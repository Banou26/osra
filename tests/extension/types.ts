// Cross-script type shapes. Re-exported here (rather than inlined at every
// import site) so content/background/popup can refer to each other's APIs
// without circular module imports through the runtime files. The handles
// tests hold are remote proxies, so they carry the Remote<> view (generic
// signatures collapse — a mapped type can't preserve higher-rank generics).
import type { Remote } from '../../src/types'
import type { Resolvers as BackgroundResolvers } from './background'
import type { Resolvers as ContentResolvers } from './content'

export type TestAPI = Remote<BackgroundResolvers>
export type ContentAPI = Remote<ContentResolvers>
