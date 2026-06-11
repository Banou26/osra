// Binary data over osra - TypedArrays, ArrayBuffers, Blobs, transfer(),
// and a ReadableStream of binary chunks.
//
// Two files are shown in one for readability: split at the section markers
// into worker.js and main.js to run.

// ============================== worker.js ===================================

import { expose } from 'osra'

const api = {
  // TypedArrays arrive as the same concrete type (Uint8Array stays a
  // Uint8Array, Float64Array a Float64Array, …).
  echo: (view) => view,

  sum: (view) => view.reduce((total, byte) => total + byte, 0),

  describe: (view) => ({
    constructorName: view.constructor.name,
    byteLength: view.byteLength,
    values: [...view],
  }),

  byteLength: (buffer) => buffer.byteLength,

  // ArrayBuffers round-trip as ArrayBuffers.
  double: (buffer) => {
    const input = new Uint8Array(buffer)
    const out = new Uint8Array(input.length)
    for (let i = 0; i < input.length; i++) out[i] = input[i] * 2
    return out.buffer
  },

  // Blobs revive on the receiving side as Promise<Blob> - the bytes are
  // fetched asynchronously, so the receiver has to await them.
  makeReport: () => ({
    name: 'report.csv',
    blob: new Blob(['id,value\n1,255\n'], { type: 'text/csv' }),
  }),

  // ReadableStream: chunks are pulled across the wire on demand. Backpressure
  // is real but both ends queue with the default highWaterMark of 1, so up to
  // ~2 chunks are produced eagerly before the consumer's first read; after
  // that, production tracks reads. Cancelling on the consumer side propagates
  // the cancel reason back to this source.
  randomBytes: (chunkCount, chunkSize) => {
    let sent = 0
    return new ReadableStream({
      pull: controller => {
        if (sent === chunkCount) {
          controller.close()
          return
        }
        const chunk = new Uint8Array(chunkSize)
        crypto.getRandomValues(chunk)
        sent++
        controller.enqueue(chunk)
      },
    })
  },
}

expose(api, { transport: self })

// ============================== main.js =====================================

import { expose, transfer } from 'osra'

const main = async () => {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  const api = await expose({}, { transport: worker })

  // --- TypedArrays, including subarray views --------------------------------
  const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
  console.log(await api.sum(backing)) // 28

  // A subarray view sends exactly the view's window - the receiver sees the
  // 3 bytes [2, 3, 4], not the 8-byte backing buffer.
  console.log(await api.describe(backing.subarray(2, 5)))
  // { constructorName: 'Uint8Array', byteLength: 3, values: [2, 3, 4] }

  // The concrete TypedArray type survives the round-trip.
  const floats = new Float64Array([0.5, 1.5])
  console.log((await api.echo(floats)) instanceof Float64Array) // true

  // --- ArrayBuffer -----------------------------------------------------------
  const buffer = new Uint8Array([10, 20, 30]).buffer
  const doubled = await api.double(buffer)
  console.log(doubled instanceof ArrayBuffer, [...new Uint8Array(doubled)]) // true [20, 40, 60]
  // The default is COPY semantics - the local buffer is untouched after a send.
  console.log(buffer.byteLength) // 3

  // --- Blob: revives as Promise<Blob> - await it explicitly ------------------
  const report = await api.makeReport()
  // report.blob is NOT a Blob yet, it is a Promise<Blob>.
  const blob = await report.blob
  console.log(blob instanceof Blob, blob.type) // true 'text/csv'
  console.log(await blob.text()) // 'id,value\n1,255\n'

  // --- transfer(): opt-in move semantics -------------------------------------
  const big = new ArrayBuffer(16 * 1024 * 1024)
  console.log(await api.byteLength(transfer(big))) // 16777216
  // The source buffer is detached after the send - but ONLY when the
  // platform/transport actually supports transfer (structured-clone
  // transports like this Worker). On JSON transports (WebSocket, web
  // extension messaging) transfer() silently degrades to a copy and the
  // source stays usable.
  console.log(big.byteLength) // 0 - detached

  // --- ReadableStream of binary chunks ---------------------------------------
  const stream = await api.randomBytes(4, 1024)
  const reader = stream.getReader()
  let received = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    received += value.byteLength
  }
  console.log(received) // 4096

  worker.terminate()
}

main().catch(console.error)
