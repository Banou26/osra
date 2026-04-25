import type { Capable } from '../types'
import type { RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { UnderlyingType } from '.'
import type { HandleId } from '../utils/remote-handle'
import type {
  BadFieldValue, BadFieldPath, BadFieldParent,
  ErrorMessage, BadValue, Path, ParentObject
} from '../utils/capable-check'

import { BoxBase, serializeError } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'promise' as const

export type ResultMessage =
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
  & { handleId: HandleId }
  & { [UnderlyingType]: T }

export const isType = (value: unknown): value is Promise<any> =>
  value instanceof Promise

export const box = <T, T2 extends RevivableContext>(
  value: CapablePromise<T>,
  context: T2,
): BoxedPromise<ExtractCapable<T>> => {
  if (!isCapablePromise(value)) throw new TypeError('Expected Promise')
  // One-shot handle: send result, release. The promise itself owns the
  // settlement; no GC tracking needed on this side.
  const handle = createHandle(context, {})
  const trySend = (msg: ResultMessage) => {
    try { handle.send(recursiveBox(msg as Capable, context)) }
    catch (sendErr) {
      // Resolve value wasn't serialisable. Surface it as a reject so the
      // peer's await rejects rather than hanging — mirrors function.ts's
      // DataCloneError fallback. If the error envelope itself fails too,
      // there's nothing left to do.
      if (msg.type === 'resolve') {
        try {
          handle.send(recursiveBox(
            { type: 'reject', error: serializeError(sendErr) } satisfies ResultMessage as Capable,
            context,
          ))
        } catch { /* error envelope failed too */ }
      }
    }
  }
  value
    .then((data: ExtractCapable<T>) => trySend({ type: 'resolve', data }))
    .catch((error: unknown) => trySend({ type: 'reject', error: serializeError(error) }))
    .finally(() => handle.release())
  return { ...BoxBase, type, handleId: handle.id } as BoxedPromise<ExtractCapable<T>>
}

export const revive = <T extends BoxedPromise, T2 extends RevivableContext>(
  value: T,
  context: T2,
) =>
  new Promise<T[UnderlyingType]>((resolve, reject) => {
    // Closure pins `resolve`/`reject` until the handle delivers — the
    // handle entry lives in the connection's handle table, which is held
    // by the connection state, so there's no risk of the cycle getting
    // collected mid-flight (the issue the old `inFlightPromisePorts` Set
    // worked around).
    const handle = adoptHandle(context, value.handleId, {
      onMessage: (payload) => {
        const result = recursiveRevive(payload, context) as ResultMessage
        if (result.type === 'resolve') resolve(result.data as T[UnderlyingType])
        else reject(result.error)
        handle.release()
      },
      onRelease: () => {
        // Owner side dropped without sending — surface as a reject so the
        // caller's await stops hanging. The opposite direction (we drop
        // the proxy Promise) is handled implicitly: the Promise object
        // itself isn't tracked here, so dropping it just abandons the
        // executor and the handle releases when peer's send arrives.
        reject(new Error('osra promise was released before settling'))
      },
    })
  })

const typeCheck = () => {
  const boxed = box(Promise.resolve(1 as const), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Promise<1> = revived
  // @ts-expect-error
  const notExpected: Promise<string> = revived
  // @ts-expect-error
  box(1 as const, {} as RevivableContext)
}
