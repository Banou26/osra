// Basic Worker Example
// This example shows the simplest use case for Osra with Web Workers

// === worker.js ===
import { expose } from 'osra'

// Define your API
const workerAPI = {
  // Simple calculation
  add: async (a, b) => {
    console.log(`Worker: Adding ${a} + ${b}`)
    return a + b
  },

  // Async operation
  fetchData: async (url) => {
    console.log(`Worker: Fetching ${url}`)
    const response = await fetch(url)
    return response.json()
  },

  // Return complex object with functions
  createCounter: async (initialValue = 0) => {
    let count = initialValue

    return {
      increment: async () => ++count,
      decrement: async () => --count,
      getValue: async () => count,
      reset: async () => { count = initialValue; return count }
    }
  }
}

// Expose the API through the worker
expose(workerAPI, { transport: self })

console.log('Worker: Ready to receive messages')


// === main.js ===
import { expose } from 'osra'

async function main() {
  // Create a worker
  const worker = new Worker('./worker.js', { type: 'module' })

  // Connect to the worker - note the empty object as first parameter
  const api = await expose({}, { transport: worker })

  // Now you can call worker functions as if they were local!

  // Simple function call
  const sum = await api.add(5, 3)
  console.log(`Main: 5 + 3 = ${sum}`) // 8

  // Async operation
  const data = await api.fetchData('https://jsonplaceholder.typicode.com/posts/1')
  console.log('Main: Fetched data:', data)

  // Complex object with methods
  const counter = await api.createCounter(10)
  console.log('Main: Initial value:', await counter.getValue()) // 10
  console.log('Main: After increment:', await counter.increment()) // 11
  console.log('Main: After increment:', await counter.increment()) // 12
  console.log('Main: After decrement:', await counter.decrement()) // 11
  console.log('Main: After reset:', await counter.reset()) // 10

  // Clean up when done
  worker.terminate()
}

main().catch(console.error)