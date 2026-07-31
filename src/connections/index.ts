import type { DefaultRevivableModules, RevivableModule } from '../revivables/index.js'
import type { ConnectionContext as BidirectionalConnectionContext } from './bidirectional.js'
import type {
  Message, MessageVariant, Uuid,
  Capable,
} from '../types.js'
import type {
  ProtocolContext,
  StartConnectionsOptions,
} from './utils.js'
import type { MessageContext, Context } from '../utils/transport.js'
import type { Connections, Contextual } from './utils.js'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from '../types.js'
import * as bidirectional from './bidirectional.js'
import {
  isEmitTransport,
  isReceiveTransport,
} from '../utils/type-guards.js'
import { createTypedEventTarget } from '../utils/typed-event-target.js'
import { getTransferableObjects } from '../utils/transferable.js'
import { registerOsraMessageListener, sendOsraMessage } from '../utils/transport.js'
import { runTeardown } from '../utils/teardown.js'
import { asConnections, createPeerQueue, isContextual, mergeRevivableModules, normalizeTransport, CONTEXT } from './utils.js'

export * from './bidirectional.js'
export * from './relay.js'
export * from './utils.js'

export type ConnectionModule<T> = {
  readonly type: string
  // ProtocolContext<any> rather than ProtocolContext<readonly RevivableModule[]>
  // for the same bivariance reason as RevivableModule.box - concrete modules
  // declare narrower context generics than the shared interface can express.
  readonly init: (ctx: ProtocolContext<any>) => void
  readonly Messages?: T
}

export const connections = [
  bidirectional
] as const

export type DefaultConnectionModules = typeof connections
export type DefaultConnectionModule = DefaultConnectionModules[number]

export type ConnectionMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> =
  DefaultConnectionModule extends {
    Messages: (modules: TModules, value: T) => infer R
  }
    ? R
    : never

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>

export const startConnections = <
  T = unknown,
  const TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  value: Capable<TModules> | Contextual<Capable<TModules>>,
  {
    transport: _transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    revivableModules: configureRevivableModules,
    uuid: _uuid,
    remoteUuid: presetRemoteUuid,
    context: declaredContext = {},
  }: StartConnectionsOptions<TModules>
): Connections<T> => {
  const transport = normalizeTransport(_transport)
  if (!(isEmitTransport(transport) && isReceiveTransport(transport))) {
    throw new Error(
      'osra: transport must be able to both emit and receive to establish a connection'
      + '; pass a bidirectional platform transport or a custom { emit, receive } pair',
    )
  }
  const mergedRevivableModules = mergeRevivableModules<TModules>(configureRevivableModules)
  type MergedModules = typeof mergedRevivableModules
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  const peerQueue = createPeerQueue<T>()

  const { promise: remoteValuePromise, resolve: resolveRemoteValue, reject: rejectRemoteValue } =
    Promise.withResolvers<Capable<MergedModules>>()
  // Keeps a fire-and-forget `expose(value, …)` (the documented server-side
  // pattern) from surfacing an unhandled rejection on abort/close; awaiting
  // callers still observe the rejection through the original promise.
  remoteValuePromise.catch(() => {})

  const uuid: Uuid = _uuid ?? globalThis.crypto.randomUUID()

  const sendEnvelope = (message: MessageVariant, targetOrigin: string = origin) => {
    const envelope = { [OSRA_KEY]: key, name, uuid, ...message }
    sendOsraMessage(transport, envelope, targetOrigin, getTransferableObjects(envelope))
  }

  const sendMessage = (message: MessageVariant, targetOrigin?: string) => {
    if (unregisterSignal?.aborted) return
    sendEnvelope(message, targetOrigin)
  }

  const protocolEventTarget = createTypedEventTarget<{ message: CustomEvent<{ message: Message<MergedModules>, peer: Context }> }>()

  const ctx: ProtocolContext<MergedModules> = {
    transport,
    declaredContext,
    valueFor: (peer: Context) =>
      (isContextual<Capable<MergedModules>>(value)
        ? value[CONTEXT](peer as Context & Record<string, unknown>)
        : value) as Capable<MergedModules>,
    revivableModules: mergedRevivableModules,
    connectionContexts,
    getUuid: () => uuid,
    presetRemoteUuid,
    sendMessage,
    protocolEventTarget,
    resolveRemoteValue,
    rejectRemoteValue,
    addPeer: (peer, remote) => peerQueue.push({ ...peer, remote: remote as T }),
    createConnectionEventTarget: createTypedEventTarget,
    unregisterSignal,
  }

  const listener = (message: Message, messageContext: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    // A port carries neither origin nor source, so what the caller declared wins there; a window
    // message carries both and they are browser-set, so they win over anything declared.
    const peer: Context = {
      ...declaredContext,
      ...(messageContext.origin ? { origin: messageContext.origin } : {}),
      ...(messageContext.source ? { source: messageContext.source } : {}),
      ...(messageContext.port ? { port: messageContext.port } : {}),
      ...(messageContext.sender ? { sender: messageContext.sender } : {}),
    }
    protocolEventTarget.dispatchEvent(
      new CustomEvent('message', { detail: { message: message as Message<MergedModules>, peer } }),
    )
  }

  registerOsraMessageListener({
    listener,
    transport,
    remoteName,
    key,
    origin,
    unregisterSignal
  })

  // A signal that is already aborted at call time rejects immediately and
  // registers nothing: its 'abort' event has fired and will never fire again,
  // so the listener below would leave the promise pending forever.
  if (unregisterSignal?.aborted) {
    rejectRemoteValue(unregisterSignal.reason)
    peerQueue.close()
    return asConnections(remoteValuePromise as Promise<T>, peerQueue)
  }

  // Abort = explicit local teardown: notify every tracked peer, dispose
  // per-connection state, and reject the (possibly still pending) handshake.
  unregisterSignal?.addEventListener('abort', () => {
    for (const [peerUuid, connectionContext] of connectionContexts) {
      sendEnvelope({ type: 'close', remoteUuid: peerUuid as Uuid })
      runTeardown(connectionContext.connection.revivableContext)
    }
    connectionContexts.clear()
    rejectRemoteValue(unregisterSignal.reason)
  }, { once: true })

  for (const connectionModule of connections) {
    connectionModule.init(ctx)
  }

  return asConnections(remoteValuePromise as Promise<T>, peerQueue)
}
