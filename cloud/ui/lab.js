// cloud/ui/lab.js — the AiFi Lab page at "/lab" (COMMAND_CENTER_SPEC §11). Joined only into that page's own bundle
// (core + lab + boot), so the Command Center and the bot pages never carry it. One block (ui/README.md); classes carry
// the lb- prefix (ui/lab.css). It exports, by assignment only:
//   VIEWS.lab            the page: the lab's totals, the Lab floor (a replay of one recorded run: scouts → test bench →
//                        auditor → arena) and the Strategy log (every strategy tested, newest first)
//   SHEETS.lab(id)       one strategy's full record, from that day's exec:lab:day key (fetched once, then cached)
//   COMP.labPage(L), COMP.labSheet(L, id, day)   → html of the header and log, and of one strategy's sheet (the
//                        client harness renders them)
//   COMP.labPlan(L, i, C) → the replay plan of run i on C bench slots (the harness checks its order and length)
//   TIP.lab / TIP.chk / TIP.lbby / TIP.lbv   this page's tip words (added to core's TIP; core's keys are never changed)
// Data: /api/lab (exec:lab) and /api/lab/day?d=<YYYY-MM-DD>. Words first; % and Sharpe only, never money; "—" when missing.
// The floor is a replay, said so on screen: the order and the relative lengths of the tests are real, the time is
// compressed to 15–60 s. Motion only after the owner opens the page; under reduced motion it shows the finished run.
{
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => isObj(v) ? v : {};
  const LB = { L: null, err: null, at: 0, p: null, days: {}, dayErr: {}, dayP: {}, f: 'all', fam: '', q: '', n: 80, root: null, run: 0, jumped: false };
  function load() {
    if (LB.p) return LB.p;
    LB.p = getJSON('/api/lab', 20000).then(d => { LB.L = isObj(d) ? d : null; LB.err = LB.L ? null : 'parse'; }, e => { LB.err = (e && e.kind) || 'net'; })
      .then(() => { LB.at = Date.now(); LB.p = null; return LB.L; });
    return LB.p;
  }
  function loadDay(d) {
    if (LB.dayP[d]) return LB.dayP[d];
    LB.dayP[d] = getJSON('/api/lab/day?d=' + encodeURIComponent(d), 20000).then(x => { if (isObj(x)) LB.days[d] = x; else LB.dayErr[d] = 'parse'; }, e => { LB.dayErr[d] = (e && e.kind) || 'net'; })
      .then(() => { LB.dayP[d] = null; });
    return LB.dayP[d];
  }
  const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() / 1000) : null; };
  const P = v => num(v) == null ? '—' : '<span class="' + fmt.cls(v, 1) + '">' + esc(fmt.pct(v, 1)) + '</span>';
  const Sh = v => num(v) == null ? '—' : esc(fmt.num(v));

  // ================================================================================== the words ==
  // A check's plain name (it reads after "Failed:" and beside ✓ / ✗) and its tip.
  const CHK = {
    'enough history': ['Enough history', 'Its coins have enough years of prices to test on.'],
    'cheap: Sharpe and trades': ['Quick check', 'The fast first screen: steady enough returns and enough trades to judge. Most ideas stop here.'],
    'cheap: earns anything': ['Quick check', 'The fast first screen: does it make money at all on past prices?'],
    'trade count': ['Enough trades', 'It traded often enough for the results to mean something.'],
    'return on capital': ['Return on capital', 'It earns enough on the money it actually puts to work.'],
    Sharpe: ['Steady returns', 'Sharpe: return for each unit of ups and downs. Higher means steadier gains.'],
    'deflated Sharpe': ['Luck test', 'After counting every recipe the lab tried, its result must still beat what luck alone would show.'],
    'max drawdown': ['Worst drop', 'Its worst fall from a peak must stay inside the limit.'],
    'costs doubled': ['Double costs', 'It must still work if trading costs were twice as high.'],
    neighbours: ['Nearby settings', 'Slightly different settings must work too, so it is not one lucky set of numbers.'],
    'beats holding the coins': ['Beats just holding', 'It must do better than simply buying and holding the same coins.'],
    'positive years': ['Most years positive', 'Most full years must make money, not just a few.'],
    'no one-year wonder': ['No one-year wonder', 'No single year may make most of the gains.'],
    'worst regime': ['Worst market', 'Its result in its worst kind of market (bull, bear or crisis) must stay above the floor.'],
    'no lookahead': ['No peeking ahead', 'It must give the same answers when later prices are hidden, so it never used the future.'],
    'works on other coins': ['Other coins', 'The same rules must also work on coins it was not designed on.'],
    'not a copy of a fleet bot': ['Different from the fleet', 'It must not move too closely with a bot that is already running.'],
    holdout: ['Final exam', 'The latest year of prices, hidden while it was designed. One try: it must still work there.'],
    'holdout budget': ['Exam budget', 'An older rule: a limit on how many recipes could take the final exam.'],
  };
  const chk = c => (CHK[c] || [cap1(String(c || '—'))])[0];
  // Who proposed it: [name, initials, tip]
  const BY = {
    scout: ['Claude scout', 'CS', 'Claude reads research and writes new recipes to test.'],
    auto: ['Auto scout', 'AS', 'The lab’s automatic scout: it proposes new versions of recipes on its own.'],
    campaign: ['Campaign', 'CP', 'A planned research campaign that tests many versions of one idea in one go.'],
    seed: ['Seed', 'SD', 'One of the recipes the lab started with.'],
  };
  const byN = b => (BY[b] || [b ? cap1(String(b)) : '—'])[0];
  const famN = id => (LB.L && obj(obj(LB.L.families)[id]).name) || famName(id);
  // A verdict in words and its class: k killed early · f failed · w waiting · x failed the exam · t turned down · p passed · a passed → arena
  const VK = { 'killed-cheap': 'k', 'failed-audit': 'f', 'passed-dev': 'w', 'failed-holdout': 'x', survivor: 'p' };
  const VW = { k: 'Killed early', f: 'Failed', w: 'Waiting for the exam', x: 'Failed the exam', t: 'Turned down by the auditor', p: 'Passed', a: 'Passed → Arena' };
  function stageOf(r) {
    const s = r.stage || { 'killed-cheap': 'quick', 'failed-audit': 'audit', 'passed-dev': 'waiting', 'failed-holdout': 'exam', survivor: 'passed' }[r.v] || '';
    return s === 'passed' && r.veto ? 'review' : s;
  }
  function vOf(r) {
    let c = VK[r.v] || 'u';
    if (c === 'p') c = stageOf(r) === 'review' ? 't' : r.arena ? 'a' : 'p';
    return { c, w: VW[c] || (r.v ? cap1(String(r.v).replace(/-/g, ' ')) : '—') };
  }
  function stopAt(r) {
    const s = stageOf(r), f = arr(r.fail)[0];
    return s === 'waiting' ? 'waiting for the final exam' : s === 'review' ? 'the auditor' : s === 'passed' ? '' : f ? chk(f) : s === 'quick' ? 'Quick check' : s === 'exam' ? 'Final exam' : '';
  }
  function stamp(r) {
    const V = vOf(r), f = arr(r.fail)[0];
    return V.c === 'f' && f ? 'Failed: ' + chk(f) : V.c === 'a' ? 'Passed → ' + r.arena : V.w;
  }
  // The four stage pips: Quick check → Full audit → Other coins → Final exam. ok · no · wait (exam still to come) ·
  // skip (an older rulebook had no "other coins" check) · '' (not reached).
  const PIPS = ['Quick check', 'Full audit', 'Other coins', 'Final exam'];
  function pips(r) {
    const s = stageOf(r), f = arr(r.fail), oc = (num(r.gv) || 0) >= 2 ? 'ok' : 'skip';
    if (s === 'quick') return ['no', '', '', ''];
    if (s === 'audit') return f.length && f.every(c => c === 'works on other coins') ? ['ok', 'ok', 'no', ''] : ['ok', 'no', '', ''];
    if (s === 'waiting') return ['ok', 'ok', oc, 'wait'];
    if (s === 'exam') return ['ok', 'ok', oc, 'no'];
    if (s === 'review' || s === 'passed') return ['ok', 'ok', oc, 'ok'];
    return ['', '', '', ''];
  }
  const LT = {
    floor: ['Lab floor', 'A replay of one recorded run: each test spawns on the bench, runs its checks and lands on the results wall. The order and the relative lengths are real; the time is compressed and long quiet gaps are cut short.'],
    scouts: ['Scouts', 'Where the ideas come from: Claude scout, the auto scout, or a research campaign.'],
    bench: ['Test bench', 'Each card is one tester on one recipe: quick check, full audit, other coins, final exam. Most stop early, on purpose.'],
    auditor: ['Auditor', 'A last review of recipes that passed every check. It can still turn one down, for example when the unseen year looks much weaker.'],
    arena: ['Arena', 'Approved recipes start trading here on paper, with no real money, and must keep matching their backtest.'],
    wall: ['Results wall', 'One dot per finished test, by how far it got. Tap a dot for its full record.'],
    tested: ['Tested', 'Every recipe the lab has tested: rules for when to buy and sell, replayed on years of past prices.'],
    killed: ['Killed early', 'Stopped at the quick check, the fast first screen.'],
    failed: ['Failed', 'Passed the quick check, then failed a check of the full audit or the final exam.'],
    audit: ['Failed the audit', 'Passed the quick check, then failed at least one check of the full audit.'],
    waiting: ['Waiting for the exam', 'Passed the full audit; each gets one try at the unseen final year.'],
    exam: ['Failed the exam', 'Passed the audit but did not hold up on the unseen final year.'],
    passed: ['Passed every check', 'Passed the audit and the final exam. The auditor still reviews each before it may trade on paper.'],
    rulebook: ['Rulebook', 'The version of the lab’s checks. A newer rulebook can be stricter; each test records the one it ran under.'],
    log: ['Strategy log', 'Every recipe the lab has tested, newest first, with how far it got. Tap one for its full record.'],
    pip0: ['Quick check', CHK['cheap: Sharpe and trades'][1]],
    pip1: ['Full audit', 'The strict checks: steady returns, the luck test, worst drop, double costs, nearby settings, beating just holding, and more.'],
    pip2: ['Other coins', CHK['works on other coins'][1] + ' Added in rulebook 2.'],
    pip3: ['Final exam', CHK.holdout[1]],
  };
  TIP.lab = a => LT[a];
  TIP.chk = a => CHK[a] ? CHK[a] : [cap1(a || '—'), 'One of the lab’s checks.'];
  TIP.lbby = a => BY[a] ? [BY[a][0], BY[a][2]] : null;
  TIP.lbv = a => ({ k: [VW.k, 'It failed the quick check, the fast first screen. Most ideas stop here, on purpose.'],
    f: [VW.f, 'It passed the quick check but failed at least one check of the full audit.'], w: [VW.w, LT.waiting[1]],
    x: [VW.x, LT.exam[1]], t: [VW.t, 'It passed every check, but the auditor found a reason not to trade it.'],
    p: [VW.p, 'It passed every check and the auditor’s review.'], a: [VW.a, 'It passed everything and now trades on paper in the arena.'] })[a];

  // ===================================================================================== totals ==
  const rowsOf = L => arr(L && L.rows).filter(r => isObj(r) && r.id);
  function totals(L) {
    const T = obj(L.totals), rs = rowsOf(L), c = v => rs.filter(r => r.v === v).length, has = Object.keys(T).length > 0 || !rs.length;
    const g = (k, f) => num(T[k]) != null ? num(T[k]) : has ? null : f;
    return { tested: g('tested', num(L.rows_total) ?? rs.length), killed: g('killed-cheap', c('killed-cheap')), audit: g('failed-audit', c('failed-audit')),
      waiting: g('passed-dev', c('passed-dev')), exam: g('failed-holdout', c('failed-holdout')), passed: g('survivor', c('survivor')),
      vetoed: g('vetoed', rs.filter(r => r.veto).length), enrolled: g('enrolled', rs.filter(r => r.arena).length) };
  }
  function families(L) {
    const F = obj(L.families), out = {};
    for (const id of Object.keys(F)) out[id] = { n: num(obj(F[id]).tested), p: num(obj(F[id]).passed) };
    if (!Object.keys(out).length) for (const r of rowsOf(L)) { const f = out[r.fam] || (out[r.fam] = { n: 0, p: 0 }); f.n++; if (r.v === 'survivor') f.p++; }
    return out;
  }
  const famIdx = id => { const ks = Object.keys(families(LB.L || {})).sort(); const i = ks.indexOf(id); return (i < 0 ? 5 : i) % 6; };
  function headHtml(L) {
    const T = totals(L), R = obj(L.rules), gv = num(L.gates_version), gen = isoS(L.gen);
    const sub = [T.vetoed ? T.vetoed + ' turned down by the auditor' : '', T.enrolled ? T.enrolled + ' in the arena' : ''].filter(Boolean).join(' · ');
    const cell = (k, n, w, s) => '<li class="tc"' + hint('lab', k, true) + '><b class="lb-fn">' + (n == null ? '—' : esc(fmt.int(n))) + '</b><span class="lb-fl tl">' + w + '</span>' + (s ? '<span class="lb-fs">' + esc(s) + '</span>' : '') + '</li>';
    let h = '<section class="card lb-head rise" aria-labelledby="lb-hh"><div class="head"><div class="ttl"><h2 id="lb-hh">What the lab has tested</h2><span class="sub">'
      + esc(gen != null ? 'log written ' + fmt.when(gen) : 'the lab’s own log') + '</span></div><div class="acts"><a class="btn small ghost" href="#floor">Lab floor ›</a><a class="btn small ghost" href="#log">Strategy log ›</a></div></div>'
      + '<p class="lb-p">Every strategy idea the AiFi Lab has tested, how far each got, and a replay of how a run went. Nothing here trades: the few ideas that pass every check go to the arena and trade on paper.</p>'
      + '<ol class="lb-fun">' + cell('tested', T.tested, 'tested') + cell('killed', T.killed, 'killed early') + cell('audit', T.audit, 'failed the audit')
      + cell('waiting', T.waiting, 'waiting for the exam') + cell('exam', T.exam, 'failed the exam') + cell('passed', T.passed, 'passed every check', sub) + '</ol>';
    h += '<p class="lb-rb"><span' + hint('lab', 'rulebook') + '>Rulebook ' + (gv == null ? '—' : 'v' + esc(gv)) + '</span>'
      + (num(R.nightly_minutes) != null ? ' · about ' + esc(fmt.int(R.nightly_minutes)) + ' min of testing a night' : '') + (num(R.arena_slots) != null ? ' · ' + esc(fmt.int(R.arena_slots)) + ' arena slots' : '') + '</p>';
    const F = families(L), ids = Object.keys(F).sort((a, z) => (F[z].n ?? -1) - (F[a].n ?? -1) || famN(a).localeCompare(famN(z)));
    if (ids.length) h += '<h3 class="lb-h3"' + hint('fx', 'fam') + '>By strategy type</h3><ul class="lb-fam">' + ids.map(id => '<li class="tc"' + hint('fam', id) + '><i class="lb-fd lb-c' + famIdx(id) + '"></i><span class="lb-fmn tl">' + esc(famN(id)) + '</span><span class="lb-fmc">'
      + (F[id].n == null ? '—' : esc(fmt.int(F[id].n))) + ' tested · <b' + (F[id].p ? ' class="lb-fmp"' : '') + '>' + (F[id].p == null ? '—' : esc(fmt.int(F[id].p))) + ' passed</b></span></li>').join('') + '</ul>';
    const st = arr(L.studies).filter(x => isObj(x) && x.name);
    if (st.length) h += '<ul class="lb-res">' + st.slice(0, 5).map(x => '<li class="tc"' + hint('fx', 'study') + '><b class="tl">Research: ' + esc(x.name) + '</b>' + (x.headline ? ' · ' + esc(x.headline) : '')
      + ' <span class="sub">' + esc([ymd(x.date) != null ? fmt.md(ymd(x.date)) : '', num(x.configs) ? word.plural(x.configs, 'version') + ' tried' : ''].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>';
    return h + '</section>';
  }

  // ============================================================================ the Strategy log ==
  const FILT = [['all', 'All'], ['p', 'Passed'], ['f', 'Failed'], ['k', 'Killed early'], ['w', 'Waiting for exam']];
  const inF = (r, f) => f === 'all' || (f === 'p' ? r.v === 'survivor' : f === 'f' ? r.v === 'failed-audit' || r.v === 'failed-holdout' : f === 'k' ? r.v === 'killed-cheap' : r.v === 'passed-dev');
  function shown(L) {
    const q = LB.q.trim().toLowerCase();
    return rowsOf(L).filter(r => inF(r, LB.f) && (!LB.fam || r.fam === LB.fam)
      && (!q || [r.name, r.desc, famN(r.fam), arr(r.coins).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0));
  }
  function rowHtml(r) {
    const V = vOf(r), st = stopAt(r);
    return '<li><button type="button" class="lb-row" data-sheet="lab:' + esc(r.id) + '"><span class="lb-rt"><b>' + esc(r.name || r.id) + '</b>' + (r.desc ? '<span class="lb-rd">' + esc(r.desc) + '</span>' : '')
      + '<span class="lb-rm">' + esc([famN(r.fam), byN(r.by), st ? 'stopped at: ' + st : '', num(r.sh) != null ? 'Sharpe ' + fmt.num(r.sh) : ''].filter(Boolean).join(' · ')) + '</span></span>'
      + '<span class="lb-vc lb-v-' + V.c + '">' + esc(V.w) + '</span></button></li>';
  }
  function listHtml(L) {
    const list = shown(L), n = Math.min(list.length, LB.n);
    if (!list.length) return '<p class="note">' + (rowsOf(L).length ? 'No strategy matches. <button type="button" class="btn small ghost" data-lb-clear>Show all ›</button>' : 'The lab hasn’t logged a test yet.') + '</p>';
    let h = '', day = null;
    for (let i = 0; i < n; i++) {
      const r = list[i];
      if (r.day !== day) {
        if (day !== null) h += '</ul>';
        day = r.day; const c = list.filter(x => x.day === day).length;
        h += '<h3 class="lb-day">' + esc(ymd(day) != null ? fmt.day(ymd(day)) : 'Undated') + ' <span class="sub">· ' + esc(word.plural(c, 'strategy', 'strategies')) + '</span></h3><ul class="list lb-rows">';
      }
      h += rowHtml(r);
    }
    h += '</ul>';
    if (list.length > n) h += '<button type="button" class="btn small lb-more" data-lb-more>Show ' + Math.min(100, list.length - n) + ' more (' + fmt.int(list.length - n) + ' left)</button>';
    return h;
  }
  function logHtml(L) {
    const rs = rowsOf(L), F = families(L), tot = num(L.rows_total);
    const cnt = k => rs.filter(r => inF(r, k)).length;
    const opt = (v, w, on) => '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(w) + '</option>';
    return '<section class="card lb-log" id="log" aria-labelledby="lb-lh"><div class="head"><div class="ttl"><h2 id="lb-lh"' + hint('lab', 'log', true) + '>Strategy log</h2><span class="sub">every strategy tested, newest first</span></div></div>'
      + '<div class="lb-ctl2"><div class="fchips lb-chips" role="group" aria-label="Show">' + FILT.map(([k, w]) => '<button type="button" class="fchip" data-lb-f="' + k + '" aria-pressed="' + (LB.f === k) + '"' + (k === 'all' ? '' : hint('lbv', k === 'p' ? 'p' : k)) + '>' + w + ' <span class="lb-cn">' + fmt.int(cnt(k)) + '</span></button>').join('') + '</div>'
      + '<select class="lb-sel" data-lb-fam aria-label="Strategy type">' + opt('', 'All types', !LB.fam) + Object.keys(F).sort((a, z) => famN(a).localeCompare(famN(z))).map(id => opt(id, famN(id) + ' (' + (F[id].n ?? '—') + ')', LB.fam === id)).join('') + '</select>'
      + '<input class="field lb-q" type="search" data-lb-q placeholder="Search name, idea or coin" aria-label="Search the strategies" value="' + esc(LB.q) + '"></div>'
      + (tot != null && tot > rs.length ? '<p class="note">Showing the ' + fmt.int(rs.length) + ' newest of ' + fmt.int(tot) + '.</p>' : '')
      + '<div id="lb-list">' + listHtml(L) + '</div></section>';
  }

  // ================================================================================ the Lab floor ==
  // A run's tests: the rows logged between its start and end (by day when a run has no times), oldest first.
  function runTests(L, R) {
    const t0 = isoS(R.start), t1 = isoS(R.end), rs = rowsOf(L);
    let list = t0 != null && t1 != null ? rs.filter(r => { const t = isoS(r.at); return t != null && t >= t0 - 5 && t <= t1 + 5; }) : [];
    if (!list.length) list = rs.filter(r => r.day === R.date);
    return list.slice().reverse().sort((a, z) => (isoS(a.at) || 0) - (isoS(z.at) || 0));
  }
  // The replay plan. Each test starts at its real start (its log time less its duration) and lasts its real duration,
  // both scaled by one factor so the whole run takes 15–60 s; a quiet gap over 20 s between two tests is cut to 20 s.
  // A finished test keeps its slot, stamp showing, until a new test needs the slot (the earliest finished one leaves
  // for the results wall first); at the end the rest leave one by one. A test waits for a free slot when all C run.
  function plan(list, t0, C) {
    const n = list.length, T = Math.min(60, Math.max(15, 8 + n * 0.9)) * 1000;
    const sec = r => Math.max(0.02, num(r.secs) || 0.5), raw = r => { const t = isoS(r.at); return t == null || t0 == null ? 0 : Math.max(0, t - sec(r) - t0); };
    let lastR = 0, acc = 0;
    const O = list.map(r => { const x = raw(r); acc += Math.min(20, Math.max(0, x - lastR)); lastR = Math.max(lastR, x); return acc; });
    const mk = (a, minD, hold, gap) => {
      const slot = Array.from({ length: C }, () => null); let prev = -gap, last = 0;
      const out = list.map((r, i) => {
        let s = Math.max(prev + gap, O[i] * a), j = slot.indexOf(null);
        if (j < 0) {
          j = 0; for (let q = 1; q < C; q++) if (slot[q].done < slot[j].done) j = q;
          s = Math.max(s, slot[j].done + hold + 300); slot[j].out = s - 300;
        }
        const x = { r, i, slot: j, s, d: Math.max(minD, sec(r) * a) };
        x.done = s + x.d; slot[j] = x; prev = s; last = Math.max(last, x.done);
        return x;
      });
      const rest = slot.filter(Boolean).sort((p, q) => p.done - q.done);
      rest.forEach((x, k) => { x.out = last + hold + k * 140; });
      return { out, end: last + hold + rest.length * 140 + 300, T };
    };
    let minD = 1500, hold = 900, gap = 200, p = mk(0, minD, hold, gap);
    if (p.end > T) { const f = Math.max(0.3, T / p.end); return mk(0, minD * f, hold * f, gap * f); }
    let lo = 0, hi = 60000;
    for (let it = 0; it < 32; it++) { const mid = (lo + hi) / 2; if (mk(mid, minD, hold, gap).end > T) hi = mid; else lo = mid; }
    return mk(lo, minD, hold, gap);
  }
  COMP.labPlan = (L, i, C) => { const R = arr(obj(L).runs)[i]; return R ? plan(runTests(L, R), isoS(R.start), C || 9) : null; };
  const FL = { R: null, tests: [], ev: [], k: 0, vt: 0, r0: 0, spd: 1, on: false, t: 0, io: null, live: {}, seen: false, wasOn: false, C: 9, cnt: null, sent: {} };
  const $f = id => document.getElementById(id);
  const slotsN = () => matchMedia('(min-width:1300px)').matches ? 12 : matchMedia('(min-width:641px)').matches ? 9 : 6;
  function runLabel(R, i) {
    const d = ymd(R.date), recent = i === 0 && d != null && nowS() - d < 36 * 3600, camp = !!obj(R.by).campaign && Object.keys(obj(R.by)).length === 1;
    return (recent ? (camp ? 'Latest campaign' : 'Last night’s run') : (camp ? 'Campaign of ' : 'Run of ') + (d != null ? fmt.md(d) : '—')) + ', replayed';
  }
  function floorHtml(L) {
    const runs = arr(L.runs).filter(isObj), R = runs[LB.run] || runs[0];
    const head = '<div class="head"><div class="ttl"><h2 id="lb-fh"' + hint('lab', 'floor', true) + '>Lab floor</h2><span class="sub" id="lb-rl"></span></div>';
    if (!R) return '<section class="card lb-floor" id="floor" aria-labelledby="lb-fh">' + head + '</div><p class="note">No run is recorded yet. The lab runs once a night; its first run shows here.</p></section>';
    const opt = runs.map((x, i) => '<option value="' + i + '"' + (x === R ? ' selected' : '') + '>' + esc((ymd(x.date) != null ? fmt.day(ymd(x.date)) : '—') + ' · ' + word.plural(num(x.tested) ?? 0, 'test') + ' · ' + Object.keys(obj(x.by)).map(byN).join(', ')) + '</option>').join('');
    const lane = (k, w, inner, cls) => '<div class="lb-lane lb-' + cls + '"><h3 class="lb-lh"' + hint('lab', k) + '>' + w + '</h3>' + inner + '</div>';
    return '<section class="card lb-floor" id="floor" aria-labelledby="lb-fh">' + head
      + '<div class="acts lb-ctl"><select class="lb-sel" data-lb-run aria-label="Pick a run">' + opt + '</select>'
      + '<button type="button" class="btn small lb-play" data-lb-play aria-pressed="false">Play</button>'
      + '<div class="seg quiet lb-spd" role="group" aria-label="Replay speed"><span class="ind"></span><button type="button" data-v="1" data-lb-spd="1" aria-pressed="' + (FL.spd === 1) + '">1×</button><button type="button" data-v="4" data-lb-spd="4" aria-pressed="' + (FL.spd === 4) + '">4×</button></div>'
      + '<button type="button" class="btn small ghost" data-lb-again>Replay</button></div></div>'
      + '<div class="lb-lanes">' + lane('scouts', 'Scouts', '<ul class="lb-sc" id="lb-sc"></ul><p class="lb-next" id="lb-next"></p>', 'scouts')
      + lane('bench', 'Test bench', '<div class="lb-slots" id="lb-bench"></div><p class="lb-bmsg" id="lb-bmsg" hidden></p>', 'bench')
      + lane('auditor', 'Auditor', '<ol class="lb-ql" id="lb-au"></ol>', 'aud') + lane('arena', 'Arena', '<ol class="lb-ql" id="lb-ar"></ol>', 'arena') + '</div>'
      + '<div class="lb-wallw"><div class="lb-cnt" id="lb-cnt"></div><div class="lb-wall" id="lb-wall" role="group" aria-label="Results wall"' + hint('lab', 'wall') + '></div>'
      + '<div class="legend lb-lg">' + ['k', 'f', 'w', 'x', 't', 'p'].map(c => '<span' + hint('lbv', c) + '><i class="lb-dot lb-v-' + c + '"></i>' + VW[c] + '</span>').join('') + '</div></div></section>';
  }
  function cntHtml() {
    const c = FL.cnt, it = (k, n, w) => '<span' + hint('lab', k) + '><b>' + fmt.int(n) + '</b> ' + w + '</span>';
    return it('tested', c.t, 'tested') + it('killed', c.k, 'killed early') + it('failed', c.f, 'failed') + it('waiting', c.w, 'waiting') + it('passed', c.p, 'passed');
  }
  function laneEmpty(id, w) { const el = $f(id); if (el && !el.children.length) el.innerHTML = '<li class="lb-none">' + w + '</li>'; }
  function laneAdd(id, h) { const el = $f(id); if (!el) return; const e = el.querySelector('.lb-none'); if (e) e.remove(); el.insertAdjacentHTML('beforeend', h); }
  function scoutsHtml() {
    const by = {}; for (const x of FL.tests) by[x.r.by || '?'] = (by[x.r.by || '?'] || 0) + 1;
    return Object.keys(by).map(b => '<li' + hint('lbby', b) + '><span class="lb-av lb-sv">' + esc((BY[b] || [, '··'])[1]) + '</span><span class="lb-sn">' + esc(byN(b)) + '</span><b class="lb-sk">' + fmt.int(FL.sent[b] || 0) + ' of ' + fmt.int(by[b]) + ' sent</b></li>').join('');
  }
  function paintScouts() {
    const sc = $f('lb-sc'); if (sc) sc.innerHTML = scoutsHtml();
    const nx = $f('lb-next'), up = FL.tests.find(x => !x.spawned);
    if (nx) nx.textContent = up ? 'Next idea: ' + (up.r.name || up.r.id) : FL.tests.length ? 'Every idea of this run is on the bench or done.' : '';
  }
  function paintCtl() {
    const b = document.querySelector('[data-lb-play]'); if (!b) return;
    const end = FL.k >= FL.ev.length;
    b.textContent = FL.on ? 'Pause' : end ? 'Play again' : FL.vt > 0 ? 'Resume' : 'Play';
    b.setAttribute('aria-pressed', FL.on ? 'true' : 'false');
    const fl = $f('floor'); if (fl) fl.classList.toggle('lb-paused', !FL.on);
  }
  // Build the floor for run LB.run: lanes empty, the wall empty, the counters at zero, then the events in time order.
  function build() {
    stop(); FL.live = {};
    const L = LB.L, runs = arr(L && L.runs).filter(isObj), R = runs[LB.run] || runs[0]; FL.R = R || null;
    if (!R) return;
    FL.C = slotsN();
    const list = runTests(L, R), p = plan(list, isoS(R.start), FL.C);
    FL.tests = p.out.map((x, i) => Object.assign(x, { n: 'T-' + String(i + 1).padStart(2, '0'), pp: pips(x.r), spawned: false }));
    FL.ev = [];
    for (const x of FL.tests) FL.ev.push({ t: x.s, ty: 0, x }, { t: x.done, ty: 1, x }, { t: x.out, ty: 2, x });
    FL.ev.sort((a, z) => a.t - z.t || a.ty - z.ty);
    FL.k = 0; FL.vt = 0; FL.sent = {}; FL.cnt = { t: 0, k: 0, f: 0, w: 0, p: 0 };
    const secs = num(R.secs), rl = $f('lb-rl');
    if (rl) rl.textContent = runLabel(R, LB.run) + ' · ' + word.plural(list.length, 'test') + (secs != null ? ' · ' + fmt.dur(secs) + ' of compute' : '') + (isoS(R.start) != null ? ' · started ' + fmt.when(isoS(R.start)) : '');
    const bench = $f('lb-bench');
    if (bench) { bench.innerHTML = Array.from({ length: FL.C }, (_, i) => '<div class="lb-slot" data-slot="' + i + '"></div>').join(''); }
    const msg = $f('lb-bmsg'); if (msg) msg.hidden = true;
    ['lb-au', 'lb-ar', 'lb-wall'].forEach(id => { const el = $f(id); if (el) el.innerHTML = ''; });
    laneEmpty('lb-au', 'Nothing has reached the auditor yet.'); laneEmpty('lb-ar', 'No new arena bot yet.');
    const c = $f('lb-cnt'); if (c) c.innerHTML = cntHtml();
    paintScouts(); paintCtl();
    if (!list.length && msg) { msg.hidden = false; msg.textContent = 'This run’s tests are older than the log keeps.'; }
  }
  const vnow = () => FL.on ? FL.vt + (performance.now() - FL.r0) * FL.spd : FL.vt;
  function podHtml(x) {
    const r = x.r;
    return '<button type="button" class="lb-pod lb-c' + famIdx(r.fam) + '" data-sheet="lab:' + esc(r.id) + '" aria-label="' + esc(x.n + ': ' + (r.name || r.id)) + '">'
      + '<span class="lb-pt"><span class="lb-av">' + x.n + '</span><span class="lb-pf">' + esc(famN(r.fam)) + '</span></span><span class="lb-pn">' + esc(r.name || r.id) + '</span>'
      + '<span class="lb-pips" aria-hidden="true">' + x.pp.map(s => '<i class="' + (s === 'skip' ? 'lb-skip' : s === 'wait' ? 'lb-wt' : '') + '"><b></b></i>').join('') + '</span>'
      + '<span class="lb-st"></span></button>';
  }
  // Each pip that runs fills in turn over the test's replayed length (Web Animations: pause and speed follow the clock).
  function animate(x, el) {
    const run = x.pp.map((s, i) => s === 'ok' || s === 'no' ? i : -1).filter(i => i >= 0), bars = el.querySelectorAll('.lb-pips b'), per = x.d / Math.max(1, run.length);
    x.an = [];
    if (typeof el.animate !== 'function') return;
    run.forEach((pi, j) => {
      const a = bars[pi].animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: per, delay: j * per, fill: 'both', easing: 'linear' });
      a.currentTime = Math.max(0, vnow() - x.s); a.playbackRate = FL.spd; if (!FL.on) a.pause();
      x.an.push(a);
    });
  }
  function fire(e, instant) {
    const x = e.x, r = x.r, V = vOf(r);
    if (e.ty === 0) {
      x.spawned = true; FL.sent[r.by || '?'] = (FL.sent[r.by || '?'] || 0) + 1;
      if (!instant) { const slot = document.querySelector('#lb-bench [data-slot="' + x.slot + '"]'); if (slot) { slot.innerHTML = podHtml(x); x.el = slot.firstElementChild; FL.live[r.id] = x; animate(x, x.el); } }
      paintScouts(); return;
    }
    if (e.ty === 1) {
      if (x.el) { x.el.classList.add('lb-done', 'lb-v-' + V.c); x.el.querySelectorAll('.lb-pips i').forEach((p, i) => { if (x.pp[i]) p.classList.add('lb-' + x.pp[i]); }); const st = x.el.querySelector('.lb-st'); if (st) st.textContent = stamp(r); }
      const s = stageOf(r);
      if (s === 'review' || s === 'passed') laneAdd('lb-au', '<li><button type="button" data-sheet="lab:' + esc(r.id) + '"><b>' + x.n + '</b> ' + (s === 'review' ? 'Turned down' : 'Approved') + '</button></li>');
      if (r.arena) laneAdd('lb-ar', '<li><button type="button" data-sheet="lab:' + esc(r.id) + '"><b>' + x.n + '</b> → ' + esc(r.arena) + '</button></li>');
      const c = FL.cnt; c.t++; c[V.c === 'k' ? 'k' : V.c === 'w' ? 'w' : V.c === 'p' || V.c === 'a' ? 'p' : 'f']++;
      const cn = $f('lb-cnt'); if (cn) cn.innerHTML = cntHtml();
      return;
    }
    if (x.el) { const el = x.el; el.classList.add('lb-out'); setTimeout(() => { if (el.isConnected) el.remove(); }, instant ? 0 : 280); x.el = null; }
    delete FL.live[r.id];
    const wall = $f('lb-wall');
    if (wall) wall.insertAdjacentHTML('beforeend', '<button type="button" class="lb-dot lb-v-' + V.c + (instant ? '' : ' lb-new') + '" data-sheet="lab:' + esc(r.id) + '" aria-label="' + esc(x.n + ', ' + (r.name || r.id) + ': ' + stamp(r)) + '"></button>');
  }
  function finish() {
    FL.on = false; clearTimeout(FL.t); FL.t = 0;
    const msg = $f('lb-bmsg');
    if (msg && FL.tests.length) { msg.hidden = false; msg.textContent = 'All ' + word.plural(FL.tests.length, 'test') + ' finished' + (reduced ? ' (motion is off on this device, so the run shows finished)' : '') + '. Tap a dot for its record.'; }
    laneEmpty('lb-au', 'Nothing reached the auditor in this run.'); laneEmpty('lb-ar', 'No new arena bot from this run.');
    paintCtl();
  }
  function tick() {
    FL.t = 0; const v = vnow();
    while (FL.k < FL.ev.length && FL.ev[FL.k].t <= v + 1) fire(FL.ev[FL.k++]);
    if (FL.k >= FL.ev.length) { FL.vt = v; finish(); return; }
    if (FL.on) FL.t = setTimeout(tick, Math.max(16, (FL.ev[FL.k].t - v) / FL.spd));
  }
  // The finished run at once: no pods, every dot, every lane (reduced motion, or a jump to the end).
  function toEnd() { FL.on = false; clearTimeout(FL.t); while (FL.k < FL.ev.length) fire(FL.ev[FL.k++], true); FL.vt = FL.ev.length ? FL.ev[FL.ev.length - 1].t : 0; finish(); }
  function each(fn) { for (const id in FL.live) for (const a of FL.live[id].an || []) call(fn, a); }
  function play() {
    if (FL.on || !FL.R) return;
    if (reduced) { if (FL.k < FL.ev.length) toEnd(); return; }
    if (FL.k >= FL.ev.length) build();
    FL.on = true; FL.r0 = performance.now(); each(a => a.play()); paintCtl(); tick();
  }
  function stop() { if (FL.on) { FL.vt = vnow(); FL.on = false; } clearTimeout(FL.t); FL.t = 0; each(a => a.pause()); paintCtl(); }
  function speed(x) { FL.vt = vnow(); FL.r0 = performance.now(); FL.spd = x; each(a => { a.playbackRate = x; }); if (FL.on) { clearTimeout(FL.t); tick(); } }
  function startFloor(root) {
    build();
    if (reduced) { toEnd(); return; }
    const fl = $f('floor');
    if (FL.io) FL.io.disconnect();
    // The first time the floor is on screen it plays once (a hidden page plays when it is shown again).
    const go = () => { FL.seen = true; if (document.hidden) FL.wasOn = true; else play(); };
    if (!fl || FL.seen || !('IntersectionObserver' in window)) { if (!FL.seen) go(); return; }
    FL.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !FL.seen) { FL.io.disconnect(); go(); } }, { threshold: 0.25 });
    FL.io.observe(fl);
  }

  // ===================================================================================== the view ==
  COMP.labPage = L => { LB.L = L; return headHtml(L) + logHtml(L); };
  COMP.labSheet = (L, id, D) => { LB.L = L; const r = rowsOf(L).find(x => x.id === id), T = D ? arr(D.trials).find(t => isObj(t) && t.id === id) : null; return r ? detailHtml(r, T, D ? (T ? '' : 'missing') : 'missing') : ''; };
  function stateCard(t, p, btn) { return '<div class="card rise lb-empty"><div class="empty"><h2>' + esc(t) + '</h2><p>' + esc(p) + '</p>' + (btn || '') + '</div></div>'; }
  function render(root, why) {
    LB.root = root;
    if (!LB.L && !LB.err) { load().then(() => { if (LB.root && LB.root.isConnected) redraw(); }); return '<div class="card"><div class="empty">Loading the lab’s log…</div></div>'; }
    if (!LB.L) {
      const retry = '<button type="button" class="btn" data-lb-retry>Retry</button>';
      return LB.err === 'missing' ? stateCard('Not connected yet', 'The lab’s log isn’t connected yet — one setup step on the owner’s side (a Cloudflare key in the lab’s GitHub secrets).')
        : LB.err === 'auth' ? stateCard('Signed out', 'Your session ended. Sign in again to see the lab.', '<a class="btn primary" href="/login">Sign in</a>')
        : LB.err === 'net' ? stateCard('Can’t reach the dashboard', 'Check the connection, then try again.', retry) : stateCard('The lab’s log couldn’t be read', 'The lab writes a fresh copy after its next run.', retry);
    }
    return '<div class="lb">' + safe(() => headHtml(LB.L), 'Lab totals') + safe(() => floorHtml(LB.L), 'Lab floor') + safe(() => logHtml(LB.L), 'Strategy log') + '</div>';
  }
  function relist() { const el = $f('lb-list'); if (el && LB.L) el.innerHTML = listHtml(LB.L); }
  let qT = 0;
  function after(root) {
    if (!LB.L) {
      const onR = e => { if (e.target instanceof Element && e.target.closest('[data-lb-retry]')) { e.preventDefault(); LB.err = null; redraw(); } };
      root.addEventListener('click', onR); return () => root.removeEventListener('click', onR);
    }
    call(startFloor, root);
    const onClick = e => {
      const t = e.target instanceof Element ? e.target : null; if (!t || e.button > 0) return;
      let el;
      if ((el = t.closest('[data-lb-play]'))) { e.preventDefault(); if (FL.on) stop(); else play(); return; }
      if ((el = t.closest('[data-lb-spd]'))) { e.preventDefault(); speed(Number(el.dataset.lbSpd) || 1); setSeg(el.closest('.seg'), el.dataset.v); return; }
      if (t.closest('[data-lb-again]')) { e.preventDefault(); build(); play(); return; }
      if ((el = t.closest('[data-lb-f]'))) { e.preventDefault(); LB.f = el.dataset.lbF; LB.n = 80; root.querySelectorAll('[data-lb-f]').forEach(b => b.setAttribute('aria-pressed', String(b === el))); relist(); return; }
      if (t.closest('[data-lb-more]')) { e.preventDefault(); LB.n += 100; relist(); return; }
      if (t.closest('[data-lb-clear]')) { e.preventDefault(); LB.f = 'all'; LB.fam = ''; LB.q = ''; redraw(); }
    };
    const onChange = e => {
      const t = e.target;
      if (t.matches('[data-lb-run]')) { LB.run = Number(t.value) || 0; build(); if (!reduced) play(); else toEnd(); }
      else if (t.matches('[data-lb-fam]')) { LB.fam = t.value; LB.n = 80; relist(); }
    };
    const onInput = e => { if (!e.target.matches('[data-lb-q]')) return; clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { LB.q = v; LB.n = 80; relist(); }, 150); };
    root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput);
    // A deep link (#floor, #log) lands once the log has drawn (after core's redraw has put the old scroll back).
    if (!LB.jumped && /^#(floor|log)$/.test(location.hash)) { LB.jumped = true; setTimeout(() => { const a = $f(location.hash.slice(1)); if (a) into(a, false); }, 60); }
    return () => { stop(); if (FL.io) FL.io.disconnect(); FL.io = null; root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); };
  }
  VIEWS.lab = { title: 'AiFi Lab', render, after };
  if (PAGE === 'lab') {
    hook('hide', () => { FL.wasOn = FL.on; stop(); });
    hook('show', () => {
      if (FL.wasOn) { FL.wasOn = false; play(); }
      if (Date.now() - LB.at > 30 * 60e3 && !LB.p && !FL.on) { const g = LB.L && LB.L.gen; load().then(() => { if (LB.L && LB.L.gen !== g) redraw(); }); }
    });
  }

  // ============================================================================ the detail sheet ==
  const PW = {
    stop_pct: v => 'Protective stop: ' + v + '%',
    vol_target: v => 'Aims for about ' + Math.round(v > 1 ? v : v * 100) + '% yearly swings',
    vol_days: v => 'Measures swings over ' + v + ' days',
    rebalance_days: v => 'Re-ranks every ' + v + ' days',
    fast: v => 'Short average: ' + v + ' days',
    slow: v => 'Long average: ' + v + ' days',
    long_regimes: v => 'Invested only in ' + arr(v).join(', ') + ' markets',
    short_regimes: v => 'Bets on falling prices in ' + arr(v).join(', ') + ' markets',
    short: v => v ? 'May bet on falling prices' : 'Never bets on falling prices',
  };
  function settings(p) {
    const ks = Object.keys(obj(p)); if (!ks.length) return '';
    const plain = ks.filter(k => PW[k] && p[k] != null && (k !== 'long_regimes' && k !== 'short_regimes' || arr(p[k]).length)).map(k => '<li>' + esc(PW[k](p[k])) + '</li>');
    return '<div class="sec"><h3>Settings</h3>' + (plain.length ? '<ul class="lb-ul">' + plain.join('') + '</ul>' : '')
      + '<details class="disc lb-raw"><summary>All ' + ks.length + ' settings, as the lab wrote them</summary><div class="body"><dl class="facts">'
      + ks.map(k => '<dt>' + esc(k) + '</dt><dd><code>' + esc(typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])) + '</code></dd>').join('') + '</dl></div></details></div>';
  }
  function pipsBig(r) {
    return '<ol class="lb-bpips">' + pips(r).map((s, i) => '<li class="lb-' + (s || 'none') + '"' + hint('lab', 'pip' + i) + '><i></i>' + PIPS[i]
      + '<span class="sub">' + ({ ok: 'passed', no: 'failed here', wait: 'still to come', skip: 'not in its rulebook', '': 'not reached' })[s] + '</span></li>').join('') + '</ol>';
  }
  const fact = (k, v, tk) => '<dt' + (tk ? hint('chk', tk) : '') + '>' + esc(k) + '</dt><dd>' + v + '</dd>';
  function detailHtml(r, T, state) {
    const V = vOf(r), t = isoS(r.at), x = T || {};
    let h = '<h2>' + esc(r.name || r.id) + '</h2><p class="sub lb-dsub">' + esc([famN(r.fam), 'proposed by ' + byN(r.by), t != null ? 'tested ' + fmt.stamp(t) : '', num(r.gv) != null ? 'rulebook v' + r.gv : ''].filter(Boolean).join(' · ')) + '</p>'
      + '<p class="lb-dv"><span class="lb-vc lb-v-' + V.c + '"' + hint('lbv', V.c) + '>' + esc(V.w) + '</span>' + (stopAt(r) ? ' <span class="ink2">stopped at: ' + esc(stopAt(r)) + '</span>' : '') + '</p>' + pipsBig(r);
    if (r.arena) h += '<p><a class="btn small" href="' + esc(botHref(r.arena)) + '">Open ' + esc(r.arena) + ' in the arena ›</a></p>';
    h += '<div class="sec"><h3>What it does</h3>' + (r.desc || x.desc ? '<p>' + esc(x.desc || r.desc) + '</p>' : '<p class="note">—</p>')
      + (x.hypothesis ? '<p class="ink2"><b>The idea:</b> ' + esc(x.hypothesis) + '</p>' : '') + (x.source ? '<p class="sub">Source: ' + esc(x.source) + '</p>' : '')
      + '<p class="lb-coins">' + esc(word.plural(T ? arr(x.coins).length : num(r.coins_n) ?? arr(r.coins).length, 'coin')) + ': ' + arr(T ? x.coins : r.coins).map(c => '<span class="tk">' + esc(c) + '</span>').join(' ')
      + (!T && num(r.coins_n) > arr(r.coins).length ? ' …' : '') + '</p></div>';
    if (state === 'wait') h += '<p class="note">Loading the full record…</p>';
    else if (state === 'missing' || state === 'parse') h += '<p class="note">The full record of this test isn’t stored; the summary below is from the log.</p>';
    else if (state) h += '<p class="note">The full record couldn’t be loaded' + (state === 'net' ? ' (no connection)' : '') + '. <button type="button" class="btn small ghost" data-lb-day="' + esc(r.day) + '">Retry</button></p>';
    if (T) h += settings(x.params);
    // the checks: every one with ✓ / ✗ and the lab's own detail; without the full record, the failed ones from the log
    const cs = arr(x.checks).filter(isObj);
    if (cs.length) h += '<div class="sec"><h3>Checks</h3><ul class="lb-checks">' + cs.map(c => '<li class="' + (c.ok ? 'lb-ok' : 'lb-no') + '"><span class="lb-ck" aria-label="' + (c.ok ? 'passed' : 'failed') + '">' + (c.ok ? '✓' : '✗') + '</span><span><b' + hint('chk', c.check) + '>' + esc(chk(c.check)) + '</b>'
      + (c.detail ? '<span class="sub">' + esc(c.detail) + '</span>' : '') + '</span></li>').join('') + '</ul></div>';
    else if (arr(r.fail).length) h += '<div class="sec"><h3>Failed checks</h3><ul class="lb-checks">' + arr(r.fail).map(c => '<li class="lb-no"><span class="lb-ck" aria-label="failed">✗</span><span><b' + hint('chk', c) + '>' + esc(chk(c)) + '</b></span></li>').join('') + '</ul></div>';
    const d = obj(x.dev), df = obj(x.deflated), al = obj(x.alpha);
    const prob = num(df.prob) ?? num(r.dfl), dd = num(d.max_dd_pct) ?? num(r.dd);
    h += '<div class="sec"><h3>Backtest on past prices</h3><dl class="facts">'
      + fact('Return a year', P(num(d.cagr_pct) ?? r.cagr)) + fact('Sharpe', Sh(num(d.sharpe) ?? r.sh), 'Sharpe') + fact('Worst drop', dd != null ? esc(fmt.pctu(dd, 1)) : '—', 'max drawdown')
      + (num(d.years) != null ? fact('Tested over', esc(fmt.num(d.years, 1)) + ' years' + (num(d.total_pct) != null ? ' · ' + P(d.total_pct) + ' in all' : '')) : '')
      + fact('Luck test', prob == null ? '—' : esc(fmt.int(prob * 100)) + '% sure it isn’t luck' + (num(df.trials) != null ? ' <span class="sub">(after ' + esc(word.plural(df.trials, 'try', 'tries')) + ' of this type)</span>' : ''), 'deflated Sharpe')
      + (num(al.ann_pct) != null ? fact('Against just holding', P(al.ann_pct) + ' a year' + (num(al.t) != null ? ' <span class="sub">(t ' + esc(fmt.num(al.t)) + ')</span>' : ''), 'beats holding the coins') : '') + '</dl></div>';
    const rg = obj(x.regimes), rk = ['bull', 'bear', 'crisis'].filter(k => isObj(rg[k]));
    if (rk.length) h += '<div class="sec"><h3>By kind of market</h3><ul class="lb-ul lb-rg">' + rk.map(k => { const g = rg[k]; return '<li><b>' + cap1(k) + '</b> ' + P(g.ann_ret_pct) + ' a year · Sharpe ' + Sh(g.sharpe)
      + (num(g.invested) != null ? ' · ' + esc(fmt.int(g.invested * 100)) + '% invested on average' : '') + (num(g.days) != null ? ' <span class="sub">(' + esc(fmt.int(g.days)) + ' days)</span>' : '') + '</li>'; }).join('') + '</ul></div>';
    const ys = Object.keys(obj(x.years)).sort();
    if (ys.length) h += '<div class="sec"><h3>Year by year</h3><p class="lb-years">' + ys.map(y => '<span><b>' + esc(y) + '</b> ' + P(x.years[y]) + '</span>').join('') + '</p></div>';
    const oc = arr(x.other_coins).filter(isObj);
    if (oc.length) h += '<div class="sec"><h3' + hint('chk', 'works on other coins') + '>On other coins</h3><ul class="lb-ul">' + oc.map(o => '<li>' + esc(arr(o.coins).join(', ') || '—') + ' · Sharpe ' + Sh(o.sharpe) + '</li>').join('') + '</ul></div>';
    const ho = isObj(x.holdout) ? x.holdout : null;
    if (ho || num(r.hold) != null) h += '<div class="sec"><h3' + hint('chk', 'holdout') + '>Final exam: the unseen year</h3><dl class="facts">' + fact('Return', P(ho ? num(ho.cagr_pct) ?? ho.ann_ret_pct : null)) + fact('Sharpe', Sh(ho ? ho.sharpe : r.hold))
      + (ho && num(ho.max_dd_pct) != null ? fact('Worst drop', esc(fmt.pctu(ho.max_dd_pct, 1))) : '') + '</dl></div>';
    if (x.veto || x.review) h += '<div class="sec"><h3' + hint('lab', 'auditor') + '>Auditor</h3><p>' + (x.veto ? '<b>Turned down:</b> ' + esc(typeof x.veto === 'string' ? x.veto : 'no reason recorded') : '<b>Note:</b> ' + esc(x.review)) + '</p></div>';
    else if (r.veto) h += '<div class="sec"><h3>Auditor</h3><p>Turned down' + (T ? '; no reason recorded.' : '.') + '</p></div>';
    return h;
  }
  SHEETS.lab = function (id) {
    const r = rowsOf(LB.L).find(x => x.id === id);
    if (!r) return '<h2>Strategy</h2><p class="note">This strategy isn’t in the lab’s log.</p>';
    const D = LB.days[r.day], T = D ? arr(D.trials).find(t => isObj(t) && t.id === id) : null, e = LB.dayErr[r.day];
    return { html: detailHtml(r, T, D ? (T ? '' : 'missing') : e || 'wait'), cls: 'lb-sheet',
      after(el) {
        if (!D && !e && r.day) loadDay(r.day).then(() => refreshSheet());
        const onR = ev => { const b = ev.target instanceof Element && ev.target.closest('[data-lb-day]'); if (b) { ev.preventDefault(); delete LB.dayErr[b.dataset.lbDay]; refreshSheet(); } };
        el.addEventListener('click', onR); return () => el.removeEventListener('click', onR);
      } };
  };
}
