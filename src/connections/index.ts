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
import type { MessageContext } from '../utils/transport.js'

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
import { mergeRevivableModules, normalizeTransport } from './utils.js'

export * from './bidirectional.js'
export * from './relay.js'
export * from './utils.js'

export type ConnectionModule<T> = {
  readonly type: string
  // ProtocolContext<any> rather than ProtocolContext<readonly RevivableModule[]>
  // for the same bivariance reason as RevivableModule.box — concrete modules
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
  value: Capable<TModules>,
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
  }: StartConnectionsOptions<TModules>
): Promise<T> => {
  const transport = normalizeTransport(_transport)
  if (!(isEmitTransport(transport) && isReceiveTransport(transport))) {
    throw new Error(
      'osra: transport must be able to both emit and receive to establish a connection'
      + ' — pass a bidirectional platform transport or a custom { emit, receive } pair',
    )
  }
  const mergedRevivableModules = mergeRevivableModules<TModules>(configureRevivableModules)
  type MergedModules = typeof mergedRevivableModules
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  const { promise: remoteValuePromise, resolve: resolveRemoteValue, reject: rejectRemoteValue } =
    Promise.withResolvers<Capable<MergedModules>>()
  // Keeps a fire-and-forget `expose(value, …)` (the documented server-side
  // pattern) from surfacing an unhandled rejection on abort/close; awaiting
  // callers still observe the rejection through the original promise.
  remoteValuePromise.catch(() => {})

  const uuid: Uuid = _uuid ?? globalThis.crypto.randomUUID()

  const sendEnvelope = (message: MessageVariant) => {
    const envelope = { [OSRA_KEY]: key, name, uuid, ...message }
    sendOsraMessage(transport, envelope, origin, getTransferableObjects(envelope))
  }

  const sendMessage = (message: MessageVariant) => {
    if (unregisterSignal?.aborted) return
    sendEnvelope(message)
  }

  const protocolEventTarget = createTypedEventTarget<{ message: CustomEvent<Message<MergedModules>> }>()

  const ctx: ProtocolContext<MergedModules> = {
    transport,
    value: value as Capable<MergedModules>,
    revivableModules: mergedRevivableModules,
    connectionContexts,
    getUuid: () => uuid,
    presetRemoteUuid,
    sendMessage,
    protocolEventTarget,
    resolveRemoteValue,
    rejectRemoteValue,
    createConnectionEventTarget: createTypedEventTarget,
  }

  const listener = (message: Message, _: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    protocolEventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message as Message<MergedModules> }),
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

  return remoteValuePromise as Promise<T>
}
