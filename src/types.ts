import { WebExtOnConnect, WebExtOnMessage, WebExtPort, WebExtRuntime } from "./utils"

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

export type Transferable =
  | SharedArrayBuffer
  | ArrayBuffer
  | MessagePort
  | ReadableStream
  | WritableStream
  | TransformStream

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

export type MessageVariant =
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
    data: Messageable
    remoteUuid: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'message'
    portId: string
    data: Messageable
    remoteUuid: string
  }
  /** message not needed if transferring MessagePort is supported */
  | {
    type: 'port-closed'
    portId: string
  }

export type Message = MessageBase & MessageVariant

export type CustomTransport = {
  receive: ((listener: (event: Message) => void) => void),
  emit: ((message: Message, transferables?: Transferable[]) => void)
}

export type Transport =
  | Window
  | ServiceWorker
  | Worker
  | SharedWorker
  | MessagePort
  | WebSocket
  | WebExtPort
  | WebExtOnConnect
  | WebExtOnMessage
  | CustomTransport
  | Pick<CustomTransport, 'receive'>
  | Pick<CustomTransport, 'emit'>
