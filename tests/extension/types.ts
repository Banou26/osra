// Cross-script type shapes. Re-exported here (rather than inlined at every
// import site) so content/background/popup can refer to each other's APIs
// without circular module imports through the runtime files.
export type { Resolvers as TestAPI } from './background'
export type { Resolvers as ContentAPI } from './content'
