// Per-class report from measure-class.mjs: for each category and candidate tier, the net score against Opus medium
// (+1 better, -1 worse, 0 same, averaged) with a 95% band, next to the null pair (Opus medium against itself), which
// should sit at 0. A tier "holds" for a category when its band reaches up to the null's level; it "wins" when its
// whole band is above 0.
// Usage: node report-class.mjs  -> results/class-report.md
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readJsonl } from './lib.mjs'

// mean and 95% band of scores in {-1, 0, 1}
export function band(xs) {
  const n = xs.length
  if (!n) return { n, mean: NaN, lo: NaN, hi: NaN }
  const mean = xs.reduce((a, x) => a + x, 0) / n
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1))
  const h = (1.96 * sd) / Math.sqrt(n)
  return { n, mean, lo: mean - h, hi: mean + h }
}
assert.deepEqual(band([1, 1, 1]), { n: 3, mean: 1, lo: 1, hi: 1 })
assert.equal(band([1, -1]).mean, 0)
export const verdict = b => (b.n < 4 ? 'thin' : b.lo > 0 ? 'wins' : b.hi < 0 ? 'loses' : 'holds')
assert.equal(verdict({ n: 10, lo: 0.1, hi: 0.5 }), 'wins')
assert.equal(verdict({ n: 10, lo: -0.5, hi: -0.1 }), 'loses')
assert.equal(verdict({ n: 10, lo: -0.3, hi: 0.2 }), 'holds')

const rows = readJsonl(join(ROOT, 'results', 'class-measure.jsonl'))
const CANDS = ['opus-high', 'opus-low', 'sonnet-high', 'haiku-medium']
const cats = [...new Set(rows.map(r => r.category))].sort()
const f = b => (Number.isNaN(b.mean) ? '-' : `${b.mean >= 0 ? '+' : ''}${Math.round(100 * b.mean)} (${Math.round(100 * b.lo)}..${Math.round(100 * b.hi)}) n${b.n} ${verdict(b)}`)
const of = (cat, cand) => band(rows.filter(r => (cat === 'all' || r.category === cat) && r.cand === cand).map(r => r.score))
const byJudge = Object.entries(Object.groupBy(rows, r => r.by)).map(([k, v]) => `${k} ${v.length}`).join(', ')
const md = [
  '# Per-class measurement', '',
  `${rows.length} judgments (${byJudge}). Cells: net score vs Opus medium in % (95% band), n, verdict. Null = Opus medium against a second Opus medium answer; it should sit near 0.`, '',
  `| Category | Null | ${CANDS.join(' | ')} |`, `|---|---|${CANDS.map(() => '---').join('|')}|`,
  ...[...cats, 'all'].map(cat => `| ${cat === 'all' ? '**all**' : cat} | ${f(of(cat, 'null'))} | ${CANDS.map(c => f(of(cat, c))).join(' | ')} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'class-report.md'), md)
console.log(md)
