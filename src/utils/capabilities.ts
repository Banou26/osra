import { getTransferableObjects } from './transferable'

export type PlatformCapabilities = {
  jsonOnly: boolean
  messagePort: boolean
  arrayBuffer: boolean
  transferable: boolean
  transferableStream: boolean
}

const probePlatformCapabilityUtil = <T>(value: T, transfer = false): Promise<T> => {
  const { port1, port2 } = new MessageChannel()
  const result = new Promise<T>(resolve =>
    port1.addEventListener('message', message =>
      resolve(message.data)
    )
  )
  port1.start()
  port2.postMessage(value, transfer ? getTransferableObjects(value) : [])
  return result
}

const probeMessagePortTransfer = async () => {
  const { port1 } = new MessageChannel()
  const port = await probePlatformCapabilityUtil(port1, true)
  return port instanceof MessagePort
}

const probeArrayBufferClone = async () => {
  const buffer = new ArrayBuffer(1)
  const arrayBuffer = await probePlatformCapabilityUtil(buffer)
  return arrayBuffer instanceof ArrayBuffer
}

const probeArrayBufferTransfer = async () => {
  const buffer = new ArrayBuffer(1)
  const arrayBuffer = await probePlatformCapabilityUtil(buffer, true)
  return arrayBuffer instanceof ArrayBuffer
}

const probeTransferableStream = async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1))
      controller.close()
    }
  })
  const transferableStream = await probePlatformCapabilityUtil(stream, true)
  return transferableStream instanceof ReadableStream
}

export const probePlatformCapabilities = async (): Promise<PlatformCapabilities> => {
  const [
    messagePort,
    arrayBuffer,
    transferable,
    transferableStream,
  ] = await Promise.all([
    probeMessagePortTransfer().catch(() => false),
    probeArrayBufferClone().catch(() => false),
    probeArrayBufferTransfer().catch(() => false),
    probeTransferableStream().catch(() => false)
  ])
  return {
    jsonOnly:
      !messagePort
      && !arrayBuffer
      && !transferable
      && !transferableStream,
    messagePort,
    arrayBuffer,
    transferable,
    transferableStream,
  }
}
