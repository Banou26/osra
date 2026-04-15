import type { DefaultRevivableModules, RevivableModule } from '../revivables'
import type { Messages as BidirectionalMessages, BidirectionalConnectionContext } from './bidirectional'
import type {
  UnidirectionalEmittingConnectionContext,
  UnidirectionalReceivingConnectionContext
} from './unidirectional'

import * as bidirectional from './bidirectional'

export * from './bidirectional'
export * from './unidirectional'

export const connections = [
  bidirectional
] as const

export type ConnectionMessage<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalMessages<TModules>

export type ConnectionContext<
  TModules extends readonly RevivableModule[] = DefaultRevivableModules
> =
  | BidirectionalConnectionContext<TModules>
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext<TModules>
