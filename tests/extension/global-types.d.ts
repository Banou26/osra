import type * as extensionTests from './index'

declare global {
  // eslint-disable-next-line no-var
  var tests: typeof extensionTests
}

export {}
