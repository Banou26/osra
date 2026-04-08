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
}

export type BoxedHTMLVideoElement =
  & BoxBaseType<typeof type>
  & {
      initialState: VideoState
      controller: unknown // actual shape is recursiveBox(Controller); opaque at the type layer
      eventProxy: unknown // facade EventTarget boxed via the eventTarget revivable
      [UnderlyingType]: HTMLVideoElement
    }

// ---- Module API ----

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

export const isType = (value: unknown): value is HTMLVideoElement =>
  typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement

export const box = <T extends HTMLVideoElement, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedHTMLVideoElement => {
  // Create a facade EventTarget that re-broadcasts each known media event as a
  // CustomEvent whose `detail` carries the state delta. The eventTarget
  // revivable proxies the facade across the wire — that's the entire
  // remote→local event flow now.
  const facade = new EventTarget()
  for (const eventName of EVENT_NAMES) {
    value.addEventListener(eventName, () => {
      facade.dispatchEvent(new CustomEvent(eventName, { detail: EVENT_DELTAS[eventName](value) }))
    })
  }

  const controller: Controller = {
    call: async (method, args) => {
      return (value as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args)
    },
    set: async (prop, v) => {
      ;(value as unknown as Record<string, unknown>)[prop] = v
    },
  }

  return {
    ...BoxBase,
    type,
    initialState: snapshot(value),
    controller: recursiveBox(controller as unknown as Capable, context),
    eventProxy: recursiveBox(facade as unknown as Capable, context),
  } as BoxedHTMLVideoElement
}

export const revive = <T extends BoxedHTMLVideoElement, T2 extends RevivableContext>(
  value: T,
  context: T2,
): HTMLVideoElement => {
  const controller = recursiveRevive(
    value.controller as Capable,
    context,
  ) as unknown as Controller

  // The eventProxy is the local mirror of the box-side facade EventTarget.
  // All event traffic (state-update deltas, on<event> handlers, user
  // addEventListener) flows through it.
  const eventProxy = recursiveRevive(
    value.eventProxy as Capable,
    context,
  ) as EventTarget

  const state: VideoState = { ...value.initialState }
  const onHandlers = new Map<string, EventListener | null>()

  let proxy!: HTMLVideoElement

  // User listeners are wrapped so the wrapper rebinds `this` to the video proxy
  // and overrides event.target/currentTarget/srcElement to point at the video
  // proxy (the eventTarget revivable would otherwise set them to the eventProxy
  // itself, which the user has no reference to).
  const wrapperByListener = new WeakMap<object, EventListener>()

  const wrapForVideo = (listener: EventListenerOrEventListenerObject): EventListener => {
    const existing = wrapperByListener.get(listener as object)
    if (existing) return existing

    const handle: EventListener = typeof listener === 'function'
      ? listener
      : (e) => { (listener as EventListenerObject).handleEvent?.(e) }

    const wrapped: EventListener = (event) => {
      Object.defineProperty(event, 'target',        { value: proxy, configurable: true })
      Object.defineProperty(event, 'currentTarget', { value: proxy, configurable: true })
      Object.defineProperty(event, 'srcElement',    { value: proxy, configurable: true })
      try { handle.call(proxy, event) }
      catch (e) { queueMicrotask(() => { throw e }) }
    }
    wrapperByListener.set(listener as object, wrapped)
    return wrapped
  }

  // Pre-register one internal listener per known media event on the eventProxy.
  // This runs BEFORE any user-added listener (because user listeners arrive
  // after revive returns), so the local state cache and the on<event> handler
  // slot are both updated before user code sees the event.
  for (const eventName of EVENT_NAMES) {
    eventProxy.addEventListener(eventName, (event) => {
      const detail = (event as CustomEvent).detail as Partial<VideoState> | null
      if (detail) Object.assign(state, detail)

      const onHandler = onHandlers.get(`on${eventName}`)
      if (onHandler) {
        // The eventTarget revivable already overrode event.target to its own
        // proxy; redirect it to the video proxy here so the user's on-handler
        // sees the right source.
        Object.defineProperty(event, 'target',        { value: proxy, configurable: true })
        Object.defineProperty(event, 'currentTarget', { value: proxy, configurable: true })
        Object.defineProperty(event, 'srcElement',    { value: proxy, configurable: true })
        try { onHandler.call(proxy, event) }
        catch (e) { queueMicrotask(() => { throw e }) }
      }
    })
  }

  const target = Object.create(HTMLVideoElement.prototype) as HTMLVideoElement

  proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'addEventListener') return (
        kind: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (listener == null) return
        eventProxy.addEventListener(kind, wrapForVideo(listener), options)
      }
      if (prop === 'removeEventListener') return (
        kind: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) => {
        if (listener == null) return
        const wrapped = wrapperByListener.get(listener as object)
        if (wrapped) eventProxy.removeEventListener(kind, wrapped, options)
      }
      if (prop === 'dispatchEvent') return (event: Event) => eventProxy.dispatchEvent(event)

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
  }) as unknown as HTMLVideoElement

  return proxy
}

const typeCheck = () => {
  const video = document.createElement('video')
  const boxed = box(video, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: HTMLVideoElement = revived
  // @ts-expect-error — not an HTMLVideoElement
  const notVideo: string = revived
  // @ts-expect-error — cannot box a non-HTMLVideoElement
  box('not a video' as unknown as string, {} as RevivableContext)
  void expected; void notVideo; void typeCheck
}
