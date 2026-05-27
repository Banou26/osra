import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { box as boxHeaders, revive as reviveHeaders } from './headers'
import { box as boxReadableStream, revive as reviveReadableStream } from './readable-stream'

export const type = 'request' as const

export const isType = (value: unknown): value is Request =>
  value instanceof Request

export const box = <T extends Request, T2 extends RevivableContext>(
  value: T,
  context: T2
) => ({
  ...BoxBase,
  type,
  method: value.method,
  url: value.url,
  headers: boxHeaders(value.headers, context),
  body: value.body ? boxReadableStream(value.body, context) : null,
  credentials: value.credentials,
  cache: value.cache,
  redirect: value.redirect,
  referrer: value.referrer,
  referrerPolicy: value.referrerPolicy,
  integrity: value.integrity,
  keepalive: value.keepalive
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
): Request => {
  const headers = reviveHeaders(value.headers, context)

  // Firefox normalizes `body: null` in the constructor to a Request whose
  // `.body` getter returns `undefined` instead of `null`. Only pass `body`
  // when there's an actual stream so a bodyless source round-trips to a
  // bodyless Request on every browser.
  const init: RequestInit & { duplex?: 'half' } = {
    method: value.method,
    headers,
    credentials: value.credentials,
    cache: value.cache,
    redirect: value.redirect,
    referrer: value.referrer,
    referrerPolicy: value.referrerPolicy,
    integrity: value.integrity,
    keepalive: value.keepalive,
  }
  if (value.body) {
    init.body = reviveReadableStream(value.body, context)
    init.duplex = 'half'
  }

  return new Request(value.url, init)
}

const typeCheck = () => {
  const boxed = box(new Request('https://example.com'), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Request = revived
  // @ts-expect-error - not a Request
  const notRequest: string = revived
  // @ts-expect-error - cannot box non-Request
  box('not a request', {} as RevivableContext)
}
