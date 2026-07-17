---
title: Security and trust
description: What origin and key do and do not protect against, and how to reason about untrusted peers sharing your channel.
---

osra treats peers as semi-trusted: malformed payloads are handled cleanly, `origin` filters window messages in both directions, but nothing on the wire is authentication. This page spells out exactly which guarantees each option gives you — and which it does not.

## `origin`: inbound and outbound

On window transports, `origin` (default `'*'`) does two things: it is the `postMessage` `targetOrigin` for outbound envelopes, **and** inbound messages whose `event.origin` doesn't match are dropped:

```ts twoslash
import { expose } from 'osra'
const hostApi = { getUser: async () => ({ name: 'Ada' }) }
const widgetApi = { notify: async (text: string) => text }
declare const iframe: HTMLIFrameElement & { readonly contentWindow: Window }
// ---cut---
// host page
const channel = await expose(hostApi, {
  transport: { emit: iframe.contentWindow, receive: window },
  origin: 'https://widget.example',
})

// inside the iframe
const host = await expose(widgetApi, {
  transport: { emit: window.parent, receive: window },
  origin: 'https://host.example',
})
```

Always set `origin` for cross-origin window messaging. Two caveats:

- Events without an origin (worker messages, custom transports) bypass the check — it is only meaningful where the platform stamps `event.origin`. Non-window transports (Worker, MessagePort, WebSocket, ServiceWorkerContainer, WebExtension, custom) are not origin-filtered; WebSocket/ServiceWorker events carry their own unrelated origins, so filtering there would be a footgun.
- The filter is not applied to [custom *function* receives](/guides/custom-transports/), which only get key/name filtering.

## The announce beacon exception

One outbound exception: the unsolicited announce beacon is posted with `targetOrigin` `'*'` regardless of the configured `origin`. Until a freshly created cross-origin iframe commits its document, its window still holds the initial `about:blank` (which inherits the embedder's origin), so a strict `targetOrigin` would be dropped by the browser with a mismatch error on every retry.

This is safe because:

- the beacon carries only channel identifiers (`key`, `name`, `uuid`) — no data,
- whatever answers it must still pass the inbound origin filter,
- every other envelope (announce replies, `init`, messages, `close`) is only sent after the peer's own message proved its committed origin, and keeps the strict `targetOrigin`.

Consequence: a wrong-origin embedder can observe the beacon's identifiers, but cannot complete a [handshake](/internals/handshake/) or receive any data.

## `key` is namespacing, not authentication

:::caution
`key` is an equality check on a plaintext envelope field. It lets multiple independent osra connections share one transport without cross-talk; any party that can post to the channel can read or claim it. Do not treat it as a secret or an access control.
:::

## WebExtension senders

`runtime.onMessage` / `onConnect` listeners receive untrusted input when paired with `onMessageExternal` / `onConnectExternal`. osra does no sender validation; the `MessageContext` passed to custom receive listeners exposes `sender`, and you must check `sender.id` / `sender.url` yourself before letting messages reach an exposed value. See [low-level messaging](/reference/low-level/) for the `MessageContext` shape.

## What a malicious same-channel peer can still do

Be honest about the model: a peer that can post on your transport is **semi-trusted**. It can:

- complete the handshake first ([first wins](/guides/multi-peer/)),
- spoof envelope `uuid`s to address your connections — including sending `{ type: 'close' }` to tear down another peer's connection,
- feed malformed boxes (which reject your handshake),
- call anything you exposed,
- flood you with announces or port traffic.

DoS-hardening is not complete. Don't expose privileged functions on channels where untrusted code can post; on windows, pin `origin`; in extensions, validate senders.
