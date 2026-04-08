import type { RevivableContext } from './utils'
export type { UnderlyingType } from './utils'
import type { DeepReplaceWithBox, DeepReplaceWithRevive, ReplaceWithBox, ReplaceWithRevive } from '../utils/replace'
import type { Uuid } from '../types'

import { Capable } from '../types'
import { BoxBase, isRevivableBox } from './utils'
import * as arrayBuffer from './array-buffer'
import * as date from './date'
import * as headers from './headers'
import * as error from './error'
import * as typedArray from './typed-array'
import * as promise from './promise'
import * as func from './function'
import * as messagePort from './message-port'
import * as readableStream from './readable-stream'
import * as abortSignal from './abort-signal'
import * as response from './response'
import * as request from './request'

export * from './utils'
export * as htmlVideoElement from './html-video-element'
export * as eventTarget from './event-target'

export type RevivableModule<T extends string = string, T2 = any, T3 extends BoxBase<T> = any> = {
  readonly type: T
  readonly isType: (value: unknown) => value is T2
  readonly box: ((value: T2, context: RevivableContext) => T3) | ((...args: any[]) => any)
  readonly revive: (value: T3, context: RevivableContext) => T2
  /**
   * Opt out of per-connection identity dedup. Default is `true` — the same
   * reference passed twice produces the same revived value on the other side.
   * Set to `false` for types where dedup has no semantic value and the
   * per-entry bookkeeping overhead would dominate at high churn (eg. stateful
   * single-use types like `MessagePort`, `Promise`, `ReadableStream`).
   */
  readonly identity?: boolean
}

export const defaultRevivableModules = [
  arrayBuffer,
  date,
  headers,
  error,
  typedArray,
  promise,
  func,
  messagePort,
  readableStream,
  abortSignal,
  response,
  request
] as const

export type DefaultRevivableModules = typeof defaultRevivableModules

export type DefaultRevivableModule = DefaultRevivableModules[number]

/**
 * Sentinel `type` for ref-only boxes — payload-less boxes that carry just an
 * identity id. The reviver looks up the cached revived value on this side.
 * Ref-only boxes are emitted when the sender has already sent the same source
 * reference before (full payload + id) and the receiver still has the revived
 * proxy cached.
 */
const IDENTITY_REF = '$ref' as const

/**
 * Wraps `module.box(value, context)` with the per-connection identity layer.
 * If the module opts out of identity (`identity: false`), passthrough. Else,
 * if the same value has already been boxed on this connection, emit a
 * ref-only box. Otherwise, allocate a fresh id, call the module's box, and
 * attach `id` to the result — same shape as a normal box but with one extra
 * field, so V8's hidden-class cache stays stable per module type.
 *
 * Primitive values (anything that can't be a WeakMap key) skip identity.
 */
const boxWithIdentity = <T, T2 extends RevivableContext<readonly RevivableModule[]>>(
  value: T,
  handledByModule: RevivableModule,
  context: T2,
): unknown => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleBox = handledByModule.box as (v: unknown, c: any) => unknown

  // Opt-out: modules like MessagePort, Promise, ReadableStream set
  // `identity: false` because they're stateful single-use types that don't
  // benefit from dedup and would dominate per-iteration overhead at high
  // churn. Check first so the common hot path (opted-out modules) never
  // touches the WeakMap.
  if (handledByModule.identity === false) {
    return moduleBox(value, context)
  }

  const isObjectLike = value !== null && (typeof value === 'object' || typeof value === 'function')
  if (!isObjectLike) {
    return moduleBox(value, context)
  }

  const existingId = context.outgoingValueIds.get(value as object)
  if (existingId !== undefined) {
    return {
      ...BoxBase,
      type: IDENTITY_REF,
      id: existingId,
    }
  }

  const id = globalThis.crypto.randomUUID()
  // Mutate the box in place rather than spreading into a new object — the
  // spread was allocating a fresh object per box, which dominated per-call
  // overhead in tight loops. All built-in modules return freshly-constructed
  // box objects from `moduleBox`, so mutating `.id` on them is safe.
  const boxed = moduleBox(value, context) as Record<string, unknown>
  boxed['id'] = id
  context.outgoingValueIds.set(value as object, id)
  context.outgoingValuesById.set(id, new WeakRef(value as object))
  return boxed
}

/**
 * Slow path: revives a box that carries an identity id. Looks up the cache
 * first (in case this id was already revived on this side); otherwise calls
 * the module's revive, caches the result as a WeakRef, and registers the
 * revived proxy for GC-triggered drop-message cleanup.
 */
const reviveWithIdentity = <T2 extends RevivableContext<readonly RevivableModule[]>>(
  boxed: Record<string, unknown>,
  id: Uuid,
  handledByModule: RevivableModule,
  context: T2,
): unknown => {
  const cached = context.revivedValuesById.get(id)?.deref()
  if (cached) return cached

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleRevive = handledByModule.revive as (v: unknown, c: any) => unknown
  const revived = moduleRevive(boxed, context)

  if (revived !== null && (typeof revived === 'object' || typeof revived === 'function')) {
    context.revivedValuesById.set(id, new WeakRef(revived as object))
    context.revivableCleanupRegistry.register(revived as object, id, revived as object)
  }
  return revived
}

/**
 * Slow path: ref-only box. Looks up the cached revived value by id; throws
 * if missing.
 */
const reviveIdentityRef = <T2 extends RevivableContext<readonly RevivableModule[]>>(
  envelope: Record<string, unknown>,
  context: T2,
): unknown => {
  const id = envelope['id'] as Uuid
  const cached = context.revivedValuesById.get(id)?.deref()
  if (cached) return cached
  throw new Error(
    `osra: ref-only box for id ${id} has no cached revived value on this side. ` +
    `Possible race between a revivable-drop GC notification and a concurrent re-box.`,
  )
}

export const findModuleForValue = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return boxWithIdentity(value, handledByModule, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const box = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): ReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithBox<T, T2['revivableModules'][number]>
  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return boxWithIdentity(value, handledByModule, context) as ReturnCastType
  }
  return value as ReturnCastType
}

export const recursiveBox = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): DeepReplaceWithBox<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithBox<T, T2['revivableModules'][number]>

  const handledByModule = context.revivableModules.find(module => module.isType(value))
  if (handledByModule?.isType(value)) {
    return boxWithIdentity(value, handledByModule, context) as ReturnCastType
  }

  return (
    Array.isArray(value) ? value.map(value => recursiveBox(value, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveBox(value, context)
          ])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}

export const revive = <
  T extends ReturnType<typeof box>,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): ReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = ReplaceWithRevive<T, T2['revivableModules'][number]>
  if (!isRevivableBox(value, context)) return value as ReturnCastType
  const boxType = value.type
  if (boxType === IDENTITY_REF) {
    return reviveIdentityRef(value as unknown as Record<string, unknown>, context) as ReturnCastType
  }
  const handledByModule = context.revivableModules.find(module => module.type === boxType)
  if (!handledByModule) return value as ReturnCastType
  // Modules that opt out of identity take the direct delegation path. The
  // `identity === false` check is against a constant per module type, so V8
  // can specialize the call site after a warmup.
  if (handledByModule.identity === false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (handledByModule.revive as (v: unknown, c: any) => unknown)(value, context) as ReturnCastType
  }
  // Identity-carrying boxes have an `id` field alongside the module payload.
  const id = (value as unknown as Record<string, unknown>)['id'] as Uuid
  return reviveWithIdentity(value as unknown as Record<string, unknown>, id, handledByModule, context) as ReturnCastType
}

export const recursiveRevive = <
  T extends Capable,
  T2 extends RevivableContext<readonly RevivableModule[]>
>(
  value: T,
  context: T2
): DeepReplaceWithRevive<T, T2['revivableModules'][number]> => {
  type ReturnCastType = DeepReplaceWithRevive<T, T2['revivableModules'][number]>

  // First check if the value is a revivable box and revive it
  if (isRevivableBox(value, context)) {
    const boxType = value.type
    if (boxType === IDENTITY_REF) {
      return reviveIdentityRef(value as unknown as Record<string, unknown>, context) as ReturnCastType
    }
    const handledByModule = context.revivableModules.find(module => module.type === boxType)
    if (handledByModule) {
      // Modules that opt out of identity take the direct delegation path.
      if (handledByModule.identity === false) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (handledByModule.revive as (v: unknown, c: any) => unknown)(value, context) as ReturnCastType
      }
      const id = (value as unknown as Record<string, unknown>)['id'] as Uuid
      return reviveWithIdentity(value as unknown as Record<string, unknown>, id, handledByModule, context) as ReturnCastType
    }
  }

  // Then recurse into arrays and plain objects
  return (
    Array.isArray(value) ? value.map(value => recursiveRevive(value, context)) as ReturnCastType
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? (
      Object.fromEntries(
        Object
          .entries(value)
          .map(([key, value]: [string, Capable]) => [
            key,
            recursiveRevive(value, context)
          ])
      )
    ) as ReturnCastType
    : value as ReturnCastType
  )
}
