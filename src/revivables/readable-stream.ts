import type { Capable } from '../types.js'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils.js'
import type { UnderlyingType } from './index.js'

import { BoxBase } from './utils.js'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
  BoxedMessagePort
} from './message-port.js'

export const type = 'readableStream' as const

export type PullContext =
  | { type: 'pull' }
  | { type: 'cancel', reason?: Capable }

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
      // reader.read() is a Promise — localPort boxes it for the transport.
      localPort.postMessage(reader.read())
    } else {
      reader.cancel('type' in data ? data.reason : undefined).catch(() => {})
      localPort.close()
    }
  })
  // Abnormal channel death (consumer dropped, connection closed): stop the
  // producer and release the source lock instead of leaking both forever.
  localPort.addEventListener('close', () => {
    reader.cancel(new Error('osra: connection closed')).catch(() => {})
  }, { once: true })
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  port.start()

  let done = false
  return new ReadableStream({
    start: (controller) => {
      // Channel death mid-stream (source dropped, connection closed): error
      // the consumer instead of hanging its pending read forever.
      port.addEventListener('close', () => {
        if (done) return
        done = true
        try { controller.error(new Error('osra: connection closed')) } catch { /* already settled */ }
      }, { once: true })
    },
    pull: (controller) => new Promise<void>((resolve, reject) => {
      port.addEventListener('message', ({ data }) => {
        if (!(data instanceof Promise)) return
        data
          .then(result => {
            if (result.done) {
              done = true
              controller.close()
              // Stream exhausted — release the channel on both sides.
              port.postMessage({ type: 'cancel' })
              queueMicrotask(() => port.close())
            }
            else controller.enqueue(result.value)
            resolve()
          })
          .catch(error => {
            done = true
            reject(error)
          })
      }, { once: true })
      port.postMessage({ type: 'pull' })
    }),
    cancel: (reason) => {
      done = true
      port.postMessage({ type: 'cancel', reason: reason as Capable })
      // Defer close so the cancel message dispatches before tear-down.
      queueMicrotask(() => port.close())
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
