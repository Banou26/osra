export const OSRA_MESSAGE_PROPERTY = '__OSRA__' as const
export const OSRA_MESSAGE_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_PROXY = '__OSRA_PROXY__' as const

export type JsonPropertyKey = string | number
export type JsonCloneType = boolean | null | number | string | Array<JsonCloneType> | { [key: string]: JsonCloneType }

export type StructuredCloneType =
  JsonCloneType | void | undefined | BigInt | Date | RegExp | Blob | File | FileList | ArrayBuffer | ArrayBufferView |
  ImageBitmap | ImageData | Array<StructuredCloneType> | { [key: string]: StructuredCloneType } | Map<StructuredCloneType, StructuredCloneType> | Set<StructuredCloneType>

export type TransferableObject =
  SharedArrayBuffer | ArrayBuffer | MessagePort | ReadableStream | WritableStream |
  TransformStream | ImageBitmap /* | AudioData | VideoFrame | OffscreenCanvas */

export type StructuredCloneTransferableType =
  StructuredCloneType | TransferableObject | { [key: string]: StructuredCloneTransferableType } |Array<StructuredCloneTransferableType> |
  Map<StructuredCloneTransferableType, StructuredCloneTransferableType> | Set<StructuredCloneTransferableType>

export type ProxiableType =
  Promise<StructuredCloneTransferableType> | Error | MessagePort | ReadableStream | 
  ((...args: StructuredCloneTransferableType[]) => StructuredCloneTransferableType | Promise<StructuredCloneTransferableType>)

export type StructuredCloneTransferableProxiableType = ProxiableType | StructuredCloneTransferableType

type PortOrJsonPort<JsonOnly extends boolean> = JsonOnly extends true ? { portId: string } : { port: MessagePort }
type StructuredCloneDataOrJsonData<JsonOnly extends boolean> = JsonOnly extends true ? JsonCloneType : StructuredCloneType

export type ProxiedFunctionType<JsonOnly extends boolean> = ({ type: 'function' } & PortOrJsonPort<JsonOnly>)
export type ProxiedMessagePortType<JsonOnly extends boolean> = ({ type: 'messagePort' } & PortOrJsonPort<JsonOnly>)
export type ProxiedPromiseType<JsonOnly extends boolean> = ({ type: 'promise' } & PortOrJsonPort<JsonOnly>)
export type ProxiedReadableStreamType<JsonOnly extends boolean> = ({ type: 'readableStream' } & PortOrJsonPort<JsonOnly>)
export type ProxiedErrorType = ({ type: 'error', message: string, stack?: string })

export type ProxiedType<JsonOnly extends boolean> =
  { [OSRA_PROXY]: true } & (
    | ProxiedFunctionType<JsonOnly>
    | ProxiedMessagePortType<JsonOnly>
    | ProxiedPromiseType<JsonOnly>
    | ProxiedReadableStreamType<JsonOnly>
    | ProxiedErrorType
  )
export type OsraMessage =
  { [OSRA_MESSAGE_PROPERTY]: true, key: string } & (
    | { type: 'ready', envCheck: { buffer: ArrayBuffer, port: MessagePort } }
    | { type: 'init', data: StructuredCloneTransferableType }
    | { type: 'message', portId: string, data: any } // message not needed if transferring MessagePort is supported
    | { type: 'port-closed', portId: string } // message not needed if transferring MessagePort is supported
  )

export type RemoteTarget = Window | ServiceWorker | Worker | MessagePort
export type LocalTarget = WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker

export type Resolver = (...data: any[]) => StructuredCloneTransferableType | Promise<StructuredCloneTransferableType>
export type ResolverToValidatedResolver<T extends Resolver> = (extra: OsraMessage) => (...data: Parameters<T>) => Promise<Awaited<ReturnType<T>>>
export type ValidatedResolver = (extra: OsraMessage) => Resolver

/**
 * Solution by mkantor#7432
 * https://www.typescriptlang.org/play#code/C4TwDgpgBACghgJzgWwsCCDOBBBEBCcA5pgPIBmAysAgJYB2J29AJgHICuyARhpgDwAVKBAAe6VpigAKFnGBwAXFHoQAbhgCUUALwA+KB3oBregHsA7vQM6AUFBmz5SqACUIAYzMIW-GAjNIBFAAaQgQABooTBoGIigAHxUuXgQ9bX0VdS0RcQhJKGEAfkKoZVUNBFtbUEgoADU4ABtaOXR3TDMmyoFhMQkWKXcvHz8AoNDwqKcFcuyEDIMjU0trG3tS-vzBqABvKABtEKgGKGNws3JCgF1leCRUdCxcAmIyKljGHFZOHj4hI7XAwAXygJUEGzmlWqXnoMSgeHiOigQlyAyGnm8vn8gQwk0iMjaLgqOUyy3MVj0emkeE63T4ykaLTaEA6XR6QnSymEmV2GzwwA4CHohlYEHIDAgLCgcCk5NWMqkEOBMLMcOACIgUmRiOkfIc5DMZmUspA9A8hOcyn2huN0U+8WBiz2wIiG24iBNmDNFr1UFtUGB1v9RvKKQwgedu1d7rgAC8vT6ZPsPQhA8HU2G-mmnboDNHbE6gA
 * https://discord.gg/typescript
 * https://discord.com/channels/508357248330760243/1041386152315342999
 * +
 * saghen#6423 from friend discord https://discord.com/channels/790293936589504523/819301407215190026/1067635967801962587
 */
export type RestrictedParametersType<T extends ValidatedResolver> =
  Parameters<ReturnType<T>> extends Array<StructuredCloneTransferableType> ? T
  : never

export type ValidatedResolversOrNever<T extends Record<JsonPropertyKey, ValidatedResolver>> =
  T extends { [K in keyof T]: RestrictedParametersType<T[K]> }
    ? T
    : never

export type RestrictParametersType<T extends Resolver> =
  Parameters<T> extends Array<StructuredCloneTransferableType> ? T
  : never

export type ResolversOrNever<T extends Record<JsonPropertyKey, Resolver>> =
  T extends { [K in keyof T]: RestrictParametersType<T[K]> }
    ? T
    : never

export type Resolvers = Record<JsonPropertyKey, Resolver>
export type ValidatedResolvers = Record<JsonPropertyKey, ValidatedResolver>
