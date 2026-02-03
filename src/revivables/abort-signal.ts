import type { StructurableTransferable } from '../types'
import type { StrictMessageChannel, StrictMessagePort } from '../utils/message-channel'
import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
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
  context: T2
) => {
  const { port1: localPort, port2: remotePort } = new MessageChannel() as StrictMessageChannel<StructurableTransferable, StructurableTransferable>
  context.messagePorts.add(remotePort as MessagePort)

  if (!value.aborted) {
    value.addEventListener('abort', () => {
      const message: AbortMessage = {
        type: 'abort',
        reason: value.reason
      }
      ;(localPort as MessagePort).postMessage(message)
      localPort.close()
    }, { once: true })
  } else {
    localPort.close()
  }

  const boxedPort = boxMessagePort(remotePort as MessagePort as StrictMessagePort<Record<string, StructurableTransferable>>, context)

  return {
    ...BoxBase,
    type,
    aborted: value.aborted,
    reason: value.reason,
    port: boxedPort as BoxedMessagePort
  }
}

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
): AbortSignal => {
  const controller = new AbortController()

  if (value.aborted) {
    controller.abort(value.reason)
    return controller.signal
  }

  const port = reviveMessagePort(value.port, context) as MessagePort
  context.messagePorts.add(port)
  port.start()

  port.addEventListener('message', ({ data }) => {
    const message = data as AbortMessage
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
