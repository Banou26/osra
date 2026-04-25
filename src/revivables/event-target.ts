import { BoxBase, type RevivableContext } from './utils'
import { identity } from './identity'
import { box as boxFunction, revive as reviveFunction } from './function'

export const type = 'eventTarget' as const

type ListenerOpts = boolean | { capture?: boolean, once?: boolean, passive?: boolean, signal?: AbortSignal }
type ListenerRpc = (eventType: string, listener: EventListener, options?: ListenerOpts) => void

export const isType = (value: unknown): value is EventTarget => value instanceof EventTarget

export const box = <T extends EventTarget, T2 extends RevivableContext>(value: T, context: T2) => ({
  ...BoxBase,
  type,
  addListener: boxFunction(
    (type: string, listener: EventListener, options?: ListenerOpts) =>
      value.addEventListener(type, listener, options),
    context,
  ),
  removeListener: boxFunction(
    (type: string, listener: EventListener, options?: ListenerOpts) =>
      value.removeEventListener(type, listener, options),
    context,
  ),
})

export type BoxedEventTarget = ReturnType<typeof box>

// Stable EventListener per EventListenerObject so identity yields the same
// id on add and remove.
const objectWrappers = new WeakMap<EventListenerObject, EventListener>()
const toListener = (l: EventListenerOrEventListenerObject): EventListener => {
  if (typeof l === 'function') return l
  let w = objectWrappers.get(l)
  if (!w) objectWrappers.set(l, w = (e) => l.handleEvent(e))
  return w
}

type Reg = { eventType: string, listener: EventListener, capture: boolean }

const findReg = (regs: Set<Reg>, eventType: string, listener: EventListener, capture: boolean): Reg | undefined => {
  for (const r of regs) if (r.eventType === eventType && r.listener === listener && r.capture === capture) return r
  return undefined
}

// Held-value fields must not retain target — otherwise the FR never fires.
// On collection, walk the regs and tell source to drop each registration so
// no source-side adapter outlives its revive-side handle.
const registry = new FinalizationRegistry<{ removeRpc: ListenerRpc, regs: Set<Reg> }>(({ removeRpc, regs }) => {
  for (const { eventType, listener, capture } of regs) {
    try {
      removeRpc(eventType, identity(listener), { capture })
    } catch {
      // connection closed
    }
  }
  regs.clear()
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(value: T, context: T2) => {
  const addRpc = reviveFunction(value.addListener, context)
  const removeRpc = reviveFunction(value.removeListener, context)
  // Façade only — events never dispatch through it. Source-side EventTarget
  // owns all semantics (dedup, once, capture, signal); we just track regs so
  // the FR can tear down registrations when the target is dropped.
  const target = new EventTarget()
  const regs = new Set<Reg>()

  Object.defineProperty(target, 'addEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      if (findReg(regs, eventType, fn, capture)) return
      regs.add({ eventType, listener: fn, capture })
      try { addRpc(eventType, identity(fn), options) } catch { /* connection closed */ }
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      const reg = findReg(regs, eventType, fn, capture)
      if (!reg) return
      regs.delete(reg)
      try { removeRpc(eventType, identity(fn), { capture }) } catch { /* connection closed */ }
    },
  })

  registry.register(target, { removeRpc, regs }, target)
  return target
}

const typeCheck = () => {
  const r = revive(box(new EventTarget(), {} as RevivableContext), {} as RevivableContext)
  const expected: EventTarget = r
  // @ts-expect-error - not a string
  const notString: string = r
  // @ts-expect-error - cannot box non-EventTarget
  box('not an event target', {} as RevivableContext)
}
