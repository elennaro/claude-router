// Acceptance eval (2026-11-19): does a tier's answer pass the person's definition of done? The side-by-side eval asked
// "is it as good as Opus medium", where the judge picks a side even between two Opus answers (36% "worse" on the null
// pair), so every cheaper tier looked worse. Here each answer is graded alone against a checklist written from the
// request only, by a grader that is not told the model. A tier fits a category when it is accepted about as often as
// Opus medium; the second Opus medium sample shows how much that moves by chance.
// Usage: node accept.mjs   (env EVAL_CAP_USD, EVAL_OFFLINE=1 for a $0 rebuild, ACCEPT_TIERS, ACCEPT_CATS, LIMIT,
//   ACCEPT_IDS=<case list json> to grade exactly those cases in that order, ACCEPT_GRADER=sonnet-medium for another
//   grader, ACCEPT_OUT=<name> for results/<name>*.{jsonl,md} instead of accept*, DRY=1 to count what is not cached)
//   -> results/accept-checklists.jsonl, results/accept.jsonl, results/accept-report.md
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CASES as OWN } from './accept/cases.mjs'
import { answer, hasAnswer, key } from './judge.mjs'
import { CapReached, ROOT, cacheGet, cacheKey, claude, log, pool, readJsonl, writeJsonl } from './lib.mjs'

const T = m => { const [model, effort] = m.split('-'); return { model, effort } }
// graded tiers; s1 is Opus medium's second answer, the chance yardstick
// in the order a spend cap should keep them: what the Sonnet decision needs first
const ALL_TIERS = [['opus-medium', 0], ['sonnet-medium', 0], ['sonnet-high', 0], ['opus-medium', 1], ['opus-high', 0], ['haiku-medium', 0], ['sonnet-low', 0]]
// ACCEPT_TIERS=opus-medium,sonnet-medium and ACCEPT_CATS=docs,explore narrow a run; answers and grades come from the store
const only = v => (process.env[v] ? process.env[v].split(',') : undefined)
const TIERS = ALL_TIERS.filter(([t, s]) => !only('ACCEPT_TIERS') || only('ACCEPT_TIERS').includes(s ? `${t}.s${s}` : t))
const WRITER = { model: 'opus', effort: 'high' }
const GRADER = process.env.ACCEPT_GRADER ? T(process.env.ACCEPT_GRADER) : { model: 'opus', effort: 'medium' }
const NAME = process.env.ACCEPT_OUT ?? 'accept'

const fromCases = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => readJsonl(join(ROOT, 'cases', f)))
// round-robin over categories, so a spend cap still leaves every category covered
const mixed = Array.from({ length: Math.max(...fromCases.map(x => x.length)) }, (_, i) => fromCases.map(x => x[i]).filter(Boolean)).flat()
const byId = new Map(mixed.map(c => [c.id, c]))
const listed = process.env.ACCEPT_IDS && JSON.parse(readFileSync(process.env.ACCEPT_IDS, 'utf8')).cases.map(x => byId.get(x.id))
const CASES = (listed || [...OWN, ...mixed]).filter(c => !only('ACCEPT_CATS') || only('ACCEPT_CATS').includes(c.category)).slice(0, Number(process.env.LIMIT ?? Infinity)) // LIMIT: a pilot on the first few

const request = c => [
  ...(c.history ?? []).map(h => `[earlier] user: ${h.user}\n[earlier] assistant: ${h.assistant}`),
  c.prompt,
  ...(c.fixtures ?? []).map(f => `--- file ${f.path} ---\n${f.content}`),
].join('\n')

const LIST = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 } }, required: ['items'] }
const checklistPrompt = c => `Write the acceptance checklist for the request below: the 3 to 6 things an answer must get right for this person to accept it as done, without asking for a redo. Only must-haves that follow from the request, its files and what any competent expert would treat as required: correctness, every explicit instruction, the asked-for format and language. No nice-to-haves, no style the person did not ask for, nothing about length. One checkable sentence per item.

The answer was written in a replay: the assistant could read the files and search the web but not edit files or run commands, so showing the exact changes counts as doing them.

<request>
${request(c)}
</request>`

const GRADE = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: { pass: { type: 'boolean' }, why: { type: 'string' } }, required: ['pass', 'why'] } },
    accept: { type: 'boolean' },
  },
  required: ['items', 'accept'],
}
const gradePrompt = (c, items, a) => `Grade one answer against the person's acceptance checklist. For each item in order: pass or fail, with a short quote or reason. Fail an item only for a real miss: a wrong fact, broken code, an instruction not followed, a missing part. Wording you would phrase differently is not a miss. Then say whether this person would accept the answer as done without asking for a redo.

The answer was written in a replay: it could read files and search the web but not edit files or run commands, so showing the exact changes counts as doing them.

<request>
${request(c)}
</request>

<checklist>
${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}
</checklist>

<answer>
${a}
</answer>`

async function checklist(c) {
  const r = await claude({ ...WRITER, prompt: checklistPrompt(c), json: LIST, cache: true, tag: `accept-list:${c.id}`, timeoutMs: 300_000 })
  return r.structured.items
}

if (listed && listed.some(c => !c)) throw new Error(`${process.env.ACCEPT_IDS} names a case that is not in cases/`)
if (process.env.DRY) {
  const hit = o => cacheGet(cacheKey(o)) !== undefined
  let lists = 0, grades = 0, answers = 0
  for (const c of CASES) {
    const l = cacheGet(cacheKey({ ...WRITER, prompt: checklistPrompt(c), json: LIST }))
    if (!l) lists++
    for (const [tier, seed] of TIERS) {
      if (!hasAnswer(c, T(tier), seed)) { answers++; grades++ }
      else if (!l || !hit({ ...GRADER, prompt: gradePrompt(c, l.structured.items, (await answer(c, T(tier), seed))), json: GRADE })) grades++
    }
  }
  log(`${CASES.length} cases, grader ${key(GRADER)}: to buy ${lists} checklists, ${answers} answers, ${grades} grades`)
  process.exit(0)
}

const lists = new Map()
const rows = []
let stop
// checklists first (every grade needs one), then grades tier by tier, so a cap leaves whole tiers graded
await pool(CASES, 6, async c => { lists.set(c.id, await checklist(c)) }).catch(e => { if (e instanceof CapReached) stop = e; else throw e })
for (const [tier, seed] of stop ? [] : TIERS) {
  await pool(CASES.filter(c => lists.has(c.id)), 6, async c => {
    const items = lists.get(c.id)
    const a = await answer(c, T(tier), seed)
    const r = await claude({ ...GRADER, prompt: gradePrompt(c, items, a), json: GRADE, cache: true, tag: `accept-grade:${c.id}:${tier}:${seed}`, timeoutMs: 300_000 })
    const g = r.structured
    rows.push({ id: c.id, category: c.category, tier: seed ? `${tier}.s${seed}` : tier, accept: g.accept, passed: g.items.filter(x => x.pass).length, of: items.length, fails: g.items.map((x, i) => (x.pass ? null : `${i + 1}: ${x.why}`)).filter(Boolean) })
  }).catch(e => { if (e instanceof CapReached) stop = e; else throw e })
  if (stop) break
}

writeJsonl(join(ROOT, 'results', `${NAME}-checklists.jsonl`), CASES.filter(c => lists.has(c.id)).map(c => ({ id: c.id, items: lists.get(c.id) })))
writeJsonl(join(ROOT, 'results', `${NAME}.jsonl`), rows.sort((a, b) => a.id.localeCompare(b.id) || a.tier.localeCompare(b.tier)))

// ---- report ----
const tiers = TIERS.map(([t, s]) => (s ? `${t}.s${s}` : t))
const cats = [...new Set(CASES.map(c => c.category))]
const cell = (rs, t) => {
  const x = rs.filter(r => r.tier === t)
  return x.length ? `${x.filter(r => r.accept).length}/${x.length}` : '-'
}
const pct = (rs, t) => { const x = rs.filter(r => r.tier === t); return x.length ? Math.round((100 * x.filter(r => r.accept).length) / x.length) : NaN }
const items = (rs, t) => { const x = rs.filter(r => r.tier === t); const of = x.reduce((a, r) => a + r.of, 0); return of ? Math.round((100 * x.reduce((a, r) => a + r.passed, 0)) / of) : NaN }
// accepted-rate difference from Opus medium on the cases both tiers were graded on, in points, with n
function paired(t) {
  const ids = new Set(rows.filter(r => r.tier === t).map(r => r.id))
  const ref = rows.filter(r => r.tier === 'opus-medium' && ids.has(r.id))
  const x = rows.filter(r => r.tier === t && ref.some(o => o.id === r.id))
  if (!x.length || t === 'opus-medium') return '-'
  const d = Math.round((100 * (x.filter(r => r.accept).length - ref.filter(r => r.accept).length)) / x.length)
  return `${d > 0 ? '+' : ''}${d} (n${x.length})`
}
const lines = [
  '# Acceptance eval',
  '',
  `${lists.size} cases, ${rows.length} graded answers. Each answer graded alone against a checklist written from the request (writer ${key(WRITER)}, grader ${key(GRADER)}, model not shown). Cells: answers the person would accept as done / graded. ${stop ? `Stopped early: ${stop.message}.` : ''}`,
  '',
  '## All cases',
  '',
  `| | ${tiers.join(' | ')} |`,
  `|---|${tiers.map(() => '---').join('|')}|`,
  `| accepted | ${tiers.map(t => `${pct(rows, t)}%`).join(' | ')} |`,
  `| checklist items passed | ${tiers.map(t => `${items(rows, t)}%`).join(' | ')} |`,
  `| vs Opus medium, same cases | ${tiers.map(t => paired(t)).join(' | ')} |`,
  '',
  'The last row compares each tier with Opus medium on the cases both were graded on (a capped tier covers fewer). The opus-medium.s1 column is the chance yardstick: the same tier again.',
  '',
  '## Per category',
  '',
  `| Category | ${tiers.join(' | ')} |`,
  `|---|${tiers.map(() => '---').join('|')}|`,
  ...cats.map(k => `| ${k} | ${tiers.map(t => cell(rows.filter(r => r.category === k), t)).join(' | ')} |`),
  '',
  '## Not accepted: Sonnet where Opus medium was accepted',
  '',
  '| Case | Tier | Failed items |',
  '|---|---|---|',
  ...rows.filter(r => r.tier.startsWith('sonnet') && !r.accept && rows.find(o => o.id === r.id && o.tier === 'opus-medium')?.accept)
    .map(r => `| ${r.id} | ${r.tier} | ${r.fails.join('; ').replace(/\|/g, '/').slice(0, 300)} |`),
]
writeFileSync(join(ROOT, 'results', `${NAME}-report.md`), lines.join('\n') + '\n')
log(`${NAME}: ${rows.length} grades -> results/${NAME}-report.md`)
if (stop) throw stop
