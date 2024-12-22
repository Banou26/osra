import type { ApiMessageData, Resolvers, ResolverToValidatedResolver, Target, ResolversOrNever} from './types'

import { MESSAGE_SOURCE_KEY } from './shared'
import { call, makeCallListener } from './call'

// type PolyfilledMessageChannel = {
//   id: string

// }

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
      ) as {  [K in keyof T]: ResolverToValidatedResolver<T[K]> }
  type ValidatedResolvers = typeof validatedResolvers

  // const channels = new Map<string, PolyfilledMessageChannel>()
  // const registry = new FinalizationRegistry((value) => {
  // })

  const listener = (event: MessageEvent<ApiMessageData<Resolvers>>) => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data?.source !== key) return
    if (filter && !filter(event)) return

    const { type, data, port } = event.data
    const resolver = validatedResolvers[type]
    if (!resolver) throw new Error(`Osra received a message of type "${String(type)}" but no resolver was found for type.`)
    else resolver({ event, type, port })(...data)
  }
  messageListener.addEventListener('message', listener as EventListener)

  return {
    call: call<ValidatedResolvers>(target, { key }),
    listener,
    unregister: () => messageListener.removeEventListener('message', listener as EventListener),
    resolvers: validatedResolvers
  }
}
