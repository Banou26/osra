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
  // Probe the embedded platform transports, not the wrapper - a custom
  // { emit: webSocket } is JSON-only even though the wrapper itself isn't.
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

/** Resolves the final revivable module list. The user supplies a function
 *  that takes the defaults and returns whatever ordering/composition they
 *  want - add modules, drop defaults, reorder, override per-type. When
 *  omitted, the defaults are used as-is. */
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
  // the transport's own view of the inbound message rides along, because that is the only place the
  // peer's origin exists and it is gone by the time a connection module sees the payload
  // `peer` is a thunk: only the announce branch needs it, and building it eagerly ran the caller's
  // context builder on every RPC frame and stream chunk instead of once per connection
  message: CustomEvent<{ message: Message<TModules>, peer: () => Context }>
}

export type ProtocolEventTarget<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = TypedEventTarget<ProtocolEventMap<TModules>>

export type ProtocolContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  /** The exposed value for ONE peer. A factory rather than a value so a server can answer each realm
   *  differently (scoped resolvers per origin) instead of sharing one object across every connection. */
  valueFor: (peer: Context) => Capable<TModules>
  revivableModules: TModules
  connectionContexts: Map<string, ConnectionContext<TModules>>
  getUuid: () => Uuid
  presetRemoteUuid?: Uuid
  /** targetOrigin overrides the configured origin for this one send - only
   *  the unsolicited announce beacon broadcasts with '*'. */
  sendMessage: (message: MessageVariant, targetOrigin?: string) => void
  protocolEventTarget: ProtocolEventTarget<TModules>
  rejectRemoteValue: (error: unknown) => void
  /** reports an established connection: settles the first-connection promise and feeds iteration, so
   *  a caller sees every realm rather than only the one that happened to connect first */
  addConnection: (ctx: Context, value: Capable<TModules>) => void
  /** tears down one connection: close to the peer, teardown locally, drop it from tracking */
  abortConnection: (remoteUuid: Uuid) => void
  /** true when this uuid was aborted before it was registered, which means refuse the registration */
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
  /** Configure the revivable module list. Receives the defaults and
   *  returns the final ordered list - add modules, drop defaults, reorder,
   *  or override per-type as needed. */
  revivableModules?: (defaults: DefaultRevivableModules) => TModules
  uuid?: Uuid
  remoteUuid?: Uuid
  /** Decides what one connection resolves to, for the await and for iteration alike. Omit it and that
   *  is the peer's value, which is what `expose` has always given back:
   *
   *  ```ts
   *  const remote = await expose(api, { transport })
   *
   *  const { value, context } = await expose(api, {
   *    transport,
   *    connection: ({ value, context }) => ({ value, context }),
   *  })
   *
   *  for await (const origin of expose(api, {
   *    transport,
   *    connection: ({ context }) => context.origin,
   *  })) { }
   *  ```
   *
   *  It runs per connection, on this side, after the handshake. It cannot change what is sent, and
   *  nothing it returns crosses the wire. */
  connection?: (connected: Connected<unknown>) => unknown
}

/** An established connection: the value that realm exposed, and what this side knows about the realm
 *  it came from. `context` is whatever the transport observed, plus an `abort` that drops this one
 *  peer. Anything derived from it is the caller's to compute, in the value factory or in
 *  `connection:`, rather than something to declare up front. */
export type Connected<TValue> = {
  value: TValue
  context: Context
}

/** The result of `expose`. Awaiting it gives the first peer, iterating it gives every peer as it
 *  connects, and both hand back the same thing: one shape, read once or read repeatedly.
 *
 *  What that shape IS comes from the `connection:` option. Without one it is the peer's value, which
 *  is what `expose` has always resolved to. With one it is whatever that function returns. */
export type Exposed<TResult> = Promise<TResult> & AsyncIterable<TResult>

export type ConnectionQueue<TRemote> = {
  push: (connection: Connected<TRemote>) => void
  close: () => void
  iterate: () => AsyncIterableIterator<Connected<TRemote>>
}

/** Multicast: every iterator sees every peer, rather than several loops sharing one cursor and each
 *  taking a slice. Two loops watching one server both mean "tell me about every peer", and a shared
 *  cursor makes whichever one happens to be waiting eat the peer the other was waiting for. */
/** Until someone asks to iterate, a connection is buffered only up to this many. Every consumer that
 *  just awaits the first connection would otherwise retain every later one for the transport's life,
 *  each pinning a Remote proxy and a window or MessagePort. Buffering a few keeps the ordinary
 *  "expose now, iterate on the next tick" case lossless; a consumer that never iterates cannot leak. */
const PRE_ITERATION_BUFFER = 32

/** @internal protocol plumbing, not part of the public api */
export const createConnectionQueue = <TRemote>(): ConnectionQueue<TRemote> => {
  type Result = IteratorResult<Connected<TRemote>>
  type Subscriber = { buffered: Connected<TRemote>[], wake?: (result: Result) => void }
  // Replayed to every iterator that starts later, so `expose` then iterate on a subsequent tick stays
  // lossless. Copied rather than drained: draining would let whichever loop iterated first decide
  // what the others never see.
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
      // Per iterator, not shared: a waiter left behind by an abandoned iterator would be handed the
      // next connection, drop it, and a fresh iterator would never see that peer.
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

/** The awaited-and-iterable result, with every connection passed through `select` first. The promise
 *  is DERIVED from the first-connection promise, so it needs its own no-op catch: a fire-and-forget
 *  `expose(...)` handles the original, and an unhandled derived rejection would still reach the
 *  console. */
/** @internal not part of the public api */
export const asExposed = <T, TResult>(
  first: Promise<Connected<T>>,
  queue: ConnectionQueue<T>,
  select: (connected: Connected<T>) => TResult,
): Exposed<TResult> => {
  const result = first.then(select)
  result.catch(() => {})
  // Hand-written rather than an async generator wrapping the queue. A generator suspended at an
  // `await` defers `return()` until that await settles, and the await here is a connection that may
  // never come, so abandoning the iterator would hang instead of releasing it. Delegating `return`
  // straight to the queue's own iterator keeps abandonment immediate.
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

/** An exposed value can itself be a function - osra exposes functions as endpoints - so a bare
 *  `typeof value === 'function'` cannot tell a per-peer factory from a plain function value. The
 *  marker makes the intent explicit and unambiguous. */
/** @internal */
export const CONTEXT = Symbol.for('osra.context')

export type Contextual<TValue> = {
  [CONTEXT]: (ctx: Context) => TValue
}

/** Build the exposed value once per connection, from that connection's context, rather than sharing
 *  one value across every realm that connects. It runs BEFORE the value is boxed and sent, which is
 *  what lets one server answer each realm differently:
 *
 *  ```ts
 *  expose(context(({ origin }) => resolvers(idFor(origin))), { transport })
 *  ```
 *
 *  A wrapper rather than "pass a function", because osra exposes functions as endpoints, so a bare
 *  `typeof value === 'function'` cannot tell a per-peer factory from a plain function value.
 *
 *  What the read side needs is not declared here: `connection:` sees the same context and derives its
 *  own. */
export const context = <TValue,>(make: (ctx: Context) => TValue): Contextual<TValue> =>
  ({ [CONTEXT]: make })

/** @internal */
export const isContextual = <TValue,>(value: unknown): value is Contextual<TValue> =>
  typeof value === 'object' && value !== null && CONTEXT in value
