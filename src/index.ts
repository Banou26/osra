import type { Capable } from './types'
import type { DefaultRevivableModules } from './revivables'
import type { RevivableModule } from './revivables'
import type { StartConnectionsOptions } from './connections/utils'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from './utils/capable-check'

import { startConnections } from './utils'

export * from './types'
export * from './revivables'
export * from './connections'
export * from './utils'

type CapableCheck<
  T,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  T extends Capable<TModules>
    ? T
    : T & {
        [ErrorMessage]: 'Value type must resolve to a Capable'
        [BadValue]: BadFieldValue<T, Capable<TModules>>
        [Path]: BadFieldPath<T, Capable<TModules>>
        [ParentObject]: BadFieldParent<T, Capable<TModules>>
      }

export const expose = async <
  T = unknown,
  const TUserModules extends readonly RevivableModule[] = readonly [],
  const TValue = Capable<[...DefaultRevivableModules, ...TUserModules]>
>(
  value: CapableCheck<TValue, [...DefaultRevivableModules, ...TUserModules]>,
  options: StartConnectionsOptions<TUserModules>
): Promise<T> =>
  startConnections<T, TUserModules>(
    value as unknown as Capable<[...DefaultRevivableModules, ...TUserModules]>,
    options
  )
