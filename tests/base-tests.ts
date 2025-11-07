import type { Transport } from '../src/types'

import { expect } from 'chai'

import { expose } from '../src/index'

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

const hashToHex = (hash: Uint8Array) =>
    Array
      .from(hash)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')

export const userArrayBuffer = async (transport: Transport) => {
  const _arrayBuffer = new ArrayBuffer(100)
  const uint8Array = new Uint8Array(_arrayBuffer)
  crypto.getRandomValues(uint8Array)
  const originalHash = hashToHex(uint8Array)
  // const originalHash = await crypto.subtle.digest('SHA-256', uint8Array).toHex()
  const value = {
    arrayBuffer: _arrayBuffer
  }
  expose(value, { transport })

  const { arrayBuffer } = await expose<typeof value>({}, { transport })
  const newHash = hashToHex(new Uint8Array(arrayBuffer))
  expect(newHash).to.equal(originalHash)
}

export const base = {
  argsAndResponse,
  callback,
  callbackAsArg,
  objectBaseArgsAndResponse,
  objectCallback,
  objectCallbackAsArg,
  userMessagePort,
  userPromise,
  userArrayBuffer
}
