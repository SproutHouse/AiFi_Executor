"""Target-weight mode (docs/specs/TREND.md): the rule, the band, paper resizing, and the cycle's paper and live paths
against a fake exchange. Live safety: a trim is reduce-only, and the resident stop is replaced at the new size."""
import math, unittest
import _path  # noqa: F401
from executor import common as C, target as TG, ledger as L, paper as PA
import test_cycle as TC

CFG = {"sma": 50, "vol_target": 0.30, "cap_x": 2.0, "vol_days": 30, "band": 0.25, "stop_pct": 15, "weights": {"BTC": 0.5, "ETH": 0.5}}


def bars(closes):
    return [{"t": i * 86400, "T": i * 86400 + 86399, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1} for i, c in enumerate(closes)]


def trending(up=True, n=80, vol=0.02):
    out, p = [], 100.0
    for i in range(n):
        p *= 1 + (vol if i % 2 == 0 else -vol * 0.5) * (1 if up else -1)
        out.append(p)
    return out


class Rule(unittest.TestCase):
    def test_above_average_gives_vol_scaled_weight(self):
        w, why = TG.weight(bars(trending(True)), CFG)
        self.assertGreater(w, 0)
        self.assertLessEqual(w, 2.0)
        self.assertIn("above its 50-day average", why)

    def test_below_average_is_flat(self):
        w, why = TG.weight(bars(trending(False)), CFG)
        self.assertEqual(w, 0.0)
        self.assertIn("at or below", why)

    def test_not_enough_history(self):
        w, why = TG.weight(bars([100.0] * 20), CFG)
        self.assertIsNone(w)

    def test_cap(self):
        calm = [100 + i * 0.01 for i in range(80)]
        w, _ = TG.weight(bars(calm), CFG)
        self.assertEqual(w, 2.0)

    def test_band_decisions(self):
        self.assertEqual(TG.decide(0, 100, 0.25), "open")
        self.assertEqual(TG.decide(100, 0, 0.25), "close")
        self.assertEqual(TG.decide(0, 0, 0.25), "none")
        self.assertEqual(TG.decide(100, 120, 0.25), "hold")
        self.assertEqual(TG.decide(100, 140, 0.25), "increase")
        self.assertEqual(TG.decide(100, 70, 0.25), "decrease")


class PaperResize(unittest.TestCase):
    def test_increase_averages_entry_and_charges_fee(self):
        s = C.settings()
        pos = {"coin": "BTC", "entry": 100.0, "sz": 1.0, "notional": 100.0, "entry_fee": 0.0}
        cash = TG.paper_resize(pos, 200.0, 110.0, s)
        self.assertLess(cash, 0)
        self.assertGreater(pos["sz"], 1.0)
        self.assertTrue(100.0 < pos["entry"] < 110.1)

    def test_decrease_realises_pnl_on_the_cut(self):
        s = C.settings()
        pos = {"coin": "BTC", "entry": 100.0, "sz": 2.0, "notional": 200.0, "entry_fee": 0.0}
        cash = TG.paper_resize(pos, 110.0, 110.0, s)
        self.assertAlmostEqual(pos["sz"], 1.0, places=2)
        self.assertGreater(cash, 0)
        self.assertAlmostEqual(pos["realized"], cash)

    def test_realized_counts_in_the_closing_record(self):
        pos = PA.open_position({"coin": "BTC", "kind": "target", "tier": "T", "stop": 85.0, "book": "trend", "benchmark": "BTC", "bench_mark": 100.0},
                               {"notional": 200.0, "risk_amt": 30.0, "leverage": 3, "notional_pct_equity": 20.0}, 100.0, C.settings(), 0)
        pos["realized"] = 5.0
        rec = L.build_close(pos, pos["entry"], "below its average", 86400, 0.0, 0.0)
        self.assertAlmostEqual(rec["pnl"], 5.0 - pos["entry_fee"])


class TargetCycle(TC.Base):
    def cycle_t(self, mode, positions, daily, marks, ex=None, exch_pos=None, eq=1000.0):
        cy = self.cycle(mode, positions, {c: daily for c in marks}, marks, ex=ex, exch_pos=exch_pos)
        s = dict(cy.s, strategy="target", trigger_tf="1d", target=CFG, gross_exposure_cap_x=3.0)
        cy.s = s
        cy.bars.get = lambda coin: (daily, daily)
        cy.equity = eq
        TC.CY.B.last_price = lambda coin: None
        TC.CY.U.check = lambda coin, row, u, days=None: (True, [])
        return cy

    def test_paper_open_then_hold_inside_band(self):
        up = bars(trending(True))
        cy = self.cycle_t("paper", {}, up, {"BTC": up[-1]["c"], "ETH": up[-1]["c"]})
        cy.manage_targets()
        self.assertEqual(set(L.positions("paper")), {"BTC", "ETH"})
        p = L.positions("paper")["BTC"]
        self.assertAlmostEqual(p["stop"], p["entry"] * 0.85, places=6)
        before = dict(p)
        cy2 = self.cycle_t("paper", L.positions("paper"), up, {"BTC": up[-1]["c"], "ETH": up[-1]["c"]})
        cy2.manage_targets()
        self.assertAlmostEqual(L.positions("paper")["BTC"]["sz"], before["sz"])
        self.assertTrue(any("→ hold" in x for x in cy2.summary))

    def test_paper_close_when_below_average(self):
        up, down = bars(trending(True)), bars(trending(False))
        cy = self.cycle_t("paper", {}, up, {"BTC": up[-1]["c"]})
        cy.s["target"] = dict(CFG, weights={"BTC": 0.5})
        cy.manage_targets()
        self.assertIn("BTC", L.positions("paper"))
        cy2 = self.cycle_t("paper", L.positions("paper"), down, {"BTC": up[-1]["c"]})
        cy2.s["target"] = dict(CFG, weights={"BTC": 0.5})
        cy2.manage_targets()
        self.assertNotIn("BTC", L.positions("paper"))
        self.assertEqual(L.trades()[-1]["reason"], "below its average")

    def test_refused_when_halted_but_close_still_happens(self):
        up, down = bars(trending(True)), bars(trending(False))
        cy = self.cycle_t("paper", {}, up, {"BTC": up[-1]["c"]})
        cy.s["target"] = dict(CFG, weights={"BTC": 0.5})
        cy.halt = True
        cy.manage_targets()
        self.assertNotIn("BTC", L.positions("paper"))
        self.assertTrue(any("REFUSED" in x and "not halted" in x for x in cy.summary))

    def test_live_trim_is_reduce_only_and_stop_follows(self):
        ex = TC.FakeEx({"close": TC.FILL(100.0, 1.0)})
        ex.script["entry"] = TC.FILL(100.0, 0.5)
        up = bars(trending(True))
        pos = TC.paper_pos("BTC", stop=85.0)
        pos.update({"mode": "live", "sz": 20.0, "entry": up[-1]["c"], "stop_cloid": "0xold"})
        cy = self.cycle_t("live", {"BTC": pos}, up, {"BTC": up[-1]["c"]}, ex=ex, exch_pos={"BTC": {"szi": 20.0, "entryPx": up[-1]["c"]}})
        cy.s["target"] = dict(CFG, weights={"BTC": 0.5})
        trims = []
        TC.CY.LV.reduce_ioc = lambda e, coin, sz, px, cl: (trims.append((coin, sz)), e.order(coin, False, sz, px, {"limit": {"tif": "Ioc"}}, reduce_only=True, cloid=cl))[1]
        cy.manage_targets()
        kinds = [(c[0], c[-1]) if c[0] != "cancel" else ("cancel", None) for c in ex.calls]
        self.assertTrue(trims, "expected a trim")
        entry_calls = [c for c in ex.calls if c[0] == "entry"]
        self.assertTrue(all(c[4] is True for c in entry_calls), "every sell in a trim must be reduce-only")
        self.assertIn("stop", [c[0] for c in ex.calls])
        self.assertLess(cy.positions["BTC"]["sz"], 20.0)


if __name__ == "__main__":
    unittest.main()
