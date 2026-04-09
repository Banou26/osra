import { consumeTransferMark, isMarkedForTransfer, transfer } from '../revivables/transfer'
import { isClonable, isTransferable } from './type-guards'

export { transfer }

// "Must-transfer" types: structured clone cannot copy these, so any occurrence
// in the outgoing message has to go on the transfer list regardless of whether
// the user opted in with `transfer()`. MessagePort is the original must-
// transfer case — cloning one would leave the remote side unable to respond.
const isMustTransfer = (value: unknown): value is Transferable =>
  Boolean(
       (typeof MessagePort !== 'undefined' && value instanceof MessagePort)
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
    || (typeof WritableStream !== 'undefined' && value instanceof WritableStream)
    || (typeof TransformStream !== 'undefined' && value instanceof TransformStream)
    || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas),
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
 *      when the user opted in with `transfer()`, as tracked by the send-side
 *      marker set populated in the transfer revivable module's box step.
 *      Marks are consumed on visit so they cannot leak into unrelated future
 *      sends.
 */
export const getTransferableObjects = (value: unknown): Transferable[] => {
  const transferables: Transferable[] = []
  const seen = new WeakSet<object>()
  const recurse = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (isClonable(value)) return

    if (isMustTransfer(value)) {
      transferables.push(value)
      return
    }

    if (isTransferable(value)) {
      if (isMarkedForTransfer(value)) {
        transferables.push(value)
        consumeTransferMark(value)
      }
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) recurse(item)
      return
    }

    for (const key of Object.keys(value as Record<string, unknown>)) {
      recurse((value as Record<string, unknown>)[key])
    }
  }

  recurse(value)
  return transferables
}
