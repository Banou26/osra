import { WebExtPort, WebExtRuntime } from "./utils"

export const OSRA_MESSAGE_PROPERTY = '__OSRA__' as const
export const OSRA_MESSAGE_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_PROXY = '__OSRA_PROXY__' as const

export type JsonClone =
  | boolean
  | null
  | number
  | string
  | { [key: string]: JsonClone }
  | Array<JsonClone>

export type StructuredClone =
  | JsonClone
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
  | { [key: string]: StructuredClone }
  | Array<StructuredClone>
  | Map<StructuredClone, StructuredClone>
  | Set<StructuredClone>

export type TransferableObject =
  | SharedArrayBuffer
  | ArrayBuffer
  | MessagePort
  | ReadableStream
  | WritableStream
  | TransformStream

export type StructuredCloneTransferable =
  | StructuredClone
  | TransferableObject
  | { [key: string]: StructuredCloneTransferable }
  | Array<StructuredCloneTransferable>
  | Map<StructuredCloneTransferable, StructuredCloneTransferable>
  | Set<StructuredCloneTransferable>

export type Proxiable =
  | Promise<StructuredCloneTransferableProxiable>
  | Error
  | MessagePort
  | ReadableStream
  | ((...args: any[]) => Promise<StructuredCloneTransferableProxiable>)
  | { [key: string]: StructuredCloneTransferableProxiable }
  | Array<StructuredCloneTransferableProxiable>
  | Map<StructuredCloneTransferableProxiable, StructuredCloneTransferableProxiable>
  | Set<StructuredCloneTransferableProxiable>

export type StructuredCloneTransferableProxiable = Proxiable | StructuredCloneTransferable

type PortOrJsonPort<JsonOnly extends boolean = boolean> = JsonOnly extends true ? { portId: string } : { port: MessagePort }
type StructuredCloneDataOrJsonData<JsonOnly extends boolean> = JsonOnly extends true ? JsonClone : StructuredClone

export type FunctionProxy<JsonOnly extends boolean = boolean> = ({ type: 'function' } & PortOrJsonPort<JsonOnly>)
export type MessagePortProxy<JsonOnly extends boolean = boolean> = ({ type: 'messagePort' } & PortOrJsonPort<JsonOnly>)
export type ProxyPromiseType<JsonOnly extends boolean = boolean> = ({ type: 'promise' } & PortOrJsonPort<JsonOnly>)
export type ProxyReadableStreamType<JsonOnly extends boolean = boolean> = ({ type: 'readableStream' } & PortOrJsonPort<JsonOnly>)
export type ProxyErrorType = ({ type: 'error', message: string, stack?: string })

export type Proxy<JsonOnly extends boolean = boolean> =
  { [OSRA_PROXY]: true } & (
    | FunctionProxy<JsonOnly>
    | MessagePortProxy<JsonOnly>
    | ProxyPromiseType<JsonOnly>
    | ProxyReadableStreamType<JsonOnly>
    | ProxyErrorType
  )
export type OsraMessage =
  {
    [OSRA_MESSAGE_PROPERTY]: true
    key: string
    uuid: string
    name?: string
  } & (
    | {
      type: 'announce'

      uuid: string
      /** Only set when acknowledging a remote announcement */
      remoteUuid?: string
    }
    | {
      /** uuid already taken, try announcing with another one */
      type: 'reject-uuid-taken'
      remoteUuid: string
    }
    | { type: 'init', data: StructuredCloneTransferable }
    | { type: 'message', portId: string, data: any } // message not needed if transferring MessagePort is supported
    | { type: 'port-closed', portId: string } // message not needed if transferring MessagePort is supported
  )

export type RemoteTarget = Window | ServiceWorker | Worker | MessagePort | WebExtPort
export type RemoteTargetOrFunction = RemoteTarget | ((osraMessage: OsraMessage, transferables?: Transferable[]) => void)
export type LocalTarget = WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker | WebExtRuntime | WebExtPort
export type LocalTargetOrFunction = LocalTarget | ((listener: (event: OsraMessage) => void) => void)
