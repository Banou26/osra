# osra
what that? https://github.com/GoogleChromeLabs/comlink but nicer to use.
thats about it

how to?
register your functions in the other context like so
```ts
import { expose } from 'osra'

const resolvers = {
  test: async (myData) => {
    // do work...
    return {
      foo: 1,
      bar: 'bar',
      baz: () => true
    }
  }
}

export type Resolvers = typeof resolvers

expose(resolvers, { local: globalThis, remote: globalThis })
```

and on your current context with full types you can call it easily like
```ts
import type { Resolvers } from './worker.ts'

import { expose } from 'osra'

const worker = new Worker('/worker.js', { type: 'module' })

const { test } = await expose<Resolvers>({}, { local: worker, remote: worker })

const { foo, bar, baz } = test()
// foo === 1
// bar === 'bar'
// baz === callable function that will return a promise with its response
```

Todo:

docs about:

* Protocol mode:
* - Bidirectional mode
* - Unidirectional mode
* Transport modes:
* - Capable mode
* - Jsonable mode
* Revivables
