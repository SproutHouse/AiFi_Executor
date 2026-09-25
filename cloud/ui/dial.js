// cloud/ui/dial.js — the cycle clock dial (spec §4.2 d, §3.1, §13 "Due phase" and "Arrival"; build step 13).
// One block (see ui/README.md); exports COMP.dial only. Every time comes from core's clock() and nowS(), so the dial,
// the capsule and the verdict read the same phase. The face is 24 hours of local time, local midnight at the top.
//
// COMP.dial(el, opts?) draws into el and returns a cleanup function; opts.b draws another bundle (default S.b).
//   Beads: the 5 slots before the owed close, each at its run's actual time (runs in one slot merge into one bead,
//   coloured by the worst outcome, with an accent ring when the bot bought, sold or raised a stop), a dashed hollow
//   bead for a slot that passed with no run, and the "next" bead at C + lag. Slots before the first check stay blank.
//   The 1 s tick (core every1s: on screen and visible only) writes one text node; the 30 s tick moves the hand and
//   the arcs. A run newer than any this page drew before grows in and pings once (arrival); the due phase pings
//   every 2 s. Reduced motion: no pings, no growth, no hand transition.
{
  const DAY = 86400, O = 120, TR = 100, BR = 9, HAND = [70, 100];
  const DIALS = new Set();
  const INST = new WeakMap();
  let seenT = null;                                  // newest run drawn this page session (arrival detection)

  // ------------------------------------------------------------------------------------------ geometry
  const r2 = x => Math.round(x * 100) / 100;
  const r4 = x => Math.round(x * 1e4) / 1e4;
  function locMin(t) { const d = new Date(t * 1000); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  function ang(t) { return locMin(t) / 4 - 90; }            // degrees; local midnight at the top, clockwise
  function xy(a, r) { const q = a * Math.PI / 180; return [r2(O + r * Math.cos(q)), r2(O + r * Math.sin(q))]; }
  function sweep(t1, t2) {
    if (!(t2 > t1)) return 0;
    if (t2 - t1 >= DAY - 60) return 359.8;
    const byFace = ((ang(t2) - ang(t1)) % 360 + 360) % 360, byTime = (t2 - t1) / DAY * 360;
    return Math.abs(byFace - byTime) > 30 ? byTime : byFace;   // a DST night moves the face, not the elapsed time
  }
  function arcD(t1, t2) {
    const sw = sweep(t1, t2); if (sw < 0.3) return '';
    const a = ang(t1), p = xy(a, TR), q = xy(a + sw, TR);
    return 'M' + p[0] + ' ' + p[1] + 'A' + TR + ' ' + TR + ' 0 ' + (sw > 180 ? 1 : 0) + ' 1 ' + q[0] + ' ' + q[1];
  }
  const handDeg = t => r2(locMin(t) / 4);                   // rotation from 12 o'clock (the hand is drawn pointing up)

  // --------------------------------------------------------------------------------------------- model
  // Centre phases: countdown · due · late · exits (late while holding, from C + 2 h) · stale · first (no run yet).
  function phaseOf(K) { return K.phase === 'none' || K.C == null ? 'first' : K.phase === 'late' && K.exits ? 'exits' : K.phase; }
  function model(b, now) {
    const K = clock(b, now), ck = clockOf(b) || {}, cfg = (b && b.cfg) || {};
    const sch = (num(ck.sched_min) ?? num(cfg.sched_min) ?? 5) * 60, lagS = Math.round((num(K.lag) ?? 20) * 60);
    const runs = b && Array.isArray(b.runs) ? b.runs.filter(r => r && num(r.t) != null) : null;
    const M = { K, now, sch, lagS, cph: phaseOf(K), beads: [], known: !!runs, last: null };
    if (M.cph === 'first') {                                  // empty: 6 hollow beads at the schedule
      const s0 = Math.floor((now - sch) / BAR) * BAR + BAR;
      for (let k = 0; k < 6; k++) M.beads.push({ kind: k ? 'plan' : 'next', s: s0 + k * BAR, t: s0 + k * BAR + sch });
      M.A = s0; M.next = s0 + sch;
      return M;
    }
    // A: the slot the next bead stands for. Stale moves it to the current slot, so the slots in between show missed.
    const A = K.phase === 'stale' ? Math.floor(now / BAR) * BAR : K.C;
    M.A = A; M.next = A === K.C ? K.next : A + lagS;
    if (runs) {
      const ev = new Map();
      for (const e of (Array.isArray(b.events) ? b.events : [])) if (Array.isArray(e) && e[0] != null) { const l = ev.get(e[0]); if (l) l.push(e); else ev.set(e[0], [e]); }
      const f = [runs.length ? num(runs[0].t) : null, b.origin ? num(b.origin.t) : null, num(ck.last_t)].filter(x => x != null);
      const f0 = f.length ? Math.floor(Math.min(...f) / BAR) * BAR : A;
      const eff = modeOf(b).eff === 'live' ? 'l' : 'p';
      for (let s = A - 5 * BAR; s < A; s += BAR) {
        if (s < f0) continue;                                 // before the first check: blank, never "missed"
        const rs = runs.filter(r => (num(r.s) ?? Math.floor(r.t / BAR) * BAR) === s && r.t <= now).sort((x, y) => x.t - y.t);
        if (rs.length) M.beads.push(runBead(s, rs, ev, eff));
        else if (now >= s + BAR) M.beads.push({ kind: 'miss', s, t: s + lagS });
      }
    }
    for (const bd of M.beads) if (bd.runs && (!M.last || bd.lastT > M.last.lastT)) M.last = bd;
    M.beads.push({ kind: 'next', s: A, t: M.next });
    return M;
  }
  function runBead(s, rs, ev, eff) {
    const k = rs.some(r => r.x) ? 'fail' : rs.some(r => !r.ok) ? 'late' : 'ok';
    const bought = [], sold = [], trail = [];
    let nBought = 0;
    for (const r of rs) {
      let nb = 0;
      for (const e of ev.get(r.t) || []) {
        if (e[1] === 'bought') { bought.push(e[2]); nb++; }
        else if (e[1] === 'sold') sold.push([e[2], num(e[7])]);
        else if (e[1] === 'trail' && !trail.includes(e[2])) trail.push(e[2]);
      }
      for (const [c, h] of Object.entries(r.hx && typeof r.hx === 'object' ? r.hx : {})) {   // when events were trimmed
        const m = String(h).match(/^([tc])([+-]?[\d.]+)$/); if (!m) continue;
        if (m[1] === 'c' && !sold.some(x => x[0] === c)) sold.push([c, num(m[2])]);
        if (m[1] === 't' && !trail.includes(c)) trail.push(c);
      }
      nBought += Math.max(nb, Array.isArray(r.c) ? num(r.c[4]) || 0 : 0);
    }
    return { kind: k, s, t: rs[0].t, lastT: rs[rs.length - 1].t, runs: rs, bought, nBought, sold, trail, ev, eff,
             acted: nBought > 0 || sold.length > 0 || trail.length > 0 };
  }

  // --------------------------------------------------------------------------------------------- words
  function runWords(r, ev, eff) {
    let s = r.lm == null && !r.x ? word.lag(null, r.ok) : word.run(r).s;
    if (r.x) { const f = (ev.get(r.t) || []).find(e => e[1] === 'failed'); if (f && f[6]) s += ' (' + f[6] + ')'; s += '; exits may not have been checked'; }
    if (r.m && r.m !== eff) s += r.m === 'l' ? ' · a live check' : ' · a paper check';
    return s;
  }
  function countWords(rs) {
    const c = rs.filter(r => Array.isArray(r.c) && !(r.x && !num(r.c[0])));
    if (!c.length) return rs.some(r => r.x) ? '' : 'counts not recorded';
    const sig = c.reduce((a, r) => a + (num(r.c[1]) || 0), 0);
    return sig ? word.plural(sig, 'signal') : 'no signals';
  }
  function actWords(bd) {
    const x = [], named = bd.bought.filter(Boolean);
    x.push(bd.nBought ? 'bought ' + (named.length ? word.list(named) : fmt.int(bd.nBought)) + (named.length && bd.nBought > named.length ? ' and ' + (bd.nBought - named.length) + ' more' : '') : 'nothing bought');
    for (const [c, R] of bd.sold) x.push('sold ' + c + (R != null ? ' ' + fmt.R(R) : ''));
    if (bd.trail.length) x.push('stop raised: ' + word.list(bd.trail));
    return x;
  }
  // {text, html, replay:[t…]} for a bead's tip and aria-label.
  function beadWords(bd, M) {
    const K = M.K;
    if (bd.kind === 'next' || bd.kind === 'plan') {
      const at = bd.s + M.sch, base = 'Scheduled ' + fmt.when(at) + ' (' + Math.round(M.sch / 60) + ' min after the ' + fmt.time(bd.s) + ' close).';
      if (bd.kind === 'plan') return { text: base + ' No check has run yet.', html: esc(base + ' No check has run yet.'), replay: [] };
      const usual = K.rng && (K.lagN == null || K.lagN >= 3) ? 'Recent checks started ' + K.rng[0] + '–' + K.rng[1] + ' min after the close' : 'Too few checks yet to know the usual start';
      const pre = {
        first: 'The first check. ',
        countdown: 'Next check, expected about ' + fmt.time(M.next) + '. ',
        due: 'Due now, expected about ' + fmt.time(M.next) + '. ',
        late: 'Late: no check yet, so buys are skipped for this bar; exits still run when it lands. ',
        exits: 'Late while holding: exits not checked since ' + fmt.when(K.lastT) + '. ',
        stale: 'No check for ' + fmt.dur(K.age) + '; the runner may be down. ',
      }[M.cph] || '';
      const text = pre + base + (M.cph === 'first' ? '' : ' ' + usual + '; buys need it within ' + (K.lim ?? '—') + ' min.');
      return { text, html: esc(text), replay: [] };
    }
    if (bd.kind === 'miss') {
      const text = 'The ' + fmt.when(bd.s) + ' close · missed: no check was recorded for it.';
      return { text, html: '<b>' + esc(fmt.when(bd.s) + ' close') + '</b> · missed: no check was recorded for it.', replay: [] };
    }
    const acts = actWords(bd).join(' · ');
    if (bd.runs.length === 1) {
      const r = bd.runs[0], cw = countWords(bd.runs);
      const tail = [runWords(r, bd.ev, bd.eff), cw ? cw + ', ' + acts : acts].join(' · ');
      return { text: fmt.when(r.t) + ' · ' + tail, html: '<b>' + esc(fmt.when(r.t)) + '</b> · ' + esc(tail), replay: [r.t] };
    }
    const head = bd.runs.length + ' checks for the ' + fmt.when(bd.s) + ' close';
    const lines = bd.runs.map(r => { const cw = countWords([r]); return fmt.time(r.t) + ' ' + runWords(r, bd.ev, bd.eff) + (cw ? ' · ' + cw : ''); });
    return { text: head + ': ' + lines.join('; ') + ' · ' + acts, html: '<b>' + esc(head) + '</b>' + lines.map(l => '<br>' + esc(l)).join('') + '<br>' + esc(acts), replay: bd.runs.map(r => r.t) };
  }
  function tipHtmlOf(w) {
    if (!w.replay.length) return w.html;
    const one = w.replay.length === 1;
    return w.html + '<div class="dl-tipb">' + w.replay.map(t => '<button type="button" class="btn small" data-cursor="' + esc(t) + '" data-scroll>'
      + (one ? 'Replay this check ›' : 'Replay ' + esc(fmt.time(t)) + ' ›') + '</button>').join('') + '</div>';
  }
  function summary(M) {
    const K = M.K, n = k => M.beads.filter(b => b.kind === k).length;
    let s = 'Cycle clock, local time. ';
    if (M.cph === 'first') s += 'No check has run yet; 6 checks a day are scheduled. ';
    else if (!M.known) s += 'Past checks are not in this data. ';
    else {
      const p = [word.plural(n('ok'), 'check') + ' on time'];
      if (n('late')) p.push(n('late') + ' ran late');
      if (n('fail')) p.push(n('fail') + ' failed');
      if (n('miss')) p.push(n('miss') + ' missed');
      const a = M.beads.filter(b => b.acted).length;
      s += 'Last 24 hours: ' + p.join(', ') + (a ? '; the bot acted in ' + a : '') + '. ';
    }
    return s + ({
      first: 'The first check is scheduled ' + fmt.when(M.next) + '.',
      countdown: 'Next check expected about ' + fmt.time(M.next) + '.',
      due: 'The next check is due now.',
      late: 'The next check is late; buys are skipped after ' + fmt.time(K.lateAt) + '.',
      exits: 'Exits not checked since ' + fmt.when(K.lastT) + '.',
      stale: 'No check for ' + fmt.dur(K.age) + '.',
    }[M.cph] || '');
  }

  // ------------------------------------------------------------------------------------------- centre
  function mainAt(M, now) {
    switch (M.cph) {
      case 'countdown': case 'first': return fmt.cd(M.next - now);
      case 'due': return fmt.over(now - M.next);
      case 'late': case 'exits': return fmt.age(now - M.K.C);
      case 'stale': return fmt.age(now - M.K.lastT);
      default: return '—';
    }
  }
  function centre(M) {
    const K = M.K, C = {
      countdown: ['Next check', '', '≈ ' + fmt.time(M.next)],
      due: ['Due now', 'due', 'usually by ' + fmt.time(K.C + (K.rng ? K.rng[1] : K.lag) * 60)],
      late: ['Late', 'warn', 'buys skipped after ' + fmt.time(K.lateAt)],
      exits: ['Exits unchecked', 'bad', ''],                 // the age counts from the close; the verdict names the last check
      stale: ['No check', 'bad', ''],
      first: ['First check', '', 'at ' + fmt.time(M.next)],
    }[M.cph] || ['Next check', '', ''];
    return { eb: C[0], cls: C[1], sub: C[2], main: mainAt(M, M.now) };
  }

  // --------------------------------------------------------------------------------------------- draw
  const keyOf = (M, cur) => [M.cph, M.A, M.known ? 1 : 0, cur ?? '', M.beads.map(b => b.kind + b.t + (b.acted ? 'a' : '') + (b.runs ? b.runs.length : '')).join()].join('|');
  function beadSvg(bd, i, M, fresh) {
    const [x, y] = xy(ang(bd.t), TR), c = ' cx="' + x + '" cy="' + y + '"';
    const ts = bd.runs ? bd.runs.map(r => r.t).join(' ') : '';
    let h = '<g class="dl-g' + (fresh ? ' dl-new' : '') + '"' + (ts ? ' data-ts="' + ts + '"' : '') + '>';
    if (ts) h += '<circle class="dl-sel"' + c + ' r="' + (BR + 5) + '"/>';
    if (bd.kind === 'next') {
      if (M.cph === 'due' && !reduced) h += '<circle class="dl-ping"' + c + ' r="' + BR + '"/>';
      h += '<circle class="dl-b next"' + c + ' r="' + (BR - 1) + '"/>';
    } else if (bd.kind === 'plan' || bd.kind === 'miss') h += '<circle class="dl-b ' + bd.kind + '"' + c + ' r="' + (BR - 1) + '"/>';
    else {
      h += '<circle class="dl-b ' + bd.kind + '"' + c + ' r="' + BR + '"/>';
      if (bd.acted) h += '<circle class="dl-ring"' + c + ' r="' + (BR + 2.5) + '"/>';
      if (fresh) h += '<circle class="dl-ping dl-once"' + c + ' r="' + BR + '"/>';
    }
    return h + '</g>';
  }
  // The four hour labels; the one the hand is passing fades so the hand never sits on top of its text.
  const LABS = [[0, 0, -1], [6, 1, 0], [12, 0, 1], [18, -1, 0]];
  const nearHand = (hh, hd) => { const d = Math.abs(((hd - hh * 15) % 360 + 540) % 360 - 180); return d < 11; };
  function hourLabels(hd) {
    const d = new Date(nowMs()), out = [];
    for (const [hh, x, y] of LABS) {
      d.setHours(hh, 0, 0, 0);
      out.push('<span class="dl-lab' + (nearHand(hh, hd) ? ' dim' : '') + '" data-h="' + hh + '" style="--x:' + x + ';--y:' + y + '" aria-hidden="true">' + esc(fmt.hr(Math.floor(d.getTime() / 1000))) + '</span>');
    }
    return out.join('');
  }
  const LEGEND = '<p class="dl-lg"><span><i class="dl-k ok"></i>on time</span><span><i class="dl-k late"></i>ran late</span>'
    + '<span><i class="dl-k fail"></i>failed</span><span><i class="dl-k miss"></i>missed</span><span><i class="dl-k act"></i>bought, sold or stop raised</span>'
    + '<span><i class="dl-k hand"></i>hand = now</span></p>';
  const arcFrom = (M, now) => M.cph === 'first' ? null : M.last ? M.last.t : (M.K.lastT != null && M.K.lastT <= now ? M.K.lastT : null);

  function draw(inst) {
    const b = inst.b || S.b, now = nowS(), M = model(b, now), cur = S.cursor;
    const newest = M.last ? M.last.lastT : null;
    const fresh = !inst.b && seenT != null && newest != null && newest > seenT && !reduced ? M.last : null;
    if (!inst.b && newest != null) seenT = Math.max(seenT ?? newest, newest);
    const ticks = [];
    for (let h = 0; h < 24; h++) { if (h % 6 === 0) continue; const a = h * 15 - 90, p = xy(a, 86), q = xy(a, 90); ticks.push('M' + p[0] + ' ' + p[1] + 'L' + q[0] + ' ' + q[1]); }   // the 4 labels stand in for their ticks
    const t0 = arcFrom(M, now), prog = t0 != null ? arcD(t0, now) : '', rest = M.next > now ? arcD(now, M.next) : '';
    const words = M.beads.map(bd => beadWords(bd, M)), ctr = centre(M), hd = handDeg(now);
    inst.rot = hd;
    const svg = '<svg class="dl-svg" viewBox="0 0 240 240" role="img" aria-label="' + esc(summary(M)) + '">'
      + '<circle class="dl-track" cx="' + O + '" cy="' + O + '" r="' + TR + '"/>'
      + '<path class="dl-tick" d="' + ticks.join('') + '"/>'
      + '<path class="dl-rest" d="' + rest + '"/><path class="dl-prog" d="' + prog + '"/>'
      + M.beads.map((bd, i) => beadSvg(bd, i, M, bd === fresh)).join('')
      + '<g class="dl-hand" style="transform:rotate(' + hd + 'deg)"><line x1="' + O + '" y1="' + (O - HAND[0]) + '" x2="' + O + '" y2="' + (O - HAND[1]) + '"/>'
      + '<circle cx="' + O + '" cy="' + (O - HAND[0]) + '" r="2.5"/></g></svg>';
    const hits = M.beads.map((bd, i) => {
      const a = ang(bd.t) * Math.PI / 180;
      return '<button type="button" class="dl-hit" data-i="' + i + '" style="--x:' + r4(Math.cos(a)) + ';--y:' + r4(Math.sin(a)) + '" data-tip="' + esc(words[i].text) + '" aria-label="' + esc(words[i].text) + '"></button>';
    }).join('');
    inst.el.innerHTML = '<div class="dl"><div class="dl-face">' + svg + hourLabels(hd)
      + '<div class="dl-ctr"><div class="dl-in"><span class="dl-eb">' + esc(ctr.eb) + '</span><span class="dl-main' + (ctr.cls ? ' ' + ctr.cls : '') + '">' + esc(ctr.main) + '</span>'
      + (ctr.sub ? '<span class="dl-sub">' + esc(ctr.sub) + '</span>' : '') + '</div></div>' + hits + '</div>'
      + LEGEND + (M.known || M.cph === 'first' ? '' : '<p class="dl-na">Past checks: ' + na() + '</p>') + '</div>';
    const q = s => inst.el.querySelector(s);
    inst.svg = q('.dl-svg'); inst.hand = q('.dl-hand'); inst.prog = q('.dl-prog'); inst.rest = q('.dl-rest'); inst.sub = q('.dl-sub');
    const mainEl = q('.dl-main');
    inst.text = mainEl && mainEl.firstChild && mainEl.firstChild.nodeType === 3 ? mainEl.firstChild : null;
    inst.el.querySelectorAll('.dl-hit').forEach(h => { const i = Number(h.dataset.i), w = words[i]; h._tip = () => tipHtmlOf(w); h._replay = w.replay.length > 0; h._bead = M.beads[i]; });
    inst.M = M; inst.key = keyOf(M, cur);
    markSel(inst);
    if (mainEl) every1s(mainEl, () => sec1(inst));
  }

  // -------------------------------------------------------------------------------------------- ticks
  // 1 s: one text node. A phase change (countdown → due → late …) redraws the dial and repaints the shell at once,
  // so the capsule and the centre never disagree until the next 30 s tick.
  function sec1(inst) {
    if (!inst.el.isConnected || !inst.M) return;
    const now = nowS(), M = inst.M, ph = phaseOf(clock(inst.b || S.b, now));
    if (ph !== M.cph || (ph === 'first' && now >= M.next) || (ph === 'stale' && Math.floor(now / BAR) * BAR !== M.A)) {
      hideIn(inst); draw(inst);
      if (!inst.b) call(refreshShell);
      return;
    }
    const v = mainAt(M, now);
    if (inst.text && inst.text.data !== v) inst.text.data = v;
  }
  // 30 s: the hand and the arcs follow the real clock; a changed shape (a slot passed, a phase flipped) redraws.
  function sec30(inst) {
    const now = nowS(), M = model(inst.b || S.b, now);
    if (keyOf(M, S.cursor) !== inst.key) { hideIn(inst); return draw(inst); }
    let hd = handDeg(now);
    while (hd < inst.rot - 180) hd += 360;
    while (hd > inst.rot + 180) hd -= 360;
    if (inst.hand) {
      const jump = Math.abs(hd - inst.rot) > 3;                // back from hidden: no sweep across the face
      if (jump) inst.hand.classList.add('dl-jump');
      inst.hand.style.transform = 'rotate(' + hd + 'deg)';
      if (jump) requestAnimationFrame(() => requestAnimationFrame(() => inst.hand && inst.hand.classList.remove('dl-jump')));
    }
    inst.rot = hd;
    inst.el.querySelectorAll('.dl-lab').forEach(l => l.classList.toggle('dim', nearHand(Number(l.dataset.h), hd)));
    const t0 = arcFrom(M, now);
    if (inst.prog) inst.prog.setAttribute('d', t0 != null ? arcD(t0, now) : '');
    if (inst.rest) inst.rest.setAttribute('d', M.next > now ? arcD(now, M.next) : '');
    const c = centre(M);
    if (inst.text && inst.text.data !== c.main) inst.text.data = c.main;     // back from hidden: right at once, not a second later
    if (inst.sub && inst.sub.textContent !== c.sub) inst.sub.textContent = c.sub;
    const lab = summary(M);
    if (inst.svg && inst.svg.getAttribute('aria-label') !== lab) inst.svg.setAttribute('aria-label', lab);
    inst.M = M;
  }
  function hideIn(inst) { const a = document.querySelector('[aria-describedby=tipbox]'); if (a && inst.el.contains(a)) hideTip(); }
  function markSel(inst) {
    const c = S.cursor;
    inst.el.querySelectorAll('.dl-g[data-ts]').forEach(g => g.classList.toggle('sel', c != null && g.dataset.ts.split(' ').includes(String(c))));
  }
  function live() { for (const i of DIALS) if (!i.el.isConnected) DIALS.delete(i); return DIALS; }
  hook('tick30s', () => live().forEach(i => call(sec30, i)));
  onCursor(() => live().forEach(i => { markSel(i); if (i.M) i.key = keyOf(i.M, S.cursor); }));

  // ------------------------------------------------------------------------------------------ clicks
  // Pointer: where two 44px areas overlap, the bead nearest the tap wins. Keyboard: Enter opens the words and
  // moves focus to "Replay this check ›"; Escape or Tab from there returns to the bead without reopening its tip.
  function nearest(inst, e) {
    const r = inst.svg && inst.svg.getBoundingClientRect(); if (!r || !r.width) return null;
    let best = null, bd = Infinity;
    inst.el.querySelectorAll('.dl-hit').forEach(h => {
      if (!h._bead) return;
      const [x, y] = xy(ang(h._bead.t), TR), dx = r.left + x / 240 * r.width - e.clientX, dy = r.top + y / 240 * r.height - e.clientY, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  }
  function quietFocus(h) {
    if (!h || !h.isConnected) return;
    const tx = h.getAttribute('data-tip'); h.removeAttribute('data-tip');
    try { h.focus({ preventScroll: true }); } catch (e) {}
    setTimeout(() => { if (h.isConnected && tx != null) h.setAttribute('data-tip', tx); }, 0);
  }
  function focusTip(h) {
    const box = document.getElementById('tipbox');
    if (!box || !box.classList.contains('on') || h.getAttribute('aria-describedby') !== 'tipbox') return;
    const btns = [...box.querySelectorAll('button')]; if (!btns.length) return;
    btns.forEach(bt => {
      bt.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); hideTip(); quietFocus(h); }
        else if (ev.key === 'Tab' && (ev.shiftKey ? bt === btns[0] : bt === btns[btns.length - 1])) { hideTip(); quietFocus(h); }   // the default Tab moves on from the bead
      });
      bt.addEventListener('click', () => setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || box.contains(a)) quietFocus(h); }, 0));
    });
    try { btns[0].focus({ preventScroll: true }); } catch (e) {}
  }
  function onDialClick(e) {
    const inst = INST.get(this), hit = e.target instanceof Element && e.target.closest('.dl-hit');
    if (!inst || !hit || !this.contains(hit)) return;
    if (e.detail > 0) {
      const best = nearest(inst, e);
      if (best && best !== hit) {
        e.preventDefault(); e.stopPropagation();
        if (best.getAttribute('aria-describedby') === 'tipbox') hideTip(); else showTip(best);
      }
      return;
    }
    if (!hit._replay) return;
    if (hit.getAttribute('aria-describedby') === 'tipbox') { e.preventDefault(); e.stopPropagation(); focusTip(hit); }
    else requestAnimationFrame(() => focusTip(hit));                    // core opens it on this click; then move focus in
  }

  // ------------------------------------------------------------------------------------------- export
  COMP.dial = function (el, opts) {
    if (!(el instanceof Element)) return () => {};
    let inst = INST.get(el);
    if (!inst) { inst = { el }; INST.set(el, inst); el.addEventListener('click', onDialClick); }
    inst.b = opts && opts.b ? opts.b : null;
    DIALS.add(inst);
    safe(() => draw(inst), 'Cycle clock', el);
    return () => { DIALS.delete(inst); };
  };
}
