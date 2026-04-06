export type PlatformCapabilities = {
  jsonOnly: boolean
  messagePort: boolean
  arrayBuffer: boolean
  transferable: boolean
  transferableStream: boolean
}

const canTransferMessagePort = () => {
  try {
    const { port1, port2 } = new MessageChannel()
    port2.postMessage(port1, [port1])
    port2.close()
    return true
  } catch {
    return false
  }
}

const canCloneArrayBuffer = () => {
  try {
    const { port1, port2 } = new MessageChannel()
    port2.postMessage(new ArrayBuffer(1))
    port2.close()
    port1.close()
    return true
  } catch {
    return false
  }
}

const canTransferArrayBuffer = () => {
  try {
    const buf = new ArrayBuffer(1)
    const { port1, port2 } = new MessageChannel()
    port2.postMessage(buf, [buf])
    port2.close()
    port1.close()
    return true
  } catch {
    return false
  }
}

const canTransferStream = () => {
  try {
    const stream = new ReadableStream()
    const { port1, port2 } = new MessageChannel()
    port2.postMessage(stream, [stream])
    port2.close()
    port1.close()
    return true
  } catch {
    return false
  }
}

export const probePlatformCapabilities = (): PlatformCapabilities => {
  const messagePort = canTransferMessagePort()
  const arrayBuffer = canCloneArrayBuffer()
  const transferable = canTransferArrayBuffer()
  const transferableStream = canTransferStream()
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
