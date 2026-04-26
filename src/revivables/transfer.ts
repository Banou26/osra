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
  isObject(value) && TRANSFER_MARKER in value && value[TRANSFER_MARKER] === true

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

/** Opt into transfer (move) semantics for a transferable value. Idempotent;
 *  non-transferable inputs pass through unchanged. Silently degrades to a
 *  copy when the platform/transport can't transfer the given type. Lies at
 *  the type level — runtime value is a TransferWrapper<T> typed as T. */
export const transfer = <T>(value: T): T =>
  (isWrappableTransferable(value)
    ? { [TRANSFER_MARKER]: true, value }
    : value
  ) as T

export const isType = (value: unknown): value is TransferWrapper =>
  isTransferWrapper(value)

export const box = <T extends Capable, TContext extends RevivableContext>(
  wrapper: TransferWrapper<T>,
  context: TContext,
): BoxedTransfer<T> =>
  // `degraded` tells the send-time walker in getTransferableObjects to treat
  // this box as a regular value (no transfer-list entry). JSON transports
  // can't move ownership, so transfer semantics don't apply.
  ({
    ...BoxBase,
    type,
    inner: recursiveBox(wrapper.value, context),
    degraded: isJsonOnlyTransport(context.transport),
  }) as unknown as BoxedTransfer<T>

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
  const expected: ArrayBuffer = revived
  // @ts-expect-error - revived is ArrayBuffer, not string
  const notExpected: string = revived
  // @ts-expect-error - cannot box a non-Capable wrapper (WeakMap not assignable)
  box({ [TRANSFER_MARKER]: true, value: new WeakMap() } as TransferWrapper<WeakMap<object, string>>, {} as RevivableContext)
}
