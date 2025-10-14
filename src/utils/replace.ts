export type DeepReplace<T, From, To> =
    T extends From ? DeepReplace<To, From, To>
  : T extends Array<infer U> ? Array<DeepReplace<U, From, To>>
  : T extends object ? { [K in keyof T]: DeepReplace<T[K], From, To> }
  : T

export const deepReplace = <T, From, To>(
  value: T,
  predicate: (value: unknown) => value is From,
  replacer: (value: From) => To,
  options: {
    /** 'pre' = top-down (default), 'post' = bottom-up */
    order?: 'pre' | 'post'
  } = {}
): DeepReplace<T, From, To> => {
  const { order = 'pre' } = options
  const replacedValue =
    order === 'pre' && predicate(value)
      ? replacer(value)
      : value

  const recursivelyReplacedValue =
    Array.isArray(replacedValue) ? replacedValue.map(value => deepReplace(value, predicate, replacer))
    : replacedValue && typeof replacedValue === 'object' ? (
      Object.fromEntries(
        Object
          .entries(replacedValue)
          .map(([key, value]: [string, unknown]) => [
            key,
            deepReplace(value, predicate, replacer)
          ])
      )
    )
    : replacedValue

  return (
    order === 'post' && predicate(recursivelyReplacedValue)
      ? replacer(recursivelyReplacedValue)
      : recursivelyReplacedValue
  ) as DeepReplace<T, From, To>
}
