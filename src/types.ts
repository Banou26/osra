import { TypedEventTarget } from 'typescript-event-target'
import type { TypedArray, WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'

// Re-export revivable types from revivables module for backward compatibility
// These types are now inferred from the revivable modules
export type {
  Revivable,
  RevivableBox,
  RevivableVariant,
  RevivableVariantType,
  ReviveBoxBase,
  RevivableModule,
  RevivablesRegistry,
  DefaultRevivables,
  RevivableVariantTypeToSource,
  SourceToRevivableType,
  // Context types
  PromiseContext as RevivablePromiseContext,
  FunctionCallContext as RevivableFunctionCallContext,
  ReadableStreamPullContext as RevivableReadableStreamPullContext
} from './utils/revivables'

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

// Import Revivable type from revivables module
// This creates a type-level circular reference which TypeScript handles correctly
import type { Revivable, RevivableBox } from './utils/revivables'

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

export type Transport =
  | PlatformTransport
  | CustomTransport
