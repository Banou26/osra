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

export type Resolver = (data: StructuredCloneTransferableType, extra: ApiResolverOptions) => any

export type Resolvers = {
  [key: string]: Resolver
}

export type ApiResolverOptions<T extends Resolvers = Resolvers, T2 = {}> = T2 & {
  event: MessageEvent<any>
  type: keyof T
  port: MessagePort
}

export type ApiMessageData<T extends Resolvers = Resolvers> = {
  type: keyof T
  data: any
  port: MessagePort
  source: string
}
