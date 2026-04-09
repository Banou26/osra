import type { Capable } from '../types'
import type { PlatformCapabilities } from '../utils/capabilities'
import type { RevivableContext } from './utils'

import { recursiveBox } from '.'

export const type = 'transfer' as const

const TRANSFER_MARKER: unique symbol = Symbol.for('osra.transfer')

type TransferWrapper<T = unknown> = {
  readonly [TRANSFER_MARKER]: true
  readonly value: T
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
 * - If the current platform cannot transfer the given type, marking silently
 *   no-ops and the wrapper degrades to a copy — nothing throws.
 */
export const transfer = <T>(value: T): T => {
  if (!isWrappableTransferable(value)) return value
  if (isTransferWrapper(value)) return value
  return { [TRANSFER_MARKER]: true, value } as unknown as T
}

// -------------------------------------------------------------------------
// Send-side marker set
// -------------------------------------------------------------------------
// Raw Transferables (ArrayBuffer, MessagePort, stream, …) that osra has been
// asked to *move* rather than clone. Entries are written during boxing and
// consumed (removed) during the very next `getTransferableObjects` walk, so
// they never leak into an unrelated later send. JS is single-threaded and
// boxing + sending is synchronous and back-to-back, so the module-level set
// is safe without any per-connection plumbing.
const transferMarked: WeakSet<object> = new WeakSet()

export const isMarkedForTransfer = (value: object): boolean =>
  transferMarked.has(value)

export const consumeTransferMark = (value: object): boolean =>
  transferMarked.delete(value)

// Gate marking by platform capability so wrapping something the runtime
// can't actually transfer silently degrades to copy instead of throwing
// later inside postMessage.
const canTransferTypeOnPlatform = (value: object, capabilities: PlatformCapabilities): boolean => {
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return capabilities.transferable
  if (
    (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
    || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
    || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
  ) return capabilities.transferableStream
  if (typeof MessagePort !== 'undefined' && value instanceof MessagePort) return capabilities.messagePort
  // ImageBitmap / OffscreenCanvas: if the constructor exists on this
  // platform, transferring the instance works. We don't probe these
  // specifically today.
  return true
}

const isRawTransferable = (value: unknown): value is Transferable =>
  isObject(value) && (
    (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
    || (typeof MessagePort !== 'undefined' && value instanceof MessagePort)
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
    || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
    || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
    || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)
    || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  )

// Walk the boxed payload we just produced and mark every raw Transferable
// for transfer. This is why `transfer(new Uint8Array(buf))` works: the box
// step unwraps the view into `{ type: 'typedArray', arrayBuffer: buf }`
// and this walker picks up `buf` regardless of how it was reached.
const markRawTransferablesDeep = (
  value: unknown,
  capabilities: PlatformCapabilities,
  seen: WeakSet<object>,
): void => {
  if (!isObject(value)) return
  if (seen.has(value)) return
  seen.add(value)

  if (isRawTransferable(value)) {
    if (canTransferTypeOnPlatform(value, capabilities)) {
      transferMarked.add(value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) markRawTransferablesDeep(item, capabilities, seen)
    return
  }

  // Boxed payloads are plain objects like { __OSRA_BOX__, type, arrayBuffer }.
  // Walking their own enumerable keys is enough to reach the embedded raw
  // Transferable references.
  for (const key of Object.keys(value as Record<string, unknown>)) {
    markRawTransferablesDeep((value as Record<string, unknown>)[key], capabilities, seen)
  }
}

// -------------------------------------------------------------------------
// Revivable module interface
// -------------------------------------------------------------------------

export const isType = (value: unknown): value is TransferWrapper =>
  isTransferWrapper(value)

export const box = <T extends TransferWrapper, TContext extends RevivableContext>(
  wrapper: T,
  context: TContext,
): unknown => {
  const inner = wrapper.value
  const boxed = recursiveBox(inner as Capable, context)
  markRawTransferablesDeep(boxed, context.platformCapabilities, new WeakSet())
  return boxed
}

// The wrapper is unwrapped at box() time — it never crosses the wire, so
// the module's type field never appears in an inbound message and this
// revive is never legitimately invoked.
export const revive = (_value: unknown): never => {
  throw new Error(
    'osra transfer: revive was invoked, but the transfer wrapper should never cross the wire',
  )
}
