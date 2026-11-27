// Self-check of the precedent table's own logic (free, no model calls): winner rule, case selection and order,
// spend total, rows. Usage: node precedents.test.mjs
import assert from 'node:assert/strict'
import { PAIRS, answerCosts, select, sumOf, tableRows, taskSpent, winner } from './precedents.mjs'

const s = (...v) => Object.fromEntries(PAIRS.map((p, i) => [p, v[i]])) // haiku-m, sonnet-l, sonnet-m, sonnet-h, opus-h

assert.deepEqual(PAIRS, ['haiku-medium', 'sonnet-low', 'sonnet-medium', 'sonnet-high', 'opus-high']) // price order
// sums -4..+4 vs Opus medium (0). Best is the reference: the cheapest within 1 point of 0
assert.equal(winner(s(-2, -1, 0, 0, 0)), 'sonnet-low')
assert.equal(winner(s(-2, -2, -2, -2, -2)), 'opus-medium')
assert.equal(winner(s(-2, -2, -2, -2, 0)), 'opus-medium') // opus-high only ties, so the cheaper reference wins
// best is above the reference: the bar moves up with it
assert.equal(winner(s(0, 1, 2, 2, 2)), 'sonnet-low') // 1 is within 1 of 2
assert.equal(winner(s(0, 0, 0, 0, 2)), 'opus-high') // 0 is 2 below the best
assert.equal(winner(s(0, 0, 0, 3, 4)), 'sonnet-high') // the bar is 3; Opus medium (0) is not within it
// a missing sum never wins (null >= -1 is true in JavaScript)
assert.equal(winner(s(null, -2, -1, -2, 0)), 'sonnet-medium')

assert.equal(sumOf({ scores: [-2, 1] }), -1)
assert.equal(sumOf({ scores: [undefined, 2] }), 2) // one order gave no verdict
assert.equal(sumOf({ score: 0, by: 'none' }), null)

const ranked =[['a1', 'a', 5], ['a2', 'a', 9], ['a3', 'a', 8], ['b1', 'b', 7], ['b2', 'b', 1], ['c1', 'c', 2]].map(([id, category, cover]) => ({ id, category, cover }))
// the 4 best-covered, one per category in turn; c is not among them, so it takes the place of the worst whose category
// has another (a1; b1 is the only b)
assert.deepEqual(select(ranked, 4).map(r => r.id), ['a2', 'b1', 'c1', 'a3'])
assert.equal(select(ranked, 99).length, 6)

const since = '2026-01-02'
const row = (tag, usd, at = '2026-01-03') => ({ tag, usd, at })
const spend = [row('prec:preflight', 1), row('prec:a:sonnet-low:opus-ab', 2), row('replay:a.sonnet-low', 4), row('replay:a.opus-medium', 8),
  row('replay:a.opus-low', 16), row('replay:z.sonnet-low', 32), row('replay:a.sonnet-low.s1', 64), row('paste:x', 128), row('prec:preflight', 256, '2026-01-01')]
assert.equal(taskSpent(spend, since, ['a']), 15) // other pairs, other cases, other seeds, other suites and older rows are not this table's

assert.deepEqual([...answerCosts([row('replay:a:sonnet-low', 0), row('replay:a.sonnet-low', 3), row('replay:a.sonnet-low', 9), row('replay:a.sonnet-low.s1', 5)])], [['a|sonnet-low', 3]])

const verdicts = PAIRS.map((cand, i) => ({ id: 'a', cand, seed: 0, score: [-1, 0, 0, 0, 0][i], sum: [-2, -1, 0, 0, 0][i], by: 'opus' }))
const rows = tableRows([{ id: 'a', category: 'k' }, { id: 'b', category: 'k' }], [...verdicts, { ...verdicts[0], id: 'b' }], [row('replay:a.sonnet-low', 3), row('replay:a.opus-medium', 8)])
assert.equal(rows.length, 5) // b has one verdict of five: not a precedent
assert.deepEqual(rows[1], { id: 'a', category: 'k', pair: 'sonnet-low', model: 'sonnet', effort: 'low', seed: 0, score: 0, sum: -1, judge: 'opus', answer_usd: 3, ref_answer_usd: 8, is_winner: true, winner: 'sonnet-low' })
assert.deepEqual(rows.map(r => r.is_winner), [false, true, false, false, false])
console.log('precedents self-check: ok')
