import type { Capable, Message, Uuid } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'identity' as const

export type Messages =
  | { type: 'identity-dispose'; remoteUuid: Uuid; id: string }

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
  isObjectOrFunction(value) &&
  (value as Record<PropertyKey, unknown>)[IDENTITY_MARKER] === true

const wrapperMemo = new WeakMap<object, IdentityWrapper>()

/**
 * Wrap a value so that osra preserves its reference identity across the
 * RPC boundary, per connection. Calling identity(X) twice on the same
 * value produces the same wrapper, and both wrapper sends resolve to the
 * same revived reference on the remote side.
 *
 * - Primitives pass through unchanged (there is no identity to preserve).
 * - Already-wrapped values pass through unchanged (idempotent).
 */
export const identity = <T>(value: T): T => {
  if (!isObjectOrFunction(value)) return value
  if (isIdentityWrapper(value)) return value as unknown as T
  const cached = wrapperMemo.get(value)
  if (cached) return cached as unknown as T
  const wrapper: IdentityWrapper<T> = {
    [IDENTITY_MARKER]: true,
    value,
  }
  wrapperMemo.set(value, wrapper)
  return wrapper as unknown as T
}

/**
 * Per-connection state for the identity revivable. Stored in a module-level
 * WeakMap so the connection's RevivableContext acts as the key — when the
 * connection ends and the context is collected, the state goes with it.
 */
type IdentityState = {
  /** Send side: inner value → stable id for this connection. */
  readonly sendIds: WeakMap<object, string>
  /** Send side: FinalizationRegistry firing when an inner value is GC'd. */
  readonly sendRegistry: FinalizationRegistry<string>
  /** Receive side: id → revived value (strong ref, explicit cleanup). */
  readonly receiveCache: Map<string, unknown>
  /** True once the eventTarget listener has been installed. */
  listenerInstalled: boolean
}

const connectionStates = new WeakMap<RevivableContext, IdentityState>()

const getOrCreateState = (context: RevivableContext): IdentityState => {
  const existing = connectionStates.get(context)
  if (existing) return existing
  const state: IdentityState = {
    sendIds: new WeakMap(),
    sendRegistry: new FinalizationRegistry<string>((id) => {
      // Sender-side inner value was collected. Tell the receiver to drop
      // its cached revived value so both sides converge. If the transport
      // has already been torn down, swallow the error.
      try {
        context.sendMessage({
          type: 'identity-dispose',
          remoteUuid: context.remoteUuid,
          id,
        })
      } catch { /* connection already closed */ }
    }),
    receiveCache: new Map(),
    listenerInstalled: false,
  }
  connectionStates.set(context, state)
  installReceiveListener(context, state)
  return state
}

const installReceiveListener = (context: RevivableContext, state: IdentityState) => {
  if (state.listenerInstalled) return
  state.listenerInstalled = true
  context.eventTarget.addEventListener('message', (event) => {
    const detail = (event as CustomEvent<Message>).detail
    if (detail?.type === 'identity-dispose') {
      state.receiveCache.delete(detail.id)
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
      } as unknown as BoxedIdentity<T>
    }
  }
  const id = globalThis.crypto.randomUUID()
  const innerBox = recursiveBox(inner, context)
  if (key !== undefined) {
    state.sendIds.set(key, id)
    state.sendRegistry.register(key, id)
  }
  return {
    ...BoxBase,
    type,
    id,
    inner: innerBox,
  } as unknown as BoxedIdentity<T>
}

export const revive = <T extends BoxedIdentity, TContext extends RevivableContext>(
  value: T,
  context: TContext,
): T[UnderlyingType] => {
  const state = getOrCreateState(context)
  const cached = state.receiveCache.get(value.id)
  if (cached !== undefined) return cached as T[UnderlyingType]
  if (!('inner' in value) || value.inner === undefined) {
    throw new Error(
      `osra identity: received id=${value.id} with no inner payload and no cached value`,
    )
  }
  const revived = recursiveRevive(value.inner, context)
  state.receiveCache.set(value.id, revived)
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
