import type {
    Capable,
  MessageWithContext,
  Revivable,
  RevivableBox,
  RevivableDate,
  RevivableError,
  RevivableFunction,
  RevivableMessagePort,
  RevivablePromise,
  RevivableReadableStream,
  RevivableVariant
} from '../types'
import type { ConnectionRevivableContext } from './connection'

import {
  OSRA_BOX,
  RevivableToRevivableType,
  ReviveBoxBase,
} from '../types'
import { StrictMessagePort } from './message-channel'
import {
  isDate, isError, isFunction,
  isMessagePort, isPromise, isReadableStream,
  isRevivable, isRevivableBox, isRevivableDateBox, isRevivableErrorBox,
  isRevivableFunctionBox, isRevivableMessagePortBox, isRevivablePromiseBox,
  isRevivableReadableStreamBox, revivableToType
} from './type-guards'
import { deepReplace } from './replace'

export const boxMessagePort = (
  value: MessagePort,
  context: ConnectionRevivableContext
): RevivableVariant & { type: 'messagePort' } => {
  const messagePort = value as StrictMessagePort<Capable>
  const uuid = context.messagePorts.alloc(messagePort)
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId: uuid
    })
  })

  context.receiveMessagePort.addEventListener('message', ({ data: { message } }) => {
    if (message.type !== 'message' || message.uuid !== uuid) return
    const revivedData = recursiveRevive(message.data, context)
    messagePort.postMessage(revivedData)
  })

  return {
    type: 'messagePort',
    messagePort,
    messagePortId: uuid
  }
}

export const reviveMessagePort = (value: RevivableMessagePort, context: ConnectionRevivableContext): MessagePort => {

}

export const boxFunction = (value: Function, context: ConnectionRevivableContext): RevivableVariant & { type: 'function' } => {

}

export const reviveFunction = (value: RevivableFunction, context: ConnectionRevivableContext): Function => {

}

export const boxPromise = (value: Promise<any>, context: ConnectionRevivableContext): RevivableVariant & { type: 'promise' } => {

}

export const revivePromise = (value: RevivablePromise, context: ConnectionRevivableContext): Promise<any> => {

}

export const boxError = (value: Error, context: ConnectionRevivableContext): RevivableVariant & { type: 'error' } => {

}

export const reviveError = (value: RevivableError, context: ConnectionRevivableContext): Error => {

}

export const boxReadableStream = (value: ReadableStream, context: ConnectionRevivableContext): RevivableVariant & { type: 'readableStream' } => {

}

export const reviveReadableStream = (value: RevivableReadableStream, context: ConnectionRevivableContext): ReadableStream => {

}

export const boxDate = (value: Date, context: ConnectionRevivableContext): RevivableVariant & { type: 'date' } => {

}

export const reviveDate = (value: RevivableDate, context: ConnectionRevivableContext): Date => {

}

export const box = (value: Revivable, context: ConnectionRevivableContext) => {
  const trap = (hint?: 'number' | 'string' | 'default') => {
    const box = {
      [OSRA_BOX]: 'revivable',
      value,
      ...(
        isMessagePort(value) ? boxMessagePort(value, context)
        : isFunction(value) ? boxFunction(value, context)
        : isPromise(value) ? boxPromise(value, context)
        : isError(value) ? boxError(value, context)
        : isReadableStream(value) ? boxReadableStream(value, context)
        : isDate(value) ? boxDate(value, context)
        : value
      )
    } satisfies RevivableBox

    return (
      hint === 'string'
        ? JSON.stringify(box)
        : box
    )
  }
  return {
    [OSRA_BOX]: 'revivable',
    type: revivableToType(value),
    value,
    [Symbol.toPrimitive]: trap,
    valueOf: trap,
    toString: trap,
    toJSON: () => trap('string')
  } satisfies ReviveBoxBase<RevivableToRevivableType<typeof value>>
}

export const recursiveBox = <T extends Capable>(value: T, context: ConnectionRevivableContext) =>
  deepReplace(
    value,
    isRevivable,
    (value) => box(value, context)
  )

export const revive = (box: RevivableBox, context: ConnectionRevivableContext) => {
  if (isRevivable(box.value)) return box.value

  return (
    isRevivableMessagePortBox(box) ? reviveMessagePort(box, context)
    : isRevivableFunctionBox(box) ? reviveFunction(box, context)
    : isRevivablePromiseBox(box) ? revivePromise(box, context)
    : isRevivableErrorBox(box) ? reviveError(box, context)
    : isRevivableReadableStreamBox(box) ? reviveReadableStream(box, context)
    : isRevivableDateBox(box) ? reviveDate(box, context)
    : box
  )
}

export const recursiveRevive = <T extends Capable>(value: T, context: ConnectionRevivableContext) =>
  deepReplace(
    value,
    isRevivableBox,
    (value) => revive(value, context),
    { order: 'post' }
  )
