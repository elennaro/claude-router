// Scores results/mood.jsonl. A missed complaint costs quality (the turn keeps its effort); a false "unhappy" costs
// money (a step more effort for the rest of the task). Unsure replies (under 0.7) change nothing and count as missed.
// Usage: node mood/report.mjs
import { join } from 'node:path'
import { ROOT, readJsonl } from '../lib.mjs'

const rows = readJsonl(join(ROOT, 'results', 'mood.jsonl'))
if (!rows.length) { console.log('no results: run node mood/run.mjs first'); process.exit(1) }
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0)
const pct = x => `${(100 * x).toFixed(1)}%`
const clear = rows.filter(r => r.kind !== 'ambiguous')
const complaints = clear.filter(r => r.gold === 'unhappy')
const calm = clear.filter(r => r.gold !== 'unhappy')
const fresh = clear.filter(r => r.gold === 'new')
const ok = r => r.mood === r.gold || r.also.includes(r.mood)

// Only every second unhappy reply in a task acts (register.tsx raiseSteps), so one misread costs nothing. The rates per
// task assume independent replies; shortcut: misreads cluster on one kind of message, so treat them as a floor.
const caught = share(complaints, r => r.mood === 'unhappy')
const falseOne = share(calm, r => r.mood === 'unhappy')
const gates = [
  ['complaints caught', caught, 'target >= 85%', x => x >= 0.85],
  ['false unhappy per reply (clarifications, next steps, new tasks)', falseOne, 'target <= 5%', x => x <= 0.05],
  ['false raise: two calm replies in a task both read unhappy', falseOne ** 2, 'hard <= 5%', x => x <= 0.05],
  ['two real complaints in a task both caught (the raise lands)', caught ** 2, 'target >= 80%', x => x >= 0.8],
  ['new task read as new (resets the raise)', share(fresh, r => r.mood === 'new'), 'target >= 80%', x => x >= 0.8],
  ['ambiguous: an accepted label', share(rows.filter(r => r.kind === 'ambiguous'), ok), 'info', () => true],
  ['unsure or failed (changes nothing)', share(rows, r => !r.mood), 'info', () => true],
]
console.log(`Mood check: ${new Set(rows.map(r => r.id)).size} cases x ${new Set(rows.map(r => r.run)).size} runs\n`)
console.log('| metric | value | gate | result |\n|---|---|---|---|')
for (const [name, v, gate, pass] of gates) console.log(`| ${name} | ${pct(v)} | ${gate} | ${pass(v) ? 'pass' : 'FAIL'} |`)
const wrong = rows.filter(r => !ok(r))
if (wrong.length) {
  console.log('\nMisses (case, run: gold -> got, reply)')
  for (const r of wrong) console.log(`- ${r.id} #${r.run}: ${r.gold} -> ${r.mood ?? 'unsure'} (${(r.reply ?? 'no reply').slice(0, 40)})`)
}
