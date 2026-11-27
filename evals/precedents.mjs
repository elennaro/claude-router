// Per-precedent table (README "Precedents"): one answer per case and pair (seed 0), each judged against Opus medium
// seed 0 by Opus in both orders, so any router pick can be graded later for $0. A case's pairs all finish before its
// worker takes the next case, so a spend cap leaves whole precedents. Answers and verdicts already paid for are reused.
//   node precedents.mjs select               free: rank the cases once -> work/precedents-cases.json
//   DRY=1 node precedents.mjs [limit]        free: what the first `limit` cases still need, and its estimated cost
//   node docker.mjs precedents.mjs [limit]   paid: billing preflight, then the first `limit` cases
//   node precedents.mjs rows                 free: the table of complete cases as JSON lines
//   -> results/precedents.jsonl {id, category, cand, seed, score, by}
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { answer, hasAnswer, judgeOpus, key } from './judge.mjs'
import { CAP_USD, CapReached, OfflineMiss, ROOT, WORK, appendJsonl, log, pool, readJson, readJsonl } from './lib.mjs'

// cheapest first; Opus medium, the reference, sits between sonnet-high and opus-high
export const PAIRS = ['haiku-medium', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-high']
export const REF = 'opus-medium'
const N = 200
const CEILING = 99 // the owner's $100 for the whole table, less room for calls in flight past a run's cap
// mean $ per replay answer and per Opus judge call in work/spend.jsonl, for the estimate only
const ANSWER_USD = { 'haiku-medium': 0.01, 'sonnet-low': 0.016, 'sonnet-medium': 0.0231, 'sonnet-high': 0.049, 'opus-medium': 0.0776, 'opus-high': 0.096 }
const JUDGE_USD = 0.0739
const T = s => { const [model, effort] = s.split('-'); return { model, effort } }

// The cheapest pair not worse than Opus medium; where Opus high beat it, the cheapest pair that also beat it.
// A missing verdict (null) never wins.
export function winner(s) {
  const cheaper = PAIRS.slice(0, -1)
  if (s['opus-high'] === 1) return cheaper.find(p => s[p] === 1) ?? 'opus-high'
  return cheaper.find(p => s[p] === 0 || s[p] === 1) ?? REF
}

// The n best-covered cases (a category with none among them takes the place of the worst-covered case whose category
// has another), ordered round-robin over categories so any prefix of the run is spread evenly.
export function select(rows, n) {
  const ranked = [...rows].sort((a, b) => b.cover - a.cover), top = ranked.slice(0, n)
  for (const r of ranked.slice(n)) {
    if (top.some(t => t.category === r.category)) continue
    const out = top.findLastIndex(t => top.filter(u => u.category === t.category).length > 1)
    if (out >= 0) top.splice(out, 1, r)
  }
  const byCat = [...Map.groupBy(top, r => r.category).values()]
  return Array.from({ length: Math.max(0, ...byCat.map(x => x.length)) }, (_, i) => byCat.map(x => x[i]).filter(Boolean)).flat()
}

// What this table has cost: its own tags, plus the replay answers of its cases bought since the list was made.
export function taskSpent(spend, since, ids) {
  const set = new Set(ids), tiers = new Set([...PAIRS, REF])
  return spend.filter(r => {
    if (r.at < since) return false
    if (r.tag?.startsWith('prec:')) return true
    const m = /^replay:(.+?)\.([a-z]+-[a-z]+)$/.exec(r.tag ?? '')
    return Boolean(m) && set.has(m[1]) && tiers.has(m[2])
  }).reduce((a, r) => a + (r.usd ?? 0), 0)
}

// First paid row per answer: the cost of the stored answer (a later row is a re-buy).
export function answerCosts(spend) {
  const out = new Map()
  for (const r of spend) {
    const m = /^replay:(.+?)[.:]([a-z]+-[a-z]+)$/.exec(r.tag ?? '')
    if (m && r.usd > 0 && !out.has(`${m[1]}|${m[2]}`)) out.set(`${m[1]}|${m[2]}`, r.usd)
  }
  return out
}

// One row per case and pair, complete cases only.
export function tableRows(list, verdicts, spend) {
  const v = new Map(verdicts.map(r => [`${r.id}|${r.cand}`, r])), usd = answerCosts(spend)
  return list.flatMap(c => {
    const got = PAIRS.map(p => v.get(`${c.id}|${p}`))
    if (got.some(r => !r)) return []
    const win = winner(Object.fromEntries(got.map(r => [r.cand, r.score])))
    return got.map(r => ({ id: c.id, category: c.category, pair: r.cand, ...T(r.cand), seed: r.seed, score: r.score, judge: r.by, answer_usd: usd.get(`${c.id}|${r.cand}`) ?? null, ref_answer_usd: usd.get(`${c.id}|${REF}`) ?? null, is_winner: r.cand === win, winner: win }))
  })
}

const LIST = join(WORK, 'precedents-cases.json')
const OUT = join(ROOT, 'results', 'precedents.jsonl')
const SPEND = join(WORK, 'spend.jsonl')
const allCases = () => readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).flatMap(f => readJsonl(join(ROOT, 'cases', f)))
// Opus verdicts the per-class measurement already paid for: same judge, same seed-0 answers
const cached = () => readJsonl(join(ROOT, 'results', 'class-measure.jsonl')).filter(r => r.seed === 0 && r.by === 'opus' && PAIRS.includes(r.cand))

// The one proof of who pays: Claude Code's init event must name the API key before any other call is made.
function preflight() {
  if (!existsSync('/.dockerenv') || !process.env.ANTHROPIC_API_KEY) throw new Error('paid runs go through: node docker.mjs precedents.mjs (a host run would bill the subscription)')
  const args = ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'project', '--tools', '']
  return new Promise((resolve, reject) => {
    const child = execFile('claude', args, { cwd: join(WORK, 'empty'), timeout: 120_000, windowsHide: true }, (err, stdout) => {
      const events = String(stdout).split('\n').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
      const source = events.find(e => e.type === 'system' && e.subtype === 'init')?.apiKeySource
      const result = events.find(e => e.type === 'result')
      appendJsonl(SPEND, { at: new Date().toISOString(), tag: 'prec:preflight', model: 'haiku', usd: result?.total_cost_usd ?? 0 })
      log(`preflight: apiKeySource = ${source}`)
      if (source !== 'ANTHROPIC_API_KEY' || !result || result.is_error) return reject(new Error(`billing preflight failed (apiKeySource ${source}, ${String(result?.result ?? err?.message).slice(0, 200)}); nothing else was bought`))
      resolve()
    })
    child.stdin.end('Reply with the word ok.')
  })
}

async function main(arg) {
  const cases = new Map(allCases().map(c => [c.id, c]))
  if (arg === 'select') {
    if (existsSync(LIST)) throw new Error(`${LIST} exists: the list is fixed once made`)
    const seen = new Set(cached().map(r => `${r.id}|${r.cand}`))
    const ranked = [...cases.values()].map(c => ({ id: c.id, category: c.category, cover: [...PAIRS, REF].filter(p => hasAnswer(c, T(p))).length + PAIRS.filter(p => seen.has(`${c.id}|${p}`)).length }))
    const picked = select(ranked, N)
    const cats = new Set(picked.map(r => r.category)).size, all = new Set(ranked.map(r => r.category)).size
    if (cats !== all) throw new Error(`only ${cats} of ${all} categories among the ${N} cases`)
    writeFileSync(LIST, JSON.stringify({ since: new Date().toISOString(), cases: picked }, null, 1))
    return console.log(`${picked.length} cases, ${cats} categories -> ${LIST}`)
  }
  const list = readJson(LIST)
  if (!list) throw new Error('run: node precedents.mjs select')
  if (arg === 'rows') return console.log(tableRows(list.cases, readJsonl(OUT), readJsonl(SPEND)).map(r => JSON.stringify(r)).join('\n'))

  const limit = Number(arg ?? list.cases.length)
  if (!(limit > 0)) throw new Error(`limit must be a number of cases (got ${arg})`)
  const have = new Set(readJsonl(OUT).map(r => `${r.id}|${r.cand}`))
  const reuse = new Map(cached().map(r => [`${r.id}|${r.cand}`, r]))
  const jobs = list.cases.slice(0, limit).map(({ id }) => {
    const c = cases.get(id), pairs = PAIRS.filter(p => !have.has(`${id}|${p}`))
    const buy = pairs.filter(p => !reuse.has(`${id}|${p}`))
    const answers = buy.length ? [...buy, REF].filter(p => !hasAnswer(c, T(p))) : []
    return { c, pairs, buy, answers, usd: answers.reduce((a, p) => a + ANSWER_USD[p], 0) + buy.length * 2 * JUDGE_USD }
  }).filter(j => j.pairs.length)
  const sum = f => jobs.reduce((a, j) => a + f(j), 0)
  const estimate = sum(j => j.usd), judging = sum(j => j.buy.length) * 2 * JUDGE_USD
  const before = taskSpent(readJsonl(SPEND), list.since, list.cases.map(c => c.id))
  log(`${jobs.length} of ${Math.min(limit, list.cases.length)} cases open: ${sum(j => j.answers.length)} answers to make (~$${(estimate - judging).toFixed(2)}), ${sum(j => j.buy.length)} pairs to judge (~$${judging.toFixed(2)}), ${sum(j => j.pairs.length - j.buy.length)} cached verdicts to reuse; estimate $${estimate.toFixed(2)}; table spend so far $${before.toFixed(2)}`)
  if (process.env.DRY) return
  if (before + CAP_USD > CEILING) throw new Error(`$${before.toFixed(2)} spent + this run's cap $${CAP_USD} passes $${CEILING}: set EVAL_CAP_USD to at most ${(CEILING - before).toFixed(0)}`)
  await preflight()

  const save = (c, cand, score, by) => appendJsonl(OUT, { id: c.id, category: c.category, cand, seed: 0, score, by })
  const errors = []
  let complete = 0, completeEstimate = 0
  try {
    await pool(jobs, 3, async j => {
      for (const p of j.pairs.filter(p => !j.buy.includes(p))) save(j.c, p, reuse.get(`${j.c.id}|${p}`).score, 'opus')
      let failed = false
      if (j.buy.length) {
        // the reference first and alone, so five pairs never buy it five times
        const ref = await answer(j.c, T(REF))
        const done = await Promise.allSettled(j.buy.map(async p => {
          const r = await judgeOpus(j.c, await answer(j.c, T(p)), ref, `prec:${j.c.id}:${key(T(p))}`)
          save(j.c, p, r.by === 'none' ? null : r.score, r.by)
        }))
        const bad = done.filter(d => d.status === 'rejected').map(d => d.reason)
        const stop = bad.find(e => e instanceof CapReached && !(e instanceof OfflineMiss))
        if (stop) throw stop
        for (const e of bad) errors.push(`${j.c.id}: ${String(e.message ?? e).slice(0, 200)}`)
        failed = bad.length > 0
      }
      if (!failed) { complete++; completeEstimate += j.usd }
      log(`${j.c.id} ${failed ? 'incomplete' : 'complete'} (${complete}/${jobs.length})`)
    }).then(out => out.forEach((o, i) => { if (o?.error) errors.push(`${jobs[i].c.id}: ${o.error}`) }))
  } finally {
    const run = taskSpent(readJsonl(SPEND), list.since, list.cases.map(c => c.id)) - before
    log(`run spent $${run.toFixed(2)}; ${complete} cases completed (their estimate $${completeEstimate.toFixed(2)}); table total $${(before + run).toFixed(2)}`)
    for (const e of errors) log(`error ${e}`)
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('evals/precedents.mjs')) await main(process.argv[2])
