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
