import { transfer } from '../revivables/transfer'
import { isRevivableBox } from '../revivables/utils'
import { instanceOfAny, isClonable, isTransferable } from './type-guards'

export { transfer }

// Must-transfer types: structured clone can't copy these, so any occurrence
// in the outgoing message must go on the transfer list — opt-in or not.
// (MessagePort is the canonical case: cloning would leave the peer mute.)
const isMustTransfer = (value: unknown): value is Transferable =>
  instanceOfAny(value, [
    globalThis.MessagePort,
    globalThis.ReadableStream,
    globalThis.WritableStream,
    globalThis.TransformStream,
    globalThis.OffscreenCanvas,
    (globalThis as { MediaSourceHandle?: abstract new (...args: any[]) => unknown }).MediaSourceHandle,
    (globalThis as { MediaStreamTrack?: abstract new (...args: any[]) => unknown }).MediaStreamTrack,
    (globalThis as { MIDIAccess?: abstract new (...args: any[]) => unknown }).MIDIAccess,
    (globalThis as { RTCDataChannel?: abstract new (...args: any[]) => unknown }).RTCDataChannel,
    (globalThis as { WebTransportReceiveStream?: abstract new (...args: any[]) => unknown }).WebTransportReceiveStream,
    (globalThis as { WebTransportSendStream?: abstract new (...args: any[]) => unknown }).WebTransportSendStream,
  ])

// Structural check — keeps the walker decoupled from the module graph.
// `degraded` (set by transfer.box) means the wrapper is a no-op here.
const isTransferBox = (value: unknown): value is { inner: unknown, degraded: boolean } =>
  isRevivableBox(value) && value.type === 'transfer'

/** Walk a boxed message and collect Transferables to move (rather than copy)
 *  on postMessage:
 *    1. Must-transfer types are always included.
 *    2. Clonable types (SharedArrayBuffer) are skipped.
 *    3. Other Transferables are included only inside a non-degraded transfer
 *       box (user opted in AND the platform supports transferring). */
export const getTransferableObjects = (value: unknown): Transferable[] => {
  const transferables: Transferable[] = []
  const seen = new WeakSet<object>()

  const recurse = (value: unknown, inTransferBox: boolean): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (isClonable(value)) return

    if (isTransferBox(value)) {
      // Non-degraded box flips into transfer mode for everything below.
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

    // TypedArray / DataView expose every numeric index — iterating a 100 KB
    // buffer would walk 100 K entries for nothing. The underlying buffer is
    // the only candidate; the typed-array revivable handles that path.
    if (ArrayBuffer.isView(value)) return

    if (Array.isArray(value)) {
      for (const item of value) recurse(item, inTransferBox)
      return
    }

    for (const item of Object.values(value)) recurse(item, inTransferBox)
  }

  recurse(value, false)
  return transferables
}
