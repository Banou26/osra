---
title: Type guards
description: Runtime guards exported from the package root for classifying transports, platform objects, and osra envelopes.
---

All guards are exported from the package root and narrow their argument's type; the `assert*` variants are throwing assertion forms of the corresponding `is*` guards.

## Transport guards

| Guard | True for |
|---|---|
| `isTransport(v)` | anything usable as the `transport` option |
| `isEmitTransport(v)` / `isReceiveTransport(v)` | transports that can send / receive (note `ServiceWorker` is emit-only, `ServiceWorkerContainer` receive-only) |
| `assertEmitTransport(v)` / `assertReceiveTransport(v)` | throwing assertion forms |

## Custom-transport guards

| Guard | True for |
|---|---|
| `isCustomTransport(v)` / `isCustomEmitTransport(v)` / `isCustomReceiveTransport(v)` | plain-object `{ emit?, receive? }` wrappers (see [custom transports](/guides/custom-transports/)) |

## JSON-only guards

| Guard | True for |
|---|---|
| `isJsonOnlyTransport(v)` / `isEmitJsonOnlyTransport(v)` / `isReceiveJsonOnlyTransport(v)` | JSON-mode transports (WebSocket, WebExtension family, `{ isJson: true }`) |

## Platform-object guards

| Guard | True for |
|---|---|
| `isWindow` / `isWorker` / `isDedicatedWorker` / `isSharedWorker` / `isServiceWorker` / `isServiceWorkerContainer` / `isWebSocket` | the respective platform objects (cross-origin-window safe) |
| `isWebExtensionRuntime` / `isWebExtensionPort` / `isWebExtensionOnConnect` / `isWebExtensionOnMessage` | WebExtension transports |

## Envelope and value guards

| Guard | True for |
|---|---|
| `isOsraMessage(v)` | objects carrying the `__OSRA_KEY__` envelope field (see the [wire protocol](/reference/wire-protocol/)) |
| `isTransferable(v)` / `isTypedArray(v)` / `isSharedArrayBuffer(v)` | value classification helpers |
