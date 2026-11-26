// Strength data: Arena prompts (CC-BY-4.0) with the HUMAN vote between two models. Only the prompt, the two model
// names and the winner are kept; no model's answer text is stored or used.
// Usage: node classifier/votes.mjs  -> work/classifier/votes.jsonl {text, lang, a, b, winner}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORK, log, writeJsonl } from '../lib.mjs'

const RAW = join(WORK, 'classifier', 'raw')
mkdirSync(RAW, { recursive: true })
const PAGES = Number(process.env.VOTE_PAGES ?? 300), TOTAL = 135_000
const text = row => row.conversation_a?.[0]?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').trim()

const out = []
for (let i = 0; i < PAGES; i++) {
  const offset = Math.floor((i * TOTAL) / PAGES), p = join(RAW, `votes-${offset}.json`)
  if (!existsSync(p)) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/arena-human-preference-140k&config=default&split=train&offset=${offset}&length=100`
    for (let k = 0; ; k++) {
      const r = await fetch(url)
      if (r.ok) {
        const rows = (await r.json()).rows ?? []
        writeFileSync(p, JSON.stringify(rows.map(({ row }) => ({ text: text(row), lang: row.language, a: row.model_a, b: row.model_b, winner: row.winner, turns: row.conversation_a?.length }))))
        break
      }
      if (k === 6) throw new Error(`${r.status} ${url}`)
      await new Promise(res => setTimeout(res, (r.status === 429 ? 20_000 : 3000) * (k + 1)))
    }
    await new Promise(res => setTimeout(res, 1500))
  }
  out.push(...JSON.parse(readFileSync(p, 'utf8')).filter(v => v.text && v.turns === 2)) // single-turn chats: the vote is about this prompt
}
writeJsonl(join(WORK, 'classifier', 'votes.jsonl'), out)
const models = {}; for (const v of out) for (const m of [v.a, v.b]) models[m] = (models[m] ?? 0) + 1
const winners = {}; for (const v of out) winners[v.winner] = (winners[v.winner] ?? 0) + 1
log(`votes: ${out.length} single-turn prompts`, JSON.stringify(winners))
console.log(Object.entries(models).sort((x, y) => y[1] - x[1]).map(([m, n]) => `${m} ${n}`).join('\n'))
