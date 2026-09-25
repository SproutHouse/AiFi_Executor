// cloud/ui/activity.js — the Activity tab (spec §6): the heartbeat and punctuality line (§6.1), the timeline (§6.2),
// Signals (§6.3), the board over time (§6.4) and All readings (§6.5); plus COMP.punctuality, the Health sheet's
// punctuality strip (§9.5), opened from the capsule through core's SHEETS.health. One block (ui/README.md); it exports
// VIEWS.activity and COMP.punctuality and follows the shared cursor (§5) with onCursor. Classes carry the ac- prefix.
{
  // ============================================================================================ state ==
  // Per session, never persisted: filters and disclosures survive a tab change and an arriving check.
  const M = {
    root: null,          // #view while Activity is mounted (null otherwise)
    EV: new Map(),       // events by run t, rebuilt on every render
    win: 'all',          // Signals period: 'all' | 'week'
    tf: 'all',           // timeline filter
    coin: null,          // timeline coin filter
    earlier: false,      // timeline: also show days before the last three
    folds: new Set(),    // opened quiet-check folds (key: newest t in the fold)
    sf: 'all',           // outcome list filter
    sn: 30,              // outcome rows shown
    pinAll: false,       // "Would have traded": all rows
    rdOpen: false,       // All readings disclosure
    k: {},               // last drawn bar values: bars grow from here (0 on first view)
    L: undefined,        // ledger: undefined = loading, null = unavailable, object = loaded
    wide: false,         // ≥900px: tables instead of cards
    cw: 0,               // tape column width in px
    hbKey: '',           // heartbeat clock key: redraw the grid only when a slot or phase changes
    play: 0,             // tape Play interval
    io: null,            // IntersectionObserver for growing bars
  };
  const WIDE = matchMedia('(min-width:900px)');
  const DAYN = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
  const LW = 48;                                                   // tape label column (spec §6.4)
  const arr = v => Array.isArray(v) ? v : [];
  const n0 = v => num(v) || 0;
  const lc1 = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
  const slotOf = r => r.s != null ? r.s : Math.floor(r.t / BAR) * BAR;
  const limit = b => num(b && b.cfg && b.cfg.late_min) || num(b && b.clock && b.clock.limit_min) || 45;
  const lday = ms => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; };
  // A time that always carries the clock time: "4:20 am", "Thu 8:27 pm", or "Thu Sep 18, 8:27 pm" beyond 6 days.
  const at = t => t == null ? '—' : Math.abs(lday(nowMs()) - lday(t * 1000)) <= 6 ? fmt.when(t) : fmt.stamp(t);
  const rowDay = t => fmt.wd(t) + ' ' + DAYN.format(new Date(t * 1000));
  // "12a"; in a half-hour zone the minutes stay ("1:30a"), since the close is not on the hour there.
  const colLabel = t => new Date(t * 1000).getMinutes() ? fmt.time(t).replace(/[\s\u00a0]*([ap])\.?m\.?$/i, '$1') : fmt.hr(t);
  const sec = (id, cls, rise, inner) => '<section class="card ' + cls + rise + '" id="' + id + '">' + inner + '</section>';
  const head = (title, sub, acts) => '<div class="head"><div class="ttl"><h2>' + title + '</h2>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';

  function evIndex(b) {
    const m = new Map();
    for (const e of arr(b && b.events)) if (Array.isArray(e) && e[0] != null) { let l = m.get(e[0]); if (!l) m.set(e[0], l = []); l.push(e); }
    return m;
  }
  function bookOf(b, c) {
    const n = arr(b && b.names).find(x => x && x.c === c); if (n && n.b) return n.b;
    for (const bk of arr(b && b.books)) if (bk && arr(bk.names).some(x => (Array.isArray(x) ? x[0] : x) === c)) return bk.b || null;
    return null;
  }

  // ====================================================================== slots (heartbeat + strip) ==
  // Cells are keyed by UTC 4-hour slot and only labelled in local time, so a DST change never shifts them.
  // N is the slot the engine owes a check for next (clock C, or the current slot once C has passed by 4 h).
  function slotModel(b, now) {
    now = now == null ? nowS() : now;
    const K = clock(b, now), runs = runsOf(b), cur = Math.floor(now / BAR) * BAR;
    const N = K.C != null ? Math.max(K.C, cur) : cur;
    const by = new Map();
    for (const r of runs) { if (!r || r.t == null) continue; const s = slotOf(r); let l = by.get(s); if (!l) by.set(s, l = []); l.push(r); }
    by.forEach(l => l.sort((a, z) => a.t - z.t));
    let start = N;
    const o = num(b && b.origin && b.origin.t);
    if (o != null) start = Math.floor(o / BAR) * BAR;
    if (runs.length && runs[0] && runs[0].t != null) start = Math.min(start, slotOf(runs[0]));
    return { N, K, by, start, now, ev: b === S.b && M.EV.size ? M.EV : evIndex(b) };
  }
  function runCounts(r, EV) {
    const c = arr(r.c), evs = EV.get(r.t) || [], cnt = ty => evs.filter(e => e[1] === ty).length;
    const closed = Object.values(r.hx && typeof r.hx === 'object' ? r.hx : {}).filter(h => /^c/.test(String(h))).length;
    return { sig: n0(c[1]), buy: Math.max(n0(c[4]), cnt('bought')), sold: Math.max(closed, cnt('sold')) };
  }
  // One slot → {s, runs, k, sig, buy, sold}. k: ok sig act late fail halt (recorded) · miss next future pre (no run).
  // Several runs in one slot merge: the most serious state shows, the counts add up, the badge counts the runs.
  function slotInfo(s, SM) {
    const rs = SM.by.get(s) || [];
    if (!rs.length) return { s, runs: rs, k: s < SM.start ? 'pre' : s > SM.N ? 'future' : s === SM.N ? 'next' : 'miss' };
    let sig = 0, buy = 0, sold = 0; const ks = new Set();
    for (const r of rs) {
      const x = runCounts(r, SM.ev); sig += x.sig; buy += x.buy; sold += x.sold;
      ks.add(r.x ? 'fail' : r.h ? 'halt' : !r.ok ? 'late' : 'ok');
    }
    const k = ks.has('fail') ? 'fail' : ks.has('halt') ? 'halt' : ks.has('late') ? 'late' : buy || sold ? 'act' : sig ? 'sig' : 'ok';
    return { s, runs: rs, k, sig, buy, sold };
  }
  const hbKeyOf = SM => SM.N + '|' + SM.K.phase + '|' + (SM.K.lateAt != null && SM.now >= SM.K.lateAt ? 1 : 0) + '|' + runsOf().length;

  // ======================================================================================= heartbeat ==
  // Column order (§6.1): of the six slots in the day that ends at N, the one with the smallest local time of day
  // starts every row; rows are six consecutive UTC slots, newest row on top.
  function hbRows(SM) {
    let r0 = SM.N, best = Infinity;
    for (let k = 0; k < 6; k++) { const t = SM.N - k * BAR, d = new Date(t * 1000), m = d.getHours() * 60 + d.getMinutes(); if (m < best) { best = m; r0 = t; } }
    const rows = [];
    for (let i = 0; i < 7; i++) { const s0 = r0 - i * 6 * BAR, cells = []; for (let j = 0; j < 6; j++) cells.push(slotInfo(s0 + j * BAR, SM)); rows.push({ s0, cells }); }
    return { r0, rows };
  }
  function runWords(r, EV) {
    const x = runCounts(r, EV);
    let s = 'checked ' + fmt.time(r.t) + ', ' + word.run(r).s;
    if (r.x) { const f = (EV.get(r.t) || []).find(e => e[1] === 'failed'); return s + (f && f[6] ? ' (' + f[6] + ')' : ''); }
    s += ', ' + (x.sig ? word.plural(x.sig, 'signal') : 'no signals');
    if (x.buy) s += ', bought ' + x.buy; else if (x.sig) s += ', nothing bought';
    if (x.sold) s += ', sold ' + x.sold;
    return s;
  }
  function nextWords(SM) {
    const K = SM.K;
    if (K.C == null) return 'next check.';
    if (SM.N !== K.C) return 'no check yet. The last one landed ' + fmt.ago(K.lastT) + '.';
    if (K.phase === 'countdown') return 'next check, expected about ' + fmt.time(K.next) + '.';
    if (K.phase === 'due') return 'due now. Checks usually land ' + (K.rng ? K.rng[0] + '–' + K.rng[1] : 'about ' + Math.round(K.lag)) + ' min after the close.';
    return 'no check yet' + (SM.now >= K.lateAt ? ', so buys are skipped for this bar.' : '. After ' + fmt.time(K.lateAt) + ' it skips buys.');
  }
  function slotWords(x, SM) {
    const close = 'The ' + at(x.s) + ' close: ';
    if (x.k === 'miss') return close + 'missed, no check was recorded.';
    if (x.k === 'next') return close + nextWords(SM);
    if (x.runs.length > 1) return close + x.runs.length + ' checks. ' + x.runs.map(r => cap1(runWords(r, SM.ev))).join('. ') + '.';
    return close + runWords(x.runs[0], SM.ev) + '.';
  }
  const HBG = { ok: '·', late: 'late', fail: '!', halt: '‖', miss: '—' };
  function hbGlyph(x) {
    if (x.k === 'sig') return String(x.sig);
    if (x.k === 'act') return (x.buy ? '+' + x.buy : '') + (x.sold ? '−' + x.sold : '');
    return HBG[x.k] || '';
  }
  function hbCell(x, SM, fresh) {
    if (x.k === 'pre' || x.k === 'future') return '<span class="ac-hc ac-h-' + x.k + '" aria-hidden="true"></span>';
    const lab = esc(slotWords(x, SM));
    if (x.k === 'miss' || x.k === 'next')                             // no run to replay: the words open as a tip
      return '<button type="button" class="ac-hc ac-h-' + x.k + ' hit" data-tip="' + lab + '" aria-label="' + lab + '">' + esc(hbGlyph(x)) + '</button>';
    const last = x.runs[x.runs.length - 1];
    return '<button type="button" class="ac-hc ac-h-' + x.k + ' hit' + (fresh ? ' grow1' : '') + '" data-cycle="' + last.t + '" data-slot="' + x.s + '" aria-label="' + lab + '">'
      + esc(hbGlyph(x)) + (x.runs.length > 1 ? '<span class="ac-hn" aria-hidden="true">' + x.runs.length + '</span>' : '') + '</button>';
  }
  function hbGrid(b, fresh) {
    const SM = slotModel(b), H = hbRows(SM);
    M.hbKey = hbKeyOf(SM);
    let h = '<div class="ac-hb" role="group" aria-label="Heartbeat: one cell per 4-hour close for the last 7 days, newest row first"><span aria-hidden="true"></span>';
    for (let j = 0; j < 6; j++) h += '<span class="ac-hcol" aria-hidden="true">' + esc(colLabel(H.r0 + j * BAR)) + '</span>';
    for (const row of H.rows) {
      h += '<span class="ac-hrow" aria-hidden="true">' + esc(rowDay(row.s0)) + '</span>';
      for (const x of row.cells) h += hbCell(x, SM, !!fresh && x.runs.some(r => fresh.has(r.t)));
    }
    return { html: h + '</div>', H };
  }
  const HBL = [['ok', 'On time'], ['sig', 'Signals, none bought'], ['act', 'Bought or sold'], ['late', 'Ran late'], ['fail', 'Failed'], ['halt', 'Halted'], ['miss', 'Missed'], ['next', 'Next check']];
  function legend(items) { return items.length ? '<ul class="ac-leg" aria-label="Legend">' + items.map(([sw, w]) => '<li><i class="ac-sw ' + sw + '" aria-hidden="true"></i>' + esc(w) + '</li>').join('') + '</ul>' : ''; }
  function last24(b) {
    const x = b.last24;
    if (!x || typeof x !== 'object') return 'Last 24 h: ' + na();
    const p = [fmt.int(x.on_time) + ' of ' + fmt.int(x.slots) + ' on time'];
    if (x.late) p.push(fmt.int(x.late) + ' late');
    if (x.missed) p.push(fmt.int(x.missed) + ' missed');
    if (x.failed) p.push(fmt.int(x.failed) + ' failed');
    p.push(x.signals ? word.plural(x.signals, 'signal') : 'no signals');
    p.push(x.bought ? 'bought ' + fmt.int(x.bought) : 'nothing bought');
    if (x.sold) p.push('sold ' + fmt.int(x.sold));
    return 'Last 24 h: ' + esc(p.join(' · '));
  }
  function hbCard(b, rise, fresh) {
    const hd = head('Heartbeat' + tip('heartbeat'), last24(b), '<button type="button" class="btn small" data-health>Health</button>');
    if (!Array.isArray(b.runs)) return sec('activity-heartbeat', 'ac-hbc', rise, hd + '<p class="empty">Checks: ' + na() + '</p>');
    const G = hbGrid(b, fresh), ks = new Set();
    G.H.rows.forEach(r => r.cells.forEach(x => ks.add(x.k)));
    const punct = word.punct(b);
    return sec('activity-heartbeat', 'ac-hbc', rise, hd + '<div class="ac-hbw"><div id="ac-hbg">' + G.html + '</div><div class="ac-hbs">'
      + (punct ? '<p class="ac-punct">' + esc(punct) + '</p>' : '')
      + legend(HBL.filter(([k]) => ks.has(k)).map(([k, w]) => ['ac-h-' + k, w]))
      + '<p class="cap">Every cell is a recorded check; tap one to replay it. Late = started more than ' + limit(b) + ' min after the close, so buys were skipped.' + tip('late') + '</p>'
      + (runsOf(b).length ? '' : '<p class="note">No checks yet. The first check after deployment lands here.</p>')
      + '</div></div>');
  }

  // ================================================================ punctuality strip (Health sheet) ==
  // §9.5: the last 42 slots as bars of minutes after the close, 0–60, with the limit drawn as a line; missed slots
  // dashed, failed red. Static (the sheet redraws on every poll, so it must not replay motion). Core adds the sentence.
  COMP.punctuality = function (b) {
    b = b || S.b;
    if (!b) return '';
    if (!Array.isArray(b.runs)) return '<p class="note">Punctuality strip: ' + na() + '</p>';
    const SM = slotModel(b), lim = limit(b), top = Math.max(60, lim + 15);
    const xs = []; for (let i = 41; i >= 0; i--) xs.push(slotInfo(SM.N - i * BAR, SM));
    const c = { ok: 0, late: 0, fail: 0, miss: 0 };
    const bars = xs.map(x => {
      if (x.k === 'pre' || x.k === 'future') return '<i class="ac-psb ac-p-pre"></i>';
      if (x.k === 'miss') { c.miss++; return '<i class="ac-psb ac-p-miss"></i>'; }
      if (x.k === 'next') return '<i class="ac-psb ac-p-next"></i>';
      const lm = num(x.runs[0].lm), k = x.k === 'fail' ? 'fail' : x.runs.some(r => !r.x && !r.ok) ? 'late' : 'ok';
      c[k]++;
      const h = lm == null ? 1 : Math.min(1, Math.max(0.04, lm / top));
      return '<i class="ac-psb ac-p-' + k + (lm != null && lm > top ? ' ac-p-over' : '') + '" style="--h:' + h.toFixed(3) + '"></i>';
    });
    const lab = 'Punctuality over the last 42 four-hour closes: ' + c.ok + ' on time, ' + c.late + ' late, ' + c.fail + ' failed, ' + c.miss
      + ' missed. Bars show the minutes after the close on a 0 to ' + top + ' scale; the limit is ' + lim + ' minutes.';
    return '<div class="ac-ps" role="img" aria-label="' + esc(lab) + '"><div class="ac-psg" style="--y:' + (lim / top).toFixed(3) + '">' + bars.join('')
      + '<i class="ac-psl"></i><span class="ac-psll">limit ' + lim + '</span><span class="ac-psy">' + top + ' min</span></div>'
      + '<div class="ac-psx"><span>' + esc(fmt.md(xs[0].s)) + '</span><span>now</span></div>'
      + legend([['ac-p-ok', 'On time'], ['ac-p-late', 'Late'], ['ac-p-fail', 'Failed'], ['ac-p-miss', 'Missed']]) + '</div>';
  };

  // ======================================================================================== timeline ==
  const TF = { trade: ['bought', 'sold', 'trail', 'sweep', 'notfilled'], blocked: ['blocked'], rec: ['recorded', 'proposed', 'expired'],
    health: ['late', 'failed', 'halt', 'resume', 'thr_halt', 'thr_half', 'recon', 'no_stop', 'close_failed', 'exit_failed', 'entry_failed', 'fallback', 'gap', 'not_on_exchange'] };
  const TFW = [['all', 'All'], ['trade', 'Bought & sold'], ['blocked', 'Blocked'], ['rec', 'Recorded'], ['health', 'Health']];
  const ACTED = new Set(['bought', 'sold', 'trail']);
  const WARNY = new Set(['blocked', 'late', 'gap', 'thr_half', 'entry_failed', 'not_on_exchange', 'fallback', 'notfilled']);
  function tlGroups(b) {
    const map = new Map();
    for (const r of runsOf(b)) if (r && r.t != null) map.set(r.t, { t: r.t, run: r, ev: [] });
    for (const e of arr(b.events)) {
      if (!Array.isArray(e) || e[0] == null) continue;
      let g = map.get(e[0]); if (!g) map.set(e[0], g = { t: e[0], run: null, ev: [] });
      g.ev.push(e);
    }
    return [...map.values()].sort((a, z) => z.t - a.t);
  }
  function evRow(e, nw) {
    const w = word.event(e), lv = Math.max(0, Math.min(3, w.lv || 0));
    const tone = lv >= 3 ? ' ac-bad' : ACTED.has(w.type) ? ' ac-act' : WARNY.has(w.type) ? ' ac-wrn' : '';
    return '<li class="ac-ev ac-lv' + lv + tone + '"><span class="ac-evi">' + icon(w.ic) + '</span><span class="ac-evt">' + w.html
      + (nw ? ' <span class="newdot" role="img" aria-label="new"></span>' : '') + '</span></li>';
  }
  function chkHead(g, hasRuns) {
    const r = g.run;
    if (!r) return '<div class="ac-chkh ac-off"><span class="ac-ct">' + esc(fmt.time(g.t)) + '</span><span class="ac-cs">'
      + (hasRuns ? 'outside a check' : 'check details ' + na()) + '</span></div>';
    const c = arr(r.c), bits = [];
    let s = word.run(r).s;
    if (r.x) { const f = (M.EV.get(r.t) || []).find(e => e[1] === 'failed'); if (f && f[6]) s += ' (' + f[6] + ')'; }
    bits.push(s);
    if (!r.x && c[0] != null) bits.push(word.plural(c[0], 'name'));
    if (!r.x) bits.push(c[1] ? word.plural(c[1], 'signal') : 'no signals');
    const eff = modeOf(S.b).eff === 'live' ? 'l' : 'p';
    if (r.m && r.m !== eff) bits.push(r.m === 'l' ? 'live' : 'paper');
    return '<button type="button" class="ac-chkh" data-cycle="' + r.t + '"><span class="ac-ct">' + esc(fmt.time(r.t)) + '</span><span class="ac-cs">'
      + esc(bits.join(' · ')) + '</span><span class="ac-go" aria-hidden="true">›</span></button>';
  }
  function chkHtml(g, isNew, fresh, hasRuns, quiet) {
    const evs = g.ev.length ? '<ul class="ac-evs">' + g.ev.map(e => evRow(e, isNew(e))).join('') + '</ul>' : '';
    return '<div class="ac-chk' + (quiet ? ' ac-q' : '') + (fresh && fresh.has(g.t) ? ' enter' : '') + '">' + chkHead(g, hasRuns) + evs + '</div>';
  }
  function quietHtml(list, isNew, fresh, hasRuns) {
    if (list.length === 1) return chkHtml(list[0], isNew, fresh, hasRuns, true);
    const key = list[0].t, open = M.folds.has(key), ts = list.map(g => fmt.time(g.t)).reverse();
    const lab = list.length + ' quiet checks · ' + (ts.length > 3 ? ts[0] + ' – ' + ts[ts.length - 1] : ts.join(', '));
    return '<div class="ac-fold"><button type="button" class="ac-foldb" data-ac="fold" data-k="' + key + '" aria-expanded="' + open + '">' + ICON.right
      + '<span>' + esc(lab) + '</span></button>' + (open ? '<div class="ac-foldx">' + list.map(g => chkHtml(g, isNew, fresh, hasRuns, true)).join('') + '</div>' : '') + '</div>';
  }
  function tlFilters() {
    return '<div class="fchips" role="group" aria-label="Show">' + TFW.map(([k, w]) => '<button type="button" class="fchip" data-ac-tf="' + k + '" aria-pressed="' + (M.tf === k) + '">' + w + '</button>').join('') + '</div>'
      + (M.coin ? '<div class="ac-coinf"><button type="button" class="fchip" data-ac="coin-x" aria-pressed="true" aria-label="Remove the ' + esc(M.coin) + ' filter">'
        + esc(M.coin) + ' ✕</button><button type="button" class="btn small ghost" data-name="' + esc(M.coin) + '">' + esc(M.coin) + ' details ›</button></div>' : '');
  }
  function tlBody(b, fresh) {
    const hasRuns = Array.isArray(b.runs);
    if (!hasRuns && !Array.isArray(b.events)) return '<p class="empty">Timeline: ' + na() + '</p>';
    const set = TF[M.tf] ? new Set(TF[M.tf]) : null, coin = M.coin, filt = !!(set || coin);
    const keep = e => (!set || set.has(e[1])) && (!coin || e[2] === coin);
    const G = tlGroups(b).map(g => ({ t: g.t, run: g.run, ev: g.ev.filter(keep).sort((a, z) => (z[5] || 0) - (a[5] || 0)) })).filter(g => !filt || g.ev.length);
    if (!G.length) return '<p class="empty">' + (filt ? 'Nothing matches this filter in the last 7 days.' : 'Nothing recorded yet.') + '</p>';
    const cut = lday(G[0].t * 1000) - 2;                               // the three newest local days show by default
    const older = G.filter(g => lday(g.t * 1000) < cut);
    const shown = M.earlier ? G : G.filter(g => lday(g.t * 1000) >= cut);
    const seen = Number(S.seenEv) || 0;
    const isNew = e => seen > 0 && e[0] > seen && (e[5] || 0) >= 1;
    let h = '', day = null, marked = seen <= 0, anyNew = false, quiet = [];
    const flush = () => { if (quiet.length) { h += quietHtml(quiet, isNew, fresh, hasRuns); quiet = []; } };
    for (const g of shown) {
      if (!marked && g.t <= seen) { flush(); if (anyNew) h += '<div class="ac-new" id="activity-new" role="separator" aria-label="New since your last visit above"><span class="ac-newp">New since your last visit</span></div>'; marked = true; }
      const dk = lday(g.t * 1000);
      if (dk !== day) { flush(); h += '<h3 class="ac-dayh">' + esc(fmt.dayLong(g.t)) + '</h3>'; day = dk; }
      if (!filt && g.run && !g.ev.some(e => (e[5] || 0) >= 1)) { quiet.push(g); continue; }  // quiet checks fold
      flush();
      if (g.ev.some(isNew)) anyNew = true;
      h += chkHtml(g, isNew, fresh, hasRuns, false);
    }
    flush();
    if (older.length) {
      const nd = new Set(older.map(g => lday(g.t * 1000))).size;
      h += '<div class="ac-more"><button type="button" class="btn small" data-ac="earlier" aria-expanded="' + M.earlier + '">'
        + (M.earlier ? 'Show only the last 3 days' : 'Show earlier · ' + word.plural(nd, 'day')) + '</button></div>';
    }
    return h;
  }
  function tlCard(b, rise, fresh) {
    return sec('activity-timeline', 'ac-tlc', rise, head('Timeline', 'Every check and what it did, newest first. Tap a coin to filter.')
      + '<div class="ac-tlf">' + tlFilters() + '</div><div class="ac-tlb" id="ac-tlb">' + tlBody(b, fresh) + '</div>');
  }

  // ========================================================================================= signals ==
  const CHK_S = { vol: 'volume', oi: 'open interest', fund: 'funding', days: 'history', lev: 'leverage', list: 'not listed', uni: 'universe',
    halt: 'halted', thr: 'throttle', fresh: 'late data', recon: 'reconciliation', sizing: 'sizing', dup: 'already held', maxpos: 'max positions',
    equity: 'equity', cap: 'open-risk cap', gross: 'gross exposure', bookcap: 'book risk cap', sanity: 'price sanity', drift: 'price drift', recheck: 're-check' };
  const CHK_L = { vol: 'Volume below the minimum', oi: 'Open interest below the minimum', fund: 'Funding above the limit', days: 'Not enough history',
    lev: 'Leverage below the minimum', list: 'Not listed on the exchange', uni: 'Universe filters', halt: 'Halted', thr: 'Drawdown throttle',
    fresh: 'Check ran late (data too old)', recon: 'Reconciliation mismatch', sizing: 'Sizing not accepted', dup: 'Already held',
    maxpos: 'At max positions', equity: 'Equity check', cap: 'Open-risk cap reached', gross: 'Gross exposure cap reached',
    bookcap: 'Book risk cap reached', sanity: 'Price outside the sanity band', drift: 'Price ran above the signal', recheck: 'Re-check failed' };
  const EMPTY_SIG = 'No signals yet. Signals appear when a 4-hour cloud flips or pulls back while weekly and daily agree.';
  const TINT = 'color-mix(in srgb,var(--accent) 45%,transparent)';     // magenta tint tier: "the funnel bar at Bought"
  // A funnel or reason row on the shared .bar (label, track, count). The fill grows by scaleX from the last drawn
  // value (0 on first view); a nonzero count always keeps a visible sliver.
  function fbar(key, label, n, max, fill, sub, side) {
    const k = n > 0 && max > 0 ? Math.min(1, Math.max(0.012, n / max)) : 0;
    const from = M.k[key] != null ? M.k[key] : 0;
    return '<div class="bar ac-fb' + (side ? ' ac-side' : '') + (String(label).indexOf('class="tip"') >= 0 ? ' ac-fbt' : '') + '"><span class="name">' + (side ? '<span class="ac-el" aria-hidden="true">└</span>' : '')
      + '<span>' + label + (sub ? ' <span class="sub">' + esc(sub) + '</span>' : '') + '</span></span>'
      + '<div class="track"><div class="fill" data-k="' + k.toFixed(4) + '" data-kk="' + esc(key) + '" style="--fill:' + (fill || 'color-mix(in srgb,var(--ink-2) 55%,transparent)') + ';--k:' + from + '"></div></div>'
      + '<span class="num">' + (n == null ? na(true) : esc(fmt.int(n))) + '</span></div>';
  }
  function funnelHtml(b) {
    const F = b.funnel && b.funnel[M.win];
    if (!F || typeof F !== 'object') return '<p class="empty">Funnel: ' + na() + '</p>';
    const ck = num(F.checks), sg = num(F.signals), bo = num(F.bought), mx = Math.max(1, ck || 0), sx = Math.max(1, sg || 0);
    const main = [
      ['checks', 'Name checks', ck],
      ['signals', 'Signals', sg],
      ['passed', 'Passed every check' + tip('checks'), num(F.passed)],
      ['auto', 'Auto grade among them' + tip('auto'), num(F.auto_passed), null, F.auto != null ? 'of ' + word.plural(F.auto, 'auto-grade signal') : ''],
      ['bought', 'Bought', bo, TINT],
    ];
    const bc = Object.entries(F.by_check && typeof F.by_check === 'object' ? F.by_check : {}).filter(x => n0(x[1]) > 0).sort((a, z) => z[1] - a[1]);
    const bsub = [bc.slice(0, 3).map(([k, n]) => (CHK_S[k] || k) + ' ' + fmt.int(n)).join(', ') + (bc.length > 3 ? ', …' : ''),
      F.blocked_auto ? 'auto grade ' + fmt.int(F.blocked_auto) : ''].filter(Boolean).join('; ');
    const side = [
      ['blocked', 'Blocked by a check', num(F.blocked), 'var(--warn)', bsub ? '(' + bsub + ')' : ''],
      ['recorded', 'Recorded, watch-only' + tip('watch'), num(F.recorded), 'var(--ink-2)'],
      ['expired', 'Expired, old approval model', num(F.expired), 'var(--muted)'],
      ['notfilled', 'Order not filled', num(F.notfilled), 'var(--bad)'],
      ['bought', 'Bought', bo, TINT],
    ];
    const rest = sg != null ? sg - side.reduce((s, x) => s + (x[2] || 0), 0) : 0;
    if (rest > 0) side.push(['unlogged', 'Outcome not logged', rest, 'var(--line-2)']);   // never infer by absence without saying so
    return '<div class="bars ac-fun">' + main.map(x => fbar('m' + M.win + x[0], x[1], x[2], mx, x[3], x[4])).join('')
      + '<p class="ac-subh">Where ' + (sg != null ? 'the ' + esc(word.plural(sg, 'signal')) : 'the signals') + ' went</p>'
      + side.map(x => fbar('s' + M.win + x[0], x[1], x[2], sx, x[3], x[4], true)).join('') + '</div>';
  }
  function whyHtml(b) {
    const F = b.funnel && b.funnel[M.win];
    if (!F || typeof F !== 'object') return '';
    const items = Object.entries(F.by_check && typeof F.by_check === 'object' ? F.by_check : {}).filter(x => n0(x[1]) > 0)
      .map(([k, n]) => ['w' + k, CHK_L[k] || cap1(word.reason(k)), n0(n), 'var(--warn)']);
    if (n0(F.recorded) > 0) items.push(['wrec', 'Watch-only grade (by design)', n0(F.recorded), 'var(--ink-2)']);
    if (n0(F.expired) > 0) items.push(['wexp', 'Proposal expired', n0(F.expired), 'var(--muted)']);
    if (n0(F.notfilled) > 0) items.push(['wnf', 'Order not filled', n0(F.notfilled), 'var(--bad)']);
    items.sort((a, z) => z[2] - a[2]);
    const h = '<div class="ac-whyw"><h3 class="ac-h3">Why signals did not trade</h3>';
    if (!items.length) return h + '<p class="note">' + (n0(F.signals) ? 'Every signal in this period was bought.' : 'No signals in this period.') + '</p></div>';
    return h + '<div class="bars ac-why">' + items.map(x => fbar(x[0] + M.win, esc(x[1]), x[2], items[0][2], x[3])).join('') + '</div></div>';
  }
  function tbtn(t) {
    return runAt(t) ? '<button type="button" class="ac-tbtn" data-cycle="' + t + '" aria-label="Open the ' + esc(at(t)) + ' check">' + esc(at(t)) + '</button>'
      : '<span class="ac-tbtn ac-off">' + esc(at(t)) + '</span>';
  }
  function pinHtml(b) {
    if (!Array.isArray(b.pinned)) return '<h3 class="ac-h3">Would have traded</h3><p class="note">' + na() + '</p>';
    const P = b.pinned.filter(Array.isArray);
    let h = '<h3 class="ac-h3">Would have traded' + tip('auto') + '</h3>';
    if (!P.length) return h + '<p class="note">None: no auto-grade signal has been blocked.</p>';
    h += '<p class="sub ac-pins">Auto-grade signals a safety check blocked, newest first.</p><ul class="ac-pinl">'
      + (M.pinAll ? P : P.slice(0, 3)).map(([t, c, kind, code, v]) => '<li class="ac-pinr">' + tbtn(t) + chip(c, t) + '<span>' + esc(word.kind(kind, true))
        + '</span><span class="pill auto">Auto grade</span><span class="ac-pw">Blocked: ' + esc(word.reason(code, v, true)) + '.</span></li>').join('') + '</ul>';
    if (P.length > 3) h += '<div class="ac-more"><button type="button" class="btn small" data-ac="pins" aria-expanded="' + M.pinAll + '">'
      + (M.pinAll ? 'Show fewer' : 'Show all ' + P.length) + '</button></div>';
    return h;
  }
  function sigSeg() {
    return '<div class="seg quiet ac-win" role="group" aria-label="Period"><span class="ind"></span>'
      + [['all', 'Since start'], ['week', 'This week']].map(([v, w]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (M.win === v) + '">' + w + '</button>').join('') + '</div>';
  }
  function noSignals(b) { const Fa = b.funnel && b.funnel.all; return !!Fa && num(Fa.signals) === 0 && !arr(b.pinned).length; }
  function sigCard(b, rise) {
    if (noSignals(b)) return sec('activity-signals', 'ac-sig', rise, head('Signals' + tip('signal'), 'What every signal became') + '<p class="empty">' + EMPTY_SIG + '</p>');
    return sec('activity-signals', 'ac-sig', rise, head('Signals' + tip('signal'), 'What every signal became', sigSeg())
      + '<div id="ac-fun">' + funnelHtml(b) + whyHtml(b) + '</div><div id="ac-pin">' + pinHtml(b) + '</div>');
  }

  // ---------------------------------------------------------------------------------- outcome list ----
  const SIG_OUT = new Set(['blocked', 'recorded', 'expired', 'notfilled', 'bought']);
  const SF = [['all', 'All'], ['blocked', 'Blocked'], ['recorded', 'Recorded'], ['expired', 'Expired'], ['notfilled', 'Not filled'], ['bought', 'Bought']];
  const OUTP = { blocked: ['warn', 'Blocked'], recorded: ['mute', 'Recorded'], expired: ['mute', 'Expired'], notfilled: ['bad', 'Not filled'], bought: ['ac-buy', 'Bought'] };
  // Rows come from the lazy ledger; until it lands (or when it can't), the last 7 days of events stand in, and say so.
  function listSource(b) {
    const sg = M.L && M.L.signals;
    if (sg && Array.isArray(sg.rows)) { const rows = sg.rows.filter(Array.isArray); return { rows, total: num(sg.total) != null ? num(sg.total) : rows.length, from: 'ledger' }; }
    const rows = arr(b.events).filter(e => Array.isArray(e) && SIG_OUT.has(e[1])).map(e => {
      const cs = e[1] === 'blocked' ? word.codes(e[6]) : [];
      return [e[0], e[2], bookOf(b, e[2]), e[3], e[4], e[1], cs[0] ? cs[0][0] : null, cs[0] ? cs[0][1] : null];
    });
    return { rows, total: rows.length, from: M.L === undefined ? 'loading' : 'events', noEv: !Array.isArray(b.events) };
  }
  function rowWhy(r) {
    const [t, c, , , tier, out, code, v] = r;
    if (out === 'blocked') {
      const e = (M.EV.get(t) || []).find(x => x[1] === 'blocked' && x[2] === c);   // the event carries every failing check
      const cs = e && e[6] ? word.codes(e[6]) : code ? [[code, v]] : [];
      return 'Blocked by a check: ' + (cs.length ? word.reasons(cs, true) : 'not recorded');
    }
    if (out === 'recorded') return tier === 'B' ? 'Watch-only grade: recorded, not traded' : 'Recorded, not traded';
    if (out === 'expired') return 'Proposal expired (old approval model)';
    if (out === 'notfilled') return 'Order not filled';
    if (out === 'bought') return 'Passed every check and bought';
    return word.outcome(out);
  }
  function kindPill(kind, tier) {
    const k = esc(cap1(word.kind(kind)));
    return tier === 'A' ? '<span class="pill auto">' + k + ' · Auto grade</span>' : tier === 'B' ? '<span class="pill mute">' + k + ' · Watch-only</span>' : '<span class="pill mute">' + k + '</span>';
  }
  function outPill(o) { const p = OUTP[o] || ['mute', word.outcome(o)]; return '<span class="pill ' + p[0] + '">' + esc(p[1]) + '</span>'; }
  function listChips(src) {
    const cnt = {}; for (const r of src.rows) cnt[r[5]] = (cnt[r[5]] || 0) + 1;
    return '<div class="fchips ac-sf" role="group" aria-label="Show">' + SF.map(([k, w]) => '<button type="button" class="fchip" data-ac-sf="' + k + '" aria-pressed="' + (M.sf === k) + '">'
      + w + ' <span class="sub">' + fmt.int(k === 'all' ? src.rows.length : cnt[k] || 0) + '</span></button>').join('') + '</div>';
  }
  function listBody(b, src) {
    let note = '';
    if (src.from === 'loading') note = '<p class="note ac-ln">Showing the last 7 days · loading the full list…</p>';
    else if (src.from === 'events') note = '<p class="note ac-ln">The full list is ' + (S.ledgerErr && S.ledgerErr !== 'missing' ? 'unavailable right now' : 'not in this data')
      + (src.noEv ? '' : '; showing the last 7 days') + '. <button type="button" class="btn small" data-ac="ledger">Try again</button></p>';
    const rows = M.sf === 'all' ? src.rows : src.rows.filter(r => r[5] === M.sf);
    if (!rows.length) return note + '<p class="empty">' + (src.rows.length ? 'No signal with this outcome.' : src.from === 'loading' ? 'Loading…' : src.noEv ? 'Signals: ' + na() : 'No signals yet.') + '</p>';
    const shown = rows.slice(0, M.sn), more = rows.length - shown.length;
    const body = M.wide
      ? '<div class="tbl"><table><thead><tr><th class="l">When</th><th class="l">Coin</th><th class="l">Book</th><th class="l">Signal</th><th class="l">Outcome</th><th class="l">Why</th></tr></thead><tbody>'
        + shown.map(r => '<tr><td class="l">' + tbtn(r[0]) + '</td><td class="l">' + chip(r[1], r[0]) + '</td><td class="l sub">' + esc(r[2] || '—') + '</td><td class="l">'
          + kindPill(r[3], r[4]) + '</td><td class="l">' + outPill(r[5]) + '</td><td class="l ac-wcell">' + esc(rowWhy(r)) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<ul class="list ac-sgs">' + shown.map(r => '<li class="ac-sg"><div class="ac-sgh">' + tbtn(r[0]) + chip(r[1], r[0]) + '<span class="ac-sgo">' + outPill(r[5]) + '</span>'
          + '</div><div class="ac-sgw">' + kindPill(r[3], r[4]) + ' <span>' + esc(rowWhy(r)) + '</span></div></li>').join('') + '</ul>';
    const trunc = src.from === 'ledger' && src.total > src.rows.length ? 'Latest ' + fmt.int(src.rows.length) + ' of ' + fmt.int(src.total) : '';
    const foot = more > 0 || trunc ? '<div class="ac-foot"><span class="sub">' + trunc + '</span>'
      + (more > 0 ? '<button type="button" class="btn small" data-ac="more">Show ' + Math.min(50, more) + ' more</button>' : '') + '</div>' : '';
    return note + body + foot;
  }
  function listCard(b, rise) {
    if (noSignals(b)) return '';                                       // the Signals card already says there are none
    const src = listSource(b);
    return sec('activity-outcomes', 'ac-slc', rise, head('Every signal', 'Newest first: what it became and why')
      + '<div id="ac-sgf">' + listChips(src) + '</div><div id="ac-sgl">' + listBody(b, src) + '</div>');
  }

  // ============================================================================ the board over time ==
  const OUTC = { blocked: 'r', recorded: 'p', proposed: 'P', notfilled: 'e', bought: 'E' };
  // One column per run. A counts-only run (rd null) is hatched, except the coins it names: held coins from hx, and
  // triggered coins from tg with the outcome taken from that run's events ("outcome not logged" when there is none).
  function tapeCols(b) {
    return runsOf(b).map(r => {
      if (typeof r.rd === 'string' && r.rd.length) return { r, rd: r.rd };
      const m = {}, evs = M.EV.get(r.t) || [];
      for (const c in (r.hx && typeof r.hx === 'object' ? r.hx : {})) m[c] = 'h';
      for (const c in (r.tg && typeof r.tg === 'object' ? r.tg : {})) {
        const e = evs.find(x => x[2] === c && OUTC[x[1]]), rx = r.rx && r.rx[c];
        m[c] = e ? OUTC[e[1]] : rx ? (arr(rx).some(p => Array.isArray(p) && p[0] === 'fill') ? 'e' : 'r') : 'm';
      }
      return { r, map: m };
    });
  }
  function codeAt(col, j, c) { const ch = col.rd ? col.rd.charAt(j) : col.map[c]; return ch && STAGE[ch] ? ch : '-'; }
  function bookGroups(b, order) {
    const inO = new Set(order), used = new Set(), out = [];
    for (const bk of arr(b.books)) {
      if (!bk) continue;
      const ns = arr(bk.names).map(x => Array.isArray(x) ? x[0] : x).filter(c => inO.has(c) && !used.has(c));
      ns.forEach(c => used.add(c)); if (ns.length) out.push({ b: bk.b || '', names: ns });
    }
    const rest = order.filter(c => !used.has(c)); if (rest.length) out.push({ b: out.length ? 'other' : '', names: rest });
    return out;
  }
  function rowSentence(c, codes, runs) {
    let seg = [];
    codes.forEach((ch, i) => { const l = seg[seg.length - 1]; if (l && l.ch === ch) { l.n++; l.j = i; } else seg.push({ ch, i, j: i, n: 1 }); });
    const cut = seg.length > 12; if (cut) seg = seg.slice(-12);
    const w = ch => ch === '-' ? 'not recorded' : lc1(stage(ch).w);
    const parts = seg.map((g, k) => w(g.ch) + (k === seg.length - 1 ? (seg.length > 1 ? ' since ' : ' at every check since ') + at(runs[g.i].t)
      : g.n > 1 ? ' from ' + at(runs[g.i].t) + ' to ' + at(runs[g.j].t) : ' ' + at(runs[g.i].t)));
    return c + ': ' + (cut ? 'earlier changes not listed; ' : '') + parts.join('; ') + '.';
  }
  function gateCounts(run) {                                           // the mini Gate Run line (§6.4)
    if (typeof run.rd === 'string' && run.rd.length) {
      const cs = [...run.rd].filter(c => c !== '-' && c !== 'h' && STAGE[c]), g = c => STAGE[c].gate || 0;
      return [[cs.length, 'names', 'names checked'], [cs.filter(c => g(c) > 2).length, 'weekly', 'weekly bullish'], [cs.filter(c => g(c) > 3).length, 'daily', 'daily bullish'],
        [cs.filter(c => g(c) > 4).length, 'signals', 'signals'], [cs.filter(c => c === 'E').length, 'bought', 'bought']];
    }
    const c = arr(run.c);
    return [[num(c[0]), 'names', 'names checked'], [null, 'weekly', 'weekly bullish'], [null, 'daily', 'daily bullish'], [num(c[1]), 'signals', 'signals'], [num(c[4]), 'bought', 'bought']];
  }
  function miniHtml(run) {
    if (!run) return '';
    const open = '<button type="button" class="btn small" data-cycle="' + run.t + '">Open</button>';
    if (run.x) return '<span class="ac-mt">This check stopped early; no names were read.</span>' + open;
    const f = gateCounts(run);
    return '<span class="ac-mh">Gate Run' + tip('gateRun') + '</span><ol class="ac-mfl" aria-label="' + esc(f.map(([v, , w]) => (v == null ? 'not recorded' : v) + ' ' + w).join(', ')) + '">'
      + f.map(([v, w]) => '<li><b>' + (v == null ? '—' : esc(fmt.int(v))) + '</b><span>' + w + '</span></li>').join('') + '</ol>' + open;
  }
  function tapeCard(b, rise) {
    const hd = head('The board over time', 'Every name at every recorded check, newest on the right');
    const runs = runsOf(b), order = arr(b.order).filter(c => typeof c === 'string');
    if (!Array.isArray(b.runs) || !order.length) return sec('activity-tape', 'ac-tp', rise, hd + '<p class="empty">The board: ' + na() + '</p>');
    if (!runs.length) return sec('activity-tape', 'ac-tp', rise, hd + '<p class="empty">No checks recorded yet.</p>');
    const cols = tapeCols(b), n = runs.length, idx = new Map(order.map((c, j) => [c, j])), present = new Set();
    let rows = '';
    for (const g of bookGroups(b, order)) {
      if (g.b) rows += '<div class="ac-tbk">' + esc(g.b) + '</div>';
      for (const c of g.names) {
        const j = idx.get(c), codes = cols.map(col => codeAt(col, j, c));
        codes.forEach(ch => present.add(ch));
        rows += '<div class="ac-tr"><button type="button" class="ac-tlab" data-name="' + esc(c) + '" aria-label="' + esc(c) + ' details">' + esc(c) + '</button>'
          + '<span class="ac-tcs" role="img" aria-label="' + esc(rowSentence(c, codes, runs)) + '">' + codes.map(ch => '<i class="' + STAGE[ch].cls + '"></i>').join('') + '</span></div>';
      }
    }
    let days = '', prev = null;
    runs.forEach((r, i) => { const d = lday(r.t * 1000); if (d !== prev) { days += '<span class="ac-tday" style="grid-column:' + (i + 1) + '">' + esc(fmt.wd(r.t)) + '</span>'; prev = d; } });
    let nr = '';
    for (let i = 0; i < n;) {
      if (cols[i].rd) { i++; continue; }
      const f = !!cols[i].r.x; let j = i;
      while (j + 1 < n && !cols[j + 1].rd && !!cols[j + 1].r.x === f) j++;
      nr += '<span class="ac-tnr' + (f ? ' ac-tfl' : '') + '" style="grid-column:' + (i + 1) + '/span ' + (j - i + 1) + '" title="' + (f ? 'check failed' : 'not recorded') + '"><em>' + (f ? 'failed' : 'not recorded') + '</em></span>';
      i = j + 1;
    }
    const hdr = '<div class="ac-tr ac-thd" aria-hidden="true"><span class="ac-tlab"></span><span class="ac-tcs">' + days + '</span></div>'
      + (nr ? '<div class="ac-tr ac-thd ac-tnrs" aria-hidden="true"><span class="ac-tlab"></span><span class="ac-tcs">' + nr + '</span></div>' : '');
    const ctl = '<div class="ac-tctl">' + (reduced ? '' : '<button type="button" class="btn small ac-play" data-ac="play" aria-pressed="false">' + ICON.play + '<span>Play</span></button>')
      + '<input class="ac-scrub" type="range" min="0" max="' + (n - 1) + '" step="1" value="' + (n - 1) + '" aria-label="Choose a check to show"></div>'
      + '<div class="ac-tnow"><span class="ac-tt"></span><span class="sub ac-ts"></span><button type="button" class="btn small ghost ac-back" data-ac="latest" hidden>Back to latest</button></div>';
    const leg = legend(Object.keys(STAGE).filter(ch => present.has(ch)).map(ch => ['ac-tsw ' + STAGE[ch].cls, ch === '-' ? 'Not recorded' : STAGE[ch].w]));
    return sec('activity-tape', 'ac-tp', rise, hd + ctl + '<div class="ac-tsc" data-mask aria-label="The board over time"><div class="ac-tg" style="--n:' + n + '" data-n="' + n + '">'
      + hdr + rows + '<div class="ac-tov" aria-hidden="true"><i class="ac-tveil"></i><i class="ac-tcur"></i></div></div></div><div class="ac-mini" id="ac-mini"></div>' + leg);
  }
  // Column width: max(5px, floor((inner − 48) / runs)), capped so a young tape does not turn into a bar chart.
  function layoutTape() {
    const root = M.root, g = root && $('.ac-tg', root); if (!g) return;
    const sc = g.parentElement, n = Number(g.dataset.n) || 1;
    const cw = Math.max(5, Math.min(32, Math.floor((sc.clientWidth - LW - (n - 1)) / n)));
    if (cw !== M.cw || !g.style.getPropertyValue('--cw')) { M.cw = cw; g.style.setProperty('--cw', cw + 'px'); }
    let right = -Infinity;
    $$('.ac-tday', g).forEach(el => { el.style.visibility = ''; const l = el.offsetLeft; if (l < right + 6) el.style.visibility = 'hidden'; else right = l + el.scrollWidth; });
    $$('.ac-tnr', g).forEach(el => el.classList.toggle('ac-fit', el.clientWidth >= 72));
    paintCursor();
  }
  function colAt(x) {
    const ov = M.root && $('.ac-tov', M.root), n = runsOf().length; if (!ov) return null;
    const i = Math.floor((x - ov.getBoundingClientRect().left) / ((M.cw || 6) + 1));
    return i >= 0 && i < n ? i : null;
  }

  // ----------------------------------------------------------------------------- Play (tape replay) ----
  // Honest motion: it moves only because the owner pressed Play. One column every 600 ms; a tap anywhere, hiding the
  // page or leaving the tab stops it. No Play with reduced motion (the scrubber stays).
  function paintPlay(on) {
    const btn = M.root && $('.ac-play', M.root); if (!btn) return;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = (on ? ICON.pause : ICON.play) + '<span>' + (on ? 'Pause' : 'Play') + '</span>';
  }
  function onPointer(e) { if (e.target instanceof Element && e.target.closest('.ac-play')) return; playStop(); }
  function playStop() {
    if (!M.play) return;
    clearInterval(M.play); M.play = 0;
    setPlay('ac-tape', false);
    document.removeEventListener('pointerdown', onPointer, true);
    paintPlay(false);
  }
  function playStart() {
    const runs = runsOf(); if (reduced || runs.length < 2 || M.play) return;
    let i = S.cursor != null ? runs.findIndex(r => r.t === S.cursor) : -1;
    if (i < 0 || i >= runs.length - 1) i = -1;                        // from the latest (or the end): start over
    const step = () => {
      const rs = runsOf(); i++;
      if (i >= rs.length - 1) { playStop(); setCursor(null, { sheet: false }); return; }
      setCursor(rs[i].t, { sheet: false });
    };
    setPlay('ac-tape', true);
    M.play = setInterval(step, 600);
    document.addEventListener('pointerdown', onPointer, true);
    paintPlay(true);
    step();
  }

  // ======================================================================== the shared cursor (§5) ==
  // Followers here: the heartbeat's selected cell (ink outline) and the tape's cursor column (accent outline, later
  // columns veiled), the scrubber, the cursor time and the mini Gate Run line.
  function paintCursor() {
    const root = M.root; if (!root || !S.b) return;
    const runs = runsOf(), last = lastRun();
    const i = S.cursor != null ? runs.findIndex(r => r.t === S.cursor) : -1, on = i >= 0, run = on ? runs[i] : last;
    $$('.ac-hc.ac-sel', root).forEach(el => el.classList.remove('ac-sel'));
    if (on) { const c = $('.ac-hc[data-slot="' + slotOf(run) + '"]', root); if (c) c.classList.add('ac-sel'); }
    const g = $('.ac-tg', root); if (!g) return;
    const cw = M.cw || 6, cur = on ? i : Math.max(0, runs.indexOf(last));
    g.classList.toggle('ac-on', on);
    if (on) {
      $('.ac-tcur', g).style.transform = 'translateX(' + i * (cw + 1) + 'px)';
      $('.ac-tveil', g).style.transform = 'translateX(' + (i + 1) * (cw + 1) + 'px)';
      const sc = g.parentElement, x = LW + i * (cw + 1);                 // keep the cursor column in view in a scrolling tape
      if (sc.scrollWidth > sc.clientWidth && (x < sc.scrollLeft + LW || x + cw > sc.scrollLeft + sc.clientWidth)) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
    }
    const sb = $('.ac-scrub', root);
    if (sb) { sb.value = String(cur); sb.setAttribute('aria-valuetext', run ? at(run.t) : '—'); }
    const tt = $('.ac-tt', root), ts = $('.ac-ts', root), bk = $('.ac-back', root), mini = $('#ac-mini', root);
    if (tt) tt.textContent = run ? at(run.t) : '—';
    if (ts) ts.textContent = run ? (on ? '' : 'latest check · ') + word.run(run).s : '';
    if (bk) bk.hidden = !on;
    if (mini) mini.innerHTML = miniHtml(run);
  }
  onCursor(() => paintCursor());

  // ==================================================================================== All readings ==
  function dirHtml(v, held) {
    if (held && v == null) return '<span class="sub" title="not read while held">—</span>';   // the check manages its exit instead
    return '<i class="ac-d ac-d' + (v === 1 ? '1' : v === 0 ? '0' : 'n') + '" aria-hidden="true"></i>' + word.dir(v);
  }
  // compact (phone cards): a limit shows only beside a failing value; the intro states the limits once.
  function rdFields(n, compact) {
    const u = (S.b && S.b.cfg && S.b.cfg.uni) || {}, held = n.st === 'h', known = Array.isArray(n.elig);
    const fails = new Set(arr(n.elig).map(p => Array.isArray(p) ? p[0] : p));
    const mk = code => !known ? '' : fails.has(code) ? ' <span class="ac-x" role="img" aria-label="fails">✕</span>' : ' <span class="ac-ok" role="img" aria-label="passes">✓</span>';
    const lim = (code, s) => s != null && (!compact || fails.has(code)) ? ' <span class="sub">(' + esc(s) + ')</span>' : '';
    const v = (x, f) => x == null ? na(true) : f(x);
    const out = [];
    if (!(compact && held && n.dist == null)) out.push(['Line', held && n.dist == null ? '<span class="sub">not read while held</span>' : v(n.dist, d => esc(word.dist(d)))]);
    out.push(['Volume', v(n.vx, x => esc(fmt.x(x)) + ' the minimum' + mk('vol'))]);
    out.push(['Funding', v(n.fund, x => esc(fmt.fund(x)) + lim('fund', u.fund_pct != null ? 'limit ' + u.fund_pct : null) + mk('fund'))]);
    out.push(['History', v(n.days, x => esc(fmt.int(x)) + ' days' + lim('days', u.days != null ? 'needs ' + u.days : null) + mk('days'))]);
    if (n.ox != null || !compact) out.push(['Open interest', n.ox != null ? esc(fmt.x(n.ox)) + ' the minimum' + mk('oi') : '<span class="sub">checked when a signal fires</span>']);
    out.push(['Range', n.rg ? esc(word.range(n.rg)) : na(true)]);
    return out;
  }
  function readBody(b) {
    if (!b || !Array.isArray(b.names)) return '<p class="empty">Readings: ' + na() + '</p>';
    const ns = b.names.filter(n => n && n.c);
    if (!ns.length) return '<p class="empty">The last check read no names.</p>';
    const u = (b.cfg && b.cfg.uni) || {};
    const intro = '<p class="note ac-rdi">Line distance: “needs”' + tip('needs') + ' is how far the next 4-hour close must rise to cross the line; “cushion”' + tip('cushion')
      + ' is how far it sits above. Range only matters for watch-only pullbacks. Tradeable coins need volume of at least the minimum'
      + (u.fund_pct != null ? ', funding under ' + esc(u.fund_pct) + '%/yr' : '') + (u.days != null ? ' and ' + esc(u.days) + ' days of history' : '') + ' (market figures, not your money).'
      + (!M.wide && ns.some(n => n.ox == null) ? ' Open interest is checked when a signal fires.' : '') + '</p>';
    if (M.wide) return intro + '<div class="tbl"><table><thead><tr><th class="l">Coin</th><th class="l">Stage</th><th class="l">Weekly</th><th class="l">Daily</th><th class="l">4-hour</th>'
      + '<th class="l">Line</th><th class="l">Volume</th><th class="l">Funding</th><th class="l">History</th><th class="l">Open interest</th><th class="l">Range</th></tr></thead><tbody>'
      + ns.map(n => { const held = n.st === 'h', f = rdFields(n); return '<tr class="' + stage(n.st).cls + '"><td class="l ac-rdc">' + chip(n.c) + '</td><td class="l"><span class="stg-word">' + esc(stage(n.st).w) + '</span></td>'
        + '<td class="l">' + dirHtml(n.w, held) + '</td><td class="l">' + dirHtml(n.d, held) + '</td><td class="l">' + dirHtml(n.h4, held) + '</td>'
        + f.map(([, x]) => '<td class="l">' + x + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    return intro + '<ul class="ac-rdl">' + ns.map(n => {
      const held = n.st === 'h', unread = held && n.w == null && n.d == null && n.h4 == null;
      const items = (unread ? [] : [['Weekly', dirHtml(n.w, held)], ['Daily', dirHtml(n.d, held)], ['4-hour', dirHtml(n.h4, held)]]).concat(rdFields(n, true));
      return '<li class="ac-rd ' + stage(n.st).cls + '"><div class="ac-rdh">' + chip(n.c) + '<span class="stg-word">' + esc(stage(n.st).w) + '</span><span class="sub">' + esc(n.b || '') + '</span></div>'
        + (unread ? '<p class="ac-rdn">Not read while held: each check manages its exit instead.</p>' : '')
        + '<ul class="ac-rdf">' + items.map(([k, x]) => '<li><span class="ac-dl">' + k + '</span> ' + x + '</li>').join('') + '</ul></li>';
    }).join('') + '</ul>';
  }
  function readCard(b, rise) {
    const ns = Array.isArray(b.names) ? b.names.filter(n => n && n.c) : null, lr = lastRun(b);
    return '<details class="disc ac-rdx' + rise + '" id="activity-readings"' + (M.rdOpen ? ' open' : '') + '><summary><span>Every name, last check</span>'
      + (ns ? '<span class="pill mute">' + ns.length + '</span>' : '') + '<span class="sub ac-rdas">' + (lr ? 'as of ' + esc(at(lr.t)) : '') + '</span></summary>'
      + '<div class="body" id="ac-rdb">' + (M.rdOpen ? readBody(b) : '') + '</div></details>';
  }

  // ================================================================================ partial repaints ==
  // A filter or disclosure redraws only its own part, keeping focus on the control that was used.
  function focusKey(a) {
    if (!(a instanceof Element) || !M.root || !M.root.contains(a)) return null;
    for (const k of ['data-ac-tf', 'data-ac-sf', 'data-ac']) if (a.hasAttribute(k)) return '[' + k + '="' + a.getAttribute(k) + '"]' + (a.dataset.k ? '[data-k="' + a.dataset.k + '"]' : '');
    return null;
  }
  function keepFocus(fn) {
    const key = focusKey(document.activeElement);
    fn();
    if (key && M.root) { const el = $(key, M.root) || (key.indexOf('coin-x') >= 0 ? $('[data-ac-tf="all"]', M.root) : null); if (el) try { el.focus({ preventScroll: true }); } catch (e) {} }
  }
  function repaintTimeline() { const r = M.root; if (!r || !S.b) return; keepFocus(() => { const f = $('.ac-tlf', r), x = $('#ac-tlb', r); if (f) f.innerHTML = tlFilters(); if (x) x.innerHTML = tlBody(S.b, null); }); }
  function repaintFunnel() { const r = M.root, x = r && $('#ac-fun', r); if (!x || !S.b) return; x.innerHTML = funnelHtml(S.b) + whyHtml(S.b); growBars(x); }
  function repaintPins() { const r = M.root, x = r && $('#ac-pin', r); if (!x || !S.b) return; keepFocus(() => { x.innerHTML = pinHtml(S.b); }); }
  function repaintList() {
    const r = M.root; if (!r || !S.b) return;
    const f = $('#ac-sgf', r), x = $('#ac-sgl', r); if (!x) return;
    const src = listSource(S.b);
    keepFocus(() => { if (f) f.innerHTML = listChips(src); x.innerHTML = listBody(S.b, src); masks(x); });
  }
  function repaintReadings() { const r = M.root, x = r && $('#ac-rdb', r); if (!x || !S.b || !M.rdOpen) return; x.innerHTML = readBody(S.b); masks(x); }
  function fetchLedger(force) {
    const b = S.b, root = M.root; if (!b || !root) return;
    const gen = b.gen;
    if (!force && S.ledgerGen != null && S.ledgerGen === gen) { if (M.L !== S.ledger) { M.L = S.ledger; repaintList(); } return; }
    loadLedger(force).then(L => { if (M.root !== root || !S.b || S.b.gen !== gen) return; M.L = L || null; repaintList(); });
  }
  // Bars grow by scaleX from their last drawn value once they scroll into view (instantly with reduced motion).
  // The track is observed, not the fill: a fill at scaleX(0) has no area, so it would never count as visible.
  function growBars(scope) {
    const els = $$('.fill[data-k]', scope).filter(el => !el.dataset.done); if (!els.length) return;
    const go = el => { el.dataset.done = '1'; el.style.setProperty('--k', el.dataset.k); M.k[el.dataset.kk] = Number(el.dataset.k); };
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(go); return; }
    if (!M.io) M.io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      M.io.unobserve(e.target);
      const f = $('.fill[data-k]', e.target);
      if (f && !f.dataset.done) requestAnimationFrame(() => go(f));
    }), { threshold: 0.1 });
    els.forEach(el => M.io.observe(el.parentElement || el));
  }

  // =========================================================================================== events ==
  function onClick(e) {
    const t = e.target; if (!(t instanceof Element) || e.button > 0) return;
    let el;
    if ((el = t.closest('#ac-tlb button.tk'))) { e.preventDefault(); M.coin = el.dataset.name || null; repaintTimeline(); return; }   // a coin in a timeline row filters
    if ((el = t.closest('[data-ac-tf]'))) { M.tf = el.dataset.acTf; repaintTimeline(); return; }
    if ((el = t.closest('[data-ac-sf]'))) { M.sf = el.dataset.acSf; M.sn = 30; repaintList(); return; }
    if ((el = t.closest('.ac-win button[data-v]'))) { const v = el.dataset.v; if (v !== M.win) { M.win = v; setSeg(el.closest('.seg'), v); repaintFunnel(); } return; }
    if ((el = t.closest('[data-ac]'))) {
      const a = el.dataset.ac;
      if (a === 'coin-x') { M.coin = null; repaintTimeline(); }
      else if (a === 'earlier') { M.earlier = !M.earlier; repaintTimeline(); }
      else if (a === 'fold') { const k = Number(el.dataset.k); if (M.folds.has(k)) M.folds.delete(k); else M.folds.add(k); repaintTimeline(); }
      else if (a === 'more') { M.sn += 50; repaintList(); }
      else if (a === 'pins') { M.pinAll = !M.pinAll; repaintPins(); }
      else if (a === 'ledger') { M.L = undefined; repaintList(); fetchLedger(true); }
      else if (a === 'play') { if (M.play) playStop(); else playStart(); }
      else if (a === 'latest') { playStop(); setCursor(null, { sheet: false }); }
      return;
    }
    if (t.closest('.ac-tcs') && !t.closest('button')) {                // a tap on the tape picks that column's check
      const i = colAt(e.clientX), rs = runsOf();
      if (i != null && rs[i]) { playStop(); setCursor(rs[i].t, { sheet: false, explicit: true }); }
    }
  }
  function onInput(e) {
    const el = e.target; if (!(el instanceof Element) || !el.matches('.ac-scrub')) return;
    playStop();
    const rs = runsOf(), r = rs[Number(el.value)];
    if (r) setCursor(r.t, { sheet: false, explicit: true });
  }
  function onToggle(e) {
    const d = e.target; if (!(d instanceof Element) || !d.matches('.ac-rdx')) return;
    M.rdOpen = d.open;
    const bd = $('#ac-rdb', d);
    if (d.open && bd && !bd.firstChild) { bd.innerHTML = readBody(S.b); masks(bd); }
  }
  function newRuns(prev, b) {
    if (!prev) return null;
    const had = new Set(runsOf(prev).map(r => r.t)), s = new Set(runsOf(b).map(r => r.t).filter(t => !had.has(t)));
    return s.size ? s : null;
  }

  // ============================================================================================ view ==
  VIEWS.activity = {
    title: 'Activity',
    render(root, why) {
      const b = S.b; if (!b) return '';
      const arrive = why === 'arrival', rise = arrive ? '' : ' rise';   // cards rise on a tab change, never on an arrival
      M.EV = evIndex(b); M.wide = WIDE.matches; if (!arrive) M.sn = 30;
      M.L = S.ledgerGen != null && S.ledgerGen === b.gen ? S.ledger : undefined;
      const fresh = arrive ? newRuns(S.prev, b) : null;                 // a recorded check arrived: its cell and rows enter
      return '<div class="ac">'
        + safe(() => hbCard(b, rise, fresh), 'Heartbeat')
        + safe(() => tlCard(b, rise, fresh), 'Timeline')
        + safe(() => sigCard(b, rise), 'Signals')
        + safe(() => listCard(b, rise), 'Every signal')
        + safe(() => tapeCard(b, rise), 'The board over time')
        + safe(() => readCard(b, rise), 'All readings')
        + '</div>';
    },
    after(root) {
      M.root = root;
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('toggle', onToggle, true);
      const onWide = () => { const w = WIDE.matches; if (w === M.wide) return; M.wide = w; repaintList(); repaintReadings(); };
      if (WIDE.addEventListener) WIDE.addEventListener('change', onWide); else if (WIDE.addListener) WIDE.addListener(onWide);
      let ro = null, rf = 0;
      const relayout = () => { cancelAnimationFrame(rf); rf = requestAnimationFrame(layoutTape); };
      const sc = $('.ac-tsc', root);
      if (sc && 'ResizeObserver' in window) { ro = new ResizeObserver(relayout); ro.observe(sc); } else addEventListener('resize', relayout);
      layoutTape();
      growBars(root);
      paintCursor();
      fetchLedger(false);
      return () => {
        playStop();
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('toggle', onToggle, true);
        if (WIDE.removeEventListener) WIDE.removeEventListener('change', onWide); else if (WIDE.removeListener) WIDE.removeListener(onWide);
        if (ro) ro.disconnect(); else removeEventListener('resize', relayout);
        cancelAnimationFrame(rf);
        if (M.io) { M.io.disconnect(); M.io = null; }
        M.root = null;
      };
    },
    leave() { playStop(); },
  };

  // The real clock moved: redraw the heartbeat grid only when a slot rolls over or the owed check changes phase.
  hook('tick30s', () => {
    if (S.tab !== 'activity' || !M.root || !S.b || !Array.isArray(S.b.runs)) return;
    if (hbKeyOf(slotModel(S.b)) === M.hbKey) return;
    const el = $('#ac-hbg', M.root); if (el) { el.innerHTML = hbGrid(S.b, null).html; paintCursor(); }
  });
  hook('hide', playStop);
}
