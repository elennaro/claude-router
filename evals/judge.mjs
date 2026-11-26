// Shared replay and judging (docs/research-eval-design.md): answers are cached per case, tier and seed.
// One judge: Jev in both orders decides where it is sure; otherwise Opus in both orders, with evidence before the
// verdict and ties allowed (judgeFast, calibrated in calibrate/run.mjs).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { OFFLINE, WORK, cacheGet, cachePut, claude, offlineMiss } from './lib.mjs'
import { PICK, ask as jevAsk } from './calibrate/jev.mjs'

const TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch'
export const key = t => `${t.model}-${t.effort}`

const ask = c => [
  'This is a replay: you can read files and search the web, but not edit files or run commands. Where the task needs edits, show the exact changes (a diff or the full new text). Do the task as well as you can.',
  ...(c.history ?? []).map(h => `[earlier turn] user: ${h.user}\n[earlier turn] you: ${h.assistant}`),
  c.prompt,
].join('\n\n')

// The answer of one tier to one case; seed > 0 gives an independent second sample (for the noise floor).
export const answerName = (c, tier, seed = 0) => `${c.id}.${key(tier)}${seed ? `.s${seed}` : ''}`
export const hasAnswer = (c, tier, seed = 0) => cacheGet(`answer:${answerName(c, tier, seed)}`) !== undefined
export async function answer(c, tier, seed = 0) {
  const name = answerName(c, tier, seed)
  const hit = cacheGet(`answer:${name}`)
  if (hit !== undefined) return hit
  if (OFFLINE) throw offlineMiss(`answer ${name}`)
  const dir = join(WORK, 'replay', 'ws', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const f of c.fixtures ?? []) { mkdirSync(dirname(join(dir, f.path)), { recursive: true }); writeFileSync(join(dir, f.path), f.content) }
  try {
    const r = await claude({ ...tier, prompt: ask(c), tools: TOOLS, cwd: dir, tag: `replay:${name}` })
    cachePut(`answer:${name}`, 'answer', r.text)
    return r.text
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SCALE = ['A much better', 'A slightly better', 'same', 'B slightly better', 'B much better']
export const VERDICT ={ type: 'object', properties: { evidence: { type: 'string' }, verdict: { type: 'string', enum: SCALE } }, required: ['evidence', 'verdict'] }
export const prompt = (c, a, b) => `You compare two answers to the same request from someone who wants top-quality work. Judge only what the person would care about: correctness, completeness, judgment, craft of the writing, following every instruction. Length is not quality: a longer answer is better only if the extra content helps. First write the evidence (the concrete differences that matter, quoting briefly), then the verdict. Say "same" when the person would be equally happy with either.

<request>
${(c.history ?? []).map(h => `[earlier] user: ${h.user}\n[earlier] assistant: ${h.assistant}`).join('\n')}
${c.prompt}
${(c.fixtures ?? []).map(f => `--- file ${f.path} ---\n${f.content}`).join('\n')}
</request>

<answer_A>
${a}
</answer_A>

<answer_B>
${b}
</answer_B>`

// +2..-2 for X, from one judgment where X sat at A (atA) or at B
export const score = (v, atA) => { const s = 2 - SCALE.indexOf(v); return atA ? s : -s }
const sign = s => (s > 0 ? 'better' : s < 0 ? 'worse' : 'same')

export async function once(model, c, x, y, xAtA, tag) {
  const r = await claude({ model, effort: 'high', prompt: xAtA ? prompt(c, x, y) : prompt(c, y, x), json: VERDICT, tag, cache: true })
  const v = r.structured?.verdict
  return v ? { s: score(v, xAtA), evidence: r.structured.evidence } : null
}

// The calibrated judge (results/calibration.md: 95% right on gold pairs, 93% without the easy Kotlin test pairs):
// Jev in both orders; where its averaged probability is under SURE, Opus in both orders decides.
// -> { score: +1 x better, -1 worse, 0 same, by }
export const SURE = 0.8
const request = c => [...(c.history ?? []).map(h => `[earlier] user: ${h.user}\n[earlier] assistant: ${h.assistant}`), c.prompt, ...(c.fixtures ?? []).map(f => `--- file ${f.path} ---\n${f.content}`)].join('\n')
export const fromJev = (ab, ba) => { const p = (ab.A + ba.B) / 2; return { p, sure: Math.max(p, 1 - p) >= SURE } }
export async function judgeFast(c, x, y, tag) {
  const [ab, ba] = await Promise.all([jevAsk({ request: request(c), answer_A: x, answer_B: y }, PICK, `${tag}:jev-ab`), jevAsk({ request: request(c), answer_A: y, answer_B: x }, PICK, `${tag}:jev-ba`)])
  const j = fromJev(ab.pick.probabilities, ba.pick.probabilities)
  if (j.sure) return { score: j.p > 0.5 ? 1 : -1, by: 'jev', p: j.p }
  return { ...await judgeOpus(c, x, y, tag), p: j.p }
}
// The Opus part alone, both orders (precedents.mjs uses it for every pair, so one judge covers the table).
export async function judgeOpus(c, x, y, tag) {
  const [a, b] = await Promise.all([once('opus', c, x, y, true, `${tag}:opus-ab`), once('opus', c, x, y, false, `${tag}:opus-ba`)])
  if (!a && !b) return { score: 0, by: 'none' }
  return { score: Math.sign((a?.s ?? 0) + (b?.s ?? 0)), by: 'opus', scores: [a?.s, b?.s] }
}

// The one judge (the cascade above) as a verdict: is x (the routed answer) better, the same or worse than y (the
// reference)? 'uncertain' when Opus gave no verdict. judge: 'cascade' marks judgments made by this judge, so saved
// judgments from the old Fable judge (dropped 2026-11-20) are told apart and re-judged.
export async function judge(c, x, y, tag) {
  const j = await judgeFast(c, x, y, tag)
  return { verdict: j.by === 'none' ? 'uncertain' : sign(j.score), by: j.by, p: j.p, scores: j.scores, judge: 'cascade' }
}
