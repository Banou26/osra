import type { RevivableContext } from './utils'

import { BoxBase, boxBuffer, reviveBuffer } from './utils'

export const type = 'arrayBuffer' as const

export const isType = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = <T extends ArrayBuffer, T2 extends RevivableContext>(
  value: T,
  context: T2,
) => ({
  ...BoxBase,
  type,
  ...boxBuffer(value, context),
})

export const revive = <T extends ReturnType<typeof box>>(
  value: T,
  _context: RevivableContext,
) => reviveBuffer(value)

const typeCheck = () => {
  const boxed = box(new ArrayBuffer(10), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: ArrayBuffer = revived
  // @ts-expect-error - not an ArrayBuffer
  const notArrayBuffer: string = revived
  // @ts-expect-error - cannot box non-ArrayBuffer
  box('not an array buffer', {} as RevivableContext)
}
