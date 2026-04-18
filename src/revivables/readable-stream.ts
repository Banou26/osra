import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'

import { BoxBase } from './utils'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
  BoxedMessagePort
} from './message-port'

export const type = 'readableStream' as const

export type PullContext = {
  type: 'pull' | 'cancel'
}

type ChunkMessage<T = unknown> = Promise<ReadableStreamReadResult<T>>

type Msg = PullContext | ChunkMessage

export type BoxedReadableStream<T extends ReadableStream = ReadableStream> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<Msg> }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const box = <T extends ReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): BoxedReadableStream<T> => {
  const { localPort, boxedRemote } = createRevivableChannel<Msg>(context)
  const reader = value.getReader()

  localPort.addEventListener('message', ({ data }) => {
    if ('type' in data && data.type === 'pull') {
      // reader.read() is a Promise — posting it live works because localPort
      // (ProtocolPort or EventPort) boxes it internally for the transport.
      localPort.postMessage(reader.read())
    } else {
      reader.cancel()
      localPort.close()
    }
  })
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  port.start()

  return new ReadableStream({
    pull: (controller) => new Promise<void>((resolve, reject) => {
      port.addEventListener('message', ({ data }) => {
        if (!(data instanceof Promise)) return
        data
          .then(result => {
            if (result.done) controller.close()
            else controller.enqueue(result.value)
            resolve()
          })
          .catch(reject)
      }, { once: true })
      port.postMessage({ type: 'pull' })
    }),
    cancel: () => {
      port.postMessage({ type: 'cancel' })
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
