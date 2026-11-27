// Cross-check the router's ledger against Claude Code's own transcripts.
// Usage: node bin/check-savings.mjs [days | YYYY-MM-DD]   (default 7 days; a date counts from that day)
//        node bin/check-savings.mjs --test               (self-check of the price and dedupe code)
// For every session in ~/.claude/router/router.db in the window, it re-counts what the session cost from the transcript
// files (main chat and subagents), with its own price code, and prints both side by side with the ledger's no-router
// baseline, saved and extra. A ledger figure far from the transcript figure means steps were missed or double counted.
// Classifier and session-check calls never reach a transcript, so they are shown apart ("router").
import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// platform.claude.com/docs/en/about-claude/pricing, read 2026-11-27: input, 5m write, 1h write, cache read, output per MTok
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
  // fast mode (Opus, Fable): 2x input and output, and the cache multipliers stack on the fast input price (pricing page, 2026-11-27)
  const k = (f === 'haiku' && prompt > 100_000 ? 5 : 1) * (u.speed === 'fast' ? 2 : 1)
  const [i, five, hour, r, o] = PRICE[f].map(x => x * k)
  return ((u.input_tokens ?? 0) * i + w5m * five + w1h * hour + (u.cache_read_input_tokens ?? 0) * r + (u.output_tokens ?? 0) * o) / 1e6
}

const tokens = u => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

// a session's transcript files -> cost. A message streams as several lines with the same id, and an early line can carry
// partial usage: keep each id's fullest line, counted once across the session's files (main chat and subagents).
// shortcut: a resumed or forked chat's copies in another session's file still count there too; dedupe globally if that shows up.
// Models with no price are added to `unpriced` instead of silently costing $0.
// A file's lines, read in chunks: a long chat's transcript passes 1 GB, over the longest string Node can hold.
// Chunks are cut at a newline byte, which never falls inside a UTF-8 character.
export function* lines(path, chunk = 64 << 20) {
  const fd = openSync(path, 'r')
  try {
    let rest = Buffer.alloc(0)
    const buf = Buffer.alloc(chunk)
    for (let n; (n = readSync(fd, buf, 0, chunk, null)) > 0;) {
      const data = Buffer.concat([rest, buf.subarray(0, n)])
      const cut = data.lastIndexOf(10)
      if (cut < 0) { rest = data; continue }
      yield* data.subarray(0, cut).toString('utf8').split('\n')
      rest = data.subarray(cut + 1)
    }
    if (rest.length) yield rest.toString('utf8')
  } finally { closeSync(fd) }
}

export function sessionUsd(paths, from = 0, unpriced = new Set()) {
  const best = new Map()
  for (const path of paths) {
    for (const line of lines(path)) {
      if (!line.includes('"usage"')) continue
      let o
      try { o = JSON.parse(line) } catch { continue }
      const m = o.message
      if (o.type !== 'assistant' || !m?.usage || !m.id || m.model === '<synthetic>') continue
      if (from && Date.parse(o.timestamp) < from) continue // before the ledger saw this session (installed later)
      const prev = best.get(m.id)
      if (!prev || tokens(m.usage) > tokens(prev.usage)) best.set(m.id, m)
    }
  }
  let usd = 0
  for (const m of best.values()) {
    if (!family(m.model)) unpriced.add(m.model)
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
  const unpriced = new Set()
  console.log(`Sessions since ${since}. ledger = what the router recorded; transcript = re-counted from Claude Code's files.\n`)
  console.log('ledger    transcript  diff    | no router  saved    extra   router | session')
  for (const r of rows) {
    const files = transcripts(r.session)
    // the later of: the first step the ledger saw in this session, local midnight of the window's first day
    const from = Math.max(Number(r.first ?? 0), new Date(`${since}T00:00:00`).getTime())
    const t = sessionUsd(files, from, unpriced)
    const saved = r.base - (r.usd + r.router) + r.extra
    if (!files.length) missing++
    else { L += r.usd; T += t }
    B += r.base; X += r.extra; R += r.router; U += r.usd
    const diff = files.length ? `${t ? Math.round((100 * (r.usd - t)) / t) : 0}%` : 'no file'
    console.log(`${$(r.usd).padEnd(9)} ${(files.length ? $(t) : '-').padEnd(11)} ${diff.padEnd(7)} | ${$(r.base).padEnd(10)} ${$(saved).padEnd(8)} ${$(r.extra).padEnd(7)} ${$(r.router).padEnd(6)} | ${String(r.label).slice(0, 40)}`)
  }
  console.log(`\nWith transcripts: ledger ${$(L)}, transcripts ${$(T)} (${T ? Math.round((100 * (L - T)) / T) : 0}% apart). ${missing} sessions had no transcript file.`)
  console.log(`All sessions: spent ${$(U + R)}, no router ${$(B)}, net ${$(B - U - R)} (saved ${$(B - U - R + X)}, extra ${$(X)}, of which the router's own calls ${$(R)}).`)
  if (unpriced.size) console.log(`No price for: ${[...unpriced].join(', ')}. Their steps count as $0 here; the ledger prices them as Opus. Add them to PRICE.`)
}

function selfTest() {
  const assert = (ok, what) => { if (!ok) throw new Error(`self-test: ${what}`) }
  const near = (a, b) => Math.abs(a - b) < 1e-9
  const w = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1e6 }
  assert(near(stepUsd('claude-opus-5-5', { ...w, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }), 8), '1h write')
  assert(near(stepUsd('claude-opus-5-5', w), 5), 'a write with no split is 5m')
  assert(near(stepUsd('claude-haiku-5-5', { input_tokens: 100_001, output_tokens: 1e6, cache_read_input_tokens: 0 }), (100_001 * 0.5) / 1e6 + 2.5), 'haiku long x5')
  assert(stepUsd('gpt-x', w) === 0, 'unknown model')
  assert(near(stepUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, speed: 'fast' }), 8 + 40 + 0.4), 'fast mode x2 on every side')
  assert(near(stepUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, speed: 'standard' }), 4), 'standard speed x1')
  // two files of one session: the same message streamed (partial first line), and copied into the second file
  const dir = mkdtempSync(join(tmpdir(), 'check-savings-'))
  try {
    const line = (id, model, out) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-25T10:00:00Z', message: { id, model, usage: { input_tokens: 0, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
    const a = join(dir, 'a.jsonl'), b = join(dir, 'b.jsonl')
    writeFileSync(a, [line('m1', 'claude-opus-5-5', 10), line('m1', 'claude-opus-5-5', 1e6), line('m2', 'gpt-x', 5)].join('\n'))
    writeFileSync(b, line('m1', 'claude-opus-5-5', 1e6))
    const unpriced = new Set()
    assert(near(sessionUsd([a, b], 0, unpriced), 20), 'fullest line per message, once per session')
    assert(unpriced.has('gpt-x'), 'unpriced models are flagged')
    // chunks of 7 bytes cut lines and two-byte letters: every line still comes back whole
    const c = join(dir, 'c.jsonl')
    writeFileSync(c, 'ёлка one\nдва\n\nthree без конца')
    assert(JSON.stringify([...lines(c, 7)]) === JSON.stringify(['ёлка one', 'два', '', 'three без конца']), 'chunked lines')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('check-savings self-test: ok')
}

if (process.argv[1]?.endsWith('check-savings.mjs')) process.argv[2] === '--test' ? selfTest() : main()
