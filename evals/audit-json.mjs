// audit.mjs for any case shape (session windows, subagent briefs): the same term scan against work/identity.txt,
// Fable attack, Opus verify, Opus rewrite of failed cases, up to 3 rounds. Only the text fields are shown and rewritten.
// Usage: node audit-json.mjs <cases.jsonl> ...   -> report in work/audit/<name>.json; the file is rewritten in place
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WORK, claude, log, pool, readJson, readJsonl, writeJsonl } from './lib.mjs'

const identity = readFileSync(join(WORK, 'identity.txt'), 'utf8')
const TERMS = identity.split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => new RegExp(l, 'i'))
const TEXT = ['window', 'rationale', 'story', 'checkpoints', 'brief', 'asked', 'answer', 'next']
const textOf = c => Object.fromEntries(TEXT.filter(k => c[k] !== undefined).map(k => [k, c[k]]))
const scan = c => TERMS.filter(re => re.test(JSON.stringify(textOf(c)))).map(re => re.source)
const show = cs => cs.map(c => `### ${c.id}\n${JSON.stringify(textOf(c), null, 1)}`).join('\n\n')

const GUESS = { type: 'object', properties: { guesses: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, guess: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, evidence: { type: 'string' } }, required: ['id', 'guess', 'confidence', 'evidence'] } } }, required: ['guesses'] }
const VERDICT = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, pass: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['id', 'pass', 'problems'] } } }, required: ['verdicts'] }
const FIXED = { type: 'object', properties: { json: { type: 'string' } }, required: ['json'] }

async function audit(tag, cases) {
  const attack = await claude({
    model: 'fable', effort: 'medium', tag: `${tag}-attack`, json: GUESS,
    prompt: `These are test cases written for an evaluation. For each one, try to guess the real person, company, client, product, project, city or country behind it, from names, places, numbers, rare details or style. Give your best specific guess, a confidence (low, medium, high) and the phrases you used. If nothing points anywhere, say "nothing specific" with low confidence.\n\n${show(cases)}`,
  })
  const verify = await claude({
    model: 'opus', effort: 'medium', tag: `${tag}-verify`, json: VERDICT,
    prompt: `You check that evaluation test cases are anonymous before they are published. The cases were written from one person's real work. Below is a private list of real identifiers (regex lines): any match, near match, translation, nickname or obvious hint at them fails a case. Also fail a case if an attacker's guess at medium or high confidence lands on a real identifier or the person's real location, if a "fake" name points to a real entity in the person's world, or if the fakes inside a case contradict each other. Common public tools and well-known public facts are fine.\n\n<identifiers>\n${identity}\n</identifiers>\n\n<attacker_guesses>\n${JSON.stringify(attack.structured?.guesses ?? [])}\n</attacker_guesses>\n\n<cases>\n${show(cases)}\n</cases>`,
  })
  return verify.structured?.verdicts ?? []
}

async function rewrite(tag, c, problems) {
  const r = await claude({
    model: 'opus', effort: 'medium', tag: `${tag}-fix`, json: FIXED,
    prompt: `Rewrite the text of this evaluation test case so it is fully anonymous while keeping the same kind and difficulty of work, the same language and the same structure. Replace every flagged item with a realistic generic fake that points to no real entity; a place becomes a well-known world city such as Lisbon, Toronto or Osaka. Keep every "state" and "intent" value exactly. Return the rewritten object as a JSON string in "json", with exactly the same keys.\n\nProblems found:\n- ${problems.join('\n- ')}\n\nCase:\n${JSON.stringify(textOf(c))}`,
  })
  let f
  try { f = JSON.parse(r.structured?.json ?? '') } catch { return c }
  const keep = (a, b) => (Array.isArray(a) && Array.isArray(b) && a.length === b.length ? a.map((x, i) => ({ ...x, state: b[i].state, intent: b[i].intent })) : b)
  const next = { ...c, rewritten: (c.rewritten ?? 0) + 1 }
  for (const k of Object.keys(textOf(c))) if (f[k] !== undefined) next[k] = k === 'checkpoints' ? keep(f[k], c[k]) : f[k]
  return next
}

mkdirSync(join(WORK, 'audit'), { recursive: true })
for (const file of process.argv.slice(2)) {
  const name = basename(file, '.jsonl')
  const tag = `${file.includes('subagents') ? 'sub' : 'sess'}-audit:${name}`
  const reportFile = join(WORK, 'audit', `${file.includes('subagents') ? 'sub' : 'sess'}-${name}.json`)
  if (readJson(reportFile, null)?.pass && !process.env.REAUDIT) { log(`skip ${name} (passed)`); continue }
  let cases = readJsonl(file)
  const chunks = []
  for (let i = 0; i < cases.length; i += 10) chunks.push(cases.slice(i, i + 10).map(c => c.id))
  let failed = []
  for (let round = 0; round < 3; round++) {
    const verdicts = (await pool(chunks, 3, ids => audit(tag, cases.filter(c => ids.includes(c.id))))).flat()
    failed = cases.map(c => {
      const v = verdicts.find(x => x?.id === c.id)
      const problems = [...(v && !v.pass ? v.problems : []), ...(v ? [] : ['no verdict returned']), ...scan(c).map(h => `contains a real identifier matching /${h}/`)]
      return problems.length ? { c, problems } : null
    }).filter(Boolean)
    log(`${name} round ${round + 1}: ${cases.length - failed.length}/${cases.length} pass`)
    if (!failed.length || round === 2) break
    const fixed = await pool(failed, 4, f => rewrite(tag, f.c, f.problems))
    cases = cases.map(c => fixed.find(x => x?.id === c.id) ?? c)
    writeJsonl(file, cases)
  }
  writeFileSync(reportFile, JSON.stringify({ pass: failed.length === 0, failed: failed.map(f => ({ id: f.c.id, problems: f.problems })) }, null, 1))
}
