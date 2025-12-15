import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { base } from './base-tests'
import type { TestAPI } from './background'

use(chaiAsPromised)

let api: TestAPI

export const setApi = (newApi: TestAPI) => {
  api = newApi
}

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
