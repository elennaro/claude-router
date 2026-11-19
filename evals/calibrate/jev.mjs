// TypeSafe's Jev (a decision-only model: a probability per option, no text) over plain HTTP. Key: TYPESAFE_API_KEY
// from the environment; never printed. Answers are cached in the store like the Claude judges', so a re-run is free.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { OFFLINE, WORK, appendJsonl, cacheGet, cachePut, offlineMiss } from '../lib.mjs'

const URL = 'https://api.typesafe.ai/v1/systemone'
export const MODEL = 'jev-1.13.0'
const USD_PER_INPUT_TOKEN = 0.000000042
const RETRY = new Set([429, 500, 502, 503, 504, 529])

// The pairwise question calibrate/run.mjs measured (keep the words: a change is a new, uncalibrated judge)
export const PICK = {
  pick: {
    type: 'choice',
    instructions: 'Two answers (answer_A, answer_B) respond to the request. Which one would a demanding expert prefer? Judge correctness first, then completeness, following every instruction, and clean, idiomatic code or writing. Length is not quality.',
    criteria: { A: { what: 'answer_A is better' }, B: { what: 'answer_B is better' } },
  },
}

export async function ask(state, questions, tag = 'jev') {
  const body = JSON.stringify({ state, model: MODEL, questions })
  const id = `jev:${createHash('sha256').update(body).digest('hex')}`
  const hit = cacheGet(id)
  if (hit) return hit
  if (OFFLINE) throw offlineMiss(`jev ${tag}`)
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new Error('no TYPESAFE_API_KEY in the environment')
  let why = ''
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(URL, { method: 'POST', body, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000) })
      if (r.ok) {
        const out = await r.json()
        const tokens = out.usage?.input_tokens ?? 0
        appendJsonl(join(WORK, 'spend.jsonl'), { at: new Date().toISOString(), tag, model: MODEL, usd: tokens * USD_PER_INPUT_TOKEN })
        cachePut(id, 'jev', out.answers)
        return out.answers
      }
      if (!RETRY.has(r.status)) throw Object.assign(new Error(`jev refused ${r.status}: ${(await r.text()).slice(0, 200)}`), { final: true })
      why = `http ${r.status}`
    } catch (e) {
      if (e.final) throw e
      why = String(e.message ?? e)
    }
    await new Promise(res => setTimeout(res, 1000 * 2 ** i))
  }
  throw new Error(`jev out of tries: ${why}`)
}
