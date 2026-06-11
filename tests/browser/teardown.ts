import { expect } from 'chai'

import type { Uuid } from '../../src/types'

import { expose } from '../../src/index'
import { OSRA_KEY, OSRA_DEFAULT_KEY } from '../../src/types'

// Error and teardown paths: misconfiguration must reject (not hang),
// abort must reject pending work locally, and the protocol 'close' must
// tear the peer down too.

export const emitOnlyTransportRejects = async () => {
  await expect(
    expose({}, { transport: { emit: () => {} } }),
  ).to.eventually.be.rejectedWith(/emit and receive/)
}

export const receiveOnlyTransportRejects = async () => {
  await expect(
    expose({}, { transport: { receive: () => {} } }),
  ).to.eventually.be.rejectedWith(/emit and receive/)
}

export const abortRejectsPendingExpose = async () => {
  const { port1 } = new MessageChannel()
  const controller = new AbortController()
  const pending = expose({}, { transport: port1, unregisterSignal: controller.signal })
  controller.abort(new Error('torn down'))
  await expect(pending).to.eventually.be.rejectedWith(/torn down/)
}

export const abortRejectsPendingCalls = async () => {
  const { port1, port2 } = new MessageChannel()
  const value = { hang: () => new Promise<void>(() => {}) }
  expose(value, { transport: port1 })

  const controller = new AbortController()
  const remote = await expose<typeof value>(
    {},
    { transport: port2, unregisterSignal: controller.signal },
  )
  const call = remote.hang()
  await new Promise(resolve => setTimeout(resolve, 50))
  controller.abort()
  await expect(call).to.eventually.be.rejectedWith(/connection closed/)
}

// Aborting one side sends a protocol 'close' - the *peer*'s pending calls
// must reject too, not hang forever.
export const peerCloseRejectsPendingCalls = async () => {
  const { port1, port2 } = new MessageChannel()
  const exposerController = new AbortController()
  const value = { hang: () => new Promise<void>(() => {}) }
  expose(value, { transport: port1, unregisterSignal: exposerController.signal })

  const remote = await expose<typeof value>({}, { transport: port2 })
  const call = remote.hang()
  await new Promise(resolve => setTimeout(resolve, 50))
  exposerController.abort()
  await expect(call).to.eventually.be.rejectedWith(/connection closed/)
}

// A hand-rolled peer completes the announce dance, then sends an init
// whose payload contains an unrevivable box - expose() must reject with
// the revive error instead of hanging with an unhandled rejection.
export const malformedInitRejects = async () => {
  const { port1, port2 } = new MessageChannel()
  port2.start()
  const evilUuid = '11111111-1111-1111-1111-111111111111' as Uuid

  port2.onmessage = ({ data }) => {
    if (data?.[OSRA_KEY] !== OSRA_DEFAULT_KEY) return
    if (data.type === 'announce' && !data.remoteUuid) {
      const envelope = { [OSRA_KEY]: OSRA_DEFAULT_KEY, uuid: evilUuid }
      port2.postMessage({ ...envelope, type: 'announce', remoteUuid: data.uuid })
      port2.postMessage({
        ...envelope,
        type: 'init',
        remoteUuid: data.uuid,
        data: {
          __OSRA_BOX__: 'revivable',
          type: 'typedArray',
          typedArrayType: 'NotARealTypedArray',
          base64Buffer: '',
        },
      })
    }
  }

  await expect(
    expose({}, { transport: port1 }),
  ).to.eventually.be.rejectedWith(/Unknown typed array/)
}
