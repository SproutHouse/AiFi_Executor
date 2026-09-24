"""risk.py — sizing, caps, the drawdown throttle and the pre-trade checklist.
Sizing is by risk: notional = (risk per trade) / (distance to the stop). Leverage is only what lets a small
pot express that notional; it is capped and its liquidation price must sit at least twice the stop distance away."""
import math


def throttle(points, thr):
    if not points:
        return {"multiplier": 1.0, "drawdown_pct": 0.0, "halt": False, "peak": None}
    peak = max(p["equity"] for p in points)
    cur = points[-1]["equity"]
    dd = (peak - cur) / peak * 100 if peak > 0 else 0.0
    if dd >= thr["halt_at_drawdown_pct"]:
        return {"multiplier": 0.0, "drawdown_pct": dd, "halt": True, "peak": peak}
    if dd >= thr["halve_at_drawdown_pct"]:
        return {"multiplier": 0.5, "drawdown_pct": dd, "halt": False, "peak": peak}
    return {"multiplier": 1.0, "drawdown_pct": dd, "halt": False, "peak": peak}


def size(equity, entry, stop, s, max_lev_asset=None, multiplier=1.0):
    out = {"entry": entry, "stop": stop}
    if entry <= 0 or stop is None or stop >= entry:
        out["refused"] = "stop not below entry"
        return out
    dist = (entry - stop) / entry
    out["dist_pct"] = dist * 100
    if dist * 100 < s["min_stop_distance_pct"]:
        out["refused"] = f"stop distance {dist * 100:.2f}% below minimum {s['min_stop_distance_pct']}%"
        return out
    risk_pct = s["risk_per_trade_pct"] / 100 * multiplier
    risk_amt = equity * risk_pct
    notional = risk_amt / dist
    lev_cap = min(int(s["leverage_cap_x"]), int(max_lev_asset or s["leverage_cap_x"]))
    if notional > lev_cap * equity:
        notional = lev_cap * equity
        risk_amt = notional * dist
        out["note"] = f"notional capped at {lev_cap}x equity; risk below target"
    if notional < s["min_notional_usd"]:
        out["refused"] = f"notional below the exchange minimum of {s['min_notional_usd']}"
        return out
    lev = lev_cap
    while lev > 1 and (1.0 / lev) * 0.9 < 2 * dist:
        lev -= 1
    out.update({"risk_amt": risk_amt, "risk_pct": risk_pct * 100, "notional": notional, "leverage": lev,
                "margin": notional / lev, "notional_pct_equity": notional / equity * 100,
                "liq_buffer_pct": (1.0 / lev) * 0.9 * 100})
    return out


def pre_trade(cand, sizing, positions, equity, s, flags):
    """All checks run and are logged; the trade is allowed only if every one passes."""
    checks = []

    def add(name, ok, detail=""):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    add("not halted", not flags.get("halt"), flags.get("halt_reason", ""))
    add("throttle allows entries", not flags.get("throttle_halt"), f"drawdown {flags.get('drawdown_pct', 0):.1f}%")
    add("data fresh and run on time", flags.get("fresh", False), flags.get("fresh_detail", ""))
    add("no reconciliation mismatch", not flags.get("reconcile_mismatch"), flags.get("reconcile_detail", ""))
    add("sizing accepted", "refused" not in sizing, sizing.get("refused", ""))
    add("no open position in this coin", cand["coin"] not in positions)
    add("below max positions", len(positions) < s["max_positions"], f"{len(positions)} open of {s['max_positions']}")
    open_risk = sum(p.get("risk_amt", 0) for p in positions.values())
    gross = sum(p.get("notional", 0) for p in positions.values())
    ra, no = sizing.get("risk_amt", 0), sizing.get("notional", 0)
    add("open-risk cap", open_risk + ra <= s["open_risk_cap_pct"] / 100 * equity + 1e-9,
        f"{(open_risk + ra) / equity * 100:.2f}% of equity after entry, cap {s['open_risk_cap_pct']}%")
    add("gross exposure cap", gross + no <= s["gross_exposure_cap_x"] * equity + 1e-9,
        f"{(gross + no) / equity:.2f}x after entry, cap {s['gross_exposure_cap_x']}x")
    cap_b = flags.get("book_cap_pct")
    if cap_b is not None and cand.get("book"):
        book_risk = sum(p.get("risk_amt", 0) for p in positions.values() if p.get("book") == cand["book"])
        add("book open-risk cap", book_risk + ra <= cap_b / 100 * equity + 1e-9,
            f"book {cand['book']}: {(book_risk + ra) / equity * 100:.2f}% after entry, cap {cap_b}%")
    add("price sanity band", flags.get("sanity_ok", True), flags.get("sanity_detail", ""))
    add("universe filters", flags.get("universe_ok", True), "; ".join(flags.get("universe_reasons", [])))
    return all(c["ok"] for c in checks), checks
