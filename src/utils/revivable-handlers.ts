import type {
  Capable,
  Message,
  RevivableArrayBuffer,
  RevivableDate,
  RevivableError,
  RevivableFunction,
  RevivableFunctionCallContext,
  RevivableMessagePort,
  RevivablePromise,
  RevivablePromiseContext,
  RevivableReadableStream,
  RevivableReadableStreamPullContext,
  RevivableTypedArray,
  RevivableVariant,
  Uuid
} from '../types'
import type { ConnectionRevivableContext } from './connection'
import type { StrictMessagePort } from './message-channel'
import type { RevivableHandler } from './revivable-registry'
import type { TypedArray } from './type-guards'

import {
  revivableRegistry,
  isMessagePort,
  isPromise,
  isFunction,
  isTypedArray,
  isArrayBuffer,
  isReadableStream,
  isDate,
  isError,
  isRevivableMessagePortBox,
  isRevivablePromiseBox,
  isRevivableFunctionBox,
  isRevivableTypedArrayBox,
  isRevivableArrayBufferBox,
  isRevivableReadableStreamBox,
  isRevivableDateBox,
  isRevivableErrorBox
} from './revivable-registry'
import { getTransferableObjects } from './transferable'
import { typedArrayToType, typedArrayTypeToTypedArrayConstructor } from './type-guards'

// Forward declarations for recursive functions (will be set after import)
let recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable
let recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable

/**
 * Set the recursive box/revive functions.
 * This is needed because of circular dependency between this file and revivable.ts
 */
export const setRecursiveFunctions = (
  boxFn: typeof recursiveBox,
  reviveFn: typeof recursiveRevive
) => {
  recursiveBox = boxFn
  recursiveRevive = reviveFn
}

// ============ MessagePort Handler ============

const messagePortHandler: RevivableHandler<'messagePort', MessagePort, RevivableVariant & { type: 'messagePort' }> = {
  type: 'messagePort',
  check: isMessagePort,
  checkBox: isRevivableMessagePortBox,
  requiresJsonBoxing: true,

  box(value: MessagePort, context: ConnectionRevivableContext): RevivableVariant & { type: 'messagePort' } {
    const messagePort = value as StrictMessagePort<Capable>
    const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort })

    messagePort.addEventListener('message', ({ data }) => {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: revivableRegistry.isRevivableBox(data) ? data : recursiveBox(data, context),
        portId
      })
    })
    messagePort.start()

    context.eventTarget.addEventListener('message', function listener({ detail: message }) {
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

    return { type: 'messagePort', portId }
  },

  revive(box: RevivableMessagePort, context: ConnectionRevivableContext): MessagePort {
    const { port1: userPort, port2: internalPort } = new MessageChannel()

    internalPort.addEventListener('message', ({ data }: MessageEvent<Message & { type: 'message' }>) => {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: revivableRegistry.isRevivableBox(data) ? data : recursiveBox(data, context),
        portId: box.portId as Uuid
      })
    })
    internalPort.start()

    const existingChannel = context.messageChannels.get(box.portId)
    const { port1 } = existingChannel
      ? existingChannel
      : context.messageChannels.alloc(box.portId as Uuid)

    port1.addEventListener('message', function listener({ data: message }) {
      if (message.type === 'message-port-close') {
        if (message.portId !== box.portId) return
        port1.removeEventListener('message', listener)
        internalPort.close()
        context.messageChannels.free(box.portId)
        return
      }
      if (message.type !== 'message' || message.portId !== box.portId) return
      if (context.messagePorts.has(userPort)) {
        internalPort.postMessage(message.data)
      } else {
        const revivedData = recursiveRevive(message.data, context)
        internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
      }
    })
    port1.start()

    return userPort
  }
}

// ============ Promise Handler ============

const promiseHandler: RevivableHandler<'promise', Promise<unknown>, RevivableVariant & { type: 'promise' }> = {
  type: 'promise',
  check: isPromise,
  checkBox: isRevivablePromiseBox,
  alwaysBox: true,

  box(value: Promise<unknown>, context: ConnectionRevivableContext): RevivableVariant & { type: 'promise' } {
    const { port1: localPort, port2: remotePort } = new MessageChannel()
    context.messagePorts.add(remotePort)

    const sendResult = (result: { type: 'resolve'; data: Capable } | { type: 'reject'; error: string }) => {
      const boxedResult = recursiveBox(result, context)
      localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
      localPort.close()
    }

    value
      .then(data => sendResult({ type: 'resolve', data: data as Capable }))
      .catch(error => sendResult({ type: 'reject', error: error.stack }))

    return { type: 'promise', port: remotePort }
  },

  revive(box: RevivablePromise, context: ConnectionRevivableContext): Promise<unknown> {
    context.messagePorts.add(box.port)
    return new Promise((resolve, reject) => {
      box.port.addEventListener('message', ({ data }: MessageEvent<RevivablePromiseContext>) => {
        const result = recursiveRevive(data, context) as RevivablePromiseContext
        if (result.type === 'resolve') {
          resolve(result.data)
        } else {
          reject(result.error)
        }
        box.port.close()
      }, { once: true })
      box.port.start()
    })
  }
}

// ============ Function Handler ============

const functionHandler: RevivableHandler<'function', Function, RevivableVariant & { type: 'function' }> = {
  type: 'function',
  check: isFunction,
  checkBox: isRevivableFunctionBox,
  alwaysBox: true,

  box(value: Function, context: ConnectionRevivableContext): RevivableVariant & { type: 'function' } {
    const { port1: localPort, port2: remotePort } = new MessageChannel()
    context.messagePorts.add(remotePort)

    localPort.addEventListener('message', ({ data }: MessageEvent<RevivableFunctionCallContext>) => {
      const [returnValuePort, args] = recursiveRevive(data, context) as RevivableFunctionCallContext
      const result = (async () => value(...args))()
      const boxedResult = recursiveBox(result, context)
      returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    })
    localPort.start()

    return { type: 'function', port: remotePort }
  },

  revive(box: RevivableFunction, context: ConnectionRevivableContext): Function {
    return (...args: Capable[]) =>
      new Promise((resolve, reject) => {
        const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
        context.messagePorts.add(returnValueRemotePort)

        const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
        box.port.postMessage(callContext, getTransferableObjects(callContext))

        returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
          if (!isRevivablePromiseBox(data as any)) {
            throw new Error('Proxied function did not return a promise')
          }
          const result = recursiveRevive(data, context) as Promise<Capable>
          result
            .then(resolve)
            .catch(reject)
            .finally(() => returnValueLocalPort.close())
        })
        returnValueLocalPort.start()
      })
  }
}

// ============ TypedArray Handler ============

const typedArrayHandler: RevivableHandler<'typedArray', TypedArray, RevivableVariant & { type: 'typedArray' }> = {
  type: 'typedArray',
  check: isTypedArray,
  checkBox: isRevivableTypedArrayBox,
  alwaysBox: true,

  box(value: TypedArray, context: ConnectionRevivableContext): RevivableVariant & { type: 'typedArray' } {
    return {
      type: 'typedArray',
      typedArrayType: typedArrayToType(value),
      arrayBuffer: value.buffer as ArrayBuffer
    }
  },

  revive(box: RevivableTypedArray, context: ConnectionRevivableContext): TypedArray {
    const TypedArrayConstructor = typedArrayTypeToTypedArrayConstructor(box.typedArrayType)
    return new TypedArrayConstructor(box.arrayBuffer) as TypedArray
  }
}

// ============ ArrayBuffer Handler ============

const arrayBufferHandler: RevivableHandler<'arrayBuffer', ArrayBuffer, RevivableVariant & { type: 'arrayBuffer' }> = {
  type: 'arrayBuffer',
  check: isArrayBuffer,
  checkBox: isRevivableArrayBufferBox,
  requiresJsonBoxing: true,

  box(value: ArrayBuffer, context: ConnectionRevivableContext): RevivableVariant & { type: 'arrayBuffer' } {
    return {
      type: 'arrayBuffer',
      base64Buffer: (new Uint8Array(value) as any).toBase64() as string
    }
  },

  revive(box: RevivableArrayBuffer, context: ConnectionRevivableContext): ArrayBuffer {
    return ((Uint8Array as any).fromBase64(box.base64Buffer) as Uint8Array).buffer as ArrayBuffer
  }
}

// ============ ReadableStream Handler ============

const readableStreamHandler: RevivableHandler<'readableStream', ReadableStream, RevivableVariant & { type: 'readableStream' }> = {
  type: 'readableStream',
  check: isReadableStream,
  checkBox: isRevivableReadableStreamBox,
  requiresJsonBoxing: true,

  box(value: ReadableStream, context: ConnectionRevivableContext): RevivableVariant & { type: 'readableStream' } {
    const { port1: localPort, port2: remotePort } = new MessageChannel()
    context.messagePorts.add(remotePort)

    const reader = value.getReader()

    localPort.addEventListener('message', async ({ data }: MessageEvent<RevivableReadableStreamPullContext>) => {
      const { type } = recursiveRevive(data, context) as RevivableReadableStreamPullContext
      if (type === 'pull') {
        const pullResult = reader.read()
        const boxedResult = recursiveBox(pullResult, context)
        localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
      } else {
        reader.cancel()
        localPort.close()
      }
    })
    localPort.start()

    return { type: 'readableStream', port: remotePort }
  },

  revive(box: RevivableReadableStream, context: ConnectionRevivableContext): ReadableStream {
    context.messagePorts.add(box.port)
    box.port.start()

    return new ReadableStream({
      start(controller) {},
      pull(controller) {
        return new Promise((resolve, reject) => {
          box.port.addEventListener('message', async ({ data }: MessageEvent<Capable>) => {
            if (!isRevivablePromiseBox(data as any)) {
              throw new Error('Proxied function did not return a promise')
            }
            const result = recursiveRevive(data, context) as Promise<ReadableStreamReadResult<any>>
            result
              .then(result => {
                if (result.done) controller.close()
                else controller.enqueue(result.value)
                resolve()
              })
              .catch(reject)
          }, { once: true })
          box.port.postMessage(recursiveBox({ type: 'pull' }, context))
        })
      },
      cancel() {
        box.port.postMessage(recursiveBox({ type: 'cancel' }, context))
        box.port.close()
      }
    })
  }
}

// ============ Date Handler ============

const dateHandler: RevivableHandler<'date', Date, RevivableVariant & { type: 'date' }> = {
  type: 'date',
  check: isDate,
  checkBox: isRevivableDateBox,
  alwaysBox: true,

  box(value: Date, context: ConnectionRevivableContext): RevivableVariant & { type: 'date' } {
    return {
      type: 'date',
      ISOString: value.toISOString()
    }
  },

  revive(box: RevivableDate, context: ConnectionRevivableContext): Date {
    return new Date(box.ISOString)
  }
}

// ============ Error Handler ============

const errorHandler: RevivableHandler<'error', Error, RevivableVariant & { type: 'error' }> = {
  type: 'error',
  check: isError,
  checkBox: isRevivableErrorBox,
  alwaysBox: true,

  box(value: Error, context: ConnectionRevivableContext): RevivableVariant & { type: 'error' } {
    return {
      type: 'error',
      message: value.message,
      stack: value.stack || value.toString()
    }
  },

  revive(box: RevivableError, context: ConnectionRevivableContext): Error {
    return new Error(box.message, { cause: box.stack })
  }
}

// ============ Register all handlers ============

revivableRegistry
  .register(messagePortHandler)
  .register(promiseHandler)
  .register(functionHandler)
  .register(typedArrayHandler)
  .register(arrayBufferHandler)
  .register(readableStreamHandler)
  .register(dateHandler)
  .register(errorHandler)

/**
 * Export individual handlers for testing or extension.
 */
export const handlers = {
  messagePort: messagePortHandler,
  promise: promiseHandler,
  function: functionHandler,
  typedArray: typedArrayHandler,
  arrayBuffer: arrayBufferHandler,
  readableStream: readableStreamHandler,
  date: dateHandler,
  error: errorHandler
} as const
