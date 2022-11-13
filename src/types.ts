export type TransferableObject =
  SharedArrayBuffer | ArrayBuffer | MessagePort | ReadableStream | WritableStream |
  TransformStream | /* AudioData | */ ImageBitmap /* | VideoFrame | OffscreenCanvas */

export type StructuredCloneObject = {
  [key: string]: StructuredCloneType
}

export type StructuredCloneType =
  boolean | null | undefined | number | BigInt | string | Date | RegExp | Blob | File | FileList | ArrayBuffer | ArrayBufferView |
  ImageBitmap | ImageData | Array<StructuredCloneType> | StructuredCloneObject | Map<StructuredCloneType, StructuredCloneType> | Set<StructuredCloneType>

export type StructuredCloneTransferableObject = {
  [key: string]: StructuredCloneTransferableType
}

export type StructuredCloneTransferableType =
  StructuredCloneType | TransferableObject | Array<StructuredCloneTransferableType> | StructuredCloneTransferableObject |
  Map<StructuredCloneTransferableType, StructuredCloneTransferableType> | Set<StructuredCloneTransferableType>

export type Target = Window | ServiceWorker | Worker

export type Resolver<T extends StructuredCloneTransferableType> = (data: T, extra: ApiResolverOptions<T>) => any

export type Resolvers<T extends StructuredCloneTransferableType> = {
  [key: string]: Resolver<T>
}

export type ApiResolverOptions<T extends StructuredCloneTransferableType, T2 extends Resolvers<T> = Resolvers<T>, T3 = {}> = T3 & {
  event: MessageEvent<any>
  type: keyof T2
  port: MessagePort
}

export type ApiMessageData<T extends StructuredCloneTransferableType, T2 extends Resolvers<T> = Resolvers<T>> = {
  type: keyof T2
  data: any
  port: MessagePort
  source: string
}
