import type { Capable, Uuid } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'identity' as const

export type Messages = {
  type: 'identity-dispose'
  remoteUuid: Uuid
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

/** Wrap a value so osra preserves reference identity across the RPC
 *  boundary. Idempotent; primitives pass through unchanged. Lies at the
 *  type level — runtime value is an IdentityWrapper<T> typed as T. */
export const identity = <T>(value: T): T =>
  (isObjectOrFunction(value) ? wrap(value) : value) as T

type IdentityState = {
  readonly sendIds: WeakMap<object, string>
  /** id → ref to the value we sent, so a round-trip resolves to the
   *  original reference instead of building a fresh proxy. */
  readonly idToSent: Map<string, WeakRef<object>>
  readonly sendRegistry: FinalizationRegistry<string>
  readonly receiveCache: Map<string, unknown>
  /** Revived value → id, so user code passing a revived value back to
   *  its origin replays the peer's id and short-circuits to the real ref. */
  readonly revivedToId: WeakMap<object, string>
  listenerInstalled: boolean
}

const connectionStates = new WeakMap<RevivableContext, IdentityState>()

const getOrCreateState = (context: RevivableContext): IdentityState => {
  const existing = connectionStates.get(context)
  if (existing) return existing
  const sendIds = new WeakMap<object, string>()
  const idToSent = new Map<string, WeakRef<object>>()
  const receiveCache = new Map<string, unknown>()
  const revivedToId = new WeakMap<object, string>()
  const sendRegistry = new FinalizationRegistry<string>((id) => {
    idToSent.delete(id)
    try {
      context.sendMessage({ type: 'identity-dispose', remoteUuid: context.remoteUuid, id })
    } catch { /* connection already closed */ }
  })
  const state: IdentityState = {
    sendIds, idToSent, sendRegistry, receiveCache, revivedToId,
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
    if (detail?.type !== 'identity-dispose') return
    const revived = state.receiveCache.get(detail.id)
    state.receiveCache.delete(detail.id)
    if (revived !== undefined && isObjectOrFunction(revived)) state.revivedToId.delete(revived)
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
      return { ...BoxBase, type, id: existingId } as BoxedIdentity<T>
    }
    const receivedId = state.revivedToId.get(key)
    if (receivedId !== undefined) {
      return { ...BoxBase, type, id: receivedId } as BoxedIdentity<T>
    }
  }
  const id = globalThis.crypto.randomUUID()
  const innerBox = recursiveBox(inner, context)
  if (key !== undefined) {
    state.sendIds.set(key, id)
    state.idToSent.set(id, new WeakRef(key))
    state.sendRegistry.register(key, id)
  }
  return { ...BoxBase, type, id, inner: innerBox } as BoxedIdentity<T>
}

export const revive = <T extends BoxedIdentity, TContext extends RevivableContext>(
  value: T,
  context: TContext,
): T[UnderlyingType] => {
  const state = getOrCreateState(context)
  const cached = state.receiveCache.get(value.id)
  if (cached !== undefined) return cached as T[UnderlyingType]
  const originated = state.idToSent.get(value.id)?.deref()
  if (originated !== undefined) return originated as T[UnderlyingType]
  if (!('inner' in value) || value.inner === undefined) {
    throw new Error(`osra identity: received id=${value.id} with no inner payload and no cached value`)
  }
  const revived = recursiveRevive(value.inner, context)
  state.receiveCache.set(value.id, revived)
  if (isObjectOrFunction(revived)) state.revivedToId.set(revived, value.id)
  return revived as T[UnderlyingType]
}

const typeCheck = () => {
  const fn = () => 42
  const wrapper = { [IDENTITY_MARKER]: true, value: fn } as IdentityWrapper<typeof fn>
  const boxed = box(wrapper, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: typeof fn = revived
  // @ts-expect-error - revived is the original function type, not string
  const notExpected: string = revived
  // @ts-expect-error - cannot box a non-Capable wrapper (WeakMap not assignable)
  box({ [IDENTITY_MARKER]: true, value: new WeakMap() } as IdentityWrapper<WeakMap<object, string>>, {} as RevivableContext)
}
