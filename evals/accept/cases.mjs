// Cases for the owner's own guesses about where Sonnet fits (2026-11-19): summarizing what a search found, comments
// and commit text about code, and small pages with a clear definition of done. Made-up, anonymized content.
// Kept apart from cases/ so the classifier and session suites stay as they are.

const RETRY = `export async function withRetry<T>(fn: () => Promise<T>, tries = 5, baseMs = 200): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i === tries - 1) break
      const cap = baseMs * 2 ** i
      await new Promise(r => setTimeout(r, Math.random() * cap))
    }
  }
  throw last
}
`

const DIFF = `diff --git a/src/orders/discount.ts b/src/orders/discount.ts
--- a/src/orders/discount.ts
+++ b/src/orders/discount.ts
@@ -1,14 +1,22 @@
-export function applyDiscount(total: number, code?: string): number {
-  if (!code) return total
-  const pct = CODES[code]
-  if (!pct) return total
-  return Math.round(total * (1 - pct / 100))
+export function applyDiscount(total: number, code?: string, loyaltyYears = 0): number {
+  let pct = code ? CODES[code.toLowerCase()] : 0
+  if (loyaltyYears > 2) pct = pct + 5
+  if (pct > 0) {
+    console.log('discount', code, pct)
+  }
+  return total * (1 - pct / 100)
 }
@@ -20,6 +28,9 @@ export const CODES: Record<string, number> = {
   SPRING10: 10,
   VIP25: 25,
+  WELCOME15: 15,
 }
`

const SLUGIFY_OLD = `export function slugify(s: string): string {
  return s.toLowerCase().replace(/ /g, '-')
}
`
const SLUGIFY_NEW = `export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
`

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Release checklist</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; background: #ffffff; color: #1d1d1f; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 24px; margin: 0 0 16px; }
  li { padding: 8px 0; border-bottom: 1px solid #e5e5ea; }
  li.done { color: #8e8e93; text-decoration: line-through; }
  button { font: inherit; padding: 6px 12px; border: 1px solid #c7c7cc; background: #f2f2f7; border-radius: 8px; }
</style>
</head>
<body>
<main>
  <h1>Release checklist</h1>
  <ul id="list">
    <li>Bump the version</li>
    <li>Update the changelog</li>
    <li>Tag the release</li>
  </ul>
  <button id="reset">Reset</button>
</main>
<script>
  const list = document.getElementById('list')
  list.addEventListener('click', e => { if (e.target.tagName === 'LI') e.target.classList.toggle('done') })
  document.getElementById('reset').addEventListener('click', () => list.querySelectorAll('li').forEach(li => li.classList.remove('done')))
</script>
</body>
</html>
`

const SALES = `region,q3_revenue_usd,q2_revenue_usd,deals
North,412000,388000,41
South,298500,301200,37
East,515250,470100,52
West,187900,210400,22
Central,344100,320000,35
`

const SEARCH_HTTP3 = `Search notes (collected by a quick lookup agent, not checked):

[1] Vendor blog, 2026-09: "HTTP/3 now carries 34% of requests on our CDN, up from 28% a year ago."
[2] Browser telemetry dashboard, 2026-10: HTTP/3 used on 31% of page loads in the stable channel; Safari lags on some enterprise networks where UDP 443 is blocked.
[3] Conference talk summary, 2026-06: "Most enterprise firewalls still drop UDP 443; fallback to HTTP/2 adds 1 extra round trip on first connect."
[4] Forum thread, 2025-12 (old): someone claims HTTP/3 is "over 50% of traffic" — no source given.
[5] Server docs, 2026-08: our web server supports HTTP/3 behind a flag; needs a QUIC-capable load balancer, and connection migration is off by default.
[6] Ops write-up from another company, 2026-07: enabling HTTP/3 cut p75 time-to-first-byte by 9% on mobile, 2% on desktop; CPU per request up about 15% at the edge.
`

const SEARCH_PG = `Raw findings about upgrading our database from PostgreSQL 16 to 17 (from a search agent):

- Release notes: 17 adds incremental backups (pg_basebackup --incremental) and a faster vacuum memory structure (up to 20x less memory for large tables).
- Release notes: logical replication slots now survive a major-version upgrade done with pg_upgrade, if the subscriber is upgraded too.
- Our managed provider page: PostgreSQL 17 is "generally available"; in-place major upgrade causes downtime of roughly 5-15 minutes depending on size; a blue/green upgrade option exists with under 1 minute switchover.
- Extension list from our repo: we use pg_partman 4.7, pgvector 0.7, and postgis 3.4.
- pg_partman changelog: 5.x is required for PostgreSQL 17; 4.x to 5.x has breaking config changes (template tables, retention settings renamed).
- pgvector notes: 0.7 supports 17.
- A blog post: "Several ORMs had issues with the new MERGE ... RETURNING behaviour" (no versions named).
- Our current DB size: 380 GB, peak traffic 9:00-18:00 local time.
`

const SEARCH_CI = `Заметки поиска по трём CI-сервисам (собраны быстрым агентом, цифры из публичных страниц цен, ноябрь 2026):

Сервис A: бесплатно 2000 минут Linux в месяц на приватные репозитории; дальше $0.008 за минуту; macOS-минуты считаются x10; кеш до 10 ГБ на репозиторий; self-hosted раннеры бесплатно.
Сервис B: бесплатно 6000 "кредитов" в месяц (1 минута Linux = 10 кредитов, то есть 600 минут); платный план от $15 в месяц за 25000 кредитов; Docker layer caching платно; хорошая поддержка параллельных тестов (test splitting).
Сервис C: встроен в наш хостинг кода; 400 минут бесплатно на группу; дальше пакеты по $10 за 1000 минут; self-hosted раннеры бесплатно; YAML совместим с нашим текущим репозиторием почти без правок.
Наш объём: примерно 3500 минут Linux в месяц, macOS не нужен, сборки в Docker.
`

export const CASES = [
  // summarizing what a lookup found: Haiku searched, the writer turns notes into the answer
  { id: 'acc-summary-01', category: 'summarize-search', lang: 'en', fixtures: [{ path: 'notes/http3.md', content: SEARCH_HTTP3 }],
    prompt: 'My lookup agent dumped its findings in notes/http3.md. Turn them into 5 bullets for my team lead on whether we should enable HTTP/3 on our web servers. Cite the note numbers for every figure, say where sources disagree or look unreliable, and end with a one-line recommendation.' },
  { id: 'acc-summary-02', category: 'summarize-search', lang: 'en', fixtures: [{ path: 'notes/pg17.md', content: SEARCH_PG }],
    prompt: 'Based only on notes/pg17.md, write one short paragraph: should we upgrade to Postgres 17 this quarter? Then list the top 3 risks in order, each with what we would do about it. Do not invent facts that are not in the notes; say what we still need to check.' },
  { id: 'acc-summary-03', category: 'summarize-search', lang: 'ru', fixtures: [{ path: 'notes/ci.md', content: SEARCH_CI }],
    prompt: 'По заметкам в notes/ci.md сделай короткое резюме на русском: таблица (сервис, сколько будет стоить наш объём в месяц, главный плюс, главный минус) и одна фраза, что бы ты выбрал и почему. Посчитай стоимость по нашему объёму, покажи расчёт коротко.' },
  // comments and text about code: no code changes, just words that land
  { id: 'acc-comments-01', category: 'code-comments', lang: 'en', fixtures: [{ path: 'src/net/retry.ts', content: RETRY }],
    prompt: 'Write a TSDoc comment for withRetry in src/net/retry.ts. Explain the parameters, what it throws, and why the delay is random (full jitter) rather than a fixed exponential backoff. Do not change the code; show the comment placed above the function.' },
  { id: 'acc-comments-02', category: 'code-comments', lang: 'en', fixtures: [{ path: 'pr.diff', content: DIFF }],
    prompt: 'Write my review comments for the change in pr.diff. One comment per real problem, each with the file and line, what is wrong and what to do instead, in a friendly but direct tone. Skip nitpicks. End with an overall verdict: approve, or request changes.' },
  { id: 'acc-comments-03', category: 'code-comments', lang: 'en', fixtures: [{ path: 'before/slugify.ts', content: SLUGIFY_OLD }, { path: 'after/slugify.ts', content: SLUGIFY_NEW }],
    prompt: 'Write the commit message for the change from before/slugify.ts to after/slugify.ts. Conventional Commits style, a subject under 72 characters, and a short body that says what changed for callers (which inputs now give different slugs).' },
  // one short message to fix or translate (owner's example, 2026-11-19; names and details changed)
  { id: 'acc-textfix-01', category: 'short-text-fix', lang: 'pt',
    prompt: 'Olá Ana, bom dia\no Miguel (seu antigo colega) me deu o seu numero\ndisse que a senhora é uma otima contabilista e que pudemos falar consigo\nprecisamos de ajuda para preencher a declaraçao anual da nossa pequena livraria aqui em Lisboa\nse tiver tempo, posso ligar-lhe amanha?\n\ncould you fix grammar and give me back the correct version' },
  { id: 'acc-textfix-02', category: 'short-text-fix', lang: 'ru',
    prompt: 'переведи на английский, коротко и вежливо, это сообщение арендодателю: "Здравствуйте! В ванной уже неделю течёт кран, мы пробовали закрутить сами, не помогло. Можно прислать мастера в четверг или пятницу после 18:00? Спасибо!"' },
  { id: 'acc-textfix-03', category: 'short-text-fix', lang: 'en',
    prompt: 'fix the grammar, keep my tone: "hey team, me and Sara has finished the migration plan, its in the shared folder. Could everyone reviews it till friday and leave comments? Their are two open question at the end we need you\'re input on."' },
  // small pages with a definition of done
  { id: 'acc-artifact-01', category: 'artifact-task', lang: 'en',
    prompt: 'Make a single-file HTML page: a sign-up sheet for a team lunch. People add a row with their name, the dish they bring, and dietary notes (vegetarian, vegan, nut-free, none). Rows show in a table and can be removed. It must work on a phone screen, use no external libraries, and keep the rows in localStorage so a reload keeps them. Give me the whole file.' },
  { id: 'acc-artifact-02', category: 'artifact-task', lang: 'en', fixtures: [{ path: 'page.html', content: PAGE }],
    prompt: 'Update page.html: add a dark mode that follows the system setting (prefers-color-scheme), with readable contrast for the done items and the button. Keep everything else exactly as it is. Show the full updated file.' },
  { id: 'acc-artifact-03', category: 'artifact-task', lang: 'en', fixtures: [{ path: 'data/sales.csv', content: SALES }],
    prompt: 'From data/sales.csv build a one-page HTML report titled "Q3 by region": a table sorted by Q3 revenue (highest first) with a column for change vs Q2 in percent, and one bar chart of Q3 revenue drawn in inline SVG (no chart library). Put the numbers into the page directly. Give the whole file.' },
]
