// Self-check of the store and offline mode (free, no model calls): a miss in offline mode is refused, never paid;
// a row reads back exactly; the sample id keeps repeat samples apart. Usage: node store.test.mjs
import assert from 'node:assert/strict'

process.env.EVAL_OFFLINE = '1'
const { OfflineMiss, cacheGet, cacheKey, cachePut, capGate, claude, pool, spent } = await import('./lib.mjs')

// the cap counts calls in flight: with $1 spent and three $1 calls of a model known to cost $1, a $3 cap admits only two
{
  const g = capGate(3)
  g.admit('opus', 0)(1) // one finished call teaches the gate opus costs about $1
  const a = g.admit('opus', 1), b = g.admit('opus', 1), c = g.admit('opus', 1)
  assert.ok(a && b && !c, 'a third call in flight would pass the cap')
  a(1) // a finished call frees its reservation (and is counted as spent by the caller)
  assert.ok(!g.admit('opus', 2 + 1), 'spent plus one in flight already fills the cap')
  b(1)
  assert.ok(g.admit('haiku', 2.5), 'an unseen model is not held back before its first call')
  assert.ok(!g.admit('haiku', 3), 'nothing passes once the cap is spent')
}
const before = spent()
const q = { model: 'haiku', prompt: `store self-check ${Date.now()}`, tag: 'selftest' }
await assert.rejects(claude({ ...q, cache: true }), OfflineMiss) // not in the store
await assert.rejects(claude(q), OfflineMiss) // uncached calls are refused outright
// a miss stops the whole run, like the spend cap: a runner must never score it as "the classifier failed"
let ran = 0
await assert.rejects(pool([1, 2, 3], 1, () => { ran++; return claude(q) }), OfflineMiss)
assert.equal(ran, 1)
assert.equal(spent(), before, 'offline mode spent money')

cachePut('selftest:row', 'selftest', { text: 'привет', n: 1 })
assert.deepEqual(cacheGet('selftest:row'), { text: 'привет', n: 1 })
cachePut(cacheKey({ ...q, cache: true }), 'selftest', { text: 'cached' })
assert.equal((await claude({ ...q, cache: true })).text, 'cached') // a hit is served offline
assert.equal((await claude({ ...q, cache: true })).usd, 0)

assert.notEqual(cacheKey({ ...q, seed: 'a' }), cacheKey({ ...q, seed: 'b' }))
assert.equal(cacheKey(q), cacheKey({ ...q, tag: 'other' })) // the tag is a label, not part of what the model sees
console.log('store self-check: ok')
