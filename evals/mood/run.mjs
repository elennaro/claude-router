// Sends every exchange through the plugin's real mood check: the same words (moodSystem/moodPrompt) and parseMood.
// Every Haiku reply is cached in the store (cache: true, one seed per run), so each case is paid for once; a re-run,
// and fast.mjs with EVAL_OFFLINE=1, replay for $0.
// Usage: node mood/run.mjs  -> results/mood.jsonl
import { join } from 'node:path'
import { moodPrompt, moodSystem, parseMood } from '../../router/hooks/policy.ts'
import { CapReached, ROOT, claude, cfgFor, log, pool, readJsonl, writeJsonl } from '../lib.mjs'

const CASES = join(ROOT, 'mood', 'cases.jsonl')
const OUT = join(ROOT, 'results', 'mood.jsonl')
const RUNS = Number(process.env.RUNS ?? 3) // independent samples per case: Haiku's own run-to-run noise

const cases = readJsonl(CASES)
const jobs = Array.from({ length: RUNS }, (_, run) => cases.map(c => ({ c, run }))).flat()
const rows = await pool(jobs, 6, async ({ c, run }) => {
  const tag = `mood:${c.id}:${run}`
  const reply = await claude({ model: cfgFor().classifier.model, effort: 'low', system: moodSystem, prompt: moodPrompt(c), tag, timeoutMs: 60_000, cache: true, seed: tag })
    .then(r => r.text, e => { if (e instanceof CapReached) throw e; return undefined })
  return { id: c.id, run, kind: c.kind, lang: c.lang, gold: c.gold, also: c.also ?? [], reply, mood: reply === undefined ? undefined : parseMood(reply) ?? null }
})
for (const [i, r] of rows.entries()) if (r?.error) log(`error ${jobs[i].c.id}: ${r.error}`)
writeJsonl(OUT, rows.filter(r => r && !r.error))
log(`mood: ${rows.filter(r => r && !r.error).length} replies`)
