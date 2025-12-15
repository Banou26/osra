import { Message } from '../../src/types'

export const makeJsonEmitter =
  (port: MessagePort) =>
    (osraMessage: Message, _: Transferable[]) =>
      port.postMessage(JSON.stringify(osraMessage))

export const makeJsonReceiver =
  (port: MessagePort) =>
    (callback: (message: Message) => void) =>
      port.addEventListener(
        'message',
        event => callback(JSON.parse(event.data))
      )

export const makeJsonTransport = (port: MessagePort) => ({
  emit: makeJsonEmitter(port),
  receive: makeJsonReceiver(port)
})
