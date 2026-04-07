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
  const controller: Controller = {
    call: async (method, args) => {
      return (value as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args)
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

export const revive = <T extends BoxedHTMLVideoElement, T2 extends RevivableContext>(
  _value: T,
  _context: T2,
): HTMLVideoElement => {
  throw new Error('html-video-element revive: not implemented')
}
