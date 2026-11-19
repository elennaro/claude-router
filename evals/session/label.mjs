// Labels each session checkpoint with the right session-check answer: action none/up/down, the model, compact/fresh.
// Opus high and Fable high label independently. Agree = same action and model (kind: Fable's when they differ).
// Disagreement: production-code investigation -> the stronger label; otherwise Fable's (owner, 2026-11-18).
// Usage: node session/label.mjs  -> session/labels.jsonl; gold + rationale written into session/cases/*.jsonl
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RANK, ROOT, WORK, claude, log, pool, readJsonl, writeJsonl } from '../lib.mjs'

const DIR = join(ROOT, 'session', 'cases')
const OUT = join(ROOT, 'session', 'labels.jsonl')
const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl'))
// one item per checkpoint: a plain case is its own checkpoint, a sequence gives seq-01#1, seq-01#2, ...
const checkpoints = c => (c.checkpoints ? c.checkpoints.map((k, i) => ({ id: `${c.id}#${i + 1}`, project: c.project, ...k })) : [c])

const SCHEMA = { type: 'object', properties: { labels: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: ['none', 'up', 'down'] }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] }, kind: { type: 'string', enum: ['compact', 'fresh'] }, prod: { type: 'boolean' }, why: { type: 'string' } }, required: ['id', 'action', 'model', 'kind', 'prod', 'why'] } } }, required: ['labels'] }

const show = k => [
  `### ${k.id} (project: ${k.project}; session on ${k.state.model}, ${k.state.turns} turns, trigger: ${k.state.trigger})`,
  `Recent prompts, oldest first:\n${k.window.prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
  k.window.todos?.length ? `Todo list:\n${k.window.todos.map(t => `[${t.status}] ${t.content}`).join('\n')}` : 'Todo list: none',
  k.window.plan ? `Plan:\n${k.window.plan}` : '',
].filter(Boolean).join('\n')

const brief = items => `You set the right answer for test cases of a "session check" in a model router for Claude Code. One person uses Claude Code all day for software development (a production web app, plus internal scripts and tools) and creative content (video scripts, brand books, image prompts, decks). Their goal: top-quality work at the lowest price that still gets it.

At moments like a compaction, a finished todo list, an approved plan or every 20 turns, the check reads the last prompts the owner typed, the todo list and the plan, and may offer a button to switch the session to another model for the work STILL AHEAD (not the work already done). It never switches by itself. Kinds: "compact" = the same work continues, compact then switch; "fresh" = the next work is unrelated, start a new session on the new model.

For each case give:
- action: "up" (offer a stronger model), "down" (offer a cheaper one) or "none" (offer nothing). model: the model to offer; for none, the current model. kind: compact or fresh (for none, compact).
- prod: true when the work ahead is investigation of production code (debugging, code review or security review of the production web app); internal tools and scripts are not production.
- why: one line.
Rules from the owner:
1. Production-code investigation needs opus or above: never offer sonnet or haiku for it, and offer opus when a cheaper session faces it.
2. Fable is offered only where Anthropic says Fable pays: hours-long agent work, multi-step deep research, analysis carried to a finished document. Otherwise opus is the top.
3. Offering a weaker model than the work ahead needs is the costly mistake. A needless offer is the second mistake: offer a switch only when the remaining work clearly needs another model, and offer down only when you are sure the cheaper model matches the best quality on everything still ahead.
4. Models, cheapest first: haiku (lookups, reformatting, trivial edits), sonnet (well-specified code and writing), opus (multi-step engineering, production code investigation, final copy, judgment calls), fable. Words the audience reads, brand and visual judgment, architecture and security are where quality drops show most.
5. If the owner explicitly asks in the window for a model for the rest of the work, honour it, except never below rule 1.

Anthropic's guidance on choosing a model:
<choosing_a_model>
${readFileSync(join(WORK, 'doc-choosing-a-model.md'), 'utf8')}
</choosing_a_model>

Cases:
${items.map(show).join('\n\n')}`

// resulting model: what the session runs on if the answer is followed; an offer of the current model means none
const norm = (l, cur) => l && (l.action === 'none' || l.model === cur ? { ...l, action: 'none', model: cur } : l)
const result = (l, cur) => (l.action === 'none' ? cur : l.model)
function gold(o, f, cur) {
  if (o && f && o.action === f.action && o.model === f.model) return { action: f.action, model: f.model, kind: f.kind, by: 'agree', why: f.why }
  if (!o || !f) return (o ?? f) ? { ...(o ?? f), by: 'one-label' } : null
  if (o.prod || f.prod) { const s = RANK[result(o, cur)] > RANK[result(f, cur)] ? o : f; return { action: s.action, model: s.model, kind: s.kind, by: `prod-stronger:${s === o ? 'opus' : 'fable'}`, why: s.why } }
  return { action: f.action, model: f.model, kind: f.kind, by: 'fable', why: f.why }
}

const done = new Map(readJsonl(OUT).map(r => [r.id, r]))
await pool(files, 3, async file => {
  const cases = readJsonl(join(DIR, file))
  const items = cases.flatMap(checkpoints)
  if (items.every(k => done.has(k.id)) && !process.env.RELABEL) return log(`skip ${file} (labeled)`)
  const prompt = brief(items)
  const [o, f] = await Promise.all([
    claude({ model: 'opus', effort: 'high', prompt, json: SCHEMA, tag: `sess-label-opus:${file}` }),
    claude({ model: 'fable', effort: 'high', prompt, json: SCHEMA, tag: `sess-label-fable:${file}` }),
  ])
  const pick = (r, k) => { const l = r.structured?.labels?.find(x => x.id === k.id); return norm(l && { action: l.action, model: l.model, kind: l.kind, prod: l.prod, why: l.why }, k.state.model) }
  for (const k of items) {
    const opus = pick(o, k), fable = pick(f, k)
    done.set(k.id, { id: k.id, opus, fable, gold: gold(opus, fable, k.state.model) })
  }
  const withGold = k => { const g = done.get(k.id)?.gold; return { ...k, writerRationale: k.writerRationale ?? k.rationale, gold: g && { action: g.action, model: g.model, kind: g.kind }, rationale: g?.why } }
  writeJsonl(join(DIR, file), cases.map(c => (c.checkpoints ? { ...c, checkpoints: c.checkpoints.map((k, i) => { const { id, project, ...rest } = withGold({ id: `${c.id}#${i + 1}`, project: c.project, ...k }); return rest }) } : withGold(c))))
  log(`${file}: ${items.filter(k => done.get(k.id)?.gold?.by === 'agree').length}/${items.length} agreed`)
})
writeJsonl(OUT, [...done.values()])
