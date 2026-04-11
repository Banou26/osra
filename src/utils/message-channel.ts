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

// ---------------------------------------------------------------------------
// CapableChannel — an in-process MessageChannel stub whose ports pass values
// by reference instead of via structured clone. Exists so osra's revivables
// can route arbitrary `Capable` payloads (Promises, Functions, real
// MessagePorts, Errors, …) through a port pair without any of the
// DataCloneError landmines a real `MessageChannel` would hit. Layout mirrors
// the real one — two paired `StrictMessagePort`s with spec-shaped message
// queueing, start/close semantics, and onmessage that implicitly starts.
//
// Use as `new CapableChannel<InType, OutType>()`. Drop-in replacement for
// `new MessageChannel()` for osra-internal plumbing where values aren't
// expected to cross a worker boundary.
// ---------------------------------------------------------------------------

type PortState = {
  started: boolean
  closed: boolean
  queue: MessageEvent[]
  target: EventTarget
  onmessage: ((event: MessageEvent) => unknown) | null
  onmessageerror: ((event: MessageEvent) => unknown) | null
  partner: PortState | null
  /** Fires when the partner port closes — this port becomes "orphaned"
   *  (postMessage is void, but it can still receive pending events). */
  onorphaned: (() => void) | null
}

const makePortState = (): PortState => ({
  started: false,
  closed: false,
  queue: [],
  target: new EventTarget(),
  onmessage: null,
  onmessageerror: null,
  partner: null,
  onorphaned: null,
})

// Per spec, closing a port does NOT prevent delivery of messages already
// dispatched as microtasks before close() was called. Only the sender-side
// check in postMessage() gates new messages. This is what lets callers do
// `port.postMessage(x); port.close()` without losing the message.
const deliverToPort = (state: PortState, event: MessageEvent) => {
  state.target.dispatchEvent(event)
}

const enqueueOnPort = (state: PortState, event: MessageEvent) => {
  if (state.closed) return
  if (state.started) {
    queueMicrotask(() => deliverToPort(state, event))
  } else {
    state.queue.push(event)
  }
}

const makeCapablePort = <T>(state: PortState): StrictMessagePort<T> => {
  const start = () => {
    if (state.started || state.closed) return
    state.started = true
    const pending = state.queue
    state.queue = []
    for (const event of pending) queueMicrotask(() => deliverToPort(state, event))
  }

  const port = {
    postMessage(
      message: T,
      _transferOrOptions?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (state.closed || !state.partner || state.partner.closed) return
      // No structured clone — `data` is the same reference the caller passed
      const event = new MessageEvent('message', { data: message })
      enqueueOnPort(state.partner, event)
    },
    start,
    close() {
      if (state.closed) return
      state.closed = true
      state.queue.length = 0
      // The partner is now orphaned — its postMessage checks
      // partner.closed and becomes void, but it's NOT closed itself
      // and still receives already-queued events. Notify it via
      // onorphaned so message-port.ts can trigger tunnel cleanup.
      state.partner?.onorphaned?.()
    },
    addEventListener: state.target.addEventListener.bind(state.target),
    removeEventListener: state.target.removeEventListener.bind(state.target),
    dispatchEvent: state.target.dispatchEvent.bind(state.target),
    get onmessage() {
      return state.onmessage
    },
    set onmessage(listener: ((event: MessageEvent) => unknown) | null) {
      if (state.onmessage) {
        state.target.removeEventListener('message', state.onmessage as EventListener)
      }
      state.onmessage = listener
      if (listener) {
        state.target.addEventListener('message', listener as EventListener)
        // Setting onmessage implicitly starts the port (spec behaviour)
        start()
      }
    },
    get onmessageerror() {
      return state.onmessageerror
    },
    set onmessageerror(listener: ((event: MessageEvent) => unknown) | null) {
      if (state.onmessageerror) {
        state.target.removeEventListener('messageerror', state.onmessageerror as EventListener)
      }
      state.onmessageerror = listener
      if (listener) {
        state.target.addEventListener('messageerror', listener as EventListener)
      }
    },
    get onorphaned() {
      return state.onorphaned
    },
    set onorphaned(cb: (() => void) | null) {
      state.onorphaned = cb
    },
  }

  return port as unknown as StrictMessagePort<T>
}

export class CapableChannel<
  T1 = StructurableTransferable,
  T2 = StructurableTransferable,
> implements StrictMessageChannel<T1, T2> {
  readonly port1: StrictMessagePort<T1>
  readonly port2: StrictMessagePort<T2>

  constructor() {
    const state1 = makePortState()
    const state2 = makePortState()
    state1.partner = state2
    state2.partner = state1
    this.port1 = makeCapablePort<T1>(state1)
    this.port2 = makeCapablePort<T2>(state2)
  }
}
