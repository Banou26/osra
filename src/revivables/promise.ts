import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type { TypedMessagePort } from '../utils/typed-message-channel'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase } from './utils'
import { EventChannel } from '../utils/event-channel'
import { getTransferableObjects, isJsonOnlyTransport } from '../utils'
import { recursiveBox, recursiveRevive } from '.'
import {
  box as boxMessagePort,
  revive as reviveMessagePort,
  BoxedMessagePort
} from './message-port'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

// Error branches intersect with T so the user's own keys are present on the
// target — otherwise TS's excess-property check flags the first user key
// (e.g. `foo`) instead of reporting the failure against the whole argument.
type CapablePromise<T> = T extends Promise<infer U>
  ? U extends Capable
    ? T
    : T & {
        [ErrorMessage]: 'Value type must extend a Promise that resolves to a Capable'
        [BadValue]: BadFieldValue<U, Capable>
        [Path]: BadFieldPath<U, Capable>
        [ParentObject]: BadFieldParent<U, Capable>
      }
  : T & {
      [ErrorMessage]: 'Value type must extend a Promise that resolves to a Capable'
      [BadValue]: T
      [Path]: ''
      [ParentObject]: T
    }

type ExtractCapable<T> = T extends Promise<infer U>
  ? U extends Capable ? U : never
  : never

const isCapablePromise = <T, U extends Capable = ExtractCapable<T>>(value: T): value is T & Promise<U> =>
  value instanceof Promise

export type BoxedPromise<T extends Capable = Capable> =
  & BoxBaseType<typeof type>
  & { port: BoxedMessagePort<Context> }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
): BoxedPromise<ExtractCapable<T>> => {
  if (!isCapablePromise(value)) throw new TypeError('Expected Promise')
  const promise = value
  // Structured-clone transports get a real MessageChannel: the remote port is
  // transferred on the wire (message-port fast path), and we box/revive the
  // data ourselves. JSON-only transports fall back to EventChannel, which
  // routes through message-port's portId handler (it does the box/revive).
  const isJson = isJsonOnlyTransport(context.transport)
  const { port1: localPort, port2: remotePort } = isJson
    ? new EventChannel<Context, Context>()
    : new MessageChannel() as unknown as { port1: TypedMessagePort<Context>, port2: TypedMessagePort<Context> }

  const sendResult = (result: Context) => {
    if (isJson) {
      localPort.postMessage(result)
    } else {
      const boxed = recursiveBox(result, context) as Context
      localPort.postMessage(boxed, getTransferableObjects(boxed))
    }
    localPort.close()
  }

  promise
    .then((data: ExtractCapable<T>) => sendResult({ type: 'resolve', data }))
    .catch((error: unknown) => sendResult({
      type: 'reject',
      error: error instanceof Error ? (error.stack ?? String(error)) : String(error),
    }))

  return {
    ...BoxBase,
    type,
    port: boxMessagePort(remotePort, context)
  } as BoxedPromise<ExtractCapable<T>>
}

export const revive = <T extends BoxedPromise, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const port = reviveMessagePort(value.port, context)
  // See `box`: on clone transports we boxed the result ourselves, so revive
  // it back; on JSON transports message-port already revived for us.
  const isJson = isJsonOnlyTransport(context.transport)
  return new Promise<T[UnderlyingType]>((resolve, reject) => {
    port.addEventListener('message', ({ data }) => {
      const result = isJson ? data : recursiveRevive(data, context) as Context
      if (result.type === 'resolve') {
        resolve(result.data as T[UnderlyingType])
      } else {
        reject(result.error)
      }
      port.close()
    }, { once: true })
    port.start()
  })
}

const typeCheck = () => {
  const boxed = box(Promise.resolve(1 as const), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Promise<1> = revived
  // @ts-expect-error
  const notExpected: Promise<string> = revived
  // @ts-expect-error
  box(1 as const, {} as RevivableContext)
}
