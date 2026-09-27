"""carry.py — delta-neutral funding carry (docs/specs/CARRY.md): short the perp and hold the same size in spot,
collect the hourly funding. Pure functions; cycle.py does the I/O.

A carry position is two legs kept equal in size:
  pos = {coin, kind:"carry", state:"entering"|"open"|"exiting", target_n (notional per leg, in pot currency),
         legs:{spot:{pair, sz, entry}, perp:{sz, entry}}        sz >= 0; the perp leg is SHORT
         orders:{spot:{side, px, sz, t}, perp:{side, px, sz, t}}   resting maker orders (paper) or their cloids (live)
         funding_income, theo_funding, fees, spot_pnl, perp_pnl, opened_ts, last_funding_ts, stuck_since}
Maker (post-only) orders only. The one exception is the SAFETY OVERRIDE: when the legs have been out of balance by
more than the band for longer than `max_unhedged_hours`, the lagging leg is completed with a taker order. An unhedged
leg is directional risk, and the spec's promise is delta-neutral; paying a taker fee is the smaller cost.
"""

H = 24 * 365


def mean_apr(rows, now_ms, hours=24):
    """Trailing mean of hourly funding rates over `hours`, annualised. rows: [{time, fundingRate}] from fundingHistory."""
    lo = now_ms - hours * 3600 * 1000
    x = [float(r["fundingRate"]) for r in rows if int(r["time"]) > lo]
    return (sum(x) / len(x) * H) if len(x) >= max(1, hours // 2) else None


def decide(apr, holding, cfg):
    """enter | exit | hold | none, per the spec: in at >= enter, out below exit (hysteresis)."""
    if apr is None:
        return "hold" if holding else "none"
    if not holding:
        return "enter" if apr >= cfg["enter_apr"] else "none"
    return "exit" if apr < cfg["exit_apr"] else "hold"


def target_notional(equity, n_active, cfg):
    """Notional per leg for one asset: capital per asset = min(per-asset cap, 100% / n_active) of the pot; capital per
    unit of notional = 1 (spot) + 1/perp_leverage (perp margin)."""
    if equity <= 0 or n_active <= 0:
        return 0.0
    cap_frac = min(cfg["per_asset_cap"], 1.0 / n_active)
    return equity * cap_frac / (1 + 1 / cfg["perp_leverage"])


def maker_prices(spot_mid, perp_mid, cfg, side_spot, side_perp):
    """Post-only prices a small step inside the mid on the passive side: buys below mid, sells above."""
    off = cfg["maker_offset_bps"] / 10000
    sp = spot_mid * (1 - off) if side_spot == "buy" else spot_mid * (1 + off)
    pp = perp_mid * (1 - off) if side_perp == "buy" else perp_mid * (1 + off)
    return sp, pp


def paper_fill(order, bars):
    """A resting maker order fills only if price trades THROUGH it (strictly) in a bar that opened after it was placed:
    buys need a low below the price, sells a high above. Returns the fill price or None."""
    for b in bars:
        if b["t"] < order["t"]:
            continue
        if order["side"] == "buy" and b["l"] < order["px"]:
            return order["px"]
        if order["side"] == "sell" and b["h"] > order["px"]:
            return order["px"]
    return None


def apply_fill(pos, leg, side, px, sz, fee_pct):
    """Update one leg with a fill. Spot: buy adds, sell reduces. Perp (short leg): sell adds to the short, buy reduces.
    Realised P&L on reductions goes to spot_pnl / perp_pnl; fees accumulate. Returns the fee."""
    L = pos["legs"][leg]
    fee = px * sz * fee_pct
    adding = (leg == "spot" and side == "buy") or (leg == "perp" and side == "sell")
    if adding:
        L["entry"] = (L.get("entry", 0.0) * L["sz"] + px * sz) / (L["sz"] + sz) if L["sz"] + sz > 0 else px
        L["sz"] += sz
    else:
        sz = min(sz, L["sz"])
        pnl = (px - L["entry"]) * sz if leg == "spot" else (L["entry"] - px) * sz
        pos["spot_pnl" if leg == "spot" else "perp_pnl"] = pos.get("spot_pnl" if leg == "spot" else "perp_pnl", 0.0) + pnl
        L["sz"] -= sz
    pos["fees"] = pos.get("fees", 0.0) + fee
    return fee


def imbalance(pos, spot_px, perp_px):
    """Relative gap between the two legs' notionals, as a fraction of the target notional."""
    s = pos["legs"]["spot"]["sz"] * spot_px
    p = pos["legs"]["perp"]["sz"] * perp_px
    t = pos.get("target_n") or max(s, p) or 1.0
    return abs(s - p) / t


def accrue(pos, rows, perp_px, rule_in):
    """Funding on the SHORT perp leg for every hourly rate newer than last_funding_ts: shorts receive positive funding.
    theo_funding is what the rule's own target size would have earned in the same hours (the capture denominator)."""
    last = pos.get("last_funding_ts", 0)
    got = theo = 0.0
    newest = last
    for r in rows:
        t = int(r["time"])
        if t <= last:
            continue
        rate = float(r["fundingRate"])
        got += rate * pos["legs"]["perp"]["sz"] * perp_px
        if rule_in:
            theo += rate * pos.get("target_n", 0.0)
        newest = max(newest, t)
    pos["funding_income"] = pos.get("funding_income", 0.0) + got
    pos["theo_funding"] = pos.get("theo_funding", 0.0) + theo
    pos["last_funding_ts"] = newest
    return got


def capture(pos):
    """Capture efficiency: funding actually collected net of fees ÷ theoretical funding. None until theory > 0."""
    th = pos.get("theo_funding", 0.0)
    return (pos.get("funding_income", 0.0) - pos.get("fees", 0.0)) / th if th > 0 else None


def closed_record(pos, ts):
    """The trade line for a finished carry position. 'R' here is the return on the capital the position used
    (1% = 0.01), because a delta-neutral position has no stop-defined risk."""
    cap = pos.get("capital") or 1.0
    pnl = pos.get("funding_income", 0.0) - pos.get("fees", 0.0) + pos.get("spot_pnl", 0.0) + pos.get("perp_pnl", 0.0)
    return {"coin": pos["coin"], "side": "carry", "kind": "carry", "tier": "C", "mode": pos.get("mode"),
            "opened": pos.get("opened"), "closed": ts, "entry": pos["legs"]["spot"].get("entry"), "exit": None,
            "notional": pos.get("target_n"), "risk_amt": cap, "pnl": pnl, "R": pnl / cap, "fees": pos.get("fees", 0.0),
            "funding": -pos.get("funding_income", 0.0), "gross": pos.get("spot_pnl", 0.0) + pos.get("perp_pnl", 0.0),
            "reason": pos.get("exit_reason", "funding below exit"), "hours": max(1, (pos.get("closed_ts", 0) - pos.get("opened_ts", 0)) / 3600),
            "capture": capture(pos), "book": "carry", "benchmark": None, "bench_ret": None, "rel_R": None, "rules": pos.get("rules", [])}
