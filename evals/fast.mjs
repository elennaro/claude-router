// The fast loop for tuning the router: every suite replayed from the store (work/eval.db) with EVAL_OFFLINE=1, so no
// model is called and nothing is spent; a cache miss stops the run and names what is missing. Changing the class table,
// rules, thresholds or effort logic replays for free; changing the classifier's words or labels needs one paid run
// without EVAL_OFFLINE (only the changed prompts are asked).
// Usage: node fast.mjs   -> each suite's report, then the spend check
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, spent } from './lib.mjs'

const steps = [
  ['run-classifier.mjs'], ['report.mjs'],
  ['subagents/run.mjs'], ['subagents/report.mjs'],
  ['session/run.mjs'], ['session/report.mjs'],
  ['toolloop/report.mjs'],
]
const before = spent(), t0 = Date.now()
let failed = false
for (const [file] of steps) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, file)], { cwd: ROOT, env: { ...process.env, EVAL_OFFLINE: '1' }, encoding: 'utf8', maxBuffer: 64 << 20 })
    const gates = out.split('\n').filter(l => /\| (pass|FAIL) \|$|^\|.*\b(hard|target)\b/.test(l))
    console.log(`\n== ${file}${gates.length ? '' : ' (no gate table)'}\n${gates.join('\n')}`)
  } catch (e) {
    failed = true
    console.log(`\n== ${file} FAILED\n${String(e.stdout ?? '').split('\n').slice(-5).join('\n')}${String(e.stderr ?? '').split('\n').slice(-5).join('\n')}`)
  }
}
const cost = spent() - before
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s, spent $${cost.toFixed(4)}${cost > 0 ? '  <- should be 0: something paid' : ''}`)
process.exit(failed || cost > 0 ? 1 : 0)
