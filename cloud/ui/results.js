// cloud/ui/results.js — the Results tab (spec §8) and the trade sheet (§9.4). One block (ui/README.md); exports
// VIEWS.results and SHEETS.trade. Reads exec:ledger through loadLedger() (lazy, cached per bundle gen) and loads
// lightweight-charts through loadLWC() only when this tab has a curve to draw. CSS prefix rs- (ui/results.css).
// Sections, in order: Verdict & go-live · Curve · Record strip · R per trade · Trades · Sunday review · Sweeps.
{
  // ------------------------------------------------------------------------------------------ helpers --
  const k01 = x => Math.max(0, Math.min(1, Number(x) || 0));
  const cfg = () => (S.b && S.b.cfg) || {};
  const needN = () => num((cfg().gates || {}).n) || 30;
  const paper = () => modeOf(S.b).eff === 'paper';
  const PP = () => paper() ? ' <span class="pill pt">Paper</span>' : '';
  const rv = (v, nd) => '<span class="' + fmt.cls(v, nd) + '">' + fmt.R(v, nd) + '</span>';           // sign-coloured R
  const trim = v => { const x = num(v); return x == null ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
  const DFY = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const DFYR = new Intl.DateTimeFormat(undefined, { year: 'numeric' }), DFMO = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const OLD = 300 * 86400;                                        // older than this, a date carries its year
  const whenY = t => t == null ? '—' : nowS() - t > OLD ? DFY.format(new Date(t * 1000)) : fmt.when(t);
  const stampY = t => t == null ? '—' : nowS() - t > OLD ? DFY.format(new Date(t * 1000)) + ', ' + fmt.time(t) : fmt.stamp(t);
  function dayOnly(t) {                                          // "Thu" within the last 6 days, else "Sep 18"
    if (t == null) return '—';
    const d = new Date(t * 1000), n = new Date(nowMs());
    const dd = Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    return dd >= 0 && dd <= 6 ? fmt.wd(t) : whenY(t);
  }
  const hrs = h => { const x = num(h); return x == null ? '—' : fmt.dur(x * 3600); };
  function noon(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) / 1000 : null; }
  function head(title, sub, acts) {
    return '<div class="head"><div class="ttl"><h2>' + title + PP() + '</h2>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>'
      + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
  }
  const card = (id, rise, inner) => '<section class="card rs-' + id + rise + '" id="results-' + id + '">' + inner + '</section>';
  // A meter grows by scaleX from the value it last showed (0 on first view) to its new value (spec §13).
  const MK = {};
  function meter(key, k, fill, label) {
    const to = k01(k), from = MK[key] != null ? MK[key] : 0;
    return '<div class="meter sx"' + (fill ? ' style="--fill:' + fill + '"' : '') + (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"')
      + '><i style="--k:' + from + '" data-k="' + to.toFixed(4) + '" data-mk="' + esc(key) + '"></i></div>';
  }
  // Colour tokens for the canvas chart, read at draw time so a theme toggle redraws in the new theme.
  function rgba(c, a) {
    c = String(c || '').trim();
    let m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(x => x + x).join(''); const n = parseInt(h.slice(0, 6), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
    m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
    return c;
  }
  function colors() {
    const t = n => tok(n) || '#888888';
    return { good: t('--good'), bad: t('--bad'), warn: t('--warn'), muted: t('--muted'), ink2: t('--ink-2'), line: t('--line'), line2: t('--line-2'), violet: t('--violet') };
  }

  // ------------------------------------------------------------------------------------- ledger reads --
  let rowsMemo = { L: null, rows: [] }, serMemo = { L: null, rs: [] };
  function trades(L) {                                           // trades.rows → objects keyed by trades.cols
    if (rowsMemo.L === L) return rowsMemo.rows;
    const T = (L && L.trades) || {}, cols = Array.isArray(T.cols) ? T.cols : [], rows = Array.isArray(T.rows) ? T.rows : [];
    const out = rows.filter(Array.isArray).map(r => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
    rowsMemo = { L, rows: out };
    return out;
  }
  function rser(L) {                                             // [[t_out, R, rel_R, book_index]], oldest first
    if (serMemo.L === L) return serMemo.rs;
    const rs = (L && Array.isArray(L.rseries) ? L.rseries : []).filter(r => Array.isArray(r) && num(r[0]) != null && num(r[1]) != null)
      .map(r => [Math.floor(num(r[0])), num(r[1]), num(r[2]), r[3]]).sort((a, b) => a[0] - b[0]);
    serMemo = { L, rs };
    return rs;
  }
  const booksOf = () => (S.b && Array.isArray(S.b.books) ? S.b.books : []);
  const bookAt = i => { const x = booksOf()[i]; return x ? x.b : null; };
  const benchOf = b => { const x = booksOf().find(y => y.b === b); return x ? x.bench : null; };
  const allStats = L => (L && L.stats && L.stats.all) || {};
  const nClosed = L => { const n = num(allStats(L).n); return n != null ? n : trades(L).length; };
  const openOf = () => { const rec = (S.b && S.b.rec) || {}, n = S.b && S.b.risk ? num(S.b.risk.n_open) : null; return { open: num(rec.open_R), n }; };

  // ----------------------------------------------------------------------------- 8.1 verdict & go-live --
  const GW = { not_yet: ['not yet', 'mute'], passing: ['passing', 'ok'], failing: ['failing', 'bad'] };
  const GSHORT = { n: 'the trade count', avg_R: 'average R', dd: 'drawdown', cost_R: 'costs' };
  function gatesOf(L) {
    const v = L && L.verdict;
    if (v && Array.isArray(v.gates) && v.gates.length) return v.gates;
    // no ledger: what the bundle itself knows, never an invented pass
    const g = cfg().gates || {}, rec = (S.b && S.b.rec) || {}, N = needN(), n = num(rec.n), st = n != null && n < N ? 'not_yet' : null;
    return [{ k: 'n', val: n, target: N, state: st }, { k: 'avg_R', val: num(rec.avg_R), target: g.avg_R, state: st },
            { k: 'dd', val: null, target: g.dd_pct, state: null }, { k: 'cost_R', val: null, target: g.cost_R, state: st }];
  }
  function gateRow(g) {
    const t = num(g.target), x = num(g.val);
    let lbl, v, k;
    switch (g.k) {
      case 'n': lbl = (t != null ? fmt.int(t) : 'Enough') + ' closed trades'; v = x == null ? na(true) : fmt.int(x) + ' of ' + trim(t); break;
      case 'avg_R': lbl = 'Average above ' + (t != null ? '+' + trim(t) + ' R' : 'the limit'); v = x == null ? na(true) : rv(x); break;
      case 'dd': lbl = 'Worst drawdown under ' + (t != null ? trim(t) + '%' : 'the limit'); v = x == null ? na(true) : fmt.pctu(x, 1); break;
      case 'cost_R': lbl = 'Costs at most ' + (t != null ? trim(t) + ' R' : 'the limit') + ' per trade'; v = x == null ? na(true) : fmt.num(x, 2) + ' R'; break;
      default: lbl = esc(g.k); v = x == null ? na(true) : trim(x);
    }
    k = x != null && t ? x / t : 0;
    const w = GW[g.state] || ['unknown', 'mute'];
    const fill = g.state === 'passing' ? 'var(--good)' : g.state === 'failing' ? 'var(--bad)' : '';
    return '<li class="rs-gate"><span class="rs-gl">' + lbl + '</span><span class="rs-gv">' + v + '</span><span class="pill ' + w[1] + '">' + w[0] + '</span>'
      + meter('g-' + g.k, k, fill) + '</li>';
  }
  function perBook(L) {                                          // book → cumulative R and holding-equivalent R, per trade
    const out = {};
    for (const [, R, rel, bi] of rser(L)) {
      const b = bookAt(bi); if (!b) continue;
      const s = out[b] || (out[b] = { c: [0], h: [0] });
      s.c.push(s.c[s.c.length - 1] + R);
      s.h.push(s.h[s.h.length - 1] + (rel != null ? R - rel : 0));
    }
    return out;
  }
  function spark(s) {
    const W = 160, H = 90, p = 6, all = s.c.concat(s.h);
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    if (hi - lo < 1) { const m = (hi + lo) / 2; hi = m + 0.5; lo = m - 0.5; }
    const n = s.c.length, x = i => (i / Math.max(1, n - 1)) * W, y = v => p + (hi - v) / (hi - lo) * (H - 2 * p);
    const path = a => a.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    return '<svg class="rs-sp" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="z" d="M0 ' + y(0).toFixed(1) + 'H' + W + '"/>'
      + '<path class="h" d="' + path(s.h) + '"/><path class="c" d="' + path(s.c) + '"/></svg>';
  }
  function bookTile(x, s) {
    const n = num(x.n) || 0, N = needN(), cum = num(x.cum_R), hold = num(x.hold_R), bench = benchOf(x.b);
    const lead = cum != null && hold != null ? cum - hold : null;
    let pill;
    if (n < N) pill = '<span class="pill">Too early' + (lead == null || !n ? '' : Math.abs(lead) < 0.05 ? ' · level with holding' : lead > 0 ? ' · leading by ' + fmt.num(lead, 1) + ' R' : ' · trailing by ' + fmt.num(-lead, 1) + ' R') + '</span>';
    else if (lead == null) pill = '<span class="pill mute">vs holding not in this data</span>';
    else pill = lead > 0 ? '<span class="pill ok">Beating ' + esc(bench || 'holding') + '</span>' : '<span class="pill bad">Trailing ' + esc(bench || 'holding') + '</span>';
    const lbl = x.b + ': ' + word.plural(n, 'closed trade') + (cum != null && n ? ', ' + fmt.R(cum) : '') + (hold != null && n ? ' against ' + fmt.R(hold) + ' for holding ' + (bench || 'its benchmark') : '') + '. Show its trades.';
    const body = n > 0 && s && s.c.length > 1 ? spark(s) : '<span class="rs-bk0">no closed trades yet</span>';
    return '<button type="button" class="rs-bk" data-rs-book="' + esc(x.b) + '" aria-label="' + esc(lbl) + '"' + (n ? '' : ' disabled') + '><span class="rs-bkh"><b>' + esc(x.b) + '</b><span>'
      + (cum != null && n ? fmt.R(cum) : word.plural(n, 'trade')) + '</span></span>' + body + pill + '</button>';
  }
  function booksBlock(L) {
    const vb = L && L.verdict && Array.isArray(L.verdict.books) ? L.verdict.books.filter(x => x && x.b) : [];
    if (!vb.length) return '';
    const h = '<h3 class="rs-h3">Per book · against holding its benchmark</h3>';
    if (!vb.some(x => num(x.n) > 0)) return '<div>' + h + '<p class="note">No closed trades yet in ' + (vb.length > 1 ? 'any of the ' + fmt.int(vb.length) + ' books' : 'its book') + '.</p></div>';
    const ser = perBook(L);
    return '<div>' + h + '<div class="rs-books">' + vb.map(x => bookTile(x, ser[x.b])).join('') + '</div>'
      + '<div class="legend"><span><i class="sw rs-a"></i>the book’s closed R</span><span><i class="sw dash rs-m"></i>holding its benchmark</span></div></div>';
  }
  function verdictCard(L, rise) {
    const gates = gatesOf(L), gN = gates.find(g => g.k === 'n') || {}, n = num(gN.val), N = num(gN.target) || needN();
    const fails = gates.filter(g => g.state === 'failing'), all = gates.length > 0 && gates.every(g => g.state === 'passing');
    const failWords = word.list(fails.map(g => GSHORT[g.k] || g.k));
    let lead;
    if (n == null) lead = 'Too early to judge: closed trades ' + na();
    else if (n < N) lead = 'Too early to judge: <b>' + fmt.int(n) + ' of ' + fmt.int(N) + '</b> closed trades';
    else if (all) lead = 'Meets every go-live gate: <b>' + fmt.int(n) + '</b> closed trades';
    else if (fails.length) lead = 'Not ready for live: ' + esc(failWords) + (fails.length > 1 ? ' fail their gates' : ' fails its gate');
    else lead = 'Judging <b>' + fmt.int(n) + '</b> closed trades';
    const early = n != null && n < N && fails.length ? '<p class="rs-warn">' + esc(failWords.charAt(0).toUpperCase() + failWords.slice(1)) + ' already past ' + (fails.length > 1 ? 'their limits' : 'its limit') + '.</p>' : '';
    const pill = n != null && n >= N ? (all ? ' <span class="pill ok">Passing</span>' : fails.length ? ' <span class="pill bad">Failing</span>' : '') : '';
    return card('verdict', rise, head('Verdict &amp; go-live' + tip('goLive'), 'Can the paper record go live?')
      + '<p class="rs-lead">' + lead + pill + '</p>' + meter('v-n', n != null && N ? n / N : 0, 'var(--accent)', (n == null ? 'unknown' : fmt.int(n)) + ' of ' + fmt.int(N) + ' closed trades') + early
      + '<div class="rs-vgrid"><div><h3 class="rs-h3">Go-live checklist</h3><ul class="rs-gates">' + gates.map(gateRow).join('') + '</ul>'
      + '<p class="cap">Going live needs all four. Only the drawdown gate can fail before ' + fmt.int(N) + ' closed trades.</p></div>'
      + (L ? booksBlock(L) : '') + '</div>');
  }

  // --------------------------------------------------------------------------------------- 8.2 curve --
  let chart = null, chartView = 'R', crossFn = null;
  const potOff = () => modeOf(S.b).eff === 'live' && !!S.b && !!S.b.pot && S.b.pot.net === false;
  function curveCard(L, rise) {
    const rs = rser(L);
    if (!rs.length) {
      const b = S.b || {}, o = b.origin || {}, pot = b.pot || {}, since = num(o.t) != null ? num(o.t) : num(pot.since);
      const checks = num(pot.n_pts) != null ? num(pot.n_pts) : runsOf(b).length, md = (o.mode || modeOf(b).eff) === 'live' ? 'Live' : 'Paper';
      return card('curve', rise, head('Curve' + tip('R'))
        + '<div class="rs-nochart"><div class="nochart"><p>The first closed trade starts this line. <span class="sub">' + md + (since != null ? ' since ' + esc(fmt.day(since)) : '')
        + ' · ' + word.plural(checks, 'check') + ' · ' + word.plural(nClosed(L), 'trade') + '.</span></p></div></div>');
    }
    if (potOff()) chartView = 'R';
    const seg = '<div class="seg" data-rs-seg="curve" aria-label="Curve units"><button type="button" data-v="R" aria-pressed="' + (chartView === 'R') + '">In R</button>'
      + '<button type="button" data-v="P" aria-pressed="' + (chartView === 'P') + '"' + (potOff() ? ' disabled' : '') + '>Pot %</button><span class="ind"></span></div>';
    return card('curve', rise, head('Curve' + tip('R'), 'Closed R against holding each book’s benchmark instead', seg)
      + (potOff() ? '<p class="note">Pot % needs the deposits record.</p>' : '')
      + '<div class="rs-chart"><div class="lwc" id="rs-lwc"><div class="rs-cmsg">Loading the chart…</div></div></div>'
      + '<div class="legend rs-legend" id="rs-legend"></div>'
      + '<p class="cap rs-attr">Times in your time zone. Drag to pan, pinch to zoom; each exit shows as a dot once there is room. Chart by <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts</a>.</p>');
  }
  function killChart() { if (chart) { try { chart.remove(); } catch (e) {} chart = null; } crossFn = null; }
  function tickFmt(t, type) {                                    // local-time axis labels (the axis itself steps in UTC)
    const s = Number(t), d = new Date(s * 1000);
    return type === 0 ? DFYR.format(d) : type === 1 ? DFMO.format(d) : type === 2 ? fmt.md(s) : fmt.time(s);
  }
  function uniq(pairs) {                                         // [[t, v]] → strictly ascending, last value per t
    const m = new Map();
    for (const p of pairs || []) if (Array.isArray(p) && num(p[0]) != null && num(p[1]) != null) m.set(Math.floor(num(p[0])), num(p[1]));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }
  const setLegend = h => { const el = document.getElementById('rs-legend'); if (el) el.innerHTML = h; };
  function legendR(L) {
    let c = 0, h = 0, nh = 0;
    for (const [, R, rel] of rser(L)) { c += R; if (rel != null) { h += R - rel; nh++; } }
    const tot = num(allStats(L).tot_R); if (tot != null) c = tot;          // the record's own total, as the strip shows it
    const o = openOf();
    setLegend('<span><i class="sw rs-g"></i>Closed <b>' + fmt.R(c) + '</b></span>'
      + (nh ? '<span><i class="sw dash rs-m"></i>Holding instead <b>' + fmt.R(h) + '</b></span>' : '')
      + (o.open != null && o.n ? '<span><i class="sw dot rs-i"></i>Open, not banked <b>' + fmt.R(o.open) + '</b></span>' : ''));
  }
  function legendP(L) {
    const eq = (L && L.eq) || {}, p = uniq(eq.pct), d = uniq(eq.dd), last = p[p.length - 1], ld = d[d.length - 1];
    const worst = d.reduce((m, x) => Math.max(m, x[1]), 0), thr = cfg().thr || [];
    setLegend('<span><i class="sw rs-g"></i>Pot <b>' + (last ? fmt.pct(last[1]) : '—') + '</b>' + (p.length ? ' since ' + esc(whenY(p[0][0])) : '') + '</span>'
      + '<span><i class="sw rs-w"></i>Drawdown <b>' + (ld ? fmt.pctu(ld[1], 1) : '—') + '</b> now · worst ' + fmt.pctu(worst, 1) + '</span>'
      + (thr[0] != null && thr[1] != null ? '<span><i class="sw dash rs-w"></i>' + esc(trim(thr[0])) + '% risk halves · ' + esc(trim(thr[1])) + '% stops buying</span>' : ''));
  }
  function drawChart() {
    killChart();
    const el = document.getElementById('rs-lwc'), LW = window.LightweightCharts, L = drawn;
    if (!el || !LW || !L) return;
    const rs = rser(L); if (!rs.length) return;
    el.innerHTML = '';
    const C = colors(), inR = chartView !== 'P', thr = cfg().thr || [];
    const pf = inR ? v => fmt.R(v, 1) : v => fmt.pct(v, 1);
    const ch = LW.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'rgba(0,0,0,0)' }, textColor: C.muted, fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.line }, horzLines: { color: C.line } },
      rightPriceScale: { borderColor: C.line, scaleMargins: inR ? { top: 0.1, bottom: 0.08 } : { top: 0.08, bottom: 0.3 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true, tickMarkFormatter: tickFmt },
      localization: { timeFormatter: t => stampY(Number(t)), priceFormatter: pf },
      crosshair: { mode: 1, vertLine: { color: C.line2, labelBackgroundColor: C.muted }, horzLine: { color: C.line2, labelBackgroundColor: C.muted } },
      watermark: { visible: paper(), text: 'PAPER', color: rgba(C.violet, 0.12), fontSize: 40, fontFamily: '-apple-system, "Inter", sans-serif', fontStyle: '700', horzAlign: 'center', vertAlign: 'center' },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false, axisDoubleClickReset: true },
    });
    chart = ch;
    const fmtP = { type: 'custom', formatter: pf, minMove: 0.01 };
    const base = () => ch.addBaselineSeries({ baseValue: { type: 'price', price: 0 }, lineWidth: 2, priceLineVisible: false, priceFormat: fmtP,
      topLineColor: C.good, topFillColor1: rgba(C.good, 0.26), topFillColor2: rgba(C.good, 0.03), bottomLineColor: C.bad, bottomFillColor1: rgba(C.bad, 0.03), bottomFillColor2: rgba(C.bad, 0.26) });
    const line = o => ch.addLineSeries(Object.assign({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmtP }, o));
    if (inR) {
      // cumulative closed R at each close (trades closing at one time merge into one point), holding-equivalent R
      // Σ(R − rel_R) dashed, the open tail dotted, one exit marker per trade (text only where it can be read)
      const o = S.b && S.b.origin, t0 = num(o && o.t) != null ? num(o.t) : num(S.b && S.b.pot && S.b.pot.since);
      const cum = new Map(), hold = new Map(), byT = new Map();
      let c = 0, h = 0;
      if (t0 != null && t0 < rs[0][0]) { cum.set(t0, 0); hold.set(t0, 0); }
      for (const r of rs) {
        c += r[1]; if (r[2] != null) h += r[1] - r[2];
        cum.set(r[0], c); hold.set(r[0], h);
        if (!byT.has(r[0])) byT.set(r[0], []);
        byT.get(r[0]).push(r);
      }
      const pts = [...cum.entries()].map(([time, value]) => ({ time, value: +value.toFixed(4) }));
      const s = base(); s.setData(pts);
      if (rs.some(r => r[2] != null)) line({ color: C.muted, lineStyle: 2 }).setData([...hold.entries()].map(([time, value]) => ({ time, value: +value.toFixed(4) })));
      const op = openOf(), lastT = pts[pts.length - 1].time;
      let tail = null;
      if (op.open != null && op.n) {
        let tn = num(S.b.clock && S.b.clock.last_t) || nowS(); if (tn <= lastT) tn = lastT + 3600;
        tail = tn;
        line({ color: C.ink2, lineWidth: 2, lineStyle: 1 }).setData([{ time: lastT, value: +c.toFixed(4) }, { time: tn, value: +(c + op.open).toFixed(4) }]);
      }
      // Exit markers: one circle per trade, coloured by R. They appear once the visible stretch leaves them room
      // (about 9px a close), so 300 overlapping dots never bury the line; the "+2.1R" text only from 640px wide.
      const mk = withText => rs.map(r => ({ time: r[0], position: 'inBar', shape: 'circle', size: 0.7,
        color: r[1] > 0.005 ? C.good : r[1] < -0.005 ? C.bad : C.muted,
        text: withText ? (r[1] > 0 ? '+' : r[1] < 0 ? '−' : '') + Math.abs(r[1]).toFixed(1) + 'R' : '' }));
      let mkOn = null;
      const fit = rg => {
        const w = el.clientWidth || 300, vis = rg ? Math.max(1, rg.to - rg.from) : pts.length;
        const on = vis <= w / 9 ? (w >= 640 && vis <= w / 28 ? 2 : 1) : 0;
        if (on !== mkOn) { mkOn = on; s.setMarkers(on ? mk(on === 2) : []); }
      };
      fit(null);
      ch.timeScale().subscribeVisibleLogicalRangeChange(rg => call(fit, rg));
      const T = new Map();
      for (const x of trades(L)) { const k = num(x.t_out); if (k == null) continue; if (!T.has(k)) T.set(k, []); T.get(k).push(x); }
      const at = t => '<span>' + esc(stampY(t)) + '</span>';
      crossFn = p => {
        if (!p || p.time == null || !p.point) return legendR(L);
        const t = Number(p.time);
        if (tail != null && t === tail) return setLegend(at(t) + '<span><i class="sw dot rs-i"></i>Open, not banked <b>' + fmt.R(op.open) + '</b> across ' + word.plural(op.n, 'position') + '</span>');
        const here = T.get(t) || [], rr = byT.get(t) || [];
        if (!rr.length) return setLegend(at(t) + '<span>Closed <b>' + fmt.R(cum.get(t)) + '</b></span>');
        const what = here.length
          ? here.slice(0, 3).map(x => '<b>' + esc(x.c) + '</b> ' + rv(x.R) + ' (' + esc(word.exit(x.rsn)) + (num(x.rel_R) != null ? ', ' + rv(x.rel_R) + ' vs holding' : '') + ')').join(' · ') + (here.length > 3 ? ' · ' + (here.length - 3) + ' more' : '')
          : rr.map(r => rv(r[1])).join(' · ');
        setLegend(at(t) + '<span>' + what + '</span><span>Total <b>' + fmt.R(cum.get(t)) + '</b></span>');
      };
      legendR(L);
    } else {
      const eq = (L && L.eq) || {}, p = uniq(eq.pct), d = uniq(eq.dd);
      const t1 = num(thr[0]) != null ? num(thr[0]) : 10, t2 = num(thr[1]) != null ? num(thr[1]) : 20, worst = d.reduce((m, x) => Math.max(m, x[1]), 0);
      const s = base(); s.setData(p.map(([time, value]) => ({ time, value })));
      const dd = ch.addHistogramSeries({ priceScaleId: 'dd', priceFormat: fmtP, priceLineVisible: false, lastValueVisible: false, base: 0,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -Math.max(t2 * 1.15, worst * 1.05), maxValue: 0 } }) });
      ch.priceScale('dd').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, visible: false });
      dd.setData(d.map(([time, v]) => ({ time, value: -v, color: v >= t2 ? rgba(C.bad, 0.7) : v >= t1 ? rgba(C.warn, 0.65) : rgba(C.muted, 0.5) })));
      dd.createPriceLine({ price: -t1, color: C.warn, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'risk halves' });
      dd.createPriceLine({ price: -t2, color: C.bad, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'stops buying' });
      const P = new Map(p), D = new Map(d);
      crossFn = q => {
        if (!q || q.time == null || !q.point) return legendP(L);
        const t = Number(q.time);
        setLegend('<span>' + esc(stampY(t)) + '</span><span><i class="sw rs-g"></i>Pot <b>' + (P.has(t) ? fmt.pct(P.get(t)) : '—') + '</b></span><span><i class="sw rs-w"></i>Drawdown <b>' + (D.has(t) ? fmt.pctu(D.get(t), 1) : '—') + '</b></span>');
      };
      legendP(L);
    }
    ch.subscribeCrosshairMove(p => { if (crossFn) call(crossFn, p); });
    ch.timeScale().fitContent();
  }
  function curve(root) {
    const el = $('#rs-lwc', root); if (!el) return;
    const my = life;
    loadLWC().then(() => { if (my === life && el.isConnected) safe(drawChart, 'Curve'); },
      () => { if (my === life && el.isConnected) el.innerHTML = '<div class="rs-cmsg"><p>The chart library didn’t load. The numbers below are unaffected.<br><button type="button" class="btn small" data-rs-lwc>Try again</button></p></div>'; });
  }

  // ------------------------------------------------------------------------------------ 8.3 record strip --
  const SEEN = {};                                               // last shown numbers: countUp only when they change
  const cu = (key, v, f, text) => '<span data-cu="' + key + '" data-n="' + v + '" data-f="' + f + '">' + text + '</span>';
  const CUF = { R: v => fmt.Rn(v), pct: v => Math.round(v) + '%', int: v => fmt.int(v), n2: v => fmt.num(v, 2) };
  const tile = (k, v, s, extra) => '<div class="t"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + (extra || '') + '</div>';
  function rTile(key, v) { const x = num(v); return x == null ? na(true) : '<span class="' + fmt.cls(x) + '">' + cu(key, x, 'R', fmt.Rn(x)) + '<small>R</small></span>'; }
  function recordCard(L, rise) {
    const a = allStats(L), n = num(a.n) || 0, N = needN();
    if (!n) return card('record', rise, head('Record') + '<p class="rs-one">No closed trades yet, so there is no record to judge. Win rate, average R and the rest start with the first close.</p>');
    const few = n < N, FEW = 'n=' + fmt.int(n) + ': too few to judge', sub = s => few ? FEW : s;
    const win = num(a.win), pf = num(a.pf), rel = num(a.rel_R), nrel = num(a.n_rel) || 0, cost = num(a.cost_R), costT = num((cfg().gates || {}).cost_R), op = openOf();
    const tiles = [
      tile('Trades', cu('n', n, 'int', fmt.int(n)), few ? FEW : 'closed' + (num(a.hrs) != null ? ' · held ' + esc(hrs(a.hrs)) + ' on average' : ''), meter('s-n', n / N, 'var(--ink-2)', fmt.int(n) + ' of ' + fmt.int(N) + ' closed trades needed')),
      tile('Win rate', win == null ? na(true) : cu('win', Math.round(win * 100), 'pct', Math.round(win * 100) + '%'), sub('of closed trades')),
      tile('Average R', rTile('avg', a.avg_R), sub('per closed trade')),
      tile('Total R', rTile('tot', a.tot_R), op.open != null && op.n ? 'plus ' + rv(op.open) + ' open, not banked' : sub('closed trades')),
      tile('vs holding' + tip('vsHolding'), rTile('rel', rel), few ? FEW : 'per trade · ' + fmt.int(nrel) + ' with a holding figure', meter('s-rel', nrel / N, 'var(--ink-2)', fmt.int(nrel) + ' of ' + fmt.int(N) + ' trades with a holding figure')),
      tile('Profit factor' + tip('pf'), pf == null ? na(true) : cu('pf', pf, 'n2', fmt.num(pf, 2)), pf == null ? 'no losing trade yet' : sub('R won ÷ R lost')),
      tile('Worst losing streak', num(a.streak) == null ? na(true) : cu('streak', num(a.streak), 'int', fmt.int(a.streak)), 'losses in a row'),
      tile('Costs per trade', cost == null ? na(true) : cu('cost', cost, 'n2', fmt.num(cost, 2)) + '<small>R</small>', 'fees and funding' + (costT != null ? ' · limit ' + trim(costT) + ' R' : '')),
    ];
    return card('record', rise, head('Record', few ? 'Values stay grey until ' + fmt.int(N) + ' closed trades.' : 'Every closed trade, in R')
      + '<div class="strip rs-strip' + (few ? ' rs-dim' : '') + '">' + tiles.join('') + '</div>' + breakdown(L));
  }
  function breakdown(L) {
    const st = (L && L.stats) || {}, groups = [['book', 'Book', k => k], ['tier', 'Grade', k => word.tier(k)], ['kind', 'Signal', k => word.kind(k, true)], ['reason', 'Exit', k => word.exit(k)]];
    const body = groups.map(([g, lbl, name]) => {
      const e = Object.entries(st[g] || {}).filter(([, s]) => s && num(s.n)); if (!e.length) return '';
      e.sort((x, y) => num(y[1].n) - num(x[1].n));
      return '<tr class="rs-grp"><td class="l" colspan="7">' + lbl + '</td></tr>' + e.map(([k, s]) => '<tr' + (num(s.n) < 10 ? ' class="rs-few"' : '') + '><td class="l">' + esc(name(k)) + '</td><td class="num">' + fmt.int(s.n)
        + '</td><td class="num">' + (num(s.win) == null ? '—' : Math.round(s.win * 100) + '%') + '</td><td class="num">' + rv(s.avg_R) + '</td><td class="num">' + rv(s.tot_R)
        + '</td><td class="num">' + (num(s.rel_R) == null ? '—' : rv(s.rel_R)) + '</td><td class="num">' + (num(s.pf) == null ? '—' : fmt.num(s.pf, 2)) + '</td></tr>').join('');
    }).join('');
    if (!body) return '';
    return '<details class="disc rs-bd"><summary>By book, grade, signal and exit</summary><div class="body"><div class="tbl" aria-label="Record by book, grade, signal and exit"><table><thead><tr><th class="l">Bucket</th><th>Trades</th><th>Win rate</th><th>Average</th><th>Total</th><th>vs holding</th><th>Profit factor</th></tr></thead><tbody>'
      + body + '</tbody></table></div><p class="cap">Grey rows have fewer than 10 trades: too few to read.</p></div></details>';
  }

  // ---------------------------------------------------------------------------------- 8.4 R per trade --
  let distMode = null, distW = 0;
  const LO = -1.5, HI = 6;
  const distMode_ = n => n > 60 ? (distMode || 'hist') : 'dots';
  const distCap = m => (m === 'hist' ? 'Trades per half R, from −1.5 R to +6 R; the end bins hold everything beyond.' : 'Every trade in order, on an R axis from −1.5 to +6; hollow dots lie beyond it.') + ' The dashed line at −1 R is a full stop.';
  function rCard(L, rise) {
    const n = rser(L).length; if (!n) return '';
    const mode = distMode_(n);
    const seg = n > 60 ? '<div class="seg" data-rs-seg="dist" aria-label="R per trade view"><button type="button" data-v="dots" aria-pressed="' + (mode === 'dots') + '">Dots</button><button type="button" data-v="hist" aria-pressed="' + (mode === 'hist') + '">Histogram</button><span class="ind"></span></div>' : '';
    return card('r', rise, head('R per trade', 'Trend following: many small losses, a few large wins.', seg)
      + '<div class="rs-dist" id="rs-dist" role="img" aria-label="' + esc(distLabel(L)) + '"></div><p class="cap" id="rs-dcap">' + distCap(mode) + '</p>');
  }
  function distLabel(L) {
    const rs = rser(L), w = rs.filter(r => r[1] > 0.005), l = rs.filter(r => r[1] < -0.005), near = l.filter(r => r[1] <= -0.8).length;
    const big = w.reduce((m, r) => Math.max(m, r[1]), 0);
    return word.plural(rs.length, 'closed trade') + ': ' + fmt.int(w.length) + ' won, ' + fmt.int(l.length) + ' lost' + (l.length ? ', ' + fmt.int(near) + ' of the losses near a full stop' : '') + (w.length ? '; the biggest win was ' + fmt.R(big) : '') + '.';
  }
  function drawDist() {
    const host = document.getElementById('rs-dist'); if (!host || !drawn) return;
    const rs = rser(drawn), n = rs.length; if (!n) return;
    const mode = distMode_(n), W = Math.max(200, Math.round(host.clientWidth || 300)), H = 150, x = [];
    distW = W;
    if (mode === 'dots') {
      const pl = 38, pr = 8, pt = 8, pb = 8, y = v => pt + (HI - Math.max(LO, Math.min(HI, v))) / (HI - LO) * (H - pt - pb);
      const X = i => pl + (n === 1 ? (W - pl - pr) / 2 : i / (n - 1) * (W - pl - pr)), r = n <= 60 ? 3.5 : n <= 150 ? 2.6 : 2;
      const hl = (cls, v, lbl) => '<path class="' + cls + '" d="M' + pl + ' ' + y(v).toFixed(1) + 'H' + (W - pr) + '"/><text class="ax" x="' + (pl - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + lbl + '</text>';
      x.push(hl('g', 6, '+6 R'), hl('g', 3, '+3 R'), hl('z', 0, '0'), hl('s1', -1, '−1 R'));
      rs.forEach((q, i) => {
        const v = q[1], out = v > HI || v < LO, c = v > 0.005 ? 'p' : v < -0.005 ? 'n' : 'o';
        x.push('<circle class="d' + c + (out ? ' dc' : '') + '" cx="' + X(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + r + '"/>');
      });
    } else {
      const pl = 8, pr = 8, pt = 14, pb = 20, nb = Math.round((HI - LO) / 0.5), cnt = new Array(nb).fill(0);
      for (const q of rs) { const i = Math.max(0, Math.min(nb - 1, Math.floor((q[1] - LO) / 0.5))); cnt[i]++; }
      const mx = Math.max(1, ...cnt), bw = (W - pl - pr) / nb, X = e => pl + (e - LO) / 0.5 * bw, base = H - pb;
      x.push('<path class="s1" d="M' + X(-1).toFixed(1) + ' ' + pt + 'V' + base + '"/><path class="z" d="M' + X(0).toFixed(1) + ' ' + pt + 'V' + base + '"/>');
      cnt.forEach((c, i) => {
        if (!c) return;
        const h = Math.max(2, c / mx * (base - pt)), mid = LO + (i + 0.5) * 0.5, x0 = pl + i * bw + 1;
        x.push('<rect class="' + (mid > 0 ? 'bp' : 'bn') + '" x="' + x0.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"/>');
        if (bw >= 16) x.push('<text class="ct" x="' + (x0 + (bw - 2) / 2).toFixed(1) + '" y="' + (base - h - 3).toFixed(1) + '" text-anchor="middle">' + c + '</text>');
      });
      x.push('<path class="g" d="M' + pl + ' ' + base + 'H' + (W - pr) + '"/>');
      for (let e = -1; e <= 6; e++) if (bw >= 14 || e % 2 === 0 || e === -1) x.push('<text class="ax" x="' + X(e).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + (e > 0 ? '+' + e : e < 0 ? '−' + -e : '0') + (e === 6 ? '+' : '') + '</text>');
    }
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true" focusable="false">' + x.join('') + '</svg>';
  }

  // -------------------------------------------------------------------------------------- 8.5 trades --
  const F = { book: '', coin: '', out: '', k: 't_out', dir: -1, shown: 50 };
  const COLS = [['t_out', 'Closed', 'l'], ['c', 'Coin', 'l'], ['b', 'Book', 'l'], ['rsn', 'Exit', 'l'], ['hours', 'Held', ''], ['R', 'R', ''], ['rel_R', 'vs holding', ''], ['cost_R', 'Costs', ''], ['pnl_pct', '% of pot', '']];
  const STRK = { c: 1, b: 1, rsn: 1 };
  function sorted(rows) {
    const k = F.k, d = F.dir, key = r => k === 'rsn' ? word.exit(r.rsn) : STRK[k] ? r[k] : num(r[k]);
    return rows.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (STRK[k] ? String(x).localeCompare(String(y)) : x - y) * d || (num(b.t_out) || 0) - (num(a.t_out) || 0);
    });
  }
  function filtered(L) {
    return trades(L).filter(r => (!F.book || r.b === F.book) && (!F.coin || r.c === F.coin)
      && (!F.out || (F.out === 'win' ? num(r.R) > 0.005 : num(r.R) < -0.005)));
  }
  function tcard(r) {
    const R = num(r.R), rel = num(r.rel_R);
    const lbl = r.c + ', ' + fmt.R(R) + ', ' + word.exit(r.rsn) + ', closed ' + whenY(num(r.t_out)) + '. Open the trade.';
    return '<button type="button" class="rs-tc" data-trade="' + esc(r.id) + '" aria-label="' + esc(lbl) + '"><span class="rs-tcc"><b>' + esc(r.c) + '</b><span>' + esc(r.b || '') + '</span></span>'
      + '<span class="rs-tcr ' + fmt.cls(R) + '">' + fmt.R(R) + '</span><span class="rs-tcw">' + esc(word.exit(r.rsn)) + ' · held ' + esc(hrs(r.hours)) + '</span>'
      + '<span class="rs-tcd"><span>' + esc(whenY(num(r.t_out))) + '</span><span>' + (rel == null ? 'vs holding —' : rv(rel) + ' vs holding') + '</span></span></button>';
  }
  function trow(r) {
    return '<tr data-trade="' + esc(r.id) + '" tabindex="0"><td class="l">' + esc(whenY(num(r.t_out))) + '</td><td class="l"><b class="mono">' + esc(r.c) + '</b></td><td class="l">' + esc(r.b || '—')
      + '</td><td class="l">' + esc(word.exit(r.rsn)) + '</td><td class="num">' + (num(r.hours) == null ? '—' : fmt.num(r.hours, 1) + ' h') + '</td><td class="num">' + rv(r.R)
      + '</td><td class="num">' + (num(r.rel_R) == null ? '—' : rv(r.rel_R)) + '</td><td class="num">' + (num(r.cost_R) == null ? '—' : fmt.num(r.cost_R, 2) + ' R')
      + '</td><td class="num"><span class="' + fmt.cls(r.pnl_pct) + '">' + fmt.pct(r.pnl_pct) + '</span></td></tr>';
  }
  function tradesBody(L) {
    const rows = sorted(filtered(L)), shown = rows.slice(0, F.shown), all = trades(L).length;
    if (!rows.length) return '<div class="empty">No closed trade matches these filters.</div>';
    const th = COLS.map(([k, lbl, c]) => '<th class="sort' + (c ? ' ' + c : '') + '"' + (F.k === k ? ' aria-sort="' + (F.dir > 0 ? 'ascending' : 'descending') + '"' : '') + ' data-k="' + k + '"><button type="button" class="rs-th">' + lbl + '</button></th>').join('');
    return '<div class="rs-cards">' + shown.map(tcard).join('') + '</div>'
      + '<div class="rs-tw"><div class="tbl rs-tbl" aria-label="Closed trades"><table><thead><tr>' + th + '</tr></thead><tbody>' + shown.map(trow).join('') + '</tbody></table></div></div>'
      + '<div class="rs-more"><span>Showing ' + fmt.int(shown.length) + ' of ' + fmt.int(rows.length) + (rows.length !== all ? ' matching' : '') + '</span>'
      + (rows.length > shown.length ? '<button type="button" class="btn small" data-rs-more>Show ' + Math.min(50, rows.length - shown.length) + ' more</button>' : '') + '</div>';
  }
  function tradesCard(L, rise) {
    const rows = trades(L), total = num(L && L.trades && L.trades.total);
    if (!rows.length) return card('trades', rise, head('Trades') + '<div class="empty">' + (total ? 'The record counts ' + word.plural(total, 'closed trade') + ' but carries none of them.' : 'No closed trades yet.') + '</div>');
    const T = total != null ? total : rows.length;
    const sub = rows.length >= 300 || T > rows.length ? 'Latest ' + fmt.int(rows.length) + ' of ' + fmt.int(T) : 'All ' + word.plural(rows.length, 'closed trade');
    const books = [...new Set(rows.map(r => r.b).filter(Boolean))].sort(), coins = [...new Set(rows.map(r => r.c).filter(Boolean))].sort();
    if (F.book && !books.includes(F.book)) F.book = '';
    if (F.coin && !coins.includes(F.coin)) F.coin = '';
    const opt = (v, cur, lbl) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    const filters = '<div class="rs-filters"><div class="seg" data-rs-seg="out" aria-label="Outcome">' + [['', 'All'], ['win', 'Wins'], ['loss', 'Losses']].map(([v, l]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (F.out === v) + '">' + l + '</button>').join('') + '<span class="ind"></span></div>'
      + '<label class="rs-sel"><span class="vh">Book</span><select data-rs-f="book">' + opt('', F.book, 'All books') + books.map(b => opt(b, F.book, b)).join('') + '</select></label>'
      + '<label class="rs-sel"><span class="vh">Coin</span><select data-rs-f="coin">' + opt('', F.coin, 'All coins') + coins.map(c => opt(c, F.coin, c)).join('') + '</select></label></div>';
    return card('trades', rise, head('Trades', esc(sub) + ' · tap one for details') + filters + '<div id="rs-tb">' + tradesBody(L) + '</div>');
  }
  function paintTrades(root) {
    const el = $('#rs-tb', root); if (!el || !drawn) return;
    el.innerHTML = tradesBody(drawn); masks(el);
  }

  // ------------------------------------------------------------------------ 8.6 review and 8.7 sweeps --
  function demote(h) {                                           // the card title replaces the review's own; headings sit below the card's h2
    return String(h || '').replace(/^\s*<h[12][^>]*>[\s\S]*?<\/h[12]>\s*/i, '').replace(/<(\/?)h([1-6])\b/gi, (m, s, n) => '<' + s + 'h' + Math.min(6, Math.max(3, +n + 1)));
  }
  function reviewCard(L, rise) {
    const r = (L && L.review) || {}, html = typeof r.html === 'string' && r.html.trim() ? r.html : r.md ? '<p>' + esc(r.md) + '</p>' : '', t = noon(r.date);
    if (!html) return card('review', rise, head('Sunday review') + '<div class="empty">No Sunday review yet.</div>');
    return card('review', rise, head('Sunday review' + (t != null ? ' · ' + esc(fmt.md(t)) : ''), t != null ? 'Written ' + esc(fmt.dayLong(t)) : '')
      + '<div class="doc rs-rev rs-clamp" id="rs-rev">' + mdTables(demote(html)) + '</div><div class="rs-ra" hidden><button type="button" class="btn small" data-rs-read aria-expanded="false" aria-controls="rs-rev">Read all</button></div>');
  }
  let swAll = false;
  function sweepsCard(L, rise) {
    const sw = (L && Array.isArray(L.sweeps) ? L.sweeps : []).filter(x => Array.isArray(x) && num(x[0]) != null).slice().sort((a, b) => b[0] - a[0]);
    if (!sw.length) return '';
    const li = ([t, b, bench, p, ex]) => '<li class="it"><span>' + esc(dayOnly(t)) + ' · ' + esc(b || '—') + ' → <b class="mono">' + esc(bench || '—') + '</b> · ' + (num(p) == null ? '—' : fmt.pctu(p, 2)) + ' of pot · ' + (ex ? 'executed' : 'recorded, not executed') + '</span></li>';
    const cap = 8, more = sw.length > cap && !swAll;
    return card('sweeps', rise, head('Sweeps', 'Gains earmarked for each book’s benchmark coin')
      + '<ul class="list rs-sw">' + (more ? sw.slice(0, cap) : sw).map(li).join('') + '</ul>'
      + (sw.length > cap ? '<div class="rs-more"><span>' + (more ? 'Latest ' + cap + ' of ' + fmt.int(sw.length) : 'All ' + fmt.int(sw.length)) + '</span><button type="button" class="btn small" data-rs-sw>' + (more ? 'Show all' : 'Show fewer') + '</button></div>' : ''));
  }

  // --------------------------------------------------------------------------------------- the view --
  let drawn = null, drawnErr = null, life = 0, ro = null;
  const loadingCard = rise => card('verdict', rise, head('Verdict &amp; go-live' + tip('goLive')) + '<div class="empty">Loading the results record…</div>');
  function sections(L, rise) {
    if (!L) {
      const e = S.ledgerErr;
      if (!e) return loadingCard(rise);
      if (e === 'missing') return safe(() => verdictCard(null, rise), 'Verdict & go-live')
        + card('record', rise, head('Record') + '<p class="rs-one">The results record isn’t in this data yet. Every check pushes it, so the next one brings it.</p>');
      return card('verdict', rise, head('Verdict &amp; go-live' + tip('goLive')) + '<div class="empty">' + (e === 'auth' ? 'Signed out. Sign in again to see the results.' : 'The results record couldn’t be loaded' + (e === 'net' ? ' (no connection).' : '.'))
        + ' <button type="button" class="btn small" data-rs-retry>Try again</button></div>');
    }
    return [[verdictCard, 'Verdict & go-live'], [curveCard, 'Curve'], [recordCard, 'Record'], [rCard, 'R per trade'], [tradesCard, 'Trades'], [reviewCard, 'Sunday review'], [sweepsCard, 'Sweeps']]
      .map(([f, name]) => safe(() => f(L, rise), name)).join('');
  }
  function wire(root) {
    const ms = $$('[data-mk]', root);
    if (ms.length) { void root.offsetWidth; requestAnimationFrame(() => ms.forEach(i => { i.style.setProperty('--k', i.dataset.k); MK[i.dataset.mk] = Number(i.dataset.k); })); }
    $$('[data-cu]', root).forEach(el => {
      const k = el.dataset.cu, v = Number(el.dataset.n), f = CUF[el.dataset.f] || String;
      if (SEEN[k] != null && SEEN[k] !== v && isFinite(v) && !reduced) { el.textContent = f(SEEN[k]); countUp(el, v, { from: SEEN[k], fmt: f }); }
      SEEN[k] = v;
    });
    curve(root);
    safe(drawDist, 'R per trade');
    if (ro) { ro.disconnect(); ro = null; }
    const d = $('#rs-dist', root);
    if (d && 'ResizeObserver' in window) {
      let rf = 0;
      ro = new ResizeObserver(() => { cancelAnimationFrame(rf); rf = requestAnimationFrame(() => { if (d.isConnected && Math.round(d.clientWidth) !== distW) safe(drawDist, 'R per trade'); }); });
      ro.observe(d);
    }
    const rev = $('#rs-rev', root), ra = rev && rev.nextElementSibling;
    if (rev && ra) requestAnimationFrame(() => { if (rev.scrollHeight > rev.clientHeight + 4) ra.hidden = false; else rev.classList.remove('rs-clamp'); });
  }
  function refill(root) {
    const host = $('#rs', root); if (!host) return;
    const first = !drawn, y = scrollY;
    killChart();
    drawn = S.ledger; drawnErr = S.ledgerErr;
    host.innerHTML = sections(drawn, '');
    initSegs(host); masks(host);
    wire(root);
    const a = first && S.sub && document.getElementById('results-' + S.sub);
    if (a) into(a, false); else jump(y);
  }
  function onClick(e) {
    const t = e.target; if (!(t instanceof Element) || e.defaultPrevented) return;
    const root = e.currentTarget;
    let el;
    if ((el = t.closest('[data-rs-seg] button'))) {
      e.preventDefault(); if (el.disabled) return;
      const seg = el.parentElement, k = seg.dataset.rsSeg, v = el.dataset.v;
      setSeg(seg, v);
      if (k === 'curve' && v !== chartView) { chartView = v; if (window.LightweightCharts) safe(drawChart, 'Curve'); }
      else if (k === 'dist') { distMode = v; safe(drawDist, 'R per trade'); const cap = $('#rs-dcap', root); if (cap) cap.textContent = distCap(v); }
      else if (k === 'out') { F.out = v; F.shown = 50; paintTrades(root); }
      return;
    }
    if ((el = t.closest('th[data-k]'))) {
      if (t.closest('.tip')) return;
      e.preventDefault();
      const k = el.dataset.k;
      if (F.k === k) F.dir = -F.dir; else { F.k = k; F.dir = STRK[k] ? 1 : -1; }
      paintTrades(root);
      const b = $('th[data-k="' + k + '"] button', root); if (b) try { b.focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    if (t.closest('[data-rs-more]')) { e.preventDefault(); F.shown += 50; paintTrades(root); return; }
    if ((el = t.closest('[data-rs-book]'))) {
      e.preventDefault();
      F.book = el.dataset.rsBook; F.shown = 50;
      const s = $('select[data-rs-f=book]', root); if (s) s.value = F.book;
      paintTrades(root); into($('#results-trades', root), true);
      return;
    }
    if ((el = t.closest('[data-rs-read]'))) {
      e.preventDefault();
      const rev = $('#rs-rev', root); if (!rev) return;
      const open = !rev.classList.toggle('rs-clamp');
      el.textContent = open ? 'Show less' : 'Read all'; el.setAttribute('aria-expanded', String(open));
      if (!open) into($('#results-review', root), false);
      return;
    }
    if (t.closest('[data-rs-sw]')) {
      e.preventDefault(); swAll = !swAll;
      const c = $('#results-sweeps', root); if (c && drawn) c.outerHTML = safe(() => sweepsCard(drawn, ''), 'Sweeps');
      return;
    }
    if (t.closest('[data-rs-lwc]')) { e.preventDefault(); const l = $('#rs-lwc', root); if (l) l.innerHTML = '<div class="rs-cmsg">Loading the chart…</div>'; curve(root); return; }
    if (t.closest('[data-rs-retry]')) {
      e.preventDefault();
      const my = life, host = $('#rs', root);
      if (host) host.innerHTML = loadingCard('');
      loadLedger(true).then(() => { if (my === life && S.tab === 'results') { drawn = null; refill(root); } });
    }
  }
  function onChange(e) {
    const s = e.target; if (!(s instanceof HTMLSelectElement) || !s.dataset.rsF) return;
    F[s.dataset.rsF] = s.value; F.shown = 50; paintTrades(e.currentTarget);
  }
  function onKey(e) {
    const tr = e.target instanceof Element && e.target.matches('tr[data-trade]') ? e.target : null;
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showSheet('trade', tr.dataset.trade, tr); }
  }
  VIEWS.results = {
    title: 'Results',
    render(root, why) {
      drawn = S.ledger; drawnErr = S.ledgerErr;
      return '<div class="stack rs" id="rs">' + sections(drawn, why === 'arrival' ? '' : ' rise') + '</div>';
    },
    after(root) {
      const my = ++life;
      root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('keydown', onKey);
      wire(root);
      // the ledger is fetched only here (and by Signals), once per bundle gen; a stale one stays on screen meanwhile
      if (S.ledgerGen !== (S.b && S.b.gen) || (!S.ledger && !S.ledgerErr)) {
        loadLedger().then(() => {
          if (my !== life || S.tab !== 'results' || (S.ledger === drawn && S.ledgerErr === drawnErr)) return;
          refill(root);
          if (S.sheet && S.sheet.kind === 'trade') refreshSheet();              // an open trade sheet follows the new record
        });
      }
      return () => {
        life++; killChart();
        if (ro) { ro.disconnect(); ro = null; }
        root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('keydown', onKey);
      };
    },
    leave() { killChart(); },
  };
  // Theme toggle or OS scheme change: the canvas reads tokens at draw time, so it is redrawn (SVG and HTML follow CSS).
  hook('theme', () => { if (chart && S.tab === 'results') requestAnimationFrame(() => safe(drawChart, 'Curve')); });

  // -------------------------------------------------------------------------------- 9.4 trade sheet --
  const fact = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
  function tradeSheet(id) {
    const L = S.ledger;
    if (!L) {
      if (!S.ledgerErr) loadLedger().then(() => { if (S.sheet && S.sheet.kind === 'trade' && String(S.sheet.arg) === String(id)) refreshSheet(); });
      return '<h2>Trade</h2><div class="empty">' + (S.ledgerErr === 'missing' ? 'The results record isn’t in this data yet.' : S.ledgerErr ? 'The results record couldn’t be loaded.' : 'Loading the record…') + '</div>';
    }
    const all = trades(L).slice().sort((a, b) => (num(a.t_out) || 0) - (num(b.t_out) || 0)), i = all.findIndex(r => String(r.id) === String(id)), r = all[i];
    if (!r) return '<h2>Trade</h2><div class="empty">This trade isn’t among the latest ' + word.plural(all.length, 'closed trade') + ' in the record.</div>';
    const R = num(r.R), rel = num(r.rel_R), bench = benchOf(r.b), prev = all[i - 1], next = all[i + 1];
    const tierPill = r.tier === 'A' ? '<span class="pill auto">Auto grade</span>' : r.tier === 'B' ? '<span class="pill">Watch-only grade</span>' : '';
    const html = '<h2><span class="mono">' + esc(r.c) + '</span> <span class="' + fmt.cls(R) + '">' + fmt.R(R) + '</span></h2>'
      + '<p class="sub rs-shs">Closed ' + esc(stampY(num(r.t_out))) + ' · ' + esc(word.exit(r.rsn)) + ' · held ' + esc(hrs(r.hours)) + '</p>'
      + '<div class="rs-shp">' + (r.b ? '<span class="pill">' + esc(r.b) + '</span>' : '') + tierPill + (r.kind ? '<span class="pill">' + esc(word.kind(r.kind, true)) + '</span>' : '') + chip(r.c) + '</div>'
      + '<div class="sec"><h3>Result</h3><dl class="facts">'
      + fact('Final R' + tip('R'), rv(R)) + fact('vs holding' + (bench ? ' ' + esc(bench) : '') + tip('vsHolding'), rel == null ? na(true) : rv(rel))
      + fact('Result, % of pot', '<span class="' + fmt.cls(r.pnl_pct) + '">' + fmt.pct(r.pnl_pct) + '</span>')
      + fact('Costs (fees and funding)', num(r.cost_R) == null ? na(true) : fmt.num(r.cost_R, 2) + ' R')
      + (num(r.mfe_R) != null ? fact('Best during the trade', rv(r.mfe_R)) : '') + (num(r.mae_R) != null ? fact('Worst during the trade', rv(r.mae_R)) : '')
      + '</dl></div>'
      + '<div class="sec"><h3>Trade</h3><dl class="facts">'
      + fact('Book', esc(r.b || '—') + (bench ? ' <span class="sub">(benchmark ' + esc(bench) + ')</span>' : '')) + fact('Grade', esc(word.tier(r.tier))) + fact('Signal', esc(word.kind(r.kind, true)))
      + fact('Opened', esc(stampY(num(r.t_in)))) + fact('Closed', esc(stampY(num(r.t_out)))) + fact('Held', esc(hrs(r.hours))) + fact('Exit', esc(word.exit(r.rsn)))
      + '</dl></div>'
      + '<div class="sec"><h3>Market prices</h3><dl class="facts">' + [['Entry', r.entry], ['Exit', r.exit], ['First stop', r.stop0]].map(([k, v]) => fact(k, num(v) == null ? na(true) : fmt.px(v))).join('') + '</dl>'
      + '<p class="cap">Market prices, not your money.' + (num(r.stop0) == null ? ' The first stop is stored from the engine update on.' : '') + '</p></div>'
      + '<div class="pn">' + (prev ? '<button type="button" class="btn small" data-rs-tr="' + esc(prev.id) + '">‹ Older</button>' : '<span></span>')
      + (next ? '<button type="button" class="btn small" data-rs-tr="' + esc(next.id) + '">Newer ›</button>' : '<span></span>') + '</div>';
    return {
      html, cls: 'rs-sheet',
      after(el) {
        const f = e => {
          const b = e.target instanceof Element && e.target.closest('[data-rs-tr]'); if (!b) return;
          e.preventDefault();
          const nid = b.dataset.rsTr;
          openSheet(tradeSheet(nid), { kind: 'trade', arg: nid, replace: true });
        };
        el.addEventListener('click', f);
        return () => el.removeEventListener('click', f);
      },
    };
  }
  SHEETS.trade = tradeSheet;
}
