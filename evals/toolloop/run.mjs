// Tool-loop suite: each task runs in a fresh copy of the fixture repo with real tools (read, search, run, edit),
// on each tier, RUNS times; the exact check scores it. Resumable: finished runs are kept.
// Usage: node toolloop/run.mjs  env RUNS (default 3), TIERS (default haiku-medium,sonnet-medium,opus-medium)
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, WORK, claude, log, pool, readJsonl, writeJsonl } from '../lib.mjs'
import { build, write } from './fixture.mjs'
import { TASKS } from './tasks.mjs'

const RUNS = Number(process.env.RUNS ?? 3)
const TIERS = (process.env.TIERS ?? 'haiku-medium,sonnet-medium,opus-medium').split(',').map(k => { const [model, effort] = k.split('-'); return { model, effort, key: k } })
const TOOLS = 'Read,Glob,Grep,Bash,Edit,Write'
const f = build()
const out = join(ROOT, 'results', 'toolloop.jsonl')
const done = new Map(readJsonl(out).map(r => [`${r.id}:${r.tier}:${r.run}`, r]))
const jobs = TASKS.flatMap(task => TIERS.flatMap(tier => Array.from({ length: RUNS }, (_, run) => ({ task, tier, run })))).filter(j => !done.has(`${j.task.id}:${j.tier.key}:${j.run}`))

log(`toolloop: ${jobs.length} runs to do`)
await pool(jobs, 4, async ({ task, tier, run }) => {
  const dir = join(WORK, 'toolloop', `${task.id}.${tier.key}.${run}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  write(dir, f.files)
  try {
    const r = await claude({ model: tier.model, effort: tier.effort, tools: TOOLS, cwd: dir, timeoutMs: 600_000, tag: `toolloop:${task.id}:${tier.key}:${run}`,
      prompt: `${task.prompt}\n\nWork only inside the current folder. End your reply with one line: ANSWER: <your answer>` })
    const pass = task.check(r.text, f, dir)
    const row = { id: task.id, kind: task.kind, tier: tier.key, run, pass, usd: r.usd, turns: r.turns, ms: r.ms, answer: r.text.slice(-300) }
    done.set(`${task.id}:${tier.key}:${run}`, row)
    writeJsonl(out, [...done.values()])
    log(`${task.id} ${tier.key} #${run}: ${pass ? 'pass' : 'FAIL'} ($${r.usd.toFixed(3)}, ${r.turns} turns)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
