import type { BrowserWindow, IpcMain, IpcRenderer, MessagePortMain } from 'electron'

import { PROXY_FUNCTION_PROPERTY, PROXY_MESSAGE_CHANNEL_PROPERTY, isClonable, isTransferable } from './utils'
import { MESSAGE_SOURCE_KEY, OSRA_NAMESPACE } from './shared'

type ExtraPort = {
  sender: BrowserWindow['webContents'] | IpcRenderer
  port: MessagePort
}

type MainPortManager = ReturnType<typeof makeMainPortManager>
const makeMainPortManager = ({ ipcMain, key = MESSAGE_SOURCE_KEY }: { ipcMain: IpcMain, key?: string }) => {
  const ports = new Map<string, ExtraPort>()

  const getPort = async (uuid: string): Promise<ExtraPort> =>
    ports.get(uuid) ?? new Promise((resolve, reject) => {
      const listener = (port) => {
        if (port.name === `${key}:${uuid}`) {
          ports.set(uuid, port)
          resolve(port)
          clearTimeout(timeout)
          ipcMain.removeListener(`${OSRA_NAMESPACE}-${key}`, listener)
        }
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Osra getPort for "${uuid}" timed out`))
        ipcMain.removeListener(`${OSRA_NAMESPACE}-${key}`, listener)
      }, 1000)
      ipcMain.addListener(`${OSRA_NAMESPACE}-${key}`, listener)
    })

  const portManager = {
    addPort: (name: string, port: ExtraPort) => ports.set(name, port),
    proxyPort: (messagePort: ExtraPort) => {
      const uuid = self.crypto.randomUUID()
      const runtimePort = chrome.runtime.connect({ name: `${key}:${uuid}` })
      // @ts-ignore
      ports.set(uuid, runtimePort)

      runtimePort.onDisconnect.addListener(() => {
        ports.delete(uuid)
      })
      runtimePort.onMessage.addListener((message) => {
        messagePort.postMessage(message)
      })

      messagePort.addListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      messagePort.addListener('close', () => {
        runtimePort.disconnect()
      })

      return {
        [PROXY_MESSAGE_CHANNEL_PROPERTY]: uuid
      }
    },
    proxiedPort: async ({ [PROXY_MESSAGE_CHANNEL_PROPERTY]: uuid }: { [PROXY_MESSAGE_CHANNEL_PROPERTY]: string }) => {
      const { port1, port2 } = new MessageChannel()
      const runtimePort = await getPort(uuid)

      runtimePort.onMessage.addListener((message) => {
        port1.postMessage(message)
      })
      runtimePort.onDisconnect.addListener(() => {
        port1.close()
      })

      port1.addEventListener('close', () => {
        runtimePort.disconnect()
      })
      port1.addEventListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      port1.start()

      port2.addEventListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      port2.start()

      const port = wrapPort(portManager, port2)
      // @ts-ignore
      port.uuid = uuid
      return port
    }
  }
  return portManager
}


type RendererPortManager = ReturnType<typeof makeRendererPortManager>
const makeRendererPortManager = ({ ipcRenderer, key = MESSAGE_SOURCE_KEY }: { ipcRenderer: IpcRenderer, key?: string }) => {
  const ports = new Map<string, MessagePort>()

  const getPort = async (uuid: string): Promise<MessagePort> =>
    ports.get(uuid) ?? new Promise((resolve, reject) => {
      let resolved = false
      setTimeout(() => {
        if (!resolved) {
          reject(new Error(`Osra getPort for "${uuid}" timed out`))
        }
      }, 1000)
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name === `${key}:${uuid}`) {
          // @ts-ignore
          ports.set(uuid, port)
          // @ts-ignore
          resolve(port)
          resolved = true
        }
      })
    })

  const portManager = {
    addPort: (name: string, port: MessagePort) => ports.set(name, port),
    proxyPort: (messagePort: MessagePort) => {
      const uuid = self.crypto.randomUUID()
      const runtimePort = chrome.runtime.connect({ name: `${key}:${uuid}` })
      // @ts-ignore
      ports.set(uuid, runtimePort)

      runtimePort.onDisconnect.addListener(() => {
        ports.delete(uuid)
      })
      runtimePort.onMessage.addListener((message) => {
        messagePort.postMessage(message)
      })

      messagePort.addEventListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      messagePort.addEventListener('close', () => {
        runtimePort.disconnect()
      })

      return {
        [PROXY_MESSAGE_CHANNEL_PROPERTY]: uuid
      }
    },
    proxiedPort: async ({ [PROXY_MESSAGE_CHANNEL_PROPERTY]: uuid }: { [PROXY_MESSAGE_CHANNEL_PROPERTY]: string }) => {
      const { port1, port2 } = new MessageChannel()
      const runtimePort = await getPort(uuid)

      runtimePort.onMessage.addListener((message) => {
        port1.postMessage(message)
      })
      runtimePort.onDisconnect.addListener(() => {
        port1.close()
      })

      port1.addEventListener('close', () => {
        runtimePort.disconnect()
      })
      port1.addEventListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      port1.start()

      port2.addEventListener('message', async (ev) => {
        runtimePort.postMessage(ev.data)
      })
      port2.start()

      const port = wrapPort(portManager, port2)
      // @ts-ignore
      port.uuid = uuid
      return port
    }
  }
  return portManager
}

type PortManager = MainPortManager | RendererPortManager

export const replaceProxies = (portManager: PortManager, value: any) =>
  value instanceof MessagePort ? portManager.proxyPort(value) :
  isClonable(value) ? value :
  isTransferable(value) ? value :
  typeof value === 'object' && PROXY_FUNCTION_PROPERTY in value ? ({ [PROXY_FUNCTION_PROPERTY]: portManager.proxyPort(value[PROXY_FUNCTION_PROPERTY]) }) :
  Array.isArray(value) ? value.map((value) => replaceProxies(portManager, value)) :
  value && typeof value === 'object' ? (
    Object.fromEntries(
      Object
        .entries(value)
        .map(([key, value]) => [
          key,
          replaceProxies(portManager, value)
        ])
    )
  ) :
  value

export const replaceProxied = async (portManager: PortManager, value: any) =>
  isClonable(value) ? value :
  isTransferable(value) ? value :
  typeof value === 'object' && PROXY_MESSAGE_CHANNEL_PROPERTY in value ? await portManager.proxiedPort(value) :
  typeof value === 'object' && PROXY_FUNCTION_PROPERTY in value ? ({ [PROXY_FUNCTION_PROPERTY]: await portManager.proxiedPort(value[PROXY_FUNCTION_PROPERTY]) }) :
  Array.isArray(value) ? await Promise.all(value.map((value) => replaceProxied(portManager, value))) :
  value && typeof value === 'object' ? (
    Object.fromEntries(
      await Promise.all(
        Object
          .entries(value)
          .map(async ([key, value]) => [
            key,
            await replaceProxied(portManager, value)
          ])
      )
    )
  ) :
  value

export const wrapPort = (portManager, port: MessagePort) => {
  const _portMessage = port.postMessage
  port.postMessage = (message: any) => {
    _portMessage.apply(port, [replaceProxies(portManager, message)])
  }
  return port
}

export const wrapMainTarget = ({
  ipcMain,
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  ipcMain,
  target: BrowserWindow['webContents']
  key?: string
}) => {
  const portManager = makeMainPortManager({ ipcMain, key })

  return {
    ...target,
    postMessage: (message: any) => {
      target.postMessage(key, replaceProxies(portManager, message))
    }
  }
}

export const wrapRendererTarget = ({
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  target: IpcRenderer
  key?: string
}) => {
  const portManager = makeRendererPortManager({ ipcRenderer: target, key })

  return {
    ...target,
    postMessage: (message: any) => {
      target.postMessage(key, replaceProxies(portManager, message))
    }
  }
}

export const wrapListenerMainTarget = ({
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  target: IpcMain
  key?: string
}) => {
  const portManager = makeMainPortManager({ ipcMain: target, key })

  return {
    ...target,
    addEventListener: (type: string, listener: Parameters<IpcMain['addListener']>[1]) => {
      if (type !== 'message') return target.addListener(type, listener)

      target.on(`${OSRA_NAMESPACE}-${key}`, async (ipcMainEvent) => {
        const [dataPort, metaPort] = ipcMainEvent.ports ?? []
        if (!dataPort || !metaPort) return
        const portKey = await new Promise<string>(resolve => {
          metaPort?.addListener('message', function listener (ev) {
            resolve(ev.data)
            metaPort?.removeListener('message', listener)
          })
        })
        if (!portKey.startsWith(`${key}:`)) return
        // @ts-ignore
        portManager.addPort(portKey.split(':')[1]!, dataPort)
      })
    }
  }
}

export const wrapListenerRendererTarget = ({
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  target: IpcRenderer
  key?: string
}) => {
  const portManager = makeRendererPortManager({ ipcRenderer: target, key })

  return {
    ...target,
    addEventListener: (type: string, listener: Parameters<IpcRenderer['addListener']>[1]) => {
      if (type !== 'message') return target.addListener(type, listener)

      target.addListener(`${OSRA_NAMESPACE}-${key}`, async (ipcRendererEvent) => {
        const [dataPort, metaPort] = ipcRendererEvent.ports ?? []
        if (!dataPort || !metaPort) return
        const portKey = await new Promise<string>(resolve => {
          metaPort.addEventListener('message', function listener (ev) {
            resolve(ev.data)
            metaPort?.removeEventListener('message', listener)
            metaPort.close()
          })
        })
        if (!portKey.startsWith(`${key}:`)) return
        ipcRendererEvent.
        // @ts-ignore
        portManager.addPort(portKey.split(':')[1]!, dataPort)
      })
    }
  }
}
