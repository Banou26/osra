import type { Messageable } from '../types'

export const replaceRecursive = <
  T extends Messageable
>(
  value: T,
  replace: (value: Messageable) => Messageable,
  replaceLast: boolean = false
): Messageable => {
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
          .map(([key, value]: [string, Messageable]) => [
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
