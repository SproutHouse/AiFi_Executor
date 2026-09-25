// cloud/ui/gaterun.js — the Gate Run (spec §4.5), its cycle bar, and the cycle and name sheets (§9.1, §9.2).
// Joined after core.js inside the page's one IIFE: one block, private names only, exports through COMP and SHEETS.
//   COMP.gateRun(el, runOrT, opts) → controller {el, run(), play(), skip(), step(), redraw()}. Fills `el` (the Now
//     card or a sheet host). runOrT: a runs[] item, a run t, or null/undefined = follow the shared cursor (§5).
//     opts: {autoplay = true (the §4.5 rules), play (play once when in view: an explicit open), sheet (compact: no h2,
//     no "Back to latest"), bar = true (the cycle bar), follow (default: runOrT is null)}.
//     The Now card should carry id="now-gaterun"; gateRun sets it when the host has no id and none exists yet.
//   COMP.cycleBar(el?) → html. With el it fills el and follows the cursor; the Gate Run embeds the same bar.
//   SHEETS.cycle(t) and SHEETS.name(coin, el) (el.dataset.at = run t → "as at …, recorded").
// Stage codes, words and colours come from core's STAGE / GATES / word.* and mission.js's .st-<code> classes.
{
  const STEP = 260, MOVE = 220, TOTAL = 2400, TAIL = 530, EASE = 'cubic-bezier(.16,1,.3,1)';
  const EV_CODE = { blocked: 'r', recorded: 'p', proposed: 'P', notfilled: 'e', bought: 'E' };
  const SIGNAL = /[rpPeEmg]/;
  const LIVE = new Set();          // Gate Run instances on screen
  let seq = 0;
  const BARS = new Set();          // stand-alone cycle bars that follow the cursor
  const spoken = s => String(s || '').replace(/×/g, ' times');
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  // ================================================================================== record helpers ==
  function orderOf(b) { return b && Array.isArray(b.order) ? b.order : []; }
  function evsOf(b) { return b && Array.isArray(b.events) ? b.events.filter(Array.isArray) : []; }
  function evsAt(t, b) { return evsOf(b).filter(e => e[0] === t); }
  function resolve(x) {
    if (x && typeof x === 'object') return x;
    if (x == null || x === '') return cursorRun();
    return runAt(x) || null;
  }
  function around(run, b) { const rs = runsOf(b), i = rs.indexOf(run); return { i, prev: i > 0 ? rs[i - 1] : null, next: i >= 0 && i < rs.length - 1 ? rs[i + 1] : null }; }
  function isLast(run, b) { const l = lastRun(b); return !!run && !!l && run.t === l.t; }
  function seenGr() { return Number(lsGet('ex.gr', 0)) || 0; }
  function markSeen(t) { if (t != null && t > seenGr()) lsSet('ex.gr', t); }
  // A counts-only run (rd == null) names only its triggered coins; each takes its outcome from the events at the
  // same t (blocked r, recorded p, proposed P, notfilled e, bought E), or "outcome not logged" (m) when none says.
  function codeFor(run, c, i, at) {
    if (run.rd != null) return i >= 0 && i < run.rd.length ? run.rd[i] : '-';
    if (own(run.hx, c)) return 'h';
    if (own(run.tg, c)) { const e = at.find(x => x[2] === c && EV_CODE[x[1]]); return e ? EV_CODE[e[1]] : 'm'; }
    return '-';
  }
  function hadSignal(r) { return !!r && !r.x && ((Array.isArray(r.c) && r.c[1] > 0) || Object.keys(r.tg || {}).length > 0 || (r.rd != null && SIGNAL.test(r.rd))); }
  function acted(r, b) {
    if (!r) return false;
    if ((r.rd && r.rd.indexOf('E') >= 0) || (Array.isArray(r.c) && r.c[4] > 0)) return true;
    if (Object.values(r.hx || {}).some(v => /^[tc]/.test(String(v)))) return true;
    return evsAt(r.t, b).some(e => e[1] === 'bought' || e[1] === 'sold' || e[1] === 'trail');
  }
  function nSignals(r) { return !r ? 0 : Math.max(Array.isArray(r.c) ? num(r.c[1]) || 0 : 0, Object.keys(r.tg || {}).length); }
  function sameKey(r, b) { return JSON.stringify([r.rd == null ? null : r.rd, r.tg || {}, !!r.x, evsAt(r.t, b).map(e => JSON.stringify(e.slice(1))).sort()]); }
  function abortOf(run, b) {
    const st = stateOf(b) || {}, last = st.last || {};
    if (last.t === run.t && last.abort) return last.abort;
    const e = evsAt(run.t, b).find(x => x[1] === 'failed');
    return e && e[6] && e[6] !== 'nomark' && e[6] !== 'candles' ? e[6] : null;
  }
  function firstRd(b) { return runsOf(b).find(r => r.rd != null) || null; }
  function bookOf(c, b) { for (const k of (b && Array.isArray(b.books) ? b.books : [])) if ((k.names || []).some(n => (Array.isArray(n) ? n[0] : n) === c)) return k.b; return null; }
  // "on time, 20 min after the 4-hour close" · "ran late, 169 min after the 4-hour close · buys skipped" · "stopped early"
  function runWords(r) {
    if (!r) return '';
    if (r.x) return 'stopped early';
    const lm = r.lm != null ? ', ' + r.lm + ' min after the 4-hour close' : '';
    return (r.h ? 'halted · ' : '') + (r.ok === 0 ? 'ran late' + lm + ' · buys skipped' : 'on time' + lm);
  }

  // ===================================================================================== the model ==
  // Held action words from runs[].hx: t+0.41 trailed · c+2.10 closed · g data gap · ! exit error · ? not logged · k kept
  function hxWords(v) {
    const s = String(v == null ? '?' : v), k = s.charAt(0), x = num(s.slice(1));
    if (k === 't') return ['stop raised', 'stop raised' + (x != null ? (x < 0 ? ', still risks ' : ', locks ') + fmt.R(x) : '')];
    if (k === 'c') return ['sold ' + fmt.R(x), 'sold at ' + fmt.R(x)];
    if (k === 'g') return ['data gap', 'no reading on one timeframe; position and stop kept'];
    if (k === '!') return ['exit error', 'the exit check failed; position kept'];
    if (k === 'k') return ['kept', 'exits checked, nothing to do'];
    return ['no exit action logged', 'held, no exit action logged'];
  }
  function entry(run, c, code, i, at, b) {
    const st = stage(code), d = run.dx && i >= 0 && run.dx[i] != null ? run.dx[i] / 10 : null;
    const ev = at.find(e => e[2] === c && EV_CODE[e[1]] === code) || null;
    let s = st.short, l, q = false;
    switch (code) {
      case 'h': { const v = run.hx && run.hx[c], w = hxWords(v); s = w[0]; l = c + ', held: ' + w[1]; if (!/^[tcg!k]/.test(String(v == null ? '?' : v))) { s = ''; q = true; } break; }
      case 'x': case '!': case 'w': case 'd': l = c + ', stopped at ' + GATES[st.gate].label.toLowerCase() + ': ' + st.w.toLowerCase(); break;
      case 'a': case 'u': s = d != null ? word.dist(d) : st.short; l = c + ', no signal: ' + st.w.toLowerCase() + (d != null ? ', ' + word.dist(d) : ''); break;
      case 't': {
        const n = run === lastRun(b) && b === S.b ? nameOf(c) : null, why = n && Array.isArray(n.elig) && n.elig.length ? word.reasons(n.elig) : '';
        s = 'too thin'; l = c + ', no signal: one flip away but too thin' + (why ? ' (' + why + ')' : '') + (d != null ? ', ' + word.dist(d) : ''); break;
      }
      case 'n': case 'g': case 'm': l = c + ', stopped at the 4-hour signal: ' + st.w.toLowerCase() + (st.note ? ' (' + st.note + ')' : ''); break;
      case 'r': {
        let list = run.rx && Array.isArray(run.rx[c]) ? run.rx[c] : [];
        if (!list.length && ev) list = word.codes(ev[6]);
        s = word.reasons(list) || 'blocked';
        l = c + ', blocked at safety checks: ' + (word.reasons(list, true) || 'a safety check') + (ev && ev[4] === 'A' ? ' (auto grade)' : '');
        break;
      }
      case 'p': l = c + ', recorded at the grade: watch-only grade, not traded'; break;
      case 'P': l = c + ', proposed at the grade (old approval model)'; break;
      case 'e': l = c + ', order not filled'; break;
      case 'E': { const sp = ev && (String(ev[6] || '').match(/stop ([\d.]+)/) || [])[1]; s = 'bought' + (sp ? ' · stop ' + fmt.pctu(sp, 1) + ' below' : ''); l = c + ', bought' + (sp ? ', stop ' + fmt.pctu(sp, 1) + ' below' : ''); break; }
      default: l = c + ': ' + st.w.toLowerCase();
    }
    return { c, code, i, gate: st.gate == null ? -1 : st.gate, s, q, aria: spoken(l) };
  }
  function listCap(list) {
    if (!list.length) return '';
    const codes = [...new Set(list.map(n => n.code))], one = codes.length === 1 ? stage(codes[0]).w.toLowerCase() : '';
    const why = w => w.indexOf('(') >= 0 ? ' · ' + w : ' (' + w + ')';                   // never "(proposed (old model))"
    if (list.length > 3) return 'Stopped here · ' + list.length + (one ? why(one) : '');
    return 'Stopped here · ' + list.length + ': ' + (one ? list.map(n => n.c).join(', ') + why(one) : list.map(n => n.c + why(stage(n.code).short)).join(', '));
  }
  // Row 4's signals line from runs[].tg: "Signal · 1: LINK flip (auto grade)", "Signals · 2: UNI pullback, CRV pullback (watch-only grade)"
  function sigLine(list, run) {
    const tg = run.tg || {}, one = list.filter(n => own(tg, n.c)); if (!one.length) return '';
    const kind = n => ({ f: 'flip', p: 'pullback' })[String(tg[n.c]).charAt(0)] || 'signal', tier = n => String(tg[n.c]).charAt(1);
    const tiers = [...new Set(one.map(tier))], same = tiers.length === 1, tw = t => t === 'A' ? 'auto grade' : t === 'B' ? 'watch-only grade' : 'grade not recorded';
    const shown = one.slice(0, 4).map(n => n.c + ' ' + kind(n) + (same ? '' : ' (' + tw(tier(n)) + ')')).join(', ') + (one.length > 4 ? ' +' + (one.length - 4) : '');
    return (one.length === 1 ? 'Signal' : 'Signals') + ' · ' + one.length + ': ' + shown + (same ? ' (' + tw(tiers[0]) + ')' : '');
  }
  // Everything the Gate Run draws for one run: rows 0–8 with counts, captions and chips (§4.5 survivor maths).
  function model(run, b) {
    const order = orderOf(b), at = evsAt(run.t, b), c = Array.isArray(run.c) ? run.c : [];
    const M = { run, t: run.t, at, failed: !!run.x, late: !run.x && run.ok === 0, counts: run.rd == null, names: [], rows: [] };
    if (!M.counts) for (let i = 0; i < Math.min(order.length, run.rd.length); i++) { const k = run.rd[i]; if (k !== '-') M.names.push(entry(run, order[i], k, i, at, b)); }
    else {
      for (const x of Object.keys(run.hx || {})) M.names.push(entry(run, x, 'h', order.indexOf(x), at, b));
      for (const x of Object.keys(run.tg || {})) if (!own(run.hx, x)) M.names.push(entry(run, x, codeFor(run, x, -1, at), order.indexOf(x), at, b));
    }
    const held = M.names.filter(n => n.code === 'h'), act = M.names.filter(n => n.code !== 'h');
    const cnt = k => act.filter(n => n.code === k).length, stopped = g => act.filter(n => n.gate === g);
    const live = run.m === 'l' || cnt('e') > 0, lastDec = live ? 7 : 6;
    let N, count, deepest;
    if (!M.counts) {
      N = act.length;
      count = g => g === 8 ? cnt('E') : act.filter(n => n.gate > g).length;
      deepest = act.reduce((m, n) => Math.max(m, n.gate), 1);
    } else {
      N = num(c[0]);
      const tgN = Object.keys(run.tg || {}).length, sig = Math.max(num(c[1]) || 0, tgN);
      M.unknown = cnt('m') + Math.max(0, sig - tgN);
      const r4 = sig - M.unknown, r5 = r4 - cnt('r'), r6 = r5 - cnt('p') - cnt('P'), r7 = r6 - cnt('e');
      count = g => g === 1 ? N : g === 2 || g === 3 ? null : g === 4 ? r4 : g === 5 ? r5 : g === 6 ? r6 : g === 7 ? r7 : Math.max(num(c[4]) || 0, cnt('E'));
      deepest = Math.max(N ? 4 : 1, r4 > 0 ? 5 : 0, ...act.map(n => n.gate));
      M.unrec = N != null ? Math.max(0, N - sig) : null;
    }
    M.N = N; M.held = held; M.deepest = deepest;
    M.signals = M.counts ? nSignals(run) : act.filter(n => n.gate >= 5 || n.code === 'g' || n.code === 'm').length;
    M.quiet = !M.failed && !M.signals && !held.some(n => /^(stop raised|sold)/.test(n.s)) && !cnt('E');
    let prev = N;
    for (const G of GATES) {
      if (G.g === 0 && !held.length) continue;
      if (G.g === 7 && !live) continue;
      const row = { g: G.g, label: G.label, cnt: null, prev: null, k: null, kp: null, cap: '', ctx: '', loud: [], muted: [], dim: false, hatch: false };
      if (G.g === 0) {
        row.cnt = M.failed ? null : held.length; row.prev = 0; row.loud = held;
        const q = held.filter(n => n.q).length;                      // the stopgap word goes to the caption, not six chips
        row.cap = 'Held · ' + held.length + ': exits are checked before any new buy' + (q ? ' · no exit action logged' + (q === held.length ? (q > 1 ? ' for any' : '') : ' for ' + held.filter(n => n.q).map(n => n.c).join(', ')) : '');
      } else {
        row.cnt = M.failed ? null : count(G.g);
        // Rows below the deepest gate any name reached dim to "—". Bought still answers "0" once a name reached the
        // last decision (the grade in paper, the fill in live): the question was asked and the answer was no.
        row.dim = !M.failed && G.g > deepest && !(G.g === 8 && deepest >= lastDec);
        row.prev = prev;
        if (N && row.cnt != null) { row.k = Math.max(0, Math.min(1, row.cnt / N)); row.kp = prev != null ? Math.max(0, Math.min(1, prev / N)) : row.k; }
        const here = stopped(G.g);
        if (G.g === 1) { row.loud = here.filter(n => n.code === '!'); row.muted = here.filter(n => n.code !== '!'); row.cap = listCap(here); }
        if (G.g === 2 || G.g === 3) {
          if (M.counts) { row.hatch = !M.failed; row.cap = 'not recorded'; } else { row.muted = here; row.cap = listCap(here); }
        }
        if (G.g === 4) {
          const ord = 'atung';
          row.loud = here.filter(n => n.code === 'm');
          row.muted = here.filter(n => n.code !== 'm').sort((x, y) => ord.indexOf(x.code) - ord.indexOf(y.code) || x.i - y.i);
          row.ctx = sigLine(act.filter(n => n.gate > 4 || n.code === 'm'), run);
          if (M.counts) {
            const p = [];
            if (M.unrec) p.push(M.unrec + ' stopped at weekly, daily or 4-hour (names not recorded)');
            if (M.unknown) p.push('outcome not logged ' + M.unknown);
            row.cap = p.join(' · ');
          } else if (here.length) {
            const k = x => here.filter(n => n.code === x).length, one = k('a') + k('t'), run4 = k('u'), p = [];
            if (one + run4) p.push('no signal on the last bar (' + [one ? one + ' one flip away' : '', run4 ? run4 + ' already running' : ''].filter(Boolean).join(', ') + ')');
            if (k('n')) p.push('not ready ' + k('n'));
            if (k('g')) p.push('close not above the line ' + k('g'));
            if (k('m')) p.push('outcome not logged ' + k('m'));
            row.cap = 'Stopped here · ' + here.length + ': ' + p.join(' · ');
          }
        }
        if (G.g === 5) { row.loud = here; row.keep = M.late; row.cap = M.late ? 'Buys skipped: the data was too late.' + (here.length ? ' ' + listCap(here) : '') : listCap(here); }
        if (G.g === 6) {
          row.loud = here; row.cap = listCap(here);
          const w = String(run.btc || '').charAt(0);
          row.ctx = w === 'B' ? 'Bitcoin weekly bullish: a 4-hour flip is auto grade' : w === 'b' ? 'Bitcoin weekly not bullish: every signal is watch-only' : 'Bitcoin weekly: no reading at this check';
        }
        if (G.g === 7 || G.g === 8) { row.loud = here; if (G.g === 7) row.cap = listCap(here); }
        if (row.cnt != null) prev = row.cnt;
      }
      M.rows.push(row);
    }
    const rs = runsOf(b), idx = rs.indexOf(run), pr = idx > 0 ? rs[idx - 1] : null;
    M.same = !!pr && sameKey(pr, b) === sameKey(run, b);
    if (M.quiet) for (let j = idx - 1; j >= 0; j--) if (hadSignal(rs[j])) { M.lastSig = rs[j]; break; }
    return M;
  }

  // ======================================================================================= drawing ==
  function chipHtml(n, run) {
    return '<button type="button" class="gr-nm stg-edge ' + stage(n.code).cls + '" data-name="' + esc(n.c) + '" data-at="' + esc(run.t) + '" aria-label="' + esc(n.aria) + '">'
      + '<b>' + esc(n.c) + '</b>' + (n.s ? '<span class="s">' + esc(n.s) + '</span>' : '') + '</button>';
  }
  function trayHtml(row, run) {
    const chips = list => list.map(n => chipHtml(n, run)).join('');
    let h = chips(row.loud);
    const m = row.muted;
    if (m.length) {
      if (row.g === 4) {
        const lbl = m.length + (m.length === 1 ? ' name' : ' names') + ' · show';
        h += '<button type="button" class="gr-more" aria-expanded="false" data-l="' + esc(lbl) + '">' + esc(lbl) + '</button><span class="gr-hid" hidden>' + chips(m) + '</span>';
      } else if (m.length > 6) {
        const lbl = '+' + (m.length - 6);
        h += chips(m.slice(0, 6)) + '<button type="button" class="gr-more" aria-expanded="false" data-l="' + esc(lbl) + '" aria-label="Show ' + (m.length - 6) + ' more">' + esc(lbl) + '</button><span class="gr-hid" hidden>' + chips(m.slice(6)) + '</span>';
      } else h += chips(m);
    }
    return h;
  }
  const TIPS = { 4: 'signal', 5: 'checks', 6: 'auto' };
  function rowHtml(row, M) {
    const g = row.g, dash = row.dim || row.cnt == null, v = dash ? '—' : String(row.cnt);
    const vh = g === 0 ? ' held' : dash ? (M.failed ? ' not in this data' : row.hatch ? ' not recorded' : ' no name reached this gate') : row.cnt === 1 ? ' name passes' : ' names pass';
    const tray = !row.dim && !M.failed ? trayHtml(row, M.run) : '';
    const cls = 'gr-row g' + g + (row.dim ? ' gr-dim' : '') + (row.hatch ? ' gr-hatch' : '') + (M.failed ? ' gr-grey' : '') + (g === 8 && row.cnt > 0 && !row.dim ? ' gr-acted' : '');
    return '<li class="' + cls + '" data-gate="' + g + '"' + (row.cnt != null && !dash ? ' data-n="' + row.cnt + '"' : '') + (row.prev != null ? ' data-p="' + row.prev + '"' : '')
      + (row.k != null ? ' data-k="' + row.k.toFixed(4) + '" data-kp="' + row.kp.toFixed(4) + '"' : '') + '>'
      + '<span class="gr-n"><b data-v="' + esc(v) + '">' + esc(v) + '</b><span class="vh">' + vh + '</span></span>'
      + '<span class="gr-sp" aria-hidden="true"><i class="gr-node"></i></span>'
      + '<div class="gr-c"><div class="gr-l">' + esc(row.label) + (TIPS[g] && !M.failed && !row.dim ? tip(TIPS[g]) : '') + '</div>'
      + (row.ctx && !M.failed ? '<div class="gr-ctx">' + esc(row.ctx) + '</div>' : '')
      + (row.cap && (!row.dim || row.keep) && !M.failed ? '<div class="gr-cap">' + esc(row.cap) + '</div>' : '')
      + (g ? '<div class="gr-fl" aria-hidden="true"><i style="--k:' + (row.k != null && !row.dim && !M.failed ? row.k.toFixed(4) : 0) + '"></i></div>' : '')
      + (tray ? '<div class="gr-tray">' + tray + '</div>' : '')
      + '</div></li>';
  }
  // The cycle bar: the last 12 checks (missed slots dashed) as 32px round buttons with a 44px hit area (.hit).
  function barItems(b, selT) {
    const rs = runsOf(b); if (!rs.length) return [];
    const have = new Set(rs.map(r => r.s)), items = rs.map(r => ({ run: r, t: r.t, s: r.s }));
    const first = Math.min(...rs.map(r => r.s)), last = Math.max(...rs.map(r => r.s));
    const end = Math.max(last, Math.floor((nowS() - BAR) / BAR) * BAR);            // slots whose whole 4-hour window passed
    for (let s = first + BAR; s <= end; s += BAR) if (!have.has(s)) items.push({ miss: true, s, t: s });
    items.sort((x, y) => x.t - y.t);
    const at = items.findIndex(it => !it.miss && it.t === selT);                  // keep an older selection in the window
    return at >= 0 && at < items.length - 12 ? items.slice(Math.max(0, at - 6), Math.max(0, at - 6) + 12) : items.slice(-12);
  }
  function barHtml(b, selT) {
    const items = barItems(b, selT);
    if (!items.length) return '';
    const lag = (clock(b).lag || 20) * 60;
    return '<div class="cycbar gr-cycbar" aria-label="Recent checks">' + items.map(it => {
      if (it.miss) return '<button type="button" class="gr-cb hit miss" data-tip="' + esc('No check was recorded for the ' + fmt.when(it.s) + ' close (' + fmt.utc(it.s) + ').') + '" aria-label="' + esc('Missed: no check for the ' + fmt.when(it.s) + ' close') + '">' + esc(fmt.hr(it.s + lag)) + '</button>';
      const r = it.run, h = r.x ? 'fail' : r.ok === 0 ? 'late' : 'ok', sig = hadSignal(r), a = acted(r, b), n = nSignals(r);
      const lbl = fmt.when(r.t) + ' check: ' + word.run(r).w + ', ' + (n ? word.plural(n, 'signal') : 'no signals') + ', ' + (a ? 'the bot acted' : 'nothing bought');
      return '<button type="button" class="gr-cb hit ' + h + (sig ? ' sig' : '') + (a ? ' act' : '') + '" data-cursor="' + r.t + '" aria-pressed="' + (r.t === selT) + '" aria-label="' + esc(lbl) + '">' + esc(fmt.hr(r.t)) + '</button>';
    }).join('') + '</div>';
  }
  function settleBar(root) {
    const bar = root && $('.gr-cycbar', root); if (!bar) return;
    const go = () => {
      if (!bar.isConnected) return;
      bar.scrollLeft = bar.scrollWidth;
      const on = $('[aria-pressed=true]', bar);
      if (on && on.offsetLeft < bar.scrollLeft) bar.scrollLeft = Math.max(0, on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2);
      masks(root);
    };
    go(); requestAnimationFrame(go);
  }
  function headHtml(M, inst, b) {
    const run = M.run, latest = isLast(run, b), o = inst.opts;
    const acts = [];
    if (!o.sheet && inst.follow && S.cursor != null && !latest) acts.push('<button type="button" class="btn small gr-back">Back to latest</button>');
    if (!M.failed && M.rows.some(r => !r.dim)) acts.push(reduced
      ? '<button type="button" class="btn small gr-step" aria-label="Show the next gate">Step ›</button>'
      : '<button type="button" class="btn small gr-play">' + ICON.play + 'Replay</button>');
    const sub = esc(fmt.when(run.t)) + ' · ' + esc(runWords(run)) + ' · replayed from the record';
    if (o.sheet) return acts.length ? '<div class="gr-acts"><span class="sub">Replayed from the record' + tip('gateRun') + '</span>' + acts.join('') + '</div>' : '';
    return '<div class="head gr-head"><div class="ttl"><h2>' + (latest ? 'Last check' : 'Check at ' + esc(fmt.when(run.t))) + tip('gateRun') + '</h2><div class="sub">' + sub + '</div></div>'
      + (acts.length ? '<div class="acts">' + acts.join('') + '</div>' : '') + '</div>';
  }
  function bodyHtml(inst) {
    const b = S.b, o = inst.opts, h2 = o.sheet ? '' : '<div class="head gr-head"><div class="ttl"><h2>Last check' + tip('gateRun') + '</h2></div></div>';
    inst.run = null;
    if (!b) return '';
    if (!Array.isArray(b.runs)) return h2 + '<div class="empty">Recorded checks: ' + na() + '</div>';
    const run = inst.follow ? resolve(null) : resolve(inst.fixed);
    if (!run) return h2 + '<div class="empty">' + (runsOf(b).length ? 'This check is no longer in the 7-day record.' : 'The first check will be replayed here.') + '</div>';
    inst.run = run;
    const M = inst.M = model(run, b), x = [headHtml(M, inst, b)];
    if (M.same) x.push('<p class="gr-same cap">Same as the previous check.</p>');
    if (o.bar !== false) x.push(barHtml(b, run.t));
    if (M.failed) { const ab = abortOf(run, b); x.push(banner('bad', 'This check stopped early' + (ab ? ' (' + esc(ab) + ')' : '') + '. Exits may not have been checked.')); }
    x.push('<ol class="gr-gates" data-n="' + (M.N || 0) + '" aria-label="' + esc('Gates of the ' + fmt.when(run.t) + ' check, in the engine’s order') + '">' + M.rows.map(r => rowHtml(r, M)).join('') + '</ol>');
    if (M.quiet && M.lastSig) x.push('<p class="gr-quiet">Quiet check. <button type="button" class="gr-link hit" data-cursor="' + M.lastSig.t + '" data-scroll>Last check with a signal: ' + esc(fmt.when(M.lastSig.t)) + ' ›</button></p>');
    else if (M.quiet) x.push('<p class="gr-quiet">Quiet check. No signal in the recorded checks before it.</p>');
    if (M.counts && !M.failed) {
      const f = firstRd(b);
      x.push('<p class="gr-foot cap">Names were not recorded for this check' + (f ? '; per-name readings start ' + esc(fmt.stamp(f.t)) : '') + '.</p>');
    } else if (!M.failed) x.push('<p class="gr-foot cap">Replayed from the record of the ' + esc(fmt.when(run.t)) + ' check. Every name, every gate, as the engine logged it.</p>');
    return x.join('');
  }

  // ==================================================================================== the replay ==
  function anim(inst, el, kf, o) { if (!el || typeof el.animate !== 'function') return null; try { const a = el.animate(kf, o); inst.anims.push(a); return a; } catch (e) { return null; } }
  function later(inst, ms, fn) { inst.timers.push(setTimeout(() => call(fn), ms)); }
  function rowsToPlay(inst) { return $$('.gr-gates > .gr-row', inst.el).filter(r => !r.classList.contains('gr-dim') && !r.classList.contains('gr-grey')); }
  function makeCluster(ol, n) {
    const c = document.createElement('div');
    c.className = 'gr-clu' + (n > 20 ? ' num' : ''); c.setAttribute('aria-hidden', 'true');
    c.innerHTML = n > 20 ? '<b>' + n + '</b>' : '<i></i>'.repeat(Math.max(0, n));
    ol.appendChild(c);
    return c;
  }
  function placeCluster(clu, row, move) {
    const node = $('.gr-node', row), ol = clu.parentNode; if (!node || !ol) return;
    const nr = node.getBoundingClientRect(), or = ol.getBoundingClientRect();
    const x = nr.left + nr.width / 2 - or.left - clu.offsetWidth / 2, y = nr.top + nr.height / 2 - or.top - Math.min(clu.offsetHeight / 2, 11);
    clu.style.transition = move ? 'transform ' + MOVE + 'ms ' + EASE + ',opacity var(--dur-1)' : 'opacity var(--dur-1)';
    clu.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    clu.classList.add('on');
  }
  function thinCluster(inst, clu, keep) {
    if (!clu || keep == null) return;
    if (clu.classList.contains('num')) { const b = $('b', clu); if (b) b.textContent = String(keep); return; }
    [...clu.children].slice(keep).forEach(d => {
      if (d._gone) return; d._gone = true;
      if (!anim(inst, d, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4)' }], { duration: 180, fill: 'forwards' })) d.remove();
      else later(inst, 190, () => d.remove());
    });
  }
  // Reveal one gate: the node pops, the count counts, the bar scales from the previous ratio, the chips enter.
  function reveal(inst, row, instant, clu) {
    if (!row) return;
    row.classList.remove('gr-pend');
    if (instant || reduced) return;
    const n = $('.gr-n b', row), to = num(row.dataset.n), from = num(row.dataset.p), k = num(row.dataset.k), kp = num(row.dataset.kp);
    anim(inst, $('.gr-node', row), [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: .45 }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-out' });
    if (n && to != null && from != null && from !== to) countUp(n, to, { from, ms: 240 });
    const fill = $('.gr-fl i', row);
    if (fill && k != null) anim(inst, fill, [{ transform: 'scaleX(' + (kp != null ? kp : k) + ')' }, { transform: 'scaleX(' + k + ')' }], { duration: 240, easing: EASE });
    $$('.gr-tray > .gr-nm, .gr-tray > .gr-more', row).forEach((c, i) => anim(inst, c,
      [{ opacity: 0, transform: 'translateX(-24px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: Math.min(i * 25, 250), easing: EASE, fill: 'backwards' }));
    if (clu && row.dataset.gate !== '0') thinCluster(inst, clu, to);
    if (row.dataset.gate === '8') $$('.gr-nm.st-E', row).forEach(c => { c.classList.remove('pulse1'); void c.offsetWidth; c.classList.add('pulse1'); });
  }
  function play(inst) {
    if (reduced || !inst.el.isConnected) return;
    stop(inst);
    const ol = $('.gr-gates', inst.el), rows = rowsToPlay(inst);
    if (!ol || !rows.length) return;
    inst.playing = true; inst.pending = null; inst.stepAt = null;
    setPlay(inst.key, true);
    inst.el.classList.add('gr-playing');
    rows.forEach(r => r.classList.add('gr-pend'));
    const K = rows.length, step = K > 1 ? Math.min(STEP, (TOTAL - TAIL) / (K - 1)) : STEP;
    const first = rows.findIndex(r => r.dataset.gate !== '0');
    const clu = first >= 0 ? makeCluster(ol, Number(ol.dataset.n) || 0) : null;
    rows.forEach((r, i) => {
      const T = i * step;
      if (clu && i === first) later(inst, 0, () => placeCluster(clu, r, false));
      else if (clu && i > first) later(inst, Math.max(0, T - MOVE), () => placeCluster(clu, r, true));
      later(inst, T, () => reveal(inst, r, false, clu));
    });
    const end = (K - 1) * step;
    if (clu) later(inst, end + 320, () => { clu.classList.remove('on'); });
    later(inst, end + TAIL, () => stop(inst));
  }
  // Skip to the final state (a tap on the card, the page hiding, a re-render) and remove the cluster.
  function stop(inst) {
    inst.timers.forEach(clearTimeout); inst.timers = [];
    inst.anims.forEach(a => { try { a.cancel(); } catch (e) {} }); inst.anims = [];
    $$('.gr-pend', inst.el).forEach(r => r.classList.remove('gr-pend'));
    $$('.gr-n b', inst.el).forEach(b => { b._cu = (b._cu || 0) + 1; if (b.dataset.v != null) b.textContent = b.dataset.v; });
    $$('.gr-clu', inst.el).forEach(c => c.remove());
    inst.el.classList.remove('gr-playing');
    if (inst.playing) { inst.playing = false; setPlay(inst.key, false); if (inst.run) markSeen(inst.run.t); }
  }
  // Reduced motion: final state only; "Step ›" reveals one gate per tap and the rows below it stay dimmed.
  function stepOnce(inst) {
    const rows = rowsToPlay(inst); if (!rows.length) return;
    if (inst.stepAt == null) { inst.stepAt = 0; rows.forEach(r => r.classList.add('gr-pend')); }
    reveal(inst, rows[inst.stepAt], true);
    inst.stepAt++;
    const btn = $('.gr-step', inst.el);
    if (inst.stepAt >= rows.length) { inst.stepAt = null; if (btn) btn.setAttribute('aria-label', 'Step through the gates again'); }
    else if (btn) btn.setAttribute('aria-label', 'Show the next gate (' + (inst.stepAt + 1) + ' of ' + rows.length + ')');
    if (inst.run) markSeen(inst.run.t);
  }
  // At least half of the card on screen (§4.5). Only a card taller than two screens, which can never be half in view,
  // falls back to filling the whole screen.
  function inView(el) {
    const r = el.getBoundingClientRect(), vh = innerHeight || document.documentElement.clientHeight;
    const vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return r.height > 0 && (vis >= .5 * r.height || (r.height > 2 * vh && vis >= vh));
  }
  // Autoplay (§4.5): once, for a run newer than ex.gr that differs from the one before it, at ≥50% in view, page
  // visible, motion allowed. An explicit request (opts.play, an explicit cursor move) skips the first two rules.
  function maybePlay(inst) {
    if (!inst.pending || inst.playing || !inst.el.isConnected) return;
    if (document.hidden || reduced) return;
    if (!inst.opts.sheet && S.sheet) { if (inst.pending === 'explicit') inst.pending = null; return; }
    if (!inView(inst.el)) return;
    play(inst);
  }
  let io = null;
  function observe(inst) {
    if (!('IntersectionObserver' in window) || inst.observed) return;
    io = io || new IntersectionObserver(es => { for (const e of es) { const i = e.target._gr; if (i) maybePlay(i); } }, { threshold: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1] });
    io.observe(inst.el); inst.observed = true;
  }
  function prune() {
    for (const i of LIVE) if (!i.el.isConnected) { stop(i); if (io && i.observed) io.unobserve(i.el); i.observed = false; LIVE.delete(i); }
    for (const e of BARS) if (!e.isConnected) BARS.delete(e);
  }

  // ================================================================================= the component ==
  function draw(inst, want) {
    stop(inst);
    inst.stepAt = null; inst.pending = null; inst.M = null;
    inst.el.innerHTML = safe(() => bodyHtml(inst), 'Gate Run');
    settleBar(inst.el);
    const run = inst.run, M = inst.M;
    if (!run || !M || M.failed || reduced) { if (run && M && M.failed) markSeen(run.t); return; }
    if (want) inst.pending = 'explicit';
    else if (inst.opts.autoplay !== false && !inst.opts.sheet && run.t > seenGr()) { if (M.same) markSeen(run.t); else inst.pending = 'auto'; }
    if (inst.pending) setTimeout(() => maybePlay(inst), 30);           // after the click that caused it (a sheet may open)
  }
  function wire(inst) {
    inst.el.addEventListener('click', e => {
      if (inst.playing) { e.preventDefault(); e.stopPropagation(); stop(inst); return; }     // a tap anywhere skips
      const t = e.target; if (!(t instanceof Element)) return;
      const more = t.closest('.gr-more');
      if (more) {
        e.preventDefault();
        const nx = more.nextElementSibling, pv = more.previousElementSibling;
        const hid = nx && nx.classList.contains('gr-hid') ? nx : pv && pv.classList.contains('gr-hid') ? pv : null;
        if (!hid) return;
        const open = more.getAttribute('aria-expanded') !== 'true';
        hid.hidden = !open; more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'hide' : more.dataset.l;
        if (open) hid.after(more); else hid.before(more);
        return;
      }
      if (t.closest('.gr-play')) { e.preventDefault(); inst.pending = null; play(inst); return; }
      if (t.closest('.gr-step')) { e.preventDefault(); stepOnce(inst); return; }
      if (t.closest('.gr-back')) { e.preventDefault(); setCursor(null, {}); }
    });
  }
  function control(inst) {
    return { el: inst.el, run: () => inst.run, play: () => play(inst), skip: () => stop(inst), step: () => stepOnce(inst), redraw: () => draw(inst, null) };
  }
  function gateRun(el, x, opts) {
    if (!el) return null;
    opts = Object.assign({ autoplay: true, sheet: false, bar: true }, opts || {});
    let inst = el._gr;
    if (!inst) { inst = el._gr = { el, timers: [], anims: [], key: 'gr' + (++seq) }; wire(inst); }
    inst.opts = opts;
    inst.follow = opts.follow != null ? !!opts.follow : (x == null || x === '');
    inst.fixed = inst.follow ? null : x;
    el.classList.add('gr');
    if (opts.sheet) el.classList.add('gr-insheet');
    else if (!el.id && !document.getElementById('now-gaterun')) el.id = 'now-gaterun';
    prune(); LIVE.add(inst); observe(inst);
    draw(inst, opts.play ? 'explicit' : null);
    return control(inst);
  }
  COMP.gateRun = gateRun;
  COMP.cycleBar = function (el) {
    const b = S.b, r = cursorRun(), h = b ? barHtml(b, r && r.t) : '';
    if (!el) return h;
    el.innerHTML = h; BARS.add(el); settleBar(el);
    return h;
  };
  // Followers of the shared cursor (§5): the Gate Run replays on an explicit move; stand-alone bars re-mark.
  onCursor((t, prev, o) => {
    prune();
    for (const inst of LIVE) if (inst.follow) draw(inst, o && o.explicit ? 'explicit' : null);
    for (const el of BARS) COMP.cycleBar(el);
  });
  hook('hide', () => { for (const i of LIVE) stop(i); });
  hook('show', () => { for (const i of LIVE) maybePlay(i); });
  hook('tick30s', () => { prune(); for (const i of LIVE) maybePlay(i); });

  // ================================================================================== cycle sheet ==
  function evList(list) {
    if (!list.length) return '<p class="note">No events were recorded for this check.</p>';
    return '<ul class="list gr-evs">' + list.map(e => {
      const w = word.event(e);
      return '<li class="gr-ev lv' + w.lv + '"><span class="gr-et">' + esc(fmt.when(e[0])) + '</span><span class="gr-ei" aria-hidden="true">' + icon(w.ic) + '</span><span class="gr-es">' + w.html + '</span></li>';
    }).join('') + '</ul>';
  }
  // Runs already replayed while the sheet stayed open: previous/next plays a new run, but a refresh on arrival or a
  // "‹ Back" to this sheet does not replay. core adds .on in the next frame, so a fresh open has no .on in after().
  let sheetTs = new Set();
  SHEETS.cycle = function (arg) {
    const b = S.b || {}, rs = runsOf(b);
    const run = arg == null || arg === '' ? lastRun(b) : runAt(arg);
    if (!run) return '<h2>Check</h2><div class="empty">' + (!Array.isArray(b.runs) ? 'Recorded checks: ' + na() : rs.length ? 'This check is no longer in the 7-day record.' : 'The first check will be replayed here.') + '</div>';
    const nb = around(run, b), slot = rs.filter(r => r.s === run.s);
    const x = ['<h2>Check at ' + esc(fmt.when(run.t)) + '<span class="gr-h2s"><span class="vh"> · </span>' + esc(word.run(run).s) + '</span></h2>'];
    if (slot.length > 1) x.push('<div class="gr-slot"><p class="cap">' + slot.length + ' checks for the ' + esc(fmt.when(run.s)) + ' close</p><div class="seg quiet" role="group" aria-label="Checks for this close"><span class="ind"></span>'
      + slot.map(r => '<button type="button" data-cursor="' + r.t + '" data-v="' + r.t + '" aria-pressed="' + (r.t === run.t) + '">' + esc(fmt.time(r.t)) + '</button>').join('') + '</div></div>');
    x.push('<div class="gr-sheethost"></div>');
    const at = evsAt(run.t, b).sort((p, q) => (q[5] || 0) - (p[5] || 0));
    x.push('<div class="sec"><h3>Events of this check</h3>' + evList(at) + '</div>');
    x.push('<div class="pn">' + (nb.prev ? '<button type="button" class="btn small" data-cursor="' + nb.prev.t + '">‹ Previous check</button>' : '<button type="button" class="btn small" disabled>‹ Previous check</button>')
      + (nb.next ? '<button type="button" class="btn small" data-cursor="' + nb.next.t + '">Next check ›</button>' : '<button type="button" class="btn small" disabled>Next check ›</button>') + '</div>');
    return {
      html: x.join(''), cls: 'gr-sh',
      after(s) {
        const host = $('.gr-sheethost', s);
        if (!s.classList.contains('on')) sheetTs = new Set();
        const play = !sheetTs.has(run.t); sheetTs.add(run.t);
        const ctl = gateRun(host, run, { sheet: true, play });
        return () => { if (ctl) ctl.skip(); };
      },
    };
  };

  // =================================================================================== name sheet ==
  // As at a recorded run, the stage says what the engine saw; the directions that stage implies are words, not guesses.
  const IMPLIED = {
    w: 'weekly not bullish (daily and 4-hour not needed)', d: 'weekly bullish · daily not bullish', n: 'weekly and daily bullish · 4-hour not ready',
    a: 'weekly and daily bullish · 4-hour bearish', t: 'weekly and daily bullish · 4-hour bearish', u: 'weekly, daily and 4-hour bullish',
    g: 'weekly and daily bullish · 4-hour signal', m: 'weekly and daily bullish · 4-hour signal', r: 'weekly and daily bullish · 4-hour signal',
    p: 'weekly and daily bullish · 4-hour signal', P: 'weekly and daily bullish · 4-hour signal', e: 'weekly and daily bullish · 4-hour signal', E: 'weekly and daily bullish · 4-hour signal',
  };
  function mark(ok) { return ok ? ' <span class="gr-ok">✓<span class="vh"> passes</span></span>' : ' <span class="gr-no">✕<span class="vh"> fails</span></span>'; }
  function filtersHtml(nm, b) {
    if (!nm || !Array.isArray(nm.elig)) return '<p class="note">Filters: ' + na() + (nm && nm.grp === 'held' ? ' (not read while held)' : '') + '</p>';
    const u = (b.cfg && b.cfg.uni) || {}, fail = new Map(nm.elig.map(p => [p[0], p[1]])), li = [];
    li.push(nm.vx != null ? 'Volume ' + esc(fmt.x(nm.vx)) + ' the minimum' + mark(!fail.has('vol')) : 'Volume ' + na(true));
    li.push(nm.fund != null ? 'Funding ' + esc(fmt.fund(nm.fund)) + (u.fund_pct != null ? ' (limit ' + esc(u.fund_pct) + ')' : '') + mark(!fail.has('fund')) : 'Funding ' + na(true));
    li.push(nm.days != null ? (fail.has('days') ? 'Only ' + esc(fmt.int(nm.days)) + ' days of history' + (u.days != null ? ' (needs ' + esc(u.days) + ')' : '') : 'History ' + esc(fmt.int(nm.days)) + ' days') + mark(!fail.has('days')) : 'History ' + na(true));
    li.push(nm.ox != null ? 'Open interest ' + esc(fmt.x(nm.ox)) + ' the minimum' + mark(!fail.has('oi')) : 'Open interest: checked when a signal fires');
    if (fail.has('lev')) li.push(esc(cap1(word.reason('lev', fail.get('lev'), true))) + mark(false));
    return '<ul class="list gr-filt">' + li.map(s => '<li>' + s + '</li>').join('') + '</ul>';
  }
  // The name's tape row, enlarged: the last 7 local days × the 6 four-hour closes, one 44px button per recorded check.
  function tapeHtml(c, b, selT) {
    const rs = runsOf(b); if (!rs.length) return '<p class="note">' + (Array.isArray(b.runs) ? 'No checks in this data yet.' : 'Recorded checks: ' + na()) + '</p>';
    const order = orderOf(b), i = order.indexOf(c), per = new Map();
    for (const r of rs) { const cur = per.get(r.s); if (!cur || r.t > cur.t) per.set(r.s, r); }
    const firstS = Math.min(...rs.map(r => r.s)), now = nowS(), d0 = new Date(nowMs()); d0.setHours(0, 0, 0, 0);
    const days = []; for (let k = 6; k >= 0; k--) { const d = new Date(d0); d.setDate(d.getDate() - k); days.push(d); }
    const key = d => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(), rowOf = new Map(days.map((d, k) => [key(d), k]));
    const grid = days.map(() => Array(6).fill(null)), heads = Array(6).fill('');
    for (let s = Math.floor(days[0].getTime() / 1000 / BAR) * BAR; s <= now; s += BAR) {
      const d = new Date(s * 1000), k = rowOf.get(key(d)); if (k == null) continue;
      const col = Math.min(5, Math.floor((d.getHours() * 60 + d.getMinutes()) / 240));
      grid[k][col] = s; heads[col] = fmt.hr(s);
    }
    const seen = new Set();
    let missed = false;
    let h = '<div class="gr-tape" role="group" aria-label="' + esc(c + ' at each check of the last 7 days') + '"><span></span>' + heads.map(x => '<span class="gr-th">' + esc(x) + '</span>').join('');
    grid.forEach((row, k) => {
      h += '<span class="gr-td">' + esc(fmt.wd(days[k].getTime() / 1000)) + '</span>';
      row.forEach(s => {
        const r = s == null ? null : per.get(s);
        if (!r) {
          const miss = s != null && s > firstS && s + BAR <= now;
          if (miss) missed = true;
          h += miss ? '<span class="gr-tc gr-miss" role="img" aria-label="' + esc('Missed: no check for the ' + fmt.when(s) + ' close') + '"><i></i></span>' : '<span class="gr-tc gr-blank"><i></i></span>';
          return;
        }
        const code = codeFor(r, c, i, evsAt(r.t, b)), st = stage(code); seen.add(code);
        h += '<button type="button" class="gr-tc' + (r.x ? ' gr-fail' : '') + (r.t === selT ? ' on' : '') + '" data-cycle="' + r.t + '" aria-label="' + esc(fmt.when(r.t) + ': ' + (r.x ? 'check stopped early' : st.w)) + '"><i class="stg-cell ' + st.cls + '"></i></button>';
      });
    });
    h += '</div>';
    const lg = [...seen].sort((p, q) => (stage(p).gate ?? 9) - (stage(q).gate ?? 9));
    return h + '<div class="gr-lg">' + lg.map(k => '<span><i class="stg-cell ' + stage(k).cls + '"></i>' + esc(stage(k).short) + '</span>').join('')
      + (missed ? '<span><i class="gr-lgmiss"></i>missed</span>' : '') + '</div><p class="cap">Tap a check to open it.</p>';
  }
  // Check lights (§9.1): cfg.checks in pre-trade order, then Policy, then Fill (live). A refusal record stores only
  // what failed, so every other light is dashed "not recorded" and is never shown as passed. The engine names each
  // check by its passing condition ("sizing accepted"); a light shows the check's neutral name instead ("Sizing"),
  // so an unrecorded one never reads as a pass.
  const NOUN = { 'not halted': 'Halt', 'throttle allows entries': 'Throttle', 'data fresh and run on time': 'Data freshness',
    'no reconciliation mismatch': 'Reconciliation', 'sizing accepted': 'Sizing', 'no open position in this coin': 'One position per coin',
    'below max positions': 'Max positions', 'equity positive': 'Equity', 'open-risk cap': 'Open-risk cap', 'gross exposure cap': 'Gross exposure cap',
    'book open-risk cap': 'Book risk cap', 'price sanity band': 'Price sanity band', 'universe filters': 'Universe filters' };
  const noun = n => NOUN[n] || cap1(n);
  function lightsHtml(ev, b, c) {
    const cfg = b.cfg || {}, checks = Array.isArray(cfg.checks) ? cfg.checks : [], ty = ev[1], tier = ev[4], run = runAt(ev[0]);
    let codes = ty === 'blocked' ? word.codes(ev[6]) : [];
    if (ty === 'blocked' && !codes.length && run && run.rx && Array.isArray(run.rx[c])) codes = run.rx[c];
    const by = {}, extra = [];
    for (const p of codes) { const nmx = CHECK_OF[p[0]]; if (nmx && checks.indexOf(nmx) >= 0) (by[nmx] = by[nmx] || []).push(p); else extra.push(p); }
    const L = checks.map(n => by[n] ? { k: 'bad', w: noun(n) + ': ' + word.reasons(by[n], true), a: noun(n) + ': failed, ' + word.reasons(by[n], true) } : { k: 'nr', w: noun(n), a: noun(n) + ': not recorded' });
    for (const p of extra) L.push({ k: 'bad', w: cap1(word.reason(p[0], p[1], true)), a: word.reason(p[0], p[1], true) + ': failed' });
    L.push(ty === 'blocked' ? { k: 'nr', w: 'Policy', a: 'Policy: not reached' }
      : ty === 'recorded' ? { k: 'on', w: tier === 'A' ? 'Policy: auto grade buys on its own' : 'Policy: watch-only, recorded', a: 'Policy stopped it: ' + (tier === 'A' ? 'auto grade' : 'watch-only grade, recorded, not traded') }
      : ty === 'proposed' ? { k: 'on', w: 'Policy: proposed for approval (old model)', a: 'Policy: proposed for approval under the old model' }
      : { k: 'nr', w: 'Policy', a: 'Policy: not recorded' });
    if (ty === 'notfilled' || (run && run.m === 'l')) L.push(ty === 'notfilled' ? { k: 'bad', w: 'Fill: order not filled', a: 'Fill: order not filled' } : { k: 'nr', w: 'Fill', a: 'Fill: not reached' });
    return '<ol class="list gr-lights">' + L.map(x => '<li class="gr-lt ' + x.k + '" aria-label="' + esc(spoken(x.a)) + '"><i class="step' + (x.k === 'bad' ? ' FAIL' : '') + '"></i><span>' + esc(x.w) + '</span></li>').join('') + '</ol>';
  }
  SHEETS.name = function (coin, el) {
    const b = S.b || {}, c = String(coin || ''), order = orderOf(b), i = order.indexOf(c), last = lastRun(b);
    const atRaw = el && el.dataset ? el.dataset.at : null, atT = atRaw != null && atRaw !== '' ? Number(atRaw) : null;
    const atRun = atT != null ? runAt(atT) : null, asAt = atRun && last && atRun.t !== last.t ? atRun : null;
    const nm = nameOf(c), ref = asAt || last;
    const code = asAt ? codeFor(asAt, c, i, evsAt(asAt.t, b)) : nm ? (nm.st || '-') : ref ? codeFor(ref, c, i, evsAt(ref.t, b)) : '-';
    const st = stage(code), grp = asAt ? st.grp : nm ? nm.grp : st.grp, book = (nm && nm.b) || bookOf(c, b);
    const x = [];
    x.push('<h2 class="gr-nh"><span class="gr-coin">' + esc(c) + '</span></h2>');
    x.push('<div class="gr-meta">' + (book ? '<span class="pill">' + esc(book) + '</span>' : '') + (grp && GRP[grp] ? '<span class="pill"><i class="stg-dot ' + st.cls + '"></i>' + esc(GRP[grp]) + '</span>' : '')
      + '<span class="sub">' + (asAt ? 'as at ' + esc(fmt.when(asAt.t)) + ', recorded' : ref ? 'as of ' + esc(fmt.when(ref.t)) : na(true)) + '</span></div>');
    const sx = [];
    if (asAt) {
      const d = asAt.dx && i >= 0 && asAt.dx[i] != null ? asAt.dx[i] / 10 : null;
      sx.push('<p class="gr-stage"><i class="stg-dot ' + st.cls + '"></i><b>' + esc(st.w) + '</b>' + (st.note ? ' <span class="sub">(' + esc(st.note) + ')</span>' : '') + '</p>');
      if (IMPLIED[code]) sx.push('<p class="ink2">' + esc(cap1(IMPLIED[code])) + '<span class="sub"> · from the recorded stage</span></p>');
      if (d != null) sx.push('<p class="ink2">' + esc(cap1(word.dist(d))) + ' <span class="sub">(from the close then)</span></p>');
      if (asAt.rd == null) sx.push('<p class="note">Names were not recorded for this check; only signals and their outcomes were.</p>');
    } else if (nm && nm.grp === 'held') {
      const p = (Array.isArray(b.pos) ? b.pos : []).find(q => q.c === c);
      sx.push('<p class="gr-stage"><i class="stg-dot st-h"></i><b>Held</b> · readings are not taken while a position is open; its exits are checked first.</p>');
      if (p) sx.push('<p class="ink2">' + (p.to_stop_pct == null ? 'Stop distance ' + na(true) : p.to_stop_pct < 0 ? 'At or through the stop; checked next cycle' : esc(cap1(word.dist(p.to_stop_pct, true)))) + ' <button type="button" class="btn small" data-pos="' + esc(p.id) + '">Open position ›</button></p>');
    } else if (nm) {
      const dir = (k, v) => '<span class="pill ' + (v === 1 ? 'bull' : v === 0 ? 'bear' : 'mute') + '">' + k + ' ' + esc(word.dir(v)) + '</span>';
      sx.push('<p class="gr-dirs">' + dir('Weekly', nm.w) + dir('Daily', nm.d) + dir('4-hour', nm.h4) + '</p>');
      const d = num(nm.dist);
      if (d != null && d > 0) sx.push('<p>Needs a 4-hour close up to <b>' + esc(fmt.pctu(d, 1)) + '</b> higher to flip' + tip('needs') + '</p>');
      else if (d != null && d < 0) sx.push('<p>Cushion <b>' + esc(fmt.pctu(d, 1)) + '</b>: the last 4-hour close sits that far above the line' + tip('cushion') + '</p>');
      else if (d == null) sx.push('<p>Distance to the line ' + na() + '</p>');
      if (nm.h4 === 1) sx.push('<p class="ink2">Range: ' + esc(word.range(nm.rg)) + ' <span class="sub">(matters only for a watch-only pullback)</span>' + tip('pullback') + '</p>');
      if (nm.sig) { const sp = String(nm.sig).split(' '); sx.push('<p class="ink2">Signal at this check: ' + esc(word.kind(sp[0], true)) + ', ' + esc(word.tier(sp[1]).toLowerCase()) + '</p>'); }
      sx.push('<p class="gr-stage"><i class="stg-dot ' + st.cls + '"></i>' + esc(st.w) + (code === 'a' ? tip('oneflip') : code === 't' ? tip('thin') : '') + '</p>');
    } else if (!Array.isArray(b.names)) sx.push('<p class="note">Readings: ' + na() + '</p>');
    else sx.push('<p class="note">Not in the last check' + (ref ? ' (' + esc(fmt.when(ref.t)) + ')' : '') + '.</p>');
    x.push('<div class="sec"><h3>State</h3>' + sx.join('') + '</div>');
    x.push('<div class="sec"><h3>Filters' + (asAt ? ' · now' : '') + '</h3>' + filtersHtml(nm, b) + '</div>');
    x.push('<div class="sec"><h3>At each check</h3>' + tapeHtml(c, b, asAt ? asAt.t : null) + '</div>');
    // check lights: the record at this run if any, else the newest blocked / recorded / proposed / not-filled record
    const recs = evsOf(b).filter(e => e[2] === c && (e[1] === 'blocked' || e[1] === 'recorded' || e[1] === 'proposed' || e[1] === 'notfilled'));
    const ev = (atT != null && recs.find(e => e[0] === atT)) || recs[0];
    if (ev) {
      const others = recs.filter(e => e !== ev).slice(0, 4);
      x.push('<div class="sec"><h3>Check lights · ' + esc(fmt.when(ev[0])) + '</h3><p class="ink2 gr-lcap">' + esc(word.outcome(ev[1])) + ' · ' + esc(word.kind(ev[3], true)) + ', ' + esc(word.tier(ev[4]).toLowerCase()) + '</p>'
        + '<p class="cap gr-lkey"><i class="step gr-lnr" aria-hidden="true"></i>Dashed: not recorded. This record keeps only what stopped it, so no other check is shown as passed.</p>' + lightsHtml(ev, b, c)
        + (others.length ? '<p class="gr-other">Other records: ' + others.map(e => '<button type="button" class="tk" data-name="' + esc(c) + '" data-at="' + e[0] + '">' + esc(fmt.when(e[0])) + '</button>').join(' ') + '</p>' : '') + '</div>');
    }
    const mine = evsOf(b).filter(e => e[2] === c).slice(0, 12);
    x.push('<div class="sec"><h3>Its events</h3>' + (mine.length ? evList(mine) : '<p class="note">No events for ' + esc(c) + ' in the last 7 days.</p>') + '</div>');
    if (nm && nm.px && (nm.px.line != null || nm.px.close != null)) x.push('<div class="sec"><h3>Market prices</h3><p class="gr-px">4-hour line ' + esc(fmt.px(nm.px.line)) + ' · last close ' + esc(fmt.px(nm.px.close))
      + ' <span class="cap">(market prices, not your money' + (asAt && last ? '; from the ' + esc(fmt.when(last.t)) + ' check' : '') + ')</span></p></div>');
    return {
      html: x.join(''), cls: 'gr-sh',
      after(s) {
        if (reduced) return;
        $$('.gr-lights > li', s).forEach((li, k) => { if (typeof li.animate === 'function') li.animate([{ opacity: .2, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: k * 40, easing: 'ease-out', fill: 'backwards' }); });
      },
    };
  };
}
