// Big-paste offload eval (docs/PLAN-v3.md, slice 3): does the cheaper model's analysis alone carry what the request
// needs? Synthetic long pastes (logs, reports, threads) with facts planted at seeded positions; the plugin's own
// prompt and model choice (pasteSystem, pasteModel from router/hooks/policy.ts); scored by whether each planted fact
// appears in the analysis exactly as written. No judge: a fact is a code, a number or a name, so string match decides.
// Usage: node paste/run.mjs            (pays for answers the store lacks; EVAL_CAP_USD, default $5)
//        EVAL_OFFLINE=1 node paste/run.mjs   (replays the store for $0)
//        node paste/run.mjs --test     (self-check of the generator and the scorer, no model calls)
import { claude, pool, log } from '../lib.mjs'
import { estTokens, pasteModel, pastePrompt, pasteSystem } from '../../router/hooks/policy.ts'

// seeded random numbers, so every run builds the same pastes and the store's answers stay valid
function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)]

const SERVICES = ['auth-gateway', 'billing-sync', 'search-indexer', 'media-resizer', 'report-builder', 'queue-worker', 'cache-warmer']
const LEVELS = ['INFO', 'INFO', 'INFO', 'DEBUG', 'INFO', 'WARN']
const NOTES = ['request served', 'health check ok', 'cache refreshed', 'batch committed', 'connection reused', 'token renewed', 'job queued', 'retry scheduled', 'metrics flushed']
const time = (r, h) => `${String(h).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`

// A filler line of the given kind; long enough to read like the real thing, never containing a planted fact.
function filler(kind, r, i) {
  if (kind === 'log') return `${time(r, 8 + Math.floor(i / 900) % 12)} ${pick(r, LEVELS)} [${pick(r, SERVICES)}] ${pick(r, NOTES)} id=${Math.floor(r() * 1e6)} took=${Math.floor(r() * 400)}ms`
  if (kind === 'report') return `Section ${1 + Math.floor(i / 40)}.${i % 40}: the ${pick(r, ['north', 'south', 'east', 'west'])} region reported ${pick(r, ['steady', 'flat', 'slightly higher', 'slightly lower'])} volumes this week, with ${Math.floor(r() * 90) + 10} open items and no change to the plan.`
  return `${pick(r, ['Sam', 'Alex', 'Robin', 'Kim', 'Jo', 'Lee'])}: ${pick(r, ['sounds good', 'I will check tomorrow', 'any update on this?', 'thanks, merged', 'let us discuss in the sync', 'looks fine to me', 'can you share the numbers?'])} (${time(r, 9 + (i % 9))})`
}

// The cases: kind, size in tokens, the request (before the paste), and the facts planted in it.
export const CASES = [
  { id: 'log-12k', kind: 'log', tokens: 12_000, ask: 'Find why billing-sync failed in this log and when it started.', facts: [['ERROR [billing-sync] upstream refused: code E4471', 'E4471'], ['first failure at 14:07:52', '14:07:52']] },
  { id: 'log-30k', kind: 'log', tokens: 30_000, ask: 'Which order ids failed in this log?', facts: [['WARN [queue-worker] order 58213-K rejected: card expired', '58213-K'], ['WARN [queue-worker] order 77104-B rejected: address missing', '77104-B'], ['WARN [queue-worker] order 90022-Q rejected: stock out', '90022-Q']] },
  { id: 'report-45k', kind: 'report', tokens: 45_000, ask: 'What budget figure and deadline does this report give for the migration?', facts: [['The migration budget is fixed at 418,500 EUR.', '418,500 EUR'], ['The migration must be live by 2027-03-31.', '2027-03-31']] },
  { id: 'thread-20k', kind: 'thread', tokens: 20_000, ask: 'Who agreed to own the rollback plan in this thread, and what is the rollback window?', facts: [['Morgan: I will own the rollback plan.', 'Morgan'], ['Kim: agreed, rollback window is 45 minutes.', '45 minutes']] },
  { id: 'log-70k', kind: 'log', tokens: 70_000, ask: 'Find every distinct error code in this log.', facts: [['ERROR [auth-gateway] signature invalid: code A1902', 'A1902'], ['ERROR [media-resizer] out of memory: code M3310', 'M3310'], ['ERROR [search-indexer] shard lost: code S0457', 'S0457']] },
  { id: 'report-60k-judge', kind: 'report', tokens: 60_000, ask: 'Review this report and recommend whether to approve the vendor, with the reasons it gives.', facts: [['The vendor failed 3 of 12 security controls.', '3 of 12'], ['The vendor offers a 22% discount for a three-year term.', '22%']] },
]

// The paste: the request, then filler with each fact line put at a seeded place (never in the first or last 5%).
export function buildPaste(c, seed = 1) {
  const r = rng(seed * 7919 + c.id.length)
  const lines = []
  let i = 0
  while (estTokens(lines.join('\n')) < c.tokens) lines.push(filler(c.kind, r, i++))
  for (const [line] of c.facts) lines.splice(Math.floor(lines.length * (0.05 + r() * 0.9)), 0, line)
  return `${c.ask}\n\n${lines.join('\n')}`
}

// Recall: the planted facts whose key string the analysis carries exactly; plus whether the analysis kept the shape.
export function score(c, analysis) {
  const found = c.facts.filter(([, key]) => analysis.includes(key)).length
  return { found, of: c.facts.length, shaped: /Request:/i.test(analysis) && /Left out:/i.test(analysis) }
}

async function main() {
  const rows = await pool(CASES, 3, async c => {
    const text = buildPaste(c)
    const model = pasteModel(text)
    const r = await claude({ model, effort: 'low', system: pasteSystem, prompt: pastePrompt(text), cache: true, tag: `paste:${c.id}` })
    const s = score(c, r.text)
    log(`${c.id}: ${model}, ~${Math.round(estTokens(text) / 1000)}K tokens, ${s.found}/${s.of} facts, shape ${s.shaped ? 'ok' : 'off'}${r.cached ? ' (stored)' : ` ($${r.usd.toFixed(3)})`}`)
    return { c, model, s, usd: r.usd }
  })
  const failed = rows.filter(x => x.error)
  for (const [i, x] of rows.entries()) if (x.error) console.log(`${CASES[i].id}: ERROR ${x.error}`)
  if (failed.length) { console.log(`GATE FAIL: ${failed.length} case(s) got no answer`); process.exitCode = 1; return }
  const by = m => rows.filter(x => x.model === m)
  const recall = xs => (xs.length ? xs.reduce((a, x) => a + x.s.found, 0) / xs.reduce((a, x) => a + x.s.of, 0) : 1)
  const line = m => `${m}: ${by(m).length} cases, fact recall ${(100 * recall(by(m))).toFixed(0)}%`
  console.log(`\n${line('haiku')} · ${line('sonnet')} · shape kept ${rows.filter(x => x.s.shaped).length}/${rows.length} · paid this run $${rows.reduce((a, x) => a + x.usd, 0).toFixed(2)}`)
  // gate: the analysis alone must carry at least 90% of planted facts for each model, and every case keeps the shape
  const pass = recall(by('haiku')) >= 0.9 && recall(by('sonnet')) >= 0.9 && rows.every(x => x.s.shaped)
  console.log(pass ? 'GATE PASS' : 'GATE FAIL')
  process.exitCode = pass ? 0 : 1
}

function selfTest() {
  const assert = (ok, what) => { if (!ok) throw new Error(`self-test: ${what}`) }
  for (const c of CASES) {
    const p = buildPaste(c)
    assert(p === buildPaste(c), `${c.id}: the same seed builds the same paste`)
    assert(estTokens(p) >= c.tokens && estTokens(p) < c.tokens * 1.05, `${c.id}: about ${c.tokens} tokens`)
    for (const [line, key] of c.facts) assert(p.includes(line) && p.split(key).length === 2, `${c.id}: ${key} planted exactly once`)
  }
  assert(pasteModel(buildPaste(CASES[0])) === 'haiku' && pasteModel(buildPaste(CASES[4])) === 'sonnet' && pasteModel(buildPaste(CASES[5])) === 'sonnet', 'models: small find on Haiku, over 50K or judgment on Sonnet')
  const c = CASES[0]
  assert(JSON.stringify(score(c, 'Request: x\nAnalysis: E4471 at 14:07:52\nLeft out: noise')) === JSON.stringify({ found: 2, of: 2, shaped: true }), 'score: both facts and the shape')
  assert(score(c, 'E4471').found === 1 && !score(c, 'E4471').shaped, 'score: one fact, no shape')
  console.log('paste eval self-test: ok')
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('paste/run.mjs')) process.argv[2] === '--test' ? selfTest() : main()
