// Small-diff review eval: can Sonnet high review a small diff as well as Opus high (the floor for code review)?
// 20 synthetic diffs with one planted correctness or security bug each, plus 4 clean diffs. The model answers in a
// JSON schema (line + summary per bug); a bug counts as found when a reported line is within 3 of the planted line or
// its summary names the bug (a key regex). No judge. Every answer is cached in work/eval.db and paid once.
// Usage: node review/run.mjs               (pays for answers the store lacks; EVAL_CAP_USD, default $5)
//        EVAL_OFFLINE=1 node review/run.mjs  (replays the store for $0)
//        node review/run.mjs --test        (self-check of the cases and the scorer, no model calls)
// Billing: run with ANTHROPIC_API_KEY set to the platform key (ROUTER_EVAL_API_KEY) for this process only.
import { claude, pool, log } from '../lib.mjs'

const MARK = ' //BUG'
// A case: id, language, the diff with the bug line ending in MARK (stripped before the model sees it), key regex.
// Clean cases have no MARK and key null.
const C = (id, lang, diff, key) => ({ id, lang, diff: diff.trim(), key })

export const CASES = [
  C('off-by-one', 'py', `
--- a/paging.py
+++ b/paging.py
@@ -1,9 +1,12 @@
 def page(items, number, size):
-    return items
+    """Return page \`number\` (1-based) of \`items\`."""
+    if number < 1 or size < 1:
+        raise ValueError("number and size must be positive")
+    start = number * size //BUG
+    return items[start:start + size]
`, /1-based|first page|skip|off.by.one|number ?- ?1|\(number - 1\)/i),
  C('inverted-check', 'ts', `
--- a/auth.ts
+++ b/auth.ts
@@ -10,6 +10,10 @@ export function canEdit(user: User, doc: Doc): boolean {
-  return false
+  if (user.isAdmin) return true
+  // owners and editors may edit; viewers may not
+  if (doc.ownerId === user.id) return true
+  return !doc.editors.includes(user.id) //BUG
 }
`, /invert|negat|!doc|editors|opposite|non-editors/i),
  C('missing-await', 'ts', `
--- a/orders.ts
+++ b/orders.ts
@@ -20,6 +20,11 @@ export async function placeOrder(cart: Cart) {
   const order = await db.orders.insert(cart.toOrder())
+  try {
+    payments.charge(order.id, cart.total) //BUG
+  } catch (e) {
+    await db.orders.markFailed(order.id)
+    throw e
+  }
   return order
`, /await|promise|unhandled|async/i),
  C('sql-injection', 'py', `
--- a/users.py
+++ b/users.py
@@ -5,4 +5,8 @@ def find_user(conn, email):
-    pass
+    cur = conn.cursor()
+    cur.execute(f"SELECT id, name FROM users WHERE email = '{email}'") //BUG
+    row = cur.fetchone()
+    return row
`, /inject|parameter|placeholder|f-string|interpolat/i),
  C('mutable-default', 'py', `
--- a/tags.py
+++ b/tags.py
@@ -1,4 +1,7 @@
-def add_tag(tag):
-    return [tag]
+def add_tag(tag, tags=[]): //BUG
+    """Add a tag to the list and return it."""
+    tags.append(tag)
+    return tags
`, /mutable|default|shared|persist/i),
  C('wrong-variable', 'js', `
--- a/cart.js
+++ b/cart.js
@@ -3,6 +3,10 @@ function total(lines, discount) {
-  return 0
+  let sum = 0
+  for (const line of lines) {
+    sum += line.price * line.qty
+  }
+  return sum - sum * discount.rate * 0 + discount.rate //BUG
 }
`, /discount|rate|\* ?0|wrong|always/i),
  C('closure-var', 'js', `
--- a/buttons.js
+++ b/buttons.js
@@ -1,5 +1,9 @@
 function bind(buttons, onPick) {
-  // TODO
+  for (var i = 0; i < buttons.length; i++) { //BUG
+    buttons[i].addEventListener('click', function () {
+      onPick(i)
+    })
+  }
 }
`, /var|closure|let|same (index|value)|last/i),
  C('ms-vs-s', 'ts', `
--- a/session.ts
+++ b/session.ts
@@ -4,5 +4,8 @@ const TTL_SECONDS = 30 * 60
 export function isExpired(s: Session, now = Date.now()): boolean {
-  return false
+  // s.createdAt is epoch milliseconds
+  const age = now - s.createdAt
+  return age > TTL_SECONDS //BUG
 }
`, /millisecond|seconds|unit|1000|ms/i),
  C('swallowed-error', 'py', `
--- a/backup.py
+++ b/backup.py
@@ -8,5 +8,10 @@ def backup(src, dst):
-    shutil.copy(src, dst)
+    try:
+        shutil.copy(src, dst)
+        return True
+    except Exception:
+        return True //BUG
`, /swallow|return(s)? True|success|hide|ignor|silent/i),
  C('regex-anchor', 'ts', `
--- a/validate.ts
+++ b/validate.ts
@@ -1,3 +1,5 @@
-export const isId = (s: string) => true
+// ids are exactly 8 hex characters
+const ID = /[0-9a-f]{8}/ //BUG
+export const isId = (s: string) => ID.test(s)
`, /anchor|\^|\$|partial|substring|longer|exactly/i),
  C('path-traversal', 'py', `
--- a/files.py
+++ b/files.py
@@ -3,4 +3,8 @@ BASE = "/srv/uploads"
 def read_upload(name):
-    raise NotImplementedError
+    path = os.path.join(BASE, name) //BUG
+    with open(path, "rb") as f:
+        return f.read()
`, /travers|\.\.|escape|outside|sanitiz|normaliz|realpath|abspath/i),
  C('float-money', 'py', `
--- a/invoice.py
+++ b/invoice.py
@@ -2,4 +2,7 @@ def split(total_cents, people):
-    return [total_cents]
+    """Split a bill in cents so the parts add up to the total."""
+    share = total_cents // people
+    return [share] * people //BUG
`, /remainder|add up|sum|lost|leftover|cent/i),
  C('missing-break', 'js', `
--- a/status.js
+++ b/status.js
@@ -1,6 +1,12 @@
 function label(code) {
   let text
-  text = 'unknown'
+  switch (code) {
+    case 200: text = 'ok' //BUG
+    case 404: text = 'not found'; break
+    case 500: text = 'error'; break
+    default: text = 'unknown'
+  }
   return text
 }
`, /break|fall.?through|falls/i),
  C('resource-leak', 'py', `
--- a/config.py
+++ b/config.py
@@ -1,4 +1,7 @@
 def load(path):
-    return {}
+    f = open(path) //BUG
+    data = json.load(f)
+    f.close()
+    return data
`, /close|leak|with |context manager|exception/i),
  C('null-deref', 'ts', `
--- a/profile.ts
+++ b/profile.ts
@@ -5,4 +5,7 @@ export async function displayName(id: string): Promise<string> {
-  return ''
+  // findUser returns null when the id is unknown
+  const user = await findUser(id)
+  return user.firstName + ' ' + user.lastName //BUG
 }
`, /null|undefined|unknown id|optional|check/i),
  C('race-check-then-act', 'py', `
--- a/stock.py
+++ b/stock.py
@@ -4,5 +4,9 @@ def reserve(db, sku, qty):
-    pass
+    row = db.execute("SELECT qty FROM stock WHERE sku = ?", (sku,)).fetchone()
+    if row[0] >= qty: //BUG
+        db.execute("UPDATE stock SET qty = qty - ? WHERE sku = ?", (qty, sku))
+        return True
+    return False
`, /race|concurren|atomic|lock|transaction|oversell/i),
  C('integer-division', 'py', `
--- a/stats.py
+++ b/stats.py
@@ -1,3 +1,6 @@
 def hit_rate(hits, total):
-    return 0
+    if total == 0:
+        return 0.0
+    return float(hits // total) //BUG
`, /integer|floor|\/\/|truncat|always 0/i),
  C('timezone', 'py', `
--- a/report.py
+++ b/report.py
@@ -2,4 +2,7 @@ from datetime import datetime, timezone
 def is_today(ts):
-    return False
+    """ts is an aware UTC datetime."""
+    today = datetime.now().date() //BUG
+    return ts.date() == today
`, /timezone|utc|local|naive|aware/i),
  C('secret-log', 'ts', `
--- a/login.ts
+++ b/login.ts
@@ -3,5 +3,8 @@ export async function login(email: string, password: string) {
-  return api.login(email, password)
+  const res = await api.login(email, password)
+  logger.info('login attempt', { email, password, ok: res.ok }) //BUG
+  return res
 }
`, /password|secret|log|sensitive|credential/i),
  C('wrong-compare', 'js', `
--- a/retry.js
+++ b/retry.js
@@ -1,6 +1,9 @@
 async function withRetry(fn, attempts = 3) {
-  return fn()
+  for (let i = 1; i <= attempts; i++) {
+    try { return await fn() }
+    catch (e) { if (i = attempts) throw e } //BUG
+  }
 }
`, /assign|===|==|= attempts|first attempt|never retr/i),
  C('clean-guard', 'py', `
--- a/paging.py
+++ b/paging.py
@@ -1,4 +1,8 @@
 def page(items, number, size):
-    return items
+    if number < 1 or size < 1:
+        raise ValueError("number and size must be positive")
+    start = (number - 1) * size
+    return items[start:start + size]
`, null),
  C('clean-rename', 'ts', `
--- a/user.ts
+++ b/user.ts
@@ -1,5 +1,5 @@
-export function fullName(u: User): string {
-  return \`\${u.first} \${u.last}\`.trim()
+export function displayName(u: User): string {
+  return \`\${u.first} \${u.last}\`.trim()
 }
`, null),
  C('clean-with', 'py', `
--- a/config.py
+++ b/config.py
@@ -1,4 +1,6 @@
 def load(path):
-    return {}
+    with open(path, encoding="utf-8") as f:
+        return json.load(f)
`, null),
  C('clean-await', 'ts', `
--- a/orders.ts
+++ b/orders.ts
@@ -20,6 +20,11 @@ export async function placeOrder(cart: Cart) {
   const order = await db.orders.insert(cart.toOrder())
+  try {
+    await payments.charge(order.id, cart.total)
+  } catch (e) {
+    await db.orders.markFailed(order.id)
+    throw e
+  }
   return order
`, null),
]

// The diff as the model sees it (numbered, marker stripped) and the planted line's number (null for clean cases).
export function shown(c) {
  const lines = c.diff.split('\n')
  const at = lines.findIndex(l => l.endsWith(MARK))
  const text = lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l.endsWith(MARK) ? l.slice(0, -MARK.length) : l}`).join('\n')
  return { text, line: at < 0 ? null : at + 1 }
}

const SYSTEM = 'You review code changes. Report only real defects the change introduces: wrong behaviour, crashes, data loss, security holes. No style, naming or nit comments. If there is no such defect, return an empty list.'
const ask = c => `Review this ${c.lang} diff. Line numbers are on the left. For each defect give the line number and one sentence.\n\n${shown(c).text}`
const SCHEMA = { type: 'object', properties: { bugs: { type: 'array', items: { type: 'object', properties: { line: { type: 'integer' }, summary: { type: 'string' } }, required: ['line', 'summary'] } } }, required: ['bugs'] }

// found: the planted bug was reported (line within 3, or a summary matching the key); alarms: reports on a clean diff.
export function score(c, bugs) {
  const { line } = shown(c)
  if (line === null) return { clean: true, alarms: bugs.length }
  return { clean: false, found: bugs.some(b => Math.abs(b.line - line) <= 3 || c.key.test(b.summary)) }
}

// REVIEW_SMOKE=1: three cases on Haiku, to check the plumbing for cents before the paid arms
const SMOKE = Boolean(process.env.REVIEW_SMOKE)
const ARMS = SMOKE ? [['haiku', 'low']] : [['sonnet', 'high'], ['opus', 'high']]
const SEEDS = SMOKE ? [1] : [1, 2]

async function main() {
  const cases = SMOKE ? [CASES[0], CASES[3], CASES[20]] : CASES
  const jobs = ARMS.flatMap(([model, effort]) => SEEDS.flatMap(seed => cases.map(c => ({ c, model, effort, seed }))))
  const rows = await pool(jobs, 4, async j => {
    const r = await claude({ model: j.model, effort: j.effort, system: SYSTEM, prompt: ask(j.c), json: SCHEMA, seed: j.seed, cache: true, tag: `review:${j.c.id}:${j.model}` })
    const bugs = r.structured?.bugs ?? (() => { try { return JSON.parse(r.text).bugs ?? [] } catch { return [] } })()
    return { ...j, s: score(j.c, bugs), usd: r.usd, cached: r.cached }
  })
  const bad = rows.filter(x => !x || x.error)
  if (bad.length) { console.log(`${bad.length} job(s) failed: ${bad.slice(0, 3).map(x => x?.error).join('; ')}`); process.exitCode = 1 }
  const ok = rows.filter(x => x && !x.error)
  for (const [model] of ARMS) {
    const m = ok.filter(x => x.model === model)
    const planted = m.filter(x => !x.s.clean), clean = m.filter(x => x.s.clean)
    const missed = [...new Set(planted.filter(x => !x.s.found).map(x => x.c.id))]
    console.log(`${model}: found ${planted.filter(x => x.s.found).length}/${planted.length} planted bugs, false alarms on ${clean.filter(x => x.s.alarms).length}/${clean.length} clean diffs, paid $${m.reduce((a, x) => a + x.usd, 0).toFixed(2)}${missed.length ? `; missed: ${missed.join(', ')}` : ''}`)
  }
  log('done')
}

function selfTest() {
  const assert = (ok, what) => { if (!ok) throw new Error(`self-test: ${what}`) }
  assert(new Set(CASES.map(c => c.id)).size === CASES.length, 'ids unique')
  for (const c of CASES) {
    const { text, line } = shown(c)
    assert(!text.includes(MARK.trim()), `${c.id}: marker leaks into the prompt`)
    assert((line === null) === (c.key === null), `${c.id}: a planted case needs a key, a clean case none`)
    assert(c.diff.split('\n').filter(l => l.endsWith(MARK)).length <= 1, `${c.id}: one bug per case`)
    if (line !== null) {
      assert(score(c, [{ line, summary: 'x' }]).found, `${c.id}: the exact line counts`)
      assert(!score(c, [{ line: line + 9, summary: 'looks fine' }]).found, `${c.id}: a far line with no key words does not count`)
      assert(!score(c, []).found, `${c.id}: no report, not found`)
    } else assert(score(c, []).alarms === 0 && score(c, [{ line: 1, summary: 'x' }]).alarms === 1, `${c.id}: alarms count`)
  }
  assert(CASES.filter(c => c.key).length === 20 && CASES.filter(c => !c.key).length === 4, '20 planted, 4 clean')
  console.log('review self-test: ok')
}

if (process.argv[2] === '--test') selfTest()
else if (process.argv[1]?.replace(/\\/g, '/').endsWith('review/run.mjs')) main().catch(e => { console.error(e.message); process.exitCode = 1 })
