import type { TestAPI } from './types'
import { expect } from 'chai'
import { OSRA_CONTEXT } from '../../src/index'

// Content -> Background tests
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

export const getContext = async (api: TestAPI) => {
  const result = await api.getContext(OSRA_CONTEXT)
  expect(result.hasContext).to.be.true
  // The marker symbol should NOT be present after revival
  expect(result.hasMarker).to.be.false
  // For extension connections, port should be present
  expect(result.hasPort).to.be.true
  // Sender should be present with tab info from content script
  expect(result.hasSender).to.be.true
  // Tab ID should be a number
  expect(result.senderTabId).to.be.a('number')
  // URL should contain localhost (our test page)
  expect(result.senderUrl).to.be.a('string')
  expect(result.senderUrl).to.include('localhost')
}

export const getContextNested = async (api: TestAPI) => {
  const result = await api.getContextNested({ ctx: OSRA_CONTEXT, value: 42 })
  expect(result.value).to.equal(42)
  expect(result.hasContext).to.be.true
  expect(result.hasMarker).to.be.false
  // For extension connections, port should be present
  expect(result.hasPort).to.be.true
  expect(result.hasSender).to.be.true
}

// Background -> Content tests (via content-initiated connection)
export const bgToContentGetInfo = async (api: TestAPI) => {
  const info = await api.bgToContent.getInfo()
  expect(info).to.have.property('location')
  expect(info).to.have.property('timestamp')
}

export const bgToContentProcess = async (api: TestAPI) => {
  const result = await api.bgToContent.process('test-data')
  expect(result).to.equal('content-processed: test-data')
}

export const bgToContentCallback = async (api: TestAPI) => {
  const callback = await api.bgToContent.getCallback()
  expect(await callback()).to.equal('from-content-callback')
}

export const bgToContentGetDate = async (api: TestAPI) => {
  const date = await api.bgToContent.getDate()
  expect(date).to.be.instanceOf(Date)
  expect(Date.now() - date.getTime()).to.be.lessThan(60000)
}

export const bgToContentGetError = async (api: TestAPI) => {
  const error = await api.bgToContent.getError()
  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('Content error')
}

export const bgToContentThrowError = async (api: TestAPI) => {
  await expect(api.bgToContent.throwError()).to.be.rejected
}

export const bgToContentProcessBuffer = async (api: TestAPI) => {
  const result = await api.bgToContent.processBuffer(new Uint8Array([1, 2, 3, 4]))
  expect(result).to.be.instanceOf(Uint8Array)
  expect(Array.from(result)).to.deep.equal([2, 3, 4, 5])
}

// Background-initiated connection tests
export const bgInitiatedConnect = async (api: TestAPI) => {
  const result = await api.bgInitiated.connect()
  expect(result).to.be.true
}

export const bgInitiatedGetInfo = async (api: TestAPI) => {
  const info = await api.bgInitiated.getInfo()
  expect(info).to.have.property('location')
  expect(info).to.have.property('timestamp')
}

export const bgInitiatedProcess = async (api: TestAPI) => {
  const result = await api.bgInitiated.process('bg-initiated-data')
  expect(result).to.equal('content-processed: bg-initiated-data')
}

export const bgInitiatedGetDate = async (api: TestAPI) => {
  const date = await api.bgInitiated.getDate()
  expect(date).to.be.instanceOf(Date)
  expect(Date.now() - date.getTime()).to.be.lessThan(60000)
}

export const bgInitiatedGetError = async (api: TestAPI) => {
  const error = await api.bgInitiated.getError()
  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.equal('Content error')
}

export const bgInitiatedThrowError = async (api: TestAPI) => {
  await expect(api.bgInitiated.throwError()).to.be.rejected
}

export const bgInitiatedProcessBuffer = async (api: TestAPI) => {
  const result = await api.bgInitiated.processBuffer(new Uint8Array([1, 2, 3, 4]))
  expect(result).to.be.instanceOf(Uint8Array)
  expect(Array.from(result)).to.deep.equal([2, 3, 4, 5])
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
  getStream,
  getContext,
  getContextNested
}

export const bgToContent = {
  bgToContentGetInfo,
  bgToContentProcess,
  bgToContentCallback,
  bgToContentGetDate,
  bgToContentGetError,
  bgToContentThrowError,
  bgToContentProcessBuffer
}

export const bgInitiated = {
  bgInitiatedConnect,
  bgInitiatedGetInfo,
  bgInitiatedProcess,
  bgInitiatedGetDate,
  bgInitiatedGetError,
  bgInitiatedThrowError,
  bgInitiatedProcessBuffer
}
