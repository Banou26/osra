export const OSRA_MESSAGE_PROPERTY = '__OSRA__' as const
export const OSRA_MESSAGE_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_PROXY = '__OSRA_PROXY__' as const

export type JsonPropertyKey = string | number
export type JsonCloneType =
  | boolean
  | null
  | number
  | string
  | { [key: string]: JsonCloneType }
  | Array<JsonCloneType>

export type StructuredCloneType =
  | JsonCloneType
  | void
  | undefined
  | BigInt
  | Date
  | RegExp
  | Blob
  | File
  | FileList
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | ImageData
  | { [key: string]: StructuredCloneType }
  | Array<StructuredCloneType>
  | Map<StructuredCloneType, StructuredCloneType>
  | Set<StructuredCloneType>

export type TransferableObject =
  | SharedArrayBuffer
  | ArrayBuffer
  | MessagePort
  | ReadableStream
  /*
  | WritableStream
  | TransformStream
  | ImageBitmap
  | AudioData
  | VideoFrame
  | OffscreenCanvas
  */

export type StructuredCloneTransferableType =
  | StructuredCloneType
  | TransferableObject
  | { [key: string]: StructuredCloneTransferableType }
  | Array<StructuredCloneTransferableType>
  | Map<StructuredCloneTransferableType, StructuredCloneTransferableType>
  | Set<StructuredCloneTransferableType>

export type ProxiableType =
  | Promise<StructuredCloneTransferableProxiableType>
  | Error
  | MessagePort
  | ReadableStream
  | ((...args: any[]) => Promise<StructuredCloneTransferableProxiableType>)
  // | ((...args: StructuredCloneTransferableProxiableType[]) => StructuredCloneTransferableProxiableType)
  | { [key: string]: StructuredCloneTransferableProxiableType }
  | Array<StructuredCloneTransferableProxiableType>
  | Map<StructuredCloneTransferableProxiableType, StructuredCloneTransferableProxiableType>
  | Set<StructuredCloneTransferableProxiableType>

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
