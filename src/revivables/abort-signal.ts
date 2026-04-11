import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { CapableChannel } from '../utils/message-channel'
import { box as boxMessagePort, revive as reviveMessagePort, type BoxedMessagePort } from './message-port'

export const type = 'abortSignal' as const

type AbortMessage = {
  type: 'abort'
  reason?: unknown
}

export const isType = (value: unknown): value is AbortSignal =>
  value instanceof AbortSignal

export const box = <T extends AbortSignal, T2 extends RevivableContext>(
  value: T,
  context: T2,
) => {
  // CapableChannel — internal plumbing. Revivables post raw JS values and
  // the message-port boundary handles boxing/reviving on the wire.
  const { port1: localPort, port2: remotePort } = new CapableChannel<AbortMessage, AbortMessage>()

  if (!value.aborted) {
    value.addEventListener('abort', () => {
      localPort.postMessage({ type: 'abort', reason: value.reason })
      localPort.close()
    }, { once: true })
  } else {
    localPort.close()
  }

  return {
    ...BoxBase,
    type,
    aborted: value.aborted,
    reason: value.reason,
    port: boxMessagePort(remotePort, context) as BoxedMessagePort,
  }
}

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2,
): AbortSignal => {
  const controller = new AbortController()

  if (value.aborted) {
    controller.abort(value.reason)
    return controller.signal
  }

  const port = reviveMessagePort(value.port, context)
  port.start()

  port.addEventListener('message', (event) => {
    const message = (event as MessageEvent<AbortMessage>).data
    if (message.type === 'abort') {
      controller.abort(message.reason)
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
