import type { TransportName } from './browser/transports'

declare global {
  var __osraRun: {
    transport: (group: string, name: string, transportName: TransportName) => Promise<void>
    memory: (name: string, transportName: TransportName) => Promise<void>
    standalone: (group: string, name: string) => Promise<void>
  }
}

export {}
