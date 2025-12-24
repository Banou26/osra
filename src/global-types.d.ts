// ES2024 Uint8Array Base64 methods
// https://github.com/tc39/proposal-arraybuffer-base64

interface Uint8Array<TArrayBuffer extends ArrayBufferLike> {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}

interface MediaSourceHandle {
  __dummy__: never
}
