// Pure routing logic: config merge, prompt classification by rules, tier picks, cost math.
// No engine calls here, so the test can exercise it directly.

import type { OutsideTable } from './outside'

// sub: what a subagent gets for this class when that differs from a chat turn (evals: Haiku does lookups and tiny
// edits right in tool loops, but its chat answers lose to Opus medium)
export type Tier = { model: string; effort?: string; class?: string; floor?: boolean; suggestOnly?: boolean; why?: string; sub?: { model: string; effort?: string } }

export type Config = {
  outside: OutsideTable // outside agents' roles -> model family and effort; families only, the newest version is picked at call time
  mode: 'on' | 'off'
  main: { model: string; effort: string }
  autoEffort: boolean
  classifier: { model: string; passAt?: number }
  classes: Record<string, Tier>
  agents: Record<string, Partial<Tier>>
  keywords: Record<string, string[]>
  // A subagent on a defined task: briefs no class claims, and classes at the main tier with no `sub` of their own, get this
  // instead of the parent's model. Classes that raise effort, floors and investigations keep their own tier.
  subagent?: { model: string; effort?: string }
}

// The calibrated defaults every install starts from; a routing.json only overrides. Each tier is the cheapest the evals
// found to keep quality (evals/README.md); `floor` classes never go below the main default; Fable is a button, never automatic.
export const BUILTIN: Config = {
  mode: 'on',
  main: { model: 'opus', effort: 'medium' },
  autoEffort: true,
  classifier: { model: 'haiku' },
  // 2026-11-19 subagent eval: two labelers put most defined-task briefs at Sonnet high, and the tool loop passed Sonnet
  // on every repo task at about 40% of Opus's cost. Moved runs 22% -> 51%, false cheap unchanged.
  subagent: { model: 'sonnet', effort: 'high' },
  classes: {
    // 2026-11-19 calibration (evals/results/class-report.md): per class, against Opus medium, judged by a judge checked
    // on gold pairs. Pooled over 133 cases per tier: Opus high +22 (better), Sonnet high -30, Haiku -52, Opus low -52
    // (worse); no group of classes kept quality below Opus medium. So chat stays Opus medium or high, and Haiku works
    // only as a subagent on lookups and tiny edits (tool-loop suite)
    // 2026-11-19 acceptance eval (each answer graded alone against the person's checklist, results/accept-report.md):
    // Sonnet medium was accepted as often as Opus medium in the classes set to sonnet below, so a chat whose first
    // prompt is surely one of them starts on Sonnet. Summaries, docs, explain and code comments lost a case each: kept.
    explore: { model: 'sonnet', sub: { model: 'haiku', effort: 'medium' }, why: 'look things up: web search, a page, weather, prices, news; search files, read logs, summarize. No writing, no code changes' },
    mechanical: { model: 'sonnet', sub: { model: 'haiku', effort: 'medium' }, why: 'reformat, translate, convert, split or fit text. Code only when it is a self-contained edit of about 10 lines that nothing else uses (one private helper, a one-off script for one clear job)' },
    // owner 2026-11-19: "a simple mail text" was read as final copy and offered Fable; a note to one person is not
    // public copy. Acceptance eval: Sonnet medium passed every short message and text fix that Opus medium passed
    message: { model: 'sonnet', effort: 'medium', why: 'an email, chat message or reply to one person or a small group: write it, fix its grammar or translate it' },
    brainstorm: { model: 'opus', why: 'angles, hooks, titles, names' },
    'scoped-code': { model: 'opus', effort: 'high', sub: { model: 'sonnet', effort: 'high' }, why: 'bug fixes, spec-driven work, feature iteration; renames and any code change that reaches other files or callers' },
    docs: { model: 'opus', why: 'everyday docs, slides, spreadsheets' },
    'repeat-agent': { model: 'opus', why: 'repeated investigation, review, drafting' },
    'image-prompt': { model: 'opus', why: 'prompts for image models' },
    'learn-explain': { model: 'opus', why: 'explain a concept, how something works, teach me; no changes' },
    'data-analysis': { model: 'sonnet', why: 'analyze data, CSV or spreadsheet numbers, write SQL' },
    'test-writing': { model: 'sonnet', why: 'write or extend tests for existing code; results checkable by running them' },
    'devops-config': { model: 'opus', effort: 'high', why: 'CI, Docker, deploy scripts, env and tool config' },
    'long-read': { model: 'sonnet', why: 'read a long file, transcript, report or thread and pull out what matters' },
    engineering: { model: 'opus', effort: 'high', why: 'everyday engineering, debugging, multi-PR work' },
    vision: { model: 'opus', effort: 'high', why: 'computer use, screenshot- or image-heavy loops' },
    debugging: { model: 'opus', effort: 'high', why: 'find why something fails, crashes or hangs; root cause before the fix' },
    'code-review': { model: 'opus', effort: 'high', why: 'review a PR, diff or branch for bugs and missing cases (not creative critique)' },
    math: { model: 'opus', why: 'proofs, derivations, probability, quantitative reasoning' },
    structure: { model: 'opus', effort: 'high', floor: true, why: 'long-form outline, story arc, cross-section consistency' },
    critique: { model: 'opus', effort: 'high', floor: true, why: 'judge hard-to-judge work: images, video, writing, other agents\' output' },
    architecture: { model: 'opus', effort: 'high', floor: true, why: 'system design, plans, ADRs, cross-module refactors' },
    'security-review': { model: 'opus', effort: 'high', floor: true, why: 'security review, vulnerabilities, threat model; misses are costly' },
    'final-copy': { model: 'fable', effort: 'high', floor: true, why: 'public copy an audience sees or hears: posts, ads, landing pages, newsletters, scripts, voice-over. Not a note to one person; Opus high, with a Fable button' },
    'brand-visual': { model: 'fable', effort: 'high', floor: true, why: 'brand guidelines, logo use, scene and composition direction; Opus high, with a Fable button' },
    'rare-hard': { model: 'fable', effort: 'xhigh', floor: true, why: 'migration, major rewrite, deep research, long agent runs; Opus xhigh, with a Fable button' },
  },
  agents: { Explore: { class: 'explore' }, Plan: { class: 'architecture' } },
  keywords: {},
  outside: {
    codex: {
      review: { family: 'sol', effort: 'high', why: 'cross-check and review' },
      validate: { family: 'sol', effort: 'high', why: 'editorial or spec validation' },
      deep: { family: 'astra', effort: 'high', why: 'hardest problems; Codex lists astra as its most capable' },
      visual: { family: 'terra', effort: 'medium', why: 'slides, screenshots, images' },
      quick: { family: 'luna', effort: 'low', why: 'lookups, formatting, small edits' },
    },
    antigravity: {
      review: { family: 'hydrogen', effort: 'high', why: 'Hydrogen edges Argon on the composite index (third-party, 2026-11)' },
      validate: { family: 'hydrogen', effort: 'high', why: 'as review' },
      deep: { family: 'hydrogen', effort: 'xhigh', why: 'Hydrogen is the only Gemini family in agy with xhigh' },
      visual: { family: 'argon', effort: 'medium', why: 'ties Hydrogen on vision evals at about half the cost' },
      quick: { family: 'flash', effort: 'low', why: 'the small, fast family' },
    },
  },
}

const MAPS = ['classes', 'agents', 'keywords'] as const

export function merge(base: Config, over: Partial<Config> | undefined): Config {
  if (!over) return base
  const out: any = { ...base, ...over }
  for (const k of MAPS) out[k] = { ...(base[k] ?? {}), ...((over as any)[k] ?? {}) }
  if (over.main) out.main = { ...base.main, ...over.main }
  out.outside = { ...base.outside }
  for (const [a, roles] of Object.entries(over.outside ?? {})) out.outside[a] = { ...((base.outside as any)?.[a] ?? {}), ...(roles ?? {}) }
  return out as Config
}

// Highest priority first: floors win over cheaper classes when several match.
// A third element `true` marks a rule exact enough to pick a cheaper class by itself.
const RULES: Array<[string, RegExp, boolean?]> = [
  ['rare-hard', /\b(migrat\w*|major refactor|rewrite the whole|deep research)\b/i],
  // a secret placed where the public can read it is a security question however it is asked (eval 2026-11-19)
  ['security-review', /\b(security (review|audit)|vulnerabilit\w*|pentest|threat model|owasp|injection risk)\b|\b(secret|api|private) key\b.{0,80}\b(public|client|browser|frontend|exposed|committed)\b|NEXT_PUBLIC_\w*(SECRET|KEY)/i],
  ['architecture', /\b(architect\w*|system design|adr\b|design doc|tech plan|solution design)\b/i],
  ['brand-visual', /\b(brand ?book|brand visual|logo|scene direction|composition|key visual)\b/i],
  // a PR link is a review ask; so is proving or verifying what a source file does (eval 2026-11-19: a proof about a
  // production sampler went to math at the default)
  ['code-review', /\b(code review|review (the|this|my) (pr|pull request|diff|code|commit|changes|branch))\b|\/pull\/\d+|\b(prove|verify) (that )?.{0,80}\b[\w-]+\/[\w./-]+\.(tsx?|jsx?|py|kt|java|go|rs|rb|cs|cpp|swift)\b/i],
  ['critique', /\b(review|critique|judge|cross-?check|qc|audit)\b/i],
  ['math', /\b(prove that|proof of|derive the|solve (the|this) equation|integral|probability of)\b/i],
  ['structure', /\b(outline|episode arc|story ?arc|structure of|beat sheet)\b/i],
  ['final-copy', /\b(final (copy|script|text|draft)|voice ?over script|linkedin post|caption|headline copy)\b/i],
  ['vision', /\b(screenshot|computer use|click through|look at the image)\b/i],
  ['image-prompt', /\b(comfy\w*|qwen-?image|image prompt|lora|controlnet)\b/i],
  ['brainstorm', /\b(brainstorm|ideas? for|angles?|hooks?|titles?|names? for)\b/i],
  ['devops-config', /\b(dockerfile|docker compose|ci pipeline|github actions|kubernetes|k8s|nginx|terraform|helm chart|deploy script)\b/i],
  ['data-analysis', /\b(analy[sz]e (the |this |my )?(data|dataset|csv|sales|numbers|metrics)|sql query|write (a |the )?query|pivot table)\b/i],
  ['docs', /\b(slides?|deck|spreadsheet|docx|pptx|document|readme)\b/i],
  ['test-writing', /\b(write|add|generate) (more |the |a )?(unit |integration |e2e )?tests?\b|test coverage/i],
  ['scoped-code', /\b(fix (the|a|this)|bug|failing test|rename|typo|small change|implement)\b/i],
  // finding what broke, from a log or a trace, is debugging even when asked as "read" or "explain" (eval 2026-11-19:
  // production log reads filed under long-read, explore and learn-explain went below Opus high); so are build warnings,
  // a list that skips items and numbers that are off
  ['debugging', /\b(debug|stack ?trace|traceback|segfault|crash(es|ing)?|why (does|do|is|are|did) .{0,60}(fail|break|crash|hang|skips?|drops?|loses?|duplicates?|miss(es)?)|why .{0,40}\b(is|are) (off|wrong|missing|negative)|what (actually )?(broke|went wrong)|where (it|this) (actually )?(breaks|fails)|why .{0,60}keeps? (failing|crashing|dying|hanging|timing out)|(build|compiler|lint) (warnings?|errors?)|(warnings?|errors?) in (the )?build)\b/i],
  ['long-read', /\b(read (the )?(whole|entire|full)|go through (all|the whole)|summari[sz]e (this|the) (book|report|transcript|pdf|thread))\b/i],
  ['explore', /\b(find|search|where is|grep|list (all|the)|summari[sz]e|read the logs?|look up)\b/i],
  // a lookup asked as a question; only the question form, so "add a weather widget" stays out
  ['explore', /^(what'?s|what is|what are|what was|how much|how is|is it|will it)\b.*\b(weather|forecast|prices?|stocks?|exchange rate|news|score)\b/i, true],
  ['mechanical', /\b(reformat|format this|translate|split subtitles|convert to|shorten)\b/i],
  ['learn-explain', /^(explain|teach me|eli5|how does|how do .{0,40} work|what is the difference)\b/i],
]

export const CLASS_LABELS = [...new Set(RULES.map(([c]) => c).concat(['engineering', 'message']))] // classes with no keyword rule: the classifier alone names them

// A model or effort named in the prompt itself. It wins for that turn, floors included; "from now on" keeps it for the chat.
export type Ask = { model?: string; effort?: string; agents?: string; sticky: boolean }
// English keywords only, in every rule here: other languages reach the Haiku classifier, which reads any language (2026-11-19)
const FAM = '(haiku|sonnet|opus|fable)'

export function explicitAsk(text: string): Ask | undefined {
  const t = text.toLowerCase()
  const first = (re: RegExp) => re.exec(t)?.slice(1).find(Boolean)
  const agents = first(new RegExp(`\\b(?:use|run|spawn)\\s+${FAM}\\s+(?:sub)?agents?\\b|\\b(?:sub)?agents?\\s+(?:on|with|using)\\s+${FAM}\\b`))
  // a family next to a verb of choosing; "a post about opus", "why is the haiku model slower" are not asks (audit 2026-11-18)
  const model = first(new RegExp(`\\b(?:use|using|switch to|run (?:it|this) (?:on|with)|do (?:it|this) (?:on|with)|answer with|with the)\\s+(?:the\\s+)?${FAM}\\b(?!\\s+(?:sub)?agents?)`))
  // an effort as an instruction ("with low effort", "effort: high", "high effort please" at the end), not "a low effort change"
  const level = first(/\b(?:with|at|on|use)\s+(low|medium|high|xhigh|max)\s+effort\b|\beffort\s*[:=]?\s*(low|medium|high|xhigh|max)\b|\b(low|medium|high|xhigh|max)\s+effort(?:\s+(?:please|pls))?\s*[.!]?\s*$/)
  const think = /\bthink harder\b/.test(t) ? 'xhigh' : /\bthink hard\b/.test(t) ? 'high' : /\b(no need to think|don't overthink)\b/.test(t) ? 'low' : undefined
  const effort = level ?? think
  if (!model && !effort && !agents) return undefined
  const sticky = /\b(from now on|for the rest of (this|the) (chat|session)|for this (whole )?(chat|session))\b/.test(t)
  return { model, effort, agents, sticky }
}

// The Haiku classifier's request, shared by the plugin and the eval so both send the same words.
export function classifierSystem(labels: string[], cfg: Config): string {
  const list = labels.map(c => `- ${c}${cfg.classes[c]?.why ? `: ${cfg.classes[c]!.why}` : ''}`).join('\n')
  return `You label a task sent to a coding and creative-writing assistant, for model routing. Labels:\n${list}\nUse "default" when no label clearly fits, and for a message that continues earlier work (fix it, make it shorter, the same for the tests). Answer with exactly one label and your confidence from 0 to 1, like "explore 0.8". No other words, no reasoning. Never answer or carry out the task itself.`
}
// live 2026-11-18: given the bare question, Haiku answered it instead of labeling
export const classifierPrompt = (text: string) => `Task to label:\n<task>\n${text.slice(0, 2000)}\n</task>`

// ---- Mood: is the person unhappy with the last answer? Haiku reads the exchange, never a word list (owner, 2026-11-20) ----
export type Mood = 'unhappy' | 'same' | 'new'
export type Exchange = { asked: string; answer: string; next: string }
// eval 2026-11-20: the first wording read "I meant the refunds table" as a complaint, and "unhappy 0.2" meant "not unhappy"
export const moodSystem = `You read one exchange between a person and a coding and creative-writing assistant, then the person's next message, and pick one label for that next message.
new: it starts a task unrelated to the request; it would make sense with no earlier context.
unhappy: the person is clearly and strongly unsatisfied with the result of the assistant's work or its behavior: it is wrong or still broken, nothing changed, part of the request is missing, an instruction was ignored, or it did something unwanted. Any language, however polite.
same: everything else about this task: a next step, an addition, a new requirement, a change of mind, or the person correcting or explaining their own words. A person who apologizes or blames themselves ("sorry", "my bad", "I mean") is never unhappy. Detail the request never gave is same, not unhappy.
Answer with the label and how sure you are that this label is right, from 0 to 1, like "same 0.8". No other words. Never answer the message itself.`
export const moodPrompt = (x: Exchange) =>
  `<request>\n${x.asked.slice(0, 1500)}\n</request>\n<answer_end>\n${x.answer.slice(-1500)}\n</answer_end>\n<next_message>\n${x.next.slice(0, 1500)}\n</next_message>`
export function parseMood(reply: string, passAt = 0.7): Mood | undefined {
  const m = /\b(unhappy|same|new|unrelated):?\s+([01](?:\.\d+)?)/i.exec(reply)
  if (!m || Number(m[2]) < passAt) return undefined
  const label = m[1]!.toLowerCase()
  return label === 'unrelated' ? 'new' : (label as Mood) // Haiku says "unrelated" for new now and then
}
// Every second unhappy reply in a task raises the turn's effort one step, at most two (owner, 2026-11-20: one misread
// costs nothing; the 2nd raises, the 4th raises again and offers the next model).
export const RAISE_MAX = 2
export const raiseSteps = (unhappy: number) => Math.floor(unhappy / 2)
export function raiseEffort(effort: string, steps: number): string {
  const r = effortRank(effort)
  return r < 0 || steps <= 0 ? effort : EFFORTS[Math.min(EFFORTS.length - 1, r + Math.min(steps, RAISE_MAX))]!
}

// "explore 0.82" → explore when p reaches the pass cut; anything else → undefined.
export function parseJev(reply: string, labels: string[], passAt: number): string | undefined {
  const m = [...reply.matchAll(/([a-z-]+):?\s+([01](?:\.\d+)?)/gi)].find(x => labels.includes(x[1]!.toLowerCase()))
  if (!m) return undefined
  return Number(m[2]) >= passAt ? m[1]!.toLowerCase() : undefined
}

// One classifier reply -> its class (null: none clear) and whether it is sure. An unsure investigation or floor class
// still counts from 0.5: it can only raise the turn (eval 2026-11-19: production debugging Haiku answered at 0.5-0.6
// ran on the default). Shared by the plugin and the eval runner.
export const UNSURE_STRONG_AT = 0.5
export function readLabel(reply: string, labels: string[], cfg: Config): { cls: string | null; sure: boolean } {
  const unsure = parseJev(reply, labels, UNSURE_STRONG_AT)
  const cls = parseJev(reply, labels, cfg.classifier.passAt ?? 0.7) ?? (isStrong(unsure, cfg) ? unsure! : null)
  return { cls, sure: parseJev(reply, labels, 0.85) !== undefined }
}

// What prompt.submit does before any model call, shared by the plugin and the eval runner so they cannot drift:
// a rule's class (no Haiku sample: it may move this turn, never the chat's model), keep the current class (short or a
// follow-up), or ask Haiku n times (3 on the chat's first prompt). strict (the chat runs on the router's own cheaper
// pick): a long prompt is read even when it opens like a follow-up ("now rebuild the billing engine").
export type ClassifyPlan = { rule: string } | { keep: true } | { ask: number }
export function classifyPlan(text: string, hasClassified: boolean, isFirst: boolean, strict: boolean, cfg: Config): ClassifyPlan {
  const rule = classifyByRules(text, cfg)
  if (rule) return { rule }
  const t = text.trim()
  if (t.length < 12 || (hasClassified && isContinuation(text) && !(strict && t.length >= 40))) return { keep: true }
  return { ask: isFirst ? 3 : 1 }
}

// Haiku's answers to one prompt -> its class, whether the main chat may move on it, and the samples firstModel reads.
// The chat's model moves only on 3 sure samples (eval 2026-11-18: three 0.8s sent code work to Sonnet); in strict mode
// a failed classifier counts as no class, so the chat goes back to the default.
export function settleAnswers(runs: Array<{ cls: string | null | undefined; sure: boolean }>, strict: boolean) {
  const first = runs[0]!
  return {
    cls: strict && first.cls === undefined ? null : first.cls,
    sure: first.sure && runs.every(r => r.cls === first.cls),
    samples: runs.map(r => (r.sure ? r.cls : null)),
  }
}

export function classifyByRules(text: string, cfg: Config): string | undefined {
  for (const [cls, words] of Object.entries(cfg.keywords)) {
    if (words.some(w => text.toLowerCase().includes(w.toLowerCase()))) return cls
  }
  // Built-in rules only raise: a rule may pick a floor or a class that needs more than the main default; a class at
  // or under it needs the classifier (eval 2026-11-18: "hooks" sent script work to Opus low, "log" sent hard debugging
  // to Haiku, and "find" took production debugging once explore sat at the default). The owner's keywords stay decisive.
  for (const [cls, re, lowers] of RULES) {
    const t = cfg.classes[cls]
    if (t && (lowers || t.floor || isHarder(cls, null, cfg)) && re.test(text)) return cls
  }
  return undefined
}

// "yes", "go on" continue the current task: keep the previous class.
export function isContinuation(text: string): boolean {
  const t = text.trim()
  // shortcut: words at the start only; a follow-up phrased like a new task reaches the classifier, which is told to call it default
  // whole words only (audit 2026-11-18: "android build is broken", "okta SSO returns 403" read as follow-ups)
  return t.length < 12 || /^(yes|yep|ok|okay|sure|go on|go ahead|continue|do it|now|and|also|then|but|great|thanks|fix it)(?!\w)/i.test(t)
}

const RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
export function family(model: string): string {
  const m = model.toLowerCase()
  return Object.keys(RANK).find(f => m.includes(f)) ?? m
}
export const rank = (model: string) => RANK[family(model)] ?? 3

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const effortRank = (e: string) => EFFORTS.indexOf(e)

// A class's tier as a subagent gets it: its `sub` tier where it has one, else the subagent default for a class at the
// main tier (no raised effort, no floor), else the class's own.
export function subTier(t: Tier | undefined, cfg: Config): Tier | undefined {
  if (t?.sub) return { ...t, ...t.sub }
  const atMain = t && !t.floor && !t.effort && family(t.model) === family(cfg.main.model)
  return atMain && cfg.subagent ? { ...t, ...cfg.subagent } : t
}

// Resolve an agents-table entry (direct tier or a class reference) to a tier; no entry: undefined (the brief decides).
export function agentTier(type: string, cfg: Config): Tier | undefined {
  const entry = cfg.agents[type]
  const cls = entry?.class ? subTier(cfg.classes[entry.class], cfg) : undefined
  if (cls) return { ...cls, ...entry, model: entry?.model ?? cls.model }
  if (entry?.model) return entry as Tier
  return undefined
}

// A subagent with no table entry and no pinned model, by its brief (docs/research-session-routing.md §E).
// Only a sure class moves it; anything else runs on the parent's model, so a guess never makes it cheaper.
// Fable is never automatic (owner, 2026-11-18): a Fable class runs on Opus unless the parent is on Fable already.
export function briefTier(cls: string | null | undefined, sure: boolean, parentModel: string, cfg: Config): Tier | undefined {
  const t = cls && sure ? subTier(cfg.classes[cls], cfg) : undefined
  if (!t) return undefined
  const model = family(t.model) === 'fable' && family(parentModel) !== 'fable' ? 'opus' : family(t.model)
  return { ...t, model, class: cls! }
}

// A sure Haiku answer that would put a subagent below its parent's model needs a second sample to agree
// (eval 2026-11-18: one sure "explore" sent Sonnet-level briefs to Haiku).
export function needsSecondSample(cls: string | null | undefined, sure: boolean, parentModel: string, cfg: Config): boolean {
  const t = cls && sure ? subTier(cfg.classes[cls], cfg) : undefined
  return Boolean(t && rank(t.model) < rank(parentModel))
}

export type SpawnFacts = {
  brief?: { cls: string | null | undefined; sure: boolean; byRule?: boolean } // a type not in the table: its brief's class
  tableTier?: Tier // a type in the table: its entry
  rule?: string // the rules' class for the brief (table types: it may only raise)
  parentModel: string
  personChose: boolean // the person picked the chat's model
  prior?: string // the model this same brief ran on last time
  sibling?: string // the highest model a sibling of this workflow run got
}

// The subagent's model and tier, as the agent.spawn hook and the eval runner both decide it.
export function spawnPick(f: SpawnFacts, cfg: Config): { model: string; tier: Tier | undefined } {
  const b = f.brief
  // an unsure strong class still raises, never lowers (eval 2026-11-18: an unsure production-debugging brief got the parent's medium effort)
  const strong = b && !b.sure && isStrong(b.cls, cfg) ? briefTier(b.cls, true, f.parentModel, cfg) : undefined
  let tier = b ? briefTier(b.cls, b.sure, f.parentModel, cfg) ?? (strong && rank(strong.model) >= rank(f.parentModel) ? strong : undefined) : f.tableTier
  // Fable is never automatic, an owner's agents entry included (audit 2026-11-18)
  if (tier && family(tier.model) === 'fable' && family(f.parentModel) !== 'fable') tier = { ...tier, model: 'opus' }
  // a table type still gets the rules, which only raise: an "Explore" brief that is really production debugging,
  // or a Plan brief that is a migration (more effort on the same model counts as higher)
  const raised = f.brief ? undefined : briefTier(f.rule, true, f.parentModel, cfg)
  const eff = (t: Tier) => effortRank(t.effort ?? cfg.main.effort)
  if (raised && tier && (rank(raised.model) > rank(tier.model) || (rank(raised.model) === rank(tier.model) && eff(raised) > eff(tier)))) tier = raised
  // rules only raise: a rule's class under the parent's model (a Fable parent, a critique rule on Opus) is no reason to go lower
  if (f.brief?.byRule && tier && rank(tier.model) < rank(f.parentModel)) tier = undefined
  // a defined task (read, no class claims it surely, no strong class even unsure): the subagent default, only ever
  // lower. A brief never read (too short, or the classifier failed: cls undefined) keeps the parent's model (eval
  // 2026-11-19: "run tests" on a production app)
  if (b && b.cls !== undefined && !tier && cfg.subagent && !isStrong(b.cls, cfg) && rank(cfg.subagent.model) < rank(f.parentModel)) tier = { ...cfg.subagent }
  // unsure: the parent's model, but not below the main default unless the person chose the chat's model
  // (eval 2026-11-18: an unsure production-debugging brief ran on a Sonnet parent)
  const lift = !tier && rank(f.parentModel) < rank(cfg.main.model) && !f.personChose ? cfg.main.model : undefined
  let model = family(tier?.model ?? lift ?? f.parentModel)
  if (f.prior && rank(stepUp(f.prior)) > rank(model)) { model = stepUp(f.prior); tier = undefined } // the same brief again: the last run fell short
  if (f.sibling && rank(f.sibling) > rank(model)) { model = f.sibling; tier = undefined } // never below a sibling: same model, shared cache
  return { model, tier }
}

// Whether class a needs more than class b (null: the main default): a stronger model, or more effort on the same one.
export function isHarder(a: string, b: string | null, cfg: Config): boolean {
  const ta = cfg.classes[a]
  if (!ta) return false
  const tb = (b ? cfg.classes[b] : undefined) ?? cfg.main
  const dm = rank(ta.model) - rank(tb.model)
  return dm > 0 || (dm === 0 && effortRank(ta.effort ?? cfg.main.effort) > effortRank(tb.effort ?? cfg.main.effort))
}

// One tier up, for a brief the parent spawns again (the first run fell short), or a chat unhappy twice. Opus and Fable stay.
const UP: Record<string, string> = { haiku: 'sonnet', sonnet: 'opus' }
export const stepUp = (model: string) => UP[family(model)] ?? family(model)

// A short stable id of a brief: repeats are matched without keeping the text.
export function briefHash(text: string): string {
  let h = 5381
  for (const ch of text.replace(/\s+/g, ' ').trim().slice(0, 4000)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  return h.toString(36)
}

// Effort for the main loop this turn: class effort, never under main default for floor classes. A cheaper class's
// effort belongs to its cheaper model: on a stronger one (a Sonnet class on an Opus chat) the turn keeps the default.
export function turnEffort(cls: string | null, cfg: Config, onModel?: string): string | undefined {
  if (!cls) return undefined
  const t = cfg.classes[cls]
  if (!t?.effort || (onModel && rank(t.model) < rank(onModel))) return undefined
  if (t.floor && effortRank(t.effort) < effortRank(cfg.main.effort)) return cfg.main.effort
  return t.effort
}

// Classes whose own turn moves to the class model in the main chat, when the class is sure (the owner chose "safe classes" on 2026-11-18).
export const AUTO = ['explore', 'mechanical']
export const SWITCH_MAX_CONTEXT = 90_000 // pricing page 2026-11: Haiku 5.5 input costs 5x above 100K; 10K margin for the new prompt and answer

// The cheaper class model a sure AUTO class moves its own turn to; undefined = stay on the requested model.
// Each model has its own cache, so the switched turn re-reads the chat uncached. Under 100K tokens Haiku's
// cache write ($0.125-0.20/M) costs no more than Opus's cache read ($0.20/M); above it Haiku's price is 5x and a short turn loses.
// Only Haiku: Sonnet's cache write ($2.50/M) re-reading the chat costs more than one turn saves.
export function autoModel(cls: string | null, context: number, requested: string, cfg: Config): string | undefined {
  const tier = cls && AUTO.includes(cls) ? cfg.classes[cls] : undefined
  if (!tier || tier.floor || family(tier.model) !== 'haiku' || rank(tier.model) >= rank(requested) || context > SWITCH_MAX_CONTEXT) return undefined
  return tier.model
}

// First prompt of a chat: the cheaper model the chat runs on when every classifier sample names the same class
// and that class is not a floor; anything less certain keeps the default (docs/research-session-routing.md: 3 of 3).
export function firstModel(samples: Array<string | null | undefined>, current: string, cfg: Config): string | undefined {
  const cls = samples[0]
  if (!cls || samples.length < 3 || samples.some(x => x !== cls)) return undefined
  // a project that raised its default above medium is production work (README): its chats never start cheaper
  if (effortRank(cfg.main.effort) > effortRank('medium')) return undefined
  const t = cfg.classes[cls]
  if (!t || t.floor || rank(t.model) >= rank(current)) return undefined
  return t.model
}

// ---- Session check (docs/research-session-routing.md, D): judges the work still ahead, never one prompt ----
export const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable']
export type SessionWindow = { prompts: Array<string>; todos?: string; plan?: string; turns: number; model: string; lastClass: string | null }
export type SessionVerdict = { tier: string; p: number; topic: 'same' | 'new' }
export type SwitchAdvice = { action: 'up' | 'down'; model: string; kind: 'compact' | 'fresh'; trigger: string }

export const sessionCheckSystem = `You judge a coding and creative-writing session for model routing. Read the recent prompts, the open todo list and the plan, then judge the work STILL AHEAD, not what is done. Pick the cheapest model that will still do that remaining work at top quality: haiku (lookups, reformatting, trivial edits), sonnet (well-specified code and writing), opus (multi-step engineering, production code investigation, final copy, judgment calls), fable (hours-long agent work, deep research, analysis carried to a finished deliverable). Also say whether the next work is the "same" task or a "new" unrelated one. Answer exactly: <model> <confidence 0-1> <same|new>, like "sonnet 0.8 same". No other words. Never do the work itself.`

export function sessionCheckPrompt(w: SessionWindow): string {
  return [
    `Session so far: ${w.turns} turns on ${family(w.model)}; last task class: ${w.lastClass ?? 'none'}.`,
    `Recent prompts, oldest first:\n${w.prompts.map((p, i) => `${i + 1}. ${p.slice(0, 600)}`).join('\n')}`,
    w.todos ? `Todo list:\n${w.todos.slice(0, 1500)}` : 'Todo list: none',
    w.plan ? `Plan:\n${w.plan.slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n')
}

export function parseSessionCheck(reply: string): SessionVerdict | undefined {
  const m = /\b(haiku|sonnet|opus|fable)\s+([01](?:\.\d+)?)\s+(same|new)\b/i.exec(reply)
  return m ? { tier: m[1]!.toLowerCase(), p: Number(m[2]), topic: m[3]!.toLowerCase() as 'same' | 'new' } : undefined
}

// Production-code investigation: owner rule, never below Opus high, never a candidate for a cheaper move.
export const INVESTIGATION = ['debugging', 'code-review', 'security-review']

// A class whose work must keep its strong model: a floor, or production-code investigation.
export const isStrong = (cls: string | null | undefined, cfg: Config) => Boolean(cls && (cfg.classes[cls]?.floor || INVESTIGATION.includes(cls)))

// Up: 2 of 3 samples above the chat's model at 0.6+ (a needless offer costs a click, a missed one costs quality: eval
// 2026-11-18 missed 62% of upgrades at 0.7), never less than a strong class at hand needs. A strong class above the
// chat's model offers its model by itself unless all samples see lighter work (Haiku tends to answer the model it is
// told the session runs on). Down: all 3 below, sure (>= 0.85), no strong class at hand, one family at a time
// (both replayed false downgrades jumped two). Never acts: the band offers it.
// shortcut: no money estimate of the switch; both offers compact first or start fresh, so the re-read is small.
export function adviseSwitch(samples: Array<SessionVerdict | undefined>, current: string, trigger: string, cfg: Config, lastClass: string | null = null): SwitchAdvice | undefined {
  const ok = samples.filter((x): x is SessionVerdict => Boolean(x))
  if (ok.length < 3) return undefined
  const cur = rank(current)
  const kind = ok.filter(x => x.topic === 'new').length >= 2 ? 'fresh' : 'compact'
  const strong = isStrong(lastClass, cfg)
  const need = strong ? family(cfg.classes[lastClass!]!.model) : undefined
  const up = ok.filter(x => rank(x.tier) > cur && x.p >= 0.6)
  if (up.length >= 2) {
    const careful = up.map(x => x.tier).sort((a, b) => rank(a) - rank(b))[0]!
    return { action: 'up', model: need && rank(need) > rank(careful) ? need : careful, kind, trigger }
  }
  const lighter = ok.every(x => rank(x.tier) < cur)
  if (need && rank(need) > cur && !lighter) return { action: 'up', model: need, kind, trigger }
  if (!strong && lighter && ok.every(x => x.p >= 0.85)) {
    const highest = ok.map(x => x.tier).sort((a, b) => rank(b) - rank(a))[0]!
    return { action: 'down', model: rank(highest) < cur - 1 ? FAMILIES[cur - 2]! : highest, kind, trigger }
  }
  return undefined
}

// API-equivalent prices per million tokens (platform.claude.com models overview, 2026-11).
// Haiku's entries are its <=100K-prompt price; costUsd applies the 5x rate above that. Cache write is 1.25x input.
export const BUILTIN_PRICE: Record<string, [number, number, number]> = {
  haiku: [0.1, 0.5, 0.01],
  sonnet: [2, 10, 0.1],
  opus: [4, 20, 0.2],
  fable: [8, 40, 0.2],
}
let PRICE = BUILTIN_PRICE
// The weekly check of the pricing page replaces these once it passes its sanity test.
export const setPrices = (p: Record<string, [number, number, number]>) => { PRICE = { ...BUILTIN_PRICE, ...p } }
export const prices = () => PRICE

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// Haiku costs 5x on every side once a prompt passes 100K tokens (pricing page, 2026-11-19): explore subagents get there.
const HAIKU_LONG = 100_000

// longCache: the write is a 1-hour cache entry (2x input) instead of a 5-minute one (1.25x). Claude Code's main thread
// writes 1-hour entries and subagents 5-minute ones (every transcript of 2026-11-18/19: 143M vs 69M tokens, no mix).
export function costUsd(model: string, u: Usage, longCache = false): number {
  const f = family(model)
  const [i0, o0, r0] = PRICE[f] ?? [4, 20, 0.2]
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const k = f === 'haiku' && prompt > HAIKU_LONG ? 5 : 1
  const i = i0 * k, o = o0 * k, r = r0 * k
  return (u.input_tokens * i + u.output_tokens * o + u.cache_read_input_tokens * r + u.cache_creation_input_tokens * i * (longCache ? 2 : 1.25)) / 1e6
}

// What a step costs at each effort, relative to medium on the same model: measured 2026-11-19 as the whole answer's
// cost on 144-158 eval cases, Opus, same prompts (evals/effort-cost.mjs), so it scales the whole step.
// shortcut: measured on Opus up to high; xhigh and max reuse high, so their extra spend shows as a floor.
export const EFFORT_COST: Record<string, number> = { low: 0.72, medium: 1, high: 1.4, xhigh: 1.4, max: 1.4 }
const effortCost = (e: string | undefined) => (e && EFFORT_COST[e]) || 1

// What a step would have cost with no router: on the model and effort the request came with (`asked`) instead of the
// ones it ran on (`sent`). A step the router moved to another model wrote the chat to a fresh cache that the asked
// model would have read from its warm one (`warm`: the context the asked model last cached); only the part not already
// read from the new model's own cache, so the credit is given once, on the first moved step (audit 2026-11-19).
export function withoutRouter(asked: { model: string; effort?: string }, sent: { model: string; effort?: string }, u: Usage, warm = 0, longCache = false): number {
  const moved = family(asked.model) !== family(sent.model)
  const cached = moved ? Math.max(0, Math.min(u.cache_creation_input_tokens, warm - u.cache_read_input_tokens)) : 0
  const usd = costUsd(asked.model, {
    ...u,
    cache_read_input_tokens: u.cache_read_input_tokens + cached,
    cache_creation_input_tokens: u.cache_creation_input_tokens - cached,
  }, longCache)
  return (usd * effortCost(asked.effort)) / effortCost(sent.effort)
}

// A cache break after an effort change: the step re-read far less than the one before.
// Only counted when steps are close in time, so a lapsed cache TTL is not blamed on effort.
export function isCacheBreak(prevRead: number, read: number, gapMs: number): boolean {
  return prevRead > 20000 && read < prevRead * 0.5 && gapMs < 4 * 60 * 1000
}
