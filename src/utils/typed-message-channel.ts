import type { UnderlyingType } from './type'
import type { TypedEventTarget } from './typed-event-target'

export type TypedMessagePortEventMap<T = unknown> = {
  'message': MessageEvent<T>
  'messageerror': MessageEvent
}

export interface TypedMessagePort<T = unknown>
  extends Omit<
    TypedEventTarget<TypedMessagePortEventMap<T>>,
    typeof UnderlyingType
  > {
  [UnderlyingType]?: T

  onmessage: ((this: MessagePort, ev: MessageEvent<T>) => unknown) | null
  onmessageerror: ((this: MessagePort, ev: MessageEvent) => unknown) | null

  postMessage(message: T, transfer: Transferable[]): void
  postMessage(message: T, options?: StructuredSerializeOptions): void

  start(): void
  close(): void
}

export interface TypedMessageChannel<T1 = unknown, T2 = unknown> {
  readonly port1: TypedMessagePort<T1>
  readonly port2: TypedMessagePort<T2>
}
