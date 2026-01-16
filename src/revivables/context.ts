import type { MessageContext } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'

export const type = 'context' as const

/**
 * Internal symbol used to identify OSRA_CONTEXT objects at runtime.
 */
const OSRA_CONTEXT_MARKER = Symbol.for('OSRA_CONTEXT')

/**
 * A special token that gets transformed into the MessageContext when revived on the receiving side.
 * Pass this value in your exposed API to receive information about the message context.
 *
 * Typed as MessageContext so it can be passed directly where MessageContext is expected.
 */
export const OSRA_CONTEXT: MessageContext = { [OSRA_CONTEXT_MARKER]: true } as MessageContext

export const isType = (value: unknown): value is MessageContext =>
  value !== null &&
  typeof value === 'object' &&
  OSRA_CONTEXT_MARKER in value

export const box = <T extends MessageContext, T2 extends RevivableContext>(
  _value: T,
  _context: T2
) => ({
  ...BoxBase,
  type
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  _value: T,
  context: T2
): MessageContext => {
  return context.messageContext ?? {}
}

const typeCheck = () => {
  const boxed = box(OSRA_CONTEXT, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: MessageContext = revived
  // @ts-expect-error - not a MessageContext
  const notContext: string = revived
}
