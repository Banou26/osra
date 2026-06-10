import { expect } from 'chai'

import { expose } from '../../src/index'

// Platform transports that the parameterized matrix can't cover: a real
// SharedWorker (messages arrive on .port, which must also be start()ed)
// and real WebSockets (string frames that must be JSON.parsed on receive).
// Workers import osra from the published build (/build/index.js), like
// worker-handshake.ts.

const osraUrl = () => new URL('/build/index.js', location.href).href

type AddApi = { add: (a: number, b: number) => Promise<number> }

// onconnect can fire before the dynamic import resolves — buffer until ready.
const sharedWorkerSource = () => `
  const pending = []
  globalThis.onconnect = (event) => pending.push(event)
  import('${osraUrl()}').then(({ expose }) => {
    const value = { add: async (a, b) => a + b }
    const handle = (event) => {
      for (const port of event.ports) expose(value, { transport: port })
    }
    globalThis.onconnect = handle
    pending.forEach(handle)
  })
`

export const sharedWorkerRpc = async () => {
  if (typeof SharedWorker === 'undefined') return
  const url = URL.createObjectURL(
    new Blob([sharedWorkerSource()], { type: 'application/javascript' }),
  )
  try {
    const sharedWorker = new SharedWorker(url)
    const remote = await expose<AddApi>({}, { transport: sharedWorker })
    expect(await remote.add(20, 22)).to.equal(42)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Two sockets through the relay server (tests/ws-relay.mjs, port 3001).
// expose() is called while the sockets are still CONNECTING — outbound
// envelopes must queue until open instead of throwing.
export const webSocketRpc = async () => {
  const socketA = new WebSocket('ws://localhost:3001')
  const socketB = new WebSocket('ws://localhost:3001')
  try {
    const value = { add: async (a: number, b: number) => a + b }
    expose(value, { transport: socketA })
    const remote = await expose<typeof value>({}, { transport: socketB })
    expect(await remote.add(1, 2)).to.equal(3)
  } finally {
    socketA.close()
    socketB.close()
  }
}

export const webSocketCallback = async () => {
  const socketA = new WebSocket('ws://localhost:3001')
  const socketB = new WebSocket('ws://localhost:3001')
  try {
    const value = { run: async (callback: () => Promise<number>) => (await callback()) * 2 }
    expose(value, { transport: socketA })
    const remote = await expose<typeof value>({}, { transport: socketB })
    expect(await remote.run(async () => 21)).to.equal(42)
  } finally {
    socketA.close()
    socketB.close()
  }
}
