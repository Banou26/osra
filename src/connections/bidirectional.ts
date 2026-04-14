import type {
  Capable,
  ConnectionMessage,
  MessageEventTarget,
  Transport,
  Uuid
} from '../types'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'

import { recursiveBox, recursiveRevive } from '../revivables'

export type BidirectionalConnectionContext = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget
  connection: BidirectionalConnection
}

export type InitMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> = {
  type: 'init'
  remoteUuid: Uuid
  data: T
}

export type Messages<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> =
  | InitMessage<TModules, T>

export type ConnectionContext =
  | BidirectionalConnectionContext

export type ConnectionRevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  remoteUuid: Uuid
  sendMessage: (message: ConnectionMessage) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget
}

// export type BidirectionalConnection<T extends Capable = Capable> = {
//   revivableContext: ConnectionRevivableContext<readonly RevivableModule[]>
//   close: () => void
//   remoteValue: Promise<T>
// }

export const startBidirectionalConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { transport, value, remoteUuid, eventTarget, send, revivableModules }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    eventTarget: MessageEventTarget
    send: (message: ConnectionMessage) => void
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
    if (detail.type !== 'init') return
    resolve(detail.data)
    eventTarget.removeEventListener('message', listener)
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
