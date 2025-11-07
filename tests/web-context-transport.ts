import { base } from './base-tests'

export const argsAndResponse = () => base.argsAndResponse(window)

export const callback = () => base.callback(window)

export const callbackAsArg = () => base.callbackAsArg(window)

export const objectBaseArgsAndResponse = () => base.objectBaseArgsAndResponse(window)

export const objectCallback = () => base.objectCallback(window)

export const objectCallbackAsArg = () => base.objectCallbackAsArg(window)

export const userMessagePort = () => base.userMessagePort(window)

export const userPromise = () => base.userPromise(window)
