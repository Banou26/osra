// both peers live in the same JS context here, so this file runs as-is - the same typings apply
// unchanged over Worker/Window/WebSocket/… transports

import type { Message, MessageContext, Remote, Transport } from 'osra'

import { expose } from 'osra'

// emit/receive can be plain functions on a PLAIN object literal - osra deliberately does not detect
// prototype-based objects (class instances, Node EventEmitters) as custom transports

type Listener = (message: Message, context: MessageContext) => void

const createTransportPair = (): [Transport, Transport] => {
  const aListeners = new Set<Listener>()
  const bListeners = new Set<Listener>()
  const deliver = (listeners: Set<Listener>, message: Message) => {
    const wire = JSON.stringify(message)
    queueMicrotask(() => {
      for (const listener of listeners) listener(JSON.parse(wire) as Message, {})
    })
  }
  return [
    {
      isJson: true,
      emit: (message: Message) => deliver(bListeners, message),
      receive: (listener: Listener) => {
        aListeners.add(listener)
        return () => { aListeners.delete(listener) }
      },
    },
    {
      isJson: true,
      emit: (message: Message) => deliver(aListeners, message),
      receive: (listener: Listener) => {
        bListeners.add(listener)
        return () => { bListeners.delete(listener) }
      },
    },
  ]
}

// class instances do NOT survive the boundary - prototypes aren't preserved

const api = {
  add: (a: number, b: number) => a + b,

  parse: (input: string): { [key: string]: number } => {
    if (!input.trimStart().startsWith('{')) throw new TypeError('expected a JSON object literal')
    return JSON.parse(input)
  },

  longTask: (durationMs: number, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve('finished'), durationMs)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      }, { once: true })
    }),
}

const main = async () => {
  const [hostSide, clientSide] = createTransportPair()

  expose(api, { transport: hostSide })
  const remote: Remote<typeof api> = await expose<typeof api>({}, { transport: clientSide })

  // CAVEAT: with the published package's types alone the Capable check does NOT fire - lib.dom's empty
  // `interface MediaSourceHandle {}` matches every object type; declare
  // `interface MediaSourceHandle { __dummy__: never }` in an ambient .d.ts of your project

  const pending: Promise<number> = remote.add(2, 3)
  console.log(await pending)

  try {
    await remote.parse('not json')
  } catch (error) {
    console.log(error instanceof TypeError)
    console.log((error as TypeError).message)
  }

  const controller = new AbortController()
  const task = remote.longTask(60_000, controller.signal)
  controller.abort(new Error('user cancelled'))
  try {
    await task
  } catch (reason) {
    console.log(reason instanceof Error && reason.message)
  }
}

main().catch(console.error)
