import type browser from 'webextension-polyfill'
import { PROXY_FUNCTION_PROPERTY, PROXY_MESSAGE_CHANNEL_PROPERTY, isClonable, isTransferable } from './utils'
import { MESSAGE_SOURCE_KEY } from './shared'

type PortManager = ReturnType<typeof makePortManager>
const makePortManager = ({ key = MESSAGE_SOURCE_KEY }: { key?: string }) => {
  const ports = new Map<string, browser.Runtime.Port>()

  const getPort = async (uuid: string): Promise<browser.Runtime.Port> =>
    ports.get(uuid) ?? new Promise((resolve, reject) => {
      const listener = (port) => {
        if (port.name === `${key}:${uuid}`) {
          ports.set(uuid, port)
          resolve(port)
          clearTimeout(timeout)
          chrome.runtime.onConnect.removeListener(listener)
        }
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Osra getPort for "${uuid}" timed out`))
        chrome.runtime.onConnect.removeListener(listener)
      }, 1000)
      chrome.runtime.onConnect.addListener(listener)
    })

  const portManager = {
    addPort: (name: string, port: browser.Runtime.Port) => ports.set(name, port),
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

export const wrapExtensionTarget = ({
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  target: browser.Browser
  key?: string
}) => {
  const portManager = makePortManager({ key })

  return {
    ...target,
    postMessage: (message: any) => {
      target.runtime.sendMessage(replaceProxies(portManager, message))
    }
  }
}

export const wrapListenerExtensionTarget = ({
  target,
  key = MESSAGE_SOURCE_KEY
}: {
  target: WindowEventHandlers | ServiceWorkerContainer | Worker | SharedWorker
  key?: string
}) => {
  const portManager = makePortManager({ key })

  return {
    ...target,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type !== 'message') return target.addEventListener(type, listener, options)

      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        replaceProxied(portManager, message)
          // @ts-ignore
          .then(proxiedMessage => listener({ data: proxiedMessage }))
      })
      chrome.runtime.onConnect.addListener((port) => {
        if (!port.name.startsWith(`${key}:`)) return
        // @ts-ignore
        portManager.addPort(port.name.split(':')[1]!, port)
      })
    }
  }
}
