import type { RevivableContext } from './utils'

import { BoxBase } from './utils'
import { box as boxHeaders, revive as reviveHeaders } from './headers'
import { box as boxReadableStream, revive as reviveReadableStream } from './readable-stream'

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
  const headers = reviveHeaders(value.headers, context)
  const body = value.body ? reviveReadableStream(value.body, context) : null

  return new Response(body, {
    status: value.status,
    statusText: value.statusText,
    headers
  })
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
