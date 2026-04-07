import type { Transport } from '../../src/types'

import { expect } from 'chai'

import { expose, htmlVideoElement } from '../../src/index'

/**
 * Creates a real <video> element on the "remote" side and exposes it through
 * the given transport to the "local" side. Returns both: the caller uses
 * `local` for assertions and `remote` to directly mutate the underlying
 * element when simulating state changes from the other context.
 */
const setupVideoRoundTrip = async (transport: Transport) => {
  const remote = document.createElement('video')

  const exposed = { getVideo: async () => remote }
  expose(exposed, { transport, revivableModules: [htmlVideoElement] })

  const client = await expose<typeof exposed>(
    {},
    { transport, revivableModules: [htmlVideoElement] },
  )

  const local = await client.getVideo()
  return { local, remote }
}

/** A one-microtask flush — the Proxy `set` trap fires `controller.set` without
 *  awaiting it, so tests need a short yield before observing the remote side. */
const flush = () => new Promise(resolve => queueMicrotask(() => resolve(undefined)))

export const instanceOfCheck = async (transport: Transport) => {
  const { local } = await setupVideoRoundTrip(transport)
  expect(local).to.be.instanceOf(HTMLVideoElement)
}

export const initialStateMirrored = async (transport: Transport) => {
  const remote = document.createElement('video')
  remote.volume = 0.5
  remote.muted = true
  remote.loop = true

  const exposed = { getVideo: async () => remote }
  expose(exposed, { transport, revivableModules: [htmlVideoElement] })

  const client = await expose<typeof exposed>(
    {},
    { transport, revivableModules: [htmlVideoElement] },
  )
  const local = await client.getVideo()

  // Synchronous reads — no await.
  expect(local.volume).to.equal(0.5)
  expect(local.muted).to.equal(true)
  expect(local.loop).to.equal(true)
  expect(local.paused).to.equal(true) // default for a freshly created <video>
}

export const writablePropPropagation = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  local.autoplay = true
  local.loop = true
  local.playbackRate = 2

  // Optimistic local read — sync, no await.
  expect(local.autoplay).to.equal(true)
  expect(local.loop).to.equal(true)
  expect(local.playbackRate).to.equal(2)

  // The remote side is updated after the controller.set RPC resolves.
  // Wait for one turn of the event loop before asserting on the remote.
  await flush()
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(remote.autoplay).to.equal(true)
  expect(remote.loop).to.equal(true)
  expect(remote.playbackRate).to.equal(2)
}

export const methodCallCanPlayType = async (transport: Transport) => {
  const { local } = await setupVideoRoundTrip(transport)

  const result = await (local.canPlayType as (type: string) => Promise<CanPlayTypeResult>)('video/mp4')
  // Chrome returns 'probably' or 'maybe' for mp4; Firefox may return 'maybe'.
  // Any of the three valid enum values is acceptable; we just assert it's a string.
  expect(result).to.be.a('string')
  // Assert it's one of the valid enum values for CanPlayTypeResult.
  expect(['', 'maybe', 'probably']).to.include(result)
}

export const playPauseRoundTrip = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // play() on a source-less element rejects, which is fine — we're only
  // verifying the proxied call returns a Promise. Swallow the rejection.
  const playResult = (local.play as () => Promise<void>)()
  expect(playResult).to.be.instanceOf(Promise)
  // Race with a 500ms timeout so that browsers that never settle play() don't hang.
  try { await Promise.race([playResult, new Promise(resolve => setTimeout(resolve, 500))]) } catch { /* no source */ }

  // pause() always resolves; it also proves the method-call path for a
  // Promise<void> return.
  const pauseResult = (local.pause as () => Promise<void>)()
  expect(pauseResult).to.be.instanceOf(Promise)
  await pauseResult

  await new Promise(resolve => setTimeout(resolve, 50))

  expect(remote.paused).to.equal(true)
  expect(local.paused).to.equal(true)
}

export const eventDeltaUpdatesState = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // Give subscribe() a turn to register on the remote side before we mutate.
  await new Promise(resolve => setTimeout(resolve, 50))

  const seen: Array<{ type: string, currentTime: number }> = []
  local.addEventListener('seeked', () => {
    seen.push({ type: 'seeked', currentTime: local.currentTime })
  })
  local.addEventListener('timeupdate', () => {
    seen.push({ type: 'timeupdate', currentTime: local.currentTime })
  })

  // Dispatch a synthetic seeked event on the remote element. This is the most
  // reliable way to force a state change without needing media to actually load
  // and play in a headless test browser.
  remote.currentTime = 5
  remote.dispatchEvent(new Event('seeked'))
  remote.dispatchEvent(new Event('timeupdate'))

  // Wait for the event stream round-trip.
  await new Promise(resolve => setTimeout(resolve, 100))

  expect(seen.length).to.be.greaterThan(0)
  // Each observed event should have seen currentTime === 5 at the moment of dispatch.
  for (const entry of seen) {
    expect(entry.currentTime).to.equal(5)
  }
  expect(local.currentTime).to.equal(5)
}

export const addEventListenerFires = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  // Give subscribe() a turn to register listeners on the remote.
  await new Promise(resolve => setTimeout(resolve, 50))

  const observed: Array<{ type: string, targetIsProxy: boolean }> = []
  local.addEventListener('volumechange', (e) => {
    observed.push({ type: e.type, targetIsProxy: e.target === local })
  })

  remote.volume = 0.25 // triggers volumechange on remote
  remote.dispatchEvent(new Event('volumechange'))

  await new Promise(resolve => setTimeout(resolve, 100))

  expect(observed.length).to.be.greaterThan(0)
  expect(observed[0].type).to.equal('volumechange')
  expect(observed[0].targetIsProxy).to.equal(true)
  expect(local.volume).to.equal(0.25)
}

export const removeEventListenerDetaches = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)

  await new Promise(resolve => setTimeout(resolve, 50))

  let firedCount = 0
  const listener = () => { firedCount++ }
  local.addEventListener('volumechange', listener)
  local.removeEventListener('volumechange', listener)

  remote.volume = 0.1
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))

  expect(firedCount).to.equal(0)
}

export const onEventHandlerSlot = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)
  await new Promise(resolve => setTimeout(resolve, 50))

  let fired = 0
  ;(local as HTMLVideoElement).onvolumechange = () => { fired++ }
  expect((local as HTMLVideoElement).onvolumechange).to.be.a('function')

  // Dispatching a synthetic event without changing volume avoids the real
  // browser volumechange that would otherwise fire from `remote.volume = ...`,
  // which would cause a double-fire and make the count assertion unreliable.
  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(fired).to.equal(1)

  // Assigning null should clear the slot.
  ;(local as HTMLVideoElement).onvolumechange = null
  expect((local as HTMLVideoElement).onvolumechange).to.equal(null)

  remote.dispatchEvent(new Event('volumechange'))
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(fired).to.equal(1) // unchanged
}

export const multipleDeltaFields = async (transport: Transport) => {
  const { local, remote } = await setupVideoRoundTrip(transport)
  await new Promise(resolve => setTimeout(resolve, 50))

  remote.volume = 0.7
  remote.muted = true
  remote.dispatchEvent(new Event('volumechange'))

  await new Promise(resolve => setTimeout(resolve, 100))

  expect(local.volume).to.equal(0.7)
  expect(local.muted).to.equal(true)
}
