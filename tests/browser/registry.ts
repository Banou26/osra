import type { Transport } from '../../src'

import { base } from './base-tests'
import { baseMemory } from './base-memory-tests'
import { gc } from './gc-tests'
import * as customRevivables from './custom-revivables'
import * as identityTests from './identity'
import * as transferTests from './transfer'
import * as eventPort from './event-port'
import * as lifecycle from './lifecycle'
import * as messageChannel from './message-channel-transport'
import * as platformTransports from './platform-transports'
import * as relayTests from './relay'
import * as reorderTests from './reorder'
import * as streamCompat from './stream-compat'
import * as teardownTests from './teardown'
import * as typeGuards from './type-guards'
import * as workerHandshake from './worker-handshake'

// Filter helper: collect functions only, drop constants like
// baseMemory.DEFAULT_ITERATIONS that share the same module namespace.
const fns = <Fn extends (...args: any[]) => any>(o: Record<string, unknown>): Record<string, Fn> =>
  Object.fromEntries(
    Object.entries(o).filter((entry): entry is [string, Fn] => typeof entry[1] === 'function'),
  )

// Transport-parameterized: each test runs once per registered transport.
// New tests added to base-tests.ts (or any of these source modules) appear
// automatically - no per-transport wiring file to update.
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

// Memory tests take (transport, iterations) - the runner pulls iterations
// from the per-transport config so JSON gets fewer rounds than Web.
export const memoryTests: Readonly<Record<string, (transport: Transport, iterations: number) => Promise<void>>> =
  fns(baseMemory)

// GC tests take (transport) but rely on the spec runner exposing
// globalThis.__osraForceGc which drives CDP HeapProfiler.collectGarbage.
export const gcTests: Readonly<Record<string, (transport: Transport) => Promise<void>>> =
  fns(gc)

// Standalone: no transport parameterization. One execution per test.
export const standaloneTests: Readonly<Record<string, Readonly<Record<string, () => Promise<void>>>>> = {
  EventPort: fns(eventPort),
  Lifecycle: fns(lifecycle),
  MessageChannelTransport: fns(messageChannel),
  PlatformTransports: fns(platformTransports),
  Relay: fns(relayTests),
  Reorder: fns(reorderTests),
  StreamCompat: fns(streamCompat),
  Teardown: fns(teardownTests),
  TypeGuards: fns(typeGuards),
  WorkerHandshake: fns(workerHandshake),
}
