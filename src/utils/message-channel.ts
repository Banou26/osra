import { StructurableTransferable } from "../types"

interface StrictMessagePortEventMap<T = any> {
  "message": MessageEvent<T>
  "messageerror": MessageEvent
}

export interface StrictMessagePort<T = StructurableTransferable> extends EventTarget {
  [UnderlyingType]: T
  onmessage: ((this: MessagePort, ev: MessageEvent<T>) => any) | null
  onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null
  close(): void
  postMessage(message: T, transfer: Transferable[]): void
  postMessage(message: T, options?: StructuredSerializeOptions): void
  start(): void
  addEventListener<K extends keyof StrictMessagePortEventMap<T>>(type: K, listener: (this: MessagePort, ev: StrictMessagePortEventMap<T>[K]) => any, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof StrictMessagePortEventMap<T>>(type: K, listener: (this: MessagePort, ev: StrictMessagePortEventMap<T>[K]) => any, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export interface StrictMessageChannel<T1 = StructurableTransferable, T2 = StructurableTransferable> {
  readonly port1: StrictMessagePort<T1>
  readonly port2: StrictMessagePort<T2>
}
