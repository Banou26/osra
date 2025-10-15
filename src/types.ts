import type { WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

export const OSRA_KEY = '__OSRA_KEY__' as const
export const OSRA_DEFAULT_KEY = '__OSRA_DEFAULT_KEY__' as const
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

export type ReviveBoxBase<T extends RevivableVariant['type'] = RevivableVariant['type']> = {
  [OSRA_BOX]: 'revivable'
  type: T
  value?: RevivableVariantTypeToRevivableVariant<T>
  [Symbol.toPrimitive]?: Function
  valueOf?: Function
  toString?: Function
  toJSON?: Function
}

export type RevivableMessagePort = {
  type: 'messagePort'
  messagePortId: string
}

export type RevivablePromiseContext =
  | {
    type: 'resolve'
    data: Capable
  }
  | {
    type: 'reject'
    error: string
  }

export type RevivablePromise = {
  type: 'promise'
  port: MessagePort
}

export type RevivableFunctionCallContext = [
  /** MessagePort that will be used to send the result of the function call */
  MessagePort,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export type RevivableFunction = {
  type: 'function'
  port: MessagePort
}

export type RevivableReadableStream = {
  type: 'readableStream'
  port: MessagePort
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
  | RevivableFunction
  | RevivableReadableStream
  | RevivableDate
  | RevivableError

export type RevivableVariantType = RevivableVariant['type']

export type RevivableVariantTypeToRevivableVariant<T extends RevivableVariantType> =
  T extends 'messagePort' ? MessagePort :
  T extends 'promise' ? Promise<any> :
  T extends 'function' ? Function :
  T extends 'readableStream' ? ReadableStream :
  T extends 'date' ? Date :
  T extends 'error' ? Error :
  never

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

export type RevivableToRevivableType<T extends Revivable> =
  T extends MessagePort ? 'messagePort' :
  T extends Promise<any> ? 'promise' :
  T extends Function ? 'function' :
  T extends ReadableStream ? 'readableStream' :
  T extends Date ? 'date' :
  T extends Error ? 'error' :
  never

export type Capable =
  | Structurable
  | TransferBox
  | Transferable
  | Revivable
  | { [key: string]: Capable }
  | Array<Capable>
  | Map<Capable, Capable>
  | Set<Capable>

export type MessageBase = {
  [OSRA_KEY]: string
  /** UUID of the client that sent the message */
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

export type BidirectionalConnectionMessage =
  | {
    type: 'init'
    remoteUuid: Uuid
    data: Capable
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'message'
    remoteUuid: Uuid
    data: Capable
    /** uuid of the messagePort that the message was sent through */
    portId: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'message-port-close'
    remoteUuid: Uuid
    /** uuid of the messagePort that closed */
    portId: string
  }

export type UnidirectionalConnectionMessage = {
  type: 'message'
  remoteUuid: Uuid
  data: Capable
  portId: string
}

export type ConnectionMessage =
  | BidirectionalConnectionMessage
  | UnidirectionalConnectionMessage

export type MessageVariant =
  | ProtocolMessage
  | ConnectionMessage

export type Message =
  | MessageBase
  & MessageVariant

export type MessageContext = {
  port?: MessagePort | WebExtPort // WebExtension
  sender?: WebExtSender // WebExtension
  receiveTransport?: ReceivePlatformTransport
  source?: MessageEventSource | null // Window, Worker, WebSocket, ect...
}

export type MessageWithContext = {
  message: Message
  context: MessageContext
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
