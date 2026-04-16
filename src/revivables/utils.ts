import type { DefaultRevivableModules, RevivableModule } from '.'
import type {
  MessageEventTarget,
  MessageFields,
  Uuid,
} from '../types'
import type { Transport } from '../utils/transport'

import { OSRA_BOX } from '../types'

export type { UnderlyingType } from '../utils/type'

export const BoxBase = {
  [OSRA_BOX]: 'revivable',
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
  /** Typed as a broad dispatcher so revivables can post their own message
   *  variants without triggering contravariant function-parameter mismatches
   *  across modules. The shape is enforced structurally via `MessageFields`. */
  sendMessage: (message: MessageFields & Record<string, unknown>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export type ExtractType<T> =
  T extends { isType: (value: unknown) => value is infer S }
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

export const isRevivableBox = (value: unknown): value is BoxBase =>
  !!value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'
