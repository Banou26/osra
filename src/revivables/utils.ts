import type { DefaultRevivableModules, RevivableModule } from '.'
import type {
  MessageEventTarget,
  MessageFields,
  Uuid,
} from '../types'
import type { Transport } from '../utils/transport'
import type { IsJsonOnlyTransport } from '../utils/type-guards'

import { OSRA_BOX } from '../types'
import { isJsonOnlyTransport } from '../utils/type-guards'

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

/** Extract the type a module's `isType` narrows to. Modules marked
 *  `capableOnly: true` (clonable, transferable) contribute `never` on JSON
 *  transports so users can't type values JSON would silently drop. */
export type ExtractType<T, Ctx extends RevivableContext = RevivableContext> =
  T extends { capableOnly: true }
    ? IsJsonOnlyTransport<Ctx['transport']> extends true
      ? never
      : T extends { isType: (value: unknown) => value is infer S } ? S : never
    : T extends { isType: (value: unknown) => value is infer S } ? S : never

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

export type InferRevivables<
  TModules extends readonly unknown[],
  Ctx extends RevivableContext = RevivableContext,
> =
  ExtractType<TModules[number], Ctx>

export type InferRevivableBox<TModules extends readonly unknown[]> =
  ExtractBox<TModules[number]>

export const isRevivableBox = (value: unknown): value is BoxBase =>
  !!value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

export const serializeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? String(error)) : String(error)

/** Wire shape for an ArrayBuffer: base64 on JSON, raw on clone. */
export type BoxedBuffer<TCtx extends RevivableContext = RevivableContext> =
  IsJsonOnlyTransport<TCtx['transport']> extends true ? { base64Buffer: string }
  : IsJsonOnlyTransport<TCtx['transport']> extends false ? { arrayBuffer: ArrayBuffer }
  : { base64Buffer: string } | { arrayBuffer: ArrayBuffer }

export const boxBuffer = <TCtx extends RevivableContext>(
  buffer: ArrayBuffer,
  context: TCtx,
): BoxedBuffer<TCtx> =>
  (isJsonOnlyTransport(context.transport)
    ? { base64Buffer: new Uint8Array(buffer).toBase64() }
    : { arrayBuffer: buffer }
  ) as BoxedBuffer<TCtx>

export const reviveBuffer = (boxed: { arrayBuffer: ArrayBuffer } | { base64Buffer: string }): ArrayBuffer =>
  'arrayBuffer' in boxed
    ? boxed.arrayBuffer
    : Uint8Array.fromBase64(boxed.base64Buffer).buffer
