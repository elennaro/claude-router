// Labels each subagent brief with its needed tier: the cheapest model and effort that still does it at top quality.
// Opus high and Fable high label independently. Agree = same model, effort within one step (the higher effort).
// Disagreement: production-code investigation -> the stronger label; otherwise Fable's (owner, 2026-11-18).
// Usage: node subagents/label.mjs  -> subagents/labels.jsonl
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EFFORTS, RANK, ROOT, WORK, claude, log, pool, readJsonl, writeJsonl } from '../lib.mjs'

const CASES = join(ROOT, 'subagents', 'cases.jsonl')
const OUT = join(ROOT, 'subagents', 'labels.jsonl')
const effortDoc = (t => t.slice(t.indexOf('## How effort works'), t.indexOf('## Next steps')))(readFileSync(join(WORK, 'doc-effort.md'), 'utf8'))
const SCHEMA = { type: 'object', properties: { labels: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] }, effort: { type: 'string', enum: EFFORTS }, prod: { type: 'boolean' }, why: { type: 'string' } }, required: ['id', 'model', 'effort', 'prod', 'why'] } } }, required: ['labels'] }

const brief = items => `You set the needed tier for subagent briefs in Claude Code. One person uses Claude Code all day for software development (a production web app, plus internal scripts and tools) and creative content (video scripts, brand books, image prompts, decks). Their goal: top-quality work at the lowest price that still gets it. When the main agent spawns a subagent, a router picks the subagent's model and effort; your label is the answer it should give.

For each brief give the cheapest model and effort that would still do this subagent's task as well as the best model would. The subagent works with tools (reads files, runs commands, searches the web) and returns its result to the main agent.
- Models, cheapest first: haiku, sonnet, opus, fable. Efforts, lowest first: ${EFFORTS.join(', ')}.
- prod: true when the task is investigation of production code (debugging, code review or security review of the production web app); internal tools and scripts are not production.
- Owner rules: production-code investigation needs opus at high effort or above, never sonnet or haiku. Fable only where Anthropic says it pays (hours-long agent work, multi-step deep research, analysis carried to a finished document). Sending work to a weaker model than it needs is the costly mistake.
- Judge the task, not how the brief sounds: "quick look" can be hard, "thorough" can be trivial. A brief too short to say what the task is needs the tier of the parent's likely task; say so.
- why: one line.

Anthropic's guidance on choosing a model and an effort level:
<choosing_a_model>
${readFileSync(join(WORK, 'doc-choosing-a-model.md'), 'utf8')}
</choosing_a_model>
<effort>
${effortDoc}
</effort>

Briefs:
${items.map(c => `### ${c.id} (agent type: ${c.agentType}; project: ${c.project}; parent on ${c.parentModel})\n${c.brief}`).join('\n\n')}`

const step = e => EFFORTS.indexOf(e)
const stronger = (a, b) => (RANK[a.model] - RANK[b.model] || step(a.effort) - step(b.effort)) >= 0 ? a : b
// Fable is never automatic (owner rule 2) and a subagent has no button, so a Fable label scores as Opus at that effort.
const need = (o, f) => { const n = rawNeed(o, f); return n?.model === 'fable' ? { ...n, model: 'opus', wanted: 'fable' } : n }
function rawNeed(o, f) {
  if (!o || !f) return null
  if (o.model === f.model && Math.abs(step(o.effort) - step(f.effort)) <= 1) return { model: o.model, effort: EFFORTS[Math.max(step(o.effort), step(f.effort))], by: 'agree' }
  if (o.prod || f.prod) { const s = stronger(o, f); return { model: s.model, effort: s.effort, by: `prod-stronger:${s === o ? 'opus' : 'fable'}` } }
  return { model: f.model, effort: f.effort, by: 'fable' }
}

const cases = readJsonl(CASES)
const done = new Map(readJsonl(OUT).map(r => [r.id, r]))
const todo = cases.filter(c => !done.has(c.id) || process.env.RELABEL)
const batches = []
for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20))
await pool(batches, 2, async (items, b) => {
  const prompt = brief(items)
  const [o, f] = await Promise.all([
    claude({ model: 'opus', effort: 'high', prompt, json: SCHEMA, tag: `sub-label-opus:${b}` }),
    claude({ model: 'fable', effort: 'high', prompt, json: SCHEMA, tag: `sub-label-fable:${b}` }),
  ])
  const pick = (r, id) => { const l = r.structured?.labels?.find(x => x.id === id); return l && { model: l.model, effort: l.effort, prod: l.prod, why: l.why } }
  for (const c of items) { const opus = pick(o, c.id), fable = pick(f, c.id); done.set(c.id, { id: c.id, opus, fable, need: need(opus, fable) }) }
  log(`batch ${b}: ${items.filter(c => done.get(c.id)?.need?.by === 'agree').length}/${items.length} agreed`)
})
writeJsonl(OUT, cases.map(c => done.get(c.id)).filter(Boolean).map(r => ({ ...r, need: need(r.opus, r.fable) })))
