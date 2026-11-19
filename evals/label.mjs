// Labels each case with its needed tier: the cheapest model and effort that still gives top-quality work.
// Opus and Fable label independently, briefed with the owner's goals and Anthropic's model-choice docs.
// Same model, effort within one step -> agree (the higher effort). Anything else -> the owner decides.
// Usage: node label.mjs [category ...]  -> labels/<category>.jsonl {id, opus, fable, need | null}
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EFFORTS, ROOT, WORK, claude, log, pool, readJsonl, writeJsonl } from './lib.mjs'

const DOCS = {
  'choosing-a-model': ['about-claude/models/choosing-a-model', null],
  effort: ['build-with-claude/effort', ['## How effort works', '## Next steps']],
}

// Anthropic's docs, fetched once per run into work/ (not committed); only the sections that matter.
async function doc(name) {
  const [path, cut] = DOCS[name]
  const file = join(WORK, `doc-${name}.md`)
  const text = existsSync(file) ? readFileSync(file, 'utf8') : await (await fetch(`https://platform.claude.com/docs/en/${path}.md`)).text()
  if (!cut) return text
  const a = text.indexOf(cut[0]), b = text.indexOf(cut[1])
  return a < 0 ? text : text.slice(a, b < 0 ? undefined : b)
}

const SCHEMA = { type: 'object', properties: { labels: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] }, effort: { type: 'string', enum: EFFORTS }, why: { type: 'string' } }, required: ['id', 'model', 'effort', 'why'] } } }, required: ['labels'] }

const show = c => [
  `### ${c.id} (project: ${c.project})`,
  ...(c.history ?? []).map(h => `[earlier] user: ${h.user}\n[earlier] assistant: ${h.assistant}`),
  `user: ${c.prompt}`,
  ...(c.fixtures ?? []).map(f => `--- file ${f.path} ---\n${f.content}`),
].join('\n')

const brief = (docs, cases) => `You set the needed tier for test prompts. They come from one person who uses Claude Code all day for software development and creative content (video scripts, social posts, brand books, image-generation prompts, decks). Their goal: keep the work at top quality and pay the lowest price that still gets it. A router will pick the model and effort for each prompt; your label is the answer it should give.

For each prompt, give the cheapest model and effort that would still do this task as well as the best model would: the owner would see no drop in quality. Cheaper models are fine wherever they truly match; a quality drop on work that matters is not.
- Models, cheapest first: haiku, sonnet, opus, fable. Efforts, lowest first: ${EFFORTS.join(', ')}.
- The model works inside Claude Code with tools: it reads files, runs commands, searches the web.
- Judge the task itself, not how long or confident the prompt sounds. A short prompt can be hard; a long paste can be trivial.
- Follow-ups ("ok do it", "давай") need the tier of the task they continue, which is in the earlier turns.
- If the prompt explicitly asks for a model or effort ("use opus", "think hard", "на хайку"), the needed tier is exactly what was asked.
- Words the audience reads (final copy, scripts), brand and visual judgment, architecture and security are where quality drops show most.

Anthropic's guidance on choosing a model and an effort level:
<choosing_a_model>
${docs[0]}
</choosing_a_model>
<effort>
${docs[1]}
</effort>

Prompts:
${cases.map(show).join('\n\n')}`

const step = e => EFFORTS.indexOf(e)
function agree(a, b) {
  if (!a || !b || a.model !== b.model || Math.abs(step(a.effort) - step(b.effort)) > 1) return null
  return { model: a.model, effort: EFFORTS[Math.max(step(a.effort), step(b.effort))] }
}

const docs = [await doc('choosing-a-model'), await doc('effort')]
const all = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''))
const cats = process.argv.slice(2).length ? process.argv.slice(2) : all
await pool(cats, 3, async cat => {
  const out = join(ROOT, 'labels', `${cat}.jsonl`)
  const cases = readJsonl(join(ROOT, 'cases', `${cat}.jsonl`))
  const done = readJsonl(out)
  if (done.length === cases.length && !process.env.RELABEL) return log(`skip ${cat} (labeled)`)
  const prompt = brief(docs, cases)
  const [o, f] = await Promise.all([
    claude({ model: 'opus', effort: 'high', prompt, json: SCHEMA, tag: `label-opus:${cat}` }),
    claude({ model: 'fable', effort: 'high', prompt, json: SCHEMA, tag: `label-fable:${cat}` }),
  ])
  const pick = (r, id) => { const l = r.structured?.labels?.find(x => x.id === id); return l && { model: l.model, effort: l.effort, why: l.why } }
  const rows = cases.map(c => {
    const opus = pick(o, c.id), fable = pick(f, c.id)
    const owner = done.find(d => d.id === c.id)?.owner // the owner's pick from the dispute page survives a relabel
    return { id: c.id, opus, fable, need: owner ?? agree(opus, fable), ...(owner ? { owner } : {}) }
  })
  writeJsonl(out, rows)
  log(`${cat}: ${rows.filter(r => r.need).length}/${rows.length} agreed`)
})
