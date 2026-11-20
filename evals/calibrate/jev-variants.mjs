// Jev question variants for the cascade (Jev where sure, else Opus both orders), on the gold pairs.
// Opus's verdict for every pair is already in results/calibration.jsonl, so only Jev is asked (under $0.001 a call).
// Pairs split in two halves by id: thresholds and weights are picked on "tune", the result is read on "test".
//  pick   the current pairwise question (jev.mjs PICK), both orders
//  pick2  a sharper pairwise question with a "same" exit, both orders
//  solo   each answer scored on its own (correct, complete, craft); no order, so no position bias
// Usage: node calibrate/jev-variants.mjs  -> results/jev-variants.md
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, WORK, log, pool, readJsonl } from '../lib.mjs'
import { PICK, ask } from './jev.mjs'

export const PICK2 = {
  pick: {
    type: 'choice',
    instructions: '`request` is a task; `answer_A` and `answer_B` are two responses to it. Pick the response a demanding expert would accept with fewer changes. First, the one with fewer errors in facts, logic or code. If both are equally correct, the one that does more of what `request` asks and follows its instructions. If still equal, the one whose code or writing is cleaner and easier to maintain. Being longer does not make a response better.',
    criteria: {
      A: { what: '`answer_A` needs fewer changes' },
      B: { what: '`answer_B` needs fewer changes' },
      same: { what: 'both need the same changes, or the difference does not matter to the expert' },
    },
  },
}
export const SOLO = {
  correct: { type: 'noul', instructions: '`answer` has no errors: its facts, logic and code are right for what `request` asks.' },
  complete: { type: 'noul', instructions: '`answer` does every part of what `request` asks and follows every instruction in it.' },
  craft: {
    type: 'score',
    instructions: 'How clean and maintainable is the code or writing in `answer`?',
    criteria: [
      'hard to follow: tangled logic, long blocks doing many things, misleading names, or duplicated code',
      'works but messy: long functions, unclear names, or logic in the wrong place',
      'readable, with a few rough spots',
      'clean: short focused parts, clear names, each piece where it belongs',
      'exemplary: as simple as the task allows, idiomatic for its language, nothing to change',
    ],
  },
}

export const half = id => (createHash('sha256').update(id).digest()[0] % 2 ? 'test' : 'tune')
// pairwise: P(good) vs P(bad) averaged over both orders; "same" mass lowers sureness
export function pairwise(ab, ba) {
  const good = (ab.A + ba.B) / 2, bad = (ab.B + ba.A) / 2
  return { d: good - bad, sure: Math.max(good, bad) }
}
assert.deepEqual(pairwise({ A: 0.75, B: 0.25 }, { A: 0.25, B: 0.5, same: 0.25 }), { d: 0.375, sure: 0.625 })
export const soloScore = (a, w) => a.correct.noul + a.complete.noul + (w * a.craft.score) / 4
assert.equal(soloScore({ correct: { noul: 1 }, complete: { noul: 0.5 }, craft: { score: 2 } }, 1), 2)

const calib = new Map(readJsonl(join(ROOT, 'results', 'calibration.jsonl')).map(r => [r.id, r]))
const pairs = readJsonl(join(WORK, 'gold', 'pairs.jsonl')).filter(p => calib.has(p.id))
const rows = await pool(pairs, 8, async p => {
  const t = `jv:${p.id}`
  const [ab, ba, ab2, ba2, sg, sb] = await Promise.all([
    ask({ request: p.request, answer_A: p.good, answer_B: p.bad }, PICK, `calib:${p.id}:jev-ab`),
    ask({ request: p.request, answer_A: p.bad, answer_B: p.good }, PICK, `calib:${p.id}:jev-ba`),
    ask({ request: p.request, answer_A: p.good, answer_B: p.bad }, PICK2, `${t}:pick2-ab`),
    ask({ request: p.request, answer_A: p.bad, answer_B: p.good }, PICK2, `${t}:pick2-ba`),
    ask({ request: p.request, answer: p.good }, SOLO, `${t}:solo-good`),
    ask({ request: p.request, answer: p.bad }, SOLO, `${t}:solo-bad`),
  ])
  return { id: p.id, set: p.set, half: half(p.id), opus: calib.get(p.id).opus.verdict, pick: pairwise(ab.pick.probabilities, ba.pick.probabilities), pick2: pairwise(ab2.pick.probabilities, ba2.pick.probabilities), solo: { good: sg, bad: sb } }
})
for (const r of rows) if (r?.error) log(`error: ${r.error}`)
const ok = rows.filter(r => r?.id)

// a variant scored at threshold t: Jev's sign where it is sure enough, else the cached Opus verdict
const judge = {
  pick: r => r.pick, pick2: r => r.pick2,
  ...Object.fromEntries([0.5, 1, 2].map(w => [`solo w${w}`, r => { const d = soloScore(r.solo.good, w) - soloScore(r.solo.bad, w); return { d, sure: Math.abs(d) } }])),
}
const T = { pick: [0.6, 0.7, 0.8, 0.85, 0.9, 0.95], pick2: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9], solo: [0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1] }
function score(rs, f, t) {
  let right = 0, wrong = 0, sent = 0
  for (const r of rs) {
    const j = f(r)
    const v = j.sure >= t && j.d !== 0 ? (j.d > 0 ? 'right' : 'wrong') : (sent++, r.opus)
    if (v === 'right') right++
    else if (v === 'wrong') wrong++
  }
  return { right: right / rs.length, wrong: wrong / rs.length, sent: sent / rs.length }
}
const pct = x => `${Math.round(100 * x)}%`
const tune = ok.filter(r => r.half === 'tune'), test = ok.filter(r => r.half === 'test')
const hard = rs => rs.filter(r => r.set !== 'kotlin-tests')
const lines = ['# Jev question variants in the cascade', '', `${ok.length} gold pairs: tune ${tune.length}, test ${test.length}. Unsure pairs go to the cached Opus verdict.`, '',
  '| Variant | Threshold | Tune right / wrong / to Opus | Test right / wrong / to Opus | Test without Kotlin tests |', '|---|---|---|---|---|']
for (const [name, f] of Object.entries(judge)) for (const t of T[name.split(' ')[0]]) {
  const a = score(tune, f, t), b = score(test, f, t), c = score(hard(test), f, t)
  lines.push(`| ${name} | ${t} | ${pct(a.right)} / ${pct(a.wrong)} / ${pct(a.sent)} | ${pct(b.right)} / ${pct(b.wrong)} / ${pct(b.sent)} | ${pct(c.right)} / ${pct(c.wrong)} / ${pct(c.sent)} |`)
}
const solo1 = judge['solo w1']
lines.push('', `Jev alone (no Opus), all pairs: pick ${pct(ok.filter(r => r.pick.d > 0).length / ok.length)}, pick2 ${pct(ok.filter(r => r.pick2.d > 0).length / ok.length)}, solo w1 ${pct(ok.filter(r => solo1(r).d > 0).length / ok.length)}`)
writeFileSync(join(ROOT, 'results', 'jev-variants.md'), lines.join('\n'))
console.log(lines.join('\n'))
