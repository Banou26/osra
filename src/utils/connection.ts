import type { TypedEventTarget } from 'typescript-event-target'

import type {
  Capable,
  ConnectionMessage,
  Message,
  Transport,
  Uuid
} from '../types'
import type { StrictMessagePort } from './message-channel'
import type { DefaultRevivableModules, InferMessages, RevivableModule } from '../revivables'
import type { RevivableContext, RevivablesMessageEventMap } from '../revivables/utils'

import { recursiveBox, recursiveRevive } from '../revivables'

export type BidirectionalConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'bidirectional'
  eventTarget: TypedEventTarget<RevivablesMessageEventMap<TModules>>
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  type: 'unidirectional-receiving'
  eventTarget: TypedEventTarget<RevivablesMessageEventMap<TModules>>
  connection: UnidirectionalReceivingConnection
}

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext<TModules>

// Alias — structurally identical to RevivableContext from the revivables
// package. Kept here as an export for consumers that imported it from the
// connection utils.
export type ConnectionRevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = RevivableContext<TModules>

export type BidirectionalConnection<T extends Capable = Capable> = {
  revivableContext: ConnectionRevivableContext<readonly RevivableModule[]>
  close: () => void
  remoteValue: Promise<T>
}

export const startBidirectionalConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { transport, value, remoteUuid, unregisterSignal, eventTarget, send, revivableModules }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    eventTarget: TypedEventTarget<RevivablesMessageEventMap<TModules>>
    unregisterSignal?: AbortSignal
    send: (message: ConnectionMessage | InferMessages<TModules>) => void
    close: () => void
    revivableModules: TModules
  }
) => {
  // Explicit annotation (not `satisfies`) so sendMessage lands as a method
  // in the resulting type. Methods get bivariance in TS's strict-function
  // check, which is what lets the narrower concrete context assign to
  // `RevivableContext<readonly RevivableModule[]>` at recursiveBox/Revive
  // call sites despite the InferMessages arm being TModules-specific.
  const revivableContext: ConnectionRevivableContext<TModules> = {
    transport,
    remoteUuid,
    sendMessage: send,
    unregisterSignal,
    eventTarget,
    revivableModules,
  }

  // Let each module set up its per-connection state and listeners.
  // message-port and identity use this to install their dispatchers on the
  // shared event target.
  for (const module of revivableModules) {
    module.init?.(revivableContext)
  }

  type InitMessage = Extract<ConnectionMessage, { type: 'init' }>
  const { promise, resolve } = Promise.withResolvers<InitMessage['data']>()

  eventTarget.addEventListener('message', function listener ({ detail }) {
    if (detail.type !== 'init') return
    // TS can't narrow through the generic InferMessages<TModules> arm of the
    // event detail union, so cast to the concrete init variant.
    resolve((detail as InitMessage).data)
    eventTarget.removeEventListener('message', listener)
  })

  send({
    type: 'init',
    remoteUuid,
    data: recursiveBox(value, revivableContext) as Capable,
  })

  return {
    revivableContext,
    close: () => {},
    remoteValue:
      promise
        .then(initData => recursiveRevive(initData, revivableContext)) as Promise<T>,
  } satisfies BidirectionalConnection<T>
}

export type UnidirectionalEmittingConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValueProxy: T
}

export const startUnidirectionalEmittingConnection = <
  T extends Capable,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  { value, uuid, send, close }:
  {
    value: Capable
    uuid: Uuid
    send: (message: ConnectionMessage | InferMessages<TModules>) => void
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
    eventTarget: StrictMessagePort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    }
  }
}
