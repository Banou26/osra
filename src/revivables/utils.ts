import type { DefaultRevivableModules, RevivableModule } from './index.js'
import type {
  MessageEventTarget,
  MessageFields,
  Uuid,
} from '../types.js'
import type { Transport } from '../utils/transport.js'
import type { IsJsonOnlyTransport } from '../utils/type-guards.js'

import { OSRA_BOX } from '../types.js'
import { isJsonOnlyTransport } from '../utils/type-guards.js'

export type { UnderlyingType } from '../utils/type.js'

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
  /** broad on purpose: revivables post their own message variants, and narrowing brings back contravariant mismatches */
  sendMessage: (message: MessageFields & Record<string, unknown>) => void
  revivableModules: TModules
  eventTarget: MessageEventTarget<TModules>
}

export type ExtractType<T, Ctx extends RevivableContext = RevivableContext> =
  T extends { capableOnly: true }
    ? IsJsonOnlyTransport<Ctx['transport']> extends true
      ? never
      : T extends { isType: (value: unknown) => value is infer S } ? S : never
    : T extends { isType: (value: unknown) => value is infer S } ? S : never

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

export const isRevivableBox = (value: unknown): value is BoxBase =>
  !!value
  && typeof value === 'object'
  && OSRA_BOX in value
  && value[OSRA_BOX] === 'revivable'

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
