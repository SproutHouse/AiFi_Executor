"""The bull_momentum family (families.py + momentum.py): causal for every gate and every score, independent of where
history starts (the engine sees 1,500 days, the lab sees 2017 onwards), flat when the gate is closed, and runnable
through the cycle's recipe path."""
import random, unittest
import _path  # noqa: F401
from executor import families as F, momentum as MO

DAY = 86400


def walk(n, seed, phases=((0.004, 0.03),), t0=0):
    """Daily bars; phases = ((drift, vol), ...) applied in equal consecutive slices (bull, bear, bull ...)."""
    rng, p, out = random.Random(seed), 100.0, []
    for i in range(n):
        drift, vol = phases[min(len(phases) - 1, i * len(phases) // n)]
        o = p
        p *= 1 + drift + rng.gauss(0, vol)
        out.append({"t": t0 + i * DAY, "T": t0 + i * DAY + DAY - 1, "o": o, "h": max(o, p) * 1.01, "l": min(o, p) * 0.99, "c": p, "v": 1e6 * (1 + rng.random())})
    return out


CYCLE = ((0.004, 0.03), (-0.004, 0.03), (0.004, 0.03), (-0.003, 0.03), (0.003, 0.03))


def panel(n=700, seed=0):
    coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "LINK"]
    return {c: walk(n, seed * 10 + k + 1, tuple((d * (1 + 0.3 * k), v) for d, v in CYCLE)) for k, c in enumerate(coins)}


def regime_of(pn):
    days = sorted({b["t"] for b in pn["BTC"]})
    return {d: ("bull" if (d // DAY // 90) % 2 == 0 else "bear") for d in days}


class Causal(unittest.TestCase):
    def check(self, params, cuts=(260, 333, 420, 555, 699)):
        pn = panel()
        reg = regime_of(pn) if F.needs_regime(params) else None
        days, W = F.targets(pn, "bull_momentum", params, reg, None)
        for cut in cuts:
            tp = {c: b[:cut + 1] for c, b in pn.items()}
            _d, W2 = F.targets(tp, "bull_momentum", params, reg, None)
            for c in pn:
                a, b = W[c][cut], W2[c][-1]
                self.assertEqual(a is None, b is None, f"{params} {c} {cut}")
                if a is not None:
                    self.assertAlmostEqual(a, b, places=12, msg=f"{params} {c} cut {cut}")

    def test_every_gate(self):
        for g in MO.GATES:
            self.check({"gate": g, "gate_n": 50, "rank": "ensemble", "n": 20, "k": 2, "buffer": 1, "breadth_min": 0.5})

    def test_every_score(self):
        for s in MO.SCORES:
            self.check({"gate": "btc_sma", "gate_n": 50, "rank": s, "n": 20, "k": 2, "filter_n": 30})

    def test_hysteresis(self):
        self.check({"gate": "index_sma", "gate_n": 30, "gate_hold": 3, "rank": "multi", "n": 15, "k": 3})

    def test_near_high(self):
        self.check({"gate": "breadth", "gate_n": 50, "rank": "high", "n": 200, "k": 2, "near_high": 0.3})


class StartIndependent(unittest.TestCase):
    def test_late_start_gives_the_same_weights(self):
        """Trim the first 250 days: once the windows are full and the gate has closed once, every weight matches."""
        pn = panel(n=900, seed=3)
        cases = [{"gate": g, "gate_n": 50, "rank": r, "n": 20, "k": 2, "buffer": b, "breadth_min": 0.5}
                 for g in ("btc_sma", "breadth", "index_sma", "vote", "btc_cloud") for r in ("ensemble", "resid", "clenow") for b in (0, 1)]
        for p in cases:
            days, W = F.targets(pn, "bull_momentum", p, None, None)
            late = {c: b[250:] for c, b in pn.items()}
            d2, W2 = F.targets(late, "bull_momentum", p, None, None)
            off = len(days) - len(d2)
            for i in range(len(d2) - 250, len(d2)):
                for c in pn:
                    self.assertEqual(W[c][i + off], W2[c][i], f"{p} {c} day {i}")


class Rules(unittest.TestCase):
    def test_closed_gate_is_flat_and_open_gate_holds_k(self):
        pn = panel()
        p = {"gate": "regime", "rank": "ret", "n": 20, "k": 2, "abs_mom": False}
        reg = regime_of(pn)
        days, W = F.targets(pn, "bull_momentum", p, reg, None)
        held_bull = 0
        for i, d in enumerate(days):
            ws = [W[c][i] for c in pn if W[c][i] is not None]
            if i < 40 or not ws:
                continue
            if reg[d] == "bear":
                self.assertTrue(all(w == 0 for w in ws), d)
            else:
                held_bull += sum(1 for w in ws if w > 0) == 2
        self.assertGreater(held_bull, 200)

    def test_no_gate_reading_is_a_data_gap(self):
        pn = panel()
        gap = pn["BTC"][500]["t"]
        pn["BTC"] = [b for b in pn["BTC"] if b["t"] != gap]
        days, W = F.targets(pn, "bull_momentum", {"gate": "btc_sma", "gate_n": 50}, None, None)
        i = days.index(gap)
        self.assertTrue(all(W[c][i] is None for c in pn))

    def test_near_high_skips_coins_far_below_their_yearly_high(self):
        pn = panel()
        days = sorted({b["t"] for b in pn["BTC"]})
        base = {"gate": "none", "rank": "ret", "n": 20, "k": 3, "abs_mom": False, "rebalance_days": 1}
        _d, W0 = F.targets(pn, "bull_momentum", base, None, None)
        _d, W1 = F.targets(pn, "bull_momentum", dict(base, near_high=0.2), None, None)
        checked = 0
        for i in range(400, len(days)):
            for c, bars in pn.items():
                cl = [b["c"] for b in bars]
                far = cl[i] < 0.8 * max(cl[max(0, i - 364):i + 1])
                if far:
                    self.assertEqual(W1[c][i], 0.0, f"{c} day {i}")
                    checked += 1
        self.assertGreater(checked, 50)
        self.assertNotEqual(W0, W1)

    def test_settings(self):
        with self.assertRaises(ValueError):
            F.params_with_defaults("bull_momentum", {"rank": "astrology"})
        self.assertTrue(F.needs_regime({"gate": "regime"}))
        self.assertFalse(F.needs_regime({"gate": "breadth"}))
        self.assertEqual(F.unused_params("bull_momentum", {"gate": "btc_sma"}), {"breadth_min"})
        self.assertEqual(F.unused_params("bull_momentum", {"gate": "regime"}), {"gate_n", "breadth_min"})
        with self.assertRaises(ValueError):
            F.targets({"ETH": walk(300, 1), "SOL": walk(300, 2)}, "bull_momentum", {"gate": "btc_sma"}, None, None)

    def test_scores_point_the_right_way(self):
        up = [100 * 1.01 ** i for i in range(120)]
        flat = [100 + (i % 2) for i in range(120)]
        for s in ("ret", "skip", "sharpe", "clenow", "high", "smooth", "ma_dist", "multi"):
            self.assertGreater(MO.score(s, up, 118, 30), MO.score(s, flat, 118, 30), s)
        self.assertIsNone(MO.score("ret", up, 10, 30))


class EnginePath(unittest.TestCase):
    def test_target_plan_runs_a_bull_momentum_recipe(self):
        import test_cycle as TC

        class T(TC.Base):
            def runTest(self):
                pass
        t = T()
        t.setUp()
        try:
            pn = panel()
            cfg = {"family": "bull_momentum", "params": {"gate": "regime", "rank": "ensemble", "n": 20, "k": 2},
                   "coins": sorted(pn), "band": 0.25, "stop_pct": 20, "book": "arena"}
            cy = t.cycle("paper", {}, {}, {c: pn[c][-1]["c"] for c in pn})
            cy.bars = type("B", (), {"tf": "1d", "get": lambda self_, c: (pn[c], pn[c])})()
            plan = cy.target_plan(cfg)
            self.assertEqual(set(plan), set(pn))
            ws = [plan[c][0] for c in pn]
            self.assertTrue(all(w is not None and w >= 0 for w in ws))
            self.assertLessEqual(sum(1 for w in ws if w > 0), 2)
        finally:
            t.tearDown()


if __name__ == "__main__":
    unittest.main()
