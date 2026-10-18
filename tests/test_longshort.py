"""The long-short book (src/executor/longshort.py) and the shadow agent that runs it (agents/shadow-01), paper only.

  book      dollar-neutral legs, the funding refusal forms each leg from names it could enter on that side, the
            volatility target and gross cap, too few names or an empty leg mean no book, nothing between rebalances
  brake     trips at brake_dd below the peak, stays flat brake_days, lifts at the first rebalance after, peak reset
  universe  ranked by trailing median notional volume known the day before; delisted and thin names not eligible
  paper     shorts: filled below the mark, gain as the price falls, RECEIVE positive funding, stop above, resized and
            closed with the right sign; every long keeps its old numbers (pinned)
  cycle     a daily run opens a balanced book on a rebalance day, holds between rebalances, closes all on the brake
  never live  resolve_mode keeps a shadow agent in paper; go_live.py refuses it even with the override phrase;
            approve.py and the server's request runner refuse it
"""
import json, math, random, unittest
import _path  # noqa: F401
from executor import common as C, cycle as CY, ledger as L, paper as PA, target as TG, longshort as XS, universe as U
import test_cycle as TC
from test_fleet import sandbox, run, ROOT

DAY = 86400
SHADOW = json.loads((ROOT / "agents" / "shadow-01" / "settings.json").read_text())
P = XS.params(SHADOW["target"]["params"])


def make_panel(n_coins=20, days=160, seed=7, last_day=None):
    """A synthetic market: BTC plus n_coins alts, each = beta x BTC + its own drift + noise, ending on last_day (a
    rebalance day unless told otherwise). Volume falls with the coin's index, so the volume ranking is known."""
    rng = random.Random(seed)
    last_day = last_day or (20377 // 7 * 7)                # an epoch day divisible by 7
    d0 = last_day - days + 1
    btc, px = [], 30000.0
    for _ in range(days):
        px *= math.exp(rng.gauss(0.0005, 0.03))
        btc.append(px)
    panel = {"BTC": [{"t": (d0 + i) * DAY, "T": (d0 + i) * DAY + DAY - 1, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1000.0}
                     for i, c in enumerate(btc)]}
    for k in range(n_coins):
        beta, drift, p = 0.8 + 0.05 * (k % 5), (k - n_coins / 2) * 0.003, 10.0 + k
        bars = []
        for i in range(days):
            r_b = math.log(btc[i] / btc[i - 1]) if i else 0.0
            p *= math.exp(beta * r_b + drift + rng.gauss(0, 0.01))
            vol = (n_coins - k + 1) * 1e6 / p                 # notional volume = (n_coins - k + 1) M a day
            bars.append({"t": (d0 + i) * DAY, "T": (d0 + i) * DAY + DAY - 1, "o": p, "h": p * 1.02, "l": p * 0.98, "c": p, "v": vol})
        panel[f"C{k:02d}"] = bars
    return panel


class Book(unittest.TestCase):
    def test_dollar_neutral_legs_vol_target_and_cap(self):
        panel = make_panel()
        elig = [c for c in panel if c != "BTC"]
        w, info = XS.latest(panel, P, elig)
        self.assertTrue(w)
        longs = {c: x for c, x in w.items() if x > 0}
        shorts = {c: x for c, x in w.items() if x < 0}
        k = int(math.floor(P["q"] * info["ranked"]))
        self.assertEqual((len(longs), len(shorts)), (k, k))
        self.assertAlmostEqual(sum(longs.values()), -sum(shorts.values()), places=12)     # equal dollars per side
        self.assertLessEqual(sum(abs(x) for x in w.values()), P["gross_cap"] + 1e-12)
        days = XS.grid(panel)
        G = XS.grid_data(panel, days)
        vol = XS.port_vol(w, G, len(days) - 1, P["cov_days"])
        if sum(abs(x) for x in w.values()) < P["gross_cap"] - 1e-9:
            self.assertAlmostEqual(vol, P["vol_target"], places=9)   # scaled to the volatility target unless capped
        # residual momentum: the strongest drifts are long, the weakest short
        self.assertTrue(all(int(c[1:]) >= 10 for c in longs), longs)
        self.assertTrue(all(int(c[1:]) < 10 for c in shorts), shorts)

    def test_funding_refusal_forms_legs_from_enterable_names(self):
        panel = make_panel()
        elig = [c for c in panel if c != "BTC"]
        w0, _ = XS.latest(panel, P, elig)
        top_long = max((c for c in w0 if w0[c] > 0), key=lambda c: w0[c])
        worst_short = min(w0, key=lambda c: w0[c])
        w1, info = XS.latest(panel, P, elig, no_long={top_long}, no_short={worst_short})
        self.assertNotIn(top_long, w1)                    # refused long: replaced, never a naked short
        self.assertNotIn(worst_short, w1)
        self.assertEqual(len([x for x in w1.values() if x > 0]), len([x for x in w0.values() if x > 0]))
        self.assertAlmostEqual(sum(x for x in w1.values() if x > 0), -sum(x for x in w1.values() if x < 0), places=12)
        self.assertIn(top_long, info["skipped_long"])
        self.assertIn(worst_short, info["skipped_short"])
        # every name of a side refused: no book (flat), never one leg alone
        w2, info2 = XS.latest(panel, P, elig, no_short=set(elig))
        self.assertEqual(w2, {})
        self.assertIn("leg is empty", info2["why"])

    def test_too_few_names_and_between_rebalances(self):
        panel = make_panel()
        w, info = XS.latest(panel, P, ["C00", "C01", "C02"])
        self.assertEqual(w, {})
        self.assertIn("fewer than 12", info["why"])
        off = make_panel(last_day=20377 // 7 * 7 + 3)
        w, info = XS.latest(off, P, [c for c in off if c != "BTC"])
        self.assertIsNone(w)
        self.assertIn("between rebalances", info["why"])

    def test_series_is_causal_and_none_between_rebalances(self):
        panel = make_panel()
        days, W = XS.series(panel, P, None)
        cut = days[-15]
        short = {c: [b for b in bars if b["t"] <= cut] for c, bars in panel.items()}
        d2, W2 = XS.series(short, P, None)
        i = days.index(cut)
        for c in W:
            self.assertEqual(W[c][:i + 1], W2[c][:i + 1])                 # adding later days changes nothing earlier
        for j, d in enumerate(days):
            if not XS.is_rebalance(d, P):
                self.assertTrue(all(W[c][j] is None for c in W))

    def test_only_what_the_engine_implements(self):
        for bad in ({"weighting": "rank"}, {"neutral": "beta"}, {"book": "btc_alt"}, {"score": "beta"}, {"stops": "name"}):
            with self.assertRaises(ValueError):
                XS.params(dict(SHADOW["target"]["params"], **bad))


class Brake(unittest.TestCase):
    def test_trips_stays_flat_and_lifts_at_a_rebalance_with_the_peak_reset(self):
        b = {}
        d = 20377 // 7 * 7
        self.assertEqual(XS.brake_step(b, 1000.0, d, True, True, P), (False, None))
        self.assertEqual(XS.brake_step(b, 1100.0, d + DAY, False, True, P), (False, None))
        self.assertEqual(b["peak"], 1100.0)
        self.assertEqual(XS.brake_step(b, 940.0, d + 2 * DAY, False, True, P), (False, None))      # -14.5%: not yet
        self.assertEqual(XS.brake_step(b, 930.0, d + 3 * DAY, False, True, P), (True, "brake"))    # -15.5%
        self.assertEqual(b["braked_until"], d + 3 * DAY + 28 * DAY)
        self.assertEqual(XS.brake_step(b, 900.0, d + 28 * DAY, True, False, P), (True, None))       # a rebalance, too early
        self.assertEqual(XS.brake_step(b, 900.0, d + 32 * DAY, False, False, P), (True, None))      # past, but no rebalance
        self.assertEqual(XS.brake_step(b, 905.0, d + 35 * DAY, True, False, P), (False, "lift"))
        self.assertEqual(b["peak"], 905.0)
        self.assertEqual(b["brakes"], 1)

    def test_no_brake_while_flat(self):
        b = {"peak": 1000.0}
        self.assertEqual(XS.brake_step(b, 500.0, 0, False, False, P), (False, None))


class Universe(unittest.TestCase):
    def test_rank_by_trailing_median_known_the_day_before(self):
        panel = make_panel()
        day = panel["BTC"][-1]["t"]
        top = XS.rank_by_volume({c: b for c, b in panel.items() if c != "BTC"}, day - DAY, 5, 30, 60)
        self.assertEqual([c for c, _v in top], ["C00", "C01", "C02", "C03", "C04"])
        self.assertAlmostEqual(top[0][1], 21e6, delta=1)
        young = {"NEW": panel["C00"][-30:], "C05": panel["C05"]}
        self.assertEqual([c for c, _ in XS.rank_by_volume(young, day - DAY, 5, 30, 60)], ["C05"])   # 30 bars < 60
        # a spike on the decision day itself is not seen by that day's ranking
        spiked = {c: [dict(x) for x in b] for c, b in panel.items() if c in ("C00", "C10")}
        spiked["C10"][-1]["v"] *= 1000
        self.assertEqual(XS.rank_by_volume(spiked, day - DAY, 1, 30, 60)[0][0], "C00")

    def test_eligible_needs_a_listing_and_the_day_volume(self):
        panel = make_panel()
        day = panel["BTC"][-1]["t"]
        top = [("C00", 1), ("C01", 1), ("C19", 1)]
        ok, no = XS.eligible_today(panel, day, top, {"C00", "C19"}, 2.5e6)
        self.assertEqual(ok, ["C00"])
        self.assertIn("not listed", no["C01"])
        self.assertIn("below", no["C19"])                 # C19 trades 2M a day

    def test_short_side_funding_filter_mirrors_the_long_one(self):
        u = SHADOW["universe"]
        row = {"dayNtlVlm": "5e6", "openInterest": "1e6", "markPx": "10", "maxLeverage": 5, "funding": str(-0.40 / 8760)}
        self.assertTrue(U.check("X", row, u)[0])                       # a long is paid: fine
        ok, why = U.check("X", row, u, None, "short")
        self.assertFalse(ok)
        self.assertIn("against shorts", why[0])
        row["funding"] = str(0.40 / 8760)
        self.assertFalse(U.check("X", row, u)[0])
        self.assertTrue(U.check("X", row, u, None, "short")[0])


S = {"paper_slippage_pct": 0.05, "fee_taker_pct": 0.045}


class PaperShorts(unittest.TestCase):
    def short(self, mark=100.0, notional=500.0):
        cand = {"coin": "X", "kind": "book", "tier": "T", "side": "short", "stop": 150.0, "bar_t": 0}
        return PA.open_position(cand, {"notional": notional, "risk_amt": 250.0, "leverage": 3, "notional_pct_equity": 50}, mark, S, 0)

    def test_open_gain_funding_stop_and_close(self):
        p = self.short()
        self.assertEqual(p["side"], "short")
        self.assertAlmostEqual(p["entry"], 100 * (1 - 0.0005))            # a sale fills below the mark
        eq, unreal = PA.equity({"cash": 1000.0}, {"X": p}, {"X": 90.0})
        self.assertAlmostEqual(unreal, (p["entry"] - 90) / p["entry"] * 500)
        PA.accrue_funding(p, 0.0001, 24 * 3600)                           # shorts receive a positive rate
        self.assertAlmostEqual(p["funding_paid"], -0.0001 * 24 * 500)
        px, t = PA.check_stop(p, [{"t": DAY, "o": 120, "h": 149, "l": 110, "c": 140}], S)
        self.assertIsNone(px)
        px, t = PA.check_stop(p, [{"t": 2 * DAY, "o": 155, "h": 160, "l": 150, "c": 158}], S)
        self.assertAlmostEqual(px, 155 * 1.0005)                          # a gap through the stop is charged in full
        rec = L.build_close(p, 80.0, "test", 3 * DAY, 0.0, p["funding_paid"])
        self.assertGreater(rec["gross"], 0)
        self.assertAlmostEqual(rec["pnl"], rec["gross"] - p["entry_fee"] + 0.0001 * 24 * 500)

    def test_actual_funding_history(self):
        p = self.short()                                    # opened at t=0, value 500 at mark 100
        rows = [{"time": h * 3600 * 1000, "fundingRate": "0.0001"} for h in range(0, 30)]
        n = PA.accrue_funding_history(p, rows, 100.0, 24 * 3600)
        self.assertEqual(n, 24)                             # hours 1..24, never the one at the open, never after now
        self.assertAlmostEqual(p["funding_paid"], -24 * 0.0001 * p["sz"] * 100.0)       # a short receives
        self.assertEqual(p["last_funding_ts"], 24 * 3600)
        self.assertEqual(PA.accrue_funding_history(p, rows, 100.0, 24 * 3600), 0)       # never counted twice
        q = dict(p, side="long", funding_paid=0.0, last_funding_ts=0)
        PA.accrue_funding_history(q, rows, 110.0, 2 * 3600)
        self.assertAlmostEqual(q["funding_paid"], 2 * 0.0001 * q["sz"] * 110.0)       # a long pays, on its value now

    def test_resize_short_both_ways(self):
        p = self.short()
        cash = TG.paper_resize(p, 800.0, 100.0, S)
        self.assertLess(cash, 0)
        self.assertAlmostEqual(p["sz"] * 100.0, 800.0 * (1 + 0.0005) / 1.0, delta=1.0)
        cash = TG.paper_resize(p, 400.0, 90.0, S)                        # buy back below the entry: a realised gain
        self.assertGreater(cash, 0)
        self.assertGreater(p["realized"], 0)

    def test_longs_keep_their_numbers(self):
        """Pinned: the side-aware code leaves every long exactly as before (the old formulas, same operation order)."""
        slip, fee = S["paper_slippage_pct"] / 100, S["fee_taker_pct"] / 100
        cand = {"coin": "X", "kind": "target", "tier": "T", "stop": 85.0, "bar_t": 0}
        p = PA.open_position(cand, {"notional": 500.0, "risk_amt": 75.0, "leverage": 3, "notional_pct_equity": 50}, 100.0, S, 0)
        entry = 100.0 * (1 + slip)
        self.assertEqual((p["side"], p["entry"], p["sz"]), ("long", entry, 500.0 / entry))
        PA.accrue_funding(p, 0.0001, 24 * 3600)
        self.assertEqual(p["funding_paid"], 0.0 + 0.0001 * 24.0 * 500.0)
        u = (110.0 - entry) / entry * 500.0 - p["funding_paid"]
        self.assertEqual(PA.equity({"cash": 1000.0}, {"X": p}, {"X": 110.0}), (1000.0 + u, 0.0 + u))
        q = dict(p)
        cur, px = q["sz"] * 110.0, 110.0 * (1 + slip)
        add = (700.0 - cur) / px
        self.assertEqual(TG.paper_resize(q, 700.0, 110.0, S), -(add * px * fee))
        q = dict(p)
        cur, px = q["sz"] * 90.0, 90.0 * (1 - slip)
        cut = min(q["sz"], (cur - 200.0) / px)
        self.assertEqual(TG.paper_resize(q, 200.0, 90.0, S), (px - entry) * cut - cut * px * fee)
        self.assertEqual(PA.check_stop(dict(p), [{"t": DAY, "o": 90, "h": 91, "l": 80, "c": 82}], S), (85.0 * (1 - slip), DAY))
        rec = L.build_close(p, 120.0, "t", DAY, 0.2, 1.2)
        self.assertEqual(rec["gross"], (120.0 - entry) / entry * 500.0)


class BookCycle(TC.Base):
    def setUp(self):
        super().setUp()
        self._lp = CY.B.last_price
        CY.B.last_price = lambda coin: None
        CY.BOOK.unlink(missing_ok=True)

    def tearDown(self):
        CY.B.last_price = self._lp
        CY.BOOK.unlink(missing_ok=True)
        super().tearDown()

    def book_cycle(self, panel, positions=None, funding=None, eq=1000.0, cash=None, pot_cash=None):
        marks = {c: b[-1]["c"] for c, b in panel.items()}
        cy = self.cycle("paper", positions or {}, {}, marks)
        cy.s = dict(SHADOW)
        cy.bars.get = lambda coin: (panel[coin], panel[coin])
        cy.ctxs = {c: {"szDecimals": 3, "markPx": str(m), "funding": str((funding or {}).get(c, 0.10) / 8760), "maxLeverage": 10,
                       "dayNtlVlm": str(panel[c][-1]["v"] * m), "openInterest": str(5e6 / m)} for c, m in marks.items()}
        cy.pot = {"cash": pot_cash if pot_cash is not None else 1000.0, "start": 1000.0}
        cy.equity = eq
        return cy

    def test_opens_a_balanced_book_and_refuses_correctly(self):
        panel = make_panel()
        cy = self.book_cycle(panel, funding={"C19": 0.45, "C00": -0.45})     # C19 too dear to buy, C00 too dear to short
        cy.manage_book()
        pos = L.positions("paper")
        longs = {c: p for c, p in pos.items() if p["side"] == "long"}
        shorts = {c: p for c, p in pos.items() if p["side"] == "short"}
        self.assertTrue(longs and shorts)
        self.assertNotIn("C19", longs)
        self.assertNotIn("C00", shorts)
        ln, sn = sum(p["notional"] for p in longs.values()), sum(p["notional"] for p in shorts.values())
        self.assertAlmostEqual(ln, sn, delta=0.002 * ln)                  # equal dollars per side (fills differ by slippage)
        for p in pos.values():
            self.assertEqual(p["kind"], "book")
            far = p["stop"] / p["entry"] - 1                                # the catastrophic stop: a short's at twice its
            self.assertAlmostEqual(far, 1.0 if p["side"] == "short" else -1.0, places=9)   # entry, a long's at zero
        book = C.load_json(CY.BOOK)
        self.assertEqual(sorted(book["last_rebalance"]["long"]), sorted(longs))
        self.assertIn("funding", book["last_rebalance"]["refused_long"]["C19"])
        self.assertIn("C00", book["last_rebalance"]["refused_short"])
        self.assertGreater(book["peak"], 0)
        # the next run the same day: nothing to do (inside the band)
        cy2 = self.book_cycle(panel, positions=L.positions("paper"), funding={"C19": 0.45, "C00": -0.45},
                              pot_cash=C.load_json(CY.PA.POT)["cash"])
        n = len(L.trades())
        cy2.manage_book()
        self.assertEqual(len(L.trades()), n)
        self.assertFalse(any("→ open" in x or "→ close" in x for x in cy2.summary))

    def test_a_name_failing_the_sanity_band_is_replaced_not_left_out(self):
        panel = make_panel()
        cy0 = self.book_cycle(panel)
        w0, _ = CY.XS.latest(panel, P, [c for c in panel if c != "BTC"])
        best = max(w0, key=lambda c: w0[c])
        CY.B.last_price = lambda coin: (cy0.marks[coin] * 5 if coin == best else None)    # a broken second source
        cy = self.book_cycle(panel)
        cy.manage_book()
        pos = L.positions("paper")
        self.assertNotIn(best, pos)
        nl, ns = sum(1 for p in pos.values() if p["side"] == "long"), sum(1 for p in pos.values() if p["side"] == "short")
        self.assertEqual(nl, ns)                                              # still balanced: the next name took its place
        self.assertIn("mark vs Binance", C.load_json(CY.BOOK)["last_rebalance"]["refused_long"][best])
        self.assertFalse(any("REFUSED" in x for x in cy.summary))

    def test_between_rebalances_nothing_trades(self):
        panel = make_panel(last_day=20377 // 7 * 7 + 2)
        cy = self.book_cycle(panel)
        cy.manage_book()
        self.assertEqual(L.positions("paper"), {})
        self.assertTrue(any("between rebalances" in x for x in cy.summary))

    def test_brake_closes_everything(self):
        panel = make_panel()
        cy = self.book_cycle(panel)
        cy.manage_book()
        held = L.positions("paper")
        self.assertTrue(held)
        b = C.load_json(CY.BOOK)
        b["peak"] = 2000.0                                                  # the book once stood far higher
        C.write_json(CY.BOOK, b)
        later = make_panel(last_day=20377 // 7 * 7 + 1)
        cy2 = self.book_cycle(later, positions=held, pot_cash=C.load_json(CY.PA.POT)["cash"])
        cy2.marks.update({c: later[c][-1]["c"] for c in held})
        cy2.manage_book()
        self.assertEqual(L.positions("paper"), {})
        self.assertTrue(all(t["reason"] == "book brake" for t in L.trades()[-len(held):]))
        self.assertTrue(any("BOOK BRAKE" in x for x in cy2.summary))
        self.assertEqual(C.load_json(CY.BOOK)["brakes"], 1)

    def test_braked_days_close_what_the_brake_day_could_not(self):
        panel = make_panel()
        cy = self.book_cycle(panel)
        cy.manage_book()
        held = L.positions("paper")
        b = C.load_json(CY.BOOK)
        b["peak"] = 2000.0
        C.write_json(CY.BOOK, b)
        later = make_panel(last_day=20377 // 7 * 7 + 1)
        lost = sorted(held)[0]
        cy2 = self.book_cycle(later, positions=held, pot_cash=C.load_json(CY.PA.POT)["cash"])
        cy2.marks.pop(lost)                                                 # no mark for one name the day it trips
        cy2.manage_book()
        self.assertEqual(sorted(L.positions("paper")), [lost])
        then = make_panel(last_day=20377 // 7 * 7 + 2)
        cy3 = self.book_cycle(then, positions=L.positions("paper"), pot_cash=C.load_json(CY.PA.POT)["cash"])
        cy3.manage_book()                                                   # still braked: it closes the next day
        self.assertEqual(L.positions("paper"), {})
        self.assertTrue(any("book brake on" in x for x in cy3.summary))

    def test_paper_only(self):
        panel = make_panel()
        cy = self.book_cycle(panel)
        cy.mode = "live"
        cy.manage_book()
        self.assertEqual(L.positions("paper"), {})
        self.assertTrue(any("paper" in x for x in cy.summary))


class NeverLive(unittest.TestCase):
    def test_resolve_mode_keeps_shadow_and_shorts_in_paper(self):
        self.assertEqual(CY.resolve_mode(dict(SHADOW, mode="live"))[0], "paper")
        self.assertIn("shadow", CY.resolve_mode(dict(SHADOW, mode="live"))[1])
        no_flag = dict(SHADOW, mode="live")
        no_flag.pop("shadow")
        self.assertEqual(CY.resolve_mode(no_flag)[0], "paper")              # a long-short book alone is paper only too
        for a in json.loads((ROOT / "agents" / "index.json").read_text())["agents"]:
            if a["id"] in ("core", "shadow-01"):
                continue
            s = json.loads((ROOT / "agents" / a["id"] / "settings.json").read_text())
            self.assertEqual(CY.paper_only(s), "", a["id"])                 # no existing agent is touched

    def test_the_shadow_agent_is_declared_plainly(self):
        row = next(a for a in json.loads((ROOT / "agents" / "index.json").read_text())["agents"] if a["id"] == "shadow-01")
        self.assertEqual((row["name"], row["enabled"]), ("S01 Shadow", True))
        self.assertNotIn("arena", row)
        self.assertEqual(row["shadow"]["lab_verdict"], "failed")
        self.assertEqual(row["shadow"]["recipe"], "ls-759fac45")
        self.assertIn("paper only", row["desc"])
        self.assertEqual(SHADOW["mode"], "paper")

    def test_go_live_refuses_even_with_the_override(self):
        home = sandbox()
        for extra in ([], ["--override", "LIVE WITHOUT READY shadow-01"]):
            r = run(home, "scripts/go_live.py", "shadow-01", "--pot", "250", *extra)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("shadow experiment", r.stderr + r.stdout)
        s = json.loads((home / "agents" / "shadow-01" / "settings.json").read_text())
        self.assertEqual(s["mode"], "paper")
        self.assertFalse((home / "agents" / "shadow-01-twin").exists())
        # even with the lab's Ready forged into factory.json
        (home / "factory").mkdir(exist_ok=True)
        (home / "factory" / "factory.json").write_text(json.dumps({"shortlist": [{"agent": "shadow-01", "ready": True}]}))
        r = run(home, "scripts/go_live.py", "shadow-01", "--pot", "250")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(json.loads((home / "agents" / "shadow-01" / "settings.json").read_text())["mode"], "paper")

    def test_approve_refuses(self):
        home = sandbox()
        env_run = lambda *a: run(home, *a)                                  # noqa: E731
        import os, subprocess, sys
        env = dict(os.environ, EXECUTOR_HOME=str(home), EXECUTOR_STATE=str(home / "state" / "agents" / "shadow-01"),
                   EXECUTOR_AGENT="shadow-01", PYTHONPATH=str(ROOT / "src"), ALERT_WEBHOOK="")
        r = subprocess.run([sys.executable, "scripts/approve.py", "--id", "x", "--confirm", "yes"], env=env, capture_output=True, text=True, cwd=str(ROOT))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("shadow experiment", r.stderr + r.stdout)
        req = home / "state" / "requests"
        req.mkdir(parents=True)
        (req / "a-approve.json").write_text(json.dumps({"action": "approve", "agent": "shadow-01", "proposal_id": "abc"}))
        r = env_run("scripts/run_requests.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        done = json.loads((req / "done" / "a-approve.json").read_text())
        self.assertEqual(done["exit"], 2)
        self.assertIn("shadow", done["output"])


if __name__ == "__main__":
    unittest.main()
