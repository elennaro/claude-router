// Runs the router's checks and paid eval suites in a fresh Linux container (evals/docker/Dockerfile), billed to the
// API key, not the subscription. Every run is a new container (--rm); only evals/work is mounted, so the answer store
// (work/eval.db) and the spend log persist and every answer is still paid once.
// Usage (from evals/):
//   node docker.mjs --check             free: build, then the engine tests, validate, db check, eval self-tests and
//                                       the offline replay, each in its own container
//   node docker.mjs paste/run.mjs [args]  a paid suite (evals/work and evals/results mounted): needs ROUTER_EVAL_API_KEY (a platform API key) in this shell; EVAL_CAP_USD (default 10,
//                                       never above 50) caps this run
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const evals = dirname(fileURLToPath(import.meta.url))
const repo = join(evals, '..')
const work = join(evals, 'work')
const IMAGE = 'claude-router-evals'
export const HARD_CAP = 50 // the owner's ceiling for all Docker evals together; one run never asks for more

const docker = (args, quiet) => spawnSync('docker', args, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })

function build() {
  const r = docker(['build', '-q', '-t', IMAGE, '-f', join(evals, 'docker', 'Dockerfile'), repo], true)
  if (r.status !== 0) throw new Error(`docker build failed:\n${r.stderr || r.stdout}`)
}

// One fresh container. The key and cap are passed by name, so docker reads their values from this process's
// environment and they never appear in an argv, a log or the image.
function inBox(cwd, argv, env = [], mounts = []) {
  mkdirSync(work, { recursive: true })
  const args = ['run', '--rm', '-v', `${work}:/repo/evals/work`, '-w', `/repo/${cwd}`, ...mounts.flatMap(m => ['-v', m]), ...env.flatMap(e => ['-e', e]), IMAGE, ...argv]
  return docker(args).status ?? 1
}

// The cap a paid run asks for: EVAL_CAP_USD or $10, refused above the hard cap.
export function capFor(v) {
  const cap = v === undefined || v === '' ? 10 : Number(v)
  if (!(cap > 0) || cap > HARD_CAP) throw new Error(`EVAL_CAP_USD must be above 0 and at most ${HARD_CAP} (got ${v})`)
  return cap
}

// A pasted command or a stray value in the key slot fails here, before a container starts.
export const looksLikeKey = k => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim())

const CHECKS = [
  ['router', ['claude', '--version']],
  ['router', ['claude', 'plugin', 'validate', '.']],
  ['router', ['claude', 'plugin', 'test', '.']],
  ['router', ['node', 'tests/db.check.mjs']],
  ['evals', ['node', 'store.test.mjs']],
  ['evals', ['node', 'toolloop/checks.test.mjs']],
  ['evals', ['node', 'paste/run.mjs', '--test']],
  ['evals', ['node', 'precedents.test.mjs']],
]

function main() {
  const [what] = process.argv.slice(2)
  if (!what) { console.log('usage: node docker.mjs --check | <suite.mjs>'); process.exitCode = 2; return }
  build()
  if (what === '--check') {
    const failed = CHECKS.filter(([cwd, argv]) => { console.log(`\n== ${argv.join(' ')}`); return inBox(cwd, argv) !== 0 })
    // the offline replay reads the store; a fresh clone has none, so it runs only where the store exists
    const replay = inBox('evals', ['node', 'fast.mjs'], ['EVAL_OFFLINE=1'])
    console.log(failed.length || replay ? `\nLINUX CHECK FAIL: ${[...failed.map(([, a]) => a.join(' ')), ...(replay ? ['fast.mjs'] : [])].join(', ')}` : '\nLINUX CHECK PASS')
    process.exitCode = failed.length || replay ? 1 : 0
    return
  }
  // The key lives under its own name, so Claude Code on this machine never picks it up and bills the API instead of
  // the subscription; only the container sees it as ANTHROPIC_API_KEY.
  const key = process.env.ROUTER_EVAL_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  if (!looksLikeKey(key)) throw new Error('ROUTER_EVAL_API_KEY is missing or not an Anthropic API key (sk-ant-...); paid runs bill the API key, never the subscription')
  process.env.ANTHROPIC_API_KEY = key
  process.env.EVAL_CAP_USD = String(capFor(process.env.EVAL_CAP_USD))
  console.log(`running ${what} in a fresh container, cap $${process.env.EVAL_CAP_USD}`)
  // a paid run also reads and appends evals/results; the free checks stay off the host's files
  process.exitCode = inBox('evals', ['node', ...process.argv.slice(2)], ['ANTHROPIC_API_KEY', 'EVAL_CAP_USD'], [`${join(evals, 'results')}:/repo/evals/results`])
}

if (process.argv[2] === '--self-test') {
  const throws = v => { try { capFor(v); return false } catch { return true } }
  if (capFor(undefined) !== 10 || capFor('') !== 10 || capFor('5') !== 5 || capFor('50') !== 50 || !throws('51') || !throws('0') || !throws('abc')) throw new Error('self-test: cap rules')
  if (!looksLikeKey('sk-ant-api03-' + 'x'.repeat(40)) || looksLikeKey('cd F:\\work\\claude-router\\plugin\\evals; node docker.mjs paste/run.mjs --x') || looksLikeKey('sk-proj-' + 'x'.repeat(40)) || looksLikeKey('task-ant-' + 'x'.repeat(40)) || looksLikeKey('')) throw new Error('self-test: key check')
  console.log('docker runner self-test: ok')
} else if (process.argv[1]?.replace(/\\/g, '/').endsWith('evals/docker.mjs')) main()
