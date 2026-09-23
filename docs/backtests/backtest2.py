import sys, os, json, bisect
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.expanduser("~/aifi/scripts"))  # the desk's indicator port; os.environ.setdefault("AIFI_HOME", "/Users/marlin/aifi")
import fred_indicators as I
SCR = os.path.dirname(os.path.abspath(__file__))
cache = json.load(open(f"{SCR}/candles_cache.json"))
DAY = 86400
def monday(ts):
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return int((d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
data = {}
for base, bars in cache.items():
    if len(bars) < 250: continue
    bars = sorted(bars, key=lambda b: b["t"])
    st, dr = I.supertrend(bars); closes = [b["c"] for b in bars]
    wk = I.weekly_from_daily(bars); st_w, dir_w = I.supertrend(wk); ws = [w["t"] for w in wk]
    reg = []
    for b in bars:
        j = bisect.bisect_left(ws, monday(b["t"])) - 1
        reg.append(dir_w[j] if j >= 0 else None)
    data[base] = dict(bars=bars, st=st, dir=dr, e200=I.ema(closes, 200), e36h=I.ema([b["h"] for b in bars], 36),
                      e36l=I.ema([b["l"] for b in bars], 36), reg=reg, idx={b["t"]: i for i, b in enumerate(bars)})
dates = sorted({b["t"] for d in data.values() for b in d["bars"]})
# market breadth per date: share of symbols (with data) whose daily AND weekly momentum are bullish; BTC weekly regime
breadth = {}; btc_reg = {}
for t in dates:
    n = h = 0
    for base, d in data.items():
        k = d["idx"].get(t)
        if k is None or d["reg"][k] is None or d["dir"][k] is None: continue
        n += 1; h += 1 if (d["reg"][k] == -1 and d["dir"][k] == -1) else 0
    breadth[t] = h / n if n else None
    kb = data["BTC"]["idx"].get(t); btc_reg[t] = data["BTC"]["reg"][kb] if kb is not None else None
FEE = 0.00045; SLIP = 0.0005
def simulate(name, risk=0.01, funding_yr=0.08, Lmax=3.0, gross_cap=4.0, long_only=False, pullback=False, flips=True,
             market_gate=False, breadth_min=0.5, strict_short=False, open_risk_cap=None):
    cash = 1.0; pos = {}; pending = {}; trades = []; curve = []; peak = 1.0; maxdd = 0.0
    maxconc = 0; worst_day = 0.0; prev_eq = 1.0; streak = 0; worst_streak = 0; conc_hist = []
    for t in dates:
        for base in list(pos):
            d = data[base]; k = d["idx"].get(t)
            if k is None: continue
            p = pos[base]; b = d["bars"][k]; exit_px = None; reason = None
            if p["exit_next_open"]:
                exit_px = b["o"] * (1 - SLIP if p["side"] > 0 else 1 + SLIP); reason = p["exit_next_open"]
            elif p["side"] > 0 and b["l"] <= p["stop"]: exit_px = min(b["o"], p["stop"]) * (1 - SLIP); reason = "stop"
            elif p["side"] < 0 and b["h"] >= p["stop"]: exit_px = max(b["o"], p["stop"]) * (1 + SLIP); reason = "stop"
            if exit_px is not None:
                days = max(1, (t - p["t_in"]) / DAY)
                pnl = p["side"] * (exit_px - p["entry"]) / p["entry"] * p["notional"] - FEE * p["notional"] * 2 - funding_yr / 365 * days * p["notional"]
                cash += pnl
                trades.append(dict(base=base, side=p["side"], t_in=p["t_in"], t_out=t, pnl=pnl, R=pnl / p["risk_amt"], days=days,
                                   reason=reason, kind=p["kind"], dist=p["dist"], notional_pct=p["notional"] / p["eq_at_entry"]))
                streak = streak + 1 if pnl <= 0 else 0; worst_streak = max(worst_streak, streak)
                del pos[base]
        def mtm():
            return cash + sum(p["side"] * (data[b]["bars"][data[b]["idx"][t]]["c"] - p["entry"]) / p["entry"] * p["notional"]
                              for b, p in pos.items() if t in data[b]["idx"])
        eq_now = mtm(); gross_now = sum(p["notional"] for p in pos.values())
        open_risk = sum(p["risk_amt"] for p in pos.values())
        for base, sig in list(pending.items()):
            del pending[base]
            d = data[base]; k = d["idx"].get(t)
            if k is None or base in pos: continue
            b = d["bars"][k]; entry = b["o"] * (1 + SLIP if sig["side"] > 0 else 1 - SLIP)
            dist = sig["side"] * (entry - sig["stop"]) / entry
            if dist <= 0.002: continue
            if open_risk_cap is not None and open_risk + risk * eq_now > open_risk_cap * eq_now: continue
            notional = min(risk * eq_now / dist, Lmax * eq_now)
            if gross_now + notional > gross_cap * eq_now: continue
            pos[base] = dict(side=sig["side"], entry=entry, stop=sig["stop"], notional=notional, risk_amt=risk * eq_now, t_in=t,
                             exit_next_open=None, eq_at_entry=eq_now, kind=sig["kind"], dist=dist, was_out=False)
            gross_now += notional; open_risk += risk * eq_now
        maxconc = max(maxconc, len(pos)); conc_hist.append(len(pos))
        br = breadth[t]; bull_mkt = btc_reg[t] == -1 and br is not None and br >= breadth_min
        bear_mkt = btc_reg[t] == 1 and br is not None and br <= (1 - breadth_min)
        for base, d in data.items():
            k = d["idx"].get(t)
            if k is None or k < 1: continue
            b = d["bars"][k]; reg = d["reg"][k]; dr = d["dir"][k]; pdr = d["dir"][k - 1]; line = d["st"][k]
            if base in pos:
                p = pos[base]
                if line is not None and ((p["side"] > 0 and dr == -1) or (p["side"] < 0 and dr == 1)): p["stop"] = line
                if (p["side"] > 0 and dr == 1) or (p["side"] < 0 and dr == -1): p["exit_next_open"] = "flip"
                if reg is not None and reg != -p["side"]: p["exit_next_open"] = "regime"
                continue
            if reg is None or line is None or dr is None or pdr is None: continue
            bias = 1 if reg == -1 else -1
            if long_only and bias < 0: continue
            if market_gate and bias > 0 and not bull_mkt: continue
            if strict_short and bias < 0 and not (bear_mkt and d["e200"][k] is not None and b["c"] < d["e200"][k]): continue
            flip_long = dr == -1 and pdr == 1; flip_short = dr == 1 and pdr == -1
            pb = d["bars"][k - 1]; e36h, e36l = d["e36h"][k], d["e36l"][k]; pe36h, pe36l = d["e36h"][k - 1], d["e36l"][k - 1]
            in_band = e36h is not None and e36l <= b["c"] <= e36h
            pull_long = pullback and bias > 0 and dr == -1 and pdr == -1 and in_band and pe36h is not None and pb["c"] > pe36h   # came back into the band from above
            pull_short = pullback and bias < 0 and dr == 1 and pdr == 1 and in_band and pe36l is not None and pb["c"] < pe36l   # came back into the band from below
            if bias > 0 and ((flips and flip_long) or pull_long): pending[base] = dict(side=1, stop=line, kind="flip" if flip_long else "pullback")
            elif bias < 0 and ((flips and flip_short) or pull_short): pending[base] = dict(side=-1, stop=line, kind="flip" if flip_short else "pullback")
        eq = mtm(); worst_day = min(worst_day, eq / prev_eq - 1); prev_eq = eq
        peak = max(peak, eq); maxdd = max(maxdd, (peak - eq) / peak); curve.append((t, eq))
    return dict(name=name, trades=trades, curve=curve, maxdd=maxdd, maxconc=maxconc, worst_day=worst_day, worst_streak=worst_streak,
                avg_conc=sum(conc_hist) / len(conc_hist))
def report(r, detail=False):
    tr = r["trades"]; c = r["curve"]; yrs = (c[-1][0] - c[0][0]) / (365 * DAY)
    if not tr: print(f"=== {r['name']}: no trades"); return
    wins = [x for x in tr if x["pnl"] > 0]; losses = [x for x in tr if x["pnl"] <= 0]
    pf = sum(x["pnl"] for x in wins) / abs(sum(x["pnl"] for x in losses)) if losses else float("inf")
    totR = sum(x["R"] for x in tr); final = c[-1][1]
    print(f"=== {r['name']} ===")
    print(f"  trades {len(tr)} ({len(tr)/yrs:.0f}/yr) · win {len(wins)/len(tr):.0%} · avg R {totR/len(tr):+.2f} · total R {totR:+.0f} · PF {pf:.2f} · final x{final:.2f} · CAGR {final**(1/yrs)-1:+.1%} · maxDD {r['maxdd']:.0%} · worst day {r['worst_day']:.1%} · worst losing streak {r['worst_streak']} · concurrent avg {r['avg_conc']:.1f} max {r['maxconc']} · avg stop dist {sum(x['dist'] for x in tr)/len(tr):.1%} · avg notional {sum(x['notional_pct'] for x in tr)/len(tr):.1%} of equity · hold {sum(x['days'] for x in tr)/len(tr):.0f}d")
    for s, nm in ((1, "long"), (-1, "short")):
        st = [x for x in tr if x["side"] == s]
        if st: print(f"  {nm:5s} n={len(st):3d} win {sum(1 for x in st if x['pnl']>0)/len(st):.0%} avgR {sum(x['R'] for x in st)/len(st):+.2f} totalR {sum(x['R'] for x in st):+.0f}")
    for kd in ("flip", "pullback"):
        st = [x for x in tr if x["kind"] == kd]
        if st: print(f"  {kd:8s} n={len(st):3d} win {sum(1 for x in st if x['pnl']>0)/len(st):.0%} avgR {sum(x['R'] for x in st)/len(st):+.2f} totalR {sum(x['R'] for x in st):+.0f}")
    by_year = {}
    for t, eq in c:
        y = datetime.fromtimestamp(t, tz=timezone.utc).year; by_year.setdefault(y, [eq, eq]); by_year[y][1] = eq
    print("  by year: " + " ".join(f"{y}:{v[1]/v[0]-1:+.0%}" for y, v in sorted(by_year.items())))
    if detail:
        per = {}
        for x in tr: per.setdefault(x["base"], [0, 0.0]); per[x["base"]][0] += 1; per[x["base"]][1] += x["R"]
        srt = sorted(per.items(), key=lambda kv: -kv[1][1])
        print("  best names (R): " + ", ".join(f"{k} {v[1]:+.0f}R/{v[0]}t" for k, v in srt[:6]))
        print("  worst names (R): " + ", ".join(f"{k} {v[1]:+.0f}R/{v[0]}t" for k, v in srt[-5:]))
        Rs = sorted(x["R"] for x in tr); print(f"  R distribution: min {Rs[0]:+.1f} · p10 {Rs[len(Rs)//10]:+.1f} · median {Rs[len(Rs)//2]:+.1f} · p90 {Rs[9*len(Rs)//10]:+.1f} · max {Rs[-1]:+.1f}")
    print()
runs = [
    ("D   long-only flips (from run 1)", dict(long_only=True), False),
    ("P   flips + pullback entries, both sides", dict(pullback=True), False),
    ("PD  flips + pullback entries, long-only", dict(pullback=True, long_only=True), True),
    ("PB  pullback entries only, long-only", dict(pullback=True, flips=False, long_only=True), False),
    ("M   PD + market gate (BTC weekly bullish AND breadth >= 50%)", dict(pullback=True, long_only=True, market_gate=True), True),
    ("M4  PD + market gate at breadth >= 40%", dict(pullback=True, long_only=True, market_gate=True, breadth_min=0.4), False),
    ("S   M longs + strict shorts (BTC weekly bearish, breadth <= 50%, below 200 EMA)", dict(pullback=True, market_gate=True, strict_short=True), True),
    ("MC  M with open-risk cap 4% of equity", dict(pullback=True, long_only=True, market_gate=True, open_risk_cap=0.04), False),
    ("M2  M at 2% risk per trade", dict(pullback=True, long_only=True, market_gate=True, risk=0.02), False),
    ("M3  M at 3% risk per trade, open-risk cap 12%", dict(pullback=True, long_only=True, market_gate=True, risk=0.03, open_risk_cap=0.12), False),
]
for name, kw, det in runs: report(simulate(name, **kw), det)
bull_days = sum(1 for t in dates if btc_reg[t] == -1 and breadth[t] is not None and breadth[t] >= 0.5)
print(f"market gate open on {bull_days}/{len(dates)} days ({bull_days/len(dates):.0%})")
