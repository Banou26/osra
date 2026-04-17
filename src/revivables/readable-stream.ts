import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type { TypedMessagePort } from '../utils/typed-message-channel'

import { BoxBase } from './utils'
import { EventChannel } from '../utils/event-channel'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { recursiveBox, recursiveRevive } from '.'
import {
  box as boxMessagePort,
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
  // Clone-capable transports get a real MessageChannel so the remote port is
  // transferred directly (message-port fast path). JSON-only transports fall
  // back to EventChannel, which routes through the portId handler.
  const isJson = isJsonOnlyTransport(context.transport)
  const { port1: localPort, port2: remotePort } = isJson
    ? new EventChannel<Msg, Msg>()
    : new MessageChannel() as unknown as { port1: TypedMessagePort<Msg>, port2: TypedMessagePort<Msg> }

  const reader = value.getReader()

  localPort.addEventListener('message', ({ data }) => {
    // pull/cancel are plain primitives — no reviving needed on clone path.
    if ('type' in data && data.type === 'pull') {
      // reader.read() returns a Promise; on clone path we must box it so it
      // survives the structured-clone hop to the peer port.
      const chunk = reader.read()
      if (isJson) {
        localPort.postMessage(chunk)
      } else {
        const boxed = recursiveBox(chunk, context)
        ;(localPort as TypedMessagePort<Msg>).postMessage(boxed as unknown as Msg, getTransferableObjects(boxed))
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
    port: boxMessagePort(remotePort, context)
  } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  const isJson = isJsonOnlyTransport(context.transport)
  port.start()

  return new ReadableStream({
    pull: (controller) => new Promise<void>((resolve, reject) => {
      port.addEventListener('message', ({ data }) => {
        // Chunks arrive as boxed Promises on clone transports, as live
        // Promises on JSON (message-port's portId handler revived already).
        const chunk = isJson ? data : recursiveRevive(data, context) as Msg
        if (!(chunk instanceof Promise)) return
        chunk
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
