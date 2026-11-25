import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Advice, Away, Bucket, Cache, ChatModel, Cold, Features, Hint, Mix, Tally, RouterView, TurnLog, Why } from '../types'
import { BOARD, SWEEP, livesQuery, livesOf, type Step, type Totals, IMPORTED, addCache, bucketsOf, dayRow, isAlreadyImported, labelOf, legacySteps, run, sessionRow, spawnRow, totalsOf, totalsQuery, usageRow } from './db'
import { shield } from './guard'
import { claudeFamily } from './latest'
import {
  type AgentName, type Call, type Env, type PriceCheck, type Tool, type Versions, ROLES, agyModels, checkPrices, checkVersions, codexModels,
  env, outsideCall, runAgy, runCodex, updateTool, versions,
} from './outside'
import {
  type Ask, AUTO, BUILTIN, DELEGATE_ID, delegateSection, wantsDelegate, CLASS_LABELS, type Config, type Usage, type SessionWindow, adviseSwitch, agentTier, autoModel, classifierPrompt, firstModel, parseSessionCheck, sessionCheckPrompt, sessionCheckSystem, classifierSystem, classifyByRules, costUsd, explicitAsk, family,
  classifyPlan, isCacheBreak, merge, settleAnswers, readLabel, prices, rank, setPrices, turnEffort, briefHash, isHarder, needsSecondSample, spawnPick, withoutRouter,
  type Mood, longRun, moodPrompt, moodSystem, parseMood, raiseEffort, raiseSteps, stepUp, rebuildUsd, stepUsd, switchMath, FAMILIES, coldMath,
  AWAKE_DEFAULT_HOURS, AWAKE_HOURS, AWAKE_MIN, AWAKE_PING_MS, AWAKE_TEXT, AWAY_COMPACT, awakeNext, isNudgeReply,
  COMPACT_POINTS, cheapestPoint, compactStepUsd,
  SIZED, briefPaths, bucket, sizeOf, cacheSheet, PASTE_MIN, estTokens, keepsRaw, pasteModel, pasteSystem, pastePrompt, offloaded,
} from './policy'
import { type Cell, NAMES, TOOL_NAMES, addWhy, awayWords, cacheClock, minutesLeft, coldWords, whyWords, barsSvg, boardHtml, cardLayout, hitPct, switchCost, svgSize, isExtra, modelColor, money, shade, net, netPct, netWords, savedUsd, statsSvg, withMode } from './view'

const PANE = 'router'
const hint = atom({ plugin: 'router', key: 'hint' } as const, null)
const isHidden = atom({ plugin: 'router', key: 'isHidden' } as const, false)
const EMPTY_TALLY: Tally = { actualUsd: 0, baselineUsd: 0, extraUsd: 0 }
const tally = atom({ plugin: 'router', key: 'tally' } as const, EMPTY_TALLY, { shape: 'tally-2' } /* 0.5: baseline is the no-router cost, extra split out */)
const EMPTY_VIEW: RouterView = { isOn: true, autoEffort: true, routeModels: true, perMessage: 'unknown', lastClass: null, lastEffort: null, pickerEffort: null, rerouted: 0, routedAgents: 0 }
const view = atom({ plugin: 'router', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-3' })
const log = atom({ plugin: 'router', key: 'log' } as const, [] as Array<TurnLog>, { shape: 'log-2' })
const mix = atom({ plugin: 'router', key: 'mix' } as const, {} as Mix)
const cacheOf = (u: Usage): Cache => ({ input: u.input_tokens, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens })
const panel = atom({ plugin: 'router', key: 'panel' } as const, 'none' as 'none' | 'stats' | 'settings')
const isWidgetOpen = atom({ plugin: 'router', key: 'isWidgetOpen' } as const, false)
const modes = atom({ plugin: 'router', key: 'modes' } as const, { global: null as string | null, project: null as string | null, isProject: false })
const tools = atom({ plugin: 'router', key: 'tools' } as const, null as Versions | null)
const updating = atom({ plugin: 'router', key: 'updating' } as const, null as Tool | null)
const chat = atom({ plugin: 'router', key: 'chat' } as const, { model: null, by: null } as ChatModel) // the chat's model: picked on its first prompt, or by the person
const advice = atom({ plugin: 'router', key: 'advice' } as const, null as Advice | null)
const FEATURES_ON: Features = { autoSwitch: true, sizing: true, pastes: true, awake: true }
const features = atom({ plugin: 'router', key: 'features' } as const, FEATURES_ON)
const cold = atom({ plugin: 'router', key: 'cold' } as const, null as Cold | null)
const away = atom({ plugin: 'router', key: 'away' } as const, null as Away | null)
const awakeHours = atom({ plugin: 'router', key: 'awakeHours' } as const, AWAKE_DEFAULT_HOURS)
const compactAt = atom({ plugin: 'router', key: 'compactAt' } as const, null as number | null)
const TODO_TOOLS = ['TodoWrite', 'mcp__ccd_turn__update_plan'] // the task list as Claude Code and the desktop app keep it

const pretty = (m: string) => NAMES[family(m)] ?? m

type Def = { model?: string; effort?: string }

// Session state; module variables start over on a reload, which is fine for all of these.
type State = {
  cfg: Config
  home: string
  root: string
  project: string
  sources: string // which routing.json files loaded
  lastClass: string | null
  lastHintModel: string | null
  hasClassified: boolean // any prompt classified yet (continuations skip Haiku after that)
  hadClass: boolean // any class found yet (the first one may show a hint)
  skipEffortThisTurn: boolean
  sure: boolean // the last class came from a rule or a confident (>= 0.85) classifier answer
  switchTurn: boolean // this prompt's own turn may run on its class model (a follow-up goes back to the picked model)
  headless: boolean // claude -p runs (scripts, agent harnesses): their frontmatter decides, the router only counts
  agentEffort: Map<string, string>
  defs: Map<string, Def>
  prev: { effort: string; read: number; at: number; model: string } // main-loop cache guard
  lastContext: number // prompt tokens of the last main-loop step
  mainSteps: number // main-loop steps in this chat: its age, for the switch-down math
  mainOut: number // output tokens of those steps: the typical answer size
  cleanChanges: number
  baseEffort: string // the effort the session started on: the app picker's default, routed like main.effort
  rerouted: number // main-loop turns sent at another effort than the picker's
  lastRerouted: string // turnId last counted in rerouted
  agentType: Map<string, string> // agentId -> subagent type, for the dashboard log
  agentAsked: Map<string, string> // agentId -> the model it would have run on with no router (the parent's, before any move of the parent), when that differs from what it runs on
  agentSpend: Map<string, { usd: number; base: number; extra: number; model: string }> // agentId -> the run's recorded totals
  pasted: boolean // a big paste was saved this session (its file is deleted at the end)
  coldTimer: { cancel: () => void } | undefined // keep-awake: fires 50 minutes after the main chat's last step
  minuteTick: { cancel: () => void } | undefined // redraws the Stats card's cache clock once a minute while it is open
  awakeSince: number // the main chat's last step that was not a keep-awake nudge: the away window starts there
  pinging: boolean // the turn running now is the router's own keep-awake nudge
  openTurn: string // the main chat's turn still running ('' when idle): keep-awake waits while one is open
  seg: { ctx: number; steps: number } // where the chat stood at its first step since the last compaction or clear: its growth per step
  briefRun: Map<string, string> // brief hash -> the agentId of its latest run
  wastedRuns: Set<string> // runs a re-spawn replaced: no saving counts for them
  paneOpened: boolean
  session: string // session id, the ledger's key
  label: string // the first prompt, shortened: how the Board names the session
  lastLedgerTurn: string
  pending: Array<Step> // ledger rows not yet in router.db
  scheduled: boolean // a flush is on the clock
  warned: boolean // the "could not save" toast was shown
  totals: Totals // this project across chats, from router.db's last flush
  routeModels: boolean
  ask: Ask | undefined // a model or effort named in this prompt (or kept "from now on")
  stickyAsk: Ask | undefined
  seenPrompt: boolean // a prompt reached the router in this session (the first one may pick the chat's model)
  samples: Array<string | null | undefined> // this prompt's classifier answers (3 on the first prompt)
  turnCount: number // prompts the router saw in this session
  quietUntil: number // no new session-check offer before this turn
  declined: string | null // the trigger whose offer was turned down: quiet until another trigger fires
  switching: boolean // a switch button is compacting or clearing: its own compaction is no trigger
  queue: Promise<unknown> // serial(): router.db batches, one at a time
  briefs: Map<string, string> // brief hash -> the model its subagent ran on: a repeat goes one tier up
  siblings: Map<string, string> // workflow run -> the highest model its routed agents got: siblings share it (and its cache)
  savedAgents: string // the subagent memory last written to the store (keepAgents)
  unhappy: number // replies in this task Haiku read as unhappy with the answer: each raises the turn's effort a step
  v: Env | undefined
}

// The subagent memory (which runs were moved, their type, effort and spend, repeats, siblings) lives in this process.
// It goes to the plugin store per session, so a restart or a reload that resumes the chat still knows what it moved.
// The chat's Stats (tally, turn rows, model mix) go with it: $.state survives a hot reload, not a restart.
const AGENTS_KEPT = 30 // sessions; older ones are dropped
const AGENTS_MAX = 400 // entries per map; shortcut: a longer session forgets its oldest runs, raise if that ever shows
type AgentMemory = Record<'asked' | 'type' | 'effort' | 'briefRun' | 'briefs' | 'siblings', Array<[string, string]>> & {
  spend: Array<[string, { usd: number; base: number; extra: number; model: string }]>
  wasted: Array<string>
  stats: { tally: Tally; log: Array<TurnLog>; mix: Mix }
}
async function agentMemory($: EngineInterface, s: State): Promise<AgentMemory> {
  const last = <T,>(it: Iterable<T>) => [...it].slice(-AGENTS_MAX)
  return {
    asked: last(s.agentAsked), type: last(s.agentType), effort: last(s.agentEffort), briefRun: last(s.briefRun),
    briefs: last(s.briefs), siblings: last(s.siblings), spend: last(s.agentSpend), wasted: last(s.wastedRuns),
    stats: { tally: await read($, tally), log: await read($, log), mix: await read($, mix) },
  }
}
const NO_AGENTS = ''

// Called from flush (inside serial): writes only when the memory changed. Never throws: routing must not wait on it.
async function keepAgents($: EngineInterface, s: State) {
  try {
    const m = await agentMemory($, s)
    const json = JSON.stringify(m)
    if (json === s.savedAgents || !s.session || s.session === 'session' || (!m.stats.log.length && !m.type.length)) return
    s.savedAgents = json
    const at = await $.clock.now()
    await $.store.set(`agents:${s.session}`, { at, ...JSON.parse(json) })
    const index = (((await $.store.get('agents')) as Array<[string, number]> | undefined) ?? []).filter(([id]) => id !== s.session)
    index.push([s.session, at])
    for (const [id] of index.splice(0, Math.max(0, index.length - AGENTS_KEPT))) await $.store.delete(`agents:${id}`)
    await $.store.set('agents', index)
  } catch { /* a full or broken store only costs the memory after a restart */ }
}

// A chat that ran before the mix existed (an update loaded mid-chat) starts its model band from the turn log.
// shortcut: the log keeps the last 30 turns and runs, so an older chat's band covers only those until new steps add up
async function seedMix($: EngineInterface) {
  if (Object.keys(await read($, mix)).length) return
  const rows = await read($, log)
  if (!rows.length) return
  await update($, mix, (): Mix => {
    const m: Mix = {}
    for (const r of rows) {
      const k = `${r.model}:${r.effort}`
      m[k] = { usd: (m[k]?.usd ?? 0) + r.usd, steps: (m[k]?.steps ?? 0) + r.steps, cache: r.cache ? addCache(m[k]?.cache, r.cache) : (m[k]?.cache ?? { input: 0, read: 0, write: 0 }) }
    }
    return m
  })
}

async function restoreAgents($: EngineInterface, s: State) {
  try {
    const id = await $.session.id()
    const m = (await $.store.get(`agents:${id}`)) as Partial<AgentMemory> | undefined
    if (!m) return
    const fill = <V,>(map: Map<string, V>, rows?: Array<[string, V]>) => { for (const [k, v] of rows ?? []) if (!map.has(k)) map.set(k, v) }
    fill(s.agentAsked, m.asked); fill(s.agentType, m.type); fill(s.agentEffort, m.effort); fill(s.briefRun, m.briefRun)
    fill(s.briefs, m.briefs); fill(s.siblings, m.siblings); fill(s.agentSpend, m.spend)
    for (const w of m.wasted ?? []) s.wastedRuns.add(w)
    // a fresh process starts from zero; after a hot reload the atoms already hold this chat
    const st = m.stats
    if (st && (await read($, tally)).actualUsd === 0 && (await read($, log)).length === 0 && Array.isArray(st.log)) {
      await update($, tally, (): Tally => ({ ...EMPTY_TALLY, ...st.tally }))
      await update($, log, (): Array<TurnLog> => st.log)
      await update($, mix, (): Mix => st.mix ?? {})
    }
    s.savedAgents = JSON.stringify(await agentMemory($, s))
  } catch { /* nothing kept: runs from before the restart are booked as asked, as before */ }
}

async function readJson($: EngineInterface, path: string): Promise<any> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    $.ui.toast(`router: ${path} is not valid JSON, ignored`)
    return undefined
  }
}

// Frontmatter `model:` / `effort:` of an agent definition.
function frontmatter(text: string): Def {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const pick = (k: string) => new RegExp(`^${k}:\\s*["']?([\\w.\\[\\]-]+)`, 'm').exec(head)?.[1]
  return { model: pick('model'), effort: pick('effort') }
}

async function load($: EngineInterface, s: State) {
  s.home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  s.root = (await $.session.root()).replace(/\\/g, '/')
  s.project = s.root.split('/').filter(Boolean).pop() ?? 'unknown'
  const g = await readJson($, `${s.home}/.claude/routing.json`)
  const p = s.root.toLowerCase() === s.home.toLowerCase() ? undefined : await readJson($, `${s.root}/.claude/routing.json`)
  s.cfg = merge(merge(BUILTIN, g), p)
  s.sources = [g ? 'global' : '', p ? 'project' : ''].filter(Boolean).join(' + ') || 'built-in only'
  const m = { global: typeof g?.mode === 'string' ? g.mode : null, project: typeof p?.mode === 'string' ? p.mode : null, isProject: s.root.toLowerCase() !== s.home.toLowerCase() }
  await update($, modes, () => m)
  s.session = await $.session.id().catch(() => s.session)
  // shortcut: 0.2's store totals, now in router.db; drop this once no 0.2 install is left
  const old = (await $.store.get('projects')) as Array<string> | undefined
  if (old) { for (const k of [...old.map(n => `tally:${n}`), 'projects', 'ledgerSince']) await $.store.delete(k) }
  void importLegacy($, s).catch(() => undefined) // a failed import tries again next session
  void flush($, s) // this project's totals for the band
  const checked = (await $.store.get('prices')) as PriceCheck | undefined
  if (checked?.table) setPrices(checked.table) // last week's check of the pricing page
  const stored = (await $.store.get('perMessage')) as RouterView['perMessage'] | undefined
  await update($, view, (v): RouterView => ({ ...v, isOn: s.cfg.mode !== 'off', autoEffort: s.cfg.autoEffort, perMessage: stored ?? 'unknown' }))
  // a reload starts the module empty while the session's atoms stay: take the chat's switches back from them
  const v = await read($, view)
  s.routeModels = v.routeModels
  s.baseEffort ||= v.pickerEffort ?? ''
}

async function definition($: EngineInterface, s: State, type: string): Promise<Def> {
  const known = s.defs.get(type)
  if (known) return known
  let found: Def = {}
  for (const dir of [`${s.root}/.claude/agents`, `${s.home}/.claude/agents`]) {
    const path = `${dir}/${type}.md`
    try {
      if (await $.fs.exists(path)) { found = frontmatter(String(await $.fs.read(path))); break }
    } catch { /* unreadable definition: treat as unpinned */ }
  }
  s.defs.set(type, found)
  return found
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

const NO_PREV = { effort: '', read: 0, at: 0, model: '' }
const MAX_PENDING = 6000 // shortcut: with node missing for good, the oldest unsaved rows drop; raise if a day ever needs more

// The ledger row's day and session: a /clear's new chat reads its new id here.
async function stamp($: EngineInterface, s: State): Promise<{ day: string; now: number }> {
  const now = await $.clock.now()
  if (!s.session) s.session = await $.session.id().catch(() => 'session')
  return { day: dayOf(now), now }
}

// Rows wait in memory and go to router.db in one batch about every 2 s, at the session's end, and before the Board.
function later($: EngineInterface, s: State, steps: Array<Step>) {
  s.pending.push(...steps)
  if (s.pending.length > MAX_PENDING) s.pending.splice(0, s.pending.length - MAX_PENDING)
  if (s.scheduled) return
  s.scheduled = true
  $.clock.after(2_000, async () => { await flush($, s) })
}

// One batch: the waiting rows, then this project's totals back. A failed run keeps the rows for the next one.
function flush($: EngineInterface, s: State) {
  return serial(s, async () => {
    s.scheduled = false
    const steps = s.pending
    s.pending = []
    try {
      const rows = await run($, s.home, [...steps, ...totalsQuery(s.project)])
      s.totals = totalsOf(rows.slice(steps.length))
    } catch (err) {
      s.pending = [...steps, ...s.pending].slice(-MAX_PENDING)
      if (!s.warned) $.ui.toast(`router: savings stats need Node.js 22.13 or newer on PATH; routing works without it. (${String(err).slice(0, 100)})`)
      s.warned = true
    }
    await keepAgents($, s)
  })
}

// 0.2 kept the ledger as JSON files, one per session per day: read them into router.db once, in one transaction.
// shortcut: a mod cannot delete files, so the old folder stays (the README says it can go); drop once no 0.2 install is left
function importLegacy($: EngineInterface, s: State) {
  return serial(s, async () => {
    if (await $.store.get('ledgerImported')) return
    const dir = `${s.home}/.claude/router/ledger`
    const steps: Array<Step> = []
    for (const day of await $.fs.list(dir).catch(() => [])) {
      if (day.kind !== 'dir') continue
      for (const f of await $.fs.list(`${dir}/${day.name}`).catch(() => [])) {
        if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
        const b = await $.fs.read(`${dir}/${day.name}/${f.name}`).then(t => JSON.parse(String(t)) as Bucket).catch(() => undefined)
        if (b?.byModel && typeof b.day === 'string' && typeof b.session === 'string') steps.push(...legacySteps(b)) // a damaged file is skipped
      }
    }
    // several sessions can start at once after an update: the marker row lets only one batch through (audit 2026-11-19)
    if (steps.length) await run($, s.home, [IMPORTED, ...steps]).catch(err => { if (!isAlreadyImported(err)) throw err })
    await $.store.set('ledgerImported', true)
  })
}

// One subagent run: per type only (runs, routed, re-spawned), never its brief.
async function countAgent($: EngineInterface, s: State, type: string, routed: boolean, respawned: boolean) {
  const { day } = await stamp($, s)
  later($, s, [spawnRow(day, s.session, type, Number(routed), Number(respawned))])
}

// One at a time: flushes take the waiting rows and hand back totals; hooks run at once (parallel subagents).
// A unit must never call serial itself.
function serial<T>(s: State, fn: () => Promise<T>): Promise<T> {
  const r = s.queue.then(fn, fn)
  s.queue = r.catch(() => undefined)
  return r
}

// One step's spend. who: 'main', a subagent type, or 'router' (the classifier and session check: spend with no
// baseline, since without the router they would not run). baseline: what the step would have cost with no router.
// longCache: a main-thread step, whose cache writes are 1-hour entries (costUsd).
// moved: a main step on another model than with no router (else its difference came from effort).
async function record($: EngineInterface, s: State, model: string, u: Usage, who: string, baseline: number, turnId?: string, longCache = false, moved = false) {
  const actual = costUsd(model, u, longCache)
  const extra = Math.max(0, actual - baseline)
  const why: Why = who === 'main' ? (moved ? 'model' : 'effort') : who === 'router' || who === 'paste' || who === 'awake' ? who : 'agents'
  await update($, tally, (t): Tally => ({ actualUsd: t.actualUsd + actual, baselineUsd: t.baselineUsd + baseline, extraUsd: t.extraUsd + extra, by: addWhy(t.by, why, Math.max(0, baseline - actual), extra) }))
  const { day, now } = await stamp($, s)
  const isNewTurn = Boolean(turnId && turnId !== s.lastLedgerTurn)
  if (isNewTurn) s.lastLedgerTurn = turnId!
  later($, s, [
    sessionRow(s.session, s.project, s.label),
    dayRow(day, s.session, Number(isNewTurn), now),
    usageRow(day, s.session, who, family(model), actual, baseline, extra, 1, cacheOf(u)),
  ])
}

// A saving with no spend of its own: keep-awake's avoided rebuild, booked when you come back (no step: steps stay real).
async function bookSaving($: EngineInterface, s: State, model: string, base: number) {
  await update($, tally, (t): Tally => ({ ...t, baselineUsd: t.baselineUsd + base, by: addWhy(t.by, 'awake', base, 0) }))
  const { day } = await stamp($, s)
  later($, s, [usageRow(day, s.session, 'awake', family(model), 0, base, 0, 0)])
}

// A run a re-spawn replaced: its booked baseline goes, and all it spent counts as extra.
async function takeBack($: EngineInterface, s: State, who: string, id: string) {
  s.wastedRuns.add(id)
  const a = s.agentSpend.get(id)
  if (!a) return
  s.agentSpend.delete(id)
  const extra = a.usd - a.extra
  const why: Why = who === 'paste' ? 'paste' : 'agents'
  await update($, tally, (t): Tally => ({ ...t, baselineUsd: t.baselineUsd - a.base, extraUsd: t.extraUsd + extra, by: addWhy(t.by, why, -(a.base - a.usd + a.extra), extra) }))
  const { day } = await stamp($, s)
  later($, s, [usageRow(day, s.session, who, a.model, 0, -a.base, extra, 0)])
}

async function probeLog($: EngineInterface, path: string, line: object) {
  let old = ''
  try { old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : '' } catch { old = '' }
  await $.fs.write(path, old + JSON.stringify(line) + '\n')
}

// A cache entry of the main chat lives an hour after its last read.
const CACHE_LIFE_MS = 60 * 60 * 1000

// Big pastes are saved here, one file per paste, named by session; deleted at the session's end, and a day later by a
// sweep at start for a session that ended without its hook. $.fs has no delete, so node does it (no shell).
const pasteDir = (s: State) => `${s.home}/.claude/router/pastes`
const sweep = ($: EngineInterface, s: State, prefix: string, ageMs: number) =>
  $.process.run(['node', '-e', SWEEP, pasteDir(s), prefix, String(ageMs)], {}).catch(() => undefined)
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').toLowerCase()

// A prompt over PASTE_MIN tokens: save it, have a cheaper model read it, and send the chat the analysis instead
// (docs/PLAN-v3.md, slice 3). undefined: send the prompt as typed (small, "raw", or anything failed: fail open).
async function offload($: EngineInterface, s: State, text: string): Promise<string | undefined> {
  if (estTokens(text) <= PASTE_MIN || keepsRaw(text)) return undefined
  const model = pasteModel(text)
  const tokens = estTokens(text)
  const fail = (why: string) => { $.ui.toast(`router: couldn't read your paste first (${why}); sent as typed.`); return undefined }
  const path = `${pasteDir(s)}/${s.session}-${await $.clock.now()}.txt`
  try { await $.fs.write(path, text) } catch (err) { return fail(`saving it: ${String(err).slice(0, 80)}`) }
  s.pasted = true
  $.ui.toast(`router: your message is about ${Math.round(tokens / 1000)}K tokens; ${model} is reading it so the chat keeps only what matters. Put "raw" in it to skip this.`)
  const r = await $.model.complete({ model, effort: 'low', maxTokens: 2000, timeoutMs: 120_000, system: pasteSystem, prompt: pastePrompt(text) }).catch(() => undefined)
  if (!r?.isAnswered || !r.text.trim()) return fail('no answer from the reader')
  if (r.usage) {
    // with no router the chat's model would have written the paste into its cache once
    // shortcut: later turns re-reading it are not counted, so saved is understated; count them if the Board needs it
    const base = rebuildUsd(await $.session.model(), tokens)
    const usd = costUsd(model, r.usage)
    await record($, s, model, r.usage, 'paste', base)
    s.agentSpend.set(`paste:${normPath(path)}`, { usd, base, extra: Math.max(0, usd - base), model })
  }
  return offloaded(text, path, model, r.text)
}

// The bytes of the files a brief names; undefined when it names none, or one is missing, a folder or unreadable.
async function namedBytes($: EngineInterface, paths: Array<string>, cwd: string, home: string): Promise<number | undefined> {
  if (!paths.length) return undefined
  let bytes = 0
  for (const p of paths) {
    const full = /^([A-Za-z]:)?[\\/]/.test(p) ? p : p.startsWith('~/') ? `${home}/${p.slice(2)}` : `${cwd}/${p}`
    const st = await $.fs.stat(full).catch(() => undefined)
    if (st?.kind !== 'file') return undefined
    bytes += st.size
  }
  return bytes
}

// The chat's typical answer per main step, in tokens (1,000 before the first answer).
const typicalOut = (s: State) => (s.mainSteps ? s.mainOut / s.mainSteps : 1000)

// The model this step runs on in the main chat: the class model for a sure AUTO class on the prompt's own turn,
// only ever cheaper than the requested one, never a floor class, never on ultrathink.
function stepModel(s: State, requested: string): string | undefined {
  if (s.cfg.mode === 'off' || s.headless || !s.routeModels || !s.switchTurn || s.skipEffortThisTurn || !s.lastClass) return undefined
  return autoModel(s.lastClass, s.lastContext, requested, s.cfg, typicalOut(s))
}

// One Haiku label: Jev-style, a class with its confidence; an unsure answer routes nothing.
// -> { cls: class | null (no clear class) | undefined (failed or late), sure }
async function haiku($: EngineInterface, s: State, text: string): Promise<{ cls: string | null | undefined; sure: boolean }> {
  const labels = CLASS_LABELS.filter(c => s.cfg.classes[c])
  try {
    const r = await $.model.complete({
      model: s.cfg.classifier.model,
      effort: 'low',
      maxTokens: 40, // eval 2026-11-18: at 20, 16 of 41 Haiku replies ran out while still thinking
      timeoutMs: 4000, // never hold the prompt long; a late answer routes nothing
      system: classifierSystem(labels, s.cfg),
      prompt: classifierPrompt(text),
    })
    if (r.isAnswered && r.usage) await record($, s, s.cfg.classifier.model, r.usage, 'router', 0) // routing's own cost counts as extra spend
    if (!r.isAnswered) return { cls: undefined, sure: false }
    return readLabel(r.text, labels, s.cfg)
  } catch {
    return { cls: undefined, sure: false } // classifier failed: keep the current class
  }
}

// Is the person unhappy with the last answer? One Haiku sample reads the last request, the end of the answer and the
// new prompt; undefined when there is no answer yet, Haiku is unsure, late or failed (nothing changes then).
async function mood($: EngineInterface, s: State, next: string): Promise<Mood | undefined> {
  const msgs = ((await $.session.messages().catch(() => [])) as Array<SessionMessage>) ?? []
  const typed = (m: SessionMessage) => m.role === 'user' && m.text.trim() && !m.toolResults?.length
  const a = msgs.findLastIndex(m => m.role === 'assistant' && m.text.trim())
  const asked = a < 0 ? undefined : msgs.slice(0, a).findLast(typed)
  if (!asked) return undefined
  try {
    const r = await $.model.complete({
      model: s.cfg.classifier.model, effort: 'low', maxTokens: 40, timeoutMs: 4000,
      system: moodSystem, prompt: moodPrompt({ asked: asked.text, answer: msgs[a]!.text, next }),
    })
    if (r.isAnswered && r.usage) await record($, s, s.cfg.classifier.model, r.usage, 'router', 0)
    return r.isAnswered ? parseMood(r.text) : undefined
  } catch {
    return undefined
  }
}

// A subagent's brief: rules first (they only raise), then one Haiku sample; only a sure answer moves the agent,
// and a move below the parent needs a second sample to agree.
async function briefClass($: EngineInterface, s: State, text: string, parentModel: string): Promise<{ cls: string | null | undefined; sure: boolean; byRule?: true }> {
  const byRule = classifyByRules(text, s.cfg)
  if (byRule) return { cls: byRule, sure: true, byRule: true }
  if (text.trim().length < 12) return { cls: undefined, sure: false }
  const first = await haiku($, s, text)
  if (!needsSecondSample(first.cls, first.sure, parentModel, s.cfg)) return first
  const second = await haiku($, s, text)
  return { cls: first.cls, sure: second.sure && second.cls === first.cls }
}

// Rules always run (free); Haiku for a new task of 12+ characters (follow-ups like "ok, do it" skip it).
// The chat's first prompt asks Haiku 3 times at once: only an answer all three agree on may move the chat (firstModel).
// -> a class; null = a new task with no class (back to the default); undefined = keep the current class.
// strict (the chat runs on the router's own cheaper pick): a long prompt is read even when it opens like a follow-up
// ("now rebuild the billing engine"), and a failed classifier counts as no class, so the chat goes back to the default.
async function classify($: EngineInterface, s: State, text: string, isFirst = false, strict = false): Promise<string | null | undefined> {
  const plan = classifyPlan(text, s.hasClassified, isFirst, strict, s.cfg)
  if ('keep' in plan) return undefined
  s.hasClassified = true
  if ('rule' in plan) { s.sure = true; s.samples = []; return plan.rule }
  const r = settleAnswers(await Promise.all(Array.from({ length: plan.ask }, () => haiku($, s, text))), strict)
  s.samples = r.samples
  s.sure = r.sure
  return r.cls
}

// What the session check reads: the last 8 typed prompts and the newest todo list and plan, from the transcript.
async function sessionWindow($: EngineInterface, s: State): Promise<SessionWindow> {
  const msgs = ((await $.session.messages().catch(() => [])) as Array<SessionMessage>) ?? []
  const prompts = msgs.filter(m => m.role === 'user' && m.text.trim() && !m.toolResults?.length).map(m => m.text.trim()).slice(-8)
  let todos: string | undefined
  let plan: string | undefined
  for (const m of msgs) {
    for (const t of m.toolUses ?? []) {
      const items = t.input.todos ?? t.input.items // Claude Code's TodoWrite, the desktop app's task list
      if (TODO_TOOLS.includes(t.tool) && Array.isArray(items)) todos = (items as Array<{ content?: string; status?: string }>).map(x => `[${x.status ?? '?'}] ${x.content ?? ''}`).join('\n')
      if (t.tool === 'ExitPlanMode' && typeof t.input.plan === 'string') plan = t.input.plan
    }
  }
  return { prompts, todos, plan, turns: s.turnCount, model: (await read($, chat)).model ?? (await $.session.model()), lastClass: s.lastClass }
}

// The session check: Haiku judges the work still ahead 3 times; adviseSwitch decides; the band offers it, never acts.
// Quiet for 10 turns after an offer, and a declined trigger stays quiet until a different trigger fires.
async function sessionCheck($: EngineInterface, s: State, trigger: string) {
  if (s.cfg.mode === 'off' || s.headless || !s.routeModels || s.switching) return
  if (s.turnCount < s.quietUntil || s.declined === trigger) return
  if (s.declined && s.declined !== trigger) s.declined = null
  const w = await sessionWindow($, s)
  if (w.prompts.length < 2) return
  const ask = () => $.model.complete({ model: s.cfg.classifier.model, effort: 'low', maxTokens: 40, timeoutMs: 8000, system: sessionCheckSystem, prompt: sessionCheckPrompt(w) }).catch(() => undefined)
  const runs = await Promise.all([ask(), ask(), ask()])
  for (const r of runs) if (r?.isAnswered && r.usage) await record($, s, s.cfg.classifier.model, r.usage, 'router', 0)
  const a = adviseSwitch(runs.map(r => (r?.isAnswered ? parseSessionCheck(r.text) : undefined)), w.model, trigger, s.cfg, s.lastClass)
  if (!a || family(a.model) === family(w.model)) return
  s.quietUntil = s.turnCount + 10
  if (a.action === 'down' && a.kind === 'compact' && (await read($, features)).autoSwitch) {
    // the same work on a cheaper model: the router moves by itself only when the move pays back its cache rebuild
    // (docs/PLAN-v3.md); a new topic keeps the offer, since starting fresh is the owner's call
    const now = await $.clock.now()
    const free = trigger === 'compact' || (s.prev.at > 0 && now - s.prev.at > CACHE_LIFE_MS)
    const lives = await serial(s, () => run($, s.home, [livesQuery(s.session)])).then(r => livesOf(r, now)).catch(() => undefined)
    const m = switchMath({ from: w.model, to: a.model, cache: s.lastContext, out: typicalOut(s), age: s.mainSteps, lives, free })
    if (!m.pays) return
    // routed + from: the no-router baseline stays on the model before the move, and the move is never undone by itself
    await update($, chat, (c): ChatModel => ({ ...c, model: a.model, by: 'auto', routed: true, from: c.routed ? (c.from ?? null) : (c.model ?? w.model) }))
    $.ui.toast(free
      ? `router: ${pretty(a.model)} for the same work from the next request (the cache was rebuilt anyway, so the move costs almost nothing)`
      : `router: ${pretty(a.model)} for the same work from the next request (re-reading the chat costs about ${money(m.rebuild)}, paid back in about ${Math.ceil(m.breakEven)} steps)`)
    return
  }
  await update($, advice, () => ({ ...a, usd: rebuildUsd(a.model, s.lastContext) }))
}

// Our own compaction (our compact hook skips it): false when the engine skipped it.
async function compactChat($: EngineInterface, s: State, skipped: string, instructions = 'Keep the goal, the plan, open tasks, decisions made, file paths and the next step.'): Promise<boolean> {
  const r = await $.session.compact({ instructions })
  if ('skip' in r && r.skip) { $.ui.toast(`router: compaction was skipped (${r.skip})${skipped}`); return false }
  s.prev = NO_PREV
  s.lastContext = 0
  s.seg = { ctx: 0, steps: 0 }
  return true
}

// Keep awake: 50 minutes after each main step (a nudge's too), nudge the chat so its cache stays warm, until the away
// window ends; then compact it while warm into a handoff and stop. Off, too small, or past the hour (the machine slept):
// the compact-first offer once the cache has lapsed. Deterministic and in the background: nothing waits on it.
function arm($: EngineInterface, s: State, model: string) {
  s.coldTimer?.cancel()
  s.coldTimer = $.clock.after(AWAKE_PING_MS, () => { void tick($, s, model) })
}
async function tick($: EngineInterface, s: State, model: string) {
  // a turn still open (a question or a permission waiting on you): a nudge would only queue behind it; its next step re-arms
  if (s.switching || s.cfg.mode === 'off' || s.headless || s.openTurn) return
  const now = await $.clock.now()
  const next = awakeNext({ on: (await read($, features)).awake, now, lastStep: s.prev.at, since: s.awakeSince, hours: await read($, awakeHours), cache: s.lastContext })
  if (next === 'cold') {
    const left = 60 * 60_000 - (now - s.prev.at)
    if (left > 0) s.coldTimer = $.clock.after(left, () => { void coldOffer($, s, model) })
    else await coldOffer($, s, model)
    return
  }
  if (next === 'ping') {
    // marked here, not in our prompt hook: a plugin's own prompt need not pass through its own hooks
    s.pinging = true
    s.switchTurn = false
    await $.prompt.submit({ text: AWAKE_TEXT }).catch(() => { s.pinging = false })
    return
  }
  // the window is over: a warm compaction (a cached read and a summary) leaves a short chat to come back to
  s.switching = true
  try {
    if (await compactChat($, s, '', AWAY_COMPACT)) await update($, away, (a): Away => ({ pings: a?.pings ?? 0, usd: a?.usd ?? 0, rebuild: a?.rebuild ?? 0, compacted: true }))
  } catch { /* a turn started meanwhile: that turn's step re-arms the timer */ } finally { s.switching = false }
}

// The cache lapsed: offer to compact first when that pays back soon.
async function coldOffer($: EngineInterface, s: State, model: string) {
  if (s.switching) return
  const m = coldMath(model, s.lastContext)
  if (m.pays) await update($, cold, (): Cold => ({ cache: s.lastContext, resume: m.resume, extra: m.extra, perStep: m.perStep, payback: m.payback }))
}

async function compactFirst($: EngineInterface, s: State) {
  await update($, cold, () => null)
  s.switching = true
  try { await compactChat($, s, '') } catch { $.ui.toast('router: wait for the current turn to finish, then press it again') } finally { s.switching = false }
}

// The offer's buttons. Compact first so the new model re-reads a short summary, not the whole chat; or start fresh.
async function switchChat($: EngineInterface, s: State, model: string, kind: 'compact' | 'fresh' | 'now') {
  s.switching = true
  try {
    if (kind === 'compact' && !(await compactChat($, s, '; the model stays'))) return
    if (kind === 'fresh') await $.command.run({ command: 'clear' })
    await update($, chat, (c): ChatModel => ({ ...c, model, by: 'you', routed: true, from: c.routed ? (c.from ?? null) : c.model }))
    await update($, advice, () => null)
    await update($, hint, () => null)
  } catch {
    $.ui.toast('router: wait for the current turn to finish, then press it again')
  } finally {
    s.switching = false
  }
}

// After a /clear the process goes on with a new chat: its ledger file, label, asks, first-prompt pick, subagent memory,
// cache guard and session-check state start over. The on/off and effort/models switches stay. A switch button that
// cleared keeps the model it is about to set.
async function clearChat($: EngineInterface, s: State) {
  Object.assign(s, {
    session: '', label: '', lastLedgerTurn: '', stickyAsk: undefined, ask: undefined, seenPrompt: false, hasClassified: false,
    hadClass: false, lastClass: null, lastHintModel: null, switchTurn: false, sure: false, samples: [], turnCount: 0, quietUntil: 0, declined: null, unhappy: 0,
    prev: NO_PREV, lastContext: 0, mainSteps: 0, mainOut: 0, rerouted: 0, lastRerouted: '',
  })
  for (const m of [s.briefs, s.siblings, s.agentEffort, s.agentType, s.agentAsked, s.agentSpend, s.briefRun, s.wastedRuns]) m.clear()
  s.savedAgents = NO_AGENTS // the old chat's memory stays in the store, for a resume of it
  s.coldTimer?.cancel()
  s.awakeSince = 0
  s.pinging = false
  s.seg = { ctx: 0, steps: 0 }
  await update($, compactAt, () => null)
  await update($, cold, () => null)
  await update($, away, () => null)
  if (!s.switching) await update($, chat, (c): ChatModel => ({ ...c, model: null, by: null, effort: null }))
  await update($, advice, () => null)
  await update($, hint, () => null)
  await update($, tally, () => EMPTY_TALLY)
  await update($, log, (): Array<TurnLog> => [])
  await update($, mix, (): Mix => ({}))
  await update($, view, (v): RouterView => ({ ...v, lastClass: null, rerouted: 0, routedAgents: 0 }))
}

// Settings: the person picks this chat's model (no auto moves for the chat then), or Auto gives it back to the router.
async function pickModel($: EngineInterface, v: string) {
  if (v === 'auto') { await update($, chat, (c): ChatModel => ({ ...c, model: null, by: null, routed: false, from: null })); return }
  await update($, chat, (c): ChatModel => ({ ...c, model: v, by: 'you', routed: false, from: null }))
  await update($, advice, () => null)
  await update($, hint, () => null)
  const isNew = (await $.session.usage().catch(() => undefined))?.context.tokens === undefined
  if (!isNew) $.ui.toast(`router: ${pretty(v)} from the next request; it reads this chat once without cache`)
}

// "Not now": the same trigger stays quiet until a different one fires.
async function decline($: EngineInterface, s: State) {
  s.declined = (await read($, advice))?.trigger ?? null
  await update($, advice, () => null)
}

async function suggest($: EngineInterface, s: State, cls: string) {
  const isFirst = !s.hadClass
  s.hadClass = true
  const prevRank = s.lastClass ? rank(s.cfg.classes[s.lastClass]?.model ?? s.cfg.main.model) : null
  s.lastClass = cls
  const tier = s.cfg.classes[cls]
  if (!tier) return
  if (AUTO.includes(cls) && s.sure) { await update($, hint, () => null); return } // the turn itself moves to that model: no tip
  const current = (await read($, chat)).model ?? (await $.session.model()) // the chat's own pick, when it has one
  const isShift = prevRank !== null && prevRank !== rank(tier.model)
  if (family(tier.model) === family(current)) {
    await update($, hint, () => null)
  } else if ((isFirst || isShift) && rank(tier.model) > rank(current) && s.lastHintModel !== tier.model) {
    // upgrades only: one prompt's class can't judge a whole session, so it never proposes a cheaper model for the chat (owner, 2026-11-18)
    s.lastHintModel = tier.model
    const h: Hint = { cls, model: tier.model, why: tier.why ?? '', current: family(current), usd: rebuildUsd(tier.model, s.lastContext) }
    await update($, hint, () => h)
    await update($, isHidden, () => false)
  }
}

// Unhappy four times in one task: the tip offers the next model up. Opus and Fable stay, so Fable is never offered on its own.
async function unhappyTip($: EngineInterface, s: State) {
  const current = (await read($, chat)).model ?? (await $.session.model())
  const up = stepUp(current)
  if (family(up) === family(current)) return
  s.lastHintModel = up
  await update($, hint, (): Hint => ({ cls: 'this task', model: up, why: 'four answers missed', current: family(current), usd: rebuildUsd(up, s.lastContext) }))
  await update($, isHidden, () => false)
}

async function status($: EngineInterface, s: State): Promise<string> {
  const v = await read($, view)
  const t = await read($, tally)
  return [
    `Router ${v.isOn ? 'on' : 'off'} · project ${s.project} · auto effort ${v.autoEffort ? 'on' : 'off'} · per-message effort ${v.perMessage}`,
    `Routing: ${s.sources} · ${Object.keys(s.cfg.classes).length} classes · main ${s.cfg.main.model}/${s.cfg.main.effort}`,
    `Last class: ${v.lastClass ?? '-'} · last effort: ${v.lastEffort ?? '-'} (picker ${s.baseEffort || '-'}) · turns re-routed: ${s.rerouted} · agents routed: ${v.routedAgents}`,
    `This session (API-equivalent): spent ${money(t.actualUsd)}, about ${money(t.baselineUsd)} with no router → ${netWords(t)} (${money(savedUsd(t))} saved, ${money(t.extraUsd)} extra)`,
    `Cache: ${Math.round(s.lastContext / 1000)}K tokens. Switching model re-reads it once: ${FAMILIES.map(m => `${pretty(m)} ${money(rebuildUsd(m, s.lastContext))}`).join(', ')}`,
  ].join('\n')
}

// A person is here once a surface draws the session (the REPL, or the desktop app attaching later): route,
// and bring back the widget if they kept it open last time. The band above the prompt needs nothing.
async function seat($: EngineInterface, s: State) {
  if (s.headless && (await $.session.surfaces()).length > 0) s.headless = false
  if (s.headless || s.paneOpened) return
  s.paneOpened = true
  if ((await $.store.get('widget')) === true) await showWidget($, true)
}

// The widget is the pane in its small form: the person drags it into the session rail; no call can.
async function showWidget($: EngineInterface, isShown: boolean) {
  await $.store.set('widget', isShown)
  await update($, isWidgetOpen, () => isShown)
  if (isShown) void $.ui.open({ id: PANE, title: 'Router', placement: 'widget' })
  else await $.ui.close({ id: PANE }).catch(() => undefined)
}

// How long keep-awake keeps an idle chat warm, for this session and every later one.
async function setAwakeHours($: EngineInterface, h: number) {
  await update($, awakeHours, () => h)
  await $.store.set('awakeHours', h)
}

// This chat's growth per main step since its last compaction or clear; unknown until a few steps have run.
const chatGrowth = (s: State) => (s.seg.ctx && s.mainSteps - s.seg.steps >= 3 ? (s.lastContext - s.seg.ctx) / (s.mainSteps - s.seg.steps) : undefined)

// The chat passed its own auto-compact point: compact between turns (the engine refuses while one runs).
async function autoCompact($: EngineInterface, s: State) {
  const at = await read($, compactAt)
  if (!at || s.lastContext <= at || s.switching) return
  const was = s.lastContext
  s.switching = true
  try {
    if (await compactChat($, s, '')) $.ui.toast(`router: compacted this chat at ${Math.round(was / 1000)}K (your point: ${at / 1000}K)`)
  } catch { /* a turn started meanwhile: the next turn's end tries again */ } finally { s.switching = false }
}

// Claude Code's own window for every chat: autoCompactWindow in ~/.claude/settings.json; null removes it (its default).
// The plugin API reads settings but has no write, so the file is edited here, every other key kept.
async function setDefaultWindow($: EngineInterface, s: State, at: number | null) {
  const path = `${s.home}/.claude/settings.json`
  let cfg: Record<string, unknown> = {}
  try {
    if (await $.fs.exists(path)) cfg = JSON.parse(String(await $.fs.read(path)))
  } catch { $.ui.toast(`router: ${path} is not valid JSON, so it was left as it is`); return }
  if (at) cfg.autoCompactWindow = at
  else delete cfg.autoCompactWindow
  await $.fs.write(path, `${JSON.stringify(cfg, null, 2)}\n`)
  $.ui.toast(at ? `router: Claude Code now compacts every chat at ${at / 1000}K (settings.json; new sessions pick it up)` : 'router: Claude Code is back on its own compaction window (settings.json)')
}

// A saving feature on or off, for this session and every later one.
async function setFeature($: EngineInterface, k: keyof Features, on: boolean) {
  const next = { ...(await read($, features)), [k]: on }
  await update($, features, (): Features => next)
  await $.store.set('features', next)
}

// Turns routing on or off in the global or the project routing.json, keeping the rest of the file as written.
async function setScope($: EngineInterface, s: State, scope: 'global' | 'project', mode: 'on' | 'off') {
  const path = scope === 'global' ? `${s.home}/.claude/routing.json` : `${s.root}/.claude/routing.json`
  try {
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : undefined
    await $.fs.write(path, withMode(old, mode))
  } catch {
    $.ui.toast(`router: could not update ${path} (is it valid JSON?)`)
    return
  }
  s.defs.clear()
  await load($, s)
}

// Edit rules: routing.json holds only your overrides, so an empty one gets a note on how it works, and the built-in
// rules are written beside it to read (never copied into routing.json: a copy there would pin today's defaults).
const RULES_NOTE = (ref: string) => `${JSON.stringify({ $help: `Your overrides of the router's rules. Anything here wins over the built-in rule of the same name; leave a key out to keep the built-in one, which updates with the plugin. The built-in rules are in ${ref} (rewritten each time you press Edit rules, so edit here, not there). Examples: "main": { "model": "opus", "effort": "high" }, "classes": { "docs": { "model": "sonnet" } }. Run /route reload after saving.` }, null, 2)}\n`
async function editRules($: EngineInterface, s: State) {
  const path = `${s.home}/.claude/routing.json`
  const ref = `${s.home}/.claude/router/builtin-rules.json`
  await $.fs.write(ref, `${JSON.stringify(BUILTIN, null, 2)}\n`)
  const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)).trim() : ''
  if (!old || old === '{}') await $.fs.write(path, RULES_NOTE(ref))
  await openFile($, path)
}

async function openFile($: EngineInterface, file: string) {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const mac = !windows && (await $.process.run(['uname'])).stdout.trim() === 'Darwin'
  // explorer, not `cmd /c start`: cmd would read & ^ | in a user's path as commands
  await $.process.run(windows ? ['explorer', file.replace(/\//g, '\\')] : [mac ? 'open' : 'xdg-open', file])
}

// Builds the Board fresh from every project's tally and opens it in the browser.
async function openBoard($: EngineInterface, s: State) {
  await flush($, s)
  const buckets = bucketsOf(await serial(s, () => run($, s.home, BOARD)))
  const file = `${s.home}/.claude/router/board.html`
  const now = await $.clock.now()
  const since = s.totals.since ?? now
  const priceNote = ((await $.store.get('prices')) as PriceCheck | undefined)?.note
  await $.fs.write(file, boardHtml(buckets, await read($, log), s.session, pretty(s.cfg.main.model), new Date(now).toLocaleString(), dayOf(since), await read($, tools), priceNote))
  await openFile($, file)
}

// Everything the band, the widget and the Stats card show.
async function facts($: EngineInterface, s: State) {
  const v = await read($, view)
  const turns = await read($, log)
  const chat = await read($, tally)
  const proj = s.totals.proj
  const m = await read($, modes)
  const main = [...turns].reverse().find(x => x.who === 'main')
  const where = m.project === 'off' ? 'in this project' : m.global === 'off' && m.project !== 'on' ? 'everywhere' : 'in this chat'
  const now = main ? `${pretty(main.model)} ${main.effort || ''}${main.asked ? ' (you asked)' : main.auto ? ' (auto)' : ''}`.trim() : `${pretty(s.cfg.main.model)} ${s.cfg.main.effort}`
  const since = new Date(s.totals.since ?? (await $.clock.now())).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const chatMode: 'off' | 'effort' | 'models' | 'both' = !v.isOn ? 'off' : !v.autoEffort ? 'models' : v.routeModels ? 'both' : 'effort'
  const cost = (await $.session.usage().catch(() => undefined))?.cost?.usd // the app's own total, /cost's, every request included
  const spend = await read($, mix)
  const hit = hitPct(Object.values(spend).reduce((a: Cache | undefined, x) => addCache(a, x.cache), undefined)) // this chat, main and subagents
  const sheet = cacheSheet(main?.model ?? s.cfg.main.model, s.lastContext)
  const feats = await read($, features)
  const hours = await read($, awakeHours)
  const at = await $.clock.now()
  return { v, turns, chat, proj, m, main, where, now, since, chatMode, cost, spend, hit, sheet, feats, hours, at }
}

function cells(s: State, f: Awaited<ReturnType<typeof facts>>): Array<Cell> {
  const picked = f.main?.picker && f.main.picker !== f.main.effort ? `you picked ${f.main.picker}` : `task: ${f.main?.cls ?? 'none yet'}`
  const swatch = f.v.isOn ? (f.main ? `${f.main.model}:${f.main.effort}` : `${s.cfg.main.model}:${s.cfg.main.effort}`) : undefined
  return [
    { label: 'This chat', value: netWords(f.chat), isExtra: isExtra(f.chat), sub: `${money(savedUsd(f.chat))} saved, ${money(f.chat.extraUsd)} extra` },
    { label: 'This project', value: netWords(f.proj), isExtra: isExtra(f.proj), sub: `${netPct(f.proj)}% ${isExtra(f.proj) ? 'more' : 'less'} since ${f.since}` },
    { label: 'Now', value: f.v.isOn ? f.now : 'Off', swatch, sub: !f.v.isOn ? `off ${f.where}` : f.chatMode === 'effort' ? 'effort only' : f.chatMode === 'models' ? 'models only' : picked },
    { label: 'Spent this chat', value: money(f.cost ?? f.chat.actualUsd), sub: f.hit === undefined ? 'cache hit not known yet' : `cache hit ${f.hit}%` },
    { label: 'Cache', value: s.lastContext >= 1000 ? `${Math.round(s.lastContext / 1000)}K tokens` : 'empty', sub: s.lastContext >= 1000 ? `${cacheClock(s.prev.at, f.at)} · rebuild ${money(f.sheet.reset)}` : 'nothing to rebuild yet' },
    { label: 'Where it went', ...whyWords(f.chat.by) },
    awakeCell(s, f),
  ]
}

// Keep awake's cell: what it saved this chat, when the next nudge goes and what the nudges cost.
function awakeCell(s: State, f: Awaited<ReturnType<typeof facts>>): Cell {
  const a = f.chat.by?.awake
  const on = f.feats.awake
  const next = on && s.lastContext >= AWAKE_MIN && !s.openTurn ? minutesLeft(s.prev.at, f.at, AWAKE_PING_MS / 60_000) : undefined
  const sub = [
    next ? `nudge in ${next} min` : on && s.lastContext < AWAKE_MIN ? 'starts at 20K tokens' : on ? '' : 'off in Settings',
    a?.extra ? `nudges ${money(a.extra)}` : '',
  ].filter(Boolean).join(' · ')
  return { label: 'Keep awake', value: a && a.saved >= 0.005 ? `saved ${money(a.saved)}` : on ? 'On' : 'Off', sub: sub || 'no nudges yet' }
}

// The cache sheet in one line: what a model switch, a reset and compacting would cost right now.
const sheetLine = (s: State, f: Awaited<ReturnType<typeof facts>>) => s.lastContext < 1000
  ? ''
  : `Switching model writes the chat once on the new one: ${f.sheet.switches.map(x => `${pretty(x.model)} ${money(x.usd)}`).join(', ')}. Compacting: about ${money(f.sheet.compact)}. Keeping it warm while you are away: about ${money(f.sheet.ping)} a nudge, one every 50 minutes. After an hour idle the cache is gone anyway, so switching then costs only the difference.`

// The note at the end of the Stats card's model band header.
const reroutedNote = (v: RouterView) => `${v.rerouted} ${v.rerouted === 1 ? 'turn' : 'turns'}, ${v.routedAgents} ${v.routedAgents === 1 ? 'agent' : 'agents'} re-routed`

// Shared by /route and the dashboard's buttons.
async function setMode($: EngineInterface, s: State, isOn: boolean) {
  s.cfg = { ...s.cfg, mode: isOn ? 'on' : 'off' }
  await update($, view, (v): RouterView => ({ ...v, isOn }))
}

async function setAutoEffort($: EngineInterface, s: State, isOn: boolean) {
  s.cfg = { ...s.cfg, autoEffort: isOn }
  await update($, view, (v): RouterView => ({ ...v, autoEffort: isOn }))
}

async function setRouteModels($: EngineInterface, s: State, isOn: boolean) {
  s.routeModels = isOn
  if (!isOn) await update($, hint, () => null)
  await update($, view, (v): RouterView => ({ ...v, routeModels: isOn }))
}

// This chat's routing: off, effort only, models only, or both.
async function setChat($: EngineInterface, s: State, mode: 'off' | 'effort' | 'models' | 'both') {
  await setMode($, s, mode !== 'off')
  if (mode === 'off') return
  await setAutoEffort($, s, mode !== 'models')
  await setRouteModels($, s, mode !== 'effort')
}

// Only two steps on the same model, with no compaction or /clear between them (both reset prev), say anything about effort.
async function guardCache($: EngineInterface, s: State, sent: string, read0: number, now: number, model: string) {
  if (s.prev.effort && s.prev.model === family(model) && sent !== s.prev.effort) {
    if (isCacheBreak(s.prev.read, read0, now - s.prev.at)) {
      await $.store.set('perMessage', 'unsupported')
      await update($, view, (v): RouterView => ({ ...v, perMessage: 'unsupported' }))
      $.ui.toast('router: an effort change broke the prompt cache; auto effort is off (/route effort retest to measure again)')
    } else if (s.prev.read > 20000 && ++s.cleanChanges >= 2) {
      await $.store.set('perMessage', 'ok')
      await update($, view, (v): RouterView => ({ ...v, perMessage: 'ok' }))
    }
  }
  s.prev = { effort: sent, read: read0, at: now, model: family(model) }
  await update($, view, (v): RouterView => ({ ...v, lastEffort: sent || null }))
}

const where = async ($: EngineInterface, s: State) => (s.v ??= await env($))

async function refreshTools($: EngineInterface, s: State, force = false) {
  const v = await where($, s)
  const t = await (force ? checkVersions($, v) : versions($, v)).catch(() => null)
  await update($, tools, () => t)
  const p = await checkPrices($, prices(), force).catch(() => undefined)
  if (p) setPrices(p.table)
  if (p?.note && Date.now() - p.at < 60_000) $.ui.toast(`router: ${p.note}`)
}

// The Settings buttons and /route update: run the update, then re-check versions and model lists.
async function runUpdate($: EngineInterface, s: State, tool: Tool): Promise<string> {
  await update($, updating, () => tool)
  try {
    const msg = await updateTool($, await where($, s), tool)
    const t = ((await $.store.get('versions')) as Versions | undefined) ?? null
    await update($, tools, () => t)
    $.ui.toast(`router: ${msg}`.slice(0, 200))
    return msg
  } finally {
    await update($, updating, () => null)
  }
}

// Outside agents: always the newest model of the role's family, the owner's standard flags.
async function answer($: EngineInterface, s: State, agent: AgentName, call: Call) {
  const tier = s.cfg.outside[agent]?.[call.role]
  if (!tier) return { deny: `router: no ${agent} role "${call.role}" in routing.json (roles: ${ROLES.join(', ')})` }
  const v = await where($, s)
  const a = agent === 'codex' ? await runCodex($, v, tier, call, await codexModels($, v)) : await runAgy($, tier, call, await agyModels($))
  if ('error' in a) return { deny: `router: ${a.error}` }
  await $.ui.status(`route: ${agent} ${call.role} · ${a.model} ${a.effort}`)
  return { result: `[${agent} ${a.model}, effort ${a.effort}]\n\n${a.text}` }
}

export const register: Register = on => {
  const s: State = {
    cfg: BUILTIN, home: '', root: '', project: 'unknown', sources: 'built-in only', lastClass: null, lastHintModel: null,
    hasClassified: false, hadClass: false, skipEffortThisTurn: false, headless: false, agentEffort: new Map(), defs: new Map(),
    prev: NO_PREV, lastContext: 0, mainSteps: 0, mainOut: 0, cleanChanges: 0, baseEffort: '', rerouted: 0, lastRerouted: '', agentType: new Map(), agentAsked: new Map(), agentSpend: new Map(), briefRun: new Map(), wastedRuns: new Set(), paneOpened: false, pasted: false, coldTimer: undefined, minuteTick: undefined, awakeSince: 0, pinging: false, openTurn: '', seg: { ctx: 0, steps: 0 },
    session: 'session', label: '', lastLedgerTurn: '', pending: [], scheduled: false, warned: false, totals: { proj: EMPTY_TALLY, since: undefined }, routeModels: true, sure: false, switchTurn: false,
    ask: undefined, stickyAsk: undefined, v: undefined, seenPrompt: false, samples: [], turnCount: 0, quietUntil: 0, declined: null, switching: false,
    briefs: new Map(), siblings: new Map(), queue: Promise.resolve(), savedAgents: NO_AGENTS, unhappy: 0,
  }

  on('session.start', async ($, e, next) => {
    s.headless = !e.isInteractive // until a surface attaches: claude -p never gets one
    await load($, s)
    await restoreAgents($, s)
    await seedMix($).catch(() => undefined)
    const kept = ((await $.store.get('features').catch(() => undefined)) ?? {}) as Partial<Features>
    // only today's switches: an older version's key (0.8.1's "idle") is dropped
    await update($, features, (): Features => ({ autoSwitch: kept.autoSwitch ?? true, sizing: kept.sizing ?? true, pastes: kept.pastes ?? true, awake: kept.awake ?? true }))
    const hours = Number(await $.store.get('awakeHours').catch(() => undefined))
    await update($, awakeHours, () => (AWAKE_HOURS.includes(hours) ? hours : AWAKE_DEFAULT_HOURS))
    await $.command.register({
      name: 'route',
      description: 'Router mode: on | off | status | board | widget | effort on|off|retest | models on|off|refresh | update claude|codex|antigravity | reload',
      argumentHint: 'on|off|status|board|widget|effort on|effort off|effort retest|models on|models off|models refresh|update codex|reload',
    })
    for (const [name, label] of [['codex', 'Codex (OpenAI)'], ['antigravity', 'Antigravity (Google Gemini)']] as const) {
      const roles = ROLES.map(r => { const t = s.cfg.outside[name]?.[r]; return t ? `${r}: ${t.why ?? t.family}` : '' }).filter(Boolean).join('; ')
      await $.tool.register({
        name,
        description: `Ask ${label} for a second opinion or a side job, read-only, on its newest model for the role. Use this instead of running \`${name === 'codex' ? 'codex exec' : 'agy -p'}\` in Bash. Roles: ${roles}. Returns the agent's answer as text.`,
        inputSchema: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: [...ROLES], description: 'Why you are asking: review, validate, deep, visual or quick' },
            brief: { type: 'string', description: 'The full, self-contained brief: what to look at, what to answer, the output format' },
            dir: { type: 'string', description: 'Absolute folder the agent works in (default: the session folder)' },
            images: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of images to attach' },
          },
          required: ['role', 'brief'],
        },
      }).catch(() => undefined)
    }
    await seat($, s)
    // the weekly CLI check runs after the session is up, never holding the first prompt
    $.clock.after(5_000, async () => { await refreshTools($, s); await sweep($, s, '', 24 * 60 * 60 * 1000) })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__router__codex' }, async ($, e) => answer($, s, 'codex', e as unknown as Call).catch((err: unknown) => ({ deny: `router: codex call failed: ${String(err).slice(0, 300)}` })))
  on('tool.call', { tool: 'mcp__router__antigravity' }, async ($, e) => answer($, s, 'antigravity', e as unknown as Call).catch((err: unknown) => ({ deny: `router: antigravity call failed: ${String(err).slice(0, 300)}` })))

  // Claude calling an outside agent in Bash gets pointed to the tool, which picks the model and the flags.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => shield($, e, next, async go => {
    const agent = s.cfg.mode === 'off' ? undefined : outsideCall(e.command)
    if (!agent) return go(e)
    return { deny: `router: call ${agent === 'codex' ? 'Codex' : 'Antigravity'} through the mcp__router__${agent} tool (role + brief), not in Bash. The tool runs the newest model for the role with the standard flags. Load it with ToolSearch if it is not listed.` }
  }))

  // Session-check triggers: a compaction, a finished task list, an approved plan (every 20 prompts: prompt.submit).
  // Each runs after its event in the background, so nothing waits on Haiku.
  // Only the main chat's own events count: not a subagent's compaction or task list, not a precompute, not a rejected plan.
  on('session.compact', async ($, e, next) => shield($, e, next, async go => {
    const r = await go(e)
    if (e.agentId || e.trigger === 'precompute' || ('skip' in r && r.skip)) return r
    s.prev = NO_PREV // the cache starts over: the next steps say nothing about effort
    s.lastContext = 0 // the old size is gone; the next step tells the new one (and a moved step gets no warm-cache credit)
    s.seg = { ctx: 0, steps: 0 }
    if (!s.switching) $.clock.after(500, async () => { await sessionCheck($, s, 'compact') })
    return r
  }))
  // The main turn closes (keep-awake waits while one is open); this chat's own auto-compact point (Settings) is checked then, compacted just after.
  on('turn.complete', async ($, e, next) => shield($, e, next, async go => {
    if (e.turnId === s.openTurn) s.openTurn = ''
    const r = await go(e)
    if (e.agentId === undefined && s.cfg.mode !== 'off' && !s.headless) $.clock.after(500, async () => { await autoCompact($, s) })
    return r
  }))
  on('tool.call', { tool: new RegExp(`^(${TODO_TOOLS.join('|')})$`) }, async ($, e, next) => shield($, e, next, async go => {
    const r = await go(e)
    const input = e as unknown as Record<string, unknown> // a tool's arguments arrive flat on the event
    const list = (input.todos ?? input.items) as Array<{ status?: string }> | undefined
    if (!e.agentId && !r.deny && !r.isError && Array.isArray(list) && list.length && list.every(x => x.status === 'completed')) $.clock.after(500, async () => { await sessionCheck($, s, 'todos-done') })
    return r
  }))
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => shield($, e, next, async go => {
    const r = await go(e)
    if (!e.agentId && !r.deny && !r.isError) $.clock.after(500, async () => { await sessionCheck($, s, 'plan') })
    return r
  }))
  // A /clear ends this chat with no session.start for the next: everything that belonged to it starts over.
  // The waiting rows go first: the end has one short time limit for every hook, and a save cut off there is lost.
  // The main model reading a saved paste means the analysis fell short: that paste saved nothing.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => shield($, e, next, async go => {
    const key = `paste:${normPath(String((e as unknown as { file_path?: string }).file_path ?? ''))}`
    if (!e.agentId && s.agentSpend.has(key)) await takeBack($, s, 'paste', key)
    return go(e)
  }))
  on('session.end', async ($, e, next) => {
    await flush($, s)
    s.coldTimer?.cancel()
    if (s.pasted) await sweep($, s, `${s.session}-`, 0)
    const r = await next(e)
    if (e.reason === 'clear') await clearChat($, s)
    return r
  })

  // The desktop app hosts sessions through the SDK: they start with no surface, and the app attaches later.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await seat($, s)
    return r
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await setMode($, s, arg === 'on')
      return { text: `Router mode ${arg} for this session.` }
    }
    if (arg === 'effort on' || arg === 'effort off') {
      await setAutoEffort($, s, arg === 'effort on')
      return { text: `Auto effort ${s.cfg.autoEffort ? 'on' : 'off'} for this session.` }
    }
    if (arg === 'models on' || arg === 'models off') {
      await setRouteModels($, s, arg === 'models on')
      return { text: `Model routing ${s.routeModels ? 'on' : 'off'} for this session.` }
    }
    if (arg === 'effort retest') {
      await $.store.delete('perMessage')
      s.cleanChanges = 0
      await update($, view, (v): RouterView => ({ ...v, perMessage: 'unknown' }))
      return { text: 'Per-message effort status reset; the cache guard will measure it again.' }
    }
    if (arg === 'reload') {
      s.defs.clear()
      await load($, s)
      return { text: `Routing reloaded for ${s.project}.` }
    }
    if (arg === 'widget' || arg === 'dash') {
      await showWidget($, true)
      return { text: 'Router widget opened. Drag it into the session rail to keep it there.' }
    }
    if (arg === 'board') {
      await openBoard($, s)
      return { text: 'Router board opened in the browser.' }
    }
    if (arg === 'models refresh') {
      const v = await where($, s)
      const [c, a] = await Promise.all([codexModels($, v, true), agyModels($, true)])
      const list = (m: Record<string, { slug: string }>) => Object.values(m).map(x => x.slug).join(', ') || 'none found'
      return { text: `Newest models now: Codex ${list(c)} · Antigravity ${list(a)} · Claude: haiku, sonnet, opus, fable (Claude Code resolves each to its newest).` }
    }
    const up = /^update (claude|codex|antigravity)$/.exec(arg)
    if (up) return { text: await runUpdate($, s, up[1] as Tool) }
    return { text: await status($, s) }
  })

  on('prompt.compose', async ($, e, next) => shield($, e, next, async go => {
    const r = await go(e)
    if (s.cfg.mode === 'off' || s.headless || !wantsDelegate(e.tools, s.routeModels) || r.sections.some(x => x.id === DELEGATE_ID)) return r
    return { sections: [...r.sections, { id: DELEGATE_ID, text: delegateSection, scope: 'session' }] }
  }))

  on('prompt.submit', async ($, e, next) => shield($, e, next, async go => {
    await seat($, s) // in case the surface joined before this module (re)loaded
    // the first prompt names the session on the Board (labelOf: 60 characters, secrets masked)
    if (!e.command && !e.isMeta && !s.label) s.label = labelOf(e.text)
    if (s.cfg.mode === 'off' || s.headless || e.command || e.isMeta) { s.switchTurn = false; return go(e) }
    if (e.origin?.kind === 'plugin' && e.text === AWAKE_TEXT) {
      // our own keep-awake nudge: no classifier, no mood, no paste reading; the chat's model at the lowest effort.
      // Dropped when the chat was used after the timer fired: its cache is warm already.
      if ((await $.clock.now()) - s.prev.at < AWAKE_PING_MS - 60_000) return { drop: 'router: the chat was used meanwhile' }
      s.pinging = true
      s.switchTurn = false
      return go(e)
    }
    s.pinging = false
    // only the person's own message (typed, or from their phone) is offloaded, never a peer's or a notification
    const own = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'
    if (own && (await read($, cold))) await update($, cold, () => null) // the message re-reads the chat: the offer is moot
    if (own && (await read($, away))?.back) await update($, away, () => null) // you have seen the report
    const short = own && (await read($, features)).pastes ? await offload($, s, e.text) : undefined
    if (short) e = { ...e, text: short }
    // typed over a running turn, the prompt joins that turn: it may raise the turn's routing, never lower it
    const midTurn = e.turnId !== undefined
    const asked = explicitAsk(e.text)
    if (asked?.sticky) s.stickyAsk = asked
    if (!midTurn || asked) s.ask = asked ?? s.stickyAsk
    const ultra = /\bultrathink\b/i.test(e.text)
    s.skipEffortThisTurn = midTurn ? s.skipEffortThisTurn || ultra : ultra
    s.sure = false
    s.samples = []
    // the chat's first prompt: no answer yet, so no cache to lose by picking the chat's model now
    const isFirst = !midTurn && !s.seenPrompt && (await $.session.usage().catch(() => undefined))?.context.tokens === undefined
    s.seenPrompt = true
    s.turnCount++
    if (s.turnCount % 20 === 0) $.clock.after(500, async () => { await sessionCheck($, s, 'periodic') })
    const chosen = await read($, chat)
    // the router's own first-prompt pick: re-check, and doubt means back to the default. A mid-chat move (routed) paid its
    // rebuild already: a harder task there gets the model tip, never an automatic move back up.
    const strict = chosen.by === 'auto' && Boolean(chosen.model) && !chosen.routed
    const [found, felt] = await Promise.all([
      classify($, s, e.text, isFirst && !asked?.model && s.routeModels, strict),
      isFirst || midTurn || !(s.cfg.autoEffort || s.routeModels) ? undefined : mood($, s, e.text),
    ])
    // an unhappy reply goes on with the same task: it keeps the task's class unless the classifier found a harder one;
    // a content follow-up the classifier could not place (it is told to say default for those) keeps it too
    const keep = felt === 'unhappy' ? !(found && isHarder(found, s.lastClass, s.cfg)) : felt === 'same' && found === null
    const cls = keep ? undefined : found
    if (felt === 'unhappy') s.unhappy++
    else if (felt === 'new' || (felt === undefined && found !== undefined && found !== s.lastClass)) s.unhappy = 0 // a new task starts calm
    if (midTurn && !(cls === null && strict) && !(cls && isHarder(cls, s.lastClass, s.cfg))) return go(e) // nothing harder: the turn keeps its routing
    s.switchTurn = !midTurn && Boolean(cls) && s.sure // every prompt starts on the picked model; only a sure quick task moves its own turn
    if (isFirst && !asked?.model && s.routeModels && !chosen.by) {
      const m = firstModel(s.samples, await $.session.model(), s.cfg)
      if (m) await update($, chat, (c): ChatModel => ({ ...c, model: m, by: 'auto' }))
    } else if (strict && cls !== undefined && (cls === null || rank(s.cfg.classes[cls]?.model ?? s.cfg.main.model) > rank(chosen.model!))) {
      // a new task the router's own pick may be too weak for (or one it can't place): back to the default; the chat is still short
      await update($, chat, (c): ChatModel => ({ ...c, model: null, by: null }))
    }
    if (cls && s.routeModels) await suggest($, s, cls)
    else if (cls) s.lastClass = cls // effort-only: the class still sets the effort, with no model tip
    else if (cls === null) s.lastClass = null // a new task with no class: back to the default effort
    if (felt === 'unhappy' && s.unhappy === 4 && s.routeModels) await unhappyTip($, s) // once per task, even after an earlier tip or Not now: a new reason
    await update($, view, (v): RouterView => ({ ...v, lastClass: s.lastClass }))
    return go(e)
  }))

  on('agent.spawn', async ($, e, next) => shield($, e, next, async go => {
    // the main model's own words in the brief ("high effort", "use opus") win over the router's pick: the spawn event
    // carries no effort, so the brief is the only place a master's effort can come from (owner 2026-11-21)
    const said = s.cfg.mode === 'off' ? undefined : explicitAsk(e.prompt)
    // every started run counts on the Board (a denied one does not); a resume is the same run going on
    const named = async (x: typeof e, routed = false, respawned = false) => {
      const r = await go(x)
      if (r.agentId && said?.effort) s.agentEffort.set(r.agentId, said.effort)
      if (r.agentId) s.agentType.set(r.agentId, e.subagentType) // for the dashboard log
      if (!r.deny && !e.resume) await countAgent($, s, e.subagentType, routed, respawned)
      return r
    }
    if (s.cfg.mode === 'off' || e.fork || e.resume) return named(e)
    if (s.ask?.agents) return named({ ...e, model: s.ask.agents }) // the prompt asked for this model's subagents
    // an exact version means its family: the newest model of it runs
    if (e.model) return named(claudeFamily(e.model) ? { ...e, model: claudeFamily(e.model)! } : e) // explicit model on the call wins
    if (said?.model) return named({ ...e, model: said.model }) // a model named in the brief, next
    const kind = SIZED[e.subagentType]
    if (kind && s.routeModels && (await read($, features)).sizing) {
      // the router's own reader and researcher: model and budget from the brief's size (docs/PLAN-v3.md, slice 2)
      const b = bucket(kind, sizeOf(e.prompt, await namedBytes($, briefPaths(e.prompt), e.cwd ?? s.root, s.home)))
      const started = await named({ ...e, model: b.model, prompt: `${e.prompt}\n\n${b.cap}` }, true)
      // with no router the main model would have done the job on its own model
      const parentNoRouter = (e.parentAgentId && s.agentAsked.get(e.parentAgentId)) || family(e.parentModel)
      if (started.agentId && b.model !== parentNoRouter) s.agentAsked.set(started.agentId, parentNoRouter)
      if (!started.deny) await update($, view, (v): RouterView => ({ ...v, routedAgents: v.routedAgents + 1 }))
      return started
    }
    const def: Def = e.subagentType.includes(':') ? { model: 'plugin' } : await definition($, s, e.subagentType)
    if (def.model && claudeFamily(def.model)) return named({ ...e, model: claudeFamily(def.model)! }) // pinned to a version in frontmatter
    if (def.model && def.model !== 'inherit') return named(e) // pinned to a family in frontmatter
    // a type in the table by its entry; any other (general-purpose, claude, an unpinned agent of yours) by its brief
    const inTable = Boolean(s.cfg.agents[e.subagentType])
    const run = e.workflow?.runId
    // a workflow may hide its script behind one placeholder prompt, so its agents are matched as siblings, never as repeats
    const hash = run ? undefined : briefHash(e.prompt)
    const before = hash ? s.briefs.get(hash) : undefined
    const { model, tier } = spawnPick({
      brief: inTable ? undefined : await briefClass($, s, e.prompt, e.parentModel).then(b => ({ ...b, cls: longRun(b.cls, e.prompt, s.cfg) })),
      tableTier: inTable ? agentTier(e.subagentType, s.cfg) : undefined,
      rule: inTable ? classifyByRules(e.prompt, s.cfg) : undefined,
      parentModel: e.parentModel,
      personChose: (await read($, chat)).by === 'you',
      prior: before,
      sibling: run ? s.siblings.get(run) : undefined,
    }, s.cfg)
    const moved = s.routeModels && model !== family(e.parentModel)
    const started = await named(moved ? { ...e, model } : e, moved, Boolean(before)) // effort-only, or the parent's model: as asked
    if (started.deny) return started
    if (run) s.siblings.set(run, model)
    if (hash) s.briefs.set(hash, model)
    if (started.agentId && tier?.effort && !def.effort && !said?.effort) s.agentEffort.set(started.agentId, tier.effort)
    // with no router a nested agent's parent would itself be on its own no-router model (audit 2026-11-19)
    const parentNoRouter = (e.parentAgentId && s.agentAsked.get(e.parentAgentId)) || family(e.parentModel)
    if (started.agentId && (moved ? model : family(e.parentModel)) !== parentNoRouter) s.agentAsked.set(started.agentId, parentNoRouter)
    if (started.agentId && hash) {
      // the same brief again: with no router one run would have done, so the replaced run saved nothing
      const prev = s.briefRun.get(hash)
      if (before && prev) await takeBack($, s, e.subagentType, prev)
      s.briefRun.set(hash, started.agentId)
    }
    if (moved || tier?.effort) await update($, view, (v): RouterView => ({ ...v, routedAgents: v.routedAgents + 1 }))
    return started
  }))

  on('turn.step', async function* ($, e, next) {
    let effort = e.effort
    const probe = await $.env.get('ROUTER_PROBE_EFFORTS')
    const isMain = e.agentId === undefined && !probe && s.cfg.mode !== 'off' && !s.headless
    // the chat's own pick (the first prompt's, or the person's in Settings); the person's effort beats the class
    const picked = isMain ? await read($, chat) : null
    // a model or effort named in the prompt wins over everything, floors included
    const ask = isMain ? s.ask : undefined
    const asked = ask?.model && family(ask.model) !== family(e.model) ? ask.model : undefined
    // then the chat's model, and under it a sure quick task's one-turn move, unless the person chose the model
    const base = picked?.model && family(picked.model) !== family(e.model) ? picked.model : undefined
    // a named model always wins, also when it is the chat's own: "use opus" on an Opus chat keeps the turn on Opus (audit 2026-11-19)
    const model = ask?.model ? asked : (e.agentId === undefined && !probe && picked?.by !== 'you' ? stepModel(s, base ?? e.model) ?? base : base)
    if (e.agentId === undefined && e.effort !== undefined) {
      if (probe) {
        effort = probe as typeof effort // measurement mode (evals): force one effort on the main loop
      } else {
        const v = await read($, view)
        if (!s.baseEffort) {
          s.baseEffort = String(e.effort)
          await update($, view, (x): RouterView => ({ ...x, pickerEffort: s.baseEffort }))
        }
        // every second unhappy reply in this task raises it a step (effort keeps the prompt cache; a model switch would not)
        const target = raiseEffort(turnEffort(s.lastClass, s.cfg, model ?? e.model) ?? s.cfg.main.effort, raiseSteps(s.unhappy))
        // the starting effort is the app picker's default and gets routed; one the person changes to later (/effort, ultrathink) is theirs
        const isDefault = String(e.effort) === s.baseEffort
        if (s.cfg.mode !== 'off' && !s.headless && s.cfg.autoEffort && isDefault && v.perMessage !== 'unsupported' && !s.skipEffortThisTurn && target) effort = target as typeof effort
      }
    } else if (e.agentId && e.effort !== undefined && s.agentEffort.has(e.agentId)) {
      effort = s.agentEffort.get(e.agentId) as typeof effort
    }
    if (picked?.effort && e.effort !== undefined && !s.skipEffortThisTurn) effort = picked.effort as typeof effort
    if (ask?.effort && e.effort !== undefined) effort = ask.effort as typeof effort
    // the router's own keep-awake nudge: the lowest effort (the cache stays, the reply is one word), never another model
    if (isMain && s.pinging && e.effort !== undefined && (await read($, view)).perMessage !== 'unsupported') effort = 'low' as typeof effort
    const changed = effort !== e.effort || model !== undefined
    const result = yield* next(changed ? { ...e, effort, ...(model ? { model } : {}) } : e)
    const u = result.usage
    if (!u) return result
    // with no router the step runs on the model and effort it came with, or on the person's own picks (theirs, not the
    // router's); a moved subagent on its parent's model (audit 2026-11-19: Opus was the baseline even on a Sonnet session)
    const nudge = isMain && s.pinging
    const who = e.agentId ? (s.agentType.get(e.agentId) ?? 'agent') : nudge ? 'awake' : 'main'
    const noRouter = {
      // a model reached through a router tip or offer is the router's doing: the baseline stays on the model before it (owner 2026-11-21)
      model: e.agentId ? (s.agentAsked.get(e.agentId) ?? u.model) : (asked ?? (picked?.routed ? (picked.from ?? e.model) : picked?.by === 'you' ? base : undefined) ?? e.model),
      effort: (ask?.effort ?? picked?.effort ?? e.effort) as string | undefined,
    }
    const longCache = e.agentId === undefined
    // the asked model's warm cache: none for a subagent, or after an hour's pause (it lapsed); a compaction zeroes lastContext
    const lapsed = s.prev.at > 0 && (await $.clock.now()) - s.prev.at > CACHE_LIFE_MS
    // a nudge: with no router it would not run, so all it costs is extra
    const baseUsd = nudge || s.wastedRuns.has(e.agentId ?? "") ? 0 : withoutRouter(noRouter, { model: u.model, effort: effort as string | undefined }, u, e.agentId || lapsed ? 0 : s.lastContext, longCache)
    await record($, s, u.model, u, who, baseUsd, e.agentId === undefined ? e.turnId : undefined, longCache, family(u.model) !== family(noRouter.model))
    if (e.agentId) { // a run's totals, so a re-spawn of the same brief can take back the first run's saving
      const a = s.agentSpend.get(e.agentId) ?? { usd: 0, base: 0, extra: 0, model: family(u.model) }
      const usd = costUsd(u.model, u)
      s.agentSpend.set(e.agentId, { usd: a.usd + usd, base: a.base + baseUsd, extra: a.extra + Math.max(0, usd - baseUsd), model: family(u.model) })
    }
    const sent = String(effort ?? '')
    // one log row per main-loop turn or subagent run, its steps summed
    const id = e.agentId ?? e.turnId
    const usd = costUsd(u.model, u, longCache)
    const c = cacheOf(u)
    await update($, log, (rows): Array<TurnLog> => {
      const i = rows.findIndex(r => r.id === id) // subagent steps interleave with the main loop's
      const auto = Boolean(model) && !asked
      const isAsked = Boolean(asked || ask?.effort)
      if (i >= 0) return rows.map((r, k) => (k === i ? { ...r, usd: r.usd + usd, baseUsd: r.baseUsd + baseUsd, steps: r.steps + 1, effort: sent, model: family(u.model), auto, asked: isAsked, cache: addCache(r.cache, c) } : r))
      const row: TurnLog = { id, who, cls: e.agentId ? '-' : (s.lastClass ?? 'default'), model: family(u.model), effort: sent, picker: String(e.effort ?? ''), usd, baseUsd, steps: 1, auto, asked: isAsked, cache: c }
      return [...rows, row].slice(-30)
    })
    const key = `${family(u.model)}:${sent}`
    await update($, mix, (m): Mix => ({ ...m, [key]: { usd: (m[key]?.usd ?? 0) + usd, steps: (m[key]?.steps ?? 0) + 1, cache: addCache(m[key]?.cache, c) } }))
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      s.lastContext = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      if (!s.seg.ctx) s.seg = { ctx: s.lastContext, steps: s.mainSteps + 1 } // counted as after this step
      if (!probe && !s.headless && s.cfg.mode !== 'off') arm($, s, u.model)
      if (nudge) {
        // a nudge that found the cache gone (a 5-minute cache, as API keys get): nudges can't keep it, so they stop
        if (u.cache_creation_input_tokens > s.lastContext / 2) {
          await setFeature($, 'awake', false)
          $.ui.toast('router: keep-awake found the cache already gone (here it lasts under 50 minutes), so it is now off. You can turn it on again in Settings.')
        }
        await update($, away, (a): Away => ({ pings: (a?.pings ?? 0) + 1, usd: (a?.usd ?? 0) + usd, rebuild: rebuildUsd(u.model, s.lastContext), compacted: false }))
      } else {
        const a = await read($, away)
        // back after the cache would have lapsed with no router: that step would have written the whole chat again
        // shortcut: after the window's compaction no saving is booked (the compaction's own cost isn't measured); book it once it is
        let saved = 0
        if (a?.pings && !a.back && !a.compacted && now - s.awakeSince > CACHE_LIFE_MS) {
          const r = u.cache_read_input_tokens
          saved = rebuildUsd(noRouter.model, r) - stepUsd(noRouter.model, r, 0)
          await bookSaving($, s, noRouter.model, saved)
        }
        s.awakeSince = now
        // the report stays through your first turn back, with what it saved; your next message clears it
        if (a && !a.back) await update($, away, (x): Away | null => (x ? { ...x, back: true, saved } : null))
      }
      s.mainSteps++
      s.mainOut += u.output_tokens
      const probeFile = await $.env.get('ROUTER_PROBE_LOG')
      if (probeFile) await probeLog($, probeFile, { at: now, index: e.index, effort: sent, model: u.model, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, input: u.input_tokens, output: u.output_tokens })
      // another model has its own prompt cache: guardCache compares only steps on the same model
      if (!probe) await guardCache($, s, sent, u.cache_read_input_tokens, now, u.model)
      if (!probe && !s.headless && s.cfg.mode !== 'off') {
        if ((sent !== String(e.effort) || model) && s.lastRerouted !== e.turnId) {
          s.lastRerouted = e.turnId
          s.rerouted++
          await update($, view, (x): RouterView => ({ ...x, rerouted: s.rerouted }))
        }
        const t = await read($, tally)
        await $.ui.status(`route: ${s.lastClass ?? 'default'}${model ? ` · ${pretty(model)} ${asked ? '(you asked)' : '(auto)'}` : ''} · effort ${sent}${ask?.effort ? ' (you asked)' : sent !== String(e.effort) ? ` (picker ${e.effort})` : ''} · ${netWords(t)}`)
      }
    }
    return result
  })

  // However the widget closes (its close mark, the app, an unload), the Settings switch and the next session follow.
  on('ui.close', async ($, e, next) => shield($, e, next, async go => {
    const r = await go(e)
    if (e.id === PANE && e.origin.kind !== 'plugin') {
      await update($, isWidgetOpen, () => false)
      if (e.origin.kind === 'person') await $.store.set('widget', false)
    }
    return r
  }))

  // The band: one row above the prompt, in the style of Claude's own, stacked with other mods' bands.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e).catch(() => undefined) // other mods share this slot: theirs draw below ours
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const Svg = 'Svg' in el ? el.Svg : undefined // text glyphs break in the desktop's proportional font; an SVG draws real columns
    const stack = (mine: NonNullable<typeof below>) => (below ? <Box flexDirection="column">{mine}{below}</Box> : mine)
    const f = await facts($, s)
    const open = await read($, panel)
    const tip = await read($, hint)
    const isHint = tip !== null && !(await read($, isHidden)) && f.v.isOn
    const flip = (p: 'stats' | 'settings') => () => update($, panel, x => (x === p ? 'none' : p))
    const board = () => openBoard($, s).catch(() => $.ui.toast('router: could not open the board'))
    const picked = await read($, chat)
    const undo = () => update($, chat, (c): ChatModel => ({ ...c, model: null, by: 'you', routed: false, from: null })) // back to the default; auto stays off for this chat
    // under 72 cells the row keeps 1-cell gaps and leaves the cache hit to Stats; narrower still, the buttons wrap
    // onto a second line instead of running off the edge (checked at 40-120 cells by tests/ui.test.ts)
    const narrow = e.props.bodyColumns < 72

    const row = (
      <Box key="router-row" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={narrow ? 1 : 2} width={e.props.bodyColumns}>
        <Text><Text color={f.v.isOn ? 'success' : 'inactive'}>●</Text> Router</Text>
        {f.v.isOn && <Text wrap="truncate-end"><Text color={modelColor(f.main?.model ?? s.cfg.main.model)}>■</Text> {f.now}</Text>}
        {f.v.isOn && picked.by === 'auto' && picked.model && <Button key="router-chat-undo" plain dimColor label={`Picked ${pretty(picked.model)} for this chat · Undo`} onPress={undo} />}
        {f.v.isOn && <Text dimColor={!isExtra(f.chat)} color={isExtra(f.chat) ? 'warning' : undefined} wrap="truncate-end">{netWords(f.chat)}</Text>}
        {f.v.isOn && f.hit !== undefined && !narrow && <Text dimColor wrap="truncate-end">cache hit {f.hit}%</Text>}
        {!f.v.isOn && <Text dimColor wrap="truncate-end">off {f.where}</Text>}
        {open !== 'settings' && Object.values((await read($, tools))?.tools ?? {}).some(x => x.isBehind) && <Button key="router-update-tip" plain label="Update available" onPress={flip('settings')} />}
        <Box flexGrow={1} />
        <Button key="router-board" plain label="Board" onPress={board} />
        <Button key="router-stats" plain label={open === 'stats' ? 'Hide stats' : 'Stats'} onPress={flip('stats')} />
        <Button key="router-settings" plain label={open === 'settings' ? 'Done' : 'Settings'} onPress={flip('settings')} />
      </Box>
    )
    // An offer gets its own row, so the model and the savings above never truncate; buttons do the switch.
    const offer = f.v.isOn ? await read($, advice) : null
    const isNew = (await $.session.usage().catch(() => undefined))?.context.tokens === undefined // nothing answered yet: no cache to lose
    const offerRow = offer
      ? (
          <Box key="router-offer" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} width={e.props.bodyColumns}>
            <Text color="warning" wrap="wrap">{offer.action === 'up' ? `The work ahead looks harder: ${pretty(offer.model)} fits it better.` : `The work ahead looks lighter: ${pretty(offer.model)} can do it at the same quality.`}{switchCost(offer.usd, isNew)}</Text>
            <Button key="router-offer-compact" {...(offer.kind === 'compact' ? { variant: 'primary' as const } : { plain: true as const })} label={`Compact and switch to ${pretty(offer.model)}`} onPress={() => switchChat($, s, offer.model, 'compact')} />
            <Button key="router-offer-fresh" {...(offer.kind === 'fresh' ? { variant: 'primary' as const } : { plain: true as const })} label={`Fresh start on ${pretty(offer.model)}`} onPress={() => switchChat($, s, offer.model, 'fresh')} />
            <Button key="router-offer-no" plain dimColor label="Not now" onPress={() => decline($, s)} />
          </Box>
        )
      : isHint && tip
        ? (
            <Box key="router-offer" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} width={e.props.bodyColumns}>
              <Text color="warning" wrap="wrap">{pretty(tip.model)} fits {tip.cls} better.{switchCost(tip.usd, isNew)}</Text>
              <Button key="router-tip-switch" variant="primary" label={isNew ? `Switch to ${pretty(tip.model)}` : `Compact and switch to ${pretty(tip.model)}`} onPress={() => switchChat($, s, tip.model, isNew ? 'now' : 'compact')} />
              <Button key="router-hide" plain dimColor label="Dismiss" onPress={() => update($, isHidden, () => true)} />
            </Box>
          )
        : null
    const lapsed = f.v.isOn && !offerRow ? await read($, cold) : null
    const coldRow = lapsed
      ? (
          <Box key="router-cold" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} width={e.props.bodyColumns}>
            <Text color="warning" wrap="wrap">{coldWords(lapsed)}</Text>
            <Button key="router-cold-compact" variant="primary" label="Compact first" onPress={() => compactFirst($, s)} />
            <Button key="router-cold-keep" plain dimColor label="Keep it all" onPress={() => update($, cold, () => null)} />
          </Box>
        )
      : null
    const kept = f.v.isOn && !offerRow && !coldRow ? await read($, away) : null
    const keptRow = kept
      ? <Text key="router-away" dimColor wrap="wrap">{awayWords(kept, await read($, awakeHours))}</Text>
      : null
    const extra = offerRow ?? coldRow ?? keptRow
    const head = extra ? <Box key="router-head" flexDirection="column" width={e.props.bodyColumns}>{row}{extra}</Box> : row
    if (open === 'none') return stack(head)

    if (open === 'stats') {
      // the cache clock counts down: redraw once a minute while the card is open
      if (!s.minuteTick && s.prev.at) s.minuteTick = $.clock.after(60_000, () => { s.minuteTick = undefined; $.ui.invalidate('ui.render') })
      const c = cells(s, f)
      const fit = cardLayout(e.props.bodyColumns)
      const src = statsSvg(c, f.turns, fit.width, fit.perRow, f.spend, reroutedNote(f.v))
      const card = Svg
        ? <Svg key="router-card" isInteractive source={src} {...svgSize(src)} alt={c.map(x => `${x.label} ${x.value}, ${x.sub}`).join('; ')} />
        : (
            <Box key="router-card" flexDirection="row" gap={2}>
              {c.map(x => (
                <Box key={x.label} flexDirection="column" width={Math.max(14, Math.floor(e.props.bodyColumns / 4) - 2)}>
                  <Text dimColor wrap="truncate-end">{x.label}</Text>
                  <Text bold wrap="truncate-end">{x.value}</Text>
                  <Text dimColor wrap="truncate-end">{x.sub}</Text>
                </Box>
              ))}
            </Box>
          )
      const line = sheetLine(s, f)
      return stack(<Box flexDirection="column" gap={1} width={e.props.bodyColumns}>{head}{card}{line && <Text key="router-sheet" dimColor wrap="wrap">{line}</Text>}</Box>)
    }

    // Settings: a label column so every control starts at the same place, each group's note right under it, and a
    // little more space between groups than inside them. In each choice the picked side is the filled button.
    const LABEL = 11 // cells: the longest label, "This chat", plus room
    // dot: a model choice carries its color, so the row doubles as the legend for Stats and the Board
    const choices = <V extends string>(key: string, options: Array<[V, string]>, value: V, set: (v: V) => unknown, dot?: (v: V) => string | undefined) =>
      options.map(([v, text]) => {
        const look = v === value ? { variant: 'primary' as const } : { plain: true as const, dimColor: true }
        const color = dot?.(v)
        // no label with a dot: the desktop draws a label in place of the children
        return color
          ? <Button key={`${key}-${v}`} {...look} onPress={() => set(v)}><Text color={color}>●</Text> {text}</Button>
          : <Button key={`${key}-${v}`} label={text} {...look} onPress={() => set(v)} />
      })
    // top: a row that may wrap to two lines keeps its label on the first one
    const field = (key: string, label: string, kids: Array<ReturnType<typeof h>> | ReturnType<typeof h>, top = false) => (
      <Box key={key} flexDirection="row" alignItems={top ? 'flex-start' : 'center'} gap={1}>
        <Box key={`${key}-label`} width={LABEL} flexShrink={0}><Text dimColor>{label}</Text></Box>
        <Box key={`${key}-kids`} flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" flexShrink={1}>{kids}</Box>
      </Box>
    )
    const note = (key: string, text: string) => <Box key={key} marginLeft={LABEL + 1}><Text dimColor wrap="wrap">{text}</Text></Box>
    const group = (key: string, ...rows: Array<ReturnType<typeof h> | false>) => <Box key={key} flexDirection="column" rowGap="sm">{rows.filter(Boolean)}</Box>
    const ONOFF: Array<['on' | 'off', string]> = [['on', 'On'], ['off', 'Off']]
    const globalOn = f.m.global !== 'off'
    const projectOn = f.m.project === null ? globalOn : f.m.project !== 'off'
    const widgetOpen = await read($, isWidgetOpen)
    const t = await read($, tools)
    const busy = await read($, updating)
    const recheck = () => refreshTools($, s, true)
    const cli = (k: Tool) => {
      const x = t?.tools[k]
      return (
        <Box key={`router-cli-${k}`} flexDirection="row" alignItems="center" gap={1} marginRight={2}>
          <Text>{TOOL_NAMES[k]} {x?.have ?? (t ? 'not found' : '…')}</Text>
          {busy === k
            ? <Text dimColor>updating…</Text>
            : x?.isBehind
              ? <Button key={`router-up-${k}`} variant="primary" label={`Update to ${x.latest}`} onPress={() => runUpdate($, s, k)} />
              : k === 'antigravity' && x?.have
                ? <Button key={`router-up-${k}`} plain dimColor label="Check for update" onPress={() => runUpdate($, s, k)} />
                : <Text dimColor>{x?.latest ? 'latest' : ''}</Text>}
        </Box>
      )
    }
    const feat = (k: keyof Features, label: string) => field(`router-f-${k}`, label, choices(`router-f-${k}`, ONOFF, f.feats[k] ? 'on' : 'off', v => setFeature($, k, v === 'on')))
    // Auto-compact: this chat's own point (the router compacts it between turns), or Claude Code's window for every chat
    const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
    const bd = usage?.context.breakdown
    const engineAt = bd?.autoCompactThreshold ?? bd?.rawMaxTokens ?? usage?.context.window ?? 1_000_000
    const at = await read($, compactAt)
    const acModel = f.main?.model ?? s.cfg.main.model
    const growth = chatGrowth(s)
    const best = growth === undefined ? undefined : cheapestPoint(acModel, growth, engineAt)
    const kt = (n: number) => `${Math.round(n / 1000)}K`
    const src = bd?.autocompactSource === 'env' ? ' (set by CLAUDE_CODE_AUTO_COMPACT_WINDOW, which beats settings.json)' : bd?.autocompactSource === 'settings' ? ' (your settings.json)' : ''
    const shown = at ?? best
    const acNote = `Now ${kt(s.lastContext)}; Claude Code itself compacts at ${kt(engineAt)}${src}.${s.lastContext >= 1000 ? ` Compacting now costs about ${money(f.sheet.compact)}.` : ''} ${growth === undefined
      ? 'The cheapest point shows after a few steps.'
      : `This chat grows about ${kt(growth)} a step; a step reads ${money(stepUsd(acModel, s.lastContext, 0))} now${shown ? `, and compacting at ${kt(shown)} averages about ${money(compactStepUsd(acModel, shown, growth))} a step` : ''}.`} A point you pick is used after the turn that passes it, for this chat only.`
    // order: what a person changes most (this chat) first, then what to save on, then where routing is on at all
    const settings = (
      <Box key="router-settings-box" flexDirection="column" rowGap="md">
        {group('router-g-chat',
          field('router-chat', 'This chat', choices('router-chat', [['off', 'Off'], ['effort', 'Effort'], ['models', 'Models'], ['both', 'Both']], f.chatMode, v => setChat($, s, v))),
          note('router-chat-note', 'Effort follows each task. Models picks subagent models and suggests a chat switch. Lasts until the session ends.'),
          field('router-compact', 'Compact at', choices('router-compact', [['off', 'Claude Code'] as [string, string], ...COMPACT_POINTS.filter(p => p < engineAt).map(p => [String(p), p === best ? `${kt(p)}, cheapest` : kt(p)] as [string, string])], at ? String(at) : 'off', v => update($, compactAt, () => (v === 'off' ? null : Number(v)))), true),
          note('router-compact-note', acNote),
          <Box key="router-compact-default" marginLeft={LABEL + 1}>
            {at
              ? <Button key="router-compact-default-set" plain label={`Make ${kt(at)} my default (every chat, in settings.json)`} onPress={() => setDefaultWindow($, s, at)} />
              : bd?.autocompactSource === 'settings' && <Button key="router-compact-default-clear" plain label="Back to Claude Code's own window (settings.json)" onPress={() => setDefaultWindow($, s, null)} />}
          </Box>)}
        {group('router-g-pick',
          field('router-model', 'Model', choices('router-model', [['auto', 'Auto'], ['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['fable', 'Fable']], picked.by === 'you' ? family(picked.model ?? s.cfg.main.model) : 'auto', v => pickModel($, v), v => (v === 'auto' ? undefined : modelColor(v)))),
          field('router-effort', 'Effort', choices('router-effort', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']], picked.effort ?? 'auto', v => update($, chat, (c): ChatModel => ({ ...c, effort: v === 'auto' ? null : v })), v => (v === 'auto' ? undefined : shade(f.main?.model ?? s.cfg.main.model, v, 'dark')))),
          note('router-pick-note', 'A pick locks this chat to it, and savings count against it. Auto lets the router choose per task.'))}
        {group('router-g-save',
          feat('autoSwitch', 'Move down'),
          note('router-f-autoSwitch-note', 'Moves to a cheaper model on its own, only when rebuilding the cache pays back. Moving up is always your call.'),
          feat('sizing', 'Helpers'),
          note('router-f-sizing-note', 'Runs the reader and researcher on Haiku or Sonnet by the size of the job, with a budget.'),
          feat('pastes', 'Big pastes'),
          note('router-f-pastes-note', 'A message over about 10K tokens goes to a file, and a cheaper model reads it first. Write "raw" to skip.'),
          feat('awake', 'Keep awake'),
          field('router-awake-hours', 'Keep it for', choices('router-awake-hours', AWAKE_HOURS.map(h => [String(h), `${h}h`] as [string, string]), String(f.hours), v => setAwakeHours($, Number(v)))),
          note('router-f-awake-note', `A hidden nudge every 50 minutes keeps an idle chat's cache warm${s.lastContext >= 1000 ? ` (about ${money(f.sheet.ping)} each, against ${money(f.sheet.reset)} to re-read it)` : ''}. After ${f.hours} hours it compacts the chat into a handoff${s.lastContext >= 1000 ? ` (about ${money(f.sheet.compact)})` : ''} and stops. Off: the band offers to compact once the cache lapses.`))}
        {group('router-g-scope',
          field('router-scope', 'Routing', [
            <Text key="router-global-l">Everywhere</Text>,
            ...choices('router-global', ONOFF, globalOn ? 'on' : 'off', v => setScope($, s, 'global', v)),
            ...(f.m.isProject ? [<Box key="router-scope-gap" width={2} />, <Text key="router-project-l">In {s.project}</Text>, ...choices('router-project', ONOFF, projectOn ? 'on' : 'off', v => setScope($, s, 'project', v))] : []),
          ]),
          note('router-scope-note', f.m.isProject ? `The ${s.project} switch wins over Everywhere. Both are saved in routing.json.` : 'Saved in ~/.claude/routing.json.'))}
        {group('router-g-tools',
          field('router-clis', 'Tools', [cli('claude'), cli('codex'), cli('antigravity'), <Button key="router-recheck" plain dimColor label="Re-check" onPress={recheck} />], true),
          note('router-tools-note', 'The newest models need current tools.'))}
        <Box key="router-more" flexDirection="row" alignItems="center" gap={2} marginLeft={LABEL + 1}>
          <Button key="router-widget" plain label={widgetOpen ? 'Hide widget' : 'Show widget'} onPress={() => showWidget($, !widgetOpen)} />
          <Button key="router-rules" plain label="Edit rules" onPress={() => editRules($, s).catch(() => $.ui.toast('router: could not open routing.json'))} />
        </Box>
      </Box>
    )
    return stack(<Box flexDirection="column" gap={1} width={e.props.bodyColumns}>{head}{settings}</Box>)
  }).catch((_, e, next) => next(e))

  // The widget: a glance in the session rail (clicks may not reach it there); expanded, the Stats card.
  // keep-awake's nudge and its one-phrase reply draw nothing (ctrl+o still shows the nudge); the band reports them
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'plugin' || e.props.text !== AWAKE_TEXT || e.props.isExpanded) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isNudgeReply(e.props.text)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // the main chat's open turn: a question or permission dialog waiting on you keeps it open
  on('turn.start', async (_, e, next) => { if (e.agentId === undefined) s.openTurn = e.turnId; return next(e) })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Button, Text } = el
    const Svg = 'Svg' in el ? el.Svg : undefined
    const f = await facts($, s)
    const line = (key: string, label: string, value: string) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" gap={2}>
        <Text>{label}</Text>
        <Text dimColor wrap="truncate-end">{value}</Text>
      </Box>
    )
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column" gap={1}>
          {line('w-now', 'Routing', f.v.isOn ? f.now : `off ${f.where}`)}
          {line('w-saved', isExtra(f.chat) ? 'Extra this chat' : 'Saved this chat', `${money(Math.abs(net(f.chat)))} · ${netPct(f.chat)}%`)}
          {s.lastContext >= 1000 && line('w-cache', 'Cache', `${Math.round(s.lastContext / 1000)}K · losing it ${money(f.sheet.reset)}`)}
          {s.lastContext >= 1000 && line('w-switch', 'Switch costs', f.sheet.switches.map(x => `${pretty(x.model)} ${money(x.usd)}`).join(', '))}
          {s.lastContext >= 1000 && line('w-keep', 'Keep or compact', `warm ${money(f.sheet.ping)} a nudge · compact ${money(f.sheet.compact)}`)}
          {Svg && f.turns.length > 1 && <Svg key="w-bars" isInteractive source={barsSvg(f.turns, 220, 24)} width={220} height={24} alt={`Cost of the last ${f.turns.length} turns against no router`} />}
        </Box>
      )
    }
    const c = cells(s, f)
    return (
      <Box flexDirection="column" gap={1}>
        {Svg
          ? <Svg key="p-card" isInteractive source={statsSvg(c, f.turns, 360, 2, f.spend, reroutedNote(f.v))} width={360} alt={c.map(x => `${x.label} ${x.value}, ${x.sub}`).join('; ')} />
          : c.map(x => line(`p-${x.label}`, x.label, `${x.value} · ${x.sub}`))}
        {sheetLine(s, f) && <Text key="p-sheet" dimColor wrap="wrap">{sheetLine(s, f)}</Text>}
        <Box flexDirection="row" gap={2}>
          <Button key="p-board" plain label="Open board" onPress={() => openBoard($, s).catch(() => $.ui.toast('router: could not open the board'))} />
        </Box>
      </Box>
    )
  })
}

