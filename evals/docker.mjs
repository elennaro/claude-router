// Runs the router's checks and paid eval suites in a fresh Linux container (evals/docker/Dockerfile), billed to the
// API key, not the subscription. Every run is a new container (--rm); only evals/work is mounted, so the answer store
// (work/eval.db) and the spend log persist and every answer is still paid once.
// Usage (from evals/):
//   node docker.mjs --check             free: build, then the engine tests, validate, db check, eval self-tests and
//                                       the offline replay, each in its own container
//   node docker.mjs paste/run.mjs       a paid suite: needs ANTHROPIC_API_KEY in this shell; EVAL_CAP_USD (default 10,
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
function inBox(cwd, argv, env = []) {
  mkdirSync(work, { recursive: true })
  const args = ['run', '--rm', '-v', `${work}:/repo/evals/work`, '-w', `/repo/${cwd}`, ...env.flatMap(e => ['-e', e]), IMAGE, ...argv]
  return docker(args).status ?? 1
}

// The cap a paid run asks for: EVAL_CAP_USD or $10, refused above the hard cap.
export function capFor(v) {
  const cap = v === undefined || v === '' ? 10 : Number(v)
  if (!(cap > 0) || cap > HARD_CAP) throw new Error(`EVAL_CAP_USD must be above 0 and at most ${HARD_CAP} (got ${v})`)
  return cap
}

const CHECKS = [
  ['router', ['claude', '--version']],
  ['router', ['claude', 'plugin', 'validate', '.']],
  ['router', ['claude', 'plugin', 'test', '.']],
  ['router', ['node', 'tests/db.check.mjs']],
  ['evals', ['node', 'store.test.mjs']],
  ['evals', ['node', 'toolloop/checks.test.mjs']],
  ['evals', ['node', 'paste/run.mjs', '--test']],
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
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in this shell; paid runs bill the API key, never the subscription')
  process.env.EVAL_CAP_USD = String(capFor(process.env.EVAL_CAP_USD))
  console.log(`running ${what} in a fresh container, cap $${process.env.EVAL_CAP_USD}`)
  process.exitCode = inBox('evals', ['node', what], ['ANTHROPIC_API_KEY', 'EVAL_CAP_USD'])
}

if (process.argv[2] === '--self-test') {
  const throws = v => { try { capFor(v); return false } catch { return true } }
  if (capFor(undefined) !== 10 || capFor('') !== 10 || capFor('5') !== 5 || capFor('50') !== 50 || !throws('51') || !throws('0') || !throws('abc')) throw new Error('self-test: cap rules')
  console.log('docker runner self-test: ok')
} else if (process.argv[1]?.replace(/\\/g, '/').endsWith('evals/docker.mjs')) main()
