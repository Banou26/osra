import type { UnderlyingType } from './type'

export type EventMap = Record<string, Event>

/**
 * A typed EventTarget class that provides type-safe addEventListener/removeEventListener.
 * Can be instantiated directly: `new TypedEventTarget<MyEventMap>()`
 */
export class TypedEventTarget<T extends EventMap> extends EventTarget {
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
  addEventListener(
    type: string,
    listener: ((event: any) => void) | EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener as EventListener, options)
  }

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
  removeEventListener(
    type: string,
    listener: ((event: any) => void) | EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, listener as EventListener, options)
  }
}

/** Interface for typing an existing EventTarget */
export interface TypedEventTarget<T extends EventMap> {
  [UnderlyingType]?: T
}
