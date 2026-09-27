"""Carry mode (docs/specs/CARRY.md): the rule, allocation, honest maker fills, funding on the short leg, the full
paper lifecycle with capture efficiency, the safety override, and live carry refusing to run until validated."""
import unittest
import _path  # noqa: F401
from executor import common as C, carry as CA, cycle as CY, ledger as L, live as LV
import test_cycle as TC

CFG = {"basket": ["HYPE"], "window_hours": 24, "enter_apr": 0.10, "exit_apr": 0.0, "per_asset_cap": 0.30, "perp_leverage": 2,
       "maker_offset_bps": 2, "requote_hours": 3, "delta_band": 0.02, "max_unhedged_hours": 3, "min_spot_vol_m": 0.5,
       "max_basis_pct": 1.0, "crisis_unwind": True,
       "fees": {"spot_maker": 0.0004, "perp_maker": 0.00015, "spot_taker": 0.0007, "perp_taker": 0.00045}}
H_MS = 3600 * 1000


def fund_rows(now_ms, rate, hours=30):
    return [{"time": now_ms - k * H_MS, "fundingRate": str(rate)} for k in range(hours, 0, -1)]


class Pure(unittest.TestCase):
    def test_mean_and_decide(self):
        now = 1790000000000
        apr = CA.mean_apr(fund_rows(now, 0.0000125), now)
        self.assertAlmostEqual(apr, 0.0000125 * 8760, places=6)
        self.assertEqual(CA.decide(0.12, False, CFG), "enter")
        self.assertEqual(CA.decide(0.08, False, CFG), "none")
        self.assertEqual(CA.decide(0.05, True, CFG), "hold")          # hysteresis: stays in until below exit
        self.assertEqual(CA.decide(-0.01, True, CFG), "exit")
        self.assertEqual(CA.decide(None, True, CFG), "hold")

    def test_allocation(self):
        self.assertAlmostEqual(CA.target_notional(1000, 1, CFG), 1000 * 0.30 / 1.5)
        self.assertAlmostEqual(CA.target_notional(1000, 5, CFG), 1000 * 0.20 / 1.5)

    def test_fill_only_through_and_after_placement(self):
        o = {"side": "buy", "px": 100.0, "sz": 1, "t": 7200}
        self.assertIsNone(CA.paper_fill(o, [{"t": 3600, "l": 90, "h": 110}]))       # opened before placement
        self.assertIsNone(CA.paper_fill(o, [{"t": 7200, "l": 100.0, "h": 110}]))    # touched, not through
        self.assertEqual(CA.paper_fill(o, [{"t": 7200, "l": 99.9, "h": 110}]), 100.0)
        s = {"side": "sell", "px": 100.0, "sz": 1, "t": 0}
        self.assertEqual(CA.paper_fill(s, [{"t": 0, "l": 90, "h": 100.1}]), 100.0)

    def test_funding_goes_to_the_short(self):
        pos = {"legs": {"spot": {"sz": 1.0, "entry": 100}, "perp": {"sz": 1.0, "entry": 100}}, "target_n": 100.0, "last_funding_ts": 0}
        got = CA.accrue(pos, [{"time": 1, "fundingRate": "0.0001"}, {"time": 2, "fundingRate": "-0.00005"}], 100.0, True)
        self.assertAlmostEqual(got, 100 * 0.00005)
        self.assertEqual(pos["last_funding_ts"], 2)
        self.assertEqual(CA.accrue(pos, [{"time": 2, "fundingRate": "0.01"}], 100.0, True), 0.0)   # never counted twice


class Lifecycle(TC.Base):
    def setup_cycle(self, pos, rate, spot_bars, perp_bars, now):
        cy = self.cycle("paper", pos, {}, {"HYPE": 30.0})
        cy.s = dict(cy.s, strategy="carry", carry=CFG)
        cy.now = now
        CY.H.spot_pairs = lambda: {"HYPE": {"pair": "@107", "token": "HYPE", "szd": 2, "vol": 5e6, "mid": 30.0}}
        CY.H.all_mids = lambda: {"@107": 30.0}
        CY.H.funding_history = lambda coin, start: fund_rows(now * 1000, rate)
        CY.H.candles = lambda name, tf, days: spot_bars if name.startswith("@") else perp_bars
        return cy

    def tearDown(self):
        super().tearDown()
        import importlib
        from executor import hl_data
        importlib.reload(hl_data)
        CY.H = hl_data

    def test_full_lifecycle(self):
        t0 = 1790000000
        cy = self.setup_cycle({}, 0.00002, [], [], t0)                     # 17.5%/yr: enter
        cy.manage_carry()
        pos = cy.positions["HYPE"]
        self.assertEqual(pos["state"], "entering")
        self.assertEqual({k: v["side"] for k, v in pos["orders"].items()}, {"spot": "buy", "perp": "sell"})
        # next hour: bars that opened after placement trade through both orders
        bars = [{"t": t0 + 100, "o": 30, "h": 30.2, "l": 29.8, "c": 30}]
        cy2 = self.setup_cycle(cy.positions, 0.00002, bars, bars, t0 + 3700)
        cy2.manage_carry()
        pos = cy2.positions["HYPE"]
        self.assertEqual(pos["state"], "open")
        self.assertGreater(pos["legs"]["spot"]["sz"], 0)
        self.assertAlmostEqual(pos["legs"]["spot"]["sz"], pos["legs"]["perp"]["sz"], places=1)
        self.assertGreater(pos["funding_income"], 0)
        # funding turns negative: exit, legs unwind with maker orders, then close with a capture figure
        cy3 = self.setup_cycle(cy2.positions, -0.00001, [], [], t0 + 7300)
        cy3.manage_carry()
        self.assertEqual(cy3.positions["HYPE"]["state"], "exiting")
        bars2 = [{"t": t0 + 7400, "o": 30, "h": 30.2, "l": 29.8, "c": 30}]
        cy4 = self.setup_cycle(cy3.positions, -0.00001, bars2, bars2, t0 + 10900)
        cy4.manage_carry()
        self.assertNotIn("HYPE", cy4.positions)
        rec = L.trades()[-1]
        self.assertEqual(rec["kind"], "carry")
        self.assertIsNotNone(rec["capture"])
        self.assertTrue(any("carry CLOSED" in x for x in cy4.summary))

    def test_refused_without_spot_liquidity(self):
        cy = self.setup_cycle({}, 0.00002, [], [], 1790000000)
        CY.H.spot_pairs = lambda: {"HYPE": {"pair": "@107", "token": "HYPE", "szd": 2, "vol": 1e5, "mid": 30.0}}
        cy.manage_carry()
        self.assertNotIn("HYPE", cy.positions)
        self.assertTrue(any("REFUSED" in x and "spot 24h volume" in x for x in cy.summary))

    def test_safety_override_after_unhedged_hours(self):
        t0 = 1790000000
        pos = {"HYPE": {"coin": "HYPE", "kind": "carry", "state": "entering", "target_n": 200.0, "capital": 300.0, "opened_ts": t0,
                        "last_funding_ts": t0 * 1000, "legs": {"spot": {"pair": "@107", "sz": 6.66, "entry": 30.0, "mark": 30.0},
                        "perp": {"sz": 0.0, "entry": 0.0}}, "orders": {}, "stuck_since": t0}}
        cy = self.setup_cycle(pos, 0.00002, [], [], t0 + 3 * 3600 + 60)
        cy.manage_carry()
        p = cy.positions["HYPE"]
        self.assertAlmostEqual(p["legs"]["perp"]["sz"] * 30.0, p["legs"]["spot"]["sz"] * 30.0, delta=5.0)
        self.assertTrue(any("safety override" in x for x in cy.summary))


class LiveGuard(unittest.TestCase):
    def test_live_carry_falls_back_to_paper(self):
        s = dict(C.settings(), mode="live", strategy="carry")
        mode, note = CY.resolve_mode(s)
        self.assertEqual(mode, "paper")
        self.assertIn("not validated on testnet", note)

    def test_maker_is_post_only(self):
        ex = TC.FakeEx()
        LV.maker(ex, "@107", True, 1.0, 30.0, "c1")
        self.assertEqual(ex.calls[0][0], "entry")
        calls = []
        class E:
            def order(self, *a, **k):
                calls.append((a, k))
        LV.maker(E(), "@107", True, 1.0, 30.0, "c1")
        self.assertEqual(calls[0][0][4], {"limit": {"tif": "Alo"}})


if __name__ == "__main__":
    unittest.main()
