import type {
  Message, MessageVariant, Uuid,
  Capable, MessageEventMap
} from '../types.js'
import type { DefaultRevivableModules, RevivableModule } from '../revivables/index.js'
import type { Context, Transport } from '../utils/transport.js'
import type { ConnectionContext } from './index.js'
import type { TypedEventTarget } from '../utils/typed-event-target.js'

import { defaultRevivableModules } from '../revivables/index.js'
import { isJsonOnlyTransport, isCustomTransport } from '../utils/type-guards.js'

export const normalizeTransport = (transport: Transport): Transport => {
  const custom = isCustomTransport(transport)
  const emit = custom ? (transport as { emit?: unknown }).emit : transport
  const receive = custom ? (transport as { receive?: unknown }).receive : transport
  // probe the embedded platform transports, not the wrapper: a custom { emit: webSocket } is JSON-only even though the wrapper is not
  const isJson =
    custom && 'isJson' in transport && transport.isJson !== undefined
      ? transport.isJson
      : (emit !== undefined && isJsonOnlyTransport(emit))
        || (receive !== undefined && isJsonOnlyTransport(receive))
  return {
    isJson,
    ...(emit !== undefined ? { emit } : {}),
    ...(receive !== undefined ? { receive } : {}),
  } as Transport
}

export const mergeRevivableModules = <
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
>(
  configure: ((defaults: DefaultRevivableModules) => TModules) | undefined,
): TModules =>
  configure
    ? configure(defaultRevivableModules)
    : defaultRevivableModules as unknown as TModules

export type ProtocolEventMap<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  // `peer` MUST stay a thunk: eager building runs the caller's context builder on every RPC frame and stream chunk instead of once per connection
  message: CustomEvent<{ message: Message<TModules>, peer: () => Context }>
}

export type ProtocolEventTarget<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = TypedEventTarget<ProtocolEventMap<TModules>>

export type ProtocolContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  valueFor: (peer: Context) => Capable<TModules>
  revivableModules: TModules
  connectionContexts: Map<string, ConnectionContext<TModules>>
  getUuid: () => Uuid
  presetRemoteUuid?: Uuid
  sendMessage: (message: MessageVariant, targetOrigin?: string) => void
  protocolEventTarget: ProtocolEventTarget<TModules>
  rejectRemoteValue: (error: unknown) => void
  addConnection: (ctx: Context, value: Capable<TModules>) => void
  abortConnection: (remoteUuid: Uuid) => void
  claimPendingAbort: (remoteUuid: Uuid) => boolean
  createConnectionEventTarget: () => TypedEventTarget<MessageEventMap<TModules>>
  unregisterSignal?: AbortSignal
}

export type StartConnectionsOptions<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  name?: string
  remoteName?: string
  key?: string
  origin?: string
  unregisterSignal?: AbortSignal
  revivableModules?: (defaults: DefaultRevivableModules) => TModules
  uuid?: Uuid
  remoteUuid?: Uuid
  /** Runs per connection on this side after the handshake; nothing it returns crosses the wire. */
  connection?: (connected: Connected<unknown>) => unknown
}

export type Connected<TValue> = {
  value: TValue
  context: Context
}

/** Awaiting gives the first peer, iterating gives every peer as it connects; the shape comes from the `connection:` option. */
export type Exposed<TResult> = Promise<TResult> & AsyncIterable<TResult>

export type ConnectionQueue<TRemote> = {
  push: (connection: Connected<TRemote>) => void
  close: () => void
  iterate: () => AsyncIterableIterator<Connected<TRemote>>
}

// bounds what a consumer that never iterates retains: each buffered connection pins a Remote proxy and a window or MessagePort
const PRE_ITERATION_BUFFER = 32

export const createConnectionQueue = <TRemote>(): ConnectionQueue<TRemote> => {
  type Result = IteratorResult<Connected<TRemote>>
  type Subscriber = { buffered: Connected<TRemote>[], wake?: (result: Result) => void }
  // copied into each new iterator, never drained: draining would let whichever loop iterated first decide what the others never see
  const early: Connected<TRemote>[] = []
  const subscribers = new Set<Subscriber>()
  let closed = false
  const done = () => ({ value: undefined as never, done: true as const })
  return {
    push: (connection) => {
      if (closed) return
      if (subscribers.size === 0) {
        early.push(connection)
        if (early.length > PRE_ITERATION_BUFFER) early.shift()
        return
      }
      for (const subscriber of subscribers) {
        const wake = subscriber.wake
        if (wake) { subscriber.wake = undefined; wake({ value: connection, done: false }); continue }
        subscriber.buffered.push(connection)
      }
    },
    close: () => {
      closed = true
      for (const subscriber of subscribers) {
        const wake = subscriber.wake
        subscriber.wake = undefined
        wake?.(done())
      }
    },
    iterate: () => {
      // per iterator, not shared: a waiter left behind by an abandoned iterator would swallow the next connection
      const subscriber: Subscriber = { buffered: [...early] }
      subscribers.add(subscriber)
      let finished = false
      return {
        [Symbol.asyncIterator]() { return this },
        next: () => {
          if (finished) return Promise.resolve(done())
          const next = subscriber.buffered.shift()
          if (next) return Promise.resolve({ value: next, done: false as const })
          if (closed) return Promise.resolve(done())
          return new Promise<Result>((resolve) => { subscriber.wake = resolve })
        },
        return: () => {
          finished = true
          subscribers.delete(subscriber)
          const wake = subscriber.wake
          subscriber.wake = undefined
          wake?.(done())
          return Promise.resolve(done())
        },
      }
    },
  }
}

export const asExposed = <T, TResult>(
  first: Promise<Connected<T>>,
  queue: ConnectionQueue<T>,
  select: (connected: Connected<T>) => TResult,
): Exposed<TResult> => {
  const result = first.then(select)
  // `result` is derived, so it needs its own no-op catch even when the caller handles the original
  result.catch(() => {})
  // do not replace with an async generator: one suspended at `await` defers `return()` until that await settles, so abandonment would hang
  const iterate = (): AsyncIterableIterator<TResult> => {
    const inner = queue.iterate()
    return {
      [Symbol.asyncIterator]() { return this },
      next: () =>
        inner.next().then(step =>
          step.done
            ? { value: undefined as never, done: true as const }
            : { value: select(step.value), done: false as const }),
      return: () =>
        inner.return?.() as Promise<IteratorResult<TResult>>
        ?? Promise.resolve({ value: undefined as never, done: true as const }),
    }
  }
  return Object.assign(result, { [Symbol.asyncIterator]: iterate }) as Exposed<TResult>
}

export const CONTEXT = Symbol.for('osra.context')

export type Contextual<TValue> = {
  [CONTEXT]: (ctx: Context) => TValue
}

/** Builds the exposed value once per connection, from that connection's context, before it is boxed and sent. */
export const context = <TValue,>(make: (ctx: Context) => TValue): Contextual<TValue> =>
  ({ [CONTEXT]: make })

export const isContextual = <TValue,>(value: unknown): value is Contextual<TValue> =>
  typeof value === 'object' && value !== null && CONTEXT in value
