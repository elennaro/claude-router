// The checks must pass the right answer and fail a near miss, and the fixture must be sound.
// Usage: node toolloop/checks.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, write } from './fixture.mjs'
import { TASKS } from './tasks.mjs'

const f = build()
const dir = mkdtempSync(join(tmpdir(), 'toolloop-check-'))
try {
  write(dir, f.files)
  const node = (...a) => execFileSync('node', a, { cwd: dir, encoding: 'utf8' }).trim()
  assert.equal(node('test/run.mjs'), 'tests ok')
  assert.match(node('scripts/stats.mjs'), new RegExp(`p90=${f.facts.p90}$`))
  assert.ok(f.facts.callers.length >= 2 && f.facts.callers.length < 10, 'callers: some files, not all')
  assert.ok(Object.values(f.files).some(t => t.includes('used to go through roundCents')), 'a comment-only mention to trip naive grep')
  assert.ok(Object.values(f.files).some(t => t.includes('round, addTax')), 'an alias caller')

  const t = id => TASKS.find(x => x.id === id)
  const good = {
    'find-def': `src/lib/money.js:${f.facts.defLine}`, callers: f.facts.callers.join(', '), 'flag-reads': f.facts.flagReaders.join(' '),
    todos: String(f.facts.todos), 'log-errors': String(f.facts.errors), 'log-fatal': `${f.facts.fatal.job}, code ${f.facts.fatal.code}`,
    'csv-total': f.facts.northTotal.toFixed(2), 'run-stats': f.facts.p90, 'unused-export': 'percentOf',
  }
  const bad = {
    'find-def': `src/lib/money.js:${f.facts.defLine + 1}`, callers: f.facts.callers.slice(1).join(', '), 'flag-reads': [...f.facts.flagReaders, 'src/config/flags.js'].join(' '),
    todos: String(f.facts.todos + 1), 'log-errors': String(f.facts.errors - 1), 'log-fatal': f.facts.fatal.job,
    'csv-total': (f.facts.northTotal + 1).toFixed(2), 'run-stats': '0.00', 'unused-export': 'percentOf and addTax',
  }
  for (const [id, a] of Object.entries(good)) {
    assert.equal(t(id).check(`I looked around.\nANSWER: ${a}`, f, dir), true, `${id} passes the right answer`)
    assert.equal(t(id).check(`ANSWER: ${bad[id]}`, f, dir), false, `${id} fails a near miss`)
  }

  assert.equal(t('find-def').check(`ANSWER: src\\lib\\money.js:${f.facts.defLine}`, f, dir), true, 'Windows paths pass')
  assert.equal(t('callers').check(`ANSWER: ${f.facts.callers.map(p => p.replace(/\//g, '\\')).join(', ')}`, f, dir), true, 'Windows path lists pass')

  // edits: nothing done fails; the right edit passes; touching another file fails
  for (const id of ['private-helper', 'one-off-script', 'rename']) assert.equal(t(id).check('ANSWER: done', f, dir), false, `${id} not done`)
  const receipt = join(dir, 'src/orders/receipt.js')
  writeFileSync(receipt, "function padId(id) {\n  return String(id).padStart(6, '0')\n}\nexport function formatLine(id, title, total) {\n  return `${padId(id)} ${title} ${total.toFixed(2)}`\n}\n")
  assert.equal(t('private-helper').check('', f, dir), true)
  writeFileSync(receipt, readFileSync(receipt, 'utf8').replace('function padId', 'export function padId'))
  assert.equal(t('private-helper').check('', f, dir), false, 'exported helper fails')
  write(dir, { 'src/orders/receipt.js': f.files['src/orders/receipt.js'] })

  const script = join(dir, 'scripts/count_regions.mjs')
  writeFileSync(script, "import { readFileSync } from 'node:fs'\nconst c = {}\nfor (const l of readFileSync('data/sales.csv', 'utf8').trim().split('\\n').slice(1)) { const r = l.split(',')[0]; c[r] = (c[r] ?? 0) + 1 }\nfor (const k of Object.keys(c).sort()) console.log(`${k} ${c[k]}`)\n")
  assert.equal(t('one-off-script').check('', f, dir), true)
  writeFileSync(join(dir, 'data/sales.csv'), f.files['data/sales.csv'] + 'east,1\n')
  assert.equal(t('one-off-script').check('', f, dir), false, 'edited data fails')
  write(dir, { 'data/sales.csv': f.files['data/sales.csv'] })
  rmSync(script)

  for (const p of Object.keys(f.files).filter(p => p.startsWith('src/'))) {
    writeFileSync(join(dir, p), readFileSync(join(dir, p), 'utf8').replace(/roundCents/g, 'roundToCents'))
  }
  assert.equal(t('rename').check('', f, dir), true)
  console.log('toolloop checks ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
