import type { Transport } from '../utils/transport'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { DeepReplaceWithBox } from '../utils/replace'
import type { ProtocolContext } from './utils'
import type {
  Capable, MessageEventTarget, MessageFields,
  MessageVariant, Uuid,
} from '../types'

import { recursiveBox, recursiveRevive } from '../revivables'
import { isEmitTransport, isReceiveTransport } from '../utils/type-guards'

export const type = 'bidirectional' as const

export type InitMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> = {
  type: 'init'
  remoteUuid: Uuid
  data: DeepReplaceWithBox<T, TModules[number]>
}

export declare const Messages: <
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
>(modules: TModules, value: T) =>
  | InitMessage<TModules, T>

export type Messages<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> = ReturnType<typeof Messages<TModules, T>>

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget<TModules>
  connection: BidirectionalConnection<TModules>
}

export type ConnectionRevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  remoteUuid: Uuid
  sendMessage: (message: MessageFields & Record<string, unknown>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export const startBidirectionalConnection = <
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
>(
  { transport, value, remoteUuid, eventTarget, send, revivableModules }:
  {
    transport: Transport
    value: Capable<TModules>
    remoteUuid: Uuid
    eventTarget: MessageEventTarget<TModules>
    send: (message: MessageFields & Record<string, unknown>) => void
    revivableModules: TModules
  },
) => {
  const revivableContext = {
    transport,
    remoteUuid,
    sendMessage: send,
    eventTarget,
    revivableModules
  } satisfies ConnectionRevivableContext<TModules>

  for (const module of revivableModules) {
    module.init?.(revivableContext)
  }

  const { promise, resolve } = Promise.withResolvers<InitMessage<TModules>['data']>()

  eventTarget.addEventListener('message', function listener ({ detail }) {
    if (detail.type === 'init') {
      resolve(detail.data)
      eventTarget.removeEventListener('message', listener)
    }
  })

  send({
    type: 'init',
    remoteUuid,
    data: recursiveBox(value, revivableContext)
  })

  return {
    revivableContext,
    remoteValue:
      promise
        .then(initData => recursiveRevive(initData, revivableContext) as Capable),
  }
}

export type BidirectionalConnection<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  revivableContext: ConnectionRevivableContext<TModules>
  remoteValue: Promise<Capable>
}

/** Mounts bidirectional mode on the shared protocol context. Only active
 *  when the transport can both emit and receive. */
export const init = <TModules extends readonly RevivableModule[]>(
  ctx: ProtocolContext<TModules>
): void => {
  if (!(isEmitTransport(ctx.transport) && isReceiveTransport(ctx.transport))) return

  ctx.protocolEventTarget.addEventListener('message', ({ detail: message }) => {
    if (message.type === 'announce') {
      if (!message.remoteUuid) {
        ctx.sendMessage({ type: 'announce', remoteUuid: message.uuid })
        return
      }
      if (message.remoteUuid !== ctx.getUuid()) return
      // Already-tracked uuid is the normal handshake-echo (peer re-announcing
      // back after our reply), not a collision — drop it.
      if (ctx.connectionContexts.has(message.uuid)) return
      // Echo announce back in case the peer missed our initial one.
      ctx.sendMessage({ type: 'announce', remoteUuid: message.uuid })
      const eventTarget = ctx.createConnectionEventTarget()
      const connectionContext = {
        type: 'bidirectional',
        eventTarget,
        connection:
          startBidirectionalConnection<TModules>({
            transport: ctx.transport,
            value: ctx.value,
            remoteUuid: message.uuid,
            eventTarget,
            send: (m) => ctx.sendMessage(m as MessageVariant),
            revivableModules: ctx.revivableModules
          })
      } satisfies ConnectionContext<TModules>
      ctx.connectionContexts.set(message.uuid, connectionContext)
      connectionContext.connection.remoteValue.then((remoteValue) =>
        ctx.resolveRemoteValue(remoteValue)
      )
      return
    }
    if (message.type === 'close') {
      if (message.remoteUuid !== ctx.getUuid()) return
      ctx.connectionContexts.delete(message.uuid)
      return
    }
    // "init" | "message" | "message-port-close"
    if (message.remoteUuid !== ctx.getUuid()) return
    const connection = ctx.connectionContexts.get(message.uuid)
    // drop messages from peers we haven't tracked (pre-announce or post-close)
    if (!connection) return
    connection.eventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message })
    )
  })

  if (ctx.presetRemoteUuid !== undefined) {
    const eventTarget = ctx.createConnectionEventTarget()
    const connectionContext = {
      type: 'bidirectional',
      eventTarget,
      connection:
        startBidirectionalConnection<TModules>({
          transport: ctx.transport,
          value: ctx.value,
          remoteUuid: ctx.presetRemoteUuid,
          eventTarget,
          send: (m) => ctx.sendMessage(m as MessageVariant),
          revivableModules: ctx.revivableModules
        })
    } satisfies ConnectionContext<TModules>
    ctx.connectionContexts.set(ctx.presetRemoteUuid, connectionContext)
    connectionContext.connection.remoteValue.then((remoteValue) =>
      ctx.resolveRemoteValue(remoteValue)
    )
    return
  }

  ctx.sendMessage({ type: 'announce' })
}
