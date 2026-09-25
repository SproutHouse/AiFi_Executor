// cloud/ui/now.js — the Now tab, mission control (spec §4.2–§4.4, §4.6–§4.8). See cloud/ui/README.md.
// Exports VIEWS.now and COMP.onDeck(el, opts). The alert rail (§4.1) is core's. The cycle clock (COMP.dial) and the
// Gate Run (COMP.gateRun) belong to other modules and are reached only through guarded lookups at render time, with
// quiet placeholders while they are absent. Every section renders through its own try/catch, so one bad field
// draws one small card, never a blank tab.
{
  // ------------------------------------------------------------------------------------------ helpers --
  const arr = v => (Array.isArray(v) ? v : null);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const effM = b => (modeOf(b).eff === 'live' ? 'l' : 'p');
  const effRuns = b => runsOf(b).filter(r => r && num(r.t) != null && (!r.m || r.m === effM(b)));
  const evsOf = b => (arr(b && b.events) ? b.events.filter(e => Array.isArray(e) && num(e[0]) != null) : null);
  const lvOf = e => num(e[5]) || 0;
  const r2 = x => (Math.abs(x) < 0.005 ? 0 : x);
  // a cap-style percentage: "0", "2.5", "3.78" (no trailing zeros), for "0% of 4% at risk"
  const trim = v => {
    const x = num(v); if (x == null) return '—';
    const r = Math.round(x * 100) / 100;
    return fmt.num(r, Math.abs(r * 10 - Math.round(r * 10)) > 1e-9 ? 2 : Math.abs(r - Math.round(r)) > 1e-9 ? 1 : 0);
  };
  const endDot = h => (/[.!?]$/.test(String(h).replace(/<[^>]*>/g, '').trim()) ? h : h + '.');
  const SIGT = new Set(['blocked', 'recorded', 'proposed', 'bought', 'notfilled']);      // trigger events, one per signal
  const ACTED = new Set(['bought', 'sold', 'trail']);                                     // "the bot acted": solid accent
  const WARNT = new Set(['blocked', 'late', 'gap', 'thr_half', 'entry_failed', 'not_on_exchange', 'notfilled']);
  const RANK = ['failed', 'halt', 'thr_halt', 'recon', 'no_stop', 'close_failed', 'exit_failed', 'fallback', 'sold', 'bought', 'trail',
    'blocked', 'notfilled', 'gap', 'entry_failed', 'not_on_exchange', 'thr_half', 'regime', 'late', 'recorded', 'proposed', 'expired',
    'resume', 'sweep', 'review', 'board'];
  const rank = ty => { const i = RANK.indexOf(ty); return i < 0 ? 99 : i; };
  const MERGE = new Set(['recorded', 'proposed', 'expired', 'blocked']);
  const mergeKey = e => (MERGE.has(e[1]) && e[2] ? [e[0], e[1], e[3], e[4], e[1] === 'blocked' ? e[6] : ''].join('|') : null);
  const byNew = (a, c) => c[0] - a[0] || lvOf(c) - lvOf(a) || rank(a[1]) - rank(c[1]) || String(mergeKey(a)).localeCompare(String(mergeKey(c)));
  // Section wrapper: a throw draws a small card that keeps its grid area (§3.3 resilience).
  function sec(fn, name, cls) {
    try { return fn() || ''; }
    catch (e) { report(e, name); return '<section class="card ' + cls + '"><div class="empty"><b>' + esc(name) + '</b> · This panel couldn’t be drawn from this data.</div></section>'; }
  }
  function safeTxt(fn) { try { return fn() || ''; } catch (e) { report(e, 'Now'); return ''; } }

  // "Since you last looked" (§4.2c): localStorage ex.seen = {t: newest run t seen, at: when}.
  const SEEN = 'ex.seen';
  function seenOf() { const s = obj(lsGet(SEEN, null)); return s && num(s.t) != null ? { t: num(s.t), at: num(s.at) } : null; }
  function markSeen() {
    const lr = lastRun(); if (!lr) return;
    const cur = seenOf();
    if (!cur || cur.t < lr.t) lsSet(SEEN, { t: lr.t, at: nowS() });
    $$('#now-latest .nw-nd').forEach(d => d.classList.add('gone'));
  }

  // ---------------------------------------------------------------------------------- (a) verdict --
  const PILL = { ok: 'ok', info: 'info', warn: 'warn', bad: 'bad' };
  function metaLine(b, K) {
    if (!K || K.lastT == null) return 'No check yet';
    const last = stateOf(b).last || {}, lr = lastRun(b);
    const lm = last.late_min != null ? last.late_min : lr ? lr.lm : null;
    let s = 'Last check ' + esc(fmt.when(K.lastT));
    if (last.failed) s += ' · stopped early';
    else if (lm != null) s += ' · ' + esc(lm) + ' min after the close' + (last.fresh === false ? ', buys skipped' : '');
    return s;
  }
  // The pill carries the bold verdict word of the §3.2 sentence ("All clear"); the sentence keeps the rest.
  function verdictInner(b) {
    const st = S.st && S.b === b ? S.st : status(b);
    let pill = esc(st.word), rest = st.sentence || '';
    const m = /^\s*<b>([\s\S]*?)<\/b>\s*(?:·\s*|:\s*)?([\s\S]*)$/.exec(rest);
    if (m) { const w = m[1].replace(/<[^>]*>/g, '').trim(); if (w && w.length <= 18) { pill = w; rest = m[2]; } }
    return '<div class="nw-vl"><span class="pill big ' + (PILL[st.lvl] || 'info') + '">' + pill + '</span> <span class="nw-vs">' + rest + '</span></div>'
      + '<div class="nw-vm">' + metaLine(b, st.K) + '</div>';
  }

  // ----------------------------------------------------------------------------------- (b) moment --
  // The highest-level event of the last 24 h (ties: the most recent), plus a "since then" line from names[c].
  const NOWV = {
    vol: n => (num(n.vx) != null ? 'volume now ' + fmt.x(n.vx) + ' the minimum' : ''),
    oi: n => (num(n.ox) != null ? 'open interest now ' + fmt.x(n.ox) + ' the minimum' : ''),
    fund: n => (num(n.fund) != null ? 'funding now ' + fmt.fund(n.fund) : ''),
    days: n => (num(n.days) != null ? fmt.int(n.days) + ' days of history now' : ''),
  };
  function sinceThen(b, e) {
    const t = e[0], ty = e[1], c = e[2];
    if (c) {
      const n = (arr(b.names) || []).find(x => x && x.c === c);
      if (!n) return '';
      const parts = [], trig = SIGT.has(ty);
      if (n.grp === 'held' || n.st === 'h') parts.push('held now');
      else {
        const tf = [], d = num(n.dist) != null ? ', ' + word.dist(n.dist) : '';
        if (n.w === 0) tf.push('weekly turned bearish'); else if (n.d === 0) tf.push('daily turned bearish');
        if (n.h4 === 1) tf.push('4-hour ' + (trig ? 'still ' : '') + 'bullish' + d);
        else if (n.h4 === 0) tf.push('4-hour ' + (trig ? 'back to ' : '') + 'bearish' + d);
        if (tf.length) parts.push(tf.join(', '));
      }
      if (ty === 'blocked') {
        const now = word.codes(e[6]).map(([code]) => (NOWV[code] ? NOWV[code](n) : '')).filter(Boolean);
        if (now.length) parts.push(now.join(', '));
      }
      return parts.length ? esc(parts.join('; ')) + '.' : '';
    }
    const later = effRuns(b).filter(r => r.t > t);
    if (!later.length) return '';
    const bad = later.filter(r => r.x).length, late = later.filter(r => !r.x && !r.ok).length;
    return esc(word.plural(later.length, 'check') + (bad || late ? ' (' + [bad ? bad + ' failed' : '', late ? late + ' ran late' : ''].filter(Boolean).join(', ') + ')' : ', all on time')) + '.';
  }
  function momentHtml(b) {
    const E = evsOf(b); if (!E) return '';
    const now = nowS();
    let best = null;
    for (const e of E.slice().sort(byNew)) { if (lvOf(e) < 1 || e[0] < now - 86400) continue; if (!best || lvOf(e) > lvOf(best)) best = e; }
    if (!best) return '';
    const t = best[0], w = word.event(best), run = runAt(t, b), when = esc(fmt.when(t));
    const head = run ? '<button type="button" class="nw-mt hit" data-cursor="' + t + '" data-scroll aria-label="Replay the ' + when + ' check">' + when + '</button>' : '<b>' + when + '</b>';
    const then = safeTxt(() => sinceThen(b, best));
    return '<div class="nw-mo"' + (run ? ' data-cursor="' + t + '" data-scroll' : '') + '><div class="nw-cl">' + head + ' · ' + endDot(w.html) + '</div>'
      + (then ? '<div class="nw-cl nw-then"><b>Since then:</b> ' + then + '</div>' : '') + '</div>';
  }

  // ------------------------------------------------------------------------ (c) since you last looked --
  const coins = list => { const u = [...new Set(list.map(e => e[2]).filter(Boolean))]; return u.length ? u.slice(0, 4).join(', ') + (u.length > 4 ? ' +' + (u.length - 4) : '') : ''; };
  function sinceHtml(b, ctx) {
    if (!arr(b.runs)) return '<div class="nw-si">Recorded checks: ' + na() + '</div>';
    const rs = effRuns(b), lr = lastRun(b); if (!lr) return '';
    const seen = ctx.seen;
    if (!seen) {
      const first = rs[0] || lr;
      return '<div class="nw-si"><span>First look: ' + esc(word.plural(rs.length || 1, 'check')) + ' since ' + esc(fmt.when(first.t)) + '.</span></div>';
    }
    const E = (evsOf(b) || []).filter(e => e[0] > seen.t).sort(byNew);
    const nr = rs.filter(r => r.t > seen.t), sold = E.filter(e => e[1] === 'sold' && e[2]);
    if (!nr.length && !sold.length) return '';
    const parts = [];
    if (nr.length) {
      parts.push(word.plural(nr.length, 'new check'));
      const sig = E.filter(e => SIGT.has(e[1])), cs = coins(sig);
      parts.push(sig.length ? word.plural(sig.length, 'signal') + (cs ? ' (' + cs + ')' : '') : 'no signals');
      const bo = E.filter(e => e[1] === 'bought');
      parts.push(bo.length ? 'bought ' + coins(bo) : 'nothing bought');
      const f = nr.filter(r => r.x).length, l = nr.filter(r => !r.x && !r.ok).length;
      if (f) parts.push(f + ' failed');
      if (l) parts.push(l + ' ran late');
    }
    let h = '<div class="nw-si">';
    if (parts.length) h += '<a class="nw-sl" href="#activity/timeline">Since ' + esc(fmt.when(seen.at != null ? seen.at : seen.t)) + ': ' + esc(parts.join(' · ')) + ' <span aria-hidden="true">›</span></a>';
    if (sold.length) h += '<div class="nw-sold">Sold since you last looked: ' + sold.map(e => chip(e[2], e[0]) + ' <span class="' + fmt.cls(e[7]) + '">' + esc(fmt.R(e[7])) + '</span> (' + esc(word.exit(e[6])) + ')').join(', ') + '</div>';
    return h + '</div>';
  }

  // ------------------------------------------------------------------------------ (d) the dial host --
  // COMP.dial(el) owns the cycle clock. Until it exists, a static placeholder shows the phase and the countdown text.
  function dialText(K) {
    const lagTo = K.rng ? K.rng[1] : Math.round(K.lag);
    switch (K.phase) {
      case 'countdown': return { cls: 'cd', eb: 'Next check', main: fmt.cd(K.toNext), sub: '≈ ' + fmt.time(K.next) };
      case 'due': return { cls: 'due', eb: 'Due now', main: fmt.over(K.now - K.next), sub: 'usually by ' + fmt.time(K.C + lagTo * 60) };
      case 'late': return { cls: 'late', eb: 'Late', main: fmt.age(K.now - K.C), sub: 'buys skipped after ' + fmt.time(K.lateAt) };
      case 'stale': return { cls: 'stale', eb: 'No check', main: fmt.age(K.age), sub: '' };
      default: {
        const now = nowS(); let nx = Math.floor(now / BAR) * BAR + 1200; if (nx <= now) nx += BAR;
        return { cls: 'cd', eb: 'First check', main: fmt.cd(nx - now), sub: '≈ ' + fmt.time(nx) };
      }
    }
  }
  function dialPH(b) {
    const K = clock(b), d = dialText(K);
    return '<div class="nw-dph ' + d.cls + '" data-ph="' + K.phase + '" role="img" aria-label="' + esc(d.eb + ' ' + d.main + (d.sub ? ', ' + d.sub : '')) + '">'
      + '<div class="nw-dc"><span class="nw-de">' + esc(d.eb) + '</span><b class="nw-cd">' + esc(d.main) + '</b>' + (d.sub ? '<span class="nw-ds">' + esc(d.sub) + '</span>' : '') + '</div></div>';
  }
  function mountDial(host) {
    if (typeof COMP.dial === 'function') {
      let r;
      try { r = COMP.dial(host); }
      catch (e) { report(e, 'Cycle clock'); host.innerHTML = '<div class="empty">The cycle clock couldn’t be drawn from this data.</div>'; return null; }
      if (typeof r === 'string' && r) host.innerHTML = r;
      return typeof r === 'function' ? r : r && typeof r.destroy === 'function' ? () => r.destroy() : null;
    }
    host.innerHTML = dialPH(S.b);
    const cd = $('.nw-cd', host);
    if (cd) every1s(cd, () => {
      const ph = host.firstElementChild; if (!ph || !S.b) return;
      const K = clock(S.b);
      if (ph.dataset.ph !== K.phase) { mountDial(host); return; }
      const v = dialText(K).main;
      if (cd.firstChild) { if (cd.firstChild.nodeValue !== v) cd.firstChild.nodeValue = v; } else cd.textContent = v;
    });
    return null;
  }

  // -------------------------------------------------------------------------------- (e) the brief --
  function bi(href, k, dot, v, s) {
    return '<a class="bi" href="' + href + '"><span class="bk">' + k + '</span><span class="bv"><i class="dot ' + dot + '"></i><span class="nw-bvt">' + v + '</span></span><span class="bs">' + s + '</span></a>';
  }
  function cell(f, b, href, k) { try { return f(b); } catch (e) { report(e, 'Brief ' + k); return bi(href, k, 'mute', na(true), MISSING); } }
  function resultCell(b) {
    const rec = obj(b.rec), pot = obj(b.pot) || {}, pos = arr(b.pos) || [], live = modeOf(b).eff === 'live', g = obj(b.cfg && b.cfg.gates) || {};
    if (!rec) return bi('#results', 'Result', 'mute', na(true), MISSING);
    const n = num(rec.n) || 0, noPct = live && pot.net === false;
    if (!n && !pos.length) {
      const p = num(pot.chg_pct);
      const v = p == null || noPct ? na(true) : esc(r2(p) ? fmt.pct(p) : '+' + fmt.num(0, 2) + '%');     // neutral "+0.00%" at zero
      return bi('#results', 'Result', 'mute', (live ? 'Live ' : 'Paper ') + v, esc(word.plural(0, 'trade') + ' · ' + fmt.num(num(rec.tot_R) || 0, 2) + ' R'));
    }
    const tot = num(rec.tot_R), c = fmt.cls(tot), s = [];
    if (!noPct && num(pot.chg_pct) != null) s.push(fmt.pct(pot.chg_pct) + ' of pot');
    s.push(word.plural(n, 'trade') + (num(g.n) != null && n < g.n ? ' (n ' + n + ' of ' + g.n + ')' : ''));
    return bi('#results', 'Result', c === 'pos' ? 'ok' : c === 'neg' ? 'bad' : 'mute', '<span class="' + c + '">' + esc(fmt.R(tot)) + '</span>', esc(s.join(' · ')));
  }
  function buyingCell(b) {
    const st = stateOf(b) || {}, th = obj(st.thr) || {}, h = obj(st.halt) || {}, btc = obj(st.btc) || {}, auto = arr(b.cfg && b.cfg.auto);
    let dot = 'ok', v = 'Allowed';
    if (h.set) { dot = 'bad'; v = 'Halted'; }
    else if (th.state === 'halted') { dot = 'bad'; v = 'Stopped'; }
    else if (th.state === 'halved') { dot = 'gap'; v = 'Risk halved'; }
    else if (th.state !== 'normal') { dot = 'mute'; v = 'Unknown'; }
    else if (btc.w !== 1 || (auto && !auto.length)) { dot = 'mute'; v = 'No auto buys'; }
    const dd = num(th.dd_pct);
    const s = 'Bitcoin weekly ' + word.dir(btc.w) + ' · ' + (th.state == null || th.state === 'unknown' ? 'throttle unknown' : 'drawdown ' + (dd != null ? fmt.pctu(dd, 1) : '—'));
    return bi('#positions', 'Buying', dot, esc(v), esc(s));
  }
  function exposureCell(b) {
    const r = obj(b.risk); if (!r) return bi('#positions', 'Exposure', 'mute', na(true), MISSING);
    const n = num(r.n_open) ?? (arr(b.pos) || []).length, mx = num(r.max), openR = num((obj(b.rec) || {}).open_R);
    const v = n ? esc(n + ' open · ') + '<span class="' + fmt.cls(openR) + '">' + esc(fmt.R(openR)) + '</span>' : 'Flat';
    const free = mx != null ? Math.max(0, mx - n) : null, used = num(r.used_pct), cap = num(r.cap_pct);
    const s = trim(used) + '% of ' + trim(cap) + '% at risk' + (free != null ? ' · ' + word.plural(free, 'slot') + ' free' : '');
    // the dot speaks for risk in use against the open-risk cap: within it, near it (≥90%), or over it
    const dot = !n ? 'mute' : used == null || cap == null ? 'mute' : used > cap ? 'bad' : used >= cap * 0.9 ? 'gap' : 'ok';
    return bi('#positions', 'Exposure', dot, v, esc(s));
  }
  function last24Cell(b) {
    const L = obj(b.last24); if (!L) return bi('#activity', 'Last 24 h', 'mute', na(true), MISSING);
    const slots = num(L.slots) || 0, f = num(L.failed) || 0, l = num(L.late) || 0, m = num(L.missed) || 0;
    const v = word.plural(num(L.signals) || 0, 'signal').replace(' ', '\u00a0') + ' · ' + fmt.int(num(L.bought) || 0) + '\u00a0bought';   // wraps only at the ·
    const s = slots ? fmt.int(num(L.on_time) || 0) + ' of ' + word.plural(slots, 'check') + ' on time' + (l ? ' · ' + l + ' late' : '') + (m ? ' · ' + m + ' missed' : '') + (f ? ' · ' + f + ' failed' : '') : 'no checks due yet';
    return bi('#activity', 'Last 24 h', f ? 'bad' : l || m ? 'gap' : slots ? 'ok' : 'mute', esc(v), esc(s));
  }
  function briefHtml(b) {
    return '<div class="cq nw-bw"><nav class="brief nw-brief" aria-label="Brief">'
      + cell(resultCell, b, '#results', 'Result') + cell(buyingCell, b, '#positions', 'Buying')
      + cell(exposureCell, b, '#positions', 'Exposure') + cell(last24Cell, b, '#activity', 'Last 24 h') + '</nav></div>';
  }

  function missionHtml(b, ctx) {
    return '<section class="card mission nw-mission' + ctx.rise + '" aria-labelledby="nw-mh"><h2 class="vh" id="nw-mh">Status</h2><div class="nw-mg">'
      + '<div class="nw-v" id="nw-verdict">' + verdictInner(b) + '</div>'
      + safeTxt(() => momentHtml(b)) + safeTxt(() => sinceHtml(b, ctx))
      + '<div class="nw-dialw" id="now-dial">' + (typeof COMP.dial === 'function' ? '' : dialPH(b)) + '</div>'
      + briefHtml(b) + '</div></section>';
  }

  // ---------------------------------------------------------------------------------- §4.3 Holding --
  function ladder(p) {
    const rn = num(p.r_now), rl = num(p.r_lock), vs = [-1, 0, 1];
    if (rn != null) vs.push(rn);
    if (rl != null) vs.push(rl);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
    const X = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%', W = v => (Math.abs(v) / (hi - lo) * 100).toFixed(2) + '%';
    let h = '';
    if (rl != null) h += rl >= 0 ? '<i class="lk" style="left:' + X(0) + ';width:' + W(rl) + '"></i>' : '<i class="rk" style="left:' + X(rl) + ';width:' + W(rl) + '"></i>';
    h += '<i class="t0" style="left:' + X(-1) + '"></i><i class="te" style="left:' + X(0) + '"></i>';
    if (rl != null) h += '<i class="ts' + (rl >= 0 ? ' up' : '') + '" style="left:' + X(rl) + '"></i>';
    if (rn != null) h += '<i class="bd" style="left:' + X(rn) + '"></i>';
    return '<span class="nw-lad" aria-hidden="true">' + h + '</span>';
  }
  function holdRow(p) {
    const rn = num(p.r_now), rl = num(p.r_lock), ts = num(p.to_stop_pct), tin = num(p.t_in), sub = [];
    sub.push(ts == null ? 'no mark in this check' : ts < 0 ? 'at or through the stop; checked next cycle' : word.dist(ts, true));
    if (rl != null) sub.push((r2(rl) < 0 ? 'still risks ' : 'locks ') + fmt.R(rl));
    if (tin != null) sub.push(fmt.age(nowS() - tin));
    const label = p.c + ', open ' + fmt.R(rn) + ', ' + sub.join(', ') + '. Opens the position.';
    return '<button type="button" class="nw-hr" data-pos="' + esc(p.id) + '" aria-label="' + esc(label) + '"><span class="tk nw-hc">' + esc(p.c) + '</span>'
      + ladder(p) + '<span class="nw-hR ' + fmt.cls(rn) + '">' + esc(fmt.R(rn)) + '</span><span class="nw-hs">' + esc(sub.join(' · ')) + '</span></button>';
  }
  function holdingHtml(b, ctx) {
    const P = (arr(b.pos) || []).filter(obj);
    if (!P.length) return '';
    const asOf = num(P[0].as_of) ?? (clockOf(b) || {}).last_t;
    return '<section class="card nw-hold' + ctx.rise + '" id="now-holding"><div class="head"><div class="ttl"><h2>Holding' + tip('openR') + '</h2><span class="sub">marks at ' + esc(fmt.when(asOf)) + '</span></div>'
      + '<div class="acts"><a class="btn small ghost" href="#positions">All positions ›</a></div></div>'
      + '<div class="nw-holds">' + P.slice(0, 6).map(holdRow).join('') + '</div>'
      + (P.length > 6 ? '<p class="note">' + esc('+' + (P.length - 6) + ' more on Positions') + '</p>' : '') + '</section>';
  }

  // ------------------------------------------------------------------------ §4.4 Pot and shakedown --
  function spark(pot) {
    const pts = (arr(pot.spark) || []).filter(p => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null).map(p => [num(p[0]), num(p[1])]);
    if (pts.length < 2) return '<p class="note">The line appears after two checks.</p>';
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0], vs = pts.map(p => p[1]);
    const mn = Math.min(...vs), mx = Math.max(...vs);
    // zero stays on the scale (a neutral line at exactly 0) unless it is more than twice the line's own span away;
    // then the line is zoomed and a caption says where the scale runs
    const zoom = (mn > 0 || mx < 0) && Math.min(Math.abs(mn), Math.abs(mx)) > 2 * Math.max(mx - mn, 1e-9);
    let lo = zoom ? mn : Math.min(0, mn), hi = zoom ? mx : Math.max(0, mx);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = t => ((t - t0) / Math.max(1, t1 - t0) * 100).toFixed(2), Y = v => ((hi - v) / (hi - lo) * 100).toFixed(2);
    const last = pts[pts.length - 1][1];
    return '<div class="nw-spark"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="' + esc('Pot over the last ' + pts.length + ' checks, from ' + fmt.pct(pts[0][1]) + ' to ' + fmt.pct(last) + ' of the starting pot') + '">'
      + (zoom ? '' : '<line class="z" x1="0" x2="100" y1="' + Y(0) + '" y2="' + Y(0) + '"/>') + '<polyline class="ln" points="' + pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ') + '"/></svg></div>'
      + '<div class="nw-spl"><span>' + esc(fmt.when(t0)) + '</span><span>now ' + esc(fmt.pct(last)) + '</span></div>'
      + (zoom ? '<p class="cap nw-scale">' + esc('Scale ' + fmt.pct(mn) + ' to ' + fmt.pct(mx) + ' of the starting pot; zero is below the line.').replace('below', mx < 0 ? 'above' : 'below') + '</p>' : '');
  }
  function potHtml(b, ctx) {
    const rec = obj(b.rec) || {}, pot = obj(b.pot) || {}, live = modeOf(b).eff === 'live', g = obj(b.cfg && b.cfg.gates) || {}, o = obj(b.origin) || {};
    const tot = num(rec.tot_R), noPct = live && pot.net === false, rel = num(rec.rel_R_avg), nr = num(rec.n_rel);
    const title = live ? 'Pot · live since ' + (num(o.t) != null ? fmt.md(o.t) : '—') : 'Paper pot';
    let h = '<section class="card nw-pot' + ctx.rise + '" id="now-pot"><div class="head"><div class="ttl"><h2>' + esc(title) + '</h2></div>'
      + (live ? '' : '<div class="acts"><button type="button" class="pill pt nw-pp hit" data-g="paper" aria-label="Paper: what is paper mode?">Paper</button></div>') + '</div>';
    h += '<div class="nw-pr"><b class="nw-R ' + fmt.cls(tot) + '" data-r="' + (tot == null ? '' : tot) + '">' + esc(fmt.R(tot)) + '</b>'
      + '<span class="sub">closed ' + esc(fmt.Rn(rec.closed_R)) + ' · open ' + esc(fmt.Rn(rec.open_R)) + '</span></div>';
    h += '<p class="nw-pl">' + (noPct ? 'Pot % appears once deposits are recorded.' : esc(fmt.pct(pot.chg_pct) + ' of pot · this week ' + fmt.pct(pot.wk_chg_pct))) + '</p>';
    h += '<p class="nw-pl">vs holding ' + (rel == null ? na() : '<span class="' + fmt.cls(rel) + '">' + esc(fmt.R(rel)) + '</span> per trade'
      + (nr != null ? ' (n ' + esc(fmt.int(nr)) + (num(g.n) != null && nr < g.n ? ' of ' + esc(g.n) : '') + ')' : '')) + tip('vsHolding') + '</p>';
    if (!noPct) h += spark(pot);
    return h + '</section>';
  }
  // The flat pot dot-line: one dot per recorded check on a dashed zero line, time-scaled to now; the line breaks
  // at missed slots, late runs are amber and failed ones red.
  function dotLine(b, origin) {
    const rs = effRuns(b), now = nowS();
    if (!rs.length) return '';
    const t0 = origin != null && origin >= rs[0].t - BAR ? Math.min(origin, rs[0].t) : rs[0].t;
    const span = Math.max(1, now - t0), X = t => Math.max(0, Math.min(100, (t - t0) / span * 100));
    const have = new Set(rs.map(r => num(r.s) ?? Math.floor(r.t / BAR) * BAR)), miss = [];
    for (let s = Math.floor(t0 / BAR) * BAR + BAR; s + BAR <= now; s += BAR) if (!have.has(s)) miss.push(s);
    const segs = []; let a = 0;
    for (const s of miss) { const x1 = X(s), x2 = X(s + BAR); if (x1 > a) segs.push([a, x1]); a = Math.max(a, x2); }
    if (a < 100) segs.push([a, 100]);
    const late = rs.filter(r => !r.x && !r.ok).length, fail = rs.filter(r => r.x).length;
    const lbl = word.plural(rs.length, 'check') + ' since ' + fmt.when(t0) + (late ? ', ' + late + ' ran late' : '') + (fail ? ', ' + fail + ' failed' : '') + (miss.length ? ', ' + miss.length + ' missed' : '') + '. Result 0 R: no trades yet.';
    const lag = (num((clockOf(b) || {}).lag_med_min) || 20) * 60;
    return '<div class="nw-dl" role="img" aria-label="' + esc(lbl) + '">'
      + segs.map(([x1, x2]) => '<i class="sg" style="left:' + x1.toFixed(2) + '%;width:' + (x2 - x1).toFixed(2) + '%"></i>').join('')
      + miss.map(s => '<i class="d miss" style="left:' + X(s + lag).toFixed(2) + '%"></i>').join('')
      + rs.map(r => '<i class="d' + (r.x ? ' fail' : !r.ok ? ' late' : '') + '" style="left:' + X(r.t).toFixed(2) + '%"></i>').join('') + '</div>'
      + '<div class="nw-spl"><span>' + esc(fmt.when(t0)) + '</span><span>now</span></div>'
      + '<p class="cap">Each dot is a check on the zero line' + (late ? '; amber ran late' : '') + (fail ? '; red stopped early' : '') + (miss.length ? '; a break is a missed check' : '') + '.</p>';
  }
  const autoTxt = f => { const a = num(f.auto) || 0, ba = num(f.blocked_auto) || 0; return word.plural(a, 'auto grade') + (a && ba === a ? ' (blocked)' : a && ba ? ' (' + ba + ' blocked)' : ''); };
  function shakedownHtml(b, ctx) {
    const o = obj(b.origin) || {}, rs = effRuns(b), f = obj(b.funnel && b.funnel.all), rec = obj(b.rec) || {}, g = obj(b.cfg && b.cfg.gates) || {}, live = modeOf(b).eff === 'live';
    const t0 = num(o.t) ?? (rs[0] ? rs[0].t : null);
    const inWin = rs.length && t0 != null && t0 >= rs[0].t - 60;
    const nChecks = inWin ? rs.length : num((obj(b.pot) || {}).n_pts);
    let h = '<section class="card nw-pot nw-shk' + ctx.rise + '" id="now-pot"><div class="head"><div class="ttl"><h2>' + (live ? 'Live shakedown' : 'Paper shakedown') + '</h2>'
      + '<span class="sub">' + (t0 != null ? 'since ' + esc(fmt.stamp(t0)) : na()) + (nChecks != null ? ' · ' + esc(word.plural(nChecks, 'check')) : '') + '</span></div>'
      + (live ? '' : '<div class="acts"><button type="button" class="pill pt nw-pp hit" data-g="paper" aria-label="Paper: what is paper mode?">Paper</button></div>') + '</div>';
    h += '<p class="nw-nums">' + (f ? esc([word.plural(num(f.checks) || 0, 'name check'), word.plural(num(f.signals) || 0, 'signal'), autoTxt(f), word.plural(num(rec.n) || 0, 'trade')].join(' · ')) : 'Funnel ' + na()) + '</p>';
    h += dotLine(b, t0);
    h += '<p class="nw-pl">The R line starts with the first trade.</p>';
    const n = num(rec.n), G = num(g.n);
    h += n == null || G == null ? '<div class="nw-gm"><span>Closed trades before any verdict: ' + na() + '</span></div>'
      : '<div class="nw-gm"><span>' + esc(fmt.int(n) + ' of ' + G + ' closed trades before any verdict') + '</span>'
      + '<div class="meter sx" role="img" aria-label="' + esc(n + ' of ' + G + ' closed trades') + '" style="--k:' + (G ? Math.min(1, n / G) : 0).toFixed(3) + '"><i></i></div></div>';
    h += '<p class="nw-go"><a class="hit" href="#results">What going live needs ›</a>' + tip('goLive') + '</p>';
    return h + '</section>';
  }

  // --------------------------------------------------------------------------------- §4.6 On deck --
  const TITLE = { sig: 'Signalled at this check', next: 'Could signal next', thin: 'Armed, too thin', run: 'Already running', notset: 'Not set up', held: 'Held', nodata: 'No data' };
  const HEAD_TIP = 'While a 4-hour cloud is bearish its line can only step down, so each figure is the most the next close must rise. Not a prediction. A signal still has to pass the safety checks and find a free slot.';
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
  const dirWords = it => 'weekly ' + word.dir(it.w) + ', daily ' + word.dir(it.d) + ', 4-hour ' + word.dir(it.h4);
  function wd3(it) {
    const c = (lab, v) => '<span class="' + (v === 1 ? 'up' : v === 0 ? 'dn' : 'na') + '"><i>' + lab + '</i><b>' + (v === 1 ? '▲' : v === 0 ? '▼' : '–') + '</b></span>';
    return '<span class="nw-wd3" role="img" aria-label="' + esc(dirWords(it)) + '">' + c('W', it.w) + c('D', it.d) + c('4h', it.h4) + '</span>';
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
      else { const ts = it.pos ? num(it.pos.to_stop_pct) : null; main = ts == null ? 'held' : ts < 0 ? 'at or through the stop' : word.dist(ts, true) + ' (4-hour line)'; }
    } else if (g === 'nodata') main = it.code === 'x' ? 'no market data' : it.code === '!' ? 'error reading' : it.code === 'n' ? '4-hour not ready' : 'no reading';
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
    let h = '<div class="head"><div class="ttl"><h2>On deck<button class="tip" type="button" data-tip="' + esc(HEAD_TIP) + '" aria-label="What is On deck?">?</button></h2>'
      + '<span class="sub">' + (M.asAt ? 'As at ' + esc(when) + ', recorded' : 'What the next 4-hour close could trigger') + '</span></div>';
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

  // ---------------------------------------------------------------------------------- §4.7 Latest --
  function latestItems(b, E) {
    const ev = E.filter(e => lvOf(e) >= 1).sort(byNew), rows = [];
    for (const e of ev) { const k = mergeKey(e), last = rows[rows.length - 1]; if (k && last && last.k === k) last.list.push(e); else rows.push({ t: e[0], k, list: [e] }); }
    const evT = new Set(ev.map(e => e[0]));
    const quiet = runsOf(b).filter(r => r && num(r.t) != null && !evT.has(r.t)).sort((a, c) => c.t - a.t);
    const board = {};
    for (const e of E) if (lvOf(e) < 1 && e[1] === 'board') (board[e[0]] = board[e[0]] || []).push(e);
    const out = [];
    let i = 0, j = 0, n = 0;
    while (n < 5 && (i < rows.length || j < quiet.length)) {
      const rt = i < rows.length ? rows[i].t : -Infinity, qt = j < quiet.length ? quiet[j].t : -Infinity;
      if (rt >= qt) { out.push(rows[i++]); n++; continue; }
      const r = quiet[j++], last = out[out.length - 1];
      if (last && last.q) last.runs.push(r); else out.push({ q: true, runs: [r] });
    }
    for (const it of out) if (it.q) it.board = [].concat(...it.runs.map(r => board[r.t] || []));
    return out;
  }
  function tcell(t, b) {
    const w = fmt.when(t), tm = fmt.time(t);
    const inner = esc(tm) + (w === tm ? '' : '<span>' + esc(w.indexOf(tm) >= 0 ? fmt.wd(t) : fmt.md(t)) + '</span>');
    return runAt(t, b) ? '<button type="button" class="nw-tm hit" data-cursor="' + t + '" data-scroll aria-label="Replay the ' + esc(w) + ' check">' + inner + '</button>' : '<span class="nw-tm">' + inner + '</span>';
  }
  function merged(list) {
    const e = list[0], chips = list.map(x => chip(x[2], x[0])).join(', '), ks = esc(word.kind(e[3]) + 's');
    switch (e[1]) {
      case 'recorded': return chips + ' ' + ks + ' recorded, ' + (e[4] === 'A' ? 'auto grade' : 'watch-only grade');
      case 'proposed': return chips + ' ' + ks + ' proposed (old approval model)';
      case 'expired': return chips + ' proposals expired (old approval model)';
      case 'blocked': {
        const rs = esc(word.reasons(word.codes(e[6]), true)) || 'a safety check';
        return e[4] === 'A' ? chips + ' would have bought (auto grade), blocked: ' + rs : chips + ' ' + ks + (e[4] === 'B' ? ' (watch-only)' : '') + ' blocked: ' + rs;
      }
    }
    return list.map(x => word.event(x).html).join('; ');
  }
  const newDot = '<span class="newdot nw-nd" role="img" aria-label="new"></span>';
  function evRow(row, b, ctx) {
    const e = row.list[0], w = word.event(e), lv = lvOf(e);
    const cls = ACTED.has(e[1]) ? 'act' : lv >= 3 ? 'bad' : WARNT.has(e[1]) ? 'warn' : '';
    const en = ctx.prevT != null && e[0] > ctx.prevT, nw = en || (ctx.seen != null && e[0] > ctx.seen.t);
    return '<li class="nw-row' + (en ? ' enter' : '') + '">' + tcell(e[0], b) + '<span class="nw-ic ' + cls + '">' + icon(w.ic) + '</span>'
      + '<div class="nw-tx"><div class="nw-s">' + (nw ? newDot : '') + (row.list.length > 1 ? merged(row.list) : w.html) + '</div></div></li>';
  }
  function foldRow(it, b, ctx) {
    const rs = it.runs, nwr = rs[0], od = rs[rs.length - 1], n = rs.length, bd = it.board || [];
    const txt = n === 1 ? '1 quiet check · ' + fmt.when(nwr.t) : n + ' quiet checks · ' + fmt.when(od.t) + ' → ' + fmt.when(nwr.t);
    const en = ctx.prevT != null && nwr.t > ctx.prevT;
    const subs = bd.slice(0, 3).map(e => '<div class="nw-sub' + (e[2] ? ' nw-subc' : '') + '">' + word.event(e).html + '</div>').join('')
      + (bd.length > 3 ? '<div class="nw-sub">' + esc('+' + (bd.length - 3) + ' more reading changes') + '</div>' : '');
    return '<li class="nw-row nw-q' + (en ? ' enter' : '') + '">' + tcell(nwr.t, b) + '<span class="nw-ic q">' + icon('ok') + '</span>'
      + '<div class="nw-tx"><div class="nw-s">' + (en ? newDot : '') + esc(txt) + '</div>' + subs + '</div></li>';
  }
  function latestHtml(b, ctx) {
    const E = evsOf(b);
    let h = '<section class="card nw-latest' + ctx.rise + '" id="now-latest"><div class="head"><div class="ttl"><h2>Latest</h2></div></div>';
    if (!E) return h + '<div class="empty">Events: ' + na() + '</div></section>';
    const items = latestItems(b, E);
    if (!items.length) return h + '<div class="empty">No events yet. The first check writes here.</div></section>';
    h += '<ol class="nw-tl">' + items.map(it => (it.q ? foldRow(it, b, ctx) : evRow(it, b, ctx))).join('') + '</ol>';
    return h + '<div class="nw-foot"><a class="hit" href="#activity">All activity ›</a></div></section>';
  }

  // ----------------------------------------------------------------------------- the Gate Run host --
  function gatePH(b) {
    const run = cursorRun(), lr = lastRun(b);
    if (!run) return '<div class="head"><div class="ttl"><h2>Last check</h2></div></div><div class="empty">The first check will be replayed here.</div>';
    const old = !!lr && run.t !== lr.t, c = arr(run.c), w = word.run(run);
    return '<div class="head"><div class="ttl"><h2>' + (old ? 'Check at ' + esc(fmt.when(run.t)) : 'Last check') + tip('gateRun') + '</h2>'
      + '<span class="sub">' + esc(fmt.when(run.t) + ' · ' + w.s) + '</span></div>'
      + (old ? '<div class="acts"><button type="button" class="btn small" data-cursor="">Back to latest</button></div>' : '') + '</div>'
      + '<p class="note">' + (c ? esc(word.plural(num(c[0]) || 0, 'name') + ' checked · ' + word.plural(num(c[1]) || 0, 'signal') + ' · ' + (num(c[4]) ? c[4] + ' bought' : 'nothing bought')) : 'Counts ' + na()) + '</p>';
  }
  // COMP.gateRun(host, null, opts) fills the card host and follows the shared cursor itself (it returns a controller
  // with run()); Now redraws the host only when the component did not follow a cursor move.
  let grCtl = null;
  function mountGate(host, o) {
    grCtl = null;
    if (typeof COMP.gateRun !== 'function') { host.innerHTML = gatePH(S.b); return; }
    let r;
    try { r = COMP.gateRun(host, null, Object.assign({ autoplay: true }, o || {})); }
    catch (e) { report(e, 'Gate Run'); host.innerHTML = '<div class="empty"><b>Gate Run</b> · This panel couldn’t be drawn from this data.</div>'; return; }
    if (typeof r === 'string' && r) host.innerHTML = r;
    else if (r && typeof r === 'object') grCtl = r;
  }
  function gateFollowed() {
    if (!grCtl || typeof grCtl.run !== 'function') return false;
    const a = grCtl.run(), c = cursorRun();
    return !!a && !!c && a.t === c.t;
  }

  // --------------------------------------------------------------------------- ex.seen watcher (§4.2c) --
  // ex.seen moves to the newest check once its Gate Run (cursor on the latest) or the first Latest row has been in
  // view for 3 s; the "new" dots then fade. The hide hook below covers "or on tab hide".
  function watchSeen(root) {
    const lr = lastRun();
    if (!lr || !('IntersectionObserver' in window)) return null;
    const cur = seenOf();
    if (cur && cur.t >= lr.t) return null;
    const targets = [document.getElementById('now-gaterun'), $('#now-latest .nw-row', root)].filter(Boolean);
    const vis = new Map();
    let timer = 0;
    const io = new IntersectionObserver(es => {
      for (const e of es) vis.set(e.target, e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= innerHeight * 0.4));
      let on = false;
      if (!document.hidden) vis.forEach((v, el) => { if (v && (el.id !== 'now-gaterun' || S.cursor == null)) on = true; });
      if (on && !timer) timer = setTimeout(() => { timer = 0; markSeen(); io.disconnect(); }, 3000);
      else if (!on && timer) { clearTimeout(timer); timer = 0; }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    targets.forEach(t => io.observe(t));
    return () => { io.disconnect(); clearTimeout(timer); };
  }
  // Pot total R counts up from the value last shown on this device, only when it changed (§13).
  function potCount(root) {
    const el = $('.nw-R', root); if (!el) return;
    const to = num(el.dataset.r); if (to == null) return;
    const from = num(lsGet('ex.nw.R', null));
    lsSet('ex.nw.R', to);
    if (from == null || Math.abs(from - to) < 0.005 || reduced || document.hidden) return;
    el.textContent = fmt.R(from);
    countUp(el, to, { from, fmt: v => fmt.R(v) });
  }

  // ------------------------------------------------------------------------------------ the view --
  // §4.8: phone, flat: mission → Gate Run → On deck → Shakedown → Latest; phone, holding or with trades: mission →
  // Holding → Pot → Gate Run → On deck → Latest. Desktop ≥1100: mission across, then two independent columns, Gate Run
  // and Latest | Holding, On deck and Pot or Shakedown, so neither column leaves a gap beside the other. The DOM is
  // built in the visual order for the width (reading and focus order match what is seen) and redrawn in place when
  // the width crosses 1100.
  const WIDE = matchMedia('(min-width:1100px)');
  let lastWhy = 'route';
  function render(root, why) {
    const b = S.b; if (!b) return '';
    lastWhy = why || 'route';
    const pos = (arr(b.pos) || []).filter(obj), rec = obj(b.rec) || {};
    const flat = !(num(rec.n) > 0) && !pos.length;
    const ctx = { rise: lastWhy === 'route' ? ' rise' : '', seen: seenOf(), prevT: lastWhy === 'arrival' && S.prev ? (lastRun(S.prev) || {}).t : null };
    const mission = sec(() => missionHtml(b, ctx), 'Mission', 'mission nw-mission');
    const hold = pos.length ? sec(() => holdingHtml(b, ctx), 'Holding', 'nw-hold') : '';
    const pot = flat ? sec(() => shakedownHtml(b, ctx), 'Shakedown', 'nw-pot') : sec(() => potHtml(b, ctx), 'Pot', 'nw-pot');
    const gate = '<section class="card nw-grh' + ctx.rise + '" id="now-gaterun"></section>';
    const deck = '<section class="card nw-od' + ctx.rise + '" id="now-ondeck">' + COMP.onDeck(null, { b }) + '</section>';
    const latest = sec(() => latestHtml(b, ctx), 'Latest', 'nw-latest');
    const cls = 'nw-now ' + (pos.length ? 'nw-h1' : 'nw-h0');
    if (WIDE.matches) return '<div class="' + cls + ' nw-cols">' + mission + '<div class="nw-col">' + gate + latest + '</div><div class="nw-col">' + hold + deck + pot + '</div></div>';
    return '<div class="' + cls + '">' + mission + hold + (flat ? '' : pot) + gate + deck + (flat ? pot : '') + latest + '</div>';
  }
  function after(root) {
    const clean = [];
    const dh = document.getElementById('now-dial');
    if (dh) clean.push(mountDial(dh));
    const gh = document.getElementById('now-gaterun');
    if (gh) mountGate(gh, { why: lastWhy });
    const v = document.getElementById('nw-verdict'); if (v) v._h = verdictInner(S.b);
    potCount(root);
    clean.push(watchSeen(root));
    return () => clean.forEach(f => { if (typeof f === 'function') call(f); });
  }
  VIEWS.now = { title: 'Now', render, after };
  const relayout = () => { if (S.tab !== 'now' || !S.b) return; const v = document.querySelector('#view > .nw-now'); if (v && v.classList.contains('nw-cols') !== WIDE.matches) redraw(); };
  if (WIDE.addEventListener) WIDE.addEventListener('change', relayout); else if (WIDE.addListener) WIDE.addListener(relayout);

  // The verdict follows the status engine: core's refreshShell() runs on the 30 s tick, on arrival, and the moment
  // the dial's 1 s tick sees the phase flip (countdown → due → late), so the verdict moves with the capsule.
  hook('status', () => {
    if (S.tab !== 'now' || !S.b) return;
    const v = document.getElementById('nw-verdict');
    if (v) { const h = verdictInner(S.b); if (v._h !== h) { v.innerHTML = h; v._h = h; } }
  });
  hook('hide', () => { if (S.tab === 'now' && S.b && document.getElementById('now-gaterun')) markSeen(); });
  // Cursor followers on Now: On deck switches to its as-at mode and the Gate Run host redraws for the cursor run.
  onCursor((t, prev, o) => {
    if (S.tab !== 'now' || !S.b) return;
    const od = document.getElementById('now-ondeck');
    if (od) COMP.onDeck(od, { at: t });
    const gr = document.getElementById('now-gaterun');
    if (gr && !gateFollowed()) mountGate(gr, { why: 'cursor', play: !!(o && o.explicit) && !(o && o.sheet === false) && !S.sheet });
  });
}
