import type { TypedMessagePort, TypedMessagePortEventMap } from './typed-message-channel'
import type { UnderlyingType } from './type'

import { TypedEventTarget } from './typed-event-target'

export class EventChannelPort<T> extends TypedEventTarget<TypedMessagePortEventMap<T>> {
  _peer: EventChannelPort<any> | undefined
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
export interface EventChannelPort<T>
  extends Omit<
    TypedMessagePort<T>,
    'addEventListener' | 'removeEventListener' | typeof UnderlyingType
  > {}

export class EventChannel<T1 = unknown, T2 = unknown> {
  readonly port1: EventChannelPort<T1>
  readonly port2: EventChannelPort<T2>

  constructor() {
    const port1 = new EventChannelPort<T1>()
    const port2 = new EventChannelPort<T2>()
    port1._peer = port2
    port2._peer = port1
    this.port1 = port1
    this.port2 = port2
  }
}
