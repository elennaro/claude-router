// Per-class measurement (replaces per-case labels: one case's label is mostly answer-to-answer variance; pooled per
// class, that variance cancels). Every case: each candidate tier against Opus medium, judged by the calibrated cheap
// judge (judge.mjs judgeFast), plus a null pair (a second Opus medium answer against the first) that shows what
// "no difference" looks like under the same judge. Sample 0 of every case runs before any sample 1, so a spend cap
// leaves every category covered. Results append as they come; a re-run only adds what is missing.
// Usage: node measure-class.mjs   env SAMPLES (default 2), DRY=1 counts the answers still to generate
//   -> results/class-measure.jsonl {id, category, cand, seed, score, by}
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { answer, hasAnswer, judgeFast, key } from './judge.mjs'
import { OfflineMiss, ROOT, appendJsonl, log, pool, readJsonl } from './lib.mjs'

const T = m => { const [model, effort] = m.split('-'); return { model, effort } }
const REF = T('opus-medium')
const CANDS = ['opus-high', 'opus-low', 'sonnet-high', 'haiku-medium'].map(T)
const SAMPLES = Number(process.env.SAMPLES ?? 2)
const OUT = process.env.MEASURE_OUT ?? join(ROOT, 'results', 'class-measure.jsonl') // EVAL_OFFLINE=1 MEASURE_OUT=x rebuilds it from the store for $0
const done = new Set(readJsonl(OUT).map(r => `${r.id}|${r.cand}|${r.seed}`))

const cats = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl'))
const byCat = cats.map(f => readJsonl(join(ROOT, 'cases', f)))
// round-robin over categories, so any prefix of the job list is spread evenly
const cases = Array.from({ length: Math.max(...byCat.map(x => x.length)) }, (_, i) => byCat.map(x => x[i]).filter(Boolean)).flat()
const jobs = []
for (let seed = 0; seed < SAMPLES; seed++) for (const c of cases) {
  if (seed === 0) jobs.push({ c, cand: REF, seed: 1, refSeed: 0, null: true }) // the null pair
  for (const cand of CANDS) jobs.push({ c, cand, seed, refSeed: 0 })
}
const todo = jobs.filter(j => !done.has(`${j.c.id}|${j.null ? 'null' : key(j.cand)}|${j.seed}`))
const has = hasAnswer
log(`${todo.length} of ${jobs.length} judgments to go; answers to generate: ${new Set(todo.flatMap(j => [[j.c, j.cand, j.seed], [j.c, REF, j.refSeed]]).filter(([c, t, s]) => !has(c, t, s)).map(([c, t, s]) => `${c.id}.${key(t)}.${s}`)).size}`)
if (process.env.DRY) process.exit(0)

await pool(todo, 6, async j => {
  const tag = `cm:${j.c.id}:${j.null ? 'null' : key(j.cand)}:${j.seed}`
  let r
  try { r = await judgeFast(j.c, await answer(j.c, j.cand, j.seed), await answer(j.c, REF, j.refSeed), tag) } catch (e) {
    if (e instanceof OfflineMiss) return // an offline rebuild takes what the store has; jobs never paid for are skipped
    throw e
  }
  appendJsonl(OUT, { id: j.c.id, category: j.c.category, cand: j.null ? 'null' : key(j.cand), seed: j.seed, score: r.score, by: r.by, p: +r.p.toFixed(3) })
})
log('done')
