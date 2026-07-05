import { expect } from 'chai'

import { EventChannel, EventPort } from '../../src/utils/event-channel'

// EventPort MUST NOT extend EventTarget: Firefox content-script / privileged
// sandboxes don't support subclassing platform interfaces - `new EventPort()`
// returns a bare EventTarget there, dropping start/postMessage/close. Guard the
// invariant so it can't silently regress (every osra function/stream revivable
// rides on EventChannel, so this breaks the whole bridge in Firefox extensions).
export const eventPortIsNotAnEventTarget = async () => {
  const { port1 } = new EventChannel()
  expect(port1 instanceof EventPort).to.equal(true)
  expect(port1 instanceof EventTarget).to.equal(false)
  expect(typeof port1.start).to.equal('function')
  expect(typeof port1.postMessage).to.equal('function')
  expect(typeof port1.close).to.equal('function')
}

export const eventPortRoundTripsAfterStart = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  const received: string[] = []
  port2.addEventListener('message', (event) => { received.push((event as MessageEvent<string>).data) })
  port2.start()
  port1.postMessage('a')
  port1.postMessage('b')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(received).to.deep.equal(['a', 'b'])
}

export const eventPortQueuesUntilStarted = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  const received: string[] = []
  port1.postMessage('queued')
  await new Promise((resolve) => setTimeout(resolve, 0))
  port2.onmessage = (event) => { received.push((event as MessageEvent<string>).data) }
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(received).to.deep.equal(['queued'])
}

export const eventPortRemoveListenerStops = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  const received: string[] = []
  const listener = (event: Event) => { received.push((event as MessageEvent<string>).data) }
  port2.addEventListener('message', listener)
  port2.start()
  port1.postMessage('one')
  await new Promise((resolve) => setTimeout(resolve, 0))
  port2.removeEventListener('message', listener)
  port1.postMessage('two')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(received).to.deep.equal(['one'])
}

// EventTarget semantics: adding the same callback twice registers it once,
// and a single removeEventListener fully unregisters it.
export const eventPortDuplicateAddRegistersOnce = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  let calls = 0
  const listener = () => { calls++ }
  port2.addEventListener('message', listener)
  port2.addEventListener('message', listener)
  port2.start()
  port1.postMessage('x')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(1)
  port2.removeEventListener('message', listener)
  port1.postMessage('y')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(1)
}

export const eventPortOnceListenerFiresOnceAndSelfRemoves = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  let calls = 0
  const listener = () => { calls++ }
  port2.addEventListener('message', listener, { once: true })
  port2.start()
  port1.postMessage('a')
  port1.postMessage('b')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(1)
  // Re-adding after the once fired registers fresh, like EventTarget.
  port2.addEventListener('message', listener, { once: true })
  port1.postMessage('c')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(2)
}

// Options on a duplicate add don't apply: the first registration wins.
export const eventPortDuplicateAddDoesNotUpgradeToOnce = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  let calls = 0
  const listener = () => { calls++ }
  port2.addEventListener('message', listener)
  port2.addEventListener('message', listener, { once: true })
  port2.start()
  port1.postMessage('a')
  port1.postMessage('b')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(2)
}

export const eventPortDuplicateAddDoesNotClearOnce = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  let calls = 0
  const listener = () => { calls++ }
  port2.addEventListener('message', listener, { once: true })
  port2.addEventListener('message', listener)
  port2.start()
  port1.postMessage('a')
  port1.postMessage('b')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(1)
}

export const eventPortOnceListenerRemovableBeforeFiring = async () => {
  const { port1, port2 } = new EventChannel<string, string>()
  let calls = 0
  const listener = () => { calls++ }
  port2.addEventListener('message', listener, { once: true })
  port2.removeEventListener('message', listener)
  port2.start()
  port1.postMessage('a')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls).to.equal(0)
}
