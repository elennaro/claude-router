// Subagent routing report: false cheap (gate), moves off the parent's model, run-to-run instability, every false cheap.
// Usage: node subagents/report.mjs  -> results/subagents-report.md
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EFFORTS, RANK, ROOT, compareTier, readJsonl } from '../lib.mjs'

const cases = new Map(readJsonl(join(ROOT, 'subagents', 'cases.jsonl')).map(c => [c.id, c]))
const labels = new Map(readJsonl(join(ROOT, 'subagents', 'labels.jsonl')).map(l => [l.id, l]))
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
const t = x => `${x.model} ${x.effort}`
const rows = readJsonl(join(ROOT, 'results', 'subagents.jsonl')).map(r => {
  const c = cases.get(r.id), need = labels.get(r.id)?.need
  if (!need) return { c, r, skipped: true }
  const v = r.runs.map(x => compareTier(x, need))
  const l = labels.get(r.id), isProd = Boolean(l.opus?.prod || l.fable?.prod)
  const prod = isProd && r.runs.some(x => RANK[x.model] < RANK.opus || (x.model === 'opus' && EFFORTS.indexOf(x.effort) < EFFORTS.indexOf('high')))
  return { c, r, need, prod, cheap: v.includes('false-cheap'), match: v.filter(x => x === 'match').length >= 2, dear: v.filter(x => x === 'false-dear').length >= 2, moved: r.runs.filter(x => x.moved).length, unstable: new Set(r.runs.map(t)).size > 1 }
}).filter(x => !x.skipped)
const n = rows.length
const runs = rows.reduce((a, x) => a + x.r.runs.length, 0)
const cheap = rows.filter(x => x.cheap)
const kinds = [...new Set(rows.map(x => x.c.kind))]
const md = [
  `# Subagent routing eval`, ``,
  `${n} labeled briefs, ${runs} runs.`, ``,
  `| Gate | Result | Pass mark | |`, `|---|---|---|---|`,
  `| False cheap (any of 3 runs) | ${pct(cheap.length, n)} (${cheap.length}) | 3% or less | ${cheap.length / n <= 0.03 ? 'pass' : 'FAIL'} |`,
  `| Production investigation below Opus high | ${rows.filter(x => x.prod).length} ${rows.filter(x => x.prod).map(x => x.c.id).join(' ')} | 0 | ${rows.some(x => x.prod) ? 'FAIL' : 'pass'} |`,
  `| Unstable (target) | ${pct(rows.filter(x => x.unstable).length, n)} | 15% or less | ${rows.filter(x => x.unstable).length / n <= 0.15 ? 'pass' : 'FAIL'} |`, ``,
  `Moved off the parent's model: ${pct(rows.reduce((a, x) => a + x.moved, 0), runs)} of runs; ${rows.filter(x => x.moved >= 2).length} briefs in 2+ of 3 runs. Unstable (runs differ): ${pct(rows.filter(x => x.unstable).length, n)} (${rows.filter(x => x.unstable).length}). Match (2 of 3): ${pct(rows.filter(x => x.match).length, n)}. False dear (2 of 3): ${pct(rows.filter(x => x.dear).length, n)}.`, ``,
  `## Per kind`, ``,
  `| Kind | Briefs | Moved (runs) | Match | False cheap | False dear | Unstable |`, `|---|---|---|---|---|---|---|`,
  ...kinds.map(k => { const s = rows.filter(x => x.c.kind === k); return `| ${k} | ${s.length} | ${s.reduce((a, x) => a + x.moved, 0)}/${s.reduce((a, x) => a + x.r.runs.length, 0)} | ${s.filter(x => x.match).length} | ${s.filter(x => x.cheap).length} | ${s.filter(x => x.dear).length} | ${s.filter(x => x.unstable).length} |` }), ``,
  `## False cheap briefs`, ``,
  `| Brief | Type | Parent | Sent (3 runs) | Needed | Class | Brief |`, `|---|---|---|---|---|---|---|`,
  ...cheap.map(x => `| ${x.c.id} | ${x.c.agentType} | ${x.c.parentModel} | ${x.r.runs.map(t).join(' / ')} | ${t(x.need)} (${x.need.by}) | ${x.r.runs.map(r => `${r.cls ?? 'none'}${r.sure ? '' : '?'} (${r.by})`).join(' / ')} | ${x.c.brief.slice(0, 80).replace(/[|\n]/g, ' ')} |`), ``,
  `## All briefs`, ``,
  `| Brief | Kind | Type | Sent (3 runs) | Needed | Verdict |`, `|---|---|---|---|---|---|`,
  ...rows.map(x => `| ${x.c.id} | ${x.c.kind} | ${x.c.agentType} | ${x.r.runs.map(t).join(' / ')} | ${t(x.need)} | ${x.cheap ? 'FALSE CHEAP' : x.match ? 'match' : x.dear ? 'dear' : 'mixed'} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'subagents-report.md'), md)
console.log(md)
