import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { registerListener } from '../src/register'

use(chaiAsPromised)

export const baseArgsAndResponse = async () => {
  const listener = async (data: { foo: number }, bar: string) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
    }
    if (bar !== 'bar') {
      throw new Error('bar is not bar')
    }
    return 1
  }

  const { call } = registerListener({
    target: window,
    messageListener: window,
    resolvers: {
      test: listener
    }
  })

  await expect(call('test', { foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(call('test', { foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async () => {
  const listener = () => () => 1

  const { call } = registerListener({
    target: window,
    messageListener: window,
    resolvers: {
      test: listener
    }
  })

  const result = await call('test')
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async () => {
  const listener = async (callback: () => number) => callback()

  const { call } = registerListener({
    target: window,
    messageListener: window,
    resolvers: {
      test: listener
    }
  })

  const result = await call('test', () => 1)
  await expect(result).to.equal(1)
}

export const polyfilledMessageChannel = async () => {
  const listener = async (callback: () => number) => callback()

  const { call } = registerListener({
    target: window,
    messageListener: window,
    resolvers: {
      test: listener
    }
  })

  const result = await call('test', () => 1)
  await expect(result).to.equal(1)
}
