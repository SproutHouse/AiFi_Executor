// cloud/ui/arrival.js — the arrival moment and motion polish (spec §13 "Arrival", build step 14; acceptance "Arrival").
// One block (see ui/README.md). It registers hooks only and exports nothing: arrival(prev, next) after core's land()
// has re-rendered the open tab in place, route(tab) for first-view motion, and show/hide.
// The rest of the moment lives with its owners, reached only through the DOM they expose:
//   dial.js      the newly landed bead grows in (scale .6→1) and pings once (.dl-new, .dl-ping.dl-once)
//   gaterun.js   replays the new run once, only when it differs from the run before it (ex.gr, "Same as …")
//   now.js       new Latest rows enter with a "new" dot (.enter, .nw-nd); the pot total counts up (ex.nw.R)
//   activity.js  the new heartbeat cell scales in and new timeline rows enter; positions.js its cards (ex.r.<id>)
//   core.js      keeps scrollY, refreshes an open sheet, paints the Activity tab dot (ex.seenEv)
// This module adds, each with a reduced-motion path (static, instant, no pulse):
//   · the toast "Check 4:21 am landed · 1 signal · nothing bought", with "↑ See it" when scrolled more than a screen
//   · no card re-entrance on an in-place re-render (.rise is dropped from cards on arrival)
//   · anchored scroll: the section being read stays put even when content above it grew or shrank
//   · changed numbers count up: any leaf number in #view that changed and that no module animates itself
//   · bars and meters with an inline --k and no data-k: scaleX from 0 on first view, from the old value on arrival
//   · Now's Holding rows: the ladder bead slides from the last seen R (localStorage ex.r.<id>, shared with positions.js)
//   · the Activity tab dot pops once when newer events arrive
// DOM opt-out: [data-ar-skip] on an element or an ancestor keeps its numbers and bars out of the generic motion.
{
  const EASE = 'cubic-bezier(.16,1,.3,1)', D3 = 600, COUNT = 800, TOAST = 4000;
  const arr = v => (Array.isArray(v) ? v : []);
  const V = () => document.getElementById('view');
  // Not ours to animate: the dial and Gate Run run their own motion, ages tick on the clock, and these modules
  // count their own numbers from their own memory (results [data-cu], positions [data-ps-r], now's pot .nw-R).
  const SKIP = '.dl,.gr,[data-ago],[data-ar-skip],[data-cu],[data-ps-r],.nw-R,svg,.vh,.tipbox';
  let wired = false;

  // core's countUp (it clamps its progress to 0–1, so it never steps back past `from`)
  function count(el, to, from, f) {
    if (!reduced) el.textContent = f(from);                          // the first painted frame shows the old value
    countUp(el, to, { from, ms: COUNT, fmt: f });
  }
  function anim(el, frames, ms) {
    if (!el || reduced || document.hidden || typeof el.animate !== 'function') return null;
    try { return el.animate(frames, { duration: ms, easing: EASE }); } catch (e) { return null; }
  }

  // ======================================================================================= the diff ==
  function evsOf(b) { return arr(b && b.events).filter(e => Array.isArray(e) && num(e[0]) != null); }
  function newestRunT(b) { let m = -Infinity; for (const r of runsOf(b)) if (r && num(r.t) != null && r.t > m) m = r.t; return m; }
  function newestEvT(b, lv) { let m = -Infinity; for (const e of evsOf(b)) if ((lv == null || (num(e[5]) || 0) >= lv) && e[0] > m) m = e[0]; return m; }
  function sigOf(r) { return Math.max(Array.isArray(r.c) ? num(r.c[1]) || 0 : 0, r.tg && typeof r.tg === 'object' ? Object.keys(r.tg).length : 0); }
  // What changed between two bundles: the checks that landed, what they did, and standing-state flips.
  function diff(prev, next) {
    const known = !!prev && Array.isArray(prev.runs), pT = newestRunT(prev);          // unknown before: never "37 checks landed"
    const runs = known ? runsOf(next).filter(r => r && num(r.t) != null && r.t > pT).sort((a, b) => a.t - b.t) : [];
    const d = { runs, first: known && !prev.runs.length && runs.length > 0, sig: 0, nBought: 0, bought: [], sold: [], trail: [], off: [], clockT: null, halt: null, mode: null };
    if (!runs.length) {                                             // a v1 bundle, or runs missing: the clock still moves
      const a = num((clockOf(prev) || {}).last_t), z = num((clockOf(next) || {}).last_t);
      if (z != null && (a == null || z > a)) d.clockT = z;
    }
    const ts = new Set(runs.map(r => r.t)), E = evsOf(next);
    for (const r of runs) { d.sig += sigOf(r); d.nBought += Array.isArray(r.c) ? num(r.c[4]) || 0 : 0; }
    let evBought = 0;
    for (const e of E) {
      if (!ts.has(e[0])) continue;
      if (e[1] === 'bought') { evBought++; if (e[2] && !d.bought.includes(e[2])) d.bought.push(e[2]); }
      else if (e[1] === 'sold' && e[2]) d.sold.push([e[2], num(e[7])]);
      else if (e[1] === 'trail' && e[2] && !d.trail.includes(e[2])) d.trail.push(e[2]);
    }
    d.nBought = Math.max(d.nBought, evBought);
    for (const r of runs) for (const [c, h] of Object.entries(r.hx && typeof r.hx === 'object' ? r.hx : {})) {   // events trimmed
      const m = String(h).match(/^([tc])([+\-\u2212]?[\d.]+)$/); if (!m) continue;
      if (m[1] === 'c' && !d.sold.some(x => x[0] === c)) d.sold.push([c, num(m[2].replace('\u2212', '-'))]);
      if (m[1] === 't' && !d.trail.includes(c)) d.trail.push(c);
    }
    const pE = newestEvT(prev);                                     // closes and opens made outside a run (flatten, approvals)
    for (const e of E) if (!ts.has(e[0]) && e[0] > pE && (e[1] === 'sold' || e[1] === 'bought') && e[2]) d.off.push(e);
    const ph = !!((stateOf(prev) || {}).halt || {}).set, nh = !!((stateOf(next) || {}).halt || {}).set;
    d.halt = nh && !ph ? 'set' : ph && !nh ? 'cleared' : null;
    const pm = modeOf(prev).eff, nm = modeOf(next).eff;
    d.mode = pm && nm && pm !== nm ? nm : null;
    return d;
  }
  function abortOf(r, b) {
    const last = (stateOf(b) || {}).last || {};
    if (last.t === r.t && last.abort) return String(last.abort);
    const e = evsOf(b).find(x => x[0] === r.t && x[1] === 'failed');
    return e && e[6] && e[6] !== 'nomark' && e[6] !== 'candles' ? String(e[6]) : '';
  }
  const few = list => list.length <= 3 ? word.list(list) : word.list(list.slice(0, 3)) + ' +' + (list.length - 3);
  // → {head, parts[], tone: ok|warn|bad|act|mute, run}. Words carry the meaning; the dot beside them only supports them.
  function words(d, next) {
    const P = [], L = d.runs[d.runs.length - 1];
    let tone = 'ok';
    if (L) {
      const n = d.runs.length, w = fmt.when(L.t), ab = L.x ? abortOf(L, next) : '';
      const st = L.x ? 'stopped early' + (ab ? ' (' + ab + ')' : '') : !L.ok ? 'ran late' : '';
      let head;
      if (n === 1) head = (d.first ? 'First check ' : 'Check ') + w + ' ' + (st || 'landed');
      else { head = word.plural(n, 'check') + ' landed'; P.push('latest ' + w + (st ? ' ' + st : '')); }
      if (L.x) { tone = 'bad'; P.push('exits may not have been checked'); }
      else if (!L.ok) tone = 'warn';
      if (!L.x || n > 1) P.push(d.sig ? word.plural(d.sig, 'signal') : 'no signals');
      const named = d.bought, bought = d.nBought > 0 || named.length > 0, acted = bought || d.sold.length > 0 || d.trail.length > 0;
      if (bought) P.push('bought ' + (named.length ? few(named) + (d.nBought > named.length ? ' and ' + (d.nBought - named.length) + ' more' : '') : fmt.int(d.nBought)));
      for (const [c, R] of d.sold.slice(0, 2)) P.push('sold ' + c + (R != null ? ' ' + fmt.R(R) : ''));
      if (d.sold.length > 2) P.push(d.sold.length - 2 + ' more sold');
      if (d.trail.length) P.push('stop raised: ' + few(d.trail));
      if (!L.x && !bought) {                                        // why nothing was bought, when the record says
        if (n === 1 && !L.ok) P.push('buys skipped');
        else if (n === 1 && L.h) P.push('halted, no new buys');
        else if (!acted) P.push('nothing bought');
      }
      if (acted && tone === 'ok') tone = 'act';
      if (d.halt === 'set') { P.push('halted'); tone = 'bad'; }
      return { head, parts: P, tone, run: true };
    }
    if (d.clockT != null) return { head: 'Check ' + fmt.when(d.clockT) + ' landed', parts: P, tone, run: true };
    const bits = [];
    if (d.halt === 'set') { bits.push('Halted'); P.push('no new buys; exits still run'); tone = 'bad'; }
    else if (d.halt === 'cleared') { bits.push('Halt lifted'); P.push('buying is allowed again'); }
    if (d.mode) {
      const m = modeOf(next);
      bits.push('Now running ' + (d.mode === 'live' ? 'live' : 'paper'));
      if (m.req && m.req !== m.eff) { P.push(m.note || 'live requirements missing'); if (tone === 'ok') tone = 'warn'; }
    }
    for (const e of d.off.slice(0, 3)) {
      const t = e[1] === 'sold' ? 'Sold ' + e[2] + (num(e[7]) != null ? ' ' + fmt.R(e[7]) : '') + (e[6] ? ' (' + word.exit(e[6]) + ')' : '') : 'Bought ' + e[2];
      if (!bits.length) bits.push(t); else P.push(t.charAt(0).toLowerCase() + t.slice(1));
      if (tone === 'ok') tone = 'act';
    }
    if (bits.length) return { head: bits.join(' · '), parts: P, tone, run: false };
    const lr = lastRun(next);
    return { head: 'Data refreshed', parts: [lr ? 'no new check since ' + fmt.when(lr.t) : 'no check yet'], tone: 'mute', run: false };
  }

  // ======================================================================================== the toast ==
  // core's toast() shows it for 4 s (bottom, above the phone tab bar). No live semantics: the capsule is the one
  // live region and already announces a changed state word.
  const DOTC = { ok: 'ok', warn: 'gap', bad: 'bad', act: 'ar-act', mute: 'mute' };
  let lastW = null, pend = null;
  function seeTarget() { return S.tab === 'now' && lastW && lastW.run ? document.getElementById('now-gaterun') : null; }   // else the top
  function seeButton(w) {
    if (w.tone === 'mute' || scrollY <= innerHeight) return '';     // only when scrolled more than a screen, and something to see
    const t = seeTarget();
    let up = true;
    if (t) { const r = t.getBoundingClientRect(); if (r.bottom > 56 && r.top < innerHeight) return ''; up = r.top < 0; }
    return '<button type="button" class="btn small ar-see" data-ar-see>' + (up ? '↑' : '↓') + ' See it</button>';
  }
  function showToast(w) {
    lastW = w;
    toast('<span class="dot ar-dot ' + (DOTC[w.tone] || 'ok') + '" aria-hidden="true"></span><span class="ar-tx"><b>' + esc(w.head) + '</b>'
      + w.parts.map(p => ' · ' + esc(p)).join('') + '</span>' + seeButton(w), { ms: TOAST });
  }
  // "See it": on Now, the Gate Run of the new check (which then replays when it differs), back on the latest run if
  // the cursor was elsewhere; on the other tabs, the top of the tab, where their new cells and rows enter.
  function seeIt(kb) {
    const t = seeTarget();
    if (t && S.cursor != null) setCursor(null, { scroll: true, explicit: true });
    else if (t) into(t, true);
    else { try { scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' }); } catch (e) { jump(0); } }
    if (!kb) return;                                                // keyboard: focus follows to where it scrolled
    const f = (t && $('h2', t)) || $('#view h2');
    if (!f) return;
    if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1');
    try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function wireToast() {
    const el = $('#toast'); if (!el || el._ar) return;
    el._ar = 1;
    el.addEventListener('click', e => {
      const b = e.target instanceof Element && e.target.closest('[data-ar-see]'); if (!b) return;
      e.preventDefault(); el.classList.remove('on'); seeIt(e.detail === 0);
    });
  }

  // =================================================================================== anchored scroll ==
  // The anchor is the id'd section (or row with data-cycle/pos/trade/slot) under 40% of the viewport, measured once the
  // reader stops scrolling or the view changes, so an arrival can put it back where it was even when content above it
  // grew. Core's jump(y) stays the fallback: when the anchor is stale (scrolled since) or gone, nothing here moves.
  const ANCSEL = '[id],[data-cycle],[data-pos],[data-trade],[data-slot]', ANCA = ['data-cycle', 'data-pos', 'data-trade', 'data-slot'];
  let anc = null, ancTm = 0, lastY = 0, settle = null;
  const cssq = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  function selOf(el) {
    if (el.id) return '#' + cssq(el.id);
    for (const a of ANCA) if (el.hasAttribute(a)) return '[' + a + '="' + cssq(el.getAttribute(a)) + '"]';
    return null;
  }
  function entering() {                                             // a card entrance transform would skew the measure
    try { return !!document.getAnimations && document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target instanceof Element && a.effect.target.classList.contains('rise')); }
    catch (e) { return false; }
  }
  function measure() {
    clearTimeout(ancTm); ancTm = 0;
    const v = V(); if (!v || !S.b) { anc = null; return; }
    if (entering()) { ancTm = setTimeout(measure, 400); return; }
    const y = scrollY; lastY = y;
    if (y < 8) { anc = { y, sel: null }; return; }
    const vr = v.getBoundingClientRect(), yy = Math.round(innerHeight * 0.4);
    let pick = null;
    for (const fx of [0.5, 0.25, 0.75]) {
      let hit = null;
      try { for (const e of document.elementsFromPoint(Math.round(vr.left + vr.width * fx), yy)) if (e !== v && v.contains(e)) { hit = e; break; } } catch (e) {}
      const a = hit && hit.closest(ANCSEL);
      if (a && a !== v && v.contains(a)) { pick = a; break; }
    }
    const sel = pick && selOf(pick);
    anc = sel ? { y, sel, i: $$(sel, v).indexOf(pick), top: pick.getBoundingClientRect().top } : { y, sel: null };
  }
  function measureSoon(ms) { clearTimeout(ancTm); ancTm = setTimeout(measure, ms == null ? 160 : ms); }
  function stopSettle() { if (!settle) return; if (settle.ro) settle.ro.disconnect(); clearTimeout(settle.tm); settle = null; }
  function restore() {
    const a = anc, v = V();
    if (!a || !a.sel || a.y < 8 || !v || Math.abs(lastY - a.y) > 2) return;
    const place = () => {
      const el = $$(a.sel, v)[a.i]; if (!el) return true;           // gone: core's y stands
      const d = el.getBoundingClientRect().top - a.top;
      if (Math.abs(d) >= 1) jump(scrollY + d);
      return Math.abs(el.getBoundingClientRect().top - a.top) < 1;
    };
    if (place() || !('ResizeObserver' in window)) return;
    stopSettle();                                                   // the page is still short (lazy content): follow it
    const ro = new ResizeObserver(() => { if (place()) stopSettle(); });
    ro.observe(v);
    settle = { ro, tm: setTimeout(stopSettle, 2500) };
  }

  // ================================================================================ changed numbers ==
  // A leaf element whose whole text is one number ("124", "+1.84 R", "3.2%", "0.73×") is snapshot under a stable key
  // (tab, nearest id, nearest row identity, a 3-level class path). On arrival a changed one counts up from its old
  // text, only when both texts re-format exactly with fmt.num, and never where a module ran countUp itself (el._cu).
  const NP = (() => {
    try { const p = new Intl.NumberFormat().formatToParts(12345.6); return { g: (p.find(x => x.type === 'group') || {}).value || ',', d: (p.find(x => x.type === 'decimal') || {}).value || '.' }; }
    catch (e) { return { g: ',', d: '.' }; }
  })();
  const rxq = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const NUMRE = new RegExp('^([+\\-\\u2212]?)(\\d{1,3}(?:' + rxq(NP.g) + '\\d{3})+|\\d+)(?:' + rxq(NP.d) + '(\\d+))?([\\u00a0\\u202f ]?(?:R|%|\\u00d7))?$');
  function parseNum(s) {
    const m = NUMRE.exec(s); if (!m) return null;
    const v = Number(m[2].split(NP.g).join('') + (m[3] ? '.' + m[3] : ''));
    if (!isFinite(v)) return null;
    return { v: m[1] === '-' || m[1] === '\u2212' ? -v : v, nd: m[3] ? m[3].length : 0, sfx: m[4] || '', plus: m[1] === '+' };
  }
  const STATE = /^(pos|neg|rise|enter|grow1|pop1|pulse1|on|sel|new|gone|dim|done|ar-.*)$/;
  const ROW = ['data-slot', 'data-cycle', 'data-pos', 'data-trade', 'data-name', 'data-kk', 'data-mk', 'data-psk', 'data-v', 'data-tf'];
  function clsOf(e) { return (e.getAttribute('class') || '').split(/\s+/).filter(x => x && !STATE.test(x)).sort().join('.'); }
  function keyOf(el, root) {
    const a = el.closest('[id]'), id = a && a !== root && root.contains(a) ? a.id : '';
    let row = '';
    for (let e = el; e && e !== root; e = e.parentElement) { const at = ROW.find(x => e.hasAttribute(x)); if (at) { row = at + '=' + e.getAttribute(at); break; } }
    const p = [];
    for (let e = el, i = 0; e && e !== root && i < 3; e = e.parentElement, i++) p.push(e.tagName + '.' + clsOf(e));
    return S.tab + '|' + id + '|' + row + '|' + p.join('<');
  }
  function leaves(root) {
    const out = [], tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement, s = n.data;
      if (!el || s.length > 18 || el.childNodes.length !== 1 || !NUMRE.test(s) || el.closest(SKIP)) continue;
      out.push(el);
    }
    return out;
  }
  function group(els, root) { const m = new Map(); for (const el of els) { const k = keyOf(el, root), a = m.get(k); if (a) a.push(el); else m.set(k, [el]); } return m; }
  let NUM = null, snapTm = 0;
  function numbers(root) {
    const old = NUM; if (!old || reduced) return;
    let n = 0;
    group(leaves(root), root).forEach((els, k) => {
      const o = old.get(k); if (!o || o.length !== els.length) return;   // ambiguous: a row came or went under this key
      els.forEach((el, i) => {
        if (n >= 60 || el._cu) return;
        const a = o[i], b = el.textContent;
        if (a === b) return;
        const pa = parseNum(a), pb = parseNum(b);
        if (!pa || !pb || pa.nd !== pb.nd || pa.sfx !== pb.sfx) return;
        const sg = pa.plus || pb.plus, f = v => fmt.num(v, pb.nd, sg) + pb.sfx;
        if (f(pa.v) !== a || f(pb.v) !== b) return;                 // not a format reproduced exactly: leave it still
        el._arTo = b; n++;
        count(el, pb.v, pa.v, f);
      });
    });
  }

  // =========================================================================================== bars ==
  // Bars and meters drawn with transform:scaleX(var(--k)) from an inline --k. Modules that animate their own carry
  // data-k (activity, results, positions); the Gate Run and dial run their own motion. The rest (On deck proximity
  // bars, the shakedown meter) grow from 0 on their first view in a session and from the old value on arrival; the
  // last drawn value of each persists across tabs for the session. Only a pure scaleX transform is animated.
  const KM = new Map();
  function barsOf(root) { return $$('[style*="--k"]', root).filter(el => !el.hasAttribute('data-k') && !el.closest('.gr,.dl,[data-ar-skip]')); }
  function kOf(el) { const v = parseFloat(el.style.getPropertyValue('--k')); return isFinite(v) ? Math.max(0, Math.min(1, v)) : null; }
  function scaleTarget(el, k) {
    for (const t of [el, el.firstElementChild]) {
      if (!t) continue;
      const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(t).transform || ''); if (!m) continue;
      const a = m[1].split(',').map(Number);
      if (Math.abs(a[0] - k) < 0.003 && Math.abs(a[1]) < 1e-6 && Math.abs(a[2]) < 1e-6 && Math.abs(a[3] - 1) < 1e-6 && Math.abs(a[4]) < 0.5 && Math.abs(a[5]) < 0.5) return t;
    }
    return null;
  }
  function bars(root) {
    group(barsOf(root), root).forEach((els, key) => {
      const o = KM.get(key), same = !!o && o.length === els.length;
      els.forEach((el, i) => {
        const to = kOf(el); if (to == null) return;
        const from = same && o[i] != null ? o[i] : 0;
        if (Math.abs(from - to) < 0.005) return;
        const t = scaleTarget(el, to);
        if (t) anim(t, [{ transform: 'scaleX(' + from + ')' }, { transform: 'scaleX(' + to + ')' }], D3);
      });
      KM.set(key, els.map(kOf));
    });
  }

  // ========================================================================================= snapshot ==
  // Re-taken once the DOM of #view settles (debounced mutations; the dial's 1 s text, the Gate Run's replay and the
  // [data-ago] ages do not count), so the next arrival compares against what was on screen, never a mid-count value.
  function snap() {
    clearTimeout(snapTm); snapTm = 0;
    const root = V(); if (!root || !S.b) return;
    const m = new Map();
    for (const el of leaves(root)) {
      if (el._cu && el._arTo == null) continue;                     // a module's count: theirs to diff
      const k = keyOf(el, root), t = el._arTo != null ? el._arTo : el.textContent, a = m.get(k);
      if (a) a.push(t); else m.set(k, [t]);
    }
    NUM = m;
    group(barsOf(root), root).forEach((els, key) => KM.set(key, els.map(kOf)));
  }
  function snapSoon() { clearTimeout(snapTm); snapTm = setTimeout(snap, 400); }
  let mo = null;
  function observe() {
    const v = V(); if (!v || mo || !('MutationObserver' in window)) return;
    mo = new MutationObserver(recs => {
      for (const r of recs) {
        const n = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (n && n.isConnected && !n.closest('.dl,.gr,[data-ago]')) { snapSoon(); measureSoon(); return; }
      }
    });
    mo.observe(v, { childList: true, subtree: true, characterData: true });
  }

  // ================================================================================ Holding ladders ==
  // Now's Holding rows: the mark bead slides from the R last seen for that position (localStorage ex.r.<id>, the key
  // positions.js uses for its cards, so a change is shown once, wherever it is seen first) and the open R counts up.
  // The ladder's own ticks give its scale: the first stop (.t0) sits at −1 R and entry (.te) at 0.
  function ladders(root) {
    if (document.hidden) return;                                    // not seen yet: keep the old value for the first view
    const P = arr(S.b && S.b.pos);
    for (const row of $$('.nw-hr[data-pos]', root)) {
      const id = row.dataset.pos, p = P.find(x => x && String(x.id) === id), n = p ? num(p.r_now) : null;
      if (!id || n == null) continue;
      const old = num(lsGet('ex.r.' + id, null));
      lsSet('ex.r.' + id, n);
      if (old == null || Math.abs(old - n) < 0.005 || reduced) continue;
      const lad = $('.nw-lad', row), bd = lad && $('.bd', lad), t0 = lad && $('.t0', lad), te = lad && $('.te', lad);
      if (bd && t0 && te && lad.clientWidth) {
        const a = parseFloat(t0.style.left), z = parseFloat(te.style.left), cur = parseFloat(bd.style.left);
        if (isFinite(a) && isFinite(z) && isFinite(cur) && z !== a) {
          const was = Math.max(0, Math.min(100, z + old * (z - a)));
          const dx = (was - cur) / 100 * lad.clientWidth;
          if (Math.abs(dx) >= 1) anim(bd, [{ transform: 'translateX(' + dx.toFixed(1) + 'px)' }, { transform: 'translateX(0)' }], D3);
        }
      }
      const big = $('.nw-hR', row);
      if (big && big.textContent === fmt.R(n)) count(big, n, old, v => fmt.R(v));
    }
  }

  // ============================================================================== the Activity dot ==
  function dotPop(prev, next) {
    if (reduced || !(newestEvT(next, 1) > newestEvT(prev, 1))) return;
    $$('a[data-tab=activity].new').forEach(a => {
      a.classList.remove('ar-pop'); void a.offsetWidth; a.classList.add('ar-pop');
      setTimeout(() => a.classList.remove('ar-pop'), D3 + 100);
    });
  }

  // ============================================================================== cards stay still ==
  // land() re-renders in place, and a module that marks its cards .rise on every render would replay their entrance.
  // The arrival hook runs before the next frame, so dropping the class here means the entrance never shows. Rows keep
  // theirs: new rows rising in are part of the moment.
  function still(root) {
    if (!root) return;
    $$('.rise', root).forEach(el => { if (el.matches('.card,section,article,details')) { el.classList.remove('rise'); el.style.animationDelay = ''; } });
  }

  // ============================================================================================ wiring ==
  function init() {
    if (wired) return;
    wired = true;
    wireToast();
    observe();
    lastY = scrollY;
    addEventListener('scroll', () => { lastY = scrollY; measureSoon(); }, { passive: true });
    addEventListener('resize', () => measureSoon(), { passive: true });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(t => addEventListener(t, stopSettle, { passive: true, capture: true }));
  }
  hook('route', tab => {
    init();
    stopSettle();
    const root = V(); if (!root || !S.b) return;
    safe(() => { if (tab === 'now') ladders(root); bars(root); }, 'Motion');
    snap();
    measureSoon(1300);                                              // after the cards' entrance
  });
  hook('arrival', (prev, next) => {
    init();
    const root = V();
    if (!root || !next) return;
    still(root); still($('#sheet'));
    safe(restore, 'Scroll');
    safe(() => { if (S.tab === 'now') ladders(root); numbers(root); bars(root); dotPop(prev, next); }, 'Arrival motion');
    measureSoon(D3 + 200);
    if (!prev) return;
    let w = null;
    try { w = words(diff(prev, next), next); } catch (e) { report(e, 'Arrival toast'); }
    if (!w) return;
    if (document.hidden) { pend = { w, at: Date.now() }; return; }  // shown when the page is next visible
    pend = null;
    showToast(w);
  });
  hook('show', () => {
    if (!pend) return;
    const p = pend; pend = null;
    if (Date.now() - p.at < 15 * 60e3) setTimeout(() => showToast(p.w), 300);
  });
  hook('hide', stopSettle);
}
