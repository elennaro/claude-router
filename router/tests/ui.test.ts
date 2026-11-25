import { expect, test } from 'claude-code/testing'

declare const console: { log: (line: string) => void } // the test runner prints it; the strict config has no DOM or Node types

import { type Node, cells, contrast, labelIssues, numberIssues, overfullRows, textOf, walk } from './uikit'

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
  })
  out.push(...overfullRows(tree, width, surface))
  return [...new Set(out)].map(x => `${state} · ${surface} · ${width}: ${x}`).filter(x => !KNOWN.some(k => k.test(x)))
}
// Findings seen when the kit landed and not fixed yet: a ratchet. A fix deletes its line; nothing is ever added here.
const KNOWN: Array<RegExp> = []

// One session per state, the band mounted at every width on both surfaces that draw it.
async function states($: any, on: any, routing: string, setup: ($: any) => Promise<void>, presses: Array<[string, string | undefined]>): Promise<Array<string>> {
  wire(on, { '/home/.claude/routing.json': routing })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await setup($)
  const issues: Array<string> = []
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      const band = await $.ui.mount({ plugin: 'router', component: 'AbovePrompt', surface, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: width, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
      for (const [state, key] of presses) {
        if (key) await band.press({ key })
        issues.push(...audit(await band.drawn(), state, surface, width))
      }
      const open = presses.map(p => p[1]).filter(k => k === 'router-stats' || k === 'router-settings' || k === 'router-switches').at(-1)
      if (open && (await band.find({ key: open }))) await band.press({ key: open }) // close the panel left open
      await band.unmount()
    }
  }
  return issues
}

const stepped = async ($: any) => {
  await $.prompt.submit({ text: 'Swap every variable called foo for bar in the utils module and the tests too' })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) { /* drain */ }
}

test('the band, Stats and Settings fit 40 to 120 cells, with sentence-case labels and clean numbers', async (engine, on) => {
  const issues = await states(engine as any, on, ROUTING, stepped, [['band', undefined], ['stats', 'router-stats'], ['settings', 'router-settings']])
  expect(issues).toEqual([])
})

test('Training on: the Switches list with its 👍 👎 fits every width', async (engine, on) => {
  const presses: Array<[string, string | undefined]> = [['settings', 'router-settings'], ['training on', 'router-f-labels-on'], ['band', 'router-settings'], ['switches', 'router-switches']]
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
  const wrapping: Node = { type: 'Box', props: { flexDirection: 'row', flexWrap: 'wrap' }, children: [{ type: 'Button', props: { label: 'Make 96K my default for every chat' } }] }
  expect(overfullRows(wrapping, 40)).toEqual([]) // 34 + 4 cells: fits on its own line
  expect(overfullRows(wrapping, 37)).toHaveLength(1)
})
