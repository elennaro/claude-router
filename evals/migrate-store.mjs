// One-time move of the old file caches into the store (work/eval.db): work/cache/*.json (Claude calls),
// work/cache/jev/*.json (Jev), work/replay/*.md (answers). Each file is deleted only after its row reads back equal.
// Usage: node migrate-store.mjs
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { WORK, cacheCount, cacheGet, cachePut, log } from './lib.mjs'

const moves = [
  { dir: join(WORK, 'cache'), ext: '.json', kind: 'claude', key: n => n, parse: JSON.parse },
  { dir: join(WORK, 'cache', 'jev'), ext: '.json', kind: 'jev', key: n => `jev:${n}`, parse: JSON.parse },
  { dir: join(WORK, 'replay'), ext: '.md', kind: 'answer', key: n => `answer:${n}`, parse: t => t },
]
for (const m of moves) {
  if (!existsSync(m.dir)) continue
  let moved = 0
  for (const f of readdirSync(m.dir).filter(f => f.endsWith(m.ext))) {
    const file = join(m.dir, f), key = m.key(f.slice(0, -m.ext.length))
    const value = m.parse(readFileSync(file, 'utf8'))
    cachePut(key, m.kind, value)
    if (JSON.stringify(cacheGet(key)) !== JSON.stringify(value)) throw new Error(`read-back differs for ${key}; ${file} kept`)
    rmSync(file)
    moved++
  }
  log(`${m.kind}: moved ${moved}`)
}
for (const d of [join(WORK, 'cache', 'jev'), join(WORK, 'cache'), join(WORK, 'replay', 'ws'), join(WORK, 'replay')])
  if (existsSync(d) && readdirSync(d).length === 0) rmSync(d, { recursive: true })
log(`store now holds ${JSON.stringify(cacheCount())}`)
