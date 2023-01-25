# osra
what that? https://github.com/GoogleChromeLabs/comlink but nicer to use.
thats about it

how to?
register your functions in the other context like so
```ts
import { makeCallListener, registerListener } from 'osra'

const resolvers = {
  'test': makeCallListener(async (myData) => {
    // do work...
    return {
      foo: 1,
      bar: 'bar',
      baz: () => true
    }
  })
}

registerListener({ target: globalThis, resolvers })
```

and on your current context you can call it easily like
```ts
import { call } from 'osra'

const worker = new Worker('/worker.js', { type: 'module' })

call(worker)('test', { theDataThatWillBeSentToTheOtherContext: 1 })
      .then(({ foo, bar, baz }) => {
        // foo === 1
        // bar === 'bar'
        // baz === callable function that will return a promise with its response
      })
```

all types of data supported by osra that will be correctly proxied/sent to the other context in addition of functions:

```ts
export type TransferableObject =
  ArrayBuffer | MessagePort | ReadableStream | WritableStream |
  TransformStream | /* AudioData | */ ImageBitmap /* | VideoFrame | OffscreenCanvas */

export interface StructuredCloneObject {
  [key: string | number | symbol]: StructuredCloneType
}

export type StructuredCloneType =
  boolean | null | undefined | number | BigInt | string | Date | RegExp | Blob | File | FileList | ArrayBuffer | ArrayBufferView |
  ImageBitmap | ImageData | Array<StructuredCloneType> | StructuredCloneObject | Map<StructuredCloneType, StructuredCloneType> | Set<StructuredCloneType>

export interface StructuredCloneTransferableObject {
  [key: string | number | symbol]: StructuredCloneTransferableType
}

export type StructuredCloneTransferableType =
  StructuredCloneType | TransferableObject | Array<StructuredCloneTransferableType> | StructuredCloneTransferableObject |
  Map<StructuredCloneTransferableType, StructuredCloneTransferableType> | Set<StructuredCloneTransferableType>
```
