// Layer 1: what the router actually decides for each case. Rules plus the real Haiku classifier (same words the
// plugin sends), 3 runs per case, then the plugin's own policy code turns the class into a model and effort.
// Usage: node run-classifier.mjs [category ...]  -> results/classifier.jsonl
import { join } from 'node:path'
import {
  CLASS_LABELS, autoModel, classifierPrompt, classifierSystem, classifyPlan, explicitAsk, family, firstModel, rank, readLabel, settleAnswers, turnEffort,
} from '../router/hooks/policy.ts'
import { CapReached, ROOT, claude, log, pool, cfgFor, readJsonl, writeJsonl } from './lib.mjs'
import { readdirSync } from 'node:fs'

const RUNS = Number(process.env.RUNS ?? 3)

// The plugin's classify(), through the same policy functions (classifyPlan, settleAnswers); only the Haiku call is ours.
async function classify(text, st, cfg, tag, isFirst, strict) {
  const plan = classifyPlan(text, st.hasClassified, isFirst, strict, cfg)
  if (plan.keep) return { cls: undefined, sure: false, by: 'keep', samples: [] }
  st.hasClassified = true
  if (plan.rule) return { cls: plan.rule, sure: true, by: 'rule', samples: [] }
  const labels = CLASS_LABELS.filter(c => cfg.classes[c])
  const one = async k => {
    try {
      const r = await claude({ model: cfg.classifier.model, effort: 'low', system: classifierSystem(labels, cfg), prompt: classifierPrompt(text), tag: `${tag}:${k}`, timeoutMs: 60_000, cache: true, seed: `${tag}:${k}` })
      return { ...readLabel(r.text, labels, cfg), reply: r.text }
    } catch (e) {
      if (e instanceof CapReached) throw e
      return { cls: undefined, sure: false, reply: String(e.message).slice(0, 120) }
    }
  }
  const runs = await Promise.all(Array.from({ length: plan.ask }, (_, k) => one(k)))
  return { ...settleAnswers(runs, strict), by: 'haiku', reply: runs.map(r => r.reply).join(' | ') }
}

// One run through a case, as the plugin decides it: earlier user turns first (the first one is the chat's first
// prompt and may pick the chat's model), then the prompt. Context is taken as small.
async function decide(c, run) {
  const cfg = cfgFor(c.project)
  const st = { hasClassified: false, lastClass: null, stickyAsk: undefined, chat: null }
  let last
  for (const [i, text] of [...(c.history ?? []).map(h => h.user), c.prompt].entries()) {
    const asked = explicitAsk(text)
    if (asked?.sticky) st.stickyAsk = asked
    const ask = asked ?? st.stickyAsk
    const isFirst = i === 0 && !asked?.model
    const r = await classify(text, st, cfg, `classify:${c.id}:${run}:${i}`, isFirst, Boolean(st.chat)) // strict on the router's own pick
    if (r.cls !== undefined) st.lastClass = r.cls
    if (isFirst) st.chat = firstModel(r.samples, cfg.main.model, cfg) ?? null
    else if (st.chat && r.cls !== undefined && (r.cls === null || rank(cfg.classes[r.cls]?.model ?? cfg.main.model) > rank(st.chat))) st.chat = null
    const ultrathink = /\bultrathink\b/i.test(text)
    const requested = st.chat ?? cfg.main.model
    const switched = Boolean(r.cls) && r.sure && !ultrathink ? autoModel(st.lastClass, 0, requested, cfg) : undefined
    const askedModel = ask?.model && family(ask.model) !== family(cfg.main.model) ? ask.model : undefined
    const tierModel = r.cls && cfg.classes[r.cls]?.model
    last = {
      cls: st.lastClass, sure: r.sure, asked: Boolean(askedModel || ask?.effort), by: r.by, reply: r.reply, chat: st.chat ? family(st.chat) : undefined,
      tip: tierModel && rank(tierModel) > rank(requested) ? family(tierModel) : undefined, // upgrades only: the band suggests, nothing moves
      model: family(askedModel ?? switched ?? requested),
      effort: ask?.effort ?? (ultrathink ? cfg.main.effort : turnEffort(st.lastClass, cfg, askedModel ?? switched ?? requested) ?? cfg.main.effort),
    }
  }
  return last
}

const files = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''))
const cats = process.argv.slice(2).length ? process.argv.slice(2) : files
const cases = cats.flatMap(cat => readJsonl(join(ROOT, 'cases', `${cat}.jsonl`)))
const out = join(ROOT, 'results', 'classifier.jsonl')
const prior = new Map(readJsonl(out).map(r => [r.id, r]))
const rows = await pool(cases, 6, async c => {
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await decide(c, i))
  return { id: c.id, category: c.category, project: c.project, runs }
})
for (const r of rows.filter(r => r?.id)) prior.set(r.id, r)
for (const [k, r] of rows.entries()) if (r?.error) log(`error ${cases[k].id}: ${r.error}`)
writeJsonl(out, [...prior.values()])
log(`classified ${rows.filter(Boolean).length} cases x ${RUNS} runs`)
