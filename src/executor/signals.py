"""signals.py — the entry triggers. Long-only in v1.0 (shorts had negative expectancy in every test).

Tier A: 4-hour Momentum Cloud flips bullish while the pair's daily and weekly are bullish AND BTC's weekly
        is bullish. Eligible for automatic execution during offline hours.
Tier B: a pullback — price re-enters the 4-hour Noodle band from above while the 4-hour cloud stays bullish —
        or a flip without BTC alignment. Always needs approval.
"""


def evaluate(coin, ctx, btc_weekly_bullish):
    """Returns (candidate or None, reasons)."""
    if ctx.get("weekly_dir") != -1:
        return None, ["weekly Momentum Cloud not bullish"]
    if ctx.get("daily_dir") != -1:
        return None, ["daily Momentum Cloud not bullish"]
    h = ctx.get("h4")
    if not h or h.get("line") is None or h.get("prev_dir") is None:
        return None, ["4-hour reading not ready"]
    flip = h["dir"] == -1 and h["prev_dir"] == 1
    in_band = h["upper"] is not None and h["lower"] is not None and h["lower"] <= h["close"] <= h["upper"]
    pullback = (h["dir"] == -1 and h["prev_dir"] == -1 and in_band
                and h["prev_upper"] is not None and h["prev_close"] > h["prev_upper"])
    if flip:
        kind, tier = "flip", ("A" if btc_weekly_bullish else "B")
    elif pullback:
        kind, tier = "pullback", "B"
    else:
        return None, ["no trigger on the last 4-hour bar"]
    if h["close"] <= h["line"]:
        return None, ["close not above the 4-hour line"]
    return {"coin": coin, "side": "long", "kind": kind, "tier": tier, "stop": h["line"],
            "signal_close": h["close"], "bar_t": h["t"], "bar_T": h.get("T"), "range": h.get("range"),
            "btc_weekly_bullish": bool(btc_weekly_bullish)}, []
