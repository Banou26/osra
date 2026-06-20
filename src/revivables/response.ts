import type { RevivableContext } from './utils.js'

import { BoxBase } from './utils.js'
import { box as boxHeaders, revive as reviveHeaders } from './headers.js'
import { box as boxReadableStream, revive as reviveReadableStream } from './readable-stream.js'

export const type = 'response' as const

export const isType = (value: unknown): value is Response =>
  value instanceof Response

export const box = <T extends Response, T2 extends RevivableContext>(
  value: T,
  context: T2
) => ({
  ...BoxBase,
  type,
  status: value.status,
  statusText: value.statusText,
  headers: boxHeaders(value.headers, context),
  body: value.body ? boxReadableStream(value.body, context) : null,
  url: value.url,
  redirected: value.redirected
})

export const revive = <T extends ReturnType<typeof box>, T2 extends RevivableContext>(
  value: T,
  context: T2
): Response => {
  // Opaque/error responses report status 0, which the constructor rejects.
  if (value.status === 0) return Response.error()

  const headers = reviveHeaders(value.headers, context)
  // 101/204/205/304 forbid a body; `new Response` throws if given one. Cancel any
  // boxed stream (so the sender isn't left pushing into a dead port) and pass null.
  const stream = value.body ? reviveReadableStream(value.body, context) : null
  const isNullBodyStatus =
    value.status === 101 || value.status === 204 || value.status === 205 || value.status === 304
  if (stream && isNullBodyStatus) stream.cancel().catch(() => {})
  const body = isNullBodyStatus ? null : stream

  const response = new Response(body, {
    status: value.status,
    statusText: value.statusText,
    headers
  })
  // url/redirected are read-only getters fed by internal state the
  // constructor can't set - shadow them so the round trip is faithful.
  if (value.url) Object.defineProperty(response, 'url', { value: value.url, configurable: true })
  if (value.redirected) Object.defineProperty(response, 'redirected', { value: true, configurable: true })
  return response
}

const typeCheck = () => {
  const boxed = box(new Response('body', { status: 200 }), {} as RevivableContext)
  const revived = revive(boxed, {} as RevivableContext)
  const expected: Response = revived
  // @ts-expect-error - not a Response
  const notResponse: string = revived
  // @ts-expect-error - cannot box non-Response
  box('not a response', {} as RevivableContext)
}
