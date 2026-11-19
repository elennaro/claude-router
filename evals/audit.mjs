// Anonymity audit of eval cases, per category: a term scan against a private identity list, then two models.
// Fable attacks (guesses who or what is behind the text); Opus verifies against the identity list and the guesses.
// Failed cases are rewritten by Opus and audited again (2 rounds). Results: evals/work/audit/<category>.json
// Usage: node audit.mjs [category ...]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, WORK, claude, log, pool, readJsonl, writeJsonl, readJson } from './lib.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const TERMS = readFileSync(join(WORK, 'identity.txt'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => new RegExp(l, 'i'))
const caseText = c => [c.prompt, ...(c.history ?? []).flatMap(h => [h.user, h.assistant]), ...(c.fixtures ?? []).flatMap(f => [f.path, f.content])].join('\n')
const scan = c => TERMS.filter(re => re.test(caseText(c))).map(re => re.source)
const show = cs => cs.map(c => `### ${c.id}\n${caseText(c)}`).join('\n\n')

const GUESS = { type: 'object', properties: { guesses: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, guess: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, evidence: { type: 'string' } }, required: ['id', 'guess', 'confidence', 'evidence'] } } }, required: ['guesses'] }
const VERDICT = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, pass: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['id', 'pass', 'problems'] } } }, required: ['verdicts'] }
const FIXED = { type: 'object', properties: { prompt: { type: 'string' }, history: { type: 'array', items: { type: 'object', properties: { user: { type: 'string' }, assistant: { type: 'string' } }, required: ['user', 'assistant'] } }, fixtures: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }, required: ['prompt'] }

const identity = readFileSync(join(WORK, 'identity.txt'), 'utf8')

async function audit(cat, cases) {
  const attack = await claude({
    model: 'fable', effort: 'medium', tag: `audit-attack:${cat}`, json: GUESS,
    prompt: `These are test prompts written for an evaluation. For each one, try to guess the real person, company, client, product, project, city or country behind it, from names, places, numbers, rare details or style. Give your best specific guess, a confidence (low, medium, high) and the phrases you used. If nothing points anywhere, say "nothing specific" with low confidence.\n\n${show(cases)}`,
  })
  const verify = await claude({
    model: 'opus', effort: 'medium', tag: `audit-verify:${cat}`, json: VERDICT,
    prompt: `You check that evaluation test cases are anonymous before they are published. The cases were written from one person's real work. Below is a private list of real identifiers (regex lines): any match, near match, translation, nickname or obvious hint at them fails a case. Also fail a case if an attacker's guess at medium or high confidence lands on a real identifier or the person's real location, if a "fake" name points to a real entity in the person's world, if the fakes inside a case contradict each other, or if anonymizing broke the task (it no longer belongs to category "${cat}"). Common public tools and well-known public facts (a programming language, a public library, a big public city unrelated to the person) are fine.\n\n<identifiers>\n${identity}\n</identifiers>\n\n<attacker_guesses>\n${JSON.stringify(attack.structured?.guesses ?? [])}\n</attacker_guesses>\n\n<cases>\n${show(cases)}\n</cases>`,
  })
  return verify.structured?.verdicts ?? []
}

async function rewrite(c, problems) {
  const r = await claude({
    model: 'opus', effort: 'medium', tag: `audit-fix:${c.id}`, json: FIXED,
    prompt: `Rewrite this evaluation test case so it is fully anonymous while keeping the same kind and difficulty of task (category "${c.category}"). Replace every flagged item with a realistic generic fake that points to no real entity; a place becomes a well-known world city such as Lisbon, Toronto or Osaka. Keep the language (${c.lang}).\n\nProblems found:\n- ${problems.join('\n- ')}\n\nCase:\n${JSON.stringify({ prompt: c.prompt, history: c.history, fixtures: c.fixtures })}`,
  })
  const f = r.structured ?? {}
  return { ...c, prompt: f.prompt ?? c.prompt, ...(f.history ? { history: f.history } : {}), ...(f.fixtures ? { fixtures: f.fixtures } : {}), rewritten: (c.rewritten ?? 0) + 1 }
}

const files = readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''))
const cats = process.argv.slice(2).length ? process.argv.slice(2) : files
mkdirSync(join(WORK, 'audit'), { recursive: true })
await pool(cats, 3, async cat => {
  const file = join(ROOT, 'cases', `${cat}.jsonl`)
  let cases = readJsonl(file)
  const report = readJson(join(WORK, 'audit', `${cat}.json`), null)
  if (report?.pass && !process.env.REAUDIT) return log(`skip ${cat} (passed)`)
  let failed = []
  for (let round = 0; round < 3; round++) {
    const verdicts = await audit(cat, cases)
    failed = cases.map(c => {
      const v = verdicts.find(x => x.id === c.id)
      const hits = scan(c)
      const problems = [...(v && !v.pass ? v.problems : []), ...(v ? [] : ['no verdict returned']), ...hits.map(h => `contains a real identifier matching /${h}/`)]
      return problems.length ? { c, problems } : null
    }).filter(Boolean)
    log(`${cat} round ${round + 1}: ${cases.length - failed.length}/${cases.length} pass`)
    if (!failed.length || round === 2) break
    const fixed = await Promise.all(failed.map(f => rewrite(f.c, f.problems)))
    cases = cases.map(c => fixed.find(x => x.id === c.id) ?? c)
    writeJsonl(file, cases)
  }
  writeFileSync(join(WORK, 'audit', `${cat}.json`), JSON.stringify({ pass: failed.length === 0, failed: failed.map(f => ({ id: f.c.id, problems: f.problems })) }, null, 1))
})
