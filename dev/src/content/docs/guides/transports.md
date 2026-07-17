---
title: Transports
description: The built-in channels osra connects over — Workers, windows and iframes, SharedWorkers, WebSockets, service workers, and web extension messaging.
---

A transport is the channel `expose()` talks over. osra accepts the platform objects below directly; anything else can be wrapped in a plain `{ emit, receive }` pair.

Transports are either **structured-clone** (Worker, Window, MessagePort, SharedWorker) or **JSON** (WebSocket, web extension messaging, custom transports with `isJson: true`). JSON mode forces JSON-safe boxing: values that depend on structured clone (`RegExp`, `SharedArrayBuffer`, `ImageBitmap`, …) are rejected at the type level, while everything with a dedicated revivable module (`Date`, `Map`, `ArrayBuffer` via base64, functions, streams, …) still works. osra only stringifies envelopes itself on WebSocket; custom function emitters handle their own serialization. See [JSON vs clone](/internals/json-vs-clone/) for exactly what degrades, and [supported types](/guides/supported-types/) for the full matrix.

## Overview

| Transport | Mode | Notes |
|---|---|---|
| `Window` | clone | `origin` applies (inbound filter + outbound `targetOrigin`). |
| `Worker` | clone | |
| `DedicatedWorkerGlobalScope` | clone | Pass `globalThis` (or `self`) inside the worker. |
| `SharedWorker` | clone | Page side. Messages ride `.port` (handled internally). |
| `MessagePort` | clone | `.start()` is called internally on receive. |
| `WebSocket` | JSON | Envelopes are `JSON.stringify`ed; sends while `CONNECTING` queue until `open`. |
| `ServiceWorker` | clone | **Emit only.** |
| `ServiceWorkerContainer` | clone | **Receive only.** Combine: `{ emit: registration.active, receive: navigator.serviceWorker }`. |
| WebExtension `runtime` / `Port` / `onConnect` / `onMessage` | JSON | `runtime`/`onConnect` are identity-matched against the `browser`/`chrome` global; `Port`/`onMessage` are detected purely structurally and work without the global (lookalike objects can misclassify as these). |
| Custom `{ emit?, receive?, isJson? }` | per `isJson` / probed | See [Custom transports](/guides/custom-transports/). |

## Worker

Pass the `Worker` on the page side and `globalThis` (the `DedicatedWorkerGlobalScope`) inside the worker — the worker scope isn't part of the `Transport` type union, so cast it:

```ts twoslash
import type { Transport } from 'osra'
import { expose } from 'osra'
const api = { add: async (a: number, b: number) => a + b }
// ---cut---
// worker.ts
expose(api, { transport: globalThis as unknown as Transport })
```

```ts twoslash
// @filename: worker.ts
import type { Transport } from 'osra'
import { expose } from 'osra'
const api = { add: async (a: number, b: number) => a + b }
export type Api = typeof api
expose(api, { transport: globalThis as unknown as Transport })
// @filename: main.ts
import type { Api } from './worker'
import { expose } from 'osra'
// ---cut---
// main.ts
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const remote = await expose<Api>({}, { transport: worker })
```

The full worker walkthrough lives in [getting started](/start/getting-started/).

## Window ↔ iframe

`message` events fire on the window that receives them, so each side pairs the *other* window for emit with its *own* window for receive. `origin` is applied in both directions: outbound it is the `postMessage` `targetOrigin`, inbound it drops events whose `event.origin` differs. Set it whenever you talk across origins — see [security](/guides/security/) for the trust model and the one announce-beacon exception.

```ts twoslash
import { expose } from 'osra'

type IframeApi = {
  render: (theme: 'light' | 'dark') => Promise<void>
}

const parentApi = {
  getConfig: async () => ({ locale: 'en' }),
}
// ---cut---
// parent
const iframe = document.querySelector('iframe')!
const remote = await expose<IframeApi>(parentApi, {
  transport: { emit: iframe.contentWindow!, receive: window },
  origin: 'https://app.example.com',
})
```

```ts twoslash
import { expose } from 'osra'

type ParentApi = {
  getConfig: () => Promise<{ locale: string }>
}

const iframeApi = {
  render: async (theme: 'light' | 'dark') => { document.documentElement.dataset.theme = theme },
}
// ---cut---
// iframe
const remote = await expose<ParentApi>(iframeApi, {
  transport: { emit: window.parent, receive: window },
  origin: 'https://host.example.com',
})
```

## SharedWorker

Pass the `SharedWorker` instance directly on the page side; osra rides its `.port` internally. Inside the worker, expose per connected port:

```ts twoslash
import { expose } from 'osra'

type Api = {
  add: (a: number, b: number) => Promise<number>
}
// ---cut---
// page
const sharedWorker = new SharedWorker(new URL('./shared.ts', import.meta.url), { type: 'module' })
const remote = await expose<Api>({}, { transport: sharedWorker })
```

```ts twoslash
// shared.ts
import { expose } from 'osra'

const api = { add: async (a: number, b: number) => a + b }

globalThis.addEventListener('connect', event => {
  for (const port of (event as MessageEvent).ports) expose(api, { transport: port })
})
```

Per-port `expose()` gives each connecting page its own connection; [multi-peer connections](/guides/multi-peer/) explains why this is the recommended pattern.

## WebSocket

JSON mode. You can `expose()` while the socket is still `CONNECTING`; outbound envelopes queue until open. The other end is anything that relays frames to a peer also running osra:

```ts twoslash
import { expose } from 'osra'

type PeerApi = {
  broadcast: (text: string) => Promise<void>
}

const localApi = {
  notify: async (text: string) => { console.log(text) },
}
// ---cut---
const socket = new WebSocket('wss://relay.example.com')
const remote = await expose<PeerApi>(localApi, { transport: socket })
```

## Service worker

A `ServiceWorker` can only emit and a `ServiceWorkerContainer` can only receive, so combine them as a custom pair:

```ts twoslash
import { expose } from 'osra'

type SwApi = {
  getCachedUrls: () => Promise<string[]>
}

const pageApi = {
  reload: async () => { location.reload() },
}
// ---cut---
const registration = await navigator.serviceWorker.ready
const remote = await expose<SwApi>(pageApi, {
  transport: { emit: registration.active!, receive: navigator.serviceWorker },
})
```

## Web extension

JSON mode. `runtime.Port`, the runtime itself (`sendMessage`/`onMessage`), `onConnect`, and `onMessage` are all accepted:

```ts twoslash
import { expose } from 'osra'
import type { Browser } from 'webextension-polyfill'

declare const browser: Browser

type BackgroundApi = {
  fetchData: (url: string) => Promise<string>
}

const contentApi = {
  getSelection: async () => document.getSelection()?.toString() ?? '',
}
// ---cut---
// content script
const port = browser.runtime.connect()
const background = await expose<BackgroundApi>(contentApi, { transport: port })
```

```ts twoslash
import { expose } from 'osra'
import type { Browser } from 'webextension-polyfill'

declare const browser: Browser

const backgroundApi = {
  fetchData: async (url: string) => (await fetch(url)).text(),
}
// ---cut---
// background
browser.runtime.onConnect.addListener(port => {
  expose(backgroundApi, { transport: port })
})
```

:::caution
If you accept `onConnectExternal`/`onMessageExternal`, validate senders yourself; osra does no sender validation. The `MessageContext` passed to custom receive listeners exposes `sender`. See [security](/guides/security/).
:::

## Anything else

Any plain object with `emit` and `receive` works as a transport — a `BroadcastChannel`, a native bridge, a text protocol of your own. See [custom transports](/guides/custom-transports/).
