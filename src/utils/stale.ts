import type { Capable } from '../types'
import type { RevivableContext } from '../revivables/utils'

import { onAbort } from './transport'

type Ctx = RevivableContext<any>
// Capable narrowed to things that can be WeakMap/WeakSet keys — i.e.,
// excludes the primitive arms (string/number/boolean/null/undefined/bigint).
type Revivable = Extract<Capable, object>

const terminalStaleSet = new WeakSet<Revivable>()

const STALE_PORT_KEY = Symbol('osra.stalePort')
const STALE_CTX_KEY = Symbol('osra.staleCtx')
type PortBearer = { [STALE_PORT_KEY]?: Revivable }
type CtxBearer = { [STALE_CTX_KEY]?: Ctx }
const valueToPortFallback = new WeakMap<Revivable, Revivable>()
const portToConnFallback = new WeakMap<Revivable, Ctx>()

const portControllers = new WeakMap<Revivable, AbortController>()
const ctxControllers = new WeakMap<Ctx, AbortController>()

const isRevivable = (value: unknown): value is Revivable =>
  value !== null && (typeof value === 'object' || typeof value === 'function')

const getValuePort = (value: Revivable): Revivable | undefined =>
  (value as PortBearer)[STALE_PORT_KEY] ?? valueToPortFallback.get(value)

const getPortCtx = (port: Revivable): Ctx | undefined =>
  (port as CtxBearer)[STALE_CTX_KEY] ?? portToConnFallback.get(port)

const ensurePortController = (port: Revivable): AbortController => {
  let c = portControllers.get(port)
  if (!c) { c = new AbortController(); portControllers.set(port, c) }
  return c
}

const ensureCtxController = (ctx: Ctx): AbortController => {
  let c = ctxControllers.get(ctx)
  if (!c) { c = new AbortController(); ctxControllers.set(ctx, c) }
  return c
}

export const associatePort = (value: Revivable, port: Revivable, ctx: Ctx): void => {
  if (!ctx.revivingHandshake) return
  if (getValuePort(value) === undefined) {
    try { (value as PortBearer)[STALE_PORT_KEY] = port }
    catch { valueToPortFallback.set(value, port) }
  }
  if (getPortCtx(port) === undefined) {
    try { (port as CtxBearer)[STALE_CTX_KEY] = ctx }
    catch { portToConnFallback.set(port, ctx) }
    if ('_onClose' in port) {
      const prev = (port as { _onClose?: () => void })._onClose
      ;(port as { _onClose?: () => void })._onClose = () => { markPortStale(port); prev?.() }
    }
  }
}

export const inheritPort = (parent: Revivable, child: Revivable, ctx: Ctx): void => {
  const port = getValuePort(child)
  if (port) associatePort(parent, port, ctx)
}

export const markTerminalStale = (value: Revivable): void => {
  terminalStaleSet.add(value)
}

export const markPortStale = (port: Revivable): void => {
  if (getPortCtx(port) === undefined) return
  ensurePortController(port).abort()
}

export const markConnStale = (ctx: Ctx): void => {
  ensureCtxController(ctx).abort()
}

export const connStaleSignal = (ctx: Ctx): AbortSignal =>
  ensureCtxController(ctx).signal

export const isStale = (value: unknown): boolean => {
  if (!isRevivable(value)) return false
  if (terminalStaleSet.has(value)) return true
  const port = getValuePort(value)
  if (!port) return false
  if (portControllers.get(port)?.signal.aborted) return true
  const ctx = getPortCtx(port)
  return !!(ctx && ctxControllers.get(ctx)?.signal.aborted)
}

const NEVER: Promise<void> = new Promise(() => {})

const signalPromiseCache = new WeakMap<AbortSignal, Promise<void>>()
const signalToPromise = (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.resolve()
  let p = signalPromiseCache.get(signal)
  if (!p) {
    p = new Promise<void>((r) => onAbort(signal, r as () => void))
    signalPromiseCache.set(signal, p)
  }
  return p
}

const onStaleCache = new WeakMap<Revivable, Promise<void>>()
export const onStale = (value: unknown): Promise<void> => {
  if (!isRevivable(value)) return NEVER
  if (terminalStaleSet.has(value)) return Promise.resolve()
  const port = getValuePort(value)
  if (!port) return NEVER
  let combined = onStaleCache.get(port)
  if (!combined) {
    const portPromise = signalToPromise(ensurePortController(port).signal)
    const ctx = getPortCtx(port)
    combined = ctx
      ? Promise.race([portPromise, signalToPromise(ensureCtxController(ctx).signal)])
      : portPromise
    onStaleCache.set(port, combined)
  }
  return combined
}
