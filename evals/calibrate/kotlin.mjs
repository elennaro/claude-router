// Kotlin correctness pairs: Haiku and Sonnet answer Kotlin HumanEval tasks (JetBrains, written by experts), each
// answer is compiled with kotlinc and run against the task's own tests. A task with one passing and one failing
// answer gives a gold pair. Needs kotlinc and java on the machine (KOTLINC overrides the compiler path).
// Usage: node calibrate/kotlin.mjs  -> adds set "kotlin-tests" to work/gold/pairs.jsonl
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORK, claude, log, pool, readJson, readJsonl, writeJsonl } from '../lib.mjs'

const spread = (xs, k) => (xs.length <= k ? xs : Array.from({ length: k }, (_, i) => xs[Math.floor((i * xs.length) / k)])) // as gold.mjs
const KOTLINC = process.env.KOTLINC ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'kotlinc', 'bin', 'kotlinc.bat')
const sh = (cmd, args, timeout) => new Promise(res => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, out, errOut) => res({ ok: !err, log: String(errOut || out).slice(-400) })))
export const stripFences = t => t.replace(/^```\w*\s*\n?|```\s*$/gm, '').trim()
assert.equal(stripFences('```kotlin\nfun a() = 1\n```'), 'fun a() = 1')

const TESTS = join(WORK, 'gold', 'kotlin-tests.json') // code hash -> {pass, log}: kotlinc is slow, run each answer once
const results = readJson(TESTS, {})
async function test(code, testMain) {
  const h = createHash('sha256').update(code + testMain).digest('hex').slice(0, 16)
  if (results[h]) return results[h]
  const dir = join(WORK, 'gold', 'kt', h)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Main.kt'), `${code}\n\n${testMain}\n`)
  const built = await sh('cmd', ['/c', KOTLINC, join(dir, 'Main.kt'), '-include-runtime', '-nowarn', '-d', join(dir, 'm.jar')], 180_000)
  const r = built.ok ? await sh('java', ['-jar', join(dir, 'm.jar')], 30_000) : { ok: false, log: `compile: ${built.log}` }
  rmSync(dir, { recursive: true, force: true })
  return (results[h] = { pass: r.ok, log: r.ok ? '' : r.log })
}

const SYSTEM = k => `Complete the Kotlin function. Output only Kotlin code: the full function with its signature, and any helpers it needs. No main, no explanation. (Attempt ${k + 1}.)`
const BUG = `Introduce exactly one subtle, realistic bug into this Kotlin code, the kind a careful developer could miss in
review: an off-by-one, a wrong boundary, a missed edge case (empty input, negative numbers, ties), a wrong operator. It
must still compile, and it must not look like a bug: same style, no comments about it. Output only the code.`
const WRITERS =[{ model: 'haiku', effort: 'low', k: 0 }, { model: 'haiku', effort: 'low', k: 1 }, { model: 'sonnet', effort: 'low', k: 0 }]
const rows = await (await fetch('https://datasets-server.huggingface.co/rows?dataset=JetBrains/Kotlin_HumanEval&config=default&split=train&offset=0&length=100')).json()
const rows2 = await (await fetch('https://datasets-server.huggingface.co/rows?dataset=JetBrains/Kotlin_HumanEval&config=default&split=train&offset=100&length=100')).json()
const tasks = spread([...rows.rows, ...rows2.rows].map(x => x.row), Number(process.env.KT_TASKS ?? 60))

const found = await pool(tasks, 4, async t => {
  const answers = []
  for (const w of WRITERS) {
    const r = await claude({ model: w.model, effort: w.effort, system: SYSTEM(w.k), prompt: t.prompt, tag: `gold:kt-tests:${t.task_id}`, cache: true })
    const code = stripFences(r.text)
    answers.push({ by: `${w.model}#${w.k}`, code, ...(await test(code, t.test)) })
  }
  const good = answers.find(a => a.pass)
  // HumanEval is easy enough that natural failures are rare: then Sonnet hides one realistic bug in the passing
  // answer, and it counts only if the tests catch it (the pair differs by that bug alone, the hardest kind to judge)
  if (good && !answers.some(a => !a.pass && !a.log.startsWith('compile'))) {
    const r = await claude({ model: 'sonnet', effort: 'medium', system: BUG, prompt: good.code, tag: `gold:kt-bug:${t.task_id}`, cache: true })
    const code = stripFences(r.text)
    if (code !== good.code) answers.push({ by: 'sonnet-bug', code, ...(await test(code, t.test)) })
  }
  const bad = answers.find(a => !a.pass && !a.log.startsWith('compile')) ?? answers.find(a => !a.pass) // a wrong answer that runs is harder than one that does not compile
  return { t, answers, pair: good && bad ? { id: `kx-${t.task_id.split('/')[1]}`, set: 'kotlin-tests', request: t.prompt.replace(/\n\s*$/, '') + '\n}\n\nComplete this Kotlin function.', good: good.code, bad: bad.code, badWhy: bad.log.slice(0, 160) } : undefined }
})
writeFileSync(TESTS, JSON.stringify(results))
const ok = found.filter(f => f?.t)
for (const f of found) if (f?.error) log(`error: ${f.error}`)
const all = ok.flatMap(f => f.answers)
log(`kotlin: ${ok.length} tasks, ${all.length} answers, pass ${all.filter(a => a.pass).length}, compile fail ${all.filter(a => a.log.startsWith('compile')).length}`)
const PAIRS = join(WORK, 'gold', 'pairs.jsonl')
const pairs = [...readJsonl(PAIRS).filter(p => p.set !== 'kotlin-tests'), ...ok.map(f => f.pair).filter(Boolean)]
writeJsonl(PAIRS, pairs)
log(`kotlin-tests pairs: ${pairs.filter(p => p.set === 'kotlin-tests').length}; total pairs ${pairs.length}`)
