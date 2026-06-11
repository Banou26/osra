// Basic worker example - main thread <-> module worker over osra.
//
// Two files are shown in one for readability: split at the section markers
// into worker.js and main.js to run. Both sides call expose() - each side
// hands osra its own value and receives the other side's value, with live
// semantics: functions stay callable, generators stay iterable.

// ============================== worker.js ===================================

import { expose } from 'osra'

let hits = 0

const api = {
  add: (a, b) => a + b,

  // Nested objects keep their shape - nested functions are proxied too.
  counter: {
    hit: () => ++hits,
    current: () => hits,
  },

  // Async generators are proxied: next/return/throw cross the wire, so
  // for-await works on the main thread, and an early `break` over there
  // propagates return() back into this generator.
  countdown: async function* (from) {
    for (let i = from; i > 0; i--) yield i
    yield 'liftoff'
  },
}

expose(api, { transport: self })

// ============================== main.js =====================================

import { expose } from 'osra'

const main = async () => {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

  // This side shares nothing, so it passes {}. The returned promise resolves
  // with the worker's value once the handshake completes.
  const api = await expose({}, { transport: worker })

  // Every remote function returns a Promise - even ones that are sync on the
  // worker side, since the call crosses the wire.
  console.log(await api.add(2, 3)) // 5

  console.log(await api.counter.hit()) // 1
  console.log(await api.counter.hit()) // 2
  console.log(await api.counter.current()) // 2

  // Calling a remote async generator returns a Promise of the iterator -
  // await the call, then for-await the result.
  for await (const tick of await api.countdown(3)) {
    console.log(tick) // 3, 2, 1, 'liftoff'
  }

  worker.terminate()
}

main().catch(console.error)
