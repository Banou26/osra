import { expect } from 'chai'

import { expose } from '../../src/index'

// Real MessageChannel exercises the structured-clone serialization path that
// `window.postMessage`-loopback never hits (same realm, no actual cloning).
// Each test gets its own pair so listeners don't leak.

const newPair = () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()
  return { port1, port2 }
}

export const argsAndResponseOverChannel = async () => {
  const { port1, port2 } = newPair()
  const value = async (data: { foo: number }) => data.foo + 1
  expose(value, { transport: port1 })

  const remote = await expose<typeof value>({}, { transport: port2 })

  await expect(remote({ foo: 41 })).to.eventually.equal(42)
}

export const callbackOverChannel = async () => {
  const { port1, port2 } = newPair()
  const value = async (cb: () => Promise<number>) => cb()
  expose(value, { transport: port1 })

  const remote = await expose<typeof value>({}, { transport: port2 })

  const result = await remote(async () => 7)
  expect(result).to.equal(7)
}

export const arrayBufferOverChannel = async () => {
  const { port1, port2 } = newPair()
  const _buf = new ArrayBuffer(16)
  new Uint8Array(_buf).set([1, 2, 3, 4, 5, 6, 7, 8])
  const value = { buf: _buf }
  expose(value, { transport: port1 })

  const { buf } = await expose<typeof value>({}, { transport: port2 })

  expect(buf).to.be.instanceOf(ArrayBuffer)
  expect(new Uint8Array(buf).slice(0, 8)).to.deep.equal(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
}

export const messagePortOverChannel = async () => {
  const { port1, port2 } = newPair()
  const inner = new MessageChannel()
  const value = { port: inner.port1 }
  expose(value, { transport: port1 })

  const { port } = await expose<typeof value>({}, { transport: port2 })

  expect(port).to.be.instanceOf(MessagePort)

  let receivedOnPort2: number | undefined
  inner.port2.addEventListener('message', e => { receivedOnPort2 = e.data })
  inner.port2.start()
  port.postMessage(99)

  await new Promise(r => setTimeout(r, 50))
  expect(receivedOnPort2).to.equal(99)
}

export const promiseOverChannel = async () => {
  const { port1, port2 } = newPair()
  const value = { p: Promise.resolve('hi') }
  expose(value, { transport: port1 })

  const { p } = await expose<typeof value>({}, { transport: port2 })

  await expect(p).to.eventually.equal('hi')
}

export const mapOverChannel = async () => {
  const { port1, port2 } = newPair()
  const value = { m: new Map<string, number>([['a', 1], ['b', 2]]) }
  expose(value, { transport: port1 })

  const { m } = await expose<typeof value>({}, { transport: port2 })

  expect(m).to.be.instanceOf(Map)
  expect(m.get('a')).to.equal(1)
  expect(m.get('b')).to.equal(2)
}
