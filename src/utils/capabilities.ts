import { TransferableObject } from "../types"

export type PlatformCapabilities = {
  jsonOnly: boolean
  messagePort: boolean
  arrayBuffer: boolean
  transferable: boolean
  transferableStream: boolean
}

export const isClonable = (value: any) =>
  globalThis.SharedArrayBuffer && value instanceof globalThis.SharedArrayBuffer ? true
  : false

export const isTransferable = (value: any): value is TransferableObject =>
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

export const isWebExtensionOnConnect = (value: any): value is WebExtOnConnect =>
  Boolean(
    (value as WebExtOnConnect)
    && (value as WebExtOnConnect).addListener
    && (value as WebExtOnConnect).hasListener
    && (value as WebExtOnConnect).removeListener
  )

export const isWindow = (value: any): value is Window => {
  return Boolean(
    (value as Window)
    && value.document
    && value.location
    && value.navigator
    && value.screen
    && value.history
  )
}

export const isWebExtensionPort = (value: any): value is WebExtPort => {
  return Boolean(
    (value as WebExtOnConnect)
    && value.name
    && value.disconnect
    && value.postMessage
    /**
     * Only present on Port created through runtime.connect(),
     * so we force using connections
    */
    && value.sender
    && value.onMessage
    && value.onDisconnect
  )
}

export const isWebExtensionRuntime = (value: any): value is WebExtRuntime => {
  const runtime = getWebExtensionRuntime()
  return Boolean(
    (value as WebExtOnConnect)
    && isWebExtensionOnConnect(runtime.onConnect)
    && runtime.id
  )
}

const probePlatformCapabilityUtil = <T>(value: T, transfer = false): Promise<T> => {
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
  const transferableStream = await probePlatformCapabilityUtil(stream)
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
