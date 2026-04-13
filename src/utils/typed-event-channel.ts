import type { UnderlyingType } from './type'
import type { TypedEventTarget } from './typed-event-target'

export type TypedEventPortEventMap<T = unknown> = {
  'message': MessageEvent<T>
  'messageerror': MessageEvent
}

export interface TypedEventPort<T = unknown>
  extends Omit<
    TypedEventTarget<TypedEventPortEventMap<T>>,
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

export interface TypedEventChannel<T1 = unknown, T2 = unknown> {
  readonly port1: TypedEventPort<T1>
  readonly port2: TypedEventPort<T2>
}

export class EventPort<T> extends EventTarget {
  addEventListener<K extends keyof TypedEventPortEventMap<T> & string>(
    type: K,
    listener: ((event: TypedEventPortEventMap<T>[K]) => void) | null,
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

  removeEventListener<K extends keyof TypedEventPortEventMap<T> & string>(
    type: K,
    listener: ((event: TypedEventPortEventMap<T>[K]) => void) | null,
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

  _peer: EventPort<any> | undefined
  _queue: MessageEvent<T>[] = []
  _started = false
  _closed = false

  private _onmessage: ((this: MessagePort, ev: MessageEvent<T>) => unknown) | null = null

  get onmessage(): ((this: MessagePort, ev: MessageEvent<T>) => unknown) | null {
    return this._onmessage
  }
  set onmessage(value: ((this: MessagePort, ev: MessageEvent<T>) => unknown) | null) {
    this._onmessage = value
    if (value !== null) this.start()
  }

  onmessageerror: ((this: MessagePort, ev: MessageEvent) => unknown) | null = null

  dispatchEvent(event: Event): boolean {
    if (event.type === 'message') {
      this._onmessage?.call(this, event as MessageEvent<T>)
    } else if (event.type === 'messageerror') {
      this.onmessageerror?.call(this, event as MessageEvent)
    }
    return super.dispatchEvent(event)
  }

  postMessage(message: T, _options?: Transferable[] | StructuredSerializeOptions): void {
    const peer = this._peer
    if (!peer || peer._closed) return
    const event = new MessageEvent('message', { data: message })
    queueMicrotask(() => {
      if (peer._closed) return
      if (peer._started) {
        peer.dispatchEvent(event)
      } else {
        peer._queue.push(event)
      }
    })
  }

  start(): void {
    if (this._started) return
    this._started = true
    for (const event of this._queue.splice(0)) {
      this.dispatchEvent(event)
    }
  }

  close(): void {
    this._closed = true
    this._queue.length = 0
  }
}
export interface EventPort<T>
  extends Omit<
    TypedEventPort<T>,
    'addEventListener' | 'removeEventListener'
  > {}

export class EventChannel<T1 = unknown, T2 = unknown> {
  readonly port1: EventPort<T1>
  readonly port2: EventPort<T2>

  constructor() {
    const port1 = new EventPort<T1>()
    const port2 = new EventPort<T2>()
    port1._peer = port2
    port2._peer = port1
    this.port1 = port1
    this.port2 = port2
  }
}
