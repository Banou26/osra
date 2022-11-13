import type { ApiMessageData, Resolver, Resolvers, StructuredCloneTransferableType } from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { call, makeCallListener } from './call'

export const registerListener = <T extends StructuredCloneTransferableType, T2 extends Resolvers<T>>({
  target,
  resolvers,
  filter,
  map,
  key = MESSAGE_SOURCE_KEY
}: {
  target: WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker
  resolvers: T2
  filter?: (event: MessageEvent<any>) => boolean
  map?: (...args: Parameters<Resolver<T>>) => Parameters<Resolver<T>>
  key?: string
}) => {
  const listener = (event: MessageEvent<ApiMessageData<T, Resolvers<T>>>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data?.source !== key ) return
    if (filter && !filter(event)) return

    const { type, data, port } = event.data
    const resolver = resolvers[type]
    if (!resolver) throw new Error(`Osra received a message of type "${type}" but no resolver was found for type.`)
    if (map) resolver(...map(data, { event, type, port }))
    else resolver(data, { event, type, port })
  }
  target.addEventListener('message', listener as EventListener)

  return {
    listener,
    resolvers
  }
}


// const resolvers = {
//   init: makeCallListener(async ({ foo }: { foo: string }, extra) => {

//   })
// }

// type Resolvr = Parameters<typeof resolvers[keyof typeof resolvers]>[0]

// const res = registerListener<Resolvr, typeof resolvers>({
//   target: globalThis as unknown as Window,
//   resolvers
// })


// const target = call<Resolvr, typeof resolvers>(window)

// target('init', { foo: 'bar' })
