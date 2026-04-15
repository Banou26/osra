import type { Capable, Message, MessageEventTarget, Uuid } from '../types'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { TypedMessagePort } from '../utils/typed-message-channel'

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
