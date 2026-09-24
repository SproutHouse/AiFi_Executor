// AiFi Executor dashboard — client. Served inline by worker.js. Vanilla JS, no build step.
(function () {
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = {
  pct: (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%',
  cls: v => v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '',
  px: v => v == null ? '—' : v >= 1000 ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? Number(v).toFixed(2) : v >= 0.01 ? Number(v).toFixed(4) : Number(v).toPrecision(3),
  R: v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + ' R',
  ts: s => s ? String(s).slice(0, 16).replace('T', ' ') + 'Z' : '—',
  ago: s => { if (!s) return '—'; const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; },
  n: (v, d = 1) => v == null ? '—' : Number(v).toFixed(d),
};
function isDark() { const th = document.documentElement.dataset.theme; return th === 'dark' || (th !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches); }
function initTheme() {
  $$('[data-theme-toggle]').forEach(b => b.onclick = () => { const next = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('aifi.theme', next); } catch (e) {} });
}
// ------------------------------------------------------------ glossary --
const GLOSS = {
  R: 'R is the amount risked on a trade. Minus 1 R lost exactly the stop; plus 2 R made twice what it risked. It is the only fair unit across trade sizes.',
  relR: 'The trade\'s result minus what simply holding the book\'s blue chip would have made over the same hours, in R. Positive means the trade beat holding.',
  tier: 'Tier A: a 4-hour flip while the pair\'s daily and weekly clouds and Bitcoin\'s weekly are all bullish; executes on its own. Tier B: pullbacks and less aligned flips; recorded, not traded.',
  drawdown: 'How far the pot is below its highest value. At 10% risk per trade halves; at 20% no new entries until reviewed.',
  book: 'A group of names scored against one blue chip, with its own allowlist, pot share and risk cap. Same rules for every book.',
  regime: 'Weekly Momentum Cloud on the last completed Monday-anchored week. Bullish allows longs; anything else means flat.',
  fresh: 'The last completed 4-hour bar must have closed within 45 minutes of the run, or entries are skipped for that bar.',
  range: 'Where the last 4-hour close sits against the 36-EMA band of highs and lows: Overextended above, In Range inside, Suppressed below.',
  refused: 'Every signal that did not become a trade, with the checks that failed. A long refusal list is healthy: it is what lets the review test each filter.',
};
let tipbox = null;
function showTip(el) {
  const text = el.dataset.tip || GLOSS[el.dataset.g] || ''; if (!text) return;
  if (!tipbox) { tipbox = document.createElement('div'); tipbox.className = 'tipbox glass'; document.body.appendChild(tipbox); }
  tipbox.textContent = text; tipbox.style.left = '0px'; tipbox.style.top = '0px'; tipbox.classList.add('on');
  const r = el.getBoundingClientRect(), w = tipbox.offsetWidth, h = tipbox.offsetHeight;
  tipbox.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px';
  let y = r.bottom + 8; if (y + h > innerHeight - 8) y = r.top - h - 8; tipbox.style.top = y + 'px';
}
function hideTip() { if (tipbox) tipbox.classList.remove('on'); }
const tip = g => '<button class="tip" type="button" data-g="' + g + '" aria-label="what is this?">?</button>';
document.addEventListener('mouseover', e => { const t = e.target.closest('.tip'); if (t) showTip(t); });
document.addEventListener('mouseout', e => { if (e.target.closest('.tip')) hideTip(); });
document.addEventListener('click', e => { const t = e.target.closest('.tip'); if (t) { e.preventDefault(); tipbox && tipbox.classList.contains('on') ? hideTip() : showTip(t); } });
addEventListener('scroll', hideTip, { passive: true });

// ---------------------------------------------------------------- sheet --
function openSheet(html) { const s = $('#sheet'), bg = $('#sheetbg'); if (!s) return; s.innerHTML = '<button class="btn icon x" type="button" aria-label="close" style="position:absolute;top:12px;right:12px">✕</button>' + html; s.classList.add('on'); bg.classList.add('on'); $('.x', s).onclick = closeSheet; bg.onclick = closeSheet; }
function closeSheet() { const s = $('#sheet'), bg = $('#sheetbg'); if (s) s.classList.remove('on'); if (bg) bg.classList.remove('on'); }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ------------------------------------------------------------ the shell --
initTheme();
const app = $('#app');
if (!app) return;
const S = { b: null, tab: 'overview', sub: null, docs: {} };
const TABS = { overview: 'Overview', book: 'Book', trades: 'Trades', refused: 'Refused', logic: 'Logic' };
const dot = state => '<i class="td ' + (state === 'Bullish' ? 'g' : state === 'Bearish' ? 'r' : 'n') + '"></i>';
const rangeDot = r => !r ? '' : '<i class="td ' + (r.startsWith('Over') ? 'y' : r.startsWith('Supp') ? 'b' : 'n') + '"></i>';
function movePill() { const nav = $('.rail nav'); if (!nav) return; const a = $('a[data-tab="' + S.tab + '"]', nav), pill = $('.pill', nav); if (!a || !pill) return; pill.style.top = a.offsetTop + 'px'; pill.style.height = a.offsetHeight + 'px'; $$('a', nav).forEach(x => x.classList.toggle('on', x === a)); $$('.tabbar a').forEach(x => x.classList.toggle('on', x.dataset.tab === S.tab)); }
function parseHash() { const h = (location.hash || '#overview').slice(1); const [tab, sub] = h.split('/'); S.tab = TABS[tab] ? tab : 'overview'; S.sub = sub || null; }
addEventListener('hashchange', () => { parseHash(); render(); });
function stagger(root) { $$('.rise', root).forEach((el, i) => { el.style.animationDelay = Math.min(i * 60, 600) + 'ms'; }); }

async function boot() {
  parseHash();
  try { const r = await fetch('/api/latest'); if (!r.ok) throw new Error(r.status); S.b = await r.json(); }
  catch (e) { $('#view').innerHTML = '<div class="card"><div class="empty">No bundle yet. The first cycle after deployment pushes one.</div></div>'; return; }
  setStatus(); render();
}
function setStatus() {
  const b = S.b, lr = b.last_run || {};
  $('#gen').textContent = 'pushed ' + fmt.ago(b.generated);
  const mp = $('#modepill'); mp.textContent = b.mode === 'live' ? 'LIVE' : 'PAPER'; mp.className = 'pill ' + (b.mode === 'live' ? 'bear' : 'cool');
  const ok = lr.t && (Date.now() - new Date(lr.t).getTime()) < 5 * 3600e3;
  $('#runtxt').innerHTML = '<b>' + (ok ? 'Running' : 'Stale') + '</b> ' + esc(fmt.ago(lr.t)) + (lr.fresh === false ? ' · late run' : '');
  $('.rundot').className = 'dot rundot ' + (ok ? 'ok' : 'FAIL');
}
function render() {
  const v = $('#view'); $('#ttl').textContent = TABS[S.tab];
  v.innerHTML = ({ overview: overview, book: book, trades: trades, refused: refused, logic: logic })[S.tab]();
  stagger(v); movePill();
  if (S.tab === 'logic') loadDoc(S.sub || 'how_it_works');
  $$('[data-open]', v).forEach(el => el.onclick = () => openSheet(el.dataset.open === 'summary' ? summarySheet() : ''));
}
// ------------------------------------------------------------- overview --
function stat(label, val, sub, cls, g) {
  return '<div class="card stat rise"><div class="lbl">' + esc(label) + (g ? tip(g) : '') + '</div><div class="val ' + (cls || '') + '">' + val + '</div><div class="sub">' + (sub || '') + '</div></div>';
}
function overview() {
  const b = S.b, lr = b.last_run || {}, pot = b.pot || {}, thr = lr.throttle || {}, c = lr.counts || {};
  const pos = Object.values(b.positions || {});
  const openRisk = pos.reduce((a, p) => a + (p.risk_amt || 0), 0) / (pot.equity || 1) * 100;
  const throttle = thr.halt ? '<span class="pill bear">halted</span>' : (thr.multiplier || 1) < 1 ? '<span class="pill cool">risk halved</span>' : '<span class="pill bull">normal</span>';
  let h = '<div class="grid4">'
    + stat('Pot since start', '<span class="' + fmt.cls(pot.change_pct) + '">' + fmt.pct(pot.change_pct, 2) + '</span>', esc(b.mode) + ' · ' + (pot.points || 0) + ' cycles recorded')
    + stat('Drawdown from peak', fmt.n(pot.drawdown_pct, 1) + '%', throttle, (pot.drawdown_pct || 0) >= 10 ? 'neg' : '', 'drawdown')
    + stat('Open positions', pos.length + ' <span class="sub">/ ' + (b.settings.max_positions || 6) + '</span>', 'open risk ' + fmt.n(openRisk, 2) + '% of pot · cap ' + (b.settings.open_risk_cap_pct || 4) + '%')
    + stat('Last cycle', esc(fmt.ago(lr.t)), (lr.fresh ? 'on time' : 'late, entries skipped') + ' · ' + (c.evaluated || 0) + ' names · ' + (c.triggers || 0) + ' triggers · ' + (c.entered || 0) + ' entered', lr.fresh ? '' : 'neg', 'fresh')
    + '</div>';
  h += '<div class="grid2" style="margin-top:var(--s4)"><div class="card rise"><h2 class="eyebrow">Bitcoin regime' + tip('regime') + '</h2><div class="kv"><span>Weekly</span><b>' + dot(lr.btc_weekly) + ' ' + esc(lr.btc_weekly || '—') + '</b></div><div class="kv"><span>Daily</span><b>' + dot(lr.btc_daily) + ' ' + esc(lr.btc_daily || '—') + '</b></div><div class="note" style="margin-top:var(--s3)">' + (lr.btc_weekly === 'Bullish' ? 'Tier A entries are possible when a pair\'s own weekly and daily agree.' : 'With Bitcoin\'s weekly not bullish, flips are tier B and are recorded, not traded.') + '</div></div>'
    + '<div class="card rise"><h2 class="eyebrow">Next</h2><div class="kv"><span>Next cycle</span><b>' + esc(fmt.ts(b.next_cycle)) + '</b></div><div class="kv"><span>Cycles today</span><b>' + (b.runs_today || 0) + ' of 6</b></div><div class="kv"><span>Approval</span><b>' + esc((b.settings.approval || {}).mode === 'never' ? 'none · tier ' + ((b.settings.approval || {}).auto_tiers || []).join(',') + ' automatic' : 'online hours') + '</b></div>' + (lr.halt ? '<div class="banner bad" style="margin-top:var(--s3)">HALT is set: no new entries</div>' : '') + '</div></div>';
  h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Books' + tip('book') + '</h2><div class="grid4">' + (b.books || []).filter(x => x.enabled !== false).map(bk => {
    const st = (b.by_book || {})[bk.book] || { n: 0 }; const inb = pos.filter(p => p.book === bk.book).length;
    return '<div class="card rise"><div class="row" style="justify-content:space-between"><b>' + esc(bk.book) + '</b><span class="pill mute">vs ' + esc(bk.benchmark) + '</span></div><div class="sub">' + (bk.names || []).map(n => esc(n.coin || n)).join(' · ') + '</div><div class="kv" style="margin-top:var(--s2)"><span>Share · cap</span><b>' + bk.pot_share_pct + '% · ' + bk.open_risk_cap_pct + '%</b></div><div class="kv"><span>Open</span><b>' + inb + '</b></div><div class="kv"><span>Closed</span><b>' + st.n + (st.n ? ' · ' + fmt.R(st.avg_R) + (st.avg_rel_R != null ? ' · ' + fmt.R(st.avg_rel_R) + ' vs hold' : '') : '') + '</b></div></div>';
  }).join('') + '</div>';
  const rd = lr.readings || [];
  h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Last cycle, every name' + tip('range') + '</h2><div class="card rise tbl"><table><thead><tr><th class="l">Name</th><th class="l">Book</th><th class="l">Weekly</th><th class="l">Daily</th><th class="l">4-hour</th><th class="l">Range</th><th class="l">Result</th><th>Vol 24h</th><th>Funding</th></tr></thead><tbody>'
    + (rd.length ? rd.map(r => '<tr><td class="l"><b>' + esc(r.coin) + '</b></td><td class="l sub">' + esc(r.book) + '</td><td class="l">' + dot(r.weekly) + ' ' + esc(r.weekly) + '</td><td class="l">' + dot(r.daily) + ' ' + esc(r.daily) + '</td><td class="l">' + dot(r.h4) + ' ' + esc(r.h4) + '</td><td class="l">' + rangeDot(r.range) + ' ' + esc(r.range || '—') + '</td><td class="l ' + (r.trigger ? 'pos' : 'sub') + '">' + esc(r.trigger || r.why || '') + '</td><td class="num">' + (r.vol_m != null ? fmt.n(r.vol_m, 0) + 'M' : '—') + '</td><td class="num">' + (r.funding_pct != null ? fmt.n(r.funding_pct, 1) + '%' : '—') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">Readings appear after the next cycle.</td></tr>')
    + '</tbody></table></div>';
  h += '<h2 class="eyebrow" style="margin-top:var(--s5)">What the last cycle did</h2><div class="card rise"><ul class="list">' + ((lr.summary || []).map(s => '<li class="it">' + esc(s) + '</li>').join('') || '<li class="it sub">Nothing yet.</li>') + '</ul></div>';
  return h;
}
// ----------------------------------------------------------------- book --
function book() {
  const b = S.b, pos = Object.values(b.positions || {}), s = b.settings || {};
  let h = '<h2 class="eyebrow">Open positions</h2><div class="card rise tbl"><table><thead><tr><th class="l">Name</th><th class="l">Book</th><th class="l">Trigger</th><th>Entry</th><th>Mark</th><th>Unrealised</th><th>Stop</th><th>To stop</th><th>Size % pot</th><th>Lev</th><th class="l">Opened</th></tr></thead><tbody>'
    + (pos.length ? pos.map(p => { const toStop = p.mark && p.stop ? (p.stop / p.mark - 1) * 100 : null; return '<tr><td class="l"><b>' + esc(p.coin) + '</b></td><td class="l sub">' + esc(p.book || '') + '</td><td class="l">' + esc(p.kind) + ' <span class="pill mute">' + esc(p.tier) + '</span></td><td class="num">' + fmt.px(p.entry) + '</td><td class="num">' + fmt.px(p.mark) + '</td><td class="num ' + fmt.cls(p.upnl_pct) + '">' + fmt.pct(p.upnl_pct, 2) + '</td><td class="num">' + fmt.px(p.stop) + '</td><td class="num">' + (toStop == null ? '—' : fmt.n(toStop, 1) + '%') + '</td><td class="num">' + fmt.n(p.notional_pct_equity, 1) + '%</td><td class="num">' + (p.leverage || '—') + 'x</td><td class="l sub">' + esc(fmt.ts(p.opened)) + '</td></tr>'; }).join('') : '<tr><td colspan="11" class="empty">No open positions.</td></tr>')
    + '</tbody></table></div>';
  if ((b.proposals_open || []).length) h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Waiting for approval</h2><div class="card rise"><ul class="list">' + b.proposals_open.map(p => '<li class="it"><b>' + esc(p.coin) + '</b> ' + esc(p.kind) + ' tier ' + esc(p.tier) + ' · id <code>' + esc(p.id) + '</code> · expires ' + esc(fmt.ts(p.expires)) + '</li>').join('') + '</ul></div>';
  h += '<div class="grid2" style="margin-top:var(--s5)"><div class="card rise"><h2 class="eyebrow">Caps in force</h2>'
    + ['Risk per trade|' + s.risk_per_trade_pct + '% of pot', 'Open risk cap|' + s.open_risk_cap_pct + '% of pot', 'Gross exposure|' + s.gross_exposure_cap_x + 'x equity', 'Leverage|' + s.leverage_cap_x + 'x isolated', 'Max positions|' + s.max_positions, 'Throttle|halve at ' + (s.throttle || {}).halve_at_drawdown_pct + '%, halt at ' + (s.throttle || {}).halt_at_drawdown_pct + '%', 'Taker fee|' + s.fee_taker_pct + '% per side'].map(x => { const [k, v] = x.split('|'); return '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }).join('')
    + '</div><div class="card rise"><h2 class="eyebrow">Universe filters</h2>' + Object.entries(s.universe || {}).map(([k, v]) => '<div class="kv"><span>' + esc(k.replace(/_/g, ' ')) + '</span><b>' + esc(typeof v === 'number' && v >= 1e6 ? (v / 1e6) + 'M' : v) + '</b></div>').join('') + '</div></div>';
  h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Books</h2><div class="card rise tbl"><table><thead><tr><th class="l">Book</th><th class="l">Benchmark</th><th class="l">Names</th><th>Pot share</th><th>Risk cap</th><th class="l">Sweep</th></tr></thead><tbody>'
    + (b.books || []).map(bk => '<tr><td class="l"><b>' + esc(bk.book) + '</b>' + (bk.enabled === false ? ' <span class="pill mute">off</span>' : '') + '</td><td class="l">' + esc(bk.benchmark) + '</td><td class="l sub">' + (bk.names || []).map(n => esc(n.coin || n) + ((n.note || '') === 'untested' ? '*' : '')).join(', ') + '</td><td class="num">' + bk.pot_share_pct + '%</td><td class="num">' + bk.open_risk_cap_pct + '%</td><td class="l sub">' + (bk.sweep_gains_to_benchmark ? 'on' : 'off') + '</td></tr>').join('')
    + '</tbody></table><div class="note" style="margin-top:var(--s2)">* not in the 2020–2026 backtests; relies on the filters and the book verdict.</div></div>';
  return h;
}
// --------------------------------------------------------------- trades --
function sparkline(points, w, hgt) {
  if (!points || points.length < 2) return '<div class="empty">The equity curve appears after a few cycles.</div>';
  const ys = points.map(p => p.pct), min = Math.min(0, ...ys), max = Math.max(0, ...ys), span = (max - min) || 1;
  const X = i => (i / (points.length - 1)) * (w - 2) + 1, Y = v => hgt - 6 - ((v - min) / span) * (hgt - 12);
  const d = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.pct).toFixed(1)).join(' ');
  const zero = Y(0).toFixed(1); const last = points[points.length - 1].pct;
  return '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="' + hgt + '" role="img" aria-label="pot change since start"><line x1="0" y1="' + zero + '" x2="' + w + '" y2="' + zero + '" stroke="var(--line-2)" stroke-dasharray="3 4"/><path d="' + d + '" fill="none" stroke="' + (last >= 0 ? 'var(--good)' : 'var(--bad)') + '" stroke-width="1.8" stroke-linejoin="round"/><text x="' + (w - 4) + '" y="' + (Y(last) - 6) + '" text-anchor="end" font-size="11" fill="var(--ink-2)" font-family="var(--mono)">' + fmt.pct(last, 2) + '</text></svg>';
}
function statsRow(st) {
  if (!st || !st.n) return '<div class="empty">No closed trades yet. The strip fills as trades close; nothing is shown as skill under 30 trades.</div>';
  const cells = [['Trades', st.n], ['Win rate', Math.round(st.win_rate * 100) + '%'], ['Average', fmt.R(st.avg_R)], ['Total', fmt.R(st.total_R)], ['Profit factor', st.profit_factor == null ? '∞' : fmt.n(st.profit_factor, 2)], ['vs holding', st.avg_rel_R == null ? '—' : fmt.R(st.avg_rel_R)], ['Worst streak', st.worst_losing_streak], ['Costs / trade', fmt.n(st.fees_R, 2) + ' R']];
  return '<div class="strip">' + cells.map(([k, v]) => '<div class="t"><div class="lbl">' + esc(k) + '</div><div class="val num">' + v + '</div></div>').join('') + '</div>' + (st.n < 30 ? '<div class="note" style="margin-top:var(--s2)">n = ' + st.n + ': too few to judge. Verdicts need 30.</div>' : '');
}
function bucketTable(title, obj) {
  const rows = Object.entries(obj || {}).sort((a, z) => (z[1].total_R || 0) - (a[1].total_R || 0));
  if (!rows.length) return '';
  return '<div class="card rise tbl"><h2 class="eyebrow">' + esc(title) + '</h2><table><thead><tr><th class="l">Bucket</th><th>n</th><th>Win</th><th>Avg R</th><th>Total R</th><th>vs hold</th></tr></thead><tbody>' + rows.map(([k, v]) => '<tr><td class="l"><b>' + esc(k) + '</b></td><td class="num">' + v.n + '</td><td class="num">' + Math.round(v.win_rate * 100) + '%</td><td class="num ' + fmt.cls(v.avg_R) + '">' + fmt.R(v.avg_R) + '</td><td class="num ' + fmt.cls(v.total_R) + '">' + fmt.R(v.total_R) + '</td><td class="num">' + (v.avg_rel_R == null ? '—' : fmt.R(v.avg_rel_R)) + '</td></tr>').join('') + '</tbody></table></div>';
}
function trades() {
  const b = S.b, tr = (b.trades || []).slice().reverse();
  let h = '<div class="card rise"><h2 class="eyebrow">Pot, percent change since start' + tip('R') + '</h2>' + sparkline(b.equity, 720, 160) + '</div>';
  h += '<div class="card rise" style="margin-top:var(--s4)"><h2 class="eyebrow">Record</h2>' + statsRow(b.stats) + '</div>';
  h += '<div class="grid2" style="margin-top:var(--s4)">' + bucketTable('By book' + '', b.by_book) + bucketTable('By tier', b.by_tier) + bucketTable('By trigger', b.by_kind) + bucketTable('By exit reason', b.by_reason) + '</div>';
  h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Closed trades' + tip('relR') + '</h2><div class="card rise tbl"><table><thead><tr><th class="l">Closed</th><th class="l">Name</th><th class="l">Book</th><th class="l">Trigger</th><th>Entry</th><th>Exit</th><th>R</th><th>vs hold</th><th class="l">Exit reason</th><th>Hours</th></tr></thead><tbody>'
    + (tr.length ? tr.map(x => '<tr><td class="l sub">' + esc(fmt.ts(x.closed)) + '</td><td class="l"><b>' + esc(x.coin) + '</b></td><td class="l sub">' + esc(x.book || '') + '</td><td class="l">' + esc(x.kind) + ' <span class="pill mute">' + esc(x.tier) + '</span></td><td class="num">' + fmt.px(x.entry) + '</td><td class="num">' + fmt.px(x.exit) + '</td><td class="num ' + fmt.cls(x.R) + '">' + fmt.R(x.R) + '</td><td class="num ' + fmt.cls(x.rel_R) + '">' + (x.rel_R == null ? '—' : fmt.R(x.rel_R)) + '</td><td class="l sub">' + esc(x.reason) + '</td><td class="num">' + Math.round(x.hours) + '</td></tr>').join('') : '<tr><td colspan="10" class="empty">No closed trades yet.</td></tr>')
    + '</tbody></table></div>';
  if ((b.sweeps || []).length) h += '<h2 class="eyebrow" style="margin-top:var(--s5)">Gains earmarked for the benchmark</h2><div class="card rise"><ul class="list">' + b.sweeps.slice().reverse().map(s => '<li class="it">' + esc(fmt.ts(s.t)) + ' · ' + esc(s.book) + ' → ' + esc(s.benchmark) + ' · ' + fmt.n(s.pct_of_pot, 2) + '% of pot' + (s.executed ? '' : ' · recorded, not executed') + '</li>').join('') + '</ul></div>';
  return h;
}
// -------------------------------------------------------------- refused --
function refused() {
  const b = S.b, rows = (b.refused || []).slice().reverse();
  const counts = Object.entries(b.refused_counts || {}).sort((a, z) => z[1] - a[1]);
  let h = '<div class="card rise"><h2 class="eyebrow">Why signals were refused' + tip('refused') + '</h2>' + (counts.length ? '<div class="bars">' + counts.map(([k, v]) => '<div class="bar"><span class="name">' + esc(k) + '</span><span class="track"><span class="fill" style="width:' + Math.round(v / counts[0][1] * 100) + '%"></span></span><span class="num">' + v + '</span></div>').join('') + '</div>' : '<div class="empty">Nothing refused yet.</div>') + '<div class="note" style="margin-top:var(--s2)">' + (b.refused_total || 0) + ' recorded in total.</div></div>';
  h += '<div class="card rise tbl" style="margin-top:var(--s4)"><table><thead><tr><th class="l">When</th><th class="l">Name</th><th class="l">Signal</th><th class="l">Stage</th><th class="l">Detail</th></tr></thead><tbody>'
    + (rows.length ? rows.slice(0, 150).map(r => { const d = Array.isArray(r.detail) ? r.detail.map(c => c.check + (c.detail ? ' (' + c.detail + ')' : '')).join('; ') : String(r.detail || ''); return '<tr><td class="l sub">' + esc(fmt.ts(r.t)) + '</td><td class="l"><b>' + esc(r.coin || '') + '</b></td><td class="l">' + esc(r.kind || '') + ' <span class="pill mute">' + esc(r.tier || '') + '</span></td><td class="l sub">' + esc(r.stage || '') + '</td><td class="l" style="white-space:normal;min-width:260px">' + esc(d) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Nothing refused yet.</td></tr>')
    + '</tbody></table></div>';
  return h;
}
// ---------------------------------------------------------------- logic --
const DOCS = [['how_it_works', 'How it works'], ['logic', 'Decision logic'], ['risk', 'Risk'], ['universe', 'Universe and books'], ['execution', 'Execution'], ['security', 'Security'], ['ledger', 'The ledger'], ['operations', 'Runbook'], ['decisions', 'Decisions'], ['review', 'Latest review']];
function logic() {
  const cur = S.sub || 'how_it_works';
  return '<div class="crumbs">' + DOCS.map(([s, t]) => '<a class="btn small' + (s === cur ? ' primary' : '') + '" href="#logic/' + s + '">' + esc(t) + '</a>').join(' ') + '</div><div class="card doc rise" id="doc"><div class="empty">Loading…</div></div>';
}
async function loadDoc(slug) {
  const box = $('#doc'); if (!box) return;
  if (slug === 'review') { box.innerHTML = S.b.review_html || '<div class="empty">No Sunday review yet. The first one arrives after the first Sunday with trades.</div>'; return; }
  if (!S.docs[slug]) { try { const r = await fetch('/api/doc/' + slug); S.docs[slug] = (await r.json()).html; } catch (e) { S.docs[slug] = '<div class="empty">Could not load.</div>'; } }
  box.innerHTML = S.docs[slug];
}
function summarySheet() { return '<div class="doc"><h2>Last cycle</h2><ul>' + ((S.b.last_run || {}).summary || []).map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></div>'; }
boot();
})();
