import type { BoxBase as BoxBaseType, RevivableContext } from './utils'

import { instanceOfAny } from '../utils/type-guards'

export const type = 'clonable' as const

export type BoxedClonable = BoxBaseType<typeof type>

/** Host objects covered by the HTML structured-clone algorithm but no
 *  other revivable module claims. Listing them here lets recursiveBox
 *  short-circuit `findBoxModule` and skip the `structuredClone` probe in
 *  `unclonable.ts` — for a 100 MB Blob, that's the difference between
 *  one virtual reference-bump and a full byte-for-byte copy used only as
 *  a clonability test.
 *
 *  Two-tier list:
 *  - `TYPED_CLONABLE_CTORS` — constructors lib.dom knows about. Their
 *    instance types are inferred into the `Clonable` union so user
 *    code can pass `Blob`, `RegExp`, etc. through `expose` with full
 *    type-safety.
 *  - `EXPERIMENTAL_CLONABLE_CTORS` — constructors that may not be in
 *    the loaded TypeScript lib (CropTarget, FencedFrameConfig, …).
 *    Runtime-detected only; they don't widen `Capable`. Users that
 *    want type-safe support for these can declare them globally.
 *
 *  Types already covered elsewhere (Date / Map / Set / Error / Headers /
 *  ArrayBuffer & TypedArrays / BigInt / Promise / Function / MessagePort /
 *  ReadableStream / Event / EventTarget) are deliberately not repeated —
 *  their modules sit earlier in `defaultRevivableModules` and match
 *  long before this one.
 *
 *  Overlap types (clonable AND transferable: ImageBitmap, AudioData,
 *  VideoFrame) live in `transferable.ts` instead so the wire-side
 *  walker has the option to move rather than copy them.
 *
 *  Source: HTML structured-clone algorithm + WebIDL serializable
 *  interfaces. */
const TYPED_CLONABLE_CTORS = [
  globalThis.Blob,
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

type AnyCtor = abstract new (...args: any[]) => unknown

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

/** Instance-type union of every typed clonable constructor — what
 *  consumers of this module see in `Capable` when the transport is in
 *  Capable mode. The `capableOnly: true` marker below tells
 *  `ExtractType` to elide this from the union when the transport is in
 *  JSON mode, so user code can't type a `Blob` it won't be able to
 *  reconstruct on the other side. */
export type Clonable = InstanceType<typeof TYPED_CLONABLE_CTORS[number]>

const isClonable = (value: unknown): value is Clonable =>
  instanceOfAny(value, TYPED_CLONABLE_CTORS)
  || instanceOfAny(value, EXPERIMENTAL_CLONABLE_CTORS)

/** Marker read by `ExtractType` (and via it `InferRevivables` /
 *  `Capable`): the types this module surfaces are only available when
 *  the transport is in Capable mode. JSON-mode transports get `never`
 *  for this module's contribution to the `Capable` union.
 *
 *  We'd love to express this as a generic `isType<Ctx>` whose `value
 *  is …` return varies on `Ctx`, but TS's `infer` over a generic
 *  function instantiates with the constraint (here `RevivableContext`),
 *  not with the caller's specific `Ctx` — so the narrowing never
 *  happens. The marker is the pragmatic alternative. */
export const capableOnly = true as const

export const isType = isClonable

// Pass-through: the wire's structured-clone (clone transport) handles
// these natively. JSON-only transports never reach here because the
// type system rejects clonables before `expose()`; if one slipped in
// dynamically, JSON.stringify would silently coerce to "{}" — the same
// fallback `unclonable` provides for unknown unclonable values.
export const box = (value: Clonable, _context: RevivableContext): Clonable => value

// Never reached: `box` returns the raw value, not a `BoxedClonable`,
// so `isRevivableBox` is false on the receive side and `recursiveRevive`
// never finds this module via `findReviveModule`. Stub kept for the
// `RevivableModule` shape.
export const revive = (value: BoxedClonable, _context: RevivableContext): Clonable => value as unknown as Clonable
