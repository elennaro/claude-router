// Sends every session checkpoint through the plugin's real session check: the same window shape and words
// (sessionCheckSystem/Prompt), 3 Haiku samples, parseSessionCheck, adviseSwitch, and register.tsx's "no offer of the
// same family" and "quiet 10 turns after an offer". lastClass is what the plugin's classify() leaves: the newest
// prompt a rule or one Haiku sample classifies (continuations and short prompts keep the class).
// Sequences run twice: as written (for the metrics) and following the router's own offers (for flip-flops).
// Usage: node session/run.mjs  -> results/session.jsonl
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLASS_LABELS, adviseSwitch, classifierPrompt, classifierSystem, classifyByRules, family, isContinuation, readLabel,
  parseSessionCheck, sessionCheckPrompt, sessionCheckSystem,
} from '../../router/hooks/policy.ts'
import { CapReached, ROOT, claude, log, pool, cfgFor, readJsonl, writeJsonl } from '../lib.mjs'

const DIR = join(ROOT, 'session', 'cases')
const OUT = join(ROOT, 'results', 'session.jsonl')
const haiku = (system, prompt, tag) => claude({ model: cfgFor().classifier.model, effort: 'low', system, prompt, tag, timeoutMs: 60_000, cache: true, seed: tag }).then(r => r.text, e => { if (e instanceof CapReached) throw e; return undefined })

// register.tsx classify() walked backwards: the newest prompt that sets a class wins
async function lastClass(prompts, tag, cfg) {
  const labels = CLASS_LABELS.filter(c => cfg.classes[c])
  for (let i = prompts.length - 1; i >= 0; i--) {
    const byRule = classifyByRules(prompts[i], cfg)
    if (byRule) return { cls: byRule, by: 'rule' }
    if (isContinuation(prompts[i])) continue // covers < 12 chars; the session has classified before, so a continuation keeps
    const reply = await haiku(classifierSystem(labels, cfg), classifierPrompt(prompts[i]), `${tag}:class`)
    if (reply === undefined) continue // failed or late: the plugin keeps the earlier class
    return { cls: readLabel(reply, labels, cfg).cls, by: 'haiku', reply }
  }
  return { cls: null, by: 'none' }
}

async function check(k, model, cls, tag, cfg) {
  const w = {
    prompts: k.window.prompts, todos: k.window.todos?.length ? k.window.todos.map(t => `[${t.status}] ${t.content}`).join('\n') : undefined,
    plan: k.window.plan || undefined, turns: k.state.turns, model, lastClass: cls,
  }
  if (w.prompts.length < 2) return { action: 'none', model, skipped: 'window' }
  const replies = await Promise.all([0, 1, 2].map(i => haiku(sessionCheckSystem, sessionCheckPrompt(w), `${tag}:s${i}`)))
  const a = adviseSwitch(replies.map(r => (r === undefined ? undefined : parseSessionCheck(r))), model, k.state.trigger, cfg, cls)
  const offer = a && family(a.model) !== family(model) ? a : undefined
  return { action: offer?.action ?? 'none', model: offer?.model ?? model, kind: offer?.kind, replies }
}

const checkpoints = c => (c.checkpoints ? c.checkpoints.map((k, i) => ({ id: `${c.id}#${i + 1}`, ...k })) : [c])
const RUNS = Number(process.env.RUNS ?? 3) // whole independent runs: the router's own run-to-run noise
const cases = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).flatMap(f => readJsonl(join(DIR, f)))
const jobs = Array.from({ length: RUNS }, (_, run) => cases.map(c => ({ c, run }))).flat()
const rows = await pool(jobs, 4, async ({ c, run }) => {
  const out = []
  for (const k of checkpoints(c)) {
    const tag = `sess-run:${k.id}:${run}`
    const cfg = cfgFor(c.project ?? k.project)
    const cls = await lastClass(k.window.prompts, tag, cfg)
    out.push({ id: k.id, run, case: c.id, category: c.category, state: k.state, gold: k.gold, lastClass: cls, router: await check(k, k.state.model, cls.cls, tag, cfg) })
  }
  if (c.checkpoints) { // follow the router: an accepted offer changes the model; quiet 10 turns after an offer (register.tsx)
    let model = c.checkpoints[0].state.model, quietUntil = 0
    const path = [model]
    for (const [i, k] of c.checkpoints.entries()) {
      const r = out[i]
      if (k.state.turns < quietUntil) { r.follow = { model, quiet: true }; path.push(model); continue }
      const res = model === k.state.model ? r.router : await check(k, model, r.lastClass.cls, `sess-run:${r.id}:${run}:follow`, cfgFor(c.project ?? k.project))
      if (res.action !== 'none') { quietUntil = k.state.turns + 10; model = res.model }
      r.follow = { from: path.at(-1), ...res }
      path.push(model)
    }
    out.forEach(r => { r.path = path })
  }
  return out
})
for (const [i, r] of rows.entries()) if (r?.error) log(`error ${jobs[i].c.id}: ${r.error}`)
writeJsonl(OUT, rows.filter(Array.isArray).flat())
log(`session check: ${rows.filter(Array.isArray).flat().length} checkpoints`)
