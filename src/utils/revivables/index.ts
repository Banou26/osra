import type { Capable, OSRA_BOX } from '../../types'
import type { ConnectionRevivableContext } from '../connection'
import type { DeepReplace } from '../replace'

import { OSRA_BOX as OSRA_BOX_VALUE } from '../../types'
import { isTransferable } from '../type-guards'

import * as messagePort from './message-port'
import * as promise from './promise'
import * as func from './function'
import * as typedArray from './typed-array'
import * as arrayBuffer from './array-buffer'
import * as error from './error'
import * as readableStream from './readable-stream'
import * as date from './date'

// Re-export individual modules for direct access
export { messagePort, promise, func, typedArray, arrayBuffer, error, readableStream, date }

// Re-export context types from modules that define them
export type { Context as PromiseContext } from './promise'
export type { CallContext as FunctionCallContext } from './function'
export type { PullContext as ReadableStreamPullContext } from './readable-stream'

// ============================================================================
// Module Type Definition
// ============================================================================

/**
 * Interface that all revivable modules must satisfy.
 * Each module defines:
 * - type: A string literal identifying this revivable type
 * - Source: The original value type (e.g., Promise, Date, Error)
 * - Boxed: The serialized form (e.g., { type: 'promise', port: MessagePort })
 *
 * Note: We use a looser runtime type (RevivableModuleRuntime) for the registry
 * since TypeScript's variance rules make it hard to use the strongly-typed version
 * in arrays of different module types.
 */
export interface RevivableModule<
  TType extends string = string,
  TSource = unknown,
  TBoxed extends { type: TType } = { type: TType }
> {
  readonly type: TType
  is: (value: unknown) => value is TSource
  shouldBox: (value: TSource, context: ConnectionRevivableContext) => boolean
  box: (value: TSource, context: ConnectionRevivableContext) => TBoxed
  revive: (value: TBoxed, context: ConnectionRevivableContext) => TSource
}

/**
 * A looser type for runtime use in the registry.
 * This allows storing modules with different Source/Boxed types in the same array.
 */
export interface RevivableModuleRuntime {
  readonly type: string
  readonly supportsPassthrough?: boolean
  is: (value: unknown) => boolean
  isBox: (value: unknown) => boolean
  shouldBox: (value: any, context: ConnectionRevivableContext) => boolean
  box: (value: any, context: ConnectionRevivableContext) => { type: string }
  revive: (value: any, context: ConnectionRevivableContext) => unknown
}

// ============================================================================
// Default Revivables Registry
// ============================================================================

/**
 * The default set of revivable modules that Osra supports out of the box.
 * This array's type is used to infer the Revivable and RevivableVariant types.
 */
export const defaultRevivables = [
  messagePort,
  promise,
  func,
  typedArray,
  arrayBuffer,
  error,
  readableStream,
  date
] as const

export type DefaultRevivables = typeof defaultRevivables

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Given a revivable module, extract its Source type
 */
export type ExtractSource<T> = T extends { is: (value: unknown) => value is infer S } ? S : never

/**
 * Given a revivable module, extract its Boxed type (without OSRA_BOX marker)
 */
export type ExtractBoxed<T> = T extends { box: (...args: any[]) => infer B } ? B : never

/**
 * Given a revivable module, extract its Box type (with OSRA_BOX marker)
 */
export type ExtractBox<T> = T extends { isBox: (value: unknown) => value is infer B } ? B : never

/**
 * Given a revivable module, extract its type string literal
 */
export type ExtractType<T> = T extends { readonly type: infer U } ? U : never

/**
 * Given an array of revivable modules, extract the union of all Source types
 */
export type InferRevivable<TModules extends readonly unknown[]> =
  ExtractSource<TModules[number]>

/**
 * Given an array of revivable modules, extract the union of all Boxed types
 */
export type InferRevivableVariant<TModules extends readonly unknown[]> =
  ExtractBoxed<TModules[number]>

/**
 * Given an array of revivable modules, extract the union of all Box types (with OSRA_BOX marker)
 */
export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

/**
 * Given an array of revivable modules, extract the union of all type string literals
 */
export type InferRevivableType<TModules extends readonly unknown[]> =
  ExtractType<TModules[number]>

// ============================================================================
// Inferred Types from Default Revivables
// ============================================================================

/**
 * The union of all source types that can be revived (inferred from defaultRevivables)
 */
export type Revivable = InferRevivable<DefaultRevivables>

/**
 * The union of all boxed types without OSRA_BOX marker (inferred from defaultRevivables)
 */
export type RevivableVariant = InferRevivableVariant<DefaultRevivables>

/**
 * The union of all type string literals (inferred from defaultRevivables)
 */
export type RevivableVariantType = InferRevivableType<DefaultRevivables>

/**
 * A boxed revivable value with the OSRA_BOX marker (inferred from defaultRevivables).
 * Also includes passthrough support with optional `value` field.
 */
export type RevivableBox = InferRevivableBox<DefaultRevivables> & { value?: unknown }

/**
 * Base type for a revivable box
 */
export type ReviveBoxBase<T extends RevivableVariantType = RevivableVariantType> = {
  [K in typeof OSRA_BOX_VALUE]: 'revivable'
} & {
  type: T
  value?: unknown
  [Symbol.toPrimitive]?: Function
  valueOf?: Function
  toString?: Function
  toJSON?: Function
}

// ============================================================================
// Type Mapping Utilities (Fully Inferred)
// ============================================================================

/**
 * Given a Source type and modules array, find the matching type string.
 * Iterates over all modules and returns the type of the first module whose Source matches.
 */
export type SourceToRevivableType<
  TSource,
  TModules extends readonly unknown[] = DefaultRevivables
> = {
  [K in keyof TModules]: TModules[K] extends { is: (v: unknown) => v is infer S, readonly type: infer TType }
    ? TSource extends S ? TType : never
    : never
}[number]

/**
 * Given a type string and modules array, find the matching Source type.
 * Iterates over all modules and returns the Source of the first module whose type matches.
 */
export type RevivableTypeToSource<
  TType extends string,
  TModules extends readonly unknown[] = DefaultRevivables
> = {
  [K in keyof TModules]: TModules[K] extends { readonly type: TType, is: (v: unknown) => v is infer S }
    ? S
    : never
}[number]

/**
 * Given a type string and modules array, find the matching Boxed type.
 */
export type RevivableTypeToBoxed<
  TType extends string,
  TModules extends readonly unknown[] = DefaultRevivables
> = {
  [K in keyof TModules]: TModules[K] extends { readonly type: TType, box: (...args: any[]) => infer B }
    ? B
    : never
}[number]

/**
 * Given a type string and modules array, find the matching Box type (with OSRA_BOX marker).
 */
export type RevivableTypeToBox<
  TType extends string,
  TModules extends readonly unknown[] = DefaultRevivables
> = {
  [K in keyof TModules]: TModules[K] extends { readonly type: TType, isBox: (v: unknown) => v is infer B }
    ? B
    : never
}[number]

// Backwards compatibility alias
export type RevivableVariantTypeToSource<T extends RevivableVariantType> = RevivableTypeToSource<T>

// ============================================================================
// Registry Types
// ============================================================================

export type RevivablesRegistry = readonly RevivableModuleRuntime[]

// ============================================================================
// Runtime Functions
// ============================================================================

/**
 * Check if a value is a revivable (can be handled by any module in the registry)
 */
export const isRevivable = (value: unknown, revivables: RevivablesRegistry = defaultRevivables): value is Revivable =>
  revivables.some(module => module.is(value))

/**
 * Check if a value is a revivable box
 */
export const isRevivableBox = (value: unknown): value is RevivableBox =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX_VALUE in value &&
  (value as Record<string, unknown>)[OSRA_BOX_VALUE] === 'revivable'

/**
 * Find the revivable module that can handle a given value
 */
export function findRevivableForValue(
  value: unknown,
  revivables: RevivablesRegistry
): RevivableModuleRuntime | undefined {
  return revivables.find(module => module.is(value))
}

/**
 * Find the revivable module by type name
 */
export function findRevivableByType(
  type: string,
  revivables: RevivablesRegistry
): RevivableModuleRuntime | undefined {
  return revivables.find(module => module.type === type)
}

/**
 * Determine if a value should be boxed based on its type and context
 */
export const shouldBox = (value: unknown, context: ConnectionRevivableContext): boolean => {
  const module = findRevivableForValue(value, context.revivables)
  if (!module) return false
  return module.shouldBox(value, context)
}

/**
 * Find the revivable module that supports passthrough for a given value
 */
export function findPassthroughModule(
  value: unknown,
  revivables: RevivablesRegistry
): RevivableModuleRuntime | undefined {
  return revivables.find(module => module.supportsPassthrough && module.is(value))
}

/**
 * Box a revivable value
 */
export const box = (value: Revivable, context: ConnectionRevivableContext): RevivableBox => {
  if (shouldBox(value, context)) {
    const module = findRevivableForValue(value, context.revivables)
    if (module) {
      return {
        [OSRA_BOX_VALUE]: 'revivable',
        ...module.box(value, context)
      } as unknown as RevivableBox
    }
  }

  // For capable transports (or unknown types on JSON transport), just mark the type but pass through the value
  // This creates a passthrough box where the value is included directly
  const passthroughModule = findPassthroughModule(value, context.revivables)
  const passthroughType = passthroughModule?.type ?? 'unknown'

  return {
    [OSRA_BOX_VALUE]: 'revivable',
    type: passthroughType,
    value
  } as unknown as RevivableBox
}

/**
 * Check if a boxed value is a passthrough (value transferred directly)
 */
const isPassthroughBox = (boxedValue: unknown, revivables: RevivablesRegistry): boolean => {
  if (!isRevivableBox(boxedValue) || !('value' in boxedValue)) return false
  const passthroughModule = findRevivableByType(boxedValue.type, revivables)
  return Boolean(passthroughModule?.supportsPassthrough && passthroughModule.is(boxedValue.value))
}

/**
 * Recursively box all revivable values in a structure
 */
export const recursiveBox = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, Revivable, RevivableBox> => {
  const boxedValue = isRevivable(value, context.revivables) ? box(value, context) : value
  return (
    Array.isArray(boxedValue) ? boxedValue.map(v => recursiveBox(v, context)) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue && typeof boxedValue === 'object' && Object.getPrototypeOf(boxedValue) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(boxedValue)
          .map(([key, v]: [string, Capable]) => {
            // Skip recursion for passthrough values (where the value is the actual transferable)
            if (isPassthroughBox(boxedValue, context.revivables)) {
              return [key, v]
            }
            return [key, recursiveBox(v, context)]
          })
      )
    ) as DeepReplace<T, Revivable, RevivableBox>
    : boxedValue as DeepReplace<T, Revivable, RevivableBox>
  )
}

/**
 * Revive a boxed value back to its original form
 */
export const revive = (boxedValue: RevivableBox, context: ConnectionRevivableContext): Revivable => {
  // If the value got properly sent through the protocol as is, we don't need to revive it
  // (passthrough case for capable transports)
  if ('value' in boxedValue && isRevivable(boxedValue.value, context.revivables)) {
    return boxedValue.value as Revivable
  }

  // Use dynamic lookup to find the appropriate reviver
  const module = findRevivableByType(boxedValue.type, context.revivables)
  if (module) {
    return module.revive(boxedValue, context) as Revivable
  }

  return boxedValue as unknown as Revivable
}

/**
 * Recursively revive all boxed values in a structure
 */
export const recursiveRevive = <T extends Capable>(value: T, context: ConnectionRevivableContext): DeepReplace<T, RevivableBox, Revivable> => {
  const recursedValue = (
    isTransferable(value) ? value
    : Array.isArray(value) ? value.map(v => recursiveRevive(v, context)) as DeepReplace<T, RevivableBox, Revivable>
    : value && typeof value === 'object' ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, v]: [string, Capable]) => [
            key,
            recursiveRevive(v, context)
          ])
      )
    ) as DeepReplace<T, RevivableBox, Revivable>
    : value as DeepReplace<T, RevivableBox, Revivable>
  )
  return (isRevivableBox(recursedValue) ? revive(recursedValue, context) : recursedValue) as DeepReplace<T, RevivableBox, Revivable>
}
