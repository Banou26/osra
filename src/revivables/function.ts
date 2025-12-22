import type { Capable, Uuid } from '../types'
import type { RevivableContext } from './utils'

import { BoxBase, recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'

export const type = 'function' as const

export type CallContext = [
  /** MessagePort or portId that will be used to send the result of the function call */
  MessagePort | string,
  /** Arguments that will be passed to the function call */
  Capable[]
]

export const isType = <T extends Function>(value: unknown): value is T =>
  typeof value === 'function'

export const box = <T extends Function, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  if (isJsonOnlyTransport(context.transport)) {
    // JSON transport: use messageChannels/eventTarget pattern
    const { uuid: portId, port1: localPort } = context.messageChannels.alloc()

    context.eventTarget.addEventListener('message', function listener({ detail: message }) {
      if (message.type !== 'message' || message.portId !== portId) return
      const [returnValuePortId, args] = recursiveRevive(message.data, context) as [string, Capable[]]
      const result = (async () => value(...args))()
      context.sendMessage({
        type: 'message',
        remoteUuid: context.remoteUuid,
        data: recursiveBox(result, context) as Capable,
        portId: returnValuePortId as Uuid
      })
    })

    return {
      ...BoxBase,
      type,
      portId
    }
  }

  // Capable transport: use MessagePort directly
  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  localPort.addEventListener('message', ({ data }: MessageEvent<CallContext>) => {
    const [returnValuePort, args] = recursiveRevive(data, context) as [MessagePort, Capable[]]
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  return {
    ...BoxBase,
    type,
    port: remotePort
  }
}

export const revive = <T extends Function, T2 extends RevivableContext>(
  value: ReturnType<typeof box>,
  context: T2
): T => {
  if ('portId' in value) {
    // JSON transport: use messageChannels/eventTarget pattern
    const func = (...args: Capable[]) =>
      new Promise((resolve, reject) => {
        const { uuid: returnValuePortId, port1: returnValueLocalPort } = context.messageChannels.alloc()
        const callContext = recursiveBox([returnValuePortId, args] as const, context) as Capable
        context.sendMessage({
          type: 'message',
          remoteUuid: context.remoteUuid,
          data: callContext,
          portId: value.portId as Uuid
        })

        returnValueLocalPort.addEventListener('message', function listener({ data: message }) {
          if (message.type !== 'message' || message.portId !== returnValuePortId) return
          returnValueLocalPort.removeEventListener('message', listener)
          const result = recursiveRevive(message.data, context) as Promise<Capable>
          result
            .then(resolve)
            .catch(reject)
            .finally(() => context.messageChannels.free(returnValuePortId))
        })
        returnValueLocalPort.start()
      })

    return func as unknown as T
  }

  // Capable transport: use MessagePort directly
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      value.port.postMessage(callContext, getTransferableObjects(callContext))

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => returnValueLocalPort.close())
      })
      returnValueLocalPort.start()
    })

  return func as unknown as T
}
