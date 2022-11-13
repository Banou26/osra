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

/**
 * Solution by mkantor#7432
 * https://www.typescriptlang.org/play#code/C4TwDgpgBACghgJzgWwsCCDOBBBEBCcA5pgPIBmAysAgJYB2J29AJgHICuyARhpgDwAVKBAAe6VpigAKFnGBwAXFHoQAbhgCUUALwA+KB3oBregHsA7vQM6AUFBmz5SqACUIAYzMIW-GAjNIBFAAaQgQABooTBoGIigAHxUuXgQ9bX0VdS0RcQhJKGEAfkKoZVUNBFtbUEgoADU4ABtaOXR3TDMmyoFhMQkWKXcvHz8AoNDwqKcFcuyEDIMjU0trG3tS-vzBqABvKABtEKgGKGNws3JCgF1leCRUdCxcAmIyKljGHFZOHj4hI7XAwAXygJUEGzmlWqXnoMSgeHiOigQlyAyGnm8vn8gQwk0iMjaLgqOUyy3MVj0emkeE63T4ykaLTaEA6XR6QnSymEmV2GzwwA4CHohlYEHIDAgLCgcCk5NWMqkEOBMLMcOACIgUmRiOkfIc5DMZmUspA9A8hOcyn2huN0U+8WBiz2wIiG24iBNmDNFr1UFtUGB1v9RvKKQwgedu1d7rgAC8vT6ZPsPQhA8HU2G-mmnboDNHbE6gA
 * https://discord.gg/typescript
 * https://discord.com/channels/508357248330760243/1041386152315342999
 */
export type RestrictedParametersType<T extends (data: never, extra: ApiResolverOptions) => unknown> =
  ((data: Record<PropertyKey, StructuredCloneTransferableType>, extra?: ApiResolverOptions) => never) extends T
    ? T
    : never

export type ValidateResolvers<T extends Record<PropertyKey, (data: never, extra: ApiResolverOptions) => unknown>> =
  T extends { [K in keyof T]: RestrictedParametersType<T[K]> }
    ? T
    : never

export type Resolvers = Record<PropertyKey, (data: never, extra: ApiResolverOptions) => unknown>

export type ApiResolverOptions<T2 extends Resolvers = Resolvers, T3 = {}> = T3 & {
  event: MessageEvent<any>
  type: keyof T2
  port: MessagePort
}

export type ApiMessageData<T2 extends Resolvers = Resolvers> = {
  type: keyof T2
  data: any
  port: MessagePort
  source: string
}
