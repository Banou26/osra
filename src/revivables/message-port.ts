import type { Capable, Uuid } from '../types'
import type { StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext } from './utils'

import { BoxBase, recursiveBox, recursiveRevive } from '.'
import { OSRA_BOX } from '../types'
import { getTransferableObjects } from '../utils'

export const type = 'messagePort' as const

export const isType = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

const isAlreadyBoxed = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'

export const box = <T extends RevivableContext>(
  value: MessagePort,
  context: T
) => {
  const messagePort = value as StrictMessagePort<Capable>
  const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort })

  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isAlreadyBoxed(data) ? data : recursiveBox(data, context),
      portId
    })
  })
  messagePort.start()

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.eventTarget.addEventListener('message', function listener({ detail: message }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== portId) return
      context.eventTarget.removeEventListener('message', listener)
      messagePort.close()
      context.messageChannels.free(portId)
      return
    }
    if (message.type !== 'message' || message.portId !== portId) return
    messagePort.postMessage(message.data, getTransferableObjects(message.data))
  })

  return {
    ...BoxBase,
    type,
    portId
  }
}

export const revive = <T extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T
): StrictMessagePort<Capable> => {
  const { port1: userPort, port2: internalPort } = new MessageChannel()

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

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  port1.addEventListener('message', function listener({ data: message }) {
    if (message.type === 'message-port-close') {
      if (message.portId !== value.portId) return
      port1.removeEventListener('message', listener)
      internalPort.close()
      context.messageChannels.free(value.portId)
      return
    }
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

  return userPort
}
