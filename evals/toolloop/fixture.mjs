// A small synthetic shop repo with planted facts, built the same way every time (seeded), plus the true answers.
// The tool-loop tasks ask about it; the checks compare against these facts, so no judge is involved.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function build(seed = 7) {
  const r = rng(seed)
  const pick = a => a[Math.floor(r() * a.length)]
  const files = {}
  const facts = {}

  // money helpers: roundCents is re-exported as `round`; percentOf is exported and never imported
  const money = [
    '// Money helpers. Amounts are numbers in the shop currency.',
    '',
    'const EPS = 1e-9',
    '',
    'export function addTax(amount, rate) {',
    '  return amount * (1 + rate)',
    '}',
    '',
    'export function roundCents(amount) {',
    '  return Math.round((amount + EPS) * 100) / 100',
    '}',
    '',
    'export function percentOf(part, whole) {',
    '  return whole ? (100 * part) / whole : 0',
    '}',
    '',
  ]
  files['src/lib/money.js'] = money.join('\n')
  facts.defLine = money.indexOf('export function roundCents(amount) {') + 1
  files['src/lib/index.js'] = "export { addTax, roundCents as round } from './money.js'\nexport { slug } from './text.js'\n"
  files['src/lib/text.js'] = "export function slug(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')\n}\n"
  files['src/config/flags.js'] = 'export const FLAGS = {\n  checkoutV2: false,\n  fastSearch: true,\n  giftCards: false,\n}\n'

  // order modules: some call roundCents directly, some through the `round` alias, some only mention it in a comment
  const names = ['cart', 'checkout', 'refund', 'invoice', 'shipping', 'discount', 'loyalty', 'report', 'export', 'audit']
  facts.callers = []
  facts.flagReaders = []
  facts.todos = 0
  for (const n of names) {
    const how = pick(['direct', 'alias', 'comment', 'none'])
    const flag = r() < 0.4
    const todo = Math.floor(r() * 3)
    const lines = []
    if (how === 'direct') lines.push("import { roundCents } from '../lib/money.js'")
    if (how === 'alias') lines.push("import { round, addTax } from '../lib/index.js'")
    if (flag) lines.push("import { FLAGS } from '../config/flags.js'")
    lines.push('')
    if (how === 'comment') lines.push('// totals here used to go through roundCents; now the caller rounds')
    for (let k = 0; k < todo; k++) lines.push(`// TODO: ${pick(['split this', 'cache the lookup', 'handle empty input', 'log the slow path'])}`)
    lines.push(`export function ${n}Total(items) {`, '  let sum = 0', '  for (const it of items) sum += it.price * it.qty')
    if (flag) lines.push('  if (FLAGS.checkoutV2) sum -= 0')
    if (how === 'direct') lines.push('  return roundCents(sum)')
    else if (how === 'alias') lines.push('  return round(addTax(sum, 0))')
    else lines.push('  return sum')
    lines.push('}', '')
    files[`src/orders/${n}.js`] = lines.join('\n')
    if (how === 'direct' || how === 'alias') facts.callers.push(`src/orders/${n}.js`)
    if (flag) facts.flagReaders.push(`src/orders/${n}.js`)
    facts.todos += todo
  }

  // receipt: the tiny private-edit target
  files['src/orders/receipt.js'] = "export function formatLine(id, title, total) {\n  return `${id} ${title} ${total.toFixed(2)}`\n}\n"

  // logs: 40 jobs, ERROR lines counted, one FATAL with a code
  facts.errors = 0
  const fatal = 1 + Math.floor(r() * 40)
  for (let j = 1; j <= 40; j++) {
    const id = `job-${String(j).padStart(3, '0')}`
    const lines = []
    for (let k = 0; k < 20 + Math.floor(r() * 20); k++) {
      const lvl = r() < 0.08 ? 'ERROR' : r() < 0.2 ? 'WARN' : 'INFO'
      if (lvl === 'ERROR') facts.errors++
      lines.push(`2026-03-${String(1 + (j % 28)).padStart(2, '0')}T0${k % 10}:00:00Z ${lvl} ${pick(['render step', 'upload', 'cache warm', 'resize', 'notify'])} ${lvl === 'ERROR' ? 'failed' : 'ok'}`)
    }
    if (j === fatal) { lines.push(`2026-03-${String(1 + (j % 28)).padStart(2, '0')}T09:59:00Z FATAL disk quota exceeded (code E-${400 + j})`); facts.fatal = { job: id, code: `E-${400 + j}` } }
    files[`logs/${id}.log`] = lines.join('\n') + '\n'
  }

  // sales: 200 rows; north total and per-region counts
  const regions = ['east', 'north', 'south', 'west']
  const rows = ['region,amount']
  facts.northTotal = 0
  facts.regionCounts = {}
  for (let k = 0; k < 200; k++) {
    const reg = pick(regions), amt = Math.round(r() * 50000) / 100
    rows.push(`${reg},${amt}`)
    if (reg === 'north') facts.northTotal += amt
    facts.regionCounts[reg] = (facts.regionCounts[reg] ?? 0) + 1
  }
  facts.northTotal = Math.round(facts.northTotal * 100) / 100
  files['data/sales.csv'] = rows.join('\n') + '\n'

  // a script whose output can only be learned by running it
  files['scripts/stats.mjs'] = "import { readFileSync } from 'node:fs'\nconst xs = readFileSync(new URL('../data/sales.csv', import.meta.url), 'utf8').trim().split('\\n').slice(1).map(l => Number(l.split(',')[1])).sort((a, b) => a - b)\nconst k = Math.floor(xs.length * 0.9)\nconsole.log(`rows=${xs.length} p90=${(xs[k] * 1.07).toFixed(2)}`)\n"
  const xs = rows.slice(1).map(l => Number(l.split(',')[1])).sort((a, b) => a - b)
  facts.p90 = (xs[Math.floor(xs.length * 0.9)] * 1.07).toFixed(2)

  // the tests a rename must keep passing
  files['test/run.mjs'] = [
    "import assert from 'node:assert/strict'",
    "import * as money from '../src/lib/money.js'",
    "import * as lib from '../src/lib/index.js'",
    "const round = Object.values(money).find(f => typeof f === 'function' && /^round/i.test(f.name))",
    'assert.equal(round(1.005), 1.01)',
    'assert.equal(Object.values(lib).filter(f => typeof f === "function").length, 3)',
    ...names.map(n => `assert.equal(typeof (await import('../src/orders/${n}.js')).${n}Total([{ price: 1.111, qty: 3 }]), 'number')`),
    "console.log('tests ok')",
    '',
  ].join('\n')
  files['package.json'] = '{ "name": "shop", "private": true, "type": "module" }\n'
  return { files, facts }
}

export function write(dir, files) {
  for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
}
