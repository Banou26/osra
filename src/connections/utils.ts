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
  message: CustomEvent<{ message: Message<TModules>, peer: Context }>
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
  /** the caller's declared values, resolved for a connection established without an inbound message
   *  to read (a preset remote uuid), where nothing was observed */
  declaredContext: Context
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
  /** Custom values to put on every connection's context. Named `local` because that is the whole
   *  point: a connection's context is built from THIS side's knowledge, never from anything the peer
   *  sends. Nothing here is transmitted, and nothing in the peer's payload can reach it.
   *
   *  Two local sources feed it. What the transport observed, which is browser-set and so cannot be
   *  forged: a window message carries `origin` and `source`, a MessagePort carries neither. And
   *  whatever this side already knew, which is the only option for a port, since the side that
   *  received the port learned the identity from the trustworthy window message that delivered it.
   *
   *  Pass an object for fixed values, or a function to derive them from what was observed:
   *
   *  ```ts
   *  expose(context(ctx => resolvers(ctx)), {
   *    transport,
   *    localContext: ({ origin }) => ({ appId: appIdFor(origin) }),
   *  })
   *  ```
   *
   *  Observed browser-set fields win over declared ones, so a declaration can never overwrite a real
   *  origin with a made-up one. */
  localContext?:
    | (Context & Record<string, unknown>)
    | ((observed: Context) => Context & Record<string, unknown>)
}

/** An established connection: what this side knows about the realm on the other end, plus the value
 *  that realm exposed. Awaiting `expose` and iterating it both hand back this same shape, so reading
 *  one connection and reading many is the same destructure. */
export type Connection<TValue, TDeclared = unknown> = Context & TDeclared & { value: TValue }

/** The result of `expose`. Awaiting it gives the FIRST peer's value, which is the single-peer case
 *  and what every existing caller does. Iterating it gives every peer as it connects, each with its
 *  own identity, which is what a server embedded by many realms needs. */
/** Awaiting gives the FIRST peer's value, which is the single-peer case and what every existing
 *  caller already does. Iterating gives every peer as it connects, each with its own identity. One
 *  object can be both: `await` goes through `then`, `for await` through Symbol.asyncIterator. */
export type Connections<TValue, TDeclared = unknown> =
  Promise<Connection<TValue, TDeclared>> & AsyncIterable<Connection<TValue, TDeclared>>

export type ConnectionQueue<TRemote, TDeclared = unknown> = {
  push: (connection: Connection<TRemote, TDeclared>) => void
  close: () => void
  iterate: () => AsyncIterableIterator<Connection<TRemote, TDeclared>>
}

/** Single-consumer: peers that connect before anything iterates are buffered, and two iterators would
 *  split the stream rather than each see every peer. That matches the shape of the problem, where one
 *  server loop accepts connections. */
export const createConnectionQueue = <TRemote, TDeclared = unknown>(): ConnectionQueue<TRemote, TDeclared> => {
  const buffered: Connection<TRemote, TDeclared>[] = []
  const waiting: ((result: IteratorResult<Connection<TRemote, TDeclared>>) => void)[] = []
  let closed = false
  const done = () => ({ value: undefined as never, done: true as const })
  return {
    push: (connection) => {
      if (closed) return
      const wake = waiting.shift()
      if (wake) wake({ value: connection, done: false })
      else buffered.push(connection)
    },
    close: () => {
      closed = true
      for (const wake of waiting.splice(0)) wake(done())
    },
    iterate: () => ({
      [Symbol.asyncIterator]() { return this },
      next: () => {
        const next = buffered.shift()
        if (next) return Promise.resolve({ value: next, done: false as const })
        if (closed) return Promise.resolve(done())
        return new Promise<IteratorResult<Connection<TRemote, TDeclared>>>((resolve) => waiting.push(resolve))
      },
      return: () => Promise.resolve(done()),
    }),
  }
}

/** Assigns onto the existing promise rather than wrapping it, so `then`, `catch` and `finally` stay
 *  exactly what callers already hold. */
export const asConnections = <T, TDeclared = unknown>(
  promise: Promise<Connection<T, TDeclared>>,
  queue: ConnectionQueue<T, TDeclared>,
): Connections<T, TDeclared> =>
  Object.assign(promise, {
    [Symbol.asyncIterator]: () => queue.iterate(),
  }) as Connections<T, TDeclared>

/** An exposed value can itself be a function - osra exposes functions as endpoints - so a bare
 *  `typeof value === 'function'` cannot tell a per-peer factory from a plain function value. The
 *  marker makes the intent explicit and unambiguous. */
export const CONTEXT = Symbol.for('osra.context')

export type Contextual<TValue> = { [CONTEXT]: (ctx: Context & Record<string, unknown>) => TValue }

/** Build the exposed value once per connection, from that connection's context, rather than sharing
 *  one value across every realm that connects. */
export const context = <TValue,>(
  build: (ctx: Context & Record<string, unknown>) => TValue,
): Contextual<TValue> => ({ [CONTEXT]: build })

export const isContextual = <TValue,>(value: unknown): value is Contextual<TValue> =>
  typeof value === 'object' && value !== null && CONTEXT in value
