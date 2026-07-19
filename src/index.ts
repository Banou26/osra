import type { Capable, Remote } from './types.js'
import type { DefaultRevivableModules, RevivableContext } from './revivables/index.js'
import type { RevivableModule } from './revivables/index.js'
import type { StartConnectionsOptions } from './connections/utils.js'
import type { Transport } from './utils/transport.js'
import type { IsJsonOnlyTransport } from './utils/type-guards.js'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from './utils/capable-check.js'

import { startConnections } from './connections/index.js'

export * from './types.js'
export * from './revivables/index.js'
export * from './connections/index.js'
export * from './utils/index.js'

/** Synthetic context so `Capable` can narrow on the inferred transport
 *  without an actual context object at the call site. Only `transport`
 *  matters; the rest is stubbed with the broadest types. */
type ContextOf<TTransport extends Transport> = RevivableContext & { transport: TTransport }

/** Error text for a failed check. When the value only fails because the
 *  transport is JSON (it would pass under the broad `RevivableContext`,
 *  whose transport union resolves to structured-clone semantics), blame
 *  the transport instead of the value. */
type CapableCheckMessage<
  T,
  TModules extends readonly RevivableModule[],
  Ctx extends RevivableContext,
> =
  IsJsonOnlyTransport<Ctx['transport']> extends true
    ? [T] extends [Capable<TModules, RevivableContext>]
      ? 'Value type is only supported on structured-clone transports, not on JSON transports'
      : 'Value type must resolve to a Capable'
    : 'Value type must resolve to a Capable'

type CapableCheck<
  T,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  Ctx extends RevivableContext = RevivableContext,
> =
  T extends Capable<TModules, Ctx>
    ? T
    : T & {
        [ErrorMessage]: CapableCheckMessage<T, TModules, Ctx>
        [BadValue]: BadFieldValue<T, Capable<TModules, Ctx>>
        [Path]: BadFieldPath<T, Capable<TModules, Ctx>>
        [ParentObject]: BadFieldParent<T, Capable<TModules, Ctx>>
      }

export const expose = async <
  T = unknown,
  const TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  const TTransport extends Transport = Transport,
  const TValue = Capable<TModules, ContextOf<TTransport>>
>(
  value: CapableCheck<TValue, TModules, ContextOf<TTransport>>,
  options: StartConnectionsOptions<TModules> & { transport: TTransport }
): Promise<Remote<T>> =>
  startConnections<Remote<T>, TModules>(
    value as Capable<TModules>,
    options
  )
