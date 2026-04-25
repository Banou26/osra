import type { Capable } from '../types'
import type { BoxBase as BoxBaseType, RevivableContext } from './utils'
import type { Handle, HandleId } from '../utils/remote-handle'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'eventTarget' as const

type ListenerOpts = boolean | { capture?: boolean, once?: boolean, passive?: boolean, signal?: AbortSignal }

/** Commands the revive side sends through the target's control handle. */
type Control =
  | { kind: 'add', eventType: string, listenerHandleId: HandleId, options?: ListenerOpts }
  | { kind: 'remove', listenerHandleId: HandleId }

export type BoxedEventTarget =
  & BoxBaseType<typeof type>
  & { handleId: HandleId }

export const isType = (value: unknown): value is EventTarget =>
  value instanceof EventTarget

// Stable EventListener per EventListenerObject so the same object yields
// the same wrapped listener on add and remove.
const objectWrappers = new WeakMap<EventListenerObject, EventListener>()
const toListener = (listenerObject: EventListenerOrEventListenerObject): EventListener => {
  if (typeof listenerObject === 'function') return listenerObject
  let listener = objectWrappers.get(listenerObject)
  if (!listener) {
    objectWrappers.set(listenerObject, listener = (e) => listenerObject.handleEvent(e))
  }
  return listener
}

const captureFromOpts = (options?: ListenerOpts): boolean =>
  typeof options === 'boolean' ? options : !!options?.capture

export const box = <T extends EventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedEventTarget => {
  // Source side: every registration the peer adds becomes a (forwarder fn,
  // adopted-listener-handle) pair stored here, keyed by the listener handle
  // id the peer allocated. On any release path — peer's `removeEventListener`
  // → listener handle release; listener fn collected on peer side → listener
  // handle release; peer dropped the whole façade → control handle release —
  // we walk the right entries and detach the forwarder so the source target
  // stops firing into a dead channel.
  type SourceReg = {
    eventType: string
    capture: boolean
    forwarder: EventListener
    listenerHandle: Handle
  }
  const sourceRegs = new Map<HandleId, SourceReg>()

  const detach = (reg: SourceReg) => {
    value.removeEventListener(reg.eventType, reg.forwarder, { capture: reg.capture })
  }

  const installListener = (cmd: Extract<Control, { kind: 'add' }>) => {
    if (sourceRegs.has(cmd.listenerHandleId)) return
    // Adopt the peer's per-listener handle. onRelease covers both the
    // peer's explicit removeEventListener and the peer-side FR firing
    // when the user's listener fn is collected — same teardown either way.
    const listenerHandle = adoptHandle(context, cmd.listenerHandleId, {
      onRelease: () => {
        const reg = sourceRegs.get(cmd.listenerHandleId)
        if (!reg) return
        sourceRegs.delete(cmd.listenerHandleId)
        detach(reg)
      },
    })
    const forwarder: EventListener = (event) => {
      try {
        listenerHandle.send(recursiveBox(event as Capable, context))
      } catch { /* event not boxable / connection torn down */ }
    }
    sourceRegs.set(cmd.listenerHandleId, {
      eventType: cmd.eventType,
      capture: captureFromOpts(cmd.options),
      forwarder,
      listenerHandle,
    })
    value.addEventListener(cmd.eventType, forwarder, cmd.options)
  }

  const removeListener = (listenerHandleId: HandleId) => {
    const reg = sourceRegs.get(listenerHandleId)
    if (!reg) return
    sourceRegs.delete(listenerHandleId)
    detach(reg)
    // Releasing notifies the peer's adopted handle so its onRelease can
    // clean up the revive-side regs entry too.
    reg.listenerHandle.release()
  }

  const controlHandle = createHandle(context, {
    onMessage: (payload) => {
      const cmd = payload as Control
      if (cmd.kind === 'add') installListener(cmd)
      else if (cmd.kind === 'remove') removeListener(cmd.listenerHandleId)
    },
    onRelease: () => {
      // Peer dropped the whole façade — blast every forwarder. Releasing
      // each listener handle is what tells the peer's revive-side regs
      // to drop their entries.
      for (const reg of sourceRegs.values()) {
        detach(reg)
        reg.listenerHandle.release()
      }
      sourceRegs.clear()
    },
  })

  return { ...BoxBase, type, handleId: controlHandle.id }
}

export const revive = <T extends BoxedEventTarget, T2 extends RevivableContext>(
  value: T,
  context: T2,
): EventTarget => {
  // Façade only — events never dispatch through it. The source-side
  // EventTarget owns dispatch semantics (dedup, once, capture, signal);
  // we just track local registrations so the per-listener / control
  // handles can drive teardown when listeners are dropped or the façade
  // itself is collected.
  const target = new EventTarget()

  type Reg = {
    eventType: string
    capture: boolean
    fnRef: WeakRef<EventListener>
    handle: Handle
  }
  const regs = new Map<HandleId, Reg>()

  // The control handle is tracked by the façade itself: when user code
  // drops the only reference to `target`, the FR releases the control
  // handle, the peer's onRelease detaches every forwarder, and each
  // listener handle releases too. No close-over-target retention here —
  // the handle's own send/release closes over connection state, not
  // `target`, so the FR can actually fire.
  const controlHandle = adoptHandle(context, value.handleId, {}, target)

  const findReg = (eventType: string, fn: EventListener, capture: boolean): Reg | undefined => {
    for (const reg of regs.values()) {
      if (reg.eventType !== eventType || reg.capture !== capture) continue
      if (reg.fnRef.deref() === fn) return reg
    }
    return undefined
  }

  Object.defineProperty(target, 'addEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = captureFromOpts(options)
      // Native EventTarget dedup: same (type, fn, capture) ignored.
      if (findReg(eventType, fn, capture)) return

      // Per-listener handle. Tracked value is `fn` directly — when the
      // user's last reference to `fn` dies, the FR fires, the peer's
      // adopted listener-handle's onRelease detaches the source-side
      // forwarder, and we drop our regs entry. The closures here MUST
      // NOT capture `fn` strongly — we use a WeakRef so the FR can fire.
      const fnRef = new WeakRef(fn)
      const handle = createHandle(context, {
        onMessage: (payload) => {
          const f = fnRef.deref()
          if (!f) return
          const event = recursiveRevive(payload, context) as Event
          f.call(target, event)
        },
        onRelease: () => {
          regs.delete(handle.id)
        },
      }, fn)

      regs.set(handle.id, { eventType, capture, fnRef, handle })
      try {
        controlHandle.send({
          kind: 'add',
          eventType,
          listenerHandleId: handle.id,
          options,
        } satisfies Control as Capable)
      } catch {
        // Connection torn down — drop our local registration so we don't
        // leak a handle entry the source side will never know about.
        regs.delete(handle.id)
        handle.release()
      }
    },
  })

  Object.defineProperty(target, 'removeEventListener', {
    value: (eventType: string, listener: EventListenerOrEventListenerObject | null, options?: ListenerOpts) => {
      if (listener === null) return
      const fn = toListener(listener)
      const capture = captureFromOpts(options)
      const reg = findReg(eventType, fn, capture)
      if (!reg) return
      regs.delete(reg.handle.id)
      // release() notifies the source side to detach its forwarder. We
      // skip the explicit 'remove' control message — listener-handle
      // release is the same signal, one round-trip cheaper.
      reg.handle.release()
    },
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
