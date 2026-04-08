// src/revivables/event-target.ts
//
// Generic revivable for `EventTarget` instances. The revived proxy is itself
// an `EventTarget` (via `instanceof`); calls to `addEventListener`,
// `removeEventListener`, and `dispatchEvent` are forwarded to the remote side
// over RPC.
//
// The listener dedup story relies on the function revivable's per-connection
// identity cache (see `src/revivables/function.ts`): when the local user
// passes the same listener reference to `addEventListener` and then
// `removeEventListener`, both reach the box side as the same revived
// function. We take advantage of that by keeping a `WeakMap<revivedListener,
// wrapper>` on the box side, so subscribe and unsubscribe find the same real
// EventTarget wrapper without any uuid tracking.
//
// Limitations
// -----------
// - The wire form for events is `{ type, detail, bubbles, cancelable, composed }`
//   reconstructed as a `CustomEvent`. Subtype-specific properties (`MouseEvent`
//   coordinates, `ProgressEvent` lengths, etc.) are NOT preserved.
// - `addEventListener` is sync in the spec but the underlying subscribe RPC is
//   fire-and-forget. If an event fires on the remote side before the subscribe
//   RPC has been processed there, the local listener will not see it. Add a
//   small wait (one transport round-trip) between subscription and the first
//   expected event when this matters in tests.
// - `dispatchEvent` returns `true` synchronously regardless of the remote
//   `defaultPrevented` value, because the round-trip is async.
// - `event.detail` must be a `Capable` value (it crosses the wire via the
//   default revivable chain).

import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'eventTarget' as const

export type SerializedEvent = {
  type: string
  detail: unknown
  bubbles: boolean
  cancelable: boolean
  composed: boolean
}

const serializeEvent = (event: Event): SerializedEvent => ({
  type: event.type,
  detail: 'detail' in event ? (event as CustomEvent).detail : null,
  bubbles: event.bubbles,
  cancelable: event.cancelable,
  composed: event.composed,
})

const deserializeEvent = (data: SerializedEvent): Event =>
  new CustomEvent(data.type, {
    detail: data.detail,
    bubbles: data.bubbles,
    cancelable: data.cancelable,
    composed: data.composed,
  })

type RemoteListener = (serialized: SerializedEvent) => void

/**
 * Options forwarded to the remote side's native `addEventListener`. `once`
 * and `signal` flow through so the remote `EventTarget` enforces them
 * natively — the `abortSignal` revivable already handles `signal` crossing
 * the wire, so local aborts propagate correctly.
 */
type RemoteAddEventListenerOptions = {
  once?: boolean
  signal?: AbortSignal
}

type Controller = {
  subscribe: (type: string, listener: RemoteListener, options?: RemoteAddEventListenerOptions) => Promise<void>
  unsubscribe: (type: string, listener: RemoteListener) => Promise<void>
  dispatch: (event: SerializedEvent) => Promise<boolean>
}

export type BoxedEventTarget =
  & BoxBaseType<typeof type>
  & {
      controller: unknown
      [UnderlyingType]: EventTarget
    }

export const isType = (value: unknown): value is EventTarget =>
  typeof EventTarget !== 'undefined' && value instanceof EventTarget

export const box = <T extends EventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedEventTarget => {
  // For each revived listener we've seen, the real DOM wrapper we attached to
  // the underlying EventTarget. Keyed by the revived listener so that the same
  // listener (resolved by function identity on the wire) maps to the same
  // wrapper across subscribe/unsubscribe calls.
  const wrapperByListener = new WeakMap<RemoteListener, EventListener>()

  const getOrCreateWrapper = (listener: RemoteListener): EventListener => {
    const existing = wrapperByListener.get(listener)
    if (existing) return existing
    const wrapper: EventListener = (event) => {
      listener(serializeEvent(event))
    }
    wrapperByListener.set(listener, wrapper)
    return wrapper
  }

  const controller: Controller = {
    subscribe: async (eventType, listener, options) => {
      value.addEventListener(eventType, getOrCreateWrapper(listener), options)
    },
    unsubscribe: async (eventType, listener) => {
      const wrapper = wrapperByListener.get(listener)
      if (wrapper) value.removeEventListener(eventType, wrapper)
    },
    dispatch: async (serialized) => value.dispatchEvent(deserializeEvent(serialized)),
  }

  return {
    ...BoxBase,
    type,
    controller: recursiveBox(controller as unknown as Capable, context),
  } as BoxedEventTarget
}

export const revive = <T extends BoxedEventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): EventTarget => {
  const controller = recursiveRevive(
    value.controller as Capable,
    context,
  ) as unknown as Controller

  // Map the user's original listener (function or handler object) to the
  // wrapped function we hand over the wire. We need the same wrapped reference
  // on the second (remove) call so function identity links the two on the box
  // side.
  const wrappedByListener = new WeakMap<object, RemoteListener>()

  // The proxy target is a real EventTarget so `instanceof EventTarget` works
  // without any prototype trickery. We override addEventListener /
  // removeEventListener / dispatchEvent on top of it; the inherited listener
  // slots are unused.
  const target = new EventTarget()
  let proxy!: EventTarget

  const wrapListener = (listener: EventListenerOrEventListenerObject): RemoteListener => {
    const existing = wrappedByListener.get(listener as object)
    if (existing) return existing

    const handle: EventListener = typeof listener === 'function'
      ? listener
      : (e) => { (listener as EventListenerObject).handleEvent?.(e) }

    const wrapped: RemoteListener = (serialized) => {
      const event = deserializeEvent(serialized)
      Object.defineProperty(event, 'target',        { value: proxy, configurable: true })
      Object.defineProperty(event, 'currentTarget', { value: proxy, configurable: true })
      Object.defineProperty(event, 'srcElement',    { value: proxy, configurable: true })
      try { handle.call(proxy, event) }
      catch (e) { queueMicrotask(() => { throw e }) }
    }
    wrappedByListener.set(listener as object, wrapped)
    return wrapped
  }

  const addEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (listener == null) return
    const wrapped = wrapListener(listener)

    // Normalize the options bag to just the fields we forward over the wire.
    // `capture` is dropped because there is no tree here. `passive` is dropped
    // because the remote EventTarget doesn't benefit from it either.
    let forwarded: RemoteAddEventListenerOptions | undefined
    if (typeof options === 'object' && options != null) {
      forwarded = {}
      if (options.once) forwarded.once = true
      if (options.signal) forwarded.signal = options.signal
    }

    void controller.subscribe(kind, wrapped, forwarded)
  }

  const removeEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions,
  ) => {
    if (listener == null) return
    const wrapped = wrappedByListener.get(listener as object)
    if (wrapped) void controller.unsubscribe(kind, wrapped)
  }

  const dispatchEvent = (event: Event): boolean => {
    void controller.dispatch(serializeEvent(event))
    return true
  }

  proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'addEventListener')    return addEventListener
      if (prop === 'removeEventListener') return removeEventListener
      if (prop === 'dispatchEvent')       return dispatchEvent
      return Reflect.get(t, prop, receiver)
    },
  })

  return proxy
}

const typeCheck = () => {
  const et = new EventTarget()
  const boxed = box(et, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: EventTarget = revived
  // @ts-expect-error — not an EventTarget
  const notEt: string = revived
  // @ts-expect-error — cannot box a non-EventTarget
  box('not an event target' as unknown as string, {} as RevivableContext)
  void expected; void notEt; void typeCheck
}
