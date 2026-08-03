type FindMatchingBox<T, M> =
  M extends { isType: (value: unknown) => value is infer S, box: (...args: any[]) => infer B }
    ? T extends S ? B : never
    : never

export type ReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T
    : FindMatchingBox<T, M>

export type DeepReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T extends Array<infer U> ? Array<DeepReplaceWithBox<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithBox<T[K], M> }
      : T
    : FindMatchingBox<T, M>

type FindMatchingRevive<T, M> =
  M extends { box: (...args: any[]) => infer S, revive: (...args: any[]) => infer R }
    ? T extends S ? R : never
    : never

export type DeepReplaceWithRevive<T, M> =
  [FindMatchingRevive<T, M>] extends [never]
    ? T extends Array<infer U> ? Array<DeepReplaceWithRevive<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithRevive<T[K], M> }
      : T
    : FindMatchingRevive<T, M>
