import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { base, bgToContent } from './base-tests'
import type { TestAPI } from './types'

use(chaiAsPromised)

let api: TestAPI

export const setApi = (newApi: TestAPI) => {
  api = newApi
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

// Background -> Content tests
export const bgToContentGetInfo = () => bgToContent.bgToContentGetInfo(api)
export const bgToContentProcess = () => bgToContent.bgToContentProcess(api)
export const bgToContentCallback = () => bgToContent.bgToContentCallback(api)
export const bgToContentGetDate = () => bgToContent.bgToContentGetDate(api)
export const bgToContentGetError = () => bgToContent.bgToContentGetError(api)
export const bgToContentThrowError = () => bgToContent.bgToContentThrowError(api)
export const bgToContentProcessBuffer = () => bgToContent.bgToContentProcessBuffer(api)
