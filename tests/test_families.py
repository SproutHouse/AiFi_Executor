"""Strategy families (families.py) and the market regime (market_regime.py): the shared code the AiFi Lab backtests
and the engine trades. Parity with the original Trend rule, causality (no lookahead), the long-or-flat engine guard,
and the recipe path through the cycle against a fake exchange."""
import math, random, unittest
import _path  # noqa: F401
from executor import families as F, market_regime as MR, target as TG, common as C
import test_cycle as TC


def walk(n=700, seed=1, drift=0.0006, vol=0.03, t0=0):
    rng, p, out = random.Random(seed), 100.0, []
    for i in range(n):
        r = drift + rng.gauss(0, vol)
        o = p
        p *= 1 + r
        out.append({"t": t0 + i * 86400, "T": t0 + i * 86400 + 86399, "o": o, "h": max(o, p) * 1.01, "l": min(o, p) * 0.99, "c": p, "v": 1e6})
    return out


TREND = {"sma": 50, "vol_target": 0.30, "cap_x": 2.0, "vol_days": 30, "band": 0.25, "stop_pct": 15, "weights": {"BTC": 0.5, "ETH": 0.5}}


class Parity(unittest.TestCase):
    def test_sma_trend_equals_the_trend_rule_every_day(self):
        panel = {"BTC": walk(seed=2), "ETH": walk(seed=3)}
        fam, params, alloc, coins = F.from_target_cfg(TREND)
        days, W = F.targets(panel, fam, params, None, alloc)
        checked = 0
        for i in range(120, len(days)):
            for c in coins:
                w, _why = TG.weight(panel[c][:i + 1], TREND)
                self.assertIsNotNone(w)
                self.assertAlmostEqual(W[c][i], w * alloc[c], places=9)
                checked += 1
        self.assertGreater(checked, 1000)

    def test_latest_is_the_last_value(self):
        panel = {"BTC": walk(seed=4), "ETH": walk(seed=5)}
        days, W = F.targets(panel, "tsmom", {"n": 60}, None, None)
        lt = F.latest(panel, "tsmom", {"n": 60}, None, None)
        for c in panel:
            self.assertAlmostEqual(lt[c][0], W[c][-1])


class Causality(unittest.TestCase):
    def test_every_family_ignores_the_future(self):
        panel = {c: walk(seed=s, n=500) for c, s in (("BTC", 7), ("ETH", 8), ("SOL", 9), ("XRP", 10))}
        alloc = {c: 0.25 for c in panel}
        cases = {"sma_trend": {"n": 40}, "tsmom": {"n": 30}, "dual_ma": {"fast": 10, "slow": 40}, "donchian": {"n": 30, "m": 10},
                 "cloud_trend": {"factor": 3.0, "atr": 10}, "rs_rotation": {"n": 20, "k": 2, "rebalance_days": 5, "filter_n": 30},
                 "meanrev": {"n": 20, "k": 1.5, "trend_n": 100}}
        for fam, p in cases.items():
            days, W = F.targets(panel, fam, p, None, alloc)
            for cut in (250, 333, 420, 499):
                tp = {c: b[:cut + 1] for c, b in panel.items()}
                _d, W2 = F.targets(tp, fam, p, None, alloc)
                for c in panel:
                    a, b = W[c][cut], W2[c][-1]
                    self.assertEqual(a is None, b is None, f"{fam} {c} {cut}")
                    if a is not None:
                        self.assertAlmostEqual(a, b, places=12, msg=f"{fam} {c} cut {cut}")

    def test_gross_cap_and_regime_gate(self):
        panel = {c: walk(seed=s, n=400, drift=0.004, vol=0.01) for c, s in (("BTC", 1), ("ETH", 2))}
        days, W = F.targets(panel, "sma_trend", {"n": 20, "cap_x": 3.0, "vol_target": 0.6, "gross_cap": 1.0}, None, None)
        for i in range(len(days)):
            tot = sum(abs(W[c][i] or 0) for c in panel)
            self.assertLessEqual(tot, 1.0 + 1e-9)
        regime = {d: ("bear" if (d // 86400) % 2 else "bull") for d in days}
        _d, W2 = F.targets(panel, "sma_trend", {"n": 20, "long_regimes": ["bull"]}, regime, None)
        for i, d in enumerate(days):
            if regime[d] == "bear":
                for c in panel:
                    self.assertIn(W2[c][i], (0.0, None))


class Regime(unittest.TestCase):
    def test_labels(self):
        up = walk(n=600, seed=11, drift=0.004, vol=0.01)
        self.assertEqual(MR.now(up), "bull")
        down = walk(n=600, seed=12, drift=-0.004, vol=0.01)
        self.assertIn(MR.now(down), ("bear", "crisis"))
        self.assertIsNone(MR.now(up[:150]))

    def test_crisis_is_immediate_and_other_changes_wait(self):
        bars = walk(n=520, seed=13, drift=0.003, vol=0.01)
        p = bars[-1]["c"]
        for k in range(12):                           # a violent fall: vol spikes, price under its 50-day average
            p *= 0.88 if k % 2 == 0 else 1.03
            t = bars[-1]["t"] + 86400
            bars.append({"t": t, "T": t + 86399, "o": p, "h": p * 1.02, "l": p * 0.95, "c": p, "v": 1})
        ls = MR.labels(bars)
        self.assertEqual(MR.coarse(ls[-1]), "crisis")


class EngineRecipe(TC.Base):
    """A recipe block (family + params + coins) runs through the cycle's target path and opens at the family's weight."""
    def test_recipe_opens_at_family_weight(self):
        panel = {"BTC": walk(seed=21, drift=0.003, vol=0.02), "ETH": walk(seed=22, drift=0.003, vol=0.02)}
        s = dict(C.settings())
        cfg = {"family": "tsmom", "params": {"n": 60, "vol_target": 0.3, "cap_x": 2.0, "vol_days": 30}, "coins": ["BTC", "ETH"],
               "band": 0.25, "stop_pct": 15, "book": "arena"}
        marks = {c: panel[c][-1]["c"] for c in panel}
        cy = self.cycle("paper", {}, {}, marks)
        cy.s = dict(s, strategy="target", target=cfg, gross_exposure_cap_x=3.0)
        cy.bars = type("B", (), {"tf": "1d", "get": lambda self_, c: (panel[c], panel[c])})()
        CYB, CYU = TC.CY.B.last_price, TC.CY.U.check
        TC.CY.B.last_price = lambda coin: marks.get(coin)
        TC.CY.U.check = lambda coin, row, u, d=None: (True, [])
        try:
            cy.ctxs = {c: {"szDecimals": 5, "markPx": str(m), "funding": "0.00001", "maxLeverage": 10, "dayNtlVlm": "1e9", "openInterest": "1e9"} for c, m in marks.items()}
            cy.manage_targets()
        finally:
            TC.CY.B.last_price, TC.CY.U.check = CYB, CYU
        plan = F.latest(panel, "tsmom", cfg["params"], None, {"BTC": 0.5, "ETH": 0.5})
        for c in panel:
            w = plan[c][0]
            if w and w > 0:
                self.assertIn(c, cy.positions)
                self.assertAlmostEqual(cy.positions[c]["sz"] * marks[c] / 1000.0, w, delta=0.01)
            else:
                self.assertNotIn(c, cy.positions)

    def test_short_weight_is_held_flat(self):
        panel = {"BTC": walk(seed=31, drift=-0.004, vol=0.01)}
        cfg = {"family": "sma_trend", "params": {"n": 50, "short": True}, "coins": ["BTC"], "band": 0.25, "stop_pct": 15}
        cy = self.cycle("paper", {}, {}, {"BTC": panel["BTC"][-1]["c"]})
        cy.bars = type("B", (), {"tf": "1d", "get": lambda self_, c: (panel[c], panel[c])})()
        plan = cy.target_plan(cfg)
        self.assertEqual(plan["BTC"][0], 0.0)
        self.assertIn("held flat", plan["BTC"][1])


if __name__ == "__main__":
    unittest.main()
