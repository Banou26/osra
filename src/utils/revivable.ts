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
import { ConnectionRevivableContext } from './connection'

import { StrictMessagePort } from './message-channel'
import { isDate, isError, isFunction, isMessagePort, isPromise, isReadableStream, isRevivable, isRevivableFunctionBox, isRevivableMessagePortBox } from './type-guards'

export const boxMessagePort = (value: MessagePort, context: ConnectionRevivableContext): RevivableVariant & { type: 'messagePort' } => {
  const messagePort = value as StrictMessagePort<MessageWithContext>
  messagePort.addEventListener('message', (event) => {
    const { message } = event.data
    send({
      type: 'message',
      remoteUuid,
      data: message,
      portId: ''
    })
  })

  return {
    type: 'messagePort',
    messagePort,
    messagePortId: ''
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

export const box =
  (context: ConnectionRevivableContext) =>
    (value: Revivable) =>
      isMessagePort(value) ? boxMessagePort(value, context)
      : isFunction(value) ? boxFunction(value, context)
      : isPromise(value) ? boxPromise(value, context)
      : isError(value) ? boxError(value, context)
      : isReadableStream(value) ? boxReadableStream(value, context)
      : isDate(value) ? boxDate(value, context)
      : value

export const revive =
  (context: ConnectionRevivableContext) =>
    (value: Capable) =>
      isRevivableMessagePortBox(value) ? reviveMessagePort(value, context)
      : isRevivableFunctionBox(value) ? reviveFunction(value, context)
      : value
