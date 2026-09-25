"""synthetic.py — the small hand-made state tree tests/test_dashboard_bundle.py builds bundle v2 from.

Contents (docs/DASHBOARD_SPEC.md, data contract §8): paper pot 1234.56 and live pot 377.19; two open positions with a
stop history (one E4-shaped `stops` list, one legacy trailed stop); five closed trades; refusals of every stage,
including an execution failure carrying a raw exchange response with a dollar figure; a HALT file with HALT.since;
a failed run doc; a run with a reconciliation mismatch. Every money figure is listed in MONEY so the test can assert
that none of them reaches a payload.
"""
import json, shutil
from pathlib import Path

REAL = Path(__file__).resolve().parent / "real"
PAPER_POT, LIVE_POT = 1234.56, 377.19
T0 = 1790252470            # 2026-09-24T12:21:10Z, a paper run
H = 4 * 3600
NOW = T0 + 3 * H + 1800    # half an hour after the last run
HALT_SINCE = "2026-09-25T00:31:10.123456Z"      # after the last run, which did not see it
HALT_SINCE_TS = T0 + 3 * H + 600


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


POSITIONS = {
    "LINK": {"coin": "LINK", "side": "long", "kind": "flip", "tier": "A", "mode": "paper", "entry": 13.214, "stop": 13.366,
             "initial_stop": 12.843, "notional": 842.47, "sz": 63.7558, "risk_amt": 12.3456, "leverage": 3,
             "notional_pct_equity": 68.2, "entry_fee": 0.3791, "funding_paid": 0.0613, "opened": iso(T0), "opened_ts": T0,
             "last_bar_t": T0 - 1270, "last_funding_ts": T0 + 2 * H, "context": {"btc_weekly": "Bullish"},
             "rules": ["LOGIC v1.3", "trigger:flip", "tier:A"], "stop_cloid": "0xabc", "entry_cloid": "0xdef", "book": "eth-defi",
             "benchmark": "ETH", "bench_entry": 2676.2, "mark": 13.894, "upnl_pct": 5.15,
             "stops": [[iso(T0), 12.843], [iso(T0 + H), 13.05], [iso(T0 + 3 * H), 13.366]], "risk_pct": 1.0},
    "SOL": {"coin": "SOL", "side": "long", "kind": "flip", "tier": "A", "mode": "paper", "entry": 117.02, "stop": 114.9,
            "initial_stop": 113.07, "notional": 301.83, "sz": 2.5793, "risk_amt": 6.1728, "leverage": 3,
            "notional_pct_equity": 24.4, "entry_fee": 0.1358, "funding_paid": 0.0271, "opened": iso(T0 + H), "opened_ts": T0 + H,
            "last_bar_t": T0 + H - 1270, "last_funding_ts": T0 + 2 * H, "context": {}, "rules": [], "stop_cloid": None,
            "entry_cloid": None, "book": "solana", "benchmark": "SOL", "bench_entry": 117.02, "mark": 116.2, "upnl_pct": -0.7},
}
TRADES = [  # five closed paper trades; every money field is distinct and listed in MONEY
    {"coin": "ETH", "kind": "flip", "tier": "A", "R": 2.1, "rel_R": 0.35, "reason": "4h flip", "notional": 611.11, "risk_amt": 11.9876,
     "gross": 26.1718, "fees": 0.5332, "funding": 0.4646, "pnl": 25.174, "entry": 2601.3, "exit": 2712.7, "book": "eth-defi", "o": -30, "c": -20},
    {"coin": "BTC", "kind": "flip", "tier": "A", "R": -1.02, "rel_R": -0.7, "reason": "stop", "notional": 734.52, "risk_amt": 12.0101,
     "gross": -11.5211, "fees": 0.6541, "funding": 0.0751, "pnl": -12.2503, "entry": 83100.0, "exit": 81800.0, "book": "bitcoin", "o": -28, "c": -24},
    {"coin": "UNI", "kind": "flip", "tier": "A", "R": 0.44, "rel_R": None, "reason": "daily flip", "notional": 455.19, "risk_amt": 12.1212,
     "gross": 6.2551, "fees": 0.4101, "funding": 0.5116, "pnl": 5.3334, "entry": 8.8, "exit": 8.925, "book": "eth-defi", "o": -22, "c": -15},
    {"coin": "HYPE", "kind": "flip", "tier": "A", "R": -0.38, "rel_R": 0.12, "reason": "manual flatten", "notional": 377.77, "risk_amt": 12.2323,
     "gross": -3.8712, "fees": 0.3399, "funding": 0.4371, "pnl": -4.6482, "entry": 90.5, "exit": 89.6, "book": "hype", "o": -14, "c": -9},
    {"coin": "SOL", "kind": "pullback", "tier": "B", "R": 3.3, "rel_R": 1.9, "reason": "weekly flip", "notional": 512.34, "risk_amt": 12.3434,
     "gross": 41.8621, "fees": 0.4611, "funding": 0.6678, "pnl": 40.7332, "entry": 110.1, "exit": 119.1, "book": "solana", "o": -12, "c": -3},
]
PAPER_EQ = [PAPER_POT, 1240.13, 1229.87, 1251.02, 1238.44, 1260.9]      # the last one is E in paper mode
LIVE_EQ = [LIVE_POT, 380.51, 371.29]
MONEY = ([PAPER_POT, LIVE_POT] + PAPER_EQ + LIVE_EQ +
         [p[k] for p in POSITIONS.values() for k in ("notional", "risk_amt", "entry_fee", "funding_paid")] +
         [x[k] for x in TRADES for k in ("notional", "risk_amt", "gross", "fees", "funding", "pnl")] + [843.12, 1230.0])
EXEC_DUMP = "IOC entry not filled: {'status': 'err', 'response': 'Insufficient margin to place order. asset=5 notional $843.12 USDC'}"


def readings(t, trigger=None):
    rows = json.loads((REAL / "state" / "runs" / "last_run.json").read_text())["readings"]
    out = []
    for r in rows:
        r = dict(r)
        if r["coin"] in ("LINK", "SOL"):
            continue                                   # held names get no reading
        if trigger and r["coin"] in trigger:
            r["trigger"], r["why"] = trigger[r["coin"]], None
        out.append(r)
    return out


def run(t, summary, *, mode="paper", fresh=True, failed=False, halt=False, positions=("LINK", "SOL"), reads=True, trig=None,
        counts=(12, 0, 0, 0, 0), throttle=None, equity=None):
    c = dict(zip(("evaluated", "triggers", "refused", "proposed", "entered"), counts))
    return {"t": iso(t), "mode": mode, "hours": "auto", "dry": False, "fresh": fresh, "failed": failed, "btc_weekly": "Bullish",
            "btc_daily": "Bullish" if not failed else "No data", "positions": list(positions), "open_proposals": [],
            "throttle": throttle or {"multiplier": 1.0, "drawdown_pct": 1.87, "halt": False, "peak": 1285.0}, "halt": halt,
            "counts": c, "summary": summary, "readings": readings(t, trig) if reads else [], "equity": equity or PAPER_EQ[-1],
            "hours_local": "08:21 EDT"}


def make_state(root, mode="paper", halt=True):
    """Write state/ and config/ under root. mode="live" makes settings and the last run live, with live equity and positions."""
    root = Path(root)
    st, cfg = root / "state", root / "config"
    for d in (st / "runs", st / "ledger", st / "proposals", st / "review", cfg):
        d.mkdir(parents=True, exist_ok=True)
    s = json.loads((REAL / "config" / "settings.json").read_text())
    s["pot_usd_paper"], s["mode"] = PAPER_POT, mode
    (cfg / "settings.json").write_text(json.dumps(s, indent=2))
    shutil.copy(REAL / "config" / "books.json", cfg / "books.json")
    t1, t2, t3 = T0 + H, T0 + 2 * H, T0 + 3 * H
    btc = "BTC weekly Bullish · daily Bullish · data 21 min after the bar close"
    runs = [
        run(T0, [btc, "LINK: ENTERED LINK long [eth-defi] · flip tier A · stop 12.843 (2.8% away) · size 68.2% of pot at 3x · risk 1.00% of pot",
                 "CRV: signal pullback tier B REFUSED: universe filters (24h volume 10.7M below 30M; funding 68%/yr against longs above 30%)",
                 "UNI: signal pullback tier B recorded, not traded (tier not automated)",
                 "evaluated 13 names · 3 triggers · 2 refused · 0 proposed · 1 entered · 1 open"],
            positions=("LINK",), trig={"LINK": "flip tier A", "CRV": "pullback tier B", "UNI": "pullback tier B"}, counts=(13, 3, 2, 0, 1)),
        run(t1, [btc, "LINK: stop trailed to 13.05", "ETH: proposal 20260924-0820-ETH-pullback expired unapproved",
                 "RECONCILIATION MISMATCH: LINK size 63.8 on the exchange vs 63.7558 in the ledger; equity 1230.00 vs 1234.56",
                 "SOL: ENTERED SOL long [solana] · flip tier A · stop 113.07 (3.4% away) · size 24.4% of pot at 3x · risk 0.50% of pot",
                 "BNB: entry not filled (Insufficient margin to place order. asset=5 notional $843.12 USDC)",
                 "evaluated 12 names · 2 triggers · 1 refused · 0 proposed · 1 entered · 2 open"],
            trig={"SOL": "flip tier A", "BNB": "flip tier A"}, counts=(12, 2, 1, 0, 1)),
        run(t2, ["BTC weekly Bullish · daily Bullish · data 20 min after the bar close",
                 "CYCLE ABORTED: ConnectionError: HTTPSConnectionPool(host='api.hyperliquid.xyz', port=443): Read timed out.",
                 "evaluated 0 names · 0 triggers · 0 refused · 0 proposed · 0 entered · 2 open"],
            fresh=True, failed=True, reads=False, counts=(0, 0, 0, 0, 0)),
        run(t3, [btc, "LINK: stop trailed to 13.366", "SOL: no reading on one timeframe (data gap); position and stop kept as they are",
                 "evaluated 12 names · 0 triggers · 0 refused · 0 proposed · 0 entered · 2 open"]),
    ]
    if mode == "live":
        for r in runs[-3:]:
            r["mode"] = "live"
        runs[-1]["throttle"] = {"multiplier": 1.0, "drawdown_pct": 2.42, "halt": False, "peak": 380.51}
    by_day = {}
    for r in runs:
        by_day.setdefault(r["t"][:10], []).append(r)
    for day, docs in by_day.items():
        (st / "runs" / f"{day}.jsonl").write_text("".join(json.dumps(d) + "\n" for d in docs))
    (st / "runs" / "last_run.json").write_text(json.dumps(runs[-1], indent=2))
    eq = [{"t": iso(T0 - (len(PAPER_EQ) - i) * H), "ts": T0 - (len(PAPER_EQ) - i) * H, "equity": e, "cash": e, "unrealized": 0.0, "mode": "paper"}
          for i, e in enumerate(PAPER_EQ)]
    if mode == "live":
        eq += [{"t": iso(t), "ts": t, "equity": e, "cash": e, "unrealized": 0.0, "mode": "live"} for t, e in zip((t1, t2, t3), LIVE_EQ)]
    (st / "ledger" / "equity.jsonl").write_text("".join(json.dumps(p) + "\n" for p in eq))
    trades = []
    for x in TRADES:
        o, c = T0 + x["o"] * H, T0 + x["c"] * H
        trades.append({"coin": x["coin"], "side": "long", "kind": x["kind"], "tier": x["tier"], "mode": "paper", "opened": iso(o), "closed": iso(c),
                       "entry": x["entry"], "exit": x["exit"], "stop_at_exit": x["entry"] * 0.98, "notional": x["notional"], "leverage": 3,
                       "risk_amt": x["risk_amt"], "gross": x["gross"], "fees": x["fees"], "funding": x["funding"], "pnl": x["pnl"], "R": x["R"],
                       "reason": x["reason"], "hours": (c - o) / 3600, "rules": ["LOGIC v1.3"], "context_at_entry": {"btc_weekly": "Bullish"},
                       "book": x["book"], "benchmark": "BTC", "bench_ret": 0.01, "rel_R": x["rel_R"]})
    (st / "ledger" / "trades.jsonl").write_text("".join(json.dumps(x) + "\n" for x in trades))
    refused = [
        {"t": iso(T0), "coin": "CRV", "kind": "pullback", "tier": "B", "stage": "pre-trade",
         "detail": [{"check": "universe filters", "ok": False, "detail": "24h volume 10.7M below 30M; funding 68%/yr against longs above 30%"}]},
        {"t": iso(T0), "coin": "UNI", "kind": "pullback", "tier": "B", "stage": "policy", "detail": "tier B is not automated and approvals are disabled"},
        {"t": iso(t1), "coin": "ETH", "kind": "pullback", "tier": "B", "stage": "proposal", "detail": "proposal expired unapproved"},
        {"t": iso(t1), "coin": "BNB", "kind": "flip", "tier": "A", "stage": "execution", "detail": EXEC_DUMP},
        {"t": iso(T0 - 3000), "coin": "HYPE", "kind": "pullback", "tier": "B", "stage": "approval", "detail": "price ran 1.23% above the signal mark"},
        {"t": iso(T0 - 2000), "coin": "AAVE", "kind": "pullback", "tier": "B", "stage": "approval",
         "detail": [{"check": "equity positive", "ok": False, "detail": "equity 1234.56"},
                    {"check": "open-risk cap", "ok": False, "detail": "4.50% of equity after entry, cap 4.0%"}]},
        {"t": iso(T0 - H), "coin": "JUP", "kind": "flip", "tier": "A", "stage": "pre-trade",
         "detail": [{"check": "below max positions", "ok": False, "detail": "6 open of 6"},
                    {"check": "sizing accepted", "ok": False, "detail": "notional below the exchange minimum of 10"}]},
    ]
    (st / "ledger" / "refused.jsonl").write_text("".join(json.dumps(r) + "\n" for r in refused))
    (st / "ledger" / "sweeps.jsonl").write_text(json.dumps({"t": iso(T0 - 20 * H), "book": "eth-defi", "benchmark": "ETH",
                                                            "pct_of_pot": 0.4211, "executed": False}) + "\n")
    pos_mode = "live" if mode == "live" else "paper"
    (st / f"positions_{pos_mode}.json").write_text(json.dumps({"updated": iso(t3), "mode": pos_mode,
                                                               "positions": {k: dict(v, mode=pos_mode) for k, v in POSITIONS.items()}}))
    if mode == "paper":
        (st / "paper.json").write_text(json.dumps({"cash": PAPER_POT, "start": PAPER_POT, "created": iso(T0 - 9 * H)}))
    (st / "proposals" / "20260924-0820-ETH-pullback.json").write_text(json.dumps(
        {"id": "20260924-0820-ETH-pullback", "status": "expired", "expires_ts": t1 - 1000, "candidate": {"coin": "ETH", "kind": "pullback", "tier": "B"}}))
    (st / "proposals" / "20260925-0021-AAVE-pullback.json").write_text(json.dumps(
        {"id": "20260925-0021-AAVE-pullback", "status": "open", "expires": iso(t3 + H), "expires_ts": t3 + H,
         "candidate": {"coin": "AAVE", "kind": "pullback", "tier": "B", "stop": 140.1}, "sizing": {"notional": 611.11, "risk_amt": 11.9876}}))
    (st / "review" / "2026-09-20.md").write_text("# Weekly review — 2026-09-20 (paper)\n\n- Closed trades 5 · average +0.89 R\n"
                                                  "- the pot was $1,234.56 at the start\n- sz 12 USDC leaked line\n\n## Gates\n")
    if halt:
        (st / "HALT").write_text("stopping for the weekend, pot $1234.56")
        (st / "HALT.since").write_text(HALT_SINCE)
    return st, cfg
