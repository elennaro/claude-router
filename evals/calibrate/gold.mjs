// Gold pairs for calibrating the judges: two answers to one request where the better one is known without asking a
// model. Public data only (nothing from the owner's chats), so any judge, outside services included, may see it.
//  judgebench  ScalerLab/JudgeBench (claude split): one answer objectively right, one wrong; 10 per source family
//  codegen / coderepair / testgen  mattymchen/codejudgebench: the right one passes the problem's tests
//  smells      MLCQ (Madeyski & Lewowski, EASE 2020, doi:10.5281/zenodo.3666840, CC BY 4.0): professional developers
//              rated Java code for smells. A sample every reviewer (2+) rated major or critical against one every
//              reviewer rated none, same smell (long method, data class). Apache projects only, so the code's license
//              is known; the code is fetched from GitHub at the rated commit.
//  (readability, se2p/code-readability-merged, was removed 2026-11-20: it states no license. The calibration numbers
//  published before then include its 20 pairs.)
//  kotlin      JetBrains/Kotlin_HumanEval: the experts' idiomatic solution against a Java-style rewrite that does the
//              same thing (made by Sonnet, cached), so "idiomatic" is known by construction
// Usage: node calibrate/gold.mjs  -> work/gold/pairs.jsonl {id, set, request, good, bad}
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { WORK, claude, log, pool, writeJsonl } from '../lib.mjs'

const API = 'https://datasets-server.huggingface.co/rows'
async function rows(dataset, config, split, n) {
  const out = []
  for (let offset = 0; offset < n; offset += 100) {
    const url = `${API}?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=${Math.min(100, n - offset)}`
    let r = await fetch(url)
    for (let wait = 5; r.status === 429 && wait <= 80; wait *= 2) { // rate limited: back off, then try again
      await new Promise(ok => setTimeout(ok, wait * 1000))
      r = await fetch(url)
    }
    if (!r.ok) throw new Error(`${dataset} ${config}/${split}: http ${r.status}`)
    const j = await r.json()
    out.push(...j.rows.map(x => x.row))
    if (out.length >= j.num_rows_total) break
  }
  return out
}
// k items spread evenly over xs (deterministic, so a re-run builds the same pairs)
export const spread = (xs, k) => (xs.length <= k ? xs : Array.from({ length: k }, (_, i) => xs[Math.floor((i * xs.length) / k)]))
assert.deepEqual(spread([1, 2, 3, 4, 5, 6], 3), [1, 3, 5])
assert.deepEqual(spread([1, 2], 3), [1, 2])

const pairs = []

const jb = (await rows('ScalerLab/JudgeBench', 'default', 'claude', 400)).filter(r => r.label === 'A>B' || r.label === 'B>A')
const families = Object.groupBy(jb, r => r.source.split('-')[0])
for (const [fam, rs] of Object.entries(families)) for (const r of spread(rs, 10)) {
  const [good, bad] = r.label === 'A>B' ? [r.response_A, r.response_B] : [r.response_B, r.response_A]
  pairs.push({ id: `jb-${r.pair_id.slice(0, 8)}`, set: 'judgebench', family: fam, request: r.question, good, bad })
}

const problem = r => `${r.question_content}${r.starter_code ? `\n\nStarter code:\n${r.starter_code}` : ''}`
for (const r of spread(await rows('mattymchen/codejudgebench', 'codegen', 'claude_4_opus', 200), 20))
  pairs.push({ id: `cg-${r.question_id}`, set: 'codegen', request: `Solve this programming problem in Python.\n\n${problem(r)}`, good: r.pos_response, bad: r.neg_response })
for (const r of spread(await rows('mattymchen/codejudgebench', 'coderepair', 'claude_3.7_sonnet', 900), 10))
  pairs.push({ id: `cr-${r.question_id}`, set: 'coderepair', request: `This code fails the problem's tests. Find the bug and fix it.\n\n${problem(r)}\n\nCode:\n${r.wrong_code}`, good: r.pos_response, bad: r.neg_response })
for (const r of spread(await rows('mattymchen/codejudgebench', 'testgen', 'claude_3.7_sonnet', 400), 10)) {
  const t = (i, o) => `Input:\n${i}\nExpected output:\n${o}`
  pairs.push({ id: `tg-${r.question_id}`, set: 'testgen', request: `Write one test case (input and the exact expected output) for this problem.\n\n${problem(r)}`, good: t(r.pos_input, r.pos_response), bad: t(r.neg_input, r.neg_response) })
}

// MLCQ rows: id;reviewer_id;sample_id;smell;severity;...;repository(8);commit_hash(9);path(10);start_line(11);end_line(12)
const SEV = { none: 0, minor: 1, major: 2, critical: 3 }
export function smellSamples(csv) {
  const by = {}
  for (const r of csv.trim().split(/\r?\n/).slice(1).map(l => l.split(';'))) {
    if (r.length !== 15 || !r[8].startsWith('git@github.com:apache/')) continue
    const s = (by[`${r[2]}|${r[3]}`] ??= { id: r[2], smell: r[3], repo: r[8].slice(15, -4), commit: r[9], path: r[10], from: +r[11], to: +r[12], sev: [] })
    s.sev.push(SEV[r[4]])
  }
  const agreed = Object.values(by).filter(s => s.sev.length >= 2 && s.to - s.from >= 7 && s.to - s.from < 80)
  return {
    clean: agreed.filter(s => s.sev.every(v => v === 0)),
    smelly: agreed.filter(s => s.sev.every(v => v >= 2)),
  }
}
{
  const head = 'id;reviewer_id;sample_id;smell;severity;t;type;name;repository;commit_hash;path;start_line;end_line;link;ind'
  const row = (r, id, sev, from = 1, to = 20) => `${r};1;${id};long method;${sev};t;function;n;git@github.com:apache/tez.git;c;/A.java;${from};${to};l;1`
  const got = smellSamples([head, row(1, 'a', 'none'), row(2, 'a', 'none'), row(3, 'b', 'major'), row(4, 'b', 'critical'),
    row(5, 'c', 'major'), row(6, 'c', 'minor'), row(7, 'd', 'none'), row(8, 'e', 'none', 1, 3), row(9, 'e', 'none', 1, 3)].join('\n'))
  assert.deepEqual([got.clean.map(s => s.id), got.smelly.map(s => s.id), got.clean[0].repo], [['a'], ['b'], 'apache/tez'])
}
async function code(s) {
  const r = await fetch(`https://raw.githubusercontent.com/${s.repo}/${s.commit}${s.path}`)
  return r.ok ? (await r.text()).split(/\r?\n/).slice(s.from - 1, s.to).join('\n') : undefined
}
// Zenodo answers 403 to node's default user agent
const mlcq = await fetch('https://zenodo.org/api/records/3666840/files/MLCQCodeSmellSamples.csv/content', { headers: { 'User-Agent': 'dataset-fetch' } })
if (!mlcq.ok) throw new Error(`MLCQ: http ${mlcq.status}`)
const { clean, smelly } = smellSamples(await mlcq.text())
const ASK = {
  'long method': 'Show a Java method that is clean, easy to read and easy to maintain.',
  'data class': 'Show a Java class that is well designed: it keeps the behavior that works on its data with that data.',
}
for (const [smell, request] of Object.entries(ASK)) {
  const goods = spread(clean.filter(s => s.smell === smell), 20), bads = spread(smelly.filter(s => s.smell === smell), 20)
  let made = 0
  for (let i = 0; made < 10 && i < Math.min(goods.length, bads.length); i++) {
    const [good, bad] = await Promise.all([code(goods[i]), code(bads[i])])
    if (good && bad) pairs.push({ id: `sm-${bads[i].id}-${goods[i].id}`, set: 'smells', family: smell, request, good, bad }), made++
  }
  if (made < 10) log(`MLCQ ${smell}: only ${made} pairs (repos moved or gone)`)
}

const JAVA_STYLE =`Rewrite this Kotlin function so it behaves exactly the same and still compiles, but written the way a Java
developer new to Kotlin would: explicit for/while loops with indexes instead of collection functions, mutable vars and
mutable lists built up step by step, explicit types everywhere, if (x != null) checks instead of ?. and ?:, block bodies
instead of expression bodies, no when, no destructuring. Keep the same name and signature. Output only the code.`
const kt = spread(await rows('JetBrains/Kotlin_HumanEval', 'default', 'train', 200), 20)
await pool(kt, 4, async r => {
  const idiomatic = r.canonical_solution.join('\n')
  const java = await claude({ model: 'sonnet', effort: 'medium', system: JAVA_STYLE, prompt: idiomatic, tag: `gold:kotlin:${r.task_id}`, cache: true })
  const code = java.text.replace(/^```\w*\n?|```\s*$/gm, '').trim()
  pairs.push({ id: `kt-${r.task_id.split('/')[1]}`, set: 'kotlin', request: `${r.description}\n\nWrite this function in idiomatic Kotlin.`, good: idiomatic, bad: code })
})

writeJsonl(join(WORK, 'gold', 'pairs.jsonl'), pairs)
log(`gold pairs: ${pairs.length} (${Object.entries(Object.groupBy(pairs, p => p.set)).map(([k, v]) => `${k} ${v.length}`).join(', ')})`)
