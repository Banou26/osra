import type { MessageContext, Transport } from '../../src/types'

import { expect } from 'chai'

import { expose, OSRA_CONTEXT } from '../../src/index'

export const argsAndResponse = async (transport: Transport) => {
  const value = async (data: { foo: number }, bar: string) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
    }
    if (bar !== 'bar') {
      throw new Error('bar is not bar')
    }
    return 1
  }
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async (transport: Transport) => {
  const value = async () => async () => 1
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async (transport: Transport) => {
  const value = async (callback: () => number) => callback()
  expose(value, { transport })

  const test = await expose<typeof value>({}, { transport })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const objectBaseArgsAndResponse = async (transport: Transport) => {
  const value = {
    test: async (data: { foo: number }, bar: string) => {
      if (data.foo !== 1) {
        throw new Error('foo is not 1')
      }
      if (bar !== 'bar') {
        throw new Error('bar is not bar')
      }
      return 1
    }
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const objectCallback = async (transport: Transport) => {
  const value = {
    test: async () => async () => 1
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const objectCallbackAsArg = async (transport: Transport) => {
  const value = {
    test: async (callback: () => number) => callback()
  }
  expose(value, { transport })

  const { test } = await expose<typeof value>({}, { transport })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const userMessagePort = async (transport: Transport) => {
  const { port1: _port1, port2 } = new MessageChannel()
  const value = {
    port1: _port1
  }
  expose(value, { transport })

  const { port1 } = await expose<typeof value>({}, { transport })

  let port1Resolve: ((value: number) => void)
  const port1Promise = new Promise<number>(resolve => port1Resolve = resolve)
  port1.addEventListener('message', event => {
    port1Resolve(event.data)
  })
  port1.start()
  port1.postMessage(1)
  
  let port2Resolve: ((value: number) => void)
  const port2Promise = new Promise<number>(resolve => port2Resolve = resolve)
  port2.addEventListener('message', event => {
    port2Resolve(event.data)
  })
  port2.start()
  port2.postMessage(2)
  
  await expect(port1Promise).to.eventually.equal(2)
  await expect(port2Promise).to.eventually.equal(1)
}

export const userPromise = async (transport: Transport) => {
  const value = {
    promise: Promise.resolve(1)
  }
  expose(value, { transport })

  const { promise } = await expose<typeof value>({}, { transport })

  await expect(promise).to.eventually.equal(1)
}

const hashToHex = async (arrayBuffer: BufferSource) =>
  new Uint8Array((await crypto.subtle.digest('SHA-256', arrayBuffer))).toHex() as string

export const userArrayBuffer = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    arrayBuffer: _arrayBuffer
  }
  expose(value, { transport })

  const { arrayBuffer } = await expose<typeof value>({}, { transport })
  const newHash = await hashToHex(arrayBuffer)
  expect(newHash).to.equal(originalHash)
}

export const userTypedArray = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const _uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(_uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    uint8Array: _uint8Array
  }
  expose(value, { transport })

  const { uint8Array } = await expose<typeof value>({}, { transport })
  expect(uint8Array).to.be.instanceOf(Uint8Array)
  const newHash = await hashToHex(uint8Array)
  expect(newHash).to.equal(originalHash)
}

export const userReadableStream = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const readableStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(uint8Array)
      controller.close()
    }
  })
  const value = {
    readableStream
  }
  expose(value, { transport })

  const { readableStream: resultReadableStream } = await expose<typeof value>({}, { transport })
  expect(resultReadableStream).to.be.instanceOf(ReadableStream)
  const reader = resultReadableStream.getReader()
  const result = await reader.read()
  if (!result.value) throw new Error('value is undefined')
  const newHash = await hashToHex(result.value.buffer as ArrayBuffer)
  expect(newHash).to.equal(originalHash)
  expect(result.done).to.be.false
  const doneResult = await reader.read()
  expect(doneResult.done).to.be.true
}

export const userPromiseTypedArray = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const _uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(_uint8Array)
  const originalHash = await hashToHex(_arrayBuffer)
  const value = {
    uint8Array: Promise.resolve(_uint8Array)
  }
  expose(value, { transport })

  const { uint8Array } = await expose<typeof value>({}, { transport })
  expect(uint8Array).to.be.instanceOf(Promise)
  const newHash = await hashToHex(await uint8Array)
  expect(newHash).to.equal(originalHash)
}

export const userDate = async (transport: Transport) => {
  const _date = new Date()
  const value = {
    date: _date
  }
  expose(value, { transport })

  const { date } = await expose<typeof value>({}, { transport })

  // Test that the date is correctly transferred
  expect(date).to.be.instanceOf(Date)
  expect(date.toISOString()).to.equal(_date.toISOString())
}

export const userError = async (transport: Transport) => {
  const _error = new Error('Test error message')
  const value = {
    error: _error,
    throwError: () => {
      throw new Error('Thrown error')
    }
  }
  expose(value, { transport })

  const { error, throwError } = await expose<typeof value>({}, { transport })

  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('Test error message')
  await expect(throwError()).to.be.rejectedWith('Thrown error')
}


export const asyncInit = async (transport: Transport) => {
  const value = {
    foo: 1
  }
  expose(value, { transport })

  await new Promise(resolve => setTimeout(resolve, 100))

  const { foo } = await expose<typeof value>({}, { transport })

  expect(foo).to.equal(1)
}

export const userContext = async (transport: Transport) => {
  let receivedContext: MessageContext | undefined
  const value = {
    getContext: (ctx: MessageContext) => {
      receivedContext = ctx
      return 'received'
    }
  }
  expose(value, { transport })

  const { getContext } = await expose<typeof value>({}, { transport })

  // OSRA_CONTEXT is typed as MessageContext, so it can be passed directly
  const result = await getContext(OSRA_CONTEXT)

  expect(result).to.equal('received')
  expect(receivedContext).to.be.an('object')
  // The context should have been populated (not the marker object)
  expect(receivedContext).to.not.have.property(Symbol.for('OSRA_CONTEXT'))
}

export const userContextInNestedObject = async (transport: Transport) => {
  let receivedContext: MessageContext | undefined
  const value = {
    process: (data: { ctx: MessageContext, name: string }) => {
      receivedContext = data.ctx
      return data.name
    }
  }
  expose(value, { transport })

  const { process } = await expose<typeof value>({}, { transport })

  const result = await process({ ctx: OSRA_CONTEXT, name: 'test' })

  expect(result).to.equal('test')
  expect(receivedContext).to.be.an('object')
  expect(receivedContext).to.not.have.property(Symbol.for('OSRA_CONTEXT'))
}

// export const userWritableStream = async (transport: Transport) => {
//   const writableStream = new WritableStream({
//     write(chunk) {
//       expect(chunk).to.deep.equal(new Uint8Array([1, 2, 3]))
//     }
//   })
//   const value = {
//     writableStream
//   }
//   expose(value, { transport })

//   const { writableStream: resultWritableStream } = await expose<typeof value>({}, { transport })
//   resultWritableStream.write(new Uint8Array([1, 2, 3]))
// }

export const base = {
  argsAndResponse,
  callback,
  callbackAsArg,
  objectBaseArgsAndResponse,
  objectCallback,
  objectCallbackAsArg,
  userMessagePort,
  userPromise,
  userArrayBuffer,
  userTypedArray,
  userReadableStream,
  userPromiseTypedArray,
  userDate,
  userError,
  asyncInit,
  userContext,
  userContextInNestedObject
}
