import type { WebSocketServer } from 'ws'

import type { ApiMessageData, ApiResolverOptions, WebsocketResolvers, StructuredCloneValidateResolvers } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'

export const registerWebsocketListener = <T extends Record<PropertyKey, (data: any, extra: ApiResolverOptions) => unknown>>({
  target,
  resolvers,
  filter,
  map,
  key = MESSAGE_SOURCE_KEY
}: {
  target: WebSocketServer
  resolvers: StructuredCloneValidateResolvers<T>
  filter?: (event: MessageEvent<any>) => boolean
  map?: (...args: Parameters<WebsocketResolvers[string]>) => Parameters<WebsocketResolvers[string]>
  key?: string
}) => {
  target.on('connection', async (ws) => {
    const channelRefs = new Map<string, WebSocket>()

    console.log('ws connected')
    ws.on('error', console.error)
  
    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message)
        if (!data || typeof data !== 'object') return
        if (data?.source !== key ) return
        if (filter && !filter(data)) return
        
        const { type, data, port } = event.data
        const resolver = resolvers[type]
        if (!resolver) throw new Error(`Osra received a message of type "${String(type)}" but no resolver was found for type.`)
        if (map) resolver(...map(data as Parameters<ValidateResolvers<T>[PropertyKey]>[0], { event, type, port }))
        else resolver(data as Parameters<ValidateResolvers<T>[PropertyKey]>[0], { event, type, port })

        console.log('received: %s', data)
      } catch (err) {
        console.warn(`Osra received a websocket message that isn't valid JSON.`)
      }
    })
  
    ws.send('something')
  
    ws.on('close', () => {
      console.log('ws disconnected')
    })
  })
  

  return {
    listener,
    resolvers
  }
}

