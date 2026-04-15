import type {
  Capable
} from './types'
import type { DefaultRevivableModules } from './revivables'
import type { RevivableModule } from './revivables'
import type { StartConnectionsOptions } from './connections/utils'

export { BoxBase } from './revivables/utils'
import {
  DeepReplace,
  DeepReplaceAsync,
  AsCapable,
  startConnections
} from './utils'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from './utils/capable-check'

export * from './types'
export * from './revivables'
export * from './utils'
export type {
  DeepReplace,
  DeepReplaceAsync,
  AsCapable
}

type CapableCheck<
  T,
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  T extends Capable<TModules>
    ? T
    // Intersect with T so the user's keys are already present on the target —
    // without this, TS's excess-property check flags the first user key (e.g.
    // `foo`) instead of reporting the failure against the whole argument.
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
