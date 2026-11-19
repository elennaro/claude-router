// Self-check of the store and offline mode (free, no model calls): a miss in offline mode is refused, never paid;
// a row reads back exactly; the sample id keeps repeat samples apart. Usage: node store.test.mjs
import assert from 'node:assert/strict'

process.env.EVAL_OFFLINE = '1'
const { OfflineMiss, cacheGet, cacheKey, cachePut, claude, pool, spent } = await import('./lib.mjs')
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
