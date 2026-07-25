---
title: Transports
description: Every channel osra runs over, from workers and iframes to WebSockets and web extensions.
---

A transport is the channel `expose()` talks over. You hand osra a platform object and it figures out how to send and listen on it.

Whatever you pass has to be able to both send and receive. When one object can only do half of it (a `ServiceWorker` can only send, `navigator.serviceWorker` can only listen) you pair two of them yourself: `{ emit, receive }`.

| Transport | Mode | Notes |
|---|---|---|
| [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) | clone | Page side. |
| Worker global scope | clone | Pass `globalThis` inside the worker. |
| [`Window`](https://developer.mozilla.org/en-US/docs/Web/API/Window) | clone | Pair the other window with your own, see below. |
| [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) | clone | osra calls `.start()` for you. |
| [`SharedWorker`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker) | clone | Page side. Rides its `.port` internally. |
| [`ServiceWorker`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker) | clone | Send only, pair it with `navigator.serviceWorker`. |
| [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) | JSON | Sends before `open` are queued. |
| WebExtension `runtime` and `Port` | JSON | `onConnect` and `onMessage` are receive only. |
| `{ emit, receive }` | either | Your own channel, see [custom transports](/guides/custom-transports/). |

## Worker

Pass the `Worker` on the page side, `globalThis` inside the worker.

```ts twoslash title="worker.ts"
import { expose } from 'osra'

const api = { add: (a: number, b: number) => a + b }
export type Api = typeof api

expose(api, { transport: globalThis })
```

```ts twoslash title="main.ts"
// @filename: worker.ts
import { expose } from 'osra'
const api = { add: (a: number, b: number) => a + b }
export type Api = typeof api
expose(api, { transport: globalThis })
// @filename: main.ts
// ---cut---
import type { Api } from './worker'
import { expose } from 'osra'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const { add } = await expose<Api>({}, { transport: worker })

await add(1, 2) // 3
```

`globalThis` typechecks as a transport even in worker code compiled with the DOM lib, so you never need a cast.

## Window and iframe

A `message` event fires on the window that *receives* it, not on the one you posted to. So each side pairs the other window to send with its own window to listen.

Set `origin` whenever the two documents are on different origins. It becomes the [`targetOrigin`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#targetorigin) on the way out, and drops incoming messages from any other origin on the way in.

```ts title="parent.ts"
import { expose } from 'osra'
import type { IframeApi } from './iframe'

const iframe = document.querySelector('iframe')!
const parentApi = { getConfig: () => ({ locale: 'en' }) }
export type ParentApi = typeof parentApi

const { render } = await expose<IframeApi>(parentApi, {
  transport: { emit: iframe.contentWindow!, receive: window },
  origin: 'https://app.example.com'
})
```

```ts title="iframe.ts"
import { expose } from 'osra'
import type { ParentApi } from './parent'

const iframeApi = {
  render: (theme: 'light' | 'dark') => { document.documentElement.dataset.theme = theme }
}
export type IframeApi = typeof iframeApi

const { getConfig } = await expose<ParentApi>(iframeApi, {
  transport: { emit: window.parent, receive: window },
  origin: 'https://host.example.com'
})
```

There is one exception to the strict origin. While the two sides are still looking for each other, osra broadcasts a small announce message with `'*'`. A freshly created iframe still holds its initial `about:blank` document, and the browser would silently drop a strictly targeted message to it. That announce carries nothing but the channel's key, name and uuid. Everything with data in it goes out with your `origin`, and incoming filtering always applies.

## MessagePort

Both ends of a [`MessageChannel`](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) work as transports, which is handy for connecting two contexts that have no direct reference to each other.

```ts twoslash
import { expose } from 'osra'

const api = { ping: () => 'pong' }
// ---cut---
const { port1, port2 } = new MessageChannel()

expose(api, { transport: port1 })
const remote = await expose<typeof api>({}, { transport: port2 })
```

## SharedWorker

Pass the `SharedWorker` itself on the page side. Inside the worker, every page shows up as a port, so expose once per port.

```ts title="page.ts"
import { expose } from 'osra'
import type { Api } from './shared'

const sharedWorker = new SharedWorker(new URL('./shared.ts', import.meta.url), { type: 'module' })
const { add } = await expose<Api>({}, { transport: sharedWorker })
```

```ts title="shared.ts"
import { expose } from 'osra'

const api = { add: (a: number, b: number) => a + b }
export type Api = typeof api

globalThis.addEventListener('connect', event => {
  for (const port of (event as MessageEvent).ports) {
    expose(api, { transport: port })
  }
})
```

One connection per port keeps the pages independent. See [multiple peers](/guides/multiple-peers/) for the alternative and why this one is usually what you want.

## Service worker

The `ServiceWorker` object can post but not listen, and `navigator.serviceWorker` can listen but not post. Pair them.

```ts title="page.ts"
import { expose } from 'osra'
import type { SwApi } from './service-worker'

const pageApi = { reload: () => location.reload() }
const registration = await navigator.serviceWorker.ready

const { getCachedUrls } = await expose<SwApi>(pageApi, {
  transport: { emit: registration.active!, receive: navigator.serviceWorker }
})
```

## WebSocket

JSON mode. You can call `expose()` on a socket that is still connecting, outgoing messages wait for `open` and then flush.

The other end can be anything that runs osra and relays frames back, a Node server for example.

```ts
import { expose } from 'osra'
import type { ServerApi } from './server'

const clientApi = { onUpdate: (payload: string) => { console.log(payload) } }

const socket = new WebSocket('wss://relay.example.com')
const { subscribe } = await expose<ServerApi>(clientApi, { transport: socket })
```

## Web extension

JSON mode. A [`runtime.Port`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/Port) works on its own, and so does the runtime itself through `sendMessage` and `onMessage`.

```ts title="content.ts"
import { expose } from 'osra'
import type { BackgroundApi } from './background'

const contentApi = { getSelection: () => document.getSelection()?.toString() ?? '' }

const port = browser.runtime.connect()
const { fetchData } = await expose<BackgroundApi>(contentApi, { transport: port })
```

```ts title="background.ts"
import { expose } from 'osra'

const backgroundApi = { fetchData: async (url: string) => (await fetch(url)).text() }
export type BackgroundApi = typeof backgroundApi

browser.runtime.onConnect.addListener(port => {
  expose(backgroundApi, { transport: port })
})
```

`onConnect` and `onMessage` only receive, so they can be the `receive` half of a pair but never a transport on their own.

If you handle `onConnectExternal` or `onMessageExternal`, check the sender yourself in a custom `receive` wrapper before handing the message to osra. `expose()` does not surface the per-message sender, only [`registerOsraMessageListener`](/reference/low-level/) does.

## Anything else

Any plain object with `emit` and `receive` is a transport. That covers `BroadcastChannel`, a Node `worker_threads` port, a native bridge, or a protocol you made up. See [custom transports](/guides/custom-transports/).
