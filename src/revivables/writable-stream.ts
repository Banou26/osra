import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type { Capable } from '../types'

import { BoxBase } from './utils'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
  BoxedMessagePort,
} from './message-port'
import { associatePort } from '../utils/stale'

export const type = 'writableStream' as const

// Outgoing wire shape (revive → box): one of these per call.
export type WriteContext =
  | { type: 'write', chunk: Capable }
  | { type: 'close' }
  | { type: 'abort', reason: Capable }

// Reply from box → revive after a write completes (so writer.write() awaits).
export type WriteAck =
  | { type: 'ack' }
  | { type: 'err', error: string }

export type Msg = WriteContext | WriteAck

export type BoxedWritableStream<T extends WritableStream = WritableStream> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<Msg> }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is WritableStream =>
  value instanceof WritableStream

export const box = <T extends WritableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): BoxedWritableStream<T> => {
  const { localPort, boxedRemote } = createRevivableChannel<Msg>(context)
  const writer = value.getWriter()

  localPort.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object' || !('type' in data)) return
    if (data.type === 'write') {
      writer.write((data as { chunk: Capable }).chunk as any)
        .then(() => localPort.postMessage({ type: 'ack' }))
        .catch((err) => localPort.postMessage({ type: 'err', error: (err as Error)?.message ?? String(err) }))
    } else if (data.type === 'close') {
      writer.close()
        .then(() => localPort.postMessage({ type: 'ack' }))
        .catch((err) => localPort.postMessage({ type: 'err', error: (err as Error)?.message ?? String(err) }))
    } else if (data.type === 'abort') {
      writer.abort((data as { reason: Capable }).reason as any)
        .then(() => localPort.postMessage({ type: 'ack' }))
        .catch((err) => localPort.postMessage({ type: 'err', error: (err as Error)?.message ?? String(err) }))
    }
  })
  localPort.start()

  return { ...BoxBase, type, port: boxedRemote } as BoxedWritableStream<T>
}

export const revive = <T extends BoxedWritableStream, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  const port = reviveMessagePort(value.port, context)
  port.start()

  // Each `write` call posts a 'write' message and awaits an 'ack'/'err'.
  // The port is shared, so we serialize via a chain — without it, two
  // concurrent writes would race and could mis-pair their ack messages.
  let chain: Promise<void> = Promise.resolve()
  const request = (msg: WriteContext): Promise<void> => {
    const next = chain.then(() => new Promise<void>((resolve, reject) => {
      port.addEventListener('message', ({ data }) => {
        if (!data || typeof data !== 'object' || !('type' in data)) return
        if ((data as { type: string }).type === 'ack') resolve()
        else if ((data as { type: string }).type === 'err') reject(new Error((data as { error: string }).error))
      }, { once: true })
      port.postMessage(msg as Msg)
    }))
    chain = next.catch(() => {})
    return next
  }

  const stream = new WritableStream({
    write: (chunk) => request({ type: 'write', chunk: chunk as Capable }),
    close: () => request({ type: 'close' }),
    abort: (reason) => request({ type: 'abort', reason: reason as Capable }),
  }) as T[UnderlyingType]
  associatePort(stream, port, context)
  return stream
}

const typeCheck = () => {
  const stream = new WritableStream<number>()
  const boxed = box(stream, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: WritableStream<number> = revived
  // @ts-expect-error - wrong stream type
  const wrongType: WritableStream<string> = revived
  // @ts-expect-error - not a WritableStream
  box('not a stream', {} as RevivableContext)
}
