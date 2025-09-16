import { expect } from 'chai'

import { expose } from '../src/index'

export const baseArgsAndResponse = async () => {
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
  expose(value, { remote: window, local: window })

  const { test } = await expose<typeof value>({}, { remote: window, local: window })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async () => {
  const value = { test: async () => async () => 1 }
  expose(value, { remote: window, local: window })

  const { test } = await expose<typeof value>({}, { remote: window, local: window })

  const result = await test()
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async () => {
  const value = { test: async (callback: () => number) => callback() }
  expose(value, { remote: window, local: window })

  const { test } = await expose<typeof value>({}, { remote: window, local: window })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const polyfilledMessageChannel = async () => {
  const value = { test: async (callback: () => number) => callback() }
  expose(value, { remote: window, local: window })

  const { test } = await expose<typeof value>({}, { remote: window, local: window })

  const result = await test(() => 1)
  expect(result).to.equal(1)
}

export const readableStreamTransfer = async () => {
  const value = {
    test: async () =>
      new ReadableStream<string>({
        start(controller) {
          controller.enqueue('hello')
          controller.enqueue('world')
          controller.close()
        }
      })
  }
  expose(value, { remote: window, local: window })

  const { test } = await expose<typeof value>({}, { remote: window, local: window })

  const stream = await test()
  const values = [] as string[]
  for await (const value of stream) {
    values.push(value)
  }

  expect(values[0]).to.equal('hello')
  expect(values[1]).to.equal('world')
}
