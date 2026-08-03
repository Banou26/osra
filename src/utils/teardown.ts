const registries = new WeakMap<WeakKey, Set<() => void>>()
const tornDown = new WeakSet<WeakKey>()

export const onTeardown = (scope: WeakKey, fn: () => void): (() => void) => {
  if (tornDown.has(scope)) {
    fn()
    return () => {}
  }
  let set = registries.get(scope)
  if (!set) registries.set(scope, set = new Set())
  set.add(fn)
  return () => set.delete(fn)
}

export const runTeardown = (scope: WeakKey): void => {
  if (tornDown.has(scope)) return
  tornDown.add(scope)
  const set = registries.get(scope)
  if (!set) return
  registries.delete(scope)
  for (const fn of set) {
    try { fn() } catch { }
  }
}
