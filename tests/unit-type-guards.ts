import { expect } from 'chai'

import {
  isTypedArray,
  isWebSocket,
  isWorker,
  isSharedWorker,
  isMessagePort,
  isPromise,
  isFunction,
  isArrayBuffer,
  isReadableStream,
  isDate,
  isError,
  isAlwaysBox,
  isOsraMessage,
  isClonable,
  isTransferable,
  isTransferBox,
  isRevivable,
  isRevivableBox,
  isRevivablePromiseBox,
  isRevivableFunctionBox,
  isRevivableTypedArrayBox,
  isRevivableArrayBufferBox,
  isRevivableReadableStreamBox,
  isRevivableErrorBox,
  isRevivableDateBox,
  typedArrayToType,
  typedArrayTypeToTypedArrayConstructor,
  isWindow,
  isCustomEmitTransport,
  isCustomReceiveTransport,
  isCustomTransport,
  isEmitTransport,
  isReceiveTransport
} from '../src/utils/type-guards'
import { OSRA_BOX, OSRA_KEY } from '../src/types'

// ============ Primitive Type Guards ============

export const testIsTypedArray = () => {
  // Should return true for all typed arrays
  expect(isTypedArray(new Int8Array())).to.be.true
  expect(isTypedArray(new Uint8Array())).to.be.true
  expect(isTypedArray(new Uint8ClampedArray())).to.be.true
  expect(isTypedArray(new Int16Array())).to.be.true
  expect(isTypedArray(new Uint16Array())).to.be.true
  expect(isTypedArray(new Int32Array())).to.be.true
  expect(isTypedArray(new Uint32Array())).to.be.true
  expect(isTypedArray(new Float32Array())).to.be.true
  expect(isTypedArray(new Float64Array())).to.be.true
  expect(isTypedArray(new BigInt64Array())).to.be.true
  expect(isTypedArray(new BigUint64Array())).to.be.true

  // Should return false for non-typed arrays
  expect(isTypedArray([])).to.be.false
  expect(isTypedArray(new ArrayBuffer(8))).to.be.false
  expect(isTypedArray(null)).to.be.false
  expect(isTypedArray(undefined)).to.be.false
  expect(isTypedArray({})).to.be.false
  expect(isTypedArray('string')).to.be.false
  expect(isTypedArray(123)).to.be.false
}

export const testIsMessagePort = () => {
  const { port1, port2 } = new MessageChannel()

  expect(isMessagePort(port1)).to.be.true
  expect(isMessagePort(port2)).to.be.true

  expect(isMessagePort(null)).to.be.false
  expect(isMessagePort(undefined)).to.be.false
  expect(isMessagePort({})).to.be.false
  expect(isMessagePort(window)).to.be.false

  port1.close()
  port2.close()
}

export const testIsPromise = () => {
  expect(isPromise(Promise.resolve())).to.be.true
  expect(isPromise(new Promise(() => {}))).to.be.true
  expect(isPromise(Promise.reject().catch(() => {}))).to.be.true

  expect(isPromise(null)).to.be.false
  expect(isPromise(undefined)).to.be.false
  expect(isPromise({ then: () => {} })).to.be.false // thenable but not Promise
  expect(isPromise(() => {})).to.be.false
}

export const testIsFunction = () => {
  expect(isFunction(() => {})).to.be.true
  expect(isFunction(function() {})).to.be.true
  expect(isFunction(async () => {})).to.be.true
  expect(isFunction(class {})).to.be.true

  expect(isFunction(null)).to.be.false
  expect(isFunction(undefined)).to.be.false
  expect(isFunction({})).to.be.false
  expect(isFunction('function')).to.be.false
}

export const testIsArrayBuffer = () => {
  expect(isArrayBuffer(new ArrayBuffer(8))).to.be.true

  expect(isArrayBuffer(new Uint8Array(8))).to.be.false
  expect(isArrayBuffer(null)).to.be.false
  expect(isArrayBuffer(undefined)).to.be.false
  expect(isArrayBuffer({})).to.be.false
}

export const testIsReadableStream = () => {
  expect(isReadableStream(new ReadableStream())).to.be.true

  expect(isReadableStream(new WritableStream())).to.be.false
  expect(isReadableStream(null)).to.be.false
  expect(isReadableStream(undefined)).to.be.false
  expect(isReadableStream({})).to.be.false
}

export const testIsDate = () => {
  expect(isDate(new Date())).to.be.true
  expect(isDate(new Date('2025-01-01'))).to.be.true

  expect(isDate(Date.now())).to.be.false
  expect(isDate('2025-01-01')).to.be.false
  expect(isDate(null)).to.be.false
  expect(isDate(undefined)).to.be.false
}

export const testIsError = () => {
  expect(isError(new Error())).to.be.true
  expect(isError(new TypeError())).to.be.true
  expect(isError(new RangeError())).to.be.true
  expect(isError(new SyntaxError())).to.be.true

  expect(isError({ message: 'error' })).to.be.false
  expect(isError(null)).to.be.false
  expect(isError(undefined)).to.be.false
}

// ============ Composite Type Guards ============

export const testIsAlwaysBox = () => {
  // Should return true for types that always need boxing
  expect(isAlwaysBox(() => {})).to.be.true
  expect(isAlwaysBox(Promise.resolve())).to.be.true
  expect(isAlwaysBox(new Uint8Array())).to.be.true
  expect(isAlwaysBox(new Date())).to.be.true
  expect(isAlwaysBox(new Error())).to.be.true

  // Should return false for other types
  expect(isAlwaysBox(new MessageChannel().port1)).to.be.false
  expect(isAlwaysBox(new ArrayBuffer(8))).to.be.false
  expect(isAlwaysBox(new ReadableStream())).to.be.false
  expect(isAlwaysBox(null)).to.be.false
  expect(isAlwaysBox({})).to.be.false
}

export const testIsOsraMessage = () => {
  // Valid OSRA messages
  expect(isOsraMessage({ [OSRA_KEY]: 'test-key' })).to.be.true
  expect(isOsraMessage({ [OSRA_KEY]: 'test-key', type: 'announce' })).to.be.true

  // Invalid messages
  expect(isOsraMessage(null)).to.be.false
  expect(isOsraMessage(undefined)).to.be.false
  expect(isOsraMessage({})).to.be.false
  expect(isOsraMessage({ type: 'announce' })).to.be.false
  expect(isOsraMessage('string')).to.be.false
  expect(isOsraMessage(123)).to.be.false
}

export const testIsTransferable = () => {
  // Transferable objects
  expect(isTransferable(new ArrayBuffer(8))).to.be.true
  expect(isTransferable(new MessageChannel().port1)).to.be.true
  expect(isTransferable(new ReadableStream())).to.be.true
  expect(isTransferable(new WritableStream())).to.be.true
  expect(isTransferable(new TransformStream())).to.be.true

  // Non-transferable
  expect(isTransferable(null)).to.be.false
  expect(isTransferable(undefined)).to.be.false
  expect(isTransferable({})).to.be.false
  expect(isTransferable(new Uint8Array())).to.be.false
  expect(isTransferable('string')).to.be.false
}

export const testIsTransferBox = () => {
  // Valid transfer boxes
  expect(isTransferBox({ [OSRA_BOX]: 'transferable', value: new ArrayBuffer(8) })).to.be.true

  // Invalid transfer boxes
  expect(isTransferBox(null)).to.be.false
  expect(isTransferBox(undefined)).to.be.false
  expect(isTransferBox({})).to.be.false
  expect(isTransferBox({ [OSRA_BOX]: 'revivable' })).to.be.false
  expect(isTransferBox({ value: new ArrayBuffer(8) })).to.be.false
}

export const testIsRevivable = () => {
  // Revivable types
  expect(isRevivable(new MessageChannel().port1)).to.be.true
  expect(isRevivable(() => {})).to.be.true
  expect(isRevivable(Promise.resolve())).to.be.true
  expect(isRevivable(new Uint8Array())).to.be.true
  expect(isRevivable(new ArrayBuffer(8))).to.be.true
  expect(isRevivable(new ReadableStream())).to.be.true
  expect(isRevivable(new Date())).to.be.true
  expect(isRevivable(new Error())).to.be.true

  // Non-revivable
  expect(isRevivable(null)).to.be.false
  expect(isRevivable(undefined)).to.be.false
  expect(isRevivable({})).to.be.false
  expect(isRevivable('string')).to.be.false
  expect(isRevivable(123)).to.be.false
}

// ============ Revivable Box Type Guards ============

export const testIsRevivableBox = () => {
  // Valid revivable boxes
  expect(isRevivableBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.true
  expect(isRevivableBox({ [OSRA_BOX]: 'revivable', type: 'function' })).to.be.true

  // Invalid revivable boxes
  expect(isRevivableBox(null)).to.be.false
  expect(isRevivableBox(undefined)).to.be.false
  expect(isRevivableBox({})).to.be.false
  expect(isRevivableBox({ [OSRA_BOX]: 'transferable' })).to.be.false
}

export const testIsRevivablePromiseBox = () => {
  expect(isRevivablePromiseBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.true
  expect(isRevivablePromiseBox({ [OSRA_BOX]: 'revivable', type: 'function' })).to.be.false
  expect(isRevivablePromiseBox(null)).to.be.false
}

export const testIsRevivableFunctionBox = () => {
  expect(isRevivableFunctionBox({ [OSRA_BOX]: 'revivable', type: 'function' })).to.be.true
  expect(isRevivableFunctionBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableFunctionBox(null)).to.be.false
}

export const testIsRevivableTypedArrayBox = () => {
  expect(isRevivableTypedArrayBox({ [OSRA_BOX]: 'revivable', type: 'typedArray' })).to.be.true
  expect(isRevivableTypedArrayBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableTypedArrayBox(null)).to.be.false
}

export const testIsRevivableArrayBufferBox = () => {
  expect(isRevivableArrayBufferBox({ [OSRA_BOX]: 'revivable', type: 'arrayBuffer' })).to.be.true
  expect(isRevivableArrayBufferBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableArrayBufferBox(null)).to.be.false
}

export const testIsRevivableReadableStreamBox = () => {
  expect(isRevivableReadableStreamBox({ [OSRA_BOX]: 'revivable', type: 'readableStream' })).to.be.true
  expect(isRevivableReadableStreamBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableReadableStreamBox(null)).to.be.false
}

export const testIsRevivableErrorBox = () => {
  expect(isRevivableErrorBox({ [OSRA_BOX]: 'revivable', type: 'error' })).to.be.true
  expect(isRevivableErrorBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableErrorBox(null)).to.be.false
}

export const testIsRevivableDateBox = () => {
  expect(isRevivableDateBox({ [OSRA_BOX]: 'revivable', type: 'date' })).to.be.true
  expect(isRevivableDateBox({ [OSRA_BOX]: 'revivable', type: 'promise' })).to.be.false
  expect(isRevivableDateBox(null)).to.be.false
}

// ============ TypedArray Utilities ============

export const testTypedArrayToType = () => {
  expect(typedArrayToType(new Int8Array())).to.equal('Int8Array')
  expect(typedArrayToType(new Uint8Array())).to.equal('Uint8Array')
  expect(typedArrayToType(new Uint8ClampedArray())).to.equal('Uint8ClampedArray')
  expect(typedArrayToType(new Int16Array())).to.equal('Int16Array')
  expect(typedArrayToType(new Uint16Array())).to.equal('Uint16Array')
  expect(typedArrayToType(new Int32Array())).to.equal('Int32Array')
  expect(typedArrayToType(new Uint32Array())).to.equal('Uint32Array')
  expect(typedArrayToType(new Float32Array())).to.equal('Float32Array')
  expect(typedArrayToType(new Float64Array())).to.equal('Float64Array')
  expect(typedArrayToType(new BigInt64Array())).to.equal('BigInt64Array')
  expect(typedArrayToType(new BigUint64Array())).to.equal('BigUint64Array')
}

export const testTypedArrayTypeToConstructor = () => {
  expect(typedArrayTypeToTypedArrayConstructor('Int8Array')).to.equal(Int8Array)
  expect(typedArrayTypeToTypedArrayConstructor('Uint8Array')).to.equal(Uint8Array)
  expect(typedArrayTypeToTypedArrayConstructor('Uint8ClampedArray')).to.equal(Uint8ClampedArray)
  expect(typedArrayTypeToTypedArrayConstructor('Int16Array')).to.equal(Int16Array)
  expect(typedArrayTypeToTypedArrayConstructor('Uint16Array')).to.equal(Uint16Array)
  expect(typedArrayTypeToTypedArrayConstructor('Int32Array')).to.equal(Int32Array)
  expect(typedArrayTypeToTypedArrayConstructor('Uint32Array')).to.equal(Uint32Array)
  expect(typedArrayTypeToTypedArrayConstructor('Float32Array')).to.equal(Float32Array)
  expect(typedArrayTypeToTypedArrayConstructor('Float64Array')).to.equal(Float64Array)
  expect(typedArrayTypeToTypedArrayConstructor('BigInt64Array')).to.equal(BigInt64Array)
  expect(typedArrayTypeToTypedArrayConstructor('BigUint64Array')).to.equal(BigUint64Array)
}

// ============ Transport Type Guards ============

export const testIsWindow = () => {
  expect(isWindow(window)).to.be.true

  expect(isWindow(null)).to.be.false
  expect(isWindow(undefined)).to.be.false
  expect(isWindow({})).to.be.false
  expect(isWindow(document)).to.be.false
}

export const testIsCustomTransport = () => {
  // Valid custom transports
  expect(isCustomEmitTransport({ emit: () => {} })).to.be.true
  expect(isCustomEmitTransport({ emit: window })).to.be.true
  expect(isCustomReceiveTransport({ receive: () => {} })).to.be.true
  expect(isCustomReceiveTransport({ receive: window })).to.be.true
  expect(isCustomTransport({ emit: () => {}, receive: () => {} })).to.be.true

  // Invalid custom transports
  expect(isCustomEmitTransport(null)).to.be.false
  expect(isCustomEmitTransport({})).to.be.false
  expect(isCustomReceiveTransport(null)).to.be.false
  expect(isCustomReceiveTransport({})).to.be.false
}

export const testIsEmitTransport = () => {
  expect(isEmitTransport(window)).to.be.true
  expect(isEmitTransport(new MessageChannel().port1)).to.be.true
  expect(isEmitTransport({ emit: () => {} })).to.be.true

  expect(isEmitTransport(null)).to.be.false
  expect(isEmitTransport({})).to.be.false
}

export const testIsReceiveTransport = () => {
  expect(isReceiveTransport(window)).to.be.true
  expect(isReceiveTransport(new MessageChannel().port1)).to.be.true
  expect(isReceiveTransport({ receive: () => {} })).to.be.true

  expect(isReceiveTransport(null)).to.be.false
  expect(isReceiveTransport({})).to.be.false
}
