import type { IsJsonOnlyTransport } from '../utils'
import type { RevivableContext } from './utils'

import { BoxBase } from '.'
import { isJsonOnlyTransport } from '../utils'

export const type = 'arrayBuffer' as const

export const isType = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = <T extends RevivableContext>(
  value: ArrayBuffer,
  _context: T
) => ({
  ...BoxBase,
  type,
  ...(
    isJsonOnlyTransport(_context)
      ? { base64Buffer: new Uint8Array(value).toBase64() }
      : { arrayBuffer: value }
  ) as (
      IsJsonOnlyTransport<T['transport']> extends true ? { base64Buffer: string }
    : IsJsonOnlyTransport<T['transport']> extends false ? { arrayBuffer: ArrayBuffer }
    : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }
  )
})

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  _context: T
) =>
  'arrayBuffer' in value ? value.arrayBuffer
  : (
    Uint8Array
      .fromBase64(value.base64Buffer)
      .buffer
  )
