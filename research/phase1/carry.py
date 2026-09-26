"""Delta-neutral funding carry projection from Hyperliquid's full hourly funding history.
Position: short perp N + long spot N. Income per hour = funding_rate x N (negative when shorts pay).
Capital per unit N = N (spot) + N/2 (perp margin at 2x) = 1.5N, so APR on capital = income / 1.5N.
Costs per round trip (enter + exit, both legs): maker 0.015%x2 + 0.04%x2 = 0.11%; taker 0.045%x2 + 0.07%x2 = 0.23%.
Rule family: in the market while the trailing L-hour mean funding (annualised) >= ENTER; out when it falls below EXIT.
Parameters are chosen on 2023-2024 and judged on 2025-2026 only."""
import json, os, math, sys
from datetime import datetime, timezone
H = 24 * 365
CAND = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "ENA", "PUMP", "XPL"]
REF = ["XRP", "NEAR", "SUI", "UNI", "TAO", "LINK", "LTC", "AAVE", "DOGE", "ONDO", "WLD", "ARB"]
CAP_PER_N, COST = 1.5, {"maker": 0.0011, "taker": 0.0023}
SPLIT = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
def load(c):
    f = f"data/funding_{c}.json"
    return json.load(open(f)) if os.path.exists(f) else None
def run(rows, L, enter, exit_, cost, lo=None, hi=None):
    rates = [r[1] for r in rows]; ts = [r[0] for r in rows]
    inpos, pnl, hours, trips, s = False, 0.0, 0, 0, 0.0
    start = None; n = 0; cur = []
    for i in range(len(rows)):
        s += rates[i]
        if i >= L: s -= rates[i - L]
        in_window = (lo is None or ts[i] >= lo) and (hi is None or ts[i] < hi)
        if not in_window:
            continue
        if start is None: start = ts[i]
        n += 1
        if inpos:
            pnl += rates[i]; hours += 1
        if i >= L:
            avg = s / L * H
            if not inpos and avg >= enter: inpos = True; pnl -= cost / 2; trips += 1
            elif inpos and avg < exit_: inpos = False; pnl -= cost / 2
    if inpos: pnl -= cost / 2
    yrs = n / H if n else 1
    return dict(apr=round(pnl / CAP_PER_N / yrs * 100, 2), in_mkt=round(hours / max(1, n) * 100), trips=trips, yrs=round(yrs, 2))
def always(rows, cost, lo=None, hi=None):
    x = [r[1] for r in rows if (lo is None or r[0] >= lo) and (hi is None or r[0] < hi)]
    if not x: return None
    yrs = len(x) / H
    neg = sum(1 for v in x if v < 0) / len(x) * 100
    worst30 = min(sum(x[i:i + 720]) for i in range(0, max(1, len(x) - 720), 24)) * H / 720 * 100 if len(x) > 720 else None
    return dict(gross_apr=round(sum(x) / yrs * 100, 1), net_apr_on_capital=round((sum(x) - cost) / CAP_PER_N / yrs * 100, 1), neg_hours_pct=round(neg), worst30_apr=round(worst30, 1) if worst30 else None, yrs=round(yrs, 2))
GRID = [(L, e, x) for L in (24, 72, 168) for e in (0.05, 0.10, 0.15, 0.20) for x in (0.0, e / 2)]
out = {"per_asset": {}, "grid": len(GRID)}
print(f"{'coin':5s} {'since':10s} | always-in gross · net APR on capital · % hours negative · worst 30d (APR) | rule chosen 2023-24 → 2025-26 net APR, time in market")
for c in CAND + REF:
    rows = load(c)
    if not rows: print(c, "no data"); continue
    a_all = always(rows, COST["maker"]); a_test = always(rows, COST["maker"], lo=SPLIT)
    best = max(GRID, key=lambda g: run(rows, g[0], g[1], g[2], COST["maker"], hi=SPLIT)["apr"])
    tr = run(rows, *best, COST["maker"], hi=SPLIT); te = run(rows, *best, COST["maker"], lo=SPLIT); tt = run(rows, *best, COST["taker"], lo=SPLIT)
    since = datetime.fromtimestamp(rows[0][0] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    tag = "" if c in CAND else " (no spot leg)"
    print(f"{c:5s} {since} | {a_all['gross_apr']:5.1f}% · {a_all['net_apr_on_capital']:5.1f}% · {a_all['neg_hours_pct']:2d}% · {a_all['worst30_apr']}% | L{best[0]} in≥{best[1]*100:.0f}% out<{best[2]*100:.1f}%: train {tr['apr']}% → test {te['apr']}% (taker {tt['apr']}%), in {te['in_mkt']}%, {te['trips']} trips{tag}")
    out["per_asset"][c] = {"spot_leg": c in CAND, "since": since, "always": a_all, "always_2025_26": a_test, "rule": {"L": best[0], "enter": best[1], "exit": best[2]}, "train": tr, "test_maker": te, "test_taker": tt}
# one pooled rule across the spot-leg assets (less overfit than per-asset picks)
def pooled(g, lo=None, hi=None):
    v = [run(load(c), *g, COST["maker"], lo=lo, hi=hi)["apr"] for c in CAND if load(c)]
    return sum(v) / len(v)
gb = max(GRID, key=lambda g: pooled(g, hi=SPLIT))
print(f"\nONE RULE FOR ALL spot-leg assets, chosen on 2023-24: L{gb[0]} enter≥{gb[1]*100:.0f}% exit<{gb[2]*100:.1f}% → mean net APR train {pooled(gb, hi=SPLIT):.1f}% · test 2025-26 {pooled(gb, lo=SPLIT):.1f}%")
for c in CAND:
    if load(c):
        te = run(load(c), *gb, COST["maker"], lo=SPLIT); print(f"   {c:5s} 2025-26 {te['apr']:6.2f}% on capital, in market {te['in_mkt']}%, {te['trips']} trips")
out["pooled_rule"] = {"L": gb[0], "enter": gb[1], "exit": gb[2], "train": pooled(gb, hi=SPLIT), "test": pooled(gb, lo=SPLIT)}
json.dump(out, open("carry_results.json", "w"), indent=1)
