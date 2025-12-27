import type { Capable, StructurableTransferable } from '../types'
import type { RevivableContext } from './utils'
import type { StrictMessageChannel, StrictMessagePort } from '../utils/message-channel'
import type { UnderlyingType } from '.'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'readableStream' as const

export type PullContext = {
  type: 'pull' | 'cancel'
}

export type BoxedReadableStream<T extends ReadableStream = ReadableStream> = {
  __OSRA_BOX__: 'revivable'
  type: typeof type
  port: BoxedMessagePort
  [UnderlyingType]: T
}

export const isType = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const box = <T extends ReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): BoxedReadableStream<T> => {
  const { port1: localPort, port2: remotePort } = new MessageChannel() as StrictMessageChannel<StructurableTransferable, StructurableTransferable>
  context.messagePorts.add(remotePort as MessagePort)

  const reader = value.getReader()

  ;(localPort as MessagePort).addEventListener('message', async ({ data }) => {
    const { type } = recursiveRevive(data, context) as PullContext
    if (type === 'pull') {
      const pullResult = reader.read()
      const boxedResult = recursiveBox(pullResult, context)
      ;(localPort as MessagePort).postMessage(boxedResult, getTransferableObjects(boxedResult))
    } else {
      reader.cancel()
      localPort.close()
    }
  })
  localPort.start()

  return {
    __OSRA_BOX__: 'revivable',
    type,
    port: boxMessagePort(remotePort as MessagePort as StrictMessagePort<Record<string, StructurableTransferable>>, context)
  } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort, context) as MessagePort
  context.messagePorts.add(port as MessagePort)
  port.start()

  return new ReadableStream({
    start(_controller) {},
    pull(controller) {
      return new Promise((resolve, reject) => {
        port.addEventListener('message', async ({ data }) => {
          const result = recursiveRevive(data, context) as Promise<ReadableStreamReadResult<any>>
          result
            .then(result => {
              if (result.done) controller.close()
              else controller.enqueue(result.value)
              resolve()
            })
            .catch(reject)
        }, { once: true })
        port.postMessage(recursiveBox({ type: 'pull' }, context))
      })
    },
    cancel() {
      port.postMessage(recursiveBox({ type: 'cancel' }, context))
      port.close()
    }
  }) as T[UnderlyingType]
}
