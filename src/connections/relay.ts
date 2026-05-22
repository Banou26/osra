import type { Transport } from '../utils/transport'

import { OSRA_DEFAULT_KEY } from '../types'
import { isEmitTransport, isReceiveTransport } from '../utils/type-guards'
import { getTransferableObjects } from '../utils/transferable'
import {
  registerOsraMessageListener,
  sendOsraMessage,
} from '../utils/transport'
import { normalizeTransport } from './utils'

export type RelayOptions = {
  key?: string
  origin?: string
  originA?: string
  originB?: string
  nameA?: string
  nameB?: string
  unregisterSignal?: AbortSignal
}

export const relay = (
  transportA: Transport,
  transportB: Transport,
  {
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    originA = origin,
    originB = origin,
    nameA,
    nameB,
    unregisterSignal,
  }: RelayOptions = {},
): void => {
  const a = normalizeTransport(transportA)
  const b = normalizeTransport(transportB)

  const forward = (
    from: Transport,
    to: Transport,
    toOrigin: string,
    remoteName: string | undefined,
  ): void => {
    if (!isReceiveTransport(from) || !isEmitTransport(to)) return
    registerOsraMessageListener({
      transport: from,
      key,
      remoteName,
      unregisterSignal,
      listener: (message) => {
        sendOsraMessage(to, message, toOrigin, getTransferableObjects(message))
      },
    })
  }

  forward(a, b, originB, nameA)
  forward(b, a, originA, nameB)
}
