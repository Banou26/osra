import type { Remote } from '../../src/types'
import type { Resolvers as BackgroundResolvers } from './background'
import type { Resolvers as ContentResolvers } from './content'

export type TestAPI = Remote<BackgroundResolvers>
export type ContentAPI = Remote<ContentResolvers>
