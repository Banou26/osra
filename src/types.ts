import { TypedEventTarget } from 'typescript-event-target'
import type { TypedArray, WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime, WebExtSender } from './utils/type-guards'
import { DefaultModuleMessages, DefaultRevivableModule, DefaultRevivableModules, RevivableModule } from './revivables'
import { InferRevivables } from './revivables/utils'

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
  
export type StructurableTransferable =
  | Structurable
  | Transferable
  | { [key: string]: StructurableTransferable }
  | Array<StructurableTransferable>
  | Map<StructurableTransferable, StructurableTransferable>
  | Set<StructurableTransferable>

export type Capable<TModules extends readonly RevivableModule[] = DefaultRevivableModules> =
  | StructurableTransferable
  | InferRevivables<TModules>
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

export type BidirectionalConnectionMessage<TModuleMessages = DefaultModuleMessages> =
  | {
    type: 'init'
    remoteUuid: Uuid
    data: Capable
  }
  | TModuleMessages

export type UnidirectionalConnectionMessage = {
  type: 'message'
  remoteUuid: Uuid
  data: Capable
  portId: Uuid
}

export type ConnectionMessage<TModuleMessages = DefaultModuleMessages> =
  | BidirectionalConnectionMessage<TModuleMessages>
  | UnidirectionalConnectionMessage

export type MessageVariant<TModuleMessages = DefaultModuleMessages> =
  | ProtocolMessage
  | ConnectionMessage<TModuleMessages>

export type Message<TModuleMessages = DefaultModuleMessages> =
  | MessageBase
  & MessageVariant<TModuleMessages>

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
  | WebExtRuntime

export type ReceiveJsonPlatformTransport =
  | WebSocket
  | WebExtPort
  | WebExtOnConnect
  | WebExtOnMessage
  | WebExtRuntime

export type JsonPlatformTransport =
  | { isJson: true }
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
