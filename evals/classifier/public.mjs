// Classifier data, layer 1: public prompts mapped to router classes where the mapping is unambiguous (docs/PLAN-classifier.md).
// Dolly (CC BY-SA 3.0), Arena prompts (CC-BY-4.0), WildChat user turns (ODC-By), OpenAssistant (Apache-2.0),
// sql-create-context (CC-BY-4.0) and clinc intents (CC-BY-3.0). No model-written text, none from Anthropic.
// Magpie is left out: one set states no licence, the other is Llama-licensed.
// Usage: node classifier/public.mjs  -> work/classifier/public.jsonl, plus work/classifier/pool.jsonl (unlabelled public prompts)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

// Pages spread evenly over a dataset through the rows API, trimmed by `pick` to [{text, lang, label?}] before caching.
async function sample(name, dataset, config, total, pages, pick) {
  const out = []
  for (let i = 0; i < pages; i++) {
    const offset = Math.floor((i * total) / pages)
    const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=train&offset=${offset}&length=100`
    const fresh = !existsSync(join(RAW, `${name}-${offset}.json`))
    out.push(...JSON.parse(await cached(`${name}-${offset}.json`, url, t => JSON.stringify((JSON.parse(t).rows ?? []).flatMap(({ row }) => pick(row) ?? [])))))
    if (fresh) await new Promise(res => setTimeout(res, 1500))
  }
  return out
}
const ALL = new Set(Object.keys(cfg.classes))
// Real people's requests with no task tag (WildChat: ODC-By, user turns only; OpenAssistant: Apache-2.0, first prompts):
// labelled by the router's own keyword rules, never by a model.
const human = [
  ...(await sample('wildchat', 'allenai/WildChat-1M', 'default', 837_989, Number(process.env.WILDCHAT_PAGES ?? 150), r => (r.toxic || r.redacted ? undefined : { text: r.conversation?.[0]?.content, lang: r.language }))), // flagged rows never kept
  ...(await sample('oasst', 'OpenAssistant/oasst1', 'default', 84_437, Number(process.env.OASST_PAGES ?? 100), r => (r.role === 'prompter' && !r.parent_id ? { text: r.text, lang: r.lang } : undefined))),
]
const opened = new Set()
for (const h of human) {
  if (!h.text || h.text.length < 3) continue
  const start = h.text.slice(0, 80).toLowerCase()
  if (opened.has(start)) continue // one pasted template (the Midjourney prompt helper) repeats hundreds of times
  opened.add(start)
  pool.push({ id: createHash('sha1').update(h.text).digest('hex').slice(0, 16), text: h.text, lang: h.lang })
  // The rules were written for short coding-assistant requests; in a long paste a word like "logo" names the paste,
  // not the task, so only short prompts are labelled by them.
  const label = h.text.length <= 400 ? byRules(h.text, ALL) : undefined
  if (label) rows.push({ text: h.text, label, src: 'human-rules', lang: h.lang })
}
// SQL questions over a given table (CC-BY-4.0, built from WikiSQL and Spider): data-analysis.
for (const r of await sample('sqlctx', 'b-mc2/sql-create-context', 'default', 78_577, 16, r => ({ text: `${r.context}\n${r.question}` })))
  rows.push({ text: r.text, label: 'data-analysis', src: 'sql-create-context', lang: 'en' })
// Assistant intents (CC-BY-3.0, crowd-written): small talk is "default"; lookups and conversions map to their classes.
const CLINC = { default: ['greeting', 'thank_you', 'goodbye', 'what_is_your_name', 'are_you_a_bot', 'how_old_are_you', 'who_made_you', 'tell_joke', 'what_are_your_hobbies', 'do_you_have_pets', 'meaning_of_life', 'yes', 'no', 'maybe', 'cancel', 'repeat', 'fun_fact', 'what_can_i_ask_you', 'where_are_you_from', 'who_do_you_work_for'], explore: ['weather', 'time', 'exchange_rate', 'timezone', 'date', 'flight_status', 'traffic', 'directions', 'distance'], mechanical: ['translate', 'measurement_conversion', 'spelling'] }
const info = JSON.parse(await cached('clinc-info.json', 'https://datasets-server.huggingface.co/info?dataset=clinc/clinc_oos&config=plus'))
const intents = info.dataset_info.features.intent.names
const clincLabel = Object.fromEntries(Object.entries(CLINC).flatMap(([c, names]) => names.map(n => [intents.indexOf(n), c])))
for (const r of await sample('clinc', 'clinc/clinc_oos', 'plus', 15_250, 153, r => (clincLabel[r.intent] ? { text: r.text, label: clincLabel[r.intent] } : undefined)))
  rows.push({ text: r.text, label: r.label, src: 'clinc', lang: 'en' })

// Real requests fill each class's cap before Dolly's trivia questions do.
rows.sort((a, b) => (a.src === 'dolly') - (b.src === 'dolly'))
const per = {}
const kept = rows.filter(r => (per[r.label] = (per[r.label] ?? 0) + 1) <= CAP)
writeJsonl(join(OUT, 'public.jsonl'), kept)
writeJsonl(join(OUT, 'pool.jsonl'), pool)
const langs = {}; for (const p of pool) langs[p.lang] = (langs[p.lang] ?? 0) + 1
log(`public: ${kept.length} rows`, JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, n]) => [k, Math.min(n, CAP)]))))
log(`pool: ${pool.length} public prompts to label (Arena, WildChat, OpenAssistant); top languages`, JSON.stringify(Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 6)))
