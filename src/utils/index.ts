export * from './transport'
export * from '../revivables'
export * from './replace'
export * from '../connections'
export * from './transferable'
export * from './type-guards'
export * from './typed-event-target'
export * from './typed-message-channel'
export * from './event-channel'
export * from './type'
export * from './capable-check'
// `init` is internal — only the connection bootstrap calls it. Skipping
// it here avoids the name collision with bidirectional.ts's own `init`.
export { createHandle, adoptHandle } from './remote-handle'
export type {
  Handle,
  HandleId,
  HandleOptions,
  HandleMessages,
} from './remote-handle'
