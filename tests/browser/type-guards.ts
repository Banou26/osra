import { expect } from 'chai'

import {
  isJsonOnlyTransport,
  isEmitJsonOnlyTransport,
  isReceiveJsonOnlyTransport,
  isWebExtensionRuntime,
  isWebExtensionPort,
  isWindow,
} from '../../src/utils/type-guards'
import { normalizeTransport } from '../../src/connections/utils'

// Mimics a cross-origin WindowProxy: whitelisted props (window/closed/close/postMessage)
// resolve; any other property access — including the `in` operator — throws SecurityError,
// exactly like the browser blocks `'isJson' in iframe.contentWindow`.
const crossOriginWindowMock = (): Window => {
  const allowed = new Set(['window', 'self', 'closed', 'close', 'postMessage', 'parent', 'top'])
  const proxy: unknown = new Proxy({}, {
    has: (_t, prop) => {
      if (allowed.has(prop as string)) return true
      throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError')
    },
    get: (_t, prop) => {
      if (prop === 'window' || prop === 'self') return proxy
      if (prop === 'closed') return false
      if (prop === 'close' || prop === 'postMessage') return () => {}
      throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError')
    },
  })
  return proxy as Window
}

export const windowIsNotJsonOnly = () => {
  expect(isJsonOnlyTransport(window)).to.equal(false)
}

export const wrappedWindowTransportIsNotJsonOnly = () => {
  const transport = { isJson: false, emit: window, receive: window }
  expect(isJsonOnlyTransport(transport as any)).to.equal(false)
}

export const wrappedWindowTransportIsNotEmitJsonOnly = () => {
  const transport = { isJson: false, emit: window, receive: window }
  expect(isEmitJsonOnlyTransport(transport)).to.equal(false)
}

export const wrappedWindowTransportIsNotReceiveJsonOnly = () => {
  const transport = { isJson: false, emit: window, receive: window }
  expect(isReceiveJsonOnlyTransport(transport)).to.equal(false)
}

export const plainObjectIsNotWebExtensionRuntime = () => {
  expect(isWebExtensionRuntime({})).to.equal(false)
  expect(isWebExtensionRuntime({ foo: 'bar' })).to.equal(false)
  expect(isWebExtensionRuntime({ isJson: false, emit: window, receive: window })).to.equal(false)
}

export const plainObjectIsNotWebExtensionPort = () => {
  expect(isWebExtensionPort({})).to.equal(false)
  expect(isWebExtensionPort({ isJson: false, emit: window, receive: window })).to.equal(false)
}

export const windowIsWindow = () => {
  expect(isWindow(window)).to.equal(true)
}

export const plainObjectIsNotWindow = () => {
  expect(isWindow({})).to.equal(false)
  expect(isWindow({ isJson: false, emit: window, receive: window })).to.equal(false)
}

export const explicitJsonOnlyTransport = () => {
  const transport = { isJson: true, emit: () => {}, receive: () => {} }
  expect(isJsonOnlyTransport(transport as any)).to.equal(true)
}

export const explicitNonJsonTransportIsNotJsonOnly = () => {
  const transport = { isJson: false, emit: () => {}, receive: () => {} }
  expect(isJsonOnlyTransport(transport as any)).to.equal(false)
}

export const crossOriginWindowIsNotJsonOnly = () => {
  const win = crossOriginWindowMock()
  // the `in` probe inside isJsonOnlyTransport must not touch the cross-origin window
  expect(() => isJsonOnlyTransport(win)).to.not.throw()
  expect(isJsonOnlyTransport(win)).to.equal(false)
  expect(isWindow(win)).to.equal(true)
}

export const normalizeCrossOriginWindowEmitTransport = () => {
  const win = crossOriginWindowMock()
  // the iframe-broker shape: emit to the cross-origin parent, receive on our own window
  expect(() => normalizeTransport({ receive: window, emit: win } as any)).to.not.throw()
  const normalized = normalizeTransport({ receive: window, emit: win } as any) as any
  expect(normalized.isJson).to.equal(false)
  expect(normalized.emit).to.equal(win)
}
