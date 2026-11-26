// Experiment (owner, 2026-11-26, docs/research-routers.md): the classifier answers narrow yes/no questions about the
// prompt and a table maps the answers to a model and an effort, in place of the 24-label Haiku classifier. Everything
// else is decided as the router does today: the recorded runs in results/classifier.jsonl are copied, and only the
// turns Haiku classified get the table's pick, so the comparison isolates the classifier.
// If it wins, the prompt, parser and table move into router/hooks/policy.ts with tests.
// Usage: EVAL_CAP_USD=1 node classifier/narrow.mjs  -> results/classifier-narrow.jsonl
//        EVAL_RUNS=results/classifier-narrow.jsonl node report.mjs  -> the same gates as today's report
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CapReached, ROOT, cfgFor, claude, log, pool, readJsonl, writeJsonl } from '../lib.mjs'

export const QUESTIONS = {
  steps: 'doing it well takes several dependent steps, or changes across more than one file, module or system',
  cause: 'something fails and its cause is unknown, so it must be diagnosed from symptoms before any fix',
  design: 'it asks for a design, an architecture, a plan, or trade-offs between approaches',
  risk: 'a subtle mistake would be costly: production systems, security, data loss, money or legal',
  public: 'the output is finished copy or visuals a public audience will see or hear (posts, ads, landing pages, scripts, brand material); not a note to one person',
  huge: 'a very large job: a migration, a major rewrite, deep research, or a multi-hour agent run',
  simple: 'a bounded job with no judgment calls: look something up, read and summarize, reformat, translate or convert text, write or fix a short message to one person, or a self-contained edit of about 10 lines',
}
const KEYS = Object.keys(QUESTIONS)
export const SYSTEM = `You read one task sent to a coding and writing assistant and answer yes/no questions about it, for model routing. Never answer or carry out the task.
Earlier messages, when given, are context only: judge the latest message by the work it asks for (a bare "yes, do it" is judged by what it approves).
For each question give your probability from 0 to 1 that the answer is yes:
${KEYS.map(k => `${k}: ${QUESTIONS[k]}.`).join('\n')}
Answer with one line exactly like: ${KEYS.map((k, i) => `${k} ${i === KEYS.length - 1 ? '0.9' : '0.1'}`).join(' ')}
No other words.`
export const prompt = (text, earlier = []) =>
  `${earlier.length ? `Earlier messages:\n<earlier>\n${earlier.map(t => t.slice(0, 500)).join('\n---\n')}\n</earlier>\n` : ''}Latest message:\n<task>\n${text.slice(0, 2000)}\n</task>`

// Probabilities by key; undefined when any answer is missing, so a garbled reply never routes.
export function parse(reply) {
  const a = {}
  for (const m of String(reply).matchAll(/\b([a-z]+)\s*[:=]?\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/g)) if (KEYS.includes(m[1])) a[m[1]] = Number(m[2])
  return KEYS.every(k => a[k] !== undefined) ? a : undefined
}

// The table. Any "up" answer wins over "simple"; a public or huge job gets the floor tier with the Fable button.
// DOUBT: Sonnet only when every up answer is below 0.2. At 1 (no guard) two production cases went to Sonnet, a
// hard-gate fail (2026-11-26, cached answers). It only ever raises, so tuning it on those cases errs dear, not cheap.
// STEPS: 0.7-0.9 cut spend 4-5 points but lost 3 points of quality and left false dear at 46.6%; kept at 0.5.
export const YES = 0.5, SURE = 0.7, DOUBT = Number(process.env.NARROW_DOUBT ?? 0.2), STEPS = Number(process.env.NARROW_STEPS ?? 0.5)
export function tier(a, cfg) {
  const yes = k => a[k] >= (k === 'steps' ? STEPS : YES)
  if (yes('huge')) return { model: 'opus', effort: 'xhigh', tip: 'fable' }
  if (yes('public')) return { model: 'opus', effort: 'high', tip: 'fable' }
  if (yes('cause') || yes('design') || yes('risk') || yes('steps')) return { model: 'opus', effort: 'high' }
  if (a.simple >= SURE && ['cause', 'design', 'risk', 'steps'].every(k => a[k] < DOUBT)) return { model: 'sonnet', effort: 'medium' }
  return { model: cfg.main.model, effort: cfg.main.effort }
}

{
  const cfg = { main: { model: 'opus', effort: 'medium' } }
  const a = parse('steps 0.1 cause 0.0 design 0 risk 0.1 public 0.0 huge 0.0 simple 0.9')
  assert.deepEqual(tier(a, cfg), { model: 'sonnet', effort: 'medium' })
  assert.deepEqual(tier({ ...a, cause: 0.6 }, cfg), { model: 'opus', effort: 'high' }) // an up answer beats simple
  assert.deepEqual(tier({ ...a, simple: 0.6 }, cfg), { model: 'opus', effort: 'medium' }) // unsure: the default
  assert.deepEqual(tier({ ...a, cause: 0.3 }, cfg), { model: 'opus', effort: 'medium' }) // a doubt blocks Sonnet
  assert.deepEqual(tier({ ...a, public: 0.8, huge: 0.9 }, cfg), { model: 'opus', effort: 'xhigh', tip: 'fable' })
  assert.equal(parse('steps 0.1 cause 0.0'), undefined) // missing answers never route
  assert.equal(parse('steps: 0.3, cause: 1, design 0.0 risk 0.0 public 0.0 huge 0.0 simple 0.5').cause, 1)
  assert.ok(SYSTEM.includes('simple 0.9') && prompt('fix it', ['the login test fails']).includes('<earlier>'))
}

const today = readJsonl(join(ROOT, 'results', 'classifier.jsonl'))
// every case file, by id: group files (russian, follow-up) hold cases of many categories
const cases = new Map(readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).flatMap(f => readJsonl(join(ROOT, 'cases', f))).map(c => [c.id, c]))
let unread = 0
const rows = await pool(today, 6, async r => {
  const c = cases.get(r.id), cfg = cfgFor(r.project)
  const earlier = (c?.history ?? []).map(h => h.user).slice(-3)
  const runs = []
  for (const [i, run] of r.runs.entries()) {
    if (run.by !== 'haiku' || !c) { runs.push(run); continue }
    const res = await claude({ model: cfg.classifier.model, effort: 'low', system: SYSTEM, prompt: prompt(c.prompt, earlier), tag: `narrow:${r.id}:${i}`, timeoutMs: 60_000, cache: true, seed: `narrow:${i}` })
      .catch(e => { if (e instanceof CapReached) throw e; return { text: String(e.message).slice(0, 120) } })
    const a = parse(res.text)
    if (!a) unread++
    const t = a ? tier(a, cfg) : { model: cfg.main.model, effort: cfg.main.effort } // unreadable: the default, as today
    runs.push({ ...run, ...t, tip: t.tip, cls: undefined, sure: Boolean(a), by: 'narrow', answers: a, reply: res.text })
  }
  return { ...r, runs }
})
writeJsonl(join(ROOT, 'results', 'classifier-narrow.jsonl'), rows.filter(r => r?.id))
for (const [k, r] of rows.entries()) if (r?.error) log(`error ${today[k].id}: ${r.error}`)
log(`narrow: ${rows.filter(r => r?.id).length} cases, ${unread} unreadable replies`)
