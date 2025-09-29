import type { Message, MessageContext } from '../types'
import type { PlatformCapabilities } from './capabilities'

export const startConnection = (
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

export type Connection = ReturnType<typeof startConnection>
