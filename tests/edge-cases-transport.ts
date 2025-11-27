import * as edgeCases from './edge-cases'

// ============ Deep Replace Tests (no transport needed) ============
export const testDeepReplaceEmptyArray = edgeCases.testDeepReplaceEmptyArray
export const testDeepReplaceEmptyObject = edgeCases.testDeepReplaceEmptyObject
export const testDeepReplaceNullValues = edgeCases.testDeepReplaceNullValues
export const testDeepReplaceNestedObjects = edgeCases.testDeepReplaceNestedObjects
export const testDeepReplaceMixedArraysAndObjects = edgeCases.testDeepReplaceMixedArraysAndObjects
export const testDeepReplacePreOrder = edgeCases.testDeepReplacePreOrder
export const testDeepReplacePostOrder = edgeCases.testDeepReplacePostOrder

// ============ Transferable Utilities Tests (no transport needed) ============
export const testGetTransferableObjectsEmpty = edgeCases.testGetTransferableObjectsEmpty
export const testGetTransferableObjectsNested = edgeCases.testGetTransferableObjectsNested
export const testGetTransferableObjectsWithDuplicates = edgeCases.testGetTransferableObjectsWithDuplicates
export const testTransferBoxCreation = edgeCases.testTransferBoxCreation
export const testGetTransferBoxes = edgeCases.testGetTransferBoxes

// ============ Expose Edge Cases (require transport) ============
export const testExposeWithEmptyObject = () => edgeCases.testExposeWithEmptyObject(window)
export const testExposeWithNestedFunctions = () => edgeCases.testExposeWithNestedFunctions(window)
export const testExposeWithLargePayload = () => edgeCases.testExposeWithLargePayload(window)
export const testExposeWithMultipleDates = () => edgeCases.testExposeWithMultipleDates(window)
export const testExposeWithMultipleErrors = () => edgeCases.testExposeWithMultipleErrors(window)
export const testExposeWithArrayOfTypedArrays = () => edgeCases.testExposeWithArrayOfTypedArrays(window)
export const testExposeWithHighOrderFunction = () => edgeCases.testExposeWithHighOrderFunction(window)
