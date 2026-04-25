import type { Capable } from '../types'
import type { UnderlyingType, RevivableContext, BoxBase as BoxBaseType } from './utils'
import type { Handle, HandleId } from '../utils/remote-handle'

import { BoxBase, serializeError } from './utils'
import { recursiveBox, recursiveRevive } from '.'
import { createHandle, adoptHandle } from '../utils/remote-handle'

export const type = 'function' as const

type ResultMessage =
  | { __osra_ok__: true, value: Capable }
  | { __osra_err__: true, error: string }

/** Wire payload of a single call: [return-handle id, recursively-boxed args]. */
type CallPayload = [HandleId, Capable[]]

type CallRecord = {
  reject: (error: unknown) => void
  returnHandle: Handle
}

export type BoxedFunction<T extends (...args: any[]) => any = (...args: any[]) => any> =
  & BoxBaseType<typeof type>
  & { handleId: HandleId }
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
  context: T2,
): BoxedFunction<T> => {
  // Owner side: every incoming call arrives as a single handle-message —
  // no per-call channel, no `__osra_close__` sentinel. The closure pins
  // `value` as long as this entry lives in the connection's handle table;
  // peer-side release (proxy GC or explicit) tears the entry down, after
  // which `value` is free to be collected if the user holds no other ref.
  const funcHandle = createHandle(context, {
    onMessage: (payload) => {
      const [returnId, boxedArgs] = payload as CallPayload
      // Adopt-only: no tracked value — the return handle's lifetime is
      // bounded by the call (released in finally below).
      const returnHandle = adoptHandle(context, returnId, {})
      const args = recursiveRevive(boxedArgs as Capable, context) as Parameters<T>
      ;(async () => value(...args))()
        .then(
          (resolved) => {
            const result: ResultMessage = { __osra_ok__: true, value: resolved as Capable }
            try {
              returnHandle.send(recursiveBox(result as Capable, context))
            } catch (postErr) {
              // Result wasn't boxable — surface as a remote error so the
              // caller's await rejects instead of hanging.
              try {
                returnHandle.send(recursiveBox(
                  { __osra_err__: true, error: serializeError(postErr) } satisfies ResultMessage as Capable,
                  context,
                ))
              } catch { /* error itself failed to serialise */ }
            }
          },
          (error: unknown) => {
            try {
              returnHandle.send(recursiveBox(
                { __osra_err__: true, error: serializeError(error) } satisfies ResultMessage as Capable,
                context,
              ))
            } catch { /* serialised error failed to post */ }
          },
        )
        .finally(() => returnHandle.release())
    },
  })
  return { ...BoxBase, type, handleId: funcHandle.id } as BoxedFunction<T>
}

export const revive = <T extends BoxedFunction, T2 extends RevivableContext>(
  value: T,
  context: T2,
): T[UnderlyingType] => {
  const inFlight = new Set<CallRecord>()

  // Captured by both `func`'s closure (so calls can post on it) and
  // `funcHandle.onRelease` (so abandoned awaits stop hanging when the
  // handle dies). Crucially, neither of those reaches `func` — the FR
  // can fire on `func` once the user drops their last reference.
  let funcHandle: Handle
  const func = (...args: Capable[]) =>
    new Promise((resolve, reject) => {
      const returnHandle = createHandle(context, {
        onMessage: (payload) => {
          const result = recursiveRevive(payload, context) as ResultMessage
          if ('__osra_ok__' in result) resolve(result.value)
          else reject(result.error)
          inFlight.delete(record)
          returnHandle.release()
        },
      })
      const record: CallRecord = { reject, returnHandle }
      inFlight.add(record)
      try {
        const callPayload: CallPayload = [returnHandle.id, args]
        funcHandle.send(recursiveBox(callPayload as unknown as Capable, context))
      } catch (sendErr) {
        // Synchronous send-failure (DataCloneError on clone, JSON cycle
        // on JSON). Without this, the in-flight record would leak and
        // the executor's implicit catch would still reject the Promise —
        // we'd just keep a dead `record` in the set forever.
        inFlight.delete(record)
        returnHandle.release()
        reject(sendErr)
      }
    })

  funcHandle = adoptHandle(context, value.handleId, {
    onRelease: () => {
      // Defer the in-flight rejection. Two motivations: (1) V8's liveness
      // analysis can drop the proxy local right after the last
      // `await callback()` syntactic use even though the Promise is still
      // pending — FR then fires before the result macrotask gets dispatched,
      // and a tight `await (await remote())()` loop would reject calls
      // that were a queue-tick away from resolving normally. (2) If the
      // owner explicitly released, in-flight values may already be on the
      // wire heading our way; we'd rather deliver them than reject. The
      // returnHandle entries stay in `state.handles` during the deferral,
      // so an arriving result can still find its handler and resolve;
      // each successful onMessage removes its own record from `inFlight`,
      // and the sweep below only catches calls genuinely stuck.
      // funcDropRejectsPending tolerates 2s — 100ms is safely under that.
      setTimeout(() => {
        for (const { reject, returnHandle } of inFlight) {
          try { reject(new Error('osra function was garbage collected before result arrived')) } catch { /* listener gone */ }
          returnHandle.release()
        }
        inFlight.clear()
      }, 100)
    },
  }, func)

  return func as T[UnderlyingType]
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
}
