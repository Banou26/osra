import { expect } from 'chai'

import { expose } from '../src/index'

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
  expose(value, { transport: window })

  const test = await expose<typeof value>({}, { transport: window })

  await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
  await expect(test({ foo: 0 }, 'baz')).to.be.rejected
}


// export const baseArgsAndResponse = async () => {
//   const value = {
//     test: async (data: { foo: number }, bar: string) => {
//       if (data.foo !== 1) {
//         throw new Error('foo is not 1')
//       }
//       if (bar !== 'bar') {
//         throw new Error('bar is not bar')
//       }
//       return 1
//     }
//   }
//   expose(value, { transport: window })
//   console.log('1')

//   const { test } = await expose<typeof value>({}, { transport: window })
//   console.log('2')

//   await expect(test({ foo: 1 }, 'bar')).to.eventually.equal(1)
//   await expect(test({ foo: 0 }, 'baz')).to.be.rejected
// }

// export const callback = async () => {
//   const value = { test: async () => async () => 1 }
//   expose(value, { transport: window })

//   const { test } = await expose<typeof value>({}, { transport: window })

//   const result = await test()
//   await expect(result()).to.eventually.equal(1)
// }

// export const callbackAsArg = async () => {
//   const value = { test: async (callback: () => number) => callback() }
//   expose(value, { transport: window })

//   const { test } = await expose<typeof value>({}, { transport: window })

//   const result = await test(() => 1)
//   expect(result).to.equal(1)
// }
