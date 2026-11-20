// Cross-check the router's ledger against Claude Code's own transcripts.
// Usage: node bin/check-savings.mjs [days | YYYY-MM-DD]   (default 7 days; a date counts from that day)
//        node bin/check-savings.mjs --test               (self-check of the price and dedupe code)
// For every session in ~/.claude/router/router.db in the window, it re-counts what the session cost from the transcript
// files (main chat and subagents), with its own price code, and prints both side by side with the ledger's no-router
// baseline, saved and extra. A ledger figure far from the transcript figure means steps were missed or double counted.
// Classifier and session-check calls never reach a transcript, so they are shown apart ("router").
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// platform.claude.com/docs/en/about-claude/pricing, read 2026-11-19: input, 5m write, 1h write, cache read, output per MTok
const PRICE = {
  fable: [8, 10, 16, 0.2, 40],
  opus: [4, 5, 8, 0.2, 20],
  sonnet: [2, 2.5, 4, 0.1, 10],
  haiku: [0.1, 0.125, 0.2, 0.01, 0.5], // x5 on every side once the prompt passes 100K tokens
}
const family = m => Object.keys(PRICE).find(f => String(m).includes(f))

export function stepUsd(model, u) {
  const f = family(model)
  if (!f) return 0
  const c = u.cache_creation ?? {}
  const w1h = c.ephemeral_1h_input_tokens ?? 0
  const w5m = c.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + w5m + w1h
  const k = f === 'haiku' && prompt > 100_000 ? 5 : 1
  const [i, five, hour, r, o] = PRICE[f].map(x => x * k)
  return ((u.input_tokens ?? 0) * i + w5m * five + w1h * hour + (u.cache_read_input_tokens ?? 0) * r + (u.output_tokens ?? 0) * o) / 1e6
}

// one transcript file -> cost; a message streams as several lines with the same id and usage, so count each id once
export function fileUsd(path, from = 0) {
  const seen = new Set()
  let usd = 0
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const m = o.message
    if (o.type !== 'assistant' || !m?.usage || !m.id || seen.has(m.id) || m.model === '<synthetic>') continue
    if (from && Date.parse(o.timestamp) < from) continue // before the ledger saw this session (installed later)
    seen.add(m.id)
    usd += stepUsd(m.model, m.usage)
  }
  return usd
}

function transcripts(session) {
  const root = join(homedir(), '.claude', 'projects')
  const out = []
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const main = join(root, dir, `${session}.jsonl`)
    if (existsSync(main)) out.push(main)
    const subs = join(root, dir, session, 'subagents')
    if (existsSync(subs)) out.push(...readdirSync(subs).filter(f => f.endsWith('.jsonl')).map(f => join(subs, f)))
  }
  return out
}

function main() {
  const arg = process.argv[2] ?? '7'
  const since = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : new Date(Date.now() - Number(arg) * 864e5).toISOString().slice(0, 10)
  const db = new DatabaseSync(join(homedir(), '.claude', 'router', 'router.db'), { readOnly: true })
  const rows = db.prepare(`SELECT u.session, (SELECT min(d.first) FROM days d WHERE d.session = u.session) AS first, coalesce(s.label, '') AS label,
      sum(CASE WHEN u.who = 'router' THEN 0 ELSE u.usd END) AS usd, sum(CASE WHEN u.who = 'router' THEN u.usd ELSE 0 END) AS router,
      sum(u.base) AS base, sum(u.extra) AS extra
    FROM usage u LEFT JOIN sessions s ON s.id = u.session WHERE u.day >= ? GROUP BY u.session ORDER BY usd DESC`).all(since)
  const $ = x => `$${x.toFixed(2)}`
  let L = 0, T = 0, B = 0, X = 0, R = 0, U = 0, missing = 0
  console.log(`Sessions since ${since}. ledger = what the router recorded; transcript = re-counted from Claude Code's files.\n`)
  console.log('ledger    transcript  diff    | no router  saved    extra   router | session')
  for (const r of rows) {
    const files = transcripts(r.session)
    // the later of: the first step the ledger saw in this session, local midnight of the window's first day
    const from = Math.max(Number(r.first ?? 0), new Date(`${since}T00:00:00`).getTime())
    const t = files.reduce((a, f) => a + fileUsd(f, from), 0)
    const saved = r.base - (r.usd + r.router) + r.extra
    if (!files.length) missing++
    else { L += r.usd; T += t }
    B += r.base; X += r.extra; R += r.router; U += r.usd
    const diff = files.length ? `${t ? Math.round((100 * (r.usd - t)) / t) : 0}%` : 'no file'
    console.log(`${$(r.usd).padEnd(9)} ${(files.length ? $(t) : '-').padEnd(11)} ${diff.padEnd(7)} | ${$(r.base).padEnd(10)} ${$(saved).padEnd(8)} ${$(r.extra).padEnd(7)} ${$(r.router).padEnd(6)} | ${String(r.label).slice(0, 40)}`)
  }
  console.log(`\nWith transcripts: ledger ${$(L)}, transcripts ${$(T)} (${T ? Math.round((100 * (L - T)) / T) : 0}% apart). ${missing} sessions had no transcript file.`)
  console.log(`All sessions: spent ${$(U + R)}, no router ${$(B)}, net ${$(B - U - R)} (saved ${$(B - U - R + X)}, extra ${$(X)}, of which the router's own calls ${$(R)}).`)
}

function selfTest() {
  const assert = (ok, what) => { if (!ok) throw new Error(`self-test: ${what}`) }
  const near = (a, b) => Math.abs(a - b) < 1e-9
  const w = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1e6 }
  assert(near(stepUsd('claude-opus-5-5', { ...w, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }), 8), '1h write')
  assert(near(stepUsd('claude-opus-5-5', w), 5), 'a write with no split is 5m')
  assert(near(stepUsd('claude-haiku-5-5', { input_tokens: 100_001, output_tokens: 1e6, cache_read_input_tokens: 0 }), (100_001 * 0.5) / 1e6 + 2.5), 'haiku long x5')
  assert(stepUsd('gpt-x', w) === 0, 'unknown model')
  console.log('check-savings self-test: ok')
}

if (process.argv[1]?.endsWith('check-savings.mjs')) process.argv[2] === '--test' ? selfTest() : main()
