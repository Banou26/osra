import type { ApiMessageData, Resolver, Resolvers } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'

export const registerListener = <T extends Resolvers>({
  target,
  resolvers,
  filter,
  key = MESSAGE_SOURCE_KEY
}: {
  target: WindowEventHandlers
  resolvers: T
  filter?: (event: MessageEvent<any>) => boolean
  map?: (...args: Parameters<Resolver>) => Parameters<Resolver>
  key?: string
}) => {
  const listener = async (event: MessageEvent<ApiMessageData>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (!event.source || event.data?.source !== key ) return
    if (filter && !filter(event)) return

    const { type, data, port } = event.data
    const resolver = resolvers[type]
    if (!resolver) throw new Error(`Osra received a message of type "${type}" but no resolver was found for type.`)
    resolver(data, { event, type, port })
  }
  target.addEventListener('message', listener)

  return {
    listener,
    resolvers
  }
}
