import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'
import type { AnyPort, BoxedMessagePort } from './message-port'

import { BoxBase } from './utils'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
} from './message-port'

export const type = 'eventTarget' as const

// Wire protocol — receiver tells source which event types to forward (so we
// don't broadcast every dispatch); source pushes a serialised event when its
// EventTarget fires a matching type. The `close` sentinel lets the revive
// side notify the box side that the revived target is gone so it can tear
// down its forwarder listeners.
type EventTargetMessage =
  | { kind: 'subscribe', eventType: string }
  | { kind: 'unsubscribe', eventType: string }
  | { kind: 'close' }
  | {
      kind: 'event'
      eventType: string
      bubbles: boolean
      cancelable: boolean
      composed: boolean
      // Present iff the source dispatched a CustomEvent — preserves `detail`
      // (boxed via the surrounding revivable graph so live values flow).
      detail?: Capable
    }

export type BoxedEventTarget<T extends EventTarget = EventTarget> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<EventTargetMessage> }
  & { [UnderlyingType]: T }

// FinalizationRegistry — when the revived EventTarget is collected the box
// side needs to remove the forwarder listeners it installed on the user's
// source EventTarget; otherwise long-lived sources (window, document, …)
// retain the forwarder forever and keep posting into a dead channel on
// every dispatch. The callback posts a `close` sentinel through the
// revive-side port and then closes it.
type EventTargetCleanupInfo = {
  port: AnyPort<EventTargetMessage>
}

const eventTargetRegistry = new FinalizationRegistry<EventTargetCleanupInfo>((info) => {
  try {
    info.port.postMessage({ kind: 'close' })
  } catch { /* Port may already be closed */ }
  try {
    info.port.close()
  } catch { /* Port may already be closed */ }
})

export const isType = (value: unknown): value is EventTarget =>
  value instanceof EventTarget

export const box = <T extends EventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedEventTarget<T> => {
  const { localPort, boxedRemote } = createRevivableChannel<EventTargetMessage>(context)

  // One forwarder per event type, installed on demand and torn down when the
  // remote unsubscribes. Keyed by eventType so duplicate subscribes are no-ops.
  const sourceListeners = new Map<string, EventListener>()

  const tearDown = () => {
    for (const [eventType, listener] of sourceListeners) {
      value.removeEventListener(eventType, listener)
    }
    sourceListeners.clear()
    localPort.removeEventListener('message', messageListener as EventListener)
    localPort.close()
  }

  const messageListener = ({ data }: MessageEvent<EventTargetMessage>) => {
    if (data.kind === 'close') {
      tearDown()
      return
    }
    if (data.kind === 'subscribe') {
      if (sourceListeners.has(data.eventType)) return
      const listener: EventListener = (event) => {
        const message: EventTargetMessage = {
          kind: 'event',
          eventType: data.eventType,
          bubbles: event.bubbles,
          cancelable: event.cancelable,
          composed: event.composed,
        }
        if (event instanceof CustomEvent) {
          message.detail = event.detail as Capable
        }
        localPort.postMessage(message)
      }
      value.addEventListener(data.eventType, listener)
      sourceListeners.set(data.eventType, listener)
      return
    }
    if (data.kind === 'unsubscribe') {
      const existing = sourceListeners.get(data.eventType)
      if (!existing) return
      value.removeEventListener(data.eventType, existing)
      sourceListeners.delete(data.eventType)
    }
  }

  localPort.addEventListener('message', messageListener as EventListener)
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedEventTarget<T>
}

const extractCapture = (
  options?: boolean | EventListenerOptions | AddEventListenerOptions,
): boolean => typeof options === 'boolean' ? options : !!options?.capture

const extractOnce = (options?: boolean | AddEventListenerOptions): boolean =>
  typeof options === 'object' && options !== null && !!options.once

export const revive = <T extends BoxedEventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  port.start()

  const target = new EventTarget()
  // WeakRef so the dispatching listener doesn't pin `target` and block GC —
  // we want target collection to fire the FinalizationRegistry cleanup.
  const targetRef = new WeakRef(target)
  // Per-type registrations keyed by `(listener, capture)` because the DOM
  // uniques on that tuple: the same listener with capture=true and capture=false
  // are two distinct registrations and must be tracked independently. Tracking
  // on listener identity alone would silently drop one registration when the
  // other is removed, and miss `{ once: true }` self-removal.
  const subscriptions =
    new Map<string, Map<EventListenerOrEventListenerObject, Map<boolean, EventListenerOrEventListenerObject>>>()

  const nativeAdd = EventTarget.prototype.addEventListener.bind(target)
  const nativeRemove = EventTarget.prototype.removeEventListener.bind(target)

  // Removes one (listener, capture) registration; returns true iff the
  // event type went from non-empty to empty so the caller can post unsubscribe.
  const removeFromTracking = (
    eventType: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean,
  ): boolean => {
    const byListener = subscriptions.get(eventType)
    if (!byListener) return false
    const byCapture = byListener.get(listener)
    if (!byCapture) return false
    if (!byCapture.delete(capture)) return false
    if (byCapture.size === 0) byListener.delete(listener)
    if (byListener.size > 0) return false
    subscriptions.delete(eventType)
    return true
  }

  port.addEventListener('message', ({ data }: MessageEvent<EventTargetMessage>) => {
    if (data.kind !== 'event') return
    const t = targetRef.deref()
    if (!t) return
    const eventInit = {
      bubbles: data.bubbles,
      cancelable: data.cancelable,
      composed: data.composed,
    }
    const event = 'detail' in data
      ? new CustomEvent(data.eventType, { ...eventInit, detail: data.detail })
      : new Event(data.eventType, eventInit)
    t.dispatchEvent(event)
  })

  Object.defineProperty(target, 'addEventListener', {
    value: (
      eventType: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener === null) return
      const capture = extractCapture(options)
      const once = extractOnce(options)

      let byListener = subscriptions.get(eventType)
      const isFirstForType = !byListener
      if (!byListener) {
        byListener = new Map()
        subscriptions.set(eventType, byListener)
      }
      let byCapture = byListener.get(listener)
      if (!byCapture) {
        byCapture = new Map()
        byListener.set(listener, byCapture)
      }
      if (byCapture.has(capture)) return

      // `{ once: true }` auto-removes the native registration after first
      // dispatch, but the DOM doesn't notify our override — so without a
      // wrapper, our tracking would diverge and we'd never send unsubscribe.
      const effective: EventListenerOrEventListenerObject = once
        ? (event: Event) => {
            const becameEmpty = removeFromTracking(eventType, listener, capture)
            if (becameEmpty) port.postMessage({ kind: 'unsubscribe', eventType })
            if (typeof listener === 'function') listener(event)
            else listener.handleEvent(event)
          }
        : listener

      byCapture.set(capture, effective)
      if (isFirstForType) port.postMessage({ kind: 'subscribe', eventType })
      nativeAdd(eventType, effective, options)
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (
      eventType: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (listener === null) return
      const capture = extractCapture(options)
      const effective = subscriptions.get(eventType)?.get(listener)?.get(capture)
      if (!effective) return
      nativeRemove(eventType, effective, options)
      const becameEmpty = removeFromTracking(eventType, listener, capture)
      if (becameEmpty) port.postMessage({ kind: 'unsubscribe', eventType })
    },
  })

  eventTargetRegistry.register(target, { port }, target)

  return target as T[UnderlyingType]
}

const typeCheck = () => {
  const et = new EventTarget()
  const boxed = box(et, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: EventTarget = revived
  // @ts-expect-error - not a string
  const notString: string = revived
  // @ts-expect-error - cannot box non-EventTarget
  box('not an event target', {} as RevivableContext)
}
