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
      <Text>{track.map(t => <Text color={t.color} bold={t.bold}>{t.text}</Text>)}</Text>
      <Text>{runs(under).map(m => <Text color={m.color}>{m.text}</Text>)}</Text>
      <Text dimColor>{labels}</Text>
    </Box>
  )
}
export default Slider
