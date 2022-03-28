export type Target = Window | ServiceWorker | Worker

export type Resolver = (data: unknown, extra?: ApiResolverOptions) => any

export type Resolvers = {
  [key: string]: Resolver
}

export type ApiResolverOptions<T extends Resolvers = Resolvers, T2 = {}> = T2 & {
  event: MessageEvent<any>
  type: keyof T
  port: MessagePort
}

export type ApiMessageData<T extends Resolvers = Resolvers> = {
  type: keyof T
  data: any
  port: MessagePort
  source: string
}
