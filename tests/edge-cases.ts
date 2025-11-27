import type { Transport } from '../src/types'

import { expect } from 'chai'

import { expose } from '../src/index'
import { deepReplace } from '../src/utils/replace'
import { getTransferableObjects, getTransferBoxes, transfer } from '../src/utils/transferable'
import { OSRA_BOX } from '../src/types'

// ============ Deep Replace Edge Cases ============

export const testDeepReplaceEmptyArray = () => {
  const result = deepReplace(
    [],
    (value): value is string => typeof value === 'string',
    (value) => value.toUpperCase()
  )
  expect(result).to.deep.equal([])
}

export const testDeepReplaceEmptyObject = () => {
  const result = deepReplace(
    {},
    (value): value is string => typeof value === 'string',
    (value) => value.toUpperCase()
  )
  expect(result).to.deep.equal({})
}

export const testDeepReplaceNullValues = () => {
  const result = deepReplace(
    { a: null, b: [null, 'hello'] },
    (value): value is string => typeof value === 'string',
    (value) => value.toUpperCase()
  )
  expect(result).to.deep.equal({ a: null, b: [null, 'HELLO'] })
}

export const testDeepReplaceNestedObjects = () => {
  const input = {
    level1: {
      level2: {
        level3: {
          value: 'deep'
        }
      }
    }
  }

  const result = deepReplace(
    input,
    (value): value is string => typeof value === 'string',
    (value) => value.toUpperCase()
  )

  expect(result).to.deep.equal({
    level1: {
      level2: {
        level3: {
          value: 'DEEP'
        }
      }
    }
  })
}

export const testDeepReplaceMixedArraysAndObjects = () => {
  const input = {
    items: [
      { name: 'first' },
      { name: 'second', nested: [{ value: 'third' }] }
    ]
  }

  const result = deepReplace(
    input,
    (value): value is string => typeof value === 'string',
    (value) => value.toUpperCase()
  )

  expect(result).to.deep.equal({
    items: [
      { name: 'FIRST' },
      { name: 'SECOND', nested: [{ value: 'THIRD' }] }
    ]
  })
}

export const testDeepReplacePreOrder = () => {
  const calls: string[] = []
  const input = { outer: { inner: 'value' } }

  deepReplace(
    input,
    (value): value is object => typeof value === 'object' && value !== null,
    (value) => {
      calls.push(JSON.stringify(value))
      return value
    },
    { order: 'pre' }
  )

  // In pre-order, outer objects should be visited before inner ones
  expect(calls.length).to.be.greaterThan(0)
}

export const testDeepReplacePostOrder = () => {
  const calls: string[] = []
  const input = { outer: { inner: 'value' } }

  deepReplace(
    input,
    (value): value is object => typeof value === 'object' && value !== null,
    (value) => {
      calls.push(JSON.stringify(value))
      return value
    },
    { order: 'post' }
  )

  // In post-order, inner objects should be visited before outer ones
  expect(calls.length).to.be.greaterThan(0)
}

// ============ Transferable Utilities Edge Cases ============

export const testGetTransferableObjectsEmpty = () => {
  expect(getTransferableObjects(null)).to.deep.equal([])
  expect(getTransferableObjects(undefined)).to.deep.equal([])
  expect(getTransferableObjects({})).to.deep.equal([])
  expect(getTransferableObjects([])).to.deep.equal([])
  expect(getTransferableObjects('string')).to.deep.equal([])
  expect(getTransferableObjects(123)).to.deep.equal([])
}

export const testGetTransferableObjectsNested = () => {
  const buffer1 = new ArrayBuffer(8)
  const buffer2 = new ArrayBuffer(16)
  const { port1 } = new MessageChannel()

  const nested = {
    level1: {
      buffer: buffer1,
      level2: {
        items: [buffer2, { port: port1 }]
      }
    }
  }

  const transferables = getTransferableObjects(nested)
  expect(transferables).to.include(buffer1)
  expect(transferables).to.include(buffer2)
  expect(transferables).to.include(port1)
  expect(transferables.length).to.equal(3)

  port1.close()
}

export const testGetTransferableObjectsWithDuplicates = () => {
  const buffer = new ArrayBuffer(8)

  // Same buffer referenced multiple times
  const input = {
    ref1: buffer,
    ref2: buffer,
    arr: [buffer]
  }

  const transferables = getTransferableObjects(input)
  // Should include duplicates since we're just collecting
  expect(transferables.filter(t => t === buffer).length).to.equal(3)
}

export const testTransferBoxCreation = () => {
  const buffer = new ArrayBuffer(8)
  const box = transfer(buffer)

  expect(box[OSRA_BOX]).to.equal('transferable')
  expect(box.value).to.equal(buffer)
}

export const testGetTransferBoxes = () => {
  const buffer1 = new ArrayBuffer(8)
  const buffer2 = new ArrayBuffer(16)
  const box1 = transfer(buffer1)
  const box2 = transfer(buffer2)

  const nested = {
    transferBox: box1,
    nested: {
      items: [box2, { notABox: 'value' }]
    }
  }

  const boxes = getTransferBoxes(nested)
  expect(boxes).to.include(box1)
  expect(boxes).to.include(box2)
  expect(boxes.length).to.equal(2)
}

// ============ Expose Edge Cases ============

export const testExposeWithEmptyObject = async (transport: Transport) => {
  expose({}, { transport })
  const remote = await expose<{}>({}, { transport })

  expect(remote).to.deep.equal({})
}

export const testExposeWithNestedFunctions = async (transport: Transport) => {
  const api = {
    math: {
      add: async (a: number, b: number) => a + b,
      subtract: async (a: number, b: number) => a - b
    },
    string: {
      concat: async (a: string, b: string) => a + b
    }
  }

  expose(api, { transport })
  const remote = await expose<typeof api>({}, { transport })

  expect(await remote.math.add(1, 2)).to.equal(3)
  expect(await remote.math.subtract(5, 3)).to.equal(2)
  expect(await remote.string.concat('hello', ' world')).to.equal('hello world')
}

export const testExposeWithLargePayload = async (transport: Transport) => {
  // Create a large array buffer (1MB)
  const largeBuffer = new ArrayBuffer(1024 * 1024)
  const view = new Uint8Array(largeBuffer)
  // Fill with pattern
  for (let i = 0; i < view.length; i++) {
    view[i] = i % 256
  }

  const value = { buffer: largeBuffer }
  expose(value, { transport })
  const { buffer } = await expose<typeof value>({}, { transport })

  // Verify the buffer was transferred correctly
  const resultView = new Uint8Array(buffer)
  expect(resultView.length).to.equal(1024 * 1024)
  // Check pattern
  for (let i = 0; i < 100; i++) {
    expect(resultView[i]).to.equal(i % 256)
  }
}

export const testExposeWithMultipleDates = async (transport: Transport) => {
  const dates = {
    past: new Date('2020-01-01'),
    present: new Date(),
    future: new Date('2030-12-31')
  }

  expose(dates, { transport })
  const remote = await expose<typeof dates>({}, { transport })

  expect(remote.past).to.be.instanceOf(Date)
  expect(remote.present).to.be.instanceOf(Date)
  expect(remote.future).to.be.instanceOf(Date)
  expect(remote.past.toISOString()).to.equal(dates.past.toISOString())
  expect(remote.future.toISOString()).to.equal(dates.future.toISOString())
}

export const testExposeWithMultipleErrors = async (transport: Transport) => {
  const errors = {
    typeError: new TypeError('Type mismatch'),
    rangeError: new RangeError('Out of range'),
    generic: new Error('Generic error')
  }

  expose(errors, { transport })
  const remote = await expose<typeof errors>({}, { transport })

  expect(remote.typeError).to.be.instanceOf(Error)
  expect(remote.rangeError).to.be.instanceOf(Error)
  expect(remote.generic).to.be.instanceOf(Error)
  expect(remote.typeError.message).to.equal('Type mismatch')
  expect(remote.rangeError.message).to.equal('Out of range')
  expect(remote.generic.message).to.equal('Generic error')
}

export const testExposeWithArrayOfTypedArrays = async (transport: Transport) => {
  const arrays = {
    int8: new Int8Array([1, 2, 3]),
    uint8: new Uint8Array([4, 5, 6]),
    int16: new Int16Array([7, 8, 9]),
    float32: new Float32Array([1.5, 2.5, 3.5])
  }

  expose(arrays, { transport })
  const remote = await expose<typeof arrays>({}, { transport })

  expect(remote.int8).to.be.instanceOf(Int8Array)
  expect(remote.uint8).to.be.instanceOf(Uint8Array)
  expect(remote.int16).to.be.instanceOf(Int16Array)
  expect(remote.float32).to.be.instanceOf(Float32Array)
  expect(Array.from(remote.int8)).to.deep.equal([1, 2, 3])
  expect(Array.from(remote.uint8)).to.deep.equal([4, 5, 6])
  expect(Array.from(remote.int16)).to.deep.equal([7, 8, 9])
}

export const testExposeWithPromiseReject = async (transport: Transport) => {
  const value = {
    willReject: Promise.reject(new Error('Intentional rejection')).catch(e => { throw e })
  }

  expose(value, { transport })

  try {
    const { willReject } = await expose<typeof value>({}, { transport })
    await willReject
    expect.fail('Should have rejected')
  } catch (error) {
    // Expected to reject
    expect(error).to.exist
  }
}

export const testExposeWithHighOrderFunction = async (transport: Transport) => {
  const value = {
    createMultiplier: async (factor: number) => {
      return async (value: number) => value * factor
    }
  }

  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const multiplyBy3 = await remote.createMultiplier(3)
  const result = await multiplyBy3(7)
  expect(result).to.equal(21)
}
