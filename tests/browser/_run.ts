import { use } from 'chai'
import chaiAsPromised from 'chai-as-promised'

// Side-effect import: type-tests.ts is compile-time only — its presence here
// keeps the type-level assertions part of the test bundle's typecheck.
import './type-tests'

import { transportTests, memoryTests, standaloneTests } from './registry'
import { transports, type TransportName } from './transports'

use(chaiAsPromised)

const findTransport = (name: TransportName) => {
  const t = transports.find(x => x.name === name)
  if (!t) throw new Error(`Unknown transport: ${name}`)
  return t
}

const lookupTransportTest = (group: string, name: string) => {
  const fn = transportTests[group]?.[name]
  if (!fn) throw new Error(`Unknown transport test: ${group}/${name}`)
  return fn
}

const lookupMemoryTest = (name: string) => {
  const fn = memoryTests[name]
  if (!fn) throw new Error(`Unknown memory test: ${name}`)
  return fn
}

const lookupStandaloneTest = (group: string, name: string) => {
  const fn = standaloneTests[group]?.[name]
  if (!fn) throw new Error(`Unknown standalone test: ${group}/${name}`)
  return fn
}

globalThis.__osraRun = {
  transport: (group, name, transportName) =>
    lookupTransportTest(group, name)(findTransport(transportName).factory()),
  memory: (name, transportName) => {
    const t = findTransport(transportName)
    return lookupMemoryTest(name)(t.factory(), t.memoryIterations)
  },
  standalone: (group, name) =>
    lookupStandaloneTest(group, name)(),
}
