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
import type { Connection, Connections, Contextual } from './utils.js'

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
import { asConnections, createConnectionQueue, isContextual, mergeRevivableModules, normalizeTransport, CONTEXT, CONTEXT_BUILD } from './utils.js'

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
    context: buildContext,
  }: StartConnectionsOptions<TModules>
): Connections<T> => {
  const transport = normalizeTransport(_transport)
  if (!(isEmitTransport(transport) && isReceiveTransport(transport))) {
    // A REJECTION, not a throw. `expose` used to be an async function, so this surfaced as a rejected
    // promise and callers wrote `.catch`; returning Connections directly would have made it throw
    // synchronously instead and blown past every one of those handlers.
    const queue = createConnectionQueue<T>()
    queue.close()
    // same fire-and-forget guard the normal path gets below: `expose(...)` with no await must not
    // surface an unhandled rejection, while an awaiting caller still sees the error
    const rejected = Promise.reject(new Error(
      'osra: transport must be able to both emit and receive to establish a connection'
      + '; pass a bidirectional platform transport or a custom { emit, receive } pair',
    ))
    rejected.catch(() => {})
    return asConnections(rejected, queue)
  }
  const mergedRevivableModules = mergeRevivableModules<TModules>(configureRevivableModules)
  type MergedModules = typeof mergedRevivableModules
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  // A builder passed to `context(build, make)` travels with the value, so one definition types the
  // resolvers AND populates the context. The `context:` option covers a builder defined elsewhere.
  const contextBuilder = () =>
    (isContextual(value) ? value[CONTEXT_BUILD] : undefined) ?? buildContext

  const connectionQueue = createConnectionQueue<T>()

  // Resolves with the FIRST established connection, in the same shape iteration yields, so reading
  // one realm and reading many are the same destructure.
  const { promise: firstConnection, resolve: resolveFirstConnection, reject: rejectRemoteValue } =
    Promise.withResolvers<Connection<T>>()
  // Keeps a fire-and-forget `expose(value, …)` (the documented server-side
  // pattern) from surfacing an unhandled rejection on abort/close; awaiting
  // callers still observe the rejection through the original promise.
  firstConnection.catch(() => {})

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
    declaredContext: () => contextBuilder()?.({}) ?? {},
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
    rejectRemoteValue,
    abortConnection: (remoteUuid: Uuid) => {
      const connectionContext = connectionContexts.get(remoteUuid)
      if (!connectionContext) return
      connectionContexts.delete(remoteUuid)
      sendEnvelope({ type: 'close', remoteUuid })
      runTeardown(connectionContext.connection.revivableContext)
      // Same reason the peer-initiated close rejects: an abort that beats the peer's init drops that
      // init at the untracked-peer guard, so nothing would ever settle the caller's promise.
      rejectRemoteValue(new Error('osra: connection aborted'))
    },
    addConnection: (ctx, value) => {
      const connection = { ...ctx, value: value as T } as Connection<T>
      resolveFirstConnection(connection)
      connectionQueue.push(connection)
    },
    createConnectionEventTarget: createTypedEventTarget,
    unregisterSignal,
  }

  const listener = (message: Message, messageContext: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    // Built from LOCAL knowledge only. `messageContext` is what the browser told us about the
    // delivery (origin, source), which the peer cannot forge; `declaredContext` is what this side
    // already knew. Nothing from the peer's payload participates, and none of this is ever sent.
    // Observed wins over declared, so a declaration cannot overwrite a real origin.
    const observed: Context = {
      ...(messageContext.origin ? { origin: messageContext.origin } : {}),
      ...(messageContext.source ? { source: messageContext.source } : {}),
      ...(messageContext.port ? { port: messageContext.port } : {}),
      ...(messageContext.sender ? { sender: messageContext.sender } : {}),
    }
    const peer: Context = {
      ...(contextBuilder()?.(observed) ?? {}),
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
    connectionQueue.close()
    return asConnections(firstConnection, connectionQueue)
  }

  // Abort = explicit local teardown: notify every tracked peer, dispose
  // per-connection state, and reject the (possibly still pending) handshake.
  unregisterSignal?.addEventListener('abort', () => {
    for (const [peerUuid, connectionContext] of connectionContexts) {
      sendEnvelope({ type: 'close', remoteUuid: peerUuid as Uuid })
      runTeardown(connectionContext.connection.revivableContext)
    }
    connectionContexts.clear()
    // the other two exit paths close the queue; without this a `for await` over connections never
    // terminates and its async function never resumes
    connectionQueue.close()
    rejectRemoteValue(unregisterSignal.reason)
  }, { once: true })

  for (const connectionModule of connections) {
    connectionModule.init(ctx)
  }

  return asConnections(firstConnection, connectionQueue)
}
