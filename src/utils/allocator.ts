import type { Message, Uuid } from '../types'
import type { StrictMessagePort } from './message-channel'

export const makeAllocator = <T>() => {
  const channels = new Map<string, T>()

  const alloc = (value: T): string => {
    let uuid = globalThis.crypto.randomUUID()
    while (channels.has(uuid)) {
      uuid = globalThis.crypto.randomUUID()
    }
    channels.set(uuid, value)
    return uuid
  }

  const has = (uuid: string) => channels.has(uuid)
  const get = (uuid: string) => channels.get(uuid)

  const free = (uuid: string) => {
    channels.delete(uuid)
  }

  const set = (uuid: string, value: T) => {
    channels.set(uuid, value)
  }

  return {
    alloc,
    has,
    get,
    free,
    set
  }
}

export type Allocator<T> = ReturnType<typeof makeAllocator<T>>

type AllocatedMessageChannel = {
  uuid: Uuid
  /** Local port */
  port1: StrictMessagePort<Message>
  /** Remote port that gets transferred, might be undefined if a remote context created the channel */
  port2?: StrictMessagePort<Message>
}

export const makeMessageChannelAllocator = () => {
  const channels = new Map<string, AllocatedMessageChannel>()

  const result = {
    getUniqueUuid: () => {
      let uuid: Uuid = globalThis.crypto.randomUUID()
      while (channels.has(uuid)) {
        uuid = globalThis.crypto.randomUUID()
      }
      return uuid
    },
    set: (uuid: Uuid, messagePorts: { port1: MessagePort, port2?: MessagePort }) => {
      channels.set(uuid, { uuid, ...messagePorts })
    },
    alloc: (uuid: Uuid | undefined = result.getUniqueUuid(), messagePorts?: { port1: MessagePort, port2?: MessagePort }) => {
      if (messagePorts) {
        channels.set(uuid, { uuid, ...messagePorts })
        return { uuid, ...messagePorts }
      }
      const messageChannel = new MessageChannel()
      const allocatedMessageChannel = {
        uuid,
        port1: messageChannel.port1,
        port2: messageChannel.port2
      } satisfies AllocatedMessageChannel
      channels.set(uuid, allocatedMessageChannel)
      return allocatedMessageChannel
    },
    has: (uuid: string) => channels.has(uuid),
    get: (uuid: string) => channels.get(uuid),
    free: (uuid: string) => channels.delete(uuid),
    getOrAlloc: (uuid: Uuid | undefined = result.getUniqueUuid(), messagePorts?: { port1: MessagePort, port2?: MessagePort }) => {
      const existingChannel = result.get(uuid)
      if (existingChannel) return existingChannel!
      return result.alloc(uuid, messagePorts)
    }
  }
  return result
}

export type MessageChannelAllocator = ReturnType<typeof makeMessageChannelAllocator>
