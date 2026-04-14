import type {
  Capable,
  Message,
  MessageVariant,
  Transport,
  Uuid
} from '../types'
import type { TypedMessagePort } from './typed-message-channel'
import type {
  RevivablesMessageEventTarget,
  RevivableContext,
  InferMessages
} from '../revivables'

import { DefaultRevivableModules, recursiveBox, recursiveRevive, RevivableModule } from '../revivables'

export type BidirectionalConnectionContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  type: 'bidirectional'
  eventTarget: RevivablesMessageEventTarget<TModules>
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> = {
  type: 'unidirectional-receiving'
  eventTarget: RevivablesMessageEventTarget<TModules>
  connection: UnidirectionalReceivingConnection
}

export type ConnectionContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> =
  | BidirectionalConnectionContext<TModules>
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext<TModules>

/**
 * @deprecated Use RevivableContext from '../revivables' instead
 */
export type ConnectionRevivableContext<TModules extends readonly RevivableModule[] = DefaultRevivableModules> =
  RevivableContext<TModules>

export type BidirectionalConnection<T extends Capable = Capable> = {
  revivableContext: RevivableContext<readonly RevivableModule[]>
  close: () => void
  remoteValue: Promise<T>
}

type SendableMessage<TModules extends readonly RevivableModule[]> =
  MessageVariant | InferMessages<TModules>

export const startBidirectionalConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { transport, value, uuid, remoteUuid, eventTarget, send, close, revivableModules, unregisterSignal }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    eventTarget: RevivablesMessageEventTarget<TModules>
    send: (message: SendableMessage<TModules>) => void
    close: () => void
    revivableModules: TModules
    unregisterSignal?: AbortSignal
  }
) => {
  const revivableContext: RevivableContext<TModules> = {
    transport,
    remoteUuid,
    messagePorts: new Set(),
    sendMessage: send,
    eventTarget,
    revivableModules,
    unregisterSignal,
  }
  type InitMessage = { type: 'init'; remoteUuid: Uuid; data: Capable }
  const { promise: initMessage, resolve: initResolve } = Promise.withResolvers<InitMessage>()

  for (const module of revivableModules) {
    module.init?.(revivableContext as unknown as RevivableContext)
  }

  eventTarget.addEventListener('message', (event) => {
    const detail = (event as CustomEvent).detail as { type: string }
    if (detail.type === 'init') {
      initResolve(detail as unknown as InitMessage)
    }
  })

  send({
    type: 'init',
    remoteUuid,
    data: recursiveBox(value, revivableContext) as Capable
  })

  return {
    revivableContext,
    close: () => {
    },
    remoteValue:
      initMessage
        .then(initMessage => recursiveRevive(initMessage.data, revivableContext)) as Promise<T>
  } satisfies BidirectionalConnection<T>
}

export type UnidirectionalEmittingConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValueProxy: T
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

export type UnidirectionalReceivingConnection = {
  close: () => void
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
