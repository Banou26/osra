
export default () => {
  const listeners = new Map<string, Function[]>()

  return {
    dispatchAll: <T = any>(type: string, value?: any): Promise<T[]> =>
      Promise.allSettled(
        (listeners.get(type) ?? []).map(func => func(value))
      ).then(results =>
        (results
          .filter(promiseSettledResult => promiseSettledResult.status === 'fulfilled' && promiseSettledResult.value) as PromiseFulfilledResult<T>[])
          .map(promiseFulfilledResult => promiseFulfilledResult.value)
      ),

    dispatch: <T = any>(type: string, value?: any): Promise<T> =>
      Promise.any(
        (listeners.get(type) ?? []).map(func => func(value))
      ).catch(() => {}),

    addEventListener: (type: string, listener: Function) =>
      listeners.set(
        type,
        [
          ...listeners.get(type) ?? [],
          listener
        ]
      ),

    removeEventListener: (type: string, listener: Function) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(v => v !== listener)
      )
  }
}
