import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
use(chaiAsPromised)

// Side-effect import: type-tests.ts is compile-time only — its presence in
// the bundle proves the type-level assertions hold.
import './type-tests'

export * as Web from './web-context-transport'
export * as JSONTransport from './json-transport'
// export * as Stateless from './stateless'
export * as TypeGuards from './type-guards'
export * as Lifecycle from './lifecycle'
export * as MessageChannelTransport from './message-channel-transport'
