// What the plugin's agent.spawn hook picks for each brief (register.tsx), 3 runs per brief: a type in the routing
// table by its entry (rules may raise it); any other type by briefClass and the plugin's own spawnPick. Effort: the
// tier's, else the parent's.
// Usage: node subagents/run.mjs  -> results/subagents.jsonl
import { join } from 'node:path'
import {
  CLASS_LABELS, agentTier, classifierPrompt, classifierSystem, classifyByRules, family, needsSecondSample, readLabel, spawnPick,
} from '../../router/hooks/policy.ts'
import { CapReached, ROOT, claude, log, pool, cfgFor, readJsonl, writeJsonl } from '../lib.mjs'

const RUNS = Number(process.env.RUNS ?? 3)

async function haiku(text, tag, cfg) {
  const labels = CLASS_LABELS.filter(c => cfg.classes[c])
  try {
    const r = await claude({ model: cfg.classifier.model, effort: 'low', system: classifierSystem(labels, cfg), prompt: classifierPrompt(text), tag, timeoutMs: 60_000, cache: true, seed: tag })
    return { ...readLabel(r.text, labels, cfg), by: 'haiku', reply: r.text }
  } catch (e) {
    if (e instanceof CapReached) throw e
    return { cls: undefined, sure: false, by: 'error', reply: String(e.message).slice(0, 120) }
  }
}

// register.tsx briefClass: rules, then one Haiku sample; a move below the parent needs a second sure sample to agree
async function briefClass(text, parentModel, tag, cfg) {
  const byRule = classifyByRules(text, cfg)
  if (byRule) return { cls: byRule, sure: true, byRule: true, by: 'rule' }
  if (text.trim().length < 12) return { cls: undefined, sure: false, by: 'short' }
  const first = await haiku(text, tag, cfg)
  if (!needsSecondSample(first.cls, first.sure, parentModel, cfg)) return first
  const second = await haiku(text, tag + ':2', cfg)
  return { ...first, sure: second.sure && second.cls === first.cls, reply: first.reply + ' | ' + second.reply }
}

// register.tsx agent.spawn through the shared spawnPick; the chat model is the router's (no person's pick in these cases)
async function spawn(c, run) {
  const cfg = cfgFor(c.project)
  const inTable = Boolean(cfg.agents[c.agentType])
  const brief = inTable ? undefined : await briefClass(c.brief, c.parentModel, `sub-run:${c.id}:${run}`, cfg)
  const { model, tier } = spawnPick({
    brief, tableTier: inTable ? agentTier(c.agentType, cfg) : undefined, rule: inTable ? classifyByRules(c.brief, cfg) : undefined,
    parentModel: c.parentModel, personChose: false, prior: c.priorModel, sibling: c.siblingModel,
  }, cfg)
  return { cls: brief?.cls ?? (inTable ? `table:${c.agentType}` : undefined), sure: brief?.sure, by: brief?.by ?? 'table', reply: brief?.reply, model, effort: tier?.effort ?? c.parentEffort, moved: model !== family(c.parentModel) }
}

const cases = readJsonl(join(ROOT, 'subagents', 'cases.jsonl'))
const rows = await pool(cases, 6, async c => ({ id: c.id, runs: await Promise.all(Array.from({ length: RUNS }, (_, i) => spawn(c, i))) }))
for (const [i, r] of rows.entries()) if (r?.error) log(`error ${cases[i].id}: ${r.error}`)
writeJsonl(join(ROOT, 'results', 'subagents.jsonl'), rows.filter(r => r?.id))
log(`subagents: ${rows.filter(r => r?.id).length} briefs x ${RUNS} runs`)
