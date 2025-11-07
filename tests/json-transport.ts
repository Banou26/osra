import type { Transport } from '../src/types'

import { expect } from 'chai'

import { expose } from '../src/index'

const jsonTransport = (): Transport => ({
  isJson: true,
  receive: (listener) => {
    window.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      listener(data, {})
    })
  },
  emit: async (message) => {
    window.postMessage(JSON.stringify(message))
  }
})

export const baseArgsAndResponse = async () => {
  const value = async (data: { foo: number }, bar: string) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
    }
    if (bar !== 'bar') {
      throw new Error('bar is not bar')
    }
    return 1
  }
  expose(value, { transport: jsonTransport() })

  const test = await expose<typeof value>({}, { transport: jsonTransport() })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async () => {
  const value = async () => async () => 1
  expose(value, { transport: jsonTransport() })

  const test = await expose<typeof value>({}, { transport: jsonTransport() })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async () => {
  const value = async (callback: () => number) => callback()
  expose(value, { transport: jsonTransport() })

  const test = await expose<typeof value>({}, { transport: jsonTransport() })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const objectBaseArgsAndResponse = async () => {
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
  expose(value, { transport: jsonTransport() })

  const { test } = await expose<typeof value>({}, { transport: jsonTransport() })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const objectCallback = async () => {
  const value = {
    test: async () => async () => 1
  }
  expose(value, { transport: jsonTransport() })

  const { test } = await expose<typeof value>({}, { transport: jsonTransport() })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const objectCallbackAsArg = async () => {
  const value = {
    test: async (callback: () => number) => callback()
  }
  expose(value, { transport: jsonTransport() })

  const { test } = await expose<typeof value>({}, { transport: jsonTransport() })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const userMessagePort = async () => {
  const { port1: _port1, port2 } = new MessageChannel()
  const value = {
    port1: _port1
  }
  expose(value, { transport: jsonTransport() })

  const { port1 } = await expose<typeof value>({}, { transport: jsonTransport() })

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

export const userPromise = async () => {
  const value = {
    promise: Promise.resolve(1)
  }
  expose(value, { transport: jsonTransport() })

  const { promise } = await expose<typeof value>({}, { transport: jsonTransport() })

  await expect(promise).to.eventually.equal(1)
}
