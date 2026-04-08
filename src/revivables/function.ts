import type { Capable, Uuid } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'

import { BoxBase } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { getTransferableObjects } from '../utils'
import { box as boxMessagePort, revive as reviveMessagePort, BoxedMessagePort } from './message-port'

export const type = 'function' as const

/**
 * FinalizationRegistry for automatically cleaning up function ports when the
 * revived function is garbage collected. Also sends a `function-drop` message
 * to the remote side so it can evict its outgoing identity entry — that way
 * a subsequent re-box of the same source function allocates a fresh id rather
 * than producing a dangling ref-only box.
 */
type FunctionCleanupInfo = {
  port: MessagePort | null
  id: Uuid
  sendMessage: RevivableContext['sendMessage']
  remoteUuid: Uuid
  revivedFunctionsById: RevivableContext['revivedFunctionsById']
}

const functionRegistry = new FinalizationRegistry<FunctionCleanupInfo>((info) => {
  // Evict the local cache entry for this id. We do this regardless of whether
  // the ref is still in there — another revive might have replaced it already.
  info.revivedFunctionsById.delete(info.id)

  // Tell the box side to evict its outgoing identity entry.
  try {
    info.sendMessage({ type: 'function-drop', remoteUuid: info.remoteUuid, id: info.id })
  } catch { /* Connection may already be torn down */ }

  if (info.port) {
    // Send a close signal through the port before closing it
    try {
      info.port.postMessage({ __osra_close__: true })
    } catch { /* Port may already be closed */ }
    try {
      info.port.close()
    } catch { /* Port may already be closed */ }
  }
})

export type CallContext = [
  /** MessagePort or portId that will be used to send the result of the function call */
  MessagePort | string,
  /** Arguments that will be passed to the function call */
  Capable[]
]

/**
 * A boxed function is either a full payload (first time this identity crosses
 * the wire in this direction) or a ref-only box (subsequent crossings). The
 * revive side resolves ref-only boxes via the per-connection
 * `revivedFunctionsById` cache.
 */
export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { id: Uuid }
  & ({ port: BoxedMessagePort } | { port?: undefined })
  & { [UnderlyingType]: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> }

type CapableFunction<T> = T extends (...args: infer P) => infer R
  ? P extends Capable[]
    ? R extends Capable ? T : never
    : never
  : never

export const isType = (value: unknown): value is (...args: any[]) => any =>
  typeof value === 'function'

export const box = <T extends (...args: any[]) => any, T2 extends RevivableContext>(
  value: T & CapableFunction<T>,
  context: T2
): BoxedFunction<T> => {
  // Identity short-circuit: if this function has already been boxed on this
  // connection, emit a ref-only box that the revive side resolves through its
  // `revivedFunctionsById` cache.
  const existingId = context.outgoingFunctionIds.get(value)
  if (existingId !== undefined) {
    return {
      ...BoxBase,
      type,
      id: existingId,
    } as BoxedFunction<T>
  }

  const id = globalThis.crypto.randomUUID()

  const { port1: localPort, port2: remotePort } = new MessageChannel()
  context.messagePorts.add(remotePort)

  const cleanup = () => {
    context.messagePorts.delete(remotePort)
    localPort.close()
  }

  localPort.addEventListener('message', ({ data }: MessageEvent<CallContext | { __osra_close__: true }>) => {
    // Check for close signal
    if (data && typeof data === 'object' && '__osra_close__' in data) {
      cleanup()
      return
    }
    const [returnValuePort, args] = recursiveRevive(data as CallContext, context) as [MessagePort, Capable[]]
    const result = (async () => value(...args))()
    const boxedResult = recursiveBox(result, context)
    returnValuePort.postMessage(boxedResult, getTransferableObjects(boxedResult))
  })
  localPort.start()

  // Record the identity AFTER the wire setup is complete so that a concurrent
  // box of the same function doesn't race ahead of us and see a stale id.
  context.outgoingFunctionIds.set(value, id)
  context.outgoingFunctionsById.set(id, new WeakRef(value))

  return {
    ...BoxBase,
    type,
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    port: boxMessagePort(remotePort as any, context),
  } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2
): T[UnderlyingType] => {
  // Identity short-circuit: if we've already revived this id on this
  // connection, return the cached proxy instead of creating a new one. This
  // makes `removeEventListener(fn)` work when `fn` is a boxed function whose
  // same reference was earlier passed to `addEventListener(fn)`.
  const existing = context.revivedFunctionsById.get(value.id)?.deref() as T[UnderlyingType] | undefined
  if (existing) return existing

  // Ref-only box: the box side is claiming "you already have a revived proxy
  // for this id". If we don't, that's a protocol drift — fall through and let
  // the port access below throw so the bug surfaces loudly rather than
  // silently returning a no-op function.
  if (!('port' in value) || value.port === undefined) {
    throw new Error(
      `osra function revive: ref-only box for id ${value.id} but no cached proxy on this side. ` +
      `The box side sent a ref-only box for an identity it no longer owns (possible race between a ` +
      `function-drop GC notification and a concurrent re-box).`,
    )
  }

  const port = reviveMessagePort(value.port as unknown as BoxedMessagePort, context)

  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const { port1: returnValueLocalPort, port2: returnValueRemotePort } = new MessageChannel()
      context.messagePorts.add(returnValueRemotePort)
      const callContext = recursiveBox([returnValueRemotePort, args] as const, context)
      ;(port as MessagePort).postMessage(callContext, getTransferableObjects(callContext))
      // Remove the remote port from the set after transfer (it's neutered now)
      context.messagePorts.delete(returnValueRemotePort)

      returnValueLocalPort.addEventListener('message', ({ data }: MessageEvent<Capable>) => {
        const result = recursiveRevive(data, context) as Promise<Capable>
        result
          .then(resolve)
          .catch(reject)
          .finally(() => {
            returnValueLocalPort.close()
          })
      }, { once: true })
      returnValueLocalPort.start()
    })

  // Cache the revived proxy by id so a subsequent rebox of the same source
  // function resolves to THIS reference.
  context.revivedFunctionsById.set(value.id, new WeakRef(func))

  // Register for GC cleanup: close the port, evict the local cache entry, and
  // tell the box side to evict its outgoing identity entry.
  functionRegistry.register(
    func,
    {
      port: port as MessagePort,
      id: value.id,
      sendMessage: context.sendMessage,
      remoteUuid: context.remoteUuid,
      revivedFunctionsById: context.revivedFunctionsById,
    },
    func,
  )

  return func
}

const typeCheck = () => {
  const boxed = box((a: number, b: string) => a + b.length, {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: (a: number, b: string) => Promise<number> = revived
  // @ts-expect-error - wrong return type
  const wrongReturn: (a: number, b: string) => Promise<string> = revived
  // @ts-expect-error - wrong parameter types
  const wrongParams: (a: string, b: number) => Promise<number> = revived
  // @ts-expect-error - non-Capable parameter type (Set is not directly Capable as parameter)
  box((a: WeakMap<object, string>) => a, {} as RevivableContext)
  // @ts-expect-error - non-Capable return type
  box(() => new WeakMap(), {} as RevivableContext)
  void expected; void wrongReturn; void wrongParams; void typeCheck
}
