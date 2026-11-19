// Writes ~40 subagent briefs with Opus: fresh and anonymized; real briefs (work/briefs-mined.jsonl) only show the shape.
// Usage: node subagents/generate.mjs  -> subagents/cases.jsonl
import { join } from 'node:path'
import { ROOT, WORK, claude, log, readJsonl, writeJsonl } from '../lib.mjs'

const OUT = join(ROOT, 'subagents', 'cases.jsonl')
if (readJsonl(OUT).length && !process.env.REGEN) { log('skip (exists)'); process.exit(0) }
const mined = readJsonl(join(WORK, 'briefs-mined.jsonl'))
const shuffle = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])
const examples = () => shuffle(mined).slice(0, 8).map((b, i) => `Example ${i + 1} (type ${b.type}):\n${b.brief.slice(0, 700)}`).join('\n\n')

const GROUPS = [
  `28 briefs for the generic types "general-purpose" and "claude" (mix them): 4 mechanical (reformat, rename across files, convert a file, split subtitles), 4 explore (find where something is defined, list usages, summarize logs, look something up on the web), 4 code review of PRODUCTION web-app code, 4 debugging of PRODUCTION web-app code (a crash, a failing payment, a race), 2 code review or debugging of an INTERNAL script or tool (not production), 3 docs (README section, slide notes, a spreadsheet tidy-up), 3 research (compare libraries, read several sources and write a finished recommendation, a deep multi-source investigation), 4 scoped code (implement a small specified change, add tests for an existing function, fix a named bug in an internal tool). Make some briefs mislead by their words ("quick look" at a hard production bug, "thorough review" of a trivial rename).`,
  `12 briefs: 5 for custom agent types the owner wrote with no model pinned (invent plausible names like "doc-writer", "test-runner", "copy-judge", "migration-helper", "asset-checker"; their work ranges from trivial to hard, and one writes final audience-facing copy), 4 SHORT briefs to a generic type (2 under 12 characters like "run tests", 2 of 15-60 characters), 3 for the built-in "Explore" type (read-only search; one of them is really a careful investigation of production code dressed as a search). In 2 of the 12 set priorModel (the parent spawns this same brief again because the first run on priorModel fell short) and in 2 others set siblingModel (one of several parallel workflow agents; a sibling already runs on siblingModel).`,
]
const SCHEMA = { type: 'object', properties: { briefs: { type: 'array', items: { type: 'object', properties: { agentType: { type: 'string' }, kind: { type: 'string', enum: ['mechanical', 'explore', 'code-review-prod', 'debugging-prod', 'internal-code', 'docs', 'research', 'scoped-code', 'custom', 'short', 'explore-type'] }, project: { type: 'string', enum: ['webapp', 'internal', 'studio', 'brand'] }, parentModel: { type: 'string', enum: ['sonnet', 'opus', 'fable'] }, brief: { type: 'string' }, priorModel: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, siblingModel: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] } }, required: ['agentType', 'kind', 'project', 'parentModel', 'brief'] } } }, required: ['briefs'] }

const brief = group => `You write test cases for a model router inside Claude Code. When the main agent spawns a subagent, the router may move that subagent to a cheaper or the same model by reading the brief (the prompt the main agent wrote for the subagent). The owner does software development (a production web app, plus internal scripts and tools) and creative content (video scripts, brand books, image prompts, decks).

Here are real briefs from this person's sessions, ONLY to show the shape (length, structure, how the main agent states scope and what to return). Do not copy them; nothing of their content may remain.
<examples>
${examples()}
</examples>

Anonymity rules (strict): no real person, company, client, brand, product, project, repo, place, URL, email, handle, file path with a user name, price or date. Use realistic generic fakes ("Northwind", "the booking app", "src/billing/refund.ts", "Maya"; only well-known world cities like these). Drop rare identifying details.

Write ${group}
Each brief is what the main agent writes: usually 2-15 sentences with paths, scope and what to return; vary length. parentModel is mostly opus, a few sonnet, one fable. project: webapp = production product code, internal = scripts/tools, studio = video content, brand = brand agency.`

const rows = []
for (const [g, group] of GROUPS.entries()) {
  const r = await claude({ model: 'opus', effort: 'medium', prompt: brief(group), json: SCHEMA, tag: `sub-generate:${g}` })
  rows.push(...(r.structured?.briefs ?? []))
  log(`group ${g + 1}: ${r.structured?.briefs?.length ?? 0} briefs ($${r.usd.toFixed(3)})`)
}
writeJsonl(OUT, rows.map((b, i) => ({ id: `sub-${String(i + 1).padStart(2, '0')}`, ...b, parentEffort: 'medium' })))
