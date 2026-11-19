// Pulls the prompts the owner typed (not scripted runs, tool results or pasted documents) from ~/.claude/projects.
// Output stays private: evals/work/mined.jsonl. It only teaches the case writer what real asks look like.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WORK, writeJsonl } from './lib.mjs'

const BASE = join(homedir(), '.claude', 'projects')
const SKIP_DIR = /scratch|staged|Temp|research|bakeoff|checker|worktrees?-|-claude-worktrees/i // automated or throwaway runs
const TYPED = new Set(['claude-desktop', 'cli', 'claude-vscode', 'vscode'])
const NOISE = /^(<command-|<local-command|Caveat:|\[Request interrupted|<task-notification|<system-reminder|<bash-|This session is being continued|\[SYSTEM NOTIFICATION)/

const text = c => (typeof c === 'string' ? c : Array.isArray(c) && c.every(b => b.type === 'text' || b.type === 'image') ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '')
const clean = t => t.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, '[pasted text]').replace(/\[Image[^\]]*\]/g, '[image]').trim()

const rows = []
const seen = new Set()
for (const dir of readdirSync(BASE)) {
  if (SKIP_DIR.test(dir)) continue
  const full = join(BASE, dir)
  if (!statSync(full).isDirectory()) continue
  for (const f of readdirSync(full).filter(n => n.endsWith('.jsonl'))) {
    let lines
    try { lines = readFileSync(join(full, f), 'utf8').split('\n') } catch { continue }
    for (const l of lines) {
      if (!l.includes('"type":"user"')) continue
      let x
      try { x = JSON.parse(l) } catch { continue }
      if (x.type !== 'user' || x.isMeta || x.isSidechain || !TYPED.has(x.entrypoint)) continue
      const t = clean(text(x.message?.content))
      if (t.length < 2 || t.length > 2000 || NOISE.test(t) || seen.has(t)) continue
      seen.add(t)
      rows.push({ project: dir, at: x.timestamp, text: t })
    }
  }
}
writeJsonl(join(WORK, 'mined.jsonl'), rows)
const by = {}
for (const r of rows) by[r.project] = (by[r.project] ?? 0) + 1
console.log(`${rows.length} typed prompts from ${Object.keys(by).length} projects`)
for (const [p, n] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(5), p)
const len = [20, 60, 200, 600, 2000].map(m => `${m}:${rows.filter(r => r.text.length <= m).length}`)
console.log('length (<= chars):', len.join(' '))
