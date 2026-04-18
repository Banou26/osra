import type { IsJsonOnlyTransport } from '../utils'
import type { RevivableContext, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { isJsonOnlyTransport } from '../utils'

export const type = 'arrayBuffer' as const

type BoxedArrayBuffer<T extends ArrayBuffer, T2 extends RevivableContext> =
  & typeof BoxBase
  & { type: typeof type }
  & (
      IsJsonOnlyTransport<T2['transport']> extends true ? { base64Buffer: string }
    : IsJsonOnlyTransport<T2['transport']> extends false ? { arrayBuffer: ArrayBuffer }
    : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }
  )
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = <T extends ArrayBuffer, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedArrayBuffer<T, T2> =>
  (isJsonOnlyTransport(context.transport)
    ? { ...BoxBase, type, base64Buffer: new Uint8Array(value).toBase64() }
    : { ...BoxBase, type, arrayBuffer: value }
  ) as unknown as BoxedArrayBuffer<T, T2>

export const revive = <T extends BoxedArrayBuffer<ArrayBuffer, RevivableContext>>(
  value: T,
  _context: RevivableContext,
): T[UnderlyingType] =>
  ('arrayBuffer' in value
    ? value.arrayBuffer
    : Uint8Array.fromBase64(value.base64Buffer).buffer
  ) as T[UnderlyingType]

const typeCheck = () => {
  const boxed = box(new ArrayBuffer(10), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: ArrayBuffer = revived
  // @ts-expect-error - not an ArrayBuffer
  const notArrayBuffer: string = revived
  // @ts-expect-error - cannot box non-ArrayBuffer
  box('not an array buffer', {} as RevivableContext)
}
