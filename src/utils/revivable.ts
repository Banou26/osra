/**
 * Revivable serialization/deserialization module.
 *
 * This module handles boxing (serializing) and reviving (deserializing) of complex types
 * that cannot be directly sent through standard messaging APIs.
 *
 * The module uses a registry pattern where each revivable type has a handler that knows
 * how to check, box, and revive values of that type. This makes it easy to add new
 * revivable types without modifying core logic.
 */

import type {
  Capable,
  Revivable,
  RevivableBox
} from '../types'
import type { ConnectionRevivableContext } from './connection'
import type { DeepReplace } from './replace'

import { OSRA_BOX } from '../types'
import {
  isRevivable,
  isRevivableBox,
  findHandlerForValue,
  findHandlerForBox
} from './revivable-registry'
import { setRecursiveFunctions } from './revivable-handlers'
import { isTransferable } from './type-guards'

// Import handlers to register them with the registry
import './revivable-handlers'

/**
 * Box a revivable value using the registry.
 * Determines whether boxing is needed based on the value type and transport capabilities.
 */
export const box = (value: Revivable, context: ConnectionRevivableContext): RevivableBox => {
  const handler = findHandlerForValue(value)

  if (!handler) {
    // Unknown type, return as-is with type marker
    return {
      [OSRA_BOX]: 'revivable',
      type: 'unknown' as any,
      value
    } as RevivableBox
  }

  // Check if we should always box this type
  if (handler.alwaysBox) {
    return {
      [OSRA_BOX]: 'revivable',
      ...handler.box(value, context)
    } as RevivableBox
  }

  // Check for special cases (like WebKit not supporting transferable streams)
  if (
    handler.type === 'readableStream' &&
    !context.platformCapabilities.transferableStream
  ) {
    return {
      [OSRA_BOX]: 'revivable',
      ...handler.box(value, context)
    } as RevivableBox
  }

  // Check if JSON transport requires boxing
  const isJsonTransport = 'isJson' in context.transport && context.transport.isJson
  if (isJsonTransport && handler.requiresJsonBoxing) {
    return {
      [OSRA_BOX]: 'revivable',
      ...handler.box(value, context)
    } as RevivableBox
  }

  // For non-JSON transports with types that don't require boxing,
  // just mark the type without full boxing
  return {
    [OSRA_BOX]: 'revivable',
    type: handler.type,
    value
  } as RevivableBox
}

/**
 * Recursively box all revivable values in a structure.
 */
export const recursiveBox = <T extends Capable>(
  value: T,
  context: ConnectionRevivableContext
): DeepReplace<T, Revivable, RevivableBox> => {
  // First, box if this value is revivable
  const boxedValue = isRevivable(value) ? box(value, context) : value

  // Handle arrays
  if (Array.isArray(boxedValue)) {
    return boxedValue.map(item => recursiveBox(item, context)) as DeepReplace<T, Revivable, RevivableBox>
  }

  // Handle plain objects (but not boxed values with transferable content)
  if (boxedValue && typeof boxedValue === 'object' && Object.getPrototypeOf(boxedValue) === Object.prototype) {
    // Skip recursion for boxed values that contain transferable native values
    if (isRevivableBox(boxedValue)) {
      const boxType = (boxedValue as RevivableBox).type
      const boxValue = (boxedValue as RevivableBox).value
      if (
        (boxType === 'messagePort' && boxValue instanceof MessagePort) ||
        (boxType === 'arrayBuffer' && boxValue instanceof ArrayBuffer) ||
        (boxType === 'readableStream' && boxValue instanceof ReadableStream)
      ) {
        return boxedValue as DeepReplace<T, Revivable, RevivableBox>
      }
    }

    return Object.fromEntries(
      Object.entries(boxedValue).map(([key, val]: [string, Capable]) => [
        key,
        recursiveBox(val, context)
      ])
    ) as DeepReplace<T, Revivable, RevivableBox>
  }

  return boxedValue as DeepReplace<T, Revivable, RevivableBox>
}

/**
 * Revive a boxed value using the registry.
 */
export const revive = (boxedValue: RevivableBox, context: ConnectionRevivableContext): Revivable => {
  // If the value got properly sent through the protocol as is, we don't need to revive it
  if (isRevivable(boxedValue.value)) {
    return boxedValue.value as Revivable
  }

  const handler = findHandlerForBox(boxedValue)
  if (!handler) {
    // Unknown box type, return as-is
    return boxedValue as unknown as Revivable
  }

  return handler.revive(boxedValue as any, context) as Revivable
}

/**
 * Recursively revive all boxed values in a structure.
 */
export const recursiveRevive = <T extends Capable>(
  value: T,
  context: ConnectionRevivableContext
): DeepReplace<T, RevivableBox, Revivable> => {
  // Skip transferable values (they don't need recursion)
  if (isTransferable(value)) {
    return value as DeepReplace<T, RevivableBox, Revivable>
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => recursiveRevive(item, context)) as DeepReplace<T, RevivableBox, Revivable>
  }

  // Handle objects
  if (value && typeof value === 'object') {
    const recursedValue = Object.fromEntries(
      Object.entries(value).map(([key, val]: [string, Capable]) => [
        key,
        recursiveRevive(val, context)
      ])
    ) as DeepReplace<T, RevivableBox, Revivable>

    // Check if this is a revivable box and revive it
    if (isRevivableBox(recursedValue)) {
      return revive(recursedValue as RevivableBox, context) as DeepReplace<T, RevivableBox, Revivable>
    }

    return recursedValue
  }

  return value as DeepReplace<T, RevivableBox, Revivable>
}

// Set up the recursive functions in the handlers module
setRecursiveFunctions(recursiveBox as any, recursiveRevive as any)

// Re-export registry functions for external use
// Note: isRevivable, isAlwaysBox, isRevivableBox are exported from type-guards.ts
export {
  registerHandler,
  getHandler,
  getAllHandlers,
  getRevivableType,
  findHandlerForValue,
  findHandlerForBox
} from './revivable-registry'

// Re-export handler types for extension
export type { RevivableHandler } from './revivable-registry'
