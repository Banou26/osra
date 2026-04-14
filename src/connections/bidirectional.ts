import type {
  Capable,
  MessageEventTarget,
  Transport,
  Uuid
} from '../types'
import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { DeepReplaceWithBox } from '../utils/replace'

import { recursiveBox, recursiveRevive } from '../revivables'

export type BidirectionalConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget<TModules>
  connection: BidirectionalConnection
}

export type InitMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> = {
  type: 'init'
  remoteUuid: Uuid
  data: DeepReplaceWithBox<T, TModules[number]>
}

export type Messages<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  T extends Capable<TModules> = Capable<TModules>
> =
  | InitMessage<TModules, T>

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>

export type ConnectionRevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  remoteUuid: Uuid
  sendMessage: (message: Messages<TModules>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
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

export type BidirectionalConnection = ReturnType<typeof startBidirectionalConnection>
