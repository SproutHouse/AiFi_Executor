"""Daily trend (time-series momentum) research for BTC + ETH, long/short, walk-forward.
Every rule variant tried is counted; the deflated Sharpe ratio (Bailey & Lopez de Prado) uses that count.
Signal at the daily close, position held the next day. Costs per unit of turnover: 0.045% taker + 0.05% slippage.
Funding: longs pay 10%/yr, shorts receive nothing (conservative; real Hyperliquid funding usually pays shorts).
Sizing: each coin targets 30% annualised volatility from 30-day realised vol, capped at 2x; the book is 50/50 BTC/ETH."""
import json, math, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src"))
from executor import indicators as I
from datetime import datetime, timezone
D = json.load(open("data/binance_1d.json"))
COST, FUND_LONG, VOL_T, CAP = 0.00045 + 0.0005, 0.10, 0.30, 2.0
def series(c):
    b = sorted(D[c], key=lambda x: x["t"]); return [x["t"] for x in b], [x["c"] for x in b], b
def sma(v, n):
    out, s = [], 0.0
    for i, x in enumerate(v):
        s += x
        if i >= n: s -= v[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out
def signals(c, rule, n, longonly):
    t, cl, bars = series(c); sig = [0] * len(cl)
    if rule == "sma":
        m = sma(cl, n); sig = [None if m[i] is None else (1 if cl[i] > m[i] else -1) for i in range(len(cl))]
    elif rule == "tsmom":
        sig = [None if i < n else (1 if cl[i] > cl[i - n] else -1) for i in range(len(cl))]
    elif rule == "donchian":
        pos = 0; sig = []
        for i in range(len(cl)):
            if i < n: sig.append(None); continue
            hi, lo = max(cl[i - n:i]), min(cl[i - n:i])
            if cl[i] > hi: pos = 1
            elif cl[i] < lo: pos = -1
            sig.append(pos)
    elif rule == "cloud":
        st, dr = I.supertrend(bars, 3.0, 10); sig = [None if d is None else (1 if d == -1 else -1) for d in dr]
    if longonly: sig = [None if s is None else max(0, s) for s in sig]
    return t, cl, sig
def returns(c, rule, n, longonly):
    t, cl, sig = signals(c, rule, n, longonly)
    r = [0.0] + [cl[i] / cl[i - 1] - 1 for i in range(1, len(cl))]
    out, prev_w = {}, 0.0
    for i in range(31, len(cl) - 1):
        if sig[i] is None: continue
        vol = math.sqrt(sum(x * x for x in r[i - 29:i + 1]) / 30 * 365)
        w = sig[i] * min(CAP, VOL_T / vol) if vol > 0 else 0.0
        day = w * r[i + 1] - abs(w - prev_w) * COST - (FUND_LONG / 365 * w if w > 0 else 0.0)
        out[t[i + 1]] = day; prev_w = w
    return out
def book(rule, n, longonly):
    a, b = returns("BTC", rule, n, longonly), returns("ETH", rule, n, longonly)
    ts = sorted(set(a) & set(b)); return [(t, 0.5 * a[t] + 0.5 * b[t]) for t in ts]
def stats(rs):
    x = [v for _, v in rs]; n = len(x)
    if n < 60: return None
    m = sum(x) / n; sd = math.sqrt(sum((v - m) ** 2 for v in x) / (n - 1)) or 1e-12
    sr = m / sd * math.sqrt(365); yrs = n / 365
    eq, peak, dd = 1.0, 1.0, 0.0
    for v in x: eq *= 1 + v; peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
    sk = sum(((v - m) / sd) ** 3 for v in x) / n; ku = sum(((v - m) / sd) ** 4 for v in x) / n
    return dict(sr=round(sr, 2), t=round(sr * math.sqrt(yrs), 2), cagr=round((eq ** (1 / yrs) - 1) * 100, 1), dd=round(dd * 100), yrs=round(yrs, 1), sk=sk, ku=ku, n=n)
def norm_cdf(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
def norm_ppf(p):
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if norm_cdf(mid) < p: lo = mid
        else: hi = mid
    return (lo + hi) / 2
def deflated(best, srs, n_obs):
    """Probability the best trial's true Sharpe exceeds the expected max of N null trials (daily units)."""
    N = len(srs); d = [s / math.sqrt(365) for s in srs]; mu = sum(d) / N; var = sum((s - mu) ** 2 for s in d) / (N - 1)
    g = 0.5772156649
    sr0 = math.sqrt(var) * ((1 - g) * norm_ppf(1 - 1 / N) + g * norm_ppf(1 - 1 / (N * math.e)))
    sr = best["sr"] / math.sqrt(365)
    z = (sr - sr0) * math.sqrt(n_obs - 1) / math.sqrt(1 - best["sk"] * sr + (best["ku"] - 1) / 4 * sr * sr)
    return norm_cdf(z)
TRIALS = [("sma", n) for n in (50, 100, 150, 200)] + [("tsmom", n) for n in (30, 60, 90, 120, 180)] + [("donchian", n) for n in (20, 40, 55, 100)] + [("cloud", 0)]
RES = {}
for rule, n in TRIALS:
    for lo in (False, True):
        RES[(rule, n, lo)] = book(rule, n, lo)
full = {k: stats(v) for k, v in RES.items()}
print(f"trials: {len(RES)}  (rules x lookbacks x long/short vs long/flat)")
print("\nFULL SAMPLE (2017-2026):")
for k, s in sorted(full.items(), key=lambda kv: -kv[1]["sr"])[:12]:
    print(f"  {k[0]:8s} n={k[1]:3d} {'long/flat ' if k[2] else 'long/short'}  SR {s['sr']:5.2f}  t {s['t']:5.2f}  CAGR {s['cagr']:6.1f}%  maxDD {s['dd']}%")
best_k = max(full, key=lambda k: full[k]["sr"])
p = deflated(full[best_k], [s["sr"] for s in full.values()], full[best_k]["n"])
print(f"\nbest in-sample: {best_k} · deflated Sharpe probability {p:.3f} (needs >= 0.95)")
# walk-forward: each calendar year from 2020, choose the best trial on all data before that year, trade it for the year
years = range(2020, 2027); wf = []; picks = []
for y in years:
    y0 = datetime(y, 1, 1, tzinfo=timezone.utc).timestamp(); y1 = datetime(y + 1, 1, 1, tzinfo=timezone.utc).timestamp()
    ins = {k: stats([(t, v) for t, v in r if t < y0]) for k, r in RES.items()}
    k = max((k for k in ins if ins[k]), key=lambda k: ins[k]["sr"]); picks.append((y, k))
    wf += [(t, v) for t, v in RES[k] if y0 <= t < y1]
s = stats(wf)
print(f"\nWALK-FORWARD out-of-sample 2020-2026 (rule re-picked each January on prior data): SR {s['sr']} · t {s['t']} · CAGR {s['cagr']}% · maxDD {s['dd']}% over {s['yrs']} yrs")
print("  picks:", ", ".join(f"{y}:{k[0]}{k[1]}{'L' if k[2] else 'LS'}" for y, k in picks))
# pre-registered simple rule (no selection): 200-day SMA, long/short, and the owner's daily Momentum Cloud
for k in (("sma", 200, False), ("sma", 200, True), ("cloud", 0, False), ("cloud", 0, True), ("tsmom", 90, False)):
    s2 = stats([(t, v) for t, v in RES[k] if t >= datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp()])
    print(f"  fixed {k}: 2020-26 SR {s2['sr']} t {s2['t']} CAGR {s2['cagr']}% maxDD {s2['dd']}%")
# by-year for the walk-forward stream and the short side's contribution
by = {}
for t, v in wf:
    y = datetime.fromtimestamp(t, tz=timezone.utc).year; by[y] = by.get(y, 1.0) * (1 + v)
print("  walk-forward by year:", " ".join(f"{y}:{(g-1)*100:+.0f}%" for y, g in sorted(by.items())))
json.dump({"trials": len(RES), "best": list(best_k), "deflated_p": p, "wf": s, "picks": [[y, list(k)] for y, k in picks],
           "full": {f"{k[0]}-{k[1]}-{'L' if k[2] else 'LS'}": v for k, v in full.items()}}, open("trend_results.json", "w"), indent=1, default=float)
