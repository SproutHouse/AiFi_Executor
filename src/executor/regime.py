"""regime.py — the per-pair reading: weekly, daily and 4-hour Momentum Cloud plus the 4-hour Noodle band.

Weekly = last COMPLETED Monday-anchored week (the forming week is excluded, so nothing peeks).
Daily  = last completed UTC day. 4h = last completed 4-hour bar.
Direction -1 is bullish, 1 bearish, None means not enough history.
"""
from . import indicators as I

WEEK = 7 * 86400


def context(daily, h4, now_ts, ind):
    factor, atr = ind["supertrend_factor"], ind["supertrend_atr"]
    weeks = [w for w in I.weekly_from_daily(daily) if w["t"] + WEEK <= now_ts]
    st_w, dir_w = I.supertrend(weeks, factor, atr) if len(weeks) >= 2 else ([], [])
    st_d, dir_d = I.supertrend(daily, factor, atr) if len(daily) >= 2 else ([], [])
    st_4, dir_4 = I.supertrend(h4, factor, atr) if len(h4) >= 2 else ([], [])
    out = {"weeks": len(weeks), "days": len(daily), "bars4h": len(h4),
           "weekly_dir": dir_w[-1] if dir_w else None, "weekly_line": st_w[-1] if st_w else None,
           "daily_dir": dir_d[-1] if dir_d else None, "daily_prev_dir": dir_d[-2] if len(dir_d) > 1 else None,
           "daily_line": st_d[-1] if st_d else None, "daily_close": daily[-1]["c"] if daily else None, "h4": None}
    k = len(h4) - 1
    if k >= 1 and dir_4:
        b = I.bands(h4, ind["band_ema"], ind["trend_ema"])
        out["h4"] = {"dir": dir_4[k], "prev_dir": dir_4[k - 1], "line": st_4[k], "close": h4[k]["c"],
                     "prev_close": h4[k - 1]["c"], "upper": b["upper"][k], "lower": b["lower"][k],
                     "prev_upper": b["upper"][k - 1], "trend": b["trend"][k], "t": h4[k]["t"], "T": h4[k].get("T"),
                     "range": I.range_state(h4[k]["c"], b["upper"][k], b["lower"][k])}
    return out


def label(d):
    return "Bullish" if d == -1 else "Bearish" if d == 1 else "No data"
