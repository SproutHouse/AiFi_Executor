// cloud/ui/positions.js — the Positions tab (spec §7) and the position sheet (§9.3). One block (ui/README.md): private
// names stay inside; exports go only through the registries:
//   VIEWS.positions                       the tab: position cards · risk budget · books · waiting for approval
//   COMP.positionCard(p, opts?) → html     one position card (opts {first}); a tap opens SHEETS.pos
//   COMP.ladder(p, {mini}?) → html         the R-ladder (mini: 8px track, ticks and bead, no labels; for Now › Holding)
//   COMP.stopWords(p, {tips}?) → html      "stop 3.2% below · locks in +0.41 R" (or "risks −0.60 R")
//   COMP.fitLadders(root)                  re-lays ladder labels with measured widths after inserting ladders elsewhere
//   SHEETS.pos(id)                         the position sheet (id = pos[].id)
// Words follow §14: open R and % of pot lead, "stop x% below", exposure on a secondary line. Only R and % of pot;
// coin prices appear only in the sheet, captioned as market prices.
{
  const clamp = (v, a, z) => Math.min(z, Math.max(a, v));
  const f2 = v => (+v).toFixed(2);
  // % of the pot: 2 decimals (§14), a true zero prints "0%". Caps and shares print as configured ("2.5%", "4%").
  const ppot = v => { const x = num(v); if (x == null) return '—'; const s = fmt.pctu(x, 2); return /^0([.,]0+)?%$/.test(s) ? '0%' : s; };
  const pcap = v => { const x = num(v); if (x == null) return '—'; const r = Math.round(x * 100) / 100, d = Math.abs(r - Math.round(r)) < 1e-9 ? 0 : Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? 1 : 2; return fmt.num(r, d) + '%'; };
  const Rs = v => '<span class="' + fmt.cls(v) + '">' + fmt.R(v) + '</span>';
  const pid = p => String(p.id != null ? p.id : (p.c || '?') + '-' + (p.t_in != null ? p.t_in : ''));
  // Distances keep §14's one decimal; a hair above zero reads "less than 0.1%" rather than a false "0.0%".
  const dist = d => { const x = num(d); return x == null ? '—' : x >= 0 && x < 0.05 ? 'less than 0.1%' : fmt.pctu(x, 1); };
  const BOOKW = { vol: 'volume', fund: 'funding', days: 'history', oi: 'open interest', lev: 'leverage', list: 'not listed', uni: 'filters' };

  // ------------------------------------------------------------------------------------------ data ---
  function posOf(b) { return b && Array.isArray(b.pos) ? b.pos.filter(isObj) : null; }
  // Closest to its stop first; a missing distance goes last (the push already sorts; this keeps it true).
  function sorted(list) {
    return list.map((p, i) => [p, i]).sort((a, z) => {
      const x = num(a[0].to_stop_pct), y = num(z[0].to_stop_pct);
      if (x == null || y == null) return x == null && y == null ? a[1] - z[1] : x == null ? 1 : -1;
      return x - y || a[1] - z[1];
    }).map(e => e[0]);
  }
  function findPos(id) { const s = sorted(posOf(S.b) || []); const i = s.findIndex(p => pid(p) === String(id)); return { s, i, p: i >= 0 ? s[i] : null }; }
  function stopsOf(p) {
    const st = Array.isArray(p.stops) ? p.stops.filter(s => Array.isArray(s) && num(s[0]) != null && num(s[1]) != null).map(s => [num(s[0]), num(s[1]) / 1000]) : [];
    return st.sort((a, z) => a[0] - z[0]);
  }
  // The stop trail, in R. From E4 the push ships every step. Before it, stops[] is [t_in, −1 R] plus the current stop
  // at the last check, so the steps come from the check log's trail events while the entry is inside its window.
  // gap = index of the one segment whose timing is unknown (drawn dashed), or −1.
  function trailOf(p, b) {
    const st = stopsOf(p), asof = num(p.as_of), tin = num(p.t_in);
    if (!st.length) return null;
    const cur = st[st.length - 1][1], end = Math.max(asof != null ? asof : st[st.length - 1][0], st[st.length - 1][0]);
    const pre = st.length === 1 || (st.length === 2 && asof != null && st[1][0] === asof);
    if (!pre) return { pts: st, end, src: 'e4', gap: -1 };
    const t0 = tin != null ? tin : st[0][0];
    if (st.length === 1) return { pts: [[t0, st[0][1]]], end, src: 'flat', gap: -1 };        // never raised: certain
    const ev = (b && Array.isArray(b.events) ? b.events : []).filter(e => Array.isArray(e) && e[1] === 'trail' && e[2] === p.c && num(e[0]) != null && num(e[7]) != null && e[0] >= t0 && e[0] <= end + 60)
      .map(e => [num(e[0]), num(e[7])]).sort((a, z) => a[0] - z[0]);
    if (!ev.length) return { pts: [[t0, st[0][1]], [end, cur]], end, src: 'ends', gap: 0 };
    // The event log holds 7 days (cap 200, trail events kept first). An entry inside its window has every raise in
    // it; when the cap bit, the window starts at the oldest event kept.
    let oldest = Infinity, n = 0;
    for (const e of b.events) if (Array.isArray(e) && num(e[0]) != null) { oldest = Math.min(oldest, e[0]); n++; }
    const g = isoS(b.gen) != null ? isoS(b.gen) : (clockOf(b) || {}).last_t;
    const win = n >= 200 || g == null ? oldest : Math.min(oldest, g - 7 * 86400);
    const full = t0 >= win - 60;
    const pts = [[t0, st[0][1]]].concat(ev);
    let gap = full ? -1 : 0;
    if (Math.abs(pts[pts.length - 1][1] - cur) > 0.015) { pts.push([end, cur]); if (gap < 0) gap = pts.length - 2; }
    return { pts, end, src: full ? 'log' : 'part', gap, win };
  }
  function raises(pts) { let n = 0; for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[i - 1][1] + 1e-9) n++; return n; }
  // Bitcoin's weekly and daily at entry, from the check that opened the position (inside the 7-day run window).
  function btcAt(p, b) {
    const t = num(p.t_in); if (t == null) return null;
    let best = null;
    for (const r of runsOf(b)) { const d = Math.abs(r.t - t); if (d <= 1800 && (!best || d < Math.abs(best.t - t))) best = r; }
    if (!best || typeof best.btc !== 'string' || best.btc.length < 2) return null;
    const w = c => c === 'B' ? 'bullish' : c === 'b' ? 'bearish' : 'no reading';
    return 'weekly ' + w(best.btc[0]) + ' · daily ' + w(best.btc[1]);
  }
  function evsOf(p, b) {
    const t0 = num(p.t_in);
    return (b && Array.isArray(b.events) ? b.events : []).filter(e => Array.isArray(e) && e[2] === p.c && num(e[0]) != null && (t0 == null || e[0] >= t0 - 60))
      .sort((a, z) => z[0] - a[0]);
  }

  // ---------------------------------------------------------------------------------------- words ---
  function stopWords(p, o) {
    o = o || {};
    const d = num(p.to_stop_pct), L = num(p.r_lock), T = k => o.tips ? tip(k) : '';
    let a;
    if (d == null) a = 'stop' + T('stop') + ' distance ' + na();
    else if (d < 0) a = '<span class="ps-thru">at or through the stop; checked next cycle</span>' + T('stop');
    else a = 'stop ' + dist(d) + ' below' + T('stop');
    const z = L == null ? '' : '<span class="ps-nw">' + (fmt.cls(L) === 'neg' ? 'risks ' : 'locks in ') + Rs(L) + T('lockedR') + '</span>';
    return a + (z ? ' · ' + z : '');
  }

  // --------------------------------------------------------------------------------------- ladder ---
  // Domain (§7.1): lo = min(−1.25, r_now − .25), hi = max(2, r_now + .5, r_lock + .5).
  function domain(p) {
    const n = num(p.r_now), l = num(p.r_lock);
    let lo = -1.25, hi = 2;
    if (n != null) { lo = Math.min(lo, n - 0.25); hi = Math.max(hi, n + 0.5); }
    if (l != null) { lo = Math.min(lo, l - 0.25); hi = Math.max(hi, l + 0.5); }
    return [lo, hi];
  }
  // Label rows: t0 sits on the track, t1 above it; b0 under it, b1 below that. Each label takes the first row of its
  // preference list where it clears the labels already there (6px gap); positions are % of the track width.
  function place(items, W) {
    const rows = {};
    for (const it of items) {
      const w = Math.min(it.w, W), x = it.x / 100 * W, L = clamp(x - w / 2, 0, Math.max(0, W - w));
      const got = it.pref.find(r => !(rows[r] || []).some(([a, z]) => L < z + 6 && L + w > a - 6)) || it.pref[it.pref.length - 1];
      (rows[got] = rows[got] || []).push([L, L + w]);
      it.row = got; it.left = W ? L / W * 100 : 0;
    }
    return { rt: rows.t1 ? 2 : 1, rb: rows.b1 ? 2 : 1 };
  }
  function fit(lad) {
    const trk = $('.ps-trk', lad); if (!trk) return;
    const W = trk.clientWidth; if (!W) return;
    const items = $$('.ps-lb', lad).map(el => ({ el, x: Number(el.dataset.x), w: el.offsetWidth, pref: String(el.dataset.pref || 't0').split(',') }));
    const r = place(items, W);
    items.forEach(it => { it.el.dataset.row = it.row; it.el.style.left = f2(it.left) + '%'; });
    lad.style.setProperty('--rt', r.rt); lad.style.setProperty('--rb', r.rb);
  }
  function fitAll(root) { $$('.ps-lad[data-fit]', root || document).forEach(lad => call(fit, lad)); }
  let resizeBound = false, rf = 0;
  function bindResize() {
    if (resizeBound) return; resizeBound = true;
    addEventListener('resize', () => { cancelAnimationFrame(rf); rf = requestAnimationFrame(() => fitAll()); });
  }
  function ladder(p, o) {
    o = o || {};
    const [lo, hi] = domain(p), X = r => +clamp((r - lo) / (hi - lo) * 100, 0, 100).toFixed(2);
    const n = num(p.r_now), l = num(p.r_lock), lc = l == null ? '' : fmt.cls(l);
    let trk = '';
    if (lc === 'pos') trk += '<i class="ps-band ps-lock" style="left:' + X(0) + '%;width:' + f2(X(l) - X(0)) + '%"></i>';
    if (lc === 'neg') trk += '<i class="ps-band ps-atrisk" style="left:' + X(l) + '%;width:' + f2(X(0) - X(l)) + '%"></i>';
    trk += '<i class="ps-tick ps-t1" style="left:' + X(-1) + '%"></i><i class="ps-tick ps-t0" style="left:' + X(0) + '%"></i>';
    if (l != null) trk += '<i class="ps-stopm" style="left:' + X(l) + '%"></i>';
    if (n != null) trk += '<i class="ps-bead" data-ps-bead style="left:' + X(n) + '%"></i>';
    const aria = 'R-ladder: first stop −1 R, entry 0 R' + (l != null ? ', stop ' + fmt.R(l) : '') + (n != null ? ', now ' + fmt.R(n) : ', no mark in this data') + '.';
    const attrs = ' role="img" aria-label="' + esc(aria) + '" data-lo="' + lo + '" data-hi="' + hi + '"';
    if (o.mini) return '<div class="ps-lad ps-mini"' + attrs + '><div class="ps-trk">' + trk + '</div></div>';
    const items = [
      n != null && { t: 'now ' + fmt.R(n), x: X(n), pref: ['t0', 't1'], cls: 'ps-ln' },
      { t: 'first stop', x: X(-1), pref: ['b0', 'b1'], cls: 'ps-lf' },
      { t: 'entry', x: X(0), pref: ['b0', 'b1'], cls: '' },
      l != null && { t: 'stop ' + fmt.R(l), x: X(l), pref: ['t0', 'b0', 't1', 'b1'], cls: 'ps-ls' },
    ].filter(Boolean);
    items.forEach(it => { it.w = it.t.length * 6.2 + 2; });
    const r = place(items, 300);                              // a first guess; after() re-lays with measured widths
    const labs = items.map(it => '<span class="ps-lb ' + it.cls + '" aria-hidden="true" data-row="' + it.row + '" data-x="' + it.x + '" data-pref="' + it.pref.join(',')
      + '" style="left:' + f2(it.left) + '%">' + esc(it.t) + '</span>').join('');
    return '<div class="ps-lad" data-fit' + attrs + ' style="--rt:' + r.rt + ';--rb:' + r.rb + '">' + labs + '<div class="ps-trk">' + trk + '</div></div>';
  }

  // ------------------------------------------------------------------------------------ trail line ---
  function trailHtml(p, b, o) {
    o = o || {};
    const tr = trailOf(p, b);
    if (!tr) return '<div class="ps-tr"><span class="ps-tk">Stop trail</span><span class="ps-tn">' + na() + '</span></div>';
    // In R at the stop price (before costs), like the check log's trail events; the headline's "locks in" is after costs.
    const pts = tr.pts, t0 = pts[0][0], span = Math.max(1, tr.end - t0), vals = pts.map(q => q[1]);
    const lo = Math.min(-1, ...vals), hi = Math.max(0, ...vals), H = o.h || 36;
    const X = t => f2(clamp((t - t0) / span * 100, 0, 100)), Y = v => 3 + (hi - v) / ((hi - lo) || 1) * (H - 6);
    let solid = '', dashed = '';
    for (let i = 1; i < pts.length; i++) {
      const [pt, pv] = pts[i - 1], [t, v] = pts[i];
      if (tr.gap === i - 1) dashed += 'M' + X(pt) + ' ' + f2(Y(pv)) + 'L' + X(t) + ' ' + f2(Y(v));
      else solid += 'M' + X(pt) + ' ' + f2(Y(pv)) + 'H' + X(t) + 'V' + f2(Y(v));
    }
    const last = pts[pts.length - 1];
    if (+X(last[0]) < 100) solid += 'M' + X(last[0]) + ' ' + f2(Y(last[1])) + 'H100';
    let dots = '';
    for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[i - 1][1] + 1e-9)
      dots += '<i class="ps-dt" style="left:' + X(pts[i][0]) + '%;top:' + f2(Y(pts[i][1]) / H * 100) + '%"></i>';
    const n = raises(pts), cur = last[1];
    const cap = tr.src === 'e4' || tr.src === 'flat' ? (n ? word.plural(n, 'raise') + ' since entry' : 'not raised yet')
      : tr.src === 'log' ? (n ? word.plural(n, 'raise') + ' since entry, from the check log' : 'not raised yet')
      : tr.src === 'part' ? 'raises before ' + fmt.when(tr.win) + ' are not in this data · trail history starts with the engine update'
      : 'raised; when is not recorded · trail history starts with the engine update';
    const aria = 'Stop trail: from ' + fmt.R(pts[0][1]) + ' at entry to ' + fmt.R(cur) + (n ? ', raised ' + word.plural(n, 'time') : ', not raised') + '.';
    return '<div class="ps-tr' + (o.bare ? ' ps-bare' : '') + '">' + (o.bare ? '' : '<span class="ps-tk">Stop trail</span>') + '<div class="ps-sp" role="img" aria-label="' + esc(aria) + '" style="height:' + H + 'px">'
      + '<svg viewBox="0 0 100 ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="ps-z" d="M0 ' + f2(Y(0)) + 'H100"/>'
      + (solid ? '<path class="ps-l1" d="' + solid + '"/>' : '') + (dashed ? '<path class="ps-l1 ps-gap" d="' + dashed + '"/>' : '') + '</svg>' + dots + '</div>'
      + '<span class="cap ps-tc">' + esc(cap) + '</span></div>';
  }

  // ------------------------------------------------------------------------------------- the card ---
  function kindPill(p) {
    return '<span class="pill' + (p.tier === 'A' ? ' auto' : '') + '">' + esc(cap1(word.kind(p.kind))) + ' · ' + esc(word.tier(p.tier)) + '</span>';
  }
  function exitsLine(p, first) {
    const d = num(p.to_stop_pct), e = isObj(p.exits) ? p.exits : {};
    const h4 = d == null ? '' : d < 0 ? ' (at or through it now)' : ' (' + dist(d) + ' below)';
    let s = 'Exits if a 4-hour close falls below the stop' + h4 + ' or the daily or weekly turns.';
    const dd = num(e.d_pct), ww = num(e.w_pct), side = v => v == null ? '—' : v < 0 ? dist(-v) + ' above the mark' : dist(v) + ' below';
    if (dd != null || ww != null) s += ' Daily line ' + side(dd) + ' · weekly line ' + side(ww) + '.';
    else s += ' <span class="ps-na">Daily and weekly distances after the engine update.</span>';
    if (first) s += '<span class="ps-nt1">No fixed target: it rides until the stop or a 4-hour, daily or weekly turn.</span>';
    return '<p class="ps-ex">' + s + '</p>';
  }
  function secLine(p) {
    const sz = num(p.size_pct), lev = num(p.lev), rk = num(p.risk_pct);
    return '<p class="ps-sec">Exposure ' + (sz == null ? '—' : fmt.pctu(sz, sz >= 10 ? 0 : 1)) + ' of pot · ' + (lev == null ? 'leverage —' : fmt.lev(lev) + ' isolated')
      + ' · only ' + (rk == null ? '—' : fmt.pctu(rk, 2)) + ' of pot at risk at entry' + tip('exposure') + '</p>';
  }
  function body(p, o) {
    o = o || {};
    const b = S.b, n = num(p.r_now), pnl = num(p.pnl_pct), tin = num(p.t_in), asof = num(p.as_of), bars = num(p.bars);
    const held = tin != null && asof != null ? 'held ' + fmt.dur(Math.max(0, asof - tin)) + (bars != null ? ' (' + word.plural(bars, 'bar') + ')' : '') : 'held ' + na(true);
    const marks = asof == null ? '' : n == null ? ' · mark ' + na() : ' · marks at ' + fmt.when(asof);
    return '<div class="ps-hd">' + chip(p.c, asof != null ? asof : undefined) + '<span class="ps-bk">' + esc(p.b || '—') + '</span>' + kindPill(p)
      + (o.sheet ? '' : '<button type="button" class="btn small ghost ps-more" data-pos="' + esc(pid(p)) + '" aria-label="' + esc((p.c || '') + ' position details') + '">Details ›</button>') + '</div>'
      + '<div class="ps-meta">' + held + marks + '</div>'
      + '<div class="ps-hl"><div class="ps-o"><span class="ps-big ' + fmt.cls(n) + '"' + (o.sheet ? '' : ' data-ps-r="' + esc(pid(p)) + '"') + '>' + (n == null ? '—' : fmt.R(n)) + '</span>'
      + '<span class="ps-w">open</span>' + tip('openR') + (n == null ? ' <span class="na">' + MISSING + '</span>' : '') + '</div>'
      + '<div class="ps-p"><span class="ps-pv ' + fmt.cls(pnl) + '">' + (pnl == null ? '—' : fmt.pct(pnl)) + '</span><span class="ps-w">of pot</span></div></div>'
      + '<p class="ps-stop">' + stopWords(p, { tips: o.sheet }) + '</p>'
      + ladder(p) + (o.sheet ? '' : trailHtml(p, b)) + exitsLine(p, o.first) + secLine(p);
  }
  function card(p, o) {
    return '<article class="card ps-card rise" data-pos="' + esc(pid(p)) + '" aria-label="' + esc((p.c || '') + ' position') + '">' + body(p, o) + '</article>';
  }

  // -------------------------------------------------------------------------------- empty (flat) ---
  function flatCard(b) {
    const st = stateOf(b), halted = !!(st.halt && st.halt.set) || !!(st.thr && st.thr.state === 'halted');
    const ns = Array.isArray(b.names) ? b.names.filter(isObj) : null;
    const best = g => ns.filter(n => n.grp === g && num(n.dist) != null && num(n.dist) > 0).sort((a, z) => num(a.dist) - num(z.dist))[0];
    let c;
    if (!ns) c = 'Closest now: ' + na();
    else {
      const nx = best('next'), th = best('thin');
      if (nx) c = 'Closest now: ' + chip(nx.c) + ' <a class="ps-deck hit" href="#now/ondeck">' + esc(word.dist(nx.dist)) + ' ›</a>';
      else if (th) c = 'Closest now: ' + chip(th.c) + ' ' + esc(word.dist(th.dist)) + ', but too thin (' + esc(word.reasons(th.elig)) + ') · <a class="ps-deck hit" href="#now/ondeck">On deck ›</a>';
      else c = 'No name is one flip away right now. <a class="ps-deck hit" href="#now/ondeck">On deck ›</a>';
    }
    return '<div class="card ps-flat rise"><p><b>No open positions.</b> An auto-grade flip that passes every check appears here with its stop and R-ladder.</p>'
      + (halted ? '<p class="ps-na">Buying is stopped right now, so nothing new opens until it resumes.</p>' : '')
      + '<p class="ps-cl">' + c + '</p></div>';
  }
  function cardsSection(b) {
    const list = posOf(b);
    const head = n => '<div class="ps-sh"><h2 class="eyebrow">Open positions' + (n ? ' · ' + n : '') + '</h2>' + (n > 1 ? '<span class="sub">closest to its stop first</span>' : '') + '</div>';
    if (!list) return head(0) + '<div class="card rise"><div class="empty">' + (b && b.v !== 2 ? 'Positions fill in after the next check.' : 'Open positions ' + na()) + '</div></div>';
    if (!list.length) return head(0) + flatCard(b);
    const s = sorted(list);
    return head(s.length) + '<div class="cq"><div class="ps-cards">' + s.map((p, i) => safe(() => card(p, { first: i === 0 }), (p.c || '') + ' position')).join('') + '</div></div>';
  }

  // ---------------------------------------------------------------------------------- risk budget ---
  // Meters draw with transform scaleX(--k): they start from the last drawn value (0 on the first view) and after()
  // moves them to the new one, so a first view grows from 0 and an arrival moves from the old value (§13).
  const KMEM = {};
  const kAttr = (key, k, style) => ' data-psk="' + esc(key) + '" data-k="' + (+clamp(k || 0, 0, 1).toFixed(4)) + '" style="' + (style ? style + ';' : '') + '--k:' + (KMEM[key] != null ? KMEM[key] : 0) + '"';
  const OP = [1, 0.8, 0.6, 0.45, 0.3];
  function row(label, value, viz, capHtml) {
    return '<div class="ps-row"><div class="ps-rl">' + label + '</div><div class="ps-rv">' + value + '</div>' + (viz ? '<div class="ps-viz">' + viz + '</div>' : '')
      + (capHtml ? '<div class="ps-rc cap">' + capHtml + '</div>' : '') + '</div>';
  }
  function bookOrder(b) {
    const rk = isObj(b.risk) ? b.risk : {}, by = isObj(rk.by_book) ? rk.by_book : {};
    const names = (Array.isArray(b.books) ? b.books : []).filter(isObj).map(x => x.b).filter(x => x != null);
    Object.keys(by).forEach(k => { if (!names.includes(k)) names.push(k); });
    return names.map(k => ({ b: k, r: isObj(by[k]) ? by[k] : {} }));
  }
  function openRisk(b, rk, cfg) {
    const cap = num(rk.cap_pct) != null ? num(rk.cap_pct) : num(cfg.open_cap_pct), used = num(rk.used_pct), per = num(cfg.risk_pct);
    const label = 'Open risk' + tip('riskInUse');
    if (used == null) return row(label, na(true), '', 'Open risk ' + na());
    const D = Math.max(cap || 0, used) || 1, X = v => +(clamp(v / D, 0, 1) * 100).toFixed(2);
    const bk = bookOrder(b);
    let at = 0, segs = '', i = 0;
    for (const x of bk) {
      const u = num(x.r.used_pct) || 0; if (u <= 0) continue;
      x.op = OP[Math.min(i++, OP.length - 1)]; x.start = at;
      segs += '<i class="ps-seg" style="left:' + X(at) + '%;width:' + f2(X(at + u) - X(at)) + '%;opacity:' + x.op + '"></i>';
      at += u;
    }
    // A tick where each book's own cap would stop it: from its segment's start, or from the end of the used span
    // for a book with nothing open (its next trade would start there).
    const ticks = [];
    for (const x of bk) {
      const c = num(x.r.cap_pct); if (c == null) continue;
      const t = (x.start != null ? x.start : at) + c;
      if (t > D + 1e-9) continue;
      const q = ticks.find(q => Math.abs(q.t - t) < 0.005);
      if (q) q.b.push(x.b); else ticks.push({ t, b: [x.b] });
    }
    const tk = ticks.map(q => '<i class="ps-cap" style="left:' + X(q.t) + '%" title="' + esc(q.b.join(', ') + ': may go to ' + pcap(q.t)) + '"></i>').join('');
    const leg = bk.map(x => {
      const u = num(x.r.used_pct), on = (u || 0) > 0;
      return '<span class="ps-lg"><i class="ps-sw' + (on ? '' : ' ps-off') + '"' + (on ? ' style="opacity:' + x.op + '"' : '') + '></i>' + esc(x.b) + ' <b>' + ppot(u) + '</b> of ' + pcap(x.r.cap_pct) + '</span>';
    }).join('');
    const room = per ? Math.max(0, Math.floor(((cap != null ? cap : D) - used) / per + 1e-9)) : null;
    const free = num(rk.max) != null && num(rk.n_open) != null ? Math.max(0, num(rk.max) - num(rk.n_open)) : null;
    const nroom = room == null ? null : free == null ? room : Math.min(room, free);
    const roomW = nroom == null ? '' : nroom === 0 ? 'No room for another full-size trade' + (room > 0 && free === 0 ? ': every slot is taken' : '') + '. '
      : 'Room for ' + word.plural(nroom, 'more full-size trade', 'more full-size trades') + (room > nroom ? ' (slots)' : '') + '. ';
    const viz = '<div class="ps-rt" role="img" aria-label="' + esc(ppot(used) + ' of ' + pcap(cap) + ' of the pot at risk, split by book. Ticks mark how far each book may go.') + '">'
      + '<div class="ps-rs"' + kAttr('risk', 1) + '>' + segs + '</div>' + tk + '</div><div class="ps-lgs">' + leg + '</div>';
    return row(label, '<b>' + ppot(used) + '</b> of ' + pcap(cap) + ' at risk', viz, esc(roomW) + 'Ticks mark how far each book may go (its own cap).');
  }
  function stopsHit(rk) {
    const v = num(rk.stops_hit_pct), n0 = num(rk.n_open) === 0;
    let val;
    if (v == null) val = na(true);
    else if (fmt.cls(v) === 'neg') val = '<b class="neg">' + fmt.pct(v) + '</b> of pot <span class="ps-wd neg">loss</span>';
    else if (fmt.cls(v) === 'pos') val = '<b class="pos">' + fmt.pct(v) + '</b> of pot <span class="ps-wd pos">locked in</span>';
    else val = '<b>0%</b> of pot · ' + (n0 ? 'nothing at risk' : 'about even');
    return row('If every stop hit now' + tip('lockedR'), val, '', v == null ? 'The result at every stop ' + na() : '');
  }
  function slots(rk, cfg) {
    const max = num(rk.max) != null ? num(rk.max) : num(cfg.max_pos), n = num(rk.n_open), L = 'Slots' + tip('slot');
    if (max == null || n == null) return row(L, na(true), '', '');
    const pips = Array.from({ length: clamp(max, 0, 24) }, (_, i) => '<i class="ps-pip' + (i < n ? ' ps-on' : '') + '"></i>').join('');
    return row(L, '<b>' + fmt.int(n) + '</b> of ' + fmt.int(max), '<span class="ps-pips" role="img" aria-label="' + esc(n + ' of ' + max + ' slots in use') + '">' + pips + '</span>',
      esc(fmt.int(Math.max(0, max - n)) + ' free.'));
  }
  function gross(rk, cfg) {
    const g = num(rk.gross_x), c = num(rk.gross_cap_x) != null ? num(rk.gross_cap_x) : num(cfg.gross_cap_x), L = 'Gross exposure';
    if (g == null) return row(L, na(true), '', '');
    return row(L, '<b>' + fmt.x(g) + '</b> of ' + (c == null ? '—' : fmt.lev(c)), '<div class="meter sx ps-m"><i' + kAttr('gross', c ? g / c : 0) + '></i></div>',
      'Every open position’s size added up, as a multiple of the pot.');
  }
  function drawdown(b, cfg) {
    const st = stateOf(b), thr = isObj(st.thr) ? st.thr : null, dd = num(thr && thr.dd_pct), mult = num(thr && thr.mult);
    const T = Array.isArray(cfg.thr) ? cfg.thr.map(num) : [null, null], t1 = T[0], t2 = T[1];
    const D = Math.max(25, t2 != null ? t2 * 1.25 : 0, dd || 0), X = v => +(clamp(v / D, 0, 1) * 100).toFixed(2);
    const state = thr && thr.state;
    let w = state === 'normal' ? 'normal' : state === 'halved' ? 'risk halved' : state === 'halted' ? 'buying stopped' : 'unknown';
    let wc = state === 'normal' ? 'pos' : state === 'halved' ? 'ps-wn' : state === 'halted' ? 'neg' : 'ps-mu';
    if (dd != null && state !== 'halted' && t2 != null && dd >= t2) { w = 'buying stops from the next check'; wc = 'neg'; }
    else if (dd != null && state === 'normal' && t1 != null && dd >= t1 && mult === 1) { w = 'risk halves from the next check'; wc = 'ps-wn'; }
    const lvl = dd == null ? '' : t2 != null && dd >= t2 ? 'ps-bad' : t1 != null && dd >= t1 ? 'ps-wrn' : 'ps-ok';
    const tick = (v, t) => v == null ? '' : '<i class="ps-gt" style="left:' + X(v) + '%"></i><span class="ps-gl" style="left:' + X(v) + '%">' + t + '</span>';
    const aria = 'Drawdown ' + (dd == null ? 'not in this data' : fmt.pctu(dd, 1)) + ' on a 0 to ' + D + '% scale.' + (t1 != null ? ' Risk halves at ' + t1 + '%.' : '') + (t2 != null ? ' Buying stops at ' + t2 + '%.' : '');
    const viz = '<div class="ps-g" role="img" aria-label="' + esc(aria) + '"><div class="ps-gtr"><i class="ps-gf ' + lvl + '"' + kAttr('dd', dd == null ? 0 : dd / D) + '></i></div>'
      + tick(t1, 'risk halves') + tick(t2, 'stops buying') + '</div>';
    const val = (dd == null ? na(true) : '<b>' + fmt.pctu(dd, 1) + '</b>') + ' · <span class="ps-wd ' + wc + '">' + w + '</span>';
    return row('Drawdown' + tip('drawdown'), val, viz, 'How far the pot is below its peak.' + (t1 != null && t2 != null ? ' Risk per trade halves at ' + esc(t1) + '%; buying stops at ' + esc(t2) + '% until reviewed.' : ''));
  }
  function riskCard(b) {
    const rk = isObj(b.risk) ? b.risk : null, cfg = isObj(b.cfg) ? b.cfg : {}, st = stateOf(b), dd = num(st.thr && st.thr.dd_pct);
    const h = '<section class="card cq ps-risk rise" id="positions-risk"><div class="head"><div class="ttl"><h2>Risk budget</h2><span class="sub">What the open positions could lose, as % of the pot</span></div></div>';
    if (!rk) return h + '<p class="ps-lead">Risk in use ' + na() + '</p><div class="ps-rows">' + drawdown(b, cfg) + '</div></section>';
    const lead = num(rk.n_open) === 0 ? '<p class="ps-lead">Nothing at risk. ' + (dd == null ? 'How far the pot is below its peak is not in this data.' : 'The pot is ' + fmt.pctu(dd, 1) + ' below its peak.') + '</p>' : '';
    return h + lead + '<div class="ps-rows">' + [openRisk(b, rk, cfg), stopsHit(rk), slots(rk, cfg), gross(rk, cfg), drawdown(b, cfg)].join('') + '</div></section>';
  }

  // ---------------------------------------------------------------------------------------- books ---
  // Why names are not tradeable today, grouped by check: "AAVE, CRV: volume · CRV: funding" (from names[].elig).
  function whyLine(bk, b) {
    const fails = {};
    for (const n of (Array.isArray(b.names) ? b.names.filter(isObj) : [])) if (n.b === bk.b && Array.isArray(n.elig))
      for (const e of n.elig) { const c = Array.isArray(e) ? e[0] : e; (fails[c] = fails[c] || []).push(n.c); }
    const why = isObj(bk.why) ? bk.why : {};
    return Object.keys(why).map(c => (fails[c] || []).length ? fails[c].map(esc).join(', ') + ': ' + esc(BOOKW[c] || c) : esc(BOOKW[c] || c) + ' ' + fmt.int(why[c])).join(' · ');
  }
  function tradesLine(bk, L, gates) {
    const s = L && L.stats && isObj(L.stats.book) ? L.stats.book[bk.b] : null, g = num(gates && gates.n);
    if (!isObj(s) || !num(s.n)) return '';
    const n = num(s.n), rel = num(s.rel_R);
    return 'n ' + fmt.int(n) + (g != null && n < g ? ' of ' + fmt.int(g) : '') + (rel != null ? ' · <span class="ps-nw">' + Rs(rel) + ' per trade vs holding' + tip('vsHolding') + '</span>' : '');
  }
  function namesHtml(bk) {
    const ns = (Array.isArray(bk.names) ? bk.names : []).filter(x => Array.isArray(x) && x[0]);
    if (!ns.length) return '';
    const one = x => '<span class="ps-nm">' + chip(x[0]) + (x[1] === 0 ? '<span class="ps-ut">untested</span>' : '') + '</span>';
    const rest = ns.slice(8);
    return '<div class="ps-nms">' + ns.slice(0, 8).map(one).join('') + '</div>'
      + (rest.length ? '<details class="ps-mn"><summary><span class="ps-mo">and ' + rest.length + ' more</span><span class="ps-mc">show fewer</span></summary><div class="ps-nms">' + rest.map(one).join('') + '</div></details>' : '');
  }
  function booksCard(b) {
    const books = Array.isArray(b.books) ? b.books.filter(isObj) : null;
    const h = ['<section class="card cq ps-books rise" id="positions-books"><div class="head"><div class="ttl"><h2>Books' + tip('book') + '</h2><span class="sub">Each book is judged against its benchmark, with its own share and risk cap</span></div></div>'];
    if (!books || (!books.length && b.v !== 2)) return h.join('') + '<div class="empty">' + (b.v !== 2 ? 'Books fill in after the next check.' : 'Books ' + na()) + '</div></section>';
    if (!books.length) return h.join('') + '<div class="empty">No books are set up.</div></section>';
    const by = isObj(b.risk) && isObj(b.risk.by_book) ? b.risk.by_book : {}, cfg = isObj(b.cfg) ? b.cfg : {};
    const L = S.ledger && S.ledgerGen === b.gen ? S.ledger : null;
    h.push('<ul class="list ps-bl">');
    for (const bk of books) {
      const r = isObj(by[bk.b]) ? by[bk.b] : {}, u = num(r.used_pct), c = num(r.cap_pct) != null ? num(r.cap_pct) : num(bk.cap_pct);
      const tr = num(bk.tradeable), of = num(bk.of), why = whyLine(bk, b), zero = tr === 0 && !!of;
      const codes = Object.keys(isObj(bk.why) ? bk.why : {}).map(c => esc(BOOKW[c] || c)).join(', ');
      const tw = tr == null ? 'tradeable today ' + na(true) : 'tradeable today <b>' + fmt.int(tr) + '</b> of ' + (of == null ? '—' : fmt.int(of));
      const bx = L ? tradesLine(bk, L, cfg.gates) : '';
      h.push('<li class="ps-b"><div class="ps-bh"><span class="ps-bn">' + esc(bk.b) + '</span>' + (bk.bench ? '<span class="ps-vs">vs ' + esc(bk.bench) + '</span>' : '')
        + (bk.on === false ? '<span class="pill mute">off</span>' : '') + '<span class="ps-bt' + (zero ? ' ps-wn' : '') + '">' + tw + (zero && codes ? ' · ' + codes : '') + '</span></div>'
        + '<div class="ps-bs">Gets ' + pcap(bk.share_pct) + ' of the pot, may risk up to ' + pcap(c) + (bk.sweep ? ' · earmarks gains for ' + esc(bk.bench || 'its benchmark') : '') + '</div>'
        + '<div class="ps-bm"><div class="meter sx ps-m"><i' + kAttr('book:' + bk.b, c ? (u || 0) / c : 0) + '></i></div><span class="ps-bu">' + (u == null ? na(true) : ppot(u)) + ' of ' + pcap(c) + ' in use'
        + (num(r.n) ? ' · ' + fmt.int(r.n) + ' open' : '') + '</span></div>'
        + (why ? '<div class="ps-bw">' + why + '</div>' : '')
        + namesHtml(bk)
        + '<div class="ps-bx" data-ps-bx="' + esc(bk.b) + '"' + (bx ? '' : ' hidden') + '>' + bx + '</div></li>');
    }
    h.push('</ul><p class="cap ps-foot">Open interest and leverage are checked when a signal fires.</p></section>');
    return h.join('');
  }
  // "n 4 of 30 · +0.30 R per trade vs holding" needs the ledger; it is fetched only once trades exist.
  function fillTrades(root, b) {
    if (!num(isObj(b.rec) ? b.rec.n : null) || !Array.isArray(b.books)) return;
    if (S.ledger && S.ledgerGen === b.gen) return;
    loadLedger().then(L => {
      if (!L || S.b !== b) return;
      const cfg = isObj(b.cfg) ? b.cfg : {};
      $$('[data-ps-bx]', root).forEach(el => {
        const bk = b.books.find(x => isObj(x) && x.b === el.dataset.psBx); if (!bk) return;
        const t = tradesLine(bk, L, cfg.gates); if (t) { el.innerHTML = t; el.hidden = false; }
      });
    });
  }

  // ------------------------------------------------------------------------------ waiting (legacy) ---
  function approvalCard(b) {
    const ps = Array.isArray(b.proposals) ? b.proposals.filter(isObj) : [];
    if (!ps.length) return '';
    const now = nowS();
    const li = ps.map(p => {
      const e = num(p.expires);
      const ex = e == null ? 'expiry ' + na() : e > now ? 'expires ' + fmt.when(e) + ' <span class="sub" data-ago="' + e + '">' + fmt.ago(e) + '</span>' : 'expired ' + fmt.when(e);
      return '<li class="it">' + chip(p.c) + '<span>' + esc(cap1(word.kind(p.kind, true))) + ' · ' + esc(word.tier(p.tier)) + ' · ' + ex + '</span></li>';
    }).join('');
    return '<section class="card ps-appr rise" id="positions-approval"><div class="head"><div class="ttl"><h2>Waiting for approval</h2><span class="sub">Old approval model: nothing new is proposed, and these expire on their own</span></div></div><ul class="list">' + li + '</ul></section>';
  }

  // ----------------------------------------------------------------------------------------- view ---
  function animate(root) {
    void root.offsetWidth;                                   // commit the starting values so the change transitions
    $$('[data-psk]', root).forEach(el => { const k = Number(el.dataset.k); el.style.setProperty('--k', k); KMEM[el.dataset.psk] = k; });
  }
  // First view after a change: the bead slides from the last seen R (localStorage ex.r.<id>) and open R counts from it.
  function lastSeen(root, list) {
    const ids = new Set();
    for (const p of list) {
      const id = pid(p), n = num(p.r_now); ids.add(id);
      if (n == null) continue;
      const old = num(lsGet('ex.r.' + id, null));
      if (old != null && Math.abs(old - n) >= 0.005 && !reduced) {
        const el = $$('.ps-card', root).find(x => x.dataset.pos === id);
        const lad = el && $('.ps-lad', el), bead = lad && $('[data-ps-bead]', lad), trk = lad && $('.ps-trk', lad);
        if (bead && trk && trk.clientWidth) {
          const lo = Number(lad.dataset.lo), hi = Number(lad.dataset.hi);
          const dx = (clamp((old - lo) / (hi - lo) * 100, 0, 100) - parseFloat(bead.style.left)) / 100 * trk.clientWidth;
          if (Math.abs(dx) >= 1) { bead.classList.add('ps-nt'); bead.style.setProperty('--dx', dx.toFixed(1) + 'px'); void bead.offsetWidth; bead.classList.remove('ps-nt'); bead.style.setProperty('--dx', '0px'); }
        }
        const big = el && $('[data-ps-r]', el);
        if (big) countUp(big, n, { from: old, fmt: v => fmt.R(v), ms: 800 });
      }
      lsSet('ex.r.' + id, n);
    }
    try {                                                    // forget positions that are no longer open
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('ex.r.') === 0 && !ids.has(k.slice(5))) drop.push(k); }
      drop.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
  VIEWS.positions = {
    title: 'Positions',
    render() {
      const b = S.b || {};
      return '<div class="stack ps">' + safe(() => cardsSection(b), 'Positions') + safe(() => riskCard(b), 'Risk budget') + safe(() => booksCard(b), 'Books')
        + safe(() => approvalCard(b), 'Waiting for approval') + '</div>';
    },
    after(root) {
      const b = S.b || {};
      bindResize();
      fitAll(root);
      animate(root);
      const list = posOf(b);
      if (list) call(lastSeen, root, list);
      fillTrades(root, b);
    },
  };

  // ---------------------------------------------------------------------------------------- sheet ---
  SHEETS.pos = function (id) {
    const b = S.b || {}, f = findPos(id), p = f.p;
    if (!p) return '<h2>Position</h2><div class="empty">This position is not open in the latest data. Closed trades are on <a href="#results">Results</a>.</div>';
    const px = isObj(p.px) ? p.px : {}, h = [], asof = num(p.as_of), tin = num(p.t_in);
    h.push('<h2 class="ps-h2"><span class="ps-coin">' + esc(p.c) + '</span> <span class="ps-h2s">open position</span></h2>');
    h.push('<div class="ps-card ps-sc">' + body(p, { sheet: true, first: true }) + '</div>');
    const F = rows => '<dl class="facts">' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>';
    const P = v => num(v) == null ? na() : fmt.px(v);
    h.push('<div class="sec"><h3>Prices</h3>' + F([['Entry', P(px.entry)], ['First stop' + tip('firstStop'), P(px.stop0)], ['Current stop', P(px.stop)],
      ['Last mark', num(px.mark) == null ? na() : fmt.px(px.mark) + (asof != null ? ' <span class="sub">at ' + fmt.when(asof) + '</span>' : '')]]) + '<p class="cap">Market prices, not your money.</p></div>');
    const bought = evsOf(p, b).find(e => e[1] === 'bought'), sp = bought && (String(bought[6] || '').match(/stop ([\d.]+)/) || [])[1];
    const bars = num(p.bars), sz = num(p.size_pct), rk = num(p.risk_pct), btc = btcAt(p, b), bk = (Array.isArray(b.books) ? b.books : []).find(x => isObj(x) && x.b === p.b);
    h.push('<div class="sec"><h3>Trade</h3>' + F([
      ['Book', esc(p.b || '—') + (bk && bk.bench ? ' <span class="sub">vs ' + esc(bk.bench) + '</span>' : '')],
      ['Trigger', esc(cap1(word.kind(p.kind, true)))],
      ['Grade', esc(word.tier(p.tier)) + (p.tier === 'A' ? tip('auto') : p.tier === 'B' ? tip('watch') : '')],
      ['Opened', tin == null ? na() : fmt.stamp(tin)],
      ['Held', tin != null && asof != null ? fmt.dur(Math.max(0, asof - tin)) + (bars != null ? ' · ' + word.plural(bars, 'bar') : '') : na()],
      ['Costs so far', num(p.cost_R) == null ? na() : fmt.R(p.cost_R) + ' <span class="sub">fees and funding</span>'],
      ['Exposure' + tip('exposure'), sz == null ? na() : fmt.pctu(sz, sz >= 10 ? 0 : 1) + ' of pot · ' + (num(p.lev) == null ? '—' : fmt.lev(p.lev) + ' isolated')],
      ['At risk at entry', rk == null ? na() : fmt.pctu(rk, 2) + ' of pot'],
      ['Stop at entry', sp ? fmt.pctu(sp, 1) + ' below' : na()],
      ['Bitcoin at entry', btc ? esc(btc) : na()],
    ]) + '</div>');
    const tr = trailOf(p, b);
    if (tr) {
      const pts = tr.pts, steps = [];
      pts.forEach((q, i) => {
        if (i > 0 && Math.abs(q[1] - pts[i - 1][1]) < 1e-9) return;           // an unchanged stop is not a step
        const w = i === 0 ? 'first stop' : q[1] > pts[i - 1][1] ? 'raised to' : 'moved to';
        const when = i > 0 && tr.gap === i - 1 ? 'by ' + fmt.when(q[0]) + ' <span class="sub">(when is not recorded)</span>' : fmt.when(q[0]);
        steps.push('<li><span class="ps-stt">' + when + '</span><span>' + w + ' ' + Rs(q[1]) + '</span></li>');
      });
      h.push('<div class="sec"><h3>Stop trail' + tip('stop') + '</h3>' + trailHtml(p, b, { h: 56, bare: true }) + '<ol class="ps-steps">' + steps.reverse().join('') + '</ol>'
        + '<p class="cap">Stop levels in R at the stop price, before costs; “locks in” above is after costs so far and the estimated exit fee.</p></div>');
    }
    const ev = evsOf(p, b).slice(0, 12);
    if (ev.length) h.push('<div class="sec"><h3>Since entry</h3><ul class="ps-evs">' + ev.map(e => {
      const w = word.event(e); return '<li><span class="ps-eic">' + icon(w.ic) + '</span><span class="ps-evt">' + fmt.when(e[0]) + '</span><span class="ps-evx">' + w.html + '</span></li>';
    }).join('') + '</ul></div>');
    const pv = f.s[f.i - 1], nx = f.s[f.i + 1];
    if (f.s.length > 1) h.push('<div class="pn">' + (pv ? '<button type="button" class="btn small" data-ps-go="' + esc(pid(pv)) + '">‹ ' + esc(pv.c) + '</button>' : '<span></span>')
      + '<span class="sub">' + (f.i + 1) + ' of ' + f.s.length + '</span>'
      + (nx ? '<button type="button" class="btn small" data-ps-go="' + esc(pid(nx)) + '">' + esc(nx.c) + ' ›</button>' : '<span></span>') + '</div>');
    return {
      html: h.join(''),
      after(el) {
        bindResize();
        fitAll(el);
        const go = e => {
          const t = e.target instanceof Element && e.target.closest('[data-ps-go]'); if (!t) return;
          e.preventDefault();
          const id2 = t.dataset.psGo;
          openSheet(SHEETS.pos(id2), { kind: 'pos', arg: id2, replace: true });
        };
        el.addEventListener('click', go);
        return () => el.removeEventListener('click', go);
      },
    };
  };

  // -------------------------------------------------------------------------------------- exports ---
  COMP.positionCard = (p, o) => isObj(p) ? card(p, o) : '';
  COMP.ladder = (p, o) => isObj(p) ? ladder(p, o) : '';
  COMP.stopWords = (p, o) => isObj(p) ? stopWords(p, o) : '';
  COMP.fitLadders = root => { bindResize(); fitAll(root); };
}
