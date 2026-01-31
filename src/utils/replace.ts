export type Replace<T, From, To> =
    T extends From ? To
  : T

// Find the matching box type for T from a union of modules M
// Returns never if no module matches
type FindMatchingBox<T, M> =
  M extends { isType: (value: unknown) => value is infer S, box: (...args: any[]) => infer B }
    ? T extends S ? B : never
    : never

// Replace T with the corresponding box type from module(s) M
// If T matches a module's type, returns that module's box type
// Otherwise returns T unchanged
export type ReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T
    : FindMatchingBox<T, M>

// Deep replace using module matching - each type maps to its specific box type
export type DeepReplaceWithBox<T, M> =
  [FindMatchingBox<T, M>] extends [never] ? (
      T extends Array<infer U> ? Array<DeepReplaceWithBox<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithBox<T[K], M> }
    : T
  )
  : FindMatchingBox<T, M>
  
// Find the matching revive type for T from a union of modules M
// T should be a box type (return type of box), returns the revive return type
// Returns never if no module matches
type FindMatchingRevive<T, M> =
  M extends { box: (...args: any[]) => infer S, revive: (...args: any[]) => infer R }
    ? T extends S ? R : never
    : never

// Replace T with the corresponding box type from module(s) M
// If T matches a module's type, returns that module's box type
// Otherwise returns T unchanged
export type ReplaceWithRevive<T, M> =
  [FindMatchingRevive<T, M>] extends [never]
    ? T
    : FindMatchingRevive<T, M>

// Deep replace using module matching - each type maps to its specific box type
export type DeepReplaceWithRevive<T, M> =
  [FindMatchingRevive<T, M>] extends [never] ? (
      T extends Array<infer U> ? Array<DeepReplaceWithRevive<U, M>>
      : T extends object ? { [K in keyof T]: DeepReplaceWithRevive<T[K], M> }
    : T
  )
  : FindMatchingRevive<T, M>

export type DeepReplace<T, From, To> =
    T extends From ? DeepReplace<To, From, To>
  : T extends (...args: infer A) => infer R ? (...args: A) => DeepReplace<R, From, To>
  : T extends Array<infer U> ? Array<DeepReplace<U, From, To>>
  : T extends object ? { [K in keyof T]: DeepReplace<T[K], From, To> }
  : T

export type DeepReplaceAsync<T, From, To> =
    T extends From ? DeepReplaceAsync<To, From, To>
  : T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<DeepReplaceAsync<R, From, To>>>
  : T extends Array<infer U> ? Array<DeepReplaceAsync<U, From, To>>
  : T extends object ? { [K in keyof T]: DeepReplaceAsync<T[K], From, To> }
  : T

export type AsCapable<T> = DeepReplaceAsync<T, never, never>

export const deepReplace = <T, From, To>(
  value: T,
  predicate: (value: unknown, parent?: unknown) => value is From,
  replacer: (value: From, parent?: unknown) => To,
  options: {
    /** 'pre' = top-down (default), 'post' = bottom-up */
    order?: 'pre' | 'post'
    parent?: unknown
  } = {}
): DeepReplace<T, From, To> => {
  const { order = 'pre' } = options
  const replacedValue =
    order === 'pre' && predicate(value, options?.parent)
      ? replacer(value, options?.parent)
      : value

  const recursivelyReplacedValue =
    Array.isArray(replacedValue) ? replacedValue.map(value => deepReplace(value, predicate, replacer, { ...options, parent: replacedValue }))
    : replacedValue && typeof replacedValue === 'object' ? (
      Object.fromEntries(
        Object
          .entries(replacedValue)
          .map(([key, value]: [string, unknown]) => [
            key,
            deepReplace(value, predicate, replacer, { ...options, parent: replacedValue })
          ])
      )
    )
    : replacedValue

  return (
    order === 'post' && predicate(recursivelyReplacedValue, options?.parent)
      ? replacer(recursivelyReplacedValue, options?.parent)
      : recursivelyReplacedValue
  ) as DeepReplace<T, From, To>
}
