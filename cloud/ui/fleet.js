// cloud/ui/fleet.js — the Command Center, the master page at "/" (COMMAND_CENTER_SPEC §3, §4, §7, §8). One block (see
// ui/README.md); classes carry the fl- prefix. It exports, by assignment only:
//   VIEWS.fleet               the master: header (verdict, KPIs, switch pills), Needs-you rail, controls, tiles, fleet log, Lab
//   COMP.fleetSummary()       → {lvl, cap, alerts, items}: the worst fleet level, which core paints into the capsule and rail
//   COMP.fleetLoading()       → the loading state (header of "—" and N static placeholder tiles, no shimmer)
//   COMP.beatStrip(beat, o)   → html: the heartbeat strip of a row's / bundle's beat {s0, n, k} (§4 row 5, §6.1 alphabet)
//   COMP.sparkSvg(values, o)  → html: the pot sparkline (inline SVG, no library)
//   COMP.roster()             → html: the rail's mini roster (dot + name + short status word), on both pages
//   SHEETS.fleethealth        every bot's status items, bad then warn then info, each with "Open bot ›"
// Every status word comes from core status(rowBundle(row)), the one engine the bot page uses on its bundle (§6.7).
{
  const D = 86400;
  const arr = v => (Array.isArray(v) ? v : []);
  const RANK = { bad: 0, warn: 1, info: 2, mute: 3, ok: 4 };
  const VERD = { ok: 'All clear', mute: 'Waiting', info: 'Due', warn: 'Watch', bad: 'Needs you' };
  const PILLC = { ok: 'ok', mute: 'mute', info: 'info', warn: 'warn', bad: 'bad' };
  const DOTC = { ok: 'ok', info: 'due', warn: 'gap', bad: 'bad', mute: 'mute' };
  const ACTED = new Set(['bought', 'sold', 'trail', 'resized', 'carry_in', 'carry_out', 'carry_closed']);
  const CONTROL = 'https://github.com/SproutHouse/AiFi_Executor/actions/workflows/control.yml';
  const SORTS = [['roster', 'Roster'], ['attention', 'Needs attention'], ['return', 'Return'], ['active', 'Most active']];
  const FILTERS = [['all', 'All'], ['flip', 'Signal traders'], ['target', 'Rebalancers'], ['carry', 'Funding collectors'], ['live', 'Live'], ['arena', 'Arena']];
  const PHONE = matchMedia('(max-width:640px)');
  const F = { order: null, root: null, seen0: Number(lsGet('ex.fl.seen', 0)) || 0, seenT: 0, gens: {}, acts: {}, big: {}, live: {}, first: true, fx: null };

  // ====================================================================================== rows ==
  const E = () => S.E || {};
  const rows = () => arr(AGENTS).filter(r => r && r.id);
  const active = () => rows().filter(r => r.enabled !== false);
  const nm = r => (r && (r.name || r.id)) || '';
  const barS = r => num(r.bar_s) || TF[r.tf] || null;
  const lastT = r => num(r.sb && r.sb.clock && r.sb.clock.last_t) ?? num(r.last_t);
  const href = (r, h) => botHref(r.id, h);
  const plain = h => String(h == null ? '' : h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  // A status sentence inside a link: its coin buttons become plain chips (a tile is one tap target, §2.4).
  const flat = h => String(h || '').replace(/<button type="button" class="tk"[^>]*>([^<]*)<\/button>/g, '<span class="tk">$1</span>');
  const tail = h => flat(h).replace(/^\s*<b>[^<]*<\/b>\s*(·|:)\s*/, '');          // "<b>Needs you</b> · exits …" → "exits …"
  function rowStatus(A, now) {
    now = now == null ? nowS() : now;
    const b = rowBundle(A);
    if (b) { const st = status(b, now); st.b = b; return st; }
    // A v1 row (no sb): its own booleans, a fleet halt, or the muted "Checked …" line. Never "On schedule" (§3.9).
    const fh = E().fleet && E().fleet.halt, t = num(A.last_t);
    const mk = (lvl, k, w, sentence, wide) => ({ lvl, k, word: w, dot: DOTC[lvl], age: '', wide, sentence, items: [{ lvl, k, word: w, sentence, head: true }], K: { phase: 'none' }, v1: true });
    if (A.failed === true) return mk('bad', 'failed', 'Failed', '<b>Failed</b> · its last check stopped early.', '· its last check stopped early');
    if (A.halt === true || fh) return mk('bad', 'halt', 'Halted', '<b>Halted</b>' + (fh ? ' · fleet halt' : '') + '. No new buys; exits still run.', '· no new buys');
    const st = mk('mute', 'v1', t != null ? 'Checked ' + fmt.ago(t) : 'Waiting for its first check', '', '· schedule after its next check');
    st.items = []; return st;
  }
  function statuses(now) { const m = {}; for (const A of rows()) m[A.id] = safe(() => rowStatus(A, now), 'Status ' + A.id) || { lvl: 'mute', word: '—', items: [], K: {} }; return m; }
  function fxNow() { return F.fx; }
  function arenaOf(A) {
    const X = fxNow(); if (!A.arena) return null;
    const s = X && arr(X.shortlist).find(x => x && x.agent === A.id);
    const m = s && /(\d+)\s+of\s+(\d+)\s+days/.exec(arr(s.not_ready).join(' ')), days = s && num(s.days);
    return { s, day: days != null ? Math.max(0, Math.floor(days)) : null, of: m ? Number(m[2]) : null };
  }

  // ============================================================================ fleet summary ==
  // The worst level over enabled bots (a v1 row counts as calm, never as "On schedule"); the capsule words of §3.0;
  // the alert rail of §3.1; the Needs-you items of §3.3.
  function summary(now) {
    now = now == null ? nowS() : now;
    const sts = statuses(now), on = active(), e = E(), out = { lvl: 'ok', cap: null, alerts: [], items: [], sts };
    let worst = 'ok';
    for (const A of on) { const l = sts[A.id].lvl; if (RANK[l] < RANK[worst] && l !== 'mute') worst = l; }
    if (!on.length || (worst === 'ok' && !on.some(A => sts[A.id].lvl === 'ok'))) worst = 'mute';   // nothing on schedule: never a glowing "All clear"
    out.lvl = worst;
    const at = l => on.filter(A => sts[A.id].lvl === l);
    const newest = Math.max(-Infinity, ...on.map(lastT).filter(t => t != null));
    if (worst === 'bad') { const n = at('bad').length; out.cap = { dot: 'bad', cls: 'bad', word: n + (n === 1 ? ' needs you' : ' need you'), age: '', wide: '' }; }
    else if (worst === 'warn') { const w = at('warn'); out.cap = { dot: 'gap', cls: 'warn', word: w.length + ' to check · ' + w.slice(0, 2).map(nm).join(', ') + (w.length > 2 ? ' +' + (w.length - 2) : ''), age: '', wide: '' }; }
    else if (worst === 'info') out.cap = { dot: 'due', cls: '', word: 'Due', age: '', wide: '· ' + at('info').map(nm).slice(0, 2).join(', ') };
    else if (worst === 'mute') out.cap = { dot: 'mute', cls: '', word: on.length ? 'Waiting' : 'No bots yet', age: on.length && isFinite(newest) ? 'checked ' + fmt.ago(newest) : '', wide: on.length ? '· schedule after the next check' : '' };
    else out.cap = { dot: 'ok', cls: '', word: 'All clear', age: isFinite(newest) ? 'checked ' + fmt.ago(newest) : '', wide: '' };
    const fl = isObj(e.fleet) ? e.fleet : {};
    if (fl.halt) out.alerts.push({ lvl: 'bad', html: '<b>Fleet halted</b> since ' + esc(fl.since != null ? fmt.when(isoS(fl.since)) : 'unknown') + ': ' + esc(fl.reason || 'no reason given') + '. No bot buys; exits still run.', act: { label: 'How to resume ›', href: CONTROL } });
    const clocked = on.filter(A => sts[A.id].K && sts[A.id].K.C != null), host = isObj(e.host) ? e.host : {}, ht = isoS(host.t);
    if (clocked.length && clocked.every(A => /^(late|stale)$/.test(sts[A.id].K.phase)) && (ht == null || now - ht > 7200))
      out.alerts.push({ lvl: 'bad', html: '<b>Runner down?</b> No bot has checked in since ' + esc(isFinite(newest) ? fmt.when(newest) : '—') + '; the ' + esc(hostName(host)) + '’s last tick was ' + esc(ht != null ? fmt.when(ht) : 'not recorded') + '.' });
    for (const A of on) for (const it of sts[A.id].items || []) if (it.lvl === 'bad' || it.lvl === 'warn') out.items.push({ A, it, lvl: it.lvl });
    const ord = orderIdx();
    out.items.sort((x, y) => RANK[x.lvl] - RANK[y.lvl] || (ord[x.A.id] ?? 99) - (ord[y.A.id] ?? 99));
    return out;
  }
  COMP.fleetSummary = function () { if (PAGE !== 'fleet') return null; return summary(); };
  function hostName(h) { return h.name === 'alwaysdata' ? 'Paris server' : h.name === 'github' ? 'GitHub runner' : h.name ? String(h.name) : 'server'; }
  function orderIdx() { const m = {}; orderOf(E()).forEach((id, i) => { m[id] = i; }); rows().forEach((r, i) => { if (m[r.id] == null) m[r.id] = 1000 + i; }); return m; }

  // ============================================================================ the heartbeat ==
  const BEADW = { o: 'on time', O: 'on time, with a trade', l: 'ran late', L: 'ran late, with a trade', x: 'failed', '-': 'missed', '.': 'before its first check' };
  const BARN = { 24: 3600, 18: 14400, 14: 86400 };
  // beatK: beat {s0, n, k} as pushed, plus "-" for every later close that is now past its late limit with no newer row
  // (§6.7), keeping the newest n → {s0, k, bar}, or null. The strip and every "last 24 h" count read this one beat.
  function beatK(beat, o) {
    if (!isObj(beat) || typeof beat.k !== 'string' || num(beat.s0) == null || !beat.k.length) return null;
    const n = num(beat.n) || beat.k.length, bar = num(o.bar) || BARN[n] || 14400, lim = num(o.lim) || 45, now = num(o.now) ?? nowS();
    let k = beat.k.replace(/[^.\-xoOlL]/g, '.'), s0 = num(beat.s0);
    for (let s = s0 + k.length * bar, i = 0; s + lim * 60 <= now && i < n; s += bar, i++) k += '-';
    if (k.length > n) { s0 += (k.length - n) * bar; k = k.slice(k.length - n); }
    return { s0, k, bar };
  }
  // COMP.beat24(beat, {bar, lim, now}) → {on, slots, late, missed, failed} over the closes of the last 24 h, or null.
  COMP.beat24 = function (beat, o) {
    o = o || {}; const bk = beatK(beat, o), now = num(o.now) ?? nowS(), r = { on: 0, slots: 0, late: 0, missed: 0, failed: 0 };
    if (!bk) return null;
    for (let i = 0; i < bk.k.length; i++) {
      const c = bk.k[i]; if (c === '.' || bk.s0 + i * bk.bar <= now - D) continue;
      r.slots++; if (c === 'o' || c === 'O') r.on++; else if (c === 'l' || c === 'L') r.late++; else if (c === 'x') r.failed++; else r.missed++;
    }
    return r;
  };
  // The strip: the extended beat, then the hollow accent "next" bead. o.big: 44px-tall tap targets with a tip per bead.
  COMP.beatStrip = function (beat, o) {
    o = o || {};
    const bk = beatK(beat, o);
    if (!bk) return '<span class="fl-hbna">heartbeat after its next check</span>';
    const { s0, k, bar } = bk;
    const owed = k.replace(/\./g, '').length, ok = (k.match(/[oO]/g) || []).length, tr = (k.match(/[OL]/g) || []).length;
    const nx = num(o.nextT), bw0 = barw(bar, 0);
    const lab = 'Last ' + k.length + ' ' + bw0 + ' checks: ' + ok + ' on time' + (tr ? ', ' + tr + ' with a trade' : '') + (owed - ok ? ', ' + (owed - ok) + ' not on time' : '') + (nx != null ? '; next about ' + fmt.time(nx) : '');
    const cls = c => 'fl-b fl-b' + ({ o: 'o', O: 'oa', l: 'l', L: 'la', x: 'x', '-': 'm', '.': 'p' })[c];
    let h = '';
    for (let i = 0; i < k.length; i++) {
      const c = k[i], s = s0 + i * bar, fresh = o.fresh && i === k.length - 1 && c !== '-' && c !== '.' ? ' grow1' : '';
      const w = 'The ' + fmt.when(s) + ' close · ' + BEADW[c];
      h += o.big ? '<button type="button" class="' + cls(c) + fresh + '" data-slot="' + s + '" data-tip="' + esc(w) + '" aria-label="' + esc(w) + '"><i></i></button>' : '<i class="' + cls(c) + fresh + '"></i>';
    }
    const nw = nx != null ? 'Next check about ' + fmt.time(nx) : 'Next check';
    h += o.big ? '<button type="button" class="fl-b fl-bn" data-tip="' + esc(nw) + '" aria-label="' + esc(nw) + '"><i></i></button>' : '<i class="fl-b fl-bn"></i>';
    return '<span class="fl-hb' + (o.big ? ' fl-hbig' : '') + '"' + (o.big ? ' role="group"' : ' role="img"') + ' aria-label="' + esc(lab) + '"><span class="fl-beads" style="--n:' + (k.length + 1) + '"' + (o.big ? '' : ' aria-hidden="true"') + '>' + h + '</span>'
      + '<span class="fl-hbn" aria-hidden="true"' + (o.big ? '' : ' title="' + esc(lab) + '"') + '>' + ok + '/' + owed + '</span></span>';
  };

  // ============================================================================== the sparkline ==
  // values: numbers or [t, v] pairs (a bundle's pot.spark). Zero is drawn as a dashed baseline when inside the range.
  COMP.sparkSvg = function (values, o) {
    o = o || {};
    const vs = arr(values).map(p => num(Array.isArray(p) ? p[1] : p)).filter(v => v != null);
    if (!arr(values).length) return '<span class="fl-spna">' + na(true) + '</span>';
    if (vs.length < 2) return '<span class="fl-spna">line appears after two checks</span>';
    const w = num(o.w) || 140, h = num(o.h) || 40, pad = 3;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
    const X = i => (pad + i * (w - 2 * pad) / (vs.length - 1)).toFixed(1), Y = v => (pad + (hi - v) / (hi - lo) * (h - 2 * pad)).toFixed(1);
    const zero = lo < 0 && hi > 0 ? '<line class="fl-sp0" x1="0" x2="' + w + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>' : '';
    const lab = o.label || ('Pot over the last ' + vs.length + ' checks, from ' + fmt.pct(vs[0]) + ' to ' + fmt.pct(vs[vs.length - 1]));
    return '<svg class="fl-sp" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(lab) + '">' + zero
      + '<polyline points="' + vs.map((v, i) => X(i) + ',' + Y(v)).join(' ') + '"/><circle r="2.5" cx="' + X(vs.length - 1) + '" cy="' + Y(vs[vs.length - 1]) + '"/></svg>';
  };

  // ================================================================================ the roster ==
  COMP.roster = function () {
    const sts = statuses(), ord = orderIdx();
    const list = active().slice().sort((a, b) => ord[a.id] - ord[b.id]);
    if (!list.length) return '';
    return '<div class="fl-roh">Bots</div>' + list.map(A => {
      const st = PAGE === 'bot' && A.id === AGENT && S.st ? S.st : sts[A.id];
      return '<a class="fl-ro" href="' + esc(href(A)) + '"' + (PAGE === 'bot' && A.id === AGENT ? ' aria-current="page"' : '') + '><i class="dot ' + (DOTC[st.lvl] || 'mute') + '"></i><span class="fl-ron">' + esc(nm(A)) + '</span><span class="fl-row">' + esc(st.word) + '</span></a>';
    }).join('');
  };

  // ================================================================================= the header ==
  function verdictHtml(sm) {
    const on = active(), sts = sm.sts, lvl = sm.lvl;
    const okN = on.filter(A => sts[A.id].lvl === 'ok').length, muteN = on.filter(A => sts[A.id].lvl === 'mute').length;
    let s;
    if (!on.length) s = 'No bot has reported yet.';
    else if (lvl === 'ok' || lvl === 'mute') s = okN + ' of ' + on.length + ' bots on schedule' + (muteN ? '; ' + muteN + ' ' + (muteN === 1 ? 'reports its schedule' : 'report their schedules') + ' after the next check' : '') + '.';
    else {
      const hit = on.filter(A => sts[A.id].lvl === lvl);
      s = hit.slice(0, 2).map(A => '<a class="fl-vl" href="#fl-' + esc(A.id) + '" data-fl-go="' + esc(A.id) + '">' + esc(nm(A)) + '</a>: '
        + esc(plain(tail(sts[A.id].head ? sts[A.id].head.sentence : sts[A.id].sentence)).replace(/^([A-Z0-9]{2,12}): /, '$1 ').replace(/\.$/, ''))).join('; ')
        + (hit.length > 2 ? '; and ' + (hit.length - 2) + ' more' : '') + '.';
    }
    return '<div class="fl-verdict"><span class="pill big ' + PILLC[lvl] + '">' + esc(VERD[lvl]) + '</span><span class="fl-vs">' + s + '</span></div>';
  }
  function kpi(k, v, sub, cls) { return '<div class="fl-kpi"><span class="fl-kk">' + esc(k) + '</span><b class="fl-kv' + (cls ? ' ' + cls : '') + '">' + v + '</b><span class="fl-ks">' + sub + '</span></div>'; }
  function kpisHtml(sm) {
    const on = active(), sts = sm.sts, X = fxNow(), now = nowS();
    // Bots: the not-OK rows split so the parts add up to (total − OK) (§3 b).
    const okN = on.filter(A => /^(ok|info)$/.test(sts[A.id].lvl)).length, bad = on.filter(A => !/^(ok|info)$/.test(sts[A.id].lvl));
    const ks = l => bad.filter(A => l.indexOf(sts[A.id].k) >= 0).length, lateN = ks(['late_now', 'stale', 'exits']), failN = ks(['failed']), haltN = ks(['halt', 'thr_halt']);
    const waitN = ks(['v1']), otherN = bad.length - lateN - failN - haltN - waitN;
    const c1 = kpi('Bots', esc(okN + ' of ' + on.length + ' OK'), esc(lateN + ' late · ' + failN + ' failed · ' + haltN + ' halted' + (waitN ? ' · ' + waitN + ' waiting' : '') + (otherN ? ' · ' + otherN + ' other' : '')));
    // Last 24 h: checks counted on the same extended beat the strips draw, so a missed close counts as soon as it is late.
    let ot = 0, sl = 0, rn = 0;
    for (const A of on) {
      const bk = COMP.beat24(A.beat, { bar: barS(A), lim: limOf(A.sb), now });
      if (bk) { rn++; ot += bk.on; sl += bk.slots; }
      else if (isObj(A.last24)) { rn++; ot += num(A.last24.on_time) || 0; sl += num(A.last24.slots) || 0; }
    }
    const rep = on.filter(A => isObj(A.last24)), sum = f => rep.reduce((a, A) => a + (num(A.last24[f]) || 0), 0);
    const behind = rep.filter(A => /^(late|stale)$/.test((sts[A.id].K || {}).phase)).map(lastT).filter(t => t != null);
    const c2 = rn ? kpi('Last 24 h', esc(fmt.int(ot) + ' of ' + fmt.int(sl)),
      esc('checks on time' + (rep.length ? ' · ' + fmt.int(sum('signals')) + ' signals · ' + fmt.int(sum('bought')) + ' bought · ' + fmt.int(sum('sold')) + ' sold' : '')
        + (behind.length ? ' · as of ' + fmt.when(Math.min(...behind)) : '') + (rn < on.length ? ' · ' + rn + ' of ' + on.length + ' bots reporting' : '')))
      : kpi('Last 24 h', '—', 'after the next check');
    // Open: positions and carry pairs side by side, never summed; a row with no kind is in neither (§3.9).
    const kd = on.filter(A => A.kind), posN = kd.filter(A => A.kind !== 'carry').reduce((a, A) => a + (num(A.n_open) || 0), 0);
    const pairs = kd.filter(A => A.kind === 'carry'), pairN = pairs.reduce((a, A) => a + (num(A.carry && A.carry.pairs) ?? num(A.n_open) ?? 0), 0);
    const inN = kd.filter(A => (num(A.n_open) || 0) > 0).length;
    const c3 = kpi('Open', esc(fmt.int(posN) + (pairs.length ? ' · ' + fmt.int(pairN) : '')),
      esc((posN === 1 ? 'position' : 'positions') + (pairs.length ? ' · ' + (pairN === 1 ? 'carry pair' : 'carry pairs') : '') + ' · in ' + word.plural(inN, 'bot') + (kd.length < on.length ? ' · ' + kd.length + ' of ' + on.length + ' bots reporting' : '')));
    const T = X && X.fleet && X.fleet.totals, pp = T && T.paper, lv = T && T.live;
    const c4 = pp ? kpi('Fleet (paper)', esc(fmt.pct(pp.ret_pct)), esc('drawdown ' + fmt.pctu(pp.dd_pct, 2) + ' · lab, as of ' + fmt.when(isoS(X.gen))) + (lv ? '<span class="fl-kl">' + esc('live ' + fmt.pct(lv.ret_pct) + ' · drawdown ' + fmt.pctu(lv.dd_pct, 2)) + '</span>' : ''), fmt.cls(pp.ret_pct))
      : kpi('Fleet (paper)', '—', 'the lab hasn’t published');
    return '<div class="fl-kpis">' + c1 + c2 + c3 + c4 + '</div>';
  }
  function ymdS(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() / 1000) : null; }
  function pill(cls, html) { return '<span class="pill ' + cls + ' fl-sw">' + html + '</span>'; }
  function nextOf(sts) {
    let best = null;
    for (const A of active()) { const K = sts[A.id].K; if (!K || K.next == null || !/^(countdown|due)$/.test(K.phase)) continue; if (!best || K.next < best.K.next) best = { A, K }; }
    return best;
  }
  function tickText(nx) {
    if (!nx) return 'Next check —';
    const K = clock(rowBundle(nx.A)), now = nowS();
    return 'Next check: ' + nm(nx.A) + (K.next > now ? ' ≈ ' + fmt.time(K.next) + ' · in ' + fmt.cd(K.next - now) : ' due now');
  }
  function pillsHtml(sm) {
    const e = E(), X = fxNow(), fl = isObj(e.fleet) ? e.fleet : null, host = isObj(e.host) ? e.host : null, now = nowS();
    const kill = !fl ? pill('mute', 'Kill switch —') : fl.halt ? pill('bad', 'Fleet halted') : pill('good', 'Fleet running');
    const rg = X && X.regime;
    const mkt = rg && rg.now ? pill(rg.now === 'bull' ? 'good' : rg.now === 'crisis' ? 'bad' : 'warn', 'Market: ' + esc(rg.now) + (rg.since ? ' since ' + esc(fmt.md(ymdS(rg.since))) : '') + ' · lab') : pill('mute', 'Market —');
    let srv = pill('mute', 'Server —');
    if (host) {
      const t = isoS(host.t), fails = num(host.fails) || 0, gap = t != null ? now - t : null;
      const base = esc(hostName(host)) + ' · ';
      srv = fails >= 2 ? pill('bad', base + fails + ' failed runs in a row')
        : fails === 1 ? pill('warn', base + '1 failed run')
        : gap != null && gap > 75 * 60 ? pill('warn', base + 'no tick for ' + esc(fmt.age(gap)))
        : pill(t != null ? 'good' : 'mute', base + 'last tick ' + esc(t != null ? fmt.time(t) : '—'));
    }
    const tk = '<span class="pill fl-sw fl-next" id="fl-next">' + esc(tickText(nextOf(sm.sts))) + '</span>';
    return '<div class="fl-pills">' + kill + mkt + srv + tk + '</div>';
  }
  function headHtml(sm, rise) {
    return '<section class="card fl-head' + rise + '" aria-labelledby="fl-hh"><h2 class="vh" id="fl-hh">Fleet status</h2>'
      + '<div class="fl-hv" id="fl-hv">' + verdictHtml(sm) + '</div><div id="fl-hk">' + kpisHtml(sm) + '</div><div id="fl-hp">' + pillsHtml(sm) + '</div></section>';
  }
  function needsHtml(sm) {
    const X = fxNow(), items = sm.items.map(x => ({ lvl: x.lvl, h: '<a class="fl-ny" href="' + esc(href(x.A, 'overview')) + '"><i class="dot ' + DOTC[x.lvl] + '"></i><span class="fl-nyt"><b>' + esc(nm(x.A)) + '</b> · ' + flat(x.it.sentence) + '</span><span class="fl-go">Open ›</span></a>' }));
    for (const s of arr(X && X.shortlist)) if (s && s.ready) items.push({ lvl: 'info', h: '<button type="button" class="fl-ny" data-sheet="shortlist"><i class="dot due"></i><span class="fl-nyt">Decision for you: <b>' + esc(s.name || s.agent) + '</b> is ready to go live</span><span class="fl-go">›</span></button>' });
    if (!items.length) return '';
    return '<section class="fl-needs" aria-label="Needs you">' + items.slice(0, 4).map(i => i.h).join('')
      + (items.length > 4 ? '<button type="button" class="fl-more" data-sheet="fleethealth">and ' + (items.length - 4) + ' more ›</button>' : '') + '</section>';
  }

  // ================================================================================== the tiles ==
  function actWords(a) {
    if (!isObj(a)) return null;
    const cs = arr(a.cs).filter(Boolean), more = (num(a.n) || cs.length) - cs.length, list = cs.join(', ') + (more > 0 ? ' +' + more : '');
    switch (a.ty) {
      case 'bought': return 'Bought ' + list;
      case 'sold': return 'Sold ' + list + (num(a.R) != null ? ' ' + fmt.R(a.R) : '');
      case 'resized': return 'Resized ' + list + (num(a.cap_pct) != null ? ' to ' + fmt.num(a.cap_pct, 0) + '% of pot' : '');
      case 'carry_in': return 'Started collecting on ' + list;
      case 'carry_out': return 'Started closing ' + list;
      case 'carry_closed': return 'Closed ' + list + ' carry' + (num(a.cap_pct) != null ? ' · ' + fmt.pct(a.cap_pct) + ' of capital' : '');
      default: return a.ty ? cap1(String(a.ty)) + ' ' + list : list;
    }
  }
  function lastTrade(A, now) {
    if (A.act === undefined || (!A.sb && !A.act)) return { h: '<span class="fl-lt">—</span>', a: 'last trade not in this data' };
    if (A.act === null) return { h: '<span class="fl-lt"><i class="fl-ad"></i>No trades yet</span>', a: 'no trades yet' };
    const w = actWords(A.act), t = num(A.act.t), hot = t != null && now - t < D;
    return { h: '<span class="fl-lt"><i class="fl-ad' + (hot ? ' on' : '') + '"></i>' + esc(w) + (t != null ? ' · ' + esc(fmt.when(t)) : '') + '</span>', a: 'last: ' + w };
  }
  function cell(k, v, sub, cls) { return '<span class="fl-st"><span class="fl-sk">' + esc(k) + '</span><b class="fl-sv' + (cls ? ' ' + cls : '') + '">' + v + '</b>' + (sub ? '<span class="fl-ss">' + sub + '</span>' : '') + '</span>'; }
  function stats(A, now) {
    const rec = isObj(A.rec) ? A.rec : {}, kind = A.kind;
    // A v1 row (no kind): neutral cells, never a signal trader's R or a pair counted as a position (§3.9).
    if (!kind) return { h: cell('Trades', na(true)) + cell('Open', na(true)) + cell('Detail', na(true)), a: 'details after its next check' };
    if (kind === 'carry') {
      const c = isObj(A.carry) ? A.carry : null;
      if (!c) return { h: cell('Pairs', na(true)) + cell('Funding kept', na(true)) + cell('Capital in use', na(true)), a: 'carry details after the next check' };
      const young = num(A.since) == null || now - A.since < 14 * D, cp = num(c.capture_pct), gate = num(c.gate_pct) ?? 80;
      const sub1 = [num(c.exiting) ? c.exiting + ' closing' : '', num(c.stuck) ? c.stuck + ' evening legs' : ''].filter(Boolean).join(' · ');
      const sub2 = young ? 'too early' : cp != null && cp < gate ? '<span class="fl-amb">below ' + esc(gate) + '% gate</span>' : 'of what it could earn';
      return { h: cell('Pairs', esc(fmt.int(c.pairs)), esc(sub1)) + cell('Funding kept', cp == null ? na(true) : esc(fmt.int(cp) + '%'), sub2) + cell('Capital in use', num(c.cap_pct) == null ? na(true) : esc(fmt.int(c.cap_pct) + '%'), 'of pot'),
               a: fmt.int(c.pairs) + ' pairs, funding kept ' + (cp == null ? 'unknown' : cp + '% of what it could earn') + (young ? ' (too early to judge)' : '') + ', capital in use ' + fmt.int(c.cap_pct) + '% of pot' };
    }
    if (kind === 'target') {
      const held = arr(A.held), ar = arenaOf(A), n = num(rec.n);
      const tks = esc(held.slice(0, 3).join(', ') + (held.length > 3 ? ' +' + (held.length - 3) : ''));   // 3 tickers never fit a cell: "3 coins" + the list
      const hv = A.held === undefined ? na(true) : held.length > 2 ? esc(word.plural(held.length, 'coin')) : held.length ? tks : 'Nothing';
      const sub = A.arena ? (ar && ar.day != null ? 'day ' + ar.day + (ar.of ? ' of ' + ar.of : '') : 'in the arena') : 'judged yearly';
      return { h: cell('Holding', hv, held.length > 2 ? tks : '') + cell('Invested', num(A.deployed_pct) == null ? na(true) : esc(fmt.int(A.deployed_pct) + '%'), num(A.deployed_pct) == null ? '' : 'of pot') + cell('Closed trades', n == null ? na(true) : esc(fmt.int(n)), esc(sub)),
               a: 'holding ' + (held.length ? held.join(', ') : 'nothing') + ', ' + (num(A.deployed_pct) == null ? '' : fmt.int(A.deployed_pct) + '% of pot invested') };
    }
    const n = num(rec.n), w = num(rec.w), l = num(rec.l), open = num(A.n_open) || 0;
    const won = !n || w == null ? na(true) : esc(fmt.int(w) + ' of ' + fmt.int(n));
    return { h: cell('Trades', n == null ? na(true) : esc(fmt.int(n)), 'closed') + cell('Won', won, n && l != null ? esc(fmt.int(l) + ' lost') : '')
               + cell('Holding', open ? esc(word.plural(open, 'coin')) : 'Nothing', open && num(rec.open_R) != null ? '<span class="' + fmt.cls(rec.open_R) + '">' + esc(fmt.R(rec.open_R)) + '</span> open' : ''),
             a: (n == null ? '' : word.plural(n, 'trade') + (n && w != null ? ', ' + w + ' won, ' + l + ' lost' : '')) };
  }
  function modePill(A) {
    const m = A.sb && isObj(A.sb.mode) ? A.sb.mode : null;
    if (m && m.req && m.eff && m.req !== m.eff) return '<span class="pill warn">Paper (live requested)</span>';
    return (A.mode || (m && m.eff)) === 'live' ? '<span class="pill live">Live</span>' : '<span class="pill pt">Paper</span>';
  }
  function typeChip(A) {
    let t = word.kindName(A.kind, barS(A));
    if (A.arena) { const ar = arenaOf(A); t += ' · Arena' + (ar && ar.day != null ? ' day ' + ar.day + (ar.of ? ' of ' + ar.of : '') : ''); }
    return '<span class="fl-ty">' + esc(t) + '</span>';
  }
  function statusHtml(A, st) {
    const K = st.K || {}, lt = lastT(A);
    let rest = '';
    if (st.v1) rest = ' <span class="fl-sr">' + esc(st.wide) + '</span>';
    else if (st.lvl === 'ok') rest = ' <span class="fl-sr">· checked <span data-ago="' + lt + '">' + esc(fmt.ago(lt)) + '</span>' + (K.next != null ? ' · next ≈ ' + esc(fmt.time(K.next)) : '') + '</span>';
    else if (st.k === 'stale') rest = ' <span class="fl-sr">· no check for ' + esc(fmt.age(K.age)) + '</span>';
    else if (st.head && st.head.wide) rest = ' <span class="fl-sr">' + esc(st.head.wide) + '</span>';      // without the "pushed …" trail
    return '<span class="fl-status"><i class="dot ' + (DOTC[st.lvl] || 'mute') + '"></i><b class="fl-sw0">' + esc(st.word) + '</b>' + rest + '</span>';
  }
  function bigHtml(A, now, st) {
    const p = num(A.pot_chg_pct), since = num(A.since);
    const v = '<span class="fl-bigl">' + (p == null ? na(true) : '<b class="fl-big ' + fmt.cls(p) + '" data-fl-big="' + p + '">' + esc(fmt.pct(p)) + '</b>' + (fmt.cls(p) ? '' : '<span class="fl-flat">flat</span>')) + '</span>';
    let cap = 'since ' + (since != null ? esc(fmt.md(since)) : '—');
    if (since != null && now - since >= 7 * D && num(A.wk_pct) != null) cap += ' · this week ' + esc(fmt.pct(A.wk_pct));
    if (st.k === 'stale' && lastT(A) != null) cap += ' · as of ' + esc(fmt.when(lastT(A)));
    const sp = A.spark === undefined ? '' : COMP.sparkSvg(A.spark, { w: 140, h: 40 });
    return '<span class="fl-num"><span class="fl-bigw">' + v + '<span class="fl-cap">' + cap + '</span></span><span class="fl-spw">' + sp + '</span></span>';
  }
  function tileCls(st) { return 'fl-tile fl-' + (st.lvl || 'mute') + (st.k === 'stale' ? ' fl-stale' : ''); }
  function ariaOf(A, st, now, s, lt) {
    const p = num(A.pot_chg_pct), K = st.K || {};
    const parts = [nm(A) + ', ' + plain(word.kindName(A.kind, barS(A))).replace(' · ', ', ').toLowerCase() + ', ' + ((A.mode === 'live') ? 'live' : 'paper') + '.'];
    parts.push(st.word + (st.lvl === 'ok' && lastT(A) != null ? ', checked ' + fmt.ago(lastT(A)) + (K.next != null ? ', next about ' + fmt.time(K.next) : '') : st.wide ? ', ' + plain(st.wide).replace(/^·\s*/, '') : '') + '.');
    if (p != null) parts.push('Pot ' + (fmt.cls(p) === 'pos' ? 'up ' : fmt.cls(p) === 'neg' ? 'down ' : 'flat at ') + fmt.pctu(p, 2) + (num(A.since) != null ? ' since ' + fmt.md(A.since) : '') + '.');
    if (s.a) parts.push(cap1(s.a) + '.');
    if (lt.a) parts.push(cap1(lt.a) + '.');
    return parts.join(' ').replace(/−/g, 'minus ');
  }
  function tileInner(A, st, now, o) {
    const s = stats(A, now), lt = lastTrade(A, now), K = st.K || {}, lim = limOf(A.sb);
    const strip = COMP.beatStrip(A.beat, { bar: barS(A), lim, nextT: K.next, fresh: o && o.fresh });
    const prob = (st.lvl === 'warn' || st.lvl === 'bad') && !st.v1 ? '<span class="fl-prob">' + esc(plain(tail(st.head ? st.head.sentence : st.sentence))) + '</span>' : '';
    return { a: ariaOf(A, st, now, s, lt), h: '<span class="fl-r1"><b class="fl-name">' + esc(nm(A)) + '</b>' + typeChip(A) + modePill(A) + '</span>'
      + statusHtml(A, st) + bigHtml(A, now, st) + '<span class="fl-stats">' + s.h + '</span>' + '<span class="fl-hbw">' + strip + '</span>' + lt.h + prob };
  }
  function compactInner(A, st, now) {
    const p = num(A.pot_chg_pct), lt = lastTrade(A, now), lim = limOf(A.sb);
    return '<i class="dot ' + (DOTC[st.lvl] || 'mute') + '"></i><b class="fl-name">' + esc(nm(A)) + '</b><span class="fl-cw">' + esc(st.word) + '</span>'
      + '<span class="fl-cp ' + fmt.cls(p) + '">' + (p == null ? '—' : esc(fmt.pct(p))) + '</span>' + lt.h
      + '<span class="fl-micro">' + COMP.beatStrip(A.beat, { bar: barS(A), lim, nextT: (st.K || {}).next }) + '</span>';
  }
  function tileHtml(A, st, now, dense, rise) {
    if (dense) return '<a class="' + tileCls(st) + ' fl-compact' + rise + '" id="fl-' + esc(A.id) + '" data-id="' + esc(A.id) + '" href="' + esc(href(A)) + '" aria-label="' + esc(nm(A) + ', ' + st.word) + '">' + compactInner(A, st, now) + '</a>';
    const t = tileInner(A, st, now);
    return '<a class="' + tileCls(st) + rise + '" id="fl-' + esc(A.id) + '" data-id="' + esc(A.id) + '" href="' + esc(href(A)) + '" aria-label="' + esc(t.a) + '">' + t.h + '</a>';
  }
  function waitingTile(id) {
    return '<a class="fl-tile fl-mute fl-wait" href="' + esc(botHref(id)) + '" data-id="' + esc(id) + '"><span class="fl-r1"><b class="fl-name">' + esc(id) + '</b></span><span class="fl-status"><i class="dot mute"></i><b class="fl-sw0">Waiting for its first check</b></span></a>';
  }

  // ===================================================================== sort, filter, compact ==
  const pref = (k, d, ok) => { const v = lsGet(k, d); return ok(v) ? v : d; };
  const sortOf = () => pref('ex.fl.sort', 'roster', v => SORTS.some(x => x[0] === v));
  const filtOf = () => pref('ex.fl.f', 'all', v => FILTERS.some(x => x[0] === v));
  function denseOf() {
    const n = active().length; if (n < 9) return false;
    const v = lsGet('ex.fl.dense', null);
    return typeof v === 'boolean' ? v : PHONE.matches;
  }
  const match = (A, f) => f === 'all' || (f === 'live' ? A.mode === 'live' : f === 'arena' ? !!A.arena : (A.kind || 'flip') === f);
  function computeOrder(sts) {
    const ord = orderIdx(), by = sortOf(), list = active().slice();
    const r = A => ord[A.id];
    const cmp = {
      roster: (a, b) => r(a) - r(b),
      attention: (a, b) => RANK[sts[a.id].lvl] - RANK[sts[b.id].lvl] || (a.mode === 'live' ? 0 : 1) - (b.mode === 'live' ? 0 : 1) || r(a) - r(b),
      return: (a, b) => { const x = num(a.pot_chg_pct), y = num(b.pot_chg_pct); return (x == null) - (y == null) || (y ?? 0) - (x ?? 0) || r(a) - r(b); },
      active: (a, b) => { const t = A => isObj(A.last24) ? (num(A.last24.bought) || 0) + (num(A.last24.sold) || 0) : 0; return t(b) - t(a) || arr(b.recent).length - arr(a.recent).length || r(a) - r(b); },
    }[by];
    F.order = list.sort(cmp).map(A => A.id);
  }
  function controlsHtml() {
    const n = active().length, by = sortOf(), f = filtOf(), dense = denseOf();
    let h = '<div class="fl-ctl"><div class="seg quiet fl-sort" role="group" aria-label="Sort the bots" data-mask><span class="ind"></span>'
      + SORTS.map(([k, w]) => '<button type="button" data-v="' + k + '" data-fl-sort="' + k + '" aria-pressed="' + (by === k) + '">' + w + '</button>').join('') + '</div>';
    if (n >= 7) {
      const cnt = k => active().filter(A => match(A, k)).length;
      h += '<div class="fchips fl-chips" role="group" aria-label="Show">' + FILTERS.filter(([k]) => k === 'all' || cnt(k) > 0)
        .map(([k, w]) => '<button type="button" class="fchip" data-fl-f="' + k + '" aria-pressed="' + (f === k) + '">' + w + ' <span class="fl-cn">' + cnt(k) + '</span></button>').join('') + '</div>';
    }
    if (n >= 9) h += '<button type="button" class="btn small ghost fl-dense" data-fl-dense aria-pressed="' + dense + '">Compact</button>';
    return h + '</div>';
  }
  function gridHtml(sts, now, rise) {
    const f = active().length >= 7 ? filtOf() : 'all', dense = denseOf(), byId = {};
    for (const A of rows()) byId[A.id] = A;
    if (!F.order) computeOrder(sts);
    const ids = F.order.filter(id => byId[id] && byId[id].enabled !== false);
    for (const A of active()) if (ids.indexOf(A.id) < 0) ids.push(A.id);   // a bot that arrived since the order was set goes last
    const shown = ids.filter(id => match(byId[id], f));
    let i = 0;
    const tiles = shown.map(id => tileHtml(byId[id], sts[id], now, dense, i++ < 12 ? rise : '')).join('');
    const wait = orderOf(E()).filter(id => !byId[id]).map(waitingTile).join('');
    let h = '<div class="fl-grid' + (dense ? ' fl-dense' : '') + '" id="fl-grid">' + (tiles || (f !== 'all' ? '' : '')) + wait + '</div>';
    if (!shown.length && f !== 'all') h = '<div class="card fl-none"><div class="empty">No bot matches “' + esc((FILTERS.find(x => x[0] === f) || [])[1] || f) + '”. <button type="button" class="btn small ghost" data-fl-f="all">Show all ›</button></div></div>';
    const ret = rows().filter(A => A.enabled === false);
    if (ret.length) h += '<details class="disc fl-ret"><summary>Retired (' + ret.length + ')</summary><div class="body fl-grid">'
      + ret.map(A => '<a class="fl-tile fl-mute fl-retired" href="' + esc(href(A)) + '" data-id="' + esc(A.id) + '"><span class="fl-r1"><b class="fl-name">' + esc(nm(A)) + '</b>' + typeChip(A) + '</span><span class="fl-status"><i class="dot mute"></i><b class="fl-sw0">Retired</b></span></a>').join('') + '</div></details>';
    return h;
  }

  // ============================================================================== the fleet log ==
  function logRows() {
    const out = [];
    for (const A of rows()) for (const e of arr(A.recent)) if (Array.isArray(e) && num(e[0]) != null) out.push({ A, e });
    out.sort((x, y) => y.e[0] - x.e[0]);
    const merged = [];
    for (const x of out) {                                            // consecutive trail rows, same bot and coin: one row
      const p = merged[merged.length - 1];
      if (p && x.e[1] === 'trail' && p.e[1] === 'trail' && p.A.id === x.A.id && p.e[2] === x.e[2]) { p.n++; p.t0 = x.e[0]; continue; }
      // one bot's entries of one kind within a minute are one row: "Bought LTC, NEAR, UNI"
      if (p && /^(bought|carry_in|carry_out)$/.test(x.e[1]) && p.e[1] === x.e[1] && p.A.id === x.A.id && Math.abs(p.e[0] - x.e[0]) <= 60) { p.cs.push(x.e[2]); continue; }
      merged.push({ A: x.A, e: x.e, n: 1, t0: x.e[0], cs: [x.e[2]] });
    }
    return merged;
  }
  function logText(x) {
    if (x.n > 1) return '<span class="tk">' + esc(x.e[2]) + '</span> stop raised ' + x.n + '× since ' + esc(fmt.when(x.t0)) + (num(x.e[7]) != null ? ', ' + (rz(x.e[7], 2) < 0 ? 'still risks ' : 'locks ') + '<span class="' + fmt.cls(x.e[7]) + '">' + esc(fmt.R(x.e[7])) + '</span>' : '');
    if (x.cs.length > 1) { const cs = x.cs.filter(Boolean).sort().map(c => '<span class="tk">' + esc(c) + '</span>').join(', ');
      return ({ bought: 'Bought ', carry_in: 'Started collecting on ', carry_out: 'Started closing ' })[x.e[1]] + cs; }
    return flat(word.event(x.e).html);
  }
  function digest(list, seen) {
    const nw = list.filter(x => x.e[0] > seen); if (!nw.length) return '';
    const cut = rows().some(A => { const r = arr(A.recent); return r.length && Math.min(...r.map(e => num(e[0]) || Infinity)) > seen; });
    const plus = cut ? '+' : '', coins = l => [...new Set(l.map(x => x.e[2]).filter(Boolean))].slice(0, 3).join(', ');
    const tr = nw.filter(x => x.e[1] === 'trail'), bo = nw.filter(x => x.e[1] === 'bought'), so = nw.filter(x => x.e[1] === 'sold');
    const parts = [];                                                 // a collapsed run of raises on one coin counts once
    if (tr.length) parts.push(tr.length + plus + ' stop' + (tr.length === 1 && !plus ? '' : 's') + ' raised (' + coins(tr) + ')');
    if (bo.length || so.length) { if (bo.length) parts.push('bought ' + coins(bo)); if (so.length) parts.push('sold ' + coins(so)); }
    else parts.push('nothing bought or sold');
    const other = nw.length - tr.length - bo.length - so.length;
    if (other > 0) parts.splice(parts.length - 1, 0, word.plural(other, 'other event') + plus);
    return '<p class="fl-dig">Since ' + esc(fmt.when(seen)) + ': ' + esc(parts.join(' · ')) + '</p>';
  }
  function logHtml(rise, prevTop) {
    const list = logRows().slice(0, 10), seen = F.seen0;
    let h = '<section class="card fl-log' + rise + '" id="fl-log"><div class="head"><div class="ttl"><h2>What just happened</h2><span class="sub">every bot, newest first</span></div></div>';
    if (!list.length) return h + '<div class="empty">Nothing traded in the last week.</div></section>';
    if (seen > 0) h += digest(list, seen);
    h += '<ol class="fl-lg">';
    let div = seen > 0 && list[0].e[0] > seen;
    for (const x of list) {
      if (div && x.e[0] <= seen) { h += '<li class="fl-new" role="separator" aria-label="New since you last looked above"><span>new</span></li>'; div = false; }
      const acted = ACTED.has(x.e[1]), enter = prevTop != null && x.e[0] > prevTop ? ' rise' : '';
      h += '<li class="fl-lr' + enter + '"><a href="' + esc(href(x.A, 'activity/timeline')) + '"><i class="fl-ld' + (acted ? ' on' : '') + '"></i><span class="fl-lb">' + esc(nm(x.A)) + '</span>'
        + '<span class="fl-lw">' + esc(fmt.when(x.e[0])) + '</span><span class="fl-lx">' + logText(x) + '</span></a></li>';
    }
    return h + '</ol></section>';
  }
  function markSeen() {
    clearTimeout(F.seenT);
    F.seenT = setTimeout(() => {
      if (document.hidden || PAGE !== 'fleet') return;
      const top = logRows().reduce((m, x) => Math.max(m, x.e[0]), 0);
      if (top > (Number(lsGet('ex.fl.seen', 0)) || 0)) lsSet('ex.fl.seen', top);
    }, 5000);
  }

  // ==================================================================================== the Lab ==
  function labHtml() {
    const X = fxNow();
    if (!X) return '<section class="fl-lab"><span>AiFi Lab · <span class="sub">not published yet</span></span></section>';
    const L = X.lab || {}, sl = arr(X.shortlist);
    return '<section class="fl-lab"><span><b>AiFi Lab</b> · ' + esc([fmt.int(L.tried || 0) + ' recipes tried', fmt.int(L.survivors || 0) + ' survived', sl.length + ' in the arena', sl.filter(s => s && s.ready).length + ' ready for you'].join(' · ')) + '</span>'
      + '<span class="fl-labb"><button type="button" class="btn small" data-sheet="shortlist">Shortlist</button><button type="button" class="btn small" data-sheet="fleet">Fleet split</button></span></section>';
  }

  // =================================================================================== the view ==
  COMP.fleetLoading = function () {
    const n = Math.max(1, Math.min(24, Number(lsGet('ex.fl.n', 6)) || 6));
    const k = kpi('Bots', '—', '') + kpi('Last 24 h', '—', '') + kpi('Open', '—', '') + kpi('Fleet (paper)', '—', '');
    return '<section class="card fl-head"><div class="fl-verdict"><span class="pill big mute">Checking…</span></div><div class="fl-kpis">' + k + '</div></section>'
      + '<div class="fl-grid">' + Array.from({ length: n }, () => '<div class="fl-tile fl-mute fl-load"><span class="fl-status"><i class="dot mute"></i><b class="fl-sw0">Loading…</b></span></div>').join('') + '</div>';
  };
  function render(root, why) {
    if (PAGE !== 'fleet' || !S.E) return '';
    F.root = root;
    if (!F.fx) loadFactory().then(X => { if (X && F.fx !== X) { F.fx = X; paintParts(); } });
    if (why === 'arrival' && $('#fl-grid', root) && arrive(root)) return;
    const now = nowS(), sm = summary(now), rise = why === 'route' ? ' rise' : '';
    if (why === 'route' || !F.order) computeOrder(sm.sts);
    lsSet('ex.fl.n', active().length);
    if (!rows().length) return '<div class="card fl-empty' + rise + '"><div class="empty">No bot has reported yet. Each bot appears here after its first check.</div></div><div id="fl-labw">' + labHtml() + '</div>';
    F.gens = {}; F.acts = {}; F.big = {};
    for (const A of rows()) { F.gens[A.id] = A.gen; F.acts[A.id] = A.act && A.act.t; F.big[A.id] = num(A.pot_chg_pct); }
    F.logTop = logRows().reduce((m, x) => Math.max(m, x.e[0]), 0);
    return '<div class="fl">' + headHtml(sm, rise) + '<div id="fl-ny">' + needsHtml(sm) + '</div>' + controlsHtml() + gridHtml(sm.sts, now, rise)
      + '<div id="fl-logw">' + logHtml(rise, null) + '</div><div id="fl-labw">' + labHtml() + '</div></div>';
  }
  // A recorded check arrived (a row's gen changed): that tile updates in place (one border pulse, a count-up of a
  // changed big number, the new bead grows), new log rows rise, one toast. Tiles never reorder (§3.4, §7).
  function arrive(root) {
    const now = nowS(), sm = summary(now), grid = $('#fl-grid', root), dense = denseOf();
    const have = new Set($$('[data-id]', grid).map(el => el.dataset.id)), want = active().map(A => A.id);
    if (want.some(id => !have.has(id))) return false;               // a new bot: a full render, the others keep their order
    let checked = 0, traded = 0, who = null;
    for (const A of active()) {
      const el = document.getElementById('fl-' + A.id); if (!el || !grid.contains(el)) continue;
      const changed = F.gens[A.id] !== A.gen, st = sm.sts[A.id];
      if (!changed) continue;
      checked++; who = A;
      const at = A.act && A.act.t; if (at && at !== F.acts[A.id]) traded++;
      // paintParts below must see this tile as current, or it rewrites it and kills the grow and the count-up (§7)
      if (dense) el.innerHTML = el._h = compactInner(A, st, now);
      else { const t = tileInner(A, st, now, { fresh: true }); el.innerHTML = t.h; el.setAttribute('aria-label', t.a); el._k = tileInner(A, st, now).h; }
      el.className = tileCls(st) + (dense ? ' fl-compact' : '');
      if (!reduced && !document.hidden) { el.classList.remove('pulse1'); void el.offsetWidth; el.classList.add('pulse1'); }
      const big = $('[data-fl-big]', el), to = num(A.pot_chg_pct), from = F.big[A.id];
      if (big && to != null && from != null && Math.abs(to - from) >= 0.005) countUp(big, to, { from, ms: 600, fmt: v => fmt.pct(v) });
      F.gens[A.id] = A.gen; F.acts[A.id] = at; F.big[A.id] = to;
    }
    paintParts(sm);
    const lw = $('#fl-logw', root), top = F.logTop;
    if (lw) { lw.innerHTML = logHtml('', top); F.logTop = logRows().reduce((m, x) => Math.max(m, x.e[0]), 0); }
    if (checked) toast(checked === 1 ? esc(nm(who)) + ' checked · ' + (traded ? 'traded' : 'nothing traded') : checked + ' bots checked · ' + (traded ? word.plural(traded, 'trade') : 'nothing traded'));
    return true;
  }
  // The parts that follow the real clock (the 30 s tick) and a landed envelope: header, Needs-you, every tile's status
  // line, problem line, edge and heartbeat. Each writes only when its html changed.
  function put(el, h) { if (el && el._h !== h) { el.innerHTML = h; el._h = h; } }
  function paintParts(sm) {
    const root = F.root; if (!root || !root.isConnected || PAGE !== 'fleet' || !S.E) return;
    const now = nowS(); sm = sm || summary(now);
    put($('#fl-hv', root), verdictHtml(sm)); put($('#fl-hk', root), kpisHtml(sm)); put($('#fl-hp', root), pillsHtml(sm));
    put($('#fl-ny', root), needsHtml(sm)); put($('#fl-labw', root), labHtml());
    bindTicker(root, sm);
    const dense = denseOf();
    for (const A of active()) {
      const el = document.getElementById('fl-' + A.id); if (!el || !root.contains(el)) continue;
      const st = sm.sts[A.id], cls = tileCls(st) + (dense ? ' fl-compact' : '');
      if (dense) { put(el, compactInner(A, st, now)); }
      else {
        const t = tileInner(A, st, now), key = t.h;
        if (el._k !== key) { el.innerHTML = t.h; el._k = key; el.setAttribute('aria-label', t.a); }
      }
      if (el.className.replace(/\s*(rise|pulse1)\b/g, '') !== cls) el.className = cls;
    }
  }
  function bindTicker(root, sm) {
    const el = $('#fl-next', root); if (!el || el._bound) return;
    el._bound = true;
    every1s(el, () => { const t = tickText(nextOf(statuses())); if (el.textContent !== t) el.textContent = t; });
  }
  function afterView(root) {
    F.root = root;
    bindTicker(root);
    initSegs(root);
    const onClick = e => {
      const t = e.target instanceof Element ? e.target : null; if (!t || e.button > 0) return;
      let el;
      if ((el = t.closest('[data-fl-sort]'))) { e.preventDefault(); lsSet('ex.fl.sort', el.dataset.flSort); F.order = null; redraw(); return; }
      if ((el = t.closest('[data-fl-f]'))) { e.preventDefault(); lsSet('ex.fl.f', el.dataset.flF); redraw(); return; }
      if ((el = t.closest('[data-fl-dense]'))) { e.preventDefault(); lsSet('ex.fl.dense', !denseOf()); redraw(); return; }
      if ((el = t.closest('[data-fl-go]'))) { const x = document.getElementById('fl-' + el.dataset.flGo); if (x) { e.preventDefault(); into(x, true); try { x.focus({ preventScroll: true }); } catch (_) {} } return; }
    };
    root.addEventListener('click', onClick);
    if (F.first) { F.first = false; restore(root, false); }
    markSeen();
    return () => { root.removeEventListener('click', onClick); };
  }
  // Coming back from a bot page (§2.4): a fresh load jumps to the saved scroll; either way the last-opened tile gets a
  // one-time identity outline, then the keys are cleared.
  function restore(root, persisted) {
    ssSet('ex.fl.from', null);
    const y = Number(ssGet('ex.fl.y')), id = ssGet('ex.fl.last');
    if (!persisted && isFinite(y) && ssGet('ex.fl.y') != null) jump(y);
    if (id) {
      const el = document.getElementById('fl-' + id);
      if (el) { el.style.viewTransitionName = ''; el.classList.add('fl-back'); setTimeout(() => el.classList.remove('fl-back'), 1200); }
    }
    ssSet('ex.fl.y', null); ssSet('ex.fl.last', null);
  }
  VIEWS.fleet = { title: 'Command center', render, after: afterView, leave() { clearTimeout(F.seenT); } };

  if (PAGE === 'fleet') {
    hook('tick30s', () => paintParts());
    hook('agents', () => { loadFactory().then(X => { if (X !== F.fx) { F.fx = X; if (F.root) paintParts(); } }); });
    hook('show', () => {                                              // back to visible: the order may be recomputed
      if (!S.E || !F.root) return;
      const before = (F.order || []).join(), sm = summary(); computeOrder(sm.sts);
      if (F.order.join() !== before) redraw();
      markSeen();
    });
    hook('hide', () => clearTimeout(F.seenT));
    // Any way into a bot (tile, Needs-you, log row, roster, a sheet's "Open bot ›") saves the way back (§2.4), so
    // "All bots" is history.back() to this scroll. A modified click opens a new tab: nothing to restore.
    document.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null, el = t && t.closest('a[href^="/?a="]');
      if (!el || el.target || e.defaultPrevented || e.button > 0 || mods(e)) return;
      ssSet('ex.fl.from', '1'); ssSet('ex.fl.y', Math.round(scrollY)); ssSet('ex.fl.last', new URLSearchParams(el.getAttribute('href').split('#')[0].slice(1)).get('a'));
      if (el.matches('a.fl-tile')) el.style.viewTransitionName = 'bot-hero';
    });
    addEventListener('pageshow', e => { if (e.persisted && F.root) restore(F.root, true); });
  }

  // ======================================================================== the fleet health sheet ==
  SHEETS.fleethealth = function () {
    const x = ['<h2>Fleet health</h2>'];
    if (!S.E) return x.concat('<p class="note">' + (S.net === 'offline' ? 'Can’t reach the dashboard right now.' : 'No data yet.') + '</p>').join('');
    const sm = summary(), groups = { bad: [], warn: [], info: [] }, calm = [];
    for (const A of active()) {
      const st = sm.sts[A.id], its = (st.items || []).filter(i => groups[i.lvl]);
      if (!its.length) calm.push(A);
      for (const it of its) groups[it.lvl].push({ A, it });
    }
    const GT = { bad: 'Needs you', warn: 'To check', info: 'Notes' };
    for (const l of ['bad', 'warn', 'info']) if (groups[l].length)
      x.push('<div class="sec"><h3>' + GT[l] + '</h3><div class="alerts">' + groups[l].map(g => banner(l, '<b>' + esc(nm(g.A)) + '</b> · ' + flat(g.it.sentence), { label: 'Open bot ›', href: href(g.A, 'overview') })).join('') + '</div></div>');
    if (!groups.bad.length && !groups.warn.length && !groups.info.length) x.push('<p class="note">Nothing needs you.</p>');
    if (calm.length) x.push('<p class="note">' + esc(calm.map(nm).join(', ')) + ': nothing to report.</p>');
    const g = isoS(E().gen);
    x.push('<div class="pn"><span class="sub">' + (g != null ? 'Fleet data pushed ' + esc(fmt.when(g)) + ' · ' : '') + 'A tap on the status also checks for new data.</span><button class="btn small" type="button" data-refresh>Refresh</button></div>');
    return x.join('');
  };
}
