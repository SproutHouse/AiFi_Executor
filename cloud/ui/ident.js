// ui/ident.js — each bot's abstract identity (COMMAND_CENTER_SPEC §3.12): its sigil (who it is: drawn from its rules
// only, so it never changes unless they do) and its constellation (what it holds now). Pure SVG + CSS; no library.
// Exports (all guarded by callers: COMP.x ? COMP.x(...) : ''):
//   COMP.identOf(x)        → {f, bar, n, k}: a row's `sig` (dashboard_push.sigil_of), else derived from a row or a bundle
//   COMP.sigil(x, o)       → svg html. o: {size, off (retired: grey, still), t (its last check: a faint tick when a
//                            newer one lands), cls}
//   COMP.holdOfRow(A)      → [{c, w, s}] from a row's `hold`, or null when the row predates it
//   COMP.holdOfBundle(b)   → [{c, w, s}] from a bundle's pos + carry
//   COMP.sky(hold, o)      → svg html, one star per holding. o: {key (stable per bot), f (family), mini}
//   COMP.skyWords(hold)    → the constellation in plain words (its caption and aria-label)
// Motion (spec §1 honesty: slow, real-clock, never a number): the sigil's ring turns once in 75 s, stars drift a few
// px; both follow the wall clock (a re-render resumes the same phase). Stars ease to new sizes and places when the
// holdings change; the sigil ticks once when a newer check lands. prefers-reduced-motion turns all of it off (CSS).
{
  // ------------------------------------------------------------------------------------------ identity --
  const FAMS = ['trend', 'carry', 'ls', 'rot', 'setups', 'gen'];
  const ROT = ['rs_rotation', 'bull_momentum'];
  const FAMW = { trend: 'Trend follower', carry: 'Carry', ls: 'Long-short book', rot: 'Rotation', setups: 'Setups', gen: 'Other rules' };
  const MARKW = { trend: 'a rising line: it follows the trend', carry: 'two linked rings: a long and a short of the same coin, paired',
    ls: 'a bar up and a bar down: longs balanced by shorts', rot: 'ranked spokes: it holds only the strongest few',
    setups: 'a bracket: it waits for a setup, then trades it', gen: 'a plain ring: rules of their own' };
  const posInt = v => { const x = num(v); return x != null && x > 0 ? Math.round(x) : null; };
  function famOfKind(kind, fam) {
    if (kind === 'flip') return 'setups';
    if (kind === 'carry') return 'carry';
    if (kind === 'target') return fam === 'ls_xs' ? 'ls' : ROT.indexOf(fam) >= 0 ? 'rot' : fam == null ? 'trend' : 'gen';
    return 'gen';
  }
  function identOf(x) {
    x = isObj(x) ? x : {};
    const g = isObj(x.sig) ? x.sig : null, cfg = isObj(x.cfg) ? x.cfg : null;
    let f, bar, n = null, k = null;
    if (g) { f = g.f; bar = TF[g.tf] || null; n = posInt(g.n); k = posInt(g.k); }
    else if (cfg) {                                                     // a bundle (the bot page)
      const t = isObj(cfg.target) ? cfg.target : {};
      f = famOfKind(cfg.kind, t.family); bar = TF[cfg.tf] || null;
      n = f === 'carry' ? posInt(isObj(cfg.carry) ? cfg.carry.basket_n : null) : f === 'ls' ? posInt(isObj(t.ls) ? t.ls.top_n : null) : posInt(t.n_coins);
      if (f === 'rot') k = posInt(t.top);
      if (n == null) n = posInt(Array.isArray(x.order) ? x.order.length : null);
    } else {                                                            // an older row: kind + its arena or shadow family
      const ar = isObj(x.arena) ? x.arena : isObj(x.shadow) ? x.shadow : null;
      f = famOfKind(x.kind, ar ? ar.family : undefined); n = posInt(x.n_names);
    }
    if (!bar) bar = num(x.bar_s) || TF[x.tf] || (isObj(x.clock) ? num(x.clock.bar_s) : null) || null;
    return { f: FAMS.indexOf(f) >= 0 ? f : 'gen', bar, n, k };
  }
  COMP.identOf = identOf;

  // ------------------------------------------------------------------------------------------- helpers --
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const unit = (s, salt) => (hash(salt + ':' + s) % 10007) / 10007;
  const f1 = v => String(Math.round(v * 10) / 10);
  // a wall-clock animation: data-ix="period ms,offset ms"; the observer below sets its delay so a re-render resumes it
  const anim = (cls, ms, off) => ' class="ix-a ' + cls + '" data-ix="' + ms + ',' + (off % ms) + '"';

  // --------------------------------------------------------------------------------------------- sigil --
  // viewBox 40×40, centre 20,20. Ring (r 18): one segment per check in a day (hourly 24, 4-hour 6, daily 1 with a gap).
  // Ticks (r 13.5–15.5): one per coin in its universe (at most 48). The mark (r ≤ 10): its family.
  function mark(f, k) {
    if (f === 'trend') return '<path class="ix-m" d="M11 26.5 16 21 20 23.5 28 13.5"/><circle class="ix-mf" cx="28" cy="13.5" r="1.8"/>';
    if (f === 'carry') return '<circle class="ix-m" cx="16.6" cy="20" r="4.6"/><circle class="ix-m" cx="23.4" cy="20" r="4.6"/>';
    if (f === 'ls') return '<path class="ix-m ix-th" d="M11.5 20h17"/><rect class="ix-mf" x="14" y="12" width="4.5" height="8" rx="1"/><rect class="ix-m" x="21.5" y="20" width="4.5" height="8" rx="1"/>';
    if (f === 'rot') {
      const n = Math.min(Math.max(k || 3, 2), 6);
      let h = '';
      for (let i = 0; i < n; i++) {
        const a = (-90 + (i - (n - 1) / 2) * (150 / Math.max(n - 1, 1))) * Math.PI / 180, L = 9.5 - i * (5 / Math.max(n - 1, 1));
        h += '<path class="ix-m" d="M20 21.5L' + f1(20 + Math.cos(a) * L) + ' ' + f1(21.5 + Math.sin(a) * L) + '"/>';
      }
      return h + '<circle class="ix-mf" cx="20" cy="21.5" r="1.8"/>';
    }
    if (f === 'setups') return '<path class="ix-m" d="M15.5 12.5h-3.5v15h3.5M24.5 12.5h3.5v15h-3.5"/><circle class="ix-mf" cx="20" cy="20" r="2"/>';
    return '<circle class="ix-m" cx="20" cy="20" r="5"/><circle class="ix-mf" cx="20" cy="20" r="1.6"/>';
  }
  function sigil(x, o) {
    o = o || {};
    const I = identOf(x), size = num(o.size) || 28, C = 2 * Math.PI * 18;
    const seg = I.bar ? Math.min(Math.max(Math.round(86400 / I.bar), 1), 48) : 0;
    const dash = seg === 1 ? f1(C - 7) + ' 7' : seg ? f1(C / seg * 0.62) + ' ' + f1(C / seg * 0.38) : '1.2 3';
    let ticks = '';
    const n = Math.min(I.n || 0, 48);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      ticks += 'M' + f1(20 + c * 13.4) + ' ' + f1(20 + s * 13.4) + 'L' + f1(20 + c * 15.4) + ' ' + f1(20 + s * 15.4);
    }
    const id = isObj(x) && x.id ? String(x.id) : '';
    const ring = '<circle class="ix-ring" cx="20" cy="20" r="18" stroke-dasharray="' + dash + '"/>';
    const tk = o.off || num(o.t) == null ? '' : '<circle class="ix-tk" cx="20" cy="2" r="2.2" data-ix-t="' + num(o.t) + '" data-ix-id="' + esc(id) + '"/>';
    return '<svg class="ix-sig ix-f-' + I.f + (o.off ? ' ix-off' : '') + (o.cls ? ' ' + o.cls : '') + '" viewBox="0 0 40 40" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">'
      + (o.off ? '<g>' + ring + '</g>' : '<g' + anim('ix-spin', 75000, hash(id) % 75000) + '>' + ring + tk + '</g>')
      + (ticks ? '<path class="ix-tks" d="' + ticks + '"/>' : '') + mark(I.f, I.k) + '</svg>';
  }
  COMP.sigil = sigil;

  // ----------------------------------------------------------------------------------------- holdings --
  const side = s => (s === 's' || s === 'short' ? 's' : s === 'c' ? 'c' : 'l');
  COMP.holdOfRow = function (A) {
    if (!isObj(A) || !Array.isArray(A.hold)) return null;
    return A.hold.filter(h => Array.isArray(h) && typeof h[0] === 'string' && num(h[1]) != null).map(h => ({ c: h[0], w: Math.abs(num(h[1])), s: side(h[2]) }));
  };
  COMP.holdOfBundle = function (b) {
    if (!isObj(b)) return null;
    const out = [];
    for (const p of (Array.isArray(b.pos) ? b.pos : [])) { const w = isObj(p) ? num(p.val_pct != null ? p.val_pct : p.size_pct) : null; if (w != null && p.c) out.push({ c: String(p.c), w: Math.abs(w), s: side(p.side) }); }
    for (const p of (Array.isArray(b.carry) ? b.carry : [])) { const w = isObj(p) ? num(p.cap_pct) : null; if (w != null && p.c) out.push({ c: String(p.c), w: Math.abs(w), s: 'c' }); }
    return out.sort((a, z) => z.w - a.w || (a.c < z.c ? -1 : 1));
  };
  COMP.skyWords = function (hold) {
    if (!Array.isArray(hold)) return '';
    if (!hold.length) return 'In cash: holding nothing right now.';
    const nl = hold.filter(h => h.s === 'l').length, ns = hold.filter(h => h.s === 's').length, nc = hold.filter(h => h.s === 'c').length;
    const tot = hold.reduce((a, h) => a + h.w, 0), parts = [];
    if (nc) parts.push(word.plural(nc, 'carry pair'));
    if (nl) parts.push(ns ? fmt.int(nl) + ' long' : word.plural(nl, 'coin'));
    if (ns) parts.push(fmt.int(ns) + ' short');
    const cash = !ns && tot < 99.5 ? ' · about ' + fmt.pctu(100 - tot, 0) + ' of the pot in cash' : '';
    return 'Holding ' + parts.join(', ') + cash + '. Each star is one holding, sized by its share of the pot.';
  };

  // ------------------------------------------------------------------------------------- constellation --
  const PREV = {};                       // key → {coin: [x, y, r]}: where each star stood last time (eases to the new place)
  function sky(hold, o) {
    o = o || {};
    if (!Array.isArray(hold)) return '';
    const mini = !!o.mini, W = mini ? 72 : 240, H = mini ? 44 : 132, pad = mini ? 4 : 10, key = String(o.key || '');
    const R0 = mini ? 1.6 : 2.6, R1 = mini ? 6.5 : 14;
    const rOf = w => R0 + (R1 - R0) * Math.sqrt(Math.min(Math.max(w, 0), 50) / 50);
    const split = o.f === 'ls' || hold.some(h => h.s === 's'), mid = W / 2, gap = mini ? 4 : 10;
    let h = '<svg class="ix-sky' + (mini ? ' ix-mini' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true" focusable="false">';
    if (split && hold.length) h += '<path class="ix-div" d="M' + mid + ' ' + (pad - 2) + 'V' + (H - pad + 2) + '"/>'
      + (mini ? '' : '<text class="ix-lab" x="' + (mid - 6) + '" y="' + (H - 3) + '" text-anchor="end">long</text><text class="ix-lab" x="' + (mid + 6) + '" y="' + (H - 3) + '">short</text>');
    if (!hold.length) {
      PREV[key] = {};
      return h + '<g transform="translate(' + f1(W / 2) + ' ' + f1(H / 2 - (mini ? 0 : 6)) + ')"><g' + anim('ix-calm', 9000, hash(key) % 9000) + '><circle class="ix-dim" r="' + (mini ? 2.8 : 3.6) + '"/></g></g>'
        + (mini ? '' : '<text class="ix-lab" x="' + W / 2 + '" y="' + (H / 2 + 14) + '" text-anchor="middle">in cash</text>') + '</svg>';
    }
    const top = 0, bot = mini ? 0 : 12;        // the bot page leaves the bottom row for its labels
    const S = hold.slice().sort((a, z) => z.w - a.w || (a.c < z.c ? -1 : 1)).map(x => {
      const r = rOf(x.w), lo = split ? (x.s === 's' ? mid + gap : pad) : pad, hi = split ? (x.s === 's' ? W - pad : mid - gap) : W - pad;
      return { x: x, r, lo, hi, px: lo + unit(x.c, 'x') * (hi - lo), py: pad + top + unit(x.c, 'y') * (H - 2 * pad - top - bot) };
    });
    const clamp = s => { s.px = Math.min(Math.max(s.px, s.lo + s.r), Math.max(s.lo + s.r, s.hi - s.r)); s.py = Math.min(Math.max(s.py, pad + s.r), Math.max(pad + s.r, H - pad - bot - s.r)); };
    S.forEach(clamp);
    for (let it = 0; it < 40; it++) {                  // deterministic relaxation: push overlapping stars apart
      let moved = false;
      for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
        const a = S[i], b = S[j], need = a.r + b.r + (mini ? 1.5 : 13);
        let dx = b.px - a.px, dy = b.py - a.py, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= need) continue;
        if (d < 0.01) { const t = unit(a.x.c + b.x.c, 'a') * 2 * Math.PI; dx = Math.cos(t); dy = Math.sin(t); d = 1; }
        const p = (need - d) / 2 / d;
        a.px -= dx * p; a.py -= dy * p; b.px += dx * p; b.py += dy * p; clamp(a); clamp(b); moved = true;
      }
      if (!moved) break;
    }
    // faint links: within one side, each star to its nearest bigger neighbour (they move together: same book, same side)
    let links = '';
    S.forEach((s, i) => {
      if (s.x.s === 'c') return;
      let best = null, bd = 1e9;
      for (let j = 0; j < i; j++) { const t = S[j]; if (t.x.s !== s.x.s) continue; const d = Math.hypot(t.px - s.px, t.py - s.py); if (d < bd) { bd = d; best = t; } }
      if (best) links += 'M' + f1(best.px) + ' ' + f1(best.py) + 'L' + f1(s.px) + ' ' + f1(s.py);
    });
    if (links) h += '<path class="ix-ln" d="' + links + '"/>';
    const was = PREV[key], now = {};
    for (const s of S) {
      const c = s.x.c, p = was && was[c];
      now[c] = [s.px, s.py, s.r];
      let mv = '';
      if (p && (Math.abs(p[0] - s.px) > 0.3 || Math.abs(p[1] - s.py) > 0.3 || Math.abs(p[2] - s.r) > 0.2)) mv = ' class="ix-mv" style="--fx:' + f1(p[0] - s.px) + 'px;--fy:' + f1(p[1] - s.py) + 'px;--fs:' + (Math.round(p[2] / s.r * 100) / 100) + '"';
      else if (was && !p) mv = ' class="ix-new"';
      const amp = mini ? 1 : 2.2, dx = f1((unit(c, 'dx') - 0.5) * 2 * amp), dy = f1((unit(c, 'dy') - 0.5) * 2 * amp);
      const body = s.x.s === 'c'
        ? '<path class="ix-ln ix-pl" d="M' + f1(-s.r * 0.55) + ' 0H' + f1(s.r * 0.55) + '"/><circle class="ix-l" cx="' + f1(-s.r * 0.55) + '" r="' + f1(s.r * 0.62) + '"/><circle class="ix-s" cx="' + f1(s.r * 0.55) + '" r="' + f1(s.r * 0.62) + '"/>'
        : '<circle class="ix-' + s.x.s + '" r="' + f1(s.r) + '"/>';
      const lab = mini || s.r < 6 ? '' : '<text class="ix-cn" y="' + f1(s.r + 10) + '" text-anchor="middle">' + esc(c) + '</text>';
      h += '<g transform="translate(' + f1(s.px) + ' ' + f1(s.py) + ')"><g' + mv + '><g' + anim('ix-dr', 14000 + (hash(c) % 9000), hash(c + key)) + ' style="--dx:' + dx + 'px;--dy:' + dy + 'px">' + body + '</g>' + lab + '</g></g>';
    }
    PREV[key] = now;
    // cash: a small hollow mark, sized like a holding of the rest of the pot (long-only books whose holdings sum under 100%)
    const tot = hold.reduce((a, x) => a + x.w, 0);
    if (!split && tot < 99.5) {
      const r = rOf(100 - tot) * 0.8, cx = W - pad - r, cy = H - pad - bot - r;
      if (!S.some(s => Math.hypot(s.px - cx, s.py - cy) < s.r + r + 1)) h += '<circle class="ix-cash" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r) + '"/>'
        + (mini ? '' : '<text class="ix-lab" x="' + f1(cx) + '" y="' + f1(cy + r + 10) + '" text-anchor="middle">cash</text>');
    }
    return h + '</svg>';
  }
  COMP.sky = sky;

  // ------------------------------------------------------------------------------------------ hover tip --
  TIP.sigil = (a, el) => {
    const A = tipRow(a, el), I = identOf(A || (S.b ? S.b : null));
    const seg = I.bar ? Math.min(Math.max(Math.round(86400 / I.bar), 1), 48) : 0;
    return ['Sigil · ' + FAMW[I.f], 'Drawn from its rules, so it changes only when they do. The ring: '
      + (seg ? (seg === 1 ? 'one segment, it checks once a day' : word.plural(seg, 'segment') + ', one per check in a day') : 'dotted, its cadence is not known yet')
      + '. The ticks: ' + (I.n ? word.plural(I.n, 'coin') + ' it can choose from' : 'none, its universe is not known yet') + '. The middle: ' + MARKW[I.f] + '.'];
  };
  TIP.sky = ['What it holds', 'One star per holding, sized by its share of the pot. Green is long, coral is short (shorts sit right of the line); a carry pair shows both legs. Faint lines join holdings on the same side. A hollow mark is cash.'];

  // ------------------------------------------------------------------------- wall-clock motion + tick --
  const SEEN = {};                       // bot id → the newest check its sigil has shown (a newer one ticks once)
  function fix(root) {
    if (!root || root.nodeType !== 1) return;
    const list = root.matches && root.matches('[data-ix],[data-ix-t]') ? [root] : [];
    if (root.querySelectorAll) list.push.apply(list, root.querySelectorAll('[data-ix],[data-ix-t]'));
    const t = Date.now();
    for (const el of list) {
      if (el.dataset.ix) { const p = el.dataset.ix.split(','), ms = +p[0], off = +p[1]; if (ms > 0) { el.style.animationDuration = ms + 'ms'; el.style.animationDelay = -((t + off) % ms) + 'ms'; } }
      if (el.dataset.ixT) {
        const id = el.dataset.ixId || '', v = +el.dataset.ixT;
        if (SEEN[id] != null && v > SEEN[id] && !reduced) el.classList.add('on');
        if (SEEN[id] == null || v > SEEN[id]) SEEN[id] = v;
      }
    }
  }
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement && document.documentElement.nodeType === 1) {
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.dataset && (n.dataset.ix || n.dataset.ixT) || n.querySelector && n.querySelector('[data-ix],[data-ix-t]'))) fix(n); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
}
