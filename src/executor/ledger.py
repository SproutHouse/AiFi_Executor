"""ledger.py — the record. Open positions in state/positions_<mode>.json; closed trades appended to
state/ledger/trades.jsonl with the result in R; refused signals in refused.jsonl; equity points in equity.jsonl.
LEDGER.md is a rendering of these files, regenerated every cycle, never edited by hand."""
from . import common as C

TRADES = C.STATE / "ledger" / "trades.jsonl"
REFUSED = C.STATE / "ledger" / "refused.jsonl"
EQUITY = C.STATE / "ledger" / "equity.jsonl"
MD = C.STATE / "ledger" / "LEDGER.md"
SWEEPS = C.STATE / "ledger" / "sweeps.jsonl"


def record_sweep_intent(book, benchmark, amount_pct_of_pot, ts, executed=False):
    """v1.1 records the intent to convert a book's realised gain into its benchmark; spot execution is a later version."""
    C.append_jsonl(SWEEPS, {"t": C.iso(ts), "book": book, "benchmark": benchmark, "pct_of_pot": amount_pct_of_pot, "executed": executed})


def pos_path(mode):
    return C.STATE / f"positions_{mode}.json"


def positions(mode):
    return (C.load_json(pos_path(mode), {}) or {}).get("positions", {})


def save_positions(pos, mode):
    C.write_json(pos_path(mode), {"updated": C.iso(), "mode": mode, "positions": pos})


def build_close(pos, exit_px, reason, ts, exit_fee, funding_paid, bench_exit=None):
    """The closed-trade record, computed without writing anything."""
    gross = (exit_px - pos["entry"]) / pos["entry"] * pos["notional"]
    pnl = gross - pos.get("entry_fee", 0.0) - exit_fee - funding_paid
    bench_ret = rel_R = None
    if bench_exit and pos.get("bench_entry"):
        bench_ret = bench_exit / pos["bench_entry"] - 1
        rel_R = (pnl - bench_ret * pos["notional"]) / pos["risk_amt"] if pos["risk_amt"] else None
    rec = {"coin": pos["coin"], "side": pos["side"], "kind": pos.get("kind"), "tier": pos.get("tier"),
           "mode": pos.get("mode"), "opened": pos["opened"], "closed": C.iso(ts), "entry": pos["entry"],
           "exit": exit_px, "stop_at_exit": pos["stop"], "notional": pos["notional"], "leverage": pos.get("leverage"),
           "risk_amt": pos["risk_amt"], "gross": gross, "fees": pos.get("entry_fee", 0.0) + exit_fee,
           "funding": funding_paid, "pnl": pnl, "R": pnl / pos["risk_amt"] if pos["risk_amt"] else 0.0,
           "reason": reason, "hours": max(1, (ts - pos["opened_ts"]) / 3600), "rules": pos.get("rules", []),
           "context_at_entry": pos.get("context", {}), "book": pos.get("book"), "benchmark": pos.get("benchmark"),
           "bench_ret": bench_ret, "rel_R": rel_R}
    return rec


def append_trade(rec):
    C.append_jsonl(TRADES, rec)


def record_close(pos, exit_px, reason, ts, exit_fee, funding_paid, bench_exit=None):
    """Build and append in one step (used by scripts and tests; the cycle persists positions in between)."""
    rec = build_close(pos, exit_px, reason, ts, exit_fee, funding_paid, bench_exit)
    append_trade(rec)
    return rec


def record_refusal(cand, checks_or_reasons, ts, stage):
    C.append_jsonl(REFUSED, {"t": C.iso(ts), "coin": cand.get("coin"), "kind": cand.get("kind"),
                             "tier": cand.get("tier"), "stage": stage, "detail": checks_or_reasons})


def equity_point(ts, equity, cash, unrealized, mode):
    C.append_jsonl(EQUITY, {"t": C.iso(ts), "ts": ts, "equity": equity, "cash": cash, "unrealized": unrealized, "mode": mode})


def equity_points(mode=None):
    pts = C.read_jsonl(EQUITY)
    return [p for p in pts if mode is None or p.get("mode") == mode]


def trades():
    return C.read_jsonl(TRADES)


def stats(tr):
    if not tr:
        return {"n": 0}
    wins = [x for x in tr if x["pnl"] > 0]
    losses = [x for x in tr if x["pnl"] <= 0]
    gw = sum(x["pnl"] for x in wins)
    gl = abs(sum(x["pnl"] for x in losses))
    streak = worst = 0
    for x in tr:
        streak = streak + 1 if x["pnl"] <= 0 else 0
        worst = max(worst, streak)
    rel = [x["rel_R"] for x in tr if x.get("rel_R") is not None]
    return {"n": len(tr), "win_rate": len(wins) / len(tr), "avg_R": sum(x["R"] for x in tr) / len(tr),
            "avg_rel_R": (sum(rel) / len(rel)) if rel else None, "n_rel": len(rel),
            "total_R": sum(x["R"] for x in tr), "profit_factor": (gw / gl) if gl else None,
            "avg_hours": sum(x["hours"] for x in tr) / len(tr), "worst_losing_streak": worst,
            "fees_R": sum((x["fees"] + x["funding"]) / x["risk_amt"] for x in tr if x["risk_amt"]) / len(tr)}


def render_markdown(pos, summary_lines=None, mode="paper"):
    tr = trades()
    st = stats(tr)
    lines = ["# Ledger", "", f"_Rendered {C.iso()} in {mode} mode from state/positions_{mode}.json and state/ledger/*.jsonl. Do not edit._", ""]
    lines += ["## Open positions", ""]
    if pos:
        lines += ["| Book | Coin | Kind | Tier | Entry | Stop | Notional % eq | Lev | Opened |", "|---|---|---|---|---|---|---|---|---|"]
        for p in pos.values():
            lines.append(f"| {p.get('book')} | {p['coin']} | {p.get('kind')} | {p.get('tier')} | {p['entry']:.6g} | {p['stop']:.6g} | "
                         f"{p.get('notional_pct_equity', 0):.1f}% | {p.get('leverage')}x | {p['opened'][:16]} |")
    else:
        lines.append("None.")
    lines += ["", "## Closed trades, summary", ""]
    if st["n"]:
        pf = f"{st['profit_factor']:.2f}" if st["profit_factor"] is not None else "n/a"
        rel = f" · average {st['avg_rel_R']:+.2f} R against holding the benchmark" if st.get("avg_rel_R") is not None else ""
        lines += [f"- Trades {st['n']} · win rate {st['win_rate']:.0%} · average {st['avg_R']:+.2f} R · total {st['total_R']:+.1f} R · "
                  f"profit factor {pf} · worst losing streak {st['worst_losing_streak']} · costs {st['fees_R']:.2f} R per trade{rel}"]
    else:
        lines.append("No closed trades yet.")
    lines += ["", "## Last 50 closed trades", ""]
    if tr:
        lines += ["| Closed | Book | Coin | Kind | Tier | Entry | Exit | R | R vs benchmark | Reason | Hours |", "|---|---|---|---|---|---|---|---|---|---|---|"]
        for x in tr[-50:][::-1]:
            rr = f"{x['rel_R']:+.2f}" if x.get("rel_R") is not None else "n/a"
            lines.append(f"| {x['closed'][:16]} | {x.get('book')} | {x['coin']} | {x['kind']} | {x['tier']} | {x['entry']:.6g} | {x['exit']:.6g} | "
                         f"{x['R']:+.2f} | {rr} | {x['reason']} | {x['hours']:.0f} |")
    else:
        lines.append("None yet.")
    ref = C.read_jsonl(REFUSED)
    lines += ["", f"## Refused signals: {len(ref)} recorded (state/ledger/refused.jsonl)", ""]
    if summary_lines:
        lines += ["## Last run", ""] + [f"- {s}" for s in summary_lines]
    MD.parent.mkdir(parents=True, exist_ok=True)
    MD.write_text("\n".join(lines) + "\n")
