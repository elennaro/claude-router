// Classifier data, layer 1: public prompts mapped to router classes where the mapping is unambiguous (docs/PLAN-classifier.md).
// Dolly (CC BY-SA 3.0) and Arena prompts (CC-BY-4.0). Magpie is left out: one set states no licence, the other is Llama-licensed.
// Usage: node classifier/public.mjs  -> work/classifier/public.jsonl, plus work/classifier/pool.jsonl (Arena prompts for layer 2)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN, classifyByRules, merge } from '../../router/hooks/policy.ts'
import { WORK, log, writeJsonl } from '../lib.mjs'

const OUT = join(WORK, 'classifier'), RAW = join(OUT, 'raw')
mkdirSync(RAW, { recursive: true })
const cfg = merge(BUILTIN, {})
const ARENA_PAGES = Number(process.env.ARENA_PAGES ?? 80) // 100 prompts a page
const CAP = 1500 // most rows one class takes from public data, so the big sets don't drown the rest

// Fetched once; `keep` trims a response to what we use before it is saved (Arena pages carry full answers, ~2 MB each).
async function cached(name, url, keep = t => t) {
  const p = join(RAW, name)
  if (existsSync(p)) return readFileSync(p, 'utf8')
  for (let i = 0; ; i++) {
    const r = await fetch(url)
    if (r.ok) { const t = keep(await r.text()); writeFileSync(p, t); return t }
    if (i === 6) throw new Error(`${r.status} ${url}`)
    await new Promise(res => setTimeout(res, (r.status === 429 ? 20_000 : 3000) * (i + 1)))
  }
}
const firstTurn = row => row.conversation_a?.[0]?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
const arenaKeep = t => JSON.stringify((JSON.parse(t).rows ?? []).map(({ row }) => ({ id: row.id, text: firstTurn(row), lang: row.language, math: row.category_tag?.['math_v0.1']?.math, code: row.is_code })))

// Code prompts split by the router's own rules; anything the rules don't name stays out (layer 2 labels those).
const CODE = new Set(['debugging', 'scoped-code', 'test-writing', 'code-review', 'devops-config', 'security-review', 'data-analysis', 'architecture', 'rare-hard'])
const byRules = (text, allowed) => { const c = classifyByRules(text, cfg); return allowed.has(c) ? c : undefined }
const LEARN = /^(why|how (does|do|is|are|can)|explain|what is the difference)\b/i

function dollyLabel(r) {
  switch (r.category) {
    case 'brainstorming': return 'brainstorm'
    case 'classification': return 'mechanical'
    case 'summarization': case 'information_extraction': case 'closed_qa': return 'explore' // a short passage given: "summarize a short file"
    case 'open_qa': return LEARN.test(r.instruction.trim()) ? 'learn-explain' : 'explore'
    default: return undefined // general_qa (advice) and creative_writing are too mixed to name
  }
}

const rows = []
const dolly = await cached('dolly.jsonl', 'https://huggingface.co/datasets/databricks/databricks-dolly-15k/resolve/main/databricks-dolly-15k.jsonl')
for (const line of dolly.split('\n').filter(Boolean)) {
  const r = JSON.parse(line), label = dollyLabel(r)
  if (label) rows.push({ text: r.context ? `${r.instruction}\n\n${r.context}` : r.instruction, label, src: 'dolly', lang: 'en' })
}

const pool = []
const TOTAL = 135_000 // about the Arena row count; pages are spread evenly across it
for (let i = 0; i < ARENA_PAGES; i++) {
  const offset = Math.floor((i * TOTAL) / ARENA_PAGES)
  const page = JSON.parse(await cached(`arena-${offset}.json`, `https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/arena-human-preference-140k&config=default&split=train&offset=${offset}&length=100`, arenaKeep))
  for (const { id, text, lang = '?', math, code } of page) {
    if (!text || text.length < 3) continue
    pool.push({ id, text, lang })
    const label = math ? 'math' : code ? byRules(text, CODE) : undefined
    if (label) rows.push({ text, label, src: 'arena', lang })
  }
  await new Promise(res => setTimeout(res, 1500)) // the rows API rate-limits bursts
}

const per = {}
const kept = rows.filter(r => (per[r.label] = (per[r.label] ?? 0) + 1) <= CAP)
writeJsonl(join(OUT, 'public.jsonl'), kept)
writeJsonl(join(OUT, 'pool.jsonl'), pool)
const langs = {}; for (const p of pool) langs[p.lang] = (langs[p.lang] ?? 0) + 1
log(`public: ${kept.length} rows`, JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, n]) => [k, Math.min(n, CAP)]))))
log(`pool: ${pool.length} Arena prompts; top languages`, JSON.stringify(Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 6)))
