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
  /** the caller's declared values for a connection established without an inbound message to read (a
   *  preset remote uuid), where nothing was observed. A getter: building it eagerly would run the
   *  caller's builder on every expose, including the paths that never need it, and a builder that
   *  throws would then throw synchronously out of expose */
  declaredContext: () => Context
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
  /** Builds the custom values on every connection's context, from THIS side's knowledge only. Never
   *  from anything the peer sends: nothing here is transmitted, and nothing in the peer's payload can
   *  reach it. That is the whole point of the option, so it is worth restating at every call site.
   *
   *  Two local sources feed it. What the transport observed, which is browser-set and so cannot be
   *  forged: a window message carries `origin` and `source`, a MessagePort carries neither. And
   *  whatever this side already knew, which is the only option for a port, since the side that
   *  received the port learned the identity from the trustworthy window message that delivered it.
   *
   *  Always a function, receiving what was observed. Fixed values are just a function that ignores
   *  its input, so there is one shape rather than two:
   *
   *  ```ts
   *  expose(context(ctx => resolvers(ctx)), {
   *    transport,
   *    context: ({ origin }) => ({ appId: appIdFor(origin) }),
   *  })
   *  ```
   *
   *  Observed browser-set fields win over declared ones, so a declaration can never overwrite a real
   *  origin with a made-up one. */
  context?: ContextBuilder
}

/** An established connection: what this side knows about the realm on the other end, plus the value
 *  that realm exposed. Awaiting `.connections` and iterating it both hand back this same shape, so
 *  reading one connection and reading many is the same destructure. */
export type Connection<TValue, TDeclared = unknown> = Context & TDeclared & { value: TValue }

/** The connection view of `expose`. Awaiting it gives the FIRST peer, iterating it gives every peer as
 *  it connects, and both carry that peer's identity and its own `abort`. */
export type Connections<TValue, TDeclared = unknown> =
  Promise<Connection<TValue, TDeclared>> & AsyncIterable<Connection<TValue, TDeclared>>

/** The result of `expose`. Awaiting it gives the first peer's value and iterating it gives every
 *  peer's value, so the plain read is the same shape either way and unchanged from before connections
 *  existed. `.connections` is the same two reads wrapped in the peer's identity.
 *
 *  The choice sits at the point of use rather than in the options, so the shape a line produces is
 *  visible in that line instead of depending on how the expose was configured somewhere else. */
export type Exposed<TValue, TDeclared = unknown> =
  Promise<TValue>
  & AsyncIterable<TValue>
  & { connections: Connections<TValue, TDeclared> }

export type ConnectionQueue<TRemote, TDeclared = unknown> = {
  push: (connection: Connection<TRemote, TDeclared>) => void
  close: () => void
  iterate: () => AsyncIterableIterator<Connection<TRemote, TDeclared>>
}

/** Multicast: every iterator sees every peer. The value view and the connection view are two reads of
 *  one stream, so a shared cursor would let `for await (const v of exposed)` silently eat peers that
 *  `for await (const c of exposed.connections)` was waiting for. Independent cursors also make the
 *  ordinary "two loops watching the same server" case behave the way it reads. */
/** Until someone asks to iterate, a connection is buffered only up to this many. Every consumer that
 *  just awaits the first connection would otherwise retain every later one for the transport's life,
 *  each pinning a Remote proxy and a window or MessagePort. Buffering a few keeps the ordinary
 *  "expose now, iterate on the next tick" case lossless; a consumer that never iterates cannot leak. */
const PRE_ITERATION_BUFFER = 32

/** @internal protocol plumbing, not part of the public api */
export const createConnectionQueue = <TRemote, TDeclared = unknown>(): ConnectionQueue<TRemote, TDeclared> => {
  type Result = IteratorResult<Connection<TRemote, TDeclared>>
  type Subscriber = { buffered: Connection<TRemote, TDeclared>[], wake?: (result: Result) => void }
  // Replayed to every iterator that starts later, so `expose` then iterate on a subsequent tick is
  // lossless for the value view and the connection view alike. Copied rather than drained: draining
  // would let whichever view iterated first decide what the other one never sees.
  const early: Connection<TRemote, TDeclared>[] = []
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

/** Assigns onto the existing promise rather than wrapping it, so `then`, `catch` and `finally` stay
 *  exactly what callers already hold. */
/** @internal MUTATES its argument; not part of the public api */
export const asConnections = <T, TDeclared = unknown>(
  promise: Promise<Connection<T, TDeclared>>,
  queue: ConnectionQueue<T, TDeclared>,
): Connections<T, TDeclared> =>
  Object.assign(promise, {
    [Symbol.asyncIterator]: () => queue.iterate(),
  }) as Connections<T, TDeclared>

/** The value view, with the connection view hanging off it. The value promise is DERIVED from the
 *  connection promise, so it needs its own no-op catch: a fire-and-forget `expose(...)` handles the
 *  original, and an unhandled derived rejection would still reach the console. */
/** @internal not part of the public api */
export const asExposed = <T, TDeclared = unknown>(
  connections: Connections<T, TDeclared>,
  queue: ConnectionQueue<T, TDeclared>,
): Exposed<T, TDeclared> => {
  const value = connections.then(connection => connection.value)
  value.catch(() => {})
  return Object.assign(value, {
    connections,
    [Symbol.asyncIterator]: async function* () {
      for await (const connection of { [Symbol.asyncIterator]: () => queue.iterate() }) yield connection.value
    },
  }) as Exposed<T, TDeclared>
}

/** An exposed value can itself be a function - osra exposes functions as endpoints - so a bare
 *  `typeof value === 'function'` cannot tell a per-peer factory from a plain function value. The
 *  marker makes the intent explicit and unambiguous. */
/** @internal */
export const CONTEXT = Symbol.for('osra.context')
/** @internal */
export const CONTEXT_BUILD = Symbol.for('osra.context.build')

/** Custom values a builder puts on the context, on top of what the transport observed. */
export type ContextBuilder = (observed: Context) => Record<string, unknown>

/** The context a given builder produces: what it returns, plus what osra observes locally. Exported
 *  so a builder defined elsewhere can type a resolver signature: `(ctx: ContextOf<typeof build>)`. */
export type ContextOf<TBuild> = TBuild extends (observed: Context) => infer R ? Context & R : Context

export type Contextual<TValue, TBuild extends ContextBuilder = ContextBuilder> = {
  [CONTEXT]: (ctx: Context & Record<string, unknown>) => TValue
  [CONTEXT_BUILD]?: TBuild
}

/** Build the exposed value once per connection, from that connection's context, rather than sharing
 *  one value across every realm that connects.
 *
 *  Optionally pass a context builder second, and `ctx` is inferred exactly from it, with no type
 *  argument to write and no separate `context:` option to keep in sync:
 *
 *  ```ts
 *  expose(
 *    context(ctx => resolvers(ctx.appId), ({ origin }) => ({ appId: appIdFor(origin) })),
 *    { transport },
 *  )
 *  ```
 *
 *  Without it, `ctx` is only known to carry unknowns: the values then come from the `context:`
 *  option, which is a separate call site TypeScript cannot link to this one. */
export function context<TBuild extends ContextBuilder, TValue>(
  make: (ctx: ContextOf<TBuild>) => TValue,
  build: TBuild,
): Contextual<TValue, TBuild>
export function context<TValue>(
  make: (ctx: Context & Record<string, unknown>) => TValue,
): Contextual<TValue>
export function context(
  make: (ctx: never) => unknown,
  build?: ContextBuilder,
): Contextual<unknown> {
  const value = { [CONTEXT]: make as (ctx: Context & Record<string, unknown>) => unknown }
  return build ? { ...value, [CONTEXT_BUILD]: build } : value
}

/** @internal */
export const isContextual = <TValue,>(value: unknown): value is Contextual<TValue> =>
  typeof value === 'object' && value !== null && CONTEXT in value
