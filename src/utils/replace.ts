import type { StructuredCloneTransferableProxiable } from '../types'

export const replaceRecursive = <
  T extends StructuredCloneTransferableProxiable
>(
  value: T,
  replace: (value: StructuredCloneTransferableProxiable) => StructuredCloneTransferableProxiable,
  replaceLast: boolean = false
): StructuredCloneTransferableProxiable => {
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
          .map(([key, value]: [string, StructuredCloneTransferableProxiable]) => [
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
