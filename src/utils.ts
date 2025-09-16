import type { StructuredCloneTransferableProxiableType } from './types'

export const replaceRecursive = <
  T extends StructuredCloneTransferableProxiableType,
  T2 extends (value: any) => any
>(
  value: T,
  shouldReplace: (value: Parameters<T2>[0]) => boolean,
  replaceFunction: T2
) =>
  shouldReplace(value) ? replaceFunction(value)
  : Array.isArray(value) ? value.map(value => replaceRecursive(value, shouldReplace, replaceFunction))
  : value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          replaceRecursive(value, shouldReplace, replaceFunction)
        ])
    )
  )
  : value
