// Pure drawing helpers for the band, the widget and the board: no `$`, so tests call them directly.

import type { Bucket, Tally, Tool, TurnLog, Versions } from '../types'

export const money = (n: number) => (n <= -0.005 ? `-$${(-n).toFixed(2)}` : `$${Math.max(0, n).toFixed(2)}`) // no "-$0.00" from rounding
// Against running with no router: net above 0 saved money, below 0 spent more. Savings and extra spend are kept apart
// step by step (a cheap subagent and a high-effort turn do not cancel out unseen).
export const net = (t: Tally) => t.baselineUsd - t.actualUsd
export const savedUsd = (t: Tally) => Math.max(0, net(t) + t.extraUsd)
export const netPct = (t: Tally) => (t.baselineUsd > 0 ? Math.round((Math.abs(net(t)) / t.baselineUsd) * 100) : 0)
export const isExtra = (t: Tally) => net(t) <= -0.005
// The band's few words: "saved $0.40", or "$0.52 extra" when it spent more than running with no router would have.
export const netWords = (t: Tally) => (isExtra(t) ? `${money(-net(t))} extra` : `saved ${money(net(t))}`)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
// Claude's own greys and accent. The image cannot read the app's theme, so it follows the system's.
// shortcut: an app theme that differs from the system theme gets the wrong text color; pass the theme in if that bites.
// .g: the no-router cost, a pale ghost behind each bar; .a: spent; .x: spent above the no-router cost (and its value text).
const STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.v{fill:#1f1e1d;font:600 18px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.a{fill:#87867f}.g{fill:#87867f;fill-opacity:.22}.x{fill:#d97757}.v.x{fill:#c15f3c}@media (prefers-color-scheme:dark){.v{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.a{fill:#a3a29b}.g{fill:#a3a29b;fill-opacity:.25}.v.x{fill:#e5906f}}`

// isExtra: the value reads as spend above running with no router, drawn in the accent.
export type Cell = { label: string; value: string; sub: string; isExtra?: boolean }

// Small turn costs need a third digit, or every bar's tip says $0.00.
const cents = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : money(n))

// Cost per turn: a pale ghost for what the turn would have cost with no router, the solid bar for what it cost,
// orange when that is more. Each bar's tip names the turn (the desktop draws <title> as a tooltip).
function bars(turns: Array<TurnLog>, x0: number, y0: number, width: number, height: number): string {
  const r = turns.slice(-Math.max(4, Math.floor(width / 9)))
  if (r.length === 0) return ''
  const gap = 3
  const bw = Math.min(24, (width - gap * (r.length - 1)) / r.length) // fills the card once there are enough turns; a few stay slim
  const max = Math.max(...r.map(t => Math.max(t.baseUsd, t.usd)), 1e-9)
  const rect = (cls: string, x: number, v: number) => {
    const h = Math.max(1.5, (v / max) * height)
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${(y0 + height - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`
  }
  return r.map((t, i) => {
    const x = x0 + i * (bw + gap)
    const tip = `${t.who === 'main' ? t.cls : t.who}, ${nice(t.model)} ${t.effort}: ${cents(t.usd)} spent, ${cents(t.baseUsd)} with no router`
    return `<g><title>${esc(tip)}</title>${rect('g', x, t.baseUsd)}${rect(t.usd > t.baseUsd + 1e-9 ? 'x' : 'a', x, t.usd)}</g>`
  }).join('')
}

// Just the bars, for the rail widget.
export function barsSvg(turns: Array<TurnLog>, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${bars(turns, 0, 0, width, height)}</svg>`
}

// The card's width and columns from the band's width in cells, so a narrow window gets two readable columns
// instead of four shrunken ones. shortcut: assumes about 8 px per cell; measure the slot if a surface reports pixels.
export function cardLayout(bodyColumns: number): { width: number; perRow: number } {
  const width = Math.max(320, Math.min(880, Math.round(bodyColumns * 8)))
  return { width, perRow: width >= 600 ? 4 : 2 }
}

// The Stats card: cells in rows of `perRow` with hairline dividers, then the cost-per-turn bars with a legend.
// Spacing sits on an 8 px grid: label, value and note 16/42/60 px down a 72 px row.
export function statsSvg(cells: Array<Cell>, turns: Array<TurnLog>, width: number, perRow: number): string {
  const rowH = 72
  const colW = width / perRow
  const chars = (per: number) => Math.floor((colW - 24) / per) // what fits a column at a font's average width
  let body = ''
  cells.forEach((c, i) => {
    const col = i % perRow
    const y = Math.floor(i / perRow) * rowH
    const x = col * colW + (col === 0 ? 0 : 16)
    if (col > 0) body += `<line class="d" x1="${col * colW}" y1="${y + 8}" x2="${col * colW}" y2="${y + rowH - 8}"/>`
    body += `<text class="l" x="${x}" y="${y + 16}">${esc(fit(c.label, chars(6.4)))}</text>`
    body += `<text class="v${c.isExtra ? ' x' : ''}" x="${x}" y="${y + 42}">${esc(fit(c.value, chars(10.4)))}</text>`
    if (c.sub) body += `<text class="s" x="${x}" y="${y + 60}">${esc(fit(c.sub, chars(6.4)))}</text>`
  })
  let height = Math.ceil(cells.length / perRow) * rowH
  if (turns.length > 1) { // one bar says nothing
    body += `<line class="d" x1="0" y1="${height + 8.5}" x2="${width}" y2="${height + 8.5}"/>`
    body += `<text class="l" x="0" y="${height + 32}">Cost per turn</text>`
    const keys: Array<[string, string]> = [['a', 'spent'], ['x', 'over no router'], ['g', 'with no router']]
    let lx = width
    for (const [cls, text] of [...keys].reverse()) {
      lx -= text.length * 5.9 + 13
      body += `<rect class="${cls}" x="${lx.toFixed(1)}" y="${height + 23}" width="9" height="9" rx="1.5"/><text class="s" x="${(lx + 13).toFixed(1)}" y="${height + 32}">${text}</text>`
      lx -= 16
    }
    body += bars(turns, 0, height + 44, width, 32)
    height += 84
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${body}</svg>`
}

// A routing.json with its top-level "mode" set, the rest of the file kept as written.
// Throws on a file that is not valid JSON, so a broken file is never overwritten.
// shortcut: finds "mode" by an indented line of its own, which is how these files are written; a one-line file gets a fresh key.
export function withMode(text: string | undefined, mode: 'on' | 'off'): string {
  const fresh = `{\n  "mode": "${mode}"\n}\n`
  if (text === undefined || text.trim() === '') return fresh
  const obj = JSON.parse(text) as Record<string, unknown>
  if (Object.keys(obj).length === 0) return fresh
  const line = /^(\s*)"mode"\s*:\s*"[a-z]*"/m
  if (line.test(text)) return text.replace(line, `$1"mode": "${mode}"`)
  return text.replace('{', `{\n  "mode": "${mode}",`)
}

export const NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }
const nice = (f: string) => NAMES[f] ?? f

// The Board: the ledger's sessions, filtered by time in the page itself, plus this chat's last turns.
// The page is a local file with its data inline, so the filter needs no server.
export const TOOL_NAMES: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }

// Which CLIs are behind: newer models only arrive with a current CLI. The update buttons live in the band's Settings.
function toolsLine(v: Versions | null, priceNote?: string): string {
  if (!v) return ''
  const parts = (Object.keys(TOOL_NAMES) as Array<Tool>).map(k => {
    const x = v.tools[k]
    if (!x?.have) return `${TOOL_NAMES[k]}: not found`
    return x.isBehind ? `<b>${TOOL_NAMES[k]} ${esc(x.have)} → ${esc(x.latest ?? '')}</b>` : `${TOOL_NAMES[k]} ${esc(x.have)}${x.latest ? ' (current)' : ''}`
  })
  const behind = Object.values(v.tools).some(x => x.isBehind)
  return `<p class="tools">${parts.join(' · ')}${behind ? '. Update from Router → Settings in Claude.' : ''}${priceNote ? ` Prices: ${esc(priceNote)}.` : ''}</p>`
}

export function boardHtml(buckets: Array<Bucket>, turns: Array<TurnLog>, session: string, mainName: string, when: string, since: string, tools: Versions | null = null, priceNote?: string): string {
  // Everything the page draws is data, escaped where the page writes it; '<' is escaped here so no value closes the script.
  const data = JSON.stringify({ buckets, turns, session, names: NAMES }).replace(/</g, '\\u003c')
  const M = esc(mainName)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Router spend</title>
<style>
:root{--bg:#faf9f5;--panel:#fff;--text:#141413;--muted:#73726c;--line:#e8e6dc;--accent:#d97757;--spent:#87867f;--ghost:rgba(135,134,127,.22);--over:#b4532c;--under:#3c7547;--seg:#f0eee6;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--panel:#30302e;--text:#faf9f5;--muted:#a3a29b;--line:#3e3e38;--spent:#a3a29b;--ghost:rgba(163,162,155,.25);--over:#e8946f;--under:#8cc192;--seg:#3a3a37;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:48px 24px 64px}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
h1{font-size:22px;font-weight:600;margin:0 0 4px}h2{font-size:15px;font-weight:600;margin:40px 0 12px}
p{margin:0;color:var(--muted)}
.range{display:flex;flex-wrap:wrap;gap:2px;background:var(--seg);border-radius:10px;padding:3px}
.range button{font:inherit;font-size:13px;min-height:32px;border:0;background:none;color:var(--muted);padding:0 10px;border-radius:7px;cursor:pointer}
.range button:hover{color:var(--text)}
.range button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.range button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin:32px 0 12px}
.kpi>span{display:block;font-size:13px;color:var(--muted)}.kpi b{display:block;font-size:28px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}.kpi small{color:var(--muted);font-size:13px}
.split{max-width:72ch}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th{font-weight:500;color:var(--muted);text-align:left;padding:12px 12px 8px 0;font-size:13px;white-space:nowrap}td{padding:10px 12px 10px 0;border-top:1px solid var(--line)}th:last-child,td:last-child{padding-right:0}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}th.n{text-align:right}.muted{color:var(--muted)}
.over{color:var(--over);font-weight:600}.under{color:var(--under);font-weight:600}
.label{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.now{font-size:12px;color:var(--accent);margin-left:8px}
.bar{width:22%;min-width:110px}.meter{position:relative;height:8px}.meter span{position:absolute;left:0;top:0;height:8px;border-radius:4px}.ghost{background:var(--ghost)}.solid{background:var(--spent)}.solid.up{background:var(--accent)}
.mix-row{display:grid;grid-template-columns:80px 1fr 110px;gap:12px;align-items:center;padding:8px 0}.track{height:8px;border-radius:4px;background:var(--line)}.track span{display:block;height:8px;border-radius:4px;background:var(--spent)}
.empty{padding:16px 0;color:var(--muted)}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
footer{margin-top:40px;color:var(--muted);font-size:13px;display:grid;gap:8px;max-width:80ch}.tools b{color:var(--accent);font-weight:600}
@media (max-width:720px){main{padding:32px 16px 48px}h1{font-size:20px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.kpi b{font-size:24px}.opt{display:none}.label{max-width:180px}.range{width:100%;flex-wrap:nowrap}.range button{flex:1;padding:0}}
@media (pointer:coarse){.range button{min-height:40px}}
</style></head><body><main>
<header><div><h1>Router spend</h1><p>What the router spent, next to the same work with the router off.</p></div>
<div class="range" role="group" aria-label="Time range" id="range"></div></header>
<section class="kpis" aria-label="Totals for the chosen range">
<div class="kpi"><span>Spent</span><b id="spent"></b></div>
<div class="kpi"><span>Without router</span><b id="base"></b></div>
<div class="kpi"><span>Difference</span><b id="diff"></b><small id="diff-pct"></small></div>
<div class="kpi"><span>Sessions</span><b id="count"></b></div>
</section>
<p class="split" id="split"></p>
<h2>Sessions</h2><div class="card"><table><thead><tr><th>Session</th><th class="opt">Project</th><th class="opt">Last active</th><th class="n opt">Turns</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Difference</th></tr></thead><tbody id="sessions"></tbody></table></div>
<h2>By project</h2><div class="card"><table><thead><tr><th>Project</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Difference</th><th class="opt"><span class="sr">Spent against without router</span></th></tr></thead><tbody id="projects"></tbody></table></div>
<h2>Requests by model</h2><div class="card" id="mix"></div>
<h2>Subagents</h2><div class="card"><table><thead><tr><th>Type</th><th class="n">Runs</th><th class="n opt">Moved off the parent's model</th><th class="n opt">Sent again</th><th class="n">Spent</th><th class="n opt">Without router</th><th class="n">Difference</th></tr></thead><tbody id="agents"></tbody></table></div>
<section id="chat" hidden><h2>This chat, turn by turn</h2><div class="card"><table><thead><tr><th>Task</th><th>Model</th><th class="opt">Effort</th><th class="n">Cost</th><th class="n opt">Without router</th><th class="n">Difference</th></tr></thead><tbody id="turns"></tbody></table></div></section>
<footer><span>API list prices. On a Max plan this tracks how fast you use your limits, not money.</span>
<span>Without router means each request on the model and effort it asked for (yours, or the parent chat's for a subagent), with the same tokens. A different effort is priced by its measured output length: high writes about 1.4 times as much as medium, low about 0.72 times. The router's own Haiku calls count as extra.</span>
<span>Spend recorded before version 0.5 was compared with ${M} at the same tokens, without a saved and extra split.</span>
<span>Days are local; 1d is today. Counting since ${esc(since)}. Updated ${esc(when)}.</span>${toolsLine(tools, priceNote)}</footer>
</main>
<script>
const D = ${data};
const RANGES = [['1d',1],['3d',3],['5d',5],['7d',7],['2w',14],['1m',30],['4m',120],['1y',365],['All',0]];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const money = n => (n < 0 ? '\\u2212$' : '$') + Math.abs(n).toFixed(2);
const cents = n => Math.abs(n) < 0.1 ? '$' + Math.abs(n).toFixed(3) : money(Math.abs(n));
// Against running with no router, from the spend side: + cost more, \\u2212 cost less. The sign carries it, the color repeats it.
function diff(u, b, f) {
  f = f || money;
  const d = u - b;
  if (Math.abs(d) < (f === money ? 0.005 : 0.0005)) return '<span class="muted">same</span>';
  return d > 0 ? '<span class="over">+' + f(d) + '</span>' : '<span class="under">\\u2212' + f(-d) + '</span>';
}
const meter = (u, b, top) => '<div class="meter"><span class="ghost" style="width:' + (b / top * 100).toFixed(1) + '%"></span><span class="solid' + (u > b ? ' up' : '') + '" style="width:' + (u / top * 100).toFixed(1) + '%"></span></div>';
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const sum = b => Object.values(b.byModel).reduce((a, m) => ({ usd: a.usd + m.usd, base: a.base + m.base, extra: a.extra + (m.extra || 0), steps: a.steps + m.steps }), { usd: 0, base: 0, extra: 0, steps: 0 });
const empty = (cols, text) => '<tr><td colspan="' + cols + '" class="empty">' + text + '</td></tr>';
let pick = '7d';
try { pick = localStorage.getItem('router-range') || pick } catch (e) {}
function draw() {
  const days = (RANGES.find(r => r[0] === pick) || RANGES[3])[1];
  const from = days ? iso(new Date(Date.now() - (days - 1) * 864e5)) : '';
  const rows = D.buckets.filter(b => b.day >= from);
  const sessions = {}, projects = {}, models = {}, agents = {};
  let usd = 0, base = 0, extra = 0;
  for (const b of rows) {
    const t = sum(b); usd += t.usd; base += t.base; extra += t.extra;
    const s = sessions[b.session] || (sessions[b.session] = { label: b.label, project: b.project, last: 0, turns: 0, usd: 0, base: 0 });
    s.label = s.label || b.label; s.last = Math.max(s.last, b.last); s.turns += b.turns; s.usd += t.usd; s.base += t.base;
    const p = projects[b.project] || (projects[b.project] = { usd: 0, base: 0 });
    p.usd += t.usd; p.base += t.base;
    for (const [f, m] of Object.entries(b.byModel)) models[f] = (models[f] || 0) + m.steps;
    for (const [k, a] of Object.entries(b.agents || {})) { const g = agents[k] || (agents[k] = { runs: 0, routed: 0, respawned: 0, usd: 0, base: 0 }); for (const f in g) g[f] += a[f] || 0; }
  }
  $('spent').textContent = money(usd);
  $('base').textContent = money(base);
  $('diff').innerHTML = diff(usd, base);
  $('diff-pct').textContent = base > 0 && Math.abs(usd - base) >= 0.005 ? Math.round(Math.abs(usd - base) / base * 100) + '% ' + (usd > base ? 'more' : 'less') + ' than without router' : '';
  $('count').textContent = Object.keys(sessions).length;
  const saved = Math.max(0, base - usd + extra);
  $('split').textContent = rows.length ? 'Saved ' + money(saved) + ' on steps the router made cheaper. Spent ' + money(extra) + ' extra on stronger steps and on its own Haiku calls.' : '';
  const ss = Object.entries(sessions).sort((a, b) => b[1].last - a[1].last).slice(0, 60);
  $('sessions').innerHTML = ss.length ? ss.map(([id, s]) => '<tr><td class="label" title="' + esc(s.label) + '">' + (esc(s.label) || '<span class="muted">untitled</span>') + (id === D.session ? '<span class="now">this chat</span>' : '') + '</td><td class="opt">' + esc(s.project) + '</td><td class="opt muted">' + new Date(s.last).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td><td class="n opt">' + s.turns + '</td><td class="n">' + money(s.usd) + '</td><td class="n muted opt">' + money(s.base) + '</td><td class="n">' + diff(s.usd, s.base) + '</td></tr>').join('') : empty(7, 'No sessions in this range. Pick a longer range above.');
  const ps = Object.entries(projects).sort((a, b) => b[1].usd - a[1].usd);
  const top = Math.max(...ps.map(p => Math.max(p[1].base, p[1].usd)), 1e-9);
  $('projects').innerHTML = ps.length ? ps.map(([name, p]) => '<tr><td>' + esc(name) + '</td><td class="n">' + money(p.usd) + '</td><td class="n muted opt">' + money(p.base) + '</td><td class="n">' + diff(p.usd, p.base) + '</td><td class="bar opt">' + meter(p.usd, p.base, top) + '</td></tr>').join('') : empty(5, 'No spend in this range.');
  const all = Object.values(models).reduce((a, b) => a + b, 0);
  $('mix').innerHTML = all ? Object.entries(models).sort((a, b) => b[1] - a[1]).map(([f, n]) => '<div class="mix-row"><span>' + esc(D.names[f] || f) + '</span><span class="track"><span style="width:' + (n / all * 100).toFixed(1) + '%"></span></span><span class="n">' + n + ' (' + Math.round(n / all * 100) + '%)</span></div>').join('') : '<div class="empty">No requests in this range.</div>';
  const as = Object.entries(agents).sort((a, b) => b[1].runs - a[1].runs);
  $('agents').innerHTML = as.length ? as.map(([k, a]) => '<tr><td>' + esc(k) + '</td><td class="n">' + a.runs + '</td><td class="n opt">' + a.routed + '</td><td class="n opt">' + a.respawned + '</td><td class="n">' + money(a.usd) + '</td><td class="n muted opt">' + money(a.base) + '</td><td class="n">' + diff(a.usd, a.base) + '</td></tr>').join('') : empty(7, 'No subagents in this range.');
  $('range').innerHTML = RANGES.map(r => '<button type="button" data-r="' + r[0] + '" aria-pressed="' + (r[0] === pick) + '">' + r[0] + '</button>').join('');
}
// This chat's turns, newest first: they come from the session, not the ledger, so the range does not filter them.
if (D.turns.length) {
  $('chat').hidden = false;
  $('turns').innerHTML = D.turns.slice().reverse().map(t => '<tr><td>' + esc(t.who === 'main' ? t.cls : t.who) + '</td><td>' + esc(D.names[t.model] || t.model) + '</td><td class="opt">' + esc(t.effort || '\\u2013') + (t.picker && t.picker !== t.effort && t.who === 'main' ? ' <span class="muted">(you picked ' + esc(t.picker) + ')</span>' : '') + '</td><td class="n">' + cents(t.usd) + '</td><td class="n muted opt">' + cents(t.baseUsd) + '</td><td class="n">' + diff(t.usd, t.baseUsd, cents) + '</td></tr>').join('');
}
$('range').addEventListener('click', e => { const r = e.target.closest('button'); if (!r) return; pick = r.dataset.r; try { localStorage.setItem('router-range', pick) } catch (x) {} draw() });
draw();
</script></body></html>`
}
