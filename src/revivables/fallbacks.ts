import type { BoxBase as BoxBaseType, RevivableContext } from './utils'

import { BoxBase } from './utils'
import { instanceOfAny } from '../utils/type-guards'

type AnyCtor = abstract new (...args: any[]) => unknown

// -------------------------------------------------------------------------
// clonable — pass-through fast path for HTML structured-clone types not
// owned by another revivable. Short-circuits findBoxModule so unclonable's
// structuredClone probe never fires on a known-safe value.
// -------------------------------------------------------------------------

const TYPED_CLONABLE_CTORS = [
  globalThis.File,
  globalThis.FileList,
  globalThis.RegExp,
  globalThis.DataView,
  globalThis.ImageData,
  globalThis.FormData,
  globalThis.DOMException,
  globalThis.DOMMatrix,
  globalThis.DOMMatrixReadOnly,
  globalThis.DOMPoint,
  globalThis.DOMPointReadOnly,
  globalThis.DOMQuad,
  globalThis.DOMRect,
  globalThis.DOMRectReadOnly,
  globalThis.CryptoKey,
  globalThis.FileSystemHandle,
  globalThis.FileSystemFileHandle,
  globalThis.FileSystemDirectoryHandle,
  globalThis.RTCCertificate,
] as const

const EXPERIMENTAL_CLONABLE_CTORS = [
  (globalThis as { CropTarget?: AnyCtor }).CropTarget,
  (globalThis as { EncodedAudioChunk?: AnyCtor }).EncodedAudioChunk,
  (globalThis as { EncodedVideoChunk?: AnyCtor }).EncodedVideoChunk,
  (globalThis as { FencedFrameConfig?: AnyCtor }).FencedFrameConfig,
  (globalThis as { GPUCompilationInfo?: AnyCtor }).GPUCompilationInfo,
  (globalThis as { GPUCompilationMessage?: AnyCtor }).GPUCompilationMessage,
  (globalThis as { GPUPipelineError?: AnyCtor }).GPUPipelineError,
  (globalThis as { RTCEncodedAudioFrame?: AnyCtor }).RTCEncodedAudioFrame,
  (globalThis as { RTCEncodedVideoFrame?: AnyCtor }).RTCEncodedVideoFrame,
  (globalThis as { WebTransportError?: AnyCtor }).WebTransportError,
] as const

export type Clonable = InstanceType<typeof TYPED_CLONABLE_CTORS[number]>
export type BoxedClonable = BoxBaseType<'clonable'>

// `capableOnly: true` tells ExtractType to elide this module from the
// Capable union on JSON transports — TS can't narrow `isType<Ctx>` via
// generic inference, so we use a marker flag.
const isClonable = (value: unknown): value is Clonable =>
  instanceOfAny(value, TYPED_CLONABLE_CTORS) || instanceOfAny(value, EXPERIMENTAL_CLONABLE_CTORS)

export const clonable = {
  type: 'clonable',
  capableOnly: true,
  isType: isClonable,
  // Pass-through; structured-clone handles these on the wire. `revive` is
  // never reached — `box` returns the raw value so isRevivableBox is false.
  box: (value: Clonable, _context: RevivableContext<any>): Clonable => value,
  revive: (value: BoxedClonable, _context: RevivableContext<any>): Clonable => value as unknown as Clonable,
} as const

// -------------------------------------------------------------------------
// transferable — pass-through fast path for transfer-only host objects.
// getTransferableObjects pulls them out of the envelope at send time.
// -------------------------------------------------------------------------

const TYPED_TRANSFERABLE_CTORS = [
  globalThis.ImageBitmap,
  globalThis.OffscreenCanvas,
  globalThis.WritableStream,
  globalThis.TransformStream,
  globalThis.MediaStreamTrack,
  globalThis.RTCDataChannel,
] as const

const EXPERIMENTAL_TRANSFERABLE_CTORS = [
  (globalThis as { AudioData?: AnyCtor }).AudioData,
  (globalThis as { VideoFrame?: AnyCtor }).VideoFrame,
  (globalThis as { MediaSourceHandle?: AnyCtor }).MediaSourceHandle,
  (globalThis as { MIDIAccess?: AnyCtor }).MIDIAccess,
  (globalThis as { WebTransportReceiveStream?: AnyCtor }).WebTransportReceiveStream,
  (globalThis as { WebTransportSendStream?: AnyCtor }).WebTransportSendStream,
] as const

export type Transferable = InstanceType<typeof TYPED_TRANSFERABLE_CTORS[number]>
export type BoxedTransferable = BoxBaseType<'transferable'>

const isTransferable = (value: unknown): value is Transferable =>
  instanceOfAny(value, TYPED_TRANSFERABLE_CTORS) || instanceOfAny(value, EXPERIMENTAL_TRANSFERABLE_CTORS)

export const transferable = {
  type: 'transferable',
  capableOnly: true,
  isType: isTransferable,
  box: (value: Transferable, _context: RevivableContext<any>): Transferable => value,
  revive: (value: BoxedTransferable, _context: RevivableContext<any>): Transferable => value as unknown as Transferable,
} as const

// -------------------------------------------------------------------------
// unclonable — catch-all that probes via structuredClone and coerces
// unclonables to `{}` so the wire never blows up on exotic host objects.
// -------------------------------------------------------------------------

const isPlainObject = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const isUnclonable = (value: unknown): boolean => {
  if (value === null) return false
  const t = typeof value
  if (t !== 'object') return false
  if (Array.isArray(value)) return false
  if (isPlainObject(value)) return false
  try {
    structuredClone(value)
    return false
  } catch {
    return true
  }
}

export type BoxedUnclonable = BoxBaseType<'unclonable'>

// Type-level lie: `value is never` so this module doesn't widen Capable.
// Coercion to `{}` is a runtime rescue for values we shouldn't see.
const isUnclonableTyped = isUnclonable as (value: unknown) => value is never

export const unclonable = {
  type: 'unclonable',
  isType: isUnclonableTyped,
  box: (_value: never, _context: RevivableContext<any>): BoxedUnclonable => ({ ...BoxBase, type: 'unclonable' }),
  revive: (_value: BoxedUnclonable, _context: RevivableContext<any>): Record<string, never> => ({}),
} as const
