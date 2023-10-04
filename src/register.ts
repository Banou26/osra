import type { ApiMessageData, ApiResolverOptions, Resolvers, Target, ValidateResolvers } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { getTransferableObjects } from './utils'

export const registerListener = <T extends Record<PropertyKey, (data: any, extra: ApiResolverOptions) => unknown>>({
  target,
  resolvers,
  filter,
  map,
  key = MESSAGE_SOURCE_KEY,
  proxyTarget
}: {
  target: WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker
  resolvers: ValidateResolvers<T>
  filter?: (event: MessageEvent<any>) => boolean
  map?: (...args: Parameters<Resolvers[string]>) => Parameters<Resolvers[string]>
  key?: string,
  proxyTarget?: Target
}) => {
  const listener = (event: MessageEvent<ApiMessageData<Resolvers>>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data?.source !== key) return
    if (filter && !filter(event)) return

    if (proxyTarget) {
      const { type, data, port } = event.data
      const transferables = getTransferableObjects(data)
      proxyTarget.postMessage(
        {
          source: key,
          type,
          data,
          port
        },
        {
          targetOrigin: '*',
          transfer: [port, ...transferables as unknown as Transferable[] ?? []]
        }
      )
      return
    }

    const { type, data, port } = event.data
    const resolver = resolvers[type]
    if (!resolver) throw new Error(`Osra received a message of type "${String(type)}" but no resolver was found for type.`)
    if (map) resolver(...map(data as Parameters<ValidateResolvers<T>[PropertyKey]>[0], { event, type, port }))
    else resolver(data as Parameters<ValidateResolvers<T>[PropertyKey]>[0], { event, type, port })
  }
  target.addEventListener('message', listener as EventListener)

  return {
    listener,
    resolvers
  }
}
