import type { Transport } from '../../src'

import { expect } from 'chai'

import { expose } from '../../src/index'

// __osraForceGc is wired up by the spec runner via page.exposeFunction:
// it drives CDP HeapProfiler.collectGarbage from the Node side and waits
// between collections so FinalizationRegistry callbacks (which run on the
// macrotask queue) actually fire before control returns to the test.
declare const __osraForceGc: () => Promise<void>

// Proves bug_004: when the revived EventTarget is collected, the box side
// tears down the forwarder it installed on the user's source EventTarget.
// Uses a probe-counter sentinel: the source-side listener (unrelated to
// the forwarder) increments probeCount on every dispatch, so we can tell
// whether the source actually dispatched without asking the revive side.
// Pre-fix, dropping the revived target left the forwarder attached and it
// kept posting into a dead channel for the source's entire lifetime.
// Diagnostic: proves our GC bracket actually reclaims unreferenced objects.
// If this fails the infrastructure is broken; no point running the real
// GC-dependent tests until it passes.
export const gcBracketCollectsUnreferencedObject = async (_transport: Transport) => {
  const probe = new WeakRef({ marker: 'unreferenced' })
  await __osraForceGc()
  expect(probe.deref(), 'plain object with no retaining refs should be collected').to.equal(undefined)
}

// Diagnostic: isolates whether the revival pipeline pins target even when
// the user never adds a listener. If this fails, something in the
// pipeline (not in user code) is holding a strong reference.
export const revivedEventTargetDroppedWithoutListenerIsCollected = async (transport: Transport) => {
  const _et = new EventTarget()
  const value = { et: _et }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  const etRef = new WeakRef(remote.et)
  ;(remote as { et?: unknown }).et = undefined
  await __osraForceGc()
  expect(etRef.deref(), 'revived EventTarget should be collected when user never added a listener').to.equal(undefined)
}

// Diagnostic companion to funcDropRejectsPending: if this fails, the
// revived function itself isn't being collected (so the finalizer never
// runs) — the fix would be in the revival pipeline, not in the pending-call
// cleanup path. We null the property rather than the binding because the
// resolved init-object is retained by osra internals (connection state
// holds the same object reference), so only scrubbing the field releases
// the revived value.
export const revivedFunctionDroppedIsCollected = async (transport: Transport) => {
  const value = { foo: async () => 1 }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })
  const fooRef = new WeakRef(remote.foo)
  ;(remote as { foo?: unknown }).foo = undefined
  await __osraForceGc()
  expect(fooRef.deref(), 'revived function should be collected after dropping the holding reference').to.equal(undefined)
}

export const revivedEventTargetDropTearsDownSource = async (transport: Transport) => {
  const _et = new EventTarget()
  let probeCount = 0
  _et.addEventListener('tick', () => { probeCount++ })

  // forwarderLive: 1 while the box side has its forwarder attached, 0 once
  // it's removed. The forwarder fires before the probe listener (install
  // order), so we can't use probe to detect its presence — we wrap the
  // source's addEventListener so the box side's install/remove is observable.
  let forwarderLive = 0
  const originalAdd = _et.addEventListener.bind(_et)
  const originalRemove = _et.removeEventListener.bind(_et)
  const wrapped = new WeakSet<EventListener>()
  _et.addEventListener = ((type: string, listener: EventListener, opts?: unknown) => {
    if (type === 'tick' && listener !== undefined && !wrapped.has(listener)) {
      forwarderLive++
      wrapped.add(listener)
    }
    return originalAdd(type, listener, opts as AddEventListenerOptions | boolean | undefined)
  }) as EventTarget['addEventListener']
  _et.removeEventListener = ((type: string, listener: EventListener, opts?: unknown) => {
    if (type === 'tick' && listener !== undefined && wrapped.has(listener)) {
      forwarderLive--
      wrapped.delete(listener)
    }
    return originalRemove(type, listener, opts as EventListenerOptions | boolean | undefined)
  }) as EventTarget['removeEventListener']

  const value = {
    et: _et,
    fire: async () => { _et.dispatchEvent(new Event('tick')) },
    probe: async () => probeCount,
    forwarderLive: async () => forwarderLive,
  }
  expose(value, { transport })
  const remote = await expose<typeof value>({}, { transport })

  // Subscribe inside an inner scope so the only strong reference to the
  // revived EventTarget is `remote.et` — we'll drop that below. The listener
  // is captured here and referenced by the revive-side subscription map;
  // that's fine, since the whole graph roots from `remote.et`.
  remote.et.addEventListener('tick', () => {})
  await new Promise(r => setTimeout(r, 50))
  await remote.fire()
  await new Promise(r => setTimeout(r, 50))
  expect(await remote.forwarderLive()).to.equal(1)

  // Drop the last strong reference to the revived target. WeakRef probe
  // confirms the engine actually collects it — if this fails we know the
  // issue is in the test's reference graph, not the revivable.
  const etRef = new WeakRef(remote.et)
  ;(remote as { et?: unknown }).et = undefined
  await __osraForceGc()
  expect(etRef.deref(), 'revived EventTarget should be collected after drop').to.equal(undefined)

  // After GC + FinalizationRegistry callback, the box side should have
  // removed its forwarder from the source EventTarget. Probe: fire again,
  // source still dispatches (probe ticks because _et's own listener is
  // independent), but the forwarder must be gone.
  const probeBefore = await remote.probe()
  await remote.fire()
  await new Promise(r => setTimeout(r, 50))
  expect(await remote.probe()).to.equal(probeBefore + 1)
  expect(await remote.forwarderLive()).to.equal(0)
}

// Proves bug_008 func-GC path: when the revived function is collected
// while a call is in flight, the FinalizationRegistry callback rejects
// the pending Promise instead of letting it hang forever. We construct
// a call the box side never answers (synchronous loop) — pre-fix the
// caller would wait forever; post-fix it rejects within a bounded window
// once we null the function reference and force GC.
export const funcDropRejectsPending = async (transport: Transport) => {
  // Box-side function that never resolves — simulates a remote that
  // accepts the call but can't/won't reply.
  const value = { slow: (): Promise<number> => new Promise(() => {}) }
  expose(value, { transport })

  const remote = await expose<typeof value>({}, { transport })

  const callPromise = remote.slow().then(
    () => 'resolved' as const,
    () => 'rejected' as const,
  )

  // Allow the call to actually dispatch before we drop the function.
  await new Promise(r => setTimeout(r, 50))

  // Clear the property that pointed to the revived function. Nulling the
  // local binding alone isn't enough: osra's connection state retains the
  // same init-object reference, so the function stays alive until the
  // field itself is scrubbed. After this, the pending call's resolve/reject
  // live inside the once-listener closure — held by returnLocal which is
  // pinned by inFlightReturnPorts — and the finalizer is what breaks the
  // hang by walking inFlight and rejecting each outstanding record.
  ;(remote as { slow?: unknown }).slow = undefined
  await __osraForceGc()

  const settled = await Promise.race([
    callPromise,
    new Promise<'hung'>(r => setTimeout(() => r('hung'), 2_000)),
  ])
  expect(settled).to.equal('rejected')
}

export const gc = {
  gcBracketCollectsUnreferencedObject,
  revivedEventTargetDroppedWithoutListenerIsCollected,
  revivedFunctionDroppedIsCollected,
  revivedEventTargetDropTearsDownSource,
  funcDropRejectsPending,
}
