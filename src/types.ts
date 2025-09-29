import type { WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

export const OSRA_KEY = '__OSRA_KEY__' as const
export const OSRA_DEFAULT_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_REVIVABLE = '__OSRA_REVIVABLE__' as const

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
  | Promise<Messageable>
  | MessagePort
  | ReadableStream
  | Date
  | Error
  | ((...args: Messageable[]) => Promise<Messageable>)

export type Messageable =
  | Structurable
  | Transferable
  | Revivable
  | { [key: string]: Messageable }
  | Array<Messageable>
  | Map<Messageable, Messageable>
  | Set<Messageable>

export type Proxy =
  { [OSRA_REVIVABLE]: true }

export type MessageBase = {
  [OSRA_KEY]: string
  uuid: string
  name?: string
}

export type MessageVariant<JsonOnly extends boolean = false> =
  | {
    type: 'announce'
    /** Only set when acknowledging a remote announcement */
    remoteUuid?: string
  }
  | {
    /** uuid already taken, try announcing with another one */
    type: 'reject-uuid-taken'
    remoteUuid: string
  }
  | {
    type: 'init'
    data: JsonOnly extends true ? Jsonable : Messageable
    remoteUuid: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'message'
    portId: string
    data: JsonOnly extends true ? Jsonable : Messageable
    remoteUuid: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'port-closed'
    portId: string
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
