// Pure drawing helpers for the band, the widget and the board: no `$`, so tests call them directly.

import type { Bucket, Tally, Tool, TurnLog, Versions } from '../types'

export const money = (n: number) => (n <= -0.005 ? `-$${(-n).toFixed(2)}` : `$${Math.max(0, n).toFixed(2)}`) // no "-$0.00" from rounding
export const saved = (t: Tally) => t.baselineUsd - t.actualUsd
export const savedPct = (t: Tally) => (t.baselineUsd > 0 ? Math.round((saved(t) / t.baselineUsd) * 100) : 0)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
// Claude's own greys and accent. The image cannot read the app's theme, so it follows the system's.
// shortcut: an app theme that differs from the system theme gets the wrong text color; pass the theme in if that bites.
const STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.v{fill:#1f1e1d;font:600 16px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.a{fill:#87867f}.b{fill:#d97757;fill-opacity:.4}@media (prefers-color-scheme:dark){.v{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.a{fill:#a3a29b}}`

export type Cell = { label: string; value: string; sub: string }

// Cost per turn: the orange bar is what the turn would have cost on the main model, the grey one what it cost.
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
  return r.map((t, i) => rect('b', x0 + i * (bw + gap), t.baseUsd) + rect('a', x0 + i * (bw + gap), t.usd)).join('')
}

// Just the bars, for the rail widget.
export function barsSvg(turns: Array<TurnLog>, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${bars(turns, 0, 0, width, height)}</svg>`
}

// The Stats card: cells in rows of `perRow` with hairline dividers, then the cost-per-turn bars with a legend.
export function statsSvg(cells: Array<Cell>, turns: Array<TurnLog>, width: number, perRow: number, mainName: string): string {
  const rowH = 60
  const colW = width / perRow
  let body = ''
  cells.forEach((c, i) => {
    const col = i % perRow
    const y = Math.floor(i / perRow) * rowH
    const x = col * colW + (col === 0 ? 0 : 12)
    if (col > 0) body += `<line class="d" x1="${col * colW}" y1="${y + 8}" x2="${col * colW}" y2="${y + rowH - 6}"/>`
    body += `<text class="l" x="${x}" y="${y + 18}">${esc(fit(c.label, Math.floor((colW - 16) / 6.4)))}</text>`
    body += `<text class="v" x="${x}" y="${y + 39}">${esc(fit(c.value, Math.floor((colW - 16) / 9.2)))}</text>`
    if (c.sub) body += `<text class="s" x="${x}" y="${y + 55}">${esc(fit(c.sub, Math.floor((colW - 16) / 6.4)))}</text>`
  })
  let height = Math.ceil(cells.length / perRow) * rowH
  if (turns.length > 1) { // one bar says nothing
    body += `<line class="d" x1="0" y1="${height + 6.5}" x2="${width}" y2="${height + 6.5}"/>`
    body += `<text class="l" x="0" y="${height + 26}">Cost per turn</text>`
    body += `<rect class="a" x="${width - 150}" y="${height + 17}" width="9" height="9" rx="1.5"/><text class="s" x="${width - 137}" y="${height + 26}">spent</text>`
    body += `<rect class="b" x="${width - 92}" y="${height + 17}" width="9" height="9" rx="1.5"/><text class="s" x="${width - 79}" y="${height + 26}">on ${esc(mainName)}</text>`
    body += bars(turns, 0, height + 36, width, 30)
    height += 70
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
  const data = JSON.stringify({ buckets, session, main: mainName, names: NAMES }).replace(/</g, '\\u003c')
  const turnRows = [...turns].reverse().map(t => `<tr><td>${esc(t.who === 'main' ? t.cls : t.who)}</td><td>${esc(nice(t.model))}</td><td>${esc(t.effort || '–')}${t.picker && t.picker !== t.effort && t.who === 'main' ? ` <span class="muted">(you picked ${esc(t.picker)})</span>` : ''}</td><td class="n">${money(t.usd)}</td><td class="n muted">${money(t.baseUsd)}</td></tr>`).join('\n')
  const M = esc(mainName)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Router savings</title>
<style>
:root{--bg:#faf9f5;--panel:#fff;--text:#141413;--muted:#73726c;--line:#e8e6dc;--accent:#d97757;--spent:#87867f;--seg:#f0eee6;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--panel:#30302e;--text:#faf9f5;--muted:#a3a29b;--line:#3e3e38;--spent:#a3a29b;--seg:#3a3a37;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
h1{font-size:22px;font-weight:600;margin:0 0 4px}h2{font-size:15px;font-weight:600;margin:36px 0 12px}
p{margin:0;color:var(--muted)}
.range{display:flex;flex-wrap:wrap;gap:2px;background:var(--seg);border-radius:9px;padding:3px}
.range button{font:inherit;font-size:13px;border:0;background:none;color:var(--muted);padding:4px 10px;border-radius:7px;cursor:pointer}
.range button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.range button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.big{display:flex;gap:40px;flex-wrap:wrap;margin:28px 0 8px}.big div{min-width:130px}.big b{display:block;font-size:30px;font-weight:600;font-variant-numeric:tabular-nums}.big span{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th{font-weight:500;color:var(--muted);text-align:left;padding:10px 8px 8px 0;font-size:13px;white-space:nowrap}td{padding:9px 8px 9px 0;border-top:1px solid var(--line)}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}th.n{text-align:right}.strong{font-weight:600}.muted{color:var(--muted)}
.label{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.now{font-size:12px;color:var(--accent);margin-left:6px}
.bar{width:24%;min-width:110px}.base{display:block;height:8px;border-radius:4px;background:color-mix(in srgb,var(--accent) 40%,transparent)}.spent{display:block;height:8px;border-radius:4px;background:var(--spent)}
.mix-row{display:grid;grid-template-columns:80px 1fr 110px;gap:12px;align-items:center;padding:8px 0}.track{height:8px;border-radius:4px;background:var(--line)}.track span{display:block;height:8px;border-radius:4px;background:var(--accent)}
.empty{padding:14px 0;color:var(--muted)}
footer{margin-top:32px;color:var(--muted);font-size:13px;display:grid;gap:6px}.tools b{color:var(--accent);font-weight:600}
</style></head><body><main>
<header><div><h1>Router savings</h1><p>Spend against running every request on ${M} at the same token counts.</p></div>
<div class="range" role="group" aria-label="Time range" id="range"></div></header>
<div class="big"><div><b id="saved"></b><span>saved</span></div><div><b id="pct"></b><span>less than all-${M}</span></div><div><b id="spent"></b><span>spent</span></div><div><b id="count"></b><span>sessions</span></div></div>
<h2>Sessions</h2><div class="card"><table><thead><tr><th>Session</th><th>Project</th><th>Last active</th><th class="n">Turns</th><th class="n">Spent</th><th class="n">Saved</th><th class="n">%</th></tr></thead><tbody id="sessions"></tbody></table></div>
<h2>By project</h2><div class="card"><table><thead><tr><th>Project</th><th class="n">Spent</th><th class="n">On ${M}</th><th class="n">Saved</th><th class="n">%</th><th>Spent vs on ${M}</th></tr></thead><tbody id="projects"></tbody></table></div>
<h2>Requests by model</h2><div class="card" id="mix"></div>
<h2>Subagents</h2><div class="card"><table><thead><tr><th>Type</th><th class="n">Runs</th><th class="n">Moved off the parent's model</th><th class="n">Sent again</th><th class="n">Spent</th><th class="n">Saved</th></tr></thead><tbody id="agents"></tbody></table></div>
${turnRows ? `<h2>This chat, turn by turn</h2><div class="card"><table><thead><tr><th>Task</th><th>Model</th><th>Effort</th><th class="n">Cost</th><th class="n">On ${M}</th></tr></thead><tbody>
${turnRows}
</tbody></table></div>` : ''}
<footer><span>API-equivalent prices. On a Max plan this tracks limit usage, not money.</span>
<span>The Haiku classifier's own cost is counted as spend. Turns sent at a lower effort save thinking tokens that cannot be measured, so they show no saving here: the figures are a floor.</span>
<span>Days are local. 1d is today. Counting since ${esc(since)}. Updated ${esc(when)}.</span>${toolsLine(tools, priceNote)}</footer>
</main>
<script>
const D = ${data};
const RANGES = [['1d',1],['3d',3],['5d',5],['7d',7],['2w',14],['1m',30],['4m',120],['1y',365],['All',0]];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const money = n => '$' + n.toFixed(2);
const pct = (u, b) => b > 0 ? Math.round((b - u) / b * 100) : 0;
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const sum = b => Object.values(b.byModel).reduce((a, m) => ({ usd: a.usd + m.usd, base: a.base + m.base, steps: a.steps + m.steps }), { usd: 0, base: 0, steps: 0 });
let pick = '7d';
try { pick = localStorage.getItem('router-range') || pick } catch (e) {}
function draw() {
  const days = (RANGES.find(r => r[0] === pick) || RANGES[3])[1];
  const from = days ? iso(new Date(Date.now() - (days - 1) * 864e5)) : '';
  const rows = D.buckets.filter(b => b.day >= from);
  const sessions = {}, projects = {}, models = {}, agents = {};
  let usd = 0, base = 0;
  for (const b of rows) {
    const t = sum(b); usd += t.usd; base += t.base;
    const s = sessions[b.session] || (sessions[b.session] = { label: b.label, project: b.project, last: 0, turns: 0, usd: 0, base: 0 });
    s.label = s.label || b.label; s.last = Math.max(s.last, b.last); s.turns += b.turns; s.usd += t.usd; s.base += t.base;
    const p = projects[b.project] || (projects[b.project] = { usd: 0, base: 0 });
    p.usd += t.usd; p.base += t.base;
    for (const [f, m] of Object.entries(b.byModel)) models[f] = (models[f] || 0) + m.steps;
    for (const [k, a] of Object.entries(b.agents || {})) { const g = agents[k] || (agents[k] = { runs: 0, routed: 0, respawned: 0, usd: 0, base: 0 }); for (const f in g) g[f] += a[f] || 0; }
  }
  $('saved').textContent = money(base - usd);
  $('pct').textContent = pct(usd, base) + '%';
  $('spent').textContent = money(usd);
  $('count').textContent = Object.keys(sessions).length;
  const ss = Object.entries(sessions).sort((a, b) => b[1].last - a[1].last).slice(0, 60);
  $('sessions').innerHTML = ss.length ? ss.map(([id, s]) => '<tr><td class="label" title="' + esc(s.label) + '">' + (esc(s.label) || '<span class="muted">untitled</span>') + (id === D.session ? '<span class="now">this chat</span>' : '') + '</td><td>' + esc(s.project) + '</td><td class="muted">' + new Date(s.last).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td><td class="n">' + s.turns + '</td><td class="n">' + money(s.usd) + '</td><td class="n strong">' + money(s.base - s.usd) + '</td><td class="n">' + pct(s.usd, s.base) + '%</td></tr>').join('') : '<tr><td colspan="7" class="empty">No sessions in this range.</td></tr>';
  const ps = Object.entries(projects).sort((a, b) => (b[1].base - b[1].usd) - (a[1].base - a[1].usd));
  const top = Math.max(...ps.map(p => p[1].base), 1e-9);
  $('projects').innerHTML = ps.length ? ps.map(([name, p]) => '<tr><td>' + esc(name) + '</td><td class="n">' + money(p.usd) + '</td><td class="n">' + money(p.base) + '</td><td class="n strong">' + money(p.base - p.usd) + '</td><td class="n">' + pct(p.usd, p.base) + '%</td><td class="bar"><span class="base" style="width:' + (p.base / top * 100).toFixed(1) + '%"><span class="spent" style="width:' + (p.base > 0 ? Math.min(100, p.usd / p.base * 100) : 100).toFixed(1) + '%"></span></span></td></tr>').join('') : '<tr><td colspan="6" class="empty">No spend in this range.</td></tr>';
  const all = Object.values(models).reduce((a, b) => a + b, 0);
  $('mix').innerHTML = all ? Object.entries(models).sort((a, b) => b[1] - a[1]).map(([f, n]) => '<div class="mix-row"><span>' + esc(D.names[f] || f) + '</span><span class="track"><span style="width:' + (n / all * 100).toFixed(1) + '%"></span></span><span class="n">' + n + ' · ' + Math.round(n / all * 100) + '%</span></div>').join('') : '<div class="empty">No requests in this range.</div>';
  const as = Object.entries(agents).sort((a, b) => b[1].runs - a[1].runs);
  $('agents').innerHTML = as.length ? as.map(([k, a]) => '<tr><td>' + esc(k) + '</td><td class="n">' + a.runs + '</td><td class="n">' + a.routed + '</td><td class="n">' + a.respawned + '</td><td class="n">' + money(a.usd) + '</td><td class="n strong">' + money(a.base - a.usd) + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">No subagents in this range.</td></tr>';
  $('range').innerHTML = RANGES.map(r => '<button type="button" data-r="' + r[0] + '" aria-pressed="' + (r[0] === pick) + '">' + r[0] + '</button>').join('');
}
$('range').addEventListener('click', e => { const r = e.target.closest('button'); if (!r) return; pick = r.dataset.r; try { localStorage.setItem('router-range', pick) } catch (x) {} draw() });
draw();
</script></body></html>`
}

