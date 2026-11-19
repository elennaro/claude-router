// Writes session-check cases with Opus: 8 per category plus sequence cases. Fresh and anonymized; the owner's real
// windows (work/session-windows.jsonl, from mine-windows.mjs) only show the shape.
// Usage: node session/generate.mjs [category ... | sequence]  -> session/cases/<category>.jsonl
import { join } from 'node:path'
import { ROOT, WORK, claude, log, pool, readJsonl, writeJsonl } from '../lib.mjs'

const DIR = join(ROOT, 'session', 'cases')
const CATS = {
  'topic-shift': 'the owner finishes one piece of work and moves to an unrelated one; sometimes the new work needs a different model, sometimes the same one (then nothing should be offered, or only a fresh start on the same model is pointless)',
  'difficulty-drop': 'the work still ahead got clearly easier than the current model (renames, reformatting, small edits, lookups, routine docs) while the session runs on a stronger model',
  'difficulty-rise': 'the work still ahead got clearly harder than the current model (a cheaper session now faces architecture, production debugging, final copy, a hard judgment call)',
  stay: 'the current model fits the work still ahead; nothing should be offered. Include sessions on every model and work that looks like it could move but should not',
  struggle: 'the session is stuck: repeated failing tests, reverts, the owner correcting the model ("no, that is wrong again", "still broken"). Struggle only ever argues for a stronger model, never a cheaper one',
  misleading: 'surface words point the wrong way: "quick" or "small" on hard production work, "deep dive" or "carefully" on trivial formatting, a long todo list of trivial items, a short list of very hard ones, words like "review" on a mechanical task',
  'ru-mixed': 'Russian or mixed Russian/English sessions, spread over all directions (up, down, stay, topic change)',
  'explicit-ask': 'the owner names a model or a tier for the rest of the work inside the window ("let\'s do the rest on sonnet", "дальше на опусе", "switch to the big model for this part"), sometimes sensibly, sometimes on production code where a cheaper model would be wrong',
}

const W = { type: 'object', properties: { prompts: { type: 'array', items: { type: 'string' } }, todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } }, plan: { type: 'string' } }, required: ['prompts'] }
const S = { type: 'object', properties: { model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] }, turns: { type: 'integer' }, trigger: { type: 'string', enum: ['compact', 'todos-done', 'plan', 'periodic'] } }, required: ['model', 'turns', 'trigger'] }
const I = { type: 'object', properties: { action: { type: 'string', enum: ['none', 'up', 'down'] }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] }, kind: { type: 'string', enum: ['compact', 'fresh'] } }, required: ['action', 'model', 'kind'] }
const PROJECT = { type: 'string', enum: ['webapp', 'internal', 'studio', 'brand'] }
const CASES = { type: 'object', properties: { cases: { type: 'array', items: { type: 'object', properties: { project: PROJECT, lang: { type: 'string', enum: ['en', 'ru', 'mixed'] }, window: W, state: S, intent: I, rationale: { type: 'string' } }, required: ['project', 'lang', 'window', 'state', 'intent', 'rationale'] } } }, required: ['cases'] }
const SEQS = { type: 'object', properties: { sequences: { type: 'array', items: { type: 'object', properties: { project: PROJECT, lang: { type: 'string', enum: ['en', 'ru', 'mixed'] }, story: { type: 'string' }, checkpoints: { type: 'array', items: { type: 'object', properties: { window: W, state: S, intent: I, rationale: { type: 'string' } }, required: ['window', 'state', 'intent', 'rationale'] } } }, required: ['project', 'lang', 'story', 'checkpoints'] } } }, required: ['sequences'] }

const mined = readJsonl(join(WORK, 'session-windows.jsonl'))
const shuffle = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])
const examples = (ru, n = 6) => shuffle(mined.filter(w => !ru || w.prompts.some(p => /[а-яё]/i.test(p)))).slice(0, n)
  .map((w, i) => `Example ${i + 1} (trigger ${w.trigger}, ${w.turns} turns):\n${w.prompts.map((p, k) => `  ${k + 1}. ${p.slice(0, 300)}`).join('\n')}${w.todos ? `\n  todos:\n${w.todos.split('\n').slice(0, 10).map(t => `    ${t.slice(0, 160)}`).join('\n')}` : ''}`).join('\n\n')

const COMMON = `You write test cases for a model router inside Claude Code, used all day by one person for software development (a production web app, plus internal scripts and tools) and creative content (video scripts, brand books, image prompts, decks). Besides routing each prompt, the router runs a "session check" at moments like after a compaction, when a todo list is finished, when a plan is approved, or every 20 turns. The check sees only: the last 2-8 prompts the owner typed (oldest first), the current todo list, the approved plan, the current model, the turn count and the trigger. It judges the work STILL AHEAD and may offer a button: switch up or down to another model, either after compacting ("compact": same work continues) or in a new session ("fresh": unrelated work). It never switches by itself. Models, cheapest first: haiku, sonnet, opus, fable. The default session model is opus.

Owner rules the right answer must follow: investigating production code (debugging, code review, security review of the web app) needs opus or above, never sonnet or haiku; internal tools and scripts are not production. Fable is offered only for hours-long agent work, deep research, or analysis carried to a finished deliverable. Sending work to a weaker model than it needs is the costly mistake; a needless offer is the second mistake (it trains the owner to ignore the button).

Here are real windows from this person, ONLY to show how sessions look (prompt length, terseness, mixed Russian/English, typos, todo phrasing). Do not copy them; nothing of their content may remain.
<examples>
EXAMPLES
</examples>

Anonymity rules (strict): no real person, company, client, brand, product, project, repo, place, URL, email, handle, file path with a user name, price or date from the examples. Use realistic generic fakes ("Northwind", "the booking app", "Maya", "Lisbon"; only well-known world cities like these). Drop rare identifying details; rewrite signature phrases and slang.

For every case give: project (webapp = production product code, internal = scripts/tools, studio = video content, brand = brand agency), lang, window (prompts as typed, 2-8 of them; todos only when a list exists, with statuses; plan only for a plan trigger), state (model, turns, trigger), intent (the right answer: action none/up/down, the model to offer — for none give the current model — and kind compact or fresh; for none give compact) and a one-line rationale. Make the window carry the evidence: the check sees nothing else.`

async function cases(cat) {
  const out = join(DIR, `${cat}.jsonl`)
  if (readJsonl(out).length && !process.env.REGEN) return log(`skip ${cat} (exists)`)
  const prompt = `${COMMON.replace('EXAMPLES', examples(cat === 'ru-mixed'))}\n\nWrite 8 cases for the category "${cat}": ${CATS[cat]}.\nSpread the current model (mostly opus, some sonnet, a few haiku or fable), the triggers and the projects. Vary difficulty, include borderline ones. About a third may be in Russian or mixed where natural.`
  const r = await claude({ model: 'opus', effort: 'medium', prompt, json: CASES, tag: `sess-generate:${cat}` })
  const rows = (r.structured?.cases ?? []).map((c, i) => ({ id: `${cat}-${String(i + 1).padStart(2, '0')}`, category: cat, ...c }))
  writeJsonl(out, rows)
  log(`${cat}: ${rows.length} cases ($${r.usd.toFixed(3)})`)
}

async function sequences(part) {
  const out = join(DIR, `sequence-${part}.jsonl`)
  if (readJsonl(out).length && !process.env.REGEN) return log(`skip sequence-${part} (exists)`)
  const prompt = `${COMMON.replace('EXAMPLES', examples(part === 2))}\n\nWrite 5 SEQUENCE cases: one session checked at 3 or 4 checkpoints, in order, 8-30 turns apart. They test flip-flopping (offering A, then B, then A again). Make the difficulty wobble near a boundary: a hard task with a mechanical stretch in the middle, an easy task with one tricky step, a topic change and a return, a struggle that resolves. The right path switches at most once over the whole sequence, or never. Each checkpoint's state.model is the model the session runs on at that point if the owner accepted every right offer before it. Each checkpoint has its own full window (the last prompts at that point, which overlap with the previous checkpoint's). ${part === 2 ? 'Write at least 3 of the 5 in Russian or mixed.' : 'Mostly English.'} Give a one-line story per sequence.`
  const r = await claude({ model: 'opus', effort: 'medium', prompt, json: SEQS, tag: `sess-generate:sequence-${part}` })
  const rows = (r.structured?.sequences ?? []).map((s, i) => ({ id: `seq-${String((part - 1) * 5 + i + 1).padStart(2, '0')}`, category: 'sequence', ...s }))
  writeJsonl(out, rows)
  log(`sequence-${part}: ${rows.length} sequences ($${r.usd.toFixed(3)})`)
}

const want = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(CATS), 'sequence']
await pool(want.flatMap(w => (w === 'sequence' ? [1, 2] : [w])), 5, w => (typeof w === 'number' ? sequences(w) : cases(w)))
