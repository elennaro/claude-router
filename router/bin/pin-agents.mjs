#!/usr/bin/env node
// Pins model/effort in agent frontmatter.
//   node pin-agents.mjs <agentsDir> '<json {name:{model?,effort?}}>' [--fill] [--dry]
// --fill also writes `effort: medium` on every other agent that has no effort (its current effective level).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function pin(text, want) {
  const m = /^---(\r?\n)([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return text
  const eol = m[1]
  let head = m[2]
  for (const [k, v] of Object.entries(want)) {
    if (!v) continue
    const re = new RegExp(`^${k}:.*$`, 'm')
    head = re.test(head) ? head.replace(re, `${k}: ${v}`) : `${head}${eol}${k}: ${v}`
  }
  return text.replace(m[0], `---${eol}${head}${eol}---`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) // decodes %20 etc.: a folder with a space ran nothing (audit 2026-11-19)
if (isMain) {
  const [dir, json] = process.argv.slice(2)
  const fill = process.argv.includes('--fill')
  const dry = process.argv.includes('--dry')
  const map = JSON.parse(json ?? '{}')
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const name = f.replace(/\.md$/, '')
    const file = path.join(dir, f)
    const before = fs.readFileSync(file, 'utf8')
    const hasEffort = /^---[\s\S]*?^effort:/m.test(before.split(/\r?\n---/)[0] + '\n')
    const want = map[name] ?? (fill && !hasEffort ? { effort: 'medium' } : null)
    if (!want) continue
    const after = pin(before, want)
    if (after === before) continue
    console.log(`${dry ? '~' : '✓'} ${name}: ${JSON.stringify(want)}`)
    if (!dry) fs.writeFileSync(file, after)
  }
}
