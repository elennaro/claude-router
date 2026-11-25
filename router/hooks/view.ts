// Pure drawing helpers for the band, the widget and the board: no `$`, so tests call them directly.

import type { Bucket, By, Cache, Mix, Tally, Tool, TurnLog, Versions, Why } from '../types'

export const money = (n: number) => (n <= -0.005 ? `-$${(-n).toFixed(2)}` : `$${Math.max(0, n).toFixed(2)}`) // no "-$0.00" from rounding
// A price in a sentence: "about $0.02", or "under $0.01" where money() would say a cost of $0.00.
export const about = (n: number) => (n > 0 && n < 0.005 ? 'under $0.01' : `about ${money(n)}`)
// What a switch offer says it costs: the new model writes the chat to its own cache once (less after compacting).
// The offer after an hour away: resuming re-reads everything anyway; compacting first adds a little and saves per step.
export const coldWords = (c: { cache: number; resume: number; extra: number; perStep: number; payback: number }) =>
  `You were away over an hour, so the cache expired: your next message re-reads the whole chat (${Math.round(c.cache / 1000)}K tokens, about ${money(c.resume)}) either way. Compacting first adds about ${money(c.extra)}, then saves about ${money(c.perStep)} a step, paying back in about ${c.payback} steps. The summary keeps the goal, plan, decisions and files, but loses detail.`
// Keep-awake's report while you were away: what the nudges cost against re-reading the chat, and the compaction if any.
export const STOP_WORDS = { done: 'the work looked finished', unlikely: 'a return at these hours is too unlikely to pay for more' } as const
export const awayWords = (a: { pings: number; usd: number; rebuild: number; compacted: boolean; back?: boolean; saved?: number; stop?: keyof typeof STOP_WORDS }, hours: number) =>
  a.stop && !a.back
    ? `While you were away the router kept this chat's cache warm: ${a.pings} ${a.pings === 1 ? 'nudge' : 'nudges'} for ${money(a.usd)}, then stopped: ${STOP_WORDS[a.stop]}${a.compacted ? '. It compacted the chat into a handoff first' : ''}.`
    : a.back && !a.compacted
    ? `While you were away the router kept this chat's cache warm: ${a.pings} ${a.pings === 1 ? 'nudge' : 'nudges'} for ${money(a.usd)}${a.saved ? `, saving about ${money(a.saved)} of re-reading it all` : ' (back within the hour: no re-read was due)'}.`
    : a.compacted
    ? `While you were away the router kept this chat's cache warm for ${hours} hours (${a.pings} ${a.pings === 1 ? 'nudge' : 'nudges'}, ${money(a.usd)}), then compacted it into a handoff while still warm: the summary says what it was doing, where it stopped and the next step.`
    : `While you were away the router kept this chat's cache warm: ${a.pings} ${a.pings === 1 ? 'nudge' : 'nudges'}, ${money(a.usd)} so far, against about ${money(a.rebuild)} to re-read it all on your return.`
export const switchCost = (usd: number | undefined, isNew: boolean) => (usd && !isNew ? ` Switching re-reads the chat: about ${money(usd)} now, less after compacting.` : '')
// Against running with no router: net above 0 saved money, below 0 spent more. Savings and extra spend are kept apart
// step by step (a cheap subagent and a high-effort turn do not cancel out unseen).
export const net = (t: Tally) => t.baselineUsd - t.actualUsd
export const savedUsd = (t: Tally) => Math.max(0, net(t) + t.extraUsd)
export const netPct = (t: Tally) => (t.baselineUsd > 0 ? Math.round((Math.abs(net(t)) / t.baselineUsd) * 100) : 0)
export const isExtra = (t: Tally) => net(t) <= -0.005
// The band's few words: "saved $0.40", or "$0.52 extra" when it spent more than running with no router would have.
export const netWords = (t: Tally, fmt: (usd: number) => string = money) => (isExtra(t) ? `${fmt(-net(t))} extra` : `saved ${fmt(net(t))}`)
// Units: % of the plan's weekly limit, from the API-price dollars that moved it one point on this machine (planRate).
// shortcut: one blended rate for every model (Anthropic publishes no per-model weights); learn one per model if they drift.
export const PLAN_MIN = 3 // points and dollars of this week before the rate is trusted
export const planRate = (spentUsd: number, pct: number) => (pct >= PLAN_MIN && spentUsd >= PLAN_MIN ? spentUsd / pct : undefined)
export const planFmt = (rate: number) => (usd: number) => {
  const p = Math.abs(usd) / rate
  return `≈${p < 0.1 ? p.toFixed(2) : p.toFixed(1)}% of week`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Cut to max characters with "…", never inside a number: "rebuild $2.…" reads as another amount, so the cut steps
// back to the word before it.
// A trailing "(you asked)" or "(auto)" goes first, whole: "Sonnet xhigh" beats "Sonnet xhigh (you …" (hover has all).
const fit = (s: string, max: number): string => {
  if (s.length <= max) return s
  const bare = s.replace(/\s*\([^()]*\)$/, '')
  if (bare !== s && bare.length > 0) return fit(bare, max)
  const cut = s.slice(0, Math.max(1, max - 1))
  const inNumber = /[\d$][\d.,]*$/.test(cut) && /[\d.,%K]/.test(s[cut.length] ?? '')
  return `${((inNumber && cut.replace(/\s*\S+$/, '')) || cut).trimEnd()}…`
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
// Claude's own greys and accent. The image cannot read the app's theme, so it follows the system's.
// shortcut: an app theme that differs from the system theme gets the wrong text color; pass the theme in if that bites.
// .v.x: a value that is spend above the no-router cost; .c: a cache-hit square (its opacity is the hit);
// .hit: an invisible column that takes the hover for its turn; .m-<model>-<effort step>: the model colors (shadeCss).
const STYLE = `.l,.s{fill:#73726c;font:12px ${FONT}}.l,.s,.v{pointer-events:none}.v{fill:#1f1e1d;font:600 18px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.v.x{fill:#b4532c}.c{fill:#1f1e1d}.hit{fill:transparent}@media (prefers-color-scheme:dark){.l,.s{fill:#a3a29b}.v{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.v.x{fill:#e5906f}.c{fill:#ecebe6}}`
let shades: string | undefined // built on first use: the palette constants sit further down
const css = () => STYLE + (shades ??= shadeCss((c, color) => `.${c}{fill:${color}}`, c => `.${c}{stroke:#ffffff73;stroke-width:1}`))

// isExtra: the value reads as spend above running with no router, drawn in the accent.
// swatch: a model and effort ("opus:high") whose color square goes before the value.
// Adds to one reason's saved and extra (a take-back passes a negative saved).
export function addWhy(by: By | undefined, why: Why, saved: number, extra: number): By {
  const o = by?.[why] ?? { saved: 0, extra: 0 }
  return { ...by, [why]: { saved: o.saved + saved, extra: o.extra + extra } }
}

// Short names: they share one Stats cell (about 30 characters a line in a narrow card)
const WHY_WORDS: Record<Why, string> = { model: 'model moves', effort: 'effort', agents: 'subagents', router: 'router calls', paste: 'pastes', awake: 'keep awake' }
// The Stats card's "Where it went": the reason that saved most as the value; the saving, then the extras, under it.
export function whyWords(by: By | undefined): { value: string; sub: string } {
  const rows = Object.entries(by ?? {}) as Array<[Why, { saved: number; extra: number }]>
  const top = (k: 'saved' | 'extra') => rows.filter(([, x]) => x[k] >= 0.005).sort((a, b) => b[1][k] - a[1][k])
  const saved = top('saved'), extra = top('extra')
  if (!saved.length && !extra.length) return { value: 'Nothing moved yet', sub: 'every step ran as with no router' }
  // the biggest extra only: a 4-column cell holds about 32 characters; the Board has every reason
  const extras = extra.length ? `+${money(extra[0]![1].extra)} ${WHY_WORDS[extra[0]![0]]}` : 'no extra spend'
  const best = saved[0]
  const name = best ? WHY_WORDS[best[0]] : ''
  return best ? { value: name[0]!.toUpperCase() + name.slice(1), sub: `saved ${money(best[1].saved)} · ${extras}` } : { value: 'Nothing saved', sub: extras }
}
// A turn's name in the log: the main chat's task, keep-awake's nudges by name, or the subagent's type.
export const whoWords = (t: { who: string; cls: string }) => (t.who === 'main' ? t.cls : t.who === 'awake' ? 'keep awake' : t.who)

export type Cell ={ label: string; value: string; sub: string; isExtra?: boolean; swatch?: string }

// The main chat's cache clock: minutes left of the hour since its last step ('' before any step, 0 once expired),
// and keep-awake's next nudge, 50 minutes after that step.
export const minutesLeft = (lastAt: number, now: number, of: number) => (lastAt ? Math.max(0, Math.ceil((of * 60_000 - (now - lastAt)) / 60_000)) : undefined)
export function cacheClock(lastAt: number, now: number): string {
  const left = minutesLeft(lastAt, now, 60)
  return left === undefined ? '' : left ? `warm ${left} min` : 'expired'
}

// Small turn costs need a third digit, or every bar's tip says $0.00.
const cents = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : money(n))

// ---- model colors ----
// One hue per model, in price order. Checked with the dataviz palette validator (lightness band, chroma, color-blind
// separation, contrast) on the light and the dark surface; names and tooltips carry identity too.
// Opus is Claude's own clay, Fable a ruby, Sonnet a teal, Haiku a green.
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const
const HEX: Record<'light' | 'dark', Record<string, string>> = {
  light: { haiku: '#7A9A2E', sonnet: '#1A8FA8', opus: '#D97757', fable: '#B83A62', other: '#87867f' },
  dark: { haiku: '#80A236', sonnet: '#2394AE', opus: '#D27946', fable: '#BF3F72', other: '#a3a29b' },
}
// Text glyphs (the band, Settings) can't read the theme: the dark set clears 3:1 on dark and is near it on light.
export const modelColor = (model: string) => HEX.dark[family(model)] ?? HEX.dark.other!
const family = (m: string) => MODELS.find(f => m.includes(f)) ?? 'other'

// Effort as darkness, in both themes (owner, 2026-11-20): low is a light tint, medium the model's own color, high and
// max darker. Steps checked with the dataviz ordinal check (monotone, gaps >= 0.06 L). On a dark page the dark steps
// fall under 2:1 against it, so they get a light ring (ringCss) to keep their edges.
export const effortStep = (e: string) => (e === 'low' ? 0 : e === 'high' ? 2 : e === 'xhigh' || e === 'max' ? 3 : 1)
const TINT = { light: 0.3, dark: 0.45 } // low: toward white
const DARKEN = { light: [0.3, 0.55], dark: [0.28, 0.5] } // high, max: toward black
const mixHex = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}
export function shade(model: string, effort: string, mode: 'light' | 'dark' = 'light'): string {
  const hex = HEX[mode][family(model)] ?? HEX[mode].other!
  const step = effortStep(effort)
  if (step === 0) return mixHex(hex, '#ffffff', TINT[mode])
  return step === 1 ? hex : mixHex(hex, '#000000', DARKEN[mode][step - 2]!)
}
// The CSS classes .m-<model>-<step> for both themes, so an SVG or the Board follows the system theme; ring draws the
// light edge the dark steps need on a dark page.
export function shadeCss(rule: (cls: string, color: string) => string, ring: (cls: string) => string): string {
  const all = [...MODELS, 'other']
  const rules = (mode: 'light' | 'dark') => all.flatMap(m => [0, 1, 2, 3].map(st => rule(`m-${m}-${st}`, shade(m, ['low', 'medium', 'high', 'max'][st]!, mode)))).join('')
  return `${rules('light')}@media (prefers-color-scheme:dark){${rules('dark')}${all.flatMap(m => [2, 3].map(st => ring(`m-${m}-${st}`))).join('')}}`
}
const cls = (model: string, effort: string) => `m-${family(model)}-${effortStep(effort)}`

// Cache hit: the share of prompt tokens read from the prompt cache. undefined: nothing recorded (rows before 0.7).
// A warm main chat sits at 99.x%, so from 99 on it keeps one decimal, rounded down: "100%" only when nothing missed.
export function hitPct(c: Cache | undefined): number | undefined {
  const all = c ? c.input + c.read + c.write : 0
  if (!c || all <= 0) return undefined
  const p = (100 * c.read) / all
  return p >= 99 ? Math.floor(p * 10) / 10 : Math.round(p)
}

// An SVG's own width and height, for the Svg element: without them a surface may fit the frame on its own and draw
// the card at a fraction of its size (seen in the desktop app, 0.7.0).
export const svgSize = (svg: string) => {
  const m = svg.match(/^<svg[^>]* width="([\d.]+)" height="([\d.]+)"/)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {}
}

// Cache hit as a bar strength 0..1, by the share that missed, in tenfold steps: hits sit at 95-100%, where a linear
// scale shows nothing, and each missed token costs about 10x a read. 99.9% hit or more = 1, 99% = 2/3, 90% = 1/3, 0% = 0.
const CACHE_H = 20
export function cacheStrength(c: Cache | undefined): number | undefined {
  const all = c ? c.input + c.read + c.write : 0
  if (!c || all <= 0) return undefined
  const miss = Math.max(0.1, (100 * (all - c.read)) / all)
  return Math.min(1, Math.max(0, 1 - Math.log10(miss / 0.1) / 3))
}

// Cost per turn against no router: a bar up for a turn that cost more than with no router, down for one that cost
// less, colored by its model and effort. stripY: where the "cache hit per turn" row goes, its own section, one bar
// per turn in the same column, taller and more solid for a higher hit (cacheStrength; absent: no row).
// Each column's tip names the turn (the desktop draws <title> as a tooltip); the hit area is the whole column.
function divergingBars(turns: Array<TurnLog>, x0: number, y0: number, width: number, half: number, stripY?: number): string {
  const gap = 2
  const r = turns.slice(-Math.max(4, Math.floor(width / (6 + gap))))
  if (r.length === 0) return ''
  const bw = Math.min(20, (width - gap * (r.length - 1)) / r.length)
  const max = Math.max(...r.map(t => Math.abs(t.usd - t.baseUsd)), 1e-9)
  const mid = y0 + half
  let out = `<line class="d" x1="${x0}" y1="${mid + 0.5}" x2="${x0 + width}" y2="${mid + 0.5}"/>`
  r.forEach((t, i) => {
    const x = (x0 + i * (bw + gap)).toFixed(1)
    const d = t.usd - t.baseUsd
    // square-root scale: a $0.004 turn stays visible next to a $0.40 one, and order is kept; a log scale would make
    // them look alike and has no zero for "same". The tooltip has the exact numbers. A same-cost turn is a 2 px tick.
    const h = Math.max(2, Math.sqrt(Math.abs(d) / max) * (half - 1))
    const y = d >= 0 ? mid - h : mid + 1
    const hit = hitPct(t.cache)
    const tip = `${whoWords(t)}: ${nice(t.model)} ${t.effort || ''}. ${cents(t.usd)} spent, ${cents(t.baseUsd)} with no router (${Math.abs(d) < 0.0005 ? 'same' : `${d > 0 ? '+' : '−'}${cents(Math.abs(d))}`})${hit === undefined ? '' : `. Cache hit ${hit}%`}`
    out += `<g><title>${esc(tip)}</title><rect class="hit" x="${x}" y="${y0}" width="${bw.toFixed(1)}" height="${2 * half}"/>`
    out += `<rect class="${cls(t.model, t.effort)}" x="${x}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/></g>`
    const s = cacheStrength(t.cache)
    if (stripY !== undefined && s !== undefined) {
      const ch = 2 + s * (CACHE_H - 2)
      out += `<g><title>Cache hit ${hit}%</title><rect class="c" x="${x}" y="${(stripY + CACHE_H - ch).toFixed(1)}" width="${bw.toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill-opacity="${(0.3 + 0.7 * s).toFixed(2)}"/></g>`
    }
  })
  return out
}

// Just the bars, for the rail widget.
export function barsSvg(turns: Array<TurnLog>, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${css()}</style>${divergingBars(turns, 0, 0, width, height / 2)}</svg>`
}

const pct = (part: number, total: number) => { const p = (100 * part) / total; return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%` }

// This chat's spend as one band, a segment per model and effort in price order, then the legend under it, wrapping
// onto more lines in a narrow card. Returns the drawing and its height.
function modelBand(mix: Mix, x0: number, y0: number, width: number): { svg: string; height: number } {
  const rank = (k: string) => { const [m = '', e = ''] = k.split(':'); return MODELS.indexOf(family(m) as typeof MODELS[number]) * 10 + effortStep(e) }
  const segs = Object.entries(mix).filter(([, v]) => v.usd > 0).sort((a, b) => rank(a[0]) - rank(b[0]))
  const total = segs.reduce((a, [, v]) => a + v.usd, 0)
  if (!total) return { svg: '', height: 0 }
  const gap = 2
  const room = width - gap * (segs.length - 1)
  let x = x0
  let out = ''
  for (const [k, v] of segs) {
    const [m = '', e = ''] = k.split(':')
    const w = Math.max(2, (v.usd / total) * room)
    const hit = hitPct(v.cache)
    const tip = `${nice(family(m))} ${e || ''}: ${money(v.usd)}, ${pct(v.usd, total)} of spend, ${v.steps} ${v.steps === 1 ? 'step' : 'steps'}${hit === undefined ? '' : `, cache hit ${hit}%`}`
    out += `<g><title>${esc(tip)}</title><rect class="hit" x="${x.toFixed(1)}" y="${y0 - 4}" width="${w.toFixed(1)}" height="20"/><rect class="${cls(m, e)}" x="${x.toFixed(1)}" y="${y0}" width="${w.toFixed(1)}" height="12" rx="3"/></g>`
    x += w + gap
  }
  // legend: each model present with its share, then the effort ramp on the right
  const share: Record<string, number> = {}
  for (const [k, v] of segs) { const f = family(k.split(':')[0] ?? ''); share[f] = (share[f] ?? 0) + v.usd }
  // items flow left to right and wrap; the effort ramp is the last item ("effort low" ▪▪▪▪ "max", 136 px)
  const items: Array<{ w: number; draw: (x: number, y: number) => string }> = []
  for (const f of [...MODELS, 'other']) {
    if (!share[f]) continue
    const text = `${nice(f)} ${pct(share[f]!, total)}`
    items.push({ w: 14 + text.length * 6.6, draw: (x, y) => `<rect class="m-${f}-1" x="${x}" y="${y - 9}" width="10" height="10" rx="2"/><text class="s" x="${x + 14}" y="${y}">${esc(text)}</text>` })
  }
  items.push({
    w: 136,
    draw: (x, y) => `<g><title>Effort: a darker color means more effort</title><text class="s" x="${x}" y="${y}">effort low</text>${[0, 1, 2, 3].map(st => `<rect class="m-other-${st}" x="${x + 64 + st * 12}" y="${y - 9}" width="10" height="10" rx="2"/>`).join('')}<text class="s" x="${x + 114}" y="${y}">max</text></g>`,
  })
  let lx = x0
  let ly = y0 + 32
  items.forEach((it, i) => {
    const isRamp = i === items.length - 1
    if (lx > x0 && lx + it.w > x0 + width) { lx = x0; ly += 20 }
    out += it.draw(isRamp && ly === y0 + 32 ? x0 + width - it.w : lx, ly) // on the first line the ramp sits at the right edge
    lx += it.w + 16
  })
  return { svg: out, height: ly - y0 + 4 }
}

// The card's width and columns from the band's width in cells, so a narrow window gets two readable columns
// instead of four shrunken ones. shortcut: assumes about 8 px per cell; measure the slot if a surface reports pixels.
export function cardLayout(bodyColumns: number): { width: number; perRow: number } {
  const width = Math.max(320, Math.min(880, Math.round(bodyColumns * 8)))
  return { width, perRow: width >= 600 ? 4 : 2 }
}

// The Stats card on an 8 px grid, three bands split by hairlines:
// 1. cells in rows of `perRow` (label, value, note at 16/42/60 px down a 72 px row);
// 2. "Models this chat": the spend band and its legend; `right` is the note at the header's end;
// 3. "Cost per turn vs no router": bars up for more, down for less, and the cache-hit squares, with word labels in a
//    left gutter so the chart reads without a legend hunt.
export function statsSvg(cells: Array<Cell>, turns: Array<TurnLog>, width: number, perRow: number, mix: Mix = {}, right = ''): string {
  const rowH = 72
  const colW = width / perRow
  const chars = (per: number, w = colW - 24) => Math.floor(w / per) // what fits at a font's average width
  let body = ''
  cells.forEach((c, i) => {
    const col = i % perRow
    const y = Math.floor(i / perRow) * rowH
    const x = col * colW + (col === 0 ? 0 : 16)
    const vx = c.swatch ? x + 18 : x
    if (col > 0) body += `<line class="d" x1="${col * colW}" y1="${y + 8}" x2="${col * colW}" y2="${y + rowH - 8}"/>`
    body += `<g><title>${esc(`${c.label}: ${c.value}${c.sub ? ` · ${c.sub}` : ''}`)}</title><rect class="hit" x="${x}" y="${y}" width="${colW - 16}" height="${rowH}"/></g><text class="l" x="${x}" y="${y + 16}">${esc(fit(c.label, chars(6.4)))}</text>`
    if (c.swatch) { const [m = '', e = ''] = c.swatch.split(':'); body += `<rect class="${cls(m, e)}" x="${x}" y="${y + 29}" width="12" height="12" rx="3"/>` }
    body += `<text class="v${c.isExtra ? ' x' : ''}" x="${vx}" y="${y + 42}">${esc(fit(c.value, chars(10.4, colW - 24 - (vx - x))))}</text>`
    if (c.sub) body += `<text class="s" x="${x}" y="${y + 60}">${esc(fit(c.sub, chars(6)))}</text>`
  })
  let height = Math.ceil(cells.length / perRow) * rowH
  const section = (title: string, note = '') => {
    body += `<line class="d" x1="0" y1="${height + 8.5}" x2="${width}" y2="${height + 8.5}"/><text class="l" x="0" y="${height + 32}">${esc(title)}</text>`
    if (note) body += `<text class="s" x="${width}" y="${height + 32}" text-anchor="end">${esc(fit(note, chars(6.2, width - title.length * 6.6 - 24)))}</text>`
  }
  const band = modelBand(mix, 0, height + 44, width)
  if (band.svg) {
    section('Models this chat', right)
    body += band.svg
    height += 44 + band.height + 16
  }
  if (turns.length > 1) { // one bar says nothing
    section('Cost per turn vs no router', 'hover for numbers')
    const G = 44 // gutter for the row words; the cache row below keeps the same columns
    const top = height + 44
    const half = 36
    body += `<text class="s" x="0" y="${top + 12}">more</text><text class="s" x="0" y="${top + 2 * half - 2}">less</text>`
    height += 44 + 2 * half + 8
    // the cache row is its own section: it is not spending, it says why a turn cost what it did
    const stripY = turns.some(t => hitPct(t.cache) !== undefined) ? height + 40 : undefined
    body += divergingBars(turns, G, top, width - G, half, stripY)
    if (stripY !== undefined) {
      section('Cache hit per turn', 'taller = more from cache; full at 99.9%')
      height += 40 + CACHE_H + 16
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${css()}</style>${body}</svg>`
}

// A routing.json with its top-level "mode" set, the rest of the file kept as written.
// Throws on a file that is not valid JSON, so a broken file is never overwritten.
// shortcut: finds "mode" by an indented line of its own, which is how these files are written; a one-line file gets a fresh key.
export function withMode(text: string | undefined, mode: 'on' | 'off'): string {
  const fresh = `{\n  "mode": "${mode}"\n}\n`
  if (text === undefined || text.trim() === '') return fresh
  const obj = JSON.parse(text) as Record<string, unknown>
  if (Object.keys(obj).length === 0) return fresh
  const line = /^(\s*)"mode"\s*:\s*"[a-z]*"/m
  if (line.test(text)) return text.replace(line, `$1"mode": "${mode}"`)
  return text.replace('{', `{\n  "mode": "${mode}",`)
}

export const NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }
const nice = (f: string) => NAMES[f] ?? f

// The Board: the ledger's sessions, filtered by time in the page itself, plus this chat's last turns.
// The page is a local file with its data inline, so the filter needs no server.
export const TOOL_NAMES: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }

// Which CLIs are behind: newer models only arrive with a current CLI. The update buttons live in the band's Settings.
function toolsLine(v: Versions | null, priceNote?: string): string {
  if (!v) return ''
  const parts = (Object.keys(TOOL_NAMES) as Array<Tool>).map(k => {
    const x = v.tools[k]
    if (!x?.have) return `${TOOL_NAMES[k]}: not found`
    return x.isBehind ? `<b>${TOOL_NAMES[k]} ${esc(x.have)} → ${esc(x.latest ?? '')}</b>` : `${TOOL_NAMES[k]} ${esc(x.have)}${x.latest ? ' (current)' : ''}`
  })
  const behind = Object.values(v.tools).some(x => x.isBehind)
  return `<p class="tools">${parts.join(' · ')}${behind ? '. Update from Router → Settings in Claude.' : ''}${priceNote ? ` Prices: ${esc(priceNote)}.` : ''}</p>`
}

export function boardHtml(buckets: Array<Bucket>, turns: Array<TurnLog>, session: string, mainName: string, when: string, since: string, tools: Versions | null = null, priceNote?: string): string {
  // Everything the page draws is data, escaped where the page writes it; '<' is escaped here so no value closes the script.
  const data = JSON.stringify({ buckets, turns, session, names: NAMES }).replace(/</g, '\\u003c')
  const M = esc(mainName)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Router spend</title>
<style>
:root{--bg:#faf9f5;--panel:#fff;--text:#141413;--muted:#73726c;--seg-text:#6b6a64;--line:#e8e6dc;--accent:#d97757;--accent-text:#b4532c;--spent:#87867f;--ghost:rgba(135,134,127,.22);--over:#b4532c;--under:#3c7547;--seg:#f0eee6;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--panel:#30302e;--text:#faf9f5;--muted:#a3a29b;--seg-text:#b0afa8;--accent-text:#e8946f;--line:#3e3e38;--spent:#a3a29b;--ghost:rgba(163,162,155,.25);--over:#e8946f;--under:#8cc192;--seg:#3a3a37;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 24px 48px}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
h1{font-size:22px;font-weight:600;margin:0 0 4px}h2{font-size:15px;font-weight:600;margin:28px 0 10px}
p{margin:0;color:var(--muted)}
.range{display:flex;flex-wrap:wrap;gap:2px;background:var(--seg);border-radius:10px;padding:3px}
.range button{font:inherit;font-size:13px;min-height:32px;border:0;background:none;color:var(--seg-text);padding:0 10px;border-radius:7px;cursor:pointer}
.range button:hover{color:var(--text)}
.range button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.range button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin:24px 0 12px}
.kpi>span{display:block;font-size:13px;color:var(--muted)}.kpi b{display:block;font-size:28px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}.kpi small{color:var(--muted);font-size:13px}
.split{max-width:72ch}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th{font-weight:500;color:var(--muted);text-align:left;padding:12px 12px 8px 0;font-size:13px;white-space:nowrap}td{padding:10px 12px 10px 0;border-top:1px solid var(--line)}th:last-child,td:last-child{padding-right:0}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}th.n{text-align:right}.muted{color:var(--muted)}
.over{color:var(--over);font-weight:600}.under{color:var(--under);font-weight:600}
.label{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.proj{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:960px){.label{max-width:200px}.opt2{display:none}}
.now{font-size:12px;color:var(--accent-text);margin-right:8px} /* before the label: the label may be cut, the tag never */
.bar{width:22%;min-width:110px}.meter{position:relative;height:8px}.meter span{position:absolute;left:0;top:0;height:8px;border-radius:4px}.ghost{background:var(--ghost)}.solid{background:var(--spent)}.solid.up{background:var(--accent)}
.mix-row{display:grid;grid-template-columns:96px 1fr 300px;gap:12px;align-items:center;padding:8px 0}.track{height:8px;border-radius:4px;background:var(--line)}.track span{display:block;height:8px;border-radius:4px}
.band{display:flex;gap:2px;height:8px}.band span{border-radius:2px;min-width:2px}.band.big{height:12px;margin:16px 0 4px}.band.big span{border-radius:3px}.band.mini{width:96px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:-1px}
${shadeCss((c, color) => `.${c}{background:${color}}`, c => `.${c}{box-shadow:inset 0 0 0 1px #ffffff73}`)}
.empty{padding:16px 0;color:var(--muted)}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
footer{margin-top:40px;color:var(--muted);font-size:13px;display:grid;gap:8px;max-width:80ch}.tools b{color:var(--accent-text);font-weight:600}
@media (max-width:720px){main{padding:32px 16px 48px}h1{font-size:20px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.kpi b{font-size:24px}.opt{display:none}.label{max-width:180px}.mix-row{grid-template-columns:80px 1fr 110px}.range{width:100%;flex-wrap:nowrap}.range button{flex:1;padding:0}}
@media (pointer:coarse){.range button{min-height:40px}}
</style></head><body><main>
<header><div><h1>Router spend</h1><p>What the router spent, next to the same work with the router off.</p></div>
<div class="range" role="group" aria-label="Time range" id="range"></div></header>
<section class="kpis" aria-label="Totals for the chosen range">
<div class="kpi"><span>Spent</span><b id="spent"></b></div>
<div class="kpi"><span>Without router</span><b id="base"></b></div>
<div class="kpi"><span>Net</span><b id="diff"></b><small id="diff-pct"></small></div>
<div class="kpi"><span>Cache hit</span><b id="hit"></b><small>of prompt tokens</small></div>
</section>
<p class="split" id="split"></p><p class="split" id="awake"></p>
<h2>Sessions <span class="muted" id="count"></span></h2><div class="card"><table><thead><tr><th>Session</th><th class="opt">Project</th><th class="opt">Last active</th><th class="opt">Models</th><th class="n opt">Turns</th><th class="n">Spent</th><th class="n opt opt2">Without router</th><th class="n">Net</th></tr></thead><tbody id="sessions"></tbody></table></div>
<h2>By project</h2><div class="card"><table><thead><tr><th>Project</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Net</th><th class="opt"><span class="sr">Spent against without router</span></th></tr></thead><tbody id="projects"></tbody></table></div>
<h2>Spend by model</h2><div class="card" id="mix"></div>
<h2>Subagents</h2><div class="card"><table><thead><tr><th>Type</th><th class="n">Runs</th><th class="n opt" title="Runs moved off the parent's model">Re-routed</th><th class="n opt">Sent again</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Net</th></tr></thead><tbody id="agents"></tbody></table></div>
<section id="chat" hidden><h2>This chat, turn by turn</h2><div class="card"><table><thead><tr><th>Task</th><th>Model</th><th class="opt">Effort</th><th class="n opt">Cache hit</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Net</th></tr></thead><tbody id="turns"></tbody></table></div></section>
<footer><span>API list prices. On a Max plan this tracks how fast you use your limits, not money.</span>
<span>Without router means each request on the model and effort it asked for (yours, or the parent chat's for a subagent), with the same tokens. A different effort is priced by its measured cost: a high-effort step costs about 1.4 times a medium one, a low one about 0.72 times. The router's own Haiku calls count as extra.</span>
<span>Colors: Haiku green, Sonnet teal, Opus clay, Fable ruby; a darker shade is a higher effort. Cache hit is the share of prompt tokens read from the prompt cache, recorded from version 0.7 on.</span>
<span>Spend recorded before version 0.5 was compared with ${M} at the same tokens, without a saved and extra split.</span>
<span>Days are local; 1d is today. Counting since ${esc(since)}. Updated ${esc(when)}.</span>${toolsLine(tools, priceNote)}</footer>
</main>
<script>
const D = ${data};
const RANGES = [['1d',1],['3d',3],['5d',5],['7d',7],['2w',14],['1m',30],['4m',120],['1y',365],['All',0]];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const money = n => (n < 0 ? '\\u2212$' : '$') + Math.abs(n).toFixed(2);
const cents = n => Math.abs(n) < 0.1 ? '$' + Math.abs(n).toFixed(3) : money(Math.abs(n));
// Against running with no router, in words, as the band says it: "saved $1.20" or "$0.52 extra". A bare "+$30" read as
// a saving (owner case 2026-11-25), so the word carries it and the color repeats it.
function diff(u, b, f) {
  f = f || money;
  const d = u - b;
  if (Math.abs(d) < (f === money ? 0.005 : 0.0005)) return '<span class="muted">same</span>';
  return d > 0 ? '<span class="over">' + f(d) + ' extra</span>' : '<span class="under">saved ' + f(-d) + '</span>';
}
const meter = (u, b, top) => '<div class="meter"><span class="ghost" style="width:' + (b / top * 100).toFixed(1) + '%"></span><span class="solid' + (u > b ? ' up' : '') + '" style="width:' + (u / top * 100).toFixed(1) + '%"></span></div>';
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const sum = b => Object.values(b.byModel).reduce((a, m) => ({ usd: a.usd + m.usd, base: a.base + m.base, extra: a.extra + (m.extra || 0), steps: a.steps + m.steps }), { usd: 0, base: 0, extra: 0, steps: 0 });
const FAMS = ['haiku', 'sonnet', 'opus', 'fable'];
const fam = f => FAMS.includes(f) ? f : 'other';
const step = e => e === 'low' ? 0 : e === 'high' ? 2 : (e === 'xhigh' || e === 'max') ? 3 : 1;
const addC = (a, c) => { if (c) { a.input += c.input; a.read += c.read; a.write += c.write } return a };
const hit = c => { const all = c.input + c.read + c.write; return all > 0 ? Math.round(100 * c.read / all) : null };
const pct = (p, t) => { const x = 100 * p / t; return x > 0 && x < 1 ? '<1%' : Math.round(x) + '%' };
// spend per model as one band, cheapest model first; the title lists the shares
function band(models, cls) {
  const segs = Object.entries(models).filter(e => e[1] > 0).sort((a, b) => FAMS.indexOf(fam(a[0])) - FAMS.indexOf(fam(b[0])));
  const total = segs.reduce((a, e) => a + e[1], 0);
  if (!total) return '';
  const tip = segs.map(e => (D.names[e[0]] || e[0]) + ' ' + pct(e[1], total)).join(', ');
  return '<span class="band ' + cls + '" title="' + esc(tip) + '" role="img" aria-label="' + esc('Spend by model: ' + tip) + '">' + segs.map(e => '<span class="m-' + fam(e[0]) + '-1" style="flex:' + e[1].toFixed(6) + '"></span>').join('') + '</span>';
}
const empty = (cols, text) => '<tr><td colspan="' + cols + '" class="empty">' + text + '</td></tr>';
let pick = '7d';
try { pick = localStorage.getItem('router-range') || pick } catch (e) {}
function draw() {
  const days = (RANGES.find(r => r[0] === pick) || RANGES[3])[1];
  const from = days ? iso(new Date(Date.now() - (days - 1) * 864e5)) : '';
  const rows = D.buckets.filter(b => b.day >= from);
  const sessions = {}, projects = {}, models = {}, agents = {};
  const cache = { input: 0, read: 0, write: 0 };
  const awake = { nudges: 0, usd: 0, saved: 0 };
  let usd = 0, base = 0, extra = 0;
  for (const b of rows) {
    const t = sum(b); usd += t.usd; base += t.base; extra += t.extra;
    const s = sessions[b.session] || (sessions[b.session] = { label: b.label, project: b.project, last: 0, turns: 0, usd: 0, base: 0, models: {} });
    s.label = s.label || b.label; s.last = Math.max(s.last, b.last); s.turns += b.turns; s.usd += t.usd; s.base += t.base;
    const p = projects[b.project] || (projects[b.project] = { usd: 0, base: 0 });
    p.usd += t.usd; p.base += t.base;
    for (const [f, m] of Object.entries(b.byModel)) {
      const x = models[f] || (models[f] = { usd: 0, steps: 0, cache: { input: 0, read: 0, write: 0 } });
      x.usd += m.usd; x.steps += m.steps; addC(x.cache, m.cache); addC(cache, m.cache);
      s.models[f] = (s.models[f] || 0) + m.usd;
    }
    if (b.awake) { awake.nudges += b.awake.nudges; awake.usd += b.awake.usd; awake.saved += b.awake.saved; }
    for (const [k, a] of Object.entries(b.agents || {})) { const g = agents[k] || (agents[k] = { runs: 0, routed: 0, respawned: 0, usd: 0, base: 0 }); for (const f in g) g[f] += a[f] || 0; }
  }
  $('spent').textContent = money(usd);
  $('base').textContent = money(base);
  $('diff').innerHTML = diff(usd, base);
  $('diff-pct').textContent = base > 0 && Math.abs(usd - base) >= 0.005 ? Math.round(Math.abs(usd - base) / base * 100) + '% ' + (usd > base ? 'more' : 'less') + ' than without router' : '';
  $('count').textContent = Object.keys(sessions).length || '';
  const h = hit(cache);
  $('hit').textContent = h === null ? '\\u2013' : h + '%';
  const saved = Math.max(0, base - usd + extra);
  $('split').textContent = rows.length ? 'Saved ' + money(saved) + ' on steps the router made cheaper. Spent ' + money(extra) + ' extra on stronger steps and on its own Haiku calls.' : '';
  $('awake').textContent = awake.nudges ? 'Keep awake: ' + awake.nudges + (awake.nudges === 1 ? ' nudge' : ' nudges') + ' cost ' + money(awake.usd) + ' and saved ' + money(awake.saved) + ' of re-reading idle chats.' : '';
  const ss = Object.entries(sessions).sort((a, b) => b[1].last - a[1].last).slice(0, 60);
  $('sessions').innerHTML = ss.length ? ss.map(([id, s]) => '<tr><td class="label" title="' + esc(s.label) + '">' + (id === D.session ? '<span class="now">this chat</span>' : '') + (esc(s.label) || '<span class="muted">untitled</span>') + '</td><td class="opt proj" title="' + esc(s.project) + '">' + esc(s.project) + '</td><td class="opt muted">' + new Date(s.last).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td><td class="opt">' + band(s.models, 'mini') + '</td><td class="n opt">' + s.turns +'</td><td class="n">' + money(s.usd) + '</td><td class="n muted opt opt2">' + money(s.base) + '</td><td class="n">' + diff(s.usd, s.base) + '</td></tr>').join('') : empty(8, 'No sessions in this range. Pick a longer range above.');
  const ps = Object.entries(projects).sort((a, b) => b[1].usd - a[1].usd);
  const top = Math.max(...ps.map(p => Math.max(p[1].base, p[1].usd)), 1e-9);
  $('projects').innerHTML = ps.length ? ps.map(([name, p]) => '<tr><td>' + esc(name) + '</td><td class="n">' + money(p.usd) + '</td><td class="n muted opt">' + money(p.base) + '</td><td class="n">' + diff(p.usd, p.base) + '</td><td class="bar opt">' + meter(p.usd, p.base, top) + '</td></tr>').join('') : empty(5, 'No spend in this range.');
  const all = Object.values(models).reduce((a, m) => a + m.usd, 0);
  const ms = Object.entries(models).filter(e => e[1].usd > 0 || e[1].steps > 0).sort((a, b) => FAMS.indexOf(fam(a[0])) - FAMS.indexOf(fam(b[0])));
  $('mix').innerHTML = all ? band(Object.fromEntries(ms.map(e => [e[0], e[1].usd])), 'big') + ms.map(([f, m]) => { const c = hit(m.cache); return '<div class="mix-row"><span><span class="sw m-' + fam(f) + '-1"></span>' + esc(D.names[f] || f) + '</span><span class="track"><span class="m-' + fam(f) + '-1" style="width:' + (m.usd / all * 100).toFixed(1) + '%"></span></span><span class="n">' + money(m.usd) + ' \\u00b7 ' + pct(m.usd, all) + '<span class="opt muted"> \\u00b7 ' + m.steps + ' requests' + (c === null ? '' : ' \\u00b7 cache hit ' + c + '%') + '</span></span></div>' }).join('') : '<div class="empty">No spend in this range.</div>';
  const as = Object.entries(agents).sort((a, b) => b[1].runs - a[1].runs);
  $('agents').innerHTML = as.length ? as.map(([k, a]) => '<tr><td>' + esc(k) + '</td><td class="n">' + a.runs + '</td><td class="n opt">' + a.routed + '</td><td class="n opt">' + a.respawned + '</td><td class="n">' + money(a.usd) + '</td><td class="n muted opt">' + money(a.base) + '</td><td class="n">' + diff(a.usd, a.base) + '</td></tr>').join('') : empty(7, 'No subagents in this range.');
  $('range').innerHTML = RANGES.map(r => '<button type="button" data-r="' + r[0] + '" aria-pressed="' + (r[0] === pick) + '">' + r[0] + '</button>').join('');
}
// This chat's turns, newest first: they come from the session, not the ledger, so the range does not filter them.
if (D.turns.length) {
  $('chat').hidden = false;
  $('turns').innerHTML = D.turns.slice().reverse().map(t => '<tr><td>' + esc(t.who === 'main' ? t.cls : t.who === 'awake' ? 'keep awake' : t.who) + '</td><td><span class="sw m-' + fam(t.model) + '-' + step(t.effort) + '"></span>' + esc(D.names[t.model] || t.model) + '</td><td class="opt">' + esc(t.effort || '\\u2013') + (t.picker && t.picker !== t.effort && t.who === 'main' ? ' <span class="muted">(you picked ' + esc(t.picker) + ')</span>' : '') + '</td><td class="n opt">' + (t.cache && hit(t.cache) !== null ? hit(t.cache) + '%' : '<span class="muted">&ndash;</span>') + '</td><td class="n">' + cents(t.usd) + '</td><td class="n muted opt">' + cents(t.baseUsd) + '</td><td class="n">' + diff(t.usd, t.baseUsd, cents) + '</td></tr>').join('');
}
$('range').addEventListener('click', e => { const r = e.target.closest('button'); if (!r) return; pick = r.dataset.r; try { localStorage.setItem('router-range', pick) } catch (x) {} draw() });
draw();
</script></body></html>`
}
