import type {
  Capable,
  RevivableReadableStream,
  RevivableReadableStreamPullContext,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { isRevivablePromiseBox } from '../type-guards'
import { getTransferableObjects } from '../transferable'

export const name = 'readableStream'

export const is = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const box = (
  value: ReadableStream,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): RevivableVariant & { type: 'readableStream' } => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const reader = value.getReader()

  localPort.addEventListener('message', async ({ data }:  MessageEvent<RevivableReadableStreamPullContext>) => {
    const { type } = recursiveRevive(data, context) as RevivableReadableStreamPullContext
    if (type === 'pull') {
      const pullResult = reader.read()
      const boxedResult = recursiveBox(pullResult, context)
      localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    } else {
      reader.cancel()
      localPort.close()
    }
  })
  localPort.start()

  return {
    type: 'readableStream',
    port: remotePort
  }
}

export const revive = (
  value: RevivableReadableStream,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): ReadableStream => {
  context.messagePorts.add(value.port)
  value.port.start()
  return new ReadableStream({
    start(controller) {},
    pull(controller) {
      return new Promise((resolve, reject) => {
        value.port.addEventListener('message', async ({ data }: MessageEvent<Capable>) => {
          if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
          const result = recursiveRevive(data, context) as Promise<ReadableStreamReadResult<any>>
          result
            .then(result => {
              if (result.done) controller.close()
              else controller.enqueue(result.value)
              resolve()
            })
            .catch(reject)
        }, { once: true })
        value.port.postMessage(recursiveBox({ type: 'pull' }, context))
      })
    },
    cancel() {
      value.port.postMessage(recursiveBox({ type: 'cancel' }, context))
      value.port.close()
    }
  })
}
