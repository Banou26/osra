import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'

export const type = 'error' as const

export type BoxedError =
  & BoxBaseType<typeof type>
  & {
    name: string
    message: string
    stack: string
    cause?: Capable
  }

export const isType = (value: unknown): value is Error =>
  value instanceof Error

export const box = <T extends Error, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedError => {
  const hasCause = 'cause' in value && value.cause !== undefined
  return {
    ...BoxBase,
    type,
    name: value.name,
    message: value.message,
    stack: value.stack || value.toString(),
    ...(hasCause ? { cause: recursiveBox(value.cause as Capable, context) as Capable } : {}),
  }
}

export const revive = <T extends BoxedError, T2 extends RevivableContext>(
  value: T,
  context: T2,
): Error => {
  const cause = value.cause !== undefined
    ? recursiveRevive(value.cause, context)
    : undefined
  const err = cause !== undefined
    ? new Error(value.message, { cause })
    : new Error(value.message)
  if (value.name) err.name = value.name
  if (value.stack) err.stack = value.stack
  return err
}

const typeCheck = () => {
  const boxed = box(new Error('test'), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Error = revived
  // @ts-expect-error - not an Error
  const notError: string = revived
  // @ts-expect-error - cannot box non-Error
  box('not an error', {} as RevivableContext)
}
