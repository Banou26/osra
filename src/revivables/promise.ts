import type { Capable } from '../types'
import type { RevivableContext } from './utils'
import type { UnderlyingType } from '.'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase } from './utils'
import { EventChannel } from '../utils/event-channel'
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

export type BoxedPromise<T extends Capable = Capable> = {
  __OSRA_BOX__: 'revivable'
  type: typeof type
  port: BoxedMessagePort<Context>
  [UnderlyingType]: T
}

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
): BoxedPromise<ExtractCapable<T>> => {
  if (!isCapablePromise(value)) throw new TypeError('Expected Promise')
  const promise = value
  // EventChannel (pass-by-reference) — we can post live values raw; the
  // message-port revivable will box them when they cross the transport.
  const { port1: localPort, port2: remotePort } = new EventChannel<Context, Context>()

  const sendResult = (result: Context) => {
    localPort.postMessage(result)
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
  return new Promise<T[UnderlyingType]>((resolve, reject) => {
    port.addEventListener('message', ({ data: result }) => {
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
