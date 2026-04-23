import type { Capable, Message, Uuid } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'identity' as const

export type Messages = {
  type: 'identity-dispose'
  remoteUuid: Uuid
  /** id of the identity-wrapped value that was collected */
  id: string
}

export declare const Messages: Messages

const IDENTITY_MARKER: unique symbol = Symbol.for('osra.identity')

type IdentityWrapper<T = unknown> = {
  readonly [IDENTITY_MARKER]: true
  readonly value: T
}

export type BoxedIdentity<T extends Capable = Capable> = BoxBaseType<typeof type> & {
  id: string
  inner?: Capable
  [UnderlyingType]: T
}

const isObjectOrFunction = (value: unknown): value is object =>
  value !== null && (typeof value === 'object' || typeof value === 'function')

const isIdentityWrapper = (value: unknown): value is IdentityWrapper =>
  isObjectOrFunction(value) && IDENTITY_MARKER in value && value[IDENTITY_MARKER] === true

const wrapperMemo = new WeakMap<object, IdentityWrapper>()

const wrap = (value: object): IdentityWrapper => {
  if (isIdentityWrapper(value)) return value
  const cached = wrapperMemo.get(value)
  if (cached) return cached
  const wrapper: IdentityWrapper = { [IDENTITY_MARKER]: true, value }
  wrapperMemo.set(value, wrapper)
  return wrapper
}

/**
 * Wrap a value so that osra preserves its reference identity across the
 * RPC boundary, per connection. Calling identity(X) twice on the same
 * value produces the same wrapper, and both wrapper sends resolve to the
 * same revived reference on the remote side.
 *
 * - Primitives pass through unchanged (there is no identity to preserve).
 * - Already-wrapped values pass through unchanged (idempotent).
 *
 * NOTE: This lies at the type level — the runtime value for object/function
 * inputs is an IdentityWrapper<T>, typed as T so the user's surrounding
 * code stays unchanged. The box-site unwraps it.
 */
export const identity = <T>(value: T): T =>
  (isObjectOrFunction(value) ? wrap(value) : value) as T

/**
 * Per-connection state for the identity revivable. Stored in a module-level
 * WeakMap so the connection's RevivableContext acts as the key — when the
 * connection ends and the context is collected, the state goes with it.
 */
type IdentityState = {
  /** Send side: inner value → stable id for this connection. */
  readonly sendIds: WeakMap<object, string>
  /** Send side: id → weak ref to the value we originally sent. Lets a later
   *  receive of our own id (round-trip: we sent, the peer sent it back)
   *  resolve to the original reference instead of building a fresh proxy. */
  readonly idToSent: Map<string, WeakRef<object>>
  /** Send side: FinalizationRegistry firing when an inner value is GC'd. */
  readonly sendRegistry: FinalizationRegistry<string>
  /** Receive side: id → revived value (strong ref, explicit cleanup). */
  readonly receiveCache: Map<string, unknown>
  /** Receive side: revived value → id. Lets us detect when user code passes
   *  a revived value back to its origin, so we can replay the original id
   *  and the origin's revive can short-circuit to the real reference. */
  readonly revivedToId: WeakMap<object, string>
  /** True once the eventTarget listener has been installed. */
  listenerInstalled: boolean
}

const connectionStates = new WeakMap<RevivableContext, IdentityState>()

const getOrCreateState = (context: RevivableContext): IdentityState => {
  const existing = connectionStates.get(context)
  if (existing) return existing
  // Construct the maps as locals first so the FinalizationRegistry callback
  // can close over them without a forward reference to `state` itself.
  const sendIds = new WeakMap<object, string>()
  const idToSent = new Map<string, WeakRef<object>>()
  const receiveCache = new Map<string, unknown>()
  const revivedToId = new WeakMap<object, string>()
  const sendRegistry = new FinalizationRegistry<string>((id) => {
    // Sender-side inner value was collected. Drop our send-side id record
    // (the WeakRef is already dead; keeping it would leak Map entries) and
    // tell the receiver to drop its cached revived value so both sides
    // converge. If the transport has already been torn down, swallow.
    idToSent.delete(id)
    try {
      context.sendMessage({
        type: 'identity-dispose',
        remoteUuid: context.remoteUuid,
        id,
      })
    } catch { /* connection already closed */ }
  })
  const state: IdentityState = {
    sendIds,
    idToSent,
    sendRegistry,
    receiveCache,
    revivedToId,
    listenerInstalled: false,
  }
  connectionStates.set(context, state)
  installReceiveListener(context, state)
  return state
}

const installReceiveListener = (context: RevivableContext, state: IdentityState) => {
  if (state.listenerInstalled) return
  state.listenerInstalled = true
  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail?.type === 'identity-dispose') {
      const revived = state.receiveCache.get(detail.id)
      state.receiveCache.delete(detail.id)
      if (revived !== undefined && isObjectOrFunction(revived)) {
        state.revivedToId.delete(revived)
      }
    }
  })
}

export const isType = (value: unknown): value is IdentityWrapper =>
  isIdentityWrapper(value)

export const box = <T extends Capable, TContext extends RevivableContext>(
  wrapper: IdentityWrapper<T>,
  context: TContext,
): BoxedIdentity<T> => {
  const state = getOrCreateState(context)
  const inner = wrapper.value
  const key = isObjectOrFunction(inner) ? inner : undefined
  if (key !== undefined) {
    const existingId = state.sendIds.get(key)
    if (existingId !== undefined) {
      // Subsequent send for this value on this connection: skip the inner
      // box entirely so the receiver resolves through its cache.
      return {
        ...BoxBase,
        type,
        id: existingId,
      } as BoxedIdentity<T>
    }
    const receivedId = state.revivedToId.get(key)
    if (receivedId !== undefined) {
      // Round-trip: user is handing us a value we originally revived from
      // the peer on this connection. Replay the peer's id so the peer's
      // revive resolves to its original reference (the one it first sent).
      return {
        ...BoxBase,
        type,
        id: receivedId,
      } as BoxedIdentity<T>
    }
  }
  const id = globalThis.crypto.randomUUID()
  const innerBox = recursiveBox(inner, context)
  if (key !== undefined) {
    state.sendIds.set(key, id)
    state.idToSent.set(id, new WeakRef(key))
    state.sendRegistry.register(key, id)
  }
  return {
    ...BoxBase,
    type,
    id,
    inner: innerBox,
  } as BoxedIdentity<T>
}

export const revive = <T extends BoxedIdentity, TContext extends RevivableContext>(
  value: T,
  context: TContext,
): T[UnderlyingType] => {
  const state = getOrCreateState(context)
  const cached = state.receiveCache.get(value.id)
  if (cached !== undefined) return cached as T[UnderlyingType]
  // The id may be one we originally sent — the peer is handing it back
  // (directly, or after arbitrary forwarding). Resolve to the original
  // reference instead of building a fresh proxy on top of one.
  const originated = state.idToSent.get(value.id)?.deref()
  if (originated !== undefined) return originated as T[UnderlyingType]
  if (!('inner' in value) || value.inner === undefined) {
    throw new Error(
      `osra identity: received id=${value.id} with no inner payload and no cached value`,
    )
  }
  const revived = recursiveRevive(value.inner, context)
  state.receiveCache.set(value.id, revived)
  if (isObjectOrFunction(revived)) {
    state.revivedToId.set(revived, value.id)
  }
  return revived as T[UnderlyingType]
}

const typeCheck = () => {
  const fn = () => 42
  const wrapper = { [IDENTITY_MARKER]: true, value: fn } as IdentityWrapper<typeof fn>
  const boxed = box(wrapper, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  // Revive recovers the original function type via the UnderlyingType phantom.
  const expected: typeof fn = revived
  // @ts-expect-error - revived is the original function type, not string
  const notExpected: string = revived
  // @ts-expect-error - cannot box a non-Capable wrapper (Symbol not assignable)
  box({ [IDENTITY_MARKER]: true, value: Symbol() } as IdentityWrapper<symbol>, {} as RevivableContext)
}
