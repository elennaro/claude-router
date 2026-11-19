// Shared eval helpers: an isolated `claude -p` call with a hard spend cap, JSONL files, a small worker pool.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN, merge } from '../router/hooks/policy.ts'

export const ROOT = dirname(fileURLToPath(import.meta.url))
export const WORK = join(ROOT, 'work') // private, gitignored: mined prompts, raw answers, spend
export const CAP_USD = Number(process.env.EVAL_CAP_USD ?? 40)
const EMPTY = join(WORK, 'empty') // runs start here: no project CLAUDE.md, no project settings
mkdirSync(EMPTY, { recursive: true })

export const readJsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [])
export const writeJsonl = (p, rows) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')) }
export const appendJsonl = (p, row) => { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(row) + '\n') }
export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback)
// The config under test: the plugin's built-in one, or a candidate file (EVAL_ROUTING=path); never the machine's own ~/.claude/routing.json.
export const evalRouting = () => (process.env.EVAL_ROUTING ? readJson(process.env.EVAL_ROUTING, {}) : {})
// What the plugin loads in a case's project: the config under test, then that project's routing.json on top.
let base
export const cfgFor = project => {
  base ??= merge(BUILTIN, evalRouting())
  return project && project !== 'plain' ? merge(base, readJson(join(ROOT, 'projects', `${project}.routing.json`), {})) : base
}

const SPEND = join(WORK, 'spend.jsonl')
export const spent = () => readJsonl(SPEND).reduce((a, r) => a + (r.usd ?? 0), 0)
let total = spent()

export class CapReached extends Error {} // stops a run: no more paid calls

// cache: true keeps the result on disk under a hash of everything the model sees, so the same question is paid once
// (judges: a re-run of the same judge on the same pair is free; a changed prompt is a new key).
// The store: one SQLite file with every model output an eval has paid for (answers, judge verdicts, Jev and Haiku
// replies), so any re-run or re-score reads it instead of asking again. EVAL_OFFLINE=1 turns a miss into an error.
let db
function store() {
  if (db) return db
  mkdirSync(WORK, { recursive: true })
  db = new DatabaseSync(join(WORK, 'eval.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; CREATE TABLE IF NOT EXISTS calls (key TEXT PRIMARY KEY, kind TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL)')
  return db
}
export const cacheGet = key => { const r = store().prepare('SELECT result FROM calls WHERE key = ?').get(key); return r ? JSON.parse(r.result) : undefined }
export const cachePut = (key, kind, value) => { store().prepare('INSERT OR REPLACE INTO calls VALUES (?, ?, ?, ?)').run(key, kind, JSON.stringify(value), new Date().toISOString()) }
export const cacheCount = () => Object.fromEntries(store().prepare('SELECT kind, COUNT(*) AS n FROM calls GROUP BY kind').all().map(r => [r.kind, r.n]))
export const OFFLINE = Boolean(process.env.EVAL_OFFLINE)
export class OfflineMiss extends CapReached {} // a miss under EVAL_OFFLINE stops the run too, so nothing is scored on missing data
export const offlineMiss = what => new OfflineMiss(`EVAL_OFFLINE: ${what} is not in the store; run without EVAL_OFFLINE to pay for it`)
// seed: which sample this is, for calls asked several times on purpose (the classifier's 3 samples, 3 runs); each
// sample is paid once and then replayed. Only appended when given, so older cache keys stay valid.
export const cacheKey = o => createHash('sha256').update(JSON.stringify([o.model, o.effort ?? '', o.system ?? '', o.prompt, o.tools ?? '', o.json ?? null, ...(o.seed === undefined ? [] : [o.seed])])).digest('hex')

// One isolated run: project settings only (no user CLAUDE.md, memory, plugins or MCP), no session file.
// tools: '' for none, or a comma list of allowed tools. Returns { text, usd, usage, turns, ms }.
export function claude(o) {
  if (!o.cache) return OFFLINE ? Promise.reject(offlineMiss(`uncached call ${o.tag}`)) : run(o)
  const key = cacheKey(o)
  const hit = cacheGet(key)
  if (hit) return Promise.resolve({ ...hit, usd: 0, cached: true })
  if (OFFLINE) return Promise.reject(offlineMiss(`call ${o.tag}`))
  return run(o).then(r => { cachePut(key, 'claude', r); return r })
}
function run({ model, effort, system, prompt, tools = '', cwd = EMPTY, tag = 'run', timeoutMs = 600_000, json }) {
  if (total >= CAP_USD) return Promise.reject(new CapReached(`spend cap $${CAP_USD} reached ($${total.toFixed(2)})`))
  const args = ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands',
    '--strict-mcp-config', '--setting-sources', 'project', '--tools', tools]
  if (effort) args.push('--effort', effort)
  if (system) args.push('--system-prompt', system)
  if (tools) args.push('--permission-mode', 'default', '--allowedTools', tools)
  if (json) args.push('--json-schema', JSON.stringify(json))
  return new Promise((resolve, reject) => {
    const child = execFile('claude', args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      let r
      try { r = JSON.parse(stdout); if (Array.isArray(r)) r = r.find(x => x.type === 'result') } catch { /* below */ }
      const usd = r?.total_cost_usd ?? 0
      total += usd
      appendJsonl(SPEND, { at: new Date().toISOString(), tag, model, effort, usd })
      if (!r) return reject(new Error(`claude -p gave no JSON (${err?.message ?? 'no error'}): ${String(stdout).slice(0, 300)}`))
      if (r.is_error) return reject(new Error(`claude -p error: ${String(r.result).slice(0, 300)}`))
      resolve({ text: String(r.result ?? '').trim(), structured: r.structured_output, usd, usage: r.usage, turns: r.num_turns, ms: r.duration_ms })
    })
    child.stdin.end(prompt)
  })
}

// Runs fn over items, n at a time; a CapReached stops new work and is rethrown at the end.
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  let stop
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length && !stop) {
      const k = i++
      try { out[k] = await fn(items[k], k) } catch (e) { if (e instanceof CapReached) stop = e; else out[k] = { error: String(e.message ?? e) } }
    }
  }))
  if (stop) throw stop
  return out
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const RANK = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

// false-cheap / match / false-dear between what the router sent and the needed tier. Any step below the need is
// false cheap (the label is already the cheapest tier that held); one effort step above it is still a match.
export function compareTier(sent, need) {
  const dm = RANK[sent.model] - RANK[need.model]
  const de = EFFORTS.indexOf(sent.effort) - EFFORTS.indexOf(need.effort)
  if (dm < 0 || (dm === 0 && de < 0)) return 'false-cheap'
  if (dm > 0 || (dm === 0 && de > 1)) return 'false-dear'
  return 'match'
}

export function log(...a) { console.log(`[${new Date().toLocaleTimeString()}] $${total.toFixed(2)}`, ...a) }
