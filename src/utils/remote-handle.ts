import type { Capable, Uuid } from '../types'
import type { RevivableContext } from '../revivables/utils'

export type HandleId = Uuid

/**
 * Wire envelopes carrying payloads and lifecycle signals between the two
 * sides of a remote handle pair. Only `handleId` distinguishes one pair
 * from another — both sides allocate the same id on their respective ends.
 */
export type HandleMessages =
  | {
    type: 'osra-handle-message'
    remoteUuid: Uuid
    handleId: HandleId
    payload: Capable
  }
  | {
    type: 'osra-handle-release'
    remoteUuid: Uuid
    handleId: HandleId
  }

export type HandleOptions = {
  /** Peer sent us a payload addressed to this handle. Payload is delivered
   *  exactly as the peer's `send()` provided it — no automatic boxing or
   *  reviving. Callers that send live values (Functions/Promises/…) are
   *  responsible for `recursiveBox` on the way out and `recursiveRevive`
   *  on the way in. */
  onMessage?: (payload: Capable) => void
  /** This handle has been released by a path *other than* an explicit
   *  `handle.release()` call: either the peer signalled release (their
   *  side dropped) or our local FinalizationRegistry collected the
   *  tracked value. Use this to clean up state held alongside the
   *  handle (in-flight work, owned ports, registrations, …). */
  onRelease?: () => void
}

export type Handle = {
  readonly id: HandleId
  /** Send a payload to the peer's matching handle. Idempotent: silently
   *  drops if the handle is already released or the connection is gone. */
  send(payload: Capable): void
  /** Explicit local release. Notifies the peer and discards local state.
   *  Does NOT call `onRelease` — the call site already knows it released
   *  and can run its cleanup inline. Use `onRelease` for the cases the
   *  call site doesn't see (peer release, FR fire). */
  release(): void
}

type Entry = HandleOptions & {
  released: boolean
  unregisterToken: object
}

type State = {
  handles: Map<HandleId, Entry>
  /** Held value is just the `HandleId` — a string with no path back to
   *  the tracked value. Anything more would risk pinning the value and
   *  preventing the FR from firing. */
  registry: FinalizationRegistry<HandleId>
}

const stateMap = new WeakMap<RevivableContext<any>, State>()

const getState = (context: RevivableContext<any>): State => {
  const state = stateMap.get(context)
  if (!state) {
    throw new Error('osra remote-handle: connection state missing — did init() run?')
  }
  return state
}

/**
 * Per-connection bootstrap. Creates the handle table, the
 * FinalizationRegistry, and installs the message dispatcher. Must run
 * before any revivable that uses handles — `startBidirectionalConnection`
 * calls this immediately after constructing the context.
 */
export const init = (context: RevivableContext<any>): void => {
  const handles = new Map<HandleId, Entry>()

  const registry = new FinalizationRegistry<HandleId>((id) => {
    const entry = handles.get(id)
    if (!entry || entry.released) return
    entry.released = true
    handles.delete(id)
    // Tell peer first so its onRelease has a chance to run before we
    // discard local state. Swallow if connection is gone — best-effort.
    try {
      context.sendMessage({
        type: 'osra-handle-release',
        remoteUuid: context.remoteUuid,
        handleId: id,
      })
    } catch { /* connection torn down */ }
    try { entry.onRelease?.() } catch { /* user cleanup threw — keep going */ }
  })

  stateMap.set(context, { handles, registry })

  context.eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type === 'osra-handle-message') {
      const entry = handles.get(detail.handleId)
      if (entry && !entry.released) {
        try { entry.onMessage?.(detail.payload) } catch { /* user threw */ }
      }
      return
    }
    if (detail.type === 'osra-handle-release') {
      const entry = handles.get(detail.handleId)
      if (!entry || entry.released) return
      entry.released = true
      handles.delete(detail.handleId)
      // Deregister so the FR doesn't pointlessly fire later and re-send a
      // release the peer has already acted on.
      registry.unregister(entry.unregisterToken)
      try { entry.onRelease?.() } catch { /* user cleanup threw */ }
    }
  })
}

const define = (
  context: RevivableContext<any>,
  id: HandleId,
  options: HandleOptions,
  trackedValue: WeakKey | undefined,
): Handle => {
  const state = getState(context)
  const unregisterToken = {}
  const entry: Entry = {
    ...options,
    released: false,
    unregisterToken,
  }
  state.handles.set(id, entry)

  // Tracking is opt-in. Handles can also exist purely as routing endpoints
  // released explicitly — useful for short-lived per-call channels.
  if (trackedValue !== undefined) {
    state.registry.register(trackedValue, id, unregisterToken)
  }

  return {
    id,
    send(payload) {
      if (entry.released) return
      // Deliberately not catching: serialisation errors (DataCloneError on
      // clone transports, JSON cycles on JSON transports) need to surface
      // to the caller so it can report back over the wire — see how
      // function.ts catches DataCloneError and sends `__osra_err__`
      // through the same handle so the awaited proxy rejects instead of
      // hanging. If the connection is genuinely gone, the throw also lets
      // the caller's executor reject the user's Promise.
      context.sendMessage({
        type: 'osra-handle-message',
        remoteUuid: context.remoteUuid,
        handleId: id,
        payload,
      })
    },
    release() {
      if (entry.released) return
      entry.released = true
      state.handles.delete(id)
      state.registry.unregister(unregisterToken)
      // Best-effort: nobody's awaiting cleanup, and a torn-down connection
      // is the normal teardown path — no caller cares.
      try {
        context.sendMessage({
          type: 'osra-handle-release',
          remoteUuid: context.remoteUuid,
          handleId: id,
        })
      } catch { /* connection torn down */ }
    },
  }
}

/**
 * Create a fresh handle. Returned `id` is allocated locally and should be
 * serialised so the peer can `adoptHandle` its other half.
 *
 * `trackedValue`, if supplied, is registered with the connection's
 * FinalizationRegistry — when the engine collects it, the handle releases
 * automatically. The tracked value MUST NOT be reachable from anything
 * captured by `options.onRelease`; otherwise the FR can never fire.
 */
export const createHandle = (
  context: RevivableContext<any>,
  options: HandleOptions,
  trackedValue?: WeakKey,
): Handle =>
  define(context, globalThis.crypto.randomUUID(), options, trackedValue)

/**
 * Bind to a handle whose id was allocated on the peer side. Forms the
 * other end of the same logical pair. Same FR/release semantics as
 * `createHandle`.
 */
export const adoptHandle = (
  context: RevivableContext<any>,
  id: HandleId,
  options: HandleOptions,
  trackedValue?: WeakKey,
): Handle =>
  define(context, id, options, trackedValue)
