import { expect, mock, test } from 'claude-code/testing'

import {
  BUILTIN, CLASS_LABELS, adviseSwitch, effortRank, rank, agentTier, autoModel, needsSecondSample, briefHash, briefTier, stepUp, classifyByRules, costUsd, firstModel, isCacheBreak, isContinuation, merge, parseJev, parseSessionCheck, parseMood, raiseEffort, moodPrompt, longRun, readLabel, spawnPick, turnEffort, withoutRouter, rebuildUsd, stepUsd, switchMath, remainingSteps, quickPays, type Life, sessionCheckSystem, briefPaths, sizeOf, bucket, estTokens, keepsRaw, pasteModel, pasteSystem, offloaded, cacheSheet, coldMath, awakeNext, AWAKE_TEXT, returnCurve, nudgePays, backAtAll, writeOverRead, parseDone, type Gap, isNudgeReply, compactStepUsd, cheapestPoint, compactPoints, compactLook, compactsPer100,
} from '../hooks/policy'
import { addWhy, cacheClock, minutesLeft, whoWords, whyWords, boardHtml, cacheStrength, cardLayout, hitPct, svgSize, switchCost, netWords, planFmt, planRate, savedUsd, shade, statsSvg, withMode } from '../hooks/view'
import { RUNNER, type Step, bucketsOf, labelOf, livesOf } from '../hooks/db'
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

test('rules pick the class, floors first; other languages go to the classifier', async () => {
  expect(classifyByRules('please review this PR for bugs', CFG)).toBe('code-review') // a PR review is code review, not creative critique
  expect(classifyByRules('find where the config lives', CFG)).toBe(undefined) // a cheaper class by a broad rule: the classifier decides
  expect(classifyByRules('rework the seat budget logic', CFG)).toBe('architecture')
  expect(classifyByRules('hello there', CFG)).toBe(undefined)
  expect(classifyByRules("what's the weather?", CFG)).toBe('explore')
  expect(classifyByRules('whats the NVDA price for last 2 days?', CFG)).toBe('explore')
  expect(classifyByRules('какая погода завтра в Лиссабоне', CFG)).toBe(undefined)
  expect(classifyByRules('проведи ревью архитектуры', CFG)).toBe(undefined)
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
  expect(isContinuation('давай')).toBe(true) // short: a follow-up in any language
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

test('on Fable a class effort of high or more runs one step lower', async () => {
  expect(turnEffort('final-copy', BUILTIN, 'claude-opus-5-5')).toBe('high')
  expect(turnEffort('final-copy', BUILTIN, 'claude-fable-5-2')).toBe('medium')
  expect(turnEffort('rare-hard', BUILTIN, 'fable')).toBe('high')
  expect(turnEffort('rare-hard', BUILTIN, 'claude-opus-5-5')).toBe('xhigh')
  // medium is not lowered
  expect(turnEffort('x', { ...BUILTIN, classes: { x: { model: 'fable', effort: 'medium' } } }, 'fable')).toBe('medium')
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
  // an unsure strong class raises (production debugging gets its effort), never lowers; a weak unsure one is a defined
  // task: the subagent default (Sonnet high), only ever lower than the parent; a brief never read keeps the parent
  const pick = (cls: string | null | undefined, parentModel: string) => spawnPick({ brief: { cls, sure: false }, parentModel, personChose: false }, cfg)
  expect(pick('debugging', 'claude-opus-5-5').tier?.effort).toBe(cfg.classes.debugging!.effort)
  expect(pick('debugging', 'claude-fable-5-2')).toEqual({ model: 'fable', tier: undefined })
  expect(pick('mechanical', 'claude-opus-5-5')).toEqual({ model: 'sonnet', tier: { model: 'sonnet', effort: 'high' } })
  expect(pick(null, 'claude-opus-5-5').model).toBe('sonnet') // read, no class: still a defined task
  expect(pick(undefined, 'claude-opus-5-5')).toEqual({ model: 'opus', tier: undefined }) // too short to read: the parent's
  expect(pick('mechanical', 'claude-haiku-5-5')).toEqual({ model: 'opus', tier: undefined }) // weak and unsure: lifted to the main default
  expect(pick('mechanical', 'claude-sonnet-5-5')).toEqual({ model: 'opus', tier: undefined }) // the default is never a raise or a stay
  // a sure class at the main tier is a defined task too; a class that raises effort keeps its own tier unless it has a sub
  expect(briefTier('docs', true, 'claude-opus-5-5', BUILTIN)?.model).toBe('sonnet')
  expect(briefTier('debugging', true, 'claude-opus-5-5', BUILTIN)).toMatchObject({ model: 'opus', effort: 'high' })
  expect(briefTier('scoped-code', true, 'claude-opus-5-5', BUILTIN)).toMatchObject({ model: 'sonnet', effort: 'high' })
  expect(briefTier('explore', true, 'claude-opus-5-5', BUILTIN)).toMatchObject({ model: 'haiku', effort: 'medium' })
  expect(briefTier('security-review', true, 'claude-opus-5-5', BUILTIN)).toMatchObject({ model: 'opus', effort: 'high' })
  expect(briefHash('Review  the\nauth module ')).toBe(briefHash('Review the auth module'))
  expect(briefHash('Review the auth module')).not.toBe(briefHash('Review the billing module'))
})

test('the no-router cost: the asked model and effort, a warm cache for a moved turn, no saving when nothing changed', () => {
  const u = { input_tokens: 1_000, output_tokens: 10_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 80_000 }
  const usd = (n: number) => Math.round(n * 1e6) // micro-dollars
  // nothing changed (a Sonnet session the router left alone): the baseline is what it spent, not an Opus price
  expect(usd(withoutRouter({ model: 'sonnet', effort: 'medium' }, { model: 'claude-sonnet-5-5', effort: 'medium' }, u, 80_000))).toBe(usd(costUsd('sonnet', u))) // a cache write on the same model happens either way
  // a turn raised to high: with no router the step would cost 1/1.4 as much (measured as whole-answer cost), so extra
  const raised = withoutRouter({ model: 'opus', effort: 'medium' }, { model: 'opus', effort: 'high' }, u)
  expect(usd(raised)).toBe(usd(costUsd('opus', u) / 1.4))
  // a turn moved to Haiku wrote the chat into Haiku's cache; Opus would have read it warm
  const moved = withoutRouter({ model: 'opus', effort: 'medium' }, { model: 'haiku', effort: 'medium' }, u, 80_000)
  expect(usd(moved)).toBe(usd(costUsd('opus', { ...u, cache_creation_input_tokens: 0, cache_read_input_tokens: 80_000 })))
  expect(moved < costUsd('opus', u) / 2).toBe(true) // not the fake saving of pricing 80K as an Opus cache write
  // the next moved step reads Haiku's own cache: Opus would have read the same, and written the same new tokens
  const next = { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 3_000 }
  expect(usd(withoutRouter({ model: 'opus', effort: 'medium' }, { model: 'sonnet', effort: 'medium' }, next, 80_000, true))).toBe(usd(costUsd('opus', next, true)))
})

test('prices: 1-hour cache writes cost 2x input, 5-minute ones 1.25x; Haiku past 100K costs 5x on every side', () => {
  const w = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }
  expect(costUsd('opus', w, true)).toBe(8) // main thread: 1-hour entries (pricing page 2026-11-19: $8/M on Opus)
  expect(costUsd('opus', w)).toBe(5) // subagents: 5-minute entries
  const long = { input_tokens: 100_001, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(Math.round(costUsd('haiku', long) * 100)).toBe(Math.round((100_001 * 0.5 / 1e6 + 2.5) * 100)) // output $2.50/M past 100K
})

test('the Stats card: two columns in a narrow band, bars up for more and down for less than no router', () => {
  expect(cardLayout(100)).toEqual({ width: 800, perRow: 4 })
  expect(cardLayout(50)).toEqual({ width: 400, perRow: 2 })
  expect(cardLayout(10).width).toBe(320) // never narrower than two readable columns
  const turn = (usd: number, baseUsd: number, cache?: { input: number; read: number; write: number }) => ({ id: 't', who: 'main', cls: 'debugging', model: 'opus', effort: 'high', picker: '', usd, baseUsd, steps: 1, cache })
  const svg = statsSvg([{ label: 'This chat', value: '$0.52 extra', sub: '', isExtra: true }], [turn(2, 1, { input: 10, read: 80, write: 10 }), turn(1, 2), turn(1, 1.01)], 400, 2)
  expect(svg).toContain('class="v x"')
  const bars = [...svg.matchAll(/<rect class="m-opus-2" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])])
  const mid = Number(svg.match(/<line class="d" x1="44" y1="([\d.]+)"/)![1]) - 0.5
  expect(bars).toHaveLength(3)
  expect(bars[0]![0]! + bars[0]![1]!).toBe(mid) // cost more: up from the no-router line
  expect(bars[1]![0]).toBe(mid + 1) // cost less: down from it
  expect(bars[0]![1]).toBe(35) // the biggest difference fills its half (36 px less the line)
  expect(bars[2]![1]).toBe(3.5) // square-root scale: 1/100 of the biggest is 1/10 of its height, not a 2 px floor
  expect(svg).toContain('<title>debugging: Opus high. $2.00 spent, $1.00 with no router (+$1.00). Cache hit 80%</title>')
  expect(svg.match(/<rect class="c" /g)).toHaveLength(1) // a cache square only where the hit is known
  // the cache squares are a section of their own under the spending chart, not part of it
  expect(svg.indexOf('Cache hit per turn')).toBeGreaterThan(svg.indexOf('Cost per turn vs no router'))
  expect(Number(svg.match(/<rect class="c" x="[\d.]+" y="([\d.]+)"/)![1])).toBeGreaterThan(mid + 36 + 24)
})

test('model colors: darker is more effort in both themes, dark steps get a ring on a dark page; the model band keeps price order', () => {
  expect([shade('opus', 'low'), shade('opus', 'medium'), shade('opus', 'high'), shade('opus', 'max')]).toEqual(['#e4a089', '#D97757', '#98533d', '#623627'])
  expect(shade('sonnet', 'xhigh', 'dark')).toBe(shade('sonnet', 'max', 'dark'))
  const lum = (h: string) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0)
  expect(lum(shade('fable', 'max', 'dark'))).toBeLessThan(lum(shade('fable', 'high', 'dark'))) // darker is more effort on a dark page too
  expect(lum(shade('fable', 'low', 'dark'))).toBeGreaterThan(lum(shade('fable', 'medium', 'dark'))) // low is the lightest
  const dark = statsSvg([], [], 400, 2, {}, '').split('@media (prefers-color-scheme:dark)').at(-1)!
  expect(dark).toContain('.m-opus-3{stroke:#ffffff73') // the ring only on a dark page
  expect(statsSvg([], [], 400, 2, {}, '').indexOf('stroke:#ffffff73')).toBeGreaterThan(statsSvg([], [], 400, 2, {}, '').lastIndexOf('@media'))
  const mix = { 'opus:high': { usd: 3, steps: 2, cache: { input: 1, read: 8, write: 1 } }, 'haiku:low': { usd: 0.001, steps: 1, cache: { input: 1, read: 0, write: 1 } } }
  const svg = statsSvg([], [], 400, 2, mix, '2 turns re-routed')
  expect(svg.indexOf('class="m-haiku-0"')).toBeLessThan(svg.indexOf('class="m-opus-2"')) // cheapest first
  expect(svg).toContain('Haiku &lt;1%')
  expect(svg).toContain('2 turns re-routed')
  expect(hitPct({ input: 1, read: 8, write: 1 })).toBe(80)
  expect(hitPct(undefined)).toBeUndefined()
  expect(hitPct({ input: 2, read: 330468, write: 1236 })).toBe(99.6) // a warm chat (this session's own steps): never rounded up to 100
  expect(hitPct({ input: 0, read: 5, write: 0 })).toBe(100)
  const near = (c: { input: number; read: number; write: number }) => Math.round(cacheStrength(c)! * 100) / 100
  expect([near({ input: 1, read: 999, write: 0 }), near({ input: 1, read: 99, write: 0 }), near({ input: 1, read: 9, write: 0 }), near({ input: 1, read: 0, write: 0 })]).toEqual([1, 0.67, 0.33, 0]) // 99.9%, 99%, 90%, 0%
  expect(cacheStrength({ input: 1, read: 249, write: 0 })! - cacheStrength({ input: 1, read: 99, write: 0 })!).toBeGreaterThan(0.1) // 99.6% vs 99%: visibly apart
  expect(svgSize(svg)).toEqual({ width: 400, height: Number(svg.match(/height="(\d+)"/)![1]) })
})

test('the money words say which way it went, and savings and extra stay apart', () => {
  expect(netWords({ actualUsd: 1, baselineUsd: 1.4, extraUsd: 0 })).toBe('saved $0.40')
  expect(netWords({ actualUsd: 1.52, baselineUsd: 1, extraUsd: 0.6 })).toBe('$0.52 extra')
  expect(netWords({ actualUsd: 1, baselineUsd: 1, extraUsd: 0 })).toBe('saved $0.00')
  expect(savedUsd({ actualUsd: 1.52, baselineUsd: 1, extraUsd: 0.6 }).toFixed(2)).toBe('0.08') // a cheap subagent under a dear turn
})

test('cost math and the cache-break test', async () => {
  const u = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(Math.round(costUsd('claude-haiku-5-5', { ...u, input_tokens: 100_000 }) * 1e6)).toBe(10_000) // at the 100K line: the short price
  expect(Math.round(costUsd('claude-haiku-5-5', u) * 1e6)).toBe(500_000) // a long prompt: Haiku's input costs 5x
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

function wire(on: any, opts: { batches?: Array<Array<Step>>; runFails?: boolean; store?: Map<string, unknown>; haiku?: string | ((e: { system?: string }) => string); tokens?: number; model?: string; messages?: Array<unknown>; ownClock?: boolean; sent: Array<unknown>; asked?: { n: number }; lines?: Array<string | undefined>; opened?: Array<unknown>; surfaces?: Array<string>; files?: Record<string, string>; models?: Array<string>; read?: number; write?: number; select?: (sql: string, params?: ReadonlyArray<unknown>) => Array<unknown>; argv?: Array<Array<string>>; nudges?: Array<{ text: string }>; window?: number; engineAt?: number; rateLimits?: Array<{ kind: string; percentUsed: number; resetsAt?: string }> }) {
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home' : undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: opts?.surfaces ?? ['desktop'] }))
  on('session.model', () => ({ value: opts.model ?? 'claude-opus-5-5' }))
  if (opts.messages) on('session.messages', () => ({ value: opts.messages }))
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
    opts.argv?.push(e.argv)
    if (opts.runFails) return { value: { exitCode: 1, stdout: '', stderr: 'no node', isStdoutTruncated: false, isStderrTruncated: false } }
    const steps = (JSON.parse(e.init?.stdin ?? '{}').steps ?? []) as Array<Step>
    opts.batches?.push(steps)
    return { value: { exitCode: 0, stdout: JSON.stringify(steps.map(x => (x.all ? (opts.select?.(x.sql, x.params) ?? []) : null))), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string; origin?: { kind: string } }) => { if (e.origin?.kind === 'plugin') opts.nudges?.push(e); return { text: e.text } })
  on('model.complete', (_: unknown, e: { system?: string }) => { opts.asked && opts.asked.n++; return { value: { isAnswered: true, text: (typeof opts.haiku === 'function' ? opts.haiku(e) : opts.haiku) ?? 'default 0.9', usage: USAGE } } })
  // tokens set = a chat already under way (no first-prompt pick); unset = a new chat
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: opts.window ?? 200_000, ...(opts.engineAt ? { breakdown: { autoCompactThreshold: opts.engineAt, rawMaxTokens: opts.window, autocompactSource: 'settings' } } : {}), ...(opts.tokens === undefined ? {} : { tokens: opts.tokens }) }, rateLimits: opts.rateLimits ?? [] } }))
  on('turn.step', async function* (_: unknown, e: { effort?: unknown; model: string; turnId: string; index: number }) {
    opts.sent.push(e.effort)
    opts.models?.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, cache_read_input_tokens: opts.read ?? 0, cache_creation_input_tokens: opts.write ?? 0, model: ({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-2' } as Record<string, string>)[e.model] ?? USAGE.model } }
  })
}

async function step($: any, effort: string, agentId?: string) {
  const st = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of st) { /* drain */ }
}

test('the system prompt asks the main model to hand lookups to subagents, once, only where it can', async (engine, on) => {
  const $ = engine as any
  wire(on, { sent: [] })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] })) // the engine's own sections
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ids = async (tools: string[]) => (await $.prompt.compose({ tools, model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], outputStyle: null, traits: [] })).sections.map((x: { id: string }) => x.id)
  const withAgent = await ids(['Read', 'Agent'])
  expect(withAgent.filter((id: string) => id === 'router:delegate').length).toBe(1)
  expect(withAgent.at(-1)).toBe('router:delegate')
  expect(await ids(['Read', 'Bash'])).not.toContain('router:delegate') // no way to start a subagent
  const text = (await $.prompt.compose({ tools: ['Agent'], model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], outputStyle: null, traits: [] })).sections.find((x: { id: string }) => x.id === 'router:delegate')
  expect(text.scope).toBe('session')
  expect(text.text).toContain('subagent')
})

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
  expect(lines[0]).toBe('route: mechanical · Haiku (auto) · effort low (picker high) · saved $0.00')
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

test("the main model's words in a brief win: its effort beats the tier, its model beats the pick", async (engine, on) => {
  const $ = engine as any
  const sent: Array<unknown> = []
  wire(on, { sent, files: { '/home/.claude/routing.json': ROUTING }, haiku: () => 'mechanical 0.95', tokens: 5_000 })
  const spawned: Array<string | undefined> = []
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: `sub${++n}` } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const spawn = (prompt: string, more = {}) => $.agent.spawn({ prompt, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', ...more })

  await spawn('Swap every variable called foo for bar across the utils folder. Use high effort.')
  await step($, 'low', 'sub1') // mechanical would be Haiku low; the brief asked high
  await spawn('Review this diff for bugs, at high effort', { model: 'opus' })
  await step($, 'low', 'sub2') // model on the call, effort in the brief: both kept
  await spawn('Swap every variable called baz for qux across the app folder, use opus')
  await step($, 'medium', 'sub3') // no effort asked: the engine's own

  expect(spawned).toEqual(['haiku', 'opus', 'opus'])
  expect(sent).toEqual(['high', 'high', 'medium'])
})

test('generic subagents go by their brief: sure and cheap moves, unsure gets the Sonnet default, a repeat climbs, workflow agents run as asked', async (engine, on) => {
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
  await step($, 'high', 'sub2') // unsure: a defined task, the subagent default (Sonnet high)
  reply = 'mechanical 0.95'
  await spawn('Swap every variable called foo for bar across the utils folder')
  await spawn('please review this PR for bugs and missing edge cases', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await spawn('Swap every variable called baz for qux across the app folder', { workflow: { runId: 'wf_1', agentIndex: 2 } })

  expect(spawned).toEqual(['haiku', 'sonnet', 'sonnet', undefined, undefined]) // repeat: Haiku -> Sonnet; a workflow's agents: as asked (the router steps aside)
  expect(sent).toEqual(['low', 'high'])
  await end($)
  // per run: [day, session, type, routed, respawned]; the brief itself is never stored
  const runs = rows(batches, 'spawns')
  expect(runs.map(r => r.slice(1))).toEqual([['sess-1', 'general-purpose', 1, 1, 0], ['sess-1', 'general-purpose', 1, 1, 0], ['sess-1', 'general-purpose', 1, 1, 1], ['sess-1', 'general-purpose', 1, 0, 0], ['sess-1', 'general-purpose', 1, 0, 0]])
  const spent = rows(batches, 'usage').filter(r => r[2] === 'general-purpose')
  expect(spent.length).toBe(3) // sub1's and sub2's steps, each under its type, and the repeat's take-back
  expect(spent.slice(0, 2).every(r => Number(r[5]) > 0)).toBe(true)
  // the repeat replaced sub1: its baseline goes and all it spent counts as extra, so it saved nothing (audit 2026-11-19)
  const [sub1, , back] = spent
  expect([back![4], back![5]]).toEqual([0, 0])
  expect(Number(back![6])).toBe(-Number(sub1![6]))
  expect(Number(back![7])).toBe(Number(sub1![5]) - Number(sub1![7]))
  expect(JSON.stringify(batches)).not.toContain('Swap every variable')
})

test('ultrathink and ultracode: the router steps aside for the turn and every agent under it, and only measures (owner case 2026-11-26)', async (engine, on) => {
  const $ = engine as any
  const sent: Array<unknown> = []
  const models: Array<string> = []
  const batches: Array<Array<Step>> = []
  const asked = { n: 0 }
  wire(on, { sent, models, batches, asked, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'mechanical 0.95' }) // a new chat: the first prompt picks Haiku for it
  const spawned: Array<string | undefined> = []
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: `sub${++n}` } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const spawn = (prompt: string, more = {}) => $.agent.spawn({ prompt, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', ...more })

  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  await step($, 'high') // routed: the chat's Haiku pick, low effort
  const calls = asked.n
  await $.prompt.submit({ text: 'ultrathink: swap every variable called foo for bar in the scripts folder' })
  expect(asked.n).toBe(calls) // no classifier on an aside turn
  await step($, 'high') // as the engine sent it: the picker's Opus, high
  await spawn('Swap every variable called foo for bar across the utils folder, use high effort') // sub1: as asked, the brief's words too
  await step($, 'medium', 'sub1')
  await spawn('Swap every variable called baz for qux across the app folder', { parentAgentId: 'sub1' }) // sub2, its child
  await $.prompt.submit({ text: 'ULTRACODE swap every variable called baz for qux in the app folder' })
  await step($, 'high')
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the docs folder' }) // a plain turn: routed again
  await step($, 'high')
  await spawn('Swap every variable called foo for bar across the docs folder') // sub3: routed
  await spawn('Swap every variable called foo for bar across the tests folder', { workflow: { runId: 'wf_9', agentIndex: 1 } }) // sub4
  await spawn('Swap every variable called foo for bar across the bin folder', { parentAgentId: 'sub4' }) // sub5, a workflow agent's child
  await end($)

  expect(models).toEqual(['haiku', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'haiku'])
  expect(sent).toEqual(['low', 'high', 'medium', 'high', 'low'])
  expect(spawned).toEqual([undefined, undefined, 'haiku', undefined, undefined])
  // measured all the same: an aside step's no-router cost is what it spent, nothing saved, nothing extra
  const aside = rows(batches, 'usage').filter(r => r[2] !== 'router').filter((_, i) => i === 1 || i === 2 || i === 3)
  expect(aside.map(r => [r[2], r[3]])).toEqual([['main', 'opus'], ['general-purpose', 'opus'], ['main', 'opus']])
  expect(aside.every(r => Number(r[5]) > 0 && r[6] === r[5] && r[7] === 0)).toBe(true)
})

test('an aside turn keeps the model and effort you picked in Settings, and its baseline is what ran (owner case 2026-11-26)', async (engine, on) => {
  const $ = engine as any
  const models: Array<string> = []
  const sent: Array<unknown> = []
  const batches: Array<Array<Step>> = []
  wire(on, { sent, models, batches, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'mechanical 0.95', tokens: 5_000 })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-model-sonnet' })
  await band.press({ key: 'router-effort-low' })
  await $.prompt.submit({ text: 'ultrathink about why the retry loop never ends' })
  await step($, 'max') // the engine's own ultrathink effort: kept, not lowered to your Settings pick
  await band.unmount()
  await end($)
  expect(models).toEqual(['sonnet'])
  expect(sent).toEqual(['max'])
  const main = rows(batches, 'usage').filter(r => r[2] === 'main')
  expect(main.map(r => [r[3], r[6] === r[5], r[7]])).toEqual([['sonnet', true, 0]])
})

test('paste size: tokens counted per character kind, the skip words, and which model reads it (docs/PLAN-v3.md, slice 3)', () => {
  expect([estTokens('a'.repeat(40_000)), estTokens('a'.repeat(40_001)), estTokens('я'.repeat(20_000)), estTokens('я'.repeat(20_000) + 'a')]).toEqual([10_000, 10_001, 10_000, 10_001])
  const log = 'line of the build log\n'.repeat(2_000) // about 11K tokens
  expect(keepsRaw(`keep it as is please\n${log}`)).toBe(true)
  expect(keepsRaw(`${log}\nraw: what fails here?`)).toBe(true)
  expect(keepsRaw(`${log.slice(0, 20_000)} raw ${log}`)).toBe(false) // a word inside the paste is not the person's
  expect(pasteModel(`Find the first error\n${log}`)).toBe('haiku')
  expect(pasteModel(`Review this log and recommend a fix\n${log}`)).toBe('sonnet')
  expect(pasteModel(`Find the first error\n${log.repeat(5)}`)).toBe('sonnet') // over 50K tokens
  const out = offloaded(`Find the first error\n${log}`, '/home/.claude/router/pastes/s-1.txt', 'haiku', 'Request: "Find the first error"\nAnalysis: none found')
  expect(out).toMatch(/^\[router: your message was about 11K tokens, so Haiku read it first\. The full text is saved at \/home\/\.claude\/router\/pastes\/s-1\.txt/)
  expect(out).toContain('Find the first error')
  expect(out).toContain('Analysis: none found')
  expect(out.length < 2_000).toBe(true)
})

test('a big paste is saved to a file and the chat gets a cheaper model\'s analysis; "raw" and failures pass it unchanged', async (engine, on) => {
  const $ = engine as any
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  const batches: Array<Array<Step>> = []
  const argv: Array<Array<string>> = []
  const asked: Array<string> = []
  let analysis: string | undefined = 'Request: "Find why the build fails"\nAnalysis: line 812, error TS2345'
  wire(on, { sent: [], files, batches, argv, tokens: 5_000, ownClock: true, haiku: (e: any) => (e.system === pasteSystem ? (asked.push(e.model), analysis ?? '') : 'engineering 0.95') })
  mock.clock(on, { now: 7_000 })
  const toasts: Array<string> = []
  on('ui.toast', (_: unknown, e: { text?: string; message?: string }) => { toasts.push(String(e.text ?? e.message ?? '')); return { value: undefined } })
  on('tool.call', () => ({ result: { content: 'ok' } }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const log = 'step 1234 compiled ok\n'.repeat(2_000)
  const big = `Find why the build fails in this log:\n${log}`
  const sendIt = async (text: string, more = {}) => (await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...more })).text as string

  const got = await sendIt(big)
  const path = '/home/.claude/router/pastes/sess-1-7000.txt'
  expect(files[path]).toBe(big) // the whole message, kept for a later Read
  expect(asked).toEqual(['haiku'])
  expect(got).toContain('line 812, error TS2345')
  expect(got).toContain(path)
  expect(got).toContain('Find why the build fails in this log:')
  expect(got.length < 3_000).toBe(true)
  expect(await sendIt(`raw\n${log}`)).toBe(`raw\n${log}`)
  expect(await sendIt(big, { origin: { kind: 'task-notification' } })).toBe(big) // not the person's own message
  expect(await sendIt(log.slice(0, 40_000))).toBe(log.slice(0, 40_000)) // 10K tokens exactly: not over the line
  analysis = undefined // the reader failed: the message goes through as typed, with a note
  expect(await sendIt(`What is wrong here?\n${log}`)).toBe(`What is wrong here?\n${log}`)
  expect(toasts.some(t => /sent as typed/.test(t))).toBe(true)
  expect(asked.length).toBe(2)

  // the main model reading the saved file means the analysis fell short: that paste saved nothing
  await $.tool.call({ tool: 'Read', file_path: 'C:\\home\\.claude\\router\\pastes\\sess-1-7000.txt' })
  await $.tool.call({ tool: 'Read', file_path: path }) // counted once
  await end($)
  const paste = rows(batches, 'usage').filter(r => r[2] === 'paste')
  expect(paste.length).toBe(2)
  expect(Number(paste[0]![6]) > Number(paste[0]![5])).toBe(true) // Opus writing 11K tokens once costs more than Haiku reading them
  expect(Number(paste[1]![6])).toBe(-Number(paste[0]![6]))
  // the session's saved pastes are deleted at its end
  expect(argv.some(a => a[0] === 'node' && a.includes('/home/.claude/router/pastes') && a.includes('sess-1-'))).toBe(true)
})

test('size buckets: what the brief names sets the model and budget of the router\'s own agents (docs/PLAN-v3.md, slice 2)', () => {
  // paths: bare with a folder or a real extension, quoted with spaces; URLs and "e.g." are not paths
  expect(briefPaths('Read src/app.ts and "C:/My Docs/notes.md", e.g. the intro. See https://x.dev/a.html and README.md.')).toEqual(['C:/My Docs/notes.md', 'src/app.ts', 'README.md'])
  expect(sizeOf('summarize it https://a.dev https://b.dev', 0)).toEqual({ tokens: 10, urls: 2, judgment: false })
  expect(sizeOf('compare the two plans', undefined)).toEqual({ tokens: undefined, urls: 0, judgment: true })
  const reader = (tokens: number | undefined, judgment = false) => bucket('reader', { tokens, urls: 0, judgment }).model
  expect([reader(50_000), reader(50_001), reader(undefined), reader(1_000, true)]).toEqual(['haiku', 'sonnet', 'sonnet', 'sonnet'])
  const web = (urls: number, judgment = false) => bucket('web', { tokens: 100, urls, judgment }).model
  expect([web(0), web(3), web(4), web(1, true)]).toEqual(['haiku', 'haiku', 'sonnet', 'sonnet'])
  expect(bucket('web', { tokens: 100, urls: 0, judgment: false }).cap).toMatch(/at most 4 searches and 6 page fetches/)
  expect(bucket('web', { tokens: 100, urls: 2, judgment: false }).cap).toMatch(/only the pages named/)
})

test('the router\'s own reader and researcher run on the model their brief\'s size calls for, with a budget; your model on the call wins', async (engine, on) => {
  const $ = engine as any
  const sent: Array<unknown> = []
  const batches: Array<Array<Step>> = []
  wire(on, { sent, batches, files: { '/home/.claude/routing.json': ROUTING }, tokens: 5_000 })
  const sizes: Record<string, number> = { '/proj/logs/small.log': 40_000, '/proj/logs/big.log': 800_000 }
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const p = e.path.replace(/\\/g, '/').replace(/^[A-Z]:/, '')
    if (!(p in sizes)) throw new Error('no such file')
    return { value: { kind: 'file' as const, size: sizes[p]!, mtimeMs: 0, isLink: false } }
  })
  const spawned: Array<{ model?: string; prompt: string }> = []
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string; prompt: string }) => { spawned.push({ model: e.model, prompt: e.prompt }); return { model: e.model ?? 'inherit', agentId: `sub${++n}` } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const spawn = (subagentType: string, prompt: string, more = {}) => $.agent.spawn({ prompt, subagentType, parentModel: 'claude-opus-5-5', ...more })

  await spawn('router:document-reader', 'Find every timeout error in logs/small.log and list the times')
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'haiku', effort: 'medium', messageCount: 1, agentId: 'sub1' })) { /* drain */ }
  await spawn('router:document-reader', 'Find every timeout error in logs/big.log and list the times')
  await spawn('router:document-reader', 'Find the timeouts in logs/missing.log') // size unknown: the agent's own model
  await spawn('router:web-researcher', 'Find the current price of the Team plan on https://example.com/pricing')
  await spawn('router:web-researcher', 'Compare the three hosting offers and recommend one')
  await spawn('router:web-researcher', 'Look up the release date', { model: 'opus' }) // the main model's pick wins

  expect(spawned.map(x => x.model)).toEqual(['haiku', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'opus'])
  expect(spawned[0]!.prompt).toMatch(/^Find every timeout error in logs\/small\.log and list the times\n\nBudget: /)
  expect(spawned[3]!.prompt).toMatch(/only the pages named/)
  expect(spawned[5]!.prompt).toBe('Look up the release date')
  await end($)
  // with no router the main model would have run the job on its own model: the Haiku run is measured against Opus
  const run = rows(batches, 'usage').find(r => r[2] === 'router:document-reader')!
  expect(Number(run[6]) > Number(run[5])).toBe(true)
  expect(rows(batches, 'spawns').filter(r => r[2] === 'router:document-reader').map(r => r[3])).toEqual([1, 1, 1])
})

test('subagents: a Haiku move needs two sure samples; rules raise a table type; unsure keeps the main default unless you chose the model', async (engine, on) => {
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

  await spawn('Swap every variable called foo for bar across the utils folder') // disagree: not Haiku, the Sonnet default
  replies = ['mechanical 0.95']
  await spawn('Swap every variable called baz for qux across the app folder') // agree: Haiku
  await spawn('Find out why the payments service crashes on startup', { subagentType: 'Explore', parentModel: 'claude-sonnet-5-5' }) // Explore's Haiku, raised by the debugging rule
  replies = ['mechanical 0.5']
  await spawn('Look into the nightly export job and the numbers it sends', { parentModel: 'claude-sonnet-5-5' }) // unsure on a Sonnet parent: the main default
  expect(spawned).toEqual(['sonnet', 'haiku', 'opus', 'opus'])

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

test('"use opus" on an Opus chat keeps a sure quick task on Opus (audit 2026-11-19)', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'mechanical 0.95', tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module' })
  await step($, 'medium') // a sure quick task: its own turn on Haiku
  await $.prompt.submit({ text: 'use opus: swap every variable called baz for qux in the utils module' })
  await step($, 'medium')
  expect(models).toEqual(['haiku', 'claude-opus-5-5'])
})

test('a nested agent is measured against its parent\'s no-router model, not the parent\'s routed one', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], batches, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'mechanical 0.95', tokens: 5_000 })
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: `sub${++n}` }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Swap every variable called foo for bar across the utils folder', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' }) // sub1: Haiku
  await $.agent.spawn({ prompt: 'please review this PR for bugs and missing edge cases', subagentType: 'general-purpose', parentModel: 'claude-haiku-5-5', parentAgentId: 'sub1' }) // sub2: back up to Opus
  await step($, 'medium', 'sub2')
  await end($)
  const sub2 = rows(batches, 'usage').find(r => r[2] === 'general-purpose')!
  // with no router sub1 ran on Opus, so its child is priced on Opus; only the review's raised effort (high) is extra,
  // not the gap to a Haiku parent the person never chose
  expect(Math.round(Number(sub2[6]) * 1e9)).toBe(Math.round((Number(sub2[5]) / 1.4) * 1e9))
})

test('the moved-subagent memory is saved per session in the store', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const store = new Map<string, unknown>()
  wire(on, { sent: [], batches: [], store, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'mechanical 0.95', tokens: 5_000 })
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: 'sub1' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Swap every variable called foo for bar across the utils folder', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' })
  await end($)
  const kept = store.get('agents:sess-1') as { asked: Array<[string, string]>; type: Array<[string, string]> }
  expect(kept.asked).toEqual([['sub1', 'opus']])
  expect(kept.type).toEqual([['sub1', 'general-purpose']])
  expect(store.get('agents')).toEqual([['sess-1', 1_000]])
})

test('after a restart a moved subagent is still measured against the model it was moved from', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const batches: Array<Array<Step>> = []
  // what the process before the restart left in the store
  const stats = { tally: { actualUsd: 5, baselineUsd: 6, extraUsd: 0 }, log: [], mix: { 'opus:medium': { usd: 5, steps: 3, cache: { input: 1, read: 8, write: 1 } } } }
  const store = new Map<string, unknown>([['agents:sess-1', { at: 1, asked: [['sub1', 'opus']], type: [['sub1', 'general-purpose']], stats }]])
  wire(on, { sent: [], batches, store, files: { '/home/.claude/routing.json': ROUTING }, tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'haiku', effort: 'medium', messageCount: 1, agentId: 'sub1' })) { /* drain */ }
  await end($)
  const row = rows(batches, 'usage').find(r => r[2] === 'general-purpose')!
  expect(row[3]).toBe('haiku')
  expect(Number(row[6])).toBeGreaterThan(Number(row[5]) * 10) // [5] spent, [6] no router: priced on Opus, not on Haiku
  expect(row.slice(8)).toEqual([USAGE.input_tokens, 0, 0]) // prompt tokens: uncached, read, written
  // the chat's Stats carried on from before the restart
  const kept = store.get('agents:sess-1') as { stats: { tally: { actualUsd: number }; mix: Record<string, { steps: number }> } }
  expect(kept.stats.tally.actualUsd).toBeGreaterThan(5)
  expect(Object.keys(kept.stats.mix)).toEqual(['opus:medium', 'haiku:medium'])
})

test('a chat from before the model band gets its band from the turn log', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const row = { id: 't1', who: 'main', cls: 'message', model: 'sonnet', effort: 'medium', picker: 'medium', usd: 0.2, baseUsd: 0.4, steps: 2 }
  const store = new Map<string, unknown>([['agents:sess-1', { at: 1, stats: { tally: { actualUsd: 0.2, baselineUsd: 0.4, extraUsd: 0 }, log: [row] } }]])
  wire(on, { sent: [], batches: [], store, files: { '/home/.claude/routing.json': ROUTING }, tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await end($)
  const kept = store.get('agents:sess-1') as { stats: { mix: Record<string, { usd: number; steps: number }> } }
  expect(kept.stats.mix).toEqual({ 'sonnet:medium': { usd: 0.2, steps: 2, cache: { input: 0, read: 0, write: 0 } } })
})

test('a main-thread step pays the 1-hour cache write, a subagent step the 5-minute one', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], batches, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'default 0.9', write: 1_000_000, tokens: 5_000 })
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: 'sub1' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await $.agent.spawn({ prompt: 'x', subagentType: 'Explore', parentModel: 'claude-opus-5-5', model: 'opus' })
  await step($, 'medium', 'sub1')
  await end($)
  const usd = (who: string) => Math.round(Number(rows(batches, 'usage').find(r => r[2] === who)![5]))
  expect(usd('main')).toBe(8) // $8 per M on Opus
  expect(usd('Explore')).toBe(5) // $5 per M
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
  const b = { day: '2026-11-18', project: evil, session: 's', label: evil, first: 1, last: 2, turns: 1, byModel: { opus: { usd: 1, base: 2, extra: 0, steps: 1 } }, agents: { [evil]: { runs: 1, routed: 0, respawned: 0, usd: 0, base: 0, extra: 0 } } }
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
  expect(await band.find({ type: 'Text', text: /fits this task better/ })).toBeFalsy() // the turn moved by itself: no tip
  expect(await band.find({ type: 'Svg' })).toBeFalsy()

  await band.press({ key: 'router-stats' })
  const card = await band.find({ type: 'Svg' })
  expect(card?.props.alt).toMatch(/This chat saved \$0\.00/)
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

test('routing turned on for the project in another session reaches this one: the band follows within seconds (owner case 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const files: Record<string, string> = { '/proj/.claude/routing.json': JSON.stringify({ mode: 'off' }) }
  wire(on, { sent: [], files, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: 'off in this project' })).toBeTruthy()
  files['/proj/.claude/routing.json'] = JSON.stringify({ mode: 'on' }) // another session's Settings wrote it
  await clock.advance(11_000)
  await band.unmount()
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' }) // a redraw notices the change and draws again
  await clock.advance(1_000)
  expect(await again.find({ type: 'Text', text: 'off in this project' })).toBeFalsy()
  await again.unmount()
  // and a prompt follows it at once, without waiting for a redraw
  files['/proj/.claude/routing.json'] = JSON.stringify({ mode: 'off' })
  await clock.advance(11_000)
  await $.prompt.submit({ text: 'please review this PR for bugs and missing edge cases', origin: { kind: 'composer' }, wait: false })
  const fourth = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await fourth.find({ type: 'Text', text: 'off in this project' })).toBeTruthy()
  await fourth.unmount()
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
  expect(await band.find({ type: 'Text', text: /fits this task better/ })).toBeFalsy()
  await $.prompt.submit({ text: 'Plan the migration of the whole billing service to the new ledger' }) // rare-hard -> Fable, above it
  expect(await band.find({ type: 'Text', text: /Fable fits this task better \(rare-hard\)/ })).toBeTruthy()
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
  // the first prompt's 3 classifier samples (who 'router', no baseline, all extra) and the 2 steps, moved to Haiku low by
  // itself; with no router they run on Opus at the picker's high effort
  const usage = rows(batches, 'usage')
  expect(usage.every(r => r[0] === day && r[1] === 'sess-1' && r[3] === 'haiku')).toBe(true)
  expect(usage.map(r => r[2])).toEqual(['router', 'router', 'router', 'main', 'main'])
  expect(usage.filter(r => r[2] === 'router').every(r => r[6] === 0 && r[7] === r[5])).toBe(true)
  const main = usage.find(r => r[2] === 'main')!
  expect(Math.round(Number(main[6]) * 1e8)).toBe(27222) // Opus, the whole step x 1.4/0.72 for high vs low: (10 x $4 + 5 x $20) per M
  expect(Math.round(Number(main[5]) * 1e8)).toBe(350) // $0.0000035 on Haiku
  expect(main[7]).toBe(0) // cheaper than with no router: nothing extra
  // the same steps by effort: low for the class, high with no router, why 'class'; money matches the usage rows
  const eff = rows(batches, 'efforts')
  expect(eff.map(r => r.slice(2, 8))).toEqual([['main', 'haiku', 'low', 'high', 'mechanical', 'class'], ['main', 'haiku', 'low', 'high', 'mechanical', 'class']])
  expect(eff.map(r => r[8])).toEqual([Number(main[5]), Number(main[5])])
  expect(eff.map(r => r[9])).toEqual([Number(main[6]), Number(main[6])])
  // the session's first batch trims the ledger: effort detail after 60 days, the rest after 400, sessions with no day
  const trim = batches.flat().filter(x => x.sql.startsWith('DELETE FROM'))
  expect(trim.map(x => x.sql.split(' ')[2])).toEqual(['efforts', 'usage', 'days', 'spawns', 'sessions'])
  const ago = (n: number) => { const t = new Date(1_000 - n * 86_400_000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
  expect(trim.map(x => x.params?.[0])).toEqual([ago(60), ago(400), ago(400), ago(400), undefined])
  // once per session, after the waiting rows
  const first = batches.findIndex(b => b.some(x => x.sql.startsWith('DELETE FROM')))
  expect(batches[first]!.findIndex(x => x.sql.startsWith('DELETE')) > batches[first]!.findIndex(x => x.sql.startsWith('INSERT INTO usage'))).toBe(true)
})

test('the effort ledger says why: an effort named in the prompt is booked as asked', async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], files: {}, batches, haiku: 'mechanical 0.95' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module, use high effort' })
  await step($, 'medium')
  await end($)
  const eff = rows(batches, 'efforts').filter(r => r[2] === 'main')
  expect(eff.at(-1)!.slice(4, 8)).toEqual(['high', 'high', 'mechanical', 'asked']) // named in the prompt: the person's, so asked too
})

test("a subagent the router moved to Haiku is measured against its parent's model", async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], files: { '/home/.claude/routing.json': ROUTING }, batches })
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: 'sub1' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'find where the config is loaded', parentModel: 'claude-opus-5-5', subagentType: 'Explore' })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'haiku', effort: 'medium', messageCount: 1, agentId: 'sub1' })) { /* drain */ }
  await end($)
  const row = rows(batches, 'usage').find(r => r[2] === 'Explore')!
  expect(row[3]).toBe('haiku')
  expect(Number(row[6]) / Number(row[5]) > 4).toBe(true) // Opus prices are 5x Haiku's; a Haiku baseline would give about 1
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
  expect(rows(opts.batches, 'usage')[0]).toEqual(['2026-11-17', 'old-1', 'main', 'opus', 7, 2, 2, 0, 0, 0, 0]) // 0.2 kept no prompt tokens
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
  expect((await widget.findAll({ type: 'Text' })).map((x: { text: string }) => x.text)).toEqual(['Routing', 'Haiku low (auto)', 'Saved this chat', '$0.00 · 97%'])
  await widget.unmount()

  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const card = await dock.find({ type: 'Svg' })
  expect(card?.props.alt).toMatch(/Spent this chat \$[0-9.]+, cache hit 0%/) // the stub steps read nothing from cache
  expect(card?.props.source).toContain('1 turn, 0 agents re-routed')
  expect(card?.props.source).toContain('class="m-haiku-0"') // the model band: this turn ran on Haiku at low effort
  await dock.unmount()
})

test('cache sheet and reasons: what losing the cache costs, and where saved and extra money went', () => {
  const sh = cacheSheet('claude-opus-5-5', 100_000)
  expect(sh.switches.map(x => [x.model, Math.round(x.usd * 100)])).toEqual([['haiku', 2], ['sonnet', 40], ['fable', 160]])
  expect(Math.round(sh.reset * 100)).toBe(80) // Opus writes 100K again at $8/M
  expect(Math.round(sh.compact * 100)).toBe(60) // reads 100K ($0.02), writes a 3K summary out ($0.06) and 65K back ($0.52)
  expect(Math.round(cacheSheet('opus', 30_000).compact * 1000)).toBe(306) // a small cache is written back whole
  // a keep-awake nudge: reads 100K ($0.02), a word out, and writes its own 150 tokens ($0.0012)
  expect(Math.round(sh.ping * 10000)).toBe(216)
  let by = addWhy(undefined, 'agents', 2, 0)
  by = addWhy(by, 'effort', 0, 0.1)
  by = addWhy(by, 'router', 0, 0.004) // under half a cent: not worth a word
  expect(whyWords(by)).toEqual({ value: 'Subagents', sub: 'saved $2.00 · +$0.10 effort' })
  expect(whyWords(addWhy(by, 'agents', -2, 1))).toEqual({ value: 'Nothing saved', sub: '+$1.00 subagents' }) // a take-back
  expect(whyWords(undefined).value).toBe('Nothing moved yet')
})

test('with a real cache the widget and the Stats card show its size, what losing it costs and what each switch costs', async (engine, on) => {
  const $ = engine as any
  wire(on, { sent: [], haiku: 'engineering 0.95', tokens: 100_000, read: 100_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'set up the release pipeline for the app' })
  await step($, 'medium')
  const widget = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget', anchoredEdges: [] }, surface: 'desktop' })
  const texts = (await widget.findAll({ type: 'Text' })).map((x: { text: string }) => x.text)
  expect(texts).toContain('Cache')
  expect(texts).toContain('100K · losing it $0.80')
  expect(texts).toContain('Haiku $0.10, Sonnet $0.40, Fable $1.60') // just over 100K: Haiku's long-prompt price, x5
  await widget.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-stats' })
  const card = await band.find({ type: 'Svg' })
  expect(card?.props.alt).toContain('Cache 100K tokens, warm 60 min · rebuild $0.80')
  expect([cacheClock(0, 5), cacheClock(1_000, 1_000 + 20 * 60_000), cacheClock(1_000, 1_000 + 61 * 60_000), minutesLeft(1_000, 1_000 + 20 * 60_000, 50)]).toEqual(['', 'warm 40 min', 'expired', 30])
  expect(card?.props.alt).toMatch(/Where it went .*\+\$[0-9.]+ effort/) // engineering raised Opus to high
  expect(await band.find({ type: 'Text', text: /Switching model writes the chat once on the new one: Haiku \$0\.10, Sonnet \$0\.40, Fable \$1\.60\. Compacting: about \$0\.60\. Keeping it warm while you are away: about \$0\.02 a nudge/ })).toBeTruthy()
  await band.unmount()
})

test('Settings switches the saving features off and on; the choice is kept for later sessions', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  const spawned: Array<string | undefined> = []
  wire(on, { sent: [], files, store, tokens: 5_000, haiku: (e: any) => (e.system === pasteSystem ? 'Request: x\nAnalysis: y' : 'engineering 0.95') })
  on('agent.spawn', (_: unknown, e: { model?: string }) => { spawned.push(e.model); return { model: e.model ?? 'inherit', agentId: 'sub1' } })
  on('fs.stat', () => ({ value: { kind: 'file', size: 4_000, mtimeMs: 0, isLink: false } }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-f-pastes-off' })
  await band.press({ key: 'router-f-sizing-off' })
  const big = `Find the error\n${'step ok\n'.repeat(6_000)}`
  expect((await $.prompt.submit({ text: big, origin: { kind: 'composer' }, wait: false })).text).toBe(big)
  await $.agent.spawn({ prompt: 'Find the timeouts in logs/a.log', subagentType: 'router:document-reader', parentModel: 'claude-opus-5-5' })
  expect(spawned).toEqual([undefined]) // the agent's own model, no sizing
  expect(store.get('features')).toEqual({ autoSwitch: true, sizing: false, pastes: false, awake: true })
  await band.press({ key: 'router-f-pastes-on' })
  expect((await $.prompt.submit({ text: big, origin: { kind: 'composer' }, wait: false })).text).not.toBe(big)
  await band.unmount()
})

test('after the cache lapsed: resuming re-reads the whole chat; compacting first costs the kept part and a summary, and pays back per step', () => {
  const c = (x: number) => Math.round(x * 1000) // tenths of a cent
  // Opus: 1-hour write $8/M, read $0.20/M, output $20/M. 200K resumed = $1.60; compacting first writes a 3K summary
  // ($0.06) and 65K back ($0.52); each later step reads 135K less = $0.027, so it pays back in 22 steps
  const m = coldMath('opus', 200_000)
  expect([c(m.resume), c(m.extra), c(m.perStep), m.payback, m.pays]).toEqual([1600, 580, 27, 22, true])
  expect(coldMath('opus', 120_000).pays).toBe(false) // 55K less a step pays back only after 53 steps
  expect(coldMath('opus', 60_000).pays).toBe(false) // already smaller than a compacted chat
})

test('keep-awake decides: nudge before the hour, compact when the window ends, offer once the cache lapsed or when off or small', () => {
  const m = 60_000
  const at = { on: true, lastStep: 0, since: 0, hours: 2, cache: 200_000 }
  expect(awakeNext({ ...at, now: 50 * m })).toBe('ping') // 50 + 50 minutes still inside 2 hours
  expect(awakeNext({ ...at, now: 100 * m, lastStep: 50 * m })).toBe('compact') // the next nudge would land past 2 hours
  expect(awakeNext({ ...at, now: 70 * m, lastStep: 0 })).toBe('cold') // the timer ran late (the machine slept): the cache is gone
  expect(awakeNext({ ...at, now: 50 * m, on: false })).toBe('cold')
  expect(awakeNext({ ...at, now: 50 * m, cache: 15_000 })).toBe('cold') // a rebuild costs cents
})

// Someone who comes back within the afternoon and leaves chats overnight (local time)
function habits(days = 22): { gaps: Array<Gap>; now: number } {
  const at = (d: number, h: number, min = 0) => new Date(2026, 9, 1 + d, h, min).getTime()
  const gaps: Array<Gap> = []
  for (let d = 0; d < days; d++) {
    gaps.push({ s: `day${d}`, start: at(d, 13), end: at(d, 15, 10) }) // back after about 2 hours
    gaps.push({ s: `night${d}`, start: at(d, 0, 30), end: d % 4 ? null : at(d, 12, 40) }) // 1 in 4 picked up after noon; the rest left for a new chat
  }
  gaps.push({ s: 'left', start: at(days, 23), end: null }) // still open
  return { gaps, now: at(days + 1, 12) }
}

test('keep awake learns when people come back: an afternoon nudge pays, a 1 a.m. one does not (owner case 2026-11-25)', () => {
  const { gaps, now } = habits()
  const curve = returnCurve(gaps, now)!
  const day = new Date(now), at = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0).getTime()
  expect(curve[15]! > curve[3]! * 5).toBe(true)
  expect(curve[15]! > curve[14]! * 5).toBe(true) // a 15:10 return counts in the 15:00 hour, not the hour its 50-minute chunk began (review 2026-11-25)
  expect(Math.round(writeOverRead('claude-opus-5-5'))).toBe(40)
  expect(nudgePays(curve, at(14), 14, 40)).toBe(true)
  expect(nudgePays(curve, at(1) + 15 * 60_000, 14, 40)).toBe(false) // a night of nudges for a 1-in-4 chance at noon costs more than the rebuild
  expect(nudgePays(curve, at(14), 0, 40)).toBe(false) // no nudges left in the window
  expect(nudgePays(curve, at(1) + 15 * 60_000, 28, 80)).toBe(true) // on Fable, with a 24-hour window, the night pays: a rebuild is twice as dear
  expect(backAtAll(curve.map(() => 0), at(1))).toBe(0)
  expect(backAtAll(curve.map(() => 0.5), at(1)) > 0.99).toBe(true)
  expect(returnCurve(habits(9).gaps, now)).toBe(null) // under 20 closed gaps: the fixed window stays
})

test('keep awake: a finished chat gets no nudge; its idle gap is kept, a notification does not close it, your own message does (owner case 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const nudges: Array<{ text: string }> = []
  const messages = [{ role: 'user', text: 'great, thanks, that is all for today', toolUses: [] }, { role: 'assistant', text: 'Done: pushed and released. Nothing left to do.', toolUses: [] }]
  wire(on, { sent: [], nudges, store, messages, haiku: 'done 0.95', files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(0) // Haiku read it as finished: nothing to keep warm
  const gaps = () => store.get('gaps') as Array<Gap>
  expect(gaps()).toEqual([{ s: 'sess-1', start: 1_000, end: null }])
  await $.prompt.submit({ text: '<task-notification>done</task-notification>', isMeta: true, wait: false })
  await step($, 'medium')
  expect(gaps()[0]!.end).toBe(null) // a notification is not the person coming back
  await clock.advance(600_000)
  await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' }, wait: false })
  await step($, 'medium')
  expect(gaps()).toEqual([{ s: 'sess-1', start: 1_000, end: 3_601_000 }])
})

test('keep awake stops when, by past gaps, a return is too unlikely to pay; "Stop for this chat" stops it too', async (engine, on) => {
  const $ = engine as any
  const nudges: Array<{ text: string }> = []
  // people who left chats idle came back only after about 40 hours: nudging through the window cannot pay
  const store = new Map<string, unknown>([['gaps', Array.from({ length: 25 }, (_, i) => ({ s: `old${i}`, start: i * 86_400_000, end: i * 86_400_000 + 40 * 3_600_000 }))]])
  wire(on, { sent: [], nudges, store, files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 40 * 86_400_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(0)
  // with no history the fixed window nudges; the away report's button turns it off for this chat
  store.set('gaps', [])
  await $.prompt.submit({ text: 'back again', origin: { kind: 'composer' }, wait: false })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(1)
  await step($, 'medium') // the nudge's turn
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-away-stop' })
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(1)
  await band.unmount()
})

test('keep awake: a stopped chat still gets the compact-first offer once the cache lapses (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const nudges: Array<{ text: string }> = []
  const messages = [{ role: 'user', text: 'thanks, that is all', toolUses: [] }, { role: 'assistant', text: 'Done. Nothing left.', toolUses: [] }]
  wire(on, { sent: [], nudges, store: new Map(), messages, haiku: 'done 0.95', files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(0)
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy() // the cache is still warm
  await clock.advance(700_000)
  expect(await band.find({ key: 'router-cold-compact' })).toBeTruthy()
  await band.unmount()
})

test('keep awake: a slash command of yours ends the idle gap, a notification does not (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const messages = [{ role: 'user', text: 'thanks, that is all', toolUses: [] }, { role: 'assistant', text: 'Done.', toolUses: [] }]
  wire(on, { sent: [], nudges: [], store, messages, haiku: 'done 0.95', files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await clock.advance(3_600_000)
  await $.prompt.submit({ text: '/review', command: 'review', origin: { kind: 'composer' }, wait: false })
  await step($, 'medium')
  expect((store.get('gaps') as Array<Gap>)[0]!.end).toBe(3_601_000)
})

test('keep awake: an unlikely-back stop with no nudge compacts as a handoff and the report says it sent none (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const nudges: Array<{ text: string }> = []
  const compacted: Array<unknown> = []
  // people come back after about 20 hours: past the 12-hour window, so nudges cannot pay, but a warm handoff does
  const store = new Map<string, unknown>([['gaps', Array.from({ length: 25 }, (_, i) => ({ s: `old${i}`, start: i * 86_400_000, end: i * 86_400_000 + 20 * 3_600_000 }))]])
  wire(on, { sent: [], nudges, store, files: {}, read: 600_000, write: 0, ownClock: true })
  on('session.compact', (_: unknown, e: unknown) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  const clock = mock.clock(on, { now: 40 * 86_400_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(0)
  expect(compacted.length).toBe(1)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /sent no nudges: a return at these hours is too unlikely.*compacted the chat into a handoff/ })).toBeTruthy()
  await band.unmount()
})

test('units: the week starts at its reset time, not at the start of that day (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const reset = new Date(2026, 10, 30, 18, 0).getTime()
  const start = reset - 7 * 86_400_000
  // this machine saw the last window, and the ledger held $500 when the new one began; $506 now, $56 on its first day
  const store = new Map<string, unknown>([['planStart', { at: Math.round(start / 3_600_000), total: 500, isExact: true }]])
  wire(on, { sent: [], files: {}, store, rateLimits: [{ kind: 'seven_day', percentUsed: 3, resetsAt: new Date(reset).toISOString() }], select: (sql, p) => (/SUM\(usd\)/.test(sql) ? [{ usd: p?.[0] === '' ? 506 : 56 }] : []) })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-stats' })
  expect((await band.find({ type: 'Svg' }))?.props.alt).toMatch(/1% ≈ \$2\.00/) // $6 since the reset over 3 points, not $56
  await band.unmount()
  // a new window: the ledger's total then becomes its zero
  expect((store.get('planStart') as { total: number }).total).toBe(500)
})

test('units: % of the plan comes from this week\'s spend over its percent, and only once both are big enough to trust', () => {
  expect(planRate(40, 10)).toBe(4) // $40 moved the week 10 points: $4 a point
  expect(planRate(40, 2)).toBe(undefined) // too few points to trust
  expect(planRate(2, 10)).toBe(undefined)
  expect(planFmt(4)(1)).toBe('≈0.3% of week')
  expect(planFmt(40)(1)).toBe('≈0.03% of week') // small shares keep two decimals
  expect(planFmt(4)(12)).toBe('≈3.0% of week')
  expect(netWords({ actualUsd: 10, baselineUsd: 14, extraUsd: 0 }, planFmt(4))).toBe('saved ≈1.0% of week')
})

test('units: the plan\'s real usage shows in Stats, and Plan % turns the band\'s saving into a share of the week (owner ask 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const reset = new Date(2026, 10, 30, 10, 0).toISOString()
  wire(on, { sent: [], files: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 20, resetsAt: reset }, { kind: 'five_hour', percentUsed: 7 }], select: sql => (/SUM\(usd\)/.test(sql) ? [{ usd: 80 }] : []) })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-stats' })
  const card = await band.find({ type: 'Svg' })
  expect(card?.props.alt).toMatch(/Plan week 20%/)
  expect(card?.props.alt).toMatch(/5h 7% · 1% ≈ \$4\.00/) // $80 this week over 20 points
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-units-plan' })
  expect(await band.find({ type: 'Text', text: /% of week/ })).toBeTruthy()
  await band.press({ key: 'router-units-usd' })
  expect(await band.find({ type: 'Text', text: /% of week/ })).toBeFalsy()
  await band.unmount()
})

test('keep awake reads a finished chat as done only when Haiku is sure', () => {
  expect(parseDone('done 0.9')).toBe(true)
  expect(parseDone('done 0.6')).toBe(false)
  expect(parseDone('open 0.95')).toBe(false)
  expect(parseDone('I think it is done')).toBe(false)
})

test('keep awake: a nudge every 50 minutes at low effort on the same model, booked as extra; coming back books the rebuild it avoided', async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  const sent: Array<unknown> = []
  const models: Array<string> = []
  const asked = { n: 0 }
  const nudges: Array<{ text: string; origin?: { kind: string; name?: string } }> = []
  wire(on, { sent, models, asked, batches, nudges, files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await clock.advance(2_900_000)
  expect(nudges.length).toBe(0)
  await clock.advance(100_000) // 50 minutes after the last step
  expect(nudges.length).toBe(1)
  expect(nudges[0]!.text).toBe(AWAKE_TEXT)
  expect(asked.n).toBe(0) // no classifier, no mood check on a nudge
  await step($, 'medium') // the nudge's turn
  expect(sent.at(-1)).toBe('low')
  expect(models.at(-1)).toBe('claude-opus-5-5') // never another model: that would rebuild the cache
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(2)
  await step($, 'medium')
  expect(await band.find({ type: 'Text', text: /kept this chat's cache warm: 2 nudges, \$0\.08 so far, against about \$1\.60/ })).toBeTruthy()
  // you come back after 1h40 with no router the cache would have lapsed: your step would have written 200K again
  await $.prompt.submit({ text: 'ok, where were we', origin: { kind: 'composer' }, wait: false })
  await step($, 'medium')
  expect(sent.at(-1)).not.toBe('low')
  // the report stays through your first turn back, with what it saved; your next message clears it
  expect(await band.find({ type: 'Text', text: /2 nudges for \$0\.08, saving about \$1\.56 of re-reading it all/ })).toBeTruthy()
  await $.prompt.submit({ text: 'next thing', origin: { kind: 'composer' }, wait: false })
  expect(await band.find({ type: 'Text', text: /While you were away/ })).toBeFalsy() // (a key lookup never matched: it proved nothing)
  await end($)
  const u = rows(batches, 'usage').filter(r => r[2] === 'awake')
  const cents = (x: unknown) => Math.round(Number(x) * 10000) / 100
  expect(u.map(r => [cents(r[5]), cents(r[6]), cents(r[7])])).toEqual([[4.01, 0, 4.01], [4.01, 0, 4.01], [0, 156, 0]]) // two nudges as they really ran (200K read, 10 in, 5 out), then $1.60 - $0.04 avoided
  expect(rows(batches, 'efforts').filter(r => r[2] === 'awake').map(r => [r[4], r[7]])).toEqual([['low', 'nudge'], ['low', 'nudge']]) // the avoided rebuild is no step
  await band.unmount()
})

test('keep awake: a turn after the nudge that no prompt of yours started (a notification) is not booked as a nudge (owner case 2026-11-25: "1 nudge, $1.03")', async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  const nudges: Array<{ text: string }> = []
  wire(on, { sent: [], batches, nudges, files: {}, read: 200_000, write: 0, ownClock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(1)
  await $.turn.start({ turnId: 'n', text: AWAKE_TEXT })
  await step($, 'medium') // the nudge's own step
  await $.turn.complete({ turnId: 'n', reason: 'answer', answer: 'cache warm' })
  // a background task's notification starts a turn: a meta prompt, which returns before the prompt hook's bookkeeping
  await $.prompt.submit({ text: '<task-notification>done</task-notification>', isMeta: true, wait: false })
  await $.turn.start({ turnId: 'm', text: '' })
  await step($, 'medium')
  await step($, 'medium')
  await $.turn.complete({ turnId: 'm', reason: 'answer', answer: '' })
  await end($)
  const who = rows(batches, 'usage').map(r => r[2])
  expect(who.filter(w => w === 'awake').length).toBe(1) // the nudge's step only
  expect(await band.find({ type: 'Text', text: /1 nudge(?!s)/ })).toBeTruthy()
  await band.unmount()
})

test('keep awake waits while a turn is open (a question waiting on you), and its nudge and reply draw nothing', async (engine, on) => {
  const $ = engine as any
  const nudges: Array<{ text: string }> = []
  wire(on, { sent: [], nudges, files: {}, read: 200_000, write: 0, ownClock: true })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 'q', text: 'pick one' })
  await step($, 'medium') // the step that asked the question; the turn stays open while you are away
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(0)
  await $.turn.complete({ turnId: 'q', reason: 'answer', answer: '' })
  await step($, 'medium')
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(1)
  const row = await $.ui.mount({ plugin: 'router', component: 'UserMessage', surface: 'desktop', props: { text: AWAKE_TEXT, origin: { kind: 'plugin', name: 'router' }, isExpanded: false } })
  expect(await row.find({ type: 'Box' })).toBeTruthy() // our empty row, not the engine's
  expect(await row.find({ type: 'Text' })).toBeFalsy()
  await row.unmount()
  expect([isNudgeReply('cache warm'), isNudgeReply(' Cache warm.\n'), isNudgeReply('the cache warm-up failed')]).toEqual([true, true, false])
})

test('keep awake ends after the hours you set: the chat is compacted while warm into a handoff, and the nudges stop', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const compacted: Array<{ instructions?: string }> = []
  const nudges: Array<{ text: string }> = []
  wire(on, { sent: [], store, nudges, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('session.compact', (_: unknown, e: { instructions?: string }) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-awake-hours-2' })
  await band.press({ key: 'router-settings' })
  expect(store.get('awakeHours')).toBe(2)
  await step($, 'medium')
  await clock.advance(3_000_000)
  await step($, 'medium') // the one nudge that fits in 2 hours
  await clock.advance(3_000_000)
  expect(nudges.length).toBe(1)
  expect(compacted.length).toBe(1)
  expect(compacted[0]!.instructions).toContain('continuation message')
  expect(await band.find({ type: 'Text', text: /warm for 2 hours \(1 nudge, \$0\.04\), then compacted it into a handoff/ })).toBeTruthy()
  await clock.advance(7_200_000)
  expect(nudges.length).toBe(1)
  await band.unmount()
})

test('the away window counts from your last step, not a nudge; back within the hour of your last step books no saving', async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  const nudges: Array<{ text: string }> = []
  const compacted: Array<unknown> = []
  wire(on, { sent: [], batches, nudges, files: {}, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('session.compact', (_: unknown, e: unknown) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-awake-hours-2' })
  await band.press({ key: 'router-settings' })
  await step($, 'medium')
  await clock.advance(2_400_000)
  await step($, 'medium') // you work on: 40 and 80 minutes in
  await clock.advance(2_400_000)
  await step($, 'medium')
  await clock.advance(3_000_000) // 50 minutes after your last step: inside the 2 hours counted from it, so a nudge
  expect(nudges.length).toBe(1)
  await step($, 'medium')
  await clock.advance(300_000) // back 55 minutes after your last step: with no router the cache was still warm
  await $.prompt.submit({ text: 'next bit', origin: { kind: 'composer' }, wait: false })
  await step($, 'medium')
  await clock.advance(3_000_000) // the window starts again at this step
  expect([nudges.length, compacted.length]).toEqual([2, 0])
  await end($)
  expect(rows(batches, 'usage').filter(r => r[2] === 'awake').map(r => Number(r[6]))).toEqual([0]) // the one nudge that ran; no saving
  await band.unmount()
})

test('a nudge is dropped when the chat was just used, and a nudge that finds the cache gone turns keep-awake off', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const toasts: Array<string> = []
  const opts = { sent: [] as Array<unknown>, store, read: 200_000, write: 0, ownClock: true }
  wire(on, opts)
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await step($, 'medium')
  await clock.advance(60_000)
  expect(await $.prompt.submit({ text: AWAKE_TEXT, origin: { kind: 'plugin', name: 'router' }, wait: false })).toEqual({ drop: 'router: the chat was used meanwhile' })
  await clock.advance(2_940_000) // the timer's own nudge, 50 minutes after the step
  opts.read = 0
  opts.write = 200_000 // the cache was gone: the nudge wrote the whole chat again (a 5-minute cache)
  await step($, 'medium')
  expect(store.get('features')).toEqual({ autoSwitch: true, sizing: true, pastes: true, awake: false })
  expect(toasts.some(t => t.includes('keep-awake found the cache already gone'))).toBe(true)
})

test('auto-compact cost: the cheapest point follows the chat\'s growth, up to the model\'s context limit; each point is coloured', () => {
  const at = (p: number, g: number) => Math.round(compactStepUsd('opus', p, g) * 1000)
  // 5K a step: half-way reads plus one compaction (read 300K, 5K out, write 116K) spread over 187K/5K steps
  expect([at(200_000, 5_000), at(300_000, 5_000), at(400_000, 5_000)]).toEqual([93, 70, 71])
  expect(compactPoints(1_000_000)).toEqual([200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000])
  expect(compactPoints(200_000)).toEqual([]) // a 200K model: only Claude Code's own window
  expect(cheapestPoint('opus', 5_000, 1_000_000)).toBe(300_000)
  expect(cheapestPoint('opus', 20_000, 1_000_000)).toBe(600_000) // a fast-growing chat compacts less often
  // 5K a step: 200K compacts every 17 steps (loses detail), 300K-500K near the cheapest, 600K dearer, 700K+ too dear
  expect(compactPoints(1_000_000).map(p => compactLook('opus', p, 5_000, 300_000))).toEqual(['bad', 'good', 'good', 'good', 'ok', 'bad', 'bad', 'bad'])
  // 20K a step: 500K would compact every 19 steps; 900K costs a little more than 600K
  expect([200_000, 500_000, 900_000].map(p => compactLook('opus', p, 20_000, 600_000))).toEqual(['bad', 'bad', 'ok'])
  expect(cheapestPoint('opus', 5_000, 300_000)).toBe(200_000) // only points under the model's limit
  expect(Math.round(compactsPer100(300_000, 5_000) * 10)).toBe(27) // 187K between compactions at 5K a step
  expect(cheapestPoint('opus', 0, 1_000_000)).toBeUndefined() // a chat that doesn't grow never needs it
  expect(compactStepUsd('opus', 100_000, 5_000)).toBe(Infinity) // a point under what compaction leaves
})

test('auto-compact: the chat compacts after the turn that passes its own point, not before, not for a subagent; Clear resets it', async (engine, on) => {
  const $ = engine as any
  const toasts: Array<string> = []
  const compacted: Array<unknown> = []
  const opts = { sent: [] as Array<unknown>, read: 250_000, write: 0, ownClock: true, window: 1_000_000 }
  wire(on, opts)
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('session.compact', (_: unknown, e: unknown) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  on('turn.complete', () => ({ text: '' }))
  const done = async (agentId?: string) => { await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer', ...(agentId ? { agentId } : {}) }); await clock.advance(1_000) }
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-compact-300000' })
  await step($, 'medium')
  await done()
  expect(compacted.length).toBe(0) // 250K: under the point
  opts.read = 310_000
  await step($, 'medium')
  await done('a1')
  expect(compacted.length).toBe(0) // a subagent's run ending mid-turn: the main turn still runs
  await done()
  expect(compacted.length).toBe(1)
  expect(toasts.some(t => t.includes('compacted this chat at 310K (your point: 300K)'))).toBe(true)
  await done()
  expect(compacted.length).toBe(1) // the next step tells the new size; nothing to do meanwhile
  await band.press({ key: 'router-compact-off' })
  await step($, 'medium')
  await done()
  expect(compacted.length).toBe(1) // Claude Code's own window again
  await band.unmount()
})

test('auto-compact Settings: the cheapest point and the costs show once the chat has grown a few steps; the default goes into settings.json, other keys kept', async (engine, on) => {
  const $ = engine as any
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING, '/home/.claude/settings.json': '{"model":"opus"}' }
  const opts = { sent: [] as Array<unknown>, files, read: 150_000, write: 0, window: 1_000_000 }
  wire(on, opts)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  expect(await band.find({ type: 'Text', text: /The cheapest point shows after a few steps/ })).toBeTruthy()
  expect(await band.find({ key: 'router-compact-default-set' })).toBeFalsy() // no point picked: nothing to make default
  for (const r of [150_000, 155_000, 160_000, 165_000]) { opts.read = r; await step($, 'medium') }
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-settings' })
  expect((await band.find({ key: 'router-compact-300000' }))?.props.label).toBe('● 300K, cheapest') // 5K a step on Opus
  expect((await band.find({ key: 'router-compact-200000' }))?.props.label).toBe('● 200K')
  expect(await band.find({ key: 'router-compact-900000' })).toBeTruthy() // up to the model's limit (1M), not a fixed cap
  // the compact row's dots, 200K to 900K: red, three greens, amber, then red as the price climbs
  const looks = ['#c8553d', '#4f9a5c', '#c9932e']
  const dots = (await band.findAll({ type: 'Text', text: '●' })).map((d: { props: { color?: string } }) => d.props.color).filter((c: string | undefined) => looks.includes(c ?? ''))
  expect(dots).toEqual(['#c8553d', '#4f9a5c', '#4f9a5c', '#4f9a5c', '#c9932e', '#c8553d', '#c8553d', '#c8553d'])
  expect(await band.find({ type: 'Text', text: /grows about 5K a step; a step reads \$0\.03 now, and compacting at 300K averages about \$0\.07 a step/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /Every 100 steps: 200K compacts 5\.7 times, \$\d+\.\d\d; 300K compacts 2\.7 times, \$7\.0\d;/ })).toBeTruthy()
  await band.press({ key: 'router-compact-400000' })
  await band.press({ key: 'router-compact-default-set' })
  expect(JSON.parse(files['/home/.claude/settings.json']!)).toEqual({ model: 'opus', autoCompactWindow: 400_000 })
  files['/home/.claude/settings.json'] = '{ broken'
  await band.press({ key: 'router-compact-default-set' })
  expect(files['/home/.claude/settings.json']).toBe('{ broken') // never overwrite a file it can't read
  await band.unmount()
})

test('auto-compact Settings: a point past Claude Code\'s own window is offered up to the model\'s limit, and the note says it needs the default', async (engine, on) => {
  const $ = engine as any
  wire(on, { sent: [], read: 150_000, write: 0, window: 1_000_000, engineAt: 400_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-compact-600000' })
  expect(await band.find({ type: 'Text', text: /Claude Code itself compacts at 400K \(your settings\.json\)/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /Claude Code compacts at 400K first, so make it your default to reach 600K/ })).toBeTruthy()
  expect(await band.find({ key: 'router-compact-default-set' })).toBeTruthy()
  await band.press({ key: 'router-compact-300000' })
  expect(await band.find({ type: 'Text', text: /make it your default to reach/ })).toBeFalsy() // under the window: the router reaches it itself
  await band.unmount()
})

test('with keep-awake off, once the cache lapses the band offers to compact first, with the costs; a prompt or Keep clears it', async (engine, on) => {
  const $ = engine as any
  const compacted: Array<unknown> = []
  const nudges: Array<{ text: string }> = []
  wire(on, { sent: [], nudges, read: 200_000, write: 0, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('session.compact', (_: unknown, e: unknown) => { compacted.push(e); return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-f-awake-off' })
  await band.press({ key: 'router-settings' })
  await step($, 'medium')
  await clock.advance(1_800_000)
  await step($, 'medium') // back within the hour: the cache lives on, the hour starts again
  await clock.advance(2_000_000)
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy()
  await clock.advance(1_700_000)
  expect(nudges.length).toBe(0)
  expect(await band.find({ type: 'Text', text: /re-reads the whole chat \(200K tokens, about \$1\.60\).*about \$0\.58.*22 steps/ })).toBeTruthy()
  await band.press({ key: 'router-cold-keep' })
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy()
  expect(compacted.length).toBe(0)
  await step($, 'medium')
  await clock.advance(3_700_000)
  await band.press({ key: 'router-cold-compact' })
  expect(compacted.length).toBe(1)
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy()
  await step($, 'medium')
  await clock.advance(3_700_000)
  expect(await band.find({ key: 'router-cold-compact' })).toBeTruthy()
  await $.prompt.submit({ text: 'ok, where were we', origin: { kind: 'composer' }, wait: false })
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy()
  await band.unmount()
})

test('no compact offer and no nudge for a small chat or a subagent', async (engine, on) => {
  const $ = engine as any
  const nudges: Array<{ text: string }> = []
  const opts = { sent: [] as Array<unknown>, nudges, read: 15_000, write: 0, ownClock: true }
  wire(on, opts)
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium') // 15K: a rebuild costs cents
  await clock.advance(3_700_000)
  opts.read = 300_000
  await step($, 'medium', 'sub1') // a subagent's step never starts the main chat's timer
  await clock.advance(3_700_000)
  expect(nudges.length).toBe(0)
  expect(await band.find({ key: 'router-cold-compact' })).toBeFalsy()
  await band.unmount()
})


test('a switched-off feature stays off in the next session', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>([['features', { autoSwitch: false, sizing: true, pastes: true }]])
  const models: Array<string> = []
  wire(on, { sent: [], models, store, haiku: (e: { system?: string }) => (e.system === sessionCheckSystem ? 'haiku 0.95 same' : 'engineering 0.95'), tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  expect(await band.find({ key: 'router-chat-undo' })).toBeFalsy() // Move down is off: no automatic move
  expect(await band.find({ key: 'router-offer-compact' })).toBeTruthy() // the offer is still made
  await band.unmount()
})

test('Edit rules never opens an empty file: an empty routing.json gets a note, the built-in rules are written beside it, your own rules are kept (owner case 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const files: Record<string, string> = { '/home/.claude/routing.json': '{}\n' }
  const argv: Array<Array<string>> = []
  wire(on, { sent: [], files, argv, tokens: 5_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  await band.press({ key: 'router-rules' })
  const note = JSON.parse(files['/home/.claude/routing.json']!)
  expect(Object.keys(note)).toEqual(['$help'])
  expect(note.$help).toContain('/home/.claude/router/builtin-rules.json')
  expect(JSON.parse(files['/home/.claude/router/builtin-rules.json']!).classes.debugging.model).toBe('opus')
  expect(argv.some(a => a.join(' ').includes('routing.json'))).toBe(true) // and it opens
  files['/home/.claude/routing.json'] = '{ "mode": "on", "main": { "effort": "high" } }'
  await band.press({ key: 'router-rules' })
  expect(files['/home/.claude/routing.json']).toBe('{ "mode": "on", "main": { "effort": "high" } }')
  await band.unmount()
})

test('money integrity: over every spend path, ledger rows, the chat tally, the reasons and the published prices all agree', async (engine, on) => {
  const $ = engine as any
  const store = new Map<string, unknown>()
  const batches: Array<Array<Step>> = []
  const files: Record<string, string> = { '/home/.claude/routing.json': ROUTING }
  wire(on, {
    sent: [], store, batches, files, tokens: 5_000, read: 20_000, write: 3_000, ownClock: true,
    haiku: (e: any) => (e.system === pasteSystem ? 'Request: x\nAnalysis: y' : /Swap every variable/.test(String(e.prompt)) ? 'mechanical 0.95' : 'engineering 0.95'),
  })
  const clock = mock.clock(on, { now: 1_000 })
  let n = 0
  on('agent.spawn', (_: unknown, e: { model?: string }) => ({ model: e.model ?? 'inherit', agentId: `sub${++n}` }))
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('ui.toast', () => ({ value: undefined }))
  const stepAs = async (model: string, effort: string, agentId?: string) => { for await (const _ of $.turn.step({ turnId: `t${n}`, index: 0, model, effort, messageCount: 1, ...(agentId ? { agentId } : {}) })) { /* drain */ } }
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'set up the release pipeline for the app', origin: { kind: 'composer' }, wait: false })
  await stepAs('claude-opus-5-5', 'medium') // engineering: Opus raised to high, extra on effort
  const brief = 'Swap every variable called foo for bar across the utils folder'
  await $.agent.spawn({ prompt: brief, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' })
  await stepAs('haiku', 'medium', 'sub1') // moved to Haiku: saved on subagents
  await $.agent.spawn({ prompt: brief, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' }) // a repeat: sub1's saving goes back
  await stepAs('sonnet', 'medium', 'sub2')
  await $.prompt.submit({ text: `Find the error\n${'step ok\n'.repeat(6_000)}`, origin: { kind: 'composer' }, wait: false }) // a paste, read by Haiku
  await $.tool.call({ tool: 'Read', file_path: '/home/.claude/router/pastes/sess-1-1000.txt' }) // then read whole: a miss
  await stepAs('claude-opus-5-5', 'medium')
  await clock.advance(2_100)
  await end($)

  const t = (store.get('agents:sess-1') as { stats: { tally: { actualUsd: number; baselineUsd: number; extraUsd: number; by: Record<string, { saved: number; extra: number }> } } }).stats.tally
  const usage = rows(batches, 'usage')
  const sum = (i: number) => usage.reduce((a, r) => a + Number(r[i]), 0)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
  // (a) the ledger and the tally are the same money
  expect([near(sum(5), t.actualUsd), near(sum(6), t.baselineUsd), near(sum(7), t.extraUsd)]).toEqual([true, true, true])
  // (b) the reasons add up to the totals, and saved minus extra is the net
  const by = Object.values(t.by)
  const saved = by.reduce((a, x) => a + x.saved, 0)
  expect(near(by.reduce((a, x) => a + x.extra, 0), t.extraUsd)).toBe(true)
  expect(near(saved - t.extraUsd, t.baselineUsd - t.actualUsd)).toBe(true)
  expect(Object.keys(t.by).sort()).toEqual(['agents', 'effort', 'paste', 'router'])
  expect(t.by.effort!.extra > 0 && t.by.router!.extra > 0).toBe(true)
  // the repeat took the first run's saving back (only the Sonnet rerun saves against Opus); the paste miss saved nothing
  const rerun = usage.find(r => r[2] === 'general-purpose' && r[3] === 'sonnet')!
  expect(near(t.by.agents!.saved, Number(rerun[6]) - Number(rerun[5]))).toBe(true)
  expect(Math.abs(t.by.paste!.saved) < 1e-9).toBe(true)
  // (c) every step row's extra is what it cost over its baseline, never negative
  for (const r of usage.filter(r => Number(r[4]) > 0)) expect(near(Number(r[7]), Math.max(0, Number(r[5]) - Number(r[6])))).toBe(true)
  // (d) one step priced by hand from the pricing page: Opus main step, 10 in at $4, 5 out at $20, 20K read at $0.2,
  // 3K written as 1-hour entries at $8 (per million); no router it is Opus medium, 1/1.4 of the high step
  const opus = (10 * 4 + 5 * 20 + 20_000 * 0.2 + 3_000 * 8) / 1e6
  const first = usage.find(r => r[2] === 'main' && r[3] === 'opus')!
  expect([near(Number(first[5]), opus), near(Number(first[6]), opus / 1.4)]).toEqual([true, true])
})

test('ledger writes never hold a step: rows wait in memory and go out as one batch about every 2 s', async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], batches, files: { '/home/.claude/routing.json': ROUTING }, tokens: 5_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const before = batches.length
  for (let i = 0; i < 5; i++) await step($, 'medium')
  expect(batches.length).toBe(before) // five steps, nothing written yet
  await clock.advance(2_100)
  const wrote = batches.slice(before).filter(b => b.some(x => x.sql.startsWith('INSERT INTO usage ')))
  expect(wrote.length).toBe(1) // one batch for all five
  expect(batches.length - before).toBe(1) // and no empty runs after it: one timer at a time
  expect(wrote[0]!.filter(x => x.sql.startsWith('INSERT INTO usage ')).length).toBe(5) // a row per step; the runner sums them per key
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

test('a note to one person is a message on Sonnet, never final copy with a Fable tip (owner case 2026-11-19)', async () => {
  expect(firstModel(['message', 'message', 'message'], 'claude-opus-5-5', BUILTIN)).toBe('sonnet')
  expect(BUILTIN.classes.message!.floor).toBe(undefined)
  expect(CLASS_LABELS).toContain('message') // no keyword rule: the classifier must be offered it
  expect(classifyByRules('write a short email to Maria with the policy links, polite and to the point', BUILTIN)).toBe(undefined)
  expect(firstModel(['mechanical', 'mechanical', 'mechanical'], 'claude-opus-5-5', BUILTIN)).toBe('sonnet')
  // a production project (default raised to high) keeps a log read on its default
  expect(firstModel(['long-read', 'long-read', 'long-read'], 'claude-opus-5-5', merge(BUILTIN, { main: { model: 'opus', effort: 'high' } }))).toBe(undefined)
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

test('cache math: rebuild cost, break-even and the survival curve decide a switch down (docs/PLAN-v3.md)', async () => {
  const opus = 'claude-opus-5-5', sonnet = 'claude-sonnet-5-5', haiku = 'claude-haiku-5-5'
  const c = (x: number) => Math.round(x * 1000) // tenths of a cent
  expect(c(rebuildUsd(sonnet, 100_000))).toBe(400) // 100K at Sonnet's 1-hour write, $4/M
  expect(c(stepUsd(opus, 100_000, 1_000))).toBe(40) // read $0.02 + answer $0.02
  // Opus to Sonnet at 100K: $0.40 once, $0.02 saved a step -> 20 steps to break even
  const base = { from: opus, to: sonnet, cache: 100_000, out: 1_000 }
  const m = switchMath({ ...base, age: 19 })
  expect(Math.round(m.breakEven)).toBe(20)
  expect(m.pays).toBe(false) // no history: only once the chat has run break-even steps
  expect(switchMath({ ...base, age: 20 }).pays).toBe(true)
  expect(switchMath({ ...base, age: 1, free: true }).pays).toBe(true) // cold or just-compacted cache: staying would write it too
  expect(switchMath({ ...base, age: 1, free: true }).rebuild).toBe(0)
  expect(switchMath({ ...base, from: sonnet, to: opus, age: 99 }).pays).toBe(false) // never "down" to a dearer model
  // past chats: 40 ended after 1..40 steps. At age 5, 75% of chats like it run at least 9 more steps
  const lives: Array<Life> = Array.from({ length: 40 }, (_, i) => ({ steps: i + 1, open: false }))
  expect(remainingSteps(lives, 5)).toBe(9)
  expect(remainingSteps(lives, 25)).toBe(undefined) // only 16 past chats reached 25 steps: too little history
  expect(remainingSteps([...lives, ...Array.from({ length: 20 }, () => ({ steps: 40, open: true }))], 39)).toBe(1) // most outlived every ended chat: at least to the longest
  expect(remainingSteps(Array.from({ length: 30 }, () => ({ steps: 50, open: true })), 50)).toBe(undefined) // none ahead to judge by
  const long: Array<Life> = Array.from({ length: 40 }, (_, i) => ({ steps: i < 20 ? 2 : 200, open: i >= 30 }))
  expect(remainingSteps(long, 10)).toBe(190) // past the short ones, chats this old run on to 200
  expect(switchMath({ ...base, age: 10, lives: long }).pays).toBe(true) // 190 ahead beats 20
  expect(switchMath({ ...base, age: 3, lives }).pays).toBe(false) // short chats: 10 ahead, under 20
  // the ledger's chats: one used within the hour may go on
  expect(livesOf([[{ steps: 12, last: 0 }, { steps: 7, last: 9_000_000 }, { steps: 0, last: 0 }]], 10_000_000)).toEqual([{ steps: 12, open: false }, { steps: 7, open: true }])
  // quick turns on Haiku: pay on a mid-size Opus chat, lose past Haiku's 100K price step
  expect(quickPays(haiku, opus, 80_000, 1_000)).toBe(true)
  expect(quickPays(haiku, opus, 130_000, 1_000)).toBe(false)
  expect(autoModel('mechanical', 130_000, opus, CFG)).toBe(undefined)
  expect(switchCost(1.6, false)).toMatch(/about \$1\.60 now/)
  expect(switchCost(1.6, true)).toBe('') // a new chat has no cache to re-read
})

test('after a compaction the same work moves to a lighter model by itself: the cache was just rewritten, so the move costs almost nothing; Undo goes back', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  const toasts: Array<string> = []
  wire(on, { sent: [], models, haiku: 'haiku 0.95 same', tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium') // 40K tokens cached on Opus
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy() // no offer to press: the router moved
  expect(await band.find({ key: 'router-chat-undo' })).toBeTruthy()
  expect(toasts.some(t => /Sonnet for the same work/.test(t))).toBe(true) // one family down at a time
  models.length = 0
  await step($, 'medium')
  expect(models).toEqual(['sonnet'])
  await band.press({ key: 'router-chat-undo' })
  await step($, 'medium')
  expect(models).toEqual(['sonnet', 'claude-opus-5-5'])
  await band.unmount()
})

test('lighter work in mid-chat stays put when the cache rebuild would not pay back, with no history of past chats', async (engine, on) => {
  const $ = engine as any
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'haiku 0.95 same', tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium') // one step: far fewer than break-even
  await $.tool.call({ tool: 'ExitPlanMode', plan: 'ship it' })
  await clock.advance(600)
  expect(await band.find({ key: 'router-chat-undo' })).toBeFalsy()
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy() // and no offer either
  await band.unmount()
})

test('a move at a free switch point books no extra spend: the old model would have written the chat too (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const models: Array<string> = []
  const batches: Array<Array<Step>> = []
  wire(on, { sent: [], models, batches, files: { '/home/.claude/routing.json': ROUTING }, haiku: (e: { system?: string }) => (e.system === sessionCheckSystem ? 'haiku 0.95 same' : 'engineering 0.95'), tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  models.length = 0
  await step($, 'medium') // the first step on Sonnet, right after compaction
  expect(models).toEqual(['sonnet'])
  await band.unmount()
  await end($)
  // the move happened where Opus's cache was rebuilt anyway: no warm-cache credit, so no extra spend booked
  const moved = rows(batches, 'usage').filter(r => r[2] === 'main' && String(r[3]).includes('sonnet'))
  expect(moved.length).toBe(1)
  expect(Number(moved[0]![7])).toBe(0)
})

test('after a move down in mid-chat, a harder prompt keeps the cheaper model and shows the tip: never an automatic move back up (review 2026-11-25)', async (engine, on) => {
  const $ = engine as any
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: (e: { system?: string }) => (e.system === sessionCheckSystem ? 'haiku 0.95 same' : 'engineering 0.95'), tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  models.length = 0
  await $.prompt.submit({ text: 'now design the next part of the system in detail for me' })
  await step($, 'medium')
  expect(models).toEqual(['sonnet'])
  expect(await band.find({ key: 'router-tip-switch' })).toBeTruthy() // Opus is offered, with its cost
  await band.unmount()
})

test("an hour's pause is a free switch point: lighter same work moves on the next check", async (engine, on) => {
  const $ = engine as any
  const batches: Array<Array<Step>> = []
  // keep-awake off: with it on, the cache never lapses and the pause is no free switch point
  wire(on, { sent: [], batches, store: new Map<string, unknown>([['features', { autoSwitch: true, sizing: true, pastes: true, awake: false }]]), files: { '/home/.claude/routing.json': ROUTING }, haiku: 'haiku 0.95 same', tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await clock.advance(3_700_000)
  await $.tool.call({ tool: 'ExitPlanMode', plan: 'ship it' })
  await clock.advance(600)
  expect(await band.find({ key: 'router-chat-undo' })).toBeTruthy()
  await step($, 'medium') // the first step on the lighter model writes the whole chat again
  await band.unmount()
  await end($)
  // Opus's cache lapsed during the pause, so without the router it would have written the chat too: no extra spend
  const moved = rows(batches, 'usage').filter(r => r[2] === 'main' && String(r[3]).includes('sonnet'))
  expect(moved.length).toBe(1)
  expect(Number(moved[0]![7])).toBe(0)
})

test('with enough past chats that ran long, lighter same work moves early in a chat: the curve says it will pay back', async (engine, on) => {
  const $ = engine as any
  const past = Array.from({ length: 25 }, () => ({ steps: 500, last: 0 }))
  wire(on, { sent: [], haiku: 'haiku 0.95 same', tokens: 40_000, write: 40_000, ownClock: true, files: { '/home/.claude/routing.json': ROUTING }, select: sql => (sql.includes("u.who = 'main'") ? past : []) })
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now just fix the typo in the README title', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium') // age 1: the classic rule alone would wait ~40 steps
  await $.tool.call({ tool: 'ExitPlanMode', plan: 'ship it' })
  await clock.advance(600)
  expect(await band.find({ key: 'router-chat-undo' })).toBeTruthy()
  await band.unmount()
})

test('lighter work on a new topic keeps the offer (starting fresh is your call); Not now keeps that trigger quiet', async (engine, on) => {
  const $ = engine as any
  wire(on, { sent: [], haiku: 'haiku 0.95 new', tokens: 40_000, write: 40_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'unrelated: what is a good name for a cat', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  expect(await band.find({ type: 'Text', text: /looks lighter: Sonnet can do it/ })).toBeTruthy()
  expect(await band.find({ key: 'router-chat-undo' })).toBeFalsy()
  await band.press({ key: 'router-offer-no' })
  expect(await band.find({ key: 'router-offer-fresh' })).toBeFalsy()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(600)
  expect(await band.find({ key: 'router-offer-fresh' })).toBeFalsy()
  await band.unmount()
})

test('the offer button compacts, then the chat runs on the offered model; the offer says what the switch costs', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const models: Array<string> = []
  wire(on, { sent: [], models, haiku: 'fable 0.9 same', tokens: 40_000, write: 100_000, ownClock: true })
  const clock = mock.clock(on, { now: 1_000 })
  let compactions = 0
  on('session.compact', () => { compactions++; return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  on('tool.call', () => ({ result: { content: 'ok' } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'set up the release pipeline for the app', toolUses: [] }, { role: 'user', text: 'now write the changelog entries', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await step($, 'medium') // 100K tokens cached on Opus: Fable writes them at $16/M, about $1.60
  const said = await $.command.run({ command: 'route', args: '' })
  expect(said.text).toMatch(/Cache: 100K tokens\. Switching model re-reads it once: .*Sonnet \$0\.40.*Fable \$1\.60/)
  await $.tool.call({ tool: 'ExitPlanMode', plan: 'ship it' })
  await clock.advance(600)
  expect(await band.find({ type: 'Text', text: /about \$1\.60 now, less after compacting/ })).toBeTruthy()
  models.length = 0
  await band.press({ key: 'router-offer-compact' })
  expect(compactions).toBe(1) // the button's
  expect(await band.find({ key: 'router-offer-compact' })).toBeFalsy()
  await step($, 'medium')
  expect(models).toEqual(['fable'])
  await band.unmount()
})

test("a model reached through the router's own offer is measured against the model before it (owner case 2026-11-21)", async (engine, on) => {
  const $ = engine as any
  const sent: Array<unknown> = []
  const batches: Array<Array<Step>> = []
  wire(on, { sent, batches, files: { '/home/.claude/routing.json': ROUTING }, haiku: 'final-copy 0.95', tokens: 40_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.prompt.submit({ text: 'write the launch post for the new product, for our blog' })
  await band.press({ key: 'router-tip-switch' }) // the Opus chat goes to Fable on the router's tip
  await step($, 'medium')
  await band.unmount()
  await end($)
  const main = rows(batches, 'usage').find(r => r[2] === 'main')!
  const effort = Number(main[6]) / costUsd('claude-opus-5-5', USAGE, true) // the effort factor alone: the baseline priced on Opus
  expect(main[3]).toBe('fable')
  expect(sent).toEqual([sent[0]]) // one step
  expect(Math.round(effort * 100)).toBe(100) // medium both ways (final copy is high on Opus, so medium on Fable)
  expect(Number(main[7])).toBeGreaterThan(0) // Fable costs more than the Opus chat would have: extra, not saved
})

test('a subagent sent to investigate production and reproduce the failure runs as a long run: Opus xhigh, never Fable', async () => {
  const brief = 'Two customers end up booked into the same slot. Find out why and propose a fix. Reproduce it with a local concurrent script.'
  expect(longRun('debugging', brief, BUILTIN)).toBe('rare-hard')
  expect(longRun('code-review', 'review the PR and run a load test on the new limiter', BUILTIN)).toBe('rare-hard')
  expect(longRun('debugging', 'find why the webhook signature check fails since the deploy', BUILTIN)).toBe('debugging') // no repro asked
  expect(longRun('test-writing', 'write a test that reproduces the bug', BUILTIN)).toBe('test-writing') // only investigations
  expect(longRun(null, brief, BUILTIN)).toBe(null)
  const pick = spawnPick({ brief: { cls: longRun('debugging', brief, BUILTIN), sure: true }, parentModel: 'claude-opus-5-5', personChose: false }, BUILTIN)
  expect([pick.model, pick.tier?.effort]).toEqual(['opus', 'xhigh'])
})

test('mood: Haiku reads the exchange; only a sure answer counts; effort rises one step per unhappy reply, two at most', async () => {
  expect(parseMood('unhappy 0.9')).toBe('unhappy')
  expect(parseMood('same: 0.8')).toBe('same')
  expect(parseMood('unhappy 0.6')).toBe(undefined) // unsure: nothing changes
  expect(parseMood('I think they are unhappy')).toBe(undefined)
  expect(raiseEffort('medium', 1)).toBe('high')
  expect(raiseEffort('medium', 5)).toBe('xhigh') // two steps at most
  expect(raiseEffort('xhigh', 2)).toBe('max')
  expect(raiseEffort('low', 0)).toBe('low')
  const p = moodPrompt({ asked: 'fix the login', answer: 'x'.repeat(3000) + 'END', next: 'still broken' })
  expect(p).toContain('END') // the end of the answer, where it says what it did
  expect(p).toContain('<next_message>\nstill broken')
})

const EXCHANGE = [
  { role: 'user', text: 'why does the refund never reach the ledger service', toolUses: [] },
  { role: 'assistant', text: 'The queue name was wrong; I fixed it in config.ts.', toolUses: [] },
]

test('unhappy replies keep the task class; the 2nd raises effort, the 4th raises again and offers the next model; a new task resets', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  const moods = ['same 0.9', 'unhappy 0.9', 'same 0.9', 'unhappy 0.85', 'unhappy 0.9', 'unhappy 0.9', 'new 0.9']
  const haiku = (e: { system?: string }) => (e.system?.startsWith('You read one exchange') ? moods.shift()! : 'default 0.9')
  const batches: Array<Array<Step>> = []
  wire(on, { sent, haiku, tokens: 5_000, model: 'claude-sonnet-5-5', messages: EXCHANGE, batches, files: {} })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const turn = async (text: string) => { await $.prompt.submit({ text }); await step($, 'medium') }
  await turn('please review this PR for bugs and missing edge cases') // critique: high
  await turn('that did not help, the refund still never shows up in the ledger') // 1st unhappy: kept critique, no raise (one misread costs nothing)
  await turn('I meant the refunds table, not the payments one') // a clarification: no change
  await turn('no, it is still not there after your change, look again') // 2nd: one step up
  await turn('still nothing in the ledger') // 3rd: no change
  expect(await band.find({ type: 'Text', text: /fits this task better\./ })).toBeFalsy()
  await turn('it is the same as before, this is not working') // 4th: a second step and the tip
  expect(await band.find({ type: 'Text', text: /Opus fits this task better\./ })).toBeTruthy()
  await turn('Swap every variable called foo for bar in the utils module and the tests too') // a new task: calm again
  expect(sent).toEqual(['high', 'high', 'high', 'xhigh', 'xhigh', 'max', 'medium'])
  await end($)
  expect(rows(batches, 'efforts').filter(r => r[2] === 'main').map(r => r[7])).toEqual(['class', 'class', 'class', 'unhappy', 'unhappy', 'unhappy', 'class']) // the ledger says which steps the unhappy raises bought
  await band.unmount()
})

test('unhappy on Opus raises effort but never offers Fable', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  const sent: Array<unknown> = []
  wire(on, { sent, haiku: e => (e.system?.startsWith('You read one exchange') ? 'unhappy 0.95' : 'default 0.9'), tokens: 5_000, messages: EXCHANGE })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  for (const text of ['that is still not what I asked for, try again please', 'still not right, please try once more', 'no, wrong again', 'this is still not it']) {
    await $.prompt.submit({ text })
    await step($, 'medium')
  }
  expect(sent).toEqual(['medium', 'high', 'high', 'xhigh'])
  expect(await band.find({ type: 'Text', text: /fits this task better\./ })).toBeFalsy()
  await band.unmount()
})

test('Settings: model and effort choices carry their colors as children (a label would hide them on the desktop)', async (engine, on) => {
  const $ = engine as any // the test engine fills origin, wait and the other session-set fields
  wire(on, { sent: [] })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'router-settings' })
  const dots = (await band.findAll({ type: 'Text', text: '●' })).map((d: { props: { color?: string } }) => d.props.color)
  expect(dots).toContain('#2394AE') // Sonnet's teal
  expect(dots).toContain(shade('opus', 'max', 'dark')) // the chat model's darkest step
  expect(dots).toContain(shade('opus', 'low', 'dark'))
  expect((await band.find({ key: 'router-model-auto' }))?.props.label).toBe('Auto') // Auto has no color
  await band.press({ key: 'router-model-sonnet' }) // still a button
  await band.unmount()
})

test('Board: keep-awake rows add up as their own line, never as a subagent type', () => {
  const [b] = bucketsOf([[{ day: 'd', session: 's', project: 'p', label: 'l', turns: 3, first: 0, last: 1 }], [{ day: 'd', session: 's', who: 'awake', model: 'opus', steps: 2, usd: 0.08, base: 0, extra: 0.08 }, { day: 'd', session: 's', who: 'awake', model: 'opus', steps: 0, usd: 0, base: 1.56, extra: 0 }], []])
  expect(b!.awake).toEqual({ nudges: 2, usd: 0.08, saved: 1.56 })
  expect(b!.agents).toBeUndefined()
  expect([whoWords({ who: 'awake', cls: 'default' }), whoWords({ who: 'main', cls: 'code' }), whoWords({ who: 'Explore', cls: '-' })]).toEqual(['keep awake', 'code', 'Explore'])
  expect(boardHtml([b!], [], 's', 'Opus', 'now', 'then')).toContain("$('awake').textContent")
})
