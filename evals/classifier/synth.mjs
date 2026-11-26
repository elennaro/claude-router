// Classifier data, layer 3: Haiku writes prompts per router class, in English, Russian and mixed (docs/PLAN-classifier.md).
// The classes no public set covers get the most; every class gets some Russian, since public data is mostly English.
// Written from the class definitions only: no real prompts are shown, so nothing private can leak in. Cached: a re-run is free.
// Usage: EVAL_CAP_USD=5 node classifier/synth.mjs [batches-cap]  -> work/classifier/synth.jsonl
import { join } from 'node:path'
import { BUILTIN, CLASS_LABELS, merge } from '../../router/hooks/policy.ts'
import { ROOT, WORK, claude, log, pool, readJson, readJsonl, writeJsonl } from '../lib.mjs'

const cfg = merge(BUILTIN, {})
const COVER = readJson(join(ROOT, 'categories.json')).classes
const PER = 30 // prompts per call
const LABELS = [...CLASS_LABELS, 'default']
const DEFAULT = 'nothing that fits one label: a message continuing earlier work ("ok do it", "make it shorter", "the same for the tests", "давай"), greetings, thanks, small talk, meta questions about the assistant, quick opinions'
const def = c => (c === 'default' ? DEFAULT : [cfg.classes[c]?.why, COVER[c]?.cover].filter(Boolean).join('; '))

// Public data already has plenty of these in English: their batches are Russian and mixed only.
const counts = {}; for (const r of readJsonl(join(WORK, 'classifier', 'public.jsonl'))) counts[r.label] = (counts[r.label] ?? 0) + 1
const batchesFor = c => ((counts[c] ?? 0) >= 1000 ? 4 : 12)
const LENGTHS = ['one short line, often terse, sometimes with a typo', 'two to four sentences', 'a longer message: the request plus pasted context (a code excerpt, a log, a draft or a table) of 10 to 40 lines']
const LANG = { en: 'English', ru: 'Russian', mixed: 'mixed Russian and English, the way a Russian-speaking developer writes (Russian sentences with English technical terms, code and file names)' }

const SYSTEM = `You write realistic messages that people type to an AI assistant that does software development and creative content work (video scripts, social posts, brand books, image-generation prompts, decks). The messages train a classifier that routes each message to a task label.

All labels:
${LABELS.map(c => `- ${c}: ${def(c)}`).join('\n')}

Rules:
1. Every message must clearly belong to the requested label and to no other label above.
2. Vary everything: wording, length within the requested range, topic, difficulty from trivial to hard, and the work context (web and mobile apps, backend services, data work, video production, a brand or design agency, everyday tasks).
3. Write what the person types, never the assistant's answer. No numbering inside the text.
4. Use only generic fake names (Northwind, Maya, the booking app); no real companies, people or private URLs.`

const jobs = []
for (const c of LABELS) {
  const n = batchesFor(c)
  for (let b = 0; b < n; b++) {
    const lang = n === 4 ? ['ru', 'mixed'][b % 2] : ['en', 'ru', 'mixed'][b % 3]
    jobs.push({ c, b, lang, length: LENGTHS[Math.floor(b / (n === 4 ? 2 : 3)) % 3] })
  }
}
const cap = Number(process.argv[2] ?? jobs.length)
const SCHEMA = { type: 'object', properties: { messages: { type: 'array', items: { type: 'string' } } }, required: ['messages'] }

const rows = []
let calls = 0, usd = 0
await pool(jobs.slice(0, cap), 6, async j => {
  const prompt = `Label: ${j.c}\nWrite ${PER} different messages for this label.\nLanguage: ${LANG[j.lang]}.\nLength: ${j.length}.\nBatch ${j.b + 1}: avoid the most obvious phrasings; make this batch differ from a typical first attempt.`
  const r = await claude({ model: 'haiku', system: SYSTEM, prompt, json: SCHEMA, tag: `synth:${j.c}:${j.b}`, cache: true, timeoutMs: 300_000 })
  calls++; usd += r.usd
  for (const text of r.structured?.messages ?? []) if (text?.trim()) rows.push({ text: text.trim(), label: j.c, src: 'synth', lang: j.lang })
})
writeJsonl(join(WORK, 'classifier', 'synth.jsonl'), rows)
const per = {}; for (const r of rows) per[r.label] = (per[r.label] ?? 0) + 1
log(`synth: ${rows.length} messages from ${calls} calls, $${usd.toFixed(3)} new spend`, JSON.stringify(per))
