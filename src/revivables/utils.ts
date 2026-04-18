import type { DefaultRevivableModules, RevivableModule } from '.'
import type {
  Message,
  MessageEventTarget,
  Uuid
} from '../types'
import type { Transport } from '../utils/transport'

import { OSRA_BOX } from '../types'

export type { UnderlyingType } from '../utils/type'

export const BoxBase = {
  [OSRA_BOX]: 'revivable',
  type: '' as string
} as const

export type BoxBase<T extends string = string> =
  & typeof BoxBase
  & { type: T }

export type RevivableContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> = {
  transport: Transport
  remoteUuid: Uuid
  unregisterSignal?: AbortSignal
  sendMessage: (message: any) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export type CustomMessageEvent<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | CustomEvent<Message<TModules>>

export type ExtractModule<T> =
  T extends { isType: (value: unknown) => value is infer S }
    ? S
    : never

export type ExtractType<T> =
  T extends { isType: (value: unknown) => value is infer S }
    ? S
    : never

export type ExtractBoxInput<T> =
  T extends { box: (value: infer S) => value is any }
    ? S
    : never

export type ExtractReviveInput<T> =
  T extends { revive: (value: infer S) => value is any }
    ? S
    : never

export type ExtractBox<T> =
  T extends { box: (...args: any[]) => infer B }
    ? B
    : never

export type ExtractMessages<T> =
  T extends { Messages?: infer B }
    ? B extends { type: string }
      ? string extends B['type'] ? never : B
      : never
    : never

export type InferMessages<TModules extends readonly unknown[]> =
  ExtractMessages<TModules[number]>

export type InferRevivables<TModules extends readonly unknown[]> =
  ExtractType<TModules[number]>

export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

export const isRevivableBox = <
  TModules extends readonly RevivableModule[],
  T extends RevivableContext<TModules>
>(value: any, _context: T): value is InferRevivableBox<TModules> =>
  value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'
