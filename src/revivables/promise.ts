import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase, serializeError } from './utils'
import {
  createRevivableChannel,
  revive as reviveMessagePort,
  BoxedMessagePort,
  AnyPort,
} from './message-port'

export const type = 'promise' as const

export type Context =
  | { type: 'resolve', data: Capable }
  | { type: 'reject', error: string }

// Error branches intersect with T so the user's own keys land on the target —
// otherwise TS's excess-property check flags a user key instead of the failure.
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

// Pins the revived port between executor return and result arrival — the
// port↔listener cycle has no other anchor (the caller only holds the
// returned Promise). The once-listener removes its entry on settle.
const inFlightPromisePorts = new Set<AnyPort<Context>>()

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2
): BoxedPromise<ExtractCapable<T>> => {
  if (!isCapablePromise(value)) throw new TypeError('Expected Promise')
  const { localPort, boxedRemote } = createRevivableChannel<Context>(context)

  const sendResult = (result: Context) => {
    localPort.postMessage(result)
    localPort.close()
  }

  value
    .then((data: ExtractCapable<T>) => sendResult({ type: 'resolve', data }))
    .catch((error: unknown) => sendResult({ type: 'reject', error: serializeError(error) }))

  return { ...BoxBase, type, port: boxedRemote } as BoxedPromise<ExtractCapable<T>>
}

export const revive = <T extends BoxedPromise, T2 extends RevivableContext>(
  value: T,
  context: T2
) => {
  const port = reviveMessagePort(value.port, context)
  inFlightPromisePorts.add(port)
  return new Promise<T[UnderlyingType]>((resolve, reject) => {
    port.addEventListener('message', ({ data: result }) => {
      if (result.type === 'resolve') resolve(result.data as T[UnderlyingType])
      else reject(result.error)
      port.close()
      inFlightPromisePorts.delete(port)
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
