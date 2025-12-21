import type { Capable } from '../../types'
import type { ConnectionRevivableContext } from '../connection'

import { OSRA_BOX } from '../../types'
import { isRevivablePromiseBox } from '../type-guards'
import { getTransferableObjects } from '../transferable'

export const type = 'readableStream' as const

export type Source = ReadableStream

export type Boxed = {
  type: typeof type
  port: MessagePort
}

export type Box = { [OSRA_BOX]: 'revivable' } & Boxed

// Context type for pull/cancel messages
export type PullContext = {
  type: 'pull' | 'cancel'
}

export const is = (value: unknown): value is Source =>
  value instanceof ReadableStream

export const isBox = (value: unknown): value is Box =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable' &&
  (value as Record<string, unknown>).type === type

export const shouldBox = (_value: Source, context: ConnectionRevivableContext): boolean =>
  !context.platformCapabilities.transferableStream
  || ('isJson' in context.transport && Boolean(context.transport.isJson))

export const box = (
  value: Source,
  context: ConnectionRevivableContext
): Boxed => {
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const reader = value.getReader()

  localPort.addEventListener('message', async ({ data }:  MessageEvent<PullContext>) => {
    const { type } = context.recursiveRevive(data, context) as PullContext
    if (type === 'pull') {
      const pullResult = reader.read()
      const boxedResult = context.recursiveBox(pullResult, context)
      localPort.postMessage(boxedResult, getTransferableObjects(boxedResult))
    } else {
      reader.cancel()
      localPort.close()
    }
  })
  localPort.start()

  return {
    type,
    port: remotePort
  }
}

export const revive = (
  value: Boxed,
  context: ConnectionRevivableContext
): Source => {
  context.messagePorts.add(value.port)
  value.port.start()
  return new ReadableStream({
    start(controller) {},
    pull(controller) {
      return new Promise((resolve, reject) => {
        value.port.addEventListener('message', async ({ data }: MessageEvent<Capable>) => {
          if (!isRevivablePromiseBox(data)) throw new Error(`Proxied function did not return a promise`)
          const result = context.recursiveRevive(data, context) as Promise<ReadableStreamReadResult<any>>
          result
            .then(result => {
              if (result.done) controller.close()
              else controller.enqueue(result.value)
              resolve()
            })
            .catch(reject)
        }, { once: true })
        value.port.postMessage(context.recursiveBox({ type: 'pull' }, context))
      })
    },
    cancel() {
      value.port.postMessage(context.recursiveBox({ type: 'cancel' }, context))
      value.port.close()
    }
  })
}
