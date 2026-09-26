"""Regime classifier from the Doctrine's three dials, with hysteresis, backtested on BTC daily data.
  trend   BTC close vs its 200-day SMA, with a +-2% buffer band (inside the band, the previous trend state holds)
  vol     30-day realised volatility as a percentile of the trailing 365 days
  funding BTC 7-day mean funding, annualised (Hyperliquid, from 2023-05; earlier days have no funding dial)
Labels, in priority order:  crisis (vol pct >= 90 AND close below its 50-day SMA: a falling market, not a violent rally)  ·  bear (trend down)  ·  euphoria (trend up and funding >= 20%/yr)
  ·  bull (trend up)  ·  chop (trend state undefined).  A new label must hold 5 consecutive days to take effect,
  except crisis, which takes effect at once (fast crashes are the case slow filters miss)."""
import json, math
from datetime import datetime, timezone
D = sorted(json.load(open("data/binance_1d.json"))["BTC"], key=lambda b: b["t"])
F = json.load(open("data/funding_BTC.json"))
fd = {}
for t, r, _ in F:
    d = int(t // 1000 // 86400); fd.setdefault(d, []).append(r)
fday = {d: sum(v) / len(v) * 8760 for d, v in fd.items()}
t = [b["t"] for b in D]; c = [b["c"] for b in D]
ret = [0.0] + [c[i] / c[i - 1] - 1 for i in range(1, len(c))]
BAND, VOLP, EUPH, HOLD = 0.02, 90, 0.20, 5
trend, raw, lab, cand, cnt = None, [], [], None, 0
vols = []
for i in range(len(c)):
    sma = sum(c[i - 199:i + 1]) / 200 if i >= 199 else None
    if sma:
        if c[i] > sma * (1 + BAND): trend = "up"
        elif c[i] < sma * (1 - BAND): trend = "down"
    vol = math.sqrt(sum(x * x for x in ret[max(1, i - 29):i + 1]) / 30 * 365) if i >= 30 else None
    vols.append(vol)
    hist = [v for v in vols[max(0, i - 365):i] if v is not None]
    vp = sum(1 for v in hist if v <= vol) / len(hist) * 100 if vol and len(hist) > 200 else None
    day = int(t[i] // 86400)
    f7 = [fday[d] for d in range(day - 6, day + 1) if d in fday]
    fund = sum(f7) / len(f7) if len(f7) >= 5 else None
    sma50 = sum(c[i - 49:i + 1]) / 50 if i >= 49 else None
    if vp is not None and vp >= VOLP and sma50 and c[i] < sma50: r = "crisis"
    elif trend == "down": r = "bear"
    elif trend == "up" and fund is not None and fund >= EUPH: r = "euphoria"
    elif trend == "up": r = "bull"
    else: r = "chop"
    raw.append(r)
    cur = lab[-1] if lab else r
    if r == "crisis": cur = "crisis"; cand, cnt = None, 0
    elif r != cur:
        if r == cand: cnt += 1
        else: cand, cnt = r, 1
        if cnt >= HOLD: cur = r; cand, cnt = None, 0
    else: cand, cnt = None, 0
    lab.append(cur)
# evaluation from 2018 (after the 200-day warm-up)
start = next(i for i in range(len(t)) if datetime.fromtimestamp(t[i], tz=timezone.utc).year >= 2018)
flips = sum(1 for i in range(start + 1, len(lab)) if lab[i] != lab[i - 1]); yrs = (len(lab) - start) / 365
runs, i = [], start
while i < len(lab):
    j = i
    while j + 1 < len(lab) and lab[j + 1] == lab[i]: j += 1
    runs.append((lab[i], j - i + 1)); i = j + 1
short = sum(1 for _, n in runs if n <= 7)
print(f"2018-2026: {flips} regime changes ({flips / yrs:.1f}/yr); stretches of 7 days or less: {short} of {len(runs)}")
dist = {}
for x in lab[start:]: dist[x] = dist.get(x, 0) + 1
print("time in each regime:", {k: f"{v / (len(lab) - start) * 100:.0f}%" for k, v in sorted(dist.items(), key=lambda kv: -kv[1])})
# what each bot earned by regime: BTC forward day return (long exposure) and BTC funding (carry income, 2023+)
agg = {}
for i in range(start, len(c) - 1):
    a = agg.setdefault(lab[i], {"n": 0, "btc": 0.0, "fund": [], "up": 0})
    a["n"] += 1; a["btc"] += ret[i + 1]; a["up"] += ret[i + 1] > 0
    d = int(t[i + 1] // 86400)
    if d in fday: a["fund"].append(fday[d])
print("\nregime  | days | BTC next-day return, annualised | share of up days | BTC funding (carry income, APR, 2023+)")
for k, a in sorted(agg.items(), key=lambda kv: -kv[1]["n"]):
    fa = sum(a["fund"]) / len(a["fund"]) * 100 if a["fund"] else None
    print(f"{k:8s} | {a['n']:4d} | {a['btc'] / a['n'] * 365 * 100:+7.0f}% | {a['up'] / a['n'] * 100:3.0f}% | {'n/a' if fa is None else f'{fa:+.1f}%'} ({len(a['fund'])} days)")
cur = lab[-1]
print(f"\nregime now ({datetime.fromtimestamp(t[-1], tz=timezone.utc).date()}): {cur}")
json.dump({"params": {"band": BAND, "vol_pct": VOLP, "euphoria_funding": EUPH, "hold_days": HOLD}, "flips_per_year": flips / yrs,
           "time_share": dist, "now": cur, "by_regime": {k: {"days": a["n"], "btc_ann_pct": a["btc"] / a["n"] * 36500,
           "funding_apr_pct": (sum(a["fund"]) / len(a["fund"]) * 100) if a["fund"] else None} for k, a in agg.items()}},
          open("regime_results.json", "w"), indent=1)
