import { BoxBase, type RevivableContext } from './utils'
import { identity } from './identity'
import { box as boxFunction, revive as reviveFunction } from './function'
import { trackGc } from '../utils/gc-tracker'

export const type = 'eventTarget' as const

type ListenerOpts = boolean | { capture?: boolean, once?: boolean, passive?: boolean, signal?: AbortSignal }

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

// Stable EventListener per EventListenerObject so identity() yields the
// same id on add and remove.
const objectWrappers = new WeakMap<EventListenerObject, EventListener>()
const toListener = (listerObject: EventListenerOrEventListenerObject): EventListener => {
  if (typeof listerObject === 'function') return listerObject
  let listener = objectWrappers.get(listerObject)
  if (!listener) objectWrappers.set(listerObject, listener = (e) => listerObject.handleEvent(e))
  return listener
}

type Reg = { eventType: string, listener: EventListener, capture: boolean }

const findReg = (regs: Reg[], eventType: string, listener: EventListener, capture: boolean): Reg | undefined =>
  regs.find(r => r.eventType === eventType && r.listener === listener && r.capture === capture)

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(value: T, context: T2) => {
  const addRpc = reviveFunction(value.addListener, context)
  const removeRpc = reviveFunction(value.removeListener, context)
  // Façade only — events never dispatch through it. Source-side EventTarget
  // owns all semantics; we just track regs for trackGc cleanup.
  const target = new EventTarget()
  const regs: Reg[] = []

  Object.defineProperty(target, 'addEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      if (findReg(regs, eventType, fn, capture)) return
      regs.push({ eventType, listener: fn, capture })
      addRpc(eventType, identity(fn), options).catch(() => {})
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = typeof options === 'boolean' ? options : !!options?.capture
      const reg = findReg(regs, eventType, fn, capture)
      if (!reg) return
      regs.splice(regs.indexOf(reg), 1)
      removeRpc(eventType, identity(fn), { capture }).catch(() => {})
    },
  })

  // Cleanup must NOT close over `target` — otherwise the FR can never fire.
  trackGc(target, () => {
    for (const { eventType, listener, capture } of regs) {
      removeRpc(eventType, identity(listener), { capture }).catch(() => {})
    }
    regs.length = 0
  })

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
