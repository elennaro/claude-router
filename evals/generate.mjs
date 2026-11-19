// Writes 9 eval cases per category with Opus: fresh, generic, anonymized; real prompts only show the shape.
// Usage: node generate.mjs [category ...]   -> evals/cases/<category>.jsonl (committed once the audit passes)
import { join } from 'node:path'
import { BUILTIN, classifyByRules, explicitAsk, isContinuation, merge } from '../router/hooks/policy.ts'
import { ROOT, WORK, claude, log, pool, evalRouting, readJson, readJsonl, writeJsonl } from './lib.mjs'

const CATS = readJson(join(ROOT, 'categories.json'))
const ALL = { ...CATS.classes, ...CATS.groups }
const cfg = merge(BUILTIN, evalRouting())
const mined = readJsonl(join(WORK, 'mined.jsonl'))
const PER = Number(process.env.CASES_PER ?? 9)

// Real prompts that look like the category, plus a few random ones, as shape examples.
function samples(cat, n = 30) {
  const pick = {
    'follow-up': r => isContinuation(r.text) && r.text.length < 60,
    russian: r => /[а-яё]/i.test(r.text),
    'very-short': r => r.text.length < 25,
    'explicit-ask': r => Boolean(explicitAsk(r.text)),
  }[cat] ?? (r => classifyByRules(r.text, cfg) === cat)
  const hits = mined.filter(pick)
  const shuffle = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])
  return [...shuffle(hits).slice(0, n - 8), ...shuffle(mined).slice(0, 8)].map(r => r.text.slice(0, 500))
}

const SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          history: { type: 'array', items: { type: 'object', properties: { user: { type: 'string' }, assistant: { type: 'string' } }, required: ['user', 'assistant'] } },
          project: { type: 'string', enum: ['webapp', 'studio', 'brand', 'plain'] },
          lang: { type: 'string', enum: ['en', 'ru', 'mixed'] },
          shape: { type: 'string', enum: ['from-real', 'synthetic'] },
          fixtures: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
        },
        required: ['prompt', 'project', 'lang', 'shape'],
      },
    },
  },
  required: ['cases'],
}

const brief = (cat, def, examples) => `You write test cases for a model router used by one person who does two kinds of work: software development and creative content (video scripts, social posts, brand books, image-generation prompts, decks). The router reads each prompt and picks the cheapest Claude model and effort that still gives top-quality work.

Write ${PER} test prompts for the category "${cat}".
What the cases must span: ${def.cover}

Here are real prompts from this person, ONLY to show how they phrase things (length, terseness, mixed Russian/English, typos, pasted context). Do not copy them. About half of your cases may follow the shape of one of these ("from-real"), rewritten so nothing of the original content remains; the rest are new ("synthetic").
<examples>
${examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}
</examples>

Anonymity rules (strict):
1. No real person, company, client, brand, product, project, repo, place, URL, email, handle, file path with a user name, price or date from the examples. Replace with realistic generic fakes (e.g. "Northwind", "the booking app", "Maya", "Lisbon" if a city is needed; only well-known world cities like these).
2. Drop rare details that could identify the work (a named campaign, an unusual model setup, a specific episode topic). Use common equivalents.
3. Rewrite signature phrases and slang; keep the task's difficulty and kind.
4. A case must still clearly belong to "${cat}" after anonymizing.

Each case:
- prompt: what the person types. Vary length and difficulty: some trivial, some hard.
- history: only for follow-ups or when the prompt depends on an earlier turn: earlier user turns and a one-line summary of the assistant's reply.
- project: webapp, studio (video content), brand (brand agency) or plain.
- lang: en, ru or mixed; include some Russian where natural.
- fixtures: only if the prompt refers to a file the assistant must read (a log, a draft, a CSV, a small code file). Give a short fake file (under 60 lines) with a relative path. No real data.`

const cats = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL)
await pool(cats, 4, async cat => {
  const out = join(ROOT, 'cases', `${cat}.jsonl`)
  if (readJsonl(out).length && !process.env.REGEN) return log(`skip ${cat} (exists)`)
  const r = await claude({ model: 'opus', effort: 'medium', prompt: brief(cat, ALL[cat], samples(cat)), json: SCHEMA, tag: `generate:${cat}` })
  const cases = (r.structured?.cases ?? []).map((c, i) => ({ id: `${cat}-${String(i + 1).padStart(2, '0')}`, category: cat, ...c }))
  writeJsonl(out, cases)
  log(`${cat}: ${cases.length} cases ($${r.usd.toFixed(3)})`)
})
