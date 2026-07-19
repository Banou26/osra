// Compiled against the built declarations with `types: []` and
// `skipLibCheck: false` - exactly what an npm consumer without our
// devDependency @types sees. If an ambient global (browser, chrome,
// DedicatedWorkerGlobalScope, …) leaks into the shipped .d.ts, the
// Transport union collapses to `any` and these assertions fail.

import { expose } from '../../build/index.js'
import type { Transport, Remote, DefaultRevivableModules, ErrorMessage } from '../../build/index.js'

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
  // @ts-expect-error remote calls are always async - sync access must fail
  const sync: number = remote.add(1, 2)
  return sum
}

// A worker's own global scope - commonly compiled under lib.dom, where it is NOT
// assignable to Window - must be accepted via the structural WorkerSelf member.
const workerSelf: Transport = globalThis
expose({}, { transport: globalThis, key: 'worker-self' })

// Capable regression: lib.dom declares empty-interface Transferable members
// (MediaSourceHandle) that once structurally absorbed every object, silencing
// all of these rejections.
// @ts-expect-error WeakMap is not Capable
expose({ ok: async () => 1, cache: new WeakMap() }, { transport: worker, key: 'capable-1' })
// @ts-expect-error a WeakSet nested deep must still be caught
expose({ a: { b: [new WeakSet()] } }, { transport: worker, key: 'capable-2' })

// And the check must not over-reject: everything Capable stays assignable,
// including inline array literals - the `const` type parameter infers them as
// readonly tuples, which the mutable-Array union used to exclude (masked by
// the same absorption).
expose({
  fn: async (n: number) => n + 1,
  date: new Date(),
  stream: new ReadableStream(),
  port: new MessageChannel().port1,
  view: new Uint8Array(4),
  map: new Map([['a', 1]]),
  err: new TypeError('x'),
  gen: async function* () { yield 1 },
  list: [1, 2, 3],
  matrix: [[1], [2]],
  nested: { deep: [{ ok: true }] },
}, { transport: worker, key: 'capable-3' })

// JSON transports narrow Capable: clone-only types (File rides the clonable
// module, elided on JSON) must be rejected there but stay accepted on clone.
declare const jsonTransport: { isJson: true, emit: Worker, receive: Worker }
// @ts-expect-error File is only supported on structured-clone transports
expose({ foo: new File([], '') }, { transport: jsonTransport, key: 'json-1' })
expose({ foo: new File([], '') }, { transport: worker, key: 'clone-file' })

// And the rejection must carry the transport-specific error text, not the
// generic one - pin both messages via an instantiation expression on expose.
type JsonFileError = Parameters<typeof expose<
  unknown, DefaultRevivableModules,
  typeof jsonTransport,
  { foo: File }
>>[0]
const jsonFileMessage: JsonFileError[typeof ErrorMessage] =
  'Value type is only supported on structured-clone transports, not on JSON transports'
// @ts-expect-error the generic message must not be the one resolved for File
const jsonFileWrong: JsonFileError[typeof ErrorMessage] = 'Value type must resolve to a Capable'

// A type unsupported on EVERY transport keeps the generic message on JSON too.
type JsonWeakMapError = Parameters<typeof expose<
  unknown, DefaultRevivableModules,
  typeof jsonTransport,
  { cache: WeakMap<object, string> }
>>[0]
const jsonWeakMapMessage: JsonWeakMapError[typeof ErrorMessage] = 'Value type must resolve to a Capable'

void jsonFileMessage; void jsonFileWrong; void jsonWeakMapMessage
