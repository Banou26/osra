import type { Transport } from '../../src'
import type { Message } from '../../src/types'
import type { MessageContext } from '../../src/utils/transport'

export type TransportName = 'Web' | 'JSON'

export type TransportEntry = {
  readonly name: TransportName
  readonly factory: () => Transport
  readonly memoryIterations: number
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

// surface the bundle exposes on globalThis for the Playwright runner to call via page.evaluate
export type OsraRunner = {
  transport: (group: string, name: string, transportName: TransportName) => Promise<void>
  memory: (name: string, transportName: TransportName) => Promise<void>
  standalone: (group: string, name: string) => Promise<void>
  gc: (name: string, transportName: TransportName) => Promise<void>
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
    // baseline growth sits near 1.25 MB for the heaviest test, so leave headroom
    memoryThreshold: 1_600_000,
  },
]
