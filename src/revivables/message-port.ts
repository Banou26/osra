import type { Capable, ConnectionMessage, Message, StructurableTransferable, Uuid } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext, BoxBase as BoxBaseType, UnderlyingType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { OSRA_BOX } from '../types'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'

/**
 * FinalizationRegistry for automatically cleaning up MessagePorts when they are garbage collected.
 * This is used in JSON-only mode where MessagePorts can't be transferred directly.
 */
type PortCleanupInfo = {
  sendMessage: (message: ConnectionMessage) => void
  remoteUuid: Uuid
  portId: string
  cleanup: () => void
}

const messagePortRegistry = new FinalizationRegistry<PortCleanupInfo>((info) => {
  console.log('cleanup', info.portId)
  // Send close message to remote side
  info.sendMessage({
    type: 'message-port-close',
    remoteUuid: info.remoteUuid,
    portId: info.portId
  })
  // Perform local cleanup
  info.cleanup()
})

export const type = 'messagePort' as const

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

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: StructurableTransferablePort<T>,
  context: T2
) => {
  if (isJsonOnlyTransport(context.transport)) {
    const messagePort = value as StrictMessagePort<ExtractStructurableTransferable<T>>
    // Only generate a unique UUID, don't store the port in the allocator.
    // Storing the port would create a strong reference that prevents GC and FinalizationRegistry cleanup.
    const portId = context.messageChannels.getUniqueUuid()

    // Use WeakRef to allow messagePort to be garbage collected.
    // The eventTargetListener would otherwise hold a strong reference preventing GC.
    const messagePortRef = new WeakRef(messagePort)

    // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
    // Define listener before registering with FinalizationRegistry so we can remove it in cleanup
    const eventTargetListener = ({ detail: message }: CustomEvent<Message>) => {
      if (message.type === 'message-port-close') {
        if (message.portId !== portId) return
        context.messageChannels.free(portId)
        console.log('free', portId)
        const port = messagePortRef.deref()
        if (port) {
          // Unregister from FinalizationRegistry to prevent double-close
          messagePortRegistry.unregister(port)
          port.close()
        }
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      if (message.type !== 'message' || message.portId !== portId) return
      const port = messagePortRef.deref()
      if (!port) {
        // Port was garbage collected, remove this listener
        context.eventTarget.removeEventListener('message', eventTargetListener)
        return
      }
      port.postMessage(message.data as ExtractStructurableTransferable<T>, getTransferableObjects(message.data))
    }

    // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
    // Define this listener before registering so it can be removed in cleanup
    function messagePortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: (isAlreadyBoxed(data) ? data : recursiveBox(data as Capable, context)) as Capable,
        portId
      })
    }

    // Register the messagePort for automatic cleanup when garbage collected
    // Use messagePort itself as the unregister token
    messagePortRegistry.register(messagePortRef.deref()!, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: () => {
        context.messageChannels.free(portId)
        console.log('free', portId)
        context.eventTarget.removeEventListener('message', eventTargetListener)
        messagePortRef.deref()?.removeEventListener('message', messagePortListener)
        messagePortRef.deref()?.close()
      }
    }, messagePortRef.deref())

    messagePortRef.deref()?.addEventListener('message', messagePortListener)
    messagePortRef.deref()?.start()

    context.eventTarget.addEventListener('message', eventTargetListener)
  
    const result = {
      ...BoxBase,
      type,
      portId
    }
    return result as typeof result & { [UnderlyingType]: StrictMessagePort<ExtractStructurableTransferable<T>> }
  }
  const result = {
    ...BoxBase,
    type,
    port: value
  }
  return result as typeof result & { [UnderlyingType]: StrictMessagePort<ExtractStructurableTransferable<T>> }
}

export const revive = <T extends StructurableTransferable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2
): StrictMessagePort<T> => {
  if ('portId' in value) {
    const { portId } = value
    const { port1: userPort, port2: internalPort } = new MessageChannel()

    const existingChannel = context.messageChannels.get(value.portId)
    const { port1 } =
      existingChannel
        ? existingChannel
        : context.messageChannels.alloc(value.portId as Uuid)

    const userPortRef = new WeakRef(userPort)

    // Define all listeners before registering so they can be removed in cleanup
    const eventTargetListener = ({ detail: message }: CustomEvent<Message>) => {
      if (message.type !== 'message-port-close' || message.portId !== portId) return
      const port = userPortRef.deref()
      if (port) {
        // Unregister from FinalizationRegistry to prevent double-close
        messagePortRegistry.unregister(port)
      }
      performCleanup()
    }

    const port1Listener = ({ data: message }: MessageEvent) => {
      if (message.type !== 'message' || message.portId !== portId) return

      const port = userPortRef.deref()
      if (!port) {
        // Port was garbage collected, cleanup
        performCleanup()
        return
      }

      // if the returned messagePort has been registered as internal message port, then we proxy the data without reviving it
      if (context.messagePorts.has(port)) {
        internalPort.postMessage(message.data)
      } else {
        // In this case, userPort is actually passed by the user of osra and we should revive all the message data
        const revivedData = recursiveRevive(message.data, context)
        internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
      }
    }

    // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
    // Define this listener before performCleanup so it can be removed in cleanup
    function internalPortListener({ data }: MessageEvent) {
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: isAlreadyBoxed(data) ? data : recursiveBox(data, context),
        portId: portId as Uuid
      })
    }

    const performCleanup = () => {
      context.eventTarget.removeEventListener('message', eventTargetListener)
      port1.removeEventListener('message', port1Listener)
      internalPort.removeEventListener('message', internalPortListener)
      internalPort.close()
      // Close the allocator's MessageChannel ports before freeing
      // The allocator creates a MessageChannel with port1 and port2 - both must be closed
      const allocatedChannel = context.messageChannels.get(portId)
      if (allocatedChannel) {
        allocatedChannel.port1.close()
        if (allocatedChannel.port2) {
          allocatedChannel.port2.close()
        }
      }
      console.log('free', portId)
      context.messageChannels.free(portId)
    }

    // Register the userPort for automatic cleanup when garbage collected
    // Use userPort itself as the unregister token
    messagePortRegistry.register(userPort, {
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      portId,
      cleanup: performCleanup
    }, userPort)

    internalPort.addEventListener('message', internalPortListener)
    internalPort.start()

    // Listen for close messages from the remote side through the main event target
    context.eventTarget.addEventListener('message', eventTargetListener)

    // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
    port1.addEventListener('message', port1Listener)
    port1.start()

    return userPort as StrictMessagePort<T>
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
