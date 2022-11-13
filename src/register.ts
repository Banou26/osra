import type { ApiMessageData, ApiResolverOptions, Resolvers, ValidateResolvers } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
// import { call, makeCallListener } from './call'

export const registerListener = <T extends Record<PropertyKey, (data: never, extra: ApiResolverOptions) => unknown>>({
  target,
  resolvers,
  filter,
  map,
  key = MESSAGE_SOURCE_KEY
}: {
  target: WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker
  resolvers: ValidateResolvers<T>
  filter?: (event: MessageEvent<any>) => boolean
  map?: (...args: Parameters<Resolvers[string]>) => Parameters<Resolvers[string]>
  key?: string
}) => {
  const listener = (event: MessageEvent<ApiMessageData<Resolvers>>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data?.source !== key ) return
    if (filter && !filter(event)) return

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

// const res = registerListener({
//   target: globalThis as unknown as Window,
//   resolvers: {
//     bruh: async (data: { foo: string }) => {

//     },
//     init: async ({ foo }: { foo: number }) => {
  
//     },
//     init2: async ({ bar }: { bar: number }) => {
//     }
//   }
// })

// res.resolvers.init({ foo: 'bruh' })

// // // res.resolvers.init({ foo: 1 }, { event: null, type: 'init', port: null })


// const target = call<typeof res['resolvers']>(window)

// target('init', { foo: 'bar' })
