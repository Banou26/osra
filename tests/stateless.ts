import { expect } from 'chai'

import { expose } from '../src/index'
import { makeJsonTransport } from './utils'

// Simulates a websocket broadcast case where only one client can broadcast and the rest can only receive messages
export const stateless = async () => {
  const { port1, port2 } = new MessageChannel()
  const value = { test: async () => 1 }
  expose(value, { transport: makeJsonTransport(port1) })

  const { test } = await expose<typeof value>(
    undefined,
    { transport: makeJsonTransport(port2) }
  )

  await expect(await test()).to.eventually.equal(1)
}
