---
title: Custom transports
description: Wrap any message channel in a plain { emit, receive } object to use it as an osra transport.
---

When none of the [built-in transports](/guides/transports/) matches your channel, wrap it in a plain object with `emit` and `receive`. Anything that can move a message between two contexts — a `BroadcastChannel`, a text socket, a native bridge — becomes an osra transport.

## The transport shape

A custom transport is a plain object with `emit` and/or `receive`, plus an optional `isJson` flag. Each of `emit` and `receive` may be a platform transport (a `Worker`, a `WebSocket`, a window, …) or a function:

```ts
type EmitHandler = (message: Message, transferables?: Transferable[]) => void

type ReceiveHandler = (
  listener: (message: Message, context: MessageContext) => void
) => void | (() => void)
```

- An `emit` function is called with the ready-to-send envelope and the collected transfer list. Serialization is yours; osra does not stringify for function emitters.
- A `receive` function is called once with osra's listener; invoke it with parsed envelope objects. Key and `remoteName` filtering are applied for you. Optionally return an unsubscribe function; it runs when `unregisterSignal` aborts.

A transport that can't both emit and receive rejects `expose()` immediately: a bare `{ emit }` or `{ receive }` alone is a configuration error.

## Plain objects only

Custom transports must be plain objects — prototype exactly `Object.prototype`, or a `null` prototype. This is deliberate: prototype-based objects like Node `EventEmitter`s have inherited `emit` members and are intentionally not detected as custom transports, so passing one never silently misclassifies.

## `isJson` and auto-probing

`isJson: true` forces JSON-safe boxing: base64 buffers, synthetic ports, no transfer. Set it whenever the channel can't carry transferables.

Without it, JSON mode is auto-detected from the embedded platform transports — `{ emit: webSocket }` is JSON-only even though the wrapper isn't. See [JSON vs clone](/internals/json-vs-clone/) for what degrades in JSON mode.

## `MessageContext`

The second argument to osra's receive listener carries whatever the channel knows: `{ port?, sender?, receiveTransport?, source?, origin? }` — `origin` and `source` from window events, `sender` and `port` from WebExtension messaging, and `receiveTransport`.

:::note
The `origin` option is not applied to custom *function* receives, which only get key/name filtering. If your channel has a notion of sender identity, validate it yourself before passing messages through — see [security](/guides/security/).
:::

## Example: BroadcastChannel

`BroadcastChannel` can't carry transferables, so mark the transport `isJson: true`:

```ts
const channel = new BroadcastChannel('app')

const remote = await expose<PeerApi>(localApi, {
  transport: {
    isJson: true,
    emit: message => channel.postMessage(message),
    receive: listener => {
      const handler = (event: MessageEvent) => listener(event.data, {})
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
  },
})
```

## Example: JSON over a MessagePort

A function transport owns its own serialization — here, stringifying every envelope across a `MessagePort`:

```ts
const makeJsonTransport = (port: MessagePort) => ({
  isJson: true as const,
  emit: (message: Message) => port.postMessage(JSON.stringify(message)),
  receive: (listener: (message: Message, ctx: MessageContext) => void) => {
    port.start()
    port.addEventListener('message', event =>
      listener(JSON.parse(event.data as string) as Message, {}),
    )
  },
})
```

## Mixed platform pairs

`emit` and `receive` don't have to be functions; you can compose two platform halves. The canonical case is a page talking to its service worker — a `ServiceWorker` can only emit and a `ServiceWorkerContainer` can only receive:

```ts
const registration = await navigator.serviceWorker.ready
const remote = await expose(value, {
  transport: { emit: registration.active!, receive: navigator.serviceWorker },
})
```

(`registration.active` is typed `ServiceWorker | null`, hence the assertion; after `navigator.serviceWorker.ready` it is non-null.)

## Related

To forward osra envelopes between two transports without terminating a connection of your own, use [relay()](/reference/relay/). The primitives underneath every transport — `sendOsraMessage` and `registerOsraMessageListener` — are covered in [low-level messaging](/reference/low-level/).
