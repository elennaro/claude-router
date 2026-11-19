// The ledger in one SQLite file, ~/.claude/router/router.db. A mod has no Node, so a fixed runner (node's built-in
// node:sqlite) takes a batch of statements on stdin and runs them in one transaction; every statement lives here.
import type { EngineInterface } from 'claude-code'
import type { AgentTally, Bucket, Tally } from '../types'

export const RUNNER = `// written by the router plugin: runs one batch of SQL statements from stdin in one transaction
import { DatabaseSync } from 'node:sqlite'
let input = ''
process.stdin.setEncoding('utf8') // a character split across two chunks must not break (Cyrillic labels did, audit 2026-11-19)
for await (const c of process.stdin) input += c
const { db, schema, migrate, steps } = JSON.parse(input)
const d = new DatabaseSync(db)
d.exec('PRAGMA busy_timeout = 5000')
d.exec(schema)
for (const m of migrate ?? []) { try { d.exec(m) } catch (e) { if (!/duplicate column/i.test(String(e))) throw e } } // already applied
const out = []
d.exec('BEGIN IMMEDIATE')
try {
  for (const s of steps) {
    const st = d.prepare(s.sql)
    out.push(s.all ? st.all(...(s.params ?? [])) : (st.run(...(s.params ?? [])), null))
  }
  d.exec('COMMIT')
} catch (e) {
  d.exec('ROLLBACK')
  process.stderr.write(String(e))
  process.exit(1)
}
process.stdout.write(JSON.stringify(out))
`

// who: 'main' (the chat), 'router' (the classifier and session check: spend with no baseline) or a subagent type.
// base: what the same steps would have cost with no router (the asked model and effort; 0 for the router's own calls).
// extra: the part of usd above base, summed per step, so savings and extra spend stay apart (saved = base - usd + extra).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project TEXT NOT NULL, label TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS days (day TEXT, session TEXT, turns INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (day, session)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS usage (day TEXT, session TEXT, who TEXT, model TEXT, steps INTEGER NOT NULL, usd REAL NOT NULL, base REAL NOT NULL, extra REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, session, who, model)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spawns (day TEXT, session TEXT, type TEXT, runs INTEGER NOT NULL, routed INTEGER NOT NULL, respawned INTEGER NOT NULL, PRIMARY KEY (day, session, type)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY) WITHOUT ROWID;
`

// 0.4's ledger had no `extra`: older rows get 0 (their extra spend was never split out).
export const MIGRATE = ['ALTER TABLE usage ADD COLUMN extra REAL NOT NULL DEFAULT 0']

export type Step = { sql: string; params?: Array<string | number | null>; all?: true }

export const paths = (home: string) => ({ runner: `${home}/.claude/router/sqlite.mjs`, db: `${home}/.claude/router/router.db` })

let runnerAt: string | undefined // the runner file was checked once in this module's life

// One batch, one transaction. Throws when node or the runner fails (nothing is written then).
export async function run($: EngineInterface, home: string, steps: Array<Step>): Promise<Array<Array<Record<string, unknown>> | null>> {
  const p = paths(home)
  if (runnerAt !== p.runner) {
    const have = await $.fs.read(p.runner).then(String).catch(() => '')
    if (have !== RUNNER) await $.fs.write(p.runner, RUNNER)
    runnerAt = p.runner
  }
  const r = await $.process.run(['node', '--no-warnings', p.runner], { stdin: JSON.stringify({ db: p.db, schema: SCHEMA, migrate: MIGRATE, steps }), timeoutMs: 15_000 })
  if (r.exitCode !== 0) throw new Error(`sqlite runner exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-300)}`)
  // shortcut: a read over the 4 MiB output limit fails with this message; aggregate in SQL if a ledger ever gets there
  if (r.isStdoutTruncated) throw new Error('the ledger read is over 4 MiB; narrow the query')
  return JSON.parse(r.stdout)
}

// How a chat's first prompt names it on the Board: 60 characters, injected reminders dropped, anything that looks like
// a secret masked (long tokens, a password in a URL, key=value secrets). Nothing else of a prompt is ever stored.
export function labelOf(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(:\/\/[^\s/:@]*:)[^\s@]+@/g, '$1…@')
    .replace(/\b(\w*(?:pass(?:word)?|secret|token|key|pwd)\w*\s*[=:]\s*)\S+/gi, '$1…')
    .replace(/[\w+/=-]{24,}/g, '…')
    .trim()
    .slice(0, 60)
    .trim()
}

// The marker that makes the 0.2 import happen once: the batch that inserts it second fails and rolls back.
export const IMPORTED: Step = { sql: `INSERT INTO meta VALUES ('legacy-import')` }
export const isAlreadyImported = (err: unknown) => /UNIQUE constraint failed: meta/.test(String(err))

// ---- writes: every one adds to its row ----

export const sessionRow = (session: string, project: string, label: string): Step => ({
  sql: `INSERT INTO sessions VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET label = CASE WHEN label = '' THEN excluded.label ELSE label END`,
  params: [session, project, label],
})

export const dayRow = (day: string, session: string, turns: number, first: number, last = first): Step => ({
  sql: `INSERT INTO days VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, session) DO UPDATE SET turns = turns + excluded.turns, first = min(first, excluded.first), last = max(last, excluded.last)`,
  params: [day, session, turns, first, last],
})

export const usageRow = (day: string, session: string, who: string, model: string, usd: number, base: number, extra: number, steps = 1): Step => ({
  sql: `INSERT INTO usage (day, session, who, model, steps, usd, base, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, session, who, model) DO UPDATE SET steps = steps + excluded.steps, usd = usd + excluded.usd, base = base + excluded.base, extra = extra + excluded.extra`,
  params: [day, session, who, model, steps, usd, base, extra],
})

export const spawnRow = (day: string, session: string, type: string, routed: number, respawned: number, runs = 1): Step => ({
  sql: `INSERT INTO spawns VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (day, session, type) DO UPDATE SET runs = runs + excluded.runs, routed = routed + excluded.routed, respawned = respawned + excluded.respawned`,
  params: [day, session, type, runs, routed, respawned],
})

// ---- 0.2's ledger: one JSON file per session per day ----

// One old file as rows. It kept spend per model only (chat and classifier mixed), so it goes in as 'main';
// its per-agent spend had no model and stays out (the per-model totals already hold it).
export function legacySteps(b: Bucket): Array<Step> {
  return [
    sessionRow(b.session, b.project, labelOf(String(b.label ?? ''))),
    dayRow(b.day, b.session, b.turns ?? 0, b.first, b.last),
    ...Object.entries(b.byModel ?? {}).map(([m, x]) => usageRow(b.day, b.session, 'main', m, x.usd, x.base, Math.max(0, x.usd - x.base), x.steps)),
    ...Object.entries(b.agents ?? {}).map(([t, a]) => spawnRow(b.day, b.session, t, a.routed, a.respawned, a.runs)),
  ]
}

// ---- reads ----

// This project's totals across chats, and the ledger's first day.
export const totalsQuery = (project: string): Array<Step> => [
  { sql: 'SELECT coalesce(sum(u.usd), 0) AS usd, coalesce(sum(u.base), 0) AS base, coalesce(sum(u.extra), 0) AS extra FROM usage u JOIN sessions s ON s.id = u.session WHERE s.project = ?', params: [project], all: true },
  { sql: 'SELECT min(first) AS since FROM days', all: true },
]

export type Totals = { proj: Tally; since: number | undefined }

export function totalsOf(rows: Array<Array<Record<string, unknown>> | null>): Totals {
  const t = rows[0]?.[0] ?? {}
  const since = rows[1]?.[0]?.since
  return { proj: { actualUsd: Number(t.usd ?? 0), baselineUsd: Number(t.base ?? 0), extraUsd: Number(t.extra ?? 0) }, since: typeof since === 'number' ? since : undefined }
}

export const BOARD: Array<Step> = [
  { sql: 'SELECT d.day, d.session, s.project, s.label, d.turns, d.first, d.last FROM days d JOIN sessions s ON s.id = d.session', all: true },
  { sql: 'SELECT day, session, who, model, steps, usd, base, extra FROM usage', all: true },
  { sql: 'SELECT day, session, type, runs, routed, respawned FROM spawns', all: true },
]

const NO_AGENT: AgentTally = { runs: 0, routed: 0, respawned: 0, usd: 0, base: 0, extra: 0 }

// The Board's rows: one per session per day, as the view draws them.
export function bucketsOf(rows: Array<Array<Record<string, any>> | null>): Array<Bucket> {
  const [days = [], usage = [], spawns = []] = rows.map(r => r ?? [])
  const out = new Map<string, Bucket>()
  for (const d of days) out.set(`${d.day}|${d.session}`, { day: d.day, project: d.project, session: d.session, label: d.label, first: d.first, last: d.last, turns: d.turns, byModel: {} })
  for (const u of usage) {
    const b = out.get(`${u.day}|${u.session}`)
    if (!b) continue
    const m = b.byModel[u.model] ?? { usd: 0, base: 0, extra: 0, steps: 0 }
    b.byModel[u.model] = { usd: m.usd + u.usd, base: m.base + u.base, extra: m.extra + (u.extra ?? 0), steps: m.steps + u.steps }
    if (u.who !== 'main' && u.who !== 'router') {
      const a = b.agents?.[u.who] ?? NO_AGENT
      b.agents = { ...b.agents, [u.who]: { ...a, usd: a.usd + u.usd, base: a.base + u.base, extra: a.extra + (u.extra ?? 0) } }
    }
  }
  for (const x of spawns) {
    const b = out.get(`${x.day}|${x.session}`)
    if (!b) continue
    const a = b.agents?.[x.type] ?? NO_AGENT
    b.agents = { ...b.agents, [x.type]: { ...a, runs: a.runs + x.runs, routed: a.routed + x.routed, respawned: a.respawned + x.respawned } }
  }
  return [...out.values()]
}
