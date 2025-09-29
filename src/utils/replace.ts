import type { Capable } from '../types'

export const replaceRecursive = <
  T extends Capable
>(
  value: T,
  replace: (value: Capable) => Capable,
  replaceLast: boolean = false
): Capable => {
  const replacedValue =
    replaceLast
      ? value
      : replace(value)

  const recursivelyReplacedValue =
    Array.isArray(replacedValue) ? replacedValue.map(value => replaceRecursive(value, replace, replaceLast))
    : replacedValue && typeof replacedValue === 'object' ? (
      Object.fromEntries(
        Object
          .entries(replacedValue)
          .map(([key, value]: [string, Capable]) => [
            key,
            replaceRecursive(value, replace, replaceLast)
          ])
      )
    )
    : replacedValue

  return (
    replaceLast
      ? replace(recursivelyReplacedValue)
      : recursivelyReplacedValue
  )
}
