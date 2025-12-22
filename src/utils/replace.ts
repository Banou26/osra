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
export type ReplaceWithModule<T, M> =
  [FindMatchingBox<T, M>] extends [never]
    ? T
    : FindMatchingBox<T, M>

// Deep replace using module matching - each type maps to its specific box type
export type DeepReplaceWithModule<T, M> =
  [FindMatchingBox<T, M>] extends [never] ? (
      T extends Array<infer U> ? Array<DeepReplaceWithModule<U, M>>
    : T extends object ? { [K in keyof T]: DeepReplaceWithModule<T[K], M> }
    : T
  )
  : FindMatchingBox<T, M>

export type DeepReplace<T, From, To> =
    T extends From ? DeepReplace<To, From, To>
  : T extends Array<infer U> ? Array<DeepReplace<U, From, To>>
  : T extends object ? { [K in keyof T]: DeepReplace<T[K], From, To> }
  : T

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
  console.log('deepReplace', options?.parent, value)
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
