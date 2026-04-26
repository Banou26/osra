import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '../utils/type'
import type { BoxedPromise } from './promise'

import { BoxBase } from './utils'
import { box as boxPromise, revive as revivePromise } from './promise'

export const type = 'blob' as const

export type BoxedBlob<T extends Blob = Blob> =
  & BoxBaseType<typeof type>
  & { mimeType: string }
  & { buffer: BoxedPromise<ArrayBuffer> }
  & { fileName?: string, lastModified?: number }
  & { [UnderlyingType]: Promise<T> }

// File extends Blob and is handled here too — encoding `name` + `lastModified`
// when present so the receiver reconstructs a File rather than dropping to a
// plain Blob. Avoids a runtime/type mismatch where File would type-check as
// Capable but silently coerce.
export const isType = (value: unknown): value is Blob =>
  value instanceof Blob

const isFile = (value: Blob): value is File =>
  typeof File !== 'undefined' && value instanceof File

export const box = <T extends Blob, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedBlob<T> => ({
  ...BoxBase,
  type,
  mimeType: value.type,
  buffer: boxPromise(value.arrayBuffer(), context),
  ...(isFile(value)
    ? { fileName: value.name, lastModified: value.lastModified }
    : {}),
}) as unknown as BoxedBlob<T>

// Blob bytes are fetched async (`blob.arrayBuffer()`), so revive can't
// hand back a Blob synchronously — receivers `await` to get the Blob.
export const revive = <T extends BoxedBlob, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] =>
  revivePromise(value.buffer, context)
    .then(buffer =>
      value.fileName !== undefined && typeof File !== 'undefined'
        ? new File([buffer], value.fileName, {
            type: value.mimeType,
            lastModified: value.lastModified,
          })
        : new Blob([buffer], { type: value.mimeType })) as T[UnderlyingType]

const typeCheck = () => {
  const boxed = box(new Blob(['x'], { type: 'text/plain' }), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Promise<Blob> = revived
  // @ts-expect-error - revived is Promise<Blob>, not a sync Blob
  const notBlob: Blob = revived
  // @ts-expect-error - cannot box non-Blob
  box('not a blob', {} as RevivableContext)
}
