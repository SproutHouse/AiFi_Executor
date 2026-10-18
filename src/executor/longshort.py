"""longshort.py — the market-neutral long-short book (the AiFi Lab's family "ls_xs"), engine side. PAPER ONLY.

Built 2026-10-18 for one shadow experiment (agents/shadow-01, lab recipe ls-759fac45): the lab's verdict on that recipe
is "failed" (it missed only the worst-regime floor), and the owner chose to paper-trade it as an unofficial experiment.
Nothing here is reachable by any other agent: the cycle runs it only for a target block whose "family" is "ls_xs" and
whose "shorts" is true, and cycle.resolve_mode keeps any such agent (and any agent marked "shadow") in paper. There is
no live short order path in the engine; go_live.py and approve.py refuse a shadow agent outright.

The book (the lab's lab/lsbook.py ls_targets, restricted to what this recipe uses: the scores ret, rev and resid,
equal weights, dollar-neutral, book "xs"; anything else raises):
  every R days (epoch day number divisible by R, as the lab), rank the day's eligible coins by the score (resid: the
  n-day residual return against Bitcoin, beta from the last BETA_DAYS days, over its own residual noise); with m
  ranked names and k = floor(q x m), the long leg is the best-ranked names of the upper half the engine could buy
  today (funding reading at or below +max_funding), at most k; the short leg the worst-ranked names of the lower half
  it could short today (funding at or above -max_funding), at most k. Each leg is equal-weighted to 0.5 of equity
  (long +0.5, short -0.5), then the whole book is scaled to the portfolio volatility target from the sample covariance
  of the last cov_days daily returns (pairwise-complete, x 365) and capped at gross_cap. Fewer than min_names eligible
  names: no book (everything flat). A leg left empty: no book that week. Between rebalances nothing is traded (weights
  drift), except by the book brake and the catastrophic stops.
  The arithmetic is the lab's, line for line, so on the same bars the weights are equal to the last bit
  (tests/test_longshort.py; the lab's Phase 0 replays the whole engine against its harness).

Book risk (gates v7 "stops": "book"): no per-name risk stop; the volatility target plus a book drawdown brake: when the
agent's equity falls brake_dd below its running peak, every position closes, the book stays flat for brake_days and
re-forms at the first rebalance after that, with its peak reset (brake_step, state in state/.../book.json).

Catastrophic stop (an engine rule, not the lab's): the engine never holds a position without a resident stop (on the
exchange it is what protects a position while the server is down), so each name of the book still carries one, far
away: catastrophic_stop_pct beyond its average entry (default 100%: a short closes if its price doubles; a long's sits
at zero and never fires). It is not part of the strategy; the lab's harness has none, and the lab's Phase 0 replay
measures it (since 2024-01: one fire at 100%, 22 at 50%).

Point-in-time universe, live (the lab ranks Binance spot pairs, dead coins included, by trailing 30-day median quote
volume; the engine can trade only Hyperliquid perps): every Hyperliquid perp listed today is ranked by its trailing
window-day median daily notional volume (base volume x close, from Hyperliquid's own daily candles), using the days up
to the day before the decision (the lab's ranking is also known the day before), with at least min_history daily
bars. The top N are the universe; a name is eligible on the decision day when it is listed (not delisted) and its
notional volume that day is at least min_usd_vol (the lab's $1M floor for these books). Shortable = listed on
Hyperliquid and not delisted. Bitcoin is always read (the resid score needs it). Differences from the lab are
documented in docs/specs/SHADOW.md and measured by the lab.
"""
import math

DAY = 86400
MIN_COV_OBS = 20          # daily returns a coin needs inside the covariance window to be sized (and so to be held)
BETA_DAYS = 90            # the beta window of the resid score
SCORES = ("ret", "rev", "resid")
# the book's settings and the lab's defaults (lab/lsbook.py LS_PARAMS); vol_target and gross_cap as families.COMMON
DEFAULTS = {"score": "ret", "n": 21, "q": 0.3, "rebalance_days": 7, "cov_days": 90, "min_names": 12,
            "weighting": "equal", "neutral": "dollar", "book": "xs", "stops": "book", "brake_dd": 0.15, "brake_days": 28,
            "vol_target": 0.30, "gross_cap": 2.0, "band": 0.25}
UNIVERSE = {"n": 30, "window": 30, "min_history": 60, "min_usd_vol": 1_000_000, "prefilter": 90}


def params(p):
    """The book's settings with defaults, checked: only what this engine implements (else ValueError)."""
    out = dict(DEFAULTS)
    out.update({k: v for k, v in (p or {}).items() if v is not None})
    for k in ("n", "rebalance_days", "cov_days", "min_names", "brake_days"):
        out[k] = int(out[k])
    for k in ("q", "brake_dd", "vol_target", "gross_cap", "band"):
        out[k] = float(out[k])
    if out["score"] not in SCORES:
        raise ValueError(f"score {out['score']!r}: the engine's book implements {', '.join(SCORES)} only")
    for k, want in (("weighting", "equal"), ("neutral", "dollar"), ("book", "xs"), ("stops", "book")):
        if out[k] != want:
            raise ValueError(f"{k}={out[k]!r}: the engine's book implements {k}={want!r} only")
    return out


# ------------------------------------------------------------------------------------------------- grid data --
def grid(panel):
    return sorted({b["t"] // DAY * DAY for bars in panel.values() for b in bars})


def _grid_closes(panel, days):
    pos = {d: i for i, d in enumerate(days)}
    out = {}
    for c, bars in panel.items():
        col = [None] * len(days)
        for b in bars:
            i = pos.get(b["t"] // DAY * DAY)
            if i is not None and b["c"] > 0:
                col[i] = b["c"]
        out[c] = col
    return out


def _rets(col):
    return [None] + [(col[i] / col[i - 1] - 1) if (col[i] is not None and col[i - 1] is not None) else None
                     for i in range(1, len(col))]


def grid_data(panel, days):
    C = _grid_closes(panel, days)
    G = {"days": days, "C": C, "R": {c: _rets(col) for c, col in C.items()}}
    if "BTC" in C:
        G["R_btc"] = G["R"]["BTC"]
    return G


def _sd(v):
    if len(v) < 2:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((a - m) ** 2 for a in v) / (len(v) - 1))


def _beta_ols(y, x, i, n, min_obs):
    pr = [(a, b) for a, b in zip(y[max(0, i - n + 1):i + 1], x[max(0, i - n + 1):i + 1]) if a is not None and b is not None]
    if len(pr) < min_obs:
        return None
    mx = sum(b for _a, b in pr) / len(pr)
    my = sum(a for a, _b in pr) / len(pr)
    vx = sum((b - mx) ** 2 for _a, b in pr)
    if vx <= 0:
        return None
    return sum((a - my) * (b - mx) for a, b in pr) / vx


def score(name, c, i, p, G):
    """A coin's score on grid day i (higher = long), or None (not enough history)."""
    C, R = G["C"][c], G["R"][c]
    n = p["n"]
    if name in ("ret", "rev"):
        if i < n or C[i] is None or C[i - n] is None:
            return None
        v = C[i] / C[i - n] - 1
        return v if name == "ret" else -v
    if name == "resid":
        rb = G.get("R_btc")
        if rb is None:
            return None
        b = _beta_ols(R, rb, i, BETA_DAYS, 60)
        if b is None:
            return None
        e_all = [(a - b * x) for a, x in zip(R[max(0, i - BETA_DAYS + 1):i + 1], rb[max(0, i - BETA_DAYS + 1):i + 1])
                 if a is not None and x is not None]
        e_n = [(a - b * x) for a, x in zip(R[max(0, i - n + 1):i + 1], rb[max(0, i - n + 1):i + 1]) if a is not None and x is not None]
        s = _sd(e_all)
        if len(e_n) < 0.9 * n or not s:
            return None
        return sum(e_n) / (s * math.sqrt(len(e_n)))
    raise ValueError(f"unknown score {name!r}")


def port_vol(w, G, i, cov_days):
    """Annualised ex-ante volatility of {coin: weight} from the sample covariance of the last cov_days daily returns
    (pairwise-complete; a pair with fewer than MIN_COV_OBS common days counts 0), x 365."""
    coins = [c for c, x in w.items() if x]
    a = max(1, i - cov_days + 1)
    win = {c: G["R"][c][a:i + 1] for c in coins}
    tot = 0.0
    for x_i, ci in enumerate(coins):
        for cj in coins[x_i:]:
            pr = [(u, v) for u, v in zip(win[ci], win[cj]) if u is not None and v is not None]
            if len(pr) < MIN_COV_OBS:
                continue
            mu, mv = sum(u for u, _v in pr) / len(pr), sum(v for _u, v in pr) / len(pr)
            cov = sum((u - mu) * (v - mv) for u, v in pr) / (len(pr) - 1)
            tot += w[ci] * w[cj] * cov * (1 if ci == cj else 2)
    if tot <= 0:                               # a pairwise matrix that is not positive: the diagonal alone
        tot = 0.0
        for c in coins:
            v = [u for u in win[c] if u is not None]
            s = _sd(v)
            tot += (w[c] * s) ** 2 if s else 0.0
    return math.sqrt(tot * 365) if tot > 0 else None


def _sizeable(c, G, i, cov_days):
    a = max(1, i - cov_days + 1)
    return sum(1 for v in G["R"][c][a:i + 1] if v is not None) >= MIN_COV_OBS


def _scale(w, G, i, p):
    if not any(w.values()):
        return {}
    sv = port_vol(w, G, i, p["cov_days"])
    if not sv:
        return {}
    k = p["vol_target"] / sv
    w = {c: x * k for c, x in w.items()}
    gross = sum(abs(x) for x in w.values())
    if gross > p["gross_cap"]:
        w = {c: x * p["gross_cap"] / gross for c, x in w.items()}
    return w


# -------------------------------------------------------------------------------------------------- the book --
def is_rebalance(day, p):
    return (day // DAY) % p["rebalance_days"] == 0


def book_at(G, i, coins, p, eligible=None, no_long=(), no_short=()):
    """The book on grid day i (a rebalance day): ({coin: weight}, info). eligible: the coins that may be ranked (None:
    every coin); no_long / no_short: the coins the engine would refuse to open or grow on that side today. An empty
    dict means no book (flat). info: {"ranked": m, "k": k, "long": [...], "short": [...], "skipped_long": [...],
    "skipped_short": [...], "why": str}."""
    sname = p["score"]
    cand = {}
    for c in coins:
        if (eligible is not None and c not in eligible) or G["C"][c][i] is None or not _sizeable(c, G, i, p["cov_days"]):
            continue
        s = score(sname, c, i, p, G)
        if s is not None:
            cand[c] = s
    info = {"ranked": len(cand), "k": 0, "long": [], "short": [], "skipped_long": [], "skipped_short": [], "why": ""}
    if len(cand) < p["min_names"]:
        info["why"] = f"only {len(cand)} names could be ranked, fewer than {p['min_names']}: no book this week"
        return {}, info
    order = sorted(cand, key=lambda c: (-cand[c], c))
    m = len(order)
    k = int(math.floor(p["q"] * m))
    info["k"] = k
    up = [c for c in order[:m - m // 2] if c not in no_long][:k] if k >= 1 else []
    dn = [c for c in order[m // 2:] if c not in no_short and c not in up] if k >= 1 else []
    info["skipped_long"] = [c for c in order[:m - m // 2] if c in no_long]       # refused on that side today
    info["skipped_short"] = [c for c in order[m // 2:] if c in no_short]
    longs = {c: 1.0 for c in up}
    shorts = {c: 1.0 for c in dn[max(0, len(dn) - k):]}
    sl, ss = sum(longs.values()), sum(shorts.values())
    w = {}
    if longs and shorts and sl > 0 and ss > 0:
        w = {c: 0.5 * v / sl for c, v in longs.items()}
        w.update({c: -0.5 * v / ss for c, v in shorts.items()})
    else:
        info["why"] = "a leg is empty after the funding refusals: no book this week"
    w = _scale(w, G, i, p) if w else {}
    if w:
        info["long"] = sorted(c for c, x in w.items() if x > 0)
        info["short"] = sorted(c for c, x in w.items() if x < 0)
    elif not info["why"]:
        info["why"] = "no volatility reading for the book: no book this week"
    return w, info


def series(panel, prm, eligible=None, refuse=None):
    """The lab's ls_targets for the same settings: (days, {coin: [weight or None per day]}). None before the book first
    forms and between rebalances; 0 for every coin outside the book on a rebalance day. Used by the tests and the lab's
    parity checks, never by the cycle (which needs the last day only: latest())."""
    p = params(prm)
    days = grid(panel)
    G = grid_data(panel, days)
    coins = sorted(panel)
    out = {c: [None] * len(days) for c in coins}
    no_long = (refuse or {}).get("long") or {}
    no_short = (refuse or {}).get("short") or {}
    formed = False
    for i, d in enumerate(days):
        if not is_rebalance(d, p):
            continue
        ok = None if eligible is None else eligible.get(d, ())
        nl = {c for c in coins if d in no_long.get(c, ())}
        ns = {c for c in coins if d in no_short.get(c, ())}
        w, _info = book_at(G, i, coins, p, ok, nl, ns)
        if not w and not formed:
            continue
        formed = True
        for c in coins:
            out[c][i] = w.get(c, 0.0)
    return days, out


def latest(panel, prm, eligible, no_long=(), no_short=()):
    """What the cycle trades on the panel's last day: (None, info) between rebalances, else ({coin: weight}, info)."""
    p = params(prm)
    days = grid(panel)
    if not days:
        return None, {"why": "no bars"}
    d = days[-1]
    if not is_rebalance(d, p):
        return None, {"why": "between rebalances (weights drift)", "day": d}
    G = grid_data(panel, days)
    w, info = book_at(G, len(days) - 1, sorted(panel), p, set(eligible), set(no_long), set(no_short))
    info["day"] = d
    return w, info


# ---------------------------------------------------------------------------------------------- book brake --
def brake_step(book, eq, day, reading, held, p):
    """One day of the book drawdown brake (the lab's backtest.run_target, gates v7). book: the persistent state
    {"peak", "braked_until", "brakes"}; reading: True on a day the book has a reading (a rebalance day); held: the book
    holds positions. Returns (braked, event): event "brake" the day it trips, "lift" the day it lifts, else None."""
    event = None
    bu = book.get("braked_until")
    if bu is not None and day >= bu and reading:
        book["braked_until"], book["peak"] = None, eq      # lifts at the first rebalance after brake_days
        bu, event = None, "lift"
    if bu is None:
        book["peak"] = eq if book.get("peak") is None else max(book["peak"], eq)
        if held and eq < book["peak"] * (1 - p["brake_dd"]):
            book["braked_until"] = day + int(p["brake_days"]) * DAY
            book["brakes"] = int(book.get("brakes") or 0) + 1
            event = "brake"
    return book.get("braked_until") is not None, event


# ------------------------------------------------------------------------------------------- the universe --
def median(v):
    s = sorted(v)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def rank_by_volume(bars_by_coin, day, n, window=30, min_history=60):
    """[(coin, median daily notional volume)] for the top n at the close of `day`: each coin's daily notional volume
    (base volume x close) over the window days up to and including `day`, ranked by its median, highest first (ties to
    the alphabet). A coin needs at least min_history daily bars up to `day` and a bar inside the window."""
    rows = []
    lo = day - (window - 1) * DAY
    for c, bars in bars_by_coin.items():
        upto = [b for b in bars if b["t"] // DAY * DAY <= day]
        if len(upto) < min_history:
            continue
        vol = [b["v"] * b["c"] for b in upto if b["t"] // DAY * DAY >= lo]
        if not vol:
            continue
        rows.append((c, median(vol)))
    rows.sort(key=lambda x: (-x[1], x[0]))
    return rows[:n]


def eligible_today(bars_by_coin, day, top, listed, min_usd_vol):
    """{coin: why not} for the top coins that cannot be held on `day`, and the eligible list: listed on Hyperliquid
    (not delisted) and a notional volume that day of at least min_usd_vol."""
    ok, no = [], {}
    for c, _v in top:
        if c not in listed:
            no[c] = "not listed on Hyperliquid perpetuals (delisted or halted)"
            continue
        b = next((x for x in bars_by_coin.get(c, []) if x["t"] // DAY * DAY == day), None)
        nv = b["v"] * b["c"] if b else 0.0
        if nv < min_usd_vol:
            no[c] = f"volume {nv / 1e6:.1f}M that day below {min_usd_vol / 1e6:.0f}M"
            continue
        ok.append(c)
    return ok, no
