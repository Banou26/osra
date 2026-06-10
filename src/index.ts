import type { Capable, Remote } from './types.js'
import type { DefaultRevivableModules, RevivableContext } from './revivables/index.js'
import type { RevivableModule } from './revivables/index.js'
import type { StartConnectionsOptions } from './connections/utils.js'
import type { Transport } from './utils/transport.js'
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

type CapableCheck<
  T,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules,
  Ctx extends RevivableContext = RevivableContext,
> =
  T extends Capable<TModules, Ctx>
    ? T
    : T & {
        [ErrorMessage]: 'Value type must resolve to a Capable'
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
