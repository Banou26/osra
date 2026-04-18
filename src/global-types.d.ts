// ES2024 Uint8Array Base64 methods
// https://github.com/tc39/proposal-arraybuffer-base64

interface Uint8Array<TArrayBuffer extends ArrayBufferLike> {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}

// MediaSourceHandle is referenced by the lib's `Transferable` union but
// isn't yet declared in the bundled lib — without this shim, `Transferable`
// collapses and breaks every narrowing chain that references it.
interface MediaSourceHandle {
  __dummy__: never
}
