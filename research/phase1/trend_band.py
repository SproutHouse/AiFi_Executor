"""Phase 2 check for the frozen trend rule (close > SMA50 → long, else flat; 30% vol target, cap 2x; BTC+ETH 50/50):
(1) a no-trade band: only trade when the current weight is off target by more than B of the target;
(2) a resident protective stop 15% below each entry price, checked against the daily low."""
import json, math
from datetime import datetime, timezone
D = json.load(open("data/binance_1d.json"))
COST, FUND_LONG, VOL_T, CAP, N = 0.00045 + 0.0005, 0.10, 0.30, 2.0, 50
def coin(c, band, stop):
    b = sorted(D[c], key=lambda x: x["t"]); cl = [x["c"] for x in b]; lo = [x["l"] for x in b]; t = [x["t"] for x in b]
    r = [0.0] + [cl[i] / cl[i - 1] - 1 for i in range(1, len(cl))]
    out, w, entry, fired, trades = {}, 0.0, None, 0, 0
    for i in range(max(N, 31), len(cl) - 1):
        sma = sum(cl[i - N + 1:i + 1]) / N
        vol = math.sqrt(sum(x * x for x in r[i - 29:i + 1]) / 30 * 365)
        target = min(CAP, VOL_T / vol) if cl[i] > sma and vol > 0 else 0.0
        new = w
        if target == 0.0 or w == 0.0 or abs(w - target) > band * target:
            new = target
        cost = abs(new - w) * COST
        if new != w: trades += 1
        if w == 0.0 and new > 0: entry = cl[i]
        if new == 0.0: entry = None
        w = new
        day = w * r[i + 1] - cost - (FUND_LONG / 365 * w)
        if stop and w > 0 and entry and lo[i + 1] <= entry * (1 - stop):
            px = entry * (1 - stop); day = w * (px / cl[i] - 1) - cost - (FUND_LONG / 365 * w) - w * COST
            fired += 1; w = 0.0; entry = None
        out[t[i + 1]] = day
    return out, fired, trades
def run(band, stop):
    a, fa, ta = coin("BTC", band, stop); b, fb, tb = coin("ETH", band, stop)
    ts = sorted(set(a) & set(b)); x = [0.5 * a[t] + 0.5 * b[t] for t in ts]
    m = sum(x) / len(x); sd = math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1)); yrs = len(x) / 365
    eq, pk, dd = 1.0, 1.0, 0.0
    for v in x: eq *= 1 + v; pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
    return dict(sr=round(m / sd * math.sqrt(365), 2), cagr=round((eq ** (1 / yrs) - 1) * 100, 1), dd=round(dd * 100), trades_per_yr=round((ta + tb) / yrs), stop_fired=fa + fb)
for band in (0.0, 0.10, 0.25, 0.50):
    for stop in (None, 0.15):
        print(f"band {int(band*100):2d}%  stop {'15%' if stop else 'none'}: {run(band, stop)}")
