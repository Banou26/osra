import { TypedEventTarget } from 'typescript-event-target'
import type { TypedArray, WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

/** Internal key used to identify Osra messages */
export const OSRA_KEY = '__OSRA_KEY__' as const
/** Default key for Osra message identification */
export const OSRA_DEFAULT_KEY = '__OSRA_DEFAULT_KEY__' as const
/** Key used to identify boxed values that need special handling */
export const OSRA_BOX = '__OSRA_BOX__' as const

/**
 * UUID string type in standard format (8-4-4-4-12 hex digits).
 * Used for identifying connections and message ports.
 */
export type Uuid = `${string}-${string}-${string}-${string}-${string}`

/**
 * Types that can be safely serialized to JSON.
 * These types are supported natively by JSON.stringify/parse.
 */
export type Jsonable =
  | boolean
  | null
  | number
  | string
  | { [key: string]: Jsonable }
  | Array<Jsonable>

/**
 * Types that can be sent via the structured clone algorithm.
 * This includes all Jsonable types plus additional types like Date, RegExp, Blob, etc.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
 */
export type Structurable =
  | Jsonable
  /** not really structureable but here for convenience */
  | void
  | undefined
  | bigint
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

/**
 * A box that wraps a transferable value for explicit transfer.
 * When encountered, the value will be transferred instead of cloned.
 */
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
  portId: string
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

export type RevivableTypedArray = {
  type: 'typedArray'
  typedArrayType: 'Int8Array' | 'Uint8Array' | 'Uint8ClampedArray' | 'Int16Array' | 'Uint16Array' | 'Int32Array' | 'Uint32Array' | 'Float16Array' | 'Float32Array' | 'Float64Array' | 'BigInt64Array' | 'BigUint64Array'
  arrayBuffer: ArrayBuffer
}

export type RevivableArrayBuffer = {
  type: 'arrayBuffer'
  base64Buffer: string
}

export type RevivableReadableStreamPullContext = {
  type: 'pull' | 'cancel'
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
  message: string
  stack: string
}

export type RevivableVariant =
  | RevivableMessagePort
  | RevivablePromise
  | RevivableFunction
  | RevivableTypedArray
  | RevivableArrayBuffer
  | RevivableReadableStream
  | RevivableDate
  | RevivableError

export type RevivableVariantType = RevivableVariant['type']

export type RevivableVariantTypeToRevivableVariant<T extends RevivableVariantType> =
  T extends 'messagePort' ? MessagePort :
  T extends 'promise' ? Promise<any> :
  T extends 'function' ? Function :
  T extends 'typedArray' ? TypedArray :
  T extends 'arrayBuffer' ? ArrayBuffer :
  T extends 'readableStream' ? ReadableStream :
  T extends 'date' ? Date :
  T extends 'error' ? Error :
  never

export type RevivableBox =
  | ReviveBoxBase
  & RevivableVariant

/**
 * Types that require special serialization/deserialization (boxing/reviving).
 * These types cannot be directly serialized via JSON or structured clone
 * and need to be proxied through MessageChannels or converted to a serializable format.
 */
export type Revivable =
  | MessagePort
  | Promise<Capable>
  | TypedArray
  | ArrayBuffer
  | ReadableStream
  | Date
  | Error
  | ((...args: Capable[]) => Promise<Capable>)

export type RevivableToRevivableType<T extends Revivable> =
  T extends MessagePort ? 'messagePort' :
  T extends Promise<any> ? 'promise' :
  T extends Function ? 'function' :
  T extends TypedArray ? 'typedArray' :
  T extends ArrayBuffer ? 'arrayBuffer' :
  T extends ReadableStream ? 'readableStream' :
  T extends Date ? 'date' :
  T extends Error ? 'error' :
  never

/**
 * The union of all types that can be sent through Osra.
 * This includes:
 * - Structurable types (JSON, Date, Blob, etc.)
 * - TransferBox wrapped values
 * - Transferable objects (ArrayBuffer, MessagePort, etc.)
 * - Revivable types (Functions, Promises, Streams, etc.)
 * - Nested objects and arrays containing any of the above
 */
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
    portId: Uuid
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
  portId: Uuid
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

export type MessageEventMap = {
  message: CustomEvent<Message>
}
export type MessageEventTarget = TypedEventTarget<MessageEventMap>

/**
 * A custom transport that can be used to send and receive messages.
 * Useful for implementing custom communication channels or wrapping
 * existing protocols.
 *
 * @example
 * ```typescript
 * // Custom WebSocket transport
 * const wsTransport: CustomTransport = {
 *   isJson: true,
 *   emit: (message) => ws.send(JSON.stringify(message)),
 *   receive: (listener) => ws.onmessage = (e) => listener(JSON.parse(e.data), {})
 * }
 * ```
 */
export type CustomTransport =
  { isJson?: boolean }
  & (
    | {
      receive: ReceivePlatformTransport | ((listener: (event: Message, messageContext: MessageContext) => void) => void)
      emit: EmitPlatformTransport | ((message: Message, transferables?: Transferable[]) => void)
    }
    | { receive: ReceivePlatformTransport | ((listener: (event: Message, messageContext: MessageContext) => void) => void) }
    | { emit: EmitPlatformTransport | ((message: Message, transferables?: Transferable[]) => void) }
  )

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
  { isJson: true }
  & (
    | EmitJsonPlatformTransport
    | ReceiveJsonPlatformTransport
  )

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

/**
 * The transport type for Osra communication.
 * Can be either a platform transport (Window, Worker, MessagePort, etc.)
 * or a custom transport for specialized use cases.
 *
 * @example
 * ```typescript
 * // Worker transport
 * const worker = new Worker('./worker.js')
 * expose(api, { transport: worker })
 *
 * // Window transport (iframe communication)
 * expose(api, { transport: iframe.contentWindow, origin: 'https://example.com' })
 *
 * // MessagePort transport
 * const { port1, port2 } = new MessageChannel()
 * expose(api, { transport: port1 })
 * ```
 */
export type Transport =
  | PlatformTransport
  | CustomTransport
