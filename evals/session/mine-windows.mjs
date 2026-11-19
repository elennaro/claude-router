// Mines what the session check and the subagent router see in the owner's real sessions, to teach case writers
// the shape. Private output: evals/work/session-windows.jsonl (windows at real check triggers) and
// evals/work/briefs-mined.jsonl (real Agent briefs). Same filters as ../mine.mjs: typed sessions only.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WORK, writeJsonl } from '../lib.mjs'

const BASE = join(homedir(), '.claude', 'projects')
const SKIP_DIR = /scratch|staged|Temp|research|bakeoff|checker|worktrees?-|-claude-worktrees/i
const TYPED = new Set(['claude-desktop', 'cli', 'claude-vscode', 'vscode'])
const NOISE = /^(<command-|<local-command|Caveat:|\[Request interrupted|<task-notification|<system-reminder|<bash-|\[SYSTEM NOTIFICATION)/
const TODO_TOOLS = ['TodoWrite', 'mcp__ccd_turn__update_plan']
const text = c => (typeof c === 'string' ? c : Array.isArray(c) && c.every(b => b.type === 'text' || b.type === 'image') ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '')
const clean = t => t.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, '[pasted text]').replace(/\[Image[^\]]*\]/g, '[image]').trim()

const windows = []
const briefs = []
for (const dir of readdirSync(BASE)) {
  if (SKIP_DIR.test(dir)) continue
  const full = join(BASE, dir)
  if (!statSync(full).isDirectory()) continue
  for (const f of readdirSync(full).filter(n => n.endsWith('.jsonl'))) {
    let lines
    try { lines = readFileSync(join(full, f), 'utf8').split('\n') } catch { continue }
    const prompts = []
    let todos, plan, model, typed = false
    const emit = trigger => { if (typed && prompts.length >= 2) windows.push({ project: dir, session: f, trigger, turns: prompts.length, model, prompts: prompts.slice(-8), todos, plan }) }
    for (const l of lines) {
      if (!l.includes('"type":"user"') && !l.includes('"type":"assistant"')) continue
      let x
      try { x = JSON.parse(l) } catch { continue }
      if (x.isSidechain) continue
      if (TYPED.has(x.entrypoint)) typed = true
      if (x.type === 'user') {
        if (x.isCompactSummary || /^This session is being continued/.test(text(x.message?.content))) { emit('compact'); continue }
        if (x.isMeta || !TYPED.has(x.entrypoint)) continue
        const t = clean(text(x.message?.content))
        if (t.length < 2 || NOISE.test(t)) continue
        prompts.push(t.slice(0, 600))
        if (prompts.length % 20 === 0) emit('periodic')
        continue
      }
      model = x.message?.model ?? model
      for (const b of Array.isArray(x.message?.content) ? x.message.content : []) {
        if (b.type !== 'tool_use') continue
        const items = b.input?.todos ?? b.input?.items
        if (TODO_TOOLS.includes(b.name) && Array.isArray(items)) {
          todos = items.map(i => `[${i.status ?? '?'}] ${i.content ?? ''}`).join('\n')
          if (items.length && items.every(i => i.status === 'completed')) emit('todos-done')
        }
        if (b.name === 'ExitPlanMode' && typeof b.input?.plan === 'string') { plan = b.input.plan.slice(0, 1500); emit('plan') }
        if ((b.name === 'Agent' || b.name === 'Task') && typeof b.input?.prompt === 'string' && typed) {
          briefs.push({ project: dir, type: b.input.subagent_type ?? 'general-purpose', model: b.input.model, brief: b.input.prompt.slice(0, 1500) })
        }
      }
    }
  }
}
writeJsonl(join(WORK, 'session-windows.jsonl'), windows)
writeJsonl(join(WORK, 'briefs-mined.jsonl'), briefs)
const count = (rows, k) => Object.entries(rows.reduce((a, r) => ({ ...a, [r[k]]: (a[r[k]] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t}:${n}`).join(' ')
console.log(`${windows.length} windows (${count(windows, 'trigger')}); ${briefs.length} briefs (${count(briefs, 'type')})`)
