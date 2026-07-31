import { expect } from 'chai'

import { expose, context } from '../../src/index'

// Platform transports that the parameterized matrix can't cover: a real
// SharedWorker (messages arrive on .port, which must also be start()ed)
// and real WebSockets (string frames that must be JSON.parsed on receive).
// Workers import osra from the published build (/build/index.js), like
// worker-handshake.ts.

const osraUrl = () => new URL('/build/index.js', location.href).href

type AddApi = { add: (a: number, b: number) => Promise<number> }

// onconnect can fire before the dynamic import resolves - buffer until ready.
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

// The relay (tests/ws-relay.mjs, port 3001) broadcasts every frame to every OTHER client, and all
// three browser projects share the one server. Two sockets on the default key therefore pair with
// whichever peer answers first, which may belong to the same test running in another browser: socketB
// pairs with a foreign socketB, gets its empty value, and `.add` is undefined. A key unique per call
// scopes the announce so only this pair can see each other.
const relayKey = () => `ws-${globalThis.crypto.randomUUID()}`

// expose() is called while the sockets are still CONNECTING - outbound
// envelopes must queue until open instead of throwing.
export const webSocketRpc = async () => {
  const socketA = new WebSocket('ws://localhost:3001')
  const socketB = new WebSocket('ws://localhost:3001')
  const key = relayKey()
  try {
    const value = { add: async (a: number, b: number) => a + b }
    expose(value, { transport: socketA, key })
    const remote = await expose<typeof value>({}, { transport: socketB, key })
    expect(await remote.add(1, 2)).to.equal(3)
  } finally {
    socketA.close()
    socketB.close()
  }
}

export const webSocketCallback = async () => {
  const socketA = new WebSocket('ws://localhost:3001')
  const socketB = new WebSocket('ws://localhost:3001')
  const key = relayKey()
  try {
    const value = { run: async (callback: () => Promise<number>) => (await callback()) * 2 }
    expose(value, { transport: socketA, key })
    const remote = await expose<typeof value>({}, { transport: socketB, key })
    expect(await remote.run(async () => 21)).to.equal(42)
  } finally {
    socketA.close()
    socketB.close()
  }
}

// A window transport is the one shape that observes a peer origin, and it is what a broker embedded
// in an iframe relies on to know which realm it is serving. srcdoc inherits this page's origin, so
// the observed value is a real origin rather than an opaque one.
export const windowTransportObservesThePeerOrigin = async () => {
  const osraUrl = new URL('/build/index.js', location.href).href
  const key = `ctx-origin-${globalThis.crypto.randomUUID()}`
  const iframe = document.createElement('iframe')
  iframe.srcdoc =
    `<script type="module">`
    + `import { expose } from ${JSON.stringify(osraUrl)}\n`
    + `expose({ ping: async () => 'pong' }, { transport: { receive: window, emit: window.parent }, key: ${JSON.stringify(key)} })`
    + `</script>`
  document.body.appendChild(iframe)
  try {
    let seen: Record<string, unknown> | undefined
    const remote = await expose<{ ping: () => Promise<string> }>(
      context(ctx => { seen = { ...ctx }; return {} }),
      { transport: { receive: window, emit: iframe.contentWindow as Window }, key },
    )
    expect(await remote.ping(), 'the connection works').to.equal('pong')
    expect(seen?.origin, 'the window transport observes the peer origin').to.equal(location.origin)
    expect(seen?.source, 'and the peer window itself').to.equal(iframe.contentWindow)
    expect(typeof seen?.abort).to.equal('function')
  } finally {
    iframe.remove()
  }
}
