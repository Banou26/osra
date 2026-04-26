/**
 * Run `cleanup` after `target` is garbage-collected. Returns a handle to
 * cancel the tracking before that happens.
 *
 * Backed by a single shared FinalizationRegistry — every revivable that
 * needs FR semantics goes through this so the boilerplate (token,
 * unregister, cycle-safety contract) lives in one place.
 *
 * Contract: `cleanup` MUST NOT (transitively) reference `target`. The
 * registry strong-holds the cleanup callback, the cleanup would then
 * strong-hold target, and the engine would never see target as
 * collectable. Use a `WeakRef` if cleanup needs something that points
 * back at target.
 *
 * Errors thrown from cleanup are swallowed: the callback fires from the
 * FR thread, where there's no caller to surface them to.
 */
export type GcUnregister = () => void

const registry = new FinalizationRegistry<() => void>((cleanup) => {
  try { cleanup() } catch { /* no caller to surface to */ }
})

export const trackGc = (target: WeakKey, cleanup: () => void): GcUnregister => {
  const token = {}
  registry.register(target, cleanup, token)
  return () => registry.unregister(token)
}
