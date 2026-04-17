import type { Capable } from '../types'
import type { RevivableContext } from './utils'
import type { UnderlyingType } from '../utils/type'
import type { TypedMessagePort } from '../utils/typed-message-channel'

import { BoxBase } from './utils'
import { EventChannel } from '../utils/event-channel'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { recursiveBox, recursiveRevive } from '.'
import {
  box as boxMessagePort,
  revive as reviveMessagePort
} from './message-port'

export const type = 'abortSignal' as const

type AbortMessage = {
  type: 'abort'
  reason?: Capable
}

export const isType = (value: unknown): value is AbortSignal =>
  value instanceof AbortSignal

export const box = <T extends AbortSignal, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  // Clone-capable transports get a real MessageChannel so the remote port is
  // transferred directly (message-port fast path). JSON-only transports fall
  // back to EventChannel, which routes through the portId handler.
  const isJson = isJsonOnlyTransport(context.transport)
  const { port1: localPort, port2: remotePort } = isJson
    ? new EventChannel<AbortMessage, AbortMessage>()
    : new MessageChannel() as unknown as { port1: TypedMessagePort<AbortMessage>, port2: TypedMessagePort<AbortMessage> }

  if (!value.aborted) {
    value.addEventListener('abort', () => {
      const message: AbortMessage = { type: 'abort', reason: value.reason as Capable }
      if (isJson) {
        localPort.postMessage(message)
      } else {
        const boxed = recursiveBox(message, context) as AbortMessage
        localPort.postMessage(boxed, getTransferableObjects(boxed))
      }
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
    port: boxMessagePort(remotePort, context),
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

  const port = reviveMessagePort(value.port, context)
  const isJson = isJsonOnlyTransport(context.transport)
  port.start()

  port.addEventListener('message', ({ data }) => {
    const message = isJson ? data : recursiveRevive(data, context) as AbortMessage
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
