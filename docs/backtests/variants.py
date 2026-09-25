import sys, os, json, bisect
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src"))
from executor import indicators as I
SCR = os.path.dirname(os.path.abspath(__file__))
D1 = json.load(open(f"{SCR}/wide_1d.json")); H4 = json.load(open(f"{SCR}/wide_4h.json")); H1 = json.load(open(f"{SCR}/wide_1h.json"))
DAY = 86400
CORE12 = "BTC ETH SOL DOGE LINK AAVE UNI NEAR SUI TAO TRX CRV".split()
WIDE = [n for n in D1 if len(D1[n]) > 400 and n in H4]
def monday(ts):
    d = datetime.fromtimestamp(ts, tz=timezone.utc); return int((d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
CTX = {}
def htf(n):
    if n in CTX: return CTX[n]
    d = sorted(D1[n], key=lambda b: b["t"]); _, dd = I.supertrend(d); wk = I.weekly_from_daily(d); _, dw = I.supertrend(wk)
    h = sorted(H4[n], key=lambda b: b["t"]); _, d4 = I.supertrend(h)
    CTX[n] = ([b["t"] for b in d], dd, [w["t"] for w in wk], dw, [b["t"] for b in h], d4); return CTX[n]
def bias(n, t, need4h):
    ds, dd, ws, dw, hs, d4 = htf(n)
    jw = bisect.bisect_left(ws, monday(t)) - 1; jd = bisect.bisect_left(ds, t - t % DAY) - 1
    ok = jw >= 0 and dw[jw] == -1 and jd >= 0 and dd[jd] == -1
    if ok and need4h:
        j4 = bisect.bisect_left(hs, t - t % 14400) - 1; ok = j4 >= 0 and d4[j4] == -1
    return ok
def btc_ok(t):
    ds, dd, ws, dw, *_ = htf("BTC"); jw = bisect.bisect_left(ws, monday(t)) - 1; return jw >= 0 and dw[jw] == -1
FEE, SLIP, FUND = 0.00045, 0.0005, 0.11
def run(names, tf="4h", btc_gate=True, pullback=False, start=None, risk=0.01, cap=0.04, maxpos=6):
    src = H4 if tf == "4h" else H1; secs = 14400 if tf == "4h" else 3600
    S = {}
    for n in names:
        if n not in src: continue
        bars = [b for b in sorted(src[n], key=lambda b: b["t"]) if not start or b["t"] >= start]
        if len(bars) < 300: continue
        st, dr = I.supertrend(bars); up = I.ema([b["h"] for b in bars], 36); lo = I.ema([b["l"] for b in bars], 36)
        S[n] = dict(b=bars, st=st, dr=dr, up=up, lo=lo, idx={b["t"]: i for i, b in enumerate(bars)})
    times = sorted({t for s in S.values() for t in s["idx"]})
    cash, pos, pend, tr, peak, dd, curve = 1.0, {}, {}, [], 1.0, 0.0, []
    for t in times:
        for n in list(pos):
            s = S[n]; k = s["idx"].get(t)
            if k is None: continue
            p = pos[n]; b = s["b"][k]; px = None
            if p["x"]: px = b["o"] * (1 - SLIP)
            elif b["l"] <= p["stop"]: px = min(b["o"], p["stop"]) * (1 - SLIP)
            if px is not None:
                hrs = max(secs / 3600, (t - p["t"]) / 3600)
                pnl = (px - p["e"]) / p["e"] * p["n"] - FEE * 2 * p["n"] - FUND / 8760 * hrs * p["n"]
                cash += pnl; tr.append(dict(n=n, R=pnl / p["r"], pnl=pnl, h=hrs, kind=p["k"])); del pos[n]
        eq = cash + sum((S[n]["b"][S[n]["idx"][t]]["c"] - p["e"]) / p["e"] * p["n"] for n, p in pos.items() if t in S[n]["idx"])
        orisk = sum(p["r"] for p in pos.values())
        for n, sg in list(pend.items()):
            del pend[n]; s = S[n]; k = s["idx"].get(t)
            if k is None or n in pos or len(pos) >= maxpos: continue
            e = s["b"][k]["o"] * (1 + SLIP); dist = (e - sg["stop"]) / e
            if dist <= 0.002 or orisk + risk * eq > cap * eq + 1e-12: continue
            notional = min(risk * eq / dist, 3 * eq); ra = notional * dist
            pos[n] = dict(e=e, stop=sg["stop"], n=notional, r=ra, t=t, x=False, k=sg["k"]); orisk += ra
        for n, s in S.items():
            k = s["idx"].get(t)
            if k is None or k < 1: continue
            b, pb = s["b"][k], s["b"][k - 1]; d, pd, line = s["dr"][k], s["dr"][k - 1], s["st"][k]
            ok = bias(n, t + secs, tf == "1h")
            if n in pos:
                p = pos[n]
                if line and d == -1 and line > p["stop"]: p["stop"] = line
                if d == 1 or not ok: p["x"] = True
                continue
            if not ok or line is None or pd is None or b["c"] <= line: continue
            flip = d == -1 and pd == 1
            inb = s["up"][k] and s["lo"][k] <= b["c"] <= s["up"][k]
            pull = pullback and d == -1 and pd == -1 and inb and s["up"][k - 1] and pb["c"] > s["up"][k - 1]
            if flip and (not btc_gate or btc_ok(t + secs)): pend[n] = dict(stop=line, k="flip")
            elif pull: pend[n] = dict(stop=line, k="pull")
        eq = cash + sum((S[n]["b"][S[n]["idx"][t]]["c"] - p["e"]) / p["e"] * p["n"] for n, p in pos.items() if t in S[n]["idx"])
        peak = max(peak, eq); dd = max(dd, (peak - eq) / peak); curve.append((t, eq))
    yrs = (curve[-1][0] - curve[0][0]) / (365 * DAY)
    w = [x for x in tr if x["pnl"] > 0]; l = [x for x in tr if x["pnl"] <= 0]
    pf = sum(x["pnl"] for x in w) / abs(sum(x["pnl"] for x in l)) if l else 0
    last = [x for x in tr]  # all
    by = {}
    for t0, e in curve:
        y = datetime.fromtimestamp(t0, tz=timezone.utc).year; by.setdefault(y, [e, e]); by[y][1] = e
    return dict(names=len(S), trades=len(tr), per_week=round(len(tr) / yrs / 52, 2), win=round(len(w) / max(1, len(tr)) * 100),
                avgR=round(sum(x["R"] for x in tr) / max(1, len(tr)), 2), pf=round(pf, 2), cagr=round((curve[-1][1] ** (1 / yrs) - 1) * 100, 1),
                dd=round(dd * 100), hold_h=round(sum(x["h"] for x in tr) / max(1, len(tr))), years={y: round((v[1] / v[0] - 1) * 100) for y, v in sorted(by.items())})
S23 = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp())
VARIANTS = [
    ("A core: 12 names, 4h flips, BTC gate", dict(names=CORE12)),
    ("B wide: 30 names, 4h flips, BTC gate", dict(names=WIDE)),
    ("C wide, 4h flips, no BTC gate", dict(names=WIDE, btc_gate=False)),
    ("D wide, 4h flips + pullbacks, no BTC gate", dict(names=WIDE, btc_gate=False, pullback=True)),
    ("E wide, 1h flips inside 4h+D+W, BTC gate (2023+)", dict(names=WIDE, tf="1h", start=S23)),
    ("F wide, 1h flips inside 4h+D+W, no BTC gate (2023+)", dict(names=WIDE, tf="1h", btc_gate=False, start=S23)),
    ("A' core 12, 4h flips, BTC gate (2023+)", dict(names=CORE12, start=S23)),
    ("B' wide 4h flips, BTC gate (2023+)", dict(names=WIDE, start=S23)),
    ("C' wide 4h flips, no BTC gate (2023+)", dict(names=WIDE, btc_gate=False, start=S23)),
]
print("wide universe:", len(WIDE), " ".join(WIDE))
for name, kw in VARIANTS:
    kw = dict(kw); names = kw.pop("names")
    r = run(names, **kw); print(f"{name:52s} {json.dumps(r)}", flush=True)
