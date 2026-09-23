import sys, os, json, math, bisect, time
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.expanduser("~/aifi/scripts"))  # the desk's indicator port
os.environ.setdefault("AIFI_HOME", "/Users/marlin/aifi")
import fred_indicators as I
SCR = os.path.dirname(os.path.abspath(__file__))
syms = json.load(open(f"{SCR}/hl_symbols.json"))
cache_path = f"{SCR}/candles_cache.json"
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
t0 = time.time()
for base, tv in syms.items():
    if base in cache: continue
    try:
        bars = I.candles(tv, "1D", limit=4000)
        cache[base] = bars
        print(f"  {base:8s} {len(bars):5d} daily bars from {datetime.fromtimestamp(bars[0]['t'], tz=timezone.utc).date()} via {I.SOURCES.get((tv,'1D'))}", flush=True)
    except Exception as e:
        print(f"  {base:8s} FAIL {str(e)[:90]}", flush=True)
json.dump(cache, open(cache_path, "w"))
print(f"fetch done in {time.time()-t0:.0f}s; {len(cache)} symbols cached\n", flush=True)

DAY = 86400
def monday(ts):
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    m = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(m.timestamp())

# ---------------- precompute per symbol ----------------
MIN_BARS = 250
data = {}
for base, bars in cache.items():
    if len(bars) < MIN_BARS: 
        print(f"skip {base}: only {len(bars)} bars"); continue
    bars = sorted(bars, key=lambda b: b["t"])
    st_d, dir_d = I.supertrend(bars)
    closes = [b["c"] for b in bars]
    e200 = I.ema(closes, 200)
    e36h = I.ema([b["h"] for b in bars], 36); e36l = I.ema([b["l"] for b in bars], 36)
    wk = I.weekly_from_daily(bars)
    st_w, dir_w = I.supertrend(wk)
    wstarts = [w["t"] for w in wk]
    # regime for a daily bar = direction of the last COMPLETED week (start < this bar's monday)
    reg = []
    for b in bars:
        m = monday(b["t"])
        j = bisect.bisect_left(wstarts, m) - 1   # last week starting before this monday
        reg.append(dir_w[j] if j >= 0 else None)
    data[base] = dict(bars=bars, st=st_d, dir=dir_d, e200=e200, e36h=e36h, e36l=e36l, reg=reg,
                      idx={b["t"]: i for i, b in enumerate(bars)})
print(f"{len(data)} symbols simulated\n")

# ---------------- simulation ----------------
FEE = 0.00045; SLIP = 0.0005
def simulate(variant, Lmax=3.0, funding_yr=0.08, risk=0.01, gross_cap=4.0, long_only=False, weekly_only=False,
             ema_filter=False, noodle_filter=False, start_year=None):
    dates = sorted({b["t"] for d in data.values() for b in d["bars"]})
    if start_year: dates = [t for t in dates if datetime.fromtimestamp(t, tz=timezone.utc).year >= start_year]
    cash = 1.0; pos = {}; pending = {}; trades = []; curve = []; peak = 1.0; maxdd = 0.0
    gross_hist = []
    for t in dates:
        # 1. exits on today's bar
        for base in list(pos):
            d = data[base]; k = d["idx"].get(t)
            if k is None: continue
            p = pos[base]; b = d["bars"][k]
            exit_px = None; reason = None
            if p["exit_next_open"]:
                exit_px = b["o"] * (1 - SLIP if p["side"] > 0 else 1 + SLIP); reason = p["exit_next_open"]
            else:
                stop = p["stop"]
                if p["side"] > 0 and b["l"] <= stop:
                    exit_px = min(b["o"], stop) * (1 - SLIP); reason = "stop"
                elif p["side"] < 0 and b["h"] >= stop:
                    exit_px = max(b["o"], stop) * (1 + SLIP); reason = "stop"
            if exit_px is not None:
                days = max(1, (t - p["t_in"]) / DAY)
                gross = p["side"] * (exit_px - p["entry"]) / p["entry"] * p["notional"]
                cost = FEE * p["notional"] * 2 + funding_yr / 365 * days * p["notional"]
                pnl = gross - cost
                cash += pnl
                trades.append(dict(base=base, side=p["side"], t_in=p["t_in"], t_out=t, entry=p["entry"], exit=exit_px,
                                   notional=p["notional"], risk_amt=p["risk_amt"], pnl=pnl, R=pnl / p["risk_amt"],
                                   days=days, reason=reason, lev=p["notional"] / p["eq_at_entry"]))
                del pos[base]
        # 2. entries pending from yesterday's close
        eq_now = cash + sum(p["side"] * (data[b]["bars"][data[b]["idx"][t]]["c"] - p["entry"]) / p["entry"] * p["notional"]
                            for b, p in pos.items() if t in data[b]["idx"])
        gross_now = sum(p["notional"] for p in pos.values())
        for base, sig in list(pending.items()):
            del pending[base]
            d = data[base]; k = d["idx"].get(t)
            if k is None or base in pos: continue
            b = d["bars"][k]
            entry = b["o"] * (1 + SLIP if sig["side"] > 0 else 1 - SLIP)
            stop = sig["stop"]
            dist = sig["side"] * (entry - stop) / entry
            if dist <= 0.002: continue            # stop on the wrong side or too tight after the gap
            notional = min(risk * eq_now / dist, Lmax * eq_now)
            if gross_now + notional > gross_cap * eq_now: continue
            cash -= 0  # fees charged at exit (both sides) for simplicity
            pos[base] = dict(side=sig["side"], entry=entry, stop=stop, notional=notional, risk_amt=risk * eq_now,
                             t_in=t, exit_next_open=None, eq_at_entry=eq_now)
            gross_now += notional
        # 3. signals at today's close, and trailing-stop / flip / regime updates
        for base, d in data.items():
            k = d["idx"].get(t)
            if k is None or k < 1: continue
            b = d["bars"][k]; reg = d["reg"][k]; dr = d["dir"][k]; pdr = d["dir"][k - 1]; line = d["st"][k]
            if base in pos:
                p = pos[base]
                if weekly_only:
                    p["stop"] = d["st"][k] if False else p["stop"]  # weekly-only: no daily trailing; exit on regime flip
                    if reg is not None and reg != -p["side"]: p["exit_next_open"] = "regime"
                else:
                    if line is not None and ((p["side"] > 0 and dr == -1) or (p["side"] < 0 and dr == 1)):
                        p["stop"] = line                                # trail to today's Momentum line
                    if (p["side"] > 0 and dr == 1) or (p["side"] < 0 and dr == -1): p["exit_next_open"] = "flip"
                    if reg is not None and reg != -p["side"]: p["exit_next_open"] = "regime"
                continue
            if reg is None or line is None or dr is None or pdr is None: continue
            bias = 1 if reg == -1 else -1                              # weekly bullish -> long bias
            if long_only and bias < 0: continue
            if weekly_only:
                # enter on the first day the regime is known and price is on the bias side, stop = weekly-ish: use daily line
                if b["c"] > line and bias > 0 and dr == -1 and pdr is not None:
                    if k >= 1 and d["reg"][k-1] != reg: pending[base] = dict(side=1, stop=line)
                elif b["c"] < line and bias < 0 and dr == 1:
                    if k >= 1 and d["reg"][k-1] != reg: pending[base] = dict(side=-1, stop=line)
                continue
            flip_long = dr == -1 and pdr == 1; flip_short = dr == 1 and pdr == -1
            if bias > 0 and flip_long:
                if ema_filter and (d["e200"][k] is None or b["c"] <= d["e200"][k]): continue
                if noodle_filter and (d["e36h"][k] is None or b["c"] > d["e36h"][k]): continue   # not when Overextended
                pending[base] = dict(side=1, stop=line)
            elif bias < 0 and flip_short:
                if ema_filter and (d["e200"][k] is None or b["c"] >= d["e200"][k]): continue
                if noodle_filter and (d["e36l"][k] is None or b["c"] < d["e36l"][k]): continue   # not when Suppressed
                pending[base] = dict(side=-1, stop=line)
        # 4. mark to market
        eq = cash + sum(p["side"] * (data[b]["bars"][data[b]["idx"][t]]["c"] - p["entry"]) / p["entry"] * p["notional"]
                        for b, p in pos.items() if t in data[b]["idx"])
        gross_hist.append(sum(p["notional"] for p in pos.values()) / eq if eq > 0 else 0)
        peak = max(peak, eq); maxdd = max(maxdd, (peak - eq) / peak)
        curve.append((t, eq))
    return dict(variant=variant, trades=trades, curve=curve, maxdd=maxdd, gross=gross_hist)

def stats(res):
    tr = res["trades"]; c = res["curve"]
    if not tr: return {"variant": res["variant"], "trades": 0}
    years = (c[-1][0] - c[0][0]) / (365 * DAY)
    final = c[-1][1]; cagr = final ** (1 / years) - 1 if years > 0 and final > 0 else float("nan")
    wins = [x for x in tr if x["pnl"] > 0]; losses = [x for x in tr if x["pnl"] <= 0]
    pf = sum(x["pnl"] for x in wins) / abs(sum(x["pnl"] for x in losses)) if losses else float("inf")
    Rs = [x["R"] for x in tr]
    by_side = {}
    for s, name in ((1, "long"), (-1, "short")):
        st = [x for x in tr if x["side"] == s]
        if st:
            by_side[name] = dict(n=len(st), win=sum(1 for x in st if x["pnl"] > 0) / len(st), avgR=sum(x["R"] for x in st) / len(st),
                                 pnl=sum(x["pnl"] for x in st))
    by_year = {}
    for t, eq in c:
        y = datetime.fromtimestamp(t, tz=timezone.utc).year
        by_year.setdefault(y, [eq, eq]); by_year[y][1] = eq
    yr = {y: v[1] / v[0] - 1 for y, v in by_year.items()}
    return dict(variant=res["variant"], trades=len(tr), years=round(years, 1), win=round(len(wins) / len(tr), 3),
                avgR=round(sum(Rs) / len(Rs), 3), pf=round(pf, 2), final=round(final, 2), cagr=round(cagr, 3),
                maxdd=round(res["maxdd"], 3), avg_days=round(sum(x["days"] for x in tr) / len(tr), 1),
                trades_per_year=round(len(tr) / years, 1), avg_gross=round(sum(res["gross"]) / len(res["gross"]), 2),
                max_gross=round(max(res["gross"]), 2), avg_lev_per_trade=round(sum(x["lev"] for x in tr) / len(tr), 2),
                by_side=by_side, by_year={y: round(v, 3) for y, v in sorted(yr.items())},
                exits={r: sum(1 for x in tr if x["reason"] == r) for r in ("stop", "flip", "regime")})

VARIANTS = [
    ("A  flip entries, long in bull / short in bear", dict()),
    ("B  A + 200-day EMA agreement filter", dict(ema_filter=True)),
    ("C  A + Noodle location filter (no chasing)", dict(noodle_filter=True)),
    ("D  A, long-only (no shorts in bear)", dict(long_only=True)),
    ("E  weekly regime only (always in, exit on weekly flip)", dict(weekly_only=True)),
    ("F  A with zero funding cost", dict(funding_yr=0.0)),
    ("G  A, 2021 onward only", dict(start_year=2021)),
    ("H  B + C combined", dict(ema_filter=True, noodle_filter=True)),
]
out = []
for name, kw in VARIANTS:
    r = simulate(name, **kw); s = stats(r); out.append(s)
    print(f"=== {name} ===")
    print(json.dumps({k: v for k, v in s.items() if k not in ('by_year','by_side','exits','variant')}))
    print("  by side:", json.dumps(s.get("by_side", {})))
    print("  exits:", s.get("exits")); print("  by year:", s.get("by_year")); print()
# baseline: BTC buy and hold over the same span as variant A's curve
btc = data["BTC"]["bars"]; ta = simulate("tmp")["curve"]; t_start = ta[0][0]
b0 = next(b for b in btc if b["t"] >= t_start); b1 = btc[-1]
yrs = (b1["t"] - b0["t"]) / (365 * DAY)
print(f"BTC buy-and-hold from {datetime.fromtimestamp(b0['t'], tz=timezone.utc).date()}: x{b1['c']/b0['c']:.1f}, CAGR {((b1['c']/b0['c'])**(1/yrs)-1):.1%}")
pk = 0; dd = 0
for b in btc:
    if b["t"] < b0["t"]: continue
    pk = max(pk, b["c"]); dd = max(dd, (pk - b["c"]) / pk)
print(f"BTC max drawdown over that span: {dd:.0%}")
json.dump(out, open(f"{SCR}/backtest_results.json", "w"), indent=1)
