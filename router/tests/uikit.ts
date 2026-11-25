// The UI rules as code: contrast, wording and number checks, and a cell-width budget for the band's rows.
// Pure (no Node, no DOM), so the plugin tests (claude plugin test) and tests/ui.check.mjs (Node) share one copy.
// The rules and their reasons are written up in the router-uiux skill; a change here changes the house style.

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
export const LIMITS = { button: 32, label: 18, toast: 200 } as const // label: a Stats cell's, at the 4-column card's narrowest (150 px)
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
  return out
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
// "[ label ]" (the engine's ButtonProps docs); a desktop draws native buttons, counted here as 2 cells of padding more.
// shortcut: the desktop's padding is a guess in cells; measure a desktop screenshot if a row there looks off.
export function minCells(n: Node | string, surface = 'terminal'): number {
  if (typeof n === 'string') return cells(n)
  if (n.props?.flexGrow) return 0
  if (n.type === 'Button') return cells(textOf(n)) + (n.props?.plain ? 0 : 4) + (surface === 'desktop' ? 2 : 0)
  if (n.props?.wrap === 'truncate-end') return Math.min(6, cells(textOf(n)))
  if (n.props?.wrap === 'wrap') return Math.min(12, cells(textOf(n)))
  if (n.type === 'Box' && n.props?.flexDirection !== 'row') return Math.max(0, ...(n.children ?? []).map(c => minCells(c, surface)))
  if (n.type === 'Box' && n.props?.flexWrap === 'wrap') return Math.max(0, ...(n.children ?? []).map(c => minCells(c, surface)))
  const kids = n.children ?? []
  const gap = Number(n.props?.gap ?? n.props?.columnGap ?? 0)
  return kids.reduce((a: number, c) => a + minCells(c, surface), 0) + (n.type === 'Box' ? gap * Math.max(0, kids.length - 1) : 0) + Number(n.props?.marginLeft ?? 0) + Number(n.props?.marginRight ?? 0)
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
