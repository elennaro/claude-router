// Outside agents (Codex, Antigravity) called from Claude through the router, always on the newest model of a family,
// plus the weekly check of the installed CLIs and the update commands behind the Settings buttons.
import type { EngineInterface } from 'claude-code'
import type { Tool, ToolState, Versions } from '../types'
import { cmpVersion, fitEffort, isSanePrices, newestAgy, newestCodex, parsePrices, versionIn, type Pick, type Prices } from './latest'

export type { Tool, Versions }

export const ROLES = ['review', 'validate', 'deep', 'visual', 'quick'] as const
export type Role = (typeof ROLES)[number]
export type RoleTier = { family: string; effort: string; why?: string }
export type AgentName = 'codex' | 'antigravity'
export type OutsideTable = Partial<Record<AgentName, Partial<Record<Role, RoleTier>>>>

const DAY = 86_400_000
const SLOTS = 8 // rolling Codex answer files: the plugin API has no delete, so a small fixed set gets overwritten

export type Env = { home: string; windows: boolean; appdata: string }

export async function env($: EngineInterface): Promise<Env> {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const appdata = ((await $.env.get('APPDATA')) ?? `${home}/AppData/Roaming`).replace(/\\/g, '/')
  return { home, windows, appdata }
}

// npm installs Codex as a .cmd shim on Windows, which cannot start without a shell; its entry is a node script, so node runs it
// and every argument reaches Codex exactly as given.
const codexBin = (v: Env) => (v.windows ? ['node', `${v.appdata}/npm/node_modules/@openai/codex/bin/codex.js`] : ['codex'])
const npmBin = (v: Env) => (v.windows ? ['cmd', '/c', 'npm'] : ['npm'])

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  return $.fs.read(path).then(t => JSON.parse(String(t))).catch(() => undefined)
}

// Newest model per family. Codex keeps its own catalog in ~/.codex/models_cache.json; older than a day, it is refreshed first.
export async function codexModels($: EngineInterface, v: Env, force = false): Promise<Record<string, Pick>> {
  const file = `${v.home}/.codex/models_cache.json`
  let cache = (await readJson($, file)) as { fetched_at?: string } | undefined
  const age = Date.now() - Date.parse(cache?.fetched_at ?? '1970-01-01')
  if (force || !cache || !(age < DAY)) {
    const r = await $.process.run([...codexBin(v), 'debug', 'models'], { stdin: '', timeoutMs: 60_000 }).catch(() => undefined)
    const fresh = r?.exitCode === 0 ? (() => { try { return JSON.parse(r.stdout) } catch { return undefined } })() : undefined
    cache = fresh?.models ? fresh : ((await readJson($, file)) as typeof cache)
  }
  return newestCodex(cache)
}

export async function agyModels($: EngineInterface, force = false): Promise<Record<string, Pick>> {
  const kept = (await $.store.get('agyModels')) as { at: number; text: string } | undefined
  if (!force && kept && Date.now() - kept.at < DAY) return newestAgy(kept.text)
  const r = await $.process.run(['agy', 'models'], { stdin: '', timeoutMs: 60_000 }).catch(() => undefined)
  if (r?.exitCode === 0 && Object.keys(newestAgy(r.stdout)).length) {
    await $.store.set('agyModels', { at: Date.now(), text: r.stdout })
    return newestAgy(r.stdout)
  }
  return newestAgy(kept?.text ?? '')
}

let slotBase: Promise<number> | undefined
let slotsTaken = 0

export type Call = { role: Role; brief: string; dir?: string; images?: Array<string> }
export type Answer = { text: string; model: string; effort: string } | { error: string }

// Read-only second opinion from Codex: your standard flags (no session log, plugins off, stdin closed), the newest model of the role's family.
export async function runCodex($: EngineInterface, v: Env, tier: RoleTier, call: Call, picks: Record<string, Pick>): Promise<Answer> {
  const pick = picks[tier.family]
  if (!pick) return { error: `Codex lists no model in the "${tier.family}" family. Update Codex (router Settings), then try again.` }
  const effort = fitEffort(tier.effort, pick.efforts) ?? tier.effort
  // parallel calls (subagents) each need their own file: the count is taken in memory, at once, after one store read
  slotBase ??= Promise.resolve($.store.get('codexSlot')).then(x => (x as number | undefined) ?? 0)
  const n = (await slotBase) + ++slotsTaken
  await $.store.set('codexSlot', n)
  const out = `${v.home}/.claude/router/codex/answer-${n % SLOTS}.md`
  await $.fs.write(out, '')
  const argv = [
    ...codexBin(v), 'exec', '--ephemeral', '--disable', 'plugins', '-s', 'read-only', '--skip-git-repo-check',
    '-m', pick.slug, '-c', `model_reasoning_effort=${effort}`, '-c', 'tools.web_search=true',
    // the elevated Windows sandbox runs the first command only, then every one fails (seen in Codex 0.13x, 2026-10)
    ...(v.windows ? ['-c', 'windows.sandbox="unelevated"'] : []),
    // the brief goes on stdin ("-"): as an argument, one starting with "-" read as a flag (audit 2026-11-19)
    ...(call.dir ? ['-C', call.dir] : []), ...(call.images ?? []).flatMap(i => ['-i', i]), '-o', out, '-',
  ]
  const r = await $.process.run(argv, { stdin: call.brief, timeoutMs: 600_000 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  const text = String(await $.fs.read(out).catch(() => '')).trim()
  // the slot is cleared once read: no answer stays on disk, and a failed call never returns an older answer
  // shortcut: two processes can still share a slot in the same moment (no delete, no lock in a mod); fine for a second opinion
  await $.fs.write(out, '').catch(() => undefined)
  if (r.exitCode === 0 && text) return { text, model: pick.slug, effort }
  return { error: `Codex ${pick.slug} (${effort}) gave no answer, exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-600)}` }
}

// Antigravity puts the effort in the model name (gemini-4-argon-high); plan mode keeps it from editing.
export async function runAgy($: EngineInterface, tier: RoleTier, call: Call, picks: Record<string, Pick>): Promise<Answer> {
  const pick = picks[tier.family]
  if (!pick) return { error: `Antigravity lists no model in the "${tier.family}" family. Update Antigravity (router Settings), then try again.` }
  const effort = fitEffort(tier.effort, pick.efforts) ?? tier.effort
  const model = `${pick.slug}-${effort}`
  // shortcut: agy has no image flag, so image paths are named in the brief for it to open itself; switch when agy gets one
  const images = (call.images ?? []).map(i => `\nLook at this image file: ${i}`).join('')
  // -p is a plain flag and the brief a positional argument: one starting with "-" gets a leading newline, so no parser reads it as a flag
  const brief = (call.brief.startsWith('-') ? `\n${call.brief}` : call.brief) + images
  const r = await $.process.run(['agy', '-p', brief, '--model', model, '--mode', 'plan', '--output-format', 'text'], {
    stdin: '', timeoutMs: 600_000, ...(call.dir ? { cwd: call.dir } : {}),
  }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  const text = r.stdout.trim()
  if (r.exitCode === 0 && text) return { text, model, effort }
  return { error: `Antigravity ${model} gave no answer, exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(-600)}` }
}

// A Bash command that calls an outside agent itself; the router points Claude to its tool instead.
export function outsideCall(command: string): AgentName | undefined {
  if (/(^|[\s;&|(])codex(\.cmd|\.js)?["']?\s+(exec|e)\b/.test(command)) return 'codex'
  if (/(^|[\s;&|(])agy(\.exe)?["']?([^\S\n][^|;&\n]*)?\s(-p|--print|--prompt)\b/.test(command)) return 'antigravity'
  return undefined
}

// ---- prices: weekly from the official page, written only when sane ----

export type PriceCheck = { at: number; table: Prices; note?: string }
const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'

// Returns the table to use. A page that fails the sanity test keeps the old table and says why.
export async function checkPrices($: EngineInterface, current: Prices, force = false): Promise<PriceCheck> {
  const kept = (await $.store.get('prices')) as PriceCheck | undefined
  if (!force && kept && Date.now() - kept.at < 7 * DAY) return kept
  const base = kept?.table ?? current
  const r = await $.http.fetch(PRICING_URL).catch(() => undefined)
  const fresh = r?.ok ? parsePrices(r.text) : {}
  const out: PriceCheck = isSanePrices(fresh, base)
    ? { at: Date.now(), table: { ...base, ...fresh } }
    : { at: Date.now(), table: base, note: r?.ok ? 'the pricing page changed shape or a price moved more than 4x; old prices kept' : 'pricing page unreachable; old prices kept' }
  await $.store.set('prices', out)
  return out
}

// ---- installed CLIs: weekly check, update on a button ----

async function have($: EngineInterface, argv: string[]): Promise<string | undefined> {
  const r = await $.process.run(argv, { stdin: '', timeoutMs: 30_000 }).catch(() => undefined)
  return r?.exitCode === 0 ? versionIn(r.stdout + r.stderr) : undefined
}

async function npmTag($: EngineInterface, pkg: string, tag: string): Promise<string | undefined> {
  const r = await $.http.fetch(`https://registry.npmjs.org/-/package/${pkg}/dist-tags`).catch(() => undefined)
  if (!r?.ok) return undefined
  try { return (JSON.parse(r.text) as Record<string, string>)[tag] } catch { return undefined }
}

const state = (h?: string, l?: string): ToolState => ({ have: h, latest: l, isBehind: Boolean(h && l && cmpVersion(l, h) > 0) })

// Claude Code follows your update channel (settings.json autoUpdatesChannel). Antigravity has no check-only command, so its
// button always offers a check; `agy update` says when it is already current.
export async function checkVersions($: EngineInterface, v: Env): Promise<Versions> {
  const settings = (await readJson($, `${v.home}/.claude/settings.json`)) as { autoUpdatesChannel?: string } | undefined
  const channel = settings?.autoUpdatesChannel === 'stable' ? 'stable' : 'latest'
  const [ch, cl, xh, xl, ah] = await Promise.all([
    have($, ['claude', '--version']), npmTag($, '@anthropic-ai/claude-code', channel),
    have($, [...codexBin(v), '--version']), npmTag($, '@openai/codex', 'latest'),
    have($, ['agy', '--version']),
  ])
  const out: Versions = { at: Date.now(), tools: { claude: state(ch, cl), codex: state(xh, xl), antigravity: state(ah) } }
  await $.store.set('versions', out)
  return out
}

export async function versions($: EngineInterface, v: Env): Promise<Versions> {
  const kept = (await $.store.get('versions')) as Versions | undefined
  return kept && Date.now() - kept.at < 7 * DAY ? kept : checkVersions($, v)
}

export const UPDATE: Record<Tool, (v: Env) => string[]> = {
  claude: () => ['claude', 'update'],
  codex: v => [...npmBin(v), 'install', '-g', '@openai/codex@latest'],
  antigravity: () => ['agy', 'update'],
}

// What the person would type in PowerShell; shown next to the button.
export const UPDATE_TEXT: Record<Tool, string> = {
  claude: 'claude update',
  codex: 'npm install -g @openai/codex@latest',
  antigravity: 'agy update',
}

export async function updateTool($: EngineInterface, v: Env, tool: Tool): Promise<string> {
  const r = await $.process.run(UPDATE[tool](v), { stdin: '', timeoutMs: 600_000 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  await checkVersions($, v)
  if (tool === 'codex') await codexModels($, v, true)
  if (tool === 'antigravity') await agyModels($, true)
  const tail = (r.stdout + '\n' + r.stderr).trim().split(/\r?\n/).slice(-2).join(' ')
  return r.exitCode === 0 ? `${UPDATE_TEXT[tool]}: done. ${tail}` : `${UPDATE_TEXT[tool]} failed (exit ${r.exitCode}): ${tail}`
}
