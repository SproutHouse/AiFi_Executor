// cloud/ui/bot.js — the bot page's Overview tab (docs/COMMAND_CENTER_SPEC.md §5, package C). One block (ui/README.md);
// exports VIEWS.overview only and adds no sheet. Reads core through the B<->C interface (§9); every name package B adds
// to core (PAGE, AGENTS, rowOf, kindOf, barOf, loadFactory, botHref, word.bar/every/kindName, COMP.beatStrip/sparkSvg)
// is guarded with typeof and has the fallback of the A->B/C table. CSS prefix bt- (ui/bot.css).
// Sections: hero · Wins & losses · What it traded · How often | Holding now · Equity · Health and schedule · Strategy.
{
  const TFS = { '1h': 3600, '4h': 14400, '1d': 86400 };
  const KN = { flip: 'Signal trader', target: 'Rebalancer', carry: 'Funding collector' };
  const BW = { 3600: ['hourly', 'every hour', 'hourly'], 14400: ['4-hour', 'every 4 hours', 'every 4 h'], 86400: ['daily', 'every day', 'daily'] };
  const CONTROL = 'https://github.com/SproutHouse/AiFi_Executor/actions/workflows/control.yml';
  const ACTED = ['bought', 'sold', 'resized', 'carry_in', 'carry_out', 'carry_closed'];
  const LV = { ok: 'ok', info: 'info', warn: 'warn', bad: 'bad' };
  const STW = { entering: 'Entering', open: 'Collecting', exiting: 'Closing' };
  const REF = { bookcap: 'book cap full', vol: 'volume too low', cap: 'open-risk cap', fund: 'funding too high', sizing: 'sizing not accepted',
    oi: 'open interest too low', days: 'too little history', lev: 'leverage too low', maxpos: 'every slot taken', thr: 'throttle', fresh: 'data too late',
    halt: 'halted', dup: 'already held', gross: 'gross exposure cap', sanity: 'price sanity band', list: 'not listed', tier: 'watch-only grade' };
  const DAY = 86400;
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => isObj(v) ? v : {};
  const sum = (a, f) => a.reduce((s, x) => s + (num(f(x)) || 0), 0);
  const trim = v => { const x = num(v); return x == null ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
  const sp = (v, f) => '<span class="' + fmt.cls(v) + '">' + f(v) + '</span>';
  const P = v => sp(v, x => fmt.pct(x));
  const RR = v => sp(v, x => fmt.R(x));
  const pp = v => { const x = num(v); return x == null ? '—' : fmt.pctu(x, Math.abs(x) >= 10 ? 0 : 1); };
  const p1 = v => { const x = num(v); return x == null ? '—' : trim(Math.round(Math.abs(x) * 10) / 10) + '%'; };
  const lk = (h, t) => '<a class="bt-lk" href="' + h + '">' + t + ' ›</a>';
  const hrs = h => { const x = num(h); return x == null ? '—' : x < 48 ? trim(Math.round(x * 10) / 10) + ' h' : trim(Math.round(x / 2.4) / 10) + ' d'; };

  // ------------------------------------------------------------------------- core through the interface --
  const me = () => typeof AGENT === 'string' ? AGENT : null;
  const isBot = () => typeof PAGE === 'string' ? PAGE === 'bot' : true;
  const rows = () => (typeof AGENTS !== 'undefined' && Array.isArray(AGENTS) ? AGENTS : []).filter(isObj);
  function rowA() {
    if (typeof rowOf === 'function') { const r = call(rowOf, me()); if (r !== undefined) return isObj(r) ? r : null; }
    return rows().find(a => a.id === me()) || null;
  }
  function barS(b) {
    const v = typeof barOf === 'function' ? num(call(barOf, b)) : null; if (v) return v;
    const A = rowA();
    return num(obj(b && b.clock).bar_s) || TFS[obj(b && b.cfg).tf] || (A && (num(A.bar_s) || TFS[A.tf])) || 14400;
  }
  const bw = (b, i) => (BW[barS(b)] || BW[14400])[i];
  function wordOf(f, b, i) { const v = typeof word[f] === 'function' ? call(word[f], b) : null; return typeof v === 'string' && v ? v : bw(b, i); }
  function kindIs(b, A) {
    const ki = typeof kindInfo === 'function' ? call(kindInfo, b) : null;
    if (isObj(ki) && KN[ki.kind]) return { k: ki.kind, inf: !!ki.inferred };
    const c = obj(b && b.cfg).kind || (A && A.kind);
    if (c) return { k: c, inf: false };
    let k = typeof kindOf === 'function' ? call(kindOf, b) : null;
    if (!k) {
      const ev = arr(b && b.events);
      k = arr(b && b.pos).some(p => isObj(p) && p.kind === 'target') || ev.some(e => Array.isArray(e) && e[3] === 'target') ? 'target'
        : ev.some(e => Array.isArray(e) && e[3] === 'carry') ? 'carry' : 'flip';
    }
    return { k, inf: true };
  }
  function kindName(k, s) {
    const v = typeof word.kindName === 'function' ? call(word.kindName, k, s) : null;
    return typeof v === 'string' && v ? v : (KN[k] || '—') + ' · ' + (BW[s] || BW[14400])[2];
  }
  const href = (id, h) => typeof botHref === 'function' ? botHref(id, h) : '/?a=' + encodeURIComponent(id) + (h || '');
  // ‹ › order: exec:agents.order (enabled roster ids), else the rows' order.
  const roster = () => { const E = isObj(S.E) ? S.E : {}; return Array.isArray(E.order) && E.order.length ? E.order.filter(x => typeof x === 'string') : rows().filter(a => a.enabled !== false && a.id).map(a => a.id); };
  const nameOfId = id => { const r = rows().find(a => a.id === id); return (r && r.name) || id; };
  function nb(d) {
    const r = roster(), i = r.indexOf(me());
    return i < 0 || r.length < 2 ? null : r[(i + d + r.length) % r.length];
  }
  function step(d) { if (typeof botStep === 'function') return call(botStep, d); const id = nb(d); if (id) location.replace(href(id, location.hash)); }
  // The factory (arena record, fleet share): core's 5-minute cache when B ships it, else one request of our own.
  let FX = null, fxDone = false, fxAt = 0, fxP = null;
  function fx() {
    if (fxP) return fxP;
    if (typeof loadFactory !== 'function' && fxDone && Date.now() - fxAt < 300e3) return Promise.resolve(FX);
    const p = typeof loadFactory === 'function' ? call(loadFactory) : getJSON('/api/factory', 10000);
    fxP = Promise.resolve(p).then(d => isObj(d) ? d : null, () => null).then(d => { FX = d; fxDone = true; fxAt = Date.now(); fxP = null; return d; });
    return fxP;
  }
  const arena = c => { const X = c.X; return X ? arr(X.shortlist).find(s => isObj(s) && s.agent === me()) || null : null; };
  const isArena = c => !!(arena(c) || (c.A && c.A.arena));
  // Ledger rows by column name; carry rows carry % of capital (cap_ret_pct, else R·100 for older ledgers), never R.
  function trades(G) {
    const t = obj(G && G.trades), ix = {};
    arr(t.cols).forEach((k, i) => { ix[k] = i; });
    return arr(t.rows).filter(Array.isArray).map(r => {
      const o = {}; for (const k in ix) o[k] = r[ix[k]];
      o.carry = o.kind === 'carry';
      o.t_at = num(o.t_rec) != null ? num(o.t_rec) : num(o.t_out);          // the check that recorded the close (owner-13)
      if (o.carry) { o.cap = num(o.cap_ret_pct) != null ? num(o.cap_ret_pct) : num(o.R) != null ? num(o.R) * 100 : null; o.R = null; }
      return o;
    });
  }
  // Calendar days between two times in the phone's zone ("5 days" from Sat to Thu).
  const mid = t => { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayDiff = (a, z) => Math.round((mid(z) - mid(a)) / 864e5);
  const ageDay = t => Math.floor((nowS() - t) / DAY) + 1;

  // ------------------------------------------------------------------------------------------ context --
  let W = 'route', DRAWN = {}, LD = {}, MORE = false;
  const OPEN = {};
  function ctx(b, why) {
    const A = rowA(), K = kindIs(b, A), G = S.ledger && S.ledgerGen === b.gen ? S.ledger : null;
    return { A, k: K.k, inf: K.inf, s: barS(b), G, gs: G ? 'ok' : LD.gen === b.gen && LD.done ? 'err' : 'wait', X: FX, rise: why === 'route' ? ' rise' : '' };
  }
  const gWait = c => '<p class="note bt-ld">' + (c.gs === 'err' ? 'Trades ' + na() : 'Loading trades…') + '</p>';
  function sec(c, id, title, sub, inner, acts) {
    return '<section class="card cq bt-sec bt-' + id + c.rise + '" id="overview-' + id + '"><div class="head"><div class="ttl"><h2' + hint('sec', id, true) + '>' + title + '</h2>'
      + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>' + inner + '</section>';
  }
  const CK = { 'Closed trades': 'nclosed', 'Won / lost': 'wl', 'Average trade': 'avg', 'Best / worst': 'best', Holding: 'holding', Invested: 'invested', 'Open result': 'openres',
    Drawdown: 'dd', Pairs: 'pairs', 'Funding kept': 'kept', Collected: 'got', Result: 'result' };
  const cell = (label, v, s) => '<div class="bt-cell' + (CK[label] ? ' tc"' + hint(CK[label]) : '"') + '><span class="bt-cl tl">' + label + '</span><span class="bt-cv">' + v + '</span>' + (s ? '<span class="bt-cs">' + s + '</span>' : '') + '</div>';
  const cells = list => '<div class="bt-cells">' + list.join('') + '</div>';

  // --------------------------------------------------------------------------------------------- hero --
  function verdictHtml() {
    const st = S.st || status(S.b);
    return '<span class="pill big ' + (LV[st.lvl] || 'info') + '"' + hint('st', '', true) + '>' + esc(st.word) + '</span><span class="bt-vs">' + st.sentence + '</span>';
  }
  function schedHtml(b) {
    const K = clock(b), last = obj(stateOf(b).last), out = [];
    if (K.lastT != null) {
      const lm = num(last.late_min) != null ? num(last.late_min) : num(obj(b.clock).late_min);
      out.push('Last check ' + fmt.when(K.lastT) + (last.failed ? ' · stopped early' : lm != null ? ' · ' + lm + ' min after the ' + wordOf('bar', b, 0) + ' close' + (last.fresh === false ? ', ran late' : '') : ''));
    } else out.push('No check yet');
    if (K.next != null) out.push(K.phase === 'countdown' ? 'next ≈ ' + fmt.when(K.next) + ' (' + fmt.rel(K.next) + ')' : 'next was due ≈ ' + fmt.when(K.next));
    return esc(out.join(' · '));
  }
  function spark(vals, o) {
    if (typeof COMP.sparkSvg === 'function') return COMP.sparkSvg(vals, o);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
    const x = i => (i / (vals.length - 1) * o.w).toFixed(1), y = v => (2 + (hi - v) / (hi - lo) * (o.h - 4)).toFixed(1);
    return '<svg class="bt-svg" viewBox="0 0 ' + o.w + ' ' + o.h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(o.label) + '"><path class="z" d="M0 ' + y(0) + 'H' + o.w + '"/>'
      + '<path class="l" d="' + vals.map((v, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(v)).join('') + '"/></svg>';
  }
  const BEAD = { '.': 'pre', '-': 'miss', x: 'fail', o: 'ok', l: 'late', O: 'ok bt-bact', L: 'late bt-bact' };
  function beads(bt, s, next) {
    const k = String(bt.k), s0 = num(bt.s0);
    const on = (k.match(/[oO]/g) || []).length, act = (k.match(/[OL]/g) || []).length;
    const lab = 'Last ' + k.length + ' ' + (BW[s] || BW[14400])[0] + ' checks: ' + on + ' on time, ' + act + ' with a trade' + (next != null ? '; next about ' + fmt.time(next) : '');
    return '<div class="bt-beads" role="img" aria-label="' + esc(lab) + '" style="--n:' + (k.length + 1) + '">'
      + k.split('').map((ch, i) => '<i class="bt-bd bt-b' + (BEAD[ch] || 'pre') + '"' + (s0 != null ? ' data-s="' + (s0 + i * s) + '"' : '') + '></i>').join('')
      + '<i class="bt-bd bt-bnext"></i></div><span class="bt-bn">' + on + '/' + k.length + '</span>';
  }
  function beatHtml(b, c) {
    const bt = isObj(b.beat) ? b.beat : c.A && isObj(c.A.beat) ? c.A.beat : null;
    if (bt && typeof bt.k === 'string') {
      const K = clock(b), h = typeof COMP.beatStrip === 'function' ? safe(() => COMP.beatStrip(bt, { big: true, nextT: K.next, bar: c.s, lim: limOf(b) }), 'Heartbeat') : beads(bt, c.s, K.next);
      return '<div class="bt-beat">' + h + '</div>';
    }
    return '<div class="bt-beat bt-pu">' + (typeof COMP.punctuality === 'function' ? safe(() => COMP.punctuality(b), 'Punctuality') : '') + '<p class="cap">Heartbeat after its next check.</p></div>';
  }
  // The last action: L.act, then A.act, then the push's own rule on what this page holds (§6.1 act candidates).
  function actOf(b, c) {
    if (b.act !== undefined) return b.act;
    if (c.A && c.A.act !== undefined) return c.A.act;
    const cand = [];
    for (const e of arr(b.events)) if (Array.isArray(e) && ACTED.includes(e[1])) {
      const ty = e[1] === 'bought' && e[3] === 'carry' ? 'carry_in' : e[1];
      cand.push({ t: num(e[0]), ty, c: e[2], R: ty === 'sold' ? num(e[7]) : null, cap: ty === 'resized' ? num(parseFloat(e[6])) : null });   // a carry_closed detail is % of pot, never capital
    }
    const tr = trades(c.G).filter(t => t.t_at != null).sort((a, z) => z.t_at - a.t_at)[0];
    if (tr) cand.push({ t: tr.t_at, ty: tr.carry ? 'carry_closed' : 'sold', c: tr.c, R: tr.carry ? null : num(tr.R), cap: tr.carry ? tr.cap : null });
    for (const p of arr(b.pos)) if (isObj(p)) cand.push({ t: num(p.t_in), ty: 'bought', c: p.c });
    for (const p of arr(b.carry)) if (isObj(p)) cand.push({ t: num(p.t_in), ty: 'carry_in', c: p.c });
    const ok = cand.filter(x => x.t != null);
    if (!ok.length) return c.G ? null : undefined;
    ok.sort((a, z) => z.t - a.t);
    const top = ok[0], grp = ok.filter(x => x.ty === top.ty && top.t - x.t <= 60), cs = [];
    grp.forEach(x => { if (x.c && !cs.includes(x.c)) cs.push(x.c); });
    return { t: top.t, ty: top.ty, cs: cs.slice(0, 3), n: cs.length, R: top.R, cap_pct: top.cap };
  }
  function actHtml(b, c) {
    const a = actOf(b, c);
    if (a === undefined) return '<i class="bt-dot"></i>' + (c.gs === 'wait' ? 'Loading trades…' : '—');
    if (a === null) return '<i class="bt-dot"></i>No trades yet';
    const cs = arr(a.cs).map(esc).join(', ') + (num(a.n) > arr(a.cs).length ? ' +' + (a.n - a.cs.length) : ''), cap = num(a.cap_pct);
    const w = { bought: 'Bought ' + cs, sold: 'Sold ' + cs + (num(a.R) != null ? ' ' + RR(a.R) : ''), resized: 'Resized ' + cs + (cap != null ? ' to ' + pp(cap) + ' of pot' : ''),
      carry_in: 'Started collecting on ' + cs, carry_out: 'Started closing ' + cs, carry_closed: 'Closed ' + cs + ' carry' + (cap != null ? ' · ' + P(cap) + ' of capital' : '') }[a.ty] || esc(a.ty) + ' ' + cs;
    return '<i class="bt-dot' + (nowS() - a.t < DAY ? ' on' : '') + '"></i>' + w + ' · ' + fmt.when(a.t);
  }
  function hero(b, c) {
    const A = c.A, pot = obj(b.pot), chg = num(pot.chg_pct), since = num(pot.since) != null ? num(pot.since) : num(obj(b.origin).t);
    const r = roster(), i = r.indexOf(me()), pv = nb(-1), nx = nb(1);
    const nav = pv && nx ? '<nav class="bt-nav" aria-label="Other bots"><a class="btn small ghost" href="' + esc(href(pv)) + '" data-bt-go="-1" aria-label="Previous bot: ' + esc(nameOfId(pv)) + '">‹</a>'
      + '<span class="sub">' + esc(nameOfId(me())) + ' · ' + (i + 1) + ' of ' + r.length + '</span><a class="btn small ghost" href="' + esc(href(nx)) + '" data-bt-go="1" aria-label="Next bot: ' + esc(nameOfId(nx)) + '">›</a></nav>' : '';
    const desc = A && A.desc ? String(A.desc) : '';
    const id = '<div class="bt-id"><span class="pill bt-type' + (c.inf ? ' bt-inf' : '') + '"' + hint('kind', '', true) + '>' + esc(kindName(c.k, c.s)) + '</span>' + nav + '</div>'
      + (desc ? (desc.length > 90 ? '<details class="bt-desc"><summary><span>' + esc(desc) + '</span><b class="bt-mo">more</b></summary></details>' : '<p class="bt-desc">' + esc(desc) + '</p>') : '');
    const wk = since != null && nowS() - since >= 7 * DAY && num(pot.wk_chg_pct) != null ? ' · this week ' + fmt.pct(pot.wk_chg_pct) : '';
    const dd = since != null ? dayDiff(since, nowS()) : null;
    let nums = '<div class="bt-n"><span class="bt-pct ' + fmt.cls(chg) + '" data-v="' + (chg == null ? '' : chg) + '"' + hint('ret') + '>' + fmt.pct(chg) + '</span><span class="bt-ncap"' + hint('since') + '>pot ' + (since != null ? 'since ' + fmt.day(since) + ' · ' + (dd < 1 ? 'today' : word.plural(dd, 'day')) : 'since —') + wk + (chg != null && fmt.cls(chg) === '' ? ' · flat' : '') + '</span></div>';
    if (c.k === 'flip') {
      const rec = obj(b.rec), show = num(rec.n) > 0 || arr(b.pos).length > 0;
      nums += '<div class="bt-n bt-n2"><span class="bt-r">' + (show ? RR(rec.tot_R) : '—') + '</span><span class="bt-ncap">total R' + tip('R') + (show ? ' · closed ' + fmt.R(rec.closed_R) + ' · open ' + fmt.R(rec.open_R) : '') + '</span></div>';
    }
    const pts = arr(pot.spark).filter(p => Array.isArray(p) && num(p[1]) != null), vals = pts.map(p => num(p[1]));
    const sl = 'Pot over the last ' + vals.length + ' checks' + (vals.length > 1 ? ', from ' + fmt.pct(vals[0]) + ' to ' + fmt.pct(vals[vals.length - 1]) : '');
    const spk = vals.length > 1 ? '<a class="bt-spark" href="#results/curve" aria-label="' + esc(sl + '. Open the interactive curve') + '">' + safe(() => spark(vals, { w: 320, h: 56, t0: pts[0][0], t1: pts[pts.length - 1][0], label: sl }), 'Sparkline') + '</a>'
      : '<p class="cap bt-spark">The line appears after two checks.</p>';
    return '<section class="card bt-hero' + c.rise + '" id="overview-hero">' + id
      + '<div class="bt-verdict" id="bt-verdict">' + verdictHtml() + '</div><p class="bt-sched" id="bt-sched">' + schedHtml(b) + '</p>'
      + '<div class="bt-nums">' + nums + spk + '</div>' + beatHtml(b, c) + '<p class="bt-act" id="bt-act"' + hint('last') + '>' + actHtml(b, c) + '</p></section>';
  }

  // ----------------------------------------------------------------------------------- 5.2 wins & losses --
  function recFlip(b, c) {
    const N = num(obj(obj(b.cfg).gates).n) || 30, rec = obj(b.rec);
    if (!c.G) return cells([cell('Closed trades', '<b>' + fmt.int(rec.n) + '</b>'), cell('Average trade', RR(rec.avg_R))]) + gWait(c);
    const all = obj(obj(c.G.stats).all), tr = trades(c.G).filter(t => !t.carry && num(t.R) != null), n = num(all.n) != null ? num(all.n) : tr.length;
    const w = tr.filter(t => t.R > 0).length, l = tr.length - w, pn = tr.filter(t => num(t.pnl_pct) != null);
    const best = tr.slice().sort((a, z) => z.R - a.R)[0], worst = tr.slice().sort((a, z) => a.R - z.R)[0];
    const gates = arr(obj(c.G.verdict).gates).filter(isObj), fails = gates.filter(g => g.state === 'failing');
    const GN = { n: 'trade count', avg_R: 'average R', dd: 'drawdown', cost_R: 'costs' };
    const pill = n < N ? '<span class="pill"' + hint('early') + '>Too early · ' + fmt.int(n) + ' of ' + fmt.int(N) + ' trades</span>'
      : fails.length ? '<span class="pill bad">Failing: ' + esc(word.list(fails.map(g => GN[g.k] || g.k))) + '</span>'
      : gates.length && gates.every(g => g.state === 'passing') ? '<span class="pill ok">Go-live checks passing ' + gates.length + '/' + gates.length + '</span>' : '<span class="pill mute">Judging ' + fmt.int(n) + ' trades</span>';
    const pf = num(all.pf);
    const more = '<details class="disc bt-more"><summary>More numbers</summary><div class="body"><dl class="facts">'
      + '<dt>Profit factor' + tip('pf') + '</dt><dd>' + (pf != null ? fmt.num(pf) + ' <span class="sub">· ' + (pf < 1 ? 'under 1 means losses outweigh wins' : 'wins outweigh losses') + '</span>' : '—') + '</dd>'
      + '<dt>vs holding' + tip('vsHolding') + '</dt><dd>' + (num(all.rel_R) != null ? RR(all.rel_R) + ' <span class="sub">per trade</span>' : '—') + '</dd>'
      + '<dt>Average hold</dt><dd>' + hrs(all.hrs) + '</dd><dt>Longest losing run</dt><dd>' + (num(all.streak) != null ? word.plural(all.streak, 'trade') : '—') + '</dd>'
      + '<dt>Costs per trade</dt><dd>' + (num(all.cost_R) != null ? fmt.num(all.cost_R) + ' R' : '—') + '</dd></dl></div></details>';
    return '<div class="bt-vrow">' + pill + lk('#results/verdict', 'Go-live checks') + '</div>' + (n ? '' : '<p class="note">No closed trades yet.</p>')
      + cells([cell('Closed trades', '<b>' + fmt.int(n) + '</b> · ' + (n >= N ? 'enough for a verdict' : fmt.int(N - n) + ' more before a verdict')),
        cell('Won / lost', tr.length ? '<b>' + w + ' won · ' + l + ' lost</b> (' + (num(all.win) != null ? fmt.pctu(all.win * 100, 0) : '—') + ')' : '—'),
        cell('Average trade', RR(all.avg_R) + (pn.length ? ' · ≈ ' + P(sum(pn, t => t.pnl_pct) / pn.length) + ' of pot' : '')),
        cell('Best / worst', best ? 'Best ' + esc(best.c) + ' ' + RR(best.R) + ' · Worst ' + esc(worst.c) + ' ' + RR(worst.R) : '—', best ? fmt.when(best.t_at) + ' · ' + fmt.when(worst.t_at) : '')]) + more;
  }
  function recTarget(b, c) {
    const pos = arr(b.pos).filter(isObj), thr = arr(obj(b.cfg).thr), dd = num(obj(stateOf(b).thr).dd_pct), s = arena(c);
    const origin = num(obj(b.origin).t);
    const pill = s ? (s.ready ? '<span class="pill ok"' + hint('fx', 'ready') + '>Ready for you</span>' : '<span class="pill"' + hint('fx', 'arena') + '>' + esc(arr(s.not_ready)[0] || 'Proving itself in the arena') + '</span>')
      : isArena(c) ? '<span class="pill"' + hint('fx', 'arena') + '>In the arena</span>' : '<span class="pill"' + hint('yearly') + '>Judged yearly' + (origin != null ? ' · day ' + ageDay(origin) + ' of 365' : '') + '</span>';
    return '<div class="bt-vrow">' + pill + '</div>' + cells([
      cell('Holding', '<b>' + word.plural(pos.length, 'coin') + '</b>', esc(pos.map(p => p.c).join(', '))),
      cell('Invested', '<b>' + (pos.length ? pp(sum(pos, p => p.size_pct)) : '0%') + '</b> of pot'),
      cell('Open result', (pos.length ? P(sum(pos, p => p.pnl_pct)) : '—') + ' of pot · ' + RR(obj(b.rec).open_R)),
      cell('Drawdown', '<b>' + (dd == null ? '—' : fmt.pctu(dd, 2)) + '</b>', thr[0] != null && thr[1] != null ? 'risk halves at ' + esc(thr[0]) + '%, stops at ' + esc(thr[1]) + '%' : '')]);
  }
  function recCarry(b, c) {
    const s = isObj(b.carry_sum) ? b.carry_sum : c.A && c.A.carry, origin = num(obj(b.origin).t), early = origin == null || nowS() - origin < 14 * DAY;
    if (!isObj(s)) return '<p class="note">' + word.plural(num(obj(b.risk).n_open) || 0, 'pair') + ' open · details after the next check</p>';
    const cap = num(s.capture_pct), gate = num(s.gate_pct) != null ? num(s.gate_pct) : 80, net = num(s.net_pct), fund = num(s.fund_pct), cost = num(s.cost_pct);
    const pill = early ? '<span class="pill"' + hint('early') + '>Too early · judged over 2–4 weeks (day ' + (origin != null ? ageDay(origin) : '—') + ' of 14)</span>'
      : cap == null ? '<span class="pill mute">Capture —</span>' : cap < gate ? '<span class="pill warn">Capture below the ' + gate + '% gate</span>' : '<span class="pill ok">Capture gate met</span>';
    // The card leads with the hero's pot figure; the parts below add up to it (owner-6: open legs and closed pairs count too).
    const pot = num(obj(b.pot).chg_pct), opn = num(s.open_pct), cl = num(s.closed_pct);
    const gap = net != null && fund != null && cost != null ? net - fund + cost : null, px = gap == null ? null : gap + (opn || 0);
    const rest = pot != null && net != null ? pot - net - (opn || 0) - (cl || 0) : null;
    const ct = trades(c.G).filter(t => t.carry);
    const st = [num(s.open) ? s.open + ' open' : '', num(s.entering) ? s.entering + ' entering' : '', num(s.exiting) ? s.exiting + ' closing' : ''].filter(Boolean).join(' · ');
    return '<div class="bt-vrow">' + pill + '</div>' + cells([
      cell('Pairs', '<b>' + fmt.int(s.pairs) + '</b>' + (st ? ' · ' + st : '')),
      cell('Funding kept', '<b>' + (cap == null ? '—' : fmt.int(cap) + '%') + '</b> of what it could earn', 'go-live gate ' + gate + '%'),
      cell('Collected', P(fund) + ' of pot', 'costs ' + fmt.pctu(cost, 2)),
      cell('Result', P(pot != null ? pot : net) + ' of pot', 'the pot since it started')])
      + '<p class="bt-wf">Where it came from: funding ' + P(fund) + ' · price moves ' + P(px) + (opn != null ? ' (' + P(gap) + ' booked, ' + P(opn) + ' still open)' : '')
      + ' · costs ' + P(cost == null ? null : -cost) + (cl != null ? ' · closed pairs ' + P(cl) : '') + ' → ' + P(pot != null ? pot : net) + ' of pot'
      + (rest == null || opn == null ? '' : Math.abs(rest) < 0.02 ? ' · the rest is rounding' : ' · ' + P(rest) + ' other') + '</p>'
      + '<p class="cap">Price moves are what the spot and perp legs’ moves did not cancel: booked when a leg was trimmed, still open at the last prices.</p>'
      + (c.G ? '<p class="note">' + (ct.length ? word.plural(ct.length, 'pair') + ' closed · ' + fmt.pct(sum(ct, t => t.cap)) + ' of capital in total' : 'No pair closed yet.') + '</p>' : gWait(c));
  }
  function record(b, c) {
    return sec(c, 'record', 'Wins &amp; losses', c.k === 'carry' ? 'Funding collected against costs' : c.k === 'target' ? 'What it holds and how that is going' : 'Closed trades and the go-live verdict',
      c.k === 'carry' ? recCarry(b, c) : c.k === 'target' ? recTarget(b, c) : recFlip(b, c));
  }

  // ------------------------------------------------------------------------------------ 5.3 what it traded --
  function evLine(e) {
    const ty = e[1], d = e[6] == null ? '' : String(e[6]);
    if (ty === 'resized') return ['resized to ' + esc(d) + '% of pot', 'swap'];
    const f = num(parseFloat(d)), fd = f == null ? '' : ' · funding ' + fmt.num(f, 1) + '%/yr';
    if (ty === 'carry_in' || (ty === 'bought' && e[3] === 'carry')) return ['started collecting' + (ty !== 'bought' ? fd : ''), 'up'];
    if (ty === 'carry_out') return ['started closing' + fd, 'down'];
    if (ty === 'carry_closed') { const m = d.split(','); return ['carry closed' + (m[0] ? ' · ' + esc(m[0]) + '% of pot' : '') + (m[1] ? ' · kept ' + esc(m[1]) : ''), 'down']; }
    if (ty === 'carry_fix') return ['evened its legs at market', 'swap'];
    return ['bought', 'up'];
  }
  function tradedItems(b, c) {
    const out = [], open = [], closed = [];
    for (const t of trades(c.G)) {
      const T = t.t_at; if (T == null) continue;
      closed.push({ t: T, c: t.c, ic: 'down', a: ' data-trade="' + esc(t.id) + '"',
        h1: esc(t.c) + ' · ' + (t.carry ? 'carry closed' : 'sold') + ' after ' + hrs(t.hours),
        h2: t.carry ? (t.cap == null ? '—' : P(t.cap)) + ' of capital · ' + fmt.when(T) : RR(t.R) + ' (' + fmt.pct(t.pnl_pct) + ' of pot) · ' + esc(word.exit(t.rsn, t)) + ' · ' + fmt.when(T) });
    }
    for (const p of arr(b.pos).filter(isObj)) open.push({ t: num(p.t_in), c: p.c, ic: 'up', a: ' data-pos="' + esc(p.id) + '"', h1: esc(p.c) + ' · open',
      h2: 'bought ' + fmt.when(p.t_in) + (c.k === 'flip' ? ' · open ' + RR(p.r_now) : ' · ' + pp(p.size_pct) + ' of pot · ' + P(p.pnl_pct)) });
    for (const q of arr(b.carry).filter(isObj)) open.push({ t: num(q.t_in), c: q.c, ic: 'up', h1: esc(q.c) + ' · ' + esc((STW[q.st] || 'Collecting').toLowerCase()),
      h2: (q.st === 'exiting' ? 'opened ' : 'since ') + fmt.when(q.t_in) + ' · uses ' + p1(q.cap_pct) + ' of pot' });
    const near = (L, e) => L.some(o => o.c === e[2] && o.t != null && Math.abs(o.t - e[0]) <= 60);
    for (const e of arr(b.events)) {
      if (!Array.isArray(e) || num(e[0]) == null) continue;
      const ty = e[1], keep = ty === 'resized' || /^carry_/.test(ty) || (ty === 'bought' && (e[3] === 'target' || e[3] === 'carry'));
      if (!keep || near(open, e) || (ty === 'carry_closed' && near(closed, e))) continue;
      const w = evLine(e);
      out.push({ t: e[0], c: e[2], ic: w[1], h1: esc(e[2] || '') + ' · ' + w[0], h2: fmt.when(e[0]) });
    }
    return out.concat(open, closed).filter(x => x.t != null).sort((a, z) => z.t - a.t).slice(0, 30);
  }
  function traded(b, c) {
    const it = tradedItems(b, c), now = nowS();
    const row = (x, i) => '<li' + (i >= 8 && !MORE ? ' hidden' : '') + '><' + (x.a ? 'button type="button"' : 'div') + ' class="bt-row"' + (x.a || '') + '><span class="bt-ri' + (now - x.t < DAY ? ' on' : '') + '">' + icon(x.ic)
      + '</span><span class="bt-rt"><b>' + x.h1 + '</b><span class="sub">' + x.h2 + '</span></span></' + (x.a ? 'button' : 'div') + '></li>';
    const empty = { flip: 'Nothing traded yet. It buys when ' + (c.s === 3600 ? 'an hourly' : c.s === 86400 ? 'a daily' : 'a 4-hour') + ' flip passes every check.', target: 'Nothing traded yet.', carry: 'No pairs yet: funding is below the entry rate.' }[c.k];
    let h = it.length ? '<ul class="list bt-log">' + it.map(row).join('') + '</ul>' : c.G || c.k !== 'flip' ? '<p class="note">' + empty + '</p>' : '';
    if (!c.G) h += gWait(c);
    const acts = (it.length > 8 ? '<button type="button" class="btn small ghost" data-bt-more>' + (MORE ? 'Show fewer' : 'Show more') + '</button>' : '') + lk('#results/trades', 'All trades');
    if (c.k === 'flip' && c.G) {
      const by = {};
      for (const t of trades(c.G)) if (!t.carry && num(t.R) != null) { const x = by[t.c] || (by[t.c] = { c: t.c, n: 0, w: 0, R: 0 }); x.n++; if (t.R > 0) x.w++; x.R += t.R; }
      const top = Object.values(by).sort((a, z) => Math.abs(z.R) - Math.abs(a.R)).slice(0, 6);
      if (top.length) h += '<h3 class="bt-h3">By coin</h3><ul class="list bt-coins">' + top.map(x => '<li>' + chip(x.c) + '<span>' + word.plural(x.n, 'trade') + ' · ' + x.w + ' won</span>' + RR(x.R) + '</li>').join('') + '</ul>';
    }
    return sec(c, 'traded', 'What it traded', 'Newest first', h, acts);
  }

  // -------------------------------------------------------------------------------------- 5.4 how often --
  // 14 columns, one per phone-local day (never ledger signals.daily, which is UTC days).
  function strip(b, c) {
    const d0 = new Date(nowMs()); d0.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 13; i >= 0; i--) { const a = new Date(d0), z = new Date(d0); a.setDate(d0.getDate() - i); z.setDate(d0.getDate() - i + 1); days.push({ a: a.getTime() / 1000, z: z.getTime() / 1000, b: 0, x: 0, r: 0, q: 0 }); }
    const at = t => days.find(d => t >= d.a && t < d.z);
    const sg = obj(c.G.signals), rs = arr(sg.rows).filter(Array.isArray);
    for (const r of rs) { const d = at(r[0]); if (!d) continue; if (r[5] === 'bought') d.b++; else if (/^(blocked|recorded|expired|notfilled)$/.test(r[5])) d.r++; }
    for (const t of trades(c.G)) { const d = at(t.t_at); if (d) d.x++; }
    const wk = nowS() - 7 * DAY;
    // opens and closes already count from the signal rows and trades.t_out: only the actions between them here
    for (const e of arr(b.events)) if (Array.isArray(e) && /^(resized|carry_out|carry_fix)$/.test(e[1]) && e[0] >= wk) { const d = at(e[0]); if (d) d.q++; }
    const old = num(sg.total) > rs.length && rs.length ? Math.min(...rs.map(r => r[0])) : null, born = num(obj(b.origin).t);
    const max = Math.max(1, ...days.map(d => d.b + d.x + d.r + d.q));
    const Wd = c.k === 'carry' ? ['opened', 'closed', 'refused', 'carry actions'] : ['bought', 'sold', 'refused', 'rebalanced'];
    const seg = (cls, n) => n ? '<i class="' + cls + '" style="height:' + (n / max * 100).toFixed(1) + '%"></i>' : '';
    const cols = days.map((d, i) => {
      const pre = born != null && d.z <= born, unk = !pre && old != null && d.z <= old, parts = [[d.b, Wd[0]], [d.x, Wd[1]], [d.r, Wd[2]], [d.q, Wd[3]]].filter(p => p[0]).map(p => p[1] === 'carry actions' ? word.plural(p[0], 'carry action') : p[0] + ' ' + p[1]);
      const lab = fmt.day(d.a + 3600) + ': ' + (pre ? 'before it started' : unk ? 'not in this data' : parts.join(', ') || 'nothing');
      return '<div class="bt-day' + (unk ? ' bt-unk' : pre ? ' bt-pre' : '') + (i === 13 ? ' bt-today' : '') + '" role="img" aria-label="' + esc(lab) + '" data-tip="' + esc(lab) + '"><span class="bt-stk">'
        + (unk ? '<span class="bt-na">—</span>' : seg('bt-sb', d.b) + seg('bt-sx', d.x) + seg('bt-sq', d.q) + seg('bt-sr', d.r)) + '</span><span class="bt-dl">' + esc(fmt.wd(d.a + 3600).charAt(0)) + '</span></div>';
    }).join('');
    return '<div class="bt-strip">' + cols + '</div><div class="bt-sx2 cap"><span>' + esc(fmt.md(days[0].a + 3600)) + '</span><span>today</span></div>'
      + '<div class="legend bt-lg"><span><i class="bt-k bt-sb"></i>' + cap1(Wd[0]) + '</span><span><i class="bt-k bt-sx"></i>' + cap1(Wd[1]) + '</span>'
      + (c.k === 'flip' ? '<span><i class="bt-k bt-sr"></i>Refused</span>' : '<span><i class="bt-k bt-sq"></i>' + cap1(Wd[3]) + '</span>') + '</div>'
      + (c.k !== 'flip' ? '<p class="cap">' + cap1(Wd[3]) + ' shown for 7 days.</p>' : '');
  }
  function pace(b, c) {
    const bt = isObj(b.beat) ? b.beat : c.A && c.A.beat, b24 = typeof COMP.beat24 === 'function' ? safe(() => COMP.beat24(bt, { bar: c.s, lim: limOf(b) }), 'Beat') : null;
    const l24 = b24 ? { on_time: b24.on, slots: b24.slots, late: b24.late, missed: b24.missed, failed: b24.failed } : obj(b.last24), k = obj(b.clock), h = [];
    let s = 'Checks ' + wordOf('every', b, 1);
    if (num(l24.slots) != null) s += ' · ' + fmt.int(l24.on_time) + ' of ' + fmt.int(l24.slots) + ' on time in the last 24 h';
    const xs = [['late', 'late'], ['missed', 'missed'], ['failed', 'failed']].filter(p => num(l24[p[0]]) > 0).map(p => l24[p[0]] + ' ' + p[1]);
    if (xs.length) s += ' (' + xs.join(', ') + ')';
    s += num(k.lag_n) >= 3 && Array.isArray(k.lag_rng) ? ' · usually ' + Math.round(k.lag_med_min) + ' min after the close (' + k.lag_rng[0] + '–' + k.lag_rng[1] + ')' : ' · too few checks yet to measure the usual start';
    h.push('<p class="bt-cad">' + esc(s) + '</p>');
    const o = num(obj(b.origin).t), dys = o != null ? (nowS() - o) / DAY : null;
    if (c.G && dys != null) {
      const tot = num(obj(c.G.trades).total) || 0, rz = c.k === 'target' ? arr(b.events).filter(e => Array.isArray(e) && e[1] === 'resized').length : 0;
      const n = tot + arr(b.pos).length + (Array.isArray(b.carry) ? b.carry.length : c.k === 'carry' ? num(obj(b.risk).n_open) || 0 : 0) + rz;
      const all = obj(obj(c.G.stats).all), wd = c.k === 'target' ? ['entry and rebalance', 'entries and rebalances'] : c.k === 'carry' ? ['pair opened', 'pairs opened'] : ['buy', 'buys'];
      h.push('<p class="bt-cad">' + esc(fmt.int(n) + ' ' + (n === 1 ? wd[0] : wd[1]) + ' in ' + trim(Math.round(dys * 10) / 10) + ' days'
        + (dys >= 1 ? ' (about ' + trim(Math.round(n / dys * 70) / 10) + ' a week)' : '') + ' · ' + fmt.int(tot) + ' closed' + (num(all.hrs) != null && c.k !== 'carry' ? ' · average hold ' + hrs(all.hrs) : '')) + '</p>');
    }
    h.push('<h3 class="bt-h3">Last 14 days</h3>' + (c.G ? strip(b, c) : gWait(c)));
    if (c.k === 'flip') {
      const f = obj(obj(b.funnel).week), by = obj(f.by_check);
      const top = Object.keys(by).filter(k2 => num(by[k2]) > 0).sort((a, z) => by[z] - by[a]).slice(0, 3).map(k2 => esc(REF[k2] || word.reason(k2)) + ' (' + fmt.int(by[k2]) + ')');
      h.push('<h3 class="bt-h3">Signal funnel</h3>' + (num(f.signals) == null ? '<p class="note">Signal funnel ' + na() + '</p>'
        : '<p class="bt-fun">Last 7 days: <b>' + fmt.int(f.signals) + '</b> signals → <b>' + fmt.int(f.passed) + '</b> passed the checks → <b>' + fmt.int(f.bought) + '</b> bought.'
          + (top.length ? ' Most refusals: ' + top.join(', ') + '.' : '') + '</p>') + lk('#activity/signals', 'Why signals didn’t trade'));
    }
    const ev = arr(b.events).filter(e => Array.isArray(e) && num(e[5]) >= 1).sort((a, z) => z[0] - a[0]).slice(0, 6);
    h.push('<h3 class="bt-h3">Recent activity</h3>' + (ev.length ? '<ul class="list bt-ev">' + ev.map(e => { const w = word.event(e); return '<li><span class="bt-ri">' + icon(w.ic) + '</span><span class="bt-et">' + esc(fmt.when(e[0])) + '</span><span>' + w.html + '</span></li>'; }).join('') + '</ul>'
      : '<p class="note">Nothing recorded yet.</p>') + lk('#activity/timeline', 'Full log'));
    return sec(c, 'pace', 'How often', null, h.join(''));
  }

  // ------------------------------------------------------------------------------------ 5.5 holding now --
  function pairCard(q, s) {
    const fix = num(s.fix_h) != null ? num(s.fix_h) : 3, gate = num(s.gate_pct) != null ? num(s.gate_pct) : 80, cp = num(q.capture_pct), by = num(q.stuck_t) != null ? q.stuck_t + fix * 3600 : null;
    return '<article class="bt-pair' + (q.stuck_t != null ? ' bt-stuck' : '') + '"><div class="bt-ph">' + chip(q.c) + '<b>' + esc(STW[q.st] || cap1(q.st || 'open')) + '</b>'
      + (q.stuck_t != null ? '<span class="pill warn">legs uneven since ' + esc(fmt.when(q.stuck_t)) + '</span>' : '') + '</div>'
      + '<p>uses ' + p1(q.cap_pct) + ' of pot · funding now ' + (num(q.apr) == null ? '—' : fmt.num(q.apr, 1) + '%/yr') + '</p>'
      + (q.st === 'exiting' && num(q.exit_t) != null ? '<p>closing since ' + esc(fmt.when(q.exit_t)) + '</p>' : '')
      + '<p>collected ' + P(q.fund_pct) + ' · costs ' + fmt.pctu(q.cost_pct, 2) + ' · net ' + P(num(q.open_pct) != null && num(q.net_pct) != null ? q.net_pct + q.open_pct : q.net_pct) + ' of pot'
      + (num(q.open_pct) != null ? ' <span class="sub">(' + P(q.open_pct) + ' still open)</span>' : '') + '</p>'
      + '<div class="bt-capt"><div class="meter bt-cm" role="img" aria-label="' + esc(cp == null ? 'Funding kept not known yet' : 'Kept ' + cp + '% of its funding; the go-live gate is ' + gate + '%') + '"><i style="width:' + Math.max(0, Math.min(100, cp || 0)) + '%"></i></div><b style="left:' + gate + '%"></b>'
      + '<span>' + (cp == null ? '— ' + (q.st === 'exiting' ? 'while closing' : 'before any funding is due') : 'kept ' + (cp < 0 ? '−' : '') + Math.abs(cp) + '% of its funding') + '</span></div>'
      + (by != null ? '<p class="bt-fix">the engine evens the legs by ' + esc(fmt.when(by)) + '</p>' : '') + '</article>';
  }
  function holding(b, c) {
    const rk = obj(b.risk), h = [];
    if (c.k === 'carry') {
      const L = Array.isArray(b.carry) ? b.carry.filter(isObj) : null, s = obj(b.carry_sum);
      if (!L) h.push('<p class="note">' + word.plural(num(rk.n_open) || 0, 'pair') + ' open · details after the next check</p>');
      else if (!L.length) h.push('<p class="note">No pairs open.</p>');
      else {
        const o = L.slice().sort((a, z) => (a.stuck_t == null) - (z.stuck_t == null) || (a.stuck_t || 0) - (z.stuck_t || 0) || (num(z.cap_pct) || 0) - (num(a.cap_pct) || 0));
        h.push('<div class="bt-pairs">' + o.map(q => safe(() => pairCard(q, s), q.c)).join('') + '</div>');
        h.push('<p class="bt-line">' + word.plural(L.length, 'pair') + ' use ' + pp(num(s.cap_pct) != null ? s.cap_pct : sum(L, q => q.cap_pct)) + ' of the pot (sized at entry)'
          + '<button class="tip" type="button" data-tip="Each pair holds a coin and an equal short on its perp, so their capital adds up past 100% while the price moves largely cancel." aria-label="Why more than 100%?">?</button></p>');
      }
      return sec(c, 'holding', 'Holding now', 'Funding pairs, uneven legs first', h.join(''));
    }
    const pos = arr(b.pos).filter(isObj);
    if (c.k === 'target') {
      const tw = arr(b.tw).filter(Array.isArray);
      if (tw.length) h.push('<ul class="list bt-tw">' + tw.map(r => '<li>' + chip(r[0]) + '<span>target ' + p1(r[1]) + ' · holding ' + p1(r[2]) + ' · ' + esc(r[3]) + '</span></li>').join('') + '</ul>');
      else if (pos.length) h.push('<ul class="list bt-tw">' + pos.map(p => '<li>' + chip(p.c) + '<span>holding ' + pp(p.size_pct) + ' of pot</span></li>').join('') + '</ul>');
    }
    if (c.k === 'flip' && num(rk.used_pct) != null) h.push('<p class="bt-line">' + fmt.pctu(rk.used_pct, 2) + ' of pot at risk (cap ' + trim(rk.cap_pct) + '%) · ' + fmt.int(rk.n_open) + ' of ' + fmt.int(rk.max) + ' slots</p>');
    const v = num(rk.stops_hit_pct);
    if (v != null && pos.length) h.push('<p class="bt-line">If every stop were hit: ' + (fmt.cls(v) === 'pos' ? P(v) + ' of pot (the stops have locked in gains)' : fmt.cls(v) === 'neg' ? P(v) + ' of pot' : 'about even') + '</p>');
    if (!pos.length) h.push('<p class="note">Nothing open right now.</p>');
    else h.push('<div class="bt-cards">' + pos.map((p, i) => typeof COMP.positionCard === 'function' ? safe(() => COMP.positionCard(p, { first: i === 0 }), p.c)
      : '<button type="button" class="bt-row" data-pos="' + esc(p.id) + '"><b>' + esc(p.c) + '</b><span class="sub">' + RR(p.r_now) + ' open</span></button>').join('') + '</div>');
    return sec(c, 'holding', 'Holding now', pos.length ? word.plural(pos.length, 'position') : null, h.join(''));
  }

  // ------------------------------------------------------------------------------------------ 5.6 equity --
  function uniq(a) { const m = new Map(); for (const p of arr(a)) if (Array.isArray(p) && num(p[0]) != null && num(p[1]) != null) m.set(num(p[0]), num(p[1])); return [...m.entries()].sort((x, z) => x[0] - z[0]); }
  function equity(b, c) {
    const thr = arr(obj(b.cfg).thr), dd = num(obj(stateOf(b).thr).dd_pct), acts = lk('#results/curve', 'Interactive curve');
    if (!c.G) return sec(c, 'equity', 'Equity', null, gWait(c), acts);
    const eq = obj(c.G.eq), p = uniq(eq.pct), d = uniq(eq.dd), worst = d.reduce((m, x) => Math.max(m, x[1]), 0);
    const txt = '<p class="bt-line">' + (dd == null ? 'Distance from its peak ' + na() : dd > 0 ? 'Now ' + fmt.pctu(dd, 2) + ' below its peak' : 'At its peak') + ' · worst ' + fmt.pctu(worst, 2)
      + (thr[0] != null && thr[1] != null ? ' · risk halves at ' + esc(thr[0]) + '%, buying stops at ' + esc(thr[1]) + '%' : '') + '</p>';
    if (p.length < 2) return sec(c, 'equity', 'Equity', null, '<p class="note">The curve appears after two checks.</p>' + txt, acts);
    const Wd = 600, H = 140, t0 = p[0][0], t1 = p[p.length - 1][0], ds = d.map(x => [x[0], -x[1]]);
    let lo = Math.min(0, ...p.map(x => x[1]), ...ds.map(x => x[1])), hi = Math.max(0, ...p.map(x => x[1])); if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
    const X = t => ((t - t0) / Math.max(1, t1 - t0) * Wd).toFixed(1), Y = v => (4 + (hi - v) / (hi - lo) * (H - 8)).toFixed(1);
    const line = a => a.map((x, i) => (i ? 'L' : 'M') + X(x[0]) + ' ' + Y(x[1])).join('');
    const band = ds.length > 1 ? '<path class="dd" d="' + line(ds) + 'L' + X(ds[ds.length - 1][0]) + ' ' + Y(0) + 'L' + X(ds[0][0]) + ' ' + Y(0) + 'Z"/>' : '';
    const lab = 'Pot since ' + fmt.day(t0) + ': from ' + fmt.pct(p[0][1]) + ' to ' + fmt.pct(p[p.length - 1][1]) + '; worst drawdown ' + fmt.pctu(worst, 2) + '.';
    return sec(c, 'equity', 'Equity', 'Pot since ' + esc(fmt.day(t0)) + ', drawdown shaded', '<svg class="bt-eq" viewBox="0 0 ' + Wd + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(lab) + '">'
      + band + '<path class="z" d="M0 ' + Y(0) + 'H' + Wd + '"/><path class="l" d="' + line(p) + '"/></svg>' + txt, acts);
  }

  // ------------------------------------------------------------------------------- 5.7 health and schedule --
  function riskLimits(b) {
    const rk = obj(b.risk), by = obj(rk.by_book), names = arr(b.books).filter(isObj).map(x => x.b);
    Object.keys(by).forEach(k => { if (!names.includes(k)) names.push(k); });
    const bk = k => arr(b.books).find(x => isObj(x) && x.b === k) || {};
    return '<ul class="list bt-rl"><li><b>All books</b><span>' + (num(rk.used_pct) == null ? '—' : fmt.pctu(rk.used_pct, 2)) + ' of ' + trim(rk.cap_pct) + '% at risk · ' + fmt.int(rk.n_open) + ' of ' + fmt.int(rk.max) + ' slots</span></li>'
      + names.map(k => { const r = obj(by[k]), cp = num(r.cap_pct) != null ? r.cap_pct : bk(k).cap_pct; return '<li><b>' + esc(k) + '</b><span>' + (num(r.used_pct) == null ? '—' : fmt.pctu(r.used_pct, 2)) + ' of ' + trim(cp) + '% in use' + (num(r.n) ? ' · ' + fmt.int(r.n) + ' open' : '') + '</span></li>'; }).join('') + '</ul>';
  }
  function health(b, c) {
    const st = S.st || status(b), s = stateOf(b), halt = obj(s.halt), thr = obj(s.thr), T = arr(obj(b.cfg).thr), h = [];
    h.push(st.items.length ? '<div class="alerts bt-al">' + st.items.map(i => banner(i.lvl, i.sentence, i.act)).join('') + '</div>' : '<p class="note">Nothing needs you.</p>');
    if (typeof COMP.punctuality === 'function') h.push(safe(() => COMP.punctuality(b), 'Punctuality'));
    h.push('<p class="note">' + esc(word.punct(b) || MISSING) + '</p>');
    const buy = halt.set ? '<span class="neg">Halted</span> since ' + (halt.since != null ? esc(fmt.when(halt.since)) : 'unknown') + ': ' + esc(halt.reason || 'manual halt')
      : ({ normal: 'Allowed', halved: '<span class="neg">Risk halved</span>', halted: '<span class="neg">Stopped</span>' })[thr.state] || 'unknown';
    const dd = num(thr.dd_pct), D = Math.max(1, dd || 0, num(T[1]) ? T[1] * 1.25 : 25), x = v => (Math.min(1, v / D) * 100).toFixed(1);
    const gen = isoS(b.gen), lt = num(obj(b.clock).last_t), pm = gen != null && lt != null ? Math.round((gen - lt) / 60) : null;
    h.push('<dl class="facts"><dt' + hint('buying') + '>Buying</dt><dd>' + buy + '</dd><dt>Drawdown' + tip('drawdown') + '</dt><dd>' + (dd == null ? na(true) : fmt.pctu(dd, 2)) + '</dd>'
      + '<dt>Data</dt><dd>' + (pm == null ? na(true) : (pm < 1 ? 'pushed within a minute of the check' : 'pushed ' + pm + ' min after the check') + (gen != null ? ' · <span data-ago="' + gen + '">' + esc(fmt.ago(gen)) + '</span>' : '')) + '</dd></dl>');
    h.push('<div class="bt-dd" role="img" aria-label="' + esc('Drawdown ' + (dd == null ? 'not in this data' : fmt.pctu(dd, 2)) + (T[0] != null ? '; risk halves at ' + T[0] + '%' : '') + (T[1] != null ? ', buying stops at ' + T[1] + '%' : '')) + '">'
      + '<div class="meter"><i class="' + (dd != null && T[1] != null && dd >= T[1] ? 'bt-bad' : dd != null && T[0] != null && dd >= T[0] ? 'bt-warn' : 'bt-ok') + '" style="width:' + x(dd || 0) + '%"></i></div>'
      + (T[0] != null ? '<b style="left:' + x(T[0]) + '%">' + esc(T[0]) + '%</b>' : '') + (T[1] != null ? '<b style="left:' + x(T[1]) + '%">' + esc(T[1]) + '%</b>' : '') + '</div>');
    if (c.k === 'flip') {
      const dsc = (k, id, t, inner) => '<details class="disc bt-dsc" data-bt="' + k + '"' + (id ? ' id="overview-' + id + '"' : '') + (OPEN[k] ? ' open' : '') + '><summary>' + t + '</summary><div class="body">' + inner + '</div></details>';
      h.push('<div class="bt-dscs">' + dsc('rl', null, 'Risk limits', riskLimits(b)) + dsc('gr', 'gaterun', 'Last check, step by step', '<div class="bt-host" id="bt-gr"></div>')
        + dsc('od', 'ondeck', 'On deck', '<div class="bt-host" id="bt-od"></div>') + '</div>' + lk('#activity/tape', 'Board over time'));
    }
    return sec(c, 'health', 'Health and schedule', null, h.join(''));
  }
  function mount(k) {
    if (k === 'gr') {
      const el = document.getElementById('bt-gr'); if (!el || el._bt) return;
      el._bt = 1;
      if (typeof COMP.gateRun === 'function') call(COMP.gateRun, el, null, { autoplay: false }); else el.innerHTML = '<p class="note">The step-by-step replay is not available here.</p>';
    } else if (k === 'od') {
      const el = document.getElementById('bt-od'); if (!el) return;
      if (typeof COMP.onDeck === 'function') call(COMP.onDeck, el, { b: S.b }); else el.innerHTML = '<p class="note">On deck is not available here.</p>';
    }
  }
  function openDsc(k, scroll) {
    const d = $('details[data-bt="' + k + '"]'); if (!d) return;
    OPEN[k] = true; d.open = true; mount(k);
    if (scroll) into(d, true);
  }

  // ------------------------------------------------------------------------------------ 5.8 strategy --
  function strategy(b, c) {
    const cf = obj(b.cfg), T = arr(cf.thr), h = [], p = [];
    if (cf.ver) p.push('Rules v' + cf.ver);
    if (c.k === 'flip' && num(cf.risk_pct) != null) p.push('risks ' + trim(cf.risk_pct) + '% of pot per trade');
    if (num(cf.max_pos) != null) p.push('up to ' + word.plural(cf.max_pos, c.k === 'carry' ? 'pair' : 'position'));
    if (T[0] != null && T[1] != null) p.push('risk halves at a ' + trim(T[0]) + '% drawdown, buying stops at ' + trim(T[1]) + '%');
    h.push('<p class="bt-line">' + esc(p.join(' · ')) + '</p><p class="note">' + (Array.isArray(b.order) ? word.plural(b.order.length, 'coin') : '— coins') + ' in ' + word.plural(arr(b.books).length, 'book')
      + (cf.btc_gate === true ? ' · <span class="pill" data-tip="It buys only while Bitcoin’s weekly trend is bullish.">Bitcoin gate on</span>' : '') + '</p>');
    const s = arena(c);
    if (s) {
      const bt = obj(s.backtest), pa = obj(s.paper), dy = num(s.days), nr = arr(s.not_ready), m = nr.map(String).map(x => /of (\d+) days/.exec(x)).find(Boolean);
      const tr = (k, x, y) => '<tr><td class="l">' + k + '</td><td>' + x + '</td><td>' + y + '</td></tr>';
      if (s.hypothesis) h.push('<p class="bt-hy">' + esc(s.hypothesis) + '</p>');
      h.push('<div class="tbl bt-bt"><table><thead><tr><th class="l">Measure</th><th' + hint('bt') + '>Backtest</th><th' + hint('bt') + '>Paper so far</th></tr></thead><tbody>'
        + tr('Return', num(bt.cagr_pct) == null ? '—' : fmt.num(bt.cagr_pct, 1) + '%/yr' + (num(bt.years) != null ? ' (' + trim(bt.years) + ' yrs)' : ''), P(pa.ret_pct) + (dy != null ? ' in ' + word.plural(Math.floor(dy), 'day') : ''))
        + tr('Worst drawdown', num(bt.max_dd_pct) == null ? '—' : fmt.pctu(bt.max_dd_pct, 1), num(pa.dd_pct) == null ? '—' : fmt.pctu(pa.dd_pct, 2))
        + tr('Sharpe', num(bt.sharpe) == null ? '—' : fmt.num(bt.sharpe) + (num(bt.holdout_sharpe) != null ? ' (holdout ' + fmt.num(bt.holdout_sharpe) + ')' : ''), 'too early')
        + tr('Matches its backtest', '—', num(pa.weight_match_pct) == null ? '—' : trim(pa.weight_match_pct) + '% of ' + fmt.int(pa.weight_checks) + ' checks')
        + tr('Days in arena', '—', dy == null ? '—' : fmt.int(Math.floor(dy)) + (m ? ' of ' + m[1] : '')) + '</tbody></table></div>');
      if (nr.length) h.push('<ul class="bt-nr">' + nr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>');
      if (s.ready) h.push('<p><span class="pill ok">Ready for you</span> <button type="button" class="btn small" data-sheet="shortlist">How to switch it live ›</button></p>');
    } else if (c.A && c.A.arena && !c.X) h.push('<p class="note">' + (fxDone ? 'The lab hasn’t published its record.' : 'Loading the lab’s record…') + '</p>');
    const F = c.X ? obj(c.X.fleet) : null, mem = F && arr(F.members).find(x => isObj(x) && x.agent === me()), ex = F && arr(F.excluded).find(x => isObj(x) && x.agent === me());
    h.push('<p class="bt-line">Fleet share: ' + (mem ? '<b>' + p1(mem.share_pct) + '</b> of the fleet, equal risk' : ex ? esc(ex.why || 'not in the allocation') : c.X ? '—' : fxDone ? 'the lab hasn’t published' : 'loading…')
      + (c.X ? ' <button type="button" class="btn small ghost" data-sheet="fleet">Fleet split ›</button>' : '') + '</p>');
    h.push('<div class="bt-links">' + lk('#rules', 'Full rules') + lk('#results/review', 'Weekly review')
      + '<a class="bt-lk" href="' + CONTROL + '" target="_blank" rel="noopener">Controls ›</a><span class="cap">run it with agent <code>' + esc(me()) + '</code></span></div>');
    return sec(c, 'strategy', 'Strategy and evidence', null, h.join(''));
  }

  // ---------------------------------------------------------------------------------------------- view --
  const sig = A => { try { return JSON.stringify([A && [A.name, A.desc, A.gen, A.beat, A.act, A.arena], roster()]); } catch (e) { return ''; } };
  function render(root, why) {
    const b = S.b; if (!b) return '';
    W = why || 'route';
    const c = ctx(b, W);
    DRAWN = { gen: b.gen, G: !!c.G, X: !!c.X, FX: c.X, sig: sig(c.A) };
    const S1 = (f, n) => safe(() => f(b, c), n);
    return '<div class="bt-page bt-' + c.k + '">' + S1(hero, 'Overview') + '<div class="bt-cols"><div class="bt-col">' + S1(record, 'Wins & losses') + S1(traded, 'What it traded') + S1(pace, 'How often')
      + '</div><div class="bt-col">' + S1(holding, 'Holding now') + S1(equity, 'Equity') + S1(health, 'Health and schedule') + S1(strategy, 'Strategy and evidence') + '</div></div></div>';
  }
  function swap(id, fn) {
    const el = document.getElementById(id); if (!el || !S.b) return;
    const c = ctx(S.b, 'swap'), t = document.createElement('template');
    t.innerHTML = safe(() => fn(S.b, c), id); const n = t.content.firstElementChild; if (!n) return;
    el.replaceWith(n); decorate(n); masks(n);
  }
  // Bead tips (§5.1.6): a bead with a slot time (fleet.js data-slot, or our fallback's data-s) gets the recorded run's
  // words, and on a signal bot "Replay this check ›"; a slot without a recorded run keeps the strip's own tip.
  function decorate(root) {
    if (typeof COMP.fitLadders === 'function' && root.querySelector('.ps-card')) call(COMP.fitLadders, root);
    const flip = ctx(S.b, 'swap').k === 'flip';
    $$('.bt-beat [data-slot],.bt-beat [data-s]', root).forEach(el => {
      if (el._tip) return;
      const s = num(el.dataset.slot != null ? el.dataset.slot : el.dataset.s), rs = runsOf().filter(r => r && r.s === s), r = rs[rs.length - 1];
      if (s == null || s > nowS()) return;
      if (!r) { if (!el.dataset.tip) el.dataset.tip = 'The ' + fmt.when(s) + ' close · no check recorded'; return; }
      const cc = arr(r.c), evs = arr(S.b.events).filter(e => Array.isArray(e) && e[0] === r.t), n = ty => evs.filter(e => e[1] === ty).length;
      const buy = Math.max(num(cc[4]) || 0, n('bought')), sold = n('sold'), sg = num(cc[1]) || 0;
      const tx = fmt.when(r.t) + ' · ' + (r.x ? 'failed' : (r.ok ? 'on time' : 'ran late') + (r.lm != null ? ', ' + r.lm + ' min after the close' : ''))
        + ' · ' + (flip ? (sg ? word.plural(sg, 'signal') : 'no signals') + ', ' : '') + (buy || sold ? [buy ? 'bought ' + buy : '', sold ? 'sold ' + sold : ''].filter(Boolean).join(', ') : 'nothing ' + (flip ? 'bought' : 'traded'));
      el.dataset.tip = tx; if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', tx);
      if (flip) el.dataset.tipCursor = r.t;
    });
    $$('details.bt-dsc[open]', root).forEach(d => mount(d.dataset.bt));
  }
  function landLedger() {
    if (S.tab !== 'overview' || !S.b || DRAWN.gen !== S.b.gen) return;
    const G = !!(S.ledger && S.ledgerGen === S.b.gen);
    if (DRAWN.G && G) return;
    DRAWN.G = G;
    swap('overview-record', record); swap('overview-traded', traded); swap('overview-pace', pace); swap('overview-equity', equity);
    const a = document.getElementById('bt-act'); if (a) a.innerHTML = actHtml(S.b, ctx(S.b, 'swap'));
  }
  function landFx() {
    if (S.tab !== 'overview' || !S.b || DRAWN.FX === FX) return;
    DRAWN.X = !!FX; DRAWN.FX = FX;
    swap('overview-record', record); swap('overview-strategy', strategy);
  }
  function onClick(e) {
    const t = e.target; if (!(t instanceof Element) || e.defaultPrevented) return;
    const go = t.closest('[data-bt-go]');
    if (go && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); step(Number(go.dataset.btGo)); return; }
    if (t.closest('[data-bt-more]')) { e.preventDefault(); MORE = !MORE; swap('overview-traded', traded); }
  }
  function onToggle(e) {
    const d = e.target; if (!(d instanceof Element) || !d.matches('details[data-bt]')) return;
    OPEN[d.dataset.bt] = d.open; if (d.open) mount(d.dataset.bt);
  }
  function countPot(root) {
    if (W !== 'arrival' || !S.prev) return;
    const el = $('.bt-pct', root), to = el && num(el.dataset.v), from = num(obj(S.prev.pot).chg_pct);
    if (to == null || from == null || Math.abs(from - to) < 0.005) return;
    el.textContent = fmt.pct(from); countUp(el, to, { from, ms: 600, fmt: v => fmt.pct(v) });
  }
  function after(root) {
    root.addEventListener('click', onClick); root.addEventListener('toggle', onToggle, true);
    decorate(root); countPot(root);
    const gen = S.b && S.b.gen;
    if (!DRAWN.G) Promise.resolve(loadLedger()).then(() => { LD = { gen, done: true }; landLedger(); }, () => {});
    fx().then(landFx);
    return () => { root.removeEventListener('click', onClick); root.removeEventListener('toggle', onToggle, true); };
  }
  VIEWS.overview = { title: 'Overview', render, after, leave() { MORE = false; } };

  // ------------------------------------------------------------------------------------------- hooks --
  hook('route', (tab, sub) => { if (tab === 'overview' && (sub === 'gaterun' || sub === 'ondeck')) openDsc(sub === 'gaterun' ? 'gr' : 'od'); });
  hook('agents', () => {
    if (S.tab !== 'overview' || !S.b || sig(rowA()) === DRAWN.sig) return;
    DRAWN.sig = sig(rowA());
    swap('overview-hero', hero); swap('overview-record', record); swap('overview-strategy', strategy);
  });
  // The verdict and schedule follow the status engine (the 30 s tick, an arrival, a phase flip).
  hook('status', () => {
    if (S.tab !== 'overview' || !S.b) return;
    const v = document.getElementById('bt-verdict'), sc = document.getElementById('bt-sched');
    if (v) { const h = verdictHtml(); if (v._h !== h) { v.innerHTML = h; v._h = h; } }
    if (sc) { const h = schedHtml(S.b); if (sc._h !== h) { sc.innerHTML = h; sc._h = h; } }
  });
  // "Replay this check ›" and an explicit cursor move open the step-by-step replay here; On deck follows the cursor.
  if (typeof onCursor === 'function') onCursor((t, prev, o) => {
    if (S.tab !== 'overview' || !S.b) return;
    const od = document.getElementById('bt-od');
    if (od && OPEN.od && typeof COMP.onDeck === 'function') call(COMP.onDeck, od, { at: t, b: S.b });
    if (o && (o.scroll || o.explicit) && o.sheet !== false && !S.sheet && ctx(S.b, 'swap').k === 'flip') openDsc('gr', true);
  });
  // [ and ] are core's (botStep) once package B ships them; until then this module handles them on a bot page.
  if (typeof botStep !== 'function') document.addEventListener('keydown', e => {
    if (e.defaultPrevented || (e.key !== '[' && e.key !== ']') || e.metaKey || e.ctrlKey || e.altKey || !isBot() || !S.b) return;
    if (e.target instanceof Element && e.target.closest('input,select,textarea,[contenteditable]')) return;
    e.preventDefault(); step(e.key === '[' ? -1 : 1);
  });
}
