import type { Capable, Message, MessageContext } from '../types'
import type { PlatformCapabilities } from './capabilities'

export const startBidirectionalConnection = (
  { uuid, remoteUuid, platformCapabilities, send, close }:
  {
    uuid: string
    remoteUuid?: string
    platformCapabilities: PlatformCapabilities
    send?: (message: Message) => void
    close: () => void
  }
) => {
  return {
    receiveMessage: (message: Message, messageContext: MessageContext) => {
    }
  }
}

export type BidirectionalConnection = ReturnType<typeof startBidirectionalConnection>

export const startUnidirectionalEmittingConnection = <T extends Capable>(
  { value, uuid, platformCapabilities, send, close }:
  {
    value: Capable
    uuid: string
    platformCapabilities: PlatformCapabilities
    send: (message: Message) => void
    close: () => void
  }
) => {

  return {
    proxy: new Proxy(
      new Function(),
      {
        apply: (target, thisArg, args) => {
        },
        get: (target, prop) => {
        }
      }
    ) as T
  }
}

export type UnidirectionalEmittingConnection = ReturnType<typeof startUnidirectionalEmittingConnection>

export const startUnidirectionalReceivingConnection = (
  { uuid, remoteUuid, platformCapabilities, close }:
  {
    uuid: string
    remoteUuid?: string
    platformCapabilities: PlatformCapabilities
    close: () => void
  }
) => {
  return {
    receiveMessage: (message: Message, messageContext: MessageContext) => {
    }
  }
}

export type UnidirectionalReceivingConnection = ReturnType<typeof startUnidirectionalReceivingConnection>
