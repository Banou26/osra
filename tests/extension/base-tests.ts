import type { TestAPI } from './background'
import { expect } from 'chai'

export const echo = async (api: TestAPI) => {
  expect(await api.echo({ foo: 'bar' })).to.deep.equal({ foo: 'bar' })
}

export const add = async (api: TestAPI) => {
  expect(await api.add(5, 3)).to.equal(8)
}

export const mathMultiply = async (api: TestAPI) => {
  expect(await api.math.multiply(6, 7)).to.equal(42)
}

export const mathDivide = async (api: TestAPI) => {
  expect(await api.math.divide(100, 4)).to.equal(25)
}

export const createCallback = async (api: TestAPI) => {
  const callback = await api.createCallback()
  expect(await callback()).to.equal(42)
}

export const callWithCallback = async (api: TestAPI) => {
  expect(await api.callWithCallback(() => 123)).to.equal(123)
}

export const getDate = async (api: TestAPI) => {
  const date = await api.getDate()
  expect(date).to.be.instanceOf(Date)
  expect(Date.now() - date.getTime()).to.be.lessThan(60000)
}

export const getError = async (api: TestAPI) => {
  const error = await api.getError()
  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('Test error')
}

export const throwError = async (api: TestAPI) => {
  await expect(api.throwError()).to.be.rejected
}

export const processBuffer = async (api: TestAPI) => {
  const result = await api.processBuffer(new Uint8Array([1, 2, 3, 4]))
  expect(result).to.be.instanceOf(Uint8Array)
  expect(Array.from(result)).to.deep.equal([2, 4, 6, 8])
}

export const getBuffer = async (api: TestAPI) => {
  const buffer = await api.getBuffer()
  expect(buffer).to.be.instanceOf(ArrayBuffer)
  expect(buffer.byteLength).to.equal(16)
}

export const getPromise = async (api: TestAPI) => {
  const result = await api.getPromise()
  expect(result instanceof Promise ? await result : result).to.equal(123)
}

export const getStream = async (api: TestAPI) => {
  const stream = await api.getStream()
  expect(stream).to.be.instanceOf(ReadableStream)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  expect(chunks.length).to.equal(2)
  expect(Array.from(chunks[0])).to.deep.equal([1, 2, 3])
  expect(Array.from(chunks[1])).to.deep.equal([4, 5, 6])
}

export const base = {
  echo,
  add,
  mathMultiply,
  mathDivide,
  createCallback,
  callWithCallback,
  getDate,
  getError,
  throwError,
  processBuffer,
  getBuffer,
  getPromise,
  getStream
}
