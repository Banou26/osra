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
  const body = value.body ? reviveReadableStream(value.body, context) : null

  return new Request(value.url, {
    method: value.method,
    headers,
    body,
    credentials: value.credentials as RequestCredentials,
    cache: value.cache as RequestCache,
    redirect: value.redirect as RequestRedirect,
    referrer: value.referrer,
    referrerPolicy: value.referrerPolicy as ReferrerPolicy,
    integrity: value.integrity,
    keepalive: value.keepalive,
    // @ts-expect-error - duplex is needed for streaming bodies
    duplex: 'half'
  })
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
