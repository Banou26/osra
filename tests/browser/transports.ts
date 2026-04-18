import type { Transport } from '../../src'
import type { Message } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

// Transport registry — adding a new transport here automatically runs every
// transport-parameterized test against it.

export type TransportName = 'Web' | 'JSON'

export type TransportEntry = {
  readonly name: TransportName
  readonly factory: () => Transport
  /** Iteration count for memory leak tests on this transport. */
  readonly memoryIterations: number
  /** Allowed heap growth (bytes) before a memory test fails. */
  readonly memoryThreshold: number
}

const jsonLoopback = (): Transport => ({
  isJson: true,
  receive: (listener: (message: Message, ctx: MessageContext) => void) => {
    window.addEventListener('message', event => {
      listener(JSON.parse((event as MessageEvent).data as string) as Message, {})
    })
  },
  emit: (message: Message) => {
    window.postMessage(JSON.stringify(message))
  },
})

// Surface the bundle exposes on globalThis for the Playwright runner to call
// via page.evaluate. Defined here (not in a .d.ts) so the implementation in
// _run.ts can `satisfies` against it and pinpoint mismatches at the lambda.
export type OsraRunner = {
  transport: (group: string, name: string, transportName: TransportName) => Promise<void>
  memory: (name: string, transportName: TransportName) => Promise<void>
  standalone: (group: string, name: string) => Promise<void>
}

export const transports: readonly TransportEntry[] = [
  {
    name: 'Web',
    factory: () => window,
    memoryIterations: 100_000,
    memoryThreshold: 1_000_000,
  },
  {
    name: 'JSON',
    factory: jsonLoopback,
    memoryIterations: 2_500,
    memoryThreshold: 1_000_000,
  },
]
