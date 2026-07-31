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
  /** what the caller declared about the peer, used when a connection is established without an
   *  inbound message to read (a preset remote uuid) */
  declaredContext: Context
  revivableModules: TModules
  connectionContexts: Map<string, ConnectionContext<TModules>>
  getUuid: () => Uuid
  presetRemoteUuid?: Uuid
  /** targetOrigin overrides the configured origin for this one send - only
   *  the unsolicited announce beacon broadcasts with '*'. */
  sendMessage: (message: MessageVariant, targetOrigin?: string) => void
  protocolEventTarget: ProtocolEventTarget<TModules>
  resolveRemoteValue: (value: Capable<TModules>) => void
  rejectRemoteValue: (error: unknown) => void
  /** reports an established connection, so a caller iterating `peers` sees every realm, not just the
   *  first one that happened to resolve the single remote promise */
  addPeer: (peer: Context, remote: Capable<TModules>) => void
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
  /** Anything the local side already knows about the realm on the other end, merged into what the
   *  transport can observe and handed to the value factory and to `peers`. Not just an origin: a port
   *  transport observes nothing at all, so whoever created it declares whatever identity it learned
   *  when it received the port (an app id, a tier, a scope, whatever the consumer needs). Observed
   *  browser-set fields win over declared ones, so a declaration can never spoof a real origin. */
  context?: Context & Record<string, unknown>
}

/** A peer, once its connection is established: what the local side knows about the realm, plus the
 *  value that realm exposed. */
export type Peer<TRemote, TDeclared = unknown> = Context & TDeclared & { remote: TRemote }

/** The result of `expose`. Awaiting it gives the FIRST peer's value, which is the single-peer case
 *  and what every existing caller does. Iterating it gives every peer as it connects, each with its
 *  own identity, which is what a server embedded by many realms needs. */
/** Awaiting gives the FIRST peer's value, which is the single-peer case and what every existing
 *  caller already does. Iterating gives every peer as it connects, each with its own identity. One
 *  object can be both: `await` goes through `then`, `for await` through Symbol.asyncIterator. */
export type Connections<TRemote, TDeclared = unknown> =
  Promise<TRemote> & AsyncIterable<Peer<TRemote, TDeclared>>

export type PeerQueue<TRemote, TDeclared = unknown> = {
  push: (peer: Peer<TRemote, TDeclared>) => void
  close: () => void
  iterate: () => AsyncIterableIterator<Peer<TRemote, TDeclared>>
}

/** Single-consumer: peers that connect before anything iterates are buffered, and two iterators would
 *  split the stream rather than each see every peer. That matches the shape of the problem, where one
 *  server loop accepts connections. */
export const createPeerQueue = <TRemote, TDeclared = unknown>(): PeerQueue<TRemote, TDeclared> => {
  const buffered: Peer<TRemote, TDeclared>[] = []
  const waiting: ((result: IteratorResult<Peer<TRemote, TDeclared>>) => void)[] = []
  let closed = false
  const done = () => ({ value: undefined as never, done: true as const })
  return {
    push: (peer) => {
      if (closed) return
      const wake = waiting.shift()
      if (wake) wake({ value: peer, done: false })
      else buffered.push(peer)
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
        return new Promise<IteratorResult<Peer<TRemote, TDeclared>>>((resolve) => waiting.push(resolve))
      },
      return: () => Promise.resolve(done()),
    }),
  }
}

/** Assigns onto the existing promise rather than wrapping it, so `then`, `catch` and `finally` stay
 *  exactly what callers already hold. */
export const asConnections = <T, TDeclared = unknown>(
  promise: Promise<T>,
  queue: PeerQueue<T, TDeclared>,
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
