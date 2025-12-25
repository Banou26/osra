import type { Capable, ConnectionMessage, Uuid } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { OSRA_BOX } from '../types'
import { getTransferableObjects } from '../utils'

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

export type BoxedMessagePort<T extends Capable = Capable> =
  & BoxBaseType<typeof type>
  & { portId: string }
  & { __type__: StrictMessagePort<T> }

declare const CapableError: unique symbol
type CapablePort<T> = T extends Capable
  ? StrictMessagePort<T>
  : { [CapableError]: 'Message type must extend Capable'; __badType__: T }

type ExtractCapable<T> = T extends Capable ? T : never

export const isType = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

const isAlreadyBoxed = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'

export const box = <T, T2 extends RevivableContext = RevivableContext>(
  value: CapablePort<T>,
  context: T2
) => {
  const messagePort = value as StrictMessagePort<ExtractCapable<T>>
  const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort as unknown as StrictMessagePort<Capable> })

  // Register the messagePort for automatic cleanup when garbage collected
  // Use messagePort itself as the unregister token
  messagePortRegistry.register(messagePort, {
    sendMessage: context.sendMessage,
    remoteUuid: context.remoteUuid,
    portId,
    cleanup: () => {
      context.messageChannels.free(portId)
    }
  }, messagePort)

  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: (isAlreadyBoxed(data) ? data : recursiveBox(data as Capable, context)) as Capable,
      portId
    })
  })
  messagePort.start()

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.eventTarget.addEventListener('message', function listener({ detail: message }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== portId) return
      // Unregister from FinalizationRegistry to prevent double-close
      messagePortRegistry.unregister(messagePort)
      context.eventTarget.removeEventListener('message', listener)
      messagePort.close()
      context.messageChannels.free(portId)
      return
    }
    if (message.type !== 'message' || message.portId !== portId) return
    messagePort.postMessage(message.data as ExtractCapable<T>, getTransferableObjects(message.data))
  })

  const result = {
    ...BoxBase,
    type,
    portId
  }
  return result as typeof result & { __type__: StrictMessagePort<ExtractCapable<T>> }
}

export const revive = <T extends Capable, T2 extends RevivableContext>(
  value: BoxedMessagePort<T>,
  context: T2
): StrictMessagePort<T> => {
  const { port1: userPort, port2: internalPort } = new MessageChannel()

  // Register the userPort for automatic cleanup when garbage collected
  // Use userPort itself as the unregister token
  messagePortRegistry.register(userPort, {
    sendMessage: context.sendMessage,
    remoteUuid: context.remoteUuid,
    portId: value.portId,
    cleanup: () => {
      internalPort.close()
      context.messageChannels.free(value.portId)
    }
  }, userPort)

  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isAlreadyBoxed(data) ? data : recursiveBox(data, context),
      portId: value.portId as Uuid
    })
  })
  internalPort.start()

  const existingChannel = context.messageChannels.get(value.portId)
  const { port1 } =
    existingChannel
      ? existingChannel
      : context.messageChannels.alloc(value.portId as Uuid)

  // Listen for close messages from the remote side through the main event target
  context.eventTarget.addEventListener('message', function closeListener({ detail: message }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== value.portId) return
      // Unregister from FinalizationRegistry to prevent double-close
      messagePortRegistry.unregister(userPort)
      context.eventTarget.removeEventListener('message', closeListener)
      internalPort.close()
      context.messageChannels.free(value.portId)
      return
    }
  })

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  ;(port1 as MessagePort).addEventListener('message', function listener({ data: message }) {
    if (message.type !== 'message' || message.portId !== value.portId) return

    // if the returned messagePort has been registered as internal message port, then we proxy the data without reviving it
    if (context.messagePorts.has(userPort)) {
      internalPort.postMessage(message.data)
    } else {
      // In this case, userPort is actually passed by the user of osra and we should revive all the message data
      const revivedData = recursiveRevive(message.data, context)
      internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
    }
  })
  port1.start()

  return userPort as StrictMessagePort<T>
}
