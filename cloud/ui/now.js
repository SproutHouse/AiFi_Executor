// cloud/ui/now.js — On deck (spec §4.6), shared as COMP.onDeck(el, opts). See cloud/ui/README.md.
// The Now tab itself is gone (COMMAND_CENTER_SPEC §2.3): its jobs moved to the bot page's Overview (bot.js), which mounts
// On deck inside its "On deck" disclosure (id="overview-ondeck"). Any element carrying [data-ondeck] is redrawn here
// when the shared cursor moves, so On deck follows a replayed check (its as-at mode).
{
  const arr = v => (Array.isArray(v) ? v : null);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const evsOf = b => (arr(b && b.events) ? b.events.filter(e => Array.isArray(e) && num(e[0]) != null) : null);
  const r2 = x => (Math.abs(x) < 0.005 ? 0 : x);
  // --------------------------------------------------------------------------------- §4.6 On deck --
  const TITLE = { sig: 'Signalled at this check', next: 'Could signal next', thin: 'Armed, too thin', run: 'Already running', notset: 'Not set up', held: 'Held', nodata: 'No data' };
  const HEAD_TIP = () => 'While ' + aBw('a') + ' cloud is bearish its line can only step down, so each figure is the most the next close must rise. Not a prediction. A signal still has to pass the safety checks and find a free slot.';
  const SIGC = 'gmrpPeE';
  const OUT = { blocked: 'r', recorded: 'p', proposed: 'P', notfilled: 'e', bought: 'E' };
  const btcOf = run => { const s = String((run && run.btc) || ''); return s[0] === 'B' ? 1 : s[0] === 'b' ? 0 : null; };
  function bookMap(b) {
    const m = {};
    for (const bk of arr(b.books) || []) for (const n of arr(bk && bk.names) || []) { const c = Array.isArray(n) ? n[0] : n; if (c && !m[c]) m[c] = bk.b; }
    return m;
  }
  const kindTier = k => { const s = String(k || ''); return [s[0] === 'f' ? 'flip' : s[0] === 'p' ? 'pullback' : '', s[1] === 'A' ? 'auto grade' : s[1] === 'B' ? 'watch-only' : ''].filter(Boolean).join(', '); };
  function deckModel(b, at) {
    const G = { sig: [], next: [], thin: [], run: [], notset: [], held: [], nodata: [] };
    const lr = lastRun(b), run = at != null ? runAt(at, b) : null, bk = bookMap(b);
    const asAt = !!run && !!lr && run.t !== lr.t;
    if (!asAt) {
      if (!arr(b.names)) return { asAt, G, missing: true };
      const rx = obj(lr && lr.rx) || {}, pos = {};
      for (const p of arr(b.pos) || []) if (p && p.c) pos[p.c] = p;
      for (const n of b.names) {
        if (!obj(n) || !n.c) continue;
        const g = n.grp === 'error' ? 'nodata' : G[n.grp] && n.grp !== 'sig' ? n.grp : 'nodata';
        G[g].push({ c: n.c, bk: n.b || bk[n.c], code: n.st, w: n.w, d: n.d, h4: n.h4, dist: num(n.dist), elig: arr(n.elig), rx: arr(rx[n.c]), pos: pos[n.c], sig: n.sig });
      }
      return { asAt, G, run: lr, btcW: (obj(stateOf(b).btc) || {}).w };
    }
    const tg = obj(run.tg) || {}, rx = obj(run.rx) || {}, hx = obj(run.hx) || {};
    if (run.rd == null) {                                   // counts-only run: only the triggered names are known
      const E = evsOf(b) || [];
      for (const c of Object.keys(tg)) {
        const ev = E.find(e => e[0] === run.t && e[2] === c && OUT[e[1]]);
        G.sig.push({ c, bk: bk[c], code: ev ? OUT[ev[1]] : 'm', rx: arr(rx[c]), tg: tg[c] });
      }
      return { asAt, G, run, counts: true, btcW: btcOf(run) };
    }
    const order = arr(b.order) || [], rd = String(run.rd), dx = arr(run.dx);
    for (let i = 0; i < rd.length && i < order.length; i++) {
      const code = rd[i], c = order[i];
      if (code === '-') continue;
      const d = dx && num(dx[i]) != null ? dx[i] / 10 : null;
      const dir = { a: [1, 1, 0], t: [1, 1, 0], u: [1, 1, 1], w: [0, null, null], d: [1, 0, null] }[code] || [null, null, null];
      const g = { a: 'next', t: 'thin', u: 'run', w: 'notset', d: 'notset', h: 'held', x: 'nodata', '!': 'nodata', n: 'nodata' }[code] || (SIGC.indexOf(code) >= 0 ? 'sig' : 'nodata');
      G[g].push({ c, bk: bk[c], code, w: dir[0], d: dir[1], h4: dir[2], dist: d, elig: null, rx: arr(rx[c]), hx: hx[c], tg: tg[c] });
    }
    return { asAt, G, run, btcW: btcOf(run) };
  }
  const dirWords = it => 'weekly ' + word.dir(it.w) + ', daily ' + word.dir(it.d) + ', ' + bw() + ' ' + word.dir(it.h4);
  function wd3(it) {
    const c = (lab, v) => '<span class="' + (v === 1 ? 'up' : v === 0 ? 'dn' : 'na') + '"><i>' + lab + '</i><b>' + (v === 1 ? '▲' : v === 0 ? '▼' : '–') + '</b></span>';
    return '<span class="nw-wd3" role="img" aria-label="' + esc(dirWords(it)) + '">' + c('W', it.w) + c('D', it.d) + c(({ 3600: '1h', 86400: '1d' })[BAR] || '4h', it.h4) + '</span>';
  }
  // A signal at the check shown: its stage word, plus every failing check for a blocked or unfilled one.
  function sigWords(it) {
    if (!it.code || SIGC.indexOf(it.code) < 0) return '';
    return (it.code === 'p' ? 'recorded, not traded' : stage(it.code).short) + ((it.code === 'r' || it.code === 'e') && it.rx && it.rx.length ? ': ' + word.reasons(it.rx) : '');
  }
  function tile(it, g, M) {
    const d = it.dist, k = d == null ? 0 : 1 - Math.min(Math.max(d, 0), 10) / 10;
    const why = g === 'thin' ? (M.asAt ? 'too thin then' : it.elig && it.elig.length ? word.reasons(it.elig) : 'fails a check') : '';
    const sw = sigWords(it);
    const lbl = [it.c + ', ' + TITLE[g].toLowerCase(), word.dist(d), dirWords(it), it.bk ? it.bk + ' book' : '', why, sw].filter(Boolean).join(', ');
    return '<button type="button" class="nw-tile ' + (g === 'thin' ? 'st-t' : 'st-a') + '" data-name="' + esc(it.c) + '"' + (M.asAt ? ' data-at="' + M.run.t + '"' : '') + ' aria-label="' + esc(lbl) + '">'
      + '<span class="nw-tt"><span class="tk">' + esc(it.c) + '</span>' + wd3(it) + '</span>'
      + '<span class="nw-need">' + esc(word.dist(d)) + '</span>'
      + '<span class="nw-prox" style="--k:' + k.toFixed(3) + '"><i></i></span>'
      + '<span class="nw-tb">' + (it.bk ? '<span>' + esc(it.bk) + '</span>' : '') + (why ? '<span class="nw-why">' + esc(why) + '</span>' : '') + (sw ? '<span class="nw-why">' + esc(sw) + '</span>' : '') + '</span></button>';
  }
  const HX = s => {
    const m = /^([tc])([+\-−]?[\d.]+)$/.exec(String(s || ''));
    if (m) { const v = num(m[2].replace('−', '-')); return m[1] === 't' ? 'stop raised, ' + (v != null && r2(v) < 0 ? 'still risks ' : 'locks ') + fmt.R(v) : 'sold ' + fmt.R(v); }
    return { g: 'no reading on one timeframe', '!': 'exit check failed', '?': 'no exit action logged', k: 'kept' }[s] || 'held';
  };
  function chipText(it, g, M) {
    let main = '', warn = '';
    if (g === 'run') {
      main = word.dist(it.dist);
      const sw = sigWords(it), told = new Set(sw && it.rx ? it.rx.map(p => p[0]) : []);
      const el = !M.asAt && it.elig ? it.elig.filter(p => !told.has(p[0])) : [];
      warn = [sw, el.length ? word.reasons(el) : ''].filter(Boolean).join(' · ');
    } else if (g === 'notset') main = it.code === 'w' || (it.code !== 'd' && it.w !== 1) ? 'weekly' : 'daily';
    else if (g === 'held') {
      if (M.asAt) main = HX(it.hx);
      else { const ts = it.pos ? num(it.pos.to_stop_pct) : null; main = ts == null ? 'held' : ts < 0 ? 'at or through the stop' : word.dist(ts, true) + ' (' + bw() + ' line)'; }
    } else if (g === 'nodata') main = it.code === 'x' ? 'no market data' : it.code === '!' ? 'error reading' : it.code === 'n' ? bw() + ' not ready' : 'no reading';
    else if (g === 'sig') {
      main = it.code === 'p' ? 'recorded, not traded' : stage(it.code).short;
      if ((it.code === 'r' || it.code === 'e') && it.rx && it.rx.length) warn = word.reasons(it.rx);
      const kt = kindTier(it.code === 'p' && String(it.tg || '')[1] === 'B' ? String(it.tg)[0] : it.tg);
      if (kt) main = kt + ' · ' + main;
    }
    return { main, warn };
  }
  function nchip(it, g, M) {
    const t = chipText(it, g, M), code = it.code || '-';
    const lbl = it.c + ', ' + TITLE[g].toLowerCase() + (t.main || t.warn ? ': ' + [t.main, t.warn].filter(Boolean).join(', ') : '');
    return '<button type="button" class="nw-nc hit6 st-' + esc(code) + '" data-name="' + esc(it.c) + '"' + (M.asAt ? ' data-at="' + M.run.t + '"' : '') + ' aria-label="' + esc(lbl) + '">'
      + '<b>' + esc(it.c) + '</b>' + (t.main ? '<span>' + esc(t.main) + '</span>' : '') + (t.warn ? '<span class="w">' + esc(t.warn) + '</span>' : '') + '</button>';
  }
  const count = n => ' <span class="nw-n">· ' + n + '</span>';
  function tileGroup(g, list, M) {
    const title = g === 'next' && M.btcW !== 1 ? 'Could flip next (watch-only while Bitcoin’s weekly is not bullish)' : TITLE[g];
    return '<div class="nw-g ' + g + '"><h3 class="nw-gh">' + esc(title) + count(list.length) + tip(g === 'next' ? 'oneflip' : 'thin') + '</h3>'
      + '<div class="nw-tiles">' + list.map(it => tile(it, g, M)).join('') + '</div></div>';
  }
  function chipGroup(g, list, M) {
    return '<div class="nw-g ' + g + '"><h3 class="nw-gh">' + esc(TITLE[g]) + count(list.length) + '</h3><div class="nw-chips">' + list.map(it => nchip(it, g, M)).join('') + '</div></div>';
  }
  function disc(g, list, M) {
    return '<details class="disc nw-dg ' + g + '"><summary>' + esc(TITLE[g]) + ' · ' + list.length + (g === 'run' ? tip('cushion') : '') + '</summary>'
      + '<div class="body"><div class="nw-chips">' + list.map(it => nchip(it, g, M)).join('') + '</div></div></details>';
  }
  const byDist = (a, c) => (a.dist == null) - (c.dist == null) || (a.dist ?? 0) - (c.dist ?? 0);
  function deckInner(b, at) {
    if (!b) return '';
    const M = deckModel(b, at === undefined ? S.cursor : at), G = M.G, when = M.asAt ? fmt.when(M.run.t) : '';
    let h = '<div class="head"><div class="ttl"><h2>On deck<button class="tip" type="button" data-tip="' + esc(HEAD_TIP()) + '" aria-label="What is On deck?">?</button></h2>'
      + '<span class="sub">' + (M.asAt ? 'As at ' + esc(when) + ', recorded' : 'What the next ' + esc(bw()) + ' close could trigger') + '</span></div>';
    if (M.asAt) h += '<div class="acts"><div class="seg quiet nw-seg"><span class="ind"></span><button type="button" data-v="now" data-cursor="" aria-pressed="false" aria-label="Back to now" title="Back to now">Now</button>'
      + '<button type="button" data-v="at" aria-pressed="true">As at ' + esc(when) + '</button></div></div>';
    h += '</div>';
    if (M.missing) return h + '<div class="empty">Readings: ' + na() + '</div>';
    if (M.counts) {
      const first = runsOf(b).find(r => r && r.rd != null);
      h += '<p class="note nw-cnt">Names were not recorded for this check; per-name readings start ' + (first ? esc(fmt.stamp(first.t)) : 'with a later check') + '.</p>';
      return h + (G.sig.length ? chipGroup('sig', G.sig, M) : '<div class="empty">No signal at this check.</div>');
    }
    G.next.sort(byDist); G.thin.sort(byDist);
    const parts = [];
    if (G.sig.length) parts.push(chipGroup('sig', G.sig, M));
    if (!G.next.length && !G.thin.length) {
      if (!G.run.length && !G.notset.length) parts.push('<div class="empty">Readings appear after the next check.</div>');
      else {
        const s = [];
        if (G.run.length) s.push(word.plural(G.run.length, 'name') + ' ' + (G.run.length === 1 ? 'is' : 'are') + ' already running');
        if (G.notset.length) s.push(G.notset.length + ' ' + (G.notset.length === 1 ? 'is' : 'are') + ' not set up');
        parts.push('<p class="nw-none">Nothing ' + (M.asAt ? 'was' : 'is') + ' one close away. ' + esc(s.join('; ')) + '.</p>');
      }
    }
    if (G.next.length) parts.push(tileGroup('next', G.next, M));
    if (G.thin.length) parts.push(tileGroup('thin', G.thin, M));
    if (G.run.length) parts.push(disc('run', G.run, M));
    if (G.notset.length) parts.push(disc('notset', G.notset, M));
    if (G.held.length) parts.push(chipGroup('held', G.held, M));
    if (G.nodata.length) parts.push(chipGroup('nodata', G.nodata, M));
    return h + parts.join('');
  }
  // COMP.onDeck(el, {at, b}): draws On deck into el (its inner content: head and groups). at = a run t for the
  // as-at mode, null for now; left out, it follows the shared cursor. Returns the html.
  COMP.onDeck = function (el, opts) {
    const o = opts || {};
    let h;
    try { h = deckInner(o.b || S.b, o.at !== undefined ? o.at : S.cursor); }
    catch (e) { report(e, 'On deck'); h = '<div class="empty"><b>On deck</b> · This panel couldn’t be drawn from this data.</div>'; }
    if (el) { el.innerHTML = h; initSegs(el); }
    return h;
  };
  onCursor(t => { if (!S.b) return; $$('[data-ondeck]').forEach(el => COMP.onDeck(el, { at: t })); });
}
