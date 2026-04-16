import type { Transport } from '../utils/transport'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { DeepReplaceWithBox } from '../utils/replace'
import type { ProtocolContext } from './utils'
import type {
  Capable, MessageEventTarget,
  MessageVariant, Uuid
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

export declare const ConnectionContext: <
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(modules: TModules) => ConnectionContext<TModules>

export type ConnectionRevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> = {
  transport: Transport
  remoteUuid: Uuid
  sendMessage: (message: Messages<TModules, T>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export const startBidirectionalConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { transport, value, remoteUuid, eventTarget, send, revivableModules }:
  {
    transport: Transport
    value: Capable<TModules>
    uuid: Uuid
    remoteUuid: Uuid
    eventTarget: MessageEventTarget<TModules>
    send: (message: Messages<TModules>) => void
    close: () => void
    revivableModules: TModules
  }
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
    close: () => {
    },
    remoteValue:
      promise
        .then(initData =>
          recursiveRevive(initData, revivableContext) as Promise<T>
        )
  }
}

export type BidirectionalConnection<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  revivableContext: ConnectionRevivableContext<TModules>
  close: () => void
  remoteValue: Promise<Capable>
}

/**
 * init() — mounts the bidirectional mode on the shared protocol context.
 * Only activates when the transport can both emit and receive. Owns the
 * announce / reject-uuid-taken / close handshake and routes
 * per-connection messages (init / message / message-port-close) to the
 * right connection's eventTarget.
 */
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
      // todo: re-add uuid collision handling
      if (ctx.connectionContexts.has(message.uuid)) return
      // Send announce back so the other side can also create a connection
      // (in case they missed our initial announce due to timing)
      ctx.sendMessage({ type: 'announce', remoteUuid: message.uuid })
      const eventTarget = ctx.createConnectionEventTarget()
      const connectionContext = {
        type: 'bidirectional',
        eventTarget,
        connection:
          startBidirectionalConnection<Capable, TModules>({
            transport: ctx.transport,
            value: ctx.value,
            uuid: ctx.getUuid(),
            remoteUuid: message.uuid,
            eventTarget,
            send: (m) => ctx.sendMessage(m as MessageVariant),
            close: () => void ctx.connectionContexts.delete(message.uuid),
            revivableModules: ctx.revivableModules
          })
      } satisfies ConnectionContext<TModules>
      ctx.connectionContexts.set(message.uuid, connectionContext)
      connectionContext.connection.remoteValue.then((remoteValue) =>
        ctx.resolveRemoteValue(remoteValue)
      )
      return
    }
    if (message.type === 'reject-uuid-taken') {
      if (message.remoteUuid !== ctx.getUuid()) return
      ctx.rerollUuid()
      ctx.sendMessage({ type: 'announce' })
      return
    }
    if (message.type === 'close') {
      if (message.remoteUuid !== ctx.getUuid()) return
      const connectionContext = ctx.connectionContexts.get(message.uuid)
      // drop the message if the remote uuid hasn't announced itself
      if (!connectionContext) {
        console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      connectionContext.connection.close()
      ctx.connectionContexts.delete(message.uuid)
      return
    }
    // "init" | "message" | "message-port-close"
    if (message.remoteUuid !== ctx.getUuid()) return
    const connection = ctx.connectionContexts.get(message.uuid)
    if (!connection) {
      console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
      return
    }
    connection.eventTarget.dispatchEvent(
      new CustomEvent('message', { detail: message })
    )
  })

  ctx.sendMessage({ type: 'announce' })
}
