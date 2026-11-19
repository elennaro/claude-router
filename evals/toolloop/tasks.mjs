// Tool-loop tasks over the fixture repo, each with an exact check (no judge).
// kind: explore = find, count, run and report (Haiku's job); tiny-edit = a self-contained edit of about 10 lines
// or a one-off script (the only code Haiku may write); scoped = a change that reaches other files (never Haiku:
// the control that shows the boundary).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const answer = text => (text.match(/ANSWER:\s*(.+)\s*$/im)?.[1] ?? '').trim().replace(/\\/g, '/') // Windows paths count too
const paths = s => new Set((s.match(/src\/[\w/.-]+\.js/g) ?? []))
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))
const num = s => Number((s.match(/-?\d[\d,]*(?:\.\d+)?/) ?? [''])[0].replace(/,/g, ''))
const node = (dir, ...args) => { try { return execFileSync('node', args, { cwd: dir, encoding: 'utf8', timeout: 30_000 }).trim() } catch { return null } }
// files other than the allowed ones are unchanged
const untouched = (dir, files, allowed) => Object.entries(files).every(([p, text]) => allowed.includes(p) || readFileSync(join(dir, p), 'utf8') === text)

export const TASKS = [
  { id: 'find-def', kind: 'explore', prompt: 'Where is the function roundCents defined? Give the file path and line number.',
    check: (t, f) => answer(t).includes(`src/lib/money.js:${f.facts.defLine}`) },
  { id: 'callers', kind: 'explore', prompt: 'List every file under src/orders that calls roundCents, directly or through any re-export or alias. Mentions in comments do not count.',
    check: (t, f) => sameSet(paths(answer(t)), new Set(f.facts.callers)) },
  { id: 'flag-reads', kind: 'explore', prompt: 'Which files read the checkoutV2 feature flag? Exclude the file that defines it.',
    check: (t, f) => sameSet(paths(answer(t)), new Set(f.facts.flagReaders)) },
  { id: 'todos', kind: 'explore', prompt: 'How many TODO comments are there under src/?',
    check: (t, f) => num(answer(t)) === f.facts.todos },
  { id: 'log-errors', kind: 'explore', prompt: 'Count the ERROR lines across all files in logs/. Give the total.',
    check: (t, f) => num(answer(t)) === f.facts.errors },
  { id: 'log-fatal', kind: 'explore', prompt: 'One job in logs/ died with a FATAL line. Which job, and what error code?',
    check: (t, f) => answer(t).includes(f.facts.fatal.job) && answer(t).includes(f.facts.fatal.code) },
  { id: 'csv-total', kind: 'explore', prompt: 'What is the total amount for region north in data/sales.csv? Two decimals.',
    check: (t, f) => Math.abs(num(answer(t)) - f.facts.northTotal) < 0.006 },
  { id: 'run-stats', kind: 'explore', prompt: 'Run scripts/stats.mjs with node and tell me the p90 value it prints.',
    check: (t, f) => answer(t).includes(f.facts.p90) },
  { id: 'unused-export', kind: 'explore', prompt: 'Which function exported from src/lib/money.js is never imported or re-exported anywhere in the repo?',
    check: t => /percentOf/.test(answer(t)) && !/addTax|roundCents/.test(answer(t)) },
  { id: 'private-helper', kind: 'tiny-edit', prompt: 'In src/orders/receipt.js add a small private helper padId(id) (not exported) that left-pads the id with zeros to 6 characters, and use it in formatLine. Change no other file. Reply ANSWER: done when finished.',
    check: (t, f, dir) => {
      if (!untouched(dir, f.files, ['src/orders/receipt.js'])) return false
      const src = readFileSync(join(dir, 'src/orders/receipt.js'), 'utf8')
      if (/export\s+(function|const)\s+padId/.test(src)) return false
      return node(dir, '--input-type=module', '-e', "import { formatLine } from './src/orders/receipt.js'; console.log(formatLine(42, 'mug', 3.5))") === '000042 mug 3.50'
    } },
  { id: 'one-off-script', kind: 'tiny-edit', prompt: 'Write scripts/count_regions.mjs: it reads data/sales.csv and prints one line per region, "region count", sorted by region name. Change no other file. Reply ANSWER: done when finished.',
    check: (t, f, dir) => {
      if (!untouched(dir, f.files, []) || !existsSync(join(dir, 'scripts/count_regions.mjs'))) return false
      const want = Object.keys(f.facts.regionCounts).sort().map(k => `${k} ${f.facts.regionCounts[k]}`).join('\n')
      return node(dir, 'scripts/count_regions.mjs')?.replace(/\r/g, '') === want
    } },
  { id: 'rename', kind: 'scoped', prompt: 'Rename roundCents to roundToCents everywhere: the definition, every caller and the re-export. Keep behavior the same; node test/run.mjs must still pass. Reply ANSWER: done when finished.',
    check: (t, f, dir) => {
      const src = Object.keys(f.files).filter(p => p.startsWith('src/')).map(p => readFileSync(join(dir, p), 'utf8')).join('\n')
      return !/roundCents/.test(src.replace(/\/\/.*$/gm, '')) && /roundToCents/.test(src) && node(dir, 'test/run.mjs') === 'tests ok'
    } },
]
