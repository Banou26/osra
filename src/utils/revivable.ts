import type {
  Capable,
  MessageWithContext,
  Revivable,
  RevivableBox,
  RevivableDate,
  RevivableError,
  RevivableFunction,
  RevivableFunctionCallContext,
  RevivableMessagePort,
  RevivablePromise,
  RevivablePromiseContext,
  RevivableReadableStream,
  RevivableVariant,
  RevivableToRevivableType,
  ReviveBoxBase
} from '../types'
import type { ConnectionRevivableContext } from './connection'
import type { DeepReplace } from './replace'
import type { StrictMessagePort } from './message-channel'

import { OSRA_BOX } from '../types'
import {
  isDate, isError, isFunction,
  isMessagePort, isPromise, isReadableStream,
  isRevivable, isRevivableBox, isRevivableDateBox, isRevivableErrorBox,
  isRevivableFunctionBox, isRevivableMessagePortBox, isRevivablePromiseBox,
  isRevivableReadableStreamBox, revivableToType
} from './type-guards'
import { deepReplace } from './replace'
import { getTransferableObjects } from './transferable'

export const boxMessagePort = (
  value: MessagePort,
  context: ConnectionRevivableContext
): RevivableVariant & { type: 'messagePort' } => {
  const messagePort = value as StrictMessagePort<Capable>
  const portId = context.messagePorts.alloc(messagePort)
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId: portId
    })
  })

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.receiveMessagePort.addEventListener('message', function listener ({ data: { message } }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== portId) return
      context.receiveMessagePort.removeEventListener('message', listener)
      messagePort.close()
      return
    }
    if (message.type !== 'message' || message.portId !== portId) return
    const revivedData = recursiveRevive(message.data, context)
    const transferables = getTransferableObjects(revivedData)
    messagePort.postMessage(revivedData, transferables)
  })

  return {
    type: 'messagePort',
    messagePortId: portId
  }
}

export const reviveMessagePort = (value: RevivableMessagePort, context: ConnectionRevivableContext): StrictMessagePort<Capable> => {
  const { port1: userPort, port2: internalPort } = new MessageChannel()
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: recursiveBox(data, context),
      portId: value.messagePortId
    })
  })

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.receiveMessagePort.addEventListener('message', function listener ({ data: { message } }:  MessageEvent<MessageWithContext>) {
    if (message.type === 'message-port-close') {
      if (message.portId !== value.messagePortId) return
      context.receiveMessagePort.removeEventListener('message', listener)
      internalPort.close()
      return
    }
    if (message.type !== 'message' || message.portId !== value.messagePortId) return
    // Revive the data before sending it off through the MessagePort
    const revivedData = recursiveRevive(message.data, context)
    const transferables = getTransferableObjects(revivedData)
    internalPort.postMessage(revivedData, transferables)
  })
  return userPort
}

export const boxFunction = (value: Function, context: ConnectionRevivableContext): RevivableVariant & { type: 'function' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()

  localPort.addEventListener('message', ({ data }:  MessageEvent<RevivableFunctionCallContext>) => {
    const [returnValuePort, args] = data
    const boxedArguments = recursiveBox(args, context)
    const result = (async () => value(...boxedArguments))()
    const boxedResult = recursiveBox(result, context)
    const transferables = getTransferableObjects(boxedResult)
    returnValuePort.postMessage(boxedResult, transferables)
  })
  localPort.start()

  return {
    type: 'function',
    port: remotePort
  }
}

export const reviveFunction = (value: RevivableFunction, context: ConnectionRevivableContext): Function => {
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      returnValueLocalPort.addEventListener('message', ({ data }:  MessageEvent<Capable>) => {
        if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
      const transferables = getTransferableObjects(args)
      value.port.postMessage(callContext, transferables)
    })

  return func
}

export const boxPromise = (value: Promise<any>, context: ConnectionRevivableContext): RevivableVariant & { type: 'promise' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()

  const sendResult = (result: Capable | Error) => {
    const boxedResult = recursiveBox(result, context)
    const transferables = getTransferableObjects(boxedResult)
    localPort.postMessage(boxedResult, transferables)
    localPort.close()
  }

  value
    .then(data => sendResult({ type: 'resolve', data }))
    .catch(error => sendResult({ type: 'reject', error: error.stack }))

  return {
    type: 'promise',
    port: remotePort
  }
}

export const revivePromise = (value: RevivablePromise, context: ConnectionRevivableContext): Promise<any> =>
  new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }:  MessageEvent<RevivablePromiseContext>) => {
      const result = recursiveRevive(data, context)
      if (data.type === 'resolve') {
        resolve(result)
      } else { // data.type === 'reject'
        reject(new Error(data.error))
      }
      value.port.close()
    }, { once: true })
    value.port.start()
  })

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
  console.log('box', revivableToType(value), typeof value, value)
  const isAlwaysBox =
    isFunction(value)
    || isPromise(value)
    || isDate(value)
    || isError(value)

  if (isAlwaysBox) {
    return {
      [OSRA_BOX]: 'revivable',
      ...(
        isFunction(value) ? boxFunction(value, context)
        : isPromise(value) ? boxPromise(value, context)
        : isDate(value) ? boxDate(value, context)
        : isError(value) ? boxError(value, context)
        : value
      )
    } satisfies RevivableBox
  }

  // Function that gets called if any of the serialization methods gets called
  const trap = (hint?: 'number' | 'string' | 'default') => {
    const box = {
      [OSRA_BOX]: 'revivable',
      ...(
        isMessagePort(value) ? boxMessagePort(value, context)
        : isReadableStream(value) ? boxReadableStream(value, context)
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
  ) as DeepReplace<T, Revivable, ReturnType<typeof box>>

export const revive = (box: RevivableBox, context: ConnectionRevivableContext) => {
  // If the value got properly sent through the protocol as is, we don't need to revive it
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
