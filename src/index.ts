import type { RemoteTarget, StructuredCloneTransferableType, LocalTarget, OsraMessage, StructuredCloneTransferableProxiableType } from './types'
import type { Context, EnvCheck } from './utils'

import { v4 as uuidv4 } from 'uuid'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from './types'
import { getTransferableObjects, makeAllocator, makeNumberAllocator, replaceIncomingProxiedTypes, replaceOutgoingProxiedTypes } from './utils'

export * from './utils'

export const expose = async <T extends StructuredCloneTransferableProxiableType>(
  value: StructuredCloneTransferableProxiableType,
  {
    remote: _remote,
    local: _local,
    key = OSRA_MESSAGE_KEY,
    origin = '*'
  }: {
    remote: RemoteTarget | ((osraMessage: OsraMessage, transferables: Transferable[]) => void)
    local: LocalTarget | ((listener: (event: MessageEvent<OsraMessage>) => void) => void)
    key?: string,
    origin?: string
  }
): Promise<T> => {
  const uuid = uuidv4()

  let envCheck: EnvCheck | undefined
  const finalizationRegistry = new FinalizationRegistry<number>((value) => {
    const allocCallback = allocator.get(value)
    if (!allocCallback) throw new Error(`Osra received a port-closed message with an invalid portId "${value}".`)
    allocCallback()
    allocator.free(value)
  })
  const idAllocator = makeNumberAllocator()
  const allocator = makeAllocator<() => void>({ numberAllocator: idAllocator })
  const incomingSerializedPorts = new Map<string, MessagePort>()

  const addIncomingProxiedMessagePort = (portId: string) => {
    const { port1, port2 } = new MessageChannel()
    incomingSerializedPorts.set(portId, port1)
    return port2
  }

  const addOutgoingProxiedMessagePort = (port: MessagePort) => {
    const id = allocator.alloc(() => {
      port.close()
    })
    port.addEventListener('message', async (ev) => {
      remote(
        {
          [OSRA_MESSAGE_PROPERTY]: true,
          key,
          type: 'message',
          portId: `${uuid}/${id}`,
          data: replaceOutgoingProxiedTypes(ev.data, getContext())
        },
        []
      )
    })

    port.addEventListener('close', () => {
      idAllocator.free(id)
      remote(
        {
          [OSRA_MESSAGE_PROPERTY]: true,
          key,
          type: 'port-closed',
          portId: `${uuid}/${id}`
        },
        []
      )
    })
    return `${uuid}/${id}`
  }

  const getContext = (): Context => {
    if (!envCheck) throw new Error(`Osra context was accessed before the ready message was received.`)
    return {
      addIncomingProxiedMessagePort,
      addOutgoingProxiedMessagePort,
      envCheck,
      finalizationRegistry
    }
  }

  let resolveRemoteValues, rejectRemoteValues
  const remoteValues = new Promise<T>((res, rej) => {
    resolveRemoteValues = res
    rejectRemoteValues = rej
  })

  const sendReady = () => {
    const buffer = new ArrayBuffer(1)
    const { port1 } = new MessageChannel()
    remote(
      {
        [OSRA_MESSAGE_PROPERTY]: true,
        key,
        type: 'ready',
        envCheck: { buffer: buffer, port: port1 }
      },
      [buffer, port1]
    )
  }

  let receivedReady = false
  const listener = async (event: MessageEvent<OsraMessage>) => {
    if (!event.data || typeof event.data !== 'object' || !event.data[OSRA_MESSAGE_PROPERTY] || event.data.key !== key) return
    const { type } = event.data

    if (type === 'ready' && !receivedReady) {
      receivedReady = true
      envCheck = {
        uuid,
        supportsPorts: event.data.envCheck.port instanceof MessagePort,
        jsonOnly: event.data.envCheck.buffer instanceof ArrayBuffer
      }
      sendReady()

      const proxiedValue = replaceOutgoingProxiedTypes(value, getContext())
      const transferables = getTransferableObjects(proxiedValue)
      remote(
        {
          [OSRA_MESSAGE_PROPERTY]: true,
          key,
          type: 'init',
          data: proxiedValue
        },
        transferables
      )
      return
    }

    if (!receivedReady || !envCheck) throw new Error(`Osra received a message before the ready message.`)

    if (type === 'init') {
      resolveRemoteValues(
        replaceIncomingProxiedTypes(
          event.data.data,
          getContext()
        )
      )
      return
    }

    if (type === 'message') {
      const { portId, data } = event.data
      const port = incomingSerializedPorts.get(portId)
      if (!port) throw new Error(`Osra received a message with portId set to "${portId}" but no port was found.`)
      port.postMessage(data)
    } else if (type === 'port-closed') {
      const { portId } = event.data
      const [messageUuid, _portNumberId] = portId.split('/')
      const messagePortId = Number(_portNumberId)
      if (!messagePortId) throw new Error(`Osra received a port-closed message with an invalid portId "${portId}".`)
      if (messageUuid !== uuid && messageUuid !== envCheck.uuid) throw new Error(`Osra received a port-closed message with an invalid portId's uuid "${portId}".`)

      if (messageUuid === uuid) {
        const unregisterCallback = allocator.get(messagePortId)
        if (!unregisterCallback) throw new Error(`Osra received a port-closed message with an invalid portId "${portId}".`)
        unregisterCallback()
      } else if (messageUuid === envCheck.uuid) {
        const port = incomingSerializedPorts.get(portId)
        if (!port) throw new Error(`Osra received a message with portId set to "${portId}" but no port was found.`)
        port.close()
        incomingSerializedPorts.delete(portId)
      }
    }
  }

  const remote =
    typeof _remote === 'function' ? _remote
    : (
      (osraMessage: OsraMessage, transferables: Transferable[] = []) =>
        _remote.postMessage(osraMessage, { targetOrigin: origin, transfer: transferables })
    )

  if (typeof _local === 'function') {
    _local(listener)
  } else {
    _local.addEventListener('message', listener as unknown as EventListener)
  }

  sendReady()

  return remoteValues
}
