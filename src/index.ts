import type { RemoteTarget, LocalTarget, OsraMessage, StructuredCloneTransferableProxiableType } from './types'

import { OSRA_MESSAGE_KEY, OSRA_MESSAGE_PROPERTY } from './types'

export const expose = async <T extends StructuredCloneTransferableProxiableType>(
  value: StructuredCloneTransferableProxiableType,
  {
    remote: _remote,
    local: _local,
    key = OSRA_MESSAGE_KEY,
    origin = '*'
  }: {
    remote: RemoteTarget | ((osraMessage: OsraMessage, transferables: Transferable[]) => void)
    local: LocalTarget | ((listener: (event: MessageEvent<OsraMessage>) => void) => void)
    key?: string,
    origin?: string
  }
): Promise<T> => {



}
