// cloud/ui/factory.js — the bot factory's two sheets (docs/specs/FACTORY.md): Shortlist (Phase 5) and Fleet (Phase 6).
// Data: /api/factory (exec:factory), written by the AiFi Lab nightly and carried by the hourly push. Read-only: the
// dashboard never switches a bot live; the Shortlist links to the owner's go-live workflow instead. Prefix fx-.
{
  let FX = null, fxErr = null, fxAt = 0, fxP = null;
  const GOLIVE = 'https://github.com/SproutHouse/AiFi_Executor/actions/workflows/go-live.yml';
  const CONTROL = 'https://github.com/SproutHouse/AiFi_Executor/actions/workflows/control.yml';
  function load(force) {
    if (!force && FX && Date.now() - fxAt < 300000) return Promise.resolve(FX);
    if (fxP) return fxP;
    fxP = getJSON('/api/factory', 10000).then(d => { FX = d && d.v === 1 ? d : null; fxErr = FX ? null : 'empty'; fxAt = Date.now(); return FX; })
      .catch(e => { fxErr = (e && e.kind) || 'net'; return null; }).finally(() => { fxP = null; });
    return fxP;
  }
  const P = (v, d) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%';
  const U = (v, d) => v == null ? '—' : Number(v).toFixed(d == null ? 1 : d) + '%';
  const N = (v, d) => v == null ? '—' : Number(v).toFixed(d == null ? 2 : d);
  function waiting(title) {
    const msg = fxErr === 'empty' || fxErr === 'missing' ? 'The AiFi Lab has not published the factory yet. It appears after the lab’s nightly batch and the next check.'
      : fxErr ? 'Could not load the factory (' + esc(fxErr) + ').' : 'Loading…';
    return { html: '<h2>' + esc(title) + '</h2><div class="empty">' + msg + '</div>',
             after() { if (!FX && !fxErr) load().then(() => refreshSheet()); } };
  }
  function regimeLine(F) {
    const r = F.regime;
    return r ? '<span class="pill ' + (r.now === 'bull' ? 'good' : r.now === 'crisis' ? 'bad' : 'warn') + '">Market: ' + esc(r.now) + '</span> <span class="sub">since ' + esc(r.since) + '</span>' : '';
  }
  function statusPill(s) {
    if (s.live) return '<span class="pill live">Live</span>';
    if (!s.enabled) return '<span class="pill bad">Retired</span>';
    if (s.ready === true) return '<span class="pill good">Ready for you</span>';
    return '<span class="pill pt">Paper · ' + esc(s.status || 'incubating') + '</span>';
  }
  // ---- the lab's evidence for one shortlisted bot (lab contract 2026-10-16; every field optional, "—" when missing):
  // how sure it is not luck NOW (deflated_now; the trial's figure only as "at its trial"), the bot against Bitcoin held and
  // Bitcoin at the same risk over the backtest, the unseen year and paper, whether execution was verified, and how strong
  // the evidence of an edge is. "Ready" now means execution verified AND strong evidence; only s.ready === true says so.
  const pc = v => num(v) == null ? '—' : fmt.pct(v, 1);
  const BENCH = [['dev', 'Backtest'], ['holdout', 'Unseen year'], ['paper', 'Paper']];
  const EVL = { weak: 'weak', moderate: 'moderate', strong: 'strong' };
  const OK = v => v === true ? '✓' : v === false ? '✗' : '—';
  function evidence(s) {
    const now = num(s.deflated_now), at = num(s.deflated_at_trial) ?? num((s.backtest || {}).deflated);
    let h = '<p class="fx-ev"><b' + hint('fxe', 'luck') + '>Not luck, now:</b> ' + (now == null ? '—' : fmt.pctu(now * 100, 0) + ' sure')
      + (at != null ? ' <span class="sub">(' + fmt.pctu(at * 100, 1) + ' at its trial' + (num(s.trials_now) ? '; ' + word.plural(s.trials_now, 'recipe') + ' tried by now' : '') + ')</span>' : '') + '</p>';
    const B = isObj(s.bench) ? s.bench : {}, rows = BENCH.filter(p => isObj(B[p[0]])).map(([k, w]) => {
      const b = B[k], d = num(b.days), x = num(b.excess_pct_yr);
      return '<li><b>' + w + '</b>' + (d != null ? ' (' + word.plural(Math.round(d), 'day') + ')' : '') + ': bot ' + pc(b.bot_pct) + ' · Bitcoin ' + pc(b.btc_pct) + ' held, ' + pc(b.btc_same_risk_pct) + ' at the same risk'
        + (x != null ? ' · <span class="' + fmt.cls(x) + '">' + (x < 0 ? 'trails' : 'beats') + ' it by ' + fmt.pctu(x, 1) + '/yr</span>' + (num(b.excess_t) != null ? ' (t ' + fmt.num(b.excess_t, 1) + ')' : '') : '') + '</li>';
    });
    h += '<div class="fx-ev"><b' + hint('fxe', 'btc') + '>vs Bitcoin</b>' + (rows.length ? '<ul class="fx-evl">' + rows.join('') + '</ul>' : ' —') + '</div>';
    const x = isObj(s.execution) ? s.execution : null, ck = x && Array.isArray(x.checks) ? x.checks.filter(isObj) : [];
    h += '<div class="fx-ev"><b' + hint('fxe', 'exec') + '>Execution verified ' + OK(x && x.ok) + '</b>' + (x ? ' <span class="sub">' + [num(x.orders) != null ? word.plural(x.orders, 'order') : '',
      num(x.invested_days) != null ? fmt.int(x.invested_days) + ' days invested' : '', num(x.healthy_run_frac) != null ? fmt.pctu(x.healthy_run_frac * 100, 0) + ' of checks clean' : '',
      num(x.return_gap_pct) != null ? 'paper vs backtest ' + fmt.pct(x.return_gap_pct) : ''].filter(Boolean).join(' · ') + '</span>' : '')
      + (ck.length ? '<ul class="fx-evl">' + ck.map(c => '<li class="' + fmt.cls(c.ok === true ? 1 : c.ok === false ? -1 : 0) + '">' + OK(c.ok) + ' ' + esc(c.check || '') + (c.detail ? ' <span class="sub">' + esc(c.detail) + '</span>' : '') + '</li>').join('') + '</ul>' : '') + '</div>';
    const e = isObj(s.evidence) ? s.evidence : null, ts = e ? [num(e.alpha_t_own), num(e.alpha_t_btc)].filter(v => v != null) : [];
    const t = ts.length ? Math.min(...ts) : null, need = num(e && e.needed_t) ?? 2, mo = num(e && e.months_more), lv = e && EVL[e.level];
    h += '<div class="fx-ev"><b' + hint('fxe', 'edge') + '>Edge evidence: ' + (lv || '—') + '</b>' + (e ? ' <span class="sub">(' + (t != null ? 't ' + fmt.num(t, 1) + ' of ' + fmt.num(need, 1) + ' needed' : 'no t yet')
      + (mo != null && lv !== 'strong' ? ', about ' + word.plural(Math.ceil(mo), 'more month') : '') + ')</span>' : '')
      + '<div class="meter fx-em" role="img" aria-label="' + esc('Edge evidence ' + (lv || 'not known') + (t != null ? ', t ' + fmt.num(t, 1) + ' of ' + fmt.num(need, 1) + ' needed' : '')) + '"><i style="width:' + (t != null ? Math.max(0, Math.min(100, t / need * 100)).toFixed(0) : 0) + '%"></i></div></div>';
    return '<div class="fx-evs">' + h + '</div>';
  }
  COMP.labEvidence = s => isObj(s) ? evidence(s) : '';
  TIP.fxe = a => ({
    luck: ['Not luck', 'How sure the lab is that the backtest is not a lucky fluke, counting every recipe it has tried: the more it tries, the more one looks good by chance. “At its trial” is the figure when it was picked; “now” counts every try since.'],
    btc: ['vs Bitcoin', 'The bot’s return next to simply holding Bitcoin, and next to Bitcoin scaled to the same ups and downs as the bot. “Beats it by” is the yearly gap to that same-risk Bitcoin; t says how sure the gap is (2 or more is convincing).'],
    exec: ['Execution verified', 'Whether its paper trading did what its backtest says it would: the orders, the days invested, the checks that ran cleanly, and how close the paper return is to the backtest replayed over the same days.'],
    edge: ['Edge evidence', 'How strong the proof is that it earns more than holding: weak, moderate or strong. A t of 2 is the bar; the months are the lab’s estimate of how long the evidence needs. Ready for you needs strong evidence and verified execution.'] })[a];
  function card(s) {
    const b = s.backtest || {}, p = s.paper || {}, rg = b.regimes || {};
    const regs = ['bull', 'bear', 'crisis'].filter(k => rg[k] != null).map(k => '<span class="fx-kv"><i>' + k + '</i><b>' + P(rg[k]) + '/yr</b></span>').join('');
    const nr = (s.not_ready || []).length ? '<ul class="fx-nr">' + s.not_ready.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '';
    const go = s.ready === true ? '<details class="fx-go"><summary>How to switch it live</summary><ol>'
      + '<li>Make a new Hyperliquid wallet for this bot only and deposit its pot (start small).</li>'
      + '<li>On that wallet, create an API wallet (Hyperliquid: More → API). It can trade but can never withdraw.</li>'
      + '<li>In the Executor repo’s Actions secrets add <code>HL_AGENT_KEY_' + esc(s.agent.toUpperCase().replace(/-/g, '_')) + '</code> and <code>HL_ACCOUNT_ADDRESS_' + esc(s.agent.toUpperCase().replace(/-/g, '_')) + '</code>.</li>'
      + '<li>Run <a href="' + GOLIVE + '" target="_blank" rel="noopener">go-live</a> with agent <code>' + esc(s.agent) + '</code>, the pot, and confirm <code>LIVE ' + esc(s.agent) + '</code>. A paper twin starts beside it to measure the cost of real fills.</li></ol></details>' : '';
    return '<div class="fx-card rise"><div class="fx-hd"><div class="fx-t"><b>' + esc(s.name || s.agent) + '</b> ' + statusPill(s) + '<div class="sub">' + esc(s.family) + ' · ' + esc(s.tag || '') + ' · recipe ' + esc(s.recipe) + ' · in the arena since ' + esc(s.enrolled) + '</div></div>'
      + '<button class="btn small" type="button" data-fx-agent="' + esc(s.agent) + '">Open</button></div>'
      + (s.hypothesis ? '<p class="fx-hy">' + esc(s.hypothesis) + '</p>' : '')
      + '<div class="fx-grid"><div><div class="fx-h3">Backtest</div>'
      + '<span class="fx-kv"><i>Sharpe</i><b>' + N(b.sharpe) + '</b></span><span class="fx-kv"><i>Return</i><b>' + P(b.cagr_pct) + '/yr</b></span>'
      + '<span class="fx-kv"><i>Worst drop</i><b>' + U(b.max_dd_pct) + '</b></span><span class="fx-kv"><i>Unseen year</i><b>Sharpe ' + N(b.holdout_sharpe) + '</b></span>'
      + (b.alpha_t != null ? '<span class="fx-kv"><i>Beats holding</i><b>t ' + N(b.alpha_t) + '</b></span>' : '') + '</div>'
      + '<div><div class="fx-h3">By market</div>' + (regs || '<span class="sub">—</span>') + '</div>'
      // the lab's own paper snapshot, dated: the bot's page has its live numbers
      + '<div><div class="fx-h3">Paper so far · lab, ' + esc(FX && FX.gen ? fmt.when(isoS(FX.gen)) : '—') + '</div><span class="fx-kv"><i>Days</i><b>' + N(s.days, 0) + '</b></span><span class="fx-kv"><i>Return</i><b>' + P(p.ret_pct, 2) + '</b></span>'
      + '<span class="fx-kv"><i>Drawdown</i><b>' + U(p.dd_pct) + '</b></span><span class="fx-kv"><i>Matches backtest</i><b>' + (p.weight_match_pct != null ? p.weight_match_pct + '% of ' + p.weight_checks : '—') + '</b></span></div></div>'
      + evidence(s) + nr + go + '</div>';
  }
  function afterCards(el) { $$('[data-fx-agent]', el).forEach(b => b.onclick = () => switchAgent(b.dataset.fxAgent)); }
  SHEETS.shortlist = function () {
    if (!FX) return waiting('Shortlist');
    const F = FX, L = F.lab || {}, list = F.shortlist || [];
    const ready = list.filter(s => s.ready === true).length;
    return { html: '<div class="doc"><h2>Shortlist</h2><p class="sub">Bots the AiFi Lab built and tested: each passed every backtest check and a locked final year it had never seen, and is now proving itself in paper. <b>Ready</b> means its paper trading was verified against its backtest and the evidence of an edge is strong. It is never an instruction: only your go-live workflow switches a bot to real money.</p>'
      + '<p class="fx-line">' + regimeLine(F) + ' <span class="sub">· ' + (L.tried || 0) + ' recipes tried · ' + (L.survivors || 0) + ' survived · ' + (L.retired || 0) + ' retired · ' + (L.vetoed || 0) + ' vetoed · last batch ' + esc(L.last_batch || '—') + ' · rules v' + esc(L.gates_version || '—') + '</span></p>'
      + '<p class="fx-line"><b>' + ready + '</b> ready for you · ' + list.filter(s => s.live).length + ' live · ' + list.filter(s => s.enabled && !s.live && s.ready !== true).length + ' still proving themselves</p></div>'
      + (list.length ? list.map(card).join('') : '<div class="empty">No bot has survived the lab yet.</div>'),
      after(el) { afterCards(el); } };
  };
  SHEETS.fleet = function () {
    if (!FX) return waiting('Fleet');
    const F = FX.fleet || {}, K = F.kill || {}, T = F.totals || {}, M = F.members || [], C = F.corr || {};
    const kill = K.halt ? '<span class="pill bad">Fleet halted</span> <span class="sub">' + esc(K.reason || '') + '</span>' : '<span class="pill good">Fleet running</span>';
    const tot = m => T[m] ? '<span class="fx-kv"><i>' + (m === 'live' ? 'Live' : 'Paper') + ' · ' + T[m].agents + ' agents</i><b>' + P(T[m].ret_pct, 2) + ' · drawdown ' + U(T[m].dd_pct) + '</b></span>' : '';
    const rows = M.map(m => '<tr><td class="l">' + esc(m.name || m.agent) + '<div class="sub">' + esc(m.kind) + '</div></td><td class="l">' + (m.mode === 'live' ? '<span class="pill live">Live</span>' : '<span class="pill pt">Paper</span>') + '</td>'
      + '<td class="num">' + U(m.vol_pct) + '</td><td class="num">' + U(m.erc_pct) + '</td><td class="num">' + N(m.regime_w, 1) + '×</td><td class="num"><b>' + U(m.share_pct) + '</b></td></tr>').join('');
    const cls = v => v == null ? '' : Math.abs(v) >= 0.7 ? 'fx-c3' : Math.abs(v) >= 0.4 ? 'fx-c2' : Math.abs(v) >= 0.2 ? 'fx-c1' : 'fx-c0';
    const ids = C.agents || [], name = id => { const m = M.find(x => x.agent === id); return m ? (m.name || id) : id; };
    const corr = ids.length > 1 ? '<div class="tbl"><table class="fx-corr"><thead><tr><th class="l"></th>' + ids.map(i => '<th>' + esc(name(i)) + '</th>').join('') + '</tr></thead><tbody>'
      + ids.map((a, i) => '<tr><td class="l">' + esc(name(a)) + '</td>' + (C.m[i] || []).map((v, j) => '<td class="num ' + (i === j ? '' : cls(v)) + '">' + (i === j ? '·' : N(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '';
    const ex = (F.excluded || []).length ? '<p class="sub">Not in the allocation: ' + F.excluded.map(x => esc(x.agent)).join(', ') + ' (' + esc(F.excluded[0].why) + ').</p>' : '';
    return { html: '<div class="doc"><h2>Fleet</h2><p class="fx-line">' + kill + ' ' + regimeLine(FX) + '</p>'
      + '<p class="sub">How money would be split across the bots so each adds the same share of risk, then trimmed by market regime. Advisory while bots are in paper; moving money between live wallets is always yours.</p>'
      + '<div class="fx-tot">' + (tot('paper') + tot('live') || '<span class="sub">No equity recorded yet.</span>') + '</div></div>'
      + '<div class="tbl"><table><thead><tr><th class="l">Bot</th><th class="l">Mode</th><th>Volatility</th><th>Equal risk</th><th>Regime</th><th>Share now</th></tr></thead><tbody>'
      + (rows || '<tr><td colspan="6" class="empty">No bots the lab can model yet.</td></tr>') + '</tbody></table></div>'
      + (corr ? '<div class="doc"><div class="fx-h3">How the bots move together</div><p class="sub">Daily correlation of backtest returns since ' + esc((F.window || '').split(' ')[0]) + '. Near 1 means two bots are really one bet.</p></div>' + corr : '')
      + '<div class="doc">' + ex + '<p class="sub">' + esc(F.method || '') + '. Kill switch: the fleet stops all new entries when live bots together fall ' + esc(K.max_live_dd_pct ?? '—') + '% from their peaks (exits still run); halt or resume by hand with the <a href="' + CONTROL + '" target="_blank" rel="noopener">control</a> workflow (fleet-halt / fleet-resume). Regime sizing of live bots: ' + (K.apply_regime_weights ? 'on' : 'off') + '.</p></div>' };
  };
  hook('arrival', () => { if (S.sheet && (S.sheet.kind === 'shortlist' || S.sheet.kind === 'fleet')) load(true).then(() => refreshSheet()); });
  load();
}
