# HTMLVideoElement Revivable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in osra `RevivableModule` that lets `HTMLVideoElement` cross an osra context boundary as an interface-level proxy — the revived value passes `instanceof HTMLVideoElement`, mirrors state synchronously, proxies method calls and writes to the remote element, and dispatches remote media events on local `addEventListener`/`on<event>` handlers.

**Architecture:** Thin adapter over the existing `function` revivable. `box()` snapshots the real element's state, builds a plain `controller` object with `call`/`set`/`subscribe` functions, and lets `recursiveBox` box each function via `function.ts`. `revive()` creates a proxy whose target is `Object.create(HTMLVideoElement.prototype)` (for `instanceof`), holds a shadow `state` object seeded from the snapshot, manages its own `addEventListener`/`on<event>` dispatch via plain `Map`s, and calls `subscribe(onDelta)` once at revive time so the remote starts pushing per-event deltas. No new wire protocol; no direct `MessageChannel` use; no real DOM node allocated.

**Tech Stack:** TypeScript (strict, `esnext`), Vite, Playwright + Chai for browser tests, composes on `src/revivables/function.ts` (itself composed on `src/revivables/message-port.ts`).

**Spec:** `docs/superpowers/specs/2026-04-08-html-video-element-revivable-design.md` — the single source of truth for field lists, event→delta mappings, and proxy semantics. Consult it whenever a table entry or trap rule is ambiguous in a task.

---

## File Structure

Files created or modified by this plan:

**Created:**
- `src/revivables/html-video-element.ts` — the revivable module itself. Contains `type`, `isType`, `box`, `revive`, the `VideoState`/`BoxedHTMLVideoElement` types, the static tables (`WRITABLE_PROPS`/`READONLY_PROPS`/`METHOD_NAMES`/`EVENT_DELTAS`/`ON_HANDLER_NAMES`), and the helper serializers. Single file — all responsibilities live together because they change together.
- `tests/browser/html-video-element.ts` — test functions, one exported `async` function per scenario, taking a `Transport` arg and asserting on a revived proxy. Mirrors the shape of `tests/browser/custom-revivables.ts`.

**Modified:**
- `src/revivables/index.ts` — export the new module namespace (`export * as htmlVideoElement from './html-video-element'`) so consumers can write `import { htmlVideoElement } from 'osra'` and pass it via `revivableModules`. The module is **not** added to `defaultRevivableModules`.
- `tests/browser/web-context-transport.ts` — wire each test export to `window` transport.
- `tests/browser/json-transport.ts` — wire each test export to `jsonTransport()`.

**NOT modified:**
- `src/index.ts` — the re-export `export * from './revivables'` already forwards anything added to `src/revivables/index.ts`.
- `defaultRevivableModules` — the module is opt-in per the spec.

---

## Task 1: Scaffold the module file with empty exports and static tables

**Files:**
- Create: `src/revivables/html-video-element.ts`

This task gets the file on disk with the static tables, helper serializers, and type declarations, but `box`/`revive` throw `not implemented`. Follow-on tasks flesh them out. Doing it in one bite keeps subsequent tasks focused on behavior, not boilerplate.

- [ ] **Step 1: Create the file with types, tables, helpers, and stub box/revive**

```ts
// src/revivables/html-video-element.ts
import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'htmlVideoElement' as const

// ---- Static tables ----

const WRITABLE_PROPS = [
  'src', 'currentTime', 'volume', 'muted', 'playbackRate', 'autoplay',
  'loop', 'controls', 'preload', 'crossOrigin', 'playsInline',
  'defaultPlaybackRate', 'defaultMuted', 'poster',
] as const
export type WritableProp = typeof WRITABLE_PROPS[number]
const WRITABLE_PROPS_SET: ReadonlySet<string> = new Set(WRITABLE_PROPS)

const READONLY_PROPS = [
  'paused', 'ended', 'duration', 'readyState', 'networkState',
  'seeking', 'videoWidth', 'videoHeight', 'error', 'currentSrc',
  'buffered', 'played', 'seekable',
] as const
export type ReadonlyProp = typeof READONLY_PROPS[number]
const READONLY_PROPS_SET: ReadonlySet<string> = new Set(READONLY_PROPS)

const METHOD_NAMES = ['play', 'pause', 'load', 'canPlayType'] as const
export type MethodName = typeof METHOD_NAMES[number]
const METHOD_NAMES_SET: ReadonlySet<string> = new Set(METHOD_NAMES)

// ---- Serialized state shape ----

export type SerializedTimeRanges = Array<[number, number]>
export type SerializedMediaError = { code: number, message: string } | null

export type VideoState = {
  // writable
  src: string
  currentTime: number
  volume: number
  muted: boolean
  playbackRate: number
  autoplay: boolean
  loop: boolean
  controls: boolean
  preload: string
  crossOrigin: string | null
  playsInline: boolean
  defaultPlaybackRate: number
  defaultMuted: boolean
  poster: string
  // read-only
  paused: boolean
  ended: boolean
  duration: number
  readyState: number
  networkState: number
  seeking: boolean
  videoWidth: number
  videoHeight: number
  currentSrc: string
  error: SerializedMediaError
  buffered: SerializedTimeRanges
  played: SerializedTimeRanges
  seekable: SerializedTimeRanges
}

// ---- Per-event deltas (remote → local) ----

type EventName =
  | 'timeupdate' | 'durationchange' | 'volumechange' | 'ratechange'
  | 'play' | 'pause' | 'playing' | 'ended'
  | 'seeking' | 'seeked'
  | 'loadstart' | 'loadedmetadata' | 'loadeddata'
  | 'canplay' | 'canplaythrough' | 'progress'
  | 'stalled' | 'suspend' | 'waiting' | 'emptied'
  | 'abort' | 'error'

const EVENT_DELTAS: Record<EventName, (v: HTMLVideoElement) => Partial<VideoState>> = {
  timeupdate:     v => ({ currentTime: v.currentTime }),
  durationchange: v => ({ duration: v.duration }),
  volumechange:   v => ({ volume: v.volume, muted: v.muted }),
  ratechange:     v => ({ playbackRate: v.playbackRate, defaultPlaybackRate: v.defaultPlaybackRate }),
  play:           _ => ({ paused: false, ended: false }),
  pause:          _ => ({ paused: true }),
  playing:        _ => ({ paused: false }),
  ended:          _ => ({ ended: true, paused: true }),
  seeking:        _ => ({ seeking: true }),
  seeked:         v => ({ seeking: false, currentTime: v.currentTime }),
  loadstart:      v => ({ networkState: v.networkState }),
  loadedmetadata: v => ({ duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight, readyState: v.readyState }),
  loadeddata:     v => ({ readyState: v.readyState }),
  canplay:        v => ({ readyState: v.readyState }),
  canplaythrough: v => ({ readyState: v.readyState }),
  progress:       v => ({ buffered: serializeRanges(v.buffered), networkState: v.networkState }),
  stalled:        v => ({ networkState: v.networkState }),
  suspend:        v => ({ networkState: v.networkState }),
  waiting:        v => ({ readyState: v.readyState }),
  emptied:        v => ({ readyState: v.readyState, networkState: v.networkState, paused: true, ended: false, error: null }),
  abort:          v => ({ networkState: v.networkState }),
  error:          v => ({ error: serializeMediaError(v.error), networkState: v.networkState }),
}

const EVENT_NAMES = Object.keys(EVENT_DELTAS) as EventName[]

const ON_HANDLER_NAMES: ReadonlySet<string> = new Set(
  EVENT_NAMES.map(type => `on${type}`)
)

// ---- Helper serializers ----

const serializeRanges = (ranges: TimeRanges): SerializedTimeRanges => {
  const out: SerializedTimeRanges = []
  for (let i = 0; i < ranges.length; i++) out.push([ranges.start(i), ranges.end(i)])
  return out
}

const reviveRanges = (ranges: SerializedTimeRanges): TimeRanges => ({
  length: ranges.length,
  start: (i: number) => {
    const r = ranges[i]
    if (!r) throw new RangeError(`TimeRanges: index ${i} out of range`)
    return r[0]
  },
  end: (i: number) => {
    const r = ranges[i]
    if (!r) throw new RangeError(`TimeRanges: index ${i} out of range`)
    return r[1]
  },
}) as unknown as TimeRanges

const serializeMediaError = (error: MediaError | null): SerializedMediaError =>
  error ? { code: error.code, message: error.message } : null

const reviveMediaError = (data: SerializedMediaError): MediaError | null =>
  data ? ({ code: data.code, message: data.message }) as unknown as MediaError : null

// ---- Revivable controller contract ----

type Controller = {
  call: (method: MethodName, args: unknown[]) => Promise<unknown>
  set: (prop: WritableProp, value: unknown) => Promise<void>
  subscribe: (
    onDelta: (type: EventName, delta: Partial<VideoState>) => void
  ) => Promise<() => void>
}

export type BoxedHTMLVideoElement =
  & BoxBaseType<typeof type>
  & {
      initialState: VideoState
      controller: unknown // actual shape is recursiveBox(Controller); opaque at the type layer
      [UnderlyingType]: HTMLVideoElement
    }

// ---- Module API (stubbed) ----

export const isType = (value: unknown): value is HTMLVideoElement =>
  typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement

export const box = <T extends HTMLVideoElement, T2 extends RevivableContext>(
  _value: T,
  _context: T2,
): BoxedHTMLVideoElement => {
  throw new Error('html-video-element box: not implemented')
}

export const revive = <T extends BoxedHTMLVideoElement, T2 extends RevivableContext>(
  _value: T,
  _context: T2,
): HTMLVideoElement => {
  throw new Error('html-video-element revive: not implemented')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsgo --noEmit`
Expected: no errors. If tsgo complains about `HTMLVideoElement`/`TimeRanges`/`MediaError` not being defined, the DOM lib is already in `tsconfig.json` — re-read the tsconfig and confirm `"lib": [..., "DOM"]` is present; do **not** add a lib reference inline in the file.

- [ ] **Step 3: Commit**

```bash
git add src/revivables/html-video-element.ts
git commit -m "feat: 🏗️scaffold htmlVideoElement revivable (types, tables, stub box/revive)"
```

---

## Task 2: Wire the new module into `src/revivables/index.ts` as an opt-in namespace export

**Files:**
- Modify: `src/revivables/index.ts`

The spec says the module is **not** added to `defaultRevivableModules`, but it must be exported so users can `import { htmlVideoElement } from 'osra'` and pass it via `revivableModules`. Osra's public surface forwards `src/revivables/*` via `export * from './revivables'` in `src/index.ts`, so a namespace export on `revivables/index.ts` is sufficient.

- [ ] **Step 1: Read the current `src/revivables/index.ts`**

Read the file. Find the block of `import * as foo from './foo'` statements and the `defaultRevivableModules` array.

- [ ] **Step 2: Add the namespace re-export at the bottom of the file (after `export * from './utils'`)**

```ts
// src/revivables/index.ts — near the bottom, AFTER `export * from './utils'`
export * as htmlVideoElement from './html-video-element'
```

Do **not** add `htmlVideoElement` to the `defaultRevivableModules` array.

- [ ] **Step 3: Type-check**

Run: `npx tsgo --noEmit`
Expected: no errors.

- [ ] **Step 4: Sanity check that the public import path works**

Add a temporary file `src/_import-check.ts` with:

```ts
import { htmlVideoElement } from './index'
const _check: typeof htmlVideoElement = htmlVideoElement
void _check
```

Run: `npx tsgo --noEmit`
Expected: no errors.

Then delete `src/_import-check.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/revivables/index.ts
git commit -m "feat: ➕export htmlVideoElement revivable as opt-in namespace"
```

---

## Task 3: Implement the remote side (`box`)

**Files:**
- Modify: `src/revivables/html-video-element.ts`

Replace the `box` stub with a real implementation. `box` snapshots the full `VideoState`, builds a plain `Controller` object, and passes the `controller` through `recursiveBox` so `function.ts` handles each method.

- [ ] **Step 1: Add the `snapshot` helper above `box`**

Insert immediately before `export const isType`:

```ts
const snapshot = (v: HTMLVideoElement): VideoState => ({
  src: v.src,
  currentTime: v.currentTime,
  volume: v.volume,
  muted: v.muted,
  playbackRate: v.playbackRate,
  autoplay: v.autoplay,
  loop: v.loop,
  controls: v.controls,
  preload: v.preload,
  crossOrigin: v.crossOrigin,
  playsInline: v.playsInline,
  defaultPlaybackRate: v.defaultPlaybackRate,
  defaultMuted: v.defaultMuted,
  poster: v.poster,
  paused: v.paused,
  ended: v.ended,
  duration: v.duration,
  readyState: v.readyState,
  networkState: v.networkState,
  seeking: v.seeking,
  videoWidth: v.videoWidth,
  videoHeight: v.videoHeight,
  currentSrc: v.currentSrc,
  error: serializeMediaError(v.error),
  buffered: serializeRanges(v.buffered),
  played: serializeRanges(v.played),
  seekable: serializeRanges(v.seekable),
})
```

- [ ] **Step 2: Replace the `box` stub with the real implementation**

Replace the entire `export const box = …` stub with:

```ts
export const box = <T extends HTMLVideoElement, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedHTMLVideoElement => {
  const controller: Controller = {
    call: async (method, args) => {
      return (value as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args)
    },
    set: async (prop, v) => {
      ;(value as unknown as Record<string, unknown>)[prop] = v
    },
    subscribe: async (onDelta) => {
      const disposers: Array<() => void> = []
      for (const eventName of EVENT_NAMES) {
        const listener = () => { onDelta(eventName, EVENT_DELTAS[eventName](value)) }
        value.addEventListener(eventName, listener)
        disposers.push(() => value.removeEventListener(eventName, listener))
      }
      return () => { for (const d of disposers) d() }
    },
  }

  const boxedController = recursiveBox(
    controller as unknown as Capable,
    context,
  )

  return {
    ...BoxBase,
    type,
    initialState: snapshot(value),
    controller: boxedController,
  } as BoxedHTMLVideoElement
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsgo --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/revivables/html-video-element.ts
git commit -m "feat: ✨implement htmlVideoElement box (snapshot + controller)"
```

---

## Task 4: Implement the local side (`revive`)

**Files:**
- Modify: `src/revivables/html-video-element.ts`

Replace the `revive` stub with a real implementation. This is the meat of the module. It builds a `Proxy` whose target is `Object.create(HTMLVideoElement.prototype)`, runs its own `addEventListener`/`on<event>` dispatch, and calls `controller.subscribe(onDelta)` to start the remote→local event stream.

- [ ] **Step 1: Replace the `revive` stub with the real implementation**

Replace the entire `export const revive = …` stub with:

```ts
export const revive = <T extends BoxedHTMLVideoElement, T2 extends RevivableContext>(
  value: T,
  context: T2,
): HTMLVideoElement => {
  const controller = recursiveRevive(
    value.controller as Capable,
    context,
  ) as unknown as Controller

  const state: VideoState = { ...value.initialState }

  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const onHandlers = new Map<string, EventListener | null>()

  // Forward declaration so the trap handlers can reference the Proxy itself.
  // `proxy` is assigned before any trap runs (synchronously below).
  let proxy: HTMLVideoElement

  const dispatchEvent = (event: Event): boolean => {
    Object.defineProperty(event, 'target',        { value: proxy, configurable: true })
    Object.defineProperty(event, 'currentTarget', { value: proxy, configurable: true })
    Object.defineProperty(event, 'srcElement',    { value: proxy, configurable: true })

    const onHandler = onHandlers.get(`on${event.type}`)
    if (onHandler) {
      try { onHandler.call(proxy, event) }
      catch (e) { queueMicrotask(() => { throw e }) }
    }

    const entries = listeners.get(event.type)
    if (entries) {
      for (const l of [...entries]) {
        try {
          if (typeof l === 'function') l.call(proxy, event)
          else (l as EventListenerObject).handleEvent?.call(proxy, event)
        } catch (e) { queueMicrotask(() => { throw e }) }
      }
    }

    return !event.defaultPrevented
  }

  const addEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (listener == null) return
    let bucket = listeners.get(kind)
    if (!bucket) { bucket = new Set(); listeners.set(kind, bucket) }

    // Handle `once` and `signal` by wrapping the listener before insertion.
    let actual = listener
    if (typeof options === 'object' && options != null) {
      if (options.once) {
        const inner = actual
        const wrapper: EventListener = (e) => {
          bucket!.delete(wrapper)
          if (typeof inner === 'function') inner.call(proxy, e)
          else (inner as EventListenerObject).handleEvent?.call(proxy, e)
        }
        actual = wrapper
      }
      if (options.signal) {
        const target = actual
        options.signal.addEventListener('abort', () => { bucket!.delete(target) }, { once: true })
      }
    }

    bucket.add(actual)
  }

  const removeEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
  ) => {
    if (listener == null) return
    listeners.get(kind)?.delete(listener)
  }

  const target = Object.create(HTMLVideoElement.prototype) as HTMLVideoElement

  proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'addEventListener')    return addEventListener
      if (prop === 'removeEventListener') return removeEventListener
      if (prop === 'dispatchEvent')       return dispatchEvent

      if (typeof prop === 'string' && ON_HANDLER_NAMES.has(prop)) {
        return onHandlers.get(prop) ?? null
      }

      if (typeof prop === 'string' && METHOD_NAMES_SET.has(prop)) {
        return (...args: unknown[]) => controller.call(prop as MethodName, args)
      }

      if (typeof prop === 'string' && prop in state) {
        const raw = (state as Record<string, unknown>)[prop]
        if (prop === 'buffered' || prop === 'played' || prop === 'seekable') {
          return reviveRanges(raw as SerializedTimeRanges)
        }
        if (prop === 'error') {
          return reviveMediaError(raw as SerializedMediaError)
        }
        return raw
      }

      return Reflect.get(t, prop, receiver)
    },
    set(t, prop, value, receiver) {
      if (typeof prop === 'string' && ON_HANDLER_NAMES.has(prop)) {
        onHandlers.set(prop, typeof value === 'function' ? value as EventListener : null)
        return true
      }

      if (typeof prop === 'string' && WRITABLE_PROPS_SET.has(prop)) {
        ;(state as Record<string, unknown>)[prop] = value
        void controller.set(prop as WritableProp, value)
        return true
      }

      return Reflect.set(t, prop, value, receiver)
    },
  }) as HTMLVideoElement

  // Start the event stream. The returned disposer is intentionally not captured:
  // teardown is handled by function.ts's FinalizationRegistry when `controller`
  // is GC'd along with the proxy.
  void controller.subscribe((type, delta) => {
    Object.assign(state, delta)
    dispatchEvent(new Event(type))
  })

  return proxy
}
```

- [ ] **Step 2: Add the `typeCheck` sentinel at the bottom of the file**

Add at the very bottom (after `revive`):

```ts
const typeCheck = () => {
  const video = document.createElement('video')
  const boxed = box(video, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: HTMLVideoElement = revived
  // @ts-expect-error — not an HTMLVideoElement
  const notVideo: string = revived
  // @ts-expect-error — cannot box a non-HTMLVideoElement
  box('not a video' as unknown as never, {} as RevivableContext)
  void expected; void notVideo; void typeCheck
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsgo --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/revivables/html-video-element.ts
git commit -m "feat: ✨implement htmlVideoElement revive (proxy + event dispatch)"
```

---

## Task 5: Scaffold the test file with helper setup

**Files:**
- Create: `tests/browser/html-video-element.ts`

This task creates the shared test harness — a helper that sets up a real `<video>` element on one osra endpoint, exposes it to the other endpoint via `revivableModules: [htmlVideoElement]`, and returns both sides for the individual tests to poke at. Follow-on tasks add one test at a time using this helper.

- [ ] **Step 1: Create the file with imports, helper, and an empty test list**

```ts
// tests/browser/html-video-element.ts
import type { Transport } from '../../src/types'

import { expect } from 'chai'

import { expose, htmlVideoElement } from '../../src/index'

/**
 * Creates a real <video> element on the "remote" side and exposes it through
 * the given transport to the "local" side. Returns both: the caller uses
 * `local` for assertions and `remote` to directly mutate the underlying
 * element when simulating state changes from the other context.
 */
const setupVideoRoundTrip = async (transport: Transport) => {
  const remote = document.createElement('video')

  const exposed = { getVideo: async () => remote }
  expose(exposed, { transport, revivableModules: [htmlVideoElement] })

  const client = await expose<typeof exposed>(
    {},
    { transport, revivableModules: [htmlVideoElement] },
  )

  const local = await client.getVideo()
  return { local, remote }
}

/** A one-microtask flush — the Proxy `set` trap fires `controller.set` without
 *  awaiting it, so tests need a short yield before observing the remote side. */
const flush = () => new Promise(resolve => queueMicrotask(() => resolve(undefined)))
```

- [ ] **Step 2: Type-check**

Run: `npx tsgo --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tests/browser/html-video-element.ts
git commit -m "test: 🧪scaffold htmlVideoElement test harness"
```

---

## Task 6: Add test — `instanceof HTMLVideoElement`

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

This validates the most fundamental guarantee of the spec: the revived value passes `instanceof HTMLVideoElement`.

- [ ] **Step 1: Append the test export to `tests/browser/html-video-element.ts`**

Add at the bottom of the file:

```ts
export const instanceOfCheck = async (transport: Transport) => {
  const { local } = await setupVideoRoundTrip(transport)
  expect(local).to.be.instanceOf(HTMLVideoElement)
}
```

- [ ] **Step 2: Wire the export into `tests/browser/web-context-transport.ts`**

At the bottom of the file (after the existing `userPoint*` exports), add:

```ts
import * as htmlVideoElementTests from './html-video-element'

export const htmlVideoElementInstanceOfCheck = () => htmlVideoElementTests.instanceOfCheck(window)
```

- [ ] **Step 3: Wire the export into `tests/browser/json-transport.ts`**

At the bottom of the file (after the existing `userPoint*` exports), add:

```ts
import * as htmlVideoElementTests from './html-video-element'

export const htmlVideoElementInstanceOfCheck = () => htmlVideoElementTests.instanceOfCheck(jsonTransport())
```

- [ ] **Step 4: Run the test suite**

Run: `npm run test -- -g htmlVideoElementInstanceOfCheck`
Expected: two passing tests (one under Web, one under JSONTransport).

If the test fails because `HTMLVideoElement` isn't found on the remote side, re-read the spec's "Revive time" section — the target is `Object.create(HTMLVideoElement.prototype)`, which requires the DOM to be present. Both test transports run in a browser page, so this should be fine.

- [ ] **Step 5: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement instanceof check"
```

---

## Task 7: Add test — initial state mirrored synchronously

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test to `tests/browser/html-video-element.ts`**

```ts
export const initialStateMirrored = async (transport: Transport) => {
  const remote = document.createElement('video')
  remote.volume = 0.5
  remote.muted = true
  remote.loop = true

  const exposed = { getVideo: async () => remote }
  expose(exposed, { transport, revivableModules: [htmlVideoElement] })

  const client = await expose<typeof exposed>(
    {},
    { transport, revivableModules: [htmlVideoElement] },
  )
  const local = await client.getVideo()

  // Synchronous reads — no await.
  expect(local.volume).to.equal(0.5)
  expect(local.muted).to.equal(true)
  expect(local.loop).to.equal(true)
  expect(local.paused).to.equal(true) // default for a freshly created <video>
}
```

- [ ] **Step 2: Wire into `web-context-transport.ts`**

```ts
export const htmlVideoElementInitialStateMirrored = () => htmlVideoElementTests.initialStateMirrored(window)
```

- [ ] **Step 3: Wire into `json-transport.ts`**

```ts
export const htmlVideoElementInitialStateMirrored = () => htmlVideoElementTests.initialStateMirrored(jsonTransport())
```

- [ ] **Step 4: Run**

Run: `npm run test -- -g htmlVideoElementInitialStateMirrored`
Expected: two passing tests.

- [ ] **Step 5: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement initial state mirrored synchronously"
```

---

## Task 8: Add test — writable property propagation

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test**

```ts
export const writablePropPropagation = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  local.autoplay = true
  local.loop = true
  local.playbackRate = 2

  // Optimistic local read — sync, no await.
  expect(local.autoplay).to.equal(true)
  expect(local.loop).to.equal(true)
  expect(local.playbackRate).to.equal(2)

  // The remote side is updated after the controller.set RPC resolves.
  // Wait for one turn of the event loop before asserting on the remote.
  await flush()
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(remote.autoplay).to.equal(true)
  expect(remote.loop).to.equal(true)
  expect(remote.playbackRate).to.equal(2)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementWritablePropPropagation = () => htmlVideoElementTests.writablePropPropagation(window)
```

```ts
// json-transport.ts
export const htmlVideoElementWritablePropPropagation = () => htmlVideoElementTests.writablePropPropagation(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementWritablePropPropagation`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement writable property propagation"
```

---

## Task 9: Add test — `canPlayType()` method call

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

`canPlayType` is the simplest method to test because it's synchronous on the real element (becomes `Promise<CanPlayTypeResult>` on the proxy), doesn't require any media to load, and returns a non-empty string for any type the browser can potentially play. We avoid `play()` here because autoplay policies can reject it in headless browsers; `play()` is tested separately in Task 10.

- [ ] **Step 1: Append the test**

```ts
export const methodCallCanPlayType = async (transport: Transport) => {
  const { local } = await setupVideoRoundTrip(transport)

  const result = await (local.canPlayType as (type: string) => Promise<CanPlayTypeResult>)('video/mp4')
  // Chrome returns 'probably' or 'maybe' for mp4; Firefox may return 'maybe'.
  // Any of the three valid enum values is acceptable; we just assert it's a string.
  expect(result).to.be.a('string')
  // Assert it's one of the valid enum values for CanPlayTypeResult.
  expect(['', 'maybe', 'probably']).to.include(result)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementMethodCallCanPlayType = () => htmlVideoElementTests.methodCallCanPlayType(window)
```

```ts
// json-transport.ts
export const htmlVideoElementMethodCallCanPlayType = () => htmlVideoElementTests.methodCallCanPlayType(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementMethodCallCanPlayType`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement canPlayType method call"
```

---

## Task 10: Add test — `play()`/`pause()` round-trip

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

This tests that promise-returning methods are proxied correctly. `play()` on a source-less video will reject, which is fine — we just want to confirm the method is callable across the wire and returns a real `Promise`. `pause()` is a no-op on an already-paused video and is the positive-path assertion.

- [ ] **Step 1: Append the test**

```ts
export const playPauseRoundTrip = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // play() on a source-less element rejects, which is fine — we're only
  // verifying the proxied call returns a Promise. Swallow the rejection.
  const playResult = (local.play as () => Promise<void>)()
  expect(playResult).to.be.instanceOf(Promise)
  try { await playResult } catch { /* no source */ }

  // pause() always resolves; it also proves the method-call path for a
  // Promise<void> return.
  const pauseResult = (local.pause as () => Promise<void>)()
  expect(pauseResult).to.be.instanceOf(Promise)
  await pauseResult

  await new Promise(resolve => setTimeout(resolve, 50))

  expect(remote.paused).to.equal(true)
  expect(local.paused).to.equal(true)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementPlayPauseRoundTrip = () => htmlVideoElementTests.playPauseRoundTrip(window)
```

```ts
// json-transport.ts
export const htmlVideoElementPlayPauseRoundTrip = () => htmlVideoElementTests.playPauseRoundTrip(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementPlayPauseRoundTrip`
Expected: two passing tests.

If the test fails because the fake data URL throws synchronously inside `play()`, simplify the test: call `pause()` only (the remote is already paused, but the RPC path still exercises the method call). Report findings before simplifying — the point of this test is covering the `play() -> Promise<void>` shape.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement play/pause round-trip"
```

---

## Task 11: Add test — event propagation with delta update (`timeupdate`/`seeked`)

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

Sets `remote.currentTime = 5` and verifies the local proxy receives a delta, updates its cache, and fires a `seeked` event whose listener sees the new `currentTime`.

- [ ] **Step 1: Append the test**

```ts
export const eventDeltaUpdatesState = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // Give subscribe() a turn to register on the remote side before we mutate.
  await new Promise(resolve => setTimeout(resolve, 50))

  const seen: Array<{ type: string, currentTime: number }> = []
  local.addEventListener('seeked', () => {
    seen.push({ type: 'seeked', currentTime: local.currentTime })
  })
  local.addEventListener('timeupdate', () => {
    seen.push({ type: 'timeupdate', currentTime: local.currentTime })
  })

  // Dispatch a synthetic seeked event on the remote element. This is the most
  // reliable way to force a state change without needing media to actually load
  // and play in a headless test browser.
  remote.currentTime = 5
  remote.dispatchEvent(new Event('seeked'))
  remote.dispatchEvent(new Event('timeupdate'))

  // Wait for the event stream round-trip.
  await new Promise(resolve => setTimeout(resolve, 100))

  expect(seen.length).to.be.greaterThan(0)
  // Each observed event should have seen currentTime === 5 at the moment of dispatch.
  for (const entry of seen) {
    expect(entry.currentTime).to.equal(5)
  }
  expect(local.currentTime).to.equal(5)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementEventDeltaUpdatesState = () => htmlVideoElementTests.eventDeltaUpdatesState(window)
```

```ts
// json-transport.ts
export const htmlVideoElementEventDeltaUpdatesState = () => htmlVideoElementTests.eventDeltaUpdatesState(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementEventDeltaUpdatesState`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement event delta updates local state"
```

---

## Task 12: Add test — `addEventListener` fires with `event.target === proxy`

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test**

```ts
export const addEventListenerFires = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // Give subscribe() a turn to register listeners on the remote.
  await new Promise(resolve => setTimeout(resolve, 50))

  const observed: Array<{ type: string, targetIsProxy: boolean }> = []
  local.addEventListener('volumechange', (e) => {
    observed.push({ type: e.type, targetIsProxy: e.target === local })
  })

  remote.volume = 0.25 // triggers volumechange on remote
  remote.dispatchEvent(new Event('volumechange'))

  await new Promise(resolve => setTimeout(resolve, 100))

  expect(observed.length).to.be.greaterThan(0)
  expect(observed[0].type).to.equal('volumechange')
  expect(observed[0].targetIsProxy).to.equal(true)
  expect(local.volume).to.equal(0.25)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementAddEventListenerFires = () => htmlVideoElementTests.addEventListenerFires(window)
```

```ts
// json-transport.ts
export const htmlVideoElementAddEventListenerFires = () => htmlVideoElementTests.addEventListenerFires(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementAddEventListenerFires`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement addEventListener receives events with correct target"
```

---

## Task 13: Add test — `removeEventListener` detaches a listener

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test**

```ts
export const removeEventListenerDetaches = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  await new Promise(resolve => setTimeout(resolve, 50))

  let firedCount = 0
  const listener = () => { firedCount++ }
  local.addEventListener('volumechange', listener)
  local.removeEventListener('volumechange', listener)

  remote.volume = 0.1
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))

  expect(firedCount).to.equal(0)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementRemoveEventListenerDetaches = () => htmlVideoElementTests.removeEventListenerDetaches(window)
```

```ts
// json-transport.ts
export const htmlVideoElementRemoveEventListenerDetaches = () => htmlVideoElementTests.removeEventListenerDetaches(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementRemoveEventListenerDetaches`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement removeEventListener detaches"
```

---

## Task 14: Add test — `on<event>` handler slot

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test**

```ts
export const onEventHandlerSlot = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)
  await new Promise(resolve => setTimeout(resolve, 50))

  let fired = 0
  ;(local as HTMLVideoElement).onvolumechange = () => { fired++ }
  expect((local as HTMLVideoElement).onvolumechange).to.be.a('function')

  remote.volume = 0.3
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(fired).to.equal(1)

  // Assigning null should clear the slot.
  ;(local as HTMLVideoElement).onvolumechange = null
  expect((local as HTMLVideoElement).onvolumechange).to.equal(null)

  remote.volume = 0.4
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(fired).to.equal(1) // unchanged
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementOnEventHandlerSlot = () => htmlVideoElementTests.onEventHandlerSlot(window)
```

```ts
// json-transport.ts
export const htmlVideoElementOnEventHandlerSlot = () => htmlVideoElementTests.onEventHandlerSlot(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementOnEventHandlerSlot`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement on<event> handler slot"
```

---

## Task 15: Add test — multiple fields in one delta (`volumechange` → volume + muted)

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

- [ ] **Step 1: Append the test**

```ts
export const multipleDeltaFields = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)
  await new Promise(resolve => setTimeout(resolve, 50))

  remote.volume = 0.7
  remote.muted = true
  remote.dispatchEvent(new Event('volumechange'))

  await new Promise(resolve => setTimeout(resolve, 100))

  expect(local.volume).to.equal(0.7)
  expect(local.muted).to.equal(true)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementMultipleDeltaFields = () => htmlVideoElementTests.multipleDeltaFields(window)
```

```ts
// json-transport.ts
export const htmlVideoElementMultipleDeltaFields = () => htmlVideoElementTests.multipleDeltaFields(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementMultipleDeltaFields`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement delta carries multiple fields per event"
```

---

## Task 16: Add test — error listener isolation

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

Spec Section 4 requires that a throwing listener rethrows asynchronously via `queueMicrotask` so subsequent listeners still fire. This test registers a bad listener followed by a good one and verifies the good one runs.

- [ ] **Step 1: Append the test**

```ts
export const errorListenerIsolation = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)
  await new Promise(resolve => setTimeout(resolve, 50))

  // Install a global error swallower so the queueMicrotask rethrow doesn't
  // fail the test. Playwright reports unhandled errors to the test runner.
  const onError = (e: ErrorEvent) => { e.preventDefault() }
  window.addEventListener('error', onError)

  let goodRan = false
  local.addEventListener('volumechange', () => { throw new Error('bad listener') })
  local.addEventListener('volumechange', () => { goodRan = true })

  remote.volume = 0.2
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))

  window.removeEventListener('error', onError)

  expect(goodRan).to.equal(true)
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementErrorListenerIsolation = () => htmlVideoElementTests.errorListenerIsolation(window)
```

```ts
// json-transport.ts
export const htmlVideoElementErrorListenerIsolation = () => htmlVideoElementTests.errorListenerIsolation(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementErrorListenerIsolation`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement listener errors don't block siblings"
```

---

## Task 17: Add test — custom property passthrough

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

The spec says the `set` trap falls through to `Reflect.set` for anything not in `WRITABLE_PROPS_SET` or `ON_HANDLER_NAMES`, so arbitrary user-tacked fields still work. This test verifies that.

- [ ] **Step 1: Append the test**

```ts
export const customPropertyPassthrough = async (transport: Transport) => {
  const { local } = await setupVideoRoundTrip(transport)

  ;(local as unknown as Record<string, string>).foo = 'bar'
  expect((local as unknown as Record<string, string>).foo).to.equal('bar')
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementCustomPropertyPassthrough = () => htmlVideoElementTests.customPropertyPassthrough(window)
```

```ts
// json-transport.ts
export const htmlVideoElementCustomPropertyPassthrough = () => htmlVideoElementTests.customPropertyPassthrough(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementCustomPropertyPassthrough`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅htmlVideoElement custom property passthrough"
```

---

## Task 18: Add test — defaults still work when this module is registered

**Files:**
- Modify: `tests/browser/html-video-element.ts`
- Modify: `tests/browser/web-context-transport.ts`
- Modify: `tests/browser/json-transport.ts`

Mirrors the existing `userPointDefaultsStillWork` pattern: registering `htmlVideoElement` in `revivableModules` must not break the default `Date` revivable.

- [ ] **Step 1: Append the test**

```ts
export const defaultsStillWork = async (transport: Transport) => {
  const value = async () => new Date('2026-04-08T00:00:00.000Z')
  expose(value, { transport, revivableModules: [htmlVideoElement] })

  const test = await expose<typeof value>(
    {},
    { transport, revivableModules: [htmlVideoElement] },
  )

  const result = await test()
  expect(result).to.be.instanceOf(Date)
  expect(result.toISOString()).to.equal('2026-04-08T00:00:00.000Z')
}
```

- [ ] **Step 2: Wire into both transports**

```ts
// web-context-transport.ts
export const htmlVideoElementDefaultsStillWork = () => htmlVideoElementTests.defaultsStillWork(window)
```

```ts
// json-transport.ts
export const htmlVideoElementDefaultsStillWork = () => htmlVideoElementTests.defaultsStillWork(jsonTransport())
```

- [ ] **Step 3: Run**

Run: `npm run test -- -g htmlVideoElementDefaultsStillWork`
Expected: two passing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/html-video-element.ts tests/browser/web-context-transport.ts tests/browser/json-transport.ts
git commit -m "test: ✅defaults still work when htmlVideoElement is registered"
```

---

## Task 19: Full suite run and final commit

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including all thirteen new `htmlVideoElement*` tests under both `Web` and `JSONTransport` contexts.

- [ ] **Step 2: Run type-check**

Run: `npx tsgo --noEmit`
Expected: no errors.

- [ ] **Step 3: If anything fails**

Investigate the root cause. Do **not** disable, skip, or `it.only` tests to make the suite green. If a test reveals an actual bug in the module, fix the module — the tests are the spec. If a test is flaky because of timing (possible with `setTimeout` waits), increase the wait to 200ms in the failing test and retry; if still flaky, report to the user before proceeding.

- [ ] **Step 4: Final verification commit (docs)**

If any documentation in `README.md`, `docs/API.md`, or `docs/ADVANCED.md` obviously needs a mention of the new module, update it in a single focused commit — but only if the addition is a natural fit for an existing section (e.g. a list of built-in revivables in API.md that currently enumerates them). If nothing obviously fits, skip this step — the spec and plan documents are already committed and serve as the reference.

```bash
git status # should be clean
```

---

## Self-Review Notes

**Spec coverage checklist:** every requirement from `docs/superpowers/specs/2026-04-08-html-video-element-revivable-design.md` maps to a task:

| Spec requirement | Task |
|---|---|
| New file `src/revivables/html-video-element.ts` with `type`/`isType`/`box`/`revive` | Tasks 1, 3, 4 |
| Opt-in export (not added to defaults) | Task 2 |
| Static tables (`WRITABLE_PROPS`, `READONLY_PROPS`, `METHOD_NAMES`, `EVENT_DELTAS`, `ON_HANDLER_NAMES`) + `_SET` runtime lookups | Task 1 |
| `VideoState` flat record with all writable + read-only fields | Task 1 |
| `serializeRanges`/`reviveRanges`/`serializeMediaError`/`reviveMediaError` helpers | Task 1 |
| `Controller` contract (`call`/`set`/`subscribe`) composed via `recursiveBox`/`recursiveRevive` | Tasks 3, 4 |
| `box` full-state snapshot + controller construction | Task 3 |
| `revive` target = `Object.create(HTMLVideoElement.prototype)` | Task 4 |
| `revive` internal event dispatch with `target`/`currentTarget`/`srcElement` overrides via `defineProperty` | Task 4 |
| `revive` listener map + on-handler map | Task 4 |
| `revive` Proxy `get` trap rules 1–7 | Task 4 |
| `revive` Proxy `set` trap rules 1–3 | Task 4 |
| `once`/`signal` option support in `addEventListener` | Task 4 |
| Synchronous `subscribe` call at revive time | Task 4 |
| Error listener isolation via `queueMicrotask` rethrow | Task 4, verified by Task 16 |
| `typeCheck` sentinel at the bottom of the module | Task 4 |
| Test: `instanceof HTMLVideoElement` | Task 6 |
| Test: initial state mirrored synchronously | Task 7 |
| Test: writable property propagation | Task 8 |
| Test: method call with return value | Task 9 |
| Test: `play()`/`pause()` round-trip | Task 10 |
| Test: event propagation + delta state update | Task 11 |
| Test: `addEventListener` receives events with correct target | Task 12 |
| Test: `removeEventListener` detaches | Task 13 |
| Test: `on<event>` handler slot | Task 14 |
| Test: multiple fields in one delta | Task 15 |
| Test: error listener isolation | Task 16 |
| Test: custom property passthrough | Task 17 |
| Test: defaults still work when this module is registered | Task 18 |
| JSON-only transport variant of all tests | Every test task wires to both `web-context-transport.ts` and `json-transport.ts` |
| Spec-declared out-of-scope items (`srcObject`, text tracks, PiP, EME, pixel rendering, memory leak tests) | Intentionally absent |

**Type consistency spot-check:**
- `WritableProp`, `MethodName`, `EventName` are declared in Task 1 and used consistently in Tasks 3 and 4.
- `Controller` shape matches the spec: `call(method, args)`, `set(prop, value)`, `subscribe(onDelta) → Promise<() => void>`. Tasks 3 and 4 both use these names.
- `BoxedHTMLVideoElement` has `initialState` and `controller` in Task 1, and both Tasks 3 and 4 reference those same names.
- The test helper `setupVideoRoundTrip` is declared in Task 5 and reused by Tasks 6, 8, 12, 13, 14, 15, 16, 17 (unchanged signature). Tests that need custom initial state (Tasks 7, 10, 11, 18) construct the remote video inline instead — this is intentional, not drift.

**Placeholder scan:** no TBD/TODO/"implement later"/"similar to Task N"/"add error handling" anywhere in the task body. Every code block is complete. Every run command has an expected output.
