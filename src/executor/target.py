"""target.py — the target-weight strategy (docs/specs/TREND.md): hold a volatility-scaled long while the daily close
is above its N-day average, otherwise hold nothing, and trade only when the position drifts outside a band.

Pure functions; cycle.py does the I/O. Daily bars must be COMPLETED bars (hl_data.candles drops the forming one),
so a run at 00:30 UTC decides on yesterday's close, exactly like the backtest (research/phase1/trend_band.py).
"""
import math


def weight(daily, cfg):
    """Returns (weight or None, detail). weight is the fraction of the coin's allocation to hold as notional:
    0 when the close is at or below the N-day SMA, else min(cap, vol_target / realised vol)."""
    n, vd = int(cfg["sma"]), int(cfg["vol_days"])
    closes = [b["c"] for b in daily]
    if len(closes) < max(n, vd + 1) + 1:
        return None, f"only {len(closes)} daily bars; need {max(n, vd + 1) + 1}"
    sma = sum(closes[-n:]) / n
    rets = [closes[i] / closes[i - 1] - 1 for i in range(len(closes) - vd, len(closes))]
    vol = math.sqrt(sum(x * x for x in rets) / len(rets) * 365)
    if closes[-1] <= sma:
        return 0.0, f"close {closes[-1]:.5g} at or below its {n}-day average {sma:.5g}"
    if vol <= 0:
        return None, "zero volatility reading"
    w = min(float(cfg["cap_x"]), float(cfg["vol_target"]) / vol)
    return w, f"close {closes[-1]:.5g} above its {n}-day average {sma:.5g}; volatility {vol * 100:.0f}% → weight {w:.2f}"


def decide(cur_notional, target_notional, band):
    """open | increase | decrease | close | hold | none. Trades only outside the band (fraction of target)."""
    cur, tgt = max(0.0, cur_notional or 0.0), max(0.0, target_notional or 0.0)
    if tgt <= 0:
        return "close" if cur > 0 else "none"
    if cur <= 0:
        return "open"
    if abs(cur - tgt) > band * tgt:
        return "increase" if tgt > cur else "decrease"
    return "hold"


def paper_resize(pos, new_notional, mark, s):
    """Resize a paper position toward new_notional at the mark (with slippage and taker fee).
    Returns the cash change (negative fee on an increase; realised P&L net of fee on a decrease)."""
    slip, fee_pct = s["paper_slippage_pct"] / 100, s["fee_taker_pct"] / 100
    cur = pos["sz"] * mark
    if new_notional > cur:
        px = mark * (1 + slip)
        add_sz = (new_notional - cur) / px
        pos["entry"] = (pos["entry"] * pos["sz"] + px * add_sz) / (pos["sz"] + add_sz)
        pos["sz"] += add_sz
        fee = add_sz * px * fee_pct
        pos["entry_fee"] = pos.get("entry_fee", 0.0) + fee
        cash = -fee
    else:
        px = mark * (1 - slip)
        cut_sz = min(pos["sz"], (cur - new_notional) / px)
        realised = (px - pos["entry"]) * cut_sz - cut_sz * px * fee_pct
        pos["sz"] -= cut_sz
        pos["realized"] = pos.get("realized", 0.0) + realised
        cash = realised
    pos["notional"] = pos["sz"] * pos["entry"]
    return cash
