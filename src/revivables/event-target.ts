import type { Capable } from '../types'
import { BoxBase, type RevivableContext, type BoxBase as BoxBaseType, type UnderlyingType } from './utils'
import { identity } from './identity'
import * as func from './function'

export const type = 'eventTarget' as const

type SerializedEvent = { eventType: string, bubbles: boolean, cancelable: boolean, composed: boolean, detail?: Capable }
type ForwarderFn = (data: SerializedEvent) => void
type ListenerRpc = (eventType: string, listener: ForwarderFn) => void

export type BoxedEventTarget<T extends EventTarget = EventTarget> =
  & BoxBaseType<typeof type>
  & { addListener: func.BoxedFunction<ListenerRpc>, removeListener: func.BoxedFunction<ListenerRpc> }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is EventTarget => value instanceof EventTarget

const serializeEvent = (event: Event): SerializedEvent => ({
  eventType: event.type,
  bubbles: event.bubbles,
  cancelable: event.cancelable,
  composed: event.composed,
  ...(event instanceof CustomEvent ? { detail: event.detail as Capable } : {}),
})

export const box = <T extends EventTarget, T2 extends RevivableContext>(value: T, context: T2): BoxedEventTarget<T> => {
  // identity() replays the same revived listener on add and remove, so
  // caching the adapter per-listener lets the DOM unregister by identity.
  const adapters = new WeakMap<ForwarderFn, EventListener>()
  const adapt = (listener: ForwarderFn): EventListener => {
    let a = adapters.get(listener)
    if (!a) adapters.set(listener, a = (event) => { listener(serializeEvent(event)) })
    return a
  }
  const add: ListenerRpc = (eventType, listener) => value.addEventListener(eventType, adapt(listener))
  const remove: ListenerRpc = (eventType, listener) => {
    const a = adapters.get(listener)
    if (a) value.removeEventListener(eventType, a)
  }
  return {
    ...BoxBase,
    type,
    addListener: func.box(add, context),
    removeListener: func.box(remove, context),
  } as BoxedEventTarget<T>
}

// DOM uniques on (listener, capture); inner value is the wrapper nativeAdd
// received so removeEventListener can pass the same reference back.
type Subscriptions = Map<string, Map<EventListenerOrEventListenerObject, Map<boolean, EventListenerOrEventListenerObject>>>

// Returns true iff the event type went empty so the caller can unregister.
const removeFromTracking = (subs: Subscriptions, eventType: string, listener: EventListenerOrEventListenerObject, capture: boolean): boolean => {
  const byListener = subs.get(eventType)
  if (!byListener) return false
  const byCapture = byListener.get(listener)
  if (!byCapture?.delete(capture)) return false
  if (byCapture.size === 0) byListener.delete(listener)
  if (byListener.size > 0) return false
  subs.delete(eventType)
  return true
}

// Top-level so the closure captures only targetRef (weak), not `target`.
// The forwarder is held strongly by FR cleanup info — any scope link to
// target would pin the revived EventTarget and defeat GC teardown. V8
// retains whole context slots per closure, so isolation must be structural.
const makeForwarder = (targetRef: WeakRef<EventTarget>): ForwarderFn =>
  (data) => {
    const t = targetRef.deref()
    if (!t) return
    const init = { bubbles: data.bubbles, cancelable: data.cancelable, composed: data.composed }
    t.dispatchEvent('detail' in data
      ? new CustomEvent(data.eventType, { ...init, detail: data.detail })
      : new Event(data.eventType, init))
  }

// Held-value fields must not retain target — otherwise the FR never fires.
const registry = new FinalizationRegistry<{ forwarder: ForwarderFn, registered: Set<string>, removeRpc: ListenerRpc }>(({ forwarder, registered, removeRpc }) => {
  for (const eventType of registered) try { removeRpc(eventType, identity(forwarder)) } catch { /* connection closed */ }
  registered.clear()
})

export const revive = <T extends BoxedEventTarget, T2 extends RevivableContext>(value: T, context: T2): T[UnderlyingType] => {
  const addRpc = func.revive(value.addListener, context) as unknown as ListenerRpc
  const removeRpc = func.revive(value.removeListener, context) as unknown as ListenerRpc
  const target = new EventTarget()
  const registered = new Set<string>()
  const subs: Subscriptions = new Map()
  const forwarder = makeForwarder(new WeakRef(target))
  const nativeAdd = EventTarget.prototype.addEventListener.bind(target)
  const nativeRemove = EventTarget.prototype.removeEventListener.bind(target)

  const register = (e: string): void => {
    if (!registered.has(e) && registered.add(e)) try { addRpc(e, identity(forwarder)) } catch { /* connection closed */ }
  }
  const unregister = (e: string): void => {
    if (registered.delete(e)) try { removeRpc(e, identity(forwarder)) } catch { /* connection closed */ }
  }

  Object.defineProperty(target, 'addEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (listener === null) return
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      let byListener = subs.get(eventType)
      if (!byListener) subs.set(eventType, byListener = new Map())
      let byCapture = byListener.get(listener)
      if (!byCapture) byListener.set(listener, byCapture = new Map())
      if (byCapture.has(capture)) return

      // once:true self-removes natively but doesn't notify us — wrapper
      // keeps our tracking in sync so the source forwarder gets dropped.
      const once = typeof options === 'object' && options !== null && !!options.once
      const wrapper: EventListenerOrEventListenerObject = once
        ? (event: Event) => {
            if (removeFromTracking(subs, eventType, listener, capture)) unregister(eventType)
            if (typeof listener === 'function') listener(event)
            else listener.handleEvent(event)
          }
        : listener

      byCapture.set(capture, wrapper)
      register(eventType)
      nativeAdd(eventType, wrapper, options)
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
      if (listener === null) return
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      const wrapper = subs.get(eventType)?.get(listener)?.get(capture)
      if (!wrapper) return
      nativeRemove(eventType, wrapper, options)
      if (removeFromTracking(subs, eventType, listener, capture)) unregister(eventType)
    },
  })

  registry.register(target, { forwarder, registered, removeRpc }, target)
  return target as T[UnderlyingType]
}

const typeCheck = () => {
  const r = revive(box(new EventTarget(), {} as RevivableContext), {} as RevivableContext)
  const expected: EventTarget = r
  // @ts-expect-error - not a string
  const notString: string = r
  // @ts-expect-error - cannot box non-EventTarget
  box('not an event target', {} as RevivableContext)
}
