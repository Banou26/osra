import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { call, makeCallListener } from '../src/call'
import { registerListener } from '../src/register'

use(chaiAsPromised)

export const test1 = async () => {
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
  await expect(callFunc('test', { foo: 0 }, 'ba')).to.be.rejected
}

export const describe1 = {
  test2: () => {
    console.log('test2')
  }
}
