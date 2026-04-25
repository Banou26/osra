import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type { HandleId } from '../utils/remote-handle'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'readableStream' as const

type Outgoing = ReadableStreamReadResult<Capable>
type Incoming = { type: 'pull' } | { type: 'cancel' }

export type BoxedReadableStream<T extends ReadableStream = ReadableStream> =
  & BoxBaseType<typeof type>
  & { handleId: HandleId }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is ReadableStream =>
  value instanceof ReadableStream

export const box = <T extends ReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedReadableStream<T> => {
  const reader = value.getReader()
  const handle = createHandle(context, {
    onMessage: (payload) => {
      const message = payload as Incoming
      if (message.type === 'pull') {
        reader.read().then(
          (result) => {
            try {
              handle.send(recursiveBox(result as unknown as Capable, context))
            } catch { /* chunk not serialisable / connection torn down */ }
            if (result.done) handle.release()
          },
          () => {
            // Read error: surface as `done: true` on a fresh chunk message
            // so the receiver's pull-promise rejects cleanly.
            try {
              handle.send(recursiveBox(
                { done: true, value: undefined } satisfies Outgoing as unknown as Capable,
                context,
              ))
            } catch { /* connection torn down */ }
            handle.release()
            try { reader.releaseLock() } catch { /* may be released */ }
          },
        )
        return
      }
      // 'cancel' — receiver tore down their stream
      reader.cancel().catch(() => {/* cancel can reject; drop */})
      handle.release()
    },
  })
  return { ...BoxBase, type, handleId: handle.id } as BoxedReadableStream<T>
}

export const revive = <T extends BoxedReadableStream, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  let pendingPull: { resolve: () => void, reject: (e: unknown) => void, controller: ReadableStreamDefaultController } | undefined

  const handle = adoptHandle(context, value.handleId, {
    onMessage: (payload) => {
      const result = recursiveRevive(payload, context) as Outgoing
      const p = pendingPull
      if (!p) return
      pendingPull = undefined
      if (result.done) p.controller.close()
      else p.controller.enqueue(result.value)
      p.resolve()
    },
    onRelease: () => {
      // Owner side dropped — fail any pending pull so the consumer stops
      // hanging.
      const p = pendingPull
      if (p) {
        pendingPull = undefined
        p.reject(new Error('osra readable-stream was released before pull resolved'))
      }
    },
  })

  return new ReadableStream({
    pull: (controller) => new Promise<void>((resolve, reject) => {
      pendingPull = { resolve, reject, controller }
      try { handle.send({ type: 'pull' } satisfies Incoming as Capable) }
      catch (sendErr) {
        pendingPull = undefined
        reject(sendErr)
      }
    }),
    cancel: () => {
      try { handle.send({ type: 'cancel' } satisfies Incoming as Capable) }
      catch { /* connection torn down */ }
      handle.release()
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
