import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { HandleId } from '../utils/remote-handle'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'abortSignal' as const

type AbortMessage = {
  type: 'abort'
  reason?: Capable
}

export type BoxedAbortSignal =
  & BoxBaseType<typeof type>
  & {
    aborted: boolean
    reason?: Capable
    handleId?: HandleId
  }

export const isType = (value: unknown): value is AbortSignal =>
  value instanceof AbortSignal

export const box = <T extends AbortSignal, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedAbortSignal => {
  if (value.aborted) {
    // Eagerly-aborted reason rides the wrapper. recursiveBox lets reasons
    // carrying live values (Function/Promise/EventTarget/…) survive — the
    // outer recursiveBox sees OSRA_BOX on this object and short-circuits.
    return {
      ...BoxBase,
      type,
      aborted: true,
      reason: recursiveBox(value.reason as Capable, context) as Capable,
    }
  }
  const handle = createHandle(context, {})
  value.addEventListener('abort', () => {
    try {
      handle.send(recursiveBox(
        { type: 'abort', reason: value.reason as Capable } satisfies AbortMessage as Capable,
        context,
      ))
    } catch { /* reason not serialisable / connection torn down — peer never sees abort, but local cleanup still proceeds */ }
    handle.release()
  }, { once: true })

  return {
    ...BoxBase,
    type,
    aborted: false,
    handleId: handle.id,
  }
}

export const revive = <T extends BoxedAbortSignal, T2 extends RevivableContext>(
  value: T,
  context: T2,
): AbortSignal => {
  const controller = new AbortController()

  if (value.aborted) {
    controller.abort(recursiveRevive(value.reason as Capable, context))
    return controller.signal
  }

  if (value.handleId === undefined) return controller.signal

  // Closure pins `controller`. The handle's entry sits in the connection
  // table — the controller stays addressable even if user code drops the
  // signal handle (signals retain their AbortController via spec anyway).
  const handle = adoptHandle(context, value.handleId, {
    onMessage: (payload) => {
      const message = recursiveRevive(payload, context) as AbortMessage
      controller.abort(message.reason)
      handle.release()
    },
  })

  return controller.signal
}

const typeCheck = () => {
  const boxed = box(new AbortController().signal, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: AbortSignal = revived
  // @ts-expect-error - not an AbortSignal
  const notAbortSignal: string = revived
  // @ts-expect-error - cannot box non-AbortSignal
  box('not an abort signal', {} as RevivableContext)
}
