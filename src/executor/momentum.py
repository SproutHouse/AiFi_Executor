"""momentum.py — the bull_momentum family's two halves: is the market in a bullish swing (gates), and which coins
have the strongest momentum (scores). docs/specs/BULL_MOMENTUM.md has the research behind every choice.

Both halves are causal: a gate reading or a score for day i uses bars up to day i only. Scores are computed directly
over their window (no running sums), so the engine (1,500 days of history) and the lab (2017 onwards) get identical
values for the same day.

GATES   market-level, one True / False / None (no reading) per day of the panel's day grid.
SCORES  per coin, a number per bar; bigger = stronger momentum. None until the window is full.
"""
import math
from . import indicators as I

DAY = 86400

# name: what it measures (plain words; the lab's reports and the dashboard show these)
SCORES = {
    "ret": "Return over the last N days.",
    "skip": "Return over the last N days, leaving out the most recent quarter (skips short-term reversals).",
    "sharpe": "Return over N days divided by its day-to-day swings (steady climbers beat jumpy ones).",
    "clenow": "Yearly growth rate of the N-day exponential trend line, times how straight the line is (R squared).",
    "high": "How close the price is to its N-day high (1.0 = at the high).",
    "accel": "Return over the last N/2 days minus the N/2 days before (speeding up beats slowing down).",
    "smooth": "Return over N days times the share of up days (many small gains beat one jump).",
    "resid": "Return over N days that is NOT explained by Bitcoin's move, divided by its noise (the coin's own strength).",
    "ma_dist": "How far the price sits above its N-day average.",
    "multi": "Trend strength over three horizons (N/3, N and 2N days), each scaled by the coin's noise, averaged.",
    "ensemble": "Average rank across ret, sharpe, clenow and high (no single measure decides).",
}
ENSEMBLE = ("ret", "sharpe", "clenow", "high")

GATES = {
    "none": "Always on (no market filter).",
    "regime": "The Executor's market regime is bull (Bitcoin above its 200-day average, held 5 days).",
    "btc_sma": "Bitcoin closes above its N-day average.",
    "btc_cross": "Bitcoin's N/4-day average is above its N-day average (e.g. 50 over 200).",
    "btc_mom": "Bitcoin is higher than N days ago.",
    "btc_slope": "Bitcoin is above its N-day average and that average is rising (vs 10 days ago).",
    "btc_cloud": "Bitcoin's daily Momentum Cloud is bullish.",
    "breadth": "At least breadth_min of the coins close above their own N-day average.",
    "index_sma": "An equal-weight index of the coins closes above its N-day average.",
    "combo": "Bitcoin above its N-day average AND at least breadth_min of the coins above their 50-day average.",
    "vote": "At least 2 of 3: Bitcoin above its N-day average, breadth_min of coins above their 50-day, Bitcoin up over 30 days.",
}
# Owner-facing words (dashboard Rules tab, arena bot descriptions): "{n}" is gate_n.
GATE_WORDS = {"none": "at all times", "regime": "while the market regime is bull",
              "btc_sma": "while Bitcoin is above its {n}-day average", "btc_cross": "while Bitcoin's averages point up",
              "btc_mom": "while Bitcoin is up over {n} days", "btc_slope": "while Bitcoin is above a rising {n}-day average",
              "btc_cloud": "while Bitcoin's Momentum Cloud is bullish",
              "breadth": "while most of its coins are above their {n}-day average",
              "index_sma": "while its coins as a group are above their {n}-day average",
              "combo": "while Bitcoin is above its {n}-day average and most coins are rising",
              "vote": "while at least two of three bull signals agree"}
SCORE_WORDS = {"ret": "biggest gain", "skip": "biggest gain (ignoring the last few days)", "sharpe": "steadiest climb",
               "clenow": "straightest uptrend", "high": "nearest to their highs", "accel": "fastest-speeding-up gain",
               "smooth": "smoothest gain", "resid": "strongest move beyond Bitcoin's", "ma_dist": "furthest above their average",
               "multi": "strongest trend across three time spans", "ensemble": "strongest momentum on four measures combined"}


def gate_words(p):
    return GATE_WORDS.get(p.get("gate"), str(p.get("gate"))).format(n=p.get("gate_n", 200))


BTC_GATES = {"btc_sma", "btc_cross", "btc_mom", "btc_slope", "btc_cloud", "combo", "vote"}


# ------------------------------------------------------------------ scores --
def _rets(c, a, b):
    """Daily log returns for bars a+1..b."""
    return [math.log(c[j] / c[j - 1]) for j in range(a + 1, b + 1)]


def _sd(v):
    if len(v) < 2:
        return 0.0
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))


def score(name, c, j, n, btc=None, t=None):
    """Score of bar j for closes c (completed daily bars, ascending). btc: {day_ts: BTC close} for "resid"; t: the
    bars' day stamps (needed with btc). None when the window is not full or the measure is undefined."""
    if j < n or j >= len(c) or n < 2:
        return None
    if name == "ret":
        return c[j] / c[j - n] - 1
    if name == "skip":
        s = max(2, n // 4)
        return c[j - s] / c[j - n] - 1
    if name == "sharpe":
        r = _rets(c, j - n, j)
        sd = _sd(r)
        return None if sd <= 0 else (sum(r) / len(r)) / sd
    if name == "clenow":
        y = [math.log(c[m]) for m in range(j - n + 1, j + 1)]
        k = len(y)
        mx, my = (k - 1) / 2, sum(y) / k
        sxx = sum((x - mx) ** 2 for x in range(k))
        sxy = sum((x - mx) * (y[x] - my) for x in range(k))
        syy = sum((v - my) ** 2 for v in y)
        if sxx <= 0 or syy <= 0:
            return None
        b = sxy / sxx
        r2 = (sxy * sxy) / (sxx * syy)
        return (math.exp(b * 365) - 1) * r2
    if name == "high":
        return c[j] / max(c[j - n + 1:j + 1])
    if name == "accel":
        h = max(1, n // 2)
        return (c[j] / c[j - h] - 1) - (c[j - h] / c[j - n] - 1)
    if name == "smooth":
        up = sum(1 for m in range(j - n + 1, j + 1) if c[m] > c[m - 1])
        return (c[j] / c[j - n] - 1) * up / n
    if name == "ma_dist":
        return c[j] / (sum(c[j - n + 1:j + 1]) / n) - 1
    if name == "multi":
        if j < 2 * n:
            return None
        sd = _sd(_rets(c, j - 2 * n, j))
        if sd <= 0:
            return None
        hs = (max(1, n // 3), n, 2 * n)
        return sum(math.log(c[j] / c[j - h]) / (sd * math.sqrt(h)) for h in hs) / 3
    if name == "resid":
        if btc is None or t is None:
            return None
        r, rb = [], []
        for m in range(j - n + 1, j + 1):
            b1, b0 = btc.get(t[m]), btc.get(t[m - 1])
            if b1 is None or b0 is None:
                continue
            r.append(math.log(c[m] / c[m - 1]))
            rb.append(math.log(b1 / b0))
        if len(r) < max(10, n * 3 // 4):
            return None
        mb, mr = sum(rb) / len(rb), sum(r) / len(r)
        vb = sum((x - mb) ** 2 for x in rb)
        beta = sum((x - mb) * (y - mr) for x, y in zip(rb, r)) / vb if vb > 0 else 0.0
        e = [y - beta * x for x, y in zip(rb, r)]
        sd = _sd(e)
        if sd < 1e-9:                    # Bitcoin itself: nothing left after removing Bitcoin
            return 0.0
        return sum(e) / (sd * math.sqrt(len(e)))
    raise ValueError(f"unknown score {name!r}")


# ------------------------------------------------------------------- gates --
def _sma_at(c, j, n):
    return sum(c[j - n + 1:j + 1]) / n if j >= n - 1 else None


def _btc_raw(name, c, j, n, cloud):
    if name == "btc_sma":
        m = _sma_at(c, j, n)
        return None if m is None else c[j] > m
    if name == "btc_cross":
        f, s = _sma_at(c, j, max(2, n // 4)), _sma_at(c, j, n)
        return None if (f is None or s is None) else f > s
    if name == "btc_mom":
        return None if j < n else c[j] > c[j - n]
    if name == "btc_slope":
        m, m0 = _sma_at(c, j, n), _sma_at(c, j - 10, n) if j >= 10 else None
        return None if (m is None or m0 is None) else (c[j] > m and m > m0)
    if name == "btc_cloud":
        x = cloud[j]
        return None if x is None else x == -1
    raise ValueError(name)


def gate_series(panel, days, pos_of, p, regime=None):
    """[True | False | None] per grid day. Hysteresis: the state flips only after `gate_hold` consecutive days of the
    opposite raw reading (1 = flip at once). A day without a reading keeps the state but reports None."""
    name, n, bmin, hold = p["gate"], p["gate_n"], p["breadth_min"], max(1, p["gate_hold"])
    raw = [None] * len(days)
    if name == "none":
        raw = [True] * len(days)
    elif name == "regime":
        raw = [None if (regime is None or regime.get(d) is None) else regime.get(d) == "bull" for d in days]
    else:
        btc = panel.get("BTC") or []
        bc = [b["c"] for b in btc]
        bpos = [pos_of[b["t"] // DAY * DAY] for b in btc]
        cloud = I.supertrend(btc, 3.0, 10)[1] if name == "btc_cloud" and btc else None
        breadth = _breadth(panel, days, pos_of, n if name == "breadth" else 50) if name in ("breadth", "combo", "vote") else None
        if name == "index_sma":
            raw = _index_above(panel, days, pos_of, n)
        elif name == "breadth":
            raw = [None if x is None else x >= bmin for x in breadth]
        else:
            if name in BTC_GATES and not btc:
                raise ValueError(f"gate {name} reads Bitcoin: put BTC in the recipe's coins")
            for j, i in enumerate(bpos):
                if name == "combo":
                    a, b = _btc_raw("btc_sma", bc, j, n, None), breadth[i]
                    raw[i] = None if (a is None or b is None) else (a and b >= bmin)
                elif name == "vote":
                    a, b, m = _btc_raw("btc_sma", bc, j, n, None), breadth[i], _btc_raw("btc_mom", bc, j, 30, None)
                    raw[i] = None if (a is None or b is None or m is None) else (int(a) + int(b >= bmin) + int(m)) >= 2
                else:
                    raw[i] = _btc_raw(name, bc, j, n, cloud)
    out, state, run = [None] * len(days), None, 0
    for i, r in enumerate(raw):
        if r is None:
            continue
        if state is None:
            state = r
        elif r != state:
            run += 1
            if run >= hold:
                state, run = r, 0
        else:
            run = 0
        out[i] = state
    return out


def _breadth(panel, days, pos_of, n):
    """Share of coins (with a reading that day) closing above their own n-day average; None with fewer than 3."""
    up, cnt = [0] * len(days), [0] * len(days)
    for bars in panel.values():
        c = [b["c"] for b in bars]
        for j, b in enumerate(bars):
            m = _sma_at(c, j, n)
            if m is None:
                continue
            i = pos_of[b["t"] // DAY * DAY]
            cnt[i] += 1
            up[i] += c[j] > m
    return [None if cnt[i] < 3 else up[i] / cnt[i] for i in range(len(days))]


def _index_above(panel, days, pos_of, n):
    """Equal-weight index of the coins (mean daily return of those with bars on both days) vs its n-day average.
    The index over any window depends only on that window's returns, so the reading does not depend on the start."""
    by_day = [[] for _ in days]
    for bars in panel.values():
        for j in range(1, len(bars)):
            i = pos_of[bars[j]["t"] // DAY * DAY]
            if (bars[j]["t"] - bars[j - 1]["t"]) // DAY <= 4:          # weekday markets skip weekends
                by_day[i].append(bars[j]["c"] / bars[j - 1]["c"] - 1)
    r = [sum(v) / len(v) if len(v) >= 3 else None for v in by_day]
    out = [None] * len(days)
    for i in range(len(days)):
        if i < n or any(x is None for x in r[i - n + 1:i + 1]):
            continue
        lvl = 1.0                         # rebuild the window's index from 1.0: start-independent
        levels = []
        for x in r[i - n + 1:i + 1]:
            lvl *= 1 + x
            levels.append(lvl)
        out[i] = levels[-1] > sum(levels) / n
    return out
