import type {
  Capable,
  RevivableMessagePort,
  RevivableVariant,
  Message,
  Uuid
} from '../../types'
import type { ConnectionRevivableContext } from '../connection'
import type { StrictMessagePort } from '../message-channel'

import { isRevivableBox } from '../type-guards'
import { getTransferableObjects } from '../transferable'

export const name = 'messagePort'

export const is = (value: unknown): value is MessagePort =>
  value instanceof MessagePort

export const box = (
  value: MessagePort,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  _recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): RevivableVariant & { type: 'messagePort' } => {
  const messagePort = value as StrictMessagePort<Capable>
  const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort })
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : recursiveBox(data, context),
      portId
    })
  })
  messagePort.start()

  // The ReceiveTransport received a message from the other side so we call it on our own side's MessagePort after reviving it
  context.eventTarget.addEventListener('message', function listener ({ detail: message }) {
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
    type: 'messagePort',
    portId
  }
}

export const revive = (
  value: RevivableMessagePort,
  context: ConnectionRevivableContext,
  recursiveBox: (value: Capable, context: ConnectionRevivableContext) => Capable,
  recursiveRevive: (value: Capable, context: ConnectionRevivableContext) => Capable
): StrictMessagePort<Capable> => {
  const { port1: userPort, port2: internalPort } = new MessageChannel()
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }: MessageEvent<Message & { type: 'message' }>) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : recursiveBox(data, context),
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
  port1.addEventListener('message', function listener ({ data: message }) {
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
    } else { // In this case, userPort is actually passed by the user of osra and we should revive all the message data
      const revivedData = recursiveRevive(message.data, context)
      internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
    }
  })
  port1.start()
  return userPort
}
