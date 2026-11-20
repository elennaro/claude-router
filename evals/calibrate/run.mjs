// Calibrates the judges on gold pairs (calibrate/gold.mjs), where the better answer is known:
//  opus   Opus alone, both orders (judge.mjs prompt)
//  jev    Jev, both orders (the answers swap slots), probabilities averaged
//  cascade  Jev's pick where it is sure (averaged probability >= t), else Opus: the one judge (judge.mjs judge)
// The old production judge (Fable both orders, Opus on a split) was dropped on 2026-11-20: no more accurate than
// Opus alone (95% / 92% without the Kotlin test pairs) at almost 3 times the cost.
// Every pair is asked with the good answer as x; "better" is right, "worse" wrong, anything else no decision.
// All calls are cached, so a re-run costs nothing and a changed judge pays only for itself.
// Usage: node calibrate/run.mjs  -> results/calibration.jsonl, results/calibration.md
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SURE, once } from '../judge.mjs'
import { OFFLINE, ROOT, WORK, log, pool, readJsonl, spent, writeJsonl } from '../lib.mjs'
import { PICK, ask } from './jev.mjs'

const outcome = s => (s > 0 ? 'right' : s < 0 ? 'wrong' : 'none')
// Jev's pick from both orders: P(good) averaged over good-at-A and good-at-B
export function jevPick(ab, ba) {
  const p = (ab.A + ba.B) / 2
  return { p, verdict: p > 0.5 ? 'right' : p < 0.5 ? 'wrong' : 'none', sure: Math.max(p, 1 - p), flip: (ab.A > ab.B) !== (ba.B > ba.A) }
}
assert.deepEqual(jevPick({ A: 0.9, B: 0.1 }, { A: 0.3, B: 0.7 }), { p: 0.8, verdict: 'right', sure: 0.8, flip: false })
assert.equal(jevPick({ A: 0.9, B: 0.1 }, { A: 0.8, B: 0.2 }).flip, true) // picks slot A both times: position, not content
// the cascade at threshold t: Jev where sure, else Opus (cost: Opus's, only when it runs)
export const cascade = (rows, t) => rows.map(r => (r.jev.sure >= t ? { verdict: r.jev.verdict, usd: 0 } : { verdict: r.opus.verdict, usd: r.opus.usd }))
assert.deepEqual(cascade([{ jev: { sure: 0.95, verdict: 'right' }, opus: { verdict: 'wrong', usd: 1 } }, { jev: { sure: 0.6, verdict: 'wrong' }, opus: { verdict: 'right', usd: 1 } }], 0.9), [{ verdict: 'right', usd: 0 }, { verdict: 'right', usd: 1 }])

const Q = PICK
const pairs = readJsonl(join(WORK, 'gold', 'pairs.jsonl'))
const before = spent()
const usdOf = tag => readJsonl(join(WORK, 'spend.jsonl')).filter(r => r.tag.startsWith(tag)).reduce((a, r) => a + r.usd, 0)
const rows = await pool(pairs, 4, async g => {
  const c = { id: g.id, prompt: g.request }
  const tag = `calib:${g.id}`
  const [oa, ob, ja, jb] = await Promise.all([
    once('opus', c, g.good, g.bad, true, `${tag}:opus-ab`), once('opus', c, g.good, g.bad, false, `${tag}:opus-ba`),
    ask({ request: g.request, answer_A: g.good, answer_B: g.bad }, Q, `${tag}:jev-ab`), ask({ request: g.request, answer_A: g.bad, answer_B: g.good }, Q, `${tag}:jev-ba`),
  ])
  return {
    id: g.id, set: g.set,
    opus: { orders: [outcome(oa?.s ?? 0), outcome(ob?.s ?? 0)], verdict: outcome((oa?.s ?? 0) + (ob?.s ?? 0)), flip: Math.sign(oa?.s ?? 0) !== Math.sign(ob?.s ?? 0), usd: usdOf(`${tag}:opus-`) },
    jev: jevPick(ja.pick.probabilities, jb.pick.probabilities),
  }
})
for (const [i, r] of rows.entries()) if (r?.error) log(`error ${pairs[i].id}: ${r.error}`)
const ok = rows.filter(r => r?.id)
writeJsonl(join(ROOT, 'results', 'calibration.jsonl'), ok)

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-')
// Wilson 95% interval for k right of n: where the true rate likely lies, given only n pairs
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = k / n, d = 1 + (z * z) / n, mid = (p + (z * z) / (2 * n)) / d, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, mid - half), Math.min(1, mid + half)]
}
assert.deepEqual(wilson(15, 20).map(x => Math.round(100 * x)), [53, 89])
assert.deepEqual(wilson(0, 0), [0, 1])
const acc = (rs, f) => {
  const v = rs.map(f), k = v.filter(x => x === 'right').length, [lo, hi] = wilson(k, v.length)
  return `${pct(k, v.length)} (${Math.round(100 * lo)}-${Math.round(100 * hi)}) / ${pct(v.filter(x => x === 'wrong').length, v.length)}`
}
const sets = [...new Set(ok.map(r => r.set))]
const opusUsd = ok.reduce((a, r) => a + r.opus.usd, 0)
const grid = [0.6, 0.7, 0.8, 0.9, 0.95, 0.99].map(t => {
  const c = cascade(ok, t)
  return { t, right: c.filter(x => x.verdict === 'right').length, wrong: c.filter(x => x.verdict === 'wrong').length, escalated: ok.filter(r => r.jev.sure < t).length, usd: c.reduce((a, x) => a + x.usd, 0) }
})
const cas = r => (r.jev.sure >= SURE ? r.jev.verdict : r.opus.verdict)
const row = (name, rs) => `| ${name} | ${rs.length} | ${acc(rs, cas)} | ${acc(rs, r => r.opus.verdict)} | ${acc(rs, r => r.jev.verdict)} | ${pct(rs.filter(r => r.jev.sure < SURE).length, rs.length)} |`
const md = [
  '# Judge calibration on gold pairs', '',
  `${ok.length} pairs where the better answer is known. Cells: right (95% interval) / wrong (the rest is "same" or no decision). ${OFFLINE ? 'Replayed from the store.' : `Spend this run $${(spent() - before).toFixed(2)}.`}`, '',
  `| Set | n | The judge: Jev if ${SURE} sure, else Opus | Opus both orders | Jev both orders | Sent to Opus |`, '|---|---|---|---|---|---|',
  ...sets.map(s => row(s, ok.filter(r => r.set === s))),
  row('**all**', ok), row('**all without kotlin-tests**', ok.filter(r => r.set !== 'kotlin-tests')), '',
  '## Position bias (the two orders pick different winners)', '',
  `| Set | Opus | Jev |`, '|---|---|---|',
  ...[...sets, 'all'].map(s => { const rs = s === 'all' ? ok : ok.filter(r => r.set === s); const fl = k => pct(rs.filter(r => r[k].flip).length, rs.length); return `| ${s} | ${fl('opus')} | ${fl('jev')} |` }),
  '', `Single order, right: Opus at A ${pct(ok.filter(r => r.opus.orders[0] === 'right').length, ok.length)}, Opus at B ${pct(ok.filter(r => r.opus.orders[1] === 'right').length, ok.length)}.`, '',
  `Judge cost per pair: Opus both orders $${(opusUsd / ok.length).toFixed(3)}, Jev under $0.001.`, '',
  '## Jev threshold: Jev where sure, else Opus', '',
  `| Threshold | Right | Wrong | Sent to Opus | Cost vs always Opus |`, '|---|---|---|---|---|',
  ...grid.map(g => `| ${g.t} | ${pct(g.right, ok.length)} | ${pct(g.wrong, ok.length)} | ${pct(g.escalated, ok.length)} | ${pct(g.usd, opusUsd)} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'calibration.md'), md)
console.log(md)
