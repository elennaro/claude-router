// The judge's noise floor: Opus medium against a second Opus medium sample (should be "same"), plus identical
// pairs (must be "same"). A routed tier's true loss is its "worse" rate minus this floor.
// Usage: node noise.mjs   env NOISE_PER (cases per category, default 2), IDENTICAL (default 20)
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { answer, judge } from './judge.mjs'
import { ROOT, log, pool, readJsonl, writeJsonl } from './lib.mjs'

const PER = Number(process.env.NOISE_PER ?? 2)
const IDENTICAL = Number(process.env.IDENTICAL ?? 20)
const REF = { model: 'opus', effort: 'medium' }
const cats = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl'))
const cases = cats.flatMap(f => readJsonl(join(ROOT, 'cases', f)).slice(0, PER))
const out = join(ROOT, 'results', 'noise.jsonl')
const done = new Map(readJsonl(out).map(r => [`${r.id}:${r.kind}`, r]))

const jobs = [...cases.map(c => ({ c, kind: 'resample' })), ...cases.filter((_, i) => i % Math.ceil(cases.length / IDENTICAL) === 0).map(c => ({ c, kind: 'identical' }))]
// new pairs, and pairs the old Fable judge settled (made again by the current judge)
const rows = await pool(jobs.filter(j => done.get(`${j.c.id}:${j.kind}`)?.judge !== 'cascade'), 4, async ({ c, kind }) => {
  const a = await answer(c, REF)
  const b = kind === 'identical' ? a : await answer(c, REF, 1)
  const j = await judge(c, a, b, `noise:${c.id}:${kind}`)
  log(`${c.id} ${kind}: ${j.verdict}`)
  return { id: c.id, category: c.category, kind, ...j }
})
for (const r of rows.filter(r => r?.id)) done.set(`${r.id}:${r.kind}`, r)
for (const r of rows) if (r?.error) log(`error: ${r.error}`)
writeJsonl(out, [...done.values()])
for (const kind of ['resample', 'identical']) {
  const rs = [...done.values()].filter(r => r.kind === kind)
  const n = v => rs.filter(r => r.verdict === v).length
  log(`${kind}: ${rs.length} pairs; worse ${n('worse')}, better ${n('better')}, same ${n('same')}, uncertain ${n('uncertain')}`)
}
