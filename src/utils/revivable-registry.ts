import type {
  Revivable,
  RevivableBox,
  RevivableVariant,
  RevivableVariantType
} from '../types'
import type { ConnectionRevivableContext } from './connection'
import type { TypedArray } from './type-guards'

import { OSRA_BOX } from '../types'

/**
 * Handler for a specific revivable type.
 * Each handler knows how to check, box, and revive its type.
 */
export interface RevivableHandler<
  TType extends RevivableVariantType = RevivableVariantType,
  TValue = unknown,
  TBoxed extends RevivableVariant & { type: TType } = RevivableVariant & { type: TType }
> {
  /** The type identifier for this handler */
  readonly type: TType

  /**
   * Check if a value is of this revivable type.
   * Used during boxing to determine which handler to use.
   */
  check: (value: unknown) => value is TValue

  /**
   * Check if a boxed value is of this type.
   * Used during reviving to determine which handler to use.
   */
  checkBox: (box: RevivableBox) => box is RevivableBox & { type: TType }

  /**
   * Convert a value to its boxed representation.
   * Called during serialization.
   */
  box: (value: TValue, context: ConnectionRevivableContext) => TBoxed

  /**
   * Convert a boxed value back to its original form.
   * Called during deserialization.
   */
  revive: (box: TBoxed, context: ConnectionRevivableContext) => TValue

  /**
   * Whether this type should always be boxed, regardless of transport capabilities.
   * Types like functions, promises, and dates must always be boxed.
   * @default false
   */
  alwaysBox?: boolean

  /**
   * Whether this type requires special handling in JSON-only mode.
   * If true, the box function will be called even for JSON transports.
   * @default false
   */
  requiresJsonBoxing?: boolean
}

/**
 * Registry of all revivable type handlers.
 * Provides a centralized way to manage type checking, boxing, and reviving.
 */
export class RevivableRegistry {
  private handlers: Map<RevivableVariantType, RevivableHandler> = new Map()
  private handlerList: RevivableHandler[] = []

  /**
   * Register a new handler for a revivable type.
   */
  register<TType extends RevivableVariantType>(handler: RevivableHandler<TType, any, any>): this {
    this.handlers.set(handler.type, handler as RevivableHandler)
    this.handlerList.push(handler as RevivableHandler)
    return this
  }

  /**
   * Get a handler by its type name.
   */
  getHandler(type: RevivableVariantType): RevivableHandler | undefined {
    return this.handlers.get(type)
  }

  /**
   * Get all registered handlers.
   */
  getAllHandlers(): readonly RevivableHandler[] {
    return this.handlerList
  }

  /**
   * Check if a value is any revivable type.
   */
  isRevivable(value: unknown): value is Revivable {
    return this.handlerList.some(handler => handler.check(value))
  }

  /**
   * Check if a value should always be boxed.
   */
  isAlwaysBox(value: unknown): boolean {
    return this.handlerList.some(handler => handler.alwaysBox && handler.check(value))
  }

  /**
   * Get the type name for a revivable value.
   */
  getType(value: Revivable): RevivableVariantType {
    for (const handler of this.handlerList) {
      if (handler.check(value)) {
        return handler.type
      }
    }
    throw new Error(
      `Unknown revivable type: ${(value as object)?.constructor?.name ?? typeof value}. ` +
      `Expected one of: ${this.handlerList.map(h => h.type).join(', ')}`
    )
  }

  /**
   * Check if a boxed value is a revivable box.
   */
  isRevivableBox(value: unknown): value is RevivableBox {
    return (
      value !== null &&
      typeof value === 'object' &&
      OSRA_BOX in value &&
      (value as RevivableBox)[OSRA_BOX] === 'revivable'
    )
  }

  /**
   * Find the handler for a given value.
   */
  findHandlerForValue(value: unknown): RevivableHandler | undefined {
    return this.handlerList.find(handler => handler.check(value))
  }

  /**
   * Find the handler for a given boxed value.
   */
  findHandlerForBox(box: RevivableBox): RevivableHandler | undefined {
    return this.handlerList.find(handler => handler.checkBox(box))
  }

  /**
   * Box a revivable value using the appropriate handler.
   */
  box(value: Revivable, context: ConnectionRevivableContext): RevivableBox {
    const handler = this.findHandlerForValue(value)
    if (!handler) {
      throw new Error(
        `No handler found for value: ${(value as object)?.constructor?.name ?? typeof value}`
      )
    }
    return {
      [OSRA_BOX]: 'revivable',
      ...handler.box(value, context)
    } as RevivableBox
  }

  /**
   * Revive a boxed value using the appropriate handler.
   */
  revive(box: RevivableBox, context: ConnectionRevivableContext): Revivable {
    // If the value got properly sent through the protocol as is, we don't need to revive it
    if (this.isRevivable(box.value)) {
      return box.value as Revivable
    }

    const handler = this.findHandlerForBox(box)
    if (!handler) {
      throw new Error(`No handler found for box type: ${box.type}`)
    }
    return handler.revive(box as any, context) as Revivable
  }
}

// ============ Type checking functions ============

// Float16Array is a recent addition (2024) and may not be available in all environments
const Float16ArrayConstructor = typeof Float16Array !== 'undefined' ? Float16Array : undefined

export const isMessagePort = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

export const isPromise = (value: unknown): value is Promise<unknown> =>
  value instanceof Promise

export const isFunction = (value: unknown): value is Function =>
  typeof value === 'function'

export const isTypedArray = (value: unknown): value is TypedArray => {
  return (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    (Float16ArrayConstructor !== undefined && value instanceof Float16ArrayConstructor) ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  )
}

export const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const isReadableStream = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const isDate = (value: unknown): value is Date =>
  value instanceof Date

export const isError = (value: unknown): value is Error =>
  value instanceof Error

// ============ Box checking functions ============

const createBoxChecker = <T extends RevivableVariantType>(type: T) =>
  (box: RevivableBox): box is RevivableBox & { type: T } =>
    box.type === type

export const isRevivableMessagePortBox = createBoxChecker('messagePort')
export const isRevivablePromiseBox = createBoxChecker('promise')
export const isRevivableFunctionBox = createBoxChecker('function')
export const isRevivableTypedArrayBox = createBoxChecker('typedArray')
export const isRevivableArrayBufferBox = createBoxChecker('arrayBuffer')
export const isRevivableReadableStreamBox = createBoxChecker('readableStream')
export const isRevivableDateBox = createBoxChecker('date')
export const isRevivableErrorBox = createBoxChecker('error')

// ============ Create and export the global registry ============

export const revivableRegistry = new RevivableRegistry()
