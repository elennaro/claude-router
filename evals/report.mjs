// Per-prompt report: the release gates in README.md, then where the router goes wrong, per category.
// Usage: node report.mjs  -> results/report.md (and results/report.json for the page)
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { BUILTIN, BUILTIN_PRICE, INVESTIGATION, merge } from '../router/hooks/policy.ts'
import { EFFORTS, RANK, ROOT, WORK, compareTier, evalRouting, readJsonl, spent } from './lib.mjs'

const cfg = merge(BUILTIN, evalRouting())
const MAIN = { model: cfg.main.model, effort: cfg.main.effort }
const OPUS_HIGH = { model: 'opus', effort: 'high' }
const t = x => (x ? `${x.model} ${x.effort}` : '-')
const key = x => `${x.model}-${x.effort}`
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
const p = v => `${(100 * v).toFixed(1)}%`
const lower = (x, y) => RANK[x.model] < RANK[y.model] || (x.model === y.model && EFFORTS.indexOf(x.effort) < EFFORTS.indexOf(y.effort))
// Fable is a button on the main loop, never automatic: a Fable need is met by its effort on Opus when the band offers Fable
// A model or effort the person names in the prompt wins by design: such a run is theirs, not the router's.
const covers = (run, need) => (run.asked ? 'match' : compareTier(run, need.model === 'fable' && run.tip === 'fable' ? { ...need, model: 'opus' } : need))
function majority(rs) {
  const n = {}
  for (const r of rs) n[key(r)] = (n[key(r)] ?? 0) + 1
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]
  return rs.find(r => key(r) === top)
}
// A routed-down tier's quality from the measured replay: the step's FIRST judgment, so the rate compares with the
// noise run (also one judgment per pair); else worse when it sits below the measured need, else unknown.
// "uncertain" counts as worse, as in measure.mjs.
function quality(tier, m) {
  const step = m.steps.find(s => s.cand === key(tier) && s.ref === 'opus-medium')
  if (step) { const v = step.first ?? step.verdict; return v === 'uncertain' ? 'worse' : v }
  return lower(tier, m.need) ? 'worse' : undefined
}
// A pick's measured quality on one case: its tier's judged score against Opus medium on that case (mean over samples),
// else that tier's pooled score over all cases; Opus medium is 0; more effort than high, or Fable, counts as Opus high
// (at least as good); a tier never measured gives undefined.
export function measuredScore(tier, id, rows) {
  const k = tier.model === 'fable' || (tier.model === 'opus' && ['xhigh', 'max'].includes(tier.effort)) ? 'opus-high' : key(tier)
  if (k === 'opus-medium') return 0
  const mine = rows.filter(r => r.cand === k && r.id === id)
  const from = mine.length ? mine : rows.filter(r => r.cand === k)
  return from.length ? from.reduce((a, r) => a + r.score, 0) / from.length : undefined
}
// Replay spend per case and tier from the spend log (seed 0 only); both tag shapes measure.mjs has written.
export function replayCosts(spend) {
  const out = new Map()
  for (const r of spend) {
    const m = /^replay:(.+?)[.:]((?:haiku|sonnet|opus|fable)-[a-z]+)$/.exec(r.tag ?? '')
    if (m && !out.get(m[1])?.has(m[2])) (out.get(m[1]) ?? out.set(m[1], new Map()).get(m[1])).set(m[2], r.usd)
  }
  return out
}
{
  const m = { need: { model: 'sonnet', effort: 'high' }, steps: [{ cand: 'sonnet-high', ref: 'opus-medium', verdict: 'same', first: 'worse' }, { cand: 'sonnet-medium', ref: 'opus-medium', verdict: 'uncertain' }] }
  assert.equal(quality({ model: 'sonnet', effort: 'high' }, m), 'worse')
  assert.equal(quality({ model: 'sonnet', effort: 'medium' }, m), 'worse')
  const rc = replayCosts([{ tag: 'replay:a-01:opus-low', usd: 1 }, { tag: 'replay:a-01.opus-medium', usd: 2 }, { tag: 'replay:a-01.opus-medium.s1', usd: 9 }, { tag: 'replay:a-01.opus-medium', usd: 5 }, { tag: 'measure:a-01:x', usd: 7 }])
  assert.deepEqual([...rc.get('a-01')], [['opus-low', 1], ['opus-medium', 2]])
  const cmT = [{ id: 'a', cand: 'opus-high', score: 1 }, { id: 'a', cand: 'opus-high', score: 0 }, { id: 'b', cand: 'opus-high', score: -1 }, { id: 'b', cand: 'sonnet-high', score: -1 }]
  assert.equal(measuredScore({ model: 'opus', effort: 'high' }, 'a', cmT), 0.5) // the case's own samples
  assert.equal(measuredScore({ model: 'opus', effort: 'xhigh' }, 'c', cmT), 0) // pooled opus-high: (1 + 0 - 1) / 3
  assert.equal(measuredScore({ model: 'opus', effort: 'medium' }, 'a', cmT), 0)
  assert.equal(measuredScore({ model: 'sonnet', effort: 'high' }, 'a', cmT), -1)
  assert.equal(measuredScore({ model: 'haiku', effort: 'low' }, 'a', cmT), undefined)
  assert.equal(quality({ model: 'haiku', effort: 'medium' }, m), 'worse')
  assert.equal(quality({ model: 'opus', effort: 'low' }, m), undefined)
  assert.equal(covers({ model: 'opus', effort: 'high', tip: 'fable' }, { model: 'fable', effort: 'high' }), 'match')
  assert.equal(covers({ model: 'opus', effort: 'high' }, { model: 'fable', effort: 'high' }), 'false-cheap')
  assert.equal(covers({ model: 'haiku', effort: 'medium', asked: true }, { model: 'opus', effort: 'high' }), 'match')
}

// EVAL_RUNS=results/<file>.jsonl scores another classifier's runs (e.g. classifier/narrow.mjs) with the same gates
const RUNS_FILE = process.env.EVAL_RUNS ? resolve(ROOT, process.env.EVAL_RUNS) : join(ROOT, 'results', 'classifier.jsonl')
const OUT = process.env.EVAL_RUNS ? `report-${basename(RUNS_FILE, '.jsonl')}` : 'report'
const runs = new Map(readJsonl(RUNS_FILE).map(r => [r.id, r]))
const cmAll = readJsonl(join(ROOT, 'results', 'class-measure.jsonl'))
const cm = cmAll.filter(r => r.cand !== 'null'), cmNull = cmAll.filter(r => r.cand === 'null')
const prodLabel = new Map(readJsonl(join(ROOT, 'labels-prod.jsonl')).map(l => [l.id, l.prod]))
const isProd = c => prodLabel.get(c.id) ?? INVESTIGATION.includes(c.category)
const atDefault = x => t(x) === t(MAIN) && (!x.cls || (cfg.classes[x.cls]?.model === MAIN.model && !cfg.classes[x.cls]?.effort))
const replay = replayCosts(readJsonl(join(WORK, 'spend.jsonl')))
const cats = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''))
const rows = cats.flatMap(cat => {
  // measured labels (replay + judge) win over the labelers' opinions wherever they exist
  const measured = new Map(readJsonl(join(ROOT, 'labels-measured', `${cat}.jsonl`)).map(l => [l.id, l]))
  const labels = new Map(readJsonl(join(ROOT, 'labels', `${cat}.jsonl`)).map(l => [l.id, measured.get(l.id) ?? l]))
  return readJsonl(join(ROOT, 'cases', `${cat}.jsonl`)).map(c => {
    const r = runs.get(c.id), need = labels.get(c.id)?.need
    if (!r || !need) return { c, skipped: true }
    const verdicts = r.runs.map(x => covers(x, need))
    const top = majority(r.runs)
    const down = lower(top, MAIN)
    return {
      c, r, need, top, down,
      floor: r.runs.some(x => cfg.classes[c.category]?.floor && lower(x, MAIN)),
      // the owner's rule is about the work, not the category: the prod label, the category only where no label exists
      // a run left at the main default follows the project's setting, which a production project raises to Opus high
      // (README); rules are English-only, so an unsure prompt in another language lands here (2026-11-19)
      prod: isProd(c) && r.runs.some(x => !x.asked && lower(x, OPUS_HIGH) && !atDefault(x)),
      prodAtDefault: isProd(c) && r.runs.some(x => !x.asked && lower(x, OPUS_HIGH) && atDefault(x)),
      usd: replay.get(c.id)?.get(key(top)), usdMain: replay.get(c.id)?.get(key(MAIN)),
      stable: new Set(r.runs.map(t)).size === 1,
      cheap: verdicts.includes('false-cheap'), match: verdicts.filter(v => v === 'match').length >= 2, dear: verdicts.filter(v => v === 'false-dear').length >= 2,
      q: down && !top.asked && measured.has(c.id) ? quality(top, measured.get(c.id)) : undefined,
      asked: r.runs.some(x => x.asked), baseCheap: compareTier(MAIN, need) === 'false-cheap',
    }
  })
})
const s = rows.filter(x => !x.skipped)
const n = s.length
const count = f => s.filter(f).length
const noise = readJsonl(join(ROOT, 'results', 'noise.jsonl')).filter(x => x.kind === 'resample')
const noiseWorse = noise.filter(x => x.verdict === 'worse' || x.verdict === 'uncertain').length / (noise.length || 1) // as quality() counts
const judged = s.filter(x => x.q)
const worse = judged.filter(x => x.q === 'worse').length / (judged.length || 1)
const better = judged.filter(x => x.q === 'better').length / (judged.length || 1)
const price = x => BUILTIN_PRICE[x.model][1]
const cost = s.reduce((a, x) => a + price(x.top), 0) / (n * price(MAIN) || 1)
// measured spend: the routed tier's replay against Opus medium's on the same prompt (effort counts here)
const costed = s.filter(x => x.usd !== undefined && x.usdMain !== undefined)
const spendRatio = costed.reduce((a, x) => a + x.usd, 0) / (costed.reduce((a, x) => a + x.usdMain, 0) || 1)
const MIN_N = 20 // fewer measured cases than this and a rate means little
// measured quality (class-measure.jsonl): the router's pick on each case scored against always-Opus-medium
const scored = s.map(x => measuredScore(x.top, x.c.id, cm)).filter(v => v !== undefined)
const measured = scored.reduce((a, v) => a + v, 0) / (scored.length || 1)
const nul = cmNull.reduce((a, r) => a + r.score, 0) / (cmNull.length || 1)
const gates = [
  { name: 'Floor downgrades', hard: true, result: String(count(x => x.floor)), mark: '0', pass: count(x => x.floor) === 0 },
  { name: 'Production investigation below Opus high', hard: true, result: String(count(x => x.prod)), mark: '0', pass: count(x => x.prod) === 0 },
  { name: 'Production investigation left at the main default (Opus high once the project sets it)', hard: false, result: String(count(x => x.prodAtDefault)), mark: 'report', pass: true },
  { name: `Measured quality vs always ${t(MAIN)} (${scored.length} cases scored)`, hard: true, result: `${measured >= 0 ? "+" : ""}${p(measured)}`, mark: `-5.0% or better (the null pair sits at ${p(nul)})`, pass: scored.length >= 100 && measured >= -0.05 },
  // always-Opus-medium scores 0 at 100% spend and fails here: the router has to buy quality or save money
  { name: 'Adds value: better quality or lower spend', hard: true, result: `${p(measured)} quality, ${p(spendRatio)} spend`, mark: 'quality +5.0% or more, or spend 90.0% or less', pass: measured >= 0.05 || (costed.length >= MIN_N && spendRatio <= 0.9) },
  { name: `Measured spend vs always ${t(MAIN)} (${costed.length} cases replayed at both)`, hard: false, result: p(spendRatio), mark: 'report', pass: true },
  { name: 'False cheap vs per-case labels (any of 3 runs; labels are noisy)', hard: false, result: pct(count(x => x.cheap), n), mark: `report (always ${t(MAIN)}: ${pct(count(x => x.baseCheap), n)})`, pass: true },
  { name: 'Unstable', hard: false, result: pct(count(x => !x.stable), n), mark: '15% or less', pass: count(x => !x.stable) / n <= 0.15 },
  { name: 'False dear (2 of 3 runs)', hard: false, result: pct(count(x => x.dear), n), mark: '30% or less', pass: count(x => x.dear) / n <= 0.3 },
  { name: 'Cost vs all Opus medium (model price only)', hard: false, result: p(cost), mark: 'report', pass: true },
]

const md = [
  `# Per-prompt eval`,
  ``,
  `${n} labeled cases of ${rows.length}; ${count(x => x.down)} routed below ${t(MAIN)}, ${judged.length} of them with a measured replay. Tier match (2 of 3, not gated): ${pct(count(x => x.match), n)}. Spend so far $${spent().toFixed(2)}.`,
  ``,
  `Baseline: always ${t(MAIN)} would be false cheap on ${pct(count(x => x.baseCheap), n)} (label noise plus the cases that truly need more). ${count(x => x.asked)} cases had a model or effort named in the prompt; the person's pick wins by design and is not scored.`,
  ``,
  `| Gate | Result | Pass mark | Kind | |`, `|---|---|---|---|---|`,
  ...gates.map(g => `| ${g.name} | ${g.result} | ${g.mark} | ${g.hard ? 'hard' : 'target'} | ${g.pass ? 'pass' : 'FAIL'} |`),
  ``,
  `## Per category`, ``,
  `| Category | Cases | Match | False cheap | False dear | Unstable | Worse / measured |`, `|---|---|---|---|---|---|---|`,
  ...cats.map(cat => {
    const c = s.filter(x => x.c.category === cat), q = c.filter(x => x.q)
    return `| ${cat} | ${c.length} | ${c.filter(x => x.match).length} | ${c.filter(x => x.cheap).length} | ${c.filter(x => x.dear).length} | ${c.filter(x => !x.stable).length} | ${q.filter(x => x.q === 'worse').length} / ${q.length} |`
  }),
  ``,
  `## Failing cases`, ``,
  `| Case | Why | Sent (3 runs) | Needed | Class | Prompt |`, `|---|---|---|---|---|---|`,
  ...s.filter(x => x.cheap || x.floor || x.prod || x.q === 'worse').map(x =>
    `| ${x.c.id} | ${[x.floor && 'floor', x.prod && 'investigation', x.cheap && 'false cheap', x.q === 'worse' && 'worse'].filter(Boolean).join(', ')} | ${x.r.runs.map(r => t(r) + (r.tip ? ` (+${r.tip})` : '')).join(' / ')} | ${t(x.need)} | ${x.r.runs.map(r => `${r.cls ?? 'none'}${r.sure ? '' : '?'} (${r.by})`).join(' / ')} | ${x.c.prompt.slice(0, 70).replace(/[|\n]/g, ' ')} |`),
].join('\n')

writeFileSync(join(ROOT, 'results', `${OUT}.md`), md)
writeFileSync(join(ROOT, 'results', `${OUT}.json`), JSON.stringify({ gates, n, total: rows.length, spent: spent() }, null, 1))
console.log(md)
