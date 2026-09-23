import sys, os, json, bisect, time, urllib.request
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.expanduser("~/aifi/scripts"))  # the desk's indicator port; os.environ.setdefault("AIFI_HOME", "/Users/marlin/aifi")
import fred_indicators as I
SCR = os.path.dirname(os.path.abspath(__file__))
daily_cache = json.load(open(f"{SCR}/candles_cache.json"))
NAMES = ["BTC", "ETH", "SOL", "DOGE", "LINK", "AAVE", "UNI", "NEAR", "SUI", "TAO", "TRX", "CRV"]
START = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp())
H4 = 4 * 3600; DAY = 86400
p4 = f"{SCR}/candles_4h.json"
c4 = json.load(open(p4)) if os.path.exists(p4) else {}
def fetch_4h(sym):
    out = []; end = int(time.time() * 1000)
    for _ in range(40):
        url = f"https://data-api.binance.vision/api/v3/klines?symbol={sym}USDT&interval=4h&limit=1000&endTime={end}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        rows = json.load(urllib.request.urlopen(req, timeout=30))
        if not rows: break
        out = [dict(t=r[0] // 1000, o=float(r[1]), h=float(r[2]), l=float(r[3]), c=float(r[4]), v=float(r[5])) for r in rows] + out
        end = rows[0][0] - 1
        if rows[0][0] // 1000 <= START or len(rows) < 1000: break
    return [b for b in out if b["t"] >= START]
t0 = time.time()
for n in NAMES:
    if n in c4: continue
    try: c4[n] = fetch_4h(n); print(f"  {n:5s} {len(c4[n]):6d} 4h bars from {datetime.fromtimestamp(c4[n][0]['t'], tz=timezone.utc).date()}", flush=True)
    except Exception as e: print("  FAIL", n, str(e)[:80])
json.dump(c4, open(p4, "w")); print(f"4h fetch {time.time()-t0:.0f}s\n")
def monday(ts):
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return int((d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
def htf_context(base):
    """daily + weekly Momentum direction arrays keyed by completed-bar start time."""
    daily = sorted(daily_cache[base], key=lambda b: b["t"])
    st_d, dir_d = I.supertrend(daily)
    wk = I.weekly_from_daily(daily); st_w, dir_w = I.supertrend(wk)
    return daily, dir_d, [w["t"] for w in wk], dir_w
def build(base, bars, tf):
    daily, dir_d, ws, dir_w = htf_context(base)
    dstarts = [b["t"] for b in daily]
    st, dr = I.supertrend(bars)
    e36h = I.ema([b["h"] for b in bars], 36); e36l = I.ema([b["l"] for b in bars], 36)
    bias = []
    for b in bars:
        jw = bisect.bisect_left(ws, monday(b["t"])) - 1
        w_ok = jw >= 0 and dir_w[jw] == -1
        if tf == "4h":
            day0 = b["t"] - (b["t"] % DAY)                       # this bar's UTC day
            jd = bisect.bisect_left(dstarts, day0) - 1             # last COMPLETED day
            d_ok = jd >= 0 and dir_d[jd] == -1
            bias.append(1 if (w_ok and d_ok) else 0)
        else:
            bias.append(1 if w_ok else 0)
    return dict(bars=bars, st=st, dir=dr, e36h=e36h, e36l=e36l, bias=bias, idx={b["t"]: i for i, b in enumerate(bars)})
FEE = 0.00045; SLIP = 0.0005
def simulate(series, bar_secs, risk=0.01, funding_yr=0.08, pullback=True, flips=True, open_risk_cap=None):
    dates = sorted({t for s in series.values() for t in s["idx"]}); cash = 1.0; pos = {}; pending = {}; trades = []
    peak = 1.0; maxdd = 0.0; curve = []
    for t in dates:
        for base in list(pos):
            s = series[base]; k = s["idx"].get(t)
            if k is None: continue
            p = pos[base]; b = s["bars"][k]; px = None; reason = None
            if p["exit_next"]: px = b["o"] * (1 - SLIP); reason = p["exit_next"]
            elif b["l"] <= p["stop"]: px = min(b["o"], p["stop"]) * (1 - SLIP); reason = "stop"
            if px is not None:
                hours = max(bar_secs / 3600, (t - p["t_in"]) / 3600)
                pnl = (px - p["entry"]) / p["entry"] * p["notional"] - FEE * p["notional"] * 2 - funding_yr / (365 * 24) * hours * p["notional"]
                cash += pnl; trades.append(dict(base=base, pnl=pnl, R=pnl / p["risk_amt"], hours=hours, kind=p["kind"], reason=reason,
                                                cost=(FEE * 2 + SLIP * 2 + funding_yr / (365 * 24) * hours) * p["notional"] / p["risk_amt"]))
                del pos[base]
        eq = cash + sum((series[b]["bars"][series[b]["idx"][t]]["c"] - p["entry"]) / p["entry"] * p["notional"] for b, p in pos.items() if t in series[b]["idx"])
        open_risk = sum(p["risk_amt"] for p in pos.values())
        for base, sig in list(pending.items()):
            del pending[base]; s = series[base]; k = s["idx"].get(t)
            if k is None or base in pos: continue
            entry = s["bars"][k]["o"] * (1 + SLIP); dist = (entry - sig["stop"]) / entry
            if dist <= 0.002: continue
            if open_risk_cap is not None and open_risk + risk * eq > open_risk_cap * eq: continue
            pos[base] = dict(entry=entry, stop=sig["stop"], notional=risk * eq / dist, risk_amt=risk * eq, t_in=t, exit_next=None, kind=sig["kind"])
            open_risk += risk * eq
        for base, s in series.items():
            k = s["idx"].get(t)
            if k is None or k < 1: continue
            b, pb = s["bars"][k], s["bars"][k - 1]; dr, pdr, line = s["dir"][k], s["dir"][k - 1], s["st"][k]
            if base in pos:
                p = pos[base]
                if line is not None and dr == -1: p["stop"] = line
                if dr == 1: p["exit_next"] = "flip"
                if s["bias"][k] == 0: p["exit_next"] = "regime"
                continue
            if s["bias"][k] != 1 or line is None or dr is None or pdr is None: continue
            flip = dr == -1 and pdr == 1
            e36h, e36l, pe36h = s["e36h"][k], s["e36l"][k], s["e36h"][k - 1]
            pull = dr == -1 and pdr == -1 and e36h is not None and e36l <= b["c"] <= e36h and pe36h is not None and pb["c"] > pe36h
            if (flips and flip) or (pullback and pull): pending[base] = dict(stop=line, kind="flip" if flip else "pullback")
        eq = cash + sum((series[b]["bars"][series[b]["idx"][t]]["c"] - p["entry"]) / p["entry"] * p["notional"] for b, p in pos.items() if t in series[b]["idx"])
        peak = max(peak, eq); maxdd = max(maxdd, (peak - eq) / peak); curve.append((t, eq))
    return trades, curve, maxdd
def report(name, trades, curve, maxdd):
    yrs = (curve[-1][0] - curve[0][0]) / (365 * DAY); tr = trades
    if not tr: print(name, "no trades"); return
    wins = [x for x in tr if x["pnl"] > 0]; losses = [x for x in tr if x["pnl"] <= 0]
    pf = sum(x["pnl"] for x in wins) / abs(sum(x["pnl"] for x in losses)) if losses else float("inf")
    totR = sum(x["R"] for x in tr); final = curve[-1][1]
    print(f"=== {name} ===")
    print(f"  trades {len(tr)} ({len(tr)/yrs:.0f}/yr) · win {len(wins)/len(tr):.0%} · avg R {totR/len(tr):+.2f} · total R {totR:+.0f} · PF {pf:.2f} · final x{final:.2f} · CAGR {final**(1/yrs)-1:+.1%} · maxDD {maxdd:.0%} · avg hold {sum(x['hours'] for x in tr)/len(tr)/24:.1f}d · costs per trade {sum(x['cost'] for x in tr)/len(tr):.2f}R ({sum(x['cost'] for x in tr):.0f}R total)")
    for kd in ("flip", "pullback"):
        st = [x for x in tr if x["kind"] == kd]
        if st: print(f"  {kd:8s} n={len(st):4d} win {sum(1 for x in st if x['pnl']>0)/len(st):.0%} avgR {sum(x['R'] for x in st)/len(st):+.2f} totalR {sum(x['R'] for x in st):+.0f}")
    by = {}
    for t, eq in curve:
        y = datetime.fromtimestamp(t, tz=timezone.utc).year; by.setdefault(y, [eq, eq]); by[y][1] = eq
    print("  by year: " + " ".join(f"{y}:{v[1]/v[0]-1:+.0%}" for y, v in sorted(by.items()))); print()
names = [n for n in NAMES if n in c4 and len(c4[n]) > 500]
s4 = {n: build(n, c4[n], "4h") for n in names}
sd = {n: build(n, [b for b in sorted(daily_cache[n], key=lambda b: b["t"]) if b["t"] >= START], "1d") for n in names}
# keep the daily EMA warm-up honest: daily series built from START only, so drop first 60 bars of signals via bias=0
for n in names:
    for i in range(min(60, len(sd[n]["bias"]))): sd[n]["bias"][i] = 0
    for i in range(min(60 * 6, len(s4[n]["bias"]))): s4[n]["bias"][i] = 0
print(f"{len(names)} names, 2020-01 onward\n")
t4, c4v, d4 = simulate(s4, H4); report("4-hour bars: flips + pullbacks, long-only, inside daily+weekly bullish", t4, c4v, d4)
t4f, c4f, d4f = simulate(s4, H4, pullback=False); report("4-hour bars: flips only", t4f, c4f, d4f)
t4c, c4c, d4c = simulate(s4, H4, open_risk_cap=0.04); report("4-hour bars: flips + pullbacks, open-risk cap 4%", t4c, c4c, d4c)
td, cd, dd = simulate(sd, DAY); report("Daily bars, same 12 names, same period: flips + pullbacks, long-only, inside weekly bullish", td, cd, dd)
tdc, cdc, ddc = simulate(sd, DAY, open_risk_cap=0.04); report("Daily bars: open-risk cap 4%", tdc, cdc, ddc)
# ---- regime whipsaw stats: weekly Momentum Cloud on BTC and ETH
for base in ("BTC", "ETH"):
    daily = sorted(daily_cache[base], key=lambda b: b["t"]); wk = I.weekly_from_daily(daily); st_w, dir_w = I.supertrend(wk)
    segs = []; cur = None; n = 0
    for i, d in enumerate(dir_w):
        if d is None: continue
        if cur is None or d != cur:
            if cur is not None: segs.append((cur, n))
            cur, n = d, 1
        else: n += 1
    segs.append((cur, n))
    bull = [n for d, n in segs if d == -1]; bear = [n for d, n in segs if d == 1]
    short = sum(1 for d, n in segs[:-1] if n <= 4)
    print(f"{base} weekly Momentum Cloud since {datetime.fromtimestamp(wk[0]['t'], tz=timezone.utc).date()}: {len(segs)-1} flips · bullish stretches {len(bull)} (median {sorted(bull)[len(bull)//2]}w, longest {max(bull)}w) · bearish stretches {len(bear)} (median {sorted(bear)[len(bear)//2]}w, longest {max(bear)}w) · stretches lasting ≤4 weeks: {short} of {len(segs)-1} ({short/(len(segs)-1):.0%}) · share of weeks bullish {sum(bull)/(sum(bull)+sum(bear)):.0%}")
    # forward 4-week return after each weekly flip, by direction
    fw = {-1: [], 1: []}
    for i in range(1, len(dir_w) - 4):
        if dir_w[i] is not None and dir_w[i - 1] is not None and dir_w[i] != dir_w[i - 1]:
            fw[dir_w[i]].append(wk[i + 4]["c"] / wk[i]["c"] - 1)
    for d, nm in ((-1, "flip to bullish"), (1, "flip to bearish")):
        v = fw[d]; 
        if v: print(f"   {nm}: n={len(v)} · next-4-week return median {sorted(v)[len(v)//2]:+.1%} · mean {sum(v)/len(v):+.1%} · share positive {sum(1 for x in v if x>0)/len(v):.0%}")
