import type { Transport } from '../../src'

import { base } from './base-tests'
import { baseMemory } from './base-memory-tests'
import * as customRevivables from './custom-revivables'
import * as identityTests from './identity'
import * as transferTests from './transfer'
import * as lifecycle from './lifecycle'
import * as messageChannel from './message-channel-transport'
import * as typeGuards from './type-guards'

// Filter helper: collect functions only, drop constants like
// baseMemory.DEFAULT_ITERATIONS that share the same module namespace.
const fns = <Fn extends (...args: any[]) => any>(o: Record<string, unknown>): Record<string, Fn> =>
  Object.fromEntries(
    Object.entries(o).filter((entry): entry is [string, Fn] => typeof entry[1] === 'function'),
  )

// Transport-parameterized: each test runs once per registered transport.
// New tests added to base-tests.ts (or any of these source modules) appear
// automatically — no per-transport wiring file to update.
export const transportTests: Readonly<Record<string, Readonly<Record<string, (transport: Transport) => Promise<void>>>>> = {
  Base: base,
  Identity: fns(identityTests),
  Transfer: fns(transferTests),
  CustomRevivables: {
    userPoint: customRevivables.userPoint,
    userPointReturn: customRevivables.userPointReturn,
    userPointDefaultsStillWork: customRevivables.userPointDefaultsStillWork,
  },
}

// Memory tests take (transport, iterations) — the runner pulls iterations
// from the per-transport config so JSON gets fewer rounds than Web.
export const memoryTests: Readonly<Record<string, (transport: Transport, iterations: number) => Promise<void>>> =
  fns(baseMemory)

// Standalone: no transport parameterization. One execution per test.
export const standaloneTests: Readonly<Record<string, Readonly<Record<string, () => Promise<void>>>>> = {
  Lifecycle: fns(lifecycle),
  MessageChannelTransport: fns(messageChannel),
  TypeGuards: fns(typeGuards),
}
