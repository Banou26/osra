// src/revivables/event-target.ts
//
// Generic revivable for `EventTarget` instances. The revived proxy is itself
// an `EventTarget` (via `instanceof`); calls to `addEventListener`,
// `removeEventListener`, and `dispatchEvent` are forwarded to the remote side
// over RPC. Listeners are register-on-demand: each local `addEventListener`
// allocates a UUID and asks the remote side to fire the corresponding callback
// when the matching event type fires on the underlying `EventTarget`.
//
// Limitations
// -----------
// - The wire form for events is `{ type, detail, bubbles, cancelable, composed }`
//   reconstructed as a `CustomEvent`. Subtype-specific properties (`MouseEvent`
//   coordinates, `ProgressEvent` lengths, etc.) are NOT preserved. Suitable for
//   custom events and DOM events that only carry `type`/`detail`.
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

type Controller = {
  subscribe: (uuid: string, type: string, cb: (event: SerializedEvent) => void) => Promise<void>
  unsubscribe: (uuid: string) => Promise<void>
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
  // For each event type, the real DOM listener attached to `value` that
  // fans out to all registered callbacks for that type.
  const realListeners = new Map<string, EventListener>()
  // (uuid → { type, callback }). All registered callbacks across all types.
  const callbacksByUuid = new Map<string, { type: string, cb: (event: SerializedEvent) => void }>()

  const ensureAttached = (eventType: string) => {
    if (realListeners.has(eventType)) return
    const fanOut: EventListener = (event) => {
      const serialized = serializeEvent(event)
      for (const entry of callbacksByUuid.values()) {
        if (entry.type === eventType) entry.cb(serialized)
      }
    }
    value.addEventListener(eventType, fanOut)
    realListeners.set(eventType, fanOut)
  }

  const controller: Controller = {
    subscribe: async (uuid, eventType, cb) => {
      callbacksByUuid.set(uuid, { type: eventType, cb })
      ensureAttached(eventType)
    },
    unsubscribe: async (uuid) => {
      const entry = callbacksByUuid.get(uuid)
      if (!entry) return
      callbacksByUuid.delete(uuid)
      // If no more callbacks for this type, detach the real DOM listener.
      const stillUsed = [...callbacksByUuid.values()].some(e => e.type === entry.type)
      if (!stillUsed) {
        const real = realListeners.get(entry.type)
        if (real) value.removeEventListener(entry.type, real)
        realListeners.delete(entry.type)
      }
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

  // (listener → (type → uuid)). Lets removeEventListener find the right uuid.
  // Stored as a Map<type, uuid> per listener so the same listener registered
  // for multiple types can be removed independently.
  const uuidsByListener = new WeakMap<object, Map<string, string>>()

  // The proxy target is a real EventTarget so `instanceof EventTarget` works
  // without any prototype trickery. We override addEventListener / removeEventListener
  // / dispatchEvent on top of it; the inherited slots are unused.
  const target = new EventTarget()
  let proxy!: EventTarget

  const addEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (listener == null) return
    let typeMap = uuidsByListener.get(listener as object)
    if (!typeMap) { typeMap = new Map(); uuidsByListener.set(listener as object, typeMap) }
    if (typeMap.has(kind)) return // dedup, matching native EventTarget semantics

    const uuid = globalThis.crypto.randomUUID()
    typeMap.set(kind, uuid)

    const once = typeof options === 'object' && options != null && options.once === true
    const signal = typeof options === 'object' && options != null ? options.signal : undefined

    const callback = (serialized: SerializedEvent) => {
      const event = deserializeEvent(serialized)
      Object.defineProperty(event, 'target',        { value: proxy, configurable: true })
      Object.defineProperty(event, 'currentTarget', { value: proxy, configurable: true })
      Object.defineProperty(event, 'srcElement',    { value: proxy, configurable: true })
      try {
        if (typeof listener === 'function') listener.call(proxy, event)
        else (listener as EventListenerObject).handleEvent?.call(proxy, event)
      } catch (e) { queueMicrotask(() => { throw e }) }

      if (once) {
        typeMap!.delete(kind)
        void controller.unsubscribe(uuid)
      }
    }

    void controller.subscribe(uuid, kind, callback)

    if (signal) {
      signal.addEventListener('abort', () => {
        typeMap!.delete(kind)
        void controller.unsubscribe(uuid)
      }, { once: true })
    }
  }

  const removeEventListener = (
    kind: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions,
  ) => {
    if (listener == null) return
    const typeMap = uuidsByListener.get(listener as object)
    if (!typeMap) return
    const uuid = typeMap.get(kind)
    if (uuid) {
      typeMap.delete(kind)
      void controller.unsubscribe(uuid)
    }
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
