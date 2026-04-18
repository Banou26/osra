import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'
import type { BoxedMessagePort } from './message-port'

import { BoxBase } from './utils'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
} from './message-port'

export const type = 'eventTarget' as const

// Wire protocol — receiver tells source which event types to forward (so we
// don't broadcast every dispatch); source pushes a serialised event when its
// EventTarget fires a matching type.
type EventTargetMessage =
  | { kind: 'subscribe', eventType: string }
  | { kind: 'unsubscribe', eventType: string }
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

  localPort.addEventListener('message', ({ data }) => {
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
  })
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedEventTarget<T>
}

export const revive = <T extends BoxedEventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  port.start()

  const target = new EventTarget()
  // Per-type listener sets; subscription messages fire only on the 0↔1 edge so
  // the source side stays the single owner of its forwarding listener.
  const subscriptions = new Map<string, Set<EventListenerOrEventListenerObject>>()

  const nativeAdd = EventTarget.prototype.addEventListener.bind(target)
  const nativeRemove = EventTarget.prototype.removeEventListener.bind(target)

  port.addEventListener('message', ({ data }) => {
    if (data.kind !== 'event') return
    const eventInit = {
      bubbles: data.bubbles,
      cancelable: data.cancelable,
      composed: data.composed,
    }
    const event = 'detail' in data
      ? new CustomEvent(data.eventType, { ...eventInit, detail: data.detail })
      : new Event(data.eventType, eventInit)
    target.dispatchEvent(event)
  })

  Object.defineProperty(target, 'addEventListener', {
    value: (
      eventType: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener === null) return
      let set = subscriptions.get(eventType)
      if (!set) {
        set = new Set()
        subscriptions.set(eventType, set)
        port.postMessage({ kind: 'subscribe', eventType })
      }
      set.add(listener)
      nativeAdd(eventType, listener, options)
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (
      eventType: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => {
      if (listener === null) return
      nativeRemove(eventType, listener, options)
      const set = subscriptions.get(eventType)
      if (!set) return
      if (!set.delete(listener)) return
      if (set.size === 0) {
        subscriptions.delete(eventType)
        port.postMessage({ kind: 'unsubscribe', eventType })
      }
    },
  })

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
