import type { Resolvers } from '@mfkn/fkn-web'

type pull = (
  type: keyof Resolvers,
  data?: any,
  transfer?: Transferable[]
) => AsyncGenerator

const pull: pull = async function * (type, data, transfer = []) {
  const { port1, port2 } = new MessageChannel()

  window.parent.postMessage(
    {
      source: 'oz-package-api',
      type,
      data,
      port: port2
    },
    '*',
    [port2, ...transfer]
  )

  let done = false
  let resolve
  let currentPromise = new Promise(_resolve => resolve = _resolve)
  port1.addEventListener(
    'message',
    ({ data: { value, done: _done } }) => {
      if (_done) done = true
      resolve(value)
    }
  )
  port1.start()
  while (!done) {
    yield await currentPromise
    currentPromise = new Promise(_resolve => resolve = _resolve)
  }
  port1.close()
  port2.close()
}

export default pull
