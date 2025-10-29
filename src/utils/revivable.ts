import type {
  Capable,
  Message,
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
    isAlwaysBox,
  isClonable,
  isDate, isError, isFunction,
  isMessagePort, isPromise, isReadableStream,
  isRevivable, isRevivableBox, isRevivableDateBox, isRevivableErrorBox,
  isRevivableFunctionBox, isRevivableMessagePortBox, isRevivablePromiseBox,
  isRevivableReadableStreamBox, isTransferable, revivableToType
} from './type-guards'
import { getTransferableObjects } from './transferable'

export const boxMessagePort = (
  value: MessagePort,
  context: ConnectionRevivableContext
): RevivableVariant & { type: 'messagePort' } => {
  console.log('MessagePort B', value)
  const messagePort = value as StrictMessagePort<Capable>
  const portId = context.messagePorts.alloc(messagePort)
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    console.log('MessagePort B received message', data, value)
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : recursiveBox(data, context),
      portId
    })
  })
  messagePort.start()

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.eventTarget.addEventListener('message', function listener ({ detail: message }) {
    console.log('MessagePort B received root message', message)
    if (message.type === 'message-port-close') {
      if (message.portId !== portId) return
      context.eventTarget.removeEventListener('message', listener)
      messagePort.close()
      context.messagePorts.free(portId)
      return
    }
    if (message.type !== 'message' || message.portId !== portId) return
    messagePort.postMessage(message.data, getTransferableObjects(message.data))
  })

  return {
    type: 'messagePort',
    portId
  }
}

export const reviveMessagePort = (value: RevivableMessagePort, context: ConnectionRevivableContext): StrictMessagePort<Capable> => {
  console.log('MessagePort R', value)
  const { port1: userPort, port2: internalPort } = new MessageChannel()
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }: MessageEvent<Message & { type: 'message' }>) => {
    console.log('MessagePort R received message to send', data, value)
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : recursiveBox(data, context),
      portId: value.portId
    })
  })
  internalPort.start()

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.eventTarget.addEventListener('message', function listener ({ detail: message }) {
    console.log('MessagePort R received root message', message, value)
    if (message.type === 'message-port-close') {
      if (message.portId !== value.portId) return
      context.eventTarget.removeEventListener('message', listener)
      internalPort.close()
      context.messagePorts.free(value.portId)
      return
    }
    if (message.type !== 'message' || message.portId !== value.portId) return
    console.log('MessagePort R passed the checks', message)
    // Revive the data before sending it off through the MessagePort
    const revivedData = recursiveRevive(message.data, context)
    internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
  })
  return userPort
}

export const boxPromise = (value: Promise<any>, context: ConnectionRevivableContext): RevivableVariant & { type: 'promise' } => {
  console.log('Promise B', value)
  const { port1: localPort, port2: remotePort } = new MessageChannel()

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = recursiveBox(result, context)
    console.log('Promise B sending result', boxedResult)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
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

export const revivePromise = (value: RevivablePromise, context: ConnectionRevivableContext): Promise<any> => {
  console.log('Promise R', value)
  debugger
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }:  MessageEvent<RevivablePromiseContext>) => {
      const result = recursiveRevive(data, context)
      console.log('Promise R receiving result', result)
      if (result.type === 'resolve') {
        resolve(recursiveRevive(result.data, context))
      } else { // result.type === 'reject'
        reject(recursiveRevive(result.error, context))
      }
      value.port.close()
    }, { once: true })
    value.port.start()
  })
}

export const boxFunction = (value: Function, context: ConnectionRevivableContext): RevivableVariant & { type: 'function' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()

  localPort.addEventListener('message', ({ data }:  MessageEvent<RevivableFunctionCallContext>) => {
    const [returnValuePort, args] = recursiveRevive(data, context) as RevivableFunctionCallContext
    console.log('Function B received message data', returnValuePort, args)
    const result = (async () => value(...args))()
    console.log('Function B call result', result)
    const boxedResult = recursiveBox(result, context)
    console.log('Function B call boxed result', boxedResult)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
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
      console.log('Function R called')
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      console.log('Function R sending parameters', callContext)
      value.port.postMessage(callContext, getTransferableObjects(callContext))
      
      returnValueLocalPort.addEventListener('message', ({ data }:  MessageEvent<Capable>) => {
        console.log('Function R received message data', data)
        if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
        const result = recursiveRevive(data, context) as Promise<Capable>
        console.log('Function R received promise', result)
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func
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

  if (isAlwaysBox(value)) {
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

  return {
    [OSRA_BOX]: 'revivable',
    ...context.transport.isJson
      ? (
        isMessagePort(value) ? boxMessagePort(value, context)
        : isReadableStream(value) ? boxReadableStream(value, context)
        : value
      )
      : {}
  } as ReviveBoxBase<RevivableToRevivableType<typeof value>>
}

export const recursiveBox = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, Revivable, RevivableBox> => {
  const boxedValue = isRevivable(value) ? box(value, context) : value
  return (
    Array.isArray(boxedValue) ? boxedValue.map(value => recursiveBox(value, context)) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue && typeof boxedValue === 'object' ? (
      Object.fromEntries(
        Object
          .entries(boxedValue)
          .map(([key, value]: [string, Capable]) => [
            key,
            isRevivableBox(boxedValue) && boxedValue.type === 'messagePort'
              ? value
              : recursiveBox(value, context)
          ])
      )
    ) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue as DeepReplace<T, Revivable, RevivableBox>
  )
}

export const revive = (box: RevivableBox, context: ConnectionRevivableContext) => {
  // If the value got properly sent through the protocol as is, we don't need to revive it
  if (isRevivable(box.value)) box.value

  return (
    isRevivableMessagePortBox(box) ? reviveMessagePort(box, context)
    : isRevivableFunctionBox(box) ? reviveFunction(box, context)
    : isRevivablePromiseBox(box) ? revivePromise(box, context)
    : isRevivableErrorBox(box) ? reviveError(box, context)
    : isRevivableReadableStreamBox(box) ? reviveReadableStream(box, context)
    : isRevivableDateBox(box) ? reviveDate(box, context)
    : box
  ) as DeepReplace<RevivableBox, RevivableBox, Revivable>
}

export const recursiveRevive = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, RevivableBox, Revivable> => {
  const recursedValue = (
    isTransferable(value) ? value
    : Array.isArray(value) ? value.map(value => recursiveRevive(value, context)) as DeepReplace<T, RevivableBox, Revivable>
    : value && typeof value === 'object' ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveRevive(value, context)
          ])
      )
    ) as DeepReplace<T, RevivableBox, Revivable>
    : value as DeepReplace<T, RevivableBox, Revivable>
  )
  return isRevivableBox(recursedValue) ? revive(recursedValue, context) as DeepReplace<T, RevivableBox, Revivable> : recursedValue
}
