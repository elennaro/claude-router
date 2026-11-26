// Compact at, as a slider: the track runs from the smallest point to the model's context limit, coloured by what
// compacting there costs (green near the cheapest, amber, red), with a scale every 100K and marks for now, the
// cheapest point and Claude Code's own. Drag or click to pick, or ←/→ then Enter. Drawn by the Client element.
import type { ClientModule } from 'claude-code'

export type SliderProps = {
  min: number
  max: number
  step: number
  value: number // the point picked, or Claude Code's own when none is
  zones: Array<[number, string]> // [up to, colour], ascending
  marks: Array<[number, string, string]> // [at, glyph, colour]
}
type SliderState = { at?: number }

export const TICK = 100_000 // a scale mark every 100K tokens (owner ask 2026-11-26)
const k = (n: number) => `${Math.round(n / 1000)}K`

// The scale under the track: a tick at every 100K, and a label at every tick that has room (every 2nd, 5th... when
// narrow: the spacing alone keeps labels 2 cells apart), each centred on its tick and never cut at either end.
export function scale(min: number, max: number, cols: number): { ticks: Array<number>; labels: string } {
  const span = Math.max(1, max - min)
  const colOf = (v: number) => Math.round(((v - min) / span) * (cols - 1))
  const ticks: Array<number> = []
  for (let v = Math.ceil(min / TICK) * TICK; v <= max; v += TICK) ticks.push(v)
  const widest = k(max).length + 2 // a label and a gap of 2
  const every = [1, 2, 5, 10, 20].find(n => (cols / Math.max(1, ticks.length / n)) >= widest) ?? 50
  const line = Array.from({ length: cols }, () => ' ')
  ticks.forEach((v, i) => {
    if (i % every) return
    const text = k(v)
    const at = Math.min(cols - text.length, Math.max(0, colOf(v) - Math.floor(text.length / 2)))
    for (let c = 0; c < text.length; c++) line[at + c] = text[c]!
  })
  return { ticks, labels: line.join('').trimEnd() }
}

// The same slider as a picture, for the desktop (its proportional font can't line text cells up): marks above the
// track, the track in its cost colours, the knob at the value, a tick every 100K and as many labels as fit 44 px apart.
export function sliderSvg(p: SliderProps, width: number): string {
  const H = 62, L = 10, R = width - 10, Y = 26
  const span = Math.max(1, p.max - p.min)
  const x = (v: number) => L + ((Math.min(p.max, Math.max(p.min, v)) - p.min) / span) * (R - L)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const out: Array<string> = []
  // the track is one gradient through the zones' colours, each stop where its zone ends
  const stops = p.zones.map(([to, color]) => `<stop offset="${((Math.min(p.max, Math.max(p.min, to)) - p.min) / span).toFixed(3)}" stop-color="${color}"/>`).join('')
  out.push(`<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">${stops || '<stop offset="0" stop-color="#8a8f98"/>'}</linearGradient></defs>`)
  out.push(`<rect x="${L}" y="${Y - 4}" width="${R - L}" height="8" rx="4" fill="url(#g)"/>`)
  const { ticks } = scale(p.min, p.max, 2)
  const every = [1, 2, 5, 10].find(n => ((R - L) / span) * TICK * n >= 44) ?? 20
  ticks.forEach((v, i) => {
    out.push(`<line x1="${x(v).toFixed(1)}" y1="${Y + 7}" x2="${x(v).toFixed(1)}" y2="${Y + 12}" stroke="#8a8f98" stroke-width="1"/>`)
    if (i % every === 0) out.push(`<text x="${x(v).toFixed(1)}" y="${Y + 26}" text-anchor="${x(v) < L + 14 ? 'start' : x(v) > R - 14 ? 'end' : 'middle'}" font-size="11" fill="#8a8f98">${k(v)}</text>`)
  })
  for (const [v, glyph, color] of p.marks) {
    if (v < p.min || v > p.max) continue
    const at = x(v).toFixed(1)
    out.push(glyph === '│'
      ? `<line x1="${at}" y1="${Y - 13}" x2="${at}" y2="${Y + 7}" stroke="${color}" stroke-width="2"><title>Claude Code ${k(v)}</title></line>`
      : `<text x="${at}" y="${Y - 9}" text-anchor="middle" font-size="15" fill="${color}">${esc(glyph)}</text>`)
  }
  out.push(`<circle cx="${x(p.value).toFixed(1)}" cy="${Y}" r="8" fill="#ffffff" stroke="#3a3d42" stroke-width="2"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" font-family="system-ui, sans-serif">${out.join('')}</svg>`
}

const Slider: ClientModule<SliderProps, SliderState> = (p, surface) => {
  const { Box, Text } = surface.elements
  const cols = Math.max(12, surface.columns || 40)
  const span = Math.max(1, p.max - p.min)
  const snap = (v: number) => Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step))
  const colOf = (v: number) => Math.round(((v - p.min) / span) * (cols - 1))
  const valOf = (x: number) => snap(p.min + (Math.min(cols - 1, Math.max(0, x)) / (cols - 1)) * span)
  const at = surface.state?.at ?? p.value
  surface.onPointer(e => {
    const x = e.fine?.x ?? e.x
    if (e.type === 'down' || (e.type === 'move' && e.button)) surface.setState({ at: valOf(x) })
    if (e.type === 'up') surface.post({ value: valOf(x) })
  })
  surface.onKey(key => {
    if (key.key === 'left' || key.key === 'right') surface.setState({ at: snap(at + (key.key === 'left' ? -p.step : p.step)) })
    if (key.key === 'return') surface.post({ value: at })
  })
  const colour = (v: number) => (p.zones.find(z => v <= z[0]) ?? p.zones[p.zones.length - 1])?.[1]
  const knob = colOf(at)
  // runs of one colour as one Text each: a 60-cell track is a handful of nodes, not 60
  const runs = <T extends { text: string; color?: string; bold?: boolean }>(cells: Array<T>) =>
    cells.reduce<Array<T>>((out, c) => {
      const last = out[out.length - 1]
      if (last && !last.bold && !c.bold && last.color === c.color) last.text += c.text
      else out.push({ ...c })
      return out
    }, [])
  const track = runs(Array.from({ length: cols }, (_, c) => (c === knob ? { text: '●', bold: true } : { text: '━', color: colour(p.min + (c / (cols - 1)) * span) })))
  const { ticks, labels } = scale(p.min, p.max, cols)
  const under = Array.from({ length: cols }, () => ({ text: ' ', color: undefined as string | undefined }))
  for (const v of ticks) under[colOf(v)] = { text: '╵', color: 'inactive' }
  for (const [v, glyph, color] of p.marks) { const c = colOf(v); if (c >= 0 && c < cols) under[c] = { text: glyph, color } }
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">{track.map(t => <Text color={t.color} bold={t.bold}>{t.text}</Text>)}</Text>
      <Text wrap="truncate-end">{runs(under).map(m => <Text color={m.color}>{m.text}</Text>)}</Text>
      <Text dimColor wrap="truncate-end">{labels}</Text>
    </Box>
  )
}
export default Slider
