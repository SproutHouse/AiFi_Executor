"""paper.py — the paper engine. Same position records as live, filled at Hyperliquid's mark with the
configured slippage and taker fee, stopped on the 4-hour bars that closed since the last cycle."""
from . import common as C

POT = C.STATE / "paper.json"


def pot(s):
    p = C.load_json(POT)
    if not p:
        p = {"cash": float(s["pot_usd_paper"]), "start": float(s["pot_usd_paper"]), "created": C.iso()}
        C.write_json(POT, p)
    return p


def save_pot(p):
    C.write_json(POT, p)


def carry_value(pos, perp_mark):
    """A carry position's value to the pot: funding received − fees + realised leg P&L + open P&L on both legs."""
    L = pos["legs"]
    v = pos.get("funding_income", 0.0) - pos.get("fees", 0.0) + pos.get("spot_pnl", 0.0) + pos.get("perp_pnl", 0.0)
    sm = L["spot"].get("mark")
    if sm and L["spot"]["sz"]:
        v += (sm - L["spot"]["entry"]) * L["spot"]["sz"]
    if perp_mark and L["perp"]["sz"]:
        v += (L["perp"]["entry"] - perp_mark) * L["perp"]["sz"]
    return v


def equity(p, positions, marks):
    unreal = 0.0
    for coin, pos in positions.items():
        m = marks.get(coin)
        if pos.get("kind") == "carry":
            unreal += carry_value(pos, m)
        elif m:
            unreal += (m - pos["entry"]) / pos["entry"] * pos["notional"]
    return p["cash"] + unreal, unreal


def open_position(cand, sizing, mark, s, ts, mode="paper", context=None, rules=None):
    slip = s["paper_slippage_pct"] / 100
    entry = mark * (1 + slip)
    fee = sizing["notional"] * s["fee_taker_pct"] / 100
    return {"coin": cand["coin"], "side": "long", "kind": cand["kind"], "tier": cand["tier"], "mode": mode,
            "entry": entry, "stop": cand["stop"], "initial_stop": cand["stop"], "notional": sizing["notional"],
            "sz": sizing["notional"] / entry, "risk_amt": sizing["risk_amt"], "leverage": sizing["leverage"],
            "notional_pct_equity": sizing["notional_pct_equity"], "entry_fee": fee, "funding_paid": 0.0,
            "opened": C.iso(ts), "opened_ts": ts, "last_bar_t": cand.get("bar_t", ts), "last_funding_ts": ts,
            "context": context or {}, "rules": rules or [], "stop_cloid": None, "entry_cloid": None,
            "book": cand.get("book"), "benchmark": cand.get("benchmark"), "bench_entry": cand.get("bench_mark")}


def accrue_funding(pos, hourly_rate, ts):
    hours = max(0.0, (ts - pos.get("last_funding_ts", ts)) / 3600)
    pos["funding_paid"] = pos.get("funding_paid", 0.0) + hourly_rate * hours * pos["notional"]
    pos["last_funding_ts"] = ts


def check_stop(pos, bars, s):
    """First completed 4-hour bar after the last checked one whose low breaches the stop fills the exit."""
    slip = s["paper_slippage_pct"] / 100
    for b in bars:
        if b["t"] <= pos.get("last_bar_t", 0):
            continue
        if b["l"] <= pos["stop"]:
            px = min(b["o"], pos["stop"]) * (1 - slip)
            return px, b["t"]
        pos["last_bar_t"] = b["t"]
    return None, None


def exit_fee(pos, px, s):
    return pos["sz"] * px * s["fee_taker_pct"] / 100
