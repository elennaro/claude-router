// Measured labels (docs/research-eval-design.md): the needed tier is the cheapest one whose answer is judged not
// worse than the reference, found by replay, not by opinion.
//  1. Up: Opus high vs Opus medium. If better, the reference is Opus high, and for the Fable classes Fable high is
//     tried against it the same way.
//  2. Down (reference Opus medium only): Sonnet high, then Sonnet medium, then Haiku medium, each vs the reference;
//     the first one judged worse stops the walk.
// Every step takes two judgments, each on an independent answer of the candidate (seed 0, 1, ...) against the same
// reference answer; when they split, a third decides. One judgment says "worse" 19% of the time on Opus medium
// against itself; two of three wrong by chance about 9%, the same in both directions (the old rule confirmed only
// verdicts that cost more, so the labels leaned cheap). Re-running keeps every judgment already made, re-judges the
// ones the old tie shortcut settled, and only adds what is missing.
// Usage: node measure.mjs [category ...]  -> labels-measured/<category>.jsonl {id, need, steps}
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { answer, judgePair, key, splitWithoutOpus } from './judge.mjs'
import { ROOT, log, pool, readJsonl, writeJsonl } from './lib.mjs'

const T = m => { const [model, effort] = m.split('-'); return { model, effort } }
const FABLE_CLASSES = ['rare-hard', 'final-copy', 'brand-visual', 'architecture']
const DOWN = ['sonnet-high', 'sonnet-medium', 'haiku-medium'].map(T)
const isWorse = v => v === 'worse' || v === 'uncertain'

// the verdict a step counts with: two judgments that point the same way, else undefined (ask another)
export function settle(verdicts, up) {
  const hit = up ? v => v === 'better' : isWorse
  const k = verdicts.filter(hit).length
  if (k >= 2) return up ? 'better' : 'worse'
  if (verdicts.length - k >= 2) return 'same'
  return undefined
}
assert.equal(settle(['same'], false), undefined)
assert.equal(settle(['same', 'better'], false), 'same')
assert.equal(settle(['worse', 'uncertain'], false), 'worse')
assert.equal(settle(['same', 'worse'], false), undefined)
assert.equal(settle(['same', 'worse', 'uncertain'], false), 'worse')
assert.equal(settle(['uncertain', 'better', 'same'], false), 'same')
assert.equal(settle(['better', 'same'], true), undefined)
assert.equal(settle(['better', 'same', 'better'], true), 'better')
assert.equal(settle(['same', 'worse'], true), 'same')
// steps saved before the judgments list: first verdict plus an optional repeat
const judgmentsOf = s => s.judgments ?? [{ verdict: s.first ?? s.verdict, by: s.by, scores: s.scores }, ...(s.repeat ? [s.repeat] : [])]
assert.deepEqual(judgmentsOf({ verdict: 'same', first: 'worse', by: 'fable', scores: [-1, -1], repeat: { verdict: 'same' } }).map(j => j.verdict), ['worse', 'same'])

async function measure(c, prior = []) {
  const steps = []
  const vs = async (cand, ref, up) => {
    const tag = `measure:${c.id}:${key(cand)}-vs-${key(ref)}`
    const old = prior.find(s => s.cand === key(cand) && s.ref === key(ref))
    const pick = j => ({ verdict: j.verdict, by: j.by, scores: j.scores })
    const js = old ? judgmentsOf(old) : []
    for (const [i, j] of js.entries()) if (splitWithoutOpus(j)) js[i] = pick(await judgePair(c, await answer(c, cand, i), await answer(c, ref), `${tag}:rejudge${i || ''}`, j.scores))
    while (settle(js.map(j => j.verdict), up) === undefined) {
      const i = js.length
      js.push(pick(await judgePair(c, await answer(c, cand, i), await answer(c, ref), `${tag}${i ? `:repeat${i > 1 ? i : ''}` : ''}`)))
    }
    const step = { cand: key(cand), ref: key(ref), first: js[0].verdict, verdict: settle(js.map(j => j.verdict), up), judgments: js }
    steps.push(step)
    return step.verdict
  }
  let ref = T('opus-medium')
  if ((await vs(T('opus-high'), ref, true)) === 'better') {
    ref = T('opus-high')
    if (FABLE_CLASSES.includes(c.category) && (await vs(T('fable-high'), ref, true)) === 'better') ref = T('fable-high')
    return { need: ref, steps }
  }
  let need = ref
  for (const cand of DOWN) {
    if (isWorse(await vs(cand, ref, false))) break
    need = cand
  }
  return { need, steps }
}

const all = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''))
const cats = process.argv.slice(2).length ? process.argv.slice(2) : all
await pool(cats, 2, async cat => {
  const out = join(ROOT, 'labels-measured', `${cat}.jsonl`)
  const done = new Map(readJsonl(out).map(r => [r.id, r]))
  // MEASURE_PER=n measures the first n cases of each category, so a spend cap leaves every category covered
  const per = Number(process.env.MEASURE_PER ?? Infinity)
  const todo = readJsonl(join(ROOT, 'cases', `${cat}.jsonl`)).slice(0, per)
  // one case at a time per category keeps the saved file current, so a usage limit loses at most a few cases
  await pool(todo, 3, async c => {
    const before = done.get(c.id)
    const r = await measure(c, before?.steps)
    done.set(c.id, { id: c.id, ...r })
    writeJsonl(out, [...done.values()])
    if (JSON.stringify(before?.steps) !== JSON.stringify(r.steps)) log(`${c.id}: ${key(r.need)} (${r.steps.map(s => `${s.cand}:${s.judgments.map(j => j.verdict).join('/')}>${s.verdict}`).join(' ')})`)
  })
})
