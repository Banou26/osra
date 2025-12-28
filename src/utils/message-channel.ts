import type { UnderlyingType } from '../revivables/utils'
import type { StructurableTransferable } from '../types'

type StrictMessagePortEventMap<T = unknown> = {
  'message': MessageEvent<T>
  'messageerror': MessageEvent
}

/**
 * A type-safe MessagePort wrapper that provides generic typing for messages.
 * This interface is structurally compatible with MessagePort while adding type safety.
 */
export interface StrictMessagePort<T = StructurableTransferable> extends MessagePort {
  [UnderlyingType]?: T
  onmessage: ((this: MessagePort, ev: MessageEvent<T>) => unknown) | null
  onmessageerror: ((this: MessagePort, ev: MessageEvent) => unknown) | null
  postMessage(message: T, transfer: Transferable[]): void
  postMessage(message: T, options?: StructuredSerializeOptions): void
  addEventListener<K extends keyof StrictMessagePortEventMap<T>>(type: K, listener: (this: MessagePort, ev: StrictMessagePortEventMap<T>[K]) => unknown, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof StrictMessagePortEventMap<T>>(type: K, listener: (this: MessagePort, ev: StrictMessagePortEventMap<T>[K]) => unknown, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export interface StrictMessageChannel<T1 = StructurableTransferable, T2 = StructurableTransferable> {
  readonly port1: StrictMessagePort<T1>
  readonly port2: StrictMessagePort<T2>
}

/**
 * Cast a MessagePort to a StrictMessagePort with type safety.
 * This is a zero-cost abstraction at runtime.
 */
export const asStrictPort = <T>(port: MessagePort): StrictMessagePort<T> =>
  port as StrictMessagePort<T>

/**
 * Cast a MessageChannel to a StrictMessageChannel with type safety.
 * This is a zero-cost abstraction at runtime.
 */
export const asStrictChannel = <T1, T2 = T1>(channel: MessageChannel): StrictMessageChannel<T1, T2> =>
  channel as StrictMessageChannel<T1, T2>
