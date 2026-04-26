import type { Capable } from './types'
import type { DefaultRevivableModules, RevivableContext } from './revivables'
import type { RevivableModule } from './revivables'
import type { StartConnectionsOptions } from './connections/utils'
import type { Transport } from './utils/transport'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from './utils/capable-check'

import { startConnections } from './utils'

export * from './types'
export * from './revivables'
export * from './connections'
export * from './utils'

/** Build a synthetic `RevivableContext` for the inferred transport, so
 *  `Capable<modules, ContextOf<TTransport>>` can narrow on JSON-only
 *  transports without us actually having a context object at the
 *  user-facing API call site. Only the `transport` field is used by
 *  `Capable`'s transport-aware machinery; the other fields are stubbed
 *  with their broadest types. */
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
  const TUserModules extends readonly RevivableModule[] = readonly [],
  const TTransport extends Transport = Transport,
  const TValue = Capable<[...DefaultRevivableModules, ...TUserModules], ContextOf<TTransport>>
>(
  value: CapableCheck<TValue, [...DefaultRevivableModules, ...TUserModules], ContextOf<TTransport>>,
  options: StartConnectionsOptions<TUserModules> & { transport: TTransport }
): Promise<T> =>
  startConnections<T, TUserModules>(
    value as Capable<[...DefaultRevivableModules, ...TUserModules]>,
    options
  )
