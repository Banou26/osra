// Typed RPC with osra - Remote<T>, the Capable compile-time check,
// AbortSignal cancellation, error subclass round-trips, and a custom
// { emit, receive } transport.
//
// Both peers live in the same JS context here, connected through a custom
// in-memory transport pair, so this file runs as-is - no worker needed.
// The same typings apply unchanged over Worker/Window/WebSocket/… transports.

import type { Message, MessageContext, Remote, Transport } from 'osra'

import { expose } from 'osra'

// --- Custom transport --------------------------------------------------------
// emit/receive can be plain functions on a PLAIN object literal - osra
// deliberately does not detect prototype-based objects (class instances,
// Node EventEmitters) as custom transports. `isJson: true` declares that the
// wire only carries JSON: binary payloads are base64-encoded, ports become
// synthetic, and transfer() degrades to a copy. `receive` may return an
// unsubscribe function - osra calls it when the `unregisterSignal` option
// aborts.

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

// --- API -----------------------------------------------------------------------
// Plain objects and arrow functions only. Class instances do NOT survive the
// boundary - prototypes aren't preserved, so an instance's methods would be
// lost. Expose plain data and functions instead.

const api = {
  // Sync here, async over there: every call crosses the wire, so the remote
  // sees (a: number, b: number) => Promise<number>.
  add: (a: number, b: number) => a + b,

  parse: (input: string): { [key: string]: number } => {
    if (!input.trimStart().startsWith('{')) throw new TypeError('expected a JSON object literal')
    return JSON.parse(input)
  },

  // The AbortSignal argument revives as a live signal - aborting on the
  // caller side fires this listener, reason included.
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

  // Both peers call expose(). Each hands over its own value and receives the
  // peer's; the client shares nothing, so it passes {}.
  expose(api, { transport: hostSide })
  const remote: Remote<typeof api> = await expose<typeof api>({}, { transport: clientSide })

  // The Capable check rejects non-serializable values at the expose() call
  // site, at compile time, pinpointing the offending path. Uncommenting:
  //
  //   expose({ ...api, cache: new WeakMap<object, string>() }, { transport: hostSide })
  //
  // produces (abridged):
  //
  //   error TS2345: Argument of type '{ add: ...; parse: ...; longTask: ...; cache: WeakMap<object, string>; }'
  //   is not assignable to parameter of type '... & {
  //     [ErrorMessage]: "Value type must resolve to a Capable";
  //     [BadValue]: WeakMap<object, string>;
  //     [Path]: "cache";
  //     [ParentObject]: { add: ...; parse: ...; longTask: ...; cache: WeakMap<object, string>; };
  //   }'
  //
  // CAVEAT: with the published package's types alone this error does NOT fire.
  // lib.dom declares `interface MediaSourceHandle {}` empty, it is a member of
  // the `Transferable` union Capable accepts, and an empty interface matches
  // every object type - so the check collapses to accepting anything. Restore
  // it by declaring this one-line shim in an ambient .d.ts of your project
  // (it's what this repo does internally in src/global-types.d.ts):
  //
  //   interface MediaSourceHandle { __dummy__: never }

  // Remote<T> in action: add returns number on the host, Promise<number> here.
  const pending: Promise<number> = remote.add(2, 3)
  console.log(await pending) // 5

  // Error subclasses round-trip - a thrown TypeError is still a TypeError.
  try {
    await remote.parse('not json')
  } catch (error) {
    console.log(error instanceof TypeError) // true
    console.log((error as TypeError).message) // 'expected a JSON object literal'
  }

  // Cancellation across the boundary: abort locally, the host's signal fires
  // with the same reason, and its rejection travels back.
  const controller = new AbortController()
  const task = remote.longTask(60_000, controller.signal)
  controller.abort(new Error('user cancelled'))
  try {
    await task
  } catch (reason) {
    console.log(reason instanceof Error && reason.message) // 'user cancelled'
  }
}

main().catch(console.error)
