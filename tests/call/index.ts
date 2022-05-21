import type { Resolvers } from './iframe'

import { setup, test } from 'epk'
import chaiAsPromised from 'chai-as-promised'
import chai from 'chai'

import { call } from '../../src/call'

chai.use(chaiAsPromised)
const { expect } = chai

let target: Window
setup(async () => {
  const iframe = document.createElement('iframe')
  await new Promise(resolve => {
    iframe.addEventListener('load', () => {
      resolve(undefined)
    })
    iframe.src = 'http://localhost:5566/call/index.html'
    document.body.appendChild(iframe)
    target = iframe.contentWindow
  })
})

test('returns promise', () => {
  expect(call<Resolvers>(target)('CALL')).to.instanceOf(Promise)
})

test('promise resolves with remote function response', async () => {
  const response = await call<Resolvers>(target)('CALL')
  expect(response).to.equal(1)
})

test('promise rejects on remote function error', async () => {
  await expect(call<Resolvers>(target)('THROW')).to.eventually.be.rejectedWith(Error, 'error message')
})
