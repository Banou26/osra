import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { base, bgToContent, bgInitiated } from './base-tests'
import type { TestAPI } from './types'

use(chaiAsPromised)

let api: TestAPI
let bgInitiatedApi: TestAPI | null = null

export const setApi = (newApi: TestAPI) => {
  api = newApi
}

export const setBgInitiatedApi = (newApi: TestAPI) => {
  bgInitiatedApi = newApi
}

// Content -> Background tests
export const echo = () => base.echo(api)
export const add = () => base.add(api)
export const mathMultiply = () => base.mathMultiply(api)
export const mathDivide = () => base.mathDivide(api)
export const createCallback = () => base.createCallback(api)
export const callWithCallback = () => base.callWithCallback(api)
export const getDate = () => base.getDate(api)
export const getError = () => base.getError(api)
export const throwError = () => base.throwError(api)
export const processBuffer = () => base.processBuffer(api)
export const getBuffer = () => base.getBuffer(api)
export const getPromise = () => base.getPromise(api)
export const getStream = () => base.getStream(api)
export const getContext = () => base.getContext(api)
export const getContextNested = () => base.getContextNested(api)

// Background -> Content tests (via content-initiated connection)
export const bgToContentGetInfo = () => bgToContent.bgToContentGetInfo(api)
export const bgToContentProcess = () => bgToContent.bgToContentProcess(api)
export const bgToContentCallback = () => bgToContent.bgToContentCallback(api)
export const bgToContentGetDate = () => bgToContent.bgToContentGetDate(api)
export const bgToContentGetError = () => bgToContent.bgToContentGetError(api)
export const bgToContentThrowError = () => bgToContent.bgToContentThrowError(api)
export const bgToContentProcessBuffer = () => bgToContent.bgToContentProcessBuffer(api)

// Background-initiated connection tests
export const bgInitiatedConnect = () => bgInitiated.bgInitiatedConnect(api)
export const bgInitiatedGetInfo = () => bgInitiated.bgInitiatedGetInfo(api)
export const bgInitiatedProcess = () => bgInitiated.bgInitiatedProcess(api)
export const bgInitiatedGetDate = () => bgInitiated.bgInitiatedGetDate(api)
export const bgInitiatedGetError = () => bgInitiated.bgInitiatedGetError(api)
export const bgInitiatedThrowError = () => bgInitiated.bgInitiatedThrowError(api)
export const bgInitiatedProcessBuffer = () => bgInitiated.bgInitiatedProcessBuffer(api)
