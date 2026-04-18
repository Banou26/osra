import type { RevivableContext, UnderlyingType, BoxedBuffer } from './utils'

import { BoxBase, boxBuffer, reviveBuffer } from './utils'

export const type = 'arrayBuffer' as const

type BoxedArrayBuffer<T extends ArrayBuffer, T2 extends RevivableContext> =
  & typeof BoxBase
  & { type: typeof type }
  & BoxedBuffer<T2>
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = <T extends ArrayBuffer, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedArrayBuffer<T, T2> =>
  ({ ...BoxBase, type, ...boxBuffer(value, context) }) as unknown as BoxedArrayBuffer<T, T2>

export const revive = <T extends BoxedArrayBuffer<ArrayBuffer, RevivableContext>>(
  value: T,
  _context: RevivableContext,
): T[UnderlyingType] =>
  reviveBuffer(value) as T[UnderlyingType]

const typeCheck = () => {
  const boxed = box(new ArrayBuffer(10), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: ArrayBuffer = revived
  // @ts-expect-error - not an ArrayBuffer
  const notArrayBuffer: string = revived
  // @ts-expect-error - cannot box non-ArrayBuffer
  box('not an array buffer', {} as RevivableContext)
}
