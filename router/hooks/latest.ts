// Newest model per family, read from each CLI's own model list. No model version is written anywhere in the router.

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

// "6.10" > "6.9"; missing parts count as 0.
export function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

export type Pick = { slug: string; version: string; efforts: string[] }

function keepNewest(out: Record<string, Pick>, family: string, p: Pick) {
  const cur = out[family]
  if (!cur || cmpVersion(p.version, cur.version) > 0) out[family] = p
}

// Codex: ~/.codex/models_cache.json (written by `codex debug models`). Slugs look like gpt-6.2-sol; hidden ones are skipped.
export function newestCodex(cache: unknown): Record<string, Pick> {
  const out: Record<string, Pick> = {}
  const models = (cache as { models?: unknown[] } | null)?.models
  if (!Array.isArray(models)) return out
  for (const m of models as Array<{ slug?: string; visibility?: string; supported_reasoning_levels?: Array<{ effort?: string } | string> }>) {
    const hit = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)$/i.exec(m.slug ?? '')
    if (!hit || m.visibility !== 'list') continue
    const efforts = (m.supported_reasoning_levels ?? []).map(l => (typeof l === 'string' ? l : (l.effort ?? ''))).filter(Boolean)
    keepNewest(out, hit[2]!.toLowerCase(), { slug: m.slug!, version: hit[1]!, efforts })
  }
  return out
}

// Antigravity: `agy models` prints "<slug>\t<name>" lines; the effort is part of the slug (gemini-4-argon-high).
export function newestAgy(text: string): Record<string, Pick> {
  const seen: Record<string, Record<string, Pick>> = {} // family -> version -> pick
  for (const line of text.split(/\r?\n/)) {
    const slug = line.split('\t')[0]!.trim()
    const hit = /^gemini-(\d+(?:\.\d+)*)-([a-z]+)-(low|medium|high|xhigh|max)$/i.exec(slug)
    if (!hit) continue
    const [, version, family] = hit as unknown as [string, string, string]
    const byVer = (seen[family.toLowerCase()] ??= {})
    const p = (byVer[version] ??= { slug: `gemini-${version}-${family.toLowerCase()}`, version, efforts: [] })
    p.efforts.push(hit[3]!.toLowerCase())
  }
  const out: Record<string, Pick> = {}
  for (const [family, byVer] of Object.entries(seen)) for (const p of Object.values(byVer)) keepNewest(out, family, p)
  return out
}

// The effort to send: the wanted one if the model has it, else the nearest one below, else its lowest.
export function fitEffort(wanted: string, efforts: string[]): string | undefined {
  if (!efforts.length) return wanted
  if (efforts.includes(wanted)) return wanted
  const w = EFFORTS.indexOf(wanted)
  const below = efforts.filter(e => EFFORTS.indexOf(e) < w).sort((a, b) => EFFORTS.indexOf(b) - EFFORTS.indexOf(a))
  return below[0] ?? efforts.slice().sort((a, b) => EFFORTS.indexOf(a) - EFFORTS.indexOf(b))[0]
}

// "codex-cli 0.170.0", "2.1.311 (Claude Code)", "1.5.11" -> the first x.y.z
export const versionIn = (text: string) => /(\d+\.\d+\.\d+)/.exec(text)?.[1]

// Prices per family from the official pricing page (markdown): the first row of each family is its newest model.
// Columns: base input, 5m cache write, 1h cache write, cache read, output. -> [input, output, cache read] per million tokens.
export type Prices = Record<string, [number, number, number]>
export function parsePrices(md: string): Prices {
  const out: Prices = {}
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*Claude (Haiku|Sonnet|Opus|Fable) [\d.]+[^|]*\|(.*)$/i.exec(line)
    if (!m) continue
    const f = m[1]!.toLowerCase()
    const n = m[2]!.split('|').map(c => Number(/\$([\d.]+)/.exec(c)?.[1]))
    if (out[f] || n.length < 5 || n.slice(0, 5).some(x => !Number.isFinite(x))) continue
    out[f] = [n[0]!, n[4]!, n[3]!]
  }
  return out
}

// Safe to write only if every known family is there and no price moved more than 4x: a changed page layout must not corrupt the stats.
export function isSanePrices(fresh: Prices, old: Prices): boolean {
  return Object.keys(old).every(f => fresh[f] && fresh[f]!.every((x, i) => x > 0 && x / old[f]![i]! <= 4 && old[f]![i]! / x <= 4))
}

// Claude model names in agent files: an exact version means its family, so it runs on the newest model.
export function claudeFamily(model: string): string | undefined {
  const m = /^claude-(?:\d+(?:[.-]\d+)*-)?(haiku|sonnet|opus|fable)(?:-[\d.-]+)?(\[1m\])?$/i.exec(model.trim())
  return m ? m[1]!.toLowerCase() + (m[2] ?? '') : undefined // keeps a 1M-context pin
}
