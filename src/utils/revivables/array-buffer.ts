import type { ConnectionRevivableContext } from '../connection'

export const type = 'arrayBuffer' as const

export type Source = ArrayBuffer

export type Boxed = {
  type: typeof type
  base64Buffer: string
}

export const is = (value: unknown): value is Source =>
  value instanceof ArrayBuffer

export const shouldBox = (_value: Source, context: ConnectionRevivableContext): boolean =>
  'isJson' in context.transport && Boolean(context.transport.isJson)

export const box = (
  value: Source,
  _context: ConnectionRevivableContext
): Boxed => {
  return {
    type,
    base64Buffer: new Uint8Array(value).toBase64() as string
  }
}

export const revive = (
  value: Boxed,
  _context: ConnectionRevivableContext
): Source => {
  return (Uint8Array.fromBase64(value.base64Buffer) as Uint8Array).buffer as ArrayBuffer
}
