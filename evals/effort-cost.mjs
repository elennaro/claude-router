// Where policy.ts EFFORT_COST comes from: each tier's measured cost against Opus medium on the same eval cases (the
// replay answers in work/spend.jsonl). Free, no model calls. Usage: node effort-cost.mjs
import { join } from 'node:path'
import { WORK, readJsonl } from './lib.mjs'

// replay:<id>[.:]<tier>[.sN]: the first sample of each case and tier (same parser as report.mjs)
const cost = new Map()
for (const r of readJsonl(join(WORK, 'spend.jsonl'))) {
  const m = /^replay:(.+?)[.:]((?:haiku|sonnet|opus|fable)-[a-z]+)$/.exec(r.tag ?? '')
  if (m && r.usd > 0 && !cost.has(`${m[1]}|${m[2]}`)) cost.set(`${m[1]}|${m[2]}`, r.usd)
}
const ids = [...new Set([...cost.keys()].map(k => k.split('|')[0]))]
for (const tier of ['opus-low', 'opus-high', 'opus-xhigh', 'sonnet-medium', 'sonnet-high', 'haiku-medium']) {
  const pairs = ids.map(id => [cost.get(`${id}|${tier}`), cost.get(`${id}|opus-medium`)]).filter(([a, b]) => a && b)
  if (!pairs.length) { console.log(`${tier.padEnd(14)} no paired cases`); continue }
  const ratio = pairs.reduce((s, p) => s + p[0], 0) / pairs.reduce((s, p) => s + p[1], 0)
  console.log(`${tier.padEnd(14)} ${ratio.toFixed(2)}x opus-medium over ${pairs.length} cases`)
}
