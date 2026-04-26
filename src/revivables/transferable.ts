import type { BoxBase as BoxBaseType, RevivableContext } from './utils'

import { instanceOfAny } from '../utils/type-guards'

export const type = 'transferable' as const

export type BoxedTransferable = BoxBaseType<typeof type>

/** Host objects that cross the wire by *transfer* (move semantics) when
 *  named in postMessage's transfer list, but no other revivable module
 *  claims. The wire-level `getTransferableObjects` walker pulls them
 *  out of the envelope at send time — we just need to short-circuit
 *  `findBoxModule` here so they don't reach the `unclonable.ts`
 *  probe, which would (incorrectly) `structuredClone`-test them, fail
 *  for the transfer-only ones, and coerce them to `{}`.
 *
 *  Two-tier list, same idea as `clonable.ts`:
 *  - `TYPED_TRANSFERABLE_CTORS` — constructors lib.dom knows about.
 *    Their instance types are inferred into the `Transferable` union
 *    so user code can pass `OffscreenCanvas`, `MediaStreamTrack`, etc.
 *    through `expose` with full type-safety.
 *  - `EXPERIMENTAL_TRANSFERABLE_CTORS` — constructors potentially
 *    absent from the loaded TypeScript lib (MediaSourceHandle, …).
 *    Runtime-detected only.
 *
 *  Types already covered elsewhere (ArrayBuffer / MessagePort /
 *  ReadableStream) are deliberately not repeated — their modules sit
 *  earlier in `defaultRevivableModules`.
 *
 *  Overlap types (transferable AND clonable: ImageBitmap, AudioData,
 *  VideoFrame) live here so the wire-side walker has the option to
 *  move rather than copy them.
 *
 *  Source: HTML transferable-objects list. */
const TYPED_TRANSFERABLE_CTORS = [
  globalThis.ImageBitmap,
  globalThis.OffscreenCanvas,
  globalThis.WritableStream,
  globalThis.TransformStream,
  globalThis.MediaStreamTrack,
  globalThis.RTCDataChannel,
] as const

type AnyCtor = abstract new (...args: any[]) => unknown

const EXPERIMENTAL_TRANSFERABLE_CTORS = [
  (globalThis as { AudioData?: AnyCtor }).AudioData,
  (globalThis as { VideoFrame?: AnyCtor }).VideoFrame,
  (globalThis as { MediaSourceHandle?: AnyCtor }).MediaSourceHandle,
  (globalThis as { MIDIAccess?: AnyCtor }).MIDIAccess,
  (globalThis as { WebTransportReceiveStream?: AnyCtor }).WebTransportReceiveStream,
  (globalThis as { WebTransportSendStream?: AnyCtor }).WebTransportSendStream,
] as const

/** Instance-type union of every typed transferable constructor — what
 *  consumers of this module see in `Capable` when the transport is in
 *  Capable mode. The `capableOnly: true` marker below tells
 *  `ExtractType` to elide this on JSON-mode transports. */
export type Transferable = InstanceType<typeof TYPED_TRANSFERABLE_CTORS[number]>

const isTransferable = (value: unknown): value is Transferable =>
  instanceOfAny(value, TYPED_TRANSFERABLE_CTORS)
  || instanceOfAny(value, EXPERIMENTAL_TRANSFERABLE_CTORS)

/** See `clonable.ts`'s `capableOnly` for the rationale. */
export const capableOnly = true as const

export const isType = isTransferable

// Pass-through: `getTransferableObjects` extracts these from the wire
// envelope at send time and the platform moves them via the transfer
// list. JSON-only transports never reach here because the type system
// rejects transferables before `expose()`.
export const box = (value: Transferable, _context: RevivableContext): Transferable => value

// Never reached — same reason as `clonable.ts`'s `revive`. Stub kept
// for the `RevivableModule` shape.
export const revive = (value: BoxedTransferable, _context: RevivableContext): Transferable => value as unknown as Transferable
