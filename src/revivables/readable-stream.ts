import type { Capable } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase, recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'

export const type = 'readableStream' as const

export type PullContext = {
  type: 'pull' | 'cancel'
}

export const isType = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const box = <T extends RevivableContext>(
  value: ReadableStream,
  context: T
) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const reader = value.getReader()

  localPort.addEventListener('message', async ({ data }: MessageEvent<PullContext>) => {
    const { type } = recursiveRevive(data, context) as PullContext
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
    ...BoxBase,
    type,
    port: remotePort
  }
}

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T
): ReadableStream => {
  context.messagePorts.add(value.port)
  value.port.start()

  return new ReadableStream({
    start(_controller) {},
    pull(controller) {
      return new Promise((resolve, reject) => {
        value.port.addEventListener('message', async ({ data }: MessageEvent<Capable>) => {
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
