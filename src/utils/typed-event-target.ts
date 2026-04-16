import type { UnderlyingType } from './type'

export type EventMap = Record<string, Event>

export interface TypedEventTarget<T extends EventMap> extends EventTarget {
  [UnderlyingType]?: T

  addEventListener<K extends keyof T & string>(
    type: K,
    listener: ((event: T[K]) => void) | null,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void

  removeEventListener<K extends keyof T & string>(
    type: K,
    listener: ((event: T[K]) => void) | null,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void
}

/**
 * Create a new `TypedEventTarget<T>` for a given event map. Centralises the
 * `EventTarget` → `TypedEventTarget<T>` cast so individual call sites don't
 * each need their own (`EventTarget` lacks the generic event map at the type
 * level, but the runtime behaviour is identical).
 */
export const createTypedEventTarget = <T extends EventMap>(): TypedEventTarget<T> =>
  new EventTarget() as TypedEventTarget<T>
