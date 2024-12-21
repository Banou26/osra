import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { call, makeCallListener } from '../src/call'
import { registerListener } from '../src/register'

use(chaiAsPromised)

export const test1 = async () => {
  const listener = makeCallListener(async (data: { foo: number }) => {
    if (data.foo !== 1) {
      throw new Error('foo is not 1')
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

  await expect(callFunc('test', { foo: 1 })).to.eventually.equal(1)
  await expect(callFunc('test', { foo: 0 })).to.be.rejected
}
