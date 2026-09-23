"""indicators.py — Momentum Cloud and Noodle Range, ported from the AiFi desk.

Pine semantics reproduced exactly (same code as the desk's fred_indicators.py):
  ta.atr(n)      RMA (Wilder) of true range, seeded with the SMA of the first n
  ta.ema(n)      alpha 2/(n+1), seeded with the SMA of the first n bars
  ta.supertrend  hl2 ± factor*atr with band locking; direction -1 = bullish
Momentum Cloud = supertrend(3, 10). Noodle Range = EMA36 of high / close / low.
Bars are dicts with keys t (seconds), o, h, l, c, v.
"""
from datetime import datetime, timezone, timedelta


def rma(values, n):
    out, acc = [], None
    for i, v in enumerate(values):
        if v is None:
            out.append(None)
            continue
        if acc is None:
            window = [x for x in values[max(0, i - n + 1): i + 1] if x is not None]
            if i + 1 < n or len(window) < n:
                out.append(None)
                continue
            acc = sum(window) / n
        else:
            acc = (acc * (n - 1) + v) / n
        out.append(acc)
    return out


def ema(values, n):
    out, acc, alpha = [], None, 2.0 / (n + 1)
    for i, v in enumerate(values):
        if v is None:
            out.append(None)
            continue
        if acc is None:
            window = [x for x in values[max(0, i - n + 1): i + 1] if x is not None]
            if i + 1 < n or len(window) < n:
                out.append(None)
                continue
            acc = sum(window) / n
        else:
            acc = alpha * v + (1 - alpha) * acc
        out.append(acc)
    return out


def sma(values, n):
    out = []
    for i in range(len(values)):
        w = values[max(0, i - n + 1): i + 1]
        out.append(sum(w) / n if len(w) == n and None not in w else None)
    return out


def true_range(bars):
    out = []
    for i, b in enumerate(bars):
        if i == 0:
            out.append(b["h"] - b["l"])
        else:
            pc = bars[i - 1]["c"]
            out.append(max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc)))
    return out


def supertrend(bars, factor=3.0, atr_period=10):
    """Pine's ta.supertrend. Returns (line, direction) per bar; direction -1 bullish, 1 bearish."""
    atr = rma(true_range(bars), atr_period)
    st, direction = [None] * len(bars), [None] * len(bars)
    prev_upper = prev_lower = None
    prev_st = None
    for i, b in enumerate(bars):
        if atr[i] is None:
            continue
        src = (b["h"] + b["l"]) / 2
        upper = src + factor * atr[i]
        lower = src - factor * atr[i]
        pc = bars[i - 1]["c"] if i else b["c"]
        if prev_lower is not None:
            lower = lower if (lower > prev_lower or pc < prev_lower) else prev_lower
            upper = upper if (upper < prev_upper or pc > prev_upper) else prev_upper
        if prev_st is None:
            d = 1
        elif prev_st == prev_upper:
            d = -1 if b["c"] > upper else 1
        else:
            d = 1 if b["c"] < lower else -1
        st[i] = lower if d == -1 else upper
        direction[i] = d
        prev_upper, prev_lower, prev_st = upper, lower, st[i]
    return st, direction


def monday_start(ts):
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    m = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(m.timestamp())


def weekly_from_daily(daily):
    """Aggregate daily bars into Monday-anchored weeks (TradingView's crypto week)."""
    weeks = {}
    for b in daily:
        k = monday_start(b["t"])
        w = weeks.get(k)
        if not w:
            weeks[k] = {"t": k, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b.get("v", 0.0)}
        else:
            w["h"] = max(w["h"], b["h"]); w["l"] = min(w["l"], b["l"]); w["c"] = b["c"]; w["v"] += b.get("v", 0.0)
    return [weeks[k] for k in sorted(weeks)]


def bands(bars, length=36, trend_len=200):
    """Noodle Range bands per bar: EMA of highs, closes and lows, plus the trend EMA."""
    return {"upper": ema([b["h"] for b in bars], length), "mid": ema([b["c"] for b in bars], length),
            "lower": ema([b["l"] for b in bars], length), "trend": ema([b["c"] for b in bars], trend_len)}


def range_state(close, upper, lower):
    if upper is None or lower is None or close is None:
        return None
    return "Overextended" if close > upper else "Suppressed" if close < lower else "In Range"
