export type TestConfig = {
  iterations?: number
  memoryTreshold?: number
  timeout?: number
}

export type TestObject = {
  config?: TestConfig
  [key: string]: TestObject | TestConfig | ((...args: any[]) => any) | undefined
}

declare global {
  var tests: TestObject
}
