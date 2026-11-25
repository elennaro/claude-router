// A vision judge for the UI screenshots tests/ui.check.mjs --shots saves: scores each PNG against evals/ui/rubric.md
// and lists what code can't check (hierarchy, clutter, wording). Every answer is cached in work/eval.db under the
// image's SHA-256 and the rubric, so unchanged pictures cost $0 on a re-run; EVAL_OFFLINE=1 makes a miss an error.
//   node evals/ui/judge.mjs <dir> [--only <substring>] [--model haiku]
// Haiku under a $2 cap by default (EVAL_CAP_USD). Any other model needs --owner-ok: the owner approves its cost first.
// --test runs the self-check (no model calls).
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.EVAL_CAP_USD ??= '2'
const { claude, CapReached, pool } = await import('../lib.mjs')
const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const RUBRIC = readFileSync(join(HERE, 'rubric.md'), 'utf8')
const SCHEMA = {
  type: 'object', required: ['score', 'findings'], additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 5 },
    findings: { type: 'array', maxItems: 5, items: { type: 'object', required: ['where', 'problem', 'fix'], additionalProperties: false, properties: { where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } },
  },
}
// The model sees a copy named by its hash, so the cache key (prompt, model, rubric) changes exactly when the picture does.
export const promptFor = (hash, name) => `Read the image file ${hash}.png (a screenshot named "${name}") and review it as the system prompt says. Answer in the JSON schema.`
export const hashOf = buf => createHash('sha256').update(buf).digest('hex')

if (args.includes('--test')) {
  const a = hashOf(Buffer.from('x')), b = hashOf(Buffer.from('y'))
  if (a === b || promptFor(a, 'n') === promptFor(b, 'n') || !promptFor(a, 'board-800-dark').includes(`${a}.png`)) throw new Error('judge: hash or prompt does not follow the picture')
  console.log('judge self-test: ok')
  process.exit(0)
}

const dir = args.find(a => !a.startsWith('--') && a !== opt('--only') && a !== opt('--model'))
const model = opt('--model', 'haiku')
if (!dir) { console.error('usage: node evals/ui/judge.mjs <dir of PNGs> [--only <text>] [--model haiku]'); process.exit(2) }
if (model !== 'haiku' && !args.includes('--owner-ok')) { console.error(`judge: ${model} costs more than Haiku; ask the owner, then add --owner-ok`); process.exit(2) }

const files = readdirSync(dir).filter(f => f.endsWith('.png') && f.includes(opt('--only', ''))).sort()
const work = join(tmpdir(), `router-ui-judge-${process.pid}`)
mkdirSync(work, { recursive: true })
let usd = 0, cached = 0
try {
  const rows = await pool(files, 4, async f => {
    const hash = hashOf(readFileSync(join(dir, f)))
    copyFileSync(join(dir, f), join(work, `${hash}.png`))
    const r = await claude({ model, system: RUBRIC, prompt: promptFor(hash, f.replace(/\.png$/, '')), tools: 'Read', cwd: work, json: SCHEMA, cache: true, tag: 'ui-judge' })
    usd += r.usd
    if (r.cached) cached++
    return { f, ...(r.structured ?? JSON.parse(r.text)) }
  })
  for (const [i, r] of rows.entries()) if (r?.error) console.log(`error  ${files[i]}: ${r.error.slice(0, 200)}`)
  for (const r of rows.filter(r => r && !r.error).sort((a, b) => a.score - b.score)) {
    console.log(`${r.score}/5  ${r.f}`)
    for (const x of r.findings) console.log(`      ${x.where}: ${x.problem} → ${x.fix}`)
  }
} catch (e) {
  if (!(e instanceof CapReached)) throw e
  console.error(`judge: stopped, ${e.message}`)
} finally { rmSync(work, { recursive: true, force: true }) }
console.log(`judge: ${files.length} screenshot(s), ${cached} from the cache, $${usd.toFixed(3)} spent (${model})`)
