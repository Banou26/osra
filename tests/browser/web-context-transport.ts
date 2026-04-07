import { base } from './base-tests'
import { baseMemory } from './base-memory-tests'
import * as customRevivables from './custom-revivables'
import * as htmlVideoElementTests from './html-video-element'

export const argsAndResponse = () => base.argsAndResponse(window)

export const callback = () => base.callback(window)

export const callbackAsArg = () => base.callbackAsArg(window)

export const objectBaseArgsAndResponse = () => base.objectBaseArgsAndResponse(window)

export const objectCallback = () => base.objectCallback(window)

export const objectCallbackAsArg = () => base.objectCallbackAsArg(window)

export const userMessagePort = () => base.userMessagePort(window)

export const userPromise = () => base.userPromise(window)

export const userArrayBuffer = () => base.userArrayBuffer(window)

export const userTypedArray = () => base.userTypedArray(window)

export const userReadableStream = () => base.userReadableStream(window)

export const userPromiseTypedArray = () => base.userPromiseTypedArray(window)

export const userDate = () => base.userDate(window)

export const userError = () => base.userError(window)

export const asyncInit = () => base.asyncInit(window)

export const userAbortSignal = () => base.userAbortSignal(window)

export const userAbortSignalAlreadyAborted = () => base.userAbortSignalAlreadyAborted(window)

export const userResponse = () => base.userResponse(window)

export const userResponseWithStreamBody = () => base.userResponseWithStreamBody(window)

export const userResponseNoBody = () => base.userResponseNoBody(window)

export const userRequest = () => base.userRequest(window)

export const userRequestWithBody = () => base.userRequestWithBody(window)

export const userRequestNoBody = () => base.userRequestNoBody(window)

export const MemoryLeaks = {
  config: {
    iterations: baseMemory.DEFAULT_ITERATIONS,
    memoryTreshold: 1_000_000,
    timeout: 60_000
  },
  functionCallsNoLeak: () => baseMemory.functionCallsNoLeak(window),
  callbacksNoLeak: () => baseMemory.callbacksNoLeak(window),
  callbackAsArgNoLeak: () => baseMemory.callbackAsArgNoLeak(window),
  promiseValuesNoLeak: () => baseMemory.promiseValuesNoLeak(window),
  objectMethodsNoLeak: () => baseMemory.objectMethodsNoLeak(window),
  largeDataTransferNoLeak: () => baseMemory.largeDataTransferNoLeak(window),
  rapidConnectionNoLeak: () => baseMemory.rapidConnectionNoLeak(window),
  errorHandlingNoLeak: () => baseMemory.errorHandlingNoLeak(window),
  nestedCallbacksNoLeak: () => baseMemory.nestedCallbacksNoLeak(window),
  concurrentCallsNoLeak: () => baseMemory.concurrentCallsNoLeak(window)
}

export const userPoint = () => customRevivables.userPoint(window)

export const userPointReturn = () => customRevivables.userPointReturn(window)

export const userPointDefaultsStillWork = () => customRevivables.userPointDefaultsStillWork(window)

export const htmlVideoElementInstanceOfCheck = () => htmlVideoElementTests.instanceOfCheck(window)

export const htmlVideoElementInitialStateMirrored = () => htmlVideoElementTests.initialStateMirrored(window)

export const htmlVideoElementWritablePropPropagation = () => htmlVideoElementTests.writablePropPropagation(window)

export const htmlVideoElementMethodCallCanPlayType = () => htmlVideoElementTests.methodCallCanPlayType(window)

export const htmlVideoElementPlayPauseRoundTrip = () => htmlVideoElementTests.playPauseRoundTrip(window)

export const htmlVideoElementEventDeltaUpdatesState = () => htmlVideoElementTests.eventDeltaUpdatesState(window)

export const htmlVideoElementAddEventListenerFires = () => htmlVideoElementTests.addEventListenerFires(window)

export const htmlVideoElementRemoveEventListenerDetaches = () => htmlVideoElementTests.removeEventListenerDetaches(window)

export const htmlVideoElementOnEventHandlerSlot = () => htmlVideoElementTests.onEventHandlerSlot(window)

export const htmlVideoElementMultipleDeltaFields = () => htmlVideoElementTests.multipleDeltaFields(window)
