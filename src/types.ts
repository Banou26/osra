export type TransferableObject =
  ArrayBuffer | MessagePort | ReadableStream | WritableStream |
  TransformStream | /* AudioData | */ ImageBitmap /* | VideoFrame | OffscreenCanvas */

export interface StructuredCloneObject {
  [key: string | number | symbol]: StructuredCloneType
}

export type StructuredCloneType =
  boolean | null | undefined | number | BigInt | string | Date | RegExp | Blob | File | FileList | ArrayBuffer | ArrayBufferView |
  ImageBitmap | ImageData | Array<StructuredCloneType> | StructuredCloneObject | Map<StructuredCloneType, StructuredCloneType> | Set<StructuredCloneType>

export interface StructruredCloneTransferableObject {
  [key: string | number | symbol]: StructruredCloneTransferableType
}

export type StructruredCloneTransferableType =
  StructuredCloneType | TransferableObject | Array<StructruredCloneTransferableType> | StructruredCloneTransferableObject |
  Map<StructruredCloneTransferableType, StructruredCloneTransferableType> | Set<StructruredCloneTransferableType>

export type Target = Window | ServiceWorker | Worker

export type Resolver = (data: StructruredCloneTransferableType, extra?: ApiResolverOptions) => any

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
