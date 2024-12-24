import type { OsraMessage, Resolvers, ResolverToValidatedResolver, Target, ResolversOrNever, Resolver} from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { call, makeCallListener } from './call'
import { makeAllocator, makeNumberAllocator, makeOsraMessageChannel, OSRA_PROXIED, OsraMessagePort, SerializedOsraMessagePort } from './utils'

export const registerListener = <T extends Resolvers>({
  target,
  messageListener,
  resolvers,
  filter,
  key = MESSAGE_SOURCE_KEY,
}: {
  target: Target
  messageListener: WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker
  resolvers: ResolversOrNever<T>
  filter?: (event: MessageEvent<any>) => boolean
  key?: string
}) => {
  const validatedResolvers =
    Object
      .fromEntries(
        Object
        .entries(resolvers)
        .map(([key, value]) => [key, makeCallListener(value)])
      ) as { [K in keyof T]: ResolverToValidatedResolver<T[K]> }
  type ValidatedResolvers = typeof validatedResolvers

  const uuid = crypto.randomUUID()
  const registry = new FinalizationRegistry<string>((value) => {
  })

  const idAllocator = makeNumberAllocator()
  const allocator = makeAllocator({ numberAllocator: idAllocator })

  const incomingSerializedPorts = new Map<string, OsraMessagePort>()

  const replaceIncomingMessagePortWithOsraMessagePort = (serializedPort: SerializedOsraMessagePort) => {
    const { port1, port2 } = makeOsraMessageChannel(uuid)
    incomingSerializedPorts.set(serializedPort[OSRA_PROXIED], port2)
    return port1
  }

  const replaceOutgoingMessagePortWithOsraMessagePort = (port: MessagePort) => {
    const osraMessagePort = makeOsraMessageChannel(uuid)
    port.postMessage(osraMessagePort.port1, [osraMessagePort.port2])
    return osraMessagePort.port1
  }
  

  const listener = (event: MessageEvent<OsraMessage>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data?.source !== key) return
    if (filter && !filter(event)) return

    const { __type__ } = event.data
    if (__type__ === 'message') {
      const { type, data, port, source, channelId } = event.data
      if (channelId) {

      } else {
        const resolver = validatedResolvers[type]
        if (!resolver) throw new Error(`Osra received a message of type "${String(type)}" but no resolver was found for type.`)
        else resolver({ __type__, type, event, port, source })(...data)
      }
    }
  }
  messageListener.addEventListener('message', listener as EventListener)

  return {
    call: call<ValidatedResolvers>(target, { key }),
    listener,
    unregister: () => messageListener.removeEventListener('message', listener as EventListener),
    resolvers: validatedResolvers
  }
}
