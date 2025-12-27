import type { IsJsonOnlyTransport } from '../utils'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { isJsonOnlyTransport } from '../utils'

export const type = 'arrayBuffer' as const

export const isType = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = <T extends ArrayBuffer, T2 extends RevivableContext>(
  value: T,
  _context: T2
) => ({
  ...BoxBase,
  type,
  ...(
    isJsonOnlyTransport(_context.transport)
      ? { base64Buffer: new Uint8Array(value).toBase64() }
      : { arrayBuffer: value }
  ) as (
      IsJsonOnlyTransport<T2['transport']> extends true ? { base64Buffer: string }
    : IsJsonOnlyTransport<T2['transport']> extends false ? { arrayBuffer: ArrayBuffer }
    : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }
  )
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  _context: T2
) =>
  'arrayBuffer' in value ? value.arrayBuffer
  : (
    Uint8Array
      .fromBase64(value.base64Buffer)
      .buffer
  )
