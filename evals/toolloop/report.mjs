// Tool-loop report: pass rate, cost and turns per kind and tier, and the Haiku gate.
// Usage: node toolloop/report.mjs  -> results/toolloop-report.md
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readJsonl } from '../lib.mjs'

const rows = readJsonl(join(ROOT, 'results', 'toolloop.jsonl'))
const kinds = [...new Set(rows.map(r => r.kind))]
const tiers = [...new Set(rows.map(r => r.tier))]
const of = (k, t) => rows.filter(r => r.kind === k && r.tier === t)
const rate = rs => (rs.length ? rs.filter(r => r.pass).length / rs.length : NaN)
const p = v => (Number.isNaN(v) ? 'n/a' : `${(100 * v).toFixed(0)}%`)
const avg = (rs, f) => (rs.length ? rs.reduce((a, r) => a + (f(r) ?? 0), 0) / rs.length : 0)
// Haiku keeps a kind when it passes within 5 points of Opus medium on it
const gate = k => rate(of(k, 'haiku-medium')) >= rate(of(k, 'opus-medium')) - 0.05

const md = [
  `# Tool-loop eval`, ``,
  `${rows.length} runs: tasks in a fresh copy of a synthetic repo with real tools, scored by exact checks (no judge).`, ``,
  `| Kind | Tier | Pass | Avg cost | Avg turns | Avg time |`, `|---|---|---|---|---|---|`,
  ...kinds.flatMap(k => tiers.map(t => { const rs = of(k, t); return `| ${k} | ${t} | ${p(rate(rs))} (${rs.filter(r => r.pass).length}/${rs.length}) | $${avg(rs, r => r.usd).toFixed(3)} | ${avg(rs, r => r.turns).toFixed(1)} | ${(avg(rs, r => r.ms) / 1000).toFixed(0)}s |` })),
  ``,
  `| Gate: Haiku within 5 points of Opus medium | Result |`, `|---|---|`,
  ...kinds.filter(k => k !== 'scoped').map(k => `| ${k} | ${gate(k) ? 'pass' : 'FAIL'} |`),
  ``,
  `## Failed runs`, ``,
  `| Task | Tier | Run | Answer (end) |`, `|---|---|---|---|`,
  ...rows.filter(r => !r.pass).map(r => `| ${r.id} | ${r.tier} | ${r.run} | ${r.answer.replace(/[|\n\r]/g, ' ').slice(-120)} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'toolloop-report.md'), md)
console.log(md)
