export type GcUnregister = () => void

const registry = new FinalizationRegistry<() => void>((cleanup) => {
  try { cleanup() } catch { /* no caller to surface to */ }
})

// Contract: `cleanup` MUST NOT (transitively) reference `target`, or the engine never sees target as collectable.
export const trackGc = (target: WeakKey, cleanup: () => void): GcUnregister => {
  const token = {}
  registry.register(target, cleanup, token)
  return () => registry.unregister(token)
}
