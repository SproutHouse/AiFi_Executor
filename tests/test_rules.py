import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
import _path  # noqa: F401
from executor import risk as K, hours as HR, signals as S, universe as U, paper as PA, common as C

S_ = C.settings()


class Hours(unittest.TestCase):
    def m(self, h, mi=0):
        return HR.mode(S_, datetime(2026, 9, 23, h, mi, tzinfo=ZoneInfo("America/Toronto")))[0]

    def test_boundaries(self):
        self.assertEqual(self.m(9, 59), "auto")
        self.assertEqual(self.m(10, 0), "approval")
        self.assertEqual(self.m(21, 59), "approval")
        self.assertEqual(self.m(22, 0), "auto")
        self.assertEqual(self.m(3), "auto")

    def test_next_bar(self):
        self.assertEqual(HR.next_bar_close(1000, 4 * 3600), 4 * 3600)


class Sizing(unittest.TestCase):
    def test_risk_math(self):
        z = K.size(1000.0, 100.0, 96.0, S_, 40)
        self.assertAlmostEqual(z["dist_pct"], 4.0)
        self.assertAlmostEqual(z["risk_amt"], 10.0)
        self.assertAlmostEqual(z["notional"], 250.0)
        self.assertEqual(z["leverage"], 3)
        self.assertAlmostEqual(z["margin"], 250.0 / 3)

    def test_leverage_cap_shrinks_risk(self):
        z = K.size(1000.0, 100.0, 99.75, S_, 40)   # 0.25% stop → 4000 notional wanted
        self.assertAlmostEqual(z["notional"], 3000.0)
        self.assertLess(z["risk_amt"], 10.0)
        self.assertIn("note", z)

    def test_wide_stop_lowers_leverage(self):
        z = K.size(1000.0, 100.0, 80.0, S_, 40)    # 20% stop: (1/3)*0.9=0.30 < 0.40 → lev 2: 0.45 ≥ 0.40
        self.assertEqual(z["leverage"], 2)

    def test_refusals(self):
        self.assertIn("refused", K.size(1000.0, 100.0, 100.0, S_))
        self.assertIn("refused", K.size(1000.0, 100.0, 99.9, S_))          # 0.1% below the minimum distance
        self.assertIn("refused", K.size(20.0, 100.0, 50.0, S_))            # notional 0.4 below minimum

    def test_throttle(self):
        pts = [{"equity": 100}, {"equity": 95}]
        self.assertEqual(K.throttle(pts, S_["throttle"])["multiplier"], 1.0)
        self.assertEqual(K.throttle([{"equity": 100}, {"equity": 89}], S_["throttle"])["multiplier"], 0.5)
        self.assertTrue(K.throttle([{"equity": 100}, {"equity": 79}], S_["throttle"])["halt"])

    def test_pre_trade_caps(self):
        cand = {"coin": "ETH"}
        z = K.size(1000.0, 100.0, 96.0, S_, 40)
        pos = {c: {"risk_amt": 10.0, "notional": 250.0} for c in ("A", "B", "C", "D")}
        ok, checks = K.pre_trade(cand, z, pos, 1000.0, S_, {"fresh": True})
        self.assertFalse(ok)
        self.assertIn("open-risk cap", [c["check"] for c in checks if not c["ok"]])
        ok2, _ = K.pre_trade(cand, z, {}, 1000.0, S_, {"fresh": True})
        self.assertTrue(ok2)
        ok3, checks3 = K.pre_trade(cand, z, {}, 1000.0, S_, {"fresh": False, "fresh_detail": "late"})
        self.assertFalse(ok3)


class Signals(unittest.TestCase):
    def ctx(self, **h4):
        base = {"dir": -1, "prev_dir": 1, "line": 95.0, "close": 100.0, "prev_close": 99.0, "upper": 101.0,
                "lower": 97.0, "prev_upper": 100.5, "trend": 90.0, "t": 0, "T": 1, "range": "In Range"}
        base.update(h4)
        return {"weekly_dir": -1, "daily_dir": -1, "h4": base}

    def test_flip_tier(self):
        c, _ = S.evaluate("ETH", self.ctx(), True); self.assertEqual((c["kind"], c["tier"]), ("flip", "A"))
        c, _ = S.evaluate("ETH", self.ctx(), False); self.assertEqual((c["kind"], c["tier"]), ("flip", "B"))

    def test_pullback(self):
        c, _ = S.evaluate("ETH", self.ctx(prev_dir=-1, prev_close=102.0, close=100.0), True)
        self.assertEqual((c["kind"], c["tier"]), ("pullback", "B"))

    def test_no_trigger_and_regime(self):
        c, why = S.evaluate("ETH", self.ctx(prev_dir=-1, prev_close=100.0), True); self.assertIsNone(c)
        ctx = self.ctx(); ctx["weekly_dir"] = 1
        c, why = S.evaluate("ETH", ctx, True); self.assertIsNone(c); self.assertIn("weekly", why[0])


class Universe(unittest.TestCase):
    def test_filters(self):
        row = {"dayNtlVlm": "50000000", "openInterest": "1000", "markPx": "20000", "maxLeverage": 10, "funding": "0.0000125"}
        ok, why = U.check("BTC", row, S_["universe"], 400); self.assertTrue(ok, why)
        thin = dict(row, dayNtlVlm="1000000"); ok, why = U.check("X", thin, S_["universe"], 400); self.assertFalse(ok)
        young = U.check("X", row, S_["universe"], 100); self.assertFalse(young[0])
        hot = dict(row, funding="0.0001"); self.assertFalse(U.check("X", hot, S_["universe"], 400)[0])   # 87%/yr


class Paper(unittest.TestCase):
    def test_stop_fill_and_trailing_never_lowers(self):
        cand = {"coin": "ETH", "kind": "flip", "tier": "A", "stop": 95.0, "bar_t": 0}
        z = K.size(1000.0, 100.0, 95.0, S_, 40)
        pos = PA.open_position(cand, z, 100.0, S_, 0)
        bars = [{"t": 14400, "o": 100, "h": 101, "l": 99, "c": 100.5}, {"t": 28800, "o": 96, "h": 97, "l": 94, "c": 94.5}]
        px, t = PA.check_stop(pos, bars, S_)
        self.assertEqual(t, 28800)
        self.assertAlmostEqual(px, 95.0 * (1 - S_["paper_slippage_pct"] / 100))
        gap = [{"t": 43200, "o": 90, "h": 91, "l": 89, "c": 90}]
        pos2 = PA.open_position(cand, z, 100.0, S_, 0)
        px2, _ = PA.check_stop(pos2, gap, S_)
        self.assertAlmostEqual(px2, 90 * (1 - S_["paper_slippage_pct"] / 100))


if __name__ == "__main__":
    unittest.main()
