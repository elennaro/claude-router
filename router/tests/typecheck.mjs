// Strict type check of the plugin (router/tsconfig.json): node tests/typecheck.mjs
// The plugin API's types are written by Claude Code itself: beside the plugin once a session has loaded it
// (.claude-plugin/types/, gitignored), or under the temp folder each time the plugin-authoring skill loads. This script
// takes the newest of those, so a check never runs against an older API than the installed Claude Code.
// Needs TypeScript 5.4+ on PATH (npm install -g typescript). Exit 0 = no type errors.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const laid = join(root, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')

// every copy the plugin-authoring skill wrote: <tmp>/claude/bundled-skills/<version>/<hash>/plugin-authoring/types/claude-code.d.ts
function skillCopies() {
  const base = join(tmpdir(), 'claude', 'bundled-skills')
  const out = []
  for (const v of existsSync(base) ? readdirSync(base) : []) {
    for (const h of readdirSync(join(base, v), { withFileTypes: true }).filter(d => d.isDirectory())) {
      const f = join(base, v, h.name, 'plugin-authoring', 'types', 'claude-code.d.ts')
      if (existsSync(f)) out.push(f)
    }
  }
  return out
}

const newest = [laid, ...skillCopies()].filter(f => existsSync(f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!newest) {
  console.error('typecheck: no plugin API types found. Start a Claude Code session with the plugin loaded once, then run this again.')
  process.exit(1)
}
if (newest !== laid) {
  mkdirSync(dirname(laid), { recursive: true })
  copyFileSync(newest, laid)
}
// TypeScript's own tsc.js, run with this node (no shell: Windows will not start tsc.cmd without one). A global npm
// install puts it beside the tsc on PATH (Windows) or under ../lib/node_modules (macOS, Linux).
const sep = process.platform === 'win32' ? ';' : ':'
const tscJs = (process.env.PATH ?? '').split(sep).filter(Boolean)
  .flatMap(d => [join(d, 'node_modules', 'typescript', 'lib', 'tsc.js'), join(d, '..', 'lib', 'node_modules', 'typescript', 'lib', 'tsc.js')])
  .find(f => existsSync(f))
if (!tscJs) {
  console.error('typecheck: TypeScript not found on PATH. Install it: npm install -g typescript')
  process.exit(1)
}
const tsc = spawnSync(process.execPath, [tscJs, '-p', root], { encoding: 'utf8' })
process.stdout.write(tsc.stdout)
process.stderr.write(tsc.stderr)
if (tsc.status === 0) console.log('typecheck: ok')
process.exit(tsc.status ?? 1)
