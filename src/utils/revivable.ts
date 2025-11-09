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
  ReviveBoxBase,
  Uuid,
  RevivableArrayBuffer
} from '../types'
import type { ConnectionRevivableContext } from './connection'
import type { DeepReplace } from './replace'
import type { StrictMessagePort } from './message-channel'

import { OSRA_BOX } from '../types'
import {
    isAlwaysBox,
  isArrayBuffer,
  isClonable,
  isDate, isError, isFunction,
  isMessagePort, isPromise, isReadableStream,
  isRevivable, isRevivableArrayBufferBox, isRevivableBox, isRevivableDateBox, isRevivableErrorBox,
  isRevivableFunctionBox, isRevivableMessagePortBox, isRevivablePromiseBox,
  isRevivableReadableStreamBox, isTransferable, revivableToType
} from './type-guards'
import { getTransferableObjects } from './transferable'

export const boxMessagePort = (
  value: MessagePort,
  context: ConnectionRevivableContext
): RevivableVariant & { type: 'messagePort' } => {
  const messagePort = value as StrictMessagePort<Capable>
  const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort })
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
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
    if (message.type === 'message-port-close') {
      if (message.portId !== portId) return
      context.eventTarget.removeEventListener('message', listener)
      messagePort.close()
      context.messageChannels.free(portId)
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
  const { port1: userPort, port2: internalPort } = new MessageChannel()
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }: MessageEvent<Message & { type: 'message' }>) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : recursiveBox(data, context),
      portId: value.portId as Uuid
    })
  })
  internalPort.start()

  const existingChannel = context.messageChannels.get(value.portId)
  const { port1 } =
    existingChannel
      ? existingChannel
      : context.messageChannels.alloc(value.portId as Uuid)
  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  port1.addEventListener('message', function listener ({ data: message }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== value.portId) return
      port1.removeEventListener('message', listener)
      internalPort.close()
      context.messageChannels.free(value.portId)
      return
    }
    if (message.type !== 'message' || message.portId !== value.portId) return
    // if the returned messagePort has been registered as internal message port, then we proxy the data without reviving it
    if (context.messagePorts.has(userPort)) {
      internalPort.postMessage(message.data)
    } else { // In this case, userPort is actually passed by the user of osra and we should revive all the message data
      const revivedData = recursiveRevive(message.data, context)
      internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
    }
  })
  port1.start()
  return userPort
}

export const boxPromise = (value: Promise<any>, context: ConnectionRevivableContext): RevivableVariant & { type: 'promise' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = recursiveBox(result, context)
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
  context.messagePorts.add(value.port)
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }:  MessageEvent<RevivablePromiseContext>) => {
      const result = recursiveRevive(data, context)
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
  context.messagePorts.add(remotePort)
  localPort.addEventListener('message', ({ data }:  MessageEvent<RevivableFunctionCallContext>) => {
    const [returnValuePort, args] = recursiveRevive(data, context) as RevivableFunctionCallContext
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
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
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }:  MessageEvent<Capable>) => {
        if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func
}

export const boxArrayBuffer = (value: ArrayBuffer, context: ConnectionRevivableContext): RevivableVariant & { type: 'arrayBuffer' } => {
  return {
    type: 'arrayBuffer',
    base64Buffer: new Uint8Array(value).toBase64() as string
  }
}

export const reviveArrayBuffer = (value: RevivableArrayBuffer, context: ConnectionRevivableContext): ArrayBuffer => {
  return (Uint8Array.fromBase64(value.base64Buffer) as Uint8Array).buffer as ArrayBuffer
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
      ),
    } satisfies RevivableBox
  }

  return {
    [OSRA_BOX]: 'revivable',
    ...'isJson' in context.transport && context.transport.isJson
      ? (
        isMessagePort(value) ? boxMessagePort(value, context)
        : isArrayBuffer(value) ? boxArrayBuffer(value, context)
        : isReadableStream(value) ? boxReadableStream(value, context)
        : value
      )
      : {
        type:
          isMessagePort(value) ? 'messagePort'
          : isArrayBuffer(value) ? 'arrayBuffer'
          : isReadableStream(value) ? 'readableStream'
          : 'unknown',
        value
      }
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
            isRevivableBox(boxedValue) && boxedValue.type === 'messagePort' && boxedValue.value instanceof MessagePort
            || isRevivableBox(boxedValue) && boxedValue.type === 'arrayBuffer' && boxedValue.value instanceof ArrayBuffer
            || isRevivableBox(boxedValue) && boxedValue.type === 'readableStream' && boxedValue.value instanceof ReadableStream
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
  if (isRevivable(box.value)) return box.value

  return (
    isRevivableMessagePortBox(box) ? reviveMessagePort(box, context)
    : isRevivableFunctionBox(box) ? reviveFunction(box, context)
    : isRevivablePromiseBox(box) ? revivePromise(box, context)
    : isRevivableErrorBox(box) ? reviveError(box, context)
    : isRevivableArrayBufferBox(box) ? reviveArrayBuffer(box, context)
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
