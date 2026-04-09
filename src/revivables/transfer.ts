import type { Capable } from '../types'
import type { BoxBase as BoxBaseType, RevivableContext } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'transfer' as const

const TRANSFER_MARKER: unique symbol = Symbol.for('osra.transfer')

type TransferWrapper<T = unknown> = {
  readonly [TRANSFER_MARKER]: true
  readonly value: T
}

export type BoxedTransfer = BoxBaseType<typeof type> & {
  inner: Capable
}

const isObject = (value: unknown): value is object =>
  value !== null && typeof value === 'object'

const isTransferWrapper = (value: unknown): value is TransferWrapper =>
  isObject(value) && (value as Record<PropertyKey, unknown>)[TRANSFER_MARKER] === true

// The set of types `transfer()` accepts. Anything else — primitives, nullish,
// plain objects, Dates, Errors, Promises, etc. — is returned unchanged so
// normal payloads don't blow up if someone wraps the wrong thing.
const isWrappableTransferable = (value: unknown): boolean => {
  if (!isObject(value)) return false
  if (ArrayBuffer.isView(value)) return true
  return (
    (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
    || (typeof MessagePort !== 'undefined' && value instanceof MessagePort)
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
    || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
    || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
    || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)
    || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  )
}

/**
 * Opt into transfer semantics for a transferable value. Without this wrapper
 * osra sends transferables as structured clones (copies) — the sender-side
 * reference stays usable after the RPC. Wrapping hands the underlying storage
 * off to the receiver and neuters the sender-side reference, matching what
 * you'd get by listing it in the transfer list of `postMessage(msg, [buf])`.
 *
 * - Primitives, null, undefined, plain objects, Promises, Dates, etc. are
 *   returned unchanged.
 * - Typed array views (`Uint8Array`, `DataView`, …) are accepted as a
 *   convenience — their underlying `.buffer` is what actually gets moved.
 * - `transfer(transfer(x))` returns the same wrapper as `transfer(x)`.
 * - If the current platform cannot transfer the given type, the wrapper
 *   silently degrades to a copy — nothing throws.
 */
export const transfer = <T>(value: T): T => {
  if (!isWrappableTransferable(value)) return value
  return { [TRANSFER_MARKER]: true, value } as unknown as T
}

// -------------------------------------------------------------------------
// Revivable module interface
// -------------------------------------------------------------------------

export const isType = (value: unknown): value is TransferWrapper =>
  isTransferWrapper(value)

export const box = <T extends TransferWrapper, TContext extends RevivableContext>(
  wrapper: T,
  context: TContext,
): Capable => {
  const inner = wrapper.value
  const innerBoxed = recursiveBox(inner as Capable, context)
  // Degrade to copy on platforms that can't transfer anything: just return
  // the boxed inner directly, skipping the transfer wrapper. The walker in
  // getTransferableObjects will never flip into transfer mode for this send.
  if (!context.platformCapabilities.transferable) {
    return innerBoxed as Capable
  }
  return {
    ...BoxBase,
    type,
    inner: innerBoxed as Capable,
  }
}

export const revive = <T extends BoxedTransfer, TContext extends RevivableContext>(
  value: T,
  context: TContext,
): unknown =>
  recursiveRevive(value.inner, context)
