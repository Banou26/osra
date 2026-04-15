import type { Capable, Message, MessageEventTarget, Uuid } from '../types'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type { ProtocolContext } from './utils'

import { isEmitTransport, isReceiveTransport } from '../utils/type-guards'

export type UnidirectionalEmittingConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValueProxy: T
}

export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}

export type UnidirectionalReceivingConnection = {
  close: () => void
}

export type UnidirectionalReceivingConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'unidirectional-receiving'
  eventTarget: MessageEventTarget<TModules>
  connection: UnidirectionalReceivingConnection
}

export const startUnidirectionalEmittingConnection = <T extends Capable>(
  { value, uuid, send, close }:
  {
    value: Capable
    uuid: Uuid
    send: (message: Message) => void
    close: () => void
  }
) => {

  return {
    close: () => {
    },
    remoteValueProxy: new Proxy(
      new Function(),
      {
        apply: (target, thisArg, args) => {
        },
        get: (target, prop) => {
        }
      }
    ) as T
  }
}

export const startUnidirectionalReceivingConnection = (
  { uuid, remoteUuid, close }:
  {
    uuid: Uuid
    remoteUuid?: Uuid
    eventTarget: TypedMessagePort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    }
  }
}

/**
 * Emit-only mode: transport can send but not receive. We can't do a
 * handshake, so we just build a proxy that serializes calls over the wire
 * and resolve the remote value immediately.
 */
export const unidirectionalEmitting = {
  type: 'unidirectional-emitting' as const,
  init: <TModules extends readonly RevivableModule[]>(
    ctx: ProtocolContext<TModules>
  ): void => {
    if (!(isEmitTransport(ctx.transport) && !isReceiveTransport(ctx.transport))) return

    const { remoteValueProxy } = startUnidirectionalEmittingConnection<Capable>({
      value: ctx.value,
      uuid: ctx.getUuid(),
      send: (message) => ctx.sendMessage(message as Message),
      close: () => ctx.connectionContexts.delete(ctx.getUuid())
    })
    ctx.resolveRemoteValue(remoteValueProxy)

    ctx.sendMessage({ type: 'announce' })
  }
}

/**
 * Receive-only mode: transport can receive but not send. No handshake is
 * possible, so any inbound message is currently a protocol error.
 */
export const unidirectionalReceiving = {
  type: 'unidirectional-receiving' as const,
  init: <TModules extends readonly RevivableModule[]>(
    ctx: ProtocolContext<TModules>
  ): void => {
    if (!(isReceiveTransport(ctx.transport) && !isEmitTransport(ctx.transport))) return

    ctx.protocolEventTarget.addEventListener('message', () => {
      throw new Error('Unidirectional receiving mode not implemented')
    })
  }
}
