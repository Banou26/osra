import type { Capable, Uuid } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'

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
  if (isJsonOnlyTransport(context.transport)) {
    // JSON transport: use messageChannels/eventTarget pattern
    const { uuid: portId } = context.messageChannels.alloc()
    const reader = value.getReader()

    context.eventTarget.addEventListener('message', async function listener({ detail: message }) {
      if (message.type !== 'message' || message.portId !== portId) return
      const { type } = recursiveRevive(message.data, context) as PullContext
      if (type === 'pull') {
        const pullResult = reader.read()
        context.sendMessage({
          type: 'message',
          remoteUuid: context.remoteUuid,
          data: recursiveBox(pullResult, context) as Capable,
          portId
        })
      } else {
        reader.cancel()
        context.eventTarget.removeEventListener('message', listener)
        context.messageChannels.free(portId)
      }
    })

    return {
      ...BoxBase,
      type,
      portId
    }
  }

  // Capable transport: use MessagePort directly
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
  if ('portId' in value) {
    // JSON transport: use messageChannels/eventTarget pattern
    const existingChannel = context.messageChannels.get(value.portId)
    const { port1 } = existingChannel
      ? existingChannel
      : context.messageChannels.alloc(value.portId as Uuid)
    port1.start()

    return new ReadableStream({
      start(_controller) {},
      pull(controller) {
        return new Promise((resolve, reject) => {
          port1.addEventListener('message', function listener({ data: message }) {
            if (message.type !== 'message' || message.portId !== value.portId) return
            port1.removeEventListener('message', listener)
            const result = recursiveRevive(message.data, context) as Promise<ReadableStreamReadResult<any>>
            result
              .then(result => {
                if (result.done) controller.close()
                else controller.enqueue(result.value)
                resolve()
              })
              .catch(reject)
          })
          context.sendMessage({
            type: 'message',
            remoteUuid: context.remoteUuid,
            data: recursiveBox({ type: 'pull' }, context) as Capable,
            portId: value.portId as Uuid
          })
        })
      },
      cancel() {
        context.sendMessage({
          type: 'message',
          remoteUuid: context.remoteUuid,
          data: recursiveBox({ type: 'cancel' }, context) as Capable,
          portId: value.portId as Uuid
        })
        context.messageChannels.free(value.portId)
      }
    })
  }

  // Capable transport: use MessagePort directly
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
