import type {
  EmitTransport, Message,
  MessageContext, MessageVariant,
  Capable, Transport,
  MessageEventTarget,
  MessageEventMap
} from './types'
import type {
  PlatformCapabilities, ConnectionContext,
  BidirectionalConnectionContext
} from './utils'

import { OSRA_DEFAULT_KEY, OSRA_KEY } from './types'
import {
  probePlatformCapabilities,
  registerOsraMessageListener,
  sendOsraMessage,
  startBidirectionalConnection,
  isReceiveTransport,
  isEmitTransport,
  startUnidirectionalEmittingConnection,
  getTransferableObjects,
  isJsonOnlyTransport,
  isCustomTransport
} from './utils'
import { TypedEventTarget } from 'typescript-event-target'

/**
 * Logger interface for debugging Osra connections.
 * Provides optional methods to log different levels of messages.
 */
export interface OsraLogger {
  /** Log debug-level messages */
  debug?: (...args: unknown[]) => void
  /** Log info-level messages */
  info?: (...args: unknown[]) => void
  /** Log warning-level messages */
  warn?: (...args: unknown[]) => void
  /** Log error-level messages */
  error?: (...args: unknown[]) => void
}

/**
 * Error thrown when a connection times out.
 */
export class OsraTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Osra connection timed out after ${timeoutMs}ms. Ensure the remote endpoint is running and accessible.`)
    this.name = 'OsraTimeoutError'
  }
}

/**
 * Error thrown when a connection is aborted.
 */
export class OsraAbortError extends Error {
  constructor() {
    super('Osra connection was aborted by the unregisterSignal.')
    this.name = 'OsraAbortError'
  }
}

/**
 * Options for the expose function.
 */
export interface ExposeOptions {
  /**
   * The transport to use for communication.
   * Can be a Window, Worker, MessagePort, WebSocket, or custom transport.
   */
  transport: Transport
  /**
   * Optional name to identify this endpoint.
   * Used for filtering messages when multiple connections share the same transport.
   */
  name?: string
  /**
   * Optional name of the remote endpoint to connect to.
   * If specified, only messages from endpoints with this name will be processed.
   */
  remoteName?: string
  /**
   * Custom key for message identification.
   * Useful when running multiple Osra instances on the same transport.
   * @default '__OSRA_DEFAULT_KEY__'
   */
  key?: string
  /**
   * Target origin for postMessage calls (Window transport only).
   * @default '*'
   */
  origin?: string
  /**
   * AbortSignal to unregister the message listener.
   * When aborted, stops listening for messages on the transport.
   */
  unregisterSignal?: AbortSignal
  /**
   * Pre-computed platform capabilities.
   * If not provided, capabilities will be probed automatically.
   */
  platformCapabilities?: PlatformCapabilities
  /**
   * If true, transfers all transferable objects instead of cloning them.
   * @default false
   */
  transferAll?: boolean
  /**
   * Optional logger for debugging purposes.
   */
  logger?: OsraLogger
  /**
   * Connection timeout in milliseconds.
   * If set, the connection will be rejected if the remote endpoint
   * doesn't respond within this time.
   * @default undefined (no timeout)
   */
  timeout?: number
}

/**
 * Exposes a value over a transport and establishes a connection with a remote endpoint.
 *
 * This function supports multiple protocol modes:
 * - **Bidirectional mode**: Both endpoints can expose values and call each other's methods.
 * - **Unidirectional mode**: One endpoint exposes values, the other only calls methods.
 *
 * And multiple transport modes:
 * - **Capable mode**: Uses structured clone and MessagePort transfers for full type support.
 * - **JSON mode**: Falls back to JSON serialization with revivable boxing for complex types.
 *
 * @typeParam T - The expected type of the remote value.
 * @param value - The value to expose to the remote endpoint.
 * @param options - Configuration options for the connection.
 * @returns A promise that resolves to the remote endpoint's exposed value.
 *
 * @example
 * ```typescript
 * // Worker side
 * const api = {
 *   add: async (a: number, b: number) => a + b,
 *   greet: async (name: string) => `Hello, ${name}!`
 * }
 * expose(api, { transport: self })
 *
 * // Main thread side
 * const worker = new Worker('./worker.js')
 * const remoteApi = await expose<typeof api>({}, { transport: worker })
 * const result = await remoteApi.add(1, 2) // 3
 * ```
 */
export const expose = async <T extends Capable>(
  value: Capable,
  {
    transport: _transport,
    name,
    remoteName,
    key = OSRA_DEFAULT_KEY,
    origin = '*',
    unregisterSignal,
    platformCapabilities: _platformCapabilities,
    transferAll,
    logger,
    timeout
  }: ExposeOptions
): Promise<T> => {
  const transport = {
    isJson:
      'isJson' in _transport && _transport.isJson !== undefined
        ? _transport.isJson
        : isJsonOnlyTransport(_transport),
    ...(
      isCustomTransport(_transport)
        ? _transport
        : {
          emit: _transport,
          receive: _transport
        }
    )
  } satisfies Transport
  const platformCapabilities = _platformCapabilities ?? await probePlatformCapabilities()
  const connectionContexts = new Map<string, ConnectionContext>()

  let resolveRemoteValue: (connection: T) => void
  let rejectRemoteValue: (error: Error) => void
  const remoteValuePromise = new Promise<T>((resolve, reject) => {
    resolveRemoteValue = resolve
    rejectRemoteValue = reject
  })

  // Set up timeout handling
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (timeout !== undefined && timeout > 0) {
    timeoutId = setTimeout(() => {
      rejectRemoteValue(new OsraTimeoutError(timeout))
    }, timeout)
  }

  // Set up abort handling
  if (unregisterSignal) {
    unregisterSignal.addEventListener('abort', () => {
      if (timeoutId) clearTimeout(timeoutId)
      rejectRemoteValue(new OsraAbortError())
    }, { once: true })
  }

  let uuid = globalThis.crypto.randomUUID()

  const sendMessage = (transport: EmitTransport, message: MessageVariant) => {
    const transferables = getTransferableObjects(message)
    sendOsraMessage(
      transport,
      {
        [OSRA_KEY]: key,
        name,
        uuid,
        ...message
      },
      origin,
      transferables
    )
  }

  const listener = async (message: Message, messageContext: MessageContext) => {
    // means that our own message looped back on the channel
    if (message.uuid === uuid) return
    // Unidirectional receiving mode
    if (!isEmitTransport(transport)) {
      // Handle non bidirectional based messages here
      throw new Error('Unidirectional receiving mode not implemented')
    }
    // Bidirectional mode
    if (message.type === 'announce') {
      if (!message.remoteUuid) {
        sendMessage(transport, { type: 'announce', remoteUuid: message.uuid })
        return
      }
      if (message.remoteUuid !== uuid) return
      if (connectionContexts.has(message.uuid)) {
        sendMessage(
          transport,
          { type: 'reject-uuid-taken', remoteUuid: message.uuid }
        )
        return
      }
      const eventTarget = new TypedEventTarget<MessageEventMap>()
      const connectionContext = {
        type: 'bidirectional',
        eventTarget,
        connection:
          startBidirectionalConnection({
            transport,
            value,
            uuid,
            remoteUuid: message.uuid,
            platformCapabilities,
            eventTarget,
            send: (message: MessageVariant) => sendMessage(transport, message),
            close: () => void connectionContexts.delete(message.uuid)
          })
      } satisfies BidirectionalConnectionContext
      connectionContexts.set(message.uuid, connectionContext)
      connectionContext.connection.remoteValue.then((remoteValue) => {
        if (timeoutId) clearTimeout(timeoutId)
        resolveRemoteValue(remoteValue as T)
      })
    } else if (message.type === 'reject-uuid-taken') {
      if (message.remoteUuid !== uuid) return
      uuid = globalThis.crypto.randomUUID()
      sendMessage(transport, { type: 'announce' })
    } else if (message.type === 'close') {
      if (message.remoteUuid !== uuid) return
      const connectionContext = connectionContexts.get(message.uuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connectionContext) {
        console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      connectionContext.connection.close()
      connectionContexts.delete(message.uuid)
    } else { //  "init" | "message" | "message-port-close"
      if (message.remoteUuid !== uuid) return
      const connection = connectionContexts.get(message.uuid)
      // We just drop the message if the remote uuid hasn't announced itself
      if (!connection) {
        console.warn(`Connection not found for remoteUuid: ${message.uuid}`)
        return
      }
      if (connection.type !== 'unidirectional-emitting') {
        connection.eventTarget.dispatchTypedEvent(
          'message',
          new CustomEvent('message', { detail: message })
        )
      }
    }
  }

  if (isReceiveTransport(transport)) {
    registerOsraMessageListener({
      listener,
      transport,
      remoteName,
      key,
      unregisterSignal
    })
  }

  if (isEmitTransport(transport)) {
    sendMessage(transport, { type: 'announce' })
  }

  // Unidirectional emitting mode
  if (isEmitTransport(transport) && !isReceiveTransport(transport)) {
    const { remoteValueProxy } = startUnidirectionalEmittingConnection<T>({
      value,
      uuid,
      platformCapabilities,
      send: (message: MessageVariant) => sendMessage(transport, message),
      close: () => connectionContexts.delete(uuid)
    })
    return remoteValueProxy
  }

  return remoteValuePromise
}
