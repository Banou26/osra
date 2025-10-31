# osra
whats that? A powerful communication library that's really easy to use.
thats about it

how?
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

and on your current context with full typescript support you can call it easily like
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

Supports almost any JS types like Promises, Functions, Streams, ect... and plans to support plugins for custom types.
From efficient transferable messaging transport to JSON only, it always works.

Todo:

docs about:

* Protocol mode:
* - Bidirectional mode
* - Unidirectional mode
* Transport modes:
* - Capable mode
* - Jsonable mode
* Revivables
