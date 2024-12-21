import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { call, makeCallListener } from '../src/call'
import { registerListener } from '../src/register'

use(chaiAsPromised)

export const baseArgsAndResponse = async () => {
  const listener = makeCallListener(async (data: { foo: number }, bar: string) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
    }
    if (bar !== 'bar') {
      throw new Error('bar is not bar')
    }
    return 1
  })

  const { resolvers } = registerListener({
    target: window,
    resolvers: {
      test: listener
    }
  })

  const callFunc = call<typeof resolvers>(window)

  await expect(callFunc('test', { foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(callFunc('test', { foo: 0 }, 'baz')).to.be.rejected
}

export const callback = async () => {
  const listener = makeCallListener(() => () => 1)

  const { resolvers } = registerListener({
    target: window,
    resolvers: {
      test: listener
    }
  })

  const result = await call<typeof resolvers>(window)('test')
  await expect(result()).to.eventually.equal(1)
}

export const callbackAsArg = async () => {
  const listener = makeCallListener(async (callback: () => number) => callback())

  const { resolvers } = registerListener({
    target: window,
    resolvers: {
      test: listener
    }
  })

  const result = await call<typeof resolvers>(window)('test', () => 1)
  await expect(result).to.equal(1)
}
