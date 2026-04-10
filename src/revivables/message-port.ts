import type { Capable, ConnectionMessage, Message, StructurableTransferable, Uuid } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { OSRA_BOX } from '../types'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'

type PortCleanupInfo = {
  sendMessage: (message: ConnectionMessage) => void
  remoteUuid: Uuid
  portId: string
  cleanup: () => void
}

const messagePortRegistry = new FinalizationRegistry<PortCleanupInfo>((info) => {
  info.sendMessage({
    type: 'message-port-close',
    remoteUuid: info.remoteUuid,
    portId: info.portId
  })
  info.cleanup()
})

export const type = 'messagePort' as const

export type Messages =
  | { type: 'message'; remoteUuid: Uuid; data: Capable; portId: Uuid }
  | { type: 'message-port-close'; remoteUuid: Uuid; portId: string }
export declare const Messages: Messages

export type BoxedMessagePort<T extends StructurableTransferable = StructurableTransferable> =
  & BoxBaseType<typeof type>
  & ({ portId: string } | { port: StrictMessagePort<T> })
  & { [UnderlyingType]: StrictMessagePort<T> }

declare const StructurableTransferableError: unique symbol
type StructurableTransferablePort<T> = T extends StructurableTransferable
  ? StrictMessagePort<T>
  : { [StructurableTransferableError]: 'Message type must extend StructurableTransferable'; __badType__: T }

type ExtractStructurableTransferable<T> = T extends StructurableTransferable ? T : never

export const isType = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

const isAlreadyBoxed = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'

// ---------------------------------------------------------------------------
// Single shared eventTarget listener per connection, dispatching by portId.
// O(1) lookup via Map. Messages for portIds without a handler yet are buffered
// and drained when the handler registers (fixes the JSON-only race where
// MessagePort.postMessage is async and transport messages can overtake it).
// ---------------------------------------------------------------------------
type PortHandler = (message: Message) => void
type PortDispatcher = {
  handlers: Map<string, PortHandler>
  pending: Map<string, Message[]>
}

const dispatchers = new WeakMap<object, PortDispatcher>()

const getDispatcher = (eventTarget: RevivableContext['eventTarget']): PortDispatcher => {
  let d = dispatchers.get(eventTarget)
  if (d) return d
  const handlers = new Map<string, PortHandler>()
  const pending = new Map<string, Message[]>()
  d = { handlers, pending }
  dispatchers.set(eventTarget, d)
  eventTarget.addEventListener('message', (event) => {
    const message = (event as CustomEvent<Message>).detail
    if (!message || !('portId' in message)) return
    const portId = (message as { portId: string }).portId
    const handler = handlers.get(portId)
    if (handler) {
      handler(message)
    } else {
      let queue = pending.get(portId)
      if (!queue) {
        queue = []
        pending.set(portId, queue)
      }
      queue.push(message)
    }
  })
  return d
}

// ---------------------------------------------------------------------------
// Explicit cleanup for boxed ports. Callers (function.ts, promise.ts, etc.)
// invoke this when a port's job is done, so cleanup is deterministic instead
// of waiting for GC + FinalizationRegistry (which never fires for started
// MessagePorts kept alive by the browser's event loop).
// ---------------------------------------------------------------------------
const portCleanups = new WeakMap<object, () => void>()

export const cleanupBoxedPort = (port: MessagePort): void => {
  const cleanup = portCleanups.get(port)
  if (!cleanup) return
  portCleanups.delete(port)
  messagePortRegistry.unregister(port)
  cleanup()
}

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2
) => {
  if (isJsonOnlyTransport(context.transport)) {
    const messagePort = value as StrictMessagePort<ExtractStructurableTransferable<T>>
    const portId = crypto.randomUUID()
    const messagePortRef = new WeakRef(messagePort)
    const dispatcher = getDispatcher(context.eventTarget)

    const boxCleanup = () => {
      dispatcher.handlers.delete(portId)
      dispatcher.pending.delete(portId)
      messagePortRef.deref()?.removeEventListener('message', messagePortListener)
      messagePortRef.deref()?.close()
    }

    dispatcher.handlers.set(portId, (message) => {
      if (message.type === 'message-port-close') {
        messagePortRegistry.unregister(messagePortRef.deref()!)
        portCleanups.delete(messagePort)
        boxCleanup()
        return
      }
      if (message.type !== 'message') return
      const port = messagePortRef.deref()
      if (!port) {
        boxCleanup()
        return
      }
      port.postMessage(message.data as ExtractStructurableTransferable<T>, getTransferableObjects(message.data))
    })

    function messagePortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: (isAlreadyBoxed(data) ? data : recursiveBox(data as Capable, context)) as Capable,
        portId
      })
    }

    portCleanups.set(messagePort, () => {
      boxCleanup()
      // Notify the remote revive side to clean up too
      try {
        context.sendMessage({
          type: 'message-port-close',
          remoteUuid: context.remoteUuid,
          portId
        })
      } catch { /* connection may be closed */ }
    })

    messagePortRegistry.register(messagePortRef.deref()!, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: boxCleanup
    }, messagePortRef.deref())

    messagePortRef.deref()?.addEventListener('message', messagePortListener)
    messagePortRef.deref()?.start()

    const result = { ...BoxBase, type, portId }
    return result as typeof result & { [UnderlyingType]: StrictMessagePort<ExtractStructurableTransferable<T>> }
  }
  const result = { ...BoxBase, type, port: value }
  return result as typeof result & { [UnderlyingType]: StrictMessagePort<ExtractStructurableTransferable<T>> }
}

export const revive = <T extends StructurableTransferable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2
): StrictMessagePort<T> => {
  if ('portId' in value) {
    const { portId } = value
    // Create the channel in an IIFE so `userPort` doesn't leak into the
    // closure scope below. V8 captures ALL variables in a shared scope,
    // so if `userPort` were here, every closure would hold a strong
    // reference to it — preventing GC even though only the WeakRef is used.
    const { internalPort, userPortRef } = (() => {
      const { port1, port2 } = new MessageChannel()
      return { internalPort: port2, userPortRef: new WeakRef(port1) }
    })()
    const dispatcher = getDispatcher(context.eventTarget)

    const reviveCleanup = () => {
      dispatcher.handlers.delete(portId)
      dispatcher.pending.delete(portId)
      internalPort.removeEventListener('message', internalPortListener)
      internalPort.close()
      userPortRef.deref()?.close()
    }

    const handler: PortHandler = (message) => {
      if (message.type === 'message-port-close') {
        const port = userPortRef.deref()
        if (port) {
          messagePortRegistry.unregister(port)
          portCleanups.delete(port)
        }
        reviveCleanup()
        return
      }
      if (message.type !== 'message') return
      const port = userPortRef.deref()
      if (!port) {
        reviveCleanup()
        return
      }
      if (context.messagePorts.has(port)) {
        internalPort.postMessage(message.data)
      } else {
        const revivedData = recursiveRevive(message.data, context)
        internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
      }
    }

    function internalPortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: isAlreadyBoxed(data) ? data : recursiveBox(data, context),
        portId: portId as Uuid
      })
    }

    portCleanups.set(userPortRef.deref()!, () => {
      reviveCleanup()
      try {
        context.sendMessage({
          type: 'message-port-close',
          remoteUuid: context.remoteUuid,
          portId
        })
      } catch { /* connection may be closed */ }
    })

    messagePortRegistry.register(userPortRef.deref()!, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: reviveCleanup
    }, userPortRef.deref()!)

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    dispatcher.handlers.set(portId, handler)
    queueMicrotask(() => {
      const buffered = dispatcher.pending.get(portId)
      if (buffered) {
        dispatcher.pending.delete(portId)
        for (const msg of buffered) handler(msg)
      }
    })

    return userPortRef.deref()! as StrictMessagePort<T>
  }
  return value.port
}

const typeCheck = () => {
  const port = new MessageChannel().port1 as StrictMessagePort<{ foo: string }>
  const boxed = box(port, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: StrictMessagePort<{ foo: string }> = revived
  // @ts-expect-error - wrong message type
  const wrongType: StrictMessagePort<{ bar: number }> = revived
  // @ts-expect-error - non-StructurableTransferable message type
  box(new MessageChannel().port1 as StrictMessagePort<Promise<string>>, {} as RevivableContext)
}
