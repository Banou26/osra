// Content API - exposed by content script to background
export type ContentAPI = {
  getContentInfo: () => Promise<{ location: string; timestamp: number }>
  processInContent: (data: string) => Promise<string>
  contentCallback: () => Promise<() => Promise<string>>
  getContentDate: () => Promise<Date>
  getContentError: () => Promise<Error>
  throwContentError: () => Promise<never>
  processContentBuffer: (data: Uint8Array) => Promise<Uint8Array>
}

// Background API - exposed by background to content/popup
export type TestAPI = {
  echo: <T>(data: T) => Promise<T>
  add: (a: number, b: number) => Promise<number>
  math: {
    multiply: (a: number, b: number) => Promise<number>
    divide: (a: number, b: number) => Promise<number>
  }
  createCallback: () => Promise<() => Promise<number>>
  callWithCallback: (cb: () => number) => Promise<number>
  getDate: () => Promise<Date>
  getError: () => Promise<Error>
  throwError: () => Promise<never>
  processBuffer: (data: Uint8Array) => Promise<Uint8Array>
  getBuffer: () => Promise<ArrayBuffer>
  getPromise: () => Promise<number>
  getStream: () => Promise<ReadableStream<Uint8Array>>
  // Background->Content via content-initiated connection
  bgToContent: {
    getInfo: () => Promise<{ location: string; timestamp: number }>
    process: (data: string) => Promise<string>
    getCallback: () => Promise<() => Promise<string>>
    getDate: () => Promise<Date>
    getError: () => Promise<Error>
    throwError: () => Promise<never>
    processBuffer: (data: Uint8Array) => Promise<Uint8Array>
  }
  // Background-initiated connection to content script
  bgInitiated: {
    connect: () => Promise<boolean>
    getInfo: () => Promise<{ location: string; timestamp: number }>
    process: (data: string) => Promise<string>
    getCallback: () => Promise<() => Promise<string>>
    getDate: () => Promise<Date>
    getError: () => Promise<Error>
    throwError: () => Promise<never>
    processBuffer: (data: Uint8Array) => Promise<Uint8Array>
  }
}
