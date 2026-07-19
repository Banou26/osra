---
title: "Low-level messaging"
description: "registerOsraMessageListener and sendOsraMessage: send and receive raw osra envelopes under the connection layer."
---

`registerOsraMessageListener` and `sendOsraMessage` are escape hatches under the connection layer: they move raw [wire-protocol](/reference/wire-protocol/) envelopes over any transport without a handshake or connection state. [`relay()`](/reference/relay/) is built on exactly these.

## registerOsraMessageListener

```ts
const registerOsraMessageListener: (options: {
  listener: (message: Message, context: MessageContext) => void
  transport: ReceiveTransport
  remoteName?: string
  key?: string        // default OSRA_DEFAULT_KEY
  origin?: string     // default '*'
  unregisterSignal?: AbortSignal
}) => void
```

Subscribes to raw osra envelopes on any receive transport, and filters them by `key`, `remoteName`, and `origin`. It handles the per-transport quirks for you:

- JSON string parsing on WebSocket
- `.port` indirection on SharedWorker
- `MessagePort.start()`
- the WebExtension listener families

`MessageContext` is `{ port?, sender?, receiveTransport?, source?, origin? }`. Which fields are populated depends on the listener family, so do not assume `port` is always there:

| Receive transport | Populated context |
|---|---|
| WebExtension `onConnect` / `onConnectExternal` | `port` (the connecting port) + `sender` |
| WebExtension `runtime` / structural `onMessage` | `sender` only |
| WebExtension `Port` passed directly | `sender` only (`port` is **not** forwarded) |
| Window, Worker, WebSocket, `MessagePort`, SharedWorker, `ServiceWorkerContainer` | `receiveTransport` + `source` + `origin` from the event |
| Custom `receive` handler | whatever your handler passes through, verbatim |

:::caution
osra does no WebExtension sender validation: consumers using `onConnectExternal`/`onMessageExternal` must validate `context.sender` themselves. See [security](/guides/security/).
:::

## sendOsraMessage

```ts
const sendOsraMessage: (
  transport: EmitTransport,
  message: Message,
  origin?: string,            // default '*', Window targetOrigin
  transferables?: Transferable[],
) => void
```

Sends a raw envelope on any emit transport. It JSON-stringifies for WebSocket and queues while the socket is `CONNECTING`, and routes via `.port` for SharedWorker.

## See also

- [Wire protocol](/reference/wire-protocol/): the envelope format these functions carry
- [Custom transports](/guides/custom-transports/): wrapping your own channel in `{ emit, receive }` instead of dropping below the connection layer
