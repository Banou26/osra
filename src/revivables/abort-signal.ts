import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { BoxedMessagePort } from './message-port'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
} from './message-port'

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
    port: BoxedMessagePort<AbortMessage>
  }

export const isType = (value: unknown): value is AbortSignal =>
  value instanceof AbortSignal

export const box = <T extends AbortSignal, T2 extends RevivableContext>(
  value: T,
  context: T2,
): BoxedAbortSignal => {
  const { localPort, boxedRemote } = createRevivableChannel<AbortMessage>(context)

  if (!value.aborted) {
    value.addEventListener('abort', () => {
      localPort.postMessage({ type: 'abort', reason: value.reason as Capable })
      localPort.close()
    }, { once: true })
  } else {
    localPort.close()
  }

  // Eagerly-aborted reason rides the wrapper instead of the channel, so it
  // has to go through recursiveBox here — the outer recursiveBox will see
  // OSRA_BOX on this object and short-circuit before descending into `reason`.
  // Without this, a reason carrying live values (Function/Promise/EventTarget/…)
  // throws DataCloneError on clone transports and silently loses fields on
  // JSON transports.
  return {
    ...BoxBase,
    type,
    aborted: value.aborted,
    reason: value.aborted ? recursiveBox(value.reason as Capable, context) as Capable : undefined,
    port: boxedRemote,
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

  const port = reviveMessagePort(value.port, context)
  port.start()

  port.addEventListener('message', ({ data: message }) => {
    if (message.type === 'abort') {
      controller.abort(recursiveRevive(message.reason as Capable, context))
      port.close()
    }
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
