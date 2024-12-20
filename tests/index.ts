import { call, makeCallListener } from '../src/call'
import { registerListener } from '../src/register'

export const test1 = async () => {
  registerListener({
    target: window,
    resolvers: {
      'test': makeCallListener(async (data: { foo: number }) => {
        if (data.foo !== 1) {
          throw new Error('foo is not 1')
        }
        return 1
      })
    }
  })

  await call(window)('test', { foo: 1 })
}

export const describe1 = {
  test2: () => {
    console.log('test2')
  }
}
