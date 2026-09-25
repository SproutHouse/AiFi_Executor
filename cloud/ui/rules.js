// cloud/ui/rules.js — the Rules tab (spec §10). One block (ui/README.md): private names stay inside; the only export is
//   VIEWS.rules    #rules                    In force: plain sentences built from the bundle's cfg, books and clock
//                  #rules/glossary           every GLOSS entry as a details list (#rules/glossary/<key> opens one term)
//                  #rules/<slug>             one of the 9 docs, fetched once from /api/doc/<slug> and kept for the session
// A single-row .seg.quiet nav (sliding .ind, scrolls inside itself, centres the active item) swaps the pane in place and
// keeps the hash in step with history.pushState, so Back walks the panes (the hashchange re-routes). Log out sits at the
// foot on phones; the rail carries it on wider screens. Numbers come from cfg at render time, never from this file.
{
  const DOCS = [['how_it_works', 'How it works'], ['logic', 'Decision logic'], ['risk', 'Risk'], ['universe', 'Universe and books'],
    ['execution', 'Execution'], ['security', 'Security'], ['ledger', 'The ledger'], ['operations', 'Runbook'], ['decisions', 'Decisions']];
  const PANES = [['inforce', 'In force'], ['glossary', 'Glossary']].concat(DOCS);
  const TITLE_OF = {}; PANES.forEach(p => { TITLE_OF[p[0]] = p[1]; });
  const FILE_OF = {}; DOCS.forEach(d => { FILE_OF[d[0].toUpperCase()] = d[0]; });     // "LOGIC.md" in a doc → #rules/logic
  const isDoc = v => DOCS.some(d => d[0] === v);
  const docs = {};                       // slug → {p: Promise} while loading, then {html} or {err: kind}
  let cur = 'inforce', drawn = '';       // the pane on screen, and the data it was drawn from (to skip no-op arrivals)

  const B = s => '<b>' + s + '</b>';
  const and = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  // A setting prints as configured: 1 → "1", 2.5 → "2.5", 0.045 → "0.045" (up to 3 decimals, the phone's digits).
  const cf = v => {
    const x = num(v); if (x == null) return null;
    let d = 0; while (d < 3 && Math.abs(x * Math.pow(10, d) - Math.round(x * Math.pow(10, d))) > 1e-9) d++;
    return fmt.num(x, d);
  };
  const pos = v => { const x = num(v); return x != null && x > 0 ? cf(x) : null; };    // the push writes 0 for an unset filter
  const SELLS = 'Sells on the stop (it follows the 4-hour line up, never down) or when the 4-hour, daily or weekly turns. No fixed target.';

  // ------------------------------------------------------------------------------------ settings ---
  // A v1 bundle carried the raw settings and books.json; read them into the v2 shape so the sentences still build.
  function cfgOf1(b) {
    if (!b) return null;
    if (isObj(b.cfg)) return b.cfg;
    const s = isObj(b.settings) ? b.settings : null; if (!s) return null;
    const u = isObj(s.universe) ? s.universe : {}, th = isObj(s.throttle) ? s.throttle : {}, ap = isObj(s.approval) ? s.approval : {};
    const m = v => num(v) == null ? null : num(v) / 1e6;
    return { v1: true, ver: s.version, risk_pct: s.risk_per_trade_pct, open_cap_pct: s.open_risk_cap_pct, gross_cap_x: s.gross_exposure_cap_x,
      lev_cap_x: s.leverage_cap_x, max_pos: s.max_positions, thr: [th.halve_at_drawdown_pct, th.halt_at_drawdown_pct],
      late_min: isObj(s.data) ? s.data.late_run_minutes : null, min_stop_pct: s.min_stop_distance_pct, fee_pct: s.fee_taker_pct,
      approval: ap.mode, auto: ap.auto_tiers, uni: { vol_m: m(u.min_day_volume_usd), oi_m: m(u.min_open_interest_usd), days: u.min_daily_bars,
        fund_pct: u.max_funding_annual_pct, lev: u.min_max_leverage } };
  }
  function booksOf(b) {
    if (!b || !Array.isArray(b.books)) return null;
    return b.books.filter(isObj).map(x => x.b != null ? x : {                            // v1: books.json as written
      b: x.book, bench: x.benchmark, share_pct: x.pot_share_pct, cap_pct: x.open_risk_cap_pct, on: x.enabled, sweep: x.sweep_gains_to_benchmark,
      names: (Array.isArray(x.names) ? x.names : []).map(n => isObj(n) ? [n.coin, n.note === 'untested' ? 0 : n.note === 'backtested' ? 1 : null] : [n, null]),
    });
  }
  // Everything the In force and Glossary panes are drawn from; an arrival that leaves it unchanged leaves the DOM alone.
  function keyOf(b) {
    b = b || {}; const k = clockOf(b) || {};
    try { return JSON.stringify([b.cfg || b.settings || null, b.books || null, b.mode || null, b.origin || null, k.lag_med_min, k.lag_n, k.last_t, k.limit_min, fmt.md(nowS())]); }
    catch (e) { return String(Math.random()); }
  }
  // The six 4-hour closes as the phone's clock reads them, earliest first ("12:00 am … 8:00 pm" in Toronto).
  function closes() {
    const d0 = Math.floor(nowS() / 86400) * 86400, n = Math.round(86400 / BAR);
    return Array.from({ length: n }, (_, i) => d0 + i * BAR)
      .map(t => { const d = new Date(t * 1000); return [d.getHours() * 60 + d.getMinutes(), t]; })
      .sort((a, z) => a[0] - z[0]).map(x => fmt.time(x[1]));
  }

  // ------------------------------------------------------------------------------------- In force ---
  // One row per rule: [label, sentence html]. A clause whose setting is missing is left out, never guessed.
  function ruleRows(b, c) {
    const R = [], u = isObj(c.uni) ? c.uni : {}, thr = Array.isArray(c.thr) ? c.thr : [], g = isObj(c.gates) ? c.gates : {};
    const m = modeOf(b), K = clockOf(b) || {};
    if (m.eff) {
      let s = m.eff === 'live' ? 'Runs ' + B('live') + ': orders reach the exchange, and every position keeps its stop on the exchange itself.'
        : 'Runs on ' + B('paper') + ': every rule on real market data, but no order reaches the exchange.' + tip('paper');
      if (m.req && m.req !== m.eff) s += '<span class="ru-x">Live was requested; it is running paper: ' + esc(m.note || 'live requirements missing') + '.</span>';
      R.push(['Mode', s]);
    }
    {                                                                  // when it checks
      const lag = num(K.lag_med_min), n = num(K.lag_n), lim = num(c.late_min) != null ? num(c.late_min) : num(K.limit_min);
      const sch = num(c.sched_min) != null ? num(c.sched_min) : num(K.sched_min);
      let s = 'Checks ' + B(Math.round(86400 / BAR) + ' times a day') + ', ';
      s += lag != null && n != null && n >= 3 ? 'about ' + B(Math.max(5, Math.round(lag / 5) * 5) + ' minutes') + ' after each 4-hour close.'
        : 'shortly after each 4-hour close' + (sch != null ? ' (it is scheduled ' + fmt.int(sch) + ' minutes after)' : '') + '.';
      let x = 'Closes are at ' + and(closes()) + ' your time (every 4 hours from 00:00 UTC).';
      if (lim != null) x += ' A check that starts more than ' + fmt.int(lim) + ' minutes after its close skips buys for that bar; exits still run.' + tip('late');
      R.push(['When', s + '<span class="ru-x">' + x + '</span>']);
    }
    {                                                                  // what it buys
      const auto = Array.isArray(c.auto) ? c.auto : null, ap = c.approval, ck = Array.isArray(c.checks) ? c.checks.filter(x => typeof x === 'string' && x) : [];
      let s = '';
      if (auto) {
        const A = auto.indexOf('A') >= 0, Bt = auto.indexOf('B') >= 0;
        if (A && !Bt) s = 'Buys on its own only an ' + B('auto-grade') + tip('auto') + ' signal: a 4-hour flip' + tip('flip') + ' while the coin’s weekly and daily and Bitcoin’s weekly are bullish.';
        else if (A && Bt) s = 'Buys on its own every signal, auto grade and watch-only grade alike.' + tip('signal');
        else if (Bt) s = 'Buys on its own only a ' + B('watch-only-grade') + ' signal.' + tip('watch');
        else s = 'Buys nothing on its own.';
        const rest = !(A && Bt);
        if (ap === 'never') s += (rest ? ' Everything else is ' + B('recorded, not traded') + '.' + (A && !Bt ? tip('watch') : '') : '') + ' Nobody approves anything.';
        else if (ap && rest) s += ' Other signals are proposed for the owner’s approval during online hours (the earlier model), and a proposal nobody approves expires.';
      }
      if (ck.length) s += '<details class="ru-more" data-k="checks"><summary><span>Every buy first passes ' + B(ck.length + ' safety checks') + ', in this order</span></summary>'
        + '<ol class="ru-ck">' + ck.map(x => '<li>' + esc(cap1(x)) + '</li>').join('') + '</ol></details>';
      if (s) R.push(['Buys', s]);
    }
    {                                                                  // how much it risks
      const rp = cf(c.risk_pct), oc = cf(c.open_cap_pct), mp = num(c.max_pos), gx = cf(c.gross_cap_x), lx = cf(c.lev_cap_x);
      const lim = [oc != null && B(oc + '%') + ' at once', mp != null && B(fmt.int(mp)) + ' positions', gx != null && B(gx + '×') + ' exposure'].filter(Boolean);
      let s = rp != null ? 'Risks ' + B(rp + '%') + ' of the pot per trade' + (lim.length ? '; at most ' + lim.join(', ') : '') + '.'
        : lim.length ? 'At most ' + lim.join(', ') + '.' : '';
      if (s) s += tip('riskInUse');
      if (lx != null) s += (s ? ' ' : '') + 'Leverage never above ' + B(lx + '×') + '.';
      if (s) R.push(['Risk', s]);
    }
    R.push(['Sells', SELLS + tip('line')]);
    {                                                                  // drawdown limits
      const h = cf(thr[0]), hh = cf(thr[1]);
      const p = [h != null && 'halves risk at ' + B(h + '%') + ' drawdown', hh != null && 'stops buying at ' + B(hh + '%') + ' until reviewed'].filter(Boolean);
      R.push(['Drawdown', p.length ? cap1(p.join('; ')) + '.' + tip('drawdown') + '<span class="ru-x">A manual halt also stops new buys. Exits always run.</span>'
        : 'A manual halt stops new buys. Exits always run.']);
    }
    {                                                                  // which coins
      const v = pos(u.vol_m), oi = pos(u.oi_m), fu = pos(u.fund_pct), dy = num(u.days) > 0 ? num(u.days) : null, lv = pos(u.lev);
      const mk = [v != null && B(v + 'M') + ' a day of market volume', oi != null && B(oi + 'M') + ' open interest'].filter(Boolean);
      const all = [mk.length && 'at least ' + and(mk) + ' (market figures, not your money)', fu != null && 'funding under ' + B(fu + '%') + ' a year',
        dy != null && B(fmt.int(dy)) + ' days of history', lv != null && B(lv + '×') + ' leverage available'].filter(Boolean);
      if (all.length) R.push(['Coins', 'Trades only coins with ' + and(all) + '.<span class="ru-x">Each book below lists the coins it may trade.</span>']);
    }
    {                                                                  // costs and the smallest stop
      const fe = cf(c.fee_pct), ms = cf(c.min_stop_pct), s = [];
      if (fe != null) s.push('Every result is counted after costs: a ' + B(fe + '%') + ' exchange fee on each fill' + (m.eff === 'live' ? '' : ' (simulated on paper)') + ', plus funding while held.');
      if (ms != null) s.push('Skips a signal whose stop would sit less than ' + B(ms + '%') + ' below the entry.');
      if (s.length) R.push(['Costs', s.join(' ')]);
    }
    if (m.eff === 'live') {
      const o = isObj(b.origin) && b.origin.mode === 'live' ? num(b.origin.t) : null;
      R.push(['Going live', o != null ? 'Live since ' + esc(fmt.stamp(o)) + '.' : 'Running live.']);
    } else {
      const gp = [num(g.n) != null && 'at least ' + B(fmt.int(g.n) + ' closed trades'), num(g.avg_R) != null && 'an average above ' + B(fmt.R(g.avg_R)),
        num(g.dd_pct) != null && 'a worst drawdown under ' + B(cf(g.dd_pct) + '%'), num(g.cost_R) != null && 'costs of at most ' + B(fmt.num(g.cost_R, 2) + ' R') + ' a trade'].filter(Boolean);
      if (gp.length) R.push(['Going live', 'Stays on paper until the owner switches it. The go-live gates ask the paper record for ' + and(gp) + '.' + tip('goLive')]);
    }
    return R;
  }
  function inForce(b) {
    const c = cfgOf1(b), K = clockOf(b) || {};
    const row = r => '<li class="ru-r"><span class="ru-k">' + esc(r[0]) + '</span><div class="ru-s">' + r[1] + '</div></li>';
    let h = '<section class="card rise ru-if"><div class="head"><div class="ttl"><h2>In force</h2><span class="sub">';
    if (!c) {
      return h + 'What the bot does, in plain sentences</span></div></div><p class="ru-none">The settings in force are ' + na() + '. They arrive with the next check.</p>'
        + '<ul class="ru-rules">' + row(['Sells', SELLS + tip('line')]) + '</ul></section>' + booksCard(b);
    }
    const at = num(K.last_t);
    h += 'From the settings pushed with ' + (at != null ? 'the check at ' + esc(fmt.when(at)) : 'the last check') + (c.ver != null ? ' · version ' + esc(c.ver) : '') + '</span></div></div>';
    if (c.v1) h += '<p class="ru-none">This data carries only part of the settings; the rest arrives with the next check.</p>';
    return h + '<ul class="ru-rules">' + ruleRows(b, c).map(row).join('') + '</ul></section>' + booksCard(b);
  }
  function booksCard(b) {
    const bk = booksOf(b);
    const head = '<section class="card rise ru-bk"><div class="head"><div class="ttl"><h2>Books' + tip('book') + '</h2><span class="sub">Each gets a share of the pot and its own risk cap, and is judged against holding its benchmark</span></div></div>';
    if (!bk) return head + '<p class="ru-none">The books are ' + na() + '.</p></section>';
    if (!bk.length) return head + '<p class="ru-none">No books are set up in this data.</p></section>';
    let untested = false;
    const rows = bk.map(x => {
      const on = x.on !== false, p = [];
      if (!on) p.push('switched off');
      if (num(x.share_pct) != null) p.push('gets ' + B(cf(x.share_pct) + '%') + ' of the pot');
      if (num(x.cap_pct) != null) p.push('may risk up to ' + B(cf(x.cap_pct) + '%'));
      const names = Array.isArray(x.names) ? x.names.filter(n => Array.isArray(n) && n[0] != null) : [];
      const ok = names.filter(n => n[1] !== 0).map(n => esc(n[0])), un = names.filter(n => n[1] === 0).map(n => esc(n[0]));
      if (un.length) untested = true;
      const sub = [ok.length && '<span class="ru-cn">' + ok.join(', ') + '</span>', un.length && 'untested: <span class="ru-cn">' + un.join(', ') + '</span>',
        x.bench && 'judged against holding <span class="ru-cn">' + esc(x.bench) + '</span>',
        x.sweep && 'gains earmarked for ' + (x.bench ? '<span class="ru-cn">' + esc(x.bench) + '</span>' : 'its benchmark') + ' (recorded, not executed)'].filter(Boolean);
      return '<li class="ru-b' + (on ? '' : ' ru-off') + '"><div class="ru-bh"><span class="ru-bn">' + esc(x.b || '—') + '</span>' + (p.length ? ' · ' + p.join(' · ') : '') + '</div>'
        + (sub.length ? '<div class="ru-bs">' + sub.join(' · ') + '</div>' : '') + '</li>';
    });
    return head + '<ul class="ru-bl">' + rows.join('') + '</ul>'
      + (untested ? '<p class="cap ru-cap">Untested coins were not in the backtests. Like every coin, they must pass the market checks on the day.</p>' : '') + '</section>';
  }

  // ------------------------------------------------------------------------------------- glossary ---
  function glossPane(term) {
    const keys = Object.keys(GLOSS).sort((a, z) => String(GLOSS[a].t).localeCompare(String(GLOSS[z].t), undefined, { sensitivity: 'base', numeric: true }));
    return '<section class="card rise ru-gc"><div class="head"><div class="ttl"><h2>Glossary</h2><span class="sub">' + keys.length
      + ' words the page uses, in plain terms. Limits come from the settings in force.</span></div><div class="acts"><button type="button" class="btn small" data-ru-all aria-pressed="false">Open all</button></div></div>'
      // Two columns on a wide card read top to bottom (column-major rows), so opening a word never moves another sideways.
      + '<div class="ru-gl" style="--ru-rows:' + Math.ceil(keys.length / 2) + '">' + keys.map((k, i) => {
        const g = gloss(k) || {};
        return '<details class="ru-g' + (i === Math.ceil(keys.length / 2) ? ' ru-c2' : '') + '" id="rules-glossary/' + esc(k) + '" data-k="' + esc(k) + '"' + (k === term ? ' open' : '') + '><summary>'
          + esc(g.t || k) + '</summary><p>' + esc(g.d || '') + '</p></details>';
      }).join('') + '</div></section>';
  }

  // ----------------------------------------------------------------------------------------- docs ---
  function docPane(slug) {
    const i = DOCS.findIndex(d => d[0] === slug), pv = DOCS[i - 1], nx = DOCS[i + 1];
    const btn = (d, txt) => '<button type="button" class="btn small" data-v="' + d[0] + '">' + txt + '</button>';
    return '<section class="card rise ru-dc" aria-label="' + esc(TITLE_OF[slug]) + '"><div class="doc ru-doc" data-ru-doc="' + slug + '">' + docBody(slug) + '</div>'
      + '<div class="ru-pn">' + (pv ? btn(pv, '‹ ' + esc(pv[1])) : '<span></span>') + '<span class="sub">' + (i + 1) + ' of ' + DOCS.length + '</span>'
      + (nx ? btn(nx, esc(nx[1]) + ' ›') : '<span></span>') + '</div></section>';
  }
  function docBody(slug) {
    const d = docs[slug];
    if (d && d.html != null) return d.html || '<p class="sub">This document is empty.</p>';
    if (d && d.err) {
      if (d.err === 'auth') return '<div class="empty">Signed out. <a href="/login">Sign in</a> to read ' + esc(TITLE_OF[slug]) + '.</div>';
      const why = d.err === 'net' ? 'Couldn’t reach the dashboard to load ' : d.err === 'missing' ? 'The dashboard has no copy of ' : 'Couldn’t read ';
      return '<div class="empty">' + why + esc(TITLE_OF[slug]) + '.<div class="ru-retry"><button type="button" class="btn small" data-ru-retry="' + slug + '">Try again</button></div></div>';
    }
    return '<div class="empty">Loading ' + esc(TITLE_OF[slug]) + '…</div>';
  }
  function load(slug) {
    const d = docs[slug];
    if (d && d.p) return d.p;
    if (d && d.html != null) return Promise.resolve();
    const req = getJSON('/api/doc/' + slug, 15000);
    const p = req.then(j => { docs[slug] = { html: j && typeof j.html === 'string' ? j.html : '' }; }, e => { docs[slug] = { err: (e && e.kind) || 'net' }; });
    docs[slug] = { p };
    return p;
  }
  // Fill the doc box from the cache, or load it and fill it if the same doc is still on screen.
  function fillDoc(root, slug) {
    const box = $('[data-ru-doc="' + slug + '"]', root); if (!box) return;
    const paint = el => {
      el.innerHTML = mdTables(docBody(slug));
      if (docs[slug] && docs[slug].html) { linkDocs(el); masks(el); }
      el.dataset.ruDone = docs[slug] && docs[slug].html != null ? '1' : '';
    };
    if (docs[slug] && (docs[slug].html != null || docs[slug].err)) { if (box.dataset.ruDone !== '1') paint(box); return; }
    load(slug).then(() => { const el = $('[data-ru-doc="' + slug + '"]', root); if (el && el.isConnected && cur === slug) paint(el); });
  }
  // The docs name each other by file ("[LOGIC.md](LOGIC.md)", which md() renders as plain "LOGIC.md"); those names
  // become in-app links to the matching pane. Code spans and existing links are left alone.
  function linkDocs(el) {
    if (!document.createTreeWalker) return;
    const re = /\b([A-Z][A-Z_]*)\.md\b/g, list = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (/\b[A-Z][A-Z_]*\.md\b/.test(n.nodeValue) && !(n.parentElement && n.parentElement.closest('code,pre,a'))) list.push(n);
    }
    list.forEach(n => {
      const s = n.nodeValue, frag = document.createDocumentFragment(); let last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        const slug = FILE_OF[m[1]]; if (!slug) continue;
        frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const a = document.createElement('a');
        a.href = '#rules/' + slug; a.dataset.v = slug; a.textContent = m[0]; a.setAttribute('aria-label', m[0] + ', ' + TITLE_OF[slug]);
        frag.appendChild(a); last = m.index + m[0].length;
      }
      if (!last) return;
      frag.appendChild(document.createTextNode(s.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  // ------------------------------------------------------------------------------------ the view ---
  function parseSub(sub) {
    const parts = String(sub || '').split('/'), p = parts[0];
    if (!p || p === 'inforce') return { pane: 'inforce', bad: p === 'inforce' };
    if (TITLE_OF[p]) return { pane: p, term: p === 'glossary' && parts[1] && GLOSS[parts[1]] ? parts[1] : null };
    return { pane: 'inforce', bad: true, review: p === 'review' };
  }
  function paneHtml(v, term) {
    if (v === 'glossary') return safe(() => glossPane(term), 'Glossary');
    if (isDoc(v)) return safe(() => docPane(v), TITLE_OF[v]);
    return safe(() => inForce(S.b || {}), 'In force');
  }
  function navHtml(v) {
    const btn = p => '<button type="button" data-v="' + p[0] + '" aria-pressed="' + (p[0] === v) + '">' + esc(p[1]) + '</button>';
    return '<nav class="ru-nav" aria-label="Rules and documents"><div class="seg quiet ru-seg ru-still" role="group" aria-label="Rules pages" tabindex="-1" data-mask>'
      + PANES.slice(0, 2).map(btn).join('') + '<span class="ru-sep" aria-hidden="true"></span>' + DOCS.map(btn).join('') + '<span class="ind"></span></div></nav>';
  }
  // Pane-local work once the pane's HTML is in: a doc loads, a glossary term named in the hash opens.
  function settle(root, term) {
    if (isDoc(cur)) fillDoc(root, cur);
    if (cur === 'glossary' && term) { const d = document.getElementById('rules-glossary/' + term); if (d) d.open = true; }
    syncAll(root);
  }
  function syncAll(root) {
    const bt = $('[data-ru-all]', root); if (!bt) return;
    const ds = $$('.ru-g', root), all = ds.length > 0 && ds.every(d => d.open);
    bt.textContent = all ? 'Close all' : 'Open all'; bt.setAttribute('aria-pressed', all ? 'true' : 'false');
  }
  // The owner picked another pane: slide the indicator, swap the pane in place, push the hash.
  function switchTo(root, v) {
    if (!TITLE_OF[v]) return;
    const seg = $('.ru-seg', root), box = $('.ru-pane', root), nav = $('.ru-nav', root);
    if (!seg || !box) { go('rules', v === 'inforce' ? null : v); return; }
    if (v !== cur) {
      cur = v; S.sub = v === 'inforce' ? null : v;
      setSeg(seg, v);
      try { history.pushState(null, '', '#rules' + (S.sub ? '/' + S.sub : '')); } catch (e) {}
      hideTip();
      box.innerHTML = paneHtml(v, null); box.dataset.p = v;
      drawn = keyOf(S.b);
      stagger(box); masks(box); settle(root, null);
    }
    if (nav && nav.getBoundingClientRect().top < 0) into(nav, false);    // a tap at the foot of a doc: back to its top
  }

  VIEWS.rules = {
    title: 'Rules',
    render(root, why) {
      const q = parseSub(S.sub), box = $('.ru-pane', root);
      if (why === 'arrival' && box && q.pane === cur) {
        const k = keyOf(S.b);
        if (k === drawn || isDoc(cur)) return;                          // docs do not come from the bundle
        drawn = k;                                                       // new settings: redraw in place, keep what is open
        const open = $$('details[open][data-k]', box).map(d => d.dataset.k);
        box.innerHTML = paneHtml(cur, null);
        $$('details[data-k]', box).forEach(d => { if (open.indexOf(d.dataset.k) >= 0) d.open = true; });
        return;
      }
      cur = q.pane; drawn = keyOf(S.b);
      return '<div class="stack ru cq">' + navHtml(cur) + '<div class="ru-pane" data-p="' + cur + '">' + paneHtml(cur, q.term) + '</div>'
        + '<div class="ru-out phone-only"><span class="sub">Signed in on this device.</span><a class="btn small ghost" href="/logout">Log out</a></div></div>';
    },
    after(root) {
      const q = parseSub(S.sub);
      if (q.review) { try { location.replace('#results/review'); } catch (e) {} return; }   // v1's "Latest review" crumb
      if (q.bad) { S.sub = null; try { history.replaceState(null, '', '#rules'); } catch (e) {} }
      // initSegs placed the indicator with its transition off (no slide on a fresh render: nothing was asked); commit
      // that style, then turn the transition back on for the owner's taps.
      const seg = $('.ru-seg', root), ind = seg && $('.ind', seg);
      if (seg && seg.classList.contains('ru-still')) { if (ind) void getComputedStyle(ind).transform; seg.classList.remove('ru-still'); }
      settle(root, q.term);
      const onClick = e => {
        if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const t = e.target instanceof Element ? e.target : null; if (!t) return;
        let el;
        if ((el = t.closest('[data-v]')) && root.contains(el) && TITLE_OF[el.dataset.v]) { e.preventDefault(); switchTo(root, el.dataset.v); return; }
        if ((el = t.closest('[data-ru-retry]'))) {
          e.preventDefault();
          const s = el.dataset.ruRetry; delete docs[s];
          const bx = $('[data-ru-doc="' + s + '"]', root); if (bx) { bx.dataset.ruDone = ''; bx.innerHTML = docBody(s); }
          fillDoc(root, s); return;
        }
        if ((el = t.closest('[data-ru-all]'))) {
          e.preventDefault();
          const ds = $$('.ru-g', root), open = !ds.every(d => d.open);
          ds.forEach(d => { d.open = open; });
          syncAll(root);
        }
      };
      const onToggle = e => { if (e.target instanceof Element && e.target.matches('.ru-g')) syncAll(root); };
      root.addEventListener('click', onClick);
      root.addEventListener('toggle', onToggle, true);
      return () => { root.removeEventListener('click', onClick); root.removeEventListener('toggle', onToggle, true); };
    },
  };
}
