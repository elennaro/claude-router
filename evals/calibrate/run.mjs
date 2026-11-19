// Calibrates the judges on gold pairs (calibrate/gold.mjs), where the better answer is known:
//  fable  the production judge (judge.mjs judgePair: Fable both orders, Opus on a split)
//  opus   Opus alone, both orders, same prompt
//  jev    Jev, both orders (the answers swap slots), probabilities averaged
//  cascade  Jev's pick where it is sure (averaged probability >= t), else the production judge
// Every pair is asked with the good answer as x; "better" is right, "worse" wrong, anything else no decision.
// All calls are cached, so a re-run costs nothing and a changed judge pays only for itself.
// Usage: node calibrate/run.mjs  -> results/calibration.jsonl, results/calibration.md
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { judgePair, once } from '../judge.mjs'
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
// the cascade at threshold t: Jev where sure, else the production judge (cost: the judge's, only when it runs)
export const cascade = (rows, t, judge = 'fable') => rows.map(r => (r.jev.sure >= t ? { verdict: r.jev.verdict, usd: 0 } : { verdict: r[judge].verdict, usd: r[judge].usd }))
assert.deepEqual(cascade([{ jev: { sure: 0.95, verdict: 'right' }, fable: { verdict: 'wrong', usd: 1 } }, { jev: { sure: 0.6, verdict: 'wrong' }, fable: { verdict: 'right', usd: 1 } }], 0.9), [{ verdict: 'right', usd: 0 }, { verdict: 'right', usd: 1 }])

const Q = PICK
const pairs = readJsonl(join(WORK, 'gold', 'pairs.jsonl'))
const before = spent()
const usdOf = tag => readJsonl(join(WORK, 'spend.jsonl')).filter(r => r.tag.startsWith(tag)).reduce((a, r) => a + r.usd, 0)
const rows = await pool(pairs, 4, async g => {
  const c = { id: g.id, prompt: g.request }
  const tag = `calib:${g.id}`
  const [f, oa, ob, ja, jb] = await Promise.all([
    judgePair(c, g.good, g.bad, `${tag}:fable`),
    once('opus', c, g.good, g.bad, true, `${tag}:opus-ab`), once('opus', c, g.good, g.bad, false, `${tag}:opus-ba`),
    ask({ request: g.request, answer_A: g.good, answer_B: g.bad }, Q, `${tag}:jev-ab`), ask({ request: g.request, answer_A: g.bad, answer_B: g.good }, Q, `${tag}:jev-ba`),
  ])
  const fv = { better: 'right', worse: 'wrong' }[f.verdict] ?? 'none'
  return {
    id: g.id, set: g.set,
    fable: { verdict: fv, by: f.by, scores: f.scores, flip: Math.sign(f.scores[0] ?? 0) !== Math.sign(f.scores[1] ?? 0), usd: usdOf(`${tag}:fable`) },
    opus: { orders: [outcome(oa?.s ?? 0), outcome(ob?.s ?? 0)], verdict: outcome((oa?.s ?? 0) + (ob?.s ?? 0)), flip: Math.sign(oa?.s ?? 0) !== Math.sign(ob?.s ?? 0), usd: usdOf(`${tag}:opus-`) },
    jev: jevPick(ja.pick.probabilities, jb.pick.probabilities),
  }
})
for (const [i, r] of rows.entries()) if (r?.error) log(`error ${pairs[i].id}: ${r.error}`)
const ok = rows.filter(r => r?.id)
writeJsonl(join(ROOT, 'results', 'calibration.jsonl'), ok)

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-')
const acc = (rs, f) => { const v = rs.map(f); return `${pct(v.filter(x => x === 'right').length, v.length)} / ${pct(v.filter(x => x === 'wrong').length, v.length)}` }
const sets = [...new Set(ok.map(r => r.set))]
const fableUsd = ok.reduce((a, r) => a + r.fable.usd, 0)
const grid = ['fable', 'opus'].flatMap(judge => [0.6, 0.7, 0.8, 0.9, 0.95, 0.99].map(t => {
  const c = cascade(ok, t, judge)
  return { judge, t, right: c.filter(x => x.verdict === 'right').length, wrong: c.filter(x => x.verdict === 'wrong').length, escalated: ok.filter(r => r.jev.sure < t).length, usd: c.reduce((a, x) => a + x.usd, 0) }
}))
const md = [
  '# Judge calibration on gold pairs', '',
  `${ok.length} pairs where the better answer is known. Cells: right / wrong (the rest is "same" or no decision). ${OFFLINE ? 'Replayed from the store.' : `Spend this run $${(spent() - before).toFixed(2)}.`}`, '',
  `| Set | n | Production (Fable + Opus split) | Opus both orders | Jev both orders |`, '|---|---|---|---|---|',
  ...sets.map(s => { const rs = ok.filter(r => r.set === s); return `| ${s} | ${rs.length} | ${acc(rs, r => r.fable.verdict)} | ${acc(rs, r => r.opus.verdict)} | ${acc(rs, r => r.jev.verdict)} |` }),
  `| **all** | ${ok.length} | ${acc(ok, r => r.fable.verdict)} | ${acc(ok, r => r.opus.verdict)} | ${acc(ok, r => r.jev.verdict)} |`, '',
  '## Position bias (the two orders pick different winners)', '',
  `| Set | Fable | Opus | Jev |`, '|---|---|---|---|',
  ...[...sets, 'all'].map(s => { const rs = s === 'all' ? ok : ok.filter(r => r.set === s); const fl = k => pct(rs.filter(r => r[k].flip).length, rs.length); return `| ${s} | ${fl('fable')} | ${fl('opus')} | ${fl('jev')} |` }),
  '', `Single order, right: Opus at A ${pct(ok.filter(r => r.opus.orders[0] === 'right').length, ok.length)}, Opus at B ${pct(ok.filter(r => r.opus.orders[1] === 'right').length, ok.length)}.`, '',
  `Judge cost per pair: production $${(fableUsd / ok.length).toFixed(3)}, Opus both orders $${(ok.reduce((a, r) => a + r.opus.usd, 0) / ok.length).toFixed(3)}, Jev under $0.001.`, '',
  '## Cascade: Jev where sure, else a judge', '',
  `| Unsure goes to | Threshold | Right | Wrong | Sent to the judge | Cost vs always the production judge |`, '|---|---|---|---|---|---|',
  ...grid.map(g => `| ${g.judge === 'fable' ? 'production' : 'Opus'} | ${g.t} | ${pct(g.right, ok.length)} | ${pct(g.wrong, ok.length)} | ${pct(g.escalated, ok.length)} | ${pct(g.usd, fableUsd)} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'calibration.md'), md)
console.log(md)
