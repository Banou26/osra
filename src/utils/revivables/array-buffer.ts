import type {
  RevivableArrayBuffer,
  RevivableVariant
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'

export const type = 'arrayBuffer'

export const is = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

export const box = (
  value: ArrayBuffer,
  _context: ConnectionRevivableContext
): RevivableVariant & { type: 'arrayBuffer' } => {
  return {
    type,
    base64Buffer: new Uint8Array(value).toBase64() as string
  }
}

export const revive = (
  value: RevivableArrayBuffer,
  _context: ConnectionRevivableContext
): ArrayBuffer => {
  return (Uint8Array.fromBase64(value.base64Buffer) as Uint8Array).buffer as ArrayBuffer
}
