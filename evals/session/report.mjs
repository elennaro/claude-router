// Session-check report: the four gates (pooled over all runs, and per run), a per-category table, every checkpoint
// with a wrong answer in any run, and flip-flops on sequences.
// Usage: node session/report.mjs  -> results/session-report.md
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RANK, ROOT, readJsonl } from '../lib.mjs'

const labels = new Map(readJsonl(join(ROOT, 'session', 'labels.jsonl')).map(l => [l.id, l]))
const rows = readJsonl(join(ROOT, 'results', 'session.jsonl')).filter(r => r.gold)
// Fable is a button, never picked automatically (owner rule), as in the subagent gates: a Fable need or offer counts as
// Opus, and an offer of the chat's own model is no offer.
const asOpus = m => (m === 'fable' ? 'opus' : m)
for (const r of rows) {
  r.state.model = asOpus(r.state.model)
  if (r.path) r.path = r.path.map(asOpus)
  for (const k of ['gold', 'router', 'follow']) {
    if (!r[k]?.model) continue
    r[k] = { ...r[k], model: asOpus(r[k].model) }
    if (r[k].action !== 'none' && r[k].model === r.state.model) r[k] = { ...r[k], action: 'none' }
  }
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
const res = (x, cur) => (x.action === 'none' || !x.action ? cur : x.model)
const t = x => (!x.action || x.action === 'none' ? 'none' : `${x.action} ${x.model}${x.kind ? ` (${x.kind})` : ''}`)
for (const r of rows) {
  const g = r.gold, x = r.router, cur = r.state.model
  r.proposed = x.action !== 'none'
  r.correct = r.proposed && x.action === g.action && x.model === g.model
  r.falseDown = r.proposed && RANK[res(x, cur)] < RANK[res(g, cur)]
  r.missedUp = g.action === 'up' && x.action !== 'up'
  r.right = x.action === g.action && (g.action === 'none' || x.model === g.model)
  r.followDown = r.follow?.action && r.follow.action !== 'none' && RANK[r.follow.model] < RANK[res(g, cur)] // following its own offers, it lands cheaper than gold
}
const runs = [...new Set(rows.map(r => r.run))].sort()
const ids = [...new Set(rows.map(r => r.id))]
// A->B->A: the model path with repeats squeezed out returns to a model it left; only counted beyond gold's own path
const flipsIn = path => path.filter((m, i) => i === 0 || m !== path[i - 1]).filter((m, i, p) => i >= 2 && p[i - 2] === m).length
console.assert(flipsIn(['opus', 'sonnet', 'sonnet', 'opus']) === 1 && flipsIn(['opus', 'opus', 'sonnet']) === 0 && flipsIn(['a', 'b', 'a', 'b']) === 2, 'flipsIn self-check')
const seqs = [...new Set(rows.filter(r => r.path).map(r => `${r.case}|${r.run}`))].map(key => {
  const [id, run] = key.split('|')
  const cps = rows.filter(r => r.case === id && String(r.run) === run)
  const gpath = [cps[0].state.model, ...cps.map(r => res(r.gold, r.state.model))]
  return { id, run, path: cps[0].path, gpath, flips: Math.max(0, flipsIn(cps[0].path) - flipsIn(gpath)), goldFlips: flipsIn(gpath) }
})
function gates(rs, ss) {
  const p = rs.filter(r => r.proposed), ups = rs.filter(r => r.gold.action === 'up'), flips = ss.reduce((a, s) => a + s.flips, 0)
  return [
    ['Proposal precision', p.filter(r => r.correct).length, p.length, v => v >= 0.85, '85% or more'],
    ['False downgrade', rs.filter(r => r.falseDown).length, rs.length, v => v <= 0.03, '3% or less'],
    ['Missed upgrade', ups.filter(r => r.missedUp).length, ups.length, v => v <= 0.2, '20% or less'],
    ['Flips on sequences (A->B->A)', flips, null, v => v === 0, '0'],
  ]
}
const show = ([, a, b]) => (b === null ? String(a) : `${pct(a, b)} (${a}/${b})`)
const pooled = gates(rows, seqs)
const perRun = runs.map(run => gates(rows.filter(r => r.run === run), seqs.filter(s => s.run === String(run))))
const ups = rows.filter(r => r.gold.action === 'up')
const unstable = ids.filter(id => new Set(rows.filter(r => r.id === id).map(r => t(r.router))).size > 1)
const cats = [...new Set(rows.map(r => r.category))]
const one = rows.filter(r => r.run === runs[0])
const md = [
  `# Session check eval`, ``,
  `${ids.length} labeled checkpoints (${one.filter(r => !r.path).length} single cases, ${one.filter(r => r.path).length} checkpoints in ${seqs.length / runs.length} sequences) x ${runs.length} runs. Gold: ${one.filter(r => r.gold.action === 'up').length} up (${one.filter(r => r.gold.action === 'up' && r.gold.model === 'fable').length} of them to fable), ${one.filter(r => r.gold.action === 'down').length} down, ${one.filter(r => r.gold.action === 'none').length} none.`, ``,
  `| Gate | All runs | ${runs.map(r => `Run ${r + 1}`).join(' | ')} | Pass mark | |`, `|---|---|${runs.map(() => '---|').join('')}---|---|`,
  ...pooled.map((g, i) => `| ${g[0]} | ${show(g)} | ${perRun.map(pr => show(pr[i])).join(' | ')} | ${g[4]} | ${g[3](g[2] === null ? g[1] : g[2] ? g[1] / g[2] : 1) ? 'pass' : 'FAIL'} |`), ``,
  `- Exact answer (action and model): ${pct(rows.filter(r => r.right).length, rows.length)}. Offers: ${rows.filter(r => r.proposed).length} of ${rows.length}; needless (gold none): ${rows.filter(r => r.proposed && r.gold.action === 'none').length}. Kind right on correct offers: ${pct(rows.filter(r => r.correct && r.router.kind === r.gold.kind).length, rows.filter(r => r.correct).length)}.`,
  `- Missed upgrade by target: to opus ${pct(ups.filter(r => r.missedUp && r.gold.model !== 'fable').length, ups.filter(r => r.gold.model !== 'fable').length)}, to fable ${pct(ups.filter(r => r.missedUp && r.gold.model === 'fable').length, ups.filter(r => r.gold.model === 'fable').length)}.`,
  `- Unstable checkpoints (the router's answer differs between runs): ${unstable.length} of ${ids.length}.`,
  `- Sequences followed with the router's own offers accepted: ${rows.filter(r => r.followDown).length} offers landed cheaper than gold (${[...new Set(rows.filter(r => r.followDown).map(r => `${r.id} run ${r.run + 1}: ${r.follow.from} -> ${r.follow.model}, gold ${res(r.gold, r.state.model)}`))].join('; ') || 'none'}).`,
  `- Unparsed Haiku replies: ${rows.flatMap(r => r.router.replies ?? []).filter(x => !/\b(haiku|sonnet|opus|fable)\s+[01](\.\d+)?\s+(same|new)\b/i.test(x ?? '')).length} of ${rows.flatMap(r => r.router.replies ?? []).length}.`, ``,
  `## Per category (all runs pooled)`, ``,
  `| Category | Checkpoints x runs | Gold up / down / none | Offered | Correct offers | False downgrade | Missed upgrade | Exact |`, `|---|---|---|---|---|---|---|---|`,
  ...cats.map(c => {
    const s = rows.filter(r => r.category === c), o = one.filter(r => r.category === c)
    const k = a => o.filter(r => r.gold.action === a).length
    return `| ${c} | ${s.length} | ${k('up')} / ${k('down')} / ${k('none')} | ${s.filter(r => r.proposed).length} | ${s.filter(r => r.correct).length} | ${s.filter(r => r.falseDown).length} | ${s.filter(r => r.missedUp).length} | ${s.filter(r => r.right).length} |`
  }), ``,
  `## Checkpoints wrong in any run`, ``,
  `| Checkpoint | On | Router (per run) | Gold (label source) | Run-1 samples | Last class | Error |`, `|---|---|---|---|---|---|---|`,
  ...ids.filter(id => rows.some(r => r.id === id && !r.right)).map(id => {
    const rs = rows.filter(r => r.id === id), r = rs[0]
    const errs = [...new Set(rs.map(x => (x.falseDown ? 'FALSE DOWNGRADE' : x.missedUp ? 'missed upgrade' : x.proposed && x.gold.action === 'none' ? 'needless offer' : !x.right ? 'other' : null)).filter(Boolean))]
    return `| ${id} | ${r.state.model} | ${rs.map(x => t(x.router)).join(' / ')} | ${t(r.gold)} (${labels.get(id)?.gold?.by ?? '?'}) | ${(r.router.replies ?? []).map(x => (x ?? 'fail').replace(/[|\n]/g, ' ').slice(0, 22)).join(' / ')} | ${r.lastClass.cls ?? 'none'} | ${errs.join(', ')} |`
  }), ``,
  `## Sequences (following the router's own offers)`, ``,
  `| Sequence | Run | Router path | Gold path | Flips |`, `|---|---|---|---|---|`,
  ...seqs.map(s => `| ${s.id} | ${Number(s.run) + 1} | ${s.path.join(' > ')} | ${s.gpath.join(' > ')} | ${s.flips}${s.goldFlips ? ` (gold has ${s.goldFlips})` : ''} |`),
].join('\n')
writeFileSync(join(ROOT, 'results', 'session-report.md'), md)
console.log(md)
