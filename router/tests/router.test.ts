import { expect, mock, test } from 'claude-code/testing'

import {
  BUILTIN, adviseSwitch, effortRank, rank, agentTier, autoModel, needsSecondSample, briefHash, briefTier, stepUp, classifyByRules, costUsd, firstModel, isCacheBreak, isContinuation, merge, parseJev, parseSessionCheck, readLabel, spawnPick, turnEffort,
} from '../hooks/policy'
import { boardHtml, withMode } from '../hooks/view'
import { RUNNER, type Step, labelOf } from '../hooks/db'
import { shield } from '../hooks/guard'

test("the router's own error never blocks the person's work: the event passes once, one warning", async () => {
  const toasts: Array<string> = []
  const $ = { ui: { toast: (t: string) => toasts.push(t) } }
  const calls: Array<string> = []
  const next = async (x: string) => { calls.push(x); return `done:${x}` }
  // fails before passing it on: the original event goes on
  expect(await shield($, 'e1' as string, next, async go => { throw new Error('boom'); return go('changed') })).toBe('done:e1')
  // fails after passing it on: the result already given stands, and next is not called again
  expect(await shield($, 'e2' as string, next, async go => { await go('e2-routed'); throw new Error('late') })).toBe('done:e2-routed')
  // no error: whatever the hook returns
  expect(await shield($, 'e3' as string, next, async go => go('e3-routed'))).toBe('done:e3-routed')
  expect(calls).toEqual(['e1', 'e2-routed', 'e3-routed'])
  expect(toasts.length).toBe(1)
})

const CFG = merge(BUILTIN, {
  main: { model: 'opus', effort: 'medium' },
  classes: {
    critique: { model: 'opus', effort: 'high', floor: true },
    explore: { model: 'haiku', effort: 'medium' },
    mechanical: { model: 'haiku', effort: 'low' },
    'final-copy': { model: 'opus', effort: 'low', floor: true },
    architecture: { model: 'opus', effort: 'high', floor: true },
  },
  agents: { 'leak-checker': { class: 'mechanical' }, writer: { model: 'opus', effort: 'high' } },
  keywords: { architecture: ['seat budget'] },
})

test('rules pick the class, floors first, in English and Russian', async () => {
  expect(classifyByRules('please review this PR for bugs', CFG)).toBe('code-review') // a PR review is code review, not creative critique
  expect(classifyByRules('найди где лежит конфиг', CFG)).toBe(undefined) // a cheaper class by a broad rule: the classifier decides
  expect(classifyByRules('rework the seat budget logic', CFG)).toBe('architecture')
  expect(classifyByRules('hello there', CFG)).toBe(undefined)
  expect(classifyByRules("what's the weather?", CFG)).toBe('explore')
  expect(classifyByRules('whats the NVDA price for last 2 days?', CFG)).toBe('explore')
  expect(classifyByRules('какая погода завтра в Лиссабоне', CFG)).toBe('explore')
  expect(classifyByRules('add a weather widget to the app', CFG)).toBe(undefined)
})

test('a broad rule never routes cheaper on its own (eval 2026-11-18 false-cheap cases)', async () => {
  const cfg = merge(CFG, { classes: { brainstorm: { model: 'sonnet', effort: 'high' } } })
  expect(classifyByRules('ReminderSchedulerTest fails 1 in 5 runs on CI, never locally. log attached, find why', cfg)).toBe(undefined)
  expect(classifyByRules('find a better word than "effortless" in the tagline', cfg)).toBe(undefined)
  expect(classifyByRules('write the 60s voice-over with 3 hooks for the cafe promo', cfg)).toBe(undefined)
  expect(classifyByRules('review the voice-over hooks', cfg)).toBe('critique') // a floor still wins by rule
  // the built-in table: explore sits at the default, so "find" leaves production debugging to the classifier
  expect(classifyByRules('Quick look please: two customers end up booked into the same slot. Find out why it happens', BUILTIN)).toBe(undefined)
  expect(classifyByRules("what's the weather in Porto tomorrow", BUILTIN)).toBe('explore') // a narrow rule that may route on its own
})

test('"арк" counts as story arc only as its own word', async () => {
  const cfg = merge(CFG, { classes: { structure: { model: 'opus', effort: 'high', floor: true } } })
  expect(classifyByRules('собери сюжетную арку на три серии', cfg)).toBe('structure')
  expect(classifyByRules('маркетинг для станции на парковке', cfg)).toBe(undefined)
})

test('a session label keeps 60 characters and masks anything that looks like a secret', () => {
  expect(labelOf('<system-reminder>ctx</system-reminder>  fix   the parser')).toBe('fix the parser')
  expect(labelOf('connect to postgres://admin:S3cret@db:5432/app')).toBe('connect to postgres://admin:…@db:5432/app')
  expect(labelOf('use password=hunter2 and api_key: abc123 here')).toBe('use password=… and api_key: … here')
  expect(labelOf('token tok_abcdefghijklmnopqrstuvwxyz0123 leaked')).toBe('token … leaked')
  expect(labelOf('почему падает сборка'.repeat(5)).length).toBe(60)
  expect(labelOf('explain the key idea of monads')).toBe('explain the key idea of monads') // "key" as a word stays
})

test('Jev-style answers route only when confident', async () => {
  const labels = ['explore', 'critique']
  expect(parseJev('explore 0.85', labels, 0.7)).toBe('explore')
  expect(parseJev('critique 0.4', labels, 0.7)).toBe(undefined)
  expect(parseJev('banana 0.99', labels, 0.7)).toBe(undefined)
  expect(parseJev('no idea', labels, 0.7)).toBe(undefined)
  expect(parseJev('Explore: 0.9', labels, 0.7)).toBe('explore')
})

test('an unsure investigation answer still names its class, so it can raise the turn; other unsure answers name none', () => {
  const labels = ['debugging', 'explore', 'learn-explain']
  expect(readLabel('debugging 0.55', labels, BUILTIN)).toEqual({ cls: 'debugging', sure: false })
  expect(readLabel('debugging 0.4', labels, BUILTIN)).toEqual({ cls: null, sure: false })
  expect(readLabel('learn-explain 0.6', labels, BUILTIN)).toEqual({ cls: null, sure: false })
  expect(readLabel('explore 0.75', labels, BUILTIN)).toEqual({ cls: 'explore', sure: false })
  expect(readLabel('explore 0.9', labels, BUILTIN)).toEqual({ cls: 'explore', sure: true })
})

test('short replies continue the current task', async () => {
  expect(isContinuation('Yes, build it')).toBe(true)
  expect(isContinuation('Write a new LinkedIn post about our bike-sharing launch in Lisbon')).toBe(false)
  expect(isContinuation('tell me the weather')).toBe(false)
  expect(isContinuation('and the tests too')).toBe(true)
  expect(isContinuation('давай дальше')).toBe(true)
})

test('floor classes never drop effort below the main default', async () => {
  expect(turnEffort('final-copy', CFG)).toBe('medium')
  expect(turnEffort('mechanical', CFG)).toBe('low')
  expect(turnEffort(null, CFG)).toBe(undefined)
  // a cheaper class's effort stays with its model: on Opus the turn keeps the default; on its own model it applies
  expect(turnEffort('mechanical', CFG, 'claude-opus-5-5')).toBe(undefined)
  expect(turnEffort('mechanical', CFG, 'haiku')).toBe('low')
  expect(turnEffort('critique', CFG, 'claude-sonnet-5-5')).toBe('high')
})

test('built-in classes that sit at the default carry no effort, so a repo that raises its default lifts them too', () => {
  const prod = merge(BUILTIN, { main: { model: 'opus', effort: 'high' } }) // a production repo's routing.json
  const atDefault = ['explore', 'mechanical', 'docs', 'learn-explain', 'data-analysis', 'long-read', 'math', 'test-writing']
  for (const c of atDefault) expect([c, turnEffort(c, BUILTIN, 'claude-opus-5-5') ?? BUILTIN.main.effort]).toEqual([c, 'medium'])
  for (const c of atDefault) expect([c, turnEffort(c, prod, 'claude-opus-5-5') ?? prod.main.effort]).toEqual([c, 'high'])
  expect(turnEffort('debugging', prod, 'claude-opus-5-5')).toBe('high')
  expect(BUILTIN.classes.explore!.sub).toEqual({ model: 'haiku', effort: 'medium' }) // a subagent tier keeps its own effort
})

test('a turn moves mid-chat only to Haiku; a class has its own subagent tier; the built-in table keeps chat answers off Haiku', async () => {
  const sonnetMech = merge(CFG, { classes: { mechanical: { model: 'sonnet', effort: 'high' } } })
  expect(autoModel('mechanical', 0, 'claude-opus-5-5', CFG)).toBe('haiku')
  expect(autoModel('mechanical', 0, 'claude-opus-5-5', sonnetMech)).toBe(undefined) // Sonnet's cache re-read costs more than the turn saves
  const sub = merge(CFG, { classes: { explore: { model: 'opus', effort: 'medium', sub: { model: 'haiku', effort: 'low' } } }, agents: { Explore: { class: 'explore' } } })
  expect(briefTier('explore', true, 'claude-opus-5-5', sub)).toMatchObject({ model: 'haiku', effort: 'low' })
  expect(agentTier('Explore', sub)).toMatchObject({ model: 'haiku', effort: 'low' })
  expect(needsSecondSample('explore', true, 'claude-opus-5-5', sub)).toBe(true)
  for (const c of Object.values(BUILTIN.classes)) expect(c.model).not.toBe('haiku')
  expect([BUILTIN.classes.explore!.sub?.model, BUILTIN.classes.mechanical!.sub?.model]).toEqual(['haiku', 'haiku'])
})

test('agents resolve through class references and direct tiers; a type with no entry is left to its brief', async () => {
  expect(agentTier('leak-checker', CFG)?.model).toBe('haiku')
  expect(agentTier('writer', CFG)?.effort).toBe('high')
  expect(agentTier('Explore', CFG)?.model).toBe('haiku')
  expect(agentTier('something-new', CFG)).toBe(undefined)
})

test("the owner's rules hold on the built-in table", async () => {
  const opusHigh = { model: 'opus', effort: 'high' }
  for (const c of ['debugging', 'code-review', 'security-review']) { // production investigation: Opus high or more, chat and subagent
    const t = BUILTIN.classes[c]!
    expect(rank(t.model) >= 3 && effortRank(t.effort!) >= effortRank(opusHigh.effort)).toBe(true)
    expect(rank(spawnPick({ brief: { cls: c, sure: true }, parentModel: 'claude-sonnet-5-5', personChose: false }, BUILTIN).model)).toBeGreaterThanOrEqual(3)
  }
  // Fable never automatic: not for a brief, a table entry or an owner's agents entry
  const owner = merge(BUILTIN, { agents: { writer: { class: 'final-copy' } } })
  expect(spawnPick({ tableTier: agentTier('writer', owner), parentModel: 'claude-opus-5-5', personChose: false }, owner).model).toBe('opus')
  expect(spawnPick({ brief: { cls: 'rare-hard', sure: true }, parentModel: 'claude-opus-5-5', personChose: false }, BUILTIN).model).toBe('opus')
  // no chat answer on Haiku; code below Opus only for scoped work the evals cleared
  for (const [c, t] of Object.entries(BUILTIN.classes)) expect([c, t.model]).not.toEqual([c, 'haiku'])
  expect(BUILTIN.classes['scoped-code']!.model).toBe('opus')
  // a Plan brief that is a migration gets the rule's extra effort on the same model
  const plan = spawnPick({ tableTier: agentTier('Plan', BUILTIN), rule: 'rare-hard', parentModel: 'claude-opus-5-5', personChose: false }, BUILTIN)
  expect([plan.model, plan.tier?.effort]).toEqual(['opus', 'xhigh'])
})

test('a brief moves a subagent only on a sure class; Fable is never automatic; a repeat climbs one tier', async () => {
  const cfg = merge(CFG, { classes: { 'rare-hard': { model: 'fable', effort: 'high', floor: true } } })
  expect(briefTier('mechanical', true, 'claude-opus-5-5', cfg)).toEqual({ model: 'haiku', effort: 'low', class: 'mechanical' })
  expect(briefTier('mechanical', false, 'claude-opus-5-5', cfg)).toBe(undefined) // unsure: the parent's model
  expect(briefTier(null, true, 'claude-opus-5-5', cfg)).toBe(undefined)
  expect(briefTier('rare-hard', true, 'claude-opus-5-5', cfg)?.model).toBe('opus')
  expect(briefTier('rare-hard', true, 'claude-fable-5-2', cfg)?.model).toBe('fable')
  expect([stepUp('claude-haiku-5-5'), stepUp('sonnet'), stepUp('opus'), stepUp('fable')]).toEqual(['sonnet', 'opus', 'opus', 'fable'])
  // an unsure strong class raises (production debugging gets its effort), never lowers, and a weak unsure one keeps the parent
  const pick = (cls: string, parentModel: string) => spawnPick({ brief: { cls, sure: false }, parentModel, personChose: false }, cfg)
  expect(pick('debugging', 'claude-opus-5-5').tier?.effort).toBe(cfg.classes.debugging!.effort)
  expect(pick('debugging', 'claude-fable-5-2')).toEqual({ model: 'fable', tier: undefined })
  expect(pick('mechanical', 'claude-opus-5-5')).toEqual({ model: 'opus', tier: undefined })
  expect(pick('mechanical', 'claude-haiku-5-5')).toEqual({ model: 'opus', tier: undefined }) // weak and unsure: lifted to the main default
  expect(briefHash('Review  the\nauth module ')).toBe(briefHash('Review the auth module'))
  expect(briefHash('Review the auth module')).not.toBe(briefHash('Review the billing module'))
})

test('cost math and the cache-break test', async () => {
  const u = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(costUsd('claude-haiku-5-5', u)).toBe(0.1)
  expect(costUsd('claude-opus-5-5', u)).toBe(4)
  expect(isCacheBreak(80000, 20000, 10_000)).toBe(true)
  expect(isCacheBreak(80000, 79000, 10_000)).toBe(false)
  expect(isCacheBreak(80000, 20000, 10 * 60_000)).toBe(false) // lapsed TTL, not effort
})

// A session wired to a fixed routing.json, a stub classifier and a model request that records the effort it got.
const ROUTING = JSON.stringify({
  main: { model: 'opus', effort: 'medium' },
  classes: { critique: { model: 'opus', effort: 'high', floor: true }, mechanical: { model: 'haiku', effort: 'low' } },
})
const USAGE = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The rows written to one table, summed per key the way the runner's upserts add them.
function rows(batches: Array<Array<Step>>, table: string): Array<Array<string | number | null>> {
  return batches.flat().filter(x => x.sql.startsWith(`INSERT INTO ${table} `)).map(x => x.params ?? [])
}

async function end($: any) {
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } })
}

function wire(on: any, opts: { batches?: Array<Array<Step>>; runFails?: boolean; store?: Map<string, unknown>; haiku?: string | (() => string); tokens?: number; ownClock?: boolean; sent: Array<unknown>; asked?: { n: number }; lines?: Array<string | undefined>; opened?: Array<unknown>; surfaces?: Array<string>; files?: Record<string, string>; models?: Array<string>; read?: number }) {
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home' : undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: opts?.surfaces ?? ['desktop'] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  if (!opts.ownClock) on('clock.now', () => ({ value: 1_000 }))
  if (!opts.ownClock) on('clock.after', () => ({ value: undefined })) // timers never fire here: tests flush at session.end
  on('ui.open', (_: unknown, e: unknown) => { opts.opened?.push(e); return { value: { isPlaced: true } } })
  on('ui.status', (_: unknown, e: { text?: string }) => { opts.lines?.push(e.text); return { value: undefined } })
  // the engine hands paths over normalized (C:\home\... on Windows)
  const files = opts.files
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Z]:/, '')
  if (files) {
    on('fs.exists', (_: unknown, e: { path: string }) => ({ value: norm(e.path) in files }))
    on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[norm(e.path)] }))
    on('fs.write', (_: unknown, e: { path: string; text: string }) => { files[norm(e.path)] = e.text; return { value: undefined } })
    on('fs.list', (_: unknown, e: { path: string }) => {
      const dir = norm(e.path).replace(/\/$/, '') + '/'
      const names = new Map<string, 'file' | 'dir'>()
      for (const p of Object.keys(files).filter(p => p.startsWith(dir))) { const [head, ...rest] = p.slice(dir.length).split('/'); names.set(head!, rest.length ? 'dir' : 'file') }
      return { value: [...names].map(([name, kind]) => ({ name, kind })) }
    })
  } else {
    on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path.replace(/\\/g, '/').endsWith('/home/.claude/routing.json') }))
    on('fs.read', () => ({ value: ROUTING }))
  }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: opts.store?.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { opts.store?.set(e.key, e.value); return { value: undefined } })
  // router.db: each batch the runner would get; selects answer empty
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('process.run', (_: unknown, e: { argv: Array<string>; init?: { stdin?: string } }) => {
    if (opts.runFails) return { value: { exitCode: 1, stdout: '', stderr: 'no node', isStdoutTruncated: false, isStderrTruncated: false } }
    const steps = (JSON.parse(e.init?.stdin ?? '{}').steps ?? []) as Array<Step>
    opts.batches?.push(steps)
    return { value: { exitCode: 0, stdout: JSON.stringify(steps.map(x => (x.all ? [] : null))), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.complete', () => { opts.asked && opts.asked.n++; return { value: { isAnswered: true, text: (typeof opts.haiku === 'function' ? opts.haiku() : opts.haiku) ?? 'default 0.9', usage: USAGE } } })
  // tokens set = a chat already under way (no first-prompt pick); unset = a new chat
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, ...(opts.tokens === undefined ? {} : { tokens: opts.tokens }) }, rateLimits: [] } }))
  on('turn.step', async function* (_: unknown, e: { effort?: unknown; model: string; turnId: string; index: number }) {
    opts.sent.push(e.effort)
    opts.models?.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, cache_read_input_tokens: opts.read ?? 0, model: e.model === 'haiku' ? 'claude-haiku-5-5' : USAGE.model } }
  })
}

async function step($: any, effort: string, agentId?: string) {
  const st = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of st) { /* drain */ }
}

test('a class sets the turn effort, a new unclassed task resets it, a chosen effort is kept', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  wire(on, { sent })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium') // critique floor: medium -> high
  await step($, 'xhigh') // the person chose xhigh: kept
  await $.prompt.submit({ text: 'Tell me a little about how the payments module talks to the ledger service' })
  await step($, 'medium') // Haiku said default: back to the session's own level

  expect(sent).toEqual(['high', 'xhigh', 'medium'])
})

test('a Sonnet class on an Opus chat keeps the default effort: the class effort belongs to its own model', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const sonnetMath = JSON.stringify({ classes: { math: { model: 'sonnet', effort: 'high' } } }) // an owner's table with a Sonnet class
  wire(on, { sent, haiku: 'math 0.95', tokens: 5_000, files: { '/home/.claude/routing.json': sonnetMath } }) // a chat under way on Opus
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Work out the expected number of retries when each call fails with p = 0.2' })
  await step($, 'medium')
  expect(sent).toEqual(['medium'])
})

test('the app picker default (high) is routed too, and the status line says so', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const lines: Array<string | undefined> = []
  wire(on, { sent, lines, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  await step($, 'high') // picker default high, class mechanical: low
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'high') // critique floor: high
  await step($, 'max') // the person switched to max mid-session: kept

  expect(sent).toEqual(['low', 'high', 'max'])
  expect(lines[0]).toBe('route: mechanical · Haiku (auto) · effort low (picker high) · saved ~$0.00')
})

test('a routed subagent gets its tier effort; headless sessions keep the main effort', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  wire(on, { sent, surfaces: [] }) // claude -p: no surface ever attaches
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: 'sub1' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: false })

  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium') // headless: never rewritten
  await $.agent.spawn({ prompt: 'find where the config is loaded', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })
  await step($, 'high', 'sub1') // BUILTIN table: Explore is the explore class, Haiku medium

  expect(sent).toEqual(['medium', 'medium'])
})

test('generic subagents go by their brief: sure and cheap moves, unsure stays on the parent, a repeat climbs, siblings share', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  const batches: Array<Array<Step>> = []
  let reply = 'mechanical 0.95'
  wire(on, { sent, files, batches, haiku: () => reply, tokens: 5_000 })
  const spawned: Array<string | undefined> = []
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: `sub${++n}` } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const spawn = (prompt: string, more = {}) => $.agent.spawn({ prompt, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', ...more })

  await spawn('Swap every variable called foo for bar across the utils folder')
  await step($, 'high', 'sub1') // mechanical: Haiku, effort low
  reply = 'mechanical 0.75'
  await spawn('Tidy the imports in the scripts folder and sort them')
  await step($, 'high', 'sub2') // unsure: the parent's model and effort
  reply = 'mechanical 0.95'
  await spawn('Swap every variable called foo for bar across the utils folder')
  await spawn('please review this PR for bugs and missing edge cases', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await spawn('Swap every variable called baz for qux across the app folder', { workflow: { runId: 'wf_1', agentIndex: 2 } })

  expect(spawned).toEqual(['haiku', undefined, 'sonnet', undefined, undefined]) // repeat: Haiku -> Sonnet; critique and its sibling: the parent's Opus
  expect(sent).toEqual(['low', 'high'])
  await end($)
  // per run: [day, session, type, routed, respawned]; the brief itself is never stored
  const runs = rows(batches, 'spawns')
  expect(runs.map(r => r.slice(1))).toEqual([['sess-1', 'general-purpose', 1, 1, 0], ['sess-1', 'general-purpose', 1, 0, 0], ['sess-1', 'general-purpose', 1, 1, 1], ['sess-1', 'general-purpose', 1, 0, 0], ['sess-1', 'general-purpose', 1, 0, 0]])
  const spent = rows(batches, 'usage').filter(r => r[2] === 'general-purpose')
  expect(spent.length).toBe(2) // sub1's and sub2's steps, each under its type
  expect(spent.every(r => Number(r[5]) > 0)).toBe(true)
  expect(JSON.stringify(batches)).not.toContain('Swap every variable')
})

test('subagents: a cheaper move needs two sure samples; rules raise a table type; unsure keeps the main default unless you chose the model', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  let replies = ['mechanical 0.95', 'explore 0.95'] // two sure samples that disagree
  let i = 0
  wire(on, { sent: [], files: { '/home/.claude/routing.json': ROUTING }, haiku: () => replies[i++ % replies.length]!, tokens: 5_000 })
  on('ui.toast', () => ({ value: undefined }))
  const spawned: Array<string | undefined> = []
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: `sub${++n}` } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const spawn = (prompt: string, more = {}) => $.agent.spawn({ prompt, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', ...more })

  await spawn('Swap every variable called foo for bar across the utils folder') // disagree: stays on the parent
  replies = ['mechanical 0.95']
  await spawn('Swap every variable called baz for qux across the app folder') // agree: Haiku
  await spawn('Find out why the payments service crashes on startup', { subagentType: 'Explore', parentModel: 'claude-sonnet-5-5' }) // Explore's Haiku, raised by the debugging rule
  replies = ['mechanical 0.5']
  await spawn('Look into the nightly export job and the numbers it sends', { parentModel: 'claude-sonnet-5-5' }) // unsure on a Sonnet parent: the main default
  expect(spawned).toEqual([undefined, 'haiku', 'opus', 'opus'])

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-model-sonnet' }) // the person chose Sonnet for this chat
  await spawn('Look into the weekly export job and the numbers it sends', { parentModel: 'claude-sonnet-5-5' })
  expect(spawned.at(-1)).toBe(undefined) // unsure stays on their Sonnet
  await band.unmount()
})

test('a desktop-app session (SDK start, surface attached later) is routed; the widget waits to be asked for', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const opened: Array<unknown> = []
  const surfaces: Array<string> = []
  wire(on, { sent, opened, surfaces })
  on('session.attach', (_: unknown, e: { clientId: string }) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  expect(opened).toEqual([]) // nothing draws yet

  surfaces.push('desktop')
  await $.session.attach({ surface: 'desktop', clientId: 'app-1' })
  await $.prompt.submit({ text: 'hi' })
  await step($, 'high') // picker default high, no class: main effort medium

  expect(sent).toEqual(['medium'])
  expect(opened).toEqual([]) // the band shows by itself; the widget only once the person turned it on
})

test('/route effort off stops the rewrite; /route off stops the classifier', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const asked = { n: 0 }
  wire(on, { sent, asked, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'route', args: 'effort off' })
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium')
  await $.command.run({ command: 'route', args: 'off' })
  await $.prompt.submit({ text: 'Reformat nothing, just describe the build pipeline stages in a few lines please' })

  expect(sent).toEqual(['medium'])
  expect(asked.n).toBe(0)
})

test('an unpinned subagent is routed to the table model; an explicit one is left alone', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const seen: Array<string | undefined> = []
  on('env.get', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', () => ({ value: false }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'route' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_, e) => {
    seen.push(e.model)
    return { model: e.model ?? 'inherit', agentId: `a${seen.length}` }
  })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'look around', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })
  await $.agent.spawn({ prompt: 'do it', parentModel: 'claude-opus-5-5', subagentType: 'general-purpose' })
  await $.agent.spawn({ prompt: 'do it', parentModel: 'claude-opus-5-5', subagentType: 'general-purpose', model: 'opus' })

  expect(seen).toEqual(['haiku', undefined, 'opus']) // a brief too short to read: the parent's model
})

test('a model or effort named in the prompt wins for that turn, floors included; "from now on" keeps it', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  const sent: Array<unknown> = []
  wire(on, { sent, models, haiku: 'default 0.9' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }

  await ask('please review this PR for bugs, use haiku for it') // critique is a floor, but the prompt asked
  await ask('Write the summary of the payments module changes for the team') // the next prompt is back on the picked model
  await ask('from now on use sonnet and think hard')
  await ask('Tell me how the ledger service stores its balances today') // still sonnet, still high

  expect(models).toEqual(['haiku', 'claude-opus-5-5', 'sonnet', 'sonnet'])
  expect(sent).toEqual(['high', 'medium', 'high', 'high'])
})

test('Claude calling Codex in Bash is pointed to the router tool', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  wire(on, { sent: [] })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'codex exec --ephemeral -s read-only "review src/" < /dev/null' })
  expect(r.deny).toMatch(/mcp__router__codex/)
})

test('a version pinned in an agent file or on the call runs the newest model of its family', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const seen: Array<string | undefined> = []
  on('env.get', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path.replace(/\\/g, '/').endsWith('/.claude/agents/old-pin.md') }))
  on('fs.read', () => ({ value: '---\nname: old-pin\nmodel: claude-opus-4-1\n---\nbody' }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'route' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('agent.spawn', (_: unknown, e: { model?: string }) => { seen.push(e.model); return { model: e.model ?? 'inherit', agentId: `a${seen.length}` } })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', parentModel: 'claude-opus-5-5', subagentType: 'old-pin' })
  await $.agent.spawn({ prompt: 'x', parentModel: 'claude-opus-5-5', subagentType: 'general-purpose', model: 'claude-sonnet-4-5-20250929' })
  await $.agent.spawn({ prompt: 'x', parentModel: 'claude-opus-5-5', subagentType: 'general-purpose', model: 'haiku' })

  expect(seen).toEqual(['opus', 'sonnet', 'haiku'])
})

const PANE = {
  plugin: 'router', component: 'Pane', requestId: 'router',
  props: { title: 'Router', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const BAND = {
  plugin: 'router', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

test('the Board never runs text from a prompt, a project name or an agent type as markup', async () => {
  const evil = '</script><img src=x onerror=alert(1)>'
  const b = { day: '2026-11-18', project: evil, session: 's', label: evil, first: 1, last: 2, turns: 1, byModel: { opus: { usd: 1, base: 2, steps: 1 } }, agents: { [evil]: { runs: 1, routed: 0, respawned: 0, usd: 0, base: 0 } } }
  const turn = { id: 't', who: evil, cls: evil, model: evil, effort: evil, picker: '', usd: 0, baseUsd: 0, steps: 1 }
  const html = boardHtml([b], [turn], 's', evil, evil, evil, null, evil)
  expect(html).not.toContain('<img')
  expect(html.match(/<\/script>/gi)?.length).toBe(html.match(/<script/gi)?.length) // only the page's own script tags close
})

test('withMode sets "mode" and keeps the rest of the file as written', async () => {
  const aligned = '{\n  "$comment": "x",\n  "mode": "on",\n  "main": { "model": "opus",   "effort": "medium" }\n}\n'
  expect(withMode(aligned, 'off')).toBe(aligned.replace('"mode": "on"', '"mode": "off"'))
  expect(JSON.parse(withMode('{\n  "codex": { "effort": "xhigh" }\n}\n', 'off'))).toEqual({ mode: 'off', codex: { effort: 'xhigh' } })
  expect(JSON.parse(withMode(undefined, 'off'))).toEqual({ mode: 'off' })
  expect(JSON.parse(withMode('{}', 'on'))).toEqual({ mode: 'on' })
  expect(() => withMode('{ broken', 'off')).toThrow()
})

test('the band is one row; Stats opens the card; Settings turns routing off for the project in its routing.json', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  wire(on, { sent: [], files, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  await step($, 'high')

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: 'Haiku low (auto)' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: 'saved $0.00' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /fits mechanical better/ })).toBeFalsy() // the turn moved by itself: no tip
  expect(await band.find({ type: 'Svg' })).toBeFalsy()

  await band.press({ key: 'router-stats' })
  const card = await band.find({ type: 'Svg' })
  expect(card?.props.alt).toMatch(/Saved this chat \$0\.00/)
  expect(card?.props.alt).toMatch(/Now Haiku low \(auto\), you picked high/)

  await band.press({ key: 'router-settings' })
  expect(await band.find({ type: 'Svg' })).toBeFalsy()
  await band.press({ key: 'router-project-off' })
  expect(JSON.parse(files['/proj/.claude/routing.json'] ?? '{}')).toEqual({ mode: 'off' })
  expect(await band.find({ type: 'Text', text: 'off in this project' })).toBeTruthy()

  await band.press({ key: 'router-global-off' })
  expect(JSON.parse(files['/home/.claude/routing.json'] ?? '{}').mode).toBe('off')
  await band.press({ key: 'router-project-on' }) // the project switch wins over Everywhere
  expect(await band.find({ type: 'Text', text: 'Haiku low (auto)' })).toBeTruthy()

  await band.press({ key: 'router-chat-off' })
  expect(await band.find({ type: 'Text', text: 'off in this chat' })).toBeTruthy()
  await band.unmount()
})

test('one prompt never proposes a cheaper model for the chat; a stronger one is still suggested', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const routing = JSON.stringify({
    main: { model: 'opus', effort: 'medium' },
    classes: { 'scoped-code': { model: 'sonnet', effort: 'medium' }, 'rare-hard': { model: 'fable', effort: 'medium', floor: true } },
  })
  wire(on, { sent: [], files: { '/home/.claude/routing.json': routing } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.prompt.submit({ text: 'The billing build finished, check it and fix the failing test' }) // scoped-code -> Sonnet, below the Opus chat
  expect(await band.find({ type: 'Text', text: /fits scoped-code better/ })).toBeFalsy()
  await $.prompt.submit({ text: 'Plan the migration of the whole billing service to the new ledger' }) // rare-hard -> Fable, above it
  expect(await band.find({ type: 'Text', text: /Fable fits rare-hard better/ })).toBeTruthy()
  await band.unmount()
})

test('effort only: a subagent keeps its model but gets its tier effort', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const models: Array<string | undefined> = []
  wire(on, { sent })
  on('agent.spawn', (_: unknown, e: { model?: string }) => { models.push(e.model); return { model: e.model ?? 'inherit', agentId: 'sub1' } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'route', args: 'models off' })
  await $.agent.spawn({ prompt: 'look around', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })
  await step($, 'high', 'sub1')
  expect(models).toEqual([undefined])
  expect(sent).toEqual(['medium'])
})

test('the ledger keeps each session per day; the classifier counts as spend with no baseline', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], files, batches, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: '<system-reminder>injected</system-reminder>\nSwap every variable called foo for bar in the utils module and the tests too' })
  await step($, 'high')
  await step($, 'high') // a second step of the same turn: still one turn
  await end($)

  const d = new Date(1_000)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  expect(files['/home/.claude/router/sqlite.mjs']).toBe(RUNNER)
  const label = 'Swap every variable called foo for bar in the utils module a' // cut at 60 characters
  expect(rows(batches, 'sessions').at(-1)).toEqual(['sess-1', 'proj', label])
  expect(rows(batches, 'days').reduce((n, r) => n + Number(r[2]), 0)).toBe(1)
  // the first prompt's 3 classifier samples (who 'router', no baseline) and the 2 steps, moved to Haiku by itself (baseline: Opus)
  const usage = rows(batches, 'usage')
  expect(usage.every(r => r[0] === day && r[1] === 'sess-1' && r[3] === 'haiku')).toBe(true)
  expect(usage.map(r => r[2])).toEqual(['router', 'router', 'router', 'main', 'main'])
  expect(usage.filter(r => r[2] === 'router').every(r => r[6] === 0)).toBe(true)
  const main = usage.find(r => r[2] === 'main')!
  expect(Math.round(Number(main[6]) * 1e8)).toBe(14000) // $0.00014 on Opus
  expect(Math.round(Number(main[5]) * 1e8)).toBe(350) // $0.0000035 on Haiku
})

test("0.2's JSON ledger is read into router.db once; a damaged file is skipped, a failed run tries again", async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const old = { day: '2026-11-17', project: 'proj', session: 'old-1', label: '<system-reminder>x</system-reminder>Fix the parser', first: 5, last: 9, turns: 3, byModel: { opus: { usd: 2, base: 2, steps: 7 } }, agents: { Explore: { runs: 2, routed: 1, respawned: 0, usd: 0.1, base: 0.2 } } }
  const files: Record<string, string> = {
    '/home/.claude/routing.json': ROUTING,
    '/home/.claude/router/ledger/2026-11-17/old-1.json': JSON.stringify(old),
    '/home/.claude/router/ledger/2026-11-17/broken.json': '{ not json',
  }
  const opts = { sent: [], files, batches: [] as Array<Array<Step>>, store: new Map<string, unknown>(), runFails: true }
  wire(on, opts)
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await end($)
  expect(opts.store.get('ledgerImported')).toBeUndefined() // node failed: nothing marked done

  opts.runFails = false
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await end($)
  expect(opts.store.get('ledgerImported')).toBe(true)
  expect(rows(opts.batches, 'sessions')[0]).toEqual(['old-1', 'proj', 'Fix the parser'])
  expect(rows(opts.batches, 'days')[0]).toEqual(['2026-11-17', 'old-1', 3, 5, 9])
  expect(rows(opts.batches, 'usage')[0]).toEqual(['2026-11-17', 'old-1', 'main', 'opus', 7, 2, 2])
  expect(rows(opts.batches, 'spawns')[0]).toEqual(['2026-11-17', 'old-1', 'Explore', 2, 1, 0])

  const before = opts.batches.length
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await end($)
  expect(rows(opts.batches.slice(before), 'usage')).toEqual([]) // never twice
})

test('a failed save keeps the rows for the next batch and warns once', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const toasts: Array<string> = []
  const opts = { sent: [], files: { '/home/.claude/routing.json': ROUTING }, haiku: 'mechanical 0.95', batches: [] as Array<Array<Step>>, runFails: true }
  wire(on, opts)
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module' })
  await step($, 'high')
  await end($)
  await end($)
  expect(toasts.filter(t => t.includes('need Node.js')).length).toBe(1)
  expect(opts.batches).toEqual([])
  opts.runFails = false
  await end($)
  expect(rows(opts.batches, 'usage').length).toBe(4) // nothing lost: 3 classifier samples and the step
  await end($)
  expect(rows(opts.batches, 'usage').length).toBe(4) // and nothing sent twice
})

test('only a sure quick task moves its own turn to Haiku; a follow-up, an unsure class and a floor class stay', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  const haikuClasses = JSON.stringify({ classes: { explore: { model: 'haiku', effort: 'medium' }, mechanical: { model: 'haiku', effort: 'low' } } })
  const opts = { sent: [] as Array<unknown>, models, haiku: 'mechanical 0.95' as string, read: 0, tokens: 5_000, files: { '/home/.claude/routing.json': haikuClasses } } // a chat under way: per-turn moves only
  wire(on, opts) // the stub reads opts.haiku on each call
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'high') }

  await ask('Swap every variable called foo for bar in the utils module and the tests too')
  await ask('ok, do it') // a follow-up: back to the picked model
  opts.haiku = 'mechanical 0.75'
  await ask('Tidy the imports at the top of the payments module please') // passes 0.7, not sure enough for 0.85
  await ask('please review this PR for bugs and missing edge cases') // critique, a floor: never moved
  opts.haiku = 'explore 0.9'
  await ask('tell me the weather')
  await $.command.run({ command: 'route', args: 'models off' })
  await ask('where is the config loaded from in this repo') // effort only: the model stays
  await $.command.run({ command: 'route', args: 'models on' })
  opts.read = 120_000
  await ask('tell me the weather in Porto') // the chat was small before this step: moved
  await ask('tell me the weather in Lisbon') // now 120K in context: Haiku's long-prompt price would cost more than Opus's cache

  expect(models).toEqual(['haiku', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'haiku', 'claude-opus-5-5', 'haiku', 'claude-opus-5-5'])
})

test('the first prompt picks the chat model only when all 3 samples agree; Undo and a harder task go back', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'mechanical 0.95' }) // no tokens yet: a new chat
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await ask('Swap every variable called foo for bar in the utils module and the tests too')
  await ask('ok, do it') // the chat itself moved: a follow-up stays there
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', label: 'Picked Haiku for this chat · Undo' })).toBeTruthy()
  await band.press({ key: 'router-chat-undo' })
  await ask('ok, and the docs too')
  expect(models).toEqual(['haiku', 'haiku', 'claude-opus-5-5'])
  expect(await band.find({ key: 'router-chat-undo' })).toBeFalsy()
  await band.unmount()
})

test('first prompt: split samples keep the default; the auto pick steps back for a floor task', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  const answers = ['mechanical 0.95', 'explore 0.9', 'mechanical 0.95']
  wire(on, { sent: [], models, haiku: () => answers.shift() ?? 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await ask('Tidy the imports at the top of the payments module please') // samples disagree: the chat keeps Opus
  expect(models).toEqual(['claude-opus-5-5'])
})

test('first prompt: three agreeing samples that are not sure keep the default', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'mechanical 0.8' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Tidy the imports at the top of the payments module please' })
  await step($, 'medium')
  expect(models).toEqual(['claude-opus-5-5'])
})

test('a new chat whose first task is easy runs on Haiku until a floor task arrives', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await ask('Tidy the imports at the top of the payments module please')
  await ask('please review this PR for bugs and missing edge cases') // critique, a floor: back to the default
  await ask('ok, go on')
  expect(models).toEqual(['haiku', 'claude-opus-5-5', 'claude-opus-5-5'])
})

test('the widget is a glance of two rows and the bars; expanded it is the Stats card', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  wire(on, { sent: [], haiku: 'mechanical 0.95', tokens: 5_000 }) // a chat under way: one turn moved, not the chat
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  await step($, 'high')

  const widget = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget', anchoredEdges: [] }, surface: 'desktop' })
  expect((await widget.findAll({ type: 'Text' })).map((x: { text: string }) => x.text)).toEqual(['Routing', 'Haiku low (auto)', 'Saved this chat', '$0.00 · 95%'])
  await widget.unmount()

  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await dock.find({ type: 'Svg' }))?.props.alt).toMatch(/Spent this chat \$[0-9.]+, re-routed 1 turn/)
  await dock.unmount()
})

// Regressions from the code audit of 2026-11-18.
test('a prompt typed over a running turn may raise that turn, never lower it', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const models: Array<string> = []
  wire(on, { sent, models, haiku: 'mechanical 0.95', tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium') // critique: high
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module', turnId: 't' })
  await step($, 'medium') // still the critique turn
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module' })
  await step($, 'medium') // its own turn: Haiku, low
  expect(sent).toEqual(['high', 'high', 'low'])
  expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5-5', 'haiku'])
})

test('a compaction never reads as an effort change breaking the cache', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const opts = { sent: [] as Array<unknown>, read: 100_000, tokens: 50_000, haiku: 'default 0.9' }
  const toasts: Array<string> = []
  wire(on, opts)
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium') // high, 100K read from cache
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  opts.read = 20_000 // the short summary
  await $.prompt.submit({ text: 'Tell me a little about how the payments module talks to the ledger service' })
  await step($, 'medium')
  expect(opts.sent).toEqual(['high', 'medium'])
  expect(toasts.filter(t => /broke the prompt cache/.test(t))).toEqual([])
})

test('/clear starts the chat over: a "from now on" ask from before no longer applies', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'mechanical 0.95', tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'use haiku from now on, and swap foo for bar in the utils module' })
  await step($, 'medium')
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } })
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases' })
  await step($, 'medium') // the old ask would beat the critique floor
  expect(models).toEqual(['haiku', 'claude-opus-5-5'])
})

test('a chat on the router\'s own cheap pick goes back to the default for a long follow-up it cannot place', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  let reply = 'mechanical 0.95'
  wire(on, { sent: [], models, haiku: () => reply }) // no tokens: a new chat
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await ask('Swap every variable called foo for bar in the utils module and the tests too') // the chat moves to Haiku
  reply = 'default 0.9'
  await ask('now rebuild the billing reconciliation engine from scratch, with tests') // opens like a follow-up
  expect(models).toEqual(['haiku', 'claude-opus-5-5'])
})

test('a keyword rule never sends a subagent below its parent', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const spawned: Array<string | undefined> = []
  wire(on, { sent: [], tokens: 5_000 })
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: 'sub1' } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'please review this PR for bugs and missing edge cases', subagentType: 'general-purpose', parentModel: 'claude-fable-5-2' })
  expect(spawned).toEqual([undefined]) // critique is Opus by rule: the Fable parent's model stays
})

test('Settings: a model and an effort picked for the chat win over the router; Auto gives them back', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  const sent: Array<unknown> = []
  wire(on, { sent, models, haiku: 'mechanical 0.95', tokens: 5_000 })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-model-sonnet' })
  await band.press({ key: 'router-effort-high' })
  const ask = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await ask('Swap every variable called foo for bar in the utils module and the tests too') // a sure quick task: no move, the pick holds
  expect(await band.find({ key: 'router-model-sonnet', variant: 'primary' })).toBeTruthy()
  await band.press({ key: 'router-model-auto' })
  await band.press({ key: 'router-effort-auto' })
  await ask('Swap every variable called baz for qux in the utils module and the tests too') // the router again: Haiku, low
  expect(models).toEqual(['sonnet', 'haiku'])
  expect(sent).toEqual(['high', 'low'])
  await band.unmount()
})

test('first-prompt pick: 3 agreeing samples of a cheaper, non-floor class only', async () => {
  const cfg = merge(CFG, { classes: { 'scoped-code': { model: 'sonnet', effort: 'high' } } })
  expect(firstModel(['scoped-code', 'scoped-code', 'scoped-code'], 'claude-opus-5-5', cfg)).toBe('sonnet')
  expect(firstModel(['scoped-code', 'scoped-code', 'explore'], 'claude-opus-5-5', cfg)).toBe(undefined)
  expect(firstModel(['scoped-code'], 'claude-opus-5-5', cfg)).toBe(undefined) // a single sample never moves the chat
  expect(firstModel(['critique', 'critique', 'critique'], 'claude-opus-5-5', cfg)).toBe(undefined) // a floor
  expect(firstModel([null, null, null], 'claude-opus-5-5', cfg)).toBe(undefined)
})

test('session check: up on 2 of 3, down only on 3 sure of 3 and no floor at hand; compact or fresh by topic', async () => {
  const v = (t: string) => parseSessionCheck(t)
  expect(v('sonnet 0.9 same')).toEqual({ tier: 'sonnet', p: 0.9, topic: 'same' })
  expect(v('I think opus')).toBe(undefined)
  const opus = 'claude-opus-5-5'
  expect(adviseSwitch([v('fable 0.8 same'), v('fable 0.9 same'), v('opus 0.9 same')], opus, 'plan', CFG)).toEqual({ action: 'up', model: 'fable', kind: 'compact', trigger: 'plan' })
  expect(adviseSwitch([v('sonnet 0.9 new'), v('haiku 0.95 new'), v('sonnet 0.9 same')], opus, 'compact', CFG)).toEqual({ action: 'down', model: 'sonnet', kind: 'fresh', trigger: 'compact' })
  expect(adviseSwitch([v('sonnet 0.9 same'), v('sonnet 0.8 same'), v('sonnet 0.9 same')], opus, 'compact', CFG)).toBe(undefined) // one unsure sample
  expect(adviseSwitch([v('sonnet 0.9 same'), v('opus 0.9 same'), v('sonnet 0.9 same')], opus, 'compact', CFG)).toBe(undefined) // not all below
  expect(adviseSwitch([v('sonnet 0.9 same'), v('sonnet 0.9 same'), v('sonnet 0.9 same')], opus, 'compact', CFG, 'critique')).toBe(undefined) // a floor task at hand
  expect(adviseSwitch([v('sonnet 0.9 same'), undefined, v('sonnet 0.9 same')], opus, 'compact', CFG)).toBe(undefined) // a failed sample
  const haiku = 'claude-haiku-5-5'
  expect(adviseSwitch([v('sonnet 0.6 same'), v('sonnet 0.65 same'), v('haiku 0.9 same')], haiku, 'todos', CFG)?.model).toBe('sonnet') // 0.6 is enough to offer up
  expect(adviseSwitch([v('sonnet 0.55 same'), v('sonnet 0.9 same'), v('haiku 0.9 same')], haiku, 'todos', CFG)).toBe(undefined) // only one sample at 0.6+
  // a strong class at hand: the offer is at least its model, never the lowest sample
  expect(adviseSwitch([v('sonnet 0.8 same'), v('opus 0.8 same'), v('haiku 0.9 same')], haiku, 'todos', CFG, 'security-review')?.model).toBe('opus')
  expect(adviseSwitch([v('sonnet 0.8 same'), v('sonnet 0.8 same'), v('haiku 0.9 same')], haiku, 'todos', CFG, 'debugging')?.model).toBe('opus') // investigation, not a floor
  expect(adviseSwitch([v('sonnet 0.8 same'), v('sonnet 0.8 same'), v('haiku 0.9 same')], haiku, 'todos', CFG, 'docs')?.model).toBe('sonnet') // an ordinary class does not raise it
  expect(adviseSwitch([v('sonnet 0.9 same'), v('sonnet 0.9 same'), v('sonnet 0.9 same')], opus, 'compact', CFG, 'debugging')).toBe(undefined) // never down with investigation at hand
  // a strong class above the chat's model offers its model even when Haiku answers the current one
  const sonnet = 'claude-sonnet-5-5'
  expect(adviseSwitch([v('sonnet 0.6 same'), v('sonnet 0.6 same'), v('sonnet 0.7 same')], sonnet, 'todos', CFG, 'debugging')).toEqual({ action: 'up', model: 'opus', kind: 'compact', trigger: 'todos' })
  expect(adviseSwitch([v('haiku 0.9 same'), v('haiku 0.9 same'), v('haiku 0.9 same')], sonnet, 'todos', CFG, 'debugging')).toBe(undefined) // all see lighter work: no raise (and no down)
  expect(adviseSwitch([v('sonnet 0.9 same'), v('sonnet 0.9 same'), v('sonnet 0.9 same')], sonnet, 'todos', CFG, 'docs')).toBe(undefined) // an ordinary class never raises by itself
  // down moves one family at a time
  expect(adviseSwitch([v('haiku 0.9 same'), v('haiku 0.95 same'), v('haiku 0.9 same')], opus, 'compact', CFG)?.model).toBe('sonnet')
  expect(adviseSwitch([v('haiku 0.9 same'), v('haiku 0.95 same'), v('haiku 0.9 same')], 'claude-fable-5-2', 'compact', CFG)?.model).toBe('opus')
  expect(adviseSwitch([v('haiku 0.9 same'), v('haiku 0.95 same'), v('haiku 0.9 same')], sonnet, 'compact', CFG)?.model).toBe('haiku')
})

test('after a compaction the band offers a lighter model; the button compacts and switches, Not now stays quiet', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'haiku 0.95 same', tokens: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  let compactions = 0
  on('session.compact', () => { compactions++; return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  expect(await band.find({ type: 'Text', text: /looks lighter: Sonnet can do it/ })).toBeTruthy() // one family down at a time
  await band.press({ key: 'router-offer-no' })
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) // the same trigger after "Not now": quiet
  await clock.advance(600)
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy()

  await $.tool.call({ tool: 'ExitPlanMode', plan: 'ship it' }) // a different trigger, but within 10 turns of the last offer: quiet
  await clock.advance(600)
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy()
  await band.unmount()
  expect(compactions).toBe(2)
})

test('the offer button compacts, then the chat runs on the offered model', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'sonnet 0.9 same', tokens: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  let compactions = 0
  on('session.compact', () => { compactions++; return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now write the changelog entries', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  await band.press({ key: 'router-offer-compact' })
  expect(compactions).toBe(2) // the trigger's and the button's
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy()
  await step($, 'medium')
  expect(models).toEqual(['sonnet'])
  await band.unmount()
})
