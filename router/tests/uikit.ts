// The UI rules as code: contrast, wording and number checks, and a cell-width budget for the band's rows.
// Pure (no Node, no DOM), so the plugin tests (claude plugin test) and tests/ui.check.mjs (Node) share one copy.
// Each rule says why it exists; a change here changes the house style for every surface.

// ---- colour ----
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
export function rgb(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) { const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a] }
  let h = color.replace('#', '')
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
}
// A colour with alpha laid over its background, as the screen shows it.
export function over(fg: string, bg: string): string {
  const [r, g, b, a] = rgb(fg)
  const [R, G, B] = rgb(bg)
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, '0')
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`
}
export const luminance = (color: string) => { const [r, g, b] = rgb(color); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
// WCAG 2.2 contrast ratio, 1 to 21.
export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
// Text needs 4.5:1, large text (24 px, or 18.5 px bold) and marks that carry meaning (bars, swatches, focus rings) 3:1.
export const MIN_TEXT = 4.5
export const MIN_LARGE = 3
export const MIN_MARK = 3
export const isLarge = (px: number, weight = 400) => px >= 24 || (px >= 18.5 && weight >= 600)

// ---- width in terminal cells ----
// Wide (2-cell) code points: CJK, Hangul, fullwidth forms, most emoji. Combining marks take none.
// shortcut: a range table, not the full Unicode East Asian Width data; good for what our labels hold.
const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd]] as const
export function cells(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue
    w += WIDE.some(([a, b]) => c >= a && c <= b) ? 2 : 1
  }
  return w
}

// ---- wording ----
// Words that stay as written even mid-label or at the start (names, units, acronyms).
const KEEP = /^(Router|Claude|Code|Codex|Antigravity|Haiku|Sonnet|Opus|Fable|Auto|JSON|CLI|K|M|OK|ID|URL|MCP|API|CLAUDE_CODE_AUTO_COMPACT_WINDOW|\d.*)$/
// label: a Stats cell's, at the 4-column card's narrowest (150 px); row: an offer or report under the band, one line at
// 120 cells and two at 60 (owner case 2026-11-27: a 117-character report wrapped loosely over the band's width)
export const LIMITS = { button: 32, label: 18, toast: 200, row: 120 } as const
// Problems with a button or field label: sentence case, short, no end stop, no "click", no shouting.
export function labelIssues(label: string, max: number = LIMITS.button): Array<string> {
  const out: Array<string> = []
  const words = label.replace(/[()·,:]/g, ' ').split(/\s+/).filter(w => /\p{L}|\d/u.test(w)) // a leading dot or mark is no word
  if (cells(label) > max) out.push(`longer than ${max} cells (${cells(label)})`)
  if (/^[a-z]/.test(words[0] ?? '')) out.push('starts lower case')
  if (/[.!]$/.test(label)) out.push('ends with a stop')
  if (/\bclick\b/i.test(label)) out.push('says "click"')
  if (words.slice(1).some(w => /^[A-Z][a-z]/.test(w) && !KEEP.test(w))) out.push('Title Case (use sentence case)')
  if (words.some(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w) && !KEEP.test(w))) out.push('ALL CAPS word')
  // "Nudges off" on a button: is that what it is, or what it does? A lone "On"/"Off" option is fine.
  if (/\s(on|off)$/i.test(label)) out.push('reads as a state, not an action')
  return out
}
// A label and its value side by side ("Cache time left" "60 min left") must not say the same word twice.
export function repeatIssues(label: string, value: string): Array<string> {
  const ws = (s: string) => new Set(s.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
  const twice = [...ws(label)].filter(w => ws(value).has(w))
  return twice.length ? [`"${label}" and "${value}" both say "${twice.join('", "')}"`] : []
}

// ---- numbers ----
// Money: "$" then digits, 2 decimals (3 below $0.10 where cents would all read $0.00); a minus sign before the "$".
// Percent: no space before "%". Tokens: whole thousands with "K". Never "NaN", "undefined", "Infinity" or "-0".
export function numberIssues(text: string): Array<string> {
  const out: Array<string> = []
  for (const m of text.matchAll(/(^|[^\w.])([-−+]?)\$(\d*\.?\d*)/g)) {
    const v = m[3] ?? ''
    if (!/^\d+\.\d{2,3}$/.test(v)) out.push(`money "${m[0].trim()}" is not $N.NN`)
    else if (v.split('.')[1]!.length === 3 && Number(v) >= 0.1) out.push(`money "${m[0].trim()}" has 3 decimals at $0.10 or more`)
    if (m[2] === '-' || m[2] === '−') { if (Number(v) === 0) out.push('negative zero money') }
  }
  if (/\$-/.test(text)) out.push('minus after the "$" (write -$1.00)')
  if (/\b(about|costs?|warm) \$0\.00\b|\$0\.00 (each|a nudge)/.test(text)) out.push('a cost stated as $0.00 (write "under $0.01")')
  if (/\d\s+%/.test(text)) out.push('space before "%"')
  if (/\d\.\d+K\b/.test(text)) out.push('tokens with decimals (write 96K)')
  if (/\b(NaN|undefined|Infinity|null)\b/.test(text)) out.push('a raw NaN/undefined/null/Infinity')
  if (/(^|\s)-0(\.0+)?%?(\s|$)/.test(text)) out.push('"-0"')
  return out
}

// ---- trees drawn by the engine (ui.mount(...).drawn()) ----
export type Node = { type: string; props?: Record<string, unknown>; children?: Array<Node | string> }
export const textOf = (n: Node | string): string => (typeof n === 'string' ? n : n.type === 'Button' && typeof n.props?.label === 'string' ? n.props.label : (n.children ?? []).map(textOf).join(''))
export function walk(n: Node | string, fn: (n: Node) => void): void {
  if (typeof n === 'string') return
  fn(n)
  for (const c of n.children ?? []) walk(c, fn)
}
// Cells a child needs at the least: a truncating text can shrink to its first cell plus "…" (we allow 6), a spacer
// nothing, anything else its full text. The terminal draws a plain Button as its label alone and any other as
// "[ label ]" (the engine's ButtonProps docs); a desktop draws native buttons with padding.
// Desktop numbers measured on an owner screenshot (2026-11-27, the band at ~940 px): text ~9.75 px a cell, button text
// ~10.4 px a character (x1.1), and about 4 cells of padding per plain button.
export const DESK = { text: 1.1, pad: 4 }
// full: a truncating text counts whole (a cut model name or saving is a fault too, not room), and a wrapping row as
// one line: what a row that must stay one line needs.
export function minCells(n: Node | string, surface = 'terminal', full = false): number {
  if (typeof n === 'string') return cells(n)
  if (n.props?.flexGrow && n.type === 'Box' && !(n.children ?? []).length) return 0 // an empty spacer; its gaps still count
  if (n.type === 'Button') return surface === 'desktop' ? Math.ceil(cells(textOf(n)) * DESK.text) + DESK.pad + (n.props?.plain ? 0 : 2) : cells(textOf(n)) + (n.props?.plain ? 0 : 4)
  if (n.props?.wrap === 'truncate-end') return full ? cells(textOf(n)) : Math.min(6, cells(textOf(n)))
  if (n.props?.wrap === 'wrap') return Math.min(12, cells(textOf(n)))
  if (n.type === 'Box' && n.props?.flexDirection !== 'row') return Math.max(0, ...(n.children ?? []).map(c => minCells(c, surface, full)))
  if (n.type === 'Box' && n.props?.flexWrap === 'wrap' && !full) return Math.max(0, ...(n.children ?? []).map(c => minCells(c, surface)))
  const kids = n.children ?? []
  const gap = Number(n.props?.gap ?? n.props?.columnGap ?? 0)
  // the engine lays a gap between every two children, an empty spacer's too (owner case 2026-11-27: the spacer's
  // uncounted gap pushed "Settings" onto a line of its own at 60 cells)
  return kids.reduce((a: number, c) => a + minCells(c, surface, full), 0) + (n.type === 'Box' ? gap * Math.max(0, kids.length - 1) : 0) + Number(n.props?.marginLeft ?? 0) + Number(n.props?.marginRight ?? 0)
}
// A row that must stay one line (the band: a second line makes the chat jump): every child at its full width, gaps
// included, as if it could not wrap. Returns the overflow in cells, 0 when it fits.
export function oneRowOverflow(row: Node, width: number, surface = 'terminal'): number {
  return Math.max(0, minCells({ ...row, props: { ...row.props, marginLeft: 0, marginRight: 0 } }, surface, true) - width)
}

// ---- spacing and steadiness ----
const isNode = (c: Node | string): c is Node => typeof c !== 'string'
const prefix = (k: unknown) => String(k ?? '').replace(/-[^-]*$/, '')
// Quiet ways out of an offer: they stay plain beside a framed primary on purpose.
export const DECLINE = /^(Not now|Dismiss|Keep it all)$/
// The options of one choice (Buttons beside the picked, primary one, sharing its key prefix) wear one frame: a plain
// option beside a framed pick is 4 cells narrower, so every pick moves the row, and a dim plain word reads as text.
export function choiceIssues(tree: Node): Array<string> {
  const out: Array<string> = []
  walk(tree, n => {
    const kids = (n.children ?? []).filter(isNode).filter(c => c.type === 'Button')
    for (const p of kids.filter(b => b.props?.variant === 'primary')) {
      for (const b of kids) if (b !== p && prefix(b.props?.key) === prefix(p.props?.key) && b.props?.plain && !DECLINE.test(textOf(b))) out.push(`${String(n.props?.key ?? 'row')}: "${textOf(b)}" is plain beside the picked "${textOf(p)}" (a pick moves the row)`)
    }
  })
  return out
}
// Spacing flows from the parent (the engine's Box docs): a margin on a child of a row with a gap doubles that gap for
// one child only, and the row's rhythm goes uneven.
export function marginIssues(tree: Node): Array<string> {
  const out: Array<string> = []
  walk(tree, n => {
    if (n.type !== 'Box' || n.props?.flexDirection !== 'row' || !Number(n.props?.gap ?? n.props?.columnGap ?? 0)) return
    for (const c of (n.children ?? []).filter(isNode)) if (c.props?.marginLeft || c.props?.marginRight) out.push(`${String(n.props?.key ?? 'row')}: "${textOf(c).slice(0, 30)}" has its own margin inside a gapped row`)
  })
  return out
}
// The band redraws as numbers change ("9 min" to "41 min", "$9.99" to "$10.00"): on the desktop's proportional font
// every digit must be one width, or the row shifts each minute. A Button's label can't be tabular: draw a number in a
// Button as a tabular Text child.
export function tabularIssues(row: Node): Array<string> {
  const out: Array<string> = []
  const visit = (n: Node, tab: boolean) => {
    const t = tab || Boolean(n.props?.tabular)
    // the engine copies a Button's children's text into its label; children drawn as elements are checked below
    if (n.type === 'Button' && typeof n.props?.label === 'string' && /\d/.test(n.props.label) && !(n.children ?? []).some(isNode)) out.push(`button "${n.props.label}": a number in a label (use a tabular Text child)`)
    if (n.type === 'Text' && !t && (n.children ?? []).some(c => typeof c === 'string' && /\d/.test(c))) out.push(`text "${textOf(n).slice(0, 40)}": digits without tabular`)
    for (const c of (n.children ?? []).filter(isNode)) visit(c, t)
  }
  visit(row, false)
  return out
}

// Every row Box whose fixed parts do not fit the width it gets (its own, or what its parents leave after margins):
// the surface would clip them or push them off the edge.
export function overfullRows(tree: Node, width: number, surface = 'terminal'): Array<string> {
  const out: Array<string> = []
  const visit = (n: Node | string, room: number) => {
    if (typeof n === 'string') return
    const own = typeof n.props?.width === 'number' ? Math.min(n.props.width, room) : room
    const inner = own - Number(n.props?.marginLeft ?? 0) - Number(n.props?.marginRight ?? 0)
    if (n.type === 'Box' && n.props?.flexDirection === 'row') { // a wrapping row needs room for its widest item
      const need = minCells({ ...n, props: { ...n.props, marginLeft: 0, marginRight: 0 } }, surface)
      if (need > inner) out.push(`${String(n.props.key ?? 'row')}: needs ${need} cells, has ${inner} (${textOf(n).slice(0, 60)})`)
    }
    // children of a row share it; a label column's fixed width is taken off what its siblings get
    const fixed = n.props?.flexDirection === 'row' ? (n.children ?? []).reduce((a: number, c) => a + (typeof c !== 'string' && typeof c.props?.width === 'number' ? c.props.width + Number(n.props?.gap ?? 0) : 0), 0) : 0
    for (const c of n.children ?? []) visit(c, typeof c !== 'string' && typeof c.props?.width === 'number' ? inner : inner - fixed)
  }
  visit(tree, width)
  return out
}
