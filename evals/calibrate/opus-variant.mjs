// An Opus prompt variant for the pairs the cascade sends to Opus (Jev under SURE), against the cached current prompt.
// The variant has Opus work out the right solution first and check both answers against it (reference-guided
// judging), and names maintainability for code. Halves as in jev-variants.mjs: read the result on "test".
// Usage: EVAL_CAP_USD=9 node calibrate/opus-variant.mjs  -> results/opus-variant.md
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SURE, VERDICT, prompt, score } from '../judge.mjs'
import { OfflineMiss, ROOT, WORK, claude, log, pool, readJsonl } from '../lib.mjs'
import { createHash } from 'node:crypto'

const half = id => (createHash('sha256').update(id).digest()[0] % 2 ? 'test' : 'tune') // as jev-variants.mjs (importing it would run it)

export const prompt2 = (c, a, b) => prompt(c, a, b).replace('First write the evidence', 'Before comparing, work out briefly what a correct, complete answer to the request must contain (for code or a problem with one right answer, solve it yourself), then check each answer against that. For code, also weigh how easy it is to maintain: small single-purpose functions, behavior kept with the data it uses, clear names. Then write the evidence')

const calib = new Map(readJsonl(join(ROOT, 'results', 'calibration.jsonl')).map(r => [r.id, r]))
const pairs = readJsonl(join(WORK, 'gold', 'pairs.jsonl')).filter(p => calib.get(p.id)?.jev.sure < SURE)
log(`pairs sent to Opus: ${pairs.length}`)
const outcome = s => (s > 0 ? 'right' : s < 0 ? 'wrong' : 'none')
const rows = await pool(pairs, 4, async p => {
  const c = { id: p.id, prompt: p.request }
  const one = async atA => {
    const r = await claude({ model: 'opus', effort: 'high', prompt: atA ? prompt2(c, p.good, p.bad) : prompt2(c, p.bad, p.good), json: VERDICT, tag: `ov:${p.id}:${atA ? 'ab' : 'ba'}`, cache: true })
    return r.structured?.verdict ? score(r.structured.verdict, atA) : 0
  }
  let a, b
  try { [a, b] = await Promise.all([one(true), one(false)]) } catch (e) { if (e instanceof OfflineMiss) return null; throw e } // EVAL_OFFLINE: score only what is cached
  return { id: p.id, set: p.set, half: half(p.id), old: calib.get(p.id).opus.verdict, now: outcome(a + b) }
})
for (const r of rows) if (r?.error) log(`error: ${r.error}`)
const ok = rows.filter(r => r?.id)
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '-')
const line = (name, rs) => `| ${name} | ${rs.length} | ${pct(rs.filter(r => r.old === 'right').length, rs.length)} / ${pct(rs.filter(r => r.old === 'wrong').length, rs.length)} | ${pct(rs.filter(r => r.now === 'right').length, rs.length)} / ${pct(rs.filter(r => r.now === 'wrong').length, rs.length)} |`
const md = ['# Opus prompt variant on the pairs Jev was unsure of', '', '| Pairs | n | Current prompt right / wrong | Variant right / wrong |', '|---|---|---|---|',
  line('tune', ok.filter(r => r.half === 'tune')), line('test', ok.filter(r => r.half === 'test')), line('all', ok), line('all without Kotlin tests', ok.filter(r => r.set !== 'kotlin-tests')),
  '', 'Changed verdicts:', ...ok.filter(r => r.old !== r.now).map(r => `- ${r.id} (${r.set}, ${r.half}): ${r.old} -> ${r.now}`)].join('\n')
writeFileSync(join(ROOT, 'results', 'opus-variant.md'), md)
console.log(md)
