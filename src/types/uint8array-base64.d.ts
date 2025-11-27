/**
 * Type declarations for Uint8Array Base64 methods (Stage 4 proposal).
 * @see https://github.com/tc39/proposal-arraybuffer-base64
 */
interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  /**
   * Encodes the Uint8Array to a Base64 string.
   */
  toBase64(): string

  /**
   * Encodes the Uint8Array to a Base64 string with optional alphabet.
   */
  toBase64(options?: { alphabet?: 'base64' | 'base64url' }): string

  /**
   * Encodes the Uint8Array to a hexadecimal string.
   */
  toHex(): string
}

interface Uint8ArrayConstructor {
  /**
   * Creates a Uint8Array from a Base64 encoded string.
   */
  fromBase64(base64: string, options?: { alphabet?: 'base64' | 'base64url'; lastChunkHandling?: 'loose' | 'strict' | 'stop-before-partial' }): Uint8Array

  /**
   * Creates a Uint8Array from a hexadecimal string.
   */
  fromHex(hex: string): Uint8Array
}
