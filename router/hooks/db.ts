// The ledger in one SQLite file, ~/.claude/router/router.db. A mod has no Node, so a fixed runner (node's built-in
// node:sqlite) takes a batch of statements on stdin and runs them in one transaction; every statement lives here.
import type { EngineInterface } from 'claude-code'
import type { AgentTally, Bucket, Cache, Switch, Tally } from '../types'
import type { Life } from './policy'

// Deletes the files in a folder whose name starts with a prefix and that are at least `age` ms old; a missing folder is
// fine. Run as: node -e SWEEP <dir> <prefix> <age>. ($.fs has no delete.)
export const SWEEP = "const fs=require('node:fs'),p=require('node:path');const [d,pre,age]=process.argv.slice(1);for(const n of fs.existsSync(d)?fs.readdirSync(d):[]){const f=p.join(d,n);if(n.startsWith(pre)&&Date.now()-fs.statSync(f).mtimeMs>=Number(age))fs.rmSync(f,{force:true})}"

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

// efforts: the same model steps by the effort they ran at, the effort they would have run at with no router (asked),
// the task class and why the effort was set (EffortWhy), so the extra spend can be traced to the class or raise that
// bought it. Kept EFFORTS_DAYS; usage, days and spawns are kept LEDGER_DAYS (cleanupSteps).
// who: 'main' (the chat), 'router' (the classifier and session check: spend with no baseline) or a subagent type.
// base: what the same steps would have cost with no router (the asked model and effort; 0 for the router's own calls).
// extra: the part of usd above base, summed per step, so savings and extra spend stay apart (saved = base - usd + extra).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project TEXT NOT NULL, label TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS days (day TEXT, session TEXT, turns INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (day, session)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS usage (day TEXT, session TEXT, who TEXT, model TEXT, steps INTEGER NOT NULL, usd REAL NOT NULL, base REAL NOT NULL, extra REAL NOT NULL DEFAULT 0, tin INTEGER NOT NULL DEFAULT 0, tread INTEGER NOT NULL DEFAULT 0, twrite INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, session, who, model)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spawns (day TEXT, session TEXT, type TEXT, runs INTEGER NOT NULL, routed INTEGER NOT NULL, respawned INTEGER NOT NULL, PRIMARY KEY (day, session, type)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS efforts (day TEXT, session TEXT, who TEXT, model TEXT, effort TEXT, asked TEXT, cls TEXT, why TEXT, steps INTEGER NOT NULL, usd REAL NOT NULL, base REAL NOT NULL, extra REAL NOT NULL, PRIMARY KEY (day, session, who, model, effort, asked, cls, why)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS switches (id TEXT PRIMARY KEY, day TEXT NOT NULL, at INTEGER NOT NULL, session TEXT NOT NULL, who TEXT NOT NULL, kind TEXT NOT NULL, from_model TEXT NOT NULL, from_effort TEXT NOT NULL, to_model TEXT NOT NULL, to_effort TEXT NOT NULL, cls TEXT NOT NULL, why TEXT NOT NULL, undo_usd REAL NOT NULL, label TEXT, source TEXT, labelled INTEGER, text TEXT, local TEXT) WITHOUT ROWID;
`

// 0.4's ledger had no `extra`: older rows get 0 (their extra spend was never split out).
// Before 0.7 no prompt tokens were kept (tin uncached input, tread cache reads, twrite cache writes): 0, no cache hit known.
export const MIGRATE = [
  'ALTER TABLE usage ADD COLUMN extra REAL NOT NULL DEFAULT 0',
  'ALTER TABLE usage ADD COLUMN tin INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE usage ADD COLUMN tread INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE usage ADD COLUMN twrite INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE switches ADD COLUMN text TEXT', // 0.9.4: the prompt, kept only with Training on
  'ALTER TABLE switches ADD COLUMN local TEXT', // 0.9.4: a later local classifier's answer, beside Haiku's
]

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
// a secret masked (long tokens, a password in a URL, key=value secrets). Nothing else of a prompt is stored, except with
// Training on: the prompt, masked the same way, up to 2000 characters (max), with its switch rows (rule 5).
export function labelOf(text: string, max = 60): string {
  return text
    .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(:\/\/[^\s/:@]*:)[^\s@]+@/g, '$1…@')
    .replace(/\b(\w*(?:pass(?:word)?|secret|token|key|pwd)\w*\s*[=:]\s*)\S+/gi, '$1…')
    .replace(/[\w+/=-]{24,}/g, '…')
    .trim()
    .slice(0, max)
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

export const usageRow = (day: string, session: string, who: string, model: string, usd: number, base: number, extra: number, steps = 1, c: Cache = NO_CACHE): Step => ({
  sql: `INSERT INTO usage (day, session, who, model, steps, usd, base, extra, tin, tread, twrite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, session, who, model) DO UPDATE SET steps = steps + excluded.steps, usd = usd + excluded.usd, base = base + excluded.base, extra = extra + excluded.extra, tin = tin + excluded.tin, tread = tread + excluded.tread, twrite = twrite + excluded.twrite`,
  params: [day, session, who, model, steps, usd, base, extra, c.input, c.read, c.write],
})

// as-is: the effort the step came with (the picker's, or one the person set later); class: the task class's effort;
// unhappy: the class's raised by unhappy replies; pick: the person's pick in Settings; asked: named in the prompt;
// agent: a subagent's routed effort; nudge: keep-awake's low; probe: an eval's forced effort.
export type EffortWhy = 'as-is' | 'class' | 'unhappy' | 'pick' | 'asked' | 'agent' | 'nudge' | 'adjust' | 'probe'
export type EffortOf = { effort: string; asked: string; cls: string; why: EffortWhy }
export const effortRow = (day: string, session: string, who: string, model: string, d: EffortOf, usd: number, base: number, extra: number): Step => ({
  sql: `INSERT INTO efforts VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (day, session, who, model, effort, asked, cls, why) DO UPDATE SET steps = steps + 1, usd = usd + excluded.usd, base = base + excluded.base, extra = extra + excluded.extra`,
  params: [day, session, who, model, d.effort, d.asked, d.cls, d.why, usd, base, extra],
})

// switches (training data, opt-in): one row per router switch (Switch in types), or per turn it kept as it was
// (kind 'stay'), with the masked prompt (main chat only; a subagent's brief is the model's text, never stored), the
// label filled in later. label 'good' | 'bad'; source 'button' (👍/👎 in the band) or 'mood' (your next message:
// unhappy, or a short thanks). A mood label never overwrites a button one; a button press overwrites a mood label.
export const switchRow = (day: string, session: string, w: Switch, text: string | null): Step => ({
  sql: 'INSERT OR IGNORE INTO switches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)',
  params: [w.id, day, w.at, session, w.who, w.kind, w.fromModel, w.fromEffort, w.toModel, w.toEffort, w.cls, w.why, w.undoUsd, text],
})
export const labelRow = (id: string, label: 'good' | 'bad', at: number): Step => ({
  sql: `UPDATE switches SET label = ?, source = 'button', labelled = ? WHERE id = ?`,
  params: [label, at, id],
})
export const moodRow = (id: string, label: 'good' | 'bad', at: number): Step => ({
  sql: `UPDATE switches SET label = ?, source = 'mood', labelled = ? WHERE id = ? AND source IS NULL`,
  params: [label, at, id],
})
// The band's effort arrows (owner ask 2026-11-28): the router's effort for this prompt, set right by your hand. The row
// says what it chose (from) and what you wanted (to), why lower or higher; arrowed back to its choice, it is unlabelled.
export const adjustRow = (id: string, toEffort: string, why: 'lower' | 'higher' | 'right', at: number): Step => ({
  sql: 'UPDATE switches SET to_effort = ?, why = ?, label = ?, source = ?, labelled = ? WHERE id = ?',
  params: [toEffort, why, why === 'right' ? null : 'bad', why === 'right' ? null : 'adjust', why === 'right' ? null : at, id],
})
// The same for the Settings move buttons: the chat's model, set right by your hand.
export const adjustModelRow = (id: string, toModel: string, why: 'lower' | 'higher' | 'right', at: number): Step => ({
  sql: 'UPDATE switches SET to_model = ?, why = ?, label = ?, source = ?, labelled = ? WHERE id = ?',
  params: [toModel, why, why === 'right' ? null : 'bad', why === 'right' ? null : 'adjust', why === 'right' ? null : at, id],
})
// Balance (owner, 2026-11-26): unlabelled rows would swamp the labelled ones and teach a model to keep everything as is,
// so from before `day` (today's can still be rated) at most SILENT_PER_LABEL unlabelled rows per labelled one stay, the
// newest, counted apart for switches and for stays.
export const SILENT_PER_LABEL = 2
const keepSilent = (day: string, stay: boolean): Step => ({
  sql: `DELETE FROM switches WHERE label IS NULL AND day < ? AND (kind = 'stay') = ? AND id NOT IN (SELECT id FROM switches WHERE label IS NULL AND (kind = 'stay') = ? ORDER BY at DESC LIMIT (SELECT ? * COUNT(*) FROM switches WHERE label IS NOT NULL))`,
  params: [day, stay ? 1 : 0, stay ? 1 : 0, SILENT_PER_LABEL],
})

// The ledger stays small: per-effort detail for EFFORTS_DAYS (enough to tune routing), the rest for LEDGER_DAYS (the
// Board's longest range is a year), and a session with no day left goes too. Run with each session's first batch.
export const EFFORTS_DAYS = 60
export const LEDGER_DAYS = 400
export const cleanupSteps = (dayBefore: (days: number) => string): Array<Step> => [
  { sql: 'DELETE FROM efforts WHERE day < ?', params: [dayBefore(EFFORTS_DAYS)] },
  ...['usage', 'days', 'spawns', 'switches'].map(t => ({ sql: `DELETE FROM ${t} WHERE day < ?`, params: [dayBefore(LEDGER_DAYS)] })),
  keepSilent(dayBefore(0), false),
  keepSilent(dayBefore(0), true),
  { sql: 'DELETE FROM sessions WHERE id NOT IN (SELECT session FROM days)' },
]

export const NO_CACHE: Cache = { input: 0, read: 0, write: 0 }
export const addCache = (a: Cache | undefined, b: Cache): Cache => ({ input: (a?.input ?? 0) + b.input, read: (a?.read ?? 0) + b.read, write: (a?.write ?? 0) + b.write })

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

// Every session's spend on this machine since a local day (YYYY-MM-DD): the dollars behind this week's plan usage.
export const spendSinceQuery = (day: string): Step => ({ sql: `SELECT COALESCE(SUM(usd), 0) AS usd FROM usage WHERE day >= ?`, params: [day], all: true })
export const spendOf = (rows: Array<Array<Record<string, unknown>> | null>) => Number(rows[0]?.[0]?.usd ?? 0)
export type Totals = { proj: Tally; since: number | undefined }

export function totalsOf(rows: Array<Array<Record<string, unknown>> | null>): Totals {
  const t = rows[0]?.[0] ?? {}
  const since = rows[1]?.[0]?.since
  return { proj: { actualUsd: Number(t.usd ?? 0), baselineUsd: Number(t.base ?? 0), extraUsd: Number(t.extra ?? 0) }, since: typeof since === 'number' ? since : undefined }
}

// Past chats' lengths in main-chat steps, for the switch-down math (policy.ts remainingSteps); never the chat asking.
export const livesQuery = (session: string): Step => ({
  sql: `SELECT u.session, sum(u.steps) AS steps, (SELECT max(d.last) FROM days d WHERE d.session = u.session) AS last FROM usage u WHERE u.who = 'main' AND u.session != ? GROUP BY u.session`,
  params: [session],
  all: true,
})
// A chat used within the cache's hour may still go on: it only says "at least this long".
export function livesOf(rows: Array<Array<Record<string, unknown>> | null>, now: number): Array<Life> {
  return (rows[0] ?? []).map(r => ({ steps: Number(r.steps ?? 0), open: now - Number(r.last ?? 0) < 60 * 60 * 1000 })).filter(x => x.steps > 0)
}

export const BOARD: Array<Step> = [
  { sql: 'SELECT d.day, d.session, s.project, s.label, d.turns, d.first, d.last FROM days d JOIN sessions s ON s.id = d.session', all: true },
  { sql: 'SELECT day, session, who, model, steps, usd, base, extra, tin, tread, twrite FROM usage', all: true },
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
    const cache = addCache(m.cache, { input: u.tin ?? 0, read: u.tread ?? 0, write: u.twrite ?? 0 })
    b.byModel[u.model] = { usd: m.usd + u.usd, base: m.base + u.base, extra: m.extra + (u.extra ?? 0), steps: m.steps + u.steps, cache }
    if (u.who === 'awake') { // nudge rows carry the cost, the saving row (no steps) the avoided re-read
      const a = b.awake ?? { nudges: 0, usd: 0, saved: 0 }
      b.awake = { nudges: a.nudges + u.steps, usd: a.usd + u.usd, saved: a.saved + Math.max(0, u.base - u.usd) }
    } else if (u.who !== 'main' && u.who !== 'router') {
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
