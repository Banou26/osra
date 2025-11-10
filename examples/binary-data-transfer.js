// Binary Data and Transfer Example
// This example shows how to efficiently handle binary data with Osra

// === worker.js ===
import { expose, transfer } from 'osra'

const imageProcessor = {
  // Process image data - receives ImageData or ArrayBuffer
  async applyGrayscale(imageData) {
    console.log('Worker: Applying grayscale filter')

    // If it's an ArrayBuffer, assume it's raw RGBA data
    const data = imageData.data || new Uint8ClampedArray(imageData)

    // Apply grayscale filter
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      data[i] = gray     // Red
      data[i + 1] = gray // Green
      data[i + 2] = gray // Blue
      // Alpha stays the same
    }

    // Transfer the data back instead of cloning
    // This is more efficient for large binary data
    if (imageData.data) {
      // Return as ImageData
      return transfer(imageData)
    } else {
      // Return as ArrayBuffer
      return transfer(data.buffer)
    }
  },

  // Generate large binary data
  async generateNoise(width, height) {
    console.log(`Worker: Generating ${width}x${height} noise`)

    const size = width * height * 4 // RGBA
    const buffer = new ArrayBuffer(size)
    const data = new Uint8ClampedArray(buffer)

    // Fill with random noise
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 255
    }

    // Transfer the buffer - it will be moved, not copied
    return transfer(buffer)
  },

  // Process multiple buffers
  async concatenateBuffers(buffers) {
    console.log(`Worker: Concatenating ${buffers.length} buffers`)

    // Calculate total size
    const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength, 0)

    // Create new buffer
    const result = new ArrayBuffer(totalSize)
    const view = new Uint8Array(result)

    // Copy all buffers
    let offset = 0
    for (const buffer of buffers) {
      view.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
    }

    // Transfer the result
    return transfer(result)
  },

  // Stream large amounts of data
  async *streamChunks(totalSize, chunkSize = 1024 * 1024) { // 1MB chunks
    console.log(`Worker: Streaming ${totalSize} bytes in ${chunkSize} byte chunks`)

    let remaining = totalSize
    let chunkNumber = 0

    while (remaining > 0) {
      const size = Math.min(remaining, chunkSize)
      const buffer = new ArrayBuffer(size)
      const view = new Uint8Array(buffer)

      // Fill with some data (chunk number repeated)
      view.fill(chunkNumber % 256)

      remaining -= size
      chunkNumber++

      // Transfer each chunk
      yield transfer(buffer)

      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  },

  // Work with TypedArrays
  async processFloatData(floatArray) {
    console.log(`Worker: Processing ${floatArray.length} float values`)

    // OSRA preserves TypedArray types
    if (!(floatArray instanceof Float32Array)) {
      throw new Error('Expected Float32Array')
    }

    // Process the data
    const result = new Float32Array(floatArray.length)
    for (let i = 0; i < floatArray.length; i++) {
      result[i] = Math.sin(floatArray[i]) * 2
    }

    // Transfer back
    return transfer(result)
  },

  // Handle Blobs and Files
  async readFileContent(file) {
    console.log(`Worker: Reading file ${file.name} (${file.size} bytes)`)

    // Files and Blobs are automatically handled by Osra
    const text = await file.text()

    return {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified),
      preview: text.substring(0, 1000),
      lineCount: text.split('\n').length
    }
  }
}

expose(imageProcessor, { transport: self })


// === main.js ===
import { expose, transfer } from 'osra'

async function main() {
  const worker = new Worker('./worker.js', { type: 'module' })
  const processor = await expose({}, { transport: worker })

  // Example 1: Process image data
  console.log('\n=== Image Processing ===')

  // Create some image data
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 100
  const ctx = canvas.getContext('2d')

  // Draw something
  ctx.fillStyle = 'red'
  ctx.fillRect(0, 0, 50, 100)
  ctx.fillStyle = 'blue'
  ctx.fillRect(50, 0, 50, 100)

  // Get image data
  const imageData = ctx.getImageData(0, 0, 100, 100)
  console.log('Main: Original image data size:', imageData.data.byteLength, 'bytes')

  // Process it in the worker - transfer for efficiency
  const processed = await processor.applyGrayscale(transfer(imageData))
  console.log('Main: Processed image data received')
  // Note: original imageData is now detached and unusable

  // Example 2: Generate binary data
  console.log('\n=== Binary Data Generation ===')

  const noise = await processor.generateNoise(512, 512)
  console.log('Main: Generated noise buffer size:', noise.byteLength, 'bytes')

  // Example 3: Concatenate buffers
  console.log('\n=== Buffer Concatenation ===')

  const buffers = [
    new ArrayBuffer(1000),
    new ArrayBuffer(2000),
    new ArrayBuffer(3000)
  ]

  // Fill with some data
  new Uint8Array(buffers[0]).fill(1)
  new Uint8Array(buffers[1]).fill(2)
  new Uint8Array(buffers[2]).fill(3)

  // Transfer all buffers for processing
  const concatenated = await processor.concatenateBuffers(buffers.map(transfer))
  console.log('Main: Concatenated buffer size:', concatenated.byteLength, 'bytes')

  // Example 4: Stream large data
  console.log('\n=== Data Streaming ===')

  const totalSize = 10 * 1024 * 1024 // 10MB
  let receivedSize = 0
  let chunkCount = 0

  for await (const chunk of processor.streamChunks(totalSize)) {
    receivedSize += chunk.byteLength
    chunkCount++
    console.log(`Main: Received chunk ${chunkCount}, total: ${receivedSize} bytes`)
  }

  console.log(`Main: Streaming complete, received ${receivedSize} bytes in ${chunkCount} chunks`)

  // Example 5: TypedArrays
  console.log('\n=== TypedArray Processing ===')

  const floatData = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0])
  console.log('Main: Original float data:', floatData)

  const processedFloats = await processor.processFloatData(transfer(floatData))
  console.log('Main: Processed float data:', processedFloats)
  console.log('Main: Type preserved:', processedFloats instanceof Float32Array)

  // Example 6: File handling
  console.log('\n=== File Processing ===')

  // Create a file
  const content = 'Hello, Osra!\n'.repeat(100)
  const file = new File([content], 'test.txt', { type: 'text/plain' })

  const fileInfo = await processor.readFileContent(file)
  console.log('Main: File info:', fileInfo)

  // Performance comparison: Transfer vs Clone
  console.log('\n=== Performance: Transfer vs Clone ===')

  const largeBuffer = new ArrayBuffer(50 * 1024 * 1024) // 50MB

  // Clone (default behavior)
  console.time('Clone')
  await processor.concatenateBuffers([largeBuffer])
  console.timeEnd('Clone')

  // Transfer (more efficient)
  const largeBuffer2 = new ArrayBuffer(50 * 1024 * 1024) // 50MB
  console.time('Transfer')
  await processor.concatenateBuffers([transfer(largeBuffer2)])
  console.timeEnd('Transfer')

  console.log('Note: Transfer is typically much faster for large data')

  worker.terminate()
}

// Run the example
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    main().catch(console.error)
  })
} else {
  console.log('This example requires a browser environment with document/canvas support')
}