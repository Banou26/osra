---
title: Type guards
description: Runtime guards exported from the package root for classifying transports, platform objects, and osra envelopes.
---

All guards are exported from the package root and narrow their argument's type; the `assert*` variants are throwing assertion forms of the corresponding `is*` guards.

## Transport guards

| Guard | True for |
|---|---|
| `isTransport(v)` | any recognized transport shape: emit-capable, receive-capable, a custom `{ emit / receive }` wrapper, or a JSON-only transport |
| `isEmitTransport(v)` / `isReceiveTransport(v)` | transports that can send / receive (note `ServiceWorker` is emit-only, `ServiceWorkerContainer` receive-only) |
| `assertEmitTransport(v)` / `assertReceiveTransport(v)` | throwing assertion forms |

Note that `expose()` additionally requires the transport to be both emit- and receive-capable, which `isTransport` alone does not guarantee: a bare `ServiceWorker`, `navigator.serviceWorker`, or an `{ emit }`-only wrapper passes `isTransport` but is rejected by `expose()`.

## Custom-transport guards

| Guard | True for |
|---|---|
| `isCustomTransport(v)` / `isCustomEmitTransport(v)` / `isCustomReceiveTransport(v)` | plain-object `{ emit?, receive? }` wrappers (see [custom transports](/guides/custom-transports/)) |

## JSON-only guards

| Guard | True for |
|---|---|
| `isJsonOnlyTransport(v)` | `WebSocket`, WebExtension transports, or a non-window object marked `isJson: true`; an explicit `isJson: false` on a custom wrapper makes it false |
| `isEmitJsonOnlyTransport(v)` | `WebSocket`, WebExtension `Port`, or `runtime` (the `isJson` marker is not consulted) |
| `isReceiveJsonOnlyTransport(v)` | those plus `onConnect` / `onConnectExternal` / `onMessage` |

## Platform-object guards

| Guard | True for |
|---|---|
| `isWindow` / `isWorker` / `isDedicatedWorker` / `isSharedWorker` / `isServiceWorker` / `isServiceWorkerContainer` / `isWebSocket` | the respective platform objects (cross-origin-window safe) |
| `isWebExtensionRuntime` / `isWebExtensionPort` / `isWebExtensionOnConnect` / `isWebExtensionOnMessage` | WebExtension transports |

`isWorker` matches `Worker` instances; `isDedicatedWorker` matches a dedicated worker's own global scope (`self` inside the worker, a `DedicatedWorkerGlobalScope`), not a `Worker` instance.

The WebExtension guards detect in two different ways. `isWebExtensionRuntime` and `isWebExtensionOnConnect` compare by identity against the live `browser`/`chrome` global (`browser` preferred when both exist), so runtime-shaped objects from another realm, polyfills, or test mocks are not detected. `isWebExtensionPort` and `isWebExtensionOnMessage` are structural: any non-window object with the expected method names passes, and consequently classifies as a JSON-only transport.

## Envelope and value guards

| Guard | True for |
|---|---|
| `isOsraMessage(v)` | objects carrying the `__OSRA_KEY__` envelope field (see the [wire protocol](/reference/wire-protocol/)) |
| `isTransferable(v)` / `isTypedArray(v)` / `isSharedArrayBuffer(v)` | value classification helpers |
| `isClonable(v)` | deprecated alias of `isSharedArrayBuffer`; despite the name, it is unrelated to the clonable pass-through value set |
