import type { Capable, Uuid } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T extends RevivableContext>(
  value: Promise<any>,
  context: T
) => {
  if (isJsonOnlyTransport(context.transport)) {
    // JSON transport: use messageChannels/eventTarget pattern
    const { uuid: portId, port1: localPort } = context.messageChannels.alloc()

    const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: recursiveBox(result, context) as Capable,
        portId
      })
      context.messageChannels.free(portId)
    }

    value
      .then(data => sendResult({ type: 'resolve', data }))
      .catch(error => sendResult({ type: 'reject', error: error?.stack ?? String(error) }))

    return {
      ...BoxBase,
      type,
      portId
    }
  }

  // Capable transport: use MessagePort directly
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const sendResult = (result: { type: 'resolve', data: Capable } | { type: 'reject', error: string }) => {
    const boxedResult = recursiveBox(result, context)
    localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    localPort.close()
  }

  value
    .then(data => sendResult({ type: 'resolve', data }))
    .catch(error => sendResult({ type: 'reject', error: error?.stack ?? String(error) }))

  return {
    ...BoxBase,
    type,
    port: remotePort
  }
}

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T
): Promise<any> => {
  if ('portId' in value) {
    // JSON transport: use messageChannels/eventTarget pattern
    const existingChannel = context.messageChannels.get(value.portId)
    const { port1 } = existingChannel
      ? existingChannel
      : context.messageChannels.alloc(value.portId as Uuid)

    return new Promise((resolve, reject) => {
      port1.addEventListener('message', function listener({ data: message }) {
        if (message.type !== 'message' || message.portId !== value.portId) return
        port1.removeEventListener('message', listener)
        const result = recursiveRevive(message.data, context) as Context
        if (result.type === 'resolve') {
          resolve(result.data)
        } else {
          reject(result.error)
        }
        context.messageChannels.free(value.portId)
      })
      port1.start()
    })
  }

  // Capable transport: use MessagePort directly
  context.messagePorts.add(value.port)
  return new Promise((resolve, reject) => {
    value.port.addEventListener('message', ({ data }: MessageEvent<Context>) => {
      const result = recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data)
      } else {
        reject(result.error)
      }
      value.port.close()
    }, { once: true })
    value.port.start()
  })
}
