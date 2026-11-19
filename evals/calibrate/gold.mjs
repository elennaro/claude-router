// Gold pairs for calibrating the judges: two answers to one request where the better one is known without asking a
// model. Public data only (nothing from the owner's chats), so any judge, outside services included, may see it.
//  judgebench  ScalerLab/JudgeBench (claude split): one answer objectively right, one wrong; 10 per source family
//  codegen / coderepair / testgen  mattymchen/codejudgebench: the right one passes the problem's tests
//  readability se2p/code-readability-merged: Java snippets people rated; a top-rated one against a bottom-rated one
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
    const r = await fetch(`${API}?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=${Math.min(100, n - offset)}`)
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

const rd = (await rows('se2p/code-readability-merged', 'default', 'train', 500)).sort((a, b) => b.score - a.score)
const top = rd.slice(0, 40), low = rd.slice(-40)
for (let i = 0; i < 20; i++) {
  const g = top[i * 2], b = low[(i * 7) % 40]
  pairs.push({ id: `rd-${i}`, set: 'readability', gap: +(g.score - b.score).toFixed(2), request: 'Show a short piece of Java code that is clean, easy to read and easy to maintain.', good: g.code_snippet, bad: b.code_snippet })
}

const JAVA_STYLE = `Rewrite this Kotlin function so it behaves exactly the same and still compiles, but written the way a Java
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
