// Basic worker example - split at the section markers into worker.js and main.js to run.

// ============================== worker.js ===================================

import { expose } from 'osra'

let hits = 0

const api = {
  add: (a, b) => a + b,

  counter: {
    hit: () => ++hits,
    current: () => hits,
  },

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

  const api = await expose({}, { transport: worker })

  console.log(await api.add(2, 3)) // 5

  console.log(await api.counter.hit()) // 1
  console.log(await api.counter.hit()) // 2
  console.log(await api.counter.current()) // 2

  for await (const tick of await api.countdown(3)) {
    console.log(tick) // 3, 2, 1, 'liftoff'
  }

  worker.terminate()
}

main().catch(console.error)
