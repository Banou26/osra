import { OSRA_BOX } from '../types'
import { transfer } from '../revivables/transfer'
import { isClonable, isTransferable } from './type-guards'

export { transfer }

// "Must-transfer" types: structured clone cannot copy these, so any occurrence
// in the outgoing message has to go on the transfer list regardless of whether
// the user opted in with `transfer()`. MessagePort is the canonical case —
// cloning one would leave the remote side unable to respond.
const isMustTransfer = (value: unknown): value is Transferable =>
  Boolean(
       (typeof MessagePort !== 'undefined' && value instanceof MessagePort)
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
    || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
    || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
    || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas),
  )

// Structural check for a transfer revivable box: we deliberately don't import
// the transfer module's `type` constant here, it's a soft coupling via the
// string literal so this walker doesn't drag the whole revivables graph in.
// The `degraded` flag is set by transfer.box() when the platform can't
// actually transfer — a degraded box is a no-op for the walker.
const isTransferBox = (value: unknown): value is { inner: unknown, degraded: boolean } =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'
    && (value as Record<string, unknown>).type === 'transfer',
  )

/**
 * Walk a boxed message and collect the list of Transferable references that
 * should be moved (rather than cloned) when calling postMessage.
 *
 * The rules are:
 *   1. Must-transfer types (MessagePort, streams, OffscreenCanvas) are always
 *      included — structured clone cannot represent them.
 *   2. Clonable types (SharedArrayBuffer) are skipped entirely.
 *   3. Other Transferable types (ArrayBuffer, ImageBitmap) are included only
 *      when the walker is inside a non-degraded transfer box — i.e. when the
 *      user explicitly opted into move semantics at the send site via
 *      transfer() AND the platform supports transferring.
 *
 * The transfer intent is carried on the wire by the transfer revivable box;
 * recognising it structurally here (without importing the module) is all the
 * coupling this file needs.
 */
export const getTransferableObjects = (value: unknown): Transferable[] => {
  const transferables: Transferable[] = []
  const seen = new WeakSet<object>()

  const recurse = (value: unknown, inTransferBox: boolean): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (isClonable(value)) return

    if (isTransferBox(value)) {
      // Non-degraded box: flip into transfer mode — every Transferable found
      // below this point on this branch of the walk gets added to the
      // transfer list. Degraded box (platform can't transfer): keep whatever
      // mode we were in, so the wrapper becomes a no-op and the inner gets
      // walked as a normal copy payload.
      recurse(value.inner, inTransferBox || !value.degraded)
      return
    }

    if (isMustTransfer(value)) {
      transferables.push(value)
      return
    }

    if (isTransferable(value)) {
      if (inTransferBox) {
        transferables.push(value)
      }
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) recurse(item, inTransferBox)
      return
    }

    for (const key of Object.keys(value as Record<string, unknown>)) {
      recurse((value as Record<string, unknown>)[key], inTransferBox)
    }
  }

  recurse(value, false)
  return transferables
}
