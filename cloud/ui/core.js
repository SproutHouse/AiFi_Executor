// cloud/ui/core.js — the client core (spec §2, §3, §4.1, §5, §9, §12, §14, §15). Joined FIRST into the page's one
// IIFE (see ui/README.md) and the only module that declares top-level names. Nothing here runs at load except
// building constants; boot.js starts everything last.
/* ================================================ CORE API ================================================
 Module builders: everything below is in scope for every ui/*.js block. Times in the bundle are unix SECONDS and
 every fmt time function takes seconds. Helpers that return HTML escape their own input.

 DOM + misc      esc(s) · $(sel, root?) → Element · $$(sel, root?) → Element[] · HTML (documentElement) · BAR = 14400
                 nowMs() → ms, nowS() → s (tests: window.__exNow = ms number or function, or override Date.now)
                 reduced (live boolean, prefers-reduced-motion) · lsGet(key, fallback) / lsSet(key, value) (JSON, never
                 throw) · call(fn, ...args) (try/catch) · report(err, where) · isoS(iso|num) → s|null
                 tok('--good') → CSS token value · isDark() · jump(y) (instant scroll, no smooth) · into(el, smooth?)
                 num(v) → finite number or null ('' / boolean / NaN → null) · isObj(v) (plain object, not an array)
                 cap1(s) → first letter upper-cased · getJSON(url, ms?) → Promise<json>; rejects {kind: 'net' | 'auth'
                 | 'missing' | 'server' | 'parse'} (same-origin, no-store, AbortController timeout)
 Formats (§14)   fmt.R(v, nd=2) "+1.84 R" · fmt.Rn(v, nd=2) "+1.84" · fmt.pct(v, nd=2) "+1.30%" (signed)
                 fmt.pctu(v, nd=1) "3.2%" (|v|) · fmt.num(v, nd=2, signed?) · fmt.int(v) "1,500" · fmt.x(v, nd=2) "0.73×"
                 fmt.lev(v) "3×" or "—" · fmt.fund(v) "68%/yr" · fmt.px(v) 5 significant figures (sheets only)
                 fmt.cls(v, nd=2) → 'pos'|'neg'|''. Below half the last digit prints 0 with no sign and no colour.
                 fmt.time(t) "4:20 am" · fmt.when(t) today "4:20 am" / within 6 days "Thu 8:27 pm" / older "Sep 18"
                 fmt.day(t) "Thu Sep 24" · fmt.stamp(t) "Thu Sep 24, 12:20 pm" · fmt.dayLong(t) "Thursday, September 24"
                 fmt.md(t) "Sep 18" · fmt.wd(t) "Thu" · fmt.hr(t) "12a"/"8p" · fmt.utc(t) "08:00 UTC"
                 fmt.ago(t) "just now" / "27 min ago" / "3 h ago" / fmt.when(t) from 48 h · fmt.rel(t) "in 2 h 13 m"
                 fmt.age(sec) "27m" "2h 10m" "9 h" "3 d" · fmt.dur(sec) "27 min" "2 h 13 m" "2 d 6 h"
                 fmt.cd(sec) "2:13:07" / "13:07" · fmt.over(sec) "+04:12". Output is plain text, safe inside HTML.
                 Any element with data-ago="<unix s>" gets fresh fmt.ago() text on every 30 s tick.
 Missing (§1.8)  val(v, f?, short?) → f(v), or "— not in this data" (short: a muted "—") · na(short?) · MISSING
                 safe(fn, name, host?) → fn(), or a small .empty card "This panel couldn't be drawn…" (also into host)
 Vocabulary      STAGE[code] = {code, w, short, gate, role, tape, grp, cls:'st-<code>', note?} (§12) · stage(code)
                 GATES[i] = {g, label, codes, live?} (Gate Run rows 0–8) · GRP[grp] → On deck group title
                 CHECK_OF[reasonCode] → the cfg.checks name it belongs to (check lights)
                 GLOSS[key] = {t, d: text | d(cfg)} · gloss(key) → {t, d} · tip(key) → the "?" button (44px hit area)
                   keys: auto watch signal flip pullback oneflip thin cushion needs openR lockedR firstStop exposure
                   riskInUse drawdown slot gateRun heartbeat late vsHolding pf goLive paper R stop book checks line
                   due stale
                 word.kind(k, long?) · word.tier(t) · word.dir(1|0|null) · word.range(rg) · word.dist(d, held?)
                 word.reason(code, v, long?) · word.reasons([[code, v]…], long?) · word.codes("vol 0.73,fund 68")
                 word.exit(rsn) · word.outcome(o) · word.stage(code) · word.run(run) → {k, w, s} · word.lag(min, ok)
                 word.event(eventsRow) → {html, ic, lv, t, type, c} · word.alert(alert) → html
                 word.punct(b) the punctuality sentence · word.list([…]) · word.plural(n, one, many?)
                 chip(coin, runT?) → a .tk button that opens the name sheet · ICON[name] / icon(name) → inline SVG
                   ICON names: x warn bad info ok left right up down raise block rec clock pause play flag eye doc
                   swap refresh
 Registries      VIEWS[tab] = {title, render(root, why) → html | nothing, after?(root) → cleanup fn?, leave?()}
                   tabs: now activity positions results rules · why: 'route' | 'arrival' | 'redraw'. A missing VIEWS entry
                   renders a quiet placeholder. A cleanup returned by after() runs before the next render.
                 COMP[name] = fn: shared components. Always guard: COMP.x ? COMP.x(…) : … . Core itself reads
                   COMP.punctuality(b) → html, for the Health sheet, when a module provides it.
                 SHEETS[kind] = (arg, el) → html | {html, after?(sheetEl) → cleanup fn?, cls?}. Opened by ONE
                   delegated click on the nearest [data-cursor] [data-health] [data-cycle] [data-name] [data-pos]
                   [data-trade] [data-sheet="kind:arg"]. data-at on a [data-name] is the run t. Core ships a default
                   SHEETS.health (replaceable). A click whose default is already prevented is left alone, so a
                   module claims a click with e.preventDefault().
                 HOOKS: hook(name, fn) registers; runHooks(name, ...args). arrival(prev, next) · tick1s() ·
                   tick30s() · route(tab, sub) · theme(theme) · hide() · show() · status(st) (after every
                   refreshShell(): the 30 s tick, a landed bundle, or a module that saw the phase flip)
 State           S = {b, ledger, ledgerGen, ledgerErr, cursor, tab, sub, prev, st, net, seenAt, seenEv, sheet}
                   S.b exec:latest · S.prev the bundle before the last arrival · S.st = status(S.b), refreshed on the
                   30 s tick · S.net 'ok'|'checking'|'offline'|'signedout' · S.seenEv = ex.seenEv as it was when
                   Activity opened (the "new since your last visit" marker) · S.sheet {kind, arg} of the open sheet
                 setCursor(t|null, opts?) null = latest; opts {scroll, sheet:false, explicit} · onCursor(fn(t, prev, opts))
                 runsOf(b?) · lastRun(b?) · runAt(t, b?) · cursorRun() · nameOf(coin) · modeOf(b) · stateOf(b) · clockOf(b)
                 loadLedger(force?) → Promise<ledger|null>, never rejects; S.ledgerErr says why when null
                 loadLWC() → Promise<LightweightCharts> (lightweight-charts 4.2.3 from jsdelivr, injected once)
 Status (§3)     clock(b?, nowS?) → {phase:'countdown'|'due'|'late'|'stale'|'none', C, lag, lim, next, lateAt, staleAt,
                   exitsAt, sched, lastT, lastSlot, age, over, toNext, rng, lagN, nOpen, exits, now}
                 status(b?, nowS?) → {lvl:'ok'|'info'|'warn'|'bad', dot, word, age, wide, sentence(html), k, items[], K}
                   items[i] = {lvl, k, word, sentence(html), act:{label, href | cycle}, age, wide, head}
                 DOT[lvl] → dot class (ok due gap bad) · LVCLS[lvl] → '' | 'warn' | 'bad'
 Shell           openSheet(html | {html, after, cls}, key?) · showSheet(kind, arg, el?) · closeSheet() · refreshSheet()
                 showTip(el, html?) · hideTip() · toast(html, {ms}) · setPlay(key, on) (html.play pauses .bg)
                 every1s(el, fn): fn runs every second while el is on screen and the page is visible
                 countUp(el, to, {from, decimals, prefix, suffix, ms, fmt}) · stagger(root) · setSeg(seg, v)
                 initSegs(root?) · movePill() · masks(root?) (edge fades .mask-l/.mask-r + region semantics) ·
                 mdTables(html) → md() html with each table in a details.disc.mdt (closed under 900px) ·
                 banner(lvl, html, act?) · go(tab, sub?) · route() · poll(user?) · land(bundle)
                 redraw() → re-render the open tab in place (why 'redraw'), keeping the scroll and an open sheet
                 refreshShell() → recompute S.st and repaint the capsule, rail mirror, mode pill, alert rail and the
                   Activity dot, then run the 'status' hooks. Call it when a module sees the clock phase flip.
 Anchors         route() scrolls to id="<tab>-<sub>" when present (#activity/signals → id="activity-signals";
                 #refused redirects there). setCursor(t, {scroll:true}) on Now scrolls to id="now-gaterun".
 Clicks          [data-cursor="<t>" | ""] sets the cursor ([data-scroll] also scrolls to the Gate Run) ·
                 [data-refresh] checks for new data · [data-retry] reboots · [data-top] scrolls to the top ·
                 .tip / [data-tip="text"] / [data-g="glossKey"] open a tip (or set el._tip = html | fn(el));
                 [data-tip-cursor="<t>"] adds a "Replay this check ›" button to that tip.
 ========================================================================================================== */

// ============================================================================================ basics ==
const BAR = 14400;
const HTML = document.documentElement;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function nowMs() {
  const o = window.__exNow;
  if (typeof o === 'function') { const v = Number(o()); if (isFinite(v)) return v; }
  if (typeof o === 'number' && isFinite(o)) return o;
  return Date.now();
}
function nowS() { return Math.floor(nowMs() / 1000); }
const MQ_RM = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = MQ_RM.matches;
// A change of the OS setting redraws the open tab and sheet, so Replay/Step, Play and the pings follow it at once.
function onMotion(e) { reduced = e.matches; if (S.b && document.getElementById('app')) { redraw(); refreshSheet(); } }
if (MQ_RM.addEventListener) MQ_RM.addEventListener('change', onMotion);
else if (MQ_RM.addListener) MQ_RM.addListener(onMotion);
function report(e, where) { try { console.error('[executor] ' + (where || 'error'), e); } catch (_) {} }
function call(fn, ...a) { if (typeof fn !== 'function') return; try { return fn(...a); } catch (e) { report(e, fn.name || 'hook'); } }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function isoS(v) { if (v == null || v === '') return null; if (typeof v === 'number') return isFinite(v) ? Math.floor(v) : null; const ms = Date.parse(v); return isFinite(ms) ? Math.floor(ms / 1000) : null; }
function tok(n) { return getComputedStyle(HTML).getPropertyValue(n).trim(); }
function isDark() { const t = HTML.dataset.theme; return t === 'dark' || (t !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches); }
function jump(y) { try { scrollTo({ top: y, behavior: 'instant' }); } catch (e) { scrollTo(0, y); } }
function into(el, smooth) { if (!el) return; el.style.scrollMarginTop = '72px'; try { el.scrollIntoView({ block: 'start', behavior: smooth && !reduced ? 'smooth' : 'instant' }); } catch (e) { el.scrollIntoView(); } }

// ===================================================================================== formats (§14) ==
const MINUS = '−', NB = ' ';
const NF = {}, DF = {};
function nf(nd, sig) { const k = (sig ? 's' : 'f') + nd; return NF[k] || (NF[k] = new Intl.NumberFormat(undefined, sig ? { maximumSignificantDigits: nd } : { minimumFractionDigits: nd, maximumFractionDigits: nd })); }
function df(k, o) { return DF[k] || (DF[k] = new Intl.DateTimeFormat(undefined, o)); }
function numv(v) { if (v == null || v === '' || typeof v === 'boolean') return null; const x = Number(v); return isFinite(x) ? x : null; }
const num = numv;                                                                        // shared: a finite number or null
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cap1 = s => { s = s == null ? '' : String(s); return s.charAt(0).toUpperCase() + s.slice(1); };
function rz(x, nd) { return Math.abs(x) < 0.5 * Math.pow(10, -nd) ? 0 : x; }
function signed(x, nd) { const r = rz(x, nd); return (r > 0 ? '+' : r < 0 ? MINUS : '') + nf(nd).format(Math.abs(r)); }
function ymd(ms) { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; }     // local calendar day
function clockText(ms) {
  return df('t', { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(ms)).map(p =>
    p.type === 'dayPeriod' ? p.value.toLowerCase().replace(/\./g, '') : p.type === 'literal' ? p.value.replace(/[\s ]+/g, NB) : p.value).join('');
}
const fmt = {
  num: (v, nd = 2, sg) => { const x = numv(v); if (x == null) return '—'; if (sg) return signed(x, nd); const r = rz(x, nd); return (r < 0 ? MINUS : '') + nf(nd).format(Math.abs(r)); },
  R: (v, nd = 2) => { const x = numv(v); return x == null ? '—' : signed(x, nd) + NB + 'R'; },
  Rn: (v, nd = 2) => { const x = numv(v); return x == null ? '—' : signed(x, nd); },
  pct: (v, nd = 2) => { const x = numv(v); return x == null ? '—' : signed(x, nd) + '%'; },
  pctu: (v, nd = 1) => { const x = numv(v); return x == null ? '—' : nf(nd).format(Math.abs(rz(x, nd))) + '%'; },
  int: v => { const x = numv(v); return x == null ? '—' : (Math.round(x) < 0 ? MINUS : '') + nf(0).format(Math.abs(Math.round(x))); },
  x: (v, nd = 2) => { const x = numv(v); return x == null ? '—' : nf(nd).format(Math.abs(rz(x, nd))) + '×'; },
  lev: v => { const x = numv(v); return x == null ? '—' : nf(x % 1 ? 1 : 0).format(x) + '×'; },
  fund: v => { const x = numv(v); return x == null ? '—' : (Math.round(x) < 0 ? MINUS : '') + nf(0).format(Math.abs(Math.round(x))) + '%/yr'; },
  px: v => { const x = numv(v); return x == null ? '—' : (x < 0 ? MINUS : '') + nf(5, true).format(Math.abs(x)); },
  cls: (v, nd = 2) => { const x = numv(v); if (x == null) return ''; const r = rz(x, nd); return r > 0 ? 'pos' : r < 0 ? 'neg' : ''; },
  time: t => t == null ? '—' : clockText(t * 1000),
  wd: t => t == null ? '—' : df('wd', { weekday: 'short' }).format(new Date(t * 1000)).replace(/\.$/, ''),
  md: t => t == null ? '—' : df('md', { month: 'short', day: 'numeric' }).format(new Date(t * 1000)),
  day: t => t == null ? '—' : fmt.wd(t) + ' ' + fmt.md(t),
  stamp: t => t == null ? '—' : fmt.day(t) + ', ' + fmt.time(t),
  dayLong: t => t == null ? '—' : df('dl', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(t * 1000)),
  when: t => {
    if (t == null) return '—';
    const dd = ymd(nowMs()) - ymd(t * 1000);
    return dd === 0 ? fmt.time(t) : Math.abs(dd) <= 6 ? fmt.wd(t) + ' ' + fmt.time(t) : fmt.md(t);
  },
  hr: t => {
    if (t == null) return '—';
    const ps = df('h', { hour: 'numeric' }).formatToParts(new Date(t * 1000));
    const h = (ps.find(p => p.type === 'hour') || {}).value || '', dp = (ps.find(p => p.type === 'dayPeriod') || {}).value;
    return dp ? String(Number(h)) + dp.replace(/\./g, '').charAt(0).toLowerCase() : h.padStart(2, '0');
  },
  utc: t => { if (t == null) return '—'; const d = new Date(t * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC'; },
  ago: t => {
    if (t == null) return '—';
    const s = nowS() - t;
    if (s < -60) return fmt.rel(t);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 48 * 3600) return Math.floor(s / 3600) + ' h ago';
    return fmt.when(t);
  },
  rel: t => { if (t == null) return '—'; const s = t - nowS(); return s >= 60 ? 'in ' + fmt.dur(s) : s > -90 ? 'now' : fmt.ago(t); },
  age: sec => {
    const s = Math.max(0, Math.floor(numv(sec) || 0));
    if (s < 60) return '<1m';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 4 * 3600) { const m = Math.floor(s / 60) % 60; return Math.floor(s / 3600) + 'h' + (m ? ' ' + m + 'm' : ''); }
    if (s < 48 * 3600) return Math.floor(s / 3600) + NB + 'h';
    return Math.floor(s / 86400) + NB + 'd';
  },
  dur: sec => {
    const s = Math.max(0, Math.round(numv(sec) || 0));
    if (s < 60) return s + NB + 's';
    if (s < 3600) return Math.round(s / 60) + NB + 'min';
    if (s < 48 * 3600) { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h + NB + 'h' + (m ? ' ' + m + NB + 'm' : ''); }
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24; return d + NB + 'd' + (h ? ' ' + h + NB + 'h' : '');
  },
  cd: sec => {
    const s = Math.max(0, Math.floor(numv(sec) || 0)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  },
  over: sec => { const s = Math.max(0, Math.floor(numv(sec) || 0)); return '+' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); },
};

// ==================================================================================== missing data ==
const MISSING = 'not in this data';
function na(short) { return short ? '<span class="na" title="' + MISSING + '">—</span>' : '— <span class="na">' + MISSING + '</span>'; }
function val(v, f, short) { return v == null || (typeof v === 'number' && !isFinite(v)) ? na(short) : f ? f(v) : esc(v); }
function broken(name) { return '<div class="card"><div class="empty">' + (name ? '<b>' + esc(name) + '</b> · ' : '') + 'This panel couldn’t be drawn from this data.</div></div>'; }
function safe(fn, name, host) {
  try { const out = fn(); return out == null ? '' : out; }
  catch (e) { report(e, name); const h = broken(name); if (host) host.innerHTML = h; return h; }
}

// ================================================================================== vocabulary (§12) ==
const STAGE = {
  h: { w: 'Held', short: 'held', gate: 0, role: 'good outline', tape: 'good outline', grp: 'held' },
  x: { w: 'Not listed / no market data', short: 'no market data', gate: 1, role: 'bad-soft', tape: 'hatched', grp: 'nodata' },
  '!': { w: 'Error reading', short: 'error reading', gate: 1, role: 'bad', tape: 'bad', grp: 'nodata' },
  w: { w: 'Weekly not bullish', short: 'weekly', gate: 2, role: 'muted', tape: 'dark glass-3', grp: 'notset' },
  d: { w: 'Daily not bullish', short: 'daily', gate: 3, role: 'muted', tape: 'dark glass-3', grp: 'notset' },
  n: { w: '4-hour not ready', short: 'not ready', gate: 4, role: 'muted', tape: 'muted', grp: 'nodata' },
  a: { w: 'One flip away', short: 'one flip away', gate: 4, role: 'accent tint', tape: 'accent tint', grp: 'next' },
  t: { w: 'One flip away, too thin', short: 'too thin', gate: 4, role: 'warn outline', tape: 'warn tint', grp: 'thin' },
  u: { w: 'Already running', short: 'running', gate: 4, role: 'good-soft', tape: 'good-soft', grp: 'run' },
  g: { w: 'Signal, close not above the line', short: 'close not above the line', gate: 4, role: 'muted', tape: 'muted', grp: null },
  m: { w: 'Signal, outcome not logged', short: 'outcome not logged', gate: 4, role: 'dashed muted', tape: 'dashed', grp: null, note: 'unknown until the engine update' },
  r: { w: 'Blocked by a check', short: 'blocked', gate: 5, role: 'warn', tape: 'warn', grp: null },
  p: { w: 'Watch-only, recorded', short: 'watch-only', gate: 6, role: 'ink-2 ring', tape: 'ink-2 ring', grp: null },
  P: { w: 'Proposed (old model)', short: 'proposed (old model)', gate: 6, role: 'ink-2 ring', tape: 'ink-2', grp: null },
  e: { w: 'Order not filled', short: 'not filled', gate: 7, role: 'bad', tape: 'bad', grp: null },
  E: { w: 'Bought', short: 'bought', gate: 8, role: 'solid accent', tape: 'solid accent', grp: 'held' },
  '-': { w: 'Not recorded', short: 'not recorded', gate: null, role: 'hatched', tape: 'hatched', grp: null },
};
for (const k in STAGE) { STAGE[k].code = k; STAGE[k].cls = 'st-' + k; }
function stage(c) { return STAGE[c] || STAGE['-']; }
const GATES = [
  { g: 0, label: 'Exits checked first', codes: 'h' },
  { g: 1, label: 'In the books', codes: 'x!' },
  { g: 2, label: 'Weekly bullish', codes: 'w' },
  { g: 3, label: 'Daily bullish', codes: 'd' },
  { g: 4, label: '4-hour signal', codes: 'atungm' },
  { g: 5, label: 'Safety checks', codes: 'r' },
  { g: 6, label: 'Grade may trade', codes: 'pP' },
  { g: 7, label: 'Order filled', codes: 'e', live: true },
  { g: 8, label: 'Bought', codes: 'E' },
];
const GRP = { next: 'Could signal next', thin: 'Armed, too thin', run: 'Already running', notset: 'Not set up', held: 'Held', nodata: 'No data', error: 'No data' };
const CHECK_OF = {
  halt: 'not halted', thr: 'throttle allows entries', fresh: 'data fresh and run on time', recon: 'no reconciliation mismatch',
  sizing: 'sizing accepted', dup: 'no open position in this coin', maxpos: 'below max positions', equity: 'equity positive',
  cap: 'open-risk cap', gross: 'gross exposure cap', bookcap: 'book open-risk cap', sanity: 'price sanity band',
  vol: 'universe filters', oi: 'universe filters', fund: 'universe filters', days: 'universe filters', lev: 'universe filters',
  list: 'universe filters', uni: 'universe filters',
};

// ================================================================================ icons and chips ==
const I = d => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (d.charAt(0) === '<' ? d : '<path d="' + d + '"/>') + '</svg>';
const ICON = {
  x: I('M6 6l12 12M18 6L6 18'),
  warn: I('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'),
  bad: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  ok: I('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  left: I('M15 6l-6 6 6 6'), right: I('M9 6l6 6-6 6'),
  up: I('M7 17L17 7M9 7h8v8'), down: I('M7 7l10 10M17 9v8H9'),
  raise: I('<path d="M5 20h14"/><path d="M12 16V5M8 9l4-4 4 4"/>'),
  block: I('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'),
  rec: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pause: I('M9 5v14M15 5v14'), play: I('M7 5l12 7-12 7z'),
  flag: I('M5 21V4M5 4h11l-2 4 2 4H5'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  doc: I('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  swap: I('M4 8h14l-3-3M20 16H6l3 3'),
  refresh: I('M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6'),
};
function icon(n) { return ICON[n] || ICON.info; }
function chip(c, at) { return '<button type="button" class="tk" data-name="' + esc(c) + '"' + (at != null ? ' data-at="' + esc(at) + '"' : '') + '>' + esc(c) + '</button>'; }

// ====================================================================================== glossary ==
// One or two plain sentences each. Thresholds come from the bundle's cfg at render time, never from this file.
function cfgOf(b) { return ((b || S.b || {}).cfg) || {}; }
function q(v, unit, alt) { return v == null ? alt : v + (unit || ''); }
const GLOSS = {
  auto: { t: 'Auto grade', d: 'A 4-hour flip while the coin’s weekly and daily and Bitcoin’s weekly are all bullish. It is the only signal the bot buys on its own, and only after every safety check passes.' },
  watch: { t: 'Watch-only grade', d: 'Every other signal: a pullback into the band, or a flip while Bitcoin’s weekly is not bullish. It is recorded, never traded.' },
  signal: { t: 'Signal', d: 'A coin’s 4-hour Momentum Cloud flips bullish, or its price pulls back into the band, while its weekly and daily are bullish. A signal is not a buy: it still needs the auto grade and every safety check.' },
  flip: { t: '4-hour flip', d: 'A 4-hour close above the Momentum Cloud line, which turns the 4-hour trend bullish.' },
  pullback: { t: 'Pullback into the band', d: 'The price dips back into its band while the 4-hour trend is already bullish. Always watch-only.' },
  oneflip: { t: 'One flip away', d: 'Weekly and daily are bullish and the 4-hour is bearish, so one 4-hour close above the line would be a flip.' },
  thin: { t: 'Too thin', d: c => { const u = c.uni || {}; return 'One flip away, but the coin fails a market check today (volume under ' + q(u.vol_m, 'M a day', 'the minimum') + ', funding above ' + q(u.fund_pct, '%/yr', 'the limit') + ' or less than ' + q(u.days, ' days', 'the minimum') + ' of history), so a signal would be blocked. Market figures, not your money.'; } },
  cushion: { t: 'Cushion', d: 'How far the last 4-hour close sits above the Momentum Cloud line. The 4-hour stays bullish until a close falls below the line.' },
  needs: { t: 'Needs (an upper bound)', d: 'How far the next 4-hour close must rise to cross the line. While a 4-hour cloud is bearish its line can only step down, so this is the most it must rise. Not a prediction.' },
  openR: { t: 'Open R', d: 'What the position would bring if it were closed at the last mark, after costs, in units of its first risk.' },
  lockedR: { t: 'Locked R', d: 'What the position would still bring if its current stop were hit now, after costs. Positive once the stop is above entry.' },
  firstStop: { t: 'First stop', d: 'The stop set at entry. Hitting it loses 1 R, the planned risk of the trade.' },
  exposure: { t: 'Exposure', d: c => 'The position’s size as a share of the pot. With leverage it can pass 100% while only ' + q(c.risk_pct, '%', 'the per-trade risk') + ' of the pot was at risk at entry.' },
  riskInUse: { t: 'Risk in use', d: c => 'What every open position would lose at its current stop, as % of the pot. At most ' + q(c.open_cap_pct, '%', 'the open-risk cap') + ' at once and ' + q(c.risk_pct, '%', 'the per-trade risk') + ' per trade.' },
  drawdown: { t: 'Drawdown gauge', d: c => { const t = c.thr || []; return 'How far the pot is below its peak. At ' + q(t[0], '%', 'the first limit') + ' risk per trade halves; at ' + q(t[1], '%', 'the second') + ' the bot stops buying until reviewed.'; } },
  slot: { t: 'Slot', d: c => 'One of the ' + q(c.max_pos, '', 'few') + ' positions the bot may hold at once.' },
  gateRun: { t: 'Gate Run', d: 'A replay of one recorded check: every name moves down the engine’s gates in order and stops where the record says it stopped.' },
  heartbeat: { t: 'Heartbeat', d: 'One cell per 4-hour close for the last 7 days. Each cell is a recorded check: on time, late, failed or missed.' },
  late: { t: 'Late check', d: c => 'A check that started more than ' + q(c.late_min, ' minutes', 'the late limit') + ' after the 4-hour close. Its data is too old to buy on, so buys are skipped for that bar; exits still run.' },
  vsHolding: { t: 'vs holding', d: 'A trade’s R minus what simply holding the book’s benchmark over the same hours would have made, in the same R. Positive means the trade beat holding.' },
  pf: { t: 'Profit factor', d: 'Total R won divided by total R lost. Above 1 the wins outweigh the losses; with no losing trade yet it has no value.' },
  goLive: { t: 'Go-live gates', d: c => { const g = c.gates || {}; return 'What the paper record must show before real money: ' + q(g.n, ' closed trades', 'enough closed trades') + ', ' + (g.avg_R != null ? 'an average above +' + g.avg_R + ' R' : 'a positive average R') + ', a worst drawdown under ' + q(g.dd_pct, '%', 'the limit') + ', and costs of at most ' + q(g.cost_R, ' R', 'the cost limit') + ' per trade.'; } },
  paper: { t: 'Paper', d: 'The bot runs every rule on real market data, but no order reaches the exchange. Fills and costs are simulated.' },
  R: { t: 'R', d: c => 'One unit of planned risk: what a trade loses if its first stop is hit, ' + q(c.risk_pct, '% of the pot', 'a fixed share of the pot') + '. Results are counted in R so they compare across coins.' },
  stop: { t: 'Stop', d: 'The price that closes the position. It follows the 4-hour line up, never down.' },
  book: { t: 'Book', d: 'A group of coins judged against one benchmark, with its own share of the pot and its own risk cap.' },
  checks: { t: 'Safety checks', d: c => 'The checks every signal must pass before a buy' + (Array.isArray(c.checks) && c.checks.length ? ', in order: ' + c.checks.join(', ') + '.' : '.') },
  line: { t: 'Momentum Cloud line', d: 'The 4-hour trend line. A close above it turns the 4-hour bullish; a close below it turns it bearish.' },
  due: { t: 'Due', d: 'The check for the last 4-hour close should land about now. It is not late until the limit passes.' },
  stale: { t: 'Stale', d: 'No check for 4 hours or more: a whole bar was missed. The runner may be down.' },
};
function gloss(k) {
  const g = GLOSS[k]; if (!g) return null;
  let d = ''; try { d = typeof g.d === 'function' ? g.d(cfgOf()) : g.d; } catch (e) { report(e, 'gloss ' + k); }
  return { t: g.t, d };
}
function tip(k) { const g = GLOSS[k]; return '<button class="tip" type="button" data-g="' + esc(k) + '" aria-label="What is ' + esc(g ? g.t : k) + '?">?</button>'; }

// ========================================================================================== words ==
const KIND = { flip: ['flip', '4-hour flip'], pullback: ['pullback', 'pullback into the band'] };
const EXIT = { stop: 'stop hit', h4: '4-hour turn', d: 'daily turn', w: 'weekly turn', flatten: 'manual flatten', nostop: 'no stop possible', exch: 'exchange stop', other: 'exit' };
const OUTCOME = { blocked: 'Blocked by a check', recorded: 'Recorded, not traded', expired: 'Expired (old approval model)', notfilled: 'Order not filled', bought: 'Bought' };
const EV_IC = { bought: 'up', sold: 'down', trail: 'raise', blocked: 'block', recorded: 'rec', proposed: 'rec', expired: 'clock', notfilled: 'x',
  late: 'clock', failed: 'bad', halt: 'pause', resume: 'play', thr_halt: 'pause', thr_half: 'warn', recon: 'bad', no_stop: 'bad', close_failed: 'bad',
  exit_failed: 'bad', fallback: 'warn', regime: 'flag', gap: 'warn', entry_failed: 'warn', not_on_exchange: 'warn', sweep: 'swap', review: 'doc', board: 'eye' };
const DIRW = { B: 'bullish', b: 'bearish', n: 'no reading', 1: 'bullish', 0: 'bearish' };
const word = {
  kind: (k, long) => KIND[k] ? KIND[k][long ? 1 : 0] : (k ? String(k) : 'signal'),
  tier: t => t === 'A' ? 'Auto grade' : t === 'B' ? 'Watch-only grade' : 'grade not recorded',
  dir: v => v === 1 || v === true ? 'bullish' : v === 0 || v === false ? 'bearish' : 'no reading',
  range: rg => ({ O: 'above its band', I: 'in its band', S: 'below its band' })[rg] || 'no reading',
  dist: (d, held) => {
    const x = numv(d); if (x == null) return '—';
    if (held) return 'stop ' + (x >= 0 && x < 0.05 ? 'less than 0.1%' : fmt.pctu(x, 1)) + ' below';     // never a false "0.0%"
    return rz(x, 1) > 0 ? 'needs +' + fmt.pctu(x, 1) : rz(x, 1) < 0 ? 'cushion ' + fmt.pctu(x, 1) : 'at the line';
  },
  reason: (code, v, long) => {
    const u = cfgOf().uni || {}, x = numv(v), has = x != null;
    switch (code) {
      case 'vol': return has ? 'volume ' + fmt.x(x) + (long ? ' the minimum' : '') : 'no volume reading';
      case 'oi': return has ? 'open interest ' + fmt.x(x) + (long ? ' the minimum' : '') : 'no open-interest reading';
      case 'fund': return has ? 'funding ' + fmt.fund(x) + (long && u.fund_pct != null ? ' (limit ' + u.fund_pct + ')' : '') : 'funding unreadable';
      case 'days': return has ? (long ? 'only ' : '') + fmt.int(x) + ' days of history' + (long && u.days != null ? ' (needs ' + u.days + ')' : '') : 'history unknown';
      case 'lev': return has ? 'max leverage ' + fmt.lev(x) + (long && u.lev != null ? ' (needs ' + u.lev + '×)' : '') : 'max leverage unreadable';
      case 'list': return 'not listed';
      case 'uni': return 'universe filters';
      case 'halt': return 'halted';
      case 'thr': return 'throttle' + (has ? ' (drawdown ' + fmt.pctu(x, 1) + ')' : '');
      case 'fresh': return 'data too late' + (has ? ' (' + fmt.int(x) + ' min after the close)' : '');
      case 'recon': return 'reconciliation mismatch';
      case 'sizing': return 'sizing not accepted';
      case 'dup': return 'already held';
      case 'maxpos': return 'max positions' + (has ? ' (' + fmt.int(x) + ' open)' : '');
      case 'equity': return 'equity check';
      case 'cap': return 'open-risk cap' + (has ? ' (' + fmt.pctu(x, 2) + ' after entry)' : '');
      case 'bookcap': return 'book risk cap' + (has ? ' (' + fmt.pctu(x, 2) + ' after entry)' : '');
      case 'gross': return 'gross exposure cap' + (has ? ' (' + fmt.x(x) + ' after entry)' : '');
      case 'sanity': return 'price sanity band' + (has ? ' (' + fmt.pctu(x, 1) + ' off)' : '');
      case 'tier': return 'watch-only grade';
      case 'expired': return 'proposal expired';
      case 'fill': return 'order not filled';
      case 'recheck': return 're-check failed';
      case 'drift': return 'price ran' + (has ? ' ' + fmt.pctu(x, 1) : '') + ' above the signal';
      default: return 'a safety check';
    }
  },
  reasons: (list, long) => (Array.isArray(list) ? list : []).map(p => Array.isArray(p) ? word.reason(p[0], p[1], long) : word.reason(p, null, long)).join(' · '),
  codes: det => String(det || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^(\S+)(?:\s+(\S+))?$/); return m ? [m[1], m[2] != null ? numv(m[2]) : null] : [s, null]; }),
  exit: r => EXIT[r] || 'exit',
  outcome: o => OUTCOME[o] || (o ? String(o) : '—'),
  stage: c => stage(c).w,
  lag: (min, ok) => (ok === false || ok === 0 ? 'ran late' : 'on time') + (min != null ? ' (' + min + ' min after the close)' : ''),
  run: r => {
    if (!r) return { k: 'none', w: 'no check', s: 'no check' };
    if (r.x) return { k: 'failed', w: 'failed', s: 'stopped early' };
    if (!r.ok) return { k: 'late', w: 'ran late', s: 'ran late (' + r.lm + ' min after the close), buys skipped' };
    const s = 'on time (' + r.lm + ' min after the close)';
    return r.h ? { k: 'halted', w: 'halted', s: 'halted · ' + s } : { k: 'ok', w: 'on time', s };
  },
  list: a => (a || []).join(', '),
  plural: (n, one, many) => fmt.int(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's')),
  punct: b => {
    const k = clockOf(b); if (!k) return '';
    const lim = limOf(b), m = modeOf(b).eff === 'live' ? 'l' : 'p';
    const known = !!b && Array.isArray(b.runs);
    const late = runsOf(b).filter(r => !r.x && r.ok === 0 && (!r.m || r.m === m) && r.lm != null).map(r => r.lm);
    let s = k.lag_n >= 3 && Array.isArray(k.lag_rng) ? 'Usually ' + Math.round(k.lag_med_min) + ' min after the close (' + k.lag_rng[0] + '–' + k.lag_rng[1] + ')' : 'Too few on-time checks yet to measure the usual start';
    s += ' · limit ' + lim + ' · ' + (!known ? 'late runs not in this data' : late.length ? word.plural(late.length, 'late run') + ' in 7 days (' + late.join(', ') + ' min)' : 'no late runs in 7 days');
    return s + '.';
  },
  alert: a => {
    if (!a) return '';
    let h = esc(a.text || '').replace('{time}', esc(fmt.when(a.t)));
    if (a.c && String(a.text || '').indexOf(a.c + ':') === 0) h = chip(a.c, a.t) + h.slice(esc(a.c).length);
    return h;
  },
  event: e => {
    if (!Array.isArray(e)) return { html: '', ic: 'info', lv: 0 };
    const [t, ty, c, kind, tier, lv, det, R, rel] = e;
    const C = c ? chip(c, t) : '', k = word.kind(kind), D = det == null ? '' : esc(det);
    const Rs = v => '<span class="' + fmt.cls(v) + '">' + fmt.R(v) + '</span>';
    const dirs = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
      if (x === 'a in') return 'now one flip away';
      if (x === 'a out') return 'no longer one flip away';
      const m = x.match(/^(w|d|h4) (\S+)>(\S+)$/); if (!m) return esc(x);
      return ({ w: 'weekly', d: 'daily', h4: '4-hour' })[m[1]] + (m[3] === 'n' ? ' lost its reading' : ' turned ' + (DIRW[m[3]] || esc(m[3])));
    }).join(', ');
    let s;
    switch (ty) {
      case 'bought': { const sp = (String(det || '').match(/stop ([\d.]+)/) || [])[1]; s = 'Bought ' + C + (kind ? ' on a ' + word.kind(kind, true) : '') + (tier ? ' (' + word.tier(tier).toLowerCase() + ')' : '') + (sp ? ', stop ' + fmt.pctu(sp, 1) + ' below' : ''); break; }
      case 'sold': s = 'Sold ' + C + ' ' + Rs(R) + ' (' + word.exit(det) + ')' + (rel != null ? ' · ' + Rs(rel) + ' vs holding' : ''); break;
      case 'trail': s = C + ' stop raised' + (R != null ? (rz(R, 2) < 0 ? ', still risks ' : ', locks ') + Rs(R) : ''); break;
      case 'blocked': {
        const rs = esc(word.reasons(word.codes(det), true)) || 'a safety check';
        s = tier === 'A' ? C + ' would have bought (auto grade), blocked: ' + rs : C + ' ' + k + (tier === 'B' ? ' (watch-only)' : '') + ' blocked: ' + rs; break;
      }
      case 'recorded': s = C + ' ' + k + ' recorded, ' + (tier === 'A' ? 'auto grade' : 'watch-only grade'); break;
      case 'proposed': s = C + ' ' + k + ' proposed (old approval model)'; break;
      case 'expired': s = C + ' ' + k + ' proposal expired (old approval model)'; break;
      case 'notfilled': s = C + ' order not filled'; break;
      case 'late': s = 'The check started ' + (D || 'too long') + ' min after the close; buys skipped'; break;
      case 'failed': s = 'The check stopped early' + (D ? ' (' + D + ')' : '') + '. Exits may not have been checked'; break;
      case 'halt': s = 'Halted' + (D ? ': ' + D : '') + '. No new buys; exits still run'; break;
      case 'resume': s = 'Resumed: buying is allowed again'; break;
      case 'thr_halt': s = 'Drawdown ' + (D ? D + '% ' : '') + 'reached the limit: buying stopped until reviewed'; break;
      case 'thr_half': s = 'Drawdown ' + (D ? D + '%' : '') + ': risk per trade halved'; break;
      case 'recon': s = 'Exchange and ledger disagree; entries paused'; break;
      case 'no_stop': s = C + ': the resident stop could not be placed'; break;
      case 'close_failed': s = C + ': the close was not filled; kept for the next check'; break;
      case 'exit_failed': s = det === 'nomark' ? C + ': an exit signal came without a mark price; kept for the next check' : C + ': the exit check failed' + (D ? ' (' + D + ')' : '') + '; kept'; break;
      case 'fallback': s = 'Live requested, running paper: ' + (det === 'sdk' ? 'exchange SDK not installed' : det === 'key' ? 'exchange key or account address missing' : 'live requirements missing'); break;
      case 'regime': {
        const [a, z] = String(det || '').split('>'), parts = [];
        if (a && z) { if (a[0] !== z[0]) parts.push('weekly turned ' + (DIRW[z[0]] || '?')); if (a[1] !== z[1]) parts.push('daily turned ' + (DIRW[z[1]] || '?')); }
        s = 'Bitcoin’s ' + (parts.join(' and ') || 'regime changed'); break;
      }
      case 'gap': s = C + ': no reading on one timeframe; position and stop kept'; break;
      case 'entry_failed': s = det === 'candles' ? C + ': candles unavailable; skipped this check' : C + ': the entry check failed' + (D ? ' (' + D + ')' : '') + '; skipped this check'; break;
      case 'not_on_exchange': s = C + ': not on the exchange and no sell fill'; break;
      case 'sweep': { const m = String(det || '').match(/^(\S+) ([\d.]+)$/); s = C + ' gain earmarked for ' + (m ? esc(m[1]) + ' (' + fmt.pctu(m[2], 2) + ' of pot)' : 'its benchmark') + ' · recorded, not executed'; break; }
      case 'review': s = 'Sunday review written'; break;
      case 'board': s = C + ': ' + (dirs(det) || 'reading changed'); break;
      default: s = (C ? C + ' ' : '') + esc(ty || 'event');
    }
    return { html: s, ic: EV_IC[ty] || 'info', lv: numv(lv) || 0, t, type: ty, c };
  },
};

// ======================================================================================== registries ==
const VIEWS = {};
const COMP = {};
const SHEETS = {};
const HOOKS = { arrival: [], tick1s: [], tick30s: [], route: [], theme: [], hide: [], show: [], status: [] };
function hooksOf(name) { const h = HOOKS[name]; return h == null ? [] : Array.isArray(h) ? h : [h]; }
function hook(name, fn) { HOOKS[name] = hooksOf(name); HOOKS[name].push(fn); }
function runHooks(name, ...a) { hooksOf(name).forEach(fn => call(fn, ...a)); }

// ============================================================================================ state ==
const TABS = ['now', 'activity', 'positions', 'results', 'rules'];
const TITLE = { now: 'Now', activity: 'Activity', positions: 'Positions', results: 'Results', rules: 'Rules' };
const S = { b: null, ledger: null, ledgerGen: null, ledgerErr: null, cursor: null, tab: 'now', sub: null, prev: null,
            st: null, net: 'checking', seenAt: 0, seenEv: 0, sheet: null, bootErr: null, booting: false };
function runsOf(b) { b = b || S.b; return b && Array.isArray(b.runs) ? b.runs : []; }
function modeOf(b) {
  const m = b && b.mode;
  if (m && typeof m === 'object') return { eff: m.eff || null, req: m.req || m.eff || null, note: m.note || '' };
  return { eff: m || null, req: (b && b.settings && b.settings.mode) || m || null, note: '' };    // v1: a plain string
}
function lastRun(b) {
  const rs = runsOf(b), m = modeOf(b || S.b).eff === 'live' ? 'l' : 'p';
  for (let i = rs.length - 1; i >= 0; i--) if (!rs[i].m || rs[i].m === m) return rs[i];
  return rs[rs.length - 1] || null;
}
function runAt(t, b) { const n = Number(t); return t == null || t === '' || !isFinite(n) ? null : runsOf(b).find(r => r.t === n) || null; }
function cursorRun() { return (S.cursor != null && runAt(S.cursor)) || lastRun(); }
function nameOf(c) { return ((S.b && S.b.names) || []).find(n => n.c === c) || null; }
const CURSOR = [];
function onCursor(fn) { CURSOR.push(fn); }
// Shared cycle cursor (§5), null = the latest run. With the cycle sheet open, moving the cursor redraws that sheet;
// off the Now tab it opens it; on Now the followers replay, and {scroll:true} brings the Gate Run into view.
function setCursor(t, opts) {
  opts = opts || {};
  let v = t == null || t === '' ? null : Number(t);
  if (v != null && !isFinite(v)) v = null;
  const last = lastRun();
  if (v != null && last && v === last.t) v = null;
  const prev = S.cursor; S.cursor = v;
  CURSOR.forEach(fn => call(fn, v, prev, opts));
  if (opts.sheet === false) return;
  const tt = v != null ? v : last && last.t;
  if (S.sheet && S.sheet.kind === 'cycle' && tt != null) return openSheet(sheetContent('cycle', tt), { kind: 'cycle', arg: tt, replace: true });
  if (S.tab !== 'now') { if (tt != null) showSheet('cycle', tt); return; }
  if (opts.scroll) into(document.getElementById('now-gaterun'), true);
}

// ======================================================================== the status engine (§3) ==
// A v2 bundle carries clock and state. A v1 bundle is read into the same shape, so the capsule stays truthful.
function clockOf(b) {
  if (!b) return null;
  if (b.clock && b.clock.last_t != null) return b.clock;
  const t = b.last_run && isoS(b.last_run.t);
  if (t == null) return b.clock || null;
  return { last_t: t, last_slot: Math.floor(t / BAR) * BAR, late_min: null, lag_med_min: 20, lag_rng: null, lag_n: 0, limit_min: null, sched_min: 5 };
}
function stateOf(b) {
  if (b && b.state) return b.state;
  const lr = (b && b.last_run) || {}, th = lr.throttle;
  return { halt: { set: !!lr.halt, reason: null, since: null },
           thr: th ? { state: th.halt ? 'halted' : th.multiplier < 1 ? 'halved' : 'normal', mult: th.multiplier, dd_pct: th.drawdown_pct } : { state: 'unknown', mult: null, dd_pct: null },
           btc: {}, last: { t: isoS(lr.t), fresh: lr.fresh, failed: lr.failed, late_min: null, abort: null } };
}
function limOf(b) { return (b && b.cfg && b.cfg.late_min) || (b && b.clock && b.clock.limit_min) || (b && b.settings && b.settings.data && b.settings.data.late_run_minutes) || 45; }
function thrOf(b) { const t = b && b.cfg && b.cfg.thr; if (Array.isArray(t)) return t; const s = b && b.settings && b.settings.throttle; return s ? [s.halve_at_drawdown_pct, s.halt_at_drawdown_pct] : [null, null]; }
function nOpen(b) {
  if (b && b.risk && b.risk.n_open != null) return b.risk.n_open;
  if (b && Array.isArray(b.pos)) return b.pos.length;
  if (b && b.positions && typeof b.positions === 'object') return Object.keys(b.positions).length;
  return 0;
}
// clock(b, now): §3.1. C is the next 4-hour close the engine owes a check for; every time is recomputed from now.
function clock(b, now) {
  b = b === undefined ? S.b : b; now = now == null ? nowS() : now;
  const k = clockOf(b), lim = limOf(b);
  if (!k || k.last_slot == null || k.last_t == null) return { phase: 'none', now, lim, lag: 20, C: null, next: null, nOpen: nOpen(b), exits: false };
  const lag = (k.lag_n != null && k.lag_n < 3) ? 20 : (numv(k.lag_med_min) ?? 20);
  const C = k.last_slot + BAR, next = Math.round(C + lag * 60), lateAt = C + lim * 60, staleAt = C + BAR, exitsAt = C + 7200;
  const phase = now < next ? 'countdown' : now < lateAt ? 'due' : now < staleAt ? 'late' : 'stale';
  const n = nOpen(b);
  return { phase, now, C, lag, lim, next, lateAt, staleAt, exitsAt, sched: C + (numv(k.sched_min) ?? 5) * 60, lastT: k.last_t, lastSlot: k.last_slot,
           age: now - k.last_t, over: now - C, toNext: next - now, rng: Array.isArray(k.lag_rng) ? k.lag_rng : null, lagN: k.lag_n ?? null,
           nOpen: n, exits: phase === 'late' && now >= exitsAt && n > 0 };
}
const DOT = { ok: 'ok', info: 'due', warn: 'gap', bad: 'bad' };
const LVCLS = { ok: '', info: '', warn: 'warn', bad: 'bad' };
const COVERED = new Set(['failed', 'halt', 'thr_halt', 'thr_half', 'fallback', 'late']);     // alerts the state already speaks for
// status(b, now): one truth for the capsule, rail mirror, verdict, alert rail and dial centre. The first item marked
// head sets the headline (§3.2 precedence); every item goes to the alert rail and the Health sheet.
function status(b, now) {
  b = b === undefined ? S.b : b;
  const K = clock(b, now);
  if (!b) return { lvl: 'info', dot: 'mute', word: 'Checking…', age: '', wide: '', sentence: 'Checking…', k: 'none', items: [], K };
  const st = stateOf(b), last = st.last || {}, halt = st.halt || {}, thr = st.thr || {}, m = modeOf(b), T = t => esc(fmt.when(t));
  const ageLast = K.lastT != null ? fmt.age(K.age) : '', items = [];
  const RUNBOOK = { label: 'Runbook', href: '#rules/operations' };
  const add = (lvl, k, wd, sentence, o) => items.push(Object.assign({ lvl, k, word: wd, sentence, act: null, age: ageLast, wide: '', head: true }, o));
  const dd = thr.dd_pct != null ? fmt.pctu(thr.dd_pct, 1) : null, lims = thrOf(b);
  if (last.failed) add('bad', 'failed', 'Failed', '<b>Needs you</b> · the ' + T(last.t) + ' check stopped early' + (last.abort ? ' (' + esc(last.abort) + ')' : '') + '. Exits may not have been checked.',
    { act: { label: 'See check', cycle: last.t }, wide: '· the ' + fmt.when(last.t) + ' check stopped early' });
  if (halt.set) add('bad', 'halt', 'Halted', '<b>Halted</b> since ' + (halt.since ? T(halt.since) : 'unknown') + ': ' + esc(halt.reason || 'manual halt') + '. No new buys; exits still run.',
    { act: RUNBOOK, wide: '· no new buys' });
  if (thr.state === 'halted') add('bad', 'thr_halt', 'Buying stopped', '<b>Buying stopped</b> · drawdown ' + (dd || '—') + ' reached the ' + (lims[1] != null ? esc(lims[1]) + '% ' : '') + 'limit.',
    { act: { label: 'Positions', href: '#positions' }, wide: dd ? '· drawdown ' + dd : '' });
  if (K.phase === 'stale') add('bad', 'stale', 'Stale', '<b>Stale</b> · no check for ' + esc(fmt.age(K.age)) + '. The runner may be down.', { act: RUNBOOK, wide: '· the runner may be down' });
  if (K.exits) add('bad', 'exits', 'Exits unchecked', '<b>Needs you</b> · exits not checked since ' + T(K.lastT) + '.',
    { act: { label: 'See positions', href: '#positions' }, age: fmt.age(K.over), wide: '· since ' + fmt.when(K.lastT) });
  const alerts = Array.isArray(b.alerts) ? b.alerts.filter(a => a && typeof a === 'object') : [];
  const actOf = a => a.c && /^(gap|close_failed|exit_failed)$/.test(a.k) ? { label: 'See position', href: '#positions' } : a.k === 'entry_failed' ? { label: 'See check', cycle: a.t != null ? a.t : last.t } : RUNBOOK;
  for (const a of alerts) if (a.lv === 'bad' && !COVERED.has(a.k)) add('bad', a.k, 'Needs you', word.alert(a), { act: actOf(a), wide: '· see the alert' });
  if (K.phase === 'late' && !K.exits) add('warn', 'late_now', 'Late', '<b>Late</b> · no check yet for the ' + T(K.C) + ' close. After ' + T(K.lateAt) + ' it skips buys.',
    { act: RUNBOOK, age: fmt.age(K.over), wide: '· no check for the ' + fmt.time(K.C) + ' close' });
  if (m.req && m.eff && m.req !== m.eff) add('warn', 'fallback', 'Paper fallback', '<b>Live requested, running paper</b>: ' + esc(m.note || 'live requirements missing') + '.', { act: RUNBOOK, wide: '· live requested' });
  if (last.fresh === false && !last.failed) {
    const lm = last.late_min != null ? last.late_min : (lastRun(b) || {}).lm;
    add('warn', 'late', 'Ran late', '<b>Ran late</b> · the last check started ' + (lm != null ? esc(lm) + ' min' : 'too long') + ' after the close, so buys were skipped for that bar.',
      { act: { label: 'See check', cycle: last.t }, wide: lm != null ? '· ' + lm + ' min after the close' : '' });
  }
  if (thr.state === 'halved') add('warn', 'thr_half', 'Risk halved', '<b>Risk halved</b> · drawdown ' + (dd || '—') + ' (halves at ' + esc(lims[0] ?? '—') + '%, stops at ' + esc(lims[1] ?? '—') + '%).',
    { act: { label: 'Positions', href: '#positions' }, wide: dd ? '· drawdown ' + dd : '' });
  for (const a of alerts) if (a.lv === 'warn' && !COVERED.has(a.k)) add('warn', a.k, 'Check', word.alert(a), { act: actOf(a) });
  if (K.phase === 'due') add('info', 'due', 'Due now', '<b>Due now</b> · checks usually land ' + (K.rng ? esc(K.rng[0]) + '–' + esc(K.rng[1]) : 'about ' + Math.round(K.lag)) + ' min after the close.',
    { age: '', wide: '· usually by ' + fmt.time(K.C + (K.rng ? K.rng[1] : K.lag) * 60) });
  for (const a of alerts) if (a.lv === 'info' && !COVERED.has(a.k))
    add('info', a.k, 'Note', word.alert(a), { head: false, act: a.k === 'proposals' ? { label: 'See them', href: '#positions' } : null });
  let head = items.find(i => i.head);
  if (!head) head = K.phase === 'none'
    ? { lvl: 'info', k: 'none', word: 'No checks yet', age: '', wide: '', sentence: '<b>No checks yet</b> · the first check after deployment writes here.' }
    : { lvl: 'ok', k: 'ok', word: 'On schedule', age: ageLast, wide: K.next ? '· next check ≈ ' + fmt.when(K.next) : '', sentence: '<b>All clear</b> · nothing needs you.' };
  const gen = isoS(b.gen || b.generated);
  const trail = gen != null && K.lastT != null && gen - K.lastT > 600 ? ' · pushed ' + fmt.when(gen) : '';
  return { lvl: head.lvl, dot: DOT[head.lvl], word: head.word, age: head.age, wide: (head.wide || '') + trail, sentence: head.sentence, k: head.k, items, K, head };
}

// ================================================================================= fetch + ledger ==
async function getJSON(url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const tm = ctl ? setTimeout(() => ctl.abort(), ms || 10000) : 0;
  let r;
  try { r = await fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } }); }
  catch (e) { clearTimeout(tm); throw { kind: 'net', err: e }; }
  if (r.status === 401 || (r.redirected && /\/login\b/.test(r.url))) { clearTimeout(tm); throw { kind: 'auth', status: r.status }; }
  if (r.status === 404) { clearTimeout(tm); throw { kind: 'missing', status: 404 }; }
  if (!r.ok) { clearTimeout(tm); throw { kind: 'server', status: r.status }; }
  let txt;
  try { txt = await r.text(); } catch (e) { throw { kind: 'net', err: e }; } finally { clearTimeout(tm); }
  try { return JSON.parse(txt); } catch (e) { throw { kind: 'parse' }; }
}
let ledgerP = null;
function loadLedger(force) {
  const gen = S.b && S.b.gen;
  if (!force && S.ledgerGen != null && S.ledgerGen === gen) return Promise.resolve(S.ledger);
  if (ledgerP && ledgerP.gen === gen && !force) return ledgerP;
  // A v1 bundle predates exec:ledger: say so without a request that can only 404.
  if (S.b && S.b.v == null) { S.ledger = null; S.ledgerGen = gen; S.ledgerErr = 'missing'; return Promise.resolve(null); }
  const p = getJSON('/api/ledger', 15000).then(L => {
    if (!L || typeof L !== 'object') throw { kind: 'parse' };
    S.ledger = L; S.ledgerGen = gen; S.ledgerErr = null; return L;
  }).catch(e => {
    S.ledgerErr = (e && e.kind) || 'net';
    if (S.ledgerErr === 'missing') { S.ledger = null; S.ledgerGen = gen; }
    if (S.ledgerErr === 'auth') { S.net = 'signedout'; paintCapsule(); }
    return S.ledgerGen === gen ? S.ledger : null;
  }).finally(() => { if (ledgerP === p) ledgerP = null; });
  p.gen = gen; ledgerP = p;
  return p;
}
const LWC_URL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
let lwcP = null;
function loadLWC() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (lwcP) return lwcP;
  lwcP = new Promise((res, rej) => {
    const s = document.createElement('script');
    let tm = 0;
    const fail = why => { clearTimeout(tm); lwcP = null; s.remove(); rej(new Error(why)); };
    tm = setTimeout(() => fail('the chart library timed out'), 15000);
    s.src = LWC_URL; s.async = true; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = () => { clearTimeout(tm); if (window.LightweightCharts) res(window.LightweightCharts); else fail('the chart library did not load'); };
    s.onerror = () => fail('the chart library did not load');
    document.head.appendChild(s);
  });
  return lwcP;
}

// ================================================================================ motion + controls ==
// Ported from ~/aifi/cloud/client.js: setSeg 311, initSegs 318, countUp 368 (with a `from`), stagger 376, movePill 379.
function countUp(el, to, opts) {
  if (!el) return;
  const o = Object.assign({ from: 0, decimals: 0, prefix: '', suffix: '', ms: 800, fmt: null }, opts || {});
  const out = v => { el.textContent = o.fmt ? o.fmt(v) : o.prefix + Number(v).toFixed(o.decimals) + o.suffix; };
  const tk = el._cu = (el._cu || 0) + 1;
  if (reduced || o.from === to || !isFinite(to) || !isFinite(o.from)) return out(to);
  const t0 = performance.now();
  const step = now => { if (el._cu !== tk) return; const k = Math.min(1, Math.max(0, (now - t0) / o.ms)), e = 1 - Math.pow(1 - k, 3); out(k < 1 ? o.from + (to - o.from) * e : to); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function stagger(root) { $$('.rise', root || document).forEach((el, i) => { el.style.animationDelay = Math.min(i * 60, 600) + 'ms'; }); }
function setSeg(seg, value) {
  if (!seg) return;
  const btns = $$('button', seg); let on = null;
  btns.forEach(b => { const hit = (b.dataset.tf ?? b.dataset.v) === value; b.setAttribute('aria-pressed', hit ? 'true' : 'false'); if (hit) on = b; });
  const ind = $('.ind', seg); if (!ind || !on) return;
  ind.style.width = on.offsetWidth + 'px'; ind.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  if (seg.scrollWidth > seg.clientWidth) { const left = Math.max(0, on.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2); try { seg.scrollTo({ left, behavior: 'instant' }); } catch (e) { seg.scrollLeft = left; } }
}
function initSegs(root) { $$('.seg', root || document).forEach(seg => { const on = $('button[aria-pressed=true]', seg); if (on) setSeg(seg, on.dataset.tf ?? on.dataset.v); }); }
function movePill() {
  const pill = $('.rail nav .pill'), on = $('.rail nav a[aria-current=page]'); if (!pill || !on) return;
  pill.style.transform = 'translateY(' + on.offsetTop + 'px)'; pill.style.height = on.offsetHeight + 'px'; pill.classList.add('on');
}
// Overflowing scrollers get an edge fade on each side that hides more (mask-r / mask-l), plus region semantics (§15).
const SCROLLERS = '.tbl,.cycbar,[data-mask]';
function maskOne(el) {
  const over = el.scrollWidth > el.clientWidth + 1;
  el.classList.toggle('mask-r', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  el.classList.toggle('mask-l', over && el.scrollLeft > 2);
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  if (!el.getAttribute('role')) el.setAttribute('role', 'region');
  if (!el.getAttribute('aria-label')) { const c = el.closest('.card,section,.sheet'), h = c && $('h2,h3', c); el.setAttribute('aria-label', h ? h.textContent.trim() : 'Scrollable list'); }
}
function masks(root) { $$(SCROLLERS, root || document).forEach(maskOne); }
// Markdown tables (the Rules docs, the Sunday review; md() in worker.js writes '<div class="tbl"><table>…') go
// inside a disclosure: closed under 900px, open from 900px (acceptance: tables only inside disclosures or at 900px
// or wider). The summary names the first columns and counts the rows. Input is md() output, already escaped.
function mdTables(html) {
  const wide = !!(window.matchMedia && matchMedia('(min-width: 900px)').matches);
  return String(html == null ? '' : html).replace(/<div class="tbl"><table>([\s\S]*?)<\/table><\/div>/g, (m, inner) => {
    const th = [];
    inner.replace(/<th\b[^>]*>([\s\S]*?)<\/th>/g, (x, c) => { const t = c.replace(/<[^>]*>/g, '').trim(); if (t) th.push(t); return x; });
    const n = ((inner.split('<tbody>')[1] || '').match(/<tr\b/g) || []).length;
    const cols = th.slice(0, 3).join(' · ') + (th.length > 3 ? ' …' : '');
    return '<details class="disc mdt"' + (wide ? ' open' : '') + '><summary><span class="mdt-s">Table' + (cols ? ': ' + cols : '') + '</span>'
      + '<span class="sub">' + n + (n === 1 ? ' row' : ' rows') + '</span></summary><div class="body">' + m + '</div></details>';
  });
}
const PLAYING = new Set();
function setPlay(key, on) { if (on) PLAYING.add(key); else PLAYING.delete(key); HTML.classList.toggle('play', PLAYING.size > 0); }
let toastT = 0;
function toast(html, opts) {
  const el = $('#toast'); if (!el) return;
  el.innerHTML = html; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), (opts && opts.ms) || 4000);
}

// ============================================================================================ tips ==
// Click or focus opens; Escape, an outside tap or a scroll closes; no hover (touch first). role=tooltip plus
// aria-describedby on the trigger; the "?" buttons read "What is <term>?" and have a 44px hit area (mission.js).
let tipbox = null, tipEl = null, tipAt = 0, tipQuiet = null;
function tipFocus(el) { if (!el || !el.isConnected) return; tipQuiet = el; try { el.focus({ preventScroll: true }); } catch (e) {} if (document.activeElement !== el) tipQuiet = null; }
const TIPSEL = '.tip,[data-tip],[data-g],[data-tip-cursor]';
function tipHtml(el) {
  if (typeof el._tip === 'function') return el._tip(el);
  if (typeof el._tip === 'string') return el._tip;
  let h = '';
  if (el.dataset.tip) h = esc(el.dataset.tip);
  else if (el.dataset.g) { const g = gloss(el.dataset.g); if (g) h = '<b>' + esc(g.t) + '</b> · ' + esc(g.d); }
  if (el.dataset.tipCursor != null) h += '<div><button type="button" class="btn small" data-cursor="' + esc(el.dataset.tipCursor) + '">Replay this check ›</button></div>';
  return h;
}
function showTip(el, html) {
  if (!el) return;
  const h = html != null ? html : tipHtml(el); if (!h) return;
  if (!tipbox) { tipbox = document.createElement('div'); tipbox.className = 'tipbox glass'; tipbox.id = 'tipbox'; tipbox.setAttribute('role', 'tooltip'); document.body.appendChild(tipbox); }
  if (tipEl && tipEl !== el) tipEl.removeAttribute('aria-describedby');
  tipbox.innerHTML = h; tipEl = el; tipAt = performance.now();
  el.setAttribute('aria-describedby', 'tipbox');
  const r = el.getBoundingClientRect();
  tipbox.style.left = '0px'; tipbox.style.top = '0px'; tipbox.classList.add('on');
  const w = tipbox.offsetWidth, ht = tipbox.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  let y = r.bottom + 8; if (y + ht > innerHeight - 8) y = Math.max(8, r.top - ht - 8);
  tipbox.style.left = x + 'px'; tipbox.style.top = y + 'px';
}
function hideTip() {
  if (tipbox) tipbox.classList.remove('on');
  if (tipEl) tipEl.removeAttribute('aria-describedby');
  tipEl = null;
}
function initTips() {
  document.addEventListener('click', e => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (tipbox && tipbox.contains(t)) return;                    // a button inside the tip acts; the shell then closes it
    const el = t.closest(TIPSEL);
    if (el) { e.preventDefault(); if (tipEl === el && performance.now() - tipAt > 350) hideTip(); else showTip(el); return; }
    if (tipEl) hideTip();
  });
  document.addEventListener('focusin', e => { const el = e.target instanceof Element && e.target.closest(TIPSEL); if (el && el === tipQuiet) { tipQuiet = null; return; } if (el && !(tipbox && tipbox.contains(el))) showTip(el); });
  document.addEventListener('focusout', () => { if (tipEl) setTimeout(() => { const a = document.activeElement; if (tipEl && a !== tipEl && !(tipbox && tipbox.contains(a))) hideTip(); }, 0); });
  document.addEventListener('keydown', e => {
    if (!tipEl) return;
    const a = document.activeElement, inBox = !!(tipbox && a && tipbox.contains(a));
    // Keyboard reach into a tip that holds buttons ("Replay this check ›"): Tab from its trigger moves into the tip;
    // Escape, or Tab out of either end, returns to the trigger without reopening it. The dial runs its own.
    const fs = tipbox ? $$('button,a[href]', tipbox) : [];
    if (e.key === 'Escape') { e.preventDefault(); const el = tipEl; hideTip(); if (inBox) tipFocus(el); return; }
    if (e.key !== 'Tab' || !fs.length || tipEl.closest('.dl')) return;
    if (a === tipEl && !e.shiftKey) { e.preventDefault(); fs[0].focus(); return; }
    if (inBox && ((!e.shiftKey && a === fs[fs.length - 1]) || (e.shiftKey && a === fs[0]))) { e.preventDefault(); const el = tipEl; hideTip(); tipFocus(el); }
  });
  addEventListener('scroll', () => { if (tipEl) hideTip(); }, { passive: true, capture: true });
  addEventListener('resize', () => { if (tipEl) hideTip(); });
}

// =========================================================================================== theme ==
function setTheme(t) {
  HTML.dataset.theme = t;
  try { localStorage.setItem('aifi.theme', t); } catch (e) {}
  $$('meta[name=theme-color]').forEach(m => m.setAttribute('content', t === 'light' ? '#eef1f6' : '#0a0b0f'));
  runHooks('theme', t);
}
function initTheme() {
  document.addEventListener('click', e => { const b = e.target instanceof Element && e.target.closest('[data-theme-toggle]'); if (b) { e.preventDefault(); setTheme(isDark() ? 'light' : 'dark'); } });
  const mq = matchMedia('(prefers-color-scheme: light)'), f = () => { if (!HTML.dataset.theme) runHooks('theme', isDark() ? 'dark' : 'light'); };
  if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f);
}

// ========================================================================================== sheets ==
let sheetStack = [], sheetFocus = null, sheetClean = null;
function sheetContent(kind, arg, el) {
  const f = SHEETS[kind];
  if (typeof f !== 'function') return { html: '<h2>Details</h2><div class="empty">This detail isn’t built yet.</div>' };
  let out; try { out = f(arg, el); } catch (e) { report(e, kind + ' sheet'); out = '<h2>Details</h2>' + broken(); }
  return typeof out === 'string' ? { html: out } : (out && typeof out === 'object' ? out : { html: '' });
}
// key = {kind, arg} makes the sheet refreshable on arrival. Opening over an open sheet keeps a "‹ Back" step;
// key.replace swaps it in place (cycle sheet previous/next), key.same redraws it keeping its scroll.
function openSheet(c, key) {
  const s = $('#sheet'), bg = $('#sheetbg'); if (!s) return;
  c = typeof c === 'string' ? { html: c } : (c || {});
  key = key || {};
  const open = s.classList.contains('on');
  const keep = key.same ? s.scrollTop : 0;
  if (open && S.sheet && key.kind && !key.back && !key.same && !key.replace) sheetStack.push(S.sheet);
  if (!open) { sheetStack = []; sheetFocus = document.activeElement; }
  if (typeof sheetClean === 'function') call(sheetClean);
  sheetClean = null;
  S.sheet = key.kind ? { kind: key.kind, arg: key.arg, at: key.at } : null;
  s.className = 'sheet glass' + (c.cls ? ' ' + c.cls : '') + (open ? ' on' : '');
  s.innerHTML = '<button class="btn icon x" id="sheetx" type="button" aria-label="Close">' + ICON.x + '</button>'
    + (sheetStack.length ? '<button class="btn small ghost" type="button" data-sheet-back>‹ Back</button>' : '') + (c.html || '');
  const h = $('h2', s); s.setAttribute('aria-label', h ? h.textContent.trim() : 'Details');
  s.setAttribute('tabindex', '-1');
  s.scrollTop = keep;
  const token = s._token = (s._token || 0) + 1;                   // a close in the same frame must win
  if (!open) requestAnimationFrame(() => { if (s._token === token) { s.classList.add('on'); if (bg) bg.classList.add('on'); try { s.focus({ preventScroll: true }); } catch (e) {} } });
  HTML.classList.add('noscroll');
  initSegs(s); stagger(s); masks(s);
  if (typeof c.after === 'function') { try { const r = c.after(s); if (typeof r === 'function') sheetClean = r; } catch (e) { report(e, (key.kind || 'sheet') + ' (after)'); } }
}
// A sheet remembers its trigger's data-at (the name sheet's "as at" run), so ‹ Back and an arrival redraw it the same.
const atOf = el => (el && el.dataset && el.dataset.at != null && el.dataset.at !== '' ? el.dataset.at : undefined);
const elOf = k => (k && k.at != null ? { dataset: { at: k.at } } : undefined);
function showSheet(kind, arg, el) { openSheet(sheetContent(kind, arg, el), { kind, arg, at: atOf(el) }); }
function sheetBack() { const p = sheetStack.pop(); if (p) openSheet(sheetContent(p.kind, p.arg, elOf(p)), { kind: p.kind, arg: p.arg, at: p.at, back: true }); }
function refreshSheet() {
  const s = $('#sheet'); if (!s || !S.sheet || !s.classList.contains('on')) return;
  openSheet(sheetContent(S.sheet.kind, S.sheet.arg, elOf(S.sheet)), { kind: S.sheet.kind, arg: S.sheet.arg, at: S.sheet.at, same: true });
}
function closeSheet() {
  const s = $('#sheet'), bg = $('#sheetbg'); if (!s) return;
  s._token = (s._token || 0) + 1;
  const was = s.classList.contains('on');
  if (typeof sheetClean === 'function') call(sheetClean);
  sheetClean = null; S.sheet = null; sheetStack = [];
  s.classList.remove('on'); if (bg) bg.classList.remove('on');
  HTML.classList.remove('noscroll');
  if (!was) return;
  setTimeout(() => { if (!s.classList.contains('on')) s.innerHTML = ''; }, 350);
  const f = sheetFocus; sheetFocus = null;
  if (f && f.isConnected && f !== document.body) try { f.focus({ preventScroll: true }); } catch (e) {}
}
// The default Health sheet (§9.5): status, punctuality, every alert with its action, the data's age, Refresh.
// A module may replace SHEETS.health; COMP.punctuality(b), when present, adds the punctuality strip.
SHEETS.health = function () {
  const b = S.b, x = ['<h2>Health</h2>'];
  if (!b) {
    x.push('<p class="note">' + (S.net === 'offline' ? 'Can’t reach the dashboard right now.' : S.net === 'signedout' ? 'Signed out.' : 'No data yet. The first check after deployment pushes it.') + '</p>');
    x.push('<div class="pn"><span></span><button class="btn small" type="button" data-refresh>Refresh</button></div>');
    return x.join('');
  }
  const st = S.st || status(b), K = st.K, s = stateOf(b), thr = s.thr || {}, m = modeOf(b), last = s.last || {};
  x.push('<p><span class="pill ' + ({ ok: 'ok', info: 'info', warn: 'warn', bad: 'bad' })[st.lvl] + '">' + esc(st.word) + '</span></p><p class="ink2">' + st.sentence + '</p>');
  x.push('<div class="sec"><h3>Punctuality</h3>' + (typeof COMP.punctuality === 'function' ? safe(() => COMP.punctuality(b), 'Punctuality') : '') + '<p class="note">' + esc(word.punct(b) || MISSING) + '</p></div>');
  x.push('<div class="sec"><h3>Alerts</h3>' + (st.items.length ? '<div class="alerts">' + st.items.map(i => banner(i.lvl, i.sentence, i.act)).join('') + '</div>' : '<p class="note">Nothing needs you.</p>') + '</div>');
  const thrW = { normal: 'Allowed', halved: 'Risk halved', halted: 'Stopped', unknown: 'unknown' }[thr.state] || 'unknown';
  const f = [];
  const lm = last.late_min != null ? last.late_min : (lastRun(b) || {}).lm;
  f.push(['Last check', K.lastT != null ? esc(fmt.when(K.lastT)) + ' · ' + (last.failed ? '<span class="neg">stopped early</span>' + (lm != null ? ' (started ' + esc(lm) + ' min after the close)' : '') : esc(word.lag(lm, last.fresh))) : na()]);
  const PH = { countdown: ['On schedule', ''], due: ['Due now', 'due'], late: [K.exits ? 'Late, exits unchecked' : 'Late', 'late'], stale: ['Stale', 'stale'] }[K.phase];
  if (PH) f.push(['Clock', esc(PH[0]) + (PH[1] ? ' ' + tip(PH[1]) : '')]);
  if (K.C != null) {
    f.push(['Next 4-hour close', esc(fmt.when(K.C)) + ' <span class="sub">' + esc(fmt.utc(K.C)) + '</span>']);
    f.push(['Check expected', '≈ ' + esc(fmt.when(K.next)) + ' <span class="sub">' + esc(fmt.rel(K.next)) + '</span>']);
    f.push(['Buys skipped after', esc(fmt.when(K.lateAt))]);
  }
  f.push(['Mode', m.eff === 'live' ? 'Live' : m.eff === 'paper' ? 'Paper' : na()]);
  if (m.req && m.eff && m.req !== m.eff) f.push(['Requested', esc(m.req) + ' · ' + esc(m.note || 'live requirements missing')]);
  f.push(['Buying', esc(thrW) + (s.halt && s.halt.set ? ' · <span class="neg">halted</span>' : '')]);
  f.push(['Drawdown', thr.dd_pct != null ? esc(fmt.pctu(thr.dd_pct, 1)) : na()]);
  const gen = isoS(b.gen || b.generated);
  f.push(['Data pushed', gen != null ? esc(fmt.when(gen)) + ' <span class="sub" data-ago="' + gen + '">' + esc(fmt.ago(gen)) + '</span>' : na()]);
  if (b.diag && b.diag.unparsed) f.push(['Unread engine lines', esc(fmt.int(b.diag.unparsed))]);
  const tr = b.diag && isObj(b.diag.trim) ? b.diag.trim : null;   // the push kept exec:latest within 50 KB
  if (tr && (num(tr.dx) || num(tr.board))) f.push(['Trimmed to fit', esc([num(tr.dx) ? 'distances of the ' + word.plural(tr.dx, 'oldest check') : '', num(tr.board) ? word.plural(tr.board, 'older reading change') : ''].filter(Boolean).join(' · '))]);
  x.push('<dl class="facts">' + f.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>');
  x.push('<div class="pn"><span class="sub">A tap on the status also checks for new data.</span><button class="btn small" type="button" data-refresh>Refresh</button></div>');
  return x.join('');
};

// ================================================================== shell: capsule, mode, alerts ==
function banner(lvl, sentence, act) {
  const cls = lvl === 'bad' ? 'bad' : lvl === 'warn' ? 'warn' : 'info';
  let a = '';
  if (act && act.cycle != null) a = '<button type="button" class="act" data-cycle="' + esc(act.cycle) + '">' + esc(act.label) + '</button>';
  else if (act && act.href) a = '<a class="act" href="' + esc(act.href) + '">' + esc(act.label) + '</a>';
  return '<div class="banner ' + cls + '"><span class="ic">' + (cls === 'bad' ? ICON.bad : cls === 'warn' ? ICON.warn : ICON.info) + '</span><span class="bt">' + sentence + '</span>' + a + '</div>';
}
let capMemo = null, railMemo = null, alertMemo = null, modeMemo = null;
function capState() {
  if (S.net === 'signedout') return { dot: 'gap', cls: 'warn', word: 'Signed out', age: '', wide: '· tap to sign in' };
  if (S.net === 'checking') return { dot: 'mute', cls: 'mute', word: 'Checking…', age: '', wide: '' };
  if (S.net === 'offline') return { dot: 'mute', cls: 'mute', word: 'Offline', age: S.seenAt ? 'last seen ' + fmt.when(S.seenAt) : '', wide: '' };
  if (!S.b) return S.bootErr === 'missing' ? { dot: 'mute', cls: 'mute', word: 'No data yet', age: '', wide: '' }
    : S.bootErr ? { dot: 'gap', cls: 'warn', word: 'Data unreadable', age: '', wide: '' } : { dot: 'mute', cls: 'mute', word: 'Checking…', age: '', wide: '' };
  const st = S.st || (S.st = status(S.b));
  return { dot: DOT[st.lvl], cls: LVCLS[st.lvl], word: st.word, age: st.age || '', wide: st.wide || '' };
}
function paintCapsule() {
  const c = capState(), cap = $('#capsule');
  if (cap) {
    // The capsule is the page's only live region. Its age is aria-hidden, so a ticking minute is never announced;
    // a change of word (a state change) is.
    const h = '<span class="dot ' + c.dot + '"></span><span class="cw">' + esc(c.word) + '</span>'
      + (c.age ? '<span class="ca" aria-hidden="true">' + esc(c.age) + '</span>' : '')
      + (c.wide ? '<span class="wide-only sub">' + esc(c.wide) + '</span>' : '');
    const cls = 'capsule' + (c.cls ? ' ' + c.cls : '');
    if (h !== capMemo) { cap.innerHTML = h; capMemo = h; }
    if (cap.className !== cls) cap.className = cls;
    const ttl = c.word + (c.age ? ' · ' + c.age : '') + (S.net === 'signedout' ? ' · sign in' : ' · health details');
    if (cap.title !== ttl) cap.title = ttl;          // the 30 s tick writes nothing that did not change (§3.3)
  }
  const rs = $('#railstat');
  if (rs) {
    const h = '<span class="dot ' + c.dot + '"></span><span class="txt"><b>' + esc(c.word) + '</b><span class="age">' + esc(c.age || '') + '</span></span>';
    const cls = 'status' + (c.cls === 'warn' || c.cls === 'bad' ? ' ' + c.cls : '');
    if (h !== railMemo) { rs.innerHTML = h; railMemo = h; }
    if (rs.className !== cls) rs.className = cls;
  }
}
function paintMode() {
  const el = $('#modepill'); if (!el) return;
  const e = modeOf(S.b).eff, cls = e === 'live' ? 'pill live' : e === 'paper' ? 'pill pt' : 'pill mute';
  const h = e === 'live' ? 'Live' : e === 'paper' ? 'Paper<span class="wide-only"> · simulated</span>' : '—';
  if (el.className !== cls) el.className = cls;
  if (h !== modeMemo || !el.firstChild) { el.innerHTML = h; modeMemo = h; }
}
// Alert rail (§4.1): bad items and the paper fallback on every tab, other warn items on Now only; empty renders nothing.
function paintAlerts() {
  const el = $('#alerts'); if (!el) return;
  let h = '';
  if (S.b && S.b.v !== 2) h += banner('info', 'Dashboard is newer than its data; some panels fill after the next check.');
  if (S.b && S.st) for (const i of S.st.items) if (i.lvl === 'bad' || i.k === 'fallback' || (i.lvl === 'warn' && S.tab === 'now')) h += banner(i.lvl, i.sentence, i.act);
  if (h !== alertMemo) { el.innerHTML = h; alertMemo = h; }
}
function newestEv(b) { let n = 0; for (const e of (b && Array.isArray(b.events) ? b.events : [])) if (Array.isArray(e) && e[5] >= 1 && e[0] > n) n = e[0]; return n; }
function paintNewDot() {
  const on = !!S.b && S.tab !== 'activity' && newestEv(S.b) > (Number(lsGet('ex.seenEv', 0)) || 0);
  $$('a[data-tab=activity]').forEach(a => a.classList.toggle('new', on));
}
function markEvSeen() { const n = newestEv(S.b); if (n) lsSet('ex.seenEv', Math.max(n, Number(lsGet('ex.seenEv', 0)) || 0)); paintNewDot(); }
// One repaint of everything that shows the status engine; modules that show it too (Now's verdict) follow via hook('status').
function refreshShell() { S.st = S.b ? status(S.b) : null; paintMode(); paintCapsule(); paintAlerts(); paintNewDot(); runHooks('status', S.st); }

// ========================================================================================= routing ==
// Ported from ~/aifi/cloud/client.js route() 391 and the digit keydown 401, plus the v2 redirects (§2).
const REDIRECT = { overview: ['now'], book: ['positions'], trades: ['results'], refused: ['activity', 'signals'], logic: ['rules'] };
function parseHash() {
  const raw = (location.hash || '').slice(1);
  let h; try { h = decodeURIComponent(raw); } catch (e) { h = raw; }
  const parts = h.split('/');
  let tab = parts[0] || 'now', sub = parts.slice(1).join('/') || null, moved = false;
  if (REDIRECT[tab]) { const r = REDIRECT[tab]; tab = r[0]; sub = r[1] || sub; moved = true; }
  if (!TABS.includes(tab)) { tab = 'now'; sub = null; moved = !!raw; }
  if (moved) try { history.replaceState(null, '', '#' + tab + (sub ? '/' + sub : '')); } catch (e) {}
  return { tab, sub };
}
function go(tab, sub) { location.hash = tab + (sub ? '/' + sub : ''); }
let viewTab = null, viewClean = null;
function placeholder(tab) { return '<div class="card rise"><div class="empty"><b>' + esc(TITLE[tab] || tab) + '</b> is not built yet. The status and alerts above are live.</div></div>'; }
function renderView(why) {
  const root = $('#view'); if (!root || !S.b) return;
  if (typeof viewClean === 'function') call(viewClean);
  viewClean = null;
  if (viewTab && viewTab !== S.tab && VIEWS[viewTab] && typeof VIEWS[viewTab].leave === 'function') call(VIEWS[viewTab].leave);
  viewTab = S.tab;
  const V = VIEWS[S.tab], name = TITLE[S.tab];
  if (!V || typeof V.render !== 'function') { root.innerHTML = placeholder(S.tab); stagger(root); return; }
  let out;
  try { out = V.render(root, why || 'route'); } catch (e) { report(e, name); out = broken(name); }
  if (typeof out === 'string') root.innerHTML = out;
  stagger(root); initSegs(root); masks(root);
  if (typeof V.after === 'function') { try { const r = V.after(root); if (typeof r === 'function') viewClean = r; } catch (e) { report(e, name + ' (after)'); } }
}
// Re-render the open tab in place (a layout breakpoint crossed, a module's own state changed): keeps the scroll
// position and any open sheet; not an arrival, so nothing counts up and no card rises.
function redraw() { if (!S.b) return; const y = scrollY; renderView('redraw'); jump(y); }
function route() {
  const { tab, sub } = parseHash();
  S.tab = tab; S.sub = sub;
  $$('.rail nav a[data-tab], .tabbar a[data-tab]').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  movePill();
  const title = (VIEWS[tab] && VIEWS[tab].title) || TITLE[tab], h1 = $('#ttl');
  if (h1) h1.textContent = title;
  document.title = title + ' · AiFi Executor';
  closeSheet(); hideTip();
  if (tab === 'activity') S.seenEv = Number(lsGet('ex.seenEv', 0)) || 0;
  paintAlerts();
  renderView('route');
  if (tab === 'activity' && S.b) markEvSeen(); else paintNewDot();
  runHooks('route', tab, sub);
  const a = sub && document.getElementById(tab + '-' + sub);
  if (a) { into(a, false); holdAnchor(a); } else jump(0);
}
// A deep link lands while cards still rise and lazy panels (the ledger, a chart) fill in above it, which moves the
// section after the first scroll. Keep it 72px below the top for two seconds, measured from layout (offsetTop, which
// ignores the rise transform), and let go the moment the reader touches, scrolls, clicks or types.
let anchorT = 0;
function holdAnchor(el) {
  clearTimeout(anchorT);
  const EV = ['wheel', 'touchstart', 'pointerdown', 'keydown'], t0 = Date.now();
  const off = () => { clearTimeout(anchorT); anchorT = 0; EV.forEach(n => removeEventListener(n, off, true)); };
  EV.forEach(n => addEventListener(n, off, { capture: true, passive: true }));
  const top = () => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y - 72; };
  const tick = () => {
    if (!el.isConnected || Date.now() - t0 > 2000) return off();
    const y = Math.max(0, top()); if (Math.abs(scrollY - y) > 2) jump(y);
    anchorT = setTimeout(tick, 250);
  };
  anchorT = setTimeout(tick, 250);
}

// ======================================================================= polling and timers (§3.3) ==
const P = { t: 0, err: 0, busy: false, at: 0, due: 0, pull: 0, tok: 0, gaveUp: null };
function pollEvery() {
  if (P.err >= 3) return 300e3;                                    // back off to 5 min after 3 consecutive errors
  if (!S.b) return 60e3;
  const K = clock(S.b); if (K.C == null) return 600e3;
  const n = nowS();
  return n >= K.C + 600 && n < K.C + BAR ? 60e3 : 600e3;            // every 60 s only inside the due window
}
function schedulePoll(ms) {
  clearTimeout(P.t); P.t = 0;
  if (document.hidden) return;
  const d = Math.max(0, ms != null ? ms : pollEvery());
  P.due = Date.now() + d; P.t = setTimeout(() => poll(), d);
}
function nudgePoll() {                                             // the due window may have opened since the timer was set
  if (document.hidden || P.busy) return;
  const next = (P.at || Date.now()) + pollEvery();
  if (!P.t || P.due > next + 1000) schedulePoll(next - Date.now());
}
async function poll(user) {
  if (P.busy || S.booting) return;
  P.busy = true; clearTimeout(P.t); P.t = 0;
  if (user) { S.net = 'checking'; paintCapsule(); }
  try {
    const st = await getJSON('/api/stamp', 10000);
    P.err = 0; S.net = 'ok'; S.seenAt = nowS();
    if (st && st.gen && (!S.b || st.gen !== S.b.gen) && P.gaveUp !== st.gen) await pull(st.gen, 0);
  } catch (e) {
    if (e && e.kind === 'auth') S.net = 'signedout';
    else { P.err++; S.net = e && e.kind === 'net' ? 'offline' : (S.net === 'checking' ? 'ok' : S.net); }
  }
  P.at = Date.now(); P.busy = false;
  if (S.b) S.st = status(S.b);
  paintCapsule(); paintAlerts();
  if (S.sheet && S.sheet.kind === 'health') refreshSheet();
  schedulePoll();
}
function newer(nb) { return !S.b || (!!nb.gen && nb.gen !== S.b.gen && (!S.b.gen || nb.gen > S.b.gen)); }
async function pull(gen, tries) {
  const tk = ++P.tok; clearTimeout(P.pull); P.pull = 0;
  let nb;
  try { nb = await getJSON('/api/latest', 10000); }
  catch (e) { if (e && e.kind === 'auth') S.net = 'signedout'; else if (e && e.kind === 'net') S.net = 'offline'; return; }
  if (tk !== P.tok || !nb || typeof nb !== 'object' || Array.isArray(nb)) return;
  if (newer(nb)) land(nb);
  if (nb.gen === gen) return;
  if (tries >= 3) { P.gaveUp = gen; return; }                       // KV propagation: up to 3 retries, 20 s apart
  if (!document.hidden) P.pull = setTimeout(() => pull(gen, tries + 1), 20e3);
}
// A new bundle landed: re-render in place (scroll position and any open sheet kept), then the arrival hook plays.
function land(nb) {
  if (!S.b) { S.bootErr = null; return start(nb); }
  const prev = S.b; S.prev = prev; S.b = nb;
  refreshShell();
  const y = scrollY;
  renderView('arrival');
  jump(y);
  refreshSheet();
  if (S.tab === 'activity') markEvSeen();
  runHooks('arrival', prev, nb);
}
// The 1 s tick runs only while a registered element is on screen and the page is visible (the dial countdown).
const ONE = []; let io1 = null, T1 = 0;
function every1s(el, fn) {
  if (!el || typeof fn !== 'function') return;
  const ent = { el, fn, on: !('IntersectionObserver' in window) };
  ONE.push(ent);
  if ('IntersectionObserver' in window) {
    io1 = io1 || new IntersectionObserver(es => { for (const e of es) for (const x of ONE) if (x.el === e.target) x.on = e.isIntersecting; sync1s(); });
    io1.observe(el);
  }
  sync1s();
}
function sync1s() {
  for (let i = ONE.length - 1; i >= 0; i--) if (!ONE[i].el.isConnected) { if (io1) io1.unobserve(ONE[i].el); ONE.splice(i, 1); }
  const want = !document.hidden && !!S.b && (ONE.some(x => x.on) || hooksOf('tick1s').length > 0);
  if (want && !T1) T1 = setTimeout(() => { tick1(); if (T1) T1 = setInterval(tick1, 1000); }, 1000 - (Date.now() % 1000) + 5);
  else if (!want && T1) { clearInterval(T1); T1 = 0; }
}
function tick1() { sync1s(); if (!T1) return; for (const x of ONE) if (x.on) call(x.fn); runHooks('tick1s'); }
let T30 = 0;
function tick30() {
  if (!S.b) return;
  refreshShell();
  $$('[data-ago]').forEach(el => { const t = Number(el.dataset.ago); if (!isFinite(t)) return; const a = fmt.ago(t); if (el.textContent !== a) el.textContent = a; });
  runHooks('tick30s');
  nudgePoll(); sync1s();
}
function startTimers() {
  stopTimers();
  if (document.hidden || !S.b) return;
  T30 = setTimeout(() => { tick30(); if (T30) T30 = setInterval(tick30, 30000); }, 30000 - (Date.now() % 30000) + 50);
  sync1s();
}
function stopTimers() { clearInterval(T30); T30 = 0; if (T1) { clearInterval(T1); T1 = 0; } }
function onVis() {
  if (document.hidden) {
    HTML.classList.add('hid');
    stopTimers(); clearTimeout(P.t); P.t = 0; clearTimeout(P.pull); P.pull = 0;
    runHooks('hide');
  } else {
    HTML.classList.remove('hid');
    if (S.b) { tick30(); startTimers(); }
    runHooks('show');
    poll();
  }
}

// ==================================================================================== boot + shell ==
function bootCard(title, text, btn) {
  return '<div class="card rise"><div class="empty"><h2 style="color:var(--ink);font-size:var(--fs-lg);margin-bottom:6px">' + esc(title) + '</h2>'
    + '<p style="margin:0 0 12px">' + esc(text) + '</p>' + (btn || '') + '</div></div>';
}
async function boot() {
  if (S.booting) return;
  S.booting = true; S.net = 'checking'; paintCapsule();
  let b = null, err = null;
  try { b = await getJSON('/api/latest', 10000); if (!b || typeof b !== 'object' || Array.isArray(b)) err = { kind: 'parse' }; }
  catch (e) { err = e && e.kind ? e : { kind: 'net' }; }
  S.booting = false;
  if (err) return bootFail(err);
  S.net = 'ok'; S.seenAt = nowS(); S.bootErr = null; P.err = 0; P.at = Date.now();
  start(b);
}
function start(b) {
  S.b = b; S.prev = null;
  refreshShell();
  route();
  startTimers(); schedulePoll();
}
async function bootFail(e) {
  const v = $('#view'), retry = '<button class="btn" type="button" data-retry>Retry</button>';
  let h;
  S.bootErr = e.kind;
  if (e.kind === 'auth') { S.net = 'signedout'; h = bootCard('Signed out', 'Your session ended. Sign in again to see the executor.', '<a class="btn primary" href="/login">Sign in</a>'); }
  else if (e.kind === 'net') { S.net = 'offline'; h = bootCard('Can’t reach the dashboard', 'Check the connection, then try again.', retry); }
  else if (e.kind === 'missing') { S.net = 'ok'; h = bootCard('No data yet', 'The first check after deployment pushes it.'); }
  else {
    S.net = 'ok';
    let when = '';
    try { const st = await getJSON('/api/stamp', 5000); const g = isoS(st && st.gen); if (g != null) when = ' (pushed ' + fmt.when(g) + ')'; } catch (_) {}
    h = bootCard('The latest data couldn’t be read' + when, 'The next check pushes a fresh copy.', retry);
  }
  if (v) { v.innerHTML = h; stagger(v); }
  paintCapsule(); paintAlerts();
  P.err++; P.at = Date.now(); schedulePoll();
}
const TRIGGERS = '[data-cursor],[data-health],[data-cycle],[data-name],[data-pos],[data-trade],[data-sheet]';
function onClick(e) {
  if (e.defaultPrevented || e.button > 0) return;
  const t = e.target; if (!(t instanceof Element)) return;
  let el;
  if (t.closest('#sheetx')) return closeSheet();
  if (t.closest('[data-sheet-back]')) return sheetBack();
  if (t.closest('[data-retry]')) { e.preventDefault(); return boot(); }
  if (t.closest('[data-refresh]')) { e.preventDefault(); return poll(true); }
  if (t.closest('[data-top]')) { e.preventDefault(); return scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); }
  if ((el = t.closest(TRIGGERS))) {
    e.preventDefault(); hideTip();
    const d = el.dataset;
    if (d.cursor != null) return setCursor(d.cursor, { explicit: true, scroll: d.scroll != null });
    if (d.health != null) { if (S.net === 'signedout') { location.href = '/login'; return; } showSheet('health'); return poll(true); }
    if (d.cycle != null) { const n = Number(d.cycle); setCursor(n, { explicit: true, sheet: false }); return showSheet('cycle', n, el); }
    if (d.name != null) return showSheet('name', d.name, el);
    if (d.pos != null) return showSheet('pos', d.pos, el);
    if (d.trade != null) return showSheet('trade', d.trade, el);
    const i = d.sheet.indexOf(':');
    return i < 0 ? showSheet(d.sheet, undefined, el) : showSheet(d.sheet.slice(0, i), d.sheet.slice(i + 1), el);
  }
  if ((el = t.closest('.rail nav a[data-tab], .tabbar a[data-tab]')) && el.dataset.tab === S.tab && !S.sub) {
    e.preventDefault(); scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });       // tapping the open tab: back to the top
  }
}
function onKey(e) {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') { if (tipEl) hideTip(); else closeSheet(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if (e.target instanceof Element && e.target.closest('input,select,textarea,[contenteditable]')) return;
  const i = '12345'.indexOf(e.key);
  if (e.key.length === 1 && i >= 0) { e.preventDefault(); go(TABS[i]); }
}
function initShell() {
  addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);
  const bg = $('#sheetbg'); if (bg) bg.addEventListener('click', closeSheet);
  let rf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rf); rf = requestAnimationFrame(() => { initSegs(); movePill(); masks(); }); });
  document.addEventListener('scroll', e => { const el = e.target; if (el instanceof Element && el.matches(SCROLLERS)) maskOne(el); }, { capture: true, passive: true });
  document.addEventListener('toggle', e => { const d = e.target; if (d instanceof Element && d.matches('details') && d.open) masks(d); }, true);   // a table shown by a disclosure gets its edge fade
  document.addEventListener('visibilitychange', onVis);
  addEventListener('pageshow', e => { if (e.persisted) onVis(); });
  addEventListener('online', () => { if (!document.hidden) poll(); });
  addEventListener('offline', () => { S.net = 'offline'; paintCapsule(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePill, () => {});
  if (document.hidden) HTML.classList.add('hid');
  paintCapsule();
  route();
}
