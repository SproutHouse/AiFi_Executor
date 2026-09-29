"""market_regime.py — the market regime from BTC's daily bars (docs/specs/REGIME.md), one label per completed day.

Three dials, with hysteresis, exactly as backtested in research/phase1/regime.py:
  trend    BTC close vs its 200-day SMA with a ±2% buffer (inside the buffer the previous trend state holds)
  vol      30-day realised volatility as a percentile of the trailing 365 days
  funding  BTC 7-day mean funding, annualised (optional; only splits "euphoria" out of "bull")
Labels, in priority order: crisis (vol pct >= 90 AND close below its 50-day SMA) · bear (trend down) · euphoria
(trend up and funding >= 20%/yr) · bull (trend up) · chop (trend state undefined). A new label must hold 5
consecutive days to take effect, except crisis, which takes effect at once.

coarse() folds euphoria into bull. Engine gates and the lab's per-regime scorecard use the coarse label, so a
gate never depends on the funding dial (which has no history before 2023).
Pure functions: the lab labels 2017-2026 with the same code the engine uses to read today's regime.
"""
import math

BAND, VOL_PCT, EUPHORIA, HOLD = 0.02, 90, 0.20, 5
COARSE = ("bull", "bear", "chop", "crisis")


def labels(daily, funding_apr_by_day=None, band=BAND, vol_pct=VOL_PCT, euphoria=EUPHORIA, hold=HOLD):
    """daily: completed BTC bars {t, c, ...} ascending. funding_apr_by_day: {day_ts: annualised funding} or None.
    Returns one label per bar (None before the 200-day warm-up)."""
    c = [b["c"] for b in daily]
    t = [b["t"] // 86400 * 86400 for b in daily]
    ret = [0.0] + [c[i] / c[i - 1] - 1 for i in range(1, len(c))]
    fund = funding_apr_by_day or {}
    out, vols = [], []
    trend, cur, cand, cnt = None, None, None, 0
    s200 = s50 = 0.0
    for i in range(len(c)):
        s200 += c[i]
        s50 += c[i]
        if i >= 200:
            s200 -= c[i - 200]
        if i >= 50:
            s50 -= c[i - 50]
        sma = s200 / 200 if i >= 199 else None
        sma50 = s50 / 50 if i >= 49 else None
        if sma:
            if c[i] > sma * (1 + band):
                trend = "up"
            elif c[i] < sma * (1 - band):
                trend = "down"
        vol = math.sqrt(sum(x * x for x in ret[max(1, i - 29):i + 1]) / 30 * 365) if i >= 30 else None
        vols.append(vol)
        hist = [v for v in vols[max(0, i - 365):i] if v is not None]
        vp = sum(1 for v in hist if v <= vol) / len(hist) * 100 if vol and len(hist) > 200 else None
        f7 = [fund[d] for d in range(t[i] - 6 * 86400, t[i] + 1, 86400) if d in fund]
        f = sum(f7) / len(f7) if len(f7) >= 5 else None
        if vp is not None and vp >= vol_pct and sma50 and c[i] < sma50:
            r = "crisis"
        elif trend == "down":
            r = "bear"
        elif trend == "up" and f is not None and f >= euphoria:
            r = "euphoria"
        elif trend == "up":
            r = "bull"
        else:
            r = "chop"
        if sma is None:
            out.append(None)
            continue
        if cur is None:
            cur = r
        elif r == "crisis":
            cur, cand, cnt = "crisis", None, 0
        elif r != cur:
            if r == cand:
                cnt += 1
            else:
                cand, cnt = r, 1
            if cnt >= hold:
                cur, cand, cnt = r, None, 0
        else:
            cand, cnt = None, 0
        out.append(cur)
    return out


def coarse(label):
    return "bull" if label == "euphoria" else label


def by_day(daily, funding_apr_by_day=None):
    """{day_ts: coarse label} for every labelled day."""
    return {b["t"] // 86400 * 86400: coarse(l) for b, l in zip(daily, labels(daily, funding_apr_by_day)) if l}


def now(daily, funding_apr_by_day=None):
    """The coarse label of the last completed day, or None without 200 days of history."""
    ls = labels(daily, funding_apr_by_day)
    return coarse(ls[-1]) if ls and ls[-1] else None
