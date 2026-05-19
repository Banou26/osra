import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { ConnectionContext as BidirectionalConnectionContext } from './bidirectional'
import type {
  ProtocolContext,
  StartConnectionsOptions,
} from '../utils'
import type {
  Message, MessageVariant, Uuid,
  Capable,
} from '../types'
import type { MessageContext } from '../utils/transport'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from '../types'
import * as bidirectional from './bidirectional'
import {
  isEmitTransport,
  isReceiveTransport,
} from '../utils/type-guards'
import { createTypedEventTarget } from '../utils/typed-event-target'
import { getTransferableObjects } from '../utils/transferable'
import { attachTransportCloseDetection, onAbort, registerOsraMessageListener, sendOsraMessage } from '../utils/transport'
import { markConnStale } from '../utils/stale'
import { mergeRevivableModules, normalizeTransport } from './utils'

export * from './bidirectional'
export * from './utils'

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
    heartbeat,
  }: StartConnectionsOptions<TModules>
): Promise<T> => {
  const transport = normalizeTransport(_transport)
  const mergedRevivableModules = mergeRevivableModules<TModules>(configureRevivableModules)
  type MergedModules = typeof mergedRevivableModules
  const connectionContexts = new Map<string, ConnectionContext<MergedModules>>()

  const { promise: remoteValuePromise, resolve: resolveRemoteValue } =
    Promise.withResolvers<Capable<MergedModules>>()

  const uuid: Uuid = _uuid ?? globalThis.crypto.randomUUID()

  const sendMessage = (message: MessageVariant) => {
    if (unregisterSignal?.aborted) return
    if (!isEmitTransport(transport)) return
    const envelope = { [OSRA_KEY]: key, name, uuid, ...message }
    sendOsraMessage(transport, envelope, origin, getTransferableObjects(envelope))
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
    createConnectionEventTarget: createTypedEventTarget,
    heartbeat,
    unregisterSignal,
  }

  const listener = (message: Message, _: MessageContext) => {
    // own message looped back on the channel
    if (message.uuid === uuid) return
    protocolEventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message as Message<MergedModules> }),
    )
  }

  if (isReceiveTransport(transport)) {
    registerOsraMessageListener({
      listener,
      transport,
      remoteName,
      key,
      unregisterSignal
    })
  }

  const markAllConnStale = () => {
    const canEmit = isEmitTransport(transport)
    for (const conn of connectionContexts.values()) {
      const { revivableContext } = conn.connection
      // Sent directly (not via sendMessage) so the abort guard doesn't drop
      // it — we run from inside the abort handler. Tells peer we're going
      // away so its side flips stale too.
      if (canEmit) {
        try {
          const envelope = { [OSRA_KEY]: key, name, uuid, type: 'close' as const, remoteUuid: revivableContext.remoteUuid }
          sendOsraMessage(transport, envelope, origin, getTransferableObjects(envelope))
        } catch {}
      }
      markConnStale(revivableContext)
    }
  }

  onAbort(unregisterSignal, markAllConnStale)

  const detachClose = attachTransportCloseDetection(transport, markAllConnStale)
  onAbort(unregisterSignal, detachClose)

  // Without this race, expose() hangs forever if the transport dies before handshake.
  const { promise: preHandshakeStale, reject: rejectPreHandshake } = Promise.withResolvers<never>()
  const onPreHandshakeDeath = () => rejectPreHandshake(new Error('osra: connection became stale before handshake completed'))
  onAbort(unregisterSignal, onPreHandshakeDeath)
  const detachPreHandshakeClose = attachTransportCloseDetection(transport, onPreHandshakeDeath)
  remoteValuePromise.finally(() => detachPreHandshakeClose())

  for (const connectionModule of connections) {
    connectionModule.init(ctx)
  }

  return Promise.race([remoteValuePromise, preHandshakeStale]) as Promise<T>
}
