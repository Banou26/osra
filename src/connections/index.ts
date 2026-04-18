import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { Messages as BidirectionalMessages } from './bidirectional'

import * as bidirectional from './bidirectional'

export const connections = [
  bidirectional
] as const

export type ConnectionMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalMessages<TModules>
