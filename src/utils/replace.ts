export type DeepReplace<T, From, To> =
    T extends From ? DeepReplace<To, From, To>
  : T extends Array<infer U> ? Array<DeepReplace<U, From, To>>
  : T extends object ? { [K in keyof T]: DeepReplace<T[K], From, To> }
  : T

let i = 0

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
  i++
  if (i > 100) throw new Error('bruh')
  console.log('deepReplace', typeof value, value)
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
