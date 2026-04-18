/// <reference path="../global-types.d.ts" />

import type { Transport } from '../../src'
import type { OsraRunner, TransportName } from './transports'

import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'

// Side-effect import: type-tests.ts is compile-time only — its presence here
// keeps the type-level assertions part of the test bundle's typecheck.
import './type-tests'

import { transportTests, memoryTests, standaloneTests, gcTests } from './registry'
import { transports } from './transports'

use(chaiAsPromised)

const findTransport = (name: TransportName) => {
  const t = transports.find(x => x.name === name)
  if (!t) throw new Error(`Unknown transport: ${name}`)
  return t
}

const lookupTransportTest = (group: string, name: string): (transport: Transport) => Promise<void> => {
  const fn = transportTests[group]?.[name]
  if (!fn) throw new Error(`Unknown transport test: ${group}/${name}`)
  return fn
}

const lookupMemoryTest = (name: string): (transport: Transport, iterations: number) => Promise<void> => {
  const fn = memoryTests[name]
  if (!fn) throw new Error(`Unknown memory test: ${name}`)
  return fn
}

const lookupStandaloneTest = (group: string, name: string): () => Promise<void> => {
  const fn = standaloneTests[group]?.[name]
  if (!fn) throw new Error(`Unknown standalone test: ${group}/${name}`)
  return fn
}

const lookupGcTest = (name: string): (transport: Transport) => Promise<void> => {
  const fn = gcTests[name]
  if (!fn) throw new Error(`Unknown gc test: ${name}`)
  return fn
}

const runner = {
  transport: async (group, name, transportName) => {
    await lookupTransportTest(group, name)(findTransport(transportName).factory())
  },
  memory: async (name, transportName) => {
    const t = findTransport(transportName)
    await lookupMemoryTest(name)(t.factory(), t.memoryIterations)
  },
  standalone: async (group, name) => {
    await lookupStandaloneTest(group, name)()
  },
  gc: async (name, transportName) => {
    await lookupGcTest(name)(findTransport(transportName).factory())
  },
} satisfies OsraRunner

globalThis.__osraRun = runner
