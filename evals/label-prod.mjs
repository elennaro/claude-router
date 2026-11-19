// Production-investigation label for every per-prompt case: does the prompt ask to debug, review or security-review
// code or a system real users depend on? The owner's rule puts those on Opus high or above, whatever the category.
// Two Opus passes; a case is prod when either says so (a wrong "yes" only makes the gate stricter).
// Usage: node label-prod.mjs  -> labels-prod.jsonl
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, claude, log, pool, readJsonl, writeJsonl } from './lib.mjs'

const SYSTEM = `You label prompts sent to a coding assistant. For each prompt decide "prod": true when it asks to investigate,
debug, diagnose, review or security-review code, config or a system that real users depend on (a production or staging
app, a live service, a shipped product, a team's main codebase), including a review of a change before it ships there.
False for: writing new code or tests, mechanical edits, explanations and questions, learning or toy code, one-off scripts,
and anything that is not about code or systems. When the prompt gives no hint either way, a bug in a project the person
works on counts as true. Answer only with the JSON asked for.`
const SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, prod: { type: 'boolean' } }, required: ['id', 'prod'] } } }, required: ['items'] }

export const merge2 = (a, b) => (a === undefined || b === undefined ? undefined : a || b)
assert.equal(merge2(true, false), true)
assert.equal(merge2(false, false), false)
assert.equal(merge2(undefined, true), undefined)

const cases = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).flatMap(f => readJsonl(join(ROOT, 'cases', f)))
const batches = []
for (let i = 0; i < cases.length; i += 20) batches.push(cases.slice(i, i + 20))
const prompt = b => b.map(c => `<prompt id="${c.id}">\n${c.prompt.slice(0, 3000)}\n</prompt>`).join('\n\n')
const pass = async k => {
  const out = new Map()
  const rows = await pool(batches, 4, b => claude({ model: 'opus', effort: 'medium', system: SYSTEM, prompt: prompt(b), json: SCHEMA, tag: `label-prod:${k}:${b[0].id}`, timeoutMs: 300_000 }))
  for (const r of rows) for (const it of r?.structured?.items ?? []) out.set(it.id, it.prod)
  return out
}
const [a, b] = await Promise.all([pass(0), pass(1)])
const rows = cases.map(c => ({ id: c.id, category: c.category, prod: merge2(a.get(c.id), b.get(c.id)), agree: a.get(c.id) === b.get(c.id) }))
const missing = rows.filter(r => r.prod === undefined)
if (missing.length) log(`no label for ${missing.length}: ${missing.map(r => r.id).join(' ')}`)
writeJsonl(join(ROOT, 'labels-prod.jsonl'), rows)
log(`prod labels: ${rows.filter(r => r.prod).length} of ${rows.length} prod; passes disagree on ${rows.filter(r => !r.agree).length}`)
