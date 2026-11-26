// Classifier data: joins the layers into one training file, drops duplicates and anything close to an eval case
// (the cases are the test set and are never trained on). Free.
// Usage: node classifier/build.mjs  -> work/classifier/train.jsonl and a count per class, source and language
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, WORK, log, readJsonl, writeJsonl } from '../lib.mjs'

const words = t => t.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
const grams = t => { const w = words(t); const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(' ')); return { s, key: w.join(' ') } }
// Too close: the same words, or half of the row's word triples found in one case.
const close = (row, kase) => row.key === kase.key || (row.s.size > 0 && [...row.s].filter(g => kase.s.has(g)).length / row.s.size >= 0.5)

assert.ok(close(grams('Fix the typo in the README, please'), grams('fix the typo in the readme please')))
assert.ok(close(grams('please rename foo to bar in utils and the tests'), grams('Rename foo to bar in utils and the tests too, thanks')))
assert.ok(!close(grams('rename foo to bar'), grams('write a linkedin post about our launch')))

const DIR = join(WORK, 'classifier')
const cases = readdirSync(join(ROOT, 'cases')).flatMap(f => readJsonl(join(ROOT, 'cases', f))).map(c => grams(c.prompt ?? ''))
const rows = [...readJsonl(join(DIR, 'public.jsonl')), ...readJsonl(join(DIR, 'synth.jsonl'))]

const seen = new Set()
let dup = 0, near = 0
const kept = rows.filter(r => {
  const g = grams(r.text)
  if (!g.key || seen.has(g.key)) return void dup++
  seen.add(g.key)
  if (cases.some(c => close(g, c))) return void near++
  return true
})
writeJsonl(join(DIR, 'train.jsonl'), kept)

const table = {}
for (const r of kept) {
  const t = (table[r.label] ??= { total: 0, public: 0, synth: 0, ru: 0 })
  t.total++; t[r.src === 'synth' ? 'synth' : 'public']++
  if (r.lang === 'ru' || r.lang === 'mixed') t.ru++
}
log(`train: ${kept.length} rows (${dup} duplicates and ${near} close to an eval case dropped, ${cases.length} cases)`)
console.log('label'.padEnd(16), 'total public synth ru/mixed')
for (const [c, t] of Object.entries(table).sort((a, b) => b[1].total - a[1].total)) console.log(c.padEnd(16), String(t.total).padStart(5), String(t.public).padStart(6), String(t.synth).padStart(5), String(t.ru).padStart(8))
