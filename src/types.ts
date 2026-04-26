import type { ConnectionMessage } from './connections'
import type { TypedEventTarget } from './utils'
import type { IsJsonOnlyTransport } from './utils/type-guards'
import type {
  DefaultRevivableModules, RevivableModule,
  InferMessages, InferRevivables, RevivableContext
} from './revivables'

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

export type StructurableTransferable =
  | Structurable
  | Transferable
  | { [key: string]: StructurableTransferable }
  | Array<StructurableTransferable>
  | Map<StructurableTransferable, StructurableTransferable>
  | Set<StructurableTransferable>

/** Base set of "free" types in `Capable` — narrows to `Jsonable` on a
 *  JSON-only transport so the user can't type a message with a `Date`,
 *  `Blob`, etc. that JSON.stringify would silently coerce. Modules
 *  that *do* support JSON (date, map, set, bigint, …) put their type
 *  back in via `InferRevivables`. */
type CapableBase<Ctx extends RevivableContext> =
  IsJsonOnlyTransport<Ctx['transport']> extends true
    ? Jsonable | undefined | void
    : StructurableTransferable

export type Capable<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  Ctx extends RevivableContext = RevivableContext,
> =
  | CapableBase<Ctx>
  | InferRevivables<TModules, Ctx>
  | { [key: string]: Capable<TModules, Ctx> }
  | Array<Capable<TModules, Ctx>>
  | Map<Capable<TModules, Ctx>, Capable<TModules, Ctx>>
  | Set<Capable<TModules, Ctx>>

export type MessageFields = {
  type: string
  remoteUuid: Uuid
}

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
    type: 'close'
    remoteUuid: Uuid
  }

export type MessageVariant<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | ProtocolMessage
  | ConnectionMessage<TModules>
  | InferMessages<TModules>

export type Message<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  & MessageBase
  & MessageVariant<TModules>

export type MessageEventMap<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  message: CustomEvent<Message<TModules>>
}

export type MessageEventTarget<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
  > = TypedEventTarget<MessageEventMap<TModules>>
