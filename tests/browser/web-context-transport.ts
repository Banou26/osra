import { base } from './base-tests'
import { baseMemory } from './base-memory-tests'
import * as customRevivables from './custom-revivables'
import * as identityTests from './identity'
import * as transferTests from './transfer'

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

export const userMap = () => base.userMap(window)
export const userMapEmpty = () => base.userMapEmpty(window)
export const userMapWithLiveValues = () => base.userMapWithLiveValues(window)
export const userMapWithFunctions = () => base.userMapWithFunctions(window)
export const userMapWithComplexKeys = () => base.userMapWithComplexKeys(window)
export const userSet = () => base.userSet(window)
export const userSetEmpty = () => base.userSetEmpty(window)
export const userSetWithLiveValues = () => base.userSetWithLiveValues(window)
export const userBigInt = () => base.userBigInt(window)
export const userBigIntInMap = () => base.userBigIntInMap(window)
export const userBigInt64Array = () => base.userBigInt64Array(window)
export const userBigUint64Array = () => base.userBigUint64Array(window)
export const userPromiseRejected = () => base.userPromiseRejected(window)
export const userPromiseRejectedWithString = () => base.userPromiseRejectedWithString(window)
export const userAbortSignalErrorReason = () => base.userAbortSignalErrorReason(window)
export const userHeadersDirect = () => base.userHeadersDirect(window)
export const userArrayBufferEmpty = () => base.userArrayBufferEmpty(window)
export const userTypedArrayEmpty = () => base.userTypedArrayEmpty(window)
export const userReadableStreamMultiChunk = () => base.userReadableStreamMultiChunk(window)
export const userReadableStreamCancel = () => base.userReadableStreamCancel(window)
export const userErrorWithCause = () => base.userErrorWithCause(window)
export const userPromiseOfMap = () => base.userPromiseOfMap(window)
export const userCallbackReturningSet = () => base.userCallbackReturningSet(window)
export const userMapInsideArray = () => base.userMapInsideArray(window)
export const userArrayBufferInMap = () => base.userArrayBufferInMap(window)

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
  concurrentCallsNoLeak: () => baseMemory.concurrentCallsNoLeak(window),
  mapRoundTripNoLeak: () => baseMemory.mapRoundTripNoLeak(window),
  setRoundTripNoLeak: () => baseMemory.setRoundTripNoLeak(window),
  bigIntRoundTripNoLeak: () => baseMemory.bigIntRoundTripNoLeak(window),
}

export const userPoint = () => customRevivables.userPoint(window)

export const userPointReturn = () => customRevivables.userPointReturn(window)

export const userPointDefaultsStillWork = () => customRevivables.userPointDefaultsStillWork(window)

export const Identity = {
  sameReferenceAcrossArgs: () => identityTests.sameReferenceAcrossArgs(window),
  sameReferenceAcrossCalls: () => identityTests.sameReferenceAcrossCalls(window),
  addRemoveEventListenerPattern: () => identityTests.addRemoveEventListenerPattern(window),
  unwrappedValuesClone: () => identityTests.unwrappedValuesClone(window),
  identityIdempotentMemoized: () => identityTests.identityIdempotentMemoized(window),
  primitivesPassThrough: () => identityTests.primitivesPassThrough(window),
  identityWithFunctionStillCallable: () => identityTests.identityWithFunctionStillCallable(window),
  identityTwiceAcrossCallsCallable: () => identityTests.identityTwiceAcrossCallsCallable(window),
}

export const Transfer = {
  unwrappedBufferIsCopied: () => transferTests.unwrappedBufferIsCopied(window),
  transferredBufferIsDetached: () => transferTests.transferredBufferIsDetached(window),
  broadcastUnwrappedWorks: () => transferTests.broadcastUnwrappedWorks(window),
  transferIsIdempotent: () => transferTests.transferIsIdempotent(window),
  transferIsIdempotentTypedArray: () => transferTests.transferIsIdempotentTypedArray(window),
  transferTwiceInlineStillTransfers: () => transferTests.transferTwiceInlineStillTransfers(window),
  transferTypedArrayMovesUnderlyingBuffer: () => transferTests.transferTypedArrayMovesUnderlyingBuffer(window),
  transferReadableStream: () => transferTests.transferReadableStream(window),
  nonTransferablesAreNoOp: () => transferTests.nonTransferablesAreNoOp(window),
  transferDoesNotCrashNonTransferable: () => transferTests.transferDoesNotCrashNonTransferable(window),
  messagePortStillTransfersWithoutWrapper: () => transferTests.messagePortStillTransfersWithoutWrapper(window),
  transferredBufferDataRoundTrips: () => transferTests.transferredBufferDataRoundTrips(window),
}
