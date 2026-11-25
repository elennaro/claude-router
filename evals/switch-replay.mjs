// $0 replay of the switch-down rule (docs/PLAN-v3.md, slice 1) over this machine's Claude Code transcripts.
// Usage: node switch-replay.mjs [days]   (default: every transcript)
//        node switch-replay.mjs --test   (self-check of the cost math)
// For each past interactive chat on Opus or Fable it prices: never switching; switching one family down at the step
// the plugin's own switchMath would pick; and the best switch step in hindsight. Money only: it assumes the session
// check allowed the cheaper model at every step (quality is gated by the class tables in fast.mjs), so this is the rule
// at its most eager. Gate: the rule costs less than never switching in total, and no chat costs over 2x its hindsight best.
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stepUsd } from '../router/bin/check-savings.mjs'
import { switchMath } from '../router/hooks/policy.ts'

const DOWN = { opus: 'sonnet', fable: 'opus' }
const HOUR = 3600_000
const INTERACTIVE = new Set(['claude-desktop', 'cli', 'claude-vscode'])
const fam = m => ['haiku', 'sonnet', 'opus', 'fable'].find(f => String(m).includes(f))
const tokens = u => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

// one main-chat transcript's lines -> its steps in order (fullest line per message) and where compactions fell.
// Lines, not one string: a long chat's file can pass the 512 MB a JavaScript string holds.
export async function chatOf(lines) {
  const best = new Map()
  const compactAt = []
  let interactive = false
  for await (const line of lines) {
    if (!line) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'system' && o.subtype === 'compact_boundary') compactAt.push(Date.parse(o.timestamp))
    const m = o.message
    if (o.type !== 'assistant' || o.isSidechain || !m?.usage || !m.id || m.model === '<synthetic>') continue
    if (INTERACTIVE.has(o.entrypoint)) interactive = true
    const prev = best.get(m.id)
    if (!prev || tokens(m.usage) > tokens(prev.u)) best.set(m.id, { model: m.model, u: m.usage, t: Date.parse(o.timestamp) })
  }
  return { steps: [...best.values()].sort((a, b) => a.t - b.t), compactAt, interactive }
}

// The step's usage when it is the first one on a new model: everything it read must be written instead (1-hour entry).
const rebuilt = u => ({ ...u, cache_read_input_tokens: 0, cache_creation_input_tokens: (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), cache_creation: { ephemeral_1h_input_tokens: (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), ephemeral_5m_input_tokens: 0 } })

// never: the chat as it ran. at[k]: switching to `to` from step k on (k >= 1). Returns both, in dollars.
export function costs(steps, to) {
  const actual = steps.map(x => stepUsd(x.model, x.u))
  const moved = steps.map(x => stepUsd(to, x.u))
  const first = steps.map(x => stepUsd(to, rebuilt(x.u)))
  const never = actual.reduce((a, b) => a + b, 0)
  const at = []
  let before = 0, after = moved.reduce((a, b) => a + b, 0)
  for (let k = 0; k < steps.length; k++) {
    after -= moved[k]
    at[k] = before + first[k] + after
    before += actual[k]
  }
  return { never, at }
}

// The first step the plugin's rule would move at; undefined = never. Decides before step k from what step k-1 left.
export function ruleStep(steps, compactAt, from, to, remaining) {
  let out = 0
  for (let k = 1; k < steps.length; k++) {
    const p = steps[k - 1]
    out += p.u.output_tokens ?? 0
    const cache = (p.u.input_tokens ?? 0) + (p.u.cache_read_input_tokens ?? 0) + (p.u.cache_creation_input_tokens ?? 0)
    const free = steps[k].t - p.t > HOUR || compactAt.some(c => c > p.t && c <= steps[k].t)
    const m = switchMath({ from, to, cache, out: out / k, age: k, lives: remaining, free })
    if (m.pays) return k
  }
  return undefined
}

function files(days) {
  const root = join(homedir(), '.claude', 'projects')
  const since = days ? Date.now() - days * 864e5 : 0
  const out = []
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    let names = []
    try { names = readdirSync(join(root, dir)) } catch { continue }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(root, dir, f)
      if (!since || statSync(p).mtimeMs >= since) out.push(p)
    }
  }
  return out
}

async function main() {
  const days = Number(process.argv[2]) || 0
  const chats = []
  for (const p of files(days)) {
    const c = await chatOf(createInterface({ input: createReadStream(p), crlfDelay: Infinity }))
    if (c.interactive && c.steps.length) chats.push(c)
  }
  // shortcut: the survival curve is built from every chat, the scored one included; with hundreds of chats one chat
  // moves it by well under 1%. Build it per chat (leave one out) if the chat count ever drops below ~200.
  const lives = chats.map(c => ({ steps: c.steps.length, open: false }))
  let N = 0, R = 0, B = 0, moved = 0, over = 0, worst = 1, n = 0
  for (const c of chats) {
    const from = fam(c.steps[0].model)
    const to = DOWN[from]
    if (!to || c.steps.length < 2) continue
    const { never, at } = costs(c.steps, to)
    const k = ruleStep(c.steps, c.compactAt, from, to, lives)
    const rule = k === undefined ? never : at[k]
    const best = Math.min(never, ...at.slice(1))
    n++; N += never; R += rule; B += best
    if (k !== undefined) moved++
    const ratio = best > 0 ? rule / best : 1
    worst = Math.max(worst, ratio)
    if (ratio > 2) over++
  }
  const $ = x => `$${x.toFixed(2)}`
  console.log(`${n} interactive chats on Opus or Fable (${chats.length} chats read). Money only: the cheaper model is assumed allowed at every step.`)
  console.log(`never switch ${$(N)} · rule ${$(R)} (${N ? Math.round((100 * (N - R)) / N) : 0}% less, moved ${moved} chats) · best in hindsight ${$(B)}`)
  console.log(`worst chat: ${worst.toFixed(2)}x its hindsight best; chats over 2x: ${over}`)
  const pass = R < N && over === 0
  console.log(pass ? 'GATE PASS' : 'GATE FAIL')
  process.exitCode = pass ? 0 : 1
}

async function selfTest() {
  const assert = (ok, what) => { if (!ok) throw new Error(`self-test: ${what}`) }
  const near = (a, b) => Math.abs(a - b) < 1e-9
  const u = (read, write, out) => ({ input_tokens: 0, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write, cache_creation: { ephemeral_1h_input_tokens: write, ephemeral_5m_input_tokens: 0 } })
  const steps = [0, 1, 2].map(i => ({ model: 'claude-opus-5-5', u: u(i ? 100_000 : 0, i ? 1_000 : 100_000, 1_000), t: i * 1000 }))
  const { never, at } = costs(steps, 'sonnet')
  assert(near(never, (100_000 * 8 + 1_000 * 20 + 2 * (100_000 * 0.2 + 1_000 * 8 + 1_000 * 20)) / 1e6), 'never = the chat as it ran')
  // switch at step 2: steps 0-1 on Opus, step 2 on Sonnet writing all 101K again
  assert(near(at[2], (100_000 * 8 + 1_000 * 20 + 100_000 * 0.2 + 1_000 * 8 + 1_000 * 20 + 101_000 * 4 + 1_000 * 10) / 1e6), 'switch pays one rebuild')
  const text = [
    JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: '2026-11-25T10:00:00Z', message: { id: 'a', model: 'claude-opus-5-5', usage: u(0, 10, 1) } }),
    JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: '2026-11-25T10:00:00Z', message: { id: 'a', model: 'claude-opus-5-5', usage: u(0, 10, 50) } }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-25T10:01:00Z' }),
    JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-11-25T10:02:00Z', message: { id: 'b', model: 'claude-haiku-5-5', usage: u(0, 10, 1) } }),
  ]
  const c = await chatOf(text)
  assert(c.steps.length === 1 && c.steps[0].u.output_tokens === 50, 'fullest line per message, subagents left out')
  assert(c.compactAt.length === 1 && c.interactive, 'compaction and entrypoint read')
  // a compaction between two steps is a free switch point: the rule moves right there, with no history
  const two = [steps[0], { ...steps[1], t: Date.parse('2026-11-25T10:02:00Z') }].map((x, i) => ({ ...x, t: i ? x.t : Date.parse('2026-11-25T10:00:00Z') }))
  assert(ruleStep(two, c.compactAt, 'opus', 'sonnet', []) === 1, 'free switch after compaction')
  assert(ruleStep(two, [], 'opus', 'sonnet', []) === undefined, 'no history, one step: too early')
  console.log('switch-replay self-test: ok')
}

if (process.argv[1]?.endsWith('switch-replay.mjs')) process.argv[2] === '--test' ? selfTest() : main()
