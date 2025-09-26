import { TransferableObject } from "../types"

export type Capabilities = {
  jsonOnly: boolean
  messagePort: boolean
  arrayBuffer: boolean
  transferable: boolean
  transferableStream: boolean
}

export const isClonable = (value: any) =>
  globalThis.SharedArrayBuffer && value instanceof globalThis.SharedArrayBuffer ? true
  : false

export const isTransferable = (value: any) =>
  globalThis.ArrayBuffer && value instanceof globalThis.ArrayBuffer ? true
  : globalThis.MessagePort && value instanceof globalThis.MessagePort ? true
  : globalThis.ReadableStream && value instanceof globalThis.ReadableStream ? true
  : globalThis.WritableStream && value instanceof globalThis.WritableStream ? true
  : globalThis.TransformStream && value instanceof globalThis.TransformStream ? true
  : globalThis.ImageBitmap && value instanceof globalThis.ImageBitmap ? true
  : false

export const getTransferableObjects = (value: any): TransferableObject[] => {
  const transferables: TransferableObject[] = []
  const recurse = (value: any): any =>
    isClonable(value) ? undefined
    : isTransferable(value) ? transferables.push(value)
    : Array.isArray(value) ? value.map(recurse)
    : value && typeof value === 'object' ? Object.values(value).map(recurse)
    : undefined

  recurse(value)
  return transferables
}

export type WebExtRuntime = typeof browser.runtime
export type WebExtOnConnect = WebExtRuntime['onConnect']
export type WebExtOnMessage = WebExtRuntime['onMessage']
export type WebExtPort = ReturnType<WebExtRuntime['connect']>
export type WebExtSender = NonNullable<WebExtPort['sender']>

export const getWebExtensionGlobal = () => globalThis.browser ?? globalThis.chrome
export const getWebExtensionRuntime = () => getWebExtensionGlobal().runtime

export const isWebExtensionOnConnect = (object: any): object is WebExtOnConnect =>
  Boolean(
    (object as WebExtOnConnect)
    && (object as WebExtOnConnect).addListener
    && (object as WebExtOnConnect).hasListener
    && (object as WebExtOnConnect).removeListener
  )

export const isWindow = (object: any): object is Window => {
  return Boolean(
    (object as Window)
    && object.document
    && object.location
    && object.navigator
    && object.screen
    && object.history
  )
}

export const isWebExtensionPort = (object: any): object is WebExtPort => {
  return Boolean(
    (object as WebExtOnConnect)
    && object.name
    && object.disconnect
    && object.postMessage
    //** Only present on Port created through runtime.connect(), so we force using connections */
    && object.sender
    && object.onMessage
    && object.onDisconnect
  )
}

export const isWebExtensionRuntime = (object: any): object is WebExtRuntime => {
  const runtime = getWebExtensionRuntime()
  return Boolean(
    (object as WebExtOnConnect)
    && isWebExtensionOnConnect(runtime.onConnect)
    && runtime.id
  )
}

const probeCapabilityUtil = <T>(value: T, transfer = false): Promise<T> => {
  const tranferables = transfer ? getTransferableObjects(value) : []
  const { port1, port2 } = new MessageChannel()
  const result = new Promise<T>(resolve =>
    port1.addEventListener('message', message =>
      resolve(message.data)
    )
  )
  port2.postMessage(value, tranferables)
  return result
}

const probeMessagePortTransfer = async () => {
  const { port1 } = new MessageChannel()
  const port = await probeCapabilityUtil(port1, true)
  return port instanceof MessagePort
}

const probeArrayBufferClone = async () => {
  const buffer = new ArrayBuffer(1)
  const arrayBuffer = await probeCapabilityUtil(buffer)
  return arrayBuffer instanceof ArrayBuffer
}

const probeArrayBufferTransfer = async () => {
  const buffer = new ArrayBuffer(1)
  const arrayBuffer = await probeCapabilityUtil(buffer, true)
  return arrayBuffer instanceof ArrayBuffer
}

const probeTransferableStream = async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1))
      controller.close()
    }
  })
  const transferableStream = await probeCapabilityUtil(stream)
  return transferableStream instanceof ReadableStream
}

export const probeCapabilities = async (): Promise<Capabilities> => {
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
