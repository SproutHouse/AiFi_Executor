"""families.py — strategy families for target-weight bots. One recipe = a family + its parameters + coins + sizing.

The same functions run in two places: the lab backtests a recipe over 2017-2026 by computing the whole series once,
and the engine (cycle.py, strategy "target") computes the series over its own recent history and trades the last
value. Every function is causal: the value on day i uses bars 0..i only (the lab's peek audit enforces this by
recomputing on truncated history).

Pipeline for each completed day:
  1. direction per coin in [-1, 1] from the family's rule          (family-specific; 0 = flat)
  2. volatility sizing: |w| = min(cap_x, vol_target / realised vol)  (shared; same formula as target.weight)
  3. allocation: equal across the recipe's coins (or across the selected coins for rotation families)
  4. regime gate: longs only on days whose market regime is in `long_regimes`, shorts only in `short_regimes`
  5. gross cap: scale everything down so sum(|weight|) <= gross_cap
The output is a fraction of the bot's equity per coin (0.4 = hold notional worth 40% of equity).

ENGINE flags which families the engine can run today: long-or-flat only. Families that short are lab-only until
the engine's short side is built and paper-validated (the expensive step comes last, and only if the lab says the
short side earns its keep; Phase 1 of the Doctrine found shorts did not pay in any trend family).
"""
import math
from . import indicators as I, momentum as MO

DAY = 86400

COMMON = {
    # name: (kind, lo, hi, default)  kind: float | int | bool | choice (choice: lo is the tuple of allowed values)
    "vol_target": ("float", 0.10, 0.60, 0.30),
    "cap_x": ("float", 0.25, 3.0, 2.0),
    "vol_days": ("int", 10, 90, 30),
    "band": ("float", 0.0, 0.5, 0.25),
    "stop_pct": ("float", 5.0, 40.0, 15.0),      # every engine position keeps a resident stop; 0 is not "no stop"
    "gross_cap": ("float", 0.5, 3.0, 2.0),
    "short": ("bool", None, None, False),
}

FAMILIES = {
    "sma_trend": {"doc": "Long while the close is above its N-day average (the Trend bot's rule).",
                  "params": {"n": ("int", 10, 300, 50)}, "engine": True},
    "tsmom": {"doc": "Time-series momentum: long while the close is above the close N days ago.",
              "params": {"n": ("int", 10, 365, 90)}, "engine": True},
    "dual_ma": {"doc": "Long while the fast average is above the slow average.",
                "params": {"fast": ("int", 5, 100, 20), "slow": ("int", 20, 300, 100)}, "engine": True},
    "donchian": {"doc": "Breakout: long on a close above the prior N-day high, out on a close below the prior M-day low.",
                 "params": {"n": ("int", 10, 200, 55), "m": ("int", 5, 100, 20)}, "engine": True},
    "cloud_trend": {"doc": "Long while the daily Momentum Cloud (supertrend) is bullish.",
                    "params": {"factor": ("float", 1.5, 5.0, 3.0), "atr": ("int", 5, 30, 10)}, "engine": True},
    "rs_rotation": {"doc": "Cross-sectional momentum: every R days hold the top K coins by N-day return, "
                           "each only while above its own F-day average.",
                    "params": {"n": ("int", 7, 180, 30), "k": ("int", 1, 10, 3), "rebalance_days": ("int", 1, 30, 7),
                               "filter_n": ("int", 0, 300, 50)}, "engine": True},
    "meanrev": {"doc": "Buy the dip inside an uptrend: long after a close below the lower N-day Bollinger band "
                       "(k deviations) while above the T-day average; out on a close back above the N-day average.",
                "params": {"n": ("int", 5, 60, 20), "k": ("float", 1.0, 3.5, 2.0), "trend_n": ("int", 0, 300, 200)},
                "engine": True},
    "bull_momentum": {"doc": "Bull-market momentum: while the market gate says the market is in a bullish swing, hold the "
                             "K coins with the strongest momentum score, re-ranked every R days (and the day the gate "
                             "opens); everything flat the day the gate closes. Gates and scores: momentum.py.",
                      "params": {"rank": ("choice", tuple(MO.SCORES), None, "ret"), "n": ("int", 5, 180, 30),
                                 "k": ("int", 1, 10, 3), "rebalance_days": ("int", 1, 30, 7),
                                 "buffer": ("int", 0, 5, 0), "filter_n": ("int", 0, 300, 0),
                                 "abs_mom": ("bool", None, None, True),
                                 "gate": ("choice", tuple(MO.GATES), None, "btc_sma"), "gate_n": ("int", 10, 300, 200),
                                 "breadth_min": ("float", 0.3, 0.9, 0.5), "gate_hold": ("int", 1, 10, 1)},
                      "engine": True},
}
ROTATIONS = ("rs_rotation", "bull_momentum")


# ----------------------------------------------------------------- helpers --
def _closes(bars):
    return [b["c"] for b in bars]


def _sma(v, n):
    out, s = [None] * len(v), 0.0
    for i, x in enumerate(v):
        s += x
        if i >= n:
            s -= v[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def realised_vol(closes, vd):
    """Annualised vol from the last vd daily returns, per bar; the same formula as target.weight.
    None until there are enough bars for target.weight's own history check."""
    out = [None] * len(closes)
    for i in range(vd, len(closes)):
        rets = [closes[j] / closes[j - 1] - 1 for j in range(i - vd + 1, i + 1)]
        out[i] = math.sqrt(sum(x * x for x in rets) / len(rets) * 365)
    return out


def _sign(x, short):
    return 1.0 if x > 0 else (-1.0 if (x < 0 and short) else 0.0)


# -------------------------------------------------------------- directions --
def dir_sma_trend(bars, p):
    c = _closes(bars)
    m = _sma(c, p["n"])
    return [None if m[i] is None else (1.0 if c[i] > m[i] else (-1.0 if p.get("short") and c[i] < m[i] else 0.0)) for i in range(len(c))]


def dir_tsmom(bars, p):
    c, n = _closes(bars), p["n"]
    return [None if i < n else _sign(c[i] / c[i - n] - 1, p.get("short")) for i in range(len(c))]


def dir_dual_ma(bars, p):
    c = _closes(bars)
    f, s = _sma(c, p["fast"]), _sma(c, p["slow"])
    return [None if (f[i] is None or s[i] is None) else _sign(f[i] - s[i], p.get("short")) for i in range(len(c))]


def dir_donchian(bars, p):
    c, n, m = _closes(bars), p["n"], p["m"]
    out, pos = [], 0.0
    for i in range(len(c)):
        if i < max(n, m):
            out.append(None)
            continue
        hi, lo = max(c[i - n:i]), min(c[i - m:i])
        if c[i] > hi:
            pos = 1.0
        elif pos > 0 and c[i] < lo:
            pos = 0.0
        if p.get("short"):
            lo_n, hi_m = min(c[i - n:i]), max(c[i - m:i])
            if c[i] < lo_n:
                pos = -1.0
            elif pos < 0 and c[i] > hi_m:
                pos = 0.0
        out.append(pos)
    return out


def dir_cloud_trend(bars, p):
    _st, d = I.supertrend(bars, float(p["factor"]), int(p["atr"]))
    return [None if x is None else (1.0 if x == -1 else (-1.0 if p.get("short") else 0.0)) for x in d]


def dir_meanrev(bars, p):
    c, n, k, tn = _closes(bars), p["n"], float(p["k"]), p["trend_n"]
    m = _sma(c, n)
    tr = _sma(c, tn) if tn else [0.0] * len(c)
    out, pos = [], 0.0
    for i in range(len(c)):
        if m[i] is None or tr[i] is None:
            out.append(None)
            continue
        sd = math.sqrt(sum((x - m[i]) ** 2 for x in c[i - n + 1:i + 1]) / n)
        if pos == 0.0 and c[i] < m[i] - k * sd and (not tn or c[i] > tr[i]):
            pos = 1.0
        elif pos > 0 and (c[i] > m[i] or (tn and c[i] < tr[i])):
            pos = 0.0
        out.append(pos)
    return out


DIRECTIONS = {"sma_trend": dir_sma_trend, "tsmom": dir_tsmom, "dual_ma": dir_dual_ma, "donchian": dir_donchian,
              "cloud_trend": dir_cloud_trend, "meanrev": dir_meanrev}


# ------------------------------------------------------------------- core --
def params_with_defaults(family, params):
    spec = dict(COMMON)
    spec.update(FAMILIES[family]["params"])
    out = {k: v[3] for k, v in spec.items()}
    out.update(params or {})
    for k, (kind, _lo, _hi, _d) in spec.items():
        if kind == "int":
            out[k] = int(out[k])
        elif kind == "float":
            out[k] = float(out[k])
        elif kind == "bool":
            out[k] = bool(out[k])
        elif kind == "choice":
            out[k] = str(out[k])
            if out[k] not in _lo:
                raise ValueError(f"{k}={out[k]!r} is not one of {', '.join(_lo)}")
    return out


def _grid(panel):
    days = sorted({b["t"] // DAY * DAY for bars in panel.values() for b in bars})
    return days


def targets(panel, family, params, regime=None, alloc=None):
    """Full series. panel: {coin: completed daily bars ascending}. regime: {day_ts: coarse label} or None (no gate).
    alloc: {coin: share} for per-coin families (default equal across the panel; callers pass the recipe's own split
    so a coin missing from the panel keeps its share in cash). Returns (days, {coin: [weight or None per day]}),
    weight = signed fraction of equity. None means "no reading" (warm-up or a data gap): the engine keeps what it has."""
    p = params_with_defaults(family, params)
    days = _grid(panel)
    pos_of = {d: i for i, d in enumerate(days)}
    coins = sorted(panel)
    raw = {}
    for coin in coins:
        bars = panel[coin]
        c = _closes(bars)
        vol = realised_vol(c, p["vol_days"])
        if family in ROTATIONS:
            dirs = [0.0] * len(bars)        # filled in below from the cross-section
        else:
            dirs = DIRECTIONS[family](bars, p)
        size = [None] * len(days)
        dvals = [None] * len(days)
        for j, b in enumerate(bars):
            i = pos_of[b["t"] // DAY * DAY]
            dvals[i] = dirs[j]
            v = vol[j]
            size[i] = None if (v is None or v <= 0) else min(p["cap_x"], p["vol_target"] / v)
        raw[coin] = (dvals, size, bars)
    if family == "rs_rotation":
        _rotation(panel, p, days, pos_of, raw)
    elif family == "bull_momentum":
        _bull_momentum(panel, p, days, pos_of, raw, regime)
    shares = alloc or {c: 1.0 / len(coins) for c in coins}
    out = {c: [None] * len(days) for c in coins}
    for i, d in enumerate(days):
        lab = regime.get(d) if regime is not None else None
        row = {}
        for coin in coins:
            dv, sz, _b = raw[coin]
            if dv[i] is None or sz[i] is None:
                continue
            dirn = dv[i]
            if regime is not None and lab is None:
                dirn = 0.0 if dirn else dirn
            elif regime is not None:
                if dirn > 0 and lab not in (p.get("long_regimes") or COARSE_ALL):
                    dirn = 0.0
                if dirn < 0 and lab not in (p.get("short_regimes") or ("bear", "crisis")):
                    dirn = 0.0
            share = shares.get(coin, 0.0) if family not in ROTATIONS else 1.0 / max(1, p["k"])
            row[coin] = dirn * sz[i] * share
        gross = sum(abs(w) for w in row.values())
        scale = min(1.0, p["gross_cap"] / gross) if gross > 0 else 1.0
        for coin, w in row.items():
            out[coin][i] = w * scale
    return days, out


COARSE_ALL = ("bull", "bear", "chop", "crisis")


def _rotation(panel, p, days, pos_of, raw):
    """Every rebalance day (epoch day number divisible by R, so the engine and the lab agree), rank coins by their
    N-day return and hold the top K that are also above their own F-day average. Between rebalances the selection
    holds, except that a coin leaving its uptrend is dropped at once."""
    n, k, R, fn = p["n"], p["k"], p["rebalance_days"], p["filter_n"]
    series = {}
    for coin, bars in panel.items():
        c = _closes(bars)
        f = _sma(c, fn) if fn else [0.0] * len(c)
        mom, up = [None] * len(days), [None] * len(days)
        for j, b in enumerate(bars):
            i = pos_of[b["t"] // DAY * DAY]
            if j >= n and f[j] is not None:
                mom[i] = c[j] / c[j - n] - 1
                up[i] = (c[j] > f[j]) if fn else True
        series[coin] = (mom, up)
    held = set()
    for i, d in enumerate(days):
        if (d // DAY) % R == 0:
            ranked = sorted((series[c][0][i], c) for c in panel if series[c][0][i] is not None and series[c][1][i])
            held = {c for _m, c in ranked[::-1][:k] if _m > 0}
        for coin in panel:
            dv = raw[coin][0]
            mom, up = series[coin]
            if mom[i] is None:
                dv[i] = None
                continue
            if coin in held and not up[i]:
                held.discard(coin)
            dv[i] = 1.0 if coin in held else 0.0


def _bull_momentum(panel, p, days, pos_of, raw, regime):
    """Gate closed: hold nothing. Gate open: on rebalance days (epoch day divisible by R, as in rs_rotation) and on the
    day the gate opens, rank the eligible coins by the score and hold the top K; a coin already held stays while it
    ranks inside the top K + buffer (fewer trades for the same idea). Eligible: a score, above its own F-day average
    when filter_n > 0, and up over N days when abs_mom. Between rebalances a held coin that falls below its F-day
    average is dropped at once. A day without a gate reading is a data gap: no weights that day, selection kept."""
    n, k, R, fn, buf, rk = p["n"], p["k"], p["rebalance_days"], p["filter_n"], p["buffer"], p["rank"]
    gate = MO.gate_series(panel, days, pos_of, p, regime)
    btc = {b["t"] // DAY * DAY: b["c"] for b in panel.get("BTC", [])}
    info = {}
    for coin, bars in panel.items():
        c = _closes(bars)
        t = [b["t"] // DAY * DAY for b in bars]
        f = _sma(c, fn) if fn else None
        info[coin] = (c, t, f, {pos_of[d]: j for j, d in enumerate(t)})
    names = MO.ENSEMBLE if rk == "ensemble" else (rk,)

    def eligible(coin, i):
        c, t, f, at = info[coin]
        j = at.get(i)
        if j is None or j < n:
            return None
        if fn and (f[j] is None or c[j] <= f[j]):
            return None
        if p["abs_mom"] and c[j] <= c[j - n]:
            return None
        vals = [MO.score(nm, c, j, n, btc, t) for nm in names]
        return None if any(v is None for v in vals) else vals

    held, prev = [], None
    for i, d in enumerate(days):
        g = gate[i]
        if g is None:
            for coin in panel:
                raw[coin][0][i] = None
            continue
        if not g:
            held = []
        elif (d // DAY) % R == 0 or not prev:
            cand = {}
            for coin in sorted(panel):
                v = eligible(coin, i)
                if v is not None:
                    cand[coin] = v
            if len(names) == 1:
                order = sorted(cand, key=lambda x: (-cand[x][0], x))
            else:                        # average rank across the measures; ties to the alphabet
                ranks = {x: 0.0 for x in cand}
                for m in range(len(names)):
                    for r, x in enumerate(sorted(cand, key=lambda x: (-cand[x][m], x))):
                        ranks[x] += r
                order = sorted(cand, key=lambda x: (ranks[x], x))
            keep = [x for x in held if x in order[:k + buf]]
            held = keep + [x for x in order if x not in keep][:k - len(keep)]
        elif fn:
            held = [x for x in held if (info[x][3].get(i) is None or
                                        (info[x][2][info[x][3][i]] is not None and info[x][0][info[x][3][i]] > info[x][2][info[x][3][i]]))]
        prev = g
        for coin in panel:
            c, t, f, at = info[coin]
            j = at.get(i)
            raw[coin][0][i] = None if (j is None or j < n) else (1.0 if coin in held else 0.0)


def latest(panel, family, params, regime=None, alloc=None):
    """What the engine trades: {coin: (weight or None, detail)} for the last completed day in the panel."""
    days, out = targets(panel, family, params, regime, alloc)
    res = {}
    for coin, series in out.items():
        bars = panel[coin]
        last_day = bars[-1]["t"] // DAY * DAY if bars else None
        if not bars or last_day != days[-1]:
            res[coin] = (None, "no bar for the latest day (data gap)")
            continue
        w = series[-1]
        lab = regime.get(days[-1]) if regime is not None else None
        res[coin] = (w, f"{family}: weight {w:.2f} of equity" + (f" · regime {lab}" if regime is not None else "") if w is not None
                     else f"{family}: not enough history")
    return res


def from_target_cfg(cfg):
    """(family, params, alloc) from a settings.target block. A block without "family" is the original Trend bot
    (sma / vol_target / cap_x / vol_days / weights), which maps exactly onto sma_trend."""
    if cfg.get("family"):
        coins = list(cfg.get("coins") or cfg.get("weights") or [])
        alloc = dict(cfg["weights"]) if isinstance(cfg.get("weights"), dict) else {c: 1.0 / len(coins) for c in coins}
        return cfg["family"], dict(cfg.get("params") or {}), alloc, coins
    params = {"n": cfg["sma"], "vol_target": cfg["vol_target"], "cap_x": cfg["cap_x"], "vol_days": cfg["vol_days"],
              "band": cfg["band"], "stop_pct": cfg["stop_pct"], "gross_cap": 10.0}
    return "sma_trend", params, dict(cfg["weights"]), list(cfg["weights"])


def unused_params(family, params):
    """Settings the recipe carries but its rule never reads (the lab's neighbour check must not count moving them as
    robustness)."""
    if family != "bull_momentum":
        return set()
    g = params.get("gate", "btc_sma")
    out = set()
    if g in ("none", "regime", "btc_cloud"):
        out.add("gate_n")
    if g not in ("breadth", "combo", "vote"):
        out.add("breadth_min")
    if g == "none":
        out.add("gate_hold")
    return out


def needs_regime(params):
    return bool(params.get("long_regimes") or params.get("short_regimes") or params.get("short") or params.get("gate") == "regime")
