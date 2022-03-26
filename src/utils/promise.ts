import type { Await } from '..'

export default
  <T extends (...args: any[]) => Promise<any>>(func: T) =>
    async ({ port, ...rest }: Parameters<T>[0]): Promise<Await<ReturnType<T>>> => {
      port.start()
      const result = await func({ port, ...rest })
      if (Array.isArray(result)) {
        port.postMessage(result[0], <Transferable[]>result[1])
      } else {
        port.postMessage(result)
      }
      port.close()
      // todo: implement the rest?
      // @ts-ignore
      return
    }
