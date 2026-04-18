import type { Capable } from '../types'
import type { BoxBase as BoxBaseType, RevivableContext, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { instanceOfAny, isJsonOnlyTransport } from '../utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'transfer' as const

const TRANSFER_MARKER: unique symbol = Symbol.for('osra.transfer')

type TransferWrapper<T = unknown> = {
  readonly [TRANSFER_MARKER]: true
  readonly value: T
}

export type BoxedTransfer<T extends Capable = Capable> = BoxBaseType<typeof type> & {
  inner: Capable
  degraded: boolean
  [UnderlyingType]: T
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
  return instanceOfAny(value, [
    globalThis.ArrayBuffer,
    globalThis.MessagePort,
    globalThis.ReadableStream,
    globalThis.WritableStream,
    globalThis.TransformStream,
    globalThis.ImageBitmap,
    globalThis.OffscreenCanvas,
  ])
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

export const box = <T extends Capable, TContext extends RevivableContext>(
  wrapper: TransferWrapper<T>,
  context: TContext,
): BoxedTransfer<T> => {
  const inner = wrapper.value
  const innerBoxed = recursiveBox(inner, context)
  // The `degraded` flag carries the transport mode to the send-time walker
  // in getTransferableObjects. When true, the walker treats this box as if
  // it weren't a transfer box at all — no mode flip, no transferables on
  // the transfer list — and the wrapper silently degrades to a copy. JSON
  // transports can't move ownership over the wire, so transfer semantics
  // don't apply and we degrade.
  return {
    ...BoxBase,
    type,
    inner: innerBoxed,
    degraded: isJsonOnlyTransport(context.transport),
  } as unknown as BoxedTransfer<T>
}

export const revive = <T extends BoxedTransfer, TContext extends RevivableContext>(
  value: T,
  context: TContext,
): T[UnderlyingType] =>
  recursiveRevive(value.inner, context) as T[UnderlyingType]

const typeCheck = () => {
  const ab = new ArrayBuffer(10)
  const wrapper = { [TRANSFER_MARKER]: true, value: ab } as TransferWrapper<ArrayBuffer>
  const boxed = box(wrapper, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  // Revive recovers the original ArrayBuffer type via the UnderlyingType phantom.
  const expected: ArrayBuffer = revived
  // @ts-expect-error - revived is ArrayBuffer, not string
  const notExpected: string = revived
  // @ts-expect-error - cannot box a non-Capable wrapper (Symbol not assignable)
  box({ [TRANSFER_MARKER]: true, value: Symbol() } as TransferWrapper<symbol>, {} as RevivableContext)
}
