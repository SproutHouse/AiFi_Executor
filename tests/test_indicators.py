import unittest, json, os, sys
from pathlib import Path
import _path  # noqa: F401
from executor import indicators as I

DESK = Path.home() / "aifi" / "scripts"


class Indicators(unittest.TestCase):
    def test_supertrend_trend_direction(self):
        bars = [{"t": i * 86400, "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1} for i in range(60)]
        st, d = I.supertrend(bars)
        self.assertEqual(d[-1], -1)
        self.assertLess(st[-1], bars[-1]["c"])

    def test_weekly_monday_anchor(self):
        bars = [{"t": 1758499200 + i * 86400, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1} for i in range(14)]  # 2025-09-22 is a Monday
        wk = I.weekly_from_daily(bars)
        self.assertEqual(len(wk), 2)
        from datetime import datetime, timezone
        self.assertEqual(datetime.fromtimestamp(wk[0]["t"], tz=timezone.utc).weekday(), 0)

    @unittest.skipUnless((DESK / "fred_indicators.py").exists(), "desk module not present")
    def test_parity_with_desk(self):
        sys.path.insert(0, str(DESK)); os.environ.setdefault("AIFI_HOME", str(DESK.parent))
        import fred_indicators as F
        with open(Path(__file__).resolve().parent / "fixtures" / "btc_daily.json") as f:
            bars = json.load(f)
        st1, d1 = I.supertrend(bars); st2, d2 = F.supertrend(bars)
        self.assertEqual(d1, d2)
        for a, b in zip(st1, st2):
            if a is not None:
                self.assertAlmostEqual(a, b, places=9)
        e1, e2 = I.ema([b["c"] for b in bars], 36), F.ema([b["c"] for b in bars], 36)
        for a, b in zip(e1, e2):
            if a is not None:
                self.assertAlmostEqual(a, b, places=9)


if __name__ == "__main__":
    unittest.main()
