# HTMLVideoElement Revivable — Design

## Goal

Add a `RevivableModule` that lets an `HTMLVideoElement` cross an osra context boundary and, on the receiving side, surface as a proxy that looks and behaves like a real `HTMLVideoElement` for the interface-level use case:

- `instanceof HTMLVideoElement` returns `true`.
- Property reads (`video.currentTime`, `video.paused`, `video.volume`, …) return up-to-date values synchronously.
- Property writes (`video.autoplay = true`, `video.volume = 0.5`, …) propagate to the real element in the remote context.
- Method calls (`video.play()`, `video.pause()`, `video.load()`, `video.canPlayType(t)`) execute on the real element; promise-returning methods resolve through the proxy.
- Media events fired by the real element (`timeupdate`, `play`, `pause`, `ended`, `durationchange`, …) are dispatched on the local proxy, firing any listeners registered via `addEventListener` or `on<event>` handler slots.

Pixel rendering is **out of scope**: the proxy is not a DOM node, cannot be appended to the document, and does not stream frames. It is an interface/behavior mirror only.

## Scope

### In scope

- A new opt-in revivable module at `src/revivables/html-video-element.ts`.
- Exported as a named module; **not** added to `defaultRevivableModules`. Consumers opt in:
  ```ts
  import { expose, htmlVideoElement } from 'osra'
  expose(api, { transport, revivableModules: [htmlVideoElement] })
  ```
- A curated set of mirrored properties, methods, and events (see the tables in Section 3).
- Tests under `tests/browser/html-video-element.ts`, wired into both `web-context-transport.ts` and `json-transport.ts`.

### Out of scope

- `srcObject` / `MediaStream` proxying.
- `textTracks`, `addTextTrack`, `audioTracks`, `videoTracks`.
- `captureStream`, `requestPictureInPicture`, `setMediaKeys`, `setSinkId`.
- Attribute-level DOM APIs (`setAttribute('src', …)`, `getAttribute(…)`, `style`, `className`, …).
- Pixel rendering / frame streaming.
- Memory-leak tests specific to this module (the underlying `function` revivable is already covered by `baseMemory`).

## Architecture

Two sides, everything composed from primitives already in the codebase.

### Remote side — `box`

When `box(video, context)` runs:

1. Take a full snapshot of the current state of `video` into a flat `VideoState` record.
2. Build a plain JavaScript `controller` object with three plain functions:
   - `call(method, args)` — invokes the named method on the real element.
   - `set(prop, value)` — assigns to a writable property on the real element.
   - `subscribe(onDelta)` — attaches one listener per mirrored media event to the real element; each listener computes a minimal delta and calls `onDelta(type, delta)`. Returns a disposer that detaches all listeners.
3. Pass the whole `controller` through `recursiveBox` — the existing `function` revivable boxes each method, and `function.ts` itself handles the MessagePort fallback for JSON-only transports via `message-port.ts`.
4. Return the box:
   ```ts
   {
     ...BoxBase,
     type: 'htmlVideoElement',
     initialState,
     controller, // boxed
   }
   ```

No hand-rolled wire protocol. No direct `MessageChannel` use. The module is a thin adapter on top of `function.ts`.

### Local side — `revive`

When `revive(box, context)` runs:

1. Revive the `controller` via `recursiveRevive` — `call`, `set`, `subscribe` come back as async functions that RPC to the remote side.
2. Seed a closed-over `state: VideoState` from `box.initialState`.
3. Create the proxy target: `Object.create(HTMLVideoElement.prototype)`. Because the target's prototype chain includes `HTMLVideoElement.prototype`, `instanceof HTMLVideoElement` is `true`. No DOM node is allocated.
4. Create a `listeners: Map<string, Set<EventListenerOrEventListenerObject>>` and an `onHandlers: Map<string, EventListener | null>` for local event dispatch.
5. Wrap the target in a `Proxy` with custom `get` and `set` traps (see Section 4).
6. Call `controller.subscribe(onDelta)` exactly once, where `onDelta(type, delta)` does:
   ```ts
   Object.assign(state, delta)
   proxy.dispatchEvent(new Event(type))
   ```
   The subscribe call happens synchronously inside `revive`, so the event stream is wired up before the revived proxy is returned.
7. Return the proxy, typed as `HTMLVideoElement`.

### Lifecycle & teardown

The disposer returned by `subscribe` is captured in a closure on the remote side but never called explicitly from the local side. Teardown is handled by GC:

- When the local proxy is garbage-collected, the revived `controller.call`/`set`/`subscribe` functions lose their last reference.
- `function.ts`'s `FinalizationRegistry` fires for each of those functions and closes the underlying MessagePort.
- The remote side's port listener goes away, which releases its references. The disposer closure becomes unreachable and is collected normally.

This means the remote element keeps its media-event listeners attached for as long as the local proxy is alive, which is the correct behavior: if the local side is still referencing the video, it still wants events.

**GC retention characteristic.** There is a retention cycle worth being aware of:

```
local proxy
  ↓ (Proxy handlers close over)
local controller.call / .set / .subscribe
  ↓ (MessagePort)
remote revived proxy functions
  ↓ (captured by)
remote video.addEventListener listeners (for the event stream)
  ↓ (call)
local revived onDelta function
  ↓ (closes over)
local proxy  ← back to start
```

The cycle itself is fine for GC — JavaScript collects cycles — but the cycle is rooted *externally* by the remote `HTMLVideoElement` (via its `addEventListener`-attached listeners). This means the local proxy stays alive as long as the real remote video is alive, even if the local code has dropped all references to the proxy. In practice this is what you want: if the remote video is still playing, you don't want the local proxy silently detaching.

If the user needs an explicit "I'm done with this" escape hatch (e.g. to stop receiving `timeupdate` deltas without waiting for the remote video to be disposed), it can be added as a follow-up (see Open questions).

## Wire protocol

### Box shape

```ts
type VideoState = {
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
  error: { code: number; message: string } | null
  buffered: Array<[number, number]>
  played: Array<[number, number]>
  seekable: Array<[number, number]>
}

type RevivedController = {
  call: (method: string, args: unknown[]) => Promise<unknown>
  set: (prop: string, value: unknown) => Promise<void>
  subscribe: (
    onDelta: (type: string, delta: Partial<VideoState>) => void
  ) => Promise<() => void>
}

type BoxedHTMLVideoElement =
  & BoxBase<'htmlVideoElement'>
  & {
      initialState: VideoState
      controller: { /* recursiveBox(controller) result */ }
      [UnderlyingType]: HTMLVideoElement
    }
```

`TimeRanges` (`buffered`, `played`, `seekable`) are not structured-cloneable, so they're serialized as `Array<[start, end]>`. The local proxy wraps the array in a `TimeRanges`-shaped object exposing `length`, `start(i)`, and `end(i)`.

`MediaError` is serialized as `{ code, message }`. The local proxy wraps it in a `MediaError`-shaped object.

### Controller contract

- **`call(method: string, args: unknown[]): Promise<unknown>`** — performs `video[method](...args)` on the real element. The `function` revivable handles crossing the boundary; `canPlayType` becomes `Promise<CanPlayTypeResult>`, `play` becomes `Promise<void>` (matching the real async signature), `pause`/`load` become `Promise<void>`.
- **`set(prop: string, value: unknown): Promise<void>`** — performs `video[prop] = value` on the real element. Async only because it's an RPC; the local proxy's `set` trap does not await it.
- **`subscribe(onDelta): Promise<() => void>`** — attaches one listener per entry in `EVENT_DELTAS` (see Section 3) to the real element; returns a disposer. The disposer is captured but not called explicitly; GC handles it.

## Field, method, and event tables

Static hand-maintained tables at the top of the module. These are the single source of truth for what the module mirrors.

Each table is defined twice: once as an `as const` tuple for driving types (`VideoState`, `WritableProp`, etc.) and once as a `Set<string>` for O(1) runtime membership checks in the Proxy traps. The `Set` is derived from the tuple so the two can't drift.

### Writable properties

```ts
const WRITABLE_PROPS = [
  'src', 'currentTime', 'volume', 'muted', 'playbackRate', 'autoplay',
  'loop', 'controls', 'preload', 'crossOrigin', 'playsInline',
  'defaultPlaybackRate', 'defaultMuted', 'poster',
] as const
type WritableProp = typeof WRITABLE_PROPS[number]
const WRITABLE_PROPS_SET: ReadonlySet<string> = new Set(WRITABLE_PROPS)
```

### Read-only properties

```ts
const READONLY_PROPS = [
  'paused', 'ended', 'duration', 'readyState', 'networkState',
  'seeking', 'videoWidth', 'videoHeight', 'error', 'currentSrc',
  'buffered', 'played', 'seekable',
] as const
type ReadonlyProp = typeof READONLY_PROPS[number]
const READONLY_PROPS_SET: ReadonlySet<string> = new Set(READONLY_PROPS)
```

### Methods

```ts
const METHOD_NAMES = ['play', 'pause', 'load', 'canPlayType'] as const
type MethodName = typeof METHOD_NAMES[number]
const METHOD_NAMES_SET: ReadonlySet<string> = new Set(METHOD_NAMES)
```

`canPlayType` is intentionally async-ified on the proxy (returns `Promise<CanPlayTypeResult>`). All other methods either already return a promise or return `void`, so the async-ification is transparent.

### Per-event deltas

Each entry returns only the fields that the spec says the event changes. The initial full-state snapshot is taken at `box` time; everything after is pure delta traffic.

```ts
const EVENT_DELTAS: Record<string, (v: HTMLVideoElement) => Partial<VideoState>> = {
  timeupdate:     v => ({ currentTime: v.currentTime }),
  durationchange: v => ({ duration: v.duration }),
  volumechange:   v => ({ volume: v.volume, muted: v.muted }),
  ratechange:     v => ({ playbackRate: v.playbackRate, defaultPlaybackRate: v.defaultPlaybackRate }),
  play:           v => ({ paused: false, ended: false }),
  pause:          v => ({ paused: true }),
  playing:        v => ({ paused: false }),
  ended:          v => ({ ended: true, paused: true }),
  seeking:        v => ({ seeking: true }),
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
```

### On-event-handler property names

Derived as the keys of `EVENT_DELTAS` prefixed with `on`:

```ts
const ON_HANDLER_NAMES = new Set(
  Object.keys(EVENT_DELTAS).map(type => `on${type}`)
)
```

## Local proxy semantics

### `get` trap — evaluated top to bottom

1. `prop === 'addEventListener'` → returns a function that inserts into `listeners` (honors `once`/`signal` from the options bag by wrapping the listener before insertion; `capture` is ignored because there is no tree).
2. `prop === 'removeEventListener'` → returns a function that deletes from `listeners`.
3. `prop === 'dispatchEvent'` → returns the internal dispatch function so user code can fire synthetic events on the proxy.
4. `ON_HANDLER_NAMES.has(prop as string)` → returns `onHandlers.get(prop as string) ?? null`.
5. `METHOD_NAMES_SET.has(prop as string)` → returns `(...args) => controller.call(prop as MethodName, args)`.
6. `(prop as string) in state` → returns `state[prop as keyof VideoState]` (wrapping `buffered`/`played`/`seekable` in a `TimeRanges`-shaped object via `reviveRanges`, wrapping `error` in a `MediaError`-shaped object via `reviveMediaError`). Note that `WRITABLE_PROPS` are also keys of `state`, so both writable and read-only state reads flow through this rule.
7. Fallthrough → `Reflect.get(target, prop, receiver)` — catches `Symbol.toStringTag`, `constructor`, etc. so stringification and prototype inspection still look right.

### `set` trap — evaluated top to bottom

1. `ON_HANDLER_NAMES.has(prop as string)` → `onHandlers.set(prop as string, typeof value === 'function' ? value : null)`. Returns `true`.
2. `WRITABLE_PROPS_SET.has(prop as string)` → **optimistic local write** (`state[prop as WritableProp] = value`) *and* fire-and-forget `controller.set(prop as WritableProp, value)`. Returns `true` immediately so `video.autoplay = true; console.log(video.autoplay) // true` behaves as on a real element. If the remote clamps or rejects the value, the subsequent `volumechange`/`ratechange`/etc. delta corrects the local cache.
3. Fallthrough → `Reflect.set(target, prop, value, receiver)` so ad-hoc custom properties still work (users routinely tack fields onto DOM nodes).

### Internal `dispatchEvent`

```ts
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
```

Errors from individual listeners are rethrown asynchronously via `queueMicrotask` so one bad listener does not prevent the rest from firing. This matches real `EventTarget` behavior.

## Helper serializers

```ts
const serializeRanges = (ranges: TimeRanges): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  for (let i = 0; i < ranges.length; i++) out.push([ranges.start(i), ranges.end(i)])
  return out
}

const reviveRanges = (ranges: Array<[number, number]>): TimeRanges => ({
  length: ranges.length,
  start: (i: number) => ranges[i][0],
  end: (i: number) => ranges[i][1],
}) as unknown as TimeRanges

const serializeMediaError = (error: MediaError | null) =>
  error ? { code: error.code, message: error.message } : null

const reviveMediaError = (data: { code: number; message: string } | null): MediaError | null =>
  data ? ({ code: data.code, message: data.message }) as unknown as MediaError : null
```

## Type-safety checks

Following the pattern in `function.ts`, add a `typeCheck` function at the bottom of the module that exercises:

- `isType` narrowing.
- `box`/`revive` round-trip producing a type assignable to `HTMLVideoElement`.
- A `@ts-expect-error` line attempting to box a non-`HTMLVideoElement` value.

## Testing

New file `tests/browser/html-video-element.ts`, exporting one function per test. Each test constructs a real `document.createElement('video')` on the "remote" side (the same page, different osra endpoint over `window` transport), calls `expose` with `revivableModules: [htmlVideoElement]`, and asserts on the revived proxy. The exports are wired into `web-context-transport.ts` and `json-transport.ts` exactly like `userPoint`/`userPointReturn`/`userPointDefaultsStillWork` are.

### Core tests

1. **`instanceof HTMLVideoElement`** — revived value passes `instanceof`.
2. **Initial state mirrored** — on the remote, set `video.volume = 0.5; video.muted = true`, then expose; revived proxy's `volume === 0.5` and `muted === true` synchronously (no `await`).
3. **Writable property propagation** — `revived.autoplay = true`; after a microtask flush, the remote element's `autoplay` is `true`.
4. **Method call** — `await revived.play()` resolves; remote `video.paused === false`; revived `paused === false`.
5. **Method with return value** — `await revived.canPlayType('video/mp4')` returns a non-empty string.
6. **Event propagation with delta update** — on the remote, set `video.currentTime = 5`; the proxy receives `timeupdate` (and/or `seeking`/`seeked`) and `revived.currentTime === 5` inside the listener.
7. **`addEventListener` receives events** — attach a `play` listener on the proxy, call `revived.play()`, listener fires with `event.target === revived`.
8. **`removeEventListener` works** — add then remove; listener does not fire.
9. **`on<event>` handler slot** — `revived.onplay = fn` fires on play; assigning `null` clears it; reassigning replaces the previous handler.
10. **Multiple delta fields in one event** — `volumechange` updates `volume` and `muted` together in a single delta.
11. **Error listener isolation** — a listener that throws does not prevent subsequent listeners from firing (relies on `queueMicrotask` rethrow).
12. **Custom property passthrough** — `revived.foo = 'bar'; revived.foo === 'bar'` via the `set`/`get` fallthrough.
13. **Defaults still work when this module is registered** — mirroring the `userPointDefaultsStillWork` pattern: return a `Date` through an endpoint whose `revivableModules` contains `[htmlVideoElement]`; assert it still revives as a `Date`.

### JSON-only transport variant

All of the above under `json-transport.ts` to confirm the module works when MessagePorts aren't transferable. The `function` revivable handles this via `message-port.ts`'s JSON-only fallback, so this test mostly catches accidental assumptions in the module about structured-clone availability.

### Not tested

- **Pixel rendering / media playback** — out of scope (interface-only).
- **`srcObject`, text tracks, PiP, EME, `captureStream`** — explicitly out of scope.
- **Memory leak tests** — the module is a thin adapter over `function.ts`, which already has `baseMemory` coverage. Can be added later if real leaks show up.

## Open questions / future work

- If `timeupdate` traffic is later shown to be a bottleneck, the module can be migrated to its own `MessageChannel`-based protocol without breaking its public shape (`{ initialState, controller }`). The `controller` type would become a sealed internal protocol, but consumers never touch it.
- **Explicit disposal.** The GC retention cycle described above means the local proxy stays alive as long as the remote video is alive. If users need to detach proactively (e.g. to unsubscribe from an expensive event stream while the remote element is still in use), we can add a `dispose()` method — either as a Symbol-keyed method to keep the proxy's `HTMLVideoElement` interface clean, or as an exported `disposeVideoProxy(proxy)` helper. Not needed for the first pass.
- `srcObject` support is a natural follow-up once a MediaStream revivable exists.
- A sibling `htmlAudioElement` module would share almost all of this code. A future refactor could extract an `htmlMediaElement` base and add `HTMLVideoElement`/`HTMLAudioElement` specializations on top.
