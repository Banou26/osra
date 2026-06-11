import type { TypedMessagePort, TypedMessagePortEventMap } from './typed-message-channel.js'

// NOT `extends EventTarget`: Firefox content-script / privileged sandboxes don't
// support subclassing platform interfaces - `super()` returns a bare EventTarget
// and the subclass methods (start/postMessage/close) vanish. EventPort keeps its
// own listener registry so it works in every realm.
type EventPortListener = EventListenerOrEventListenerObject

export class EventPort<T> {
  private _listeners = new Map<string, Set<EventPortListener>>()
  private _onceListeners = new WeakSet<EventPortListener>()

  addEventListener<K extends keyof TypedMessagePortEventMap<T> & string>(
    type: K,
    listener: ((event: TypedMessagePortEventMap<T>[K]) => void) | null,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!listener) return
    let set = this._listeners.get(type)
    if (!set) { set = new Set(); this._listeners.set(type, set) }
    set.add(listener)
    if (typeof options === 'object' && options?.once) this._onceListeners.add(listener)
  }

  removeEventListener<K extends keyof TypedMessagePortEventMap<T> & string>(
    type: K,
    listener: ((event: TypedMessagePortEventMap<T>[K]) => void) | null,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    if (!listener) return
    this._listeners.get(type)?.delete(listener)
    this._onceListeners.delete(listener)
  }

  _peer: EventPort<any> | undefined
  _queue: MessageEvent<T>[] = []
  _started = false
  _closed = false
  _onClose: (() => void) | undefined

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
    const set = this._listeners.get(event.type)
    if (set) {
      for (const listener of [...set]) {
        if (this._onceListeners.has(listener)) {
          set.delete(listener)
          this._onceListeners.delete(listener)
        }
        if (typeof listener === 'function') listener.call(this, event)
        else listener.handleEvent(event)
      }
    }
    return true
  }

  postMessage(message: T, _options?: Transferable[] | StructuredSerializeOptions): void {
    const peer = this._peer
    if (!peer || peer._closed) return
    queueMicrotask(() => {
      if (peer._closed) return
      const event = new MessageEvent('message', { data: message })
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
    if (this._closed) return
    this._closed = true
    this._queue.length = 0
    this._onClose?.()
    // Mirror the platform 'close' event: closing a port notifies its peer.
    // Deferred so messages posted before the close still deliver first.
    const peer = this._peer
    if (peer && !peer._closed) {
      queueMicrotask(() => {
        if (!peer._closed) peer.dispatchEvent(new Event('close'))
      })
    }
  }
}

export interface EventPort<T>
  extends Omit<
    TypedMessagePort<T>,
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
