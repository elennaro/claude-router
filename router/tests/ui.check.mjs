// UI checks for what view.ts draws (the Stats card, the rail bars, the Board) and, with --trees, the band and Settings
// as the plugin tests draw them. No model calls, built-ins only. Run from anywhere:
//   node tests/ui.check.mjs                 wording, numbers, snapshots; with Chrome or Edge: fit, overlap, contrast,
//                                           sideways scroll and target size at 500/800/1200 px, light and dark
//   node tests/ui.check.mjs --update        rewrite the snapshots after a change you meant
//   node tests/ui.check.mjs --shots <dir>   also save a PNG of every surface, width and theme into <dir>
//   node tests/ui.check.mjs --trees         also run the plugin tests and lay out their band and Settings trees
//   node tests/ui.check.mjs --test          self-check of the parsers
// Exit 1 on any finding. The rules and their reasons: the router-uiux skill; the rule code: tests/uikit.ts.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SNAP = join(HERE, 'ui-snapshots')
const args = process.argv.slice(2)
const flag = f => args.includes(f)
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : undefined
const view = await import(pathToFileURL(join(ROOT, 'hooks', 'view.ts')).href)
const kit = await import(pathToFileURL(join(HERE, 'uikit.ts')).href)

// ---- fixtures: one fixed chat, so every run draws the same pictures ----
const C = (input, read, write) => ({ input, read, write })
const MODELS = [['opus', 'medium'], ['haiku', 'low'], ['sonnet', 'high'], ['opus', 'high'], ['haiku', 'medium'], ['sonnet', 'medium'], ['fable', 'max'], ['opus', 'low']]
const TURNS = Array.from({ length: 26 }, (_, i) => {
  const [model, effort] = MODELS[i % MODELS.length]
  const base = 0.02 + ((i * 37) % 11) / 20
  const usd = i % 5 === 0 ? base * 1.3 : i % 7 === 0 ? base : base * (0.15 + ((i * 13) % 7) / 10)
  return { id: `t${i}`, who: i % 4 === 3 ? 'router:document-reader' : 'main', cls: ['scoped-code', 'explore', 'code-review', 'mechanical'][i % 4], model, effort, picker: '', usd, baseUsd: base, steps: 1 + (i % 3), cache: i % 9 === 4 ? C(80_000, 2_000, 9_000) : C(300, 95_000 - i * 100, 1_200) }
})
const MIX = { 'haiku:low': { usd: 0.42, steps: 11, cache: C(2_000, 300_000, 9_000) }, 'sonnet:high': { usd: 1.37, steps: 8, cache: C(3_000, 410_000, 20_000) }, 'opus:medium': { usd: 4.12, steps: 14, cache: C(9_000, 900_000, 60_000) }, 'opus:high': { usd: 0.88, steps: 3, cache: C(1_000, 120_000, 5_000) }, 'fable:max': { usd: 0.31, steps: 1, cache: C(500, 40_000, 2_000) } }
const TALLY = { actualUsd: 7.1, baselineUsd: 9.45, extraUsd: 0.61, by: { model: { saved: 1.9, extra: 0 }, effort: { saved: 0.7, extra: 0.42 }, agents: { saved: 0.36, extra: 0 }, router: { saved: 0, extra: 0.19 } } }
const CELLS = [
  { label: 'This chat', value: view.netWords(TALLY), isExtra: view.isExtra(TALLY), sub: `${view.money(view.savedUsd(TALLY))} saved, ${view.money(TALLY.extraUsd)} extra` },
  { label: 'This project', value: '$12.43 extra', isExtra: true, sub: '18% more since 3 Nov' },
  { label: 'Now', value: 'Sonnet xhigh (you asked)', swatch: 'sonnet:xhigh', sub: 'task: architecture-review' },
  { label: 'Spent this chat', value: view.money(TALLY.actualUsd), sub: 'cache hit 99.4%' },
  { label: 'Cache', value: '184K tokens', sub: `${view.cacheClock(1, 1 + 23 * 60_000)} · rebuild $2.76` },
  { label: 'Where it went', ...view.whyWords(TALLY.by) },
  { label: 'Keep awake', value: 'saved $3.10', sub: 'nudge in 41 min · nudges $0.18' },
]
const DAY = 864e5
const today = new Date(2026, 10, 25, 12)
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const BUCKETS = Array.from({ length: 14 }, (_, i) => ({
  day: iso(new Date(today.getTime() - (i % 6) * DAY)), project: ['billing-service', 'docs-site', 'a-project-with-a-very-long-folder-name'][i % 3], session: `s${i % 7}`,
  label: ['Fix the flaky retry test in the payments worker', 'Write the migration guide', 'Why does the cache miss after an hour away from the keyboard'][i % 3],
  first: today.getTime() - i * 3_600_000, last: today.getTime() - i * 3_000_000, turns: 3 + i,
  byModel: { opus: { usd: 1.2 + i / 10, base: 1.9 + i / 9, extra: 0.1, steps: 9, cache: C(900, 90_000, 4_000) }, haiku: { usd: 0.08, base: 0, extra: 0.08, steps: 4, cache: C(200, 9_000, 800) }, ...(i % 2 ? { sonnet: { usd: 0.6, base: 0.5, extra: 0.1, steps: 3 } } : {}) },
  agents: { 'router:web-researcher': { runs: 2, routed: 2, respawned: 0, usd: 0.21, base: 0.6, extra: 0 }, Explore: { runs: 1, routed: 0, respawned: 1, usd: 0.4, base: 0.38, extra: 0.02 } },
  ...(i === 2 ? { awake: { nudges: 3, usd: 0.12, saved: 1.4 } } : {}),
}))
const VERSIONS = { at: 0, tools: { claude: { have: '2.1.321', latest: '2.1.330', isBehind: true }, codex: { have: '0.9.1', latest: '0.9.1', isBehind: false }, antigravity: { isBehind: false } } }

// ---- surfaces ----
const WIDTHS = [500, 800, 1200] // px: a narrow window, a laptop, a wide screen
const statsAt = px => { const l = view.cardLayout(Math.floor(px / 8)); return view.statsSvg(CELLS, TURNS, l.width, l.perRow, MIX, '5 turns, 3 agents re-routed') }
const SURFACES = [
  ...WIDTHS.map(px => ({ name: `stats-${px}`, kind: 'svg', px: Math.max(px, view.svgSize(statsAt(px)).width + 32), src: statsAt(px) })), // the window holds the card and the page margin
  { name: 'stats-pane', kind: 'svg', px: 400, src: view.statsSvg(CELLS, TURNS, 360, 2, MIX, '5 turns, 3 agents re-routed') },
  { name: 'rail-bars', kind: 'svg', px: 260, src: view.barsSvg(TURNS, 220, 24) },
  ...WIDTHS.map(px => ({ name: `board-${px}`, kind: 'html', px, src: view.boardHtml(BUCKETS, TURNS, 's1', 'Opus', '25 Nov 2026, 12:00', '1 Oct', VERSIONS, 'checked 25 Nov') })),
]
// Where an SVG card sits: the app's own backgrounds. shortcut: Claude's light and dark greys as of 2026-11; measure
// the app if its theme changes.
const BACKS = { light: ['#ffffff', '#faf9f5'], dark: ['#262624', '#1f1e1d', '#30302e'] }

const findings = []
const add = (where, what) => findings.push(`${where}: ${what}`)

// ---- static checks: no browser ----
const texts = svg => [...svg.matchAll(/<(text|title)[^>]*>([^<]*)</g)].map(m => m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
function staticChecks() {
  for (const s of SURFACES.filter(x => x.kind === 'svg')) for (const t of texts(s.src)) for (const i of kit.numberIssues(t)) add(s.name, `"${t.slice(0, 60)}": ${i}`)
  for (const c of CELLS) for (const i of kit.labelIssues(c.label, kit.LIMITS.label)) add('stats cell label', `"${c.label}": ${i}`)
  // words the plugin builds outside a surface, with the numbers they carry
  const words = [
    view.coldWords({ cache: 184_000, resume: 2.76, extra: 0.31, perStep: 0.42, payback: 2 }),
    view.awayWords({ pings: 3, usd: 0.12, rebuild: 2.76, compacted: false }, 4), view.awayWords({ pings: 1, usd: 0.04, rebuild: 2.76, compacted: true }, 4),
    view.awayWords({ pings: 2, usd: 0.08, rebuild: 2.76, compacted: false, back: true, saved: 2.1 }, 4), view.switchCost(1.234, false),
    view.netWords({ actualUsd: 1, baselineUsd: 1.004, extraUsd: 0 }), view.netWords({ actualUsd: 1.5, baselineUsd: 1, extraUsd: 0.5 }), view.money(-0.001), view.money(-3),
  ]
  for (const w of words) for (const i of kit.numberIssues(w)) add('words', `"${w.slice(0, 60)}": ${i}`)
  for (const s of SURFACES.filter(x => x.kind === 'html')) {
    const body = s.src.replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, '').replace(/<[^>]+>/g, ' ')
    for (const i of kit.numberIssues(body)) add(s.name, i)
  }
}

// ---- snapshots ----
function snapshots() {
  mkdirSync(SNAP, { recursive: true })
  for (const s of SURFACES.filter(x => !/^board-(800|1200)$/.test(x.name))) { // one Board: the page is the same at every width
    const file = join(SNAP, `${s.name.replace(/-\d+$/, x => (s.kind === 'html' ? '' : x))}.${s.kind}`)
    const now = s.src.replace(/></g, '>\n<') + '\n' // one tag a line, so a diff names the part that moved
    if (flag('--update') || !existsSync(file)) { writeFileSync(file, now); continue }
    const was = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    if (was === now) continue
    const [a, b] = [was.split('\n'), now.split('\n')]
    const i = a.findIndex((l, k) => l !== b[k])
    const [x, y] = [a[i] ?? '', b[i] ?? '']
    const c = [...x].findIndex((ch, k) => ch !== y[k]), from = Math.max(0, (c < 0 ? Math.min(x.length, y.length) : c) - 30)
    add(`snapshot ${s.name}`, `changed at line ${i + 1}: "…${x.slice(from, from + 70)}" → "…${y.slice(from, from + 70)}" (run with --update if meant)`)
  }
}

// ---- the browser: real fonts, real layout ----
function chromePath() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const fixed = [
    ...pf.flatMap(p => [join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  const onPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(d => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(n => join(d, n)))
  return [...fixed, ...onPath].find(f => existsSync(f))
}
const run = (bin, argv) => new Promise(res => execFile(bin, argv, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, out) => res(err && !out ? '' : String(out))))
const chromeArgs = (theme, w, h, dir) => ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${dir}`, `--window-size=${w},${h}`, '--force-device-scale-factor=1', '--virtual-time-budget=1500', ...(theme === 'dark' ? ['--force-dark-mode', '--blink-settings=preferredColorScheme=0'] : ['--blink-settings=preferredColorScheme=1'])]

// Runs in the page: measures what a person would see, writes JSON into #ui-out. Kept as a string so this file has
// no DOM types. Text boxes come from getBBox (SVG) and getBoundingClientRect (HTML), with the page's own fonts.
const MEASURE = `
(() => {
  const L = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const P = s => (s.match(/[\\d.]+/g) || []).map(Number)
  const lum = ([r, g, b]) => 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(b)
  const blend = (f, b) => { const a = f[3] ?? 1; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)) }
  const ratio = (f, b) => { const x = lum(blend(f, b)), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3) } return null }
  const out = { dark: matchMedia('(prefers-color-scheme: dark)').matches, w: innerWidth, sw: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, svgs: [], html: [] }
  const backs = JSON.parse(document.body.dataset.backs || '[]').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)))
  for (const svg of document.querySelectorAll('svg[data-name]')) {
    const W = +svg.getAttribute('width'), H = +svg.getAttribute('height')
    const items = [...svg.querySelectorAll('text')].map(t => { const b = t.getBBox(); const cs = getComputedStyle(t); return { t: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height, fill: P(cs.fill), px: parseFloat(cs.fontSize), wt: +cs.fontWeight || 400 } })
    const marks = [...svg.querySelectorAll('rect[class^="m-"]')].map(r => ({ c: r.getAttribute('class'), fill: P(getComputedStyle(r).fill) }))
    out.svgs.push({ name: svg.dataset.name, W, H, items, marks, worst: items.map(i => Math.min(...backs.map(b => ratio(i.fill, b)))) })
  }
  if (!document.querySelector('svg[data-name]')) {
    const leaves = [...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 1 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    for (const e of leaves) {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
      const bg = bgOf(e) || [255, 255, 255]
      out.html.push({ tag: e.tagName.toLowerCase(), cls: e.className || '', t: e.textContent.trim().slice(0, 60), x: r.left, y: r.top, w: r.width, h: r.height, px: parseFloat(cs.fontSize), wt: +cs.fontWeight || 400, cr: ratio(P(cs.color), bg), clip: e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' })
    }
    out.targets = [...document.querySelectorAll('button, a[href], input, select')].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), w: r.width, h: r.height } })
    out.scrollers = [...document.querySelectorAll('.card')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.previousElementSibling?.textContent || 'a card')
  }
  const pre = document.createElement('pre'); pre.id = 'ui-out'; pre.hidden = true; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
})()`
const page = (s, theme) => (s.kind === 'html'
  ? s.src.replace('<body>', `<body data-backs='[]'>`).replace('</body>', `<script>${MEASURE}</script></body>`)
  : `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:16px;background:${BACKS[theme][0]}}</style></head><body data-backs='${JSON.stringify(BACKS[theme])}'>${s.src.replace('<svg ', `<svg data-name="${s.name}" `)}<script>${MEASURE}</script></body></html>`)
const box = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5

function judge(s, theme, m) {
  const at = `${s.name} ${theme}`
  if (m.dark !== (theme === 'dark')) add(at, `the browser did not take the ${theme} theme; contrast not checked`)
  for (const v of m.svgs) {
    v.items.forEach((a, i) => {
      if (a.x < -1.5 || a.y < -1.5 || a.x + a.w > v.W + 1.5 || a.y + a.h > v.H + 1.5) // 1.5 px: a glyph's side bearing is no clipping add(at, `"${a.t}" runs outside the card (${Math.round(a.x)}..${Math.round(a.x + a.w)} of ${v.W} px)`)
      for (const b of v.items.slice(i + 1)) if (box(a, b)) add(at, `"${a.t}" overlaps "${b.t}"`)
      const need = kit.isLarge(a.px, a.wt) ? kit.MIN_LARGE : kit.MIN_TEXT
      if (m.dark === (theme === 'dark') && v.worst[i] < need) add(at, `"${a.t}" contrast ${v.worst[i].toFixed(2)}:1, needs ${need}:1`)
    })
  }
  if (!m.svgs.length) {
    if (m.sw > m.w + 1) add(at, `the page scrolls sideways (${m.sw} px in ${m.w})`)
    for (const c of m.scrollers ?? []) add(at, `the "${c.slice(0, 30)}" table scrolls sideways`)
    for (const e of m.html) {
      const need = kit.isLarge(e.px, e.wt) ? kit.MIN_LARGE : kit.MIN_TEXT
      if (m.dark === (theme === 'dark') && e.cr < need) add(at, `"${e.t}" (${e.tag}${e.cls ? '.' + e.cls : ''}) contrast ${e.cr.toFixed(2)}:1, needs ${need}:1`)
      if (e.clip) add(at, `"${e.t}" is clipped without an ellipsis`)
      if (e.x + e.w > m.w + 1) add(at, `"${e.t}" runs past the right edge`)
    }
    for (const t of m.targets ?? []) if (t.w < 24 || t.h < 24) add(at, `target "${t.t}" is ${Math.round(t.w)}x${Math.round(t.h)} px, under 24x24`)
  }
}

async function browserChecks(chrome, extra = []) {
  const tmp = mkdtempSync(join(tmpdir(), 'router-ui-'))
  try {
    const jobs = [...SURFACES, ...extra].flatMap(s => ['light', 'dark'].map(theme => ({ s, theme })))
    await Promise.all(jobs.map(async ({ s, theme }, k) => {
      const file = join(tmp, `${s.name}-${theme}.html`)
      writeFileSync(file, s.kind === 'tree' ? s.src : page(s, theme))
      const prof = join(tmp, `p${k}`)
      const dom = await run(chrome, [...chromeArgs(theme, s.px, 900, prof), '--dump-dom', pathToFileURL(file).href])
      const json = dom.match(/<pre id="ui-out"[^>]*>([^<]*)<\/pre>/)?.[1]
      if (!json) return add(`${s.name} ${theme}`, 'the browser gave no measurements')
      const m = JSON.parse(json.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      ;(s.judge ?? judge)(s, theme, m)
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true })
        const h = Math.min(4000, Math.ceil(m.h + 8))
        await run(chrome, [...chromeArgs(theme, s.px, h, prof), `--screenshot=${join(shotsDir, `${s.name}-${theme}.png`)}`, pathToFileURL(file).href])
      }
    }))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ---- --trees: the band and Settings as the plugin tests draw them, laid out in a terminal-like grid ----
// shortcut: an approximation of the terminal's paint (monospace cells, Ink-like flex rules), not Ink itself; the
// plugin tests' own row budget (uikit overfullRows) stays the rule, this adds a look and a second, real-flex opinion.
const TERM = { dark: { bg: '#1e1e1e', fg: '#d4d4d4', success: '#4eba65', warning: '#e5b567', inactive: '#808080', accent: '#d97757', dim: 0.6 }, light: { bg: '#ffffff', fg: '#1f1f1f', success: '#2e7d32', warning: '#9a6700', inactive: '#6e6e6e', accent: '#b85a3a', dim: 0.66 } }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function treeHtml(n, surface) {
  if (typeof n === 'string') return esc(n)
  const p = n.props ?? {}
  const kids = (n.children ?? []).map(c => treeHtml(c, surface)).join('')
  const sp = v => (v === 'sm' ? 0.5 : v === 'md' ? 1 : v === 'lg' ? 2 : Number(v ?? 0))
  if (n.type === 'Box') {
    const row = p.flexDirection === 'row'
    const st = [`display:flex`, `flex-direction:${row ? 'row' : 'column'}`, p.width !== undefined ? `width:${p.width}ch;max-width:${p.width}ch` : '', p.gap !== undefined ? (row ? `column-gap:${sp(p.gap)}ch` : `row-gap:${sp(p.gap) * 1.25}em`) : '', p.rowGap !== undefined ? `row-gap:${sp(p.rowGap) * 1.25}em` : '', p.columnGap !== undefined ? `column-gap:${sp(p.columnGap)}ch` : '', p.marginLeft ? `margin-left:${p.marginLeft}ch` : '', p.marginRight ? `margin-right:${p.marginRight}ch` : '', p.flexGrow ? `flex-grow:${p.flexGrow}` : '', p.flexShrink !== undefined ? `flex-shrink:${p.flexShrink}` : '', p.flexWrap ? `flex-wrap:${p.flexWrap}` : '', p.alignItems ? `align-items:${p.alignItems}` : '', 'min-width:0']
    return `<div class="box" data-key="${esc(p.key ?? '')}" style="${st.filter(Boolean).join(';')}">${kids}</div>`
  }
  if (n.type === 'Text') {
    const st = [p.color ? `color:${/^#/.test(p.color) ? p.color : `var(--${p.color})`}` : '', p.dimColor ? 'opacity:var(--dim)' : '', p.bold ? 'font-weight:700' : '', p.wrap === 'truncate-end' ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex-shrink:1' : p.wrap === 'wrap' || p.wrap === undefined ? 'white-space:normal' : 'white-space:nowrap']
    return `<span class="text" style="${st.filter(Boolean).join(';')}">${kids}</span>`
  }
  if (n.type === 'Button') {
    const label = p.label !== undefined ? esc(p.label) : kids
    const st = [p.dimColor ? 'opacity:var(--dim)' : '', p.variant === 'primary' && !p.plain ? 'color:var(--accent)' : '', 'white-space:nowrap;flex-shrink:0']
    return `<span class="button" style="${st.filter(Boolean).join(';')}">${p.plain ? label : `[ ${label} ]`}</span>`
  }
  if (n.type === 'Svg' && surface === 'desktop') return `<img alt="" src="data:image/svg+xml;base64,${Buffer.from(String(p.source)).toString('base64')}" width="${p.width ?? ''}">`
  return kids
}
async function treeSurfaces() {
  const out = await runTests()
  const seen = new Set()
  const list = []
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('UI-TREE ')) continue
    const { state, surface, width, tree } = JSON.parse(line.slice(8))
    const name = `band-${state}-${surface}-${width}`.replace(/\+/g, '-')
    if (surface !== 'terminal' || seen.has(name)) continue // the desktop paints natively; this mock is the terminal's
    seen.add(name)
    list.push({ name, kind: 'tree', px: width * 9 + 32, src: '', tree, width, judge: treeJudge })
  }
  return list
}
function runTests() {
  return new Promise(res => execFile('claude', ['plugin', 'test', '.'], { cwd: ROOT, timeout: 600_000, maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (_e, out, err) => res(String(out) + String(err))))
}
const TREE_MEASURE = `
(() => {
  const band = document.querySelector('#band').getBoundingClientRect()
  const bad = []
  for (const e of document.querySelectorAll('.text, .button')) {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
    if (r.width === 0) continue
    if (r.right > band.right + 1) bad.push('"' + e.textContent.slice(0, 50) + '" runs past the band edge')
    if (cs.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible') bad.push('"' + e.textContent.slice(0, 50) + '" is clipped')
  }
  const pre = document.createElement('pre'); pre.id = 'ui-out'; pre.hidden = true; pre.textContent = JSON.stringify({ dark: matchMedia('(prefers-color-scheme: dark)').matches, h: document.documentElement.scrollHeight, bad }); document.body.appendChild(pre)
})()`
for (const t of ['dark', 'light']) TERM[t].css = Object.entries(TERM[t]).filter(([k]) => k !== 'css').map(([k, v]) => `--${k}:${v}`).join(';')
const treePage = s => `<!doctype html><html><head><meta charset="utf-8"><style>:root{${TERM.light.css}}@media (prefers-color-scheme:dark){:root{${TERM.dark.css}}}body{margin:16px;background:var(--bg);color:var(--fg);font:14px/1.25 Consolas,'Cascadia Mono',Menlo,'DejaVu Sans Mono',monospace}#band{width:${s.width}ch;outline:1px dashed color-mix(in srgb,var(--fg) 25%,transparent)}</style></head><body>${`<div id="band">${treeHtml(s.tree, 'terminal')}</div>`}<script>${TREE_MEASURE}</script></body></html>`
function treeJudge(s, theme, m) { for (const b of m.bad ?? []) add(`${s.name} ${theme}`, b) }

// ---- --test: the parsers on fixed input ----
function selfTest() {
  const svg = '<svg><text class="l" x="0" y="1">A &amp; B</text><g><title>Cache hit 99.4%</title></g></svg>'
  const t = texts(svg)
  if (t.join('|') !== 'A & B|Cache hit 99.4%') throw new Error(`texts: ${t.join('|')}`)
  const h = treeHtml({ type: 'Box', props: { flexDirection: 'row', width: 40, gap: 2 }, children: [{ type: 'Text', props: { wrap: 'truncate-end' }, children: ['a<b'] }, { type: 'Button', props: { label: 'Go', plain: true } }] }, 'terminal')
  if (!h.includes('width:40ch') || !h.includes('a&lt;b') || !h.includes('>Go<') || !h.includes('text-overflow:ellipsis')) throw new Error(`treeHtml: ${h}`)
  if (!box({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }) || box({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })) throw new Error('box overlap')
  console.log('ui.check self-test: ok')
}

if (flag('--test')) { selfTest(); process.exit(0) }
const t0 = Date.now()
staticChecks()
snapshots()
const chrome = chromePath()
const trees = flag('--trees') ? await treeSurfaces() : []
for (const s of trees) s.src = treePage(s)
if (chrome) await browserChecks(chrome, trees)
else console.log('ui.check: no Chrome or Edge found (set CHROME=<path>); layout, contrast and target checks skipped')
// Findings seen when the kit landed and not fixed yet: a ratchet. A fix deletes its line; nothing is ever added here.
const KNOWN = [
]
const unique = [...new Set(findings)]
const known = unique.filter(f => KNOWN.some(k => k.test(f)))
const fresh = unique.filter(f => !known.includes(f))
for (const f of fresh) console.log(`  ${f}`)
if (flag('--known')) for (const f of known) console.log(`  (known) ${f}`)
console.log(`ui.check: ${fresh.length ? `${fresh.length} finding(s)` : 'ok'}${known.length ? `, ${known.length} known (--known lists them)` : ''} (${SURFACES.length + trees.length} surfaces${chrome ? ', light and dark' : ''}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
process.exit(fresh.length ? 1 : 0)
