import type {
  Capable, ConnectionMessage,
  Message,
  MessageEventTarget,
  MessageVariant,
  Transport,
  Uuid
} from '../types'
import type { MessageChannelAllocator } from './allocator'
import type { PlatformCapabilities } from './capabilities'
import type { StrictMessagePort } from './message-channel'

import { recursiveBox, recursiveRevive } from './revivable'
import { makeMessageChannelAllocator } from './allocator'

export type BidirectionalConnectionContext = {
  type: 'bidirectional'
  eventTarget: MessageEventTarget
  connection: BidirectionalConnection
}
export type UnidirectionalEmittingConnectionContext = {
  type: 'unidirectional-emitting'
  connection: UnidirectionalEmittingConnection
}
export type UnidirectionalReceivingConnectionContext = {
  type: 'unidirectional-receiving'
  eventTarget: MessageEventTarget
  connection: UnidirectionalReceivingConnection
}

export type ConnectionContext =
  | BidirectionalConnectionContext
  | UnidirectionalEmittingConnectionContext
  | UnidirectionalReceivingConnectionContext

export type ConnectionRevivableContext = {
  platformCapabilities: PlatformCapabilities
  transport: Transport
  remoteUuid: Uuid
  messagePorts: Set<MessagePort>
  messageChannels: MessageChannelAllocator
  sendMessage: (message: MessageVariant) => void
  eventTarget: MessageEventTarget
}

export type BidirectionalConnection<T extends Capable = Capable> = {
  revivableContext: ConnectionRevivableContext
  close: () => void
  remoteValue: Promise<T>
}

export const startBidirectionalConnection = <T extends Capable>(
  { transport, value, uuid, remoteUuid, platformCapabilities, eventTarget, send, close,
    weAcknowledgedThem, theyAcknowledgedUs }:
  {
    transport: Transport
    value: Capable
    uuid: Uuid
    remoteUuid: Uuid
    platformCapabilities: PlatformCapabilities
    eventTarget: MessageEventTarget
    send: (message: MessageVariant) => void
    close: () => void
    weAcknowledgedThem: boolean
    theyAcknowledgedUs: boolean
  }
) => {
  const revivableContext = {
    platformCapabilities,
    transport,
    remoteUuid,
    messagePorts: new Set(),
    messageChannels: makeMessageChannelAllocator(),
    sendMessage: send,
    eventTarget
  } satisfies ConnectionRevivableContext

  let initResolve: ((message: ConnectionMessage & { type: 'init' }) => void)
  const initMessage = new Promise<ConnectionMessage & { type: 'init' }>((resolve, reject) => {
    initResolve = resolve
  })

  let handshakeComplete = weAcknowledgedThem && theyAcknowledgedUs
  let initSent = false

  const trySendInit = () => {
    if (handshakeComplete && !initSent) {
      initSent = true
      send({
        type: 'init',
        remoteUuid,
        data: recursiveBox(value, revivableContext)
      })
    }
  }

  // Send acknowledge if we haven't yet
  if (!weAcknowledgedThem) {
    send({ type: 'announce', remoteUuid })
    weAcknowledgedThem = true
    handshakeComplete = weAcknowledgedThem && theyAcknowledgedUs
  }

  eventTarget.addEventListener('message', ({ detail }) => {
    if (detail.type === 'announce' && detail.remoteUuid === uuid) {
      // Received acknowledge from peer
      theyAcknowledgedUs = true
      handshakeComplete = weAcknowledgedThem && theyAcknowledgedUs
      trySendInit()
      return
    }
    if (detail.type === 'init') {
      initResolve(detail)
      return
    }
    if (detail.type === 'message') {
      const messageChannel = revivableContext.messageChannels.getOrAlloc(detail.portId)
      messageChannel.port2?.postMessage(detail)
    }
  })

  // Try to send init if handshake already complete
  trySendInit()

  return {
    revivableContext,
    close: () => {
    },
    remoteValue:
      initMessage
        .then(initMessage => recursiveRevive(initMessage.data, revivableContext)) as Promise<T>
  } satisfies BidirectionalConnection<T>
}

export type UnidirectionalEmittingConnection<T extends Capable = Capable> = {
  close: () => void
  remoteValueProxy: T
}

export const startUnidirectionalEmittingConnection = <T extends Capable>(
  { value, uuid, platformCapabilities, send, close }:
  {
    value: Capable
    uuid: Uuid
    platformCapabilities: PlatformCapabilities
    send: (message: Message) => void
    close: () => void
  }
) => {

  return {
    close: () => {
    },
    remoteValueProxy: new Proxy(
      new Function(),
      {
        apply: (target, thisArg, args) => {
        },
        get: (target, prop) => {
        }
      }
    ) as T
  }
}

export type UnidirectionalReceivingConnection = {
  close: () => void
}

export const startUnidirectionalReceivingConnection = (
  { uuid, remoteUuid, platformCapabilities, close }:
  {
    uuid: Uuid
    remoteUuid?: Uuid
    platformCapabilities: PlatformCapabilities
    eventTarget: StrictMessagePort<Message>
    close: () => void
  }
) => {

  return {
    close: () => {
    }
  }
}
