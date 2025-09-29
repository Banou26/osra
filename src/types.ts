import type { WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

export const OSRA_KEY = '__OSRA_KEY__' as const
export const OSRA_DEFAULT_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_REVIVABLE = '__OSRA_REVIVABLE__' as const

export type Uuid = `${string}-${string}-${string}-${string}-${string}`

export type Jsonable =
  | boolean
  | null
  | number
  | string
  | { [key: string]: Jsonable }
  | Array<Jsonable>

export type Structurable =
  | Jsonable
  /** not really structureable but here for convenience */
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
  | { [key: string]: Structurable }
  | Array<Structurable>
  | Map<Structurable, Structurable>
  | Set<Structurable>

// export type Transferable =
//   | SharedArrayBuffer
//   | ArrayBuffer
//   | MessagePort
//   | ReadableStream
//   | WritableStream
//   | TransformStream

export type Revivable =
  | Promise<Capable>
  | MessagePort
  | ReadableStream
  | Date
  | Error
  | ((...args: Capable[]) => Promise<Capable>)

export type Capable =
  | Structurable
  | Transferable
  | Revivable
  | { [key: string]: Capable }
  | Array<Capable>
  | Map<Capable, Capable>
  | Set<Capable>

export type Proxy =
  { [OSRA_REVIVABLE]: true }

export type MessageBase = {
  [OSRA_KEY]: string
  uuid: Uuid
  name?: string
}

export type MessageVariant<JsonOnly extends boolean = false> =
  | {
    type: 'announce'
    /** Only set when acknowledging a remote announcement */
    remoteUuid?: Uuid
  }
  | {
    /** uuid already taken, try announcing with another one */
    type: 'reject-uuid-taken'
    remoteUuid: Uuid
  }
  | {
    type: 'init'
    remoteUuid: Uuid
    data: JsonOnly extends true ? Jsonable : Capable
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'message'
    remoteUuid: Uuid
    data: JsonOnly extends true ? Jsonable : Capable
    portId: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'close'
    remoteUuid: Uuid
    /**
     * Set when closing a revivable message port
     * If unset, we are closing the entire connection
     */
    portId?: string
  }

export type Message<JsonOnly extends boolean = false> = MessageBase & MessageVariant<JsonOnly>

export type MessageContext = {
  port?: MessagePort | WebExtPort
  sender?: WebExtSender
  receiveTransport?: ReceivePlatformTransport
  source?: MessageEventSource | null
}

export type CustomTransport =
  | {
    receive: ReceivePlatformTransport | ((listener: (event: Message, messageContext: MessageContext) => void) => void)
    emit: EmitPlatformTransport | ((message: Message, transferables?: Transferable[]) => void)
  }
  | { receive: ReceivePlatformTransport | ((listener: (event: Message, messageContext: MessageContext) => void) => void) }
  | { emit: EmitPlatformTransport | ((message: Message, transferables?: Transferable[]) => void) }

export type CustomEmitTransport = Extract<CustomTransport, { emit: any }>
export type CustomReceiveTransport = Extract<CustomTransport, { receive: any }>

export type EmitJsonPlatformTransport =
  | WebSocket
  | WebExtPort

export type ReceiveJsonPlatformTransport =
  | WebSocket
  | WebExtPort
  | WebExtOnConnect
  | WebExtOnMessage

export type JsonPlatformTransport =
  | EmitJsonPlatformTransport
  | ReceiveJsonPlatformTransport

export type EmitPlatformTransport =
  | EmitJsonPlatformTransport
  | Window
  | ServiceWorker
  | Worker
  | SharedWorker
  | MessagePort

export type ReceivePlatformTransport =
  | ReceiveJsonPlatformTransport
  | Window
  | ServiceWorker
  | Worker
  | SharedWorker
  | MessagePort

export type PlatformTransport =
  | EmitPlatformTransport
  | ReceivePlatformTransport

export type EmitTransport = EmitPlatformTransport & Extract<CustomTransport, { emit: any }>
export type ReceiveTransport = ReceivePlatformTransport & Extract<CustomTransport, { receive: any }>

export type Transport =
  | PlatformTransport
  | CustomTransport
