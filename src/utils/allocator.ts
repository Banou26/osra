import type { StructurableTransferable, Uuid } from '../types'
import type { StrictMessageChannel, StrictMessagePort } from './message-channel'

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

type AllocatedMessageChannel<
  T extends StructurableTransferable = StructurableTransferable,
  T2 extends StructurableTransferable = StructurableTransferable
> = {
  uuid: Uuid
  /** Local port */
  port1: StrictMessagePort<T>
  /** Remote port that gets transferred, might be undefined if a remote context created the channel */
  port2?: StrictMessagePort<T2>
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
    set: (uuid: Uuid, messagePorts: { port1: StrictMessagePort, port2?: StrictMessagePort }) => {
      channels.set(uuid, { uuid, ...messagePorts })
    },
    alloc: (
      uuid: Uuid | undefined = result.getUniqueUuid(),
      messagePorts?: { port1: StrictMessagePort, port2?: StrictMessagePort }
    ) => {
      if (messagePorts) {
        const allocatedMessageChannel = { uuid, ...messagePorts } satisfies AllocatedMessageChannel
        channels.set(uuid, allocatedMessageChannel)
        return allocatedMessageChannel
      }
      const messageChannel = new MessageChannel() as StrictMessageChannel
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
    getOrAlloc: (
      uuid: Uuid | undefined = result.getUniqueUuid(),
      messagePorts?: { port1: StrictMessagePort, port2?: StrictMessagePort }
    ) => {
      const existingChannel = result.get(uuid)
      if (existingChannel) return existingChannel!
      return result.alloc(uuid, messagePorts)
    }
  }
  return result
}

export type MessageChannelAllocator = ReturnType<typeof makeMessageChannelAllocator>
