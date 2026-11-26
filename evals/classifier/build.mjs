// Classifier data: the training file from the public layer, drops duplicates and anything close to an eval case
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
// No model-written data: Anthropic's Usage Policy bars training a model on Claude outputs without authorization (owner, 2026-11-26)
const rows = readJsonl(join(DIR, 'public.jsonl'))

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
  const t = (table[r.label] ??= { total: 0, ru: 0 })
  t.total++
  if (r.lang === 'ru') t.ru++
}
log(`train: ${kept.length} rows (${dup} duplicates and ${near} close to an eval case dropped, ${cases.length} cases)`)
console.log('label'.padEnd(16), 'total russian')
for (const [c, t] of Object.entries(table).sort((a, b) => b[1].total - a[1].total)) console.log(c.padEnd(16), String(t.total).padStart(5), String(t.ru).padStart(7))

// Strength: the smallest model size a person judged enough for the prompt, from Arena's human votes (CC-BY-4.0).
// 1 small (Haiku-like), 2 mid (Sonnet-like), 3 big (Opus-like), read from the model names. Any pair with a Claude model
// is dropped, so no label rests on an Anthropic answer (owner, 2026-11-26).
// shortcut: tiers by name pattern for the mid-2025 Arena line-up, revisit if votes.mjs pulls a newer set.
const SMALL = /flash-lite|gemma|qwen3-30b|scout|mistral-small|-mini|gemini-2\.0-flash|nova-pro|llama-3\.3|hunyuan|command-a/
const BIG = /^o3-20|gemini-2\.5-pro|deepseek-r1|grok-4|grok-3-preview|^qwen3-235b-a22b$|kimi-k2|minimax-m1/
const tier = m => (/claude/.test(m) ? undefined : SMALL.test(m) ? 1 : BIG.test(m) ? 3 : 2)
// The cheaper side won or tied: its size was enough. The dearer side won: its size was needed. Both bad: the biggest.
const need = v => {
  const a = tier(v.a), b = tier(v.b)
  if (!a || !b || a === b) return undefined
  if (v.winner === 'both_bad') return 3
  if (v.winner === 'tie') return Math.min(a, b)
  return v.winner === 'model_a' ? a : b
}
assert.equal(need({ a: 'gemma-3-27b-it', b: 'o3-2025-04-16', winner: 'tie' }), 1)
assert.equal(need({ a: 'gemma-3-27b-it', b: 'o3-2025-04-16', winner: 'model_b' }), 3)
assert.equal(need({ a: 'gpt-4.1-2025-04-14', b: 'o3-mini', winner: 'model_a' }), 2)
assert.equal(need({ a: 'claude-opus-4-20250514', b: 'gemma-3-27b-it', winner: 'model_b' }), undefined)
assert.equal(need({ a: 'qwen3-235b-a22b', b: 'qwen3-235b-a22b-no-thinking', winner: 'both_bad' }), 3)

const strong = [], seenS = new Set()
let nearS = 0
for (const v of readJsonl(join(DIR, 'votes.jsonl'))) {
  const n = need(v), g = grams(v.text)
  if (!n || !g.key || seenS.has(g.key)) continue
  seenS.add(g.key)
  if (cases.some(c => close(g, c))) { nearS++; continue }
  strong.push({ text: v.text, lang: v.lang, need: n })
}
writeJsonl(join(DIR, 'strength.jsonl'), strong)
const byNeed = [1, 2, 3].map(n => strong.filter(r => r.need === n).length)
log(`strength: ${strong.length} prompts (${nearS} close to an eval case dropped); small ${byNeed[0]}, mid ${byNeed[1]}, big ${byNeed[2]}`)
