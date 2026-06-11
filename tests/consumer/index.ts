// Compiled against the built declarations with `types: []` and
// `skipLibCheck: false` — exactly what an npm consumer without our
// devDependency @types sees. If an ambient global (browser, chrome,
// DedicatedWorkerGlobalScope, …) leaks into the shipped .d.ts, the
// Transport union collapses to `any` and these assertions fail.

import { expose } from '../../build/index.js'
import type { Transport, Remote } from '../../build/index.js'

// @ts-expect-error a number must never be assignable to Transport
const notATransport: Transport = 42

// @ts-expect-error expose must reject a non-transport
expose({}, { transport: 42 })

const worker = new Worker('x.js')
const okTransport: Transport = worker

type Api = { add: (a: number, b: number) => number }
const checkRemote = async () => {
  const remote = await expose<Api>({}, { transport: worker })
  const sum: Promise<number> = remote.add(1, 2)
  // @ts-expect-error remote calls are always async — sync access must fail
  const sync: number = remote.add(1, 2)
  return sum
}

// A worker's own global scope — commonly compiled under lib.dom, where it is NOT
// assignable to Window — must be accepted via the structural WorkerSelf member.
const workerSelf: Transport = globalThis
expose({}, { transport: globalThis, key: 'worker-self' })
