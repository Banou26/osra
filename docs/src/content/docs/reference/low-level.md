---
title: Low-level API
description: relay(), the raw message helpers, and the type guards osra uses internally.
---

Everything below `expose()`. You need none of it for normal use, and it is there when you are building something around osra rather than with it.

## relay()

```ts
relay(transportA, transportB, options?)
```

Forwards osra traffic between two channels. Use it when two contexts cannot see each other but both can see you.

```ts twoslash
import { relay } from 'osra'
declare const worker: Worker
declare const iframe: HTMLIFrameElement
// ---cut---
relay(worker, { emit: iframe.contentWindow!, receive: window }, { key: 'app' })
```

Only envelopes matching `key` are forwarded, and nothing is ever revived in the middle, so no value exists in the relay context. The two real ends still handshake directly with each other.

| Option | |
|---|---|
| `key` | Which channel to forward. Defaults to osra's default key. |
| `origin` | Applies to both sides. |
| `originA` / `originB` | Per side, overriding `origin`. |
| `nameA` / `nameB` | Only forward from a peer with this `name`. |
| `unregisterSignal` | Abort to unhook both directions. |

More context in [custom transports](/guides/custom-transports/#bridging-two-transports).

## registerOsraMessageListener()

```ts
registerOsraMessageListener({ listener, transport, key?, remoteName?, origin?, unregisterSignal? })
```

Subscribes to osra messages on a transport and hands them to you raw, still boxed. It knows how to listen on every transport kind, and it filters by key, name and origin the same way `expose()` does.

The reason to reach for it is the second argument your listener gets, which `expose()` does not surface:

| `MessageContext` | |
|---|---|
| `sender` | Web extension sender, when there is one. |
| `port` | The `MessagePort` or extension `Port` it arrived on. |
| `source` | The `MessageEventSource`, for window and worker messages. |
| `origin` | The `event.origin`, for window messages. |
| `receiveTransport` | The transport it came from. |

That makes it the way to check extension senders, since `expose()` has no hook for it:

```ts
import { expose, registerOsraMessageListener } from 'osra'

expose(api, {
  transport: {
    isJson: true,
    emit: message => browser.runtime.sendMessage(message),
    receive: listener =>
      registerOsraMessageListener({
        transport: browser.runtime,
        listener: (message, context) => {
          if (context.sender?.id !== browser.runtime.id) return
          listener(message, context)
        }
      })
  }
})
```

## sendOsraMessage()

```ts
sendOsraMessage(transport, message, origin?, transferables?)
```

The other half. Picks the right send call for the transport: `postMessage` with an origin for windows, `.port` for a `SharedWorker`, `JSON.stringify` with an open-queue for a `WebSocket`, `sendMessage` for the extension runtime.

## getTransferableObjects()

```ts
getTransferableObjects(message): Transferable[]
```

Walks a boxed message and collects what should be moved rather than copied. `sendOsraMessage` calls it for you. It is exported for custom transports that forward the transfer list themselves.

## Type guards

The guards osra uses to recognise transports and values. All of them tolerate a platform where the constructor does not exist.

**Transports:** `isTransport`, `isEmitTransport`, `isReceiveTransport`, `isCustomTransport`, `isCustomEmitTransport`, `isCustomReceiveTransport`, `isJsonOnlyTransport`, plus `assertEmitTransport` and `assertReceiveTransport`.

**Platform objects:** `isWindow`, `isWorker`, `isDedicatedWorker`, `isSharedWorker`, `isServiceWorker`, `isServiceWorkerContainer`, `isWebSocket`.

**Web extension:** `isWebExtensionRuntime`, `isWebExtensionPort`, `isWebExtensionOnConnect`, `isWebExtensionOnMessage`.

**Values:** `isTypedArray`, `isTransferable`, `isSharedArrayBuffer`, `isOsraMessage`, `isRevivableBox`, `instanceOfAny`.

`isWindow` is worth knowing about: it handles cross-origin windows, which throw a `SecurityError` on most property access, by probing only the properties that do not.

## Boxing

`recursiveBox(value, context)` and `recursiveRevive(boxed, context)` are the two halves of the value walker, for [custom revivables](/guides/custom-revivables/) that box their own fields. `BoxBase` is the marker every box spreads.

## Constants

| | |
|---|---|
| `OSRA_KEY` | The envelope field holding the channel key. |
| `OSRA_DEFAULT_KEY` | The default `key`. |
| `OSRA_BOX` | The field marking an object as a box. |

## Types

`Transport`, `PlatformTransport`, `CustomTransport`, `EmitTransport`, `ReceiveTransport`, `Message`, `MessageContext`, `Capable`, `Remote`, `RevivableModule`, `RevivableContext`, `Uuid`.
