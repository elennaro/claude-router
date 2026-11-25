import { expect, test } from 'claude-code/testing'

import { claudeFamily, cmpVersion, fitEffort, isSanePrices, newestAgy, newestCodex, parsePrices, versionIn } from '../hooks/latest'
import { outsideCall, runAgy, runCodex } from '../hooks/outside'
import { BUILTIN, BUILTIN_PRICE, classifyByRules, explicitAsk, isContinuation, merge } from '../hooks/policy'

// The shape `codex debug models` writes to ~/.codex/models_cache.json (fields trimmed).
const CODEX_CACHE = {
  fetched_at: '2026-11-18T09:31:29Z',
  models: [
    { slug: 'gpt-6.2-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }] },
    { slug: 'gpt-6.1-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'gpt-6-astra', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'gpt-6.2-astra', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'gpt-6-luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }] },
    { slug: 'gpt-5.6-luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'gpt-reserve', visibility: 'hide', supported_reasoning_levels: [] },
    { slug: 'gpt-7-sol', visibility: 'hide', supported_reasoning_levels: [] }, // hidden: never picked, however new
    { slug: 'codex-auto-review', visibility: 'hide' },
  ],
}

const AGY = [
  'Fetching available models...',
  'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.10-flash-low\tGemini 3.10 Flash (Low)',
  'gemini-pro-orchestrator-g1-pro\tOrchestrator (Argon)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
].join('\n')

test('Codex runs read-only with the standard flags, web search, the unelevated Windows sandbox, the brief on stdin', async () => {
  const runs: Array<{ argv: Array<string>; stdin?: string }> = []
  const files: Record<string, string> = {}
  const $ = { // only what runCodex touches
    store: { get: async () => 4, set: async () => undefined },
    fs: { write: async (p: string, t: string) => { files[p] = t }, read: async (p: string) => files[p] ?? '' },
    process: {
      run: async (argv: Array<string>, o: { stdin?: string }) => {
        runs.push({ argv, stdin: o.stdin })
        files[argv[argv.indexOf('-o') + 1]!] = 'looks fine'
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  }
  const v = { home: '/home', windows: true, appdata: '/appdata' }
  const a = await runCodex($ as any, v, { family: 'sol', effort: 'high' } as any, { role: 'review', brief: 'check it', dir: '/proj' }, { sol: { slug: 'gpt-6.2-sol', version: '6.2', efforts: ['low', 'high'] } } as any)
  expect(a).toEqual({ text: 'looks fine', model: 'gpt-6.2-sol', effort: 'high' })
  expect(runs[0]!.argv).toEqual([
    'node', '/appdata/npm/node_modules/@openai/codex/bin/codex.js', 'exec', '--ephemeral', '--disable', 'plugins', '-s', 'read-only', '--skip-git-repo-check',
    '-m', 'gpt-6.2-sol', '-c', 'model_reasoning_effort=high', '-c', 'web_search="live"', '-c', 'windows.sandbox="unelevated"',
    '-C', '/proj', '-o', '/home/.claude/router/codex/answer-5.md', '-',
  ])
  expect(runs[0]!.stdin).toBe('check it')
  expect(files['/home/.claude/router/codex/answer-5.md']).toBe('') // nothing stays on disk
})

test('a failed Codex call never returns text left in its answer file', async () => {
  const files: Record<string, string> = {}
  const $ = {
    store: { get: async () => 0, set: async () => undefined },
    fs: { write: async (p: string, t: string) => { files[p] = t }, read: async (p: string) => files[p] ?? '' },
    process: {
      run: async (argv: Array<string>) => {
        files[argv[argv.indexOf('-o') + 1]!] = 'an answer from another call' // written by someone else meanwhile
        return { exitCode: 1, stdout: '', stderr: 'rate limited' }
      },
    },
  }
  const a = await runCodex($ as any, { home: '/h', windows: false, appdata: '' }, { family: 'sol', effort: 'high' } as any, { role: 'review', brief: '- a bullet first' }, { sol: { slug: 'gpt-6.2-sol', version: '6.2', efforts: ['high'] } } as any)
  expect('error' in a && a.error.includes('rate limited')).toBe(true)
})

test('an Antigravity brief that starts with "-" cannot be read as a flag', async () => {
  const runs: Array<Array<string>> = []
  const $ = { process: { run: async (argv: Array<string>) => { runs.push(argv); return { exitCode: 0, stdout: 'ok', stderr: '' } } } }
  await runAgy($ as any, { family: 'argon', effort: 'high' } as any, { role: 'visual', brief: '--help me review' }, { argon: { slug: 'gemini-4-argon', version: '4', efforts: ['high'] } } as any)
  expect(runs[0]![2]).toBe('\n--help me review')
})

test('Antigravity runs with writes, commands and MCP denied for the session (owner case 2026-11-25: plan mode alone wrote a file)', async () => {
  const runs: Array<Array<string>> = []
  const $ = { process: { run: async (argv: Array<string>) => { runs.push(argv); return { exitCode: 0, stdout: 'ok', stderr: '' } } } }
  await runAgy($ as any, { family: 'argon', effort: 'high' } as any, { role: 'review', brief: 'look' }, { argon: { slug: 'gemini-4-argon', version: '4', efforts: ['high'] } } as any)
  const argv = runs[0]!
  expect(argv).not.toContain('--dangerously-skip-permissions')
  const deny = JSON.parse(argv[argv.indexOf('--settings') + 1]!).permissions.deny
  expect(deny).toEqual(['write_file(*)', 'command(*)', 'unsandboxed(*)', 'mcp(*)'])
})

test('the newest listed version wins per family; hidden models never', async () => {
  const c = newestCodex(CODEX_CACHE)
  expect(c.sol?.slug).toBe('gpt-6.2-sol')
  expect(c.astra?.slug).toBe('gpt-6.2-astra')
  expect(c.luna?.slug).toBe('gpt-6-luna')
  expect(c.reserve).toBe(undefined)
  expect(newestCodex(undefined)).toEqual({})
  const a = newestAgy(AGY)
  expect(a.argon).toEqual({ slug: 'gemini-4-argon', version: '4', efforts: ['medium', 'high'] })
  expect(a.hydrogen?.efforts).toEqual(['high', 'xhigh'])
  expect(a.flash?.slug).toBe('gemini-3.10-flash') // 3.10 is newer than 3.8
  expect(cmpVersion('6.10', '6.9') > 0).toBe(true)
})

test('prices come from the page only when every family is there and nothing moved 4x', async () => {
  const md = [
    '| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |',
    '| Claude Fable 5.2   | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |',
    '| Claude Fable 5.1   | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok | $50 / MTok |',
    '| Claude Opus 5.5    | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |',
    '| Claude Sonnet 5.5  | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok | $10 / MTok |',
    '| Claude Haiku 5.5 (prompts up to 100K) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |',
  ].join('\n')
  const p = parsePrices(md)
  expect(p).toEqual({ fable: [8, 40, 0.2], opus: [4, 20, 0.2], sonnet: [2, 10, 0.1], haiku: [0.1, 0.5, 0.01] })
  expect(isSanePrices(p, BUILTIN_PRICE)).toBe(true)
  expect(isSanePrices({ ...p, haiku: [1, 5, 0.1] }, BUILTIN_PRICE)).toBe(false) // a 10x jump: keep the old table
  expect(isSanePrices({ opus: p.opus! }, BUILTIN_PRICE)).toBe(false) // families missing: the page changed shape
})

test('effort fits what the model offers', async () => {
  expect(fitEffort('high', ['low', 'high', 'ultra'])).toBe('high')
  expect(fitEffort('xhigh', ['medium', 'high'])).toBe('high') // nearest below
  expect(fitEffort('low', ['medium', 'high'])).toBe('medium') // nothing below: its lowest
  expect(fitEffort('medium', [])).toBe('medium')
  expect(versionIn('codex-cli 0.170.0')).toBe('0.170.0')
  expect(versionIn('2.1.311 (Claude Code)')).toBe('2.1.311')
})

test('an exact Claude version means its family', async () => {
  expect(claudeFamily('claude-opus-4-1')).toBe('opus')
  expect(claudeFamily('claude-3-5-sonnet-20241022')).toBe('sonnet')
  expect(claudeFamily('claude-sonnet-4-5-20250929')).toBe('sonnet')
  expect(claudeFamily('claude-opus-5-5[1m]')).toBe('opus[1m]')
  expect(claudeFamily('opus')).toBe(undefined) // already a family
  expect(claudeFamily('inherit')).toBe(undefined)
})

test('Bash calls to an outside agent are spotted, other Codex commands are not', async () => {
  expect(outsideCall('codex exec --ephemeral -s read-only "review this" < /dev/null')).toBe('codex')
  expect(outsideCall('cd repo && codex exec -m gpt-6.1-sol "x"')).toBe('codex')
  expect(outsideCall('agy -p "check the slides" --model gemini-4-argon-high')).toBe('antigravity')
  expect(outsideCall('codex --version')).toBe(undefined)
  expect(outsideCall('codex debug models')).toBe(undefined)
  expect(outsideCall('agy models')).toBe(undefined)
  expect(outsideCall('grep -r "codex exec" docs/')).toBe(undefined)
})

test('a model or effort named in the prompt is an explicit ask; talk about models is not', async () => {
  expect(explicitAsk('use haiku for this: list the files in src')).toEqual({ model: 'haiku', effort: undefined, agents: undefined, sticky: false })
  expect(explicitAsk('think hard about the migration plan')?.effort).toBe('high')
  expect(explicitAsk('think harder about it')?.effort).toBe('xhigh')
  expect(explicitAsk('do it with low effort')?.effort).toBe('low')
  expect(explicitAsk('from now on use sonnet')).toEqual({ model: 'sonnet', effort: undefined, agents: undefined, sticky: true })
  expect(explicitAsk('run sonnet subagents to check each file')?.agents).toBe('sonnet')
  expect(explicitAsk('run sonnet subagents to check each file')?.model).toBe(undefined)
  expect(explicitAsk('сделай на опус, это важно')).toBe(undefined) // keywords are English only; the classifier reads other languages
  expect(explicitAsk('write a LinkedIn post about Claude Opus pricing')).toBe(undefined)
  expect(explicitAsk('a short poem on haiku form')).toBe(undefined)
  expect(explicitAsk('compare haiku and sonnet costs for our classifier')).toBe(undefined)
  // audit 2026-11-18: a mention is not a request
  expect(explicitAsk('why is the haiku model slower than opus here?')).toBe(undefined)
  expect(explicitAsk('compare the sonnet model and the opus model')).toBe(undefined)
  expect(explicitAsk('this should be a low effort change: rename the helper and update callers')).toBe(undefined)
  expect(explicitAsk('effort: high')?.effort).toBe('high')
  expect(explicitAsk('rename it everywhere, high effort please')?.effort).toBe('high')
})

test('a follow-up is a whole word at the start; a new task that starts with those letters is not', async () => {
  for (const t of ['ok, do it', 'yes', 'and the tests too, same pattern', 'ок, давай']) expect(isContinuation(t)).toBe(true) // any language: short is a follow-up
  expect(isContinuation('ок, давай дальше по плану')).toBe(false) // longer, not English: the classifier decides
  for (const t of ['android build is broken on CI since this morning', 'okta SSO returns 403 for new users', 'данные в отчёте не сходятся с базой', 'nowhere in the logs is the retry recorded', 'button click does nothing in prod after deploy']) expect(isContinuation(t)).toBe(false)
})

test('the new classes are picked by their own rules before the broad ones', async () => {
  const cfg = merge(BUILTIN, {
    main: { model: 'sonnet', effort: 'medium' }, // every class a notch above the main tier: every rule may pick
    classes: Object.fromEntries(['security-review', 'code-review', 'critique', 'math', 'devops-config', 'data-analysis', 'test-writing', 'scoped-code', 'debugging', 'long-read', 'explore', 'learn-explain', 'docs'].map(c => [c, { model: 'sonnet', effort: 'high' }])),
  })
  expect(classifyByRules('review this PR before I merge', cfg)).toBe('code-review')
  expect(classifyByRules('review my outline for the episode', cfg)).toBe('critique')
  expect(classifyByRules('do a security review of the login handler', cfg)).toBe('security-review')
  expect(classifyByRules('write unit tests for the parser', cfg)).toBe('test-writing')
  expect(classifyByRules('fix the typo in the header', cfg)).toBe('scoped-code')
  expect(classifyByRules('why does the worker crash after an hour', cfg)).toBe('debugging')
  expect(classifyByRules('set up github actions to run the tests', cfg)).toBe('devops-config')
  expect(classifyByRules('analyze the sales data for October', cfg)).toBe('data-analysis')
  expect(classifyByRules('explain how the prompt cache works', cfg)).toBe('learn-explain')
  expect(classifyByRules('read the whole transcript and pull out the decisions', cfg)).toBe('long-read')
  expect(classifyByRules('prove that the queue never loses a message', cfg)).toBe('math')
})

test('production investigation asked as a read or an explain still reaches an Opus-high class (built-in table)', () => {
  const r = (t: string) => classifyByRules(t, BUILTIN)
  expect(r('read logs/checkout-worker.log end to end. what actually broke last night?')).toBe('debugging')
  expect(r('explain what this trace means and where it actually breaks')).toBe('debugging')
  expect(r('look at the worker log and tell me why the export job keeps failing')).toBe('debugging')
  expect(r('https://github.com/acme/api/pull/412 глянь плиз')).toBe('code-review') // a PR link in any language
  expect(r('is it ok to keep the stripe secret key in a public env var? it ships to the browser')).toBe('security-review')
  expect(r('can I put it in NEXT_PUBLIC_STRIPE_KEY')).toBe('security-review')
  expect(r('why does the orders list skip one item between pages?')).toBe('debugging')
  expect(r('can we find approved top-ups with no ledger row? i think thats why balances are off')).toBe('debugging')
  expect(r('any build warnings worth fixing before the release?')).toBe('debugging')
  expect(r('Prove that the sampler in src/feed/sampler.ts gives every item probability k/n')).toBe('code-review')
  // and the plain versions stay with the classifier
  expect(r('prove that the square root of 2 is irrational')).toBe(undefined)
  expect(r('why are cats afraid of cucumbers')).toBe(undefined)
  expect(r('set up the build for the new package')).toBe(undefined)
  expect(r('explain how the prompt cache works')).toBe(undefined)
  expect(r('read the whole transcript and pull out the decisions')).toBe(undefined)
  expect(r('what keeps the dough from rising, any ideas')).toBe(undefined)
})
