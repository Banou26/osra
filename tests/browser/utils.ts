import type { Message } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

export const makeJsonEmitter =
  (port: MessagePort) =>
    (osraMessage: Message, _?: Transferable[]) =>
      port.postMessage(JSON.stringify(osraMessage))

export const makeJsonReceiver =
  (port: MessagePort) =>
    (callback: (message: Message, ctx: MessageContext) => void) => {
      port.start()
      port.addEventListener(
        'message',
        event => callback(JSON.parse(event.data as string) as Message, {}),
      )
    }

export const makeJsonTransport = (port: MessagePort) => ({
  isJson: true as const,
  emit: makeJsonEmitter(port),
  receive: makeJsonReceiver(port),
})
