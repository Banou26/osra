// Match a module from a union of modules M by the shape its `isType` guard
// accepts. Returns the matching module's box return type, or never.
type FindMatchingBox<T, M> =
  M extends { isType: (value: unknown) => value is infer S, box: (...args: any[]) => infer B }
    ? T extends S ? B : never
    : never

// If T matches a module's isType, return the module's box return type.
// Otherwise, return T unchanged.
export type ReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T
    : FindMatchingBox<T, M>

// Recursive variant of ReplaceWithBox — descends into arrays and objects.
export type DeepReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T extends Array<infer U> ? Array<DeepReplaceWithBox<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithBox<T[K], M> }
      : T
    : FindMatchingBox<T, M>

// Given a box shape, find the matching module and return its revive return
// type. Returns never if no module's box type matches T.
type FindMatchingRevive<T, M> =
  M extends { box: (...args: any[]) => infer S, revive: (...args: any[]) => infer R }
    ? T extends S ? R : never
    : never

// If T matches a module's box output, return the module's revive return type.
// Otherwise, return T unchanged.
export type ReplaceWithRevive<T, M> =
  [FindMatchingRevive<T, M>] extends [never]
    ? T
    : FindMatchingRevive<T, M>

// Recursive variant of ReplaceWithRevive.
export type DeepReplaceWithRevive<T, M> =
  [FindMatchingRevive<T, M>] extends [never]
    ? T extends Array<infer U> ? Array<DeepReplaceWithRevive<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithRevive<T[K], M> }
      : T
    : FindMatchingRevive<T, M>
