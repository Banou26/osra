// Fast per-file validation of ```ts twoslash blocks without a full astro
// build. Usage: node scripts/check-twoslash.mjs [file ...]
// With no arguments, checks every .md/.mdx under src/content/docs.
// compilerOptions must stay in sync with ec.config.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createTwoslasher } from 'twoslash'

const root = new URL('..', import.meta.url).pathname
const docsDir = join(root, 'src/content/docs')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.mdx?$/.test(name) ? [path] : []
  })

const files = process.argv.length > 2 ? process.argv.slice(2) : walk(docsDir)

const twoslasher = createTwoslasher({
  compilerOptions: {
    target: 99,
    module: 99,
    moduleResolution: 100,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
  },
})

let blocks = 0
let failures = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const fences = [...source.matchAll(/^```ts twoslash\n([\s\S]*?)^```$/gm)]
  for (const [i, fence] of fences.entries()) {
    blocks++
    const line = source.slice(0, fence.index).split('\n').length
    try {
      twoslasher(fence[1], 'ts')
    } catch (error) {
      failures++
      console.error(`✗ ${relative(root, file)} block ${i + 1} (line ${line})`)
      console.error(`  ${String(error.message ?? error).split('\n').slice(0, 6).join('\n  ')}`)
    }
  }
}
console.log(`${blocks - failures}/${blocks} twoslash blocks OK (${files.length} files)`)
process.exit(failures ? 1 : 0)
