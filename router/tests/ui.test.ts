import { expect, test } from 'claude-code/testing'

declare const console: { log: (line: string) => void } // the test runner prints it; the strict config has no DOM or Node types

import { type BandPart, bandFit } from '../hooks/view'
import { type Node, LIMITS, cells, choiceIssues, contrast, labelIssues, marginIssues, numberIssues, oneRowOverflow, overfullRows, repeatIssues, tabularIssues, textOf, walk } from './uikit'

const ROUTING = JSON.stringify({ main: { model: 'opus', effort: 'medium' }, classes: { mechanical: { model: 'haiku', effort: 'low' } } })
const USAGE = { model: 'claude-opus-5-5', input_tokens: 4000, output_tokens: 800, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 2000 }

function wire(on: any, files: Record<string, string>) {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Z]:/, '')
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/home' : undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: ['desktop', 'terminal'] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: norm(e.path) in files }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[norm(e.path)] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => { files[norm(e.path)] = e.text; return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: { init?: { stdin?: string } }) => {
    const steps = (e.init?.stdin?.startsWith('{') ? JSON.parse(e.init.stdin).steps ?? [] : []) as Array<{ all?: boolean }>
    return { value: { exitCode: 0, stdout: JSON.stringify(steps.map(x => (x.all ? [] : null))), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'mechanical 0.95', usage: USAGE } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 96_000 }, rateLimits: [] } }))
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number; model: string }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model === 'haiku' ? 'claude-haiku-5-5' : USAGE.model } }
  })
}

const WIDTHS = [40, 60, 80, 120] // cells: a split pane, a narrow window, the classic terminal, a wide one
const SURFACES = ['terminal', 'desktop'] as const

// Every check the tree allows without a paint: wording of buttons, number formats in text, rows that fit their width.
// Each drawn tree is also printed as a UI-TREE line, which tests/ui.check.mjs --trees turns into screenshots.
function audit(tree: Node, state: string, surface: string, width: number): Array<string> {
  console.log('UI-TREE ' + JSON.stringify({ state, surface, width, tree }))
  const out: Array<string> = []
  walk(tree, n => {
    if (n.type === 'Button') for (const i of labelIssues(textOf(n))) out.push(`button "${textOf(n)}": ${i}`)
    if (n.type === 'Text' && !(n.children ?? []).some(c => typeof c !== 'string')) for (const i of numberIssues(textOf(n))) out.push(`text "${textOf(n).slice(0, 50)}": ${i}`)
    if (n.type === 'Svg') for (const i of numberIssues(String(n.props?.alt ?? ''))) out.push(`card alt: ${i}`)
    // plain buttons have no chrome: 1 cell apart, "Board Stats Settings" reads as one phrase
    const plain = (n.children ?? []).filter(c => typeof c !== 'string' && c.type === 'Button' && c.props?.plain).length
    if (n.type === 'Box' && n.props?.flexDirection === 'row' && plain >= 2 && Number(n.props?.columnGap ?? n.props?.gap ?? 0) < 2) out.push(`${String(n.props?.key ?? 'row')}: plain buttons closer than 2 cells`)
    if (n.type === 'Progress') for (const i of repeatIssues(String(n.props?.label ?? ''), String(n.props?.valueText ?? ''))) out.push(`progress: ${i}`)
    if (n.type === 'Box' && /^router-(offer|cold|away-row)$/.test(String(n.props?.key))) for (const c of n.children ?? []) if (typeof c !== 'string' && c.type === 'Text' && cells(textOf(c)) > LIMITS.row) out.push(`${String(n.props?.key)}: ${cells(textOf(c))} cells of text, over ${LIMITS.row} ("${textOf(c).slice(0, 50)}…")`)
    if (n.props?.key === 'router-row' && surface !== 'terminal') out.push(...tabularIssues(n)) // a terminal's digits are one cell each
    // the band's lead is one glyph and a word, as the bands it stacks with ("● full"); two glyphs side by side are noise
    if (n.props?.key === 'router-row' && (textOf(n).match(/[●■]/g) ?? []).length > 1) out.push(`router-row: more than one glyph ("${textOf(n).slice(0, 30)}")`)
  })
  out.push(...overfullRows(tree, width, surface), ...choiceIssues(tree), ...marginIssues(tree))
  return [...new Set(out)].map(x => `${state} · ${surface} · ${width}: ${x}`).filter(x => !KNOWN.some(k => k.test(x)))
}
// Findings seen when the kit landed and not fixed yet: a ratchet. A fix deletes its line; nothing is ever added here.
const KNOWN: Array<RegExp> = []

// One session per state, the band and the Router panel mounted at every width on both surfaces that draw them. A press
// goes wherever its key is drawn; the band is checked to stay one row (an offer adds one), the panel at each width.
async function states($: any, on: any, routing: string, setup: ($: any) => Promise<void>, presses: Array<[string, string | undefined]>): Promise<Array<string>> {
  wire(on, { '/home/.claude/routing.json': routing })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await setup($)
  const issues: Array<string> = []
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      const band = await $.ui.mount({ plugin: 'router', component: 'AbovePrompt', surface, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: width, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
      const panel = await $.ui.mount({ plugin: 'router', component: 'Pane', requestId: 'router-panel', surface, props: { title: 'Router', isFocused: true, bodyColumns: width, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
      for (const [state, key] of presses) {
        if (key) await ((await band.find({ key })) ? band : panel).press({ key })
        if (!state) continue // a step on the way, checked by its own test: drawing it again only costs time
        const row = await band.drawn()
        issues.push(...audit(row, `${state} (band)`, surface, width))
        // the band never grows with what is open (owner case 2026-11-26: a tall band made the chat jump); only an offer adds a row
        walk(row, n => { const k = String(n.props?.key ?? ''); if (n.type === 'Svg' || /^router-(card|f-|compact|tab-|cost-|cache-|sw-|model-|effort-|global|project|units|chat-awake)/.test(k)) issues.push(`${state} · ${surface} · ${width}: the band grew: ${k || n.type}`) })
        // from 72 cells the row stays one line (owner case 2026-11-27: "Settings" wrapped on the desktop at ~96 cells)
        walk(row, n => { if (n.props?.key === 'router-row' && width >= 72) { const over = oneRowOverflow(n, width, surface); if (over) issues.push(`${state} · ${surface} · ${width}: the band row wraps, ${over} cells over (${textOf(n).slice(0, 70)})`) } })
        issues.push(...audit(await panel.drawn(), `${state} (panel)`, surface, width))
      }
      await band.unmount()
      await panel.unmount()
    }
  }
  return issues
}

const stepped = async ($: any) => {
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) { /* drain */ }
}

// One test per view: all four in one test drew the band and panel 32 times, 2.4-4.4 s on the CI runners, and timed out
// at the 5 s default on macOS (2026-11-28). Most of it is the engine drawing, so each view gets its own budget.
for (const [state, key] of [['band', undefined], ['cache', 'router-cache'], ['stats', 'router-stats'], ['settings', 'router-settings']] as Array<[string, string | undefined]>) {
  test(`the ${state} view fits 40 to 120 cells, with sentence-case labels and clean numbers`, async (engine, on) => {
    expect(await states(engine as any, on, ROUTING, stepped, [[state, key]])).toEqual([])
  })
}

test('Training on: the Switches list with its 👍 👎 fits every width', async (engine, on) => {
  const presses: Array<[string, string | undefined]> = [['', 'router-settings'], ['training on', 'router-f-labels-on'], ['switches', 'router-tab-switches']]
  expect(await states(engine as any, on, ROUTING, stepped, presses)).toEqual([])
})

test('a model tip row fits every width too, with Settings open under it', async (engine, on) => {
  const routing = JSON.stringify({ main: { model: 'opus', effort: 'medium' }, classes: { 'rare-hard': { model: 'fable', effort: 'medium', floor: true } } })
  const tip = async ($: any) => { await $.prompt.submit({ text: 'Plan the migration of the whole billing service to the new ledger' }) }
  expect(await states(engine as any, on, routing, tip, [['tip', undefined], ['tip+settings', 'router-settings']])).toEqual([])
})

test('the band with routing off fits every width', async (engine, on) => {
  const routing = JSON.stringify({ mode: 'off', main: { model: 'opus', effort: 'medium' } })
  expect(await states(engine as any, on, routing, async () => {}, [['off', undefined], ['off+settings', 'router-settings']])).toEqual([])
})

// The band's parts at every width are the same whether the numbers are short or long: a value gaining a digit as it
// ticks never makes Board or the countdown come and go (owner case 2026-11-27: "nothing jumping").
test('the band shows the same parts at every width as its numbers change length', () => {
  const parts = (net: string, left: number, k: string, hit: string): Array<BandPart> => [
    { key: 'lead', forms: ['● Opus high'], required: true },
    { key: 'net', forms: [net], required: true },
    { key: 'stats', forms: ['Stats'], button: true, required: true },
    { key: 'settings', forms: ['Settings'], button: true, required: true },
    { key: 'awake', forms: ['Stop nudges'], button: true },
    { key: 'board', forms: ['Board'], button: true },
    { key: 'cache', forms: [`Cache ${k} · ${left} min left`, `Cache · ${left} min left`, 'Cache'], button: true, required: true },
    { key: 'hit', forms: [hit] },
  ]
  const moved: Array<string> = []
  for (const desk of [false, true])
    for (let w = 30; w <= 160; w++) {
      const shape = (x: Record<string, string>) => Object.keys(x).sort().join(',') + ' / ' + (x.cache ?? '').replace(/\d+/g, '#')
      const [a, b] = [bandFit(w, desk, parts('saved $1.07', 9, '9K', 'hit 9%')), bandFit(w, desk, parts('saved $102.70', 41, '184K', 'hit 99.4%'))]
      if (shape(a) !== shape(b)) moved.push(`${desk ? 'desktop' : 'terminal'} ${w}: ${shape(a)}  vs  ${shape(b)}`)
    }
  expect(moved).toEqual([])
  // and it fills the room it has: everything at 160, only the required parts at 30
  expect(Object.keys(bandFit(160, true, parts('saved $1.07', 9, '9K', 'hit 9%'))).sort()).toEqual(['awake', 'board', 'cache', 'hit', 'lead', 'net', 'settings', 'stats'])
  expect(bandFit(160, true, parts('saved $1.07', 9, '9K', 'hit 9%')).cache).toBe('Cache 9K · 9 min left')
  expect(Object.keys(bandFit(30, false, parts('saved $1.07', 9, '9K', 'hit 9%'))).sort()).toEqual(['cache', 'lead', 'net', 'settings', 'stats'])
})

test('the rules themselves: contrast, labels, numbers, cell widths, row budgets', async () => {
  expect(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9).toBe(true)
  expect(contrast('#767676', '#ffffff')).toBeGreaterThan(4.5) // the classic lightest grey that passes on white
  expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5)
  expect(Math.abs(contrast('rgba(0,0,0,0.5)', '#ffffff') - contrast('#808080', '#ffffff')) < 0.05).toBe(true)
  expect(labelIssues('Compact and switch to Sonnet')).toEqual([])
  expect(labelIssues('Open Board')).toEqual(['Title Case (use sentence case)'])
  expect(labelIssues('click here.')).toEqual(['starts lower case', 'ends with a stop', 'says "click"'])
  expect(labelIssues('Make 96K my default (every chat, in settings.json)')).toEqual(['longer than 32 cells (50)'])
  expect(numberIssues('saved $0.12 · cache hit 94% · 96K tokens · $0.004')).toEqual([])
  expect(numberIssues('$0.1 and $-2.00 and 5 % and 96.4K and NaN')).toHaveLength(6) // $-2.00 is both a bad amount and a misplaced minus
  expect(numberIssues('$0.123')).toEqual(['money "$0.123" has 3 decimals at $0.10 or more'])
  expect(numberIssues('(about $0.00 each, against $0.02 to re-read it)')).toEqual(['a cost stated as $0.00 (write "under $0.01")'])
  expect(numberIssues('saved $0.00')).toEqual([]) // a saving of nothing is a fact, not a price
  expect(cells('Opus 高')).toBe(7)
  const row = (width: number): Node => ({ type: 'Box', props: { flexDirection: 'row', gap: 2, width }, children: [{ type: 'Text', children: ['● Router'] }, { type: 'Text', props: { wrap: 'truncate-end' }, children: ['Haiku low (auto)'] }, { type: 'Button', props: { label: 'Settings' } }] })
  expect(overfullRows(row(40), 40)).toEqual([])
  expect(overfullRows(row(30), 30)).toEqual([]) // 8 + 2 + 6 + 2 + "[ Settings ]" 12 = 30 cells
  expect(overfullRows(row(29), 29)).toHaveLength(1)
  // the desktop's buttons as measured (2026-11-27): "Settings" is 9 cells of text plus 4 of padding
  const band: Node = { type: 'Box', props: { key: 'router-row', flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }, children: [{ type: 'Text', children: ['● Router'] }, { type: 'Box', props: { flexGrow: 1 } }, { type: 'Button', props: { plain: true, label: 'Stats' } }, { type: 'Button', props: { plain: true, label: 'Settings' } }] }
  expect(oneRowOverflow(band, 27, 'terminal')).toBe(0) // 8 + 5 + 8 + 3 gaps of 2 (the spacer has two) = 27
  expect(oneRowOverflow(band, 26, 'terminal')).toBe(1)
  expect(oneRowOverflow(band, 40, 'desktop')).toBe(0) // 8 + 10 + 13 + 6 = 37
  expect(oneRowOverflow(band, 30, 'desktop')).toBe(7)
  const grouped: Node = { type: 'Box', props: { key: 'router-row', flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }, children: [{ type: 'Box', props: { flexDirection: 'row', columnGap: 2 }, children: [{ type: 'Text', props: { wrap: 'truncate-end' }, children: ['● Haiku low (auto)'] }] }, { type: 'Box', props: { flexDirection: 'row', columnGap: 2, flexGrow: 1 }, children: [{ type: 'Button', props: { plain: true, label: 'Stats' } }] }] }
  expect(oneRowOverflow(grouped, 25, 'terminal')).toBe(0) // the model in full (18) + 2 + 5: nested truncating text counts whole
  expect(oneRowOverflow(grouped, 24, 'terminal')).toBe(1)
  // steadiness: one frame per choice, no child margins in a gapped row, tabular digits in the band, no doubled words
  const pick = (plain: boolean): Node => ({ type: 'Box', props: { key: 'router-model', flexDirection: 'row', columnGap: 2 }, children: [{ type: 'Button', props: { key: 'router-model-auto', variant: 'primary', label: 'Auto' } }, { type: 'Button', props: { key: 'router-model-opus', ...(plain ? { plain: true } : {}), label: 'Opus' } }, { type: 'Button', props: { key: 'router-model-no', plain: true, label: 'Not now' } }, { type: 'Button', props: { key: 'router-hide', plain: true, label: 'Hide' } }] })
  expect(choiceIssues(pick(true))).toHaveLength(1)
  expect(choiceIssues(pick(false))).toEqual([]) // "Not now" is a way out, "Hide" another group
  expect(marginIssues({ type: 'Box', props: { flexDirection: 'row', gap: 2 }, children: [{ type: 'Box', props: { marginRight: 2 }, children: ['x'] }] })).toHaveLength(1)
  expect(marginIssues({ type: 'Box', props: { flexDirection: 'column', gap: 1 }, children: [{ type: 'Box', props: { marginLeft: 13 }, children: ['x'] }] })).toEqual([])
  expect(tabularIssues({ type: 'Box', children: [{ type: 'Text', children: ['saved $1.07'] }, { type: 'Button', props: { label: '60m left' } }] })).toHaveLength(2)
  expect(tabularIssues({ type: 'Box', children: [{ type: 'Text', props: { tabular: true }, children: ['saved $1.07'] }, { type: 'Button', children: [{ type: 'Text', props: { tabular: true }, children: ['60 min'] }] }, { type: 'Text', children: ['Stats'] }] })).toEqual([])
  expect(repeatIssues('Cache time left', '60 min left')).toHaveLength(1)
  expect(repeatIssues('Cache warm', '60 min left')).toEqual([])
  expect(labelIssues('Nudges off')).toEqual(['reads as a state, not an action'])
  expect(labelIssues('Off')).toEqual([])
  const wrapping: Node ={ type: 'Box', props: { flexDirection: 'row', flexWrap: 'wrap' }, children: [{ type: 'Button', props: { label: 'Make 96K my default for every chat' } }] }
  expect(overfullRows(wrapping, 40)).toEqual([]) // 34 + 4 cells: fits on its own line
  expect(overfullRows(wrapping, 37)).toHaveLength(1)
})
