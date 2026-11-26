// The local classifier: a softmax layer on potion embeddings, trained on work/classifier/train.jsonl (public data only:
// no Claude output ever trains it), then scored on the eval cases against their category and against what the router
// does today (rules, then Haiku; its recorded answers in results/classifier.jsonl). Free: no model calls.
// Usage: POTION_DIR=<folder> node classifier/train.mjs  -> work/classifier/head.json, results/classifier-local.md
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN, CLASS_LABELS, classifyByRules, merge } from '../../router/hooks/policy.ts'
import { ROOT, WORK, log, readJsonl } from '../lib.mjs'
import { loadPotion } from './potion.mjs'

const SCALE = 16 // unit-length embeddings have tiny parts; scaling keeps the logits in a useful range
const SURE = 0.7 // the plugin's pass cut for Haiku, reused for the local probability

// Multinomial logistic regression, class-weighted, Adam, L2. xs: Float32Array[], ys: label index per row.
export function trainSoftmax(xs, ys, L, { epochs = 40, lr = 0.01, l2 = 1e-4, batch = 64 } = {}) {
  const D = xs[0].length, W = new Float64Array(L * D), b = new Float64Array(L)
  const n = new Array(L).fill(0); for (const y of ys) n[y]++
  const cw = n.map(c => (c ? xs.length / (L * c) : 0))
  const mW = new Float64Array(L * D), vW = new Float64Array(L * D), mb = new Float64Array(L), vb = new Float64Array(L)
  const gW = new Float64Array(L * D), gb = new Float64Array(L), p = new Float64Array(L)
  let t = 0
  const order = xs.map((_, i) => i)
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    for (let s = 0; s < order.length; s += batch) {
      gW.fill(0); gb.fill(0)
      const idx = order.slice(s, s + batch)
      for (const i of idx) {
        const x = xs[i]
        let mx = -Infinity
        for (let k = 0; k < L; k++) { let z = b[k]; for (let d = 0; d < D; d++) z += W[k * D + d] * x[d] * SCALE; p[k] = z; if (z > mx) mx = z }
        let sum = 0; for (let k = 0; k < L; k++) { p[k] = Math.exp(p[k] - mx); sum += p[k] }
        const w = cw[ys[i]]
        for (let k = 0; k < L; k++) { const g = w * (p[k] / sum - (k === ys[i] ? 1 : 0)); gb[k] += g; for (let d = 0; d < D; d++) gW[k * D + d] += g * x[d] * SCALE }
      }
      t++
      const step = (P, G, M, V, j, reg) => {
        const g = G[j] / idx.length + reg * P[j]
        M[j] = 0.9 * M[j] + 0.1 * g; V[j] = 0.999 * V[j] + 0.001 * g * g
        P[j] -= (lr * (M[j] / (1 - 0.9 ** t))) / (Math.sqrt(V[j] / (1 - 0.999 ** t)) + 1e-8)
      }
      for (let j = 0; j < W.length; j++) step(W, gW, mW, vW, j, l2)
      for (let j = 0; j < L; j++) step(b, gb, mb, vb, j, 0)
    }
  }
  return { W: Array.from(W), b: Array.from(b), D, L }
}
export function predict(head, x) {
  const { W, b, D, L } = head, p = new Array(L)
  let mx = -Infinity
  for (let k = 0; k < L; k++) { let z = b[k]; for (let d = 0; d < D; d++) z += W[k * D + d] * x[d] * SCALE; p[k] = z; if (z > mx) mx = z }
  let sum = 0; for (let k = 0; k < L; k++) { p[k] = Math.exp(p[k] - mx); sum += p[k] }
  let best = 0; for (let k = 1; k < L; k++) if (p[k] > p[best]) best = k
  return { k: best, p: p[best] / sum }
}

// Self-check: two separable clusters must come out right.
{
  const xs = [], ys = []
  for (let i = 0; i < 200; i++) { const y = i % 2, v = new Float32Array(4); v[y] = 0.9; v[2 + (i % 2 ? 0 : 1)] = 0.1 * Math.random(); xs.push(v); ys.push(y) }
  const h = trainSoftmax(xs, ys, 2, { epochs: 5 })
  assert.equal(xs.filter((x, i) => predict(h, x).k === ys[i]).length, xs.length)
}

const cfg = merge(BUILTIN, {})
const { embed } = loadPotion()
const train = readJsonl(join(WORK, 'classifier', 'train.jsonl'))
const labels = [...new Set(train.map(r => r.label))].sort()
const held = r => createHash('sha1').update(r.text).digest()[0] < 26 // ~10% held out, the same rows every run
let t0 = Date.now()
const fit = train.filter(r => !held(r)), val = train.filter(held)
const xs = fit.map(r => embed(r.text)), ys = fit.map(r => labels.indexOf(r.label))
log(`embedded ${xs.length} training rows in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${labels.length} labels`)
t0 = Date.now()
const head = { labels, ...trainSoftmax(xs, ys, labels.length) }
log(`trained in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
writeFileSync(join(WORK, 'classifier', 'head.json'), JSON.stringify(head))
const valAcc = val.filter(r => labels[predict(head, embed(r.text)).k] === r.label).length / (val.length || 1)

// The test set: every eval case filed under a router class (group files such as russian or follow-up have no class).
const today = new Map(readJsonl(join(ROOT, 'results', 'classifier.jsonl')).map(r => [r.id, r.runs?.[0]]))
const cases = readdirSync(join(ROOT, 'cases')).filter(f => CLASS_LABELS.includes(f.replace('.jsonl', ''))).flatMap(f => readJsonl(join(ROOT, 'cases', f)))
const per = {}
const tot = { n: 0, local: 0, routerLocal: 0, today: 0, free: 0, freeLocal: 0, freeHaiku: 0, sure: 0, sureOk: 0 }
for (const c of cases) {
  const want = c.category, x = embed(c.prompt), pr = predict(head, x), local = labels[pr.k]
  const rule = classifyByRules(c.prompt, cfg), run = today.get(c.id)
  const row = (per[want] ??= { n: 0, local: 0, routerLocal: 0, today: 0, trained: labels.includes(want) })
  const add = (k, ok) => { if (ok) { row[k]++; tot[k]++ } }
  row.n++; tot.n++
  add('local', local === want)
  add('routerLocal', (rule ?? local) === want)
  add('today', run?.cls === want)
  if (!rule) { // the part the local model would replace: prompts no rule names
    tot.free++
    if (local === want) tot.freeLocal++
    if (run?.cls === want) tot.freeHaiku++
    if (pr.p >= SURE) { tot.sure++; if (local === want) tot.sureOk++ }
  }
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-')

// Strength head: the smallest model size people judged enough (build.mjs: Arena human votes, no pair with a Claude model).
const sRows = readJsonl(join(WORK, 'classifier', 'strength.jsonl'))
const sFit = sRows.filter(r => !held(r)), sVal = sRows.filter(held)
const strength = trainSoftmax(sFit.map(r => embed(r.text)), sFit.map(r => r.need - 1), 3)
writeFileSync(join(WORK, 'classifier', 'strength.json'), JSON.stringify(strength))
const sValOk = sVal.filter(r => predict(strength, embed(r.text)).k + 1 === r.need).length
// Scored against each case's measured need (labels-measured wins over labels/, as in report.mjs); model size only.
const SIZE = { haiku: 1, sonnet: 2, opus: 3, fable: 3 }
const needOf = new Map()
for (const f of readdirSync(join(ROOT, 'labels')).filter(f => f.endsWith('.jsonl'))) {
  const measured = new Map(readJsonl(join(ROOT, 'labels-measured', f)).map(l => [l.id, l.need]))
  for (const l of readJsonl(join(ROOT, 'labels', f))) { const n = measured.get(l.id) ?? l.need; if (n) needOf.set(l.id, SIZE[n.model]) }
}
const allCases = readdirSync(join(ROOT, 'cases')).flatMap(f => readJsonl(join(ROOT, 'cases', f))).filter(c => needOf.has(c.id))
const sTot = { n: 0 }, sAdd = (who, got, want) => { const t = (sTot[who] ??= { ok: 0, cheap: 0, dear: 0 }); if (got === want) t.ok++; else if (got < want) t.cheap++; else t.dear++ }
for (const c of allCases) {
  const want = needOf.get(c.id), run = today.get(c.id)
  if (!run?.model || run.asked) continue // a model named in the prompt wins by design and is not scored
  sTot.n++
  sAdd('today', SIZE[run.model], want)
  sAdd('local', predict(strength, embed(c.prompt)).k + 1, want)
  sAdd('opus', 3, want)
}
const sLine = (name, who) => `| ${name} | ${pct(sTot[who].ok, sTot.n)} | ${pct(sTot[who].cheap, sTot.n)} | ${pct(sTot[who].dear, sTot.n)} |`
const lines = [
  '# Local classifier vs today (rules + Haiku)', '',
  `Model: potion-multilingual-128M + a softmax layer, ${labels.length} labels, ${fit.length} public training rows (no Claude output). Held-out public rows: ${pct(valAcc * val.length, val.length)} right.`, '',
  `Test: ${tot.n} eval cases filed under a router class; "right" means the class the case is filed under.`, '',
  '| | Right |', '|---|---|',
  `| Today: rules, then Haiku (recorded run 1) | ${pct(tot.today, tot.n)} |`,
  `| Rules, then the local model | ${pct(tot.routerLocal, tot.n)} |`,
  `| Local model alone | ${pct(tot.local, tot.n)} |`, '',
  `Prompts no rule names (${tot.free}), the part the local model would take over: Haiku ${pct(tot.freeHaiku, tot.free)}, local ${pct(tot.freeLocal, tot.free)}. Local sure (p >= ${SURE}) on ${tot.sure} of them, ${pct(tot.sureOk, tot.sure)} right when sure.`, '',
  '| Class | Cases | Trained on | Today | Rules + local | Local alone |', '|---|---|---|---|---|---|',
  ...Object.entries(per).sort().map(([c, r]) => `| ${c} | ${r.n} | ${r.trained ? 'yes' : 'no'} | ${pct(r.today, r.n)} | ${pct(r.routerLocal, r.n)} | ${pct(r.local, r.n)} |`),
  '', '## Model size (strength head)', '',
  `Trained on ${sFit.length} Arena prompts with a human vote between two model sizes (no Claude pairs). Held-out: ${pct(sValOk, sVal.length)} right (3 sizes; a coin would get 33%).`, '',
  `Test: ${sTot.n} eval cases with a measured need; size only (small = Haiku, mid = Sonnet, big = Opus or Fable), effort not scored.`, '',
  '| | Right size | Too small (false cheap) | Too big (false dear) |', '|---|---|---|---|',
  sLine('Today: first-prompt model (recorded run 1)', 'today'), sLine('Local strength head', 'local'), sLine('Always Opus', 'opus'),
]
writeFileSync(join(ROOT, 'results', 'classifier-local.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
