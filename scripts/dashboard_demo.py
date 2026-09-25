#!/usr/bin/env python3
"""dashboard_demo.py — seeded synthetic executor state → KV files for the local preview (cloud/dev/preview.mjs).

It writes a whole state tree into a temporary directory (never state/), runs the real push serializer
(scripts/dashboard_push.py) over it, and writes the KV pairs a push would leave in the namespace. Summary lines are
rendered with cycle.py's own formats, so the demo also exercises the event parser (it refuses to write a file if any
line goes unparsed).

Scenarios (default output cloud/dev/kv_demo.json for mature, cloud/dev/kv_demo_<scenario>.json for the others):
  mature   40 names in 6 books; 6 open positions with stop histories; 300 closed trades (eth-defi past 30); a year of
           checks, the last 11 days in full detail. The 7-day window holds the caps: 60 runs (late, failed, halted and
           throttle-halved runs, missed slots, a failed-then-rerun slot, manual re-runs on three busy days) and 200
           events; the last two checks are quiet
  failed   mature, but the last check stopped early (ConnectionError) while holding six positions
  halted   mature, plus a HALT file set after the last check (with HALT.since)
  flat     mature history, nothing open
  v1       an old-shape bundle without "v": the page must show its "newer than its data" note
  missing  mature with state.thr, names and runs deleted: panels must say "unknown" / "not in this data"

  python3 scripts/dashboard_demo.py                     mature → cloud/dev/kv_demo.json
  python3 scripts/dashboard_demo.py --all               every scenario
  python3 scripts/dashboard_demo.py --scenario failed [--out FILE] [--now TS] [--seed N] [--keep DIR]
"""
import argparse, json, math, random, shutil, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path
import _path  # noqa: F401
from executor import risk as K
import dashboard_push as DP

ROOT = Path(__file__).resolve().parents[1]
DEV = ROOT / "cloud" / "dev"
SCENARIOS = ("mature", "failed", "halted", "flat", "v1", "missing")
BAR, DAY = 4 * 3600, 86400
START = 2500.0                      # the synthetic paper pot; never shipped (a test asserts it)

BOOKS = [  # book, benchmark, share, cap, sweep, [(coin, price, vol_m, funding %/yr, days, backtested)]
    ("bitcoin", "BTC", 15, 1.0, False, [("BTC", 84000, 3900, 10.95, 1500, 1)]),
    ("eth-defi", "ETH", 30, 2.5, False, [("ETH", 2700, 1080, 10.95, 1500, 1), ("AAVE", 145, 13, 10.95, 1500, 1), ("UNI", 9.1, 48, 20.8, 1500, 1),
                                         ("LINK", 13.3, 34, 22, 1500, 1), ("CRV", 0.34, 11, 67.6, 1500, 1), ("MKR", 1450, 9, 10.95, 1500, 1),
                                         ("LDO", 0.92, 36, 10.95, 1300, 1), ("ENS", 17.5, 6, 10.95, 1100, 0), ("SNX", 0.62, 4, 10.95, 1500, 0),
                                         ("COMP", 41, 5, 10.95, 1500, 0), ("ARB", 0.39, 70, 10.95, 900, 1), ("OP", 0.68, 55, 10.95, 1000, 1)]),
    ("solana", "SOL", 20, 2.0, False, [("SOL", 117, 316, 10.95, 1500, 1), ("JUP", 0.30, 11, 10.95, 1027, 0), ("JTO", 0.49, 1.4, 10.95, 1023, 0),
                                       ("PENGU", 0.0096, 11, 45, 647, 0), ("PUMP", 0.0039, 58, 10.95, 442, 0), ("RAY", 2.1, 3, 10.95, 1200, 0),
                                       ("WIF", 0.62, 90, 10.95, 640, 0), ("BONK", 0.000017, 40, 10.95, 1000, 0), ("PYTH", 0.12, 8, 10.95, 600, 0),
                                       ("TNSR", 0.14, 0.8, 10.95, 190, 0)]),
    ("hype", "HYPE", 10, 1.0, False, [("HYPE", 92, 800, 10.95, 659, 0)]),
    ("bnb", "BNB", 5, 1.0, False, [("BNB", 773, 7.4, 10.95, 1500, 0), ("CAKE", 2.74, 1.7, 10.95, 1058, 0)]),
    ("majors", "BTC", 20, 1.5, True, [("XRP", 2.35, 240, 10.95, 1500, 1), ("ADA", 0.62, 60, 10.95, 1500, 1), ("DOGE", 0.18, 180, 10.95, 1500, 1),
                                      ("AVAX", 21, 45, 10.95, 1500, 1), ("DOT", 3.9, 28, 10.95, 1500, 1), ("TRX", 0.27, 35, 10.95, 1500, 0),
                                      ("LTC", 88, 38, 10.95, 1500, 1), ("BCH", 410, 31, 10.95, 1500, 0), ("NEAR", 2.4, 40, 10.95, 1500, 0),
                                      ("ATOM", 4.3, 25, 10.95, 1500, 1), ("SUI", 2.9, 150, 10.95, 900, 0), ("APT", 4.6, 33, 10.95, 1000, 0),
                                      ("TIA", 1.6, 32, 38, 700, 0), ("SEI", 0.24, 30.5, 10.95, 700, 0)]),
]
WHY_W, WHY_D, WHY_N, WHY_T, WHY_G = ("weekly Momentum Cloud not bullish", "daily Momentum Cloud not bullish", "4-hour reading not ready",
                                     "no trigger on the last 4-hour bar", "close not above the 4-hour line")


def iso(ts, micro=False):
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return (dt.isoformat() if micro else dt.replace(microsecond=0).isoformat()).replace("+00:00", "Z")


def label(d):
    return "Bullish" if d == 1 else "Bearish" if d == 0 else "No data"


# cycle.py's say() formats (tests/test_dashboard_events.py pins the parser against cycle.py itself)
def L_btc(w, d, detail):
    return f"BTC weekly {label(w)} · daily {label(d)} · data {detail}"


def L_sold(coin, book, reason, px, R, rel, bench):
    return f"{coin} [{book}]: closed on {reason} at {px:.5g} → {R:+.2f} R" + (f" · {rel:+.2f} R vs {bench}" if rel is not None else "")


def L_entered(coin, book, kind, tier, stop, dist, size, lev, risk):
    return (f"{coin}: ENTERED {coin} long [{book}] · {kind} tier {tier} · stop {stop:.5g} ({dist:.1f}% away) · size {size:.1f}% of pot at "
            f"{lev}x · risk {risk:.2f}% of pot")


def L_refused(coin, kind, tier, failed):
    return f"{coin}: signal {kind} tier {tier} REFUSED: " + "; ".join(f"{c['check']} ({c['detail']})" for c in failed)


def L_counts(c, n_open):
    return (f"evaluated {c['evaluated']} names · {c['triggers']} triggers · {c['refused']} refused · {c['proposed']} proposed · "
            f"{c['entered']} entered · {n_open} open")


class World:
    def __init__(self, scenario="mature", seed=7, now=None):
        self.sc, self.rng = scenario, random.Random(seed)
        self.now = float(now if now is not None else time.time())
        self.names, self.book_of, self.bench_of = {}, {}, {}
        for bk, bench, _sh, _cap, _sw, rows in BOOKS:
            for coin, px, vol, fund, days, tested in rows:
                self.names[coin] = {"px": float(px), "vol": vol, "fund": fund, "days": days, "tested": tested}
                self.book_of[coin], self.bench_of[coin] = bk, bench
        self.order = list(self.names)
        s_last = int((self.now - 25 * 60) // BAR * BAR)
        self.slots = list(range(s_last - 365 * 6 * BAR, s_last + BAR, BAR))
        self.N = len(self.slots)
        self.W = self.N - 66                          # first slot of the detailed window (the last 11 days)
        self.runs, self.refused, self.trades, self.equity, self.sweeps = [], [], [], [], []
        self.positions = {}

    # ---------------------------------------------------------------------------------------------- plan --
    def plan(self):
        """Per slot: which runs happen. Returns {slot index: [run spec]}."""
        r, W, N = self.rng, self.W, self.N
        spec = {}
        for i in range(N):
            if i < W and r.random() < 0.02:
                continue                              # an occasional missed slot in the old history
            spec[i] = [{"lag": r.randint(20, 27) * 60 + r.randint(0, 59), "fresh": True}]
        rel = lambda k: N + k                         # noqa: E731 — k counts back from the end (−1 = the last slot)
        for k in (-58, -51, -45, -33, -24, -6):
            spec.pop(rel(k), None)                    # missed slots: three inside the 7-day window, three before it
        for k, late in ((-30, 97), (-22, 58), (-9, 143)):
            spec[rel(k)] = [{"lag": late * 60 + 17, "fresh": False}]
        spec[rel(-35)] = [{"lag": 21 * 60 + 4, "fresh": False, "failed": "ConnectionError"}]
        spec[rel(-16)] = [{"lag": 20 * 60 + 40, "fresh": False, "failed": "ReadTimeout"}, {"lag": 38 * 60 + 12, "fresh": True}]  # two runs, one slot
        for k in (-12, -11, -10):
            spec[rel(k)][0]["halt"] = "manual halt"
        if self.sc == "failed":
            spec[rel(-1)] = [{"lag": 21 * 60 + 9, "fresh": False, "failed": "ConnectionError"}]
        # A busy week: on three days the owner re-ran the check by hand a few minutes after the scheduled one (a re-run
        # reads the same closed bar, so it repeats that bar's refusals and buys nothing). That fills the 7-day window to
        # the 60-run cap of runs[] (and events[] to its 200 cap), the worst case the 50 KB budget is sized for.
        lo_t = self.now - 7 * DAY
        in_win = lambda: sum(1 for i, sp in spec.items() for x in sp if self.slots[i] + x["lag"] >= lo_t)  # noqa: E731
        busy = [k for d0 in (-40, -28, -20) for k in range(d0, d0 + 6)] + list(range(-8, -2))
        for k in busy:
            sp = spec.get(rel(k))
            if in_win() >= DP.RUNS_CAP:
                break
            if sp and len(sp) == 1 and sp[0]["fresh"] and not sp[0].get("failed") and not sp[0].get("halt"):
                sp.append({"lag": sp[0]["lag"] + r.randint(6, 14) * 60 + r.randint(0, 59), "fresh": True, "rerun": True})
        self.quiet_from = N - 2                       # the last two checks are quiet: Now › Latest folds them
        # one manual flatten in the old history: it closes whatever is open between two runs and sets HALT
        self.flat_i = W - 700
        self.flat_ts = self.slots[self.flat_i - 1] + 2 * 3600 + 731
        for k in (0, 1):
            if self.flat_i + k in spec:
                spec[self.flat_i + k][0]["halt"] = "flatten"
        self.spec = spec
        # BTC regime: weekly bullish except a stretch last winter; daily bearish for a day inside the window
        self.btc = {}
        for i in range(N):
            w = 0 if 900 <= i < 1150 else 1
            d = 0 if (N - 32 <= i < N - 27 or 880 <= i < 1200) else 1
            self.btc[i] = (w, d)

    def run_t(self, i, j=0):
        return self.slots[i] + self.spec[i][j]["lag"]

    def ok_slot(self, i):
        """A slot whose (last) run can open or close a trade: on time, not failed, not halted, Bitcoin weekly bullish."""
        sp = self.spec.get(i)
        return bool(sp) and sp[-1]["fresh"] and not sp[-1].get("failed") and not sp[0].get("halt") and self.btc[i][0] == 1

    # -------------------------------------------------------------------------------------------- trades --
    def schedule_trades(self):
        """300 closed trades over the year (≤ 6 at once, one coin once), plus the open positions at the end."""
        r, N, W = self.rng, self.N, self.W
        busy = [set() for _ in range(N + 1)]
        weights = [("eth-defi", 120), ("solana", 55), ("majors", 65), ("bitcoin", 25), ("hype", 20), ("bnb", 15)]
        pool = {bk: [c for c, _p, v, f, dd, _t in rows if v >= 30 and f <= 30 and dd >= 280] or [rows[0][0]]
                for bk, _b, _s, _c, _w, rows in BOOKS}
        pool["bnb"] = ["BNB", "CAKE"]
        self.open_plan = []
        if self.sc != "flat":         # (coin, open slot from the end, risk multiplier) — two at full size, four while halved
            self.open_plan = [("UNI", -25), ("AVAX", -23), ("XRP", -21), ("ETH", -20), ("LINK", -8), ("SOL", -3)]
            for coin, k in self.open_plan:
                for j in range(N + k, N + 1):
                    busy[j].add(coin)
        plan = []
        for bk, n in weights:
            plan += [bk] * n
        r.shuffle(plan)
        window_closes = 8
        for bk in plan:
            for _try in range(400):
                coin = r.choice(pool[bk])
                dur = max(2, int(r.expovariate(1 / 14)))
                if window_closes > 0:
                    o = r.randint(W - 30, N - 45)
                else:
                    o = r.randint(0, W - dur - 1)
                c = o + dur
                if c >= N - 28 or not self.ok_slot(o) or not (self.ok_slot(c) or self.flat_i <= c <= self.flat_i + 1):
                    continue
                if any(coin in busy[j] or len(busy[j]) >= 6 for j in range(o, c + 1)):
                    continue
                for j in range(o, c + 1):
                    busy[j].add(coin)
                if c >= W:
                    window_closes -= 1
                self.trades.append({"coin": coin, "book": bk, "o": o, "c": c})
                break
        self.trades.sort(key=lambda x: x["o"])
        for x in self.trades:        # outcome in R: trend following, many small losses and a few large wins
            win = r.random() < 0.36
            x["R"] = round(r.lognormvariate(0.35, 0.7), 4) if win else round(-r.uniform(0.25, 1.12), 4)
            x["reason"] = (r.choice(["4h flip", "4h flip", "daily flip", "weekly flip", "stop"]) if win else
                           r.choice(["stop", "stop", "stop", "4h flip", "daily flip"]))
            x["dist"] = r.uniform(0.018, 0.06)
            x["bench_ret"] = r.gauss(0.004, 0.035)
            x["hold_open"] = False
        for x in self.trades:        # the flatten closes whatever is open then, outside any run
            if x["o"] < self.flat_i <= x["c"]:
                x["c"], x["reason"], x["flatten"] = self.flat_i, "manual flatten", True

    # -------------------------------------------------------------------------------------------- equity --
    def equity_path(self):
        """Realised R of closed trades + a synthetic drawdown dip inside the window (the throttle halves there)."""
        r, N = self.rng, self.N
        closes = sorted(self.trades, key=lambda x: x["c"])
        eq, k, realised = [], 0, 0.0
        base = START
        for i in range(N):
            while k < len(closes) and closes[k]["c"] <= i:
                x = closes[k]
                x["risk_amt"] = base * 0.01 * x.get("mult", 1.0)
                x["pnl"] = x["R"] * x["risk_amt"]
                realised += x["pnl"]
                base = START + realised
                k += 1
            eq.append(START + realised)
        # inside the last 40 slots the pot sits about 2% under its old peak, with a temporary 12% dip centred on
        # slot N−23: the throttle halves risk for about six runs there, and the last check is back to normal
        tc, P = N - 23, max(eq[: N - 40])
        out = []
        for i in range(N):
            if i >= N - 40:
                out.append(P * (0.98 - 0.12 * math.exp(-((i - tc) / 6.0) ** 2)) * (1 + r.gauss(0, 0.0008)))
            else:
                out.append(eq[i] * (1 + r.gauss(0, 0.0012)))
        self.eq = out
        # the throttle each run saw (K.throttle over the points written so far)
        self.thr, pts = {}, []
        for i in range(N):
            for j, _x in enumerate(self.spec.get(i, [])):
                pts.append({"equity": out[i]})
                self.thr[(i, j)] = K.throttle(pts, {"halve_at_drawdown_pct": 10, "halt_at_drawdown_pct": 20})

    # -------------------------------------------------------------------------------------------- simulate --
    def simulate(self):
        r, N, W = self.rng, self.N, self.W
        st = {c: {"w": 1, "d": 1, "h4": r.choice([0, 1]), "px": v["px"], "cush": r.uniform(0.01, 0.1)} for c, v in self.names.items()}
        for c in ("PENGU", "SEI"):
            st[c]["w"] = 0
        for c in ("JTO", "PUMP", "DOT"):
            st[c]["d"] = 0
        open_at = {N + k: c for c, k in self.open_plan}
        held = {}                                           # coin → position dict (window) or trade (history)
        opens = {}
        for x in self.trades:
            opens.setdefault(x["o"], []).append(x)
        closes_at = {}
        for x in self.trades:
            closes_at.setdefault(x["c"], []).append(x)
        for i in range(N):
            if i not in self.spec:
                continue
            detailed = i >= W
            w_btc, d_btc = self.btc[i]
            # the prices move once per slot (a random walk inside the window, around the base price before it)
            for c, s in st.items():
                if detailed:
                    drift = 0.0035 if (c in held and held[c].get("win", True)) else 0.0
                    s["px"] *= math.exp(r.gauss(drift, 0.012))
                else:
                    s["px"] = self.names[c]["px"] * math.exp(r.gauss(0, 0.04))
            st["BTC"]["w"], st["BTC"]["d"] = w_btc, d_btc
            quiet = i >= self.quiet_from and self.sc != "failed"
            first = None
            for j, sp in enumerate(self.spec[i]):
                t = self.run_t(i, j)
                failed = sp.get("failed")
                halt = sp.get("halt")
                thr = dict(self.thr[(i, j)])
                if sp.get("rerun") and first:
                    self.rerun(first, t, i, thr, held, w_btc, d_btc)
                    continue
                lines, readings, refs = [], [], []
                counts = {"evaluated": 0, "triggers": 0, "refused": 0, "proposed": 0, "entered": 0}
                halt_text = None
                if halt:
                    halt_text = "manual halt" if halt == "manual halt" else f"manual flatten {iso(self.flat_ts, True)}"
                    lines.append(f"HALT set: {halt_text} (exits still managed, no entries)")
                late = sp["lag"] // 60
                if failed and not detailed:
                    failed = None
                if failed:
                    e_msg = {"ConnectionError": "HTTPSConnectionPool(host='api.hyperliquid.xyz', port=443): Max retries exceeded with url: /info",
                             "ReadTimeout": "HTTPSConnectionPool(host='api.hyperliquid.xyz', port=443): Read timed out. (read timeout=30)"}[failed]
                    lines.append(f"CYCLE ABORTED: {failed}: {e_msg[:160]}")
                    lines.append(L_counts(counts, len(held)))
                    self.runs.append(self.doc(t, False, True, bool(halt), None, None, sorted(held), thr, counts, lines, [], i))
                    continue
                fresh = sp["fresh"]
                lines.append(L_btc(w_btc, d_btc, f"{late} min after the bar close" if fresh else
                                   f"run started {late} min after the bar close, limit 45"))
                # exits
                for c in list(held):
                    x = held[c]
                    if x.get("trade") and x["trade"]["c"] == i and not x["trade"].get("flatten"):
                        self.close_trade(x["trade"], t, i, lines)
                        del held[c]
                        continue
                    if detailed and x.get("pos"):
                        p = x["pos"]
                        line_px = st[c]["px"] * (1 - st[c]["cush"])
                        if c == "UNI" and i == N - 13:
                            lines.append(f"{c}: exit management failed (ReadTimeout: HTTPSConnectionPool(host='api.hyperliquid.xyz', port=443): "
                                         f"Read timed out.); position kept")
                        elif c == "XRP" and i == N - 4:
                            lines.append(f"{c}: no reading on one timeframe (data gap); position and stop kept as they are")
                        elif line_px > p["stop"] and not quiet and r.random() < 0.55:
                            p["stop"] = line_px
                            if "stops" in p:
                                p["stops"].append([iso(t), line_px])
                            lines.append(f"{c}: stop trailed to {line_px:.5g}")
                    elif detailed and x.get("trade") and not quiet and r.random() < 0.3:
                        tr = x["trade"]
                        tr["stop"] = tr.get("stop", tr["entry"] * (1 - tr["dist"])) * (1 + r.uniform(0.003, 0.012))
                        lines.append(f"{c}: stop trailed to {tr['stop']:.5g}")
                for x in closes_at.get(i, []):
                    if x.get("flatten") and x["coin"] in held:
                        del held[x["coin"]]
                if thr["multiplier"] < 1 and not thr["halt"]:
                    lines.append(f"throttle: drawdown {thr['drawdown_pct']:.1f}%, risk per trade halved")
                E = self.eq[i]
                # entries
                planned = [x for x in opens.get(i, []) if not x.get("placed")]
                if i in open_at:
                    planned.append({"coin": open_at[i], "open": True})
                plan_coins = {x["coin"] for x in planned}
                for c in self.order:
                    if c in held:
                        continue
                    s, meta = st[c], self.names[c]
                    if detailed:
                        if c not in plan_coins and c != "BTC":        # weekly and daily turn rarely and drift back to bullish
                            if c not in ("PENGU", "SEI") and r.random() < (0.003 if s["w"] else 0.06):
                                s["w"] = 1 - s["w"]
                            if c not in ("JTO", "PUMP", "DOT") and r.random() < (0.012 if s["d"] else 0.08):
                                s["d"] = 1 - s["d"]
                        prev_h4 = s["h4"]
                        if c in plan_coins:
                            s["w"], s["d"], prev_h4, s["h4"] = 1, 1, 0, 1
                        elif not quiet and r.random() < (0.035 if (s["w"] and s["d"] and meta["vol"] >= 30 and meta["fund"] <= 30) else 0.08):
                            s["h4"] = 1 - s["h4"]
                        if s["h4"] != prev_h4 or r.random() < 0.05:
                            s["cush"] = r.uniform(0.012, 0.11)
                        counts["evaluated"] += 1
                        close = s["px"] * r.uniform(0.996, 1.004)
                        line_px = close * (1 - s["cush"]) if s["h4"] == 1 else close * (1 + s["cush"])
                        rd = {"coin": c, "book": self.book_of[c], "weekly": label(s["w"]), "daily": label(s["d"]), "h4": label(s["h4"]),
                              "range": r.choice(["Overextended", "Overextended", "In Range", "Suppressed"]) if s["h4"] == 0 else
                              r.choice(["Overextended", "In Range"]), "line": line_px, "close": close, "trigger": None, "why": None,
                              "vol_m": meta["vol"] * r.uniform(0.85, 1.15), "funding_pct": meta["fund"], "days": meta["days"] + (i - W) // 6,
                              "mark": close * r.uniform(0.998, 1.002)}
                        kind = None
                        if c == "TNSR":
                            rd["why"] = WHY_N
                        elif s["w"] != 1:
                            rd["why"] = WHY_W
                        elif s["d"] != 1:
                            rd["why"] = WHY_D
                        elif s["h4"] == 1 and prev_h4 == 0:
                            kind = "flip"
                        elif s["h4"] == 1 and rd["range"] == "In Range" and not quiet and r.random() < 0.12:
                            kind = "pullback"
                        elif r.random() < 0.004:
                            rd["why"] = WHY_G
                        else:
                            rd["why"] = WHY_T
                        readings.append(rd)
                        if kind is None:
                            continue
                        tier = "A" if (kind == "flip" and w_btc == 1) else "B"
                        rd["trigger"] = f"{kind} tier {tier}"
                    else:
                        counts["evaluated"] += 1
                        if c not in plan_coins and r.random() > 0.012:
                            continue
                        kind, tier = ("flip", "A") if c in plan_coins else (r.choice(["flip", "pullback", "pullback"]), None)
                        tier = tier or ("A" if kind == "flip" and w_btc == 1 else "B")
                        rd = {"vol_m": meta["vol"], "funding_pct": meta["fund"]}
                    counts["triggers"] += 1
                    cand = {"coin": c, "kind": kind, "tier": tier}
                    failed_checks = []
                    if halt:
                        failed_checks.append({"check": "not halted", "ok": False, "detail": halt_text})
                    if not fresh:
                        failed_checks.append({"check": "data fresh and run on time", "ok": False,
                                              "detail": f"run started {late} min after the bar close, limit 45"})
                    uni = []
                    if rd["vol_m"] < 30:
                        uni.append(f"24h volume {rd['vol_m']:.1f}M below 30M")
                    if meta["fund"] > 30:
                        uni.append(f"funding {meta['fund']:.0f}%/yr against longs above 30%")
                    if meta["days"] < 280:
                        uni.append(f"{meta['days']} daily bars below 280")
                    if c in plan_coins:
                        uni, failed_checks, tier = [], [], "A"
                    is_planned = c in plan_coins
                    if not is_planned and tier == "A" and not failed_checks and not uni:
                        n_open = len(held)
                        failed_checks.append(r.choice([
                            {"check": "below max positions", "ok": False, "detail": f"{n_open} open of 6"} if n_open >= 6 else
                            {"check": "book open-risk cap", "ok": False, "detail": f"book {self.book_of[c]}: 2.60% after entry, cap 2.5%"},
                            {"check": "price sanity band", "ok": False, "detail": f"mark vs Binance {r.uniform(2.05, 3.4):.2f}%"},
                            {"check": "open-risk cap", "ok": False, "detail": f"{r.uniform(4.1, 4.9):.2f}% of equity after entry, cap 4.0%"}]))
                    if uni:
                        failed_checks.append({"check": "universe filters", "ok": False, "detail": "; ".join(uni)})
                    if failed_checks:
                        counts["refused"] += 1
                        refs.append({"t": iso(t), "coin": c, "kind": kind, "tier": tier, "stage": "pre-trade", "detail": failed_checks})
                        lines.append(L_refused(c, kind, tier, failed_checks))
                        continue
                    if tier != "A":
                        counts["refused"] += 1
                        refs.append({"t": iso(t), "coin": c, "kind": kind, "tier": tier, "stage": "policy",
                                     "detail": f"tier {tier} is not automated and approvals are disabled"})
                        lines.append(f"{c}: signal {kind} tier {tier} recorded, not traded (tier not automated)")
                        continue
                    # bought
                    counts["entered"] += 1
                    mult = thr["multiplier"]
                    entry = (rd.get("mark") or s["px"]) * 1.0005
                    x = next((y for y in planned if y["coin"] == c), None)
                    if x is not None and x.get("open"):
                        dist = r.uniform(0.022, 0.05)
                        stop = entry * (1 - dist)
                        risk_amt = E * 0.01 * mult
                        notional = risk_amt / dist
                        lev = 3
                        pos = {"coin": c, "side": "long", "kind": "flip", "tier": "A", "mode": "paper", "entry": entry, "stop": stop,
                               "initial_stop": stop, "notional": notional, "sz": notional / entry, "risk_amt": risk_amt, "leverage": lev,
                               "notional_pct_equity": notional / E * 100, "entry_fee": notional * 0.00045, "funding_paid": 0.0,
                               "opened": iso(t), "opened_ts": t, "last_bar_t": self.slots[i] - BAR, "last_funding_ts": t,
                               "context": {"btc_weekly": "Bullish"}, "rules": ["LOGIC v1.3", "trigger:flip", "tier:A"], "stop_cloid": None,
                               "entry_cloid": None, "book": self.book_of[c], "benchmark": self.bench_of[c], "bench_entry": 84000.0,
                               "win": c not in ("ETH", "AVAX")}
                        if c in ("UNI", "XRP", "LINK"):                      # E4-shaped stop history on half of them
                            pos["stops"] = [[iso(t), stop]]
                            pos["risk_pct"] = round(risk_amt / E * 100, 4)
                        held[c] = {"pos": pos, "win": pos["win"]}
                        s["cush"] = dist
                    else:
                        x = x or {"coin": c}
                        x["placed"] = True
                        dist = x.get("dist", 0.03)
                        stop = entry * (1 - dist)
                        x.update({"entry": entry, "stop0": stop, "t_open": t, "mult": mult})
                        risk_amt = x.get("risk_amt") or E * 0.01 * mult
                        notional, lev = risk_amt / dist, 3
                        held[c] = {"trade": x, "win": x.get("R", 0) > 0}
                    lines.append(L_entered(c, self.book_of[c], "flip", "A", stop, dist * 100, notional / E * 100, lev, risk_amt / E * 100))
                lines.append(L_counts(counts, len(held)))
                self.refused += refs
                self.runs.append(self.doc(t, fresh, False, bool(halt), w_btc, d_btc, sorted(held), thr, counts, lines, readings, i))
                first = {"lines": lines, "refs": refs, "readings": readings, "counts": counts, "halt": bool(halt)}
        self.held_end = held

    def rerun(self, first, t, i, thr, held, w_btc, d_btc):
        """A manual re-run minutes after the scheduled check: the same closed bar, so the same readings and the same
        refusals again; names bought by the first run are held now and are not read for entries."""
        late = (t - self.slots[i]) // 60
        refs = [dict(x, t=iso(t)) for x in first["refs"]]
        sig = [l for l in first["lines"] if " REFUSED: " in l or "recorded, not traded" in l]
        c0 = first["counts"]
        counts = {"evaluated": c0["evaluated"] - c0["entered"], "triggers": len(refs), "refused": len(refs), "proposed": 0, "entered": 0}
        lines = [L_btc(w_btc, d_btc, f"{late} min after the bar close")] + sig + [L_counts(counts, len(held))]
        readings = [dict(x) for x in first["readings"] if x["coin"] not in held]
        self.refused += refs
        self.runs.append(self.doc(t, True, False, first["halt"], w_btc, d_btc, sorted(held), thr, counts, lines, readings, i))

    def close_trade(self, x, t, i, lines):
        entry = x.get("entry") or self.names[x["coin"]]["px"]
        x.setdefault("t_open", self.run_t(x["o"]) if x["o"] in self.spec else self.slots[x["o"]] + 1300)
        risk_amt = x["risk_amt"]
        notional = risk_amt / x["dist"]
        fees = notional * 0.00045 * 2
        funding = notional * 0.0001 * max(1, (i - x["o"])) * self.rng.uniform(0, 1)
        pnl = x["R"] * risk_amt
        gross = pnl + fees + funding
        exit_px = entry * (1 + gross / notional)
        rel = (pnl - x["bench_ret"] * notional) / risk_amt
        closed = t if x["reason"] != "stop" else self.slots[i] - BAR
        if x.get("flatten"):
            closed = self.flat_ts
        rec = {"coin": x["coin"], "side": "long", "kind": "flip", "tier": "A", "mode": "paper", "opened": iso(x["t_open"]), "closed": iso(closed),
               "entry": entry, "exit": exit_px, "stop_at_exit": x.get("stop", entry * (1 - x["dist"])), "notional": notional, "leverage": 3,
               "risk_amt": risk_amt, "gross": gross, "fees": fees, "funding": funding, "pnl": pnl, "R": pnl / risk_amt, "reason": x["reason"],
               "hours": max(1, (closed - x["t_open"]) / 3600), "rules": ["LOGIC v1.3", "trigger:flip", "tier:A"],
               "context_at_entry": {"btc_weekly": "Bullish"}, "book": x["book"], "benchmark": self.bench_of[x["coin"]],
               "bench_ret": x["bench_ret"], "rel_R": rel}
        self.trade_recs.append(rec)
        if lines is not None:
            lines.append(L_sold(x["coin"], x["book"], x["reason"], exit_px, rec["R"], rel, self.bench_of[x["coin"]]))
            if x["book"] == "majors" and pnl > 0 and self.btc[i][0] == 1:
                pct = pnl / self.eq[i] * 100
                self.sweeps.append({"t": iso(t), "book": "majors", "benchmark": "BTC", "pct_of_pot": pct, "executed": False})
                lines.append(f"{x['coin']}: gain earmarked for BTC ({pct:.2f}% of pot); execution is a later version")

    def doc(self, t, fresh, failed, halt, w, d, positions, thr, counts, lines, readings, i):
        return {"t": iso(t), "mode": "paper", "hours": "auto", "dry": False, "fresh": fresh, "failed": failed,
                "btc_weekly": label(w), "btc_daily": label(d), "positions": positions, "open_proposals": [],
                "throttle": {"multiplier": thr["multiplier"], "drawdown_pct": thr["drawdown_pct"], "halt": thr["halt"], "peak": thr["peak"]},
                "halt": halt, "counts": counts, "summary": lines, "readings": readings, "equity": self.eq[i], "hours_local": "00:20 UTC"}

    # ----------------------------------------------------------------------------------------------- write --
    def build(self):
        self.trade_recs = []
        self.plan()
        self.schedule_trades()
        self.equity_path()
        self.simulate()
        # flattened trades close outside any run (the ledger cross-check must still show them)
        for x in self.trades:
            if x.get("flatten") and x.get("entry"):
                self.close_trade(x, None, x["c"], None)
        # old refusals outside the window are already in self.refused (light runs); marks for the open positions
        last = self.runs[-1]
        for c, h in self.held_end.items():
            p = h.get("pos")
            if not p:
                continue
            mark = self.names[c]["px"]
            if c == "AVAX":
                mark = p["stop"] * 0.997                         # at or through the stop: checked next cycle
            elif c == "ETH":
                mark = p["entry"] * 0.994
            elif c == "UNI":
                mark = max(mark, p["entry"] * 1.09)
                p["stop"] = max(p["stop"], p["entry"] * 1.012)
                p.setdefault("stops", []).append([last["t"], p["stop"]])
            else:
                mark = max(mark, p["stop"] * 1.012)
            p["mark"], p["upnl_pct"] = mark, (mark / p["entry"] - 1) * 100
            p["funding_paid"] = p["notional"] * 0.00004 * max(1, (DP.ts_of(last["t"]) - p["opened_ts"]) / 3600)
            p.pop("win", None)
            self.positions[c] = p
        self.trade_recs.sort(key=lambda x: x["closed"])

    def write(self, root):
        st, cfg = Path(root) / "state", Path(root) / "config"
        (st / "runs").mkdir(parents=True)
        (st / "ledger").mkdir()
        (st / "review").mkdir()
        cfg.mkdir()
        settings = json.loads((ROOT / "config" / "settings.json").read_text())
        settings["pot_usd_paper"] = START
        (cfg / "settings.json").write_text(json.dumps(settings, indent=2))
        books = {"version": 1, "books": [{"book": bk, "enabled": True, "benchmark": bench, "pot_share_pct": sh, "open_risk_cap_pct": cap,
                                          "sweep_gains_to_benchmark": sw,
                                          "names": [{"coin": c, "note": "backtested" if tt else "untested"} for c, _p, _v, _f, _d, tt in rows]}
                                         for bk, bench, sh, cap, sw, rows in BOOKS]}
        (cfg / "books.json").write_text(json.dumps(books, indent=1))
        by_day = {}
        for d in self.runs:
            by_day.setdefault(d["t"][:10], []).append(d)
        for day, docs in by_day.items():
            (st / "runs" / f"{day}.jsonl").write_text("".join(json.dumps(d) + "\n" for d in docs))
        (st / "runs" / "last_run.json").write_text(json.dumps(self.runs[-1], indent=2))
        eq_lines = []
        for i, sp in sorted(self.spec.items()):
            for j in range(len(sp)):
                t = self.run_t(i, j)
                eq_lines.append(json.dumps({"t": iso(t), "ts": t, "equity": self.eq[i], "cash": self.eq[i], "unrealized": 0.0, "mode": "paper"}))
        (st / "ledger" / "equity.jsonl").write_text("\n".join(eq_lines) + "\n")
        (st / "ledger" / "trades.jsonl").write_text("".join(json.dumps(x) + "\n" for x in self.trade_recs))
        (st / "ledger" / "refused.jsonl").write_text("".join(json.dumps(x) + "\n" for x in sorted(self.refused, key=lambda r: r["t"])))
        (st / "ledger" / "sweeps.jsonl").write_text("".join(json.dumps(x) + "\n" for x in self.sweeps))
        (st / "positions_paper.json").write_text(json.dumps({"updated": self.runs[-1]["t"], "mode": "paper", "positions": self.positions}, indent=1))
        (st / "paper.json").write_text(json.dumps({"cash": self.eq[-1], "start": START, "created": iso(self.slots[0])}))
        sunday = datetime.fromtimestamp(self.now - 12 * 3600, tz=timezone.utc)
        sunday = sunday.fromordinal(sunday.toordinal() - (sunday.weekday() + 1) % 7)
        tr = self.trade_recs
        avg = sum(x["R"] for x in tr) / len(tr)
        (st / "review" / f"{sunday:%Y-%m-%d}.md").write_text(
            f"# Weekly review — {sunday:%Y-%m-%d} (paper)\n\n- Closed trades {len(tr)} · win rate "
            f"{sum(1 for x in tr if x['R'] > 0) / len(tr):.0%} · average {avg:+.2f} R · total {sum(x['R'] for x in tr):+.1f} R\n\n"
            "## Book verdicts\n\n- eth-defi: past 30 trades; compare with holding ETH on the Results tab\n"
            "- bitcoin: too few to judge (needs 30)\n\n## Gates\n\n"
            "- Live at half size needs: 30 closed trades, average above +0.2 R, drawdown under 20%, costs at most 0.12 R per trade.\n")
        if self.sc == "halted":
            since = DP.ts_of(self.runs[-1]["t"]) + 1800
            (st / "HALT").write_text("manual halt")
            (st / "HALT.since").write_text(iso(since, True))
        return st, cfg


def v1_bundle(latest):
    """An old-shape (v1) exec:latest: its top-level keys, no "v", and no money."""
    return {"generated": latest["gen"][:19] + "Z", "date": latest["gen"][:10], "mode": latest["mode"]["eff"],
            "settings": {"version": "1.2", "risk_per_trade_pct": 1.0, "max_positions": 6},
            "books": [], "last_run": {"t": DP.iso_ms(latest["clock"]["last_t"])[:19] + "Z", "mode": "paper", "fresh": True, "counts": {}},
            "runs_today": 3, "next_cycle": None, "positions": {}, "proposals_open": [],
            "pot": {"change_pct": latest["pot"]["chg_pct"], "drawdown_pct": 0.0, "points": latest["pot"]["n_pts"]},
            "trades": [], "stats": {"n": 0}, "refused": [], "refused_total": 0, "refused_counts": {}, "sweeps": [], "review_date": None}


def generate(scenario, out=None, now=None, seed=7, keep=None):
    base = "mature" if scenario in ("v1", "missing") else scenario
    world = World(base, seed, now)
    world.build()
    tmp = Path(keep) if keep else Path(tempfile.mkdtemp(prefix="exec-demo-"))
    if keep and tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        st, cfg = world.write(tmp)
        b = DP.build(st, cfg, world.now)
        if b["unparsed"]:
            raise SystemExit("demo lines the parser could not read:\n" + "\n".join(b["unparsed"][:10]))
        if scenario == "missing":
            del b["latest"]["state"]["thr"], b["latest"]["names"], b["latest"]["runs"]
        out = Path(out or (DEV / ("kv_demo.json" if scenario == "mature" else f"kv_demo_{scenario}.json")))
        docs = DP.doc_texts(ROOT / "docs")
        if scenario == "v1":
            kv = {"exec:latest": DP.dumps(v1_bundle(b["latest"]))}
            kv.update({f"doc:{k}": v for k, v in docs.items()})
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(kv, indent=1, ensure_ascii=False) + "\n")
        else:
            DP.write_kv_json(out, b, docs)
        L = b["latest"]
        print(f"{scenario:8s} → {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: latest {len(DP.dumps(L))} B, "
              f"ledger {len(DP.dumps(b['ledger']))} B · {len(L.get('names', []))} names · {len(L['pos'])} open · "
              f"{b['ledger']['trades']['total']} trades · {len(L.get('runs', []))} runs in 7 d · {len(L['events'])} events · "
              f"{len(world.runs)} run docs")
        return b
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Write demo KV files for cloud/dev/preview.mjs from seeded synthetic state.")
    ap.add_argument("out", nargs="?", help="output KV file (default: cloud/dev/kv_demo[_<scenario>].json)")
    ap.add_argument("--out", dest="out_opt", help="same as the positional output file")
    ap.add_argument("--scenario", choices=SCENARIOS, default="mature")
    ap.add_argument("--all", action="store_true", help="write every scenario to its default file")
    ap.add_argument("--now", type=float, help="anchor the synthetic clock (default: now)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--keep", help="also leave the synthetic state tree in this directory")
    a = ap.parse_args(argv)
    now = a.now if a.now is not None else time.time()
    if a.all:
        for sc in SCENARIOS:
            generate(sc, None, now, a.seed)
    else:
        generate(a.scenario, a.out or a.out_opt, now, a.seed, a.keep)


if __name__ == "__main__":
    sys.exit(main())
