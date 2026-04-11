import type { RevivableContext } from './utils'
import type { UnderlyingType } from '.'

import { BoxBase } from './utils'
import { CapableChannel } from '../utils/message-channel'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'readableStream' as const

export type PullContext = {
  type: 'pull' | 'cancel'
}

export type StreamChunk = ReadableStreamReadResult<any>

type WireMessage = PullContext | StreamChunk

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
  context: T2,
): BoxedReadableStream<T> => {
  // CapableChannel — chunks can be arbitrary JS values including things
  // that wouldn't survive structured clone. The boundary at message-port
  // handles the wire format.
  const { port1: localPort, port2: remotePort } = new CapableChannel<WireMessage, WireMessage>()

  const reader = value.getReader()

  localPort.addEventListener('message', async (event) => {
    const data = (event as MessageEvent<PullContext>).data
    if (data.type === 'pull') {
      try {
        const result = await reader.read()
        localPort.postMessage(result)
        if (result.done) localPort.close()
      } catch {
        localPort.close()
      }
    } else {
      reader.cancel()
      localPort.close()
    }
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort, context),
  } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort<WireMessage>, context)
  port.start()

  return new ReadableStream({
    start(_controller) {},
    pull(controller) {
      return new Promise<void>((resolve, reject) => {
        port.addEventListener('message', (event) => {
          const result = (event as unknown as MessageEvent<StreamChunk>).data
          if (result.done) controller.close()
          else controller.enqueue(result.value)
          resolve()
        }, { once: true })
        port.postMessage({ type: 'pull' } as unknown as WireMessage)
      })
    },
    cancel() {
      port.postMessage({ type: 'cancel' } as unknown as WireMessage)
      port.close()
    },
  }) as T[UnderlyingType]
}

const typeCheck = () => {
  const stream = new ReadableStream<number>()
  const boxed = box(stream, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: ReadableStream<number> = revived
  // @ts-expect-error - wrong stream type
  const wrongType: ReadableStream<string> = revived
  // @ts-expect-error - not a ReadableStream
  box('not a stream', {} as RevivableContext)
}
