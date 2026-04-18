import type { OsraRunner } from './browser/transports'

declare global {
  // eslint-disable-next-line no-var
  var __osraRun: OsraRunner
}

export {}
