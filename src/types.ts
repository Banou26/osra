import type { WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

export const OSRA_KEY = '__OSRA_KEY__' as const
export const OSRA_DEFAULT_KEY = '__OSRA_DEFAULT_KEY__' as const
export const OSRA_REVIVABLE = '__OSRA_REVIVABLE__' as const
export const OSRA_BOX = '__OSRA_BOX__' as const

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

export type TransferBox<T extends Transferable = Transferable> = {
  [OSRA_BOX]: 'transferable'
  value: T
}

export type ReviveBoxBase = { [OSRA_BOX]: 'revivable' }

export type RevivableMessagePort = {
  type: 'messagePort'
  messageId: string
}

export type RevivablePromise = {
  type: 'promise'
  port: RevivableMessagePort
}

export type RevivableReadableStream = {
  type: 'readableStream'
  port: RevivableMessagePort
}

export type RevivableDate = {
  type: 'date'
  ISOString: string
}

export type RevivableError = {
  type: 'error'
  stack: string
}

export type RevivableVariant =
  | RevivableMessagePort
  | RevivablePromise
  | RevivableReadableStream
  | RevivableDate
  | RevivableError

export type RevivableVariantType = RevivableVariant['type']

export type RevivableBox =
  | ReviveBoxBase
  & RevivableVariant

export type Revivable =
  | MessagePort
  | Promise<Capable>
  | ReadableStream
  | Date
  | Error
  | ((...args: Capable[]) => Promise<Capable>)

export type Capable =
  | Structurable
  | TransferBox
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

export type ProtocolMessage =
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
    type: 'close'
    remoteUuid: Uuid
  }

export type BidirectionalConnectionMessage<JsonOnly extends boolean = false> =
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
    portId: string
  }

export type UnidirectionalConnectionMessage<JsonOnly extends boolean = false> = {
  type: 'message'
  remoteUuid: Uuid
  data: JsonOnly extends true ? Jsonable : Capable
  portId: string
}

export type ConnectionMessage<JsonOnly extends boolean = false> =
  | BidirectionalConnectionMessage<JsonOnly>
  | UnidirectionalConnectionMessage<JsonOnly>

export type MessageVariant<JsonOnly extends boolean = false> =
  | ProtocolMessage
  | ConnectionMessage<JsonOnly>

export type Message<JsonOnly extends boolean = false> =
  | MessageBase
  & MessageVariant<JsonOnly>

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
