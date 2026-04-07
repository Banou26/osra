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
