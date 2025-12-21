import type { Capable, Uuid } from '../../types'
import type { ConnectionRevivableContext } from '../connection'
import type { StrictMessagePort } from '../message-channel'

import { OSRA_BOX } from '../../types'
import { getTransferableObjects } from '../transferable'

// Note: isRevivableBox is imported late to avoid circular dependency
const isRevivableBox = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable'

export const type = 'messagePort' as const
export const supportsPassthrough = true as const

export type Source = MessagePort

export type Boxed = {
  type: typeof type
  portId: string
}

export type Box = { [OSRA_BOX]: 'revivable' } & Boxed

export const is = (value: unknown): value is Source =>
  value instanceof MessagePort

// MessagePort is transferable
export const isTransferable = is

export const isBox = (value: unknown): value is Box =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_BOX in value &&
  (value as Record<string, unknown>)[OSRA_BOX] === 'revivable' &&
  (value as Record<string, unknown>).type === type

export const shouldBox = (_value: Source, context: ConnectionRevivableContext): boolean =>
  'isJson' in context.transport && Boolean(context.transport.isJson)

export const box = (
  value: Source,
  context: ConnectionRevivableContext
): Boxed => {
  const messagePort = value as StrictMessagePort<Capable>
  const { uuid: portId } = context.messageChannels.alloc(undefined, { port1: messagePort })
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  messagePort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : context.recursiveBox(data, context),
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
    type,
    portId
  }
}

export const revive = (
  value: Boxed,
  context: ConnectionRevivableContext
): StrictMessagePort<Capable> => {
  const { port1: userPort, port2: internalPort } = new MessageChannel()
  // Since we are in a boxed MessagePort, we want to send a message to the other side through the EmitTransport
  internalPort.addEventListener('message', ({ data }) => {
    context.sendMessage({
      type: 'message',
      remoteUuid: context.remoteUuid,
      data: isRevivableBox(data) ? data : context.recursiveBox(data, context),
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
      const revivedData = context.recursiveRevive(message.data, context)
      internalPort.postMessage(revivedData, getTransferableObjects(revivedData))
    }
  })
  port1.start()
  return userPort
}
