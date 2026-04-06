import { expect } from 'chai'

import {
  isJsonOnlyTransport,
  isEmitJsonOnlyTransport,
  isReceiveJsonOnlyTransport,
  isWebExtensionRuntime,
  isWebExtensionPort,
  isWindow,
} from '../../src/utils/type-guards'

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
