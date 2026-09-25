"""Cycle tests with a fake exchange and fake readings. They exercise the paths that touch capital:
write-through persistence, data-gap handling, close-before-cancel, fail-closed entries, recovery after a
timeout, trailing that never lowers, and absorbing a stop the exchange fired."""
import os, unittest
from pathlib import Path
import _path  # noqa: F401
from executor import common as C, cycle as CY, ledger as L, paper as PA, live as LV, hl_data as H, risk as K

STATE = Path(os.environ["EXECUTOR_STATE"])
FILL = lambda px, sz: {"status": "ok", "response": {"type": "order", "data": {"statuses": [{"filled": {"totalSz": str(sz), "avgPx": str(px), "oid": 1}}]}}}
RESTING = {"status": "ok", "response": {"type": "order", "data": {"statuses": [{"resting": {"oid": 2}}]}}}
ERROR = {"status": "ok", "response": {"type": "order", "data": {"statuses": [{"error": "Reduce only order would increase position."}]}}}


class FakeCloid:
    def __init__(self, s):
        self.s = s

    def to_raw(self):
        return self.s


class FakeEx:
    """Records every call; `script` maps entry/stop/cancel/close to a response or an exception."""
    def __init__(self, script=None):
        self.calls, self.script = [], script or {}

    def _play(self, kind, default):
        r = self.script.get(kind, default)
        if isinstance(r, Exception):
            raise r
        return r

    def update_leverage(self, lev, coin, is_cross=True):
        self.calls.append(("update_leverage", coin, lev))
        return {"status": "ok"}

    def order(self, coin, is_buy, sz, px, order_type, reduce_only=False, cloid=None):
        kind = "stop" if "trigger" in order_type else "entry"
        self.calls.append((kind, coin, sz, px, reduce_only))
        return self._play(kind, RESTING if kind == "stop" else FILL(px, sz))

    def cancel_by_cloid(self, coin, cloid):
        self.calls.append(("cancel", coin))
        return self._play("cancel", {"status": "ok"})

    def market_close(self, coin, sz=None, px=None, slippage=None, cloid=None, builder=None):
        self.calls.append(("market_close", coin, sz))
        return self._play("close", FILL(99.0, 2.5))


class FakeBars:
    def __init__(self, table):
        self.table = table

    def get(self, coin):
        v = self.table.get(coin, [])
        if isinstance(v, Exception):
            raise v
        return coin, v          # regime.context is patched to key its answer on this first element


CTX = {}


def fake_context(d, h, now, ind):
    return CTX[d]


def ctx(weekly=-1, daily=-1, h4=-1, line=97.0):
    h = None if h4 is None else {"dir": h4, "prev_dir": -1, "line": line, "close": 100.0, "prev_close": 100.0, "upper": 101.0,
                                 "lower": 96.0, "prev_upper": 101.0, "trend": 90.0, "t": 0, "T": 14399, "range": "In Range"}
    return {"weekly_dir": weekly, "daily_dir": daily, "days": 400, "h4": h}


def paper_pos(coin, stop=95.0):
    """A paper long opened now at 100 with the given stop; the benchmark's mark at entry equals the coin's."""
    cand = {"coin": coin, "kind": "flip", "tier": "A", "stop": stop, "bar_t": 0, "book": "eth-defi", "benchmark": "ETH", "bench_mark": 100.0}
    z = K.size(1000.0, 100.0, stop, C.settings(), 40)
    pos = PA.open_position(cand, z, 100.0, C.settings(), C.now_ts())
    pos["last_bar_t"] = 0          # so the synthetic bars at t=14400/28800 count as "after the signal bar"
    return pos


class Base(unittest.TestCase):
    def setUp(self):
        self._settings, self._context, self._sleep = C.settings, CY.R.context, CY.time.sleep
        self._lv = {n: getattr(CY.LV, n) for n in ("creds", "available", "new_cloid", "cloid_from", "account")}
        self._fills = CY.H.user_fills
        CY.R.context, CY.time.sleep = fake_context, (lambda s: None)
        for f in ("positions_paper.json", "positions_live.json", "paper.json", "ledger/trades.jsonl", "ledger/refused.jsonl", "HALT"):
            p = STATE / f
            if p.exists():
                p.unlink()
        CTX.clear()

    def tearDown(self):
        C.settings, CY.R.context, CY.time.sleep = self._settings, self._context, self._sleep
        for n, f in self._lv.items():
            setattr(CY.LV, n, f)
        CY.H.user_fills = self._fills

    def cycle(self, mode, positions, bars, marks, ex=None, exch_pos=None):
        s = dict(self._settings())
        s["mode"] = mode
        C.settings = lambda: s
        if mode == "live":
            CY.LV.creds, CY.LV.available = (lambda: ("0xkey", "0xaddr")), (lambda: True)
            CY.LV.new_cloid, CY.LV.cloid_from = (lambda: FakeCloid("0x" + "ab" * 16)), (lambda r: r)
            CY.LV.account = lambda addr: (1000.0, exch_pos or {}, {})
        cy = CY.Cycle(dry=False)
        cy.mode, cy.ex, cy.addr = mode, ex, "0xaddr"
        cy.positions, cy.marks = positions, marks
        cy.ctxs = {c: {"szDecimals": 3, "markPx": str(m), "funding": "0.0000125", "maxLeverage": 10} for c, m in marks.items()}
        cy.btc, cy.btc_bull, cy.fresh, cy.fresh_detail = {"weekly_dir": -1, "daily_dir": -1}, True, True, "test"
        cy.pot = {"cash": 1000.0, "start": 1000.0}
        cy.equity, cy.unreal, cy.cash = 1000.0, 0.0, 1000.0
        cy.exch_pos, cy.bars = exch_pos or {}, FakeBars(bars)
        cy.persist()
        return cy


class PaperExits(Base):
    def test_stop_hit_is_persisted_even_if_another_coin_fails(self):
        bars = {"ETH": [{"t": 14400, "T": 28799, "o": 100, "h": 101, "l": 99, "c": 100.5},
                        {"t": 28800, "T": 43199, "o": 96, "h": 97, "l": 94, "c": 94.5}],
                "SOL": RuntimeError("api down")}
        CTX.update({"ETH": ctx(), "SOL": ctx()})
        cy = self.cycle("paper", {"ETH": paper_pos("ETH"), "SOL": paper_pos("SOL")}, bars, {"ETH": 100.0, "SOL": 100.0})
        cy.manage_exits()
        on_disk = L.positions("paper")
        self.assertNotIn("ETH", on_disk)
        self.assertIn("SOL", on_disk)
        tr = L.trades()
        self.assertEqual(len(tr), 1)
        self.assertEqual(tr[0]["reason"], "stop")
        self.assertLess(tr[0]["R"], 0)
        self.assertTrue(any("exit management failed" in x for x in cy.summary))

    def test_no_reading_keeps_position_and_stop(self):
        CTX["ETH"] = ctx(weekly=None, line=99.0)
        cy = self.cycle("paper", {"ETH": paper_pos("ETH", stop=95.0)}, {"ETH": []}, {"ETH": 100.0})
        cy.manage_exits()
        self.assertIn("ETH", cy.positions)
        self.assertEqual(cy.positions["ETH"]["stop"], 95.0)
        self.assertTrue(any("no reading" in x for x in cy.summary))
        self.assertEqual(L.trades(), [])

    def test_bearish_daily_closes_at_mark(self):
        CTX["ETH"] = ctx(daily=1)
        cy = self.cycle("paper", {"ETH": paper_pos("ETH")}, {"ETH": []}, {"ETH": 104.0})
        cy.manage_exits()
        self.assertNotIn("ETH", L.positions("paper"))
        tr = L.trades()
        self.assertEqual(tr[0]["reason"], "daily flip")
        self.assertGreater(tr[0]["R"], 0)

    def test_trail_never_lowers(self):
        CTX["ETH"] = ctx(line=93.0)
        cy = self.cycle("paper", {"ETH": paper_pos("ETH", stop=95.0)}, {"ETH": []}, {"ETH": 100.0})
        cy.manage_exits()
        self.assertEqual(cy.positions["ETH"]["stop"], 95.0)
        CTX["ETH"] = ctx(line=97.5)
        cy.manage_exits()
        self.assertEqual(cy.positions["ETH"]["stop"], 97.5)
        self.assertEqual(L.positions("paper")["ETH"]["stop"], 97.5)


class LiveSafety(Base):
    def cand(self):
        return {"coin": "ETH", "side": "long", "kind": "flip", "tier": "A", "stop": 96.0, "bar_t": 0, "range": "In Range",
                "book": "eth-defi", "benchmark": "ETH", "bench_mark": 100.0}

    def test_close_before_cancel_and_whole_position(self):
        ex = FakeEx()
        pos = paper_pos("ETH"); pos.update({"mode": "live", "stop_cloid": "0xold", "sz": 2.5})
        cy = self.cycle("live", {"ETH": pos}, {"ETH": []}, {"ETH": 100.0}, ex=ex)
        rec = cy.close_position("ETH", pos, 100.0, "4h flip", 1000)
        self.assertIsNotNone(rec)
        self.assertEqual([c[0] for c in ex.calls], ["market_close", "cancel"])
        self.assertIsNone(ex.calls[0][2])
        self.assertNotIn("ETH", L.positions("live"))
        self.assertEqual(L.trades()[0]["reason"], "4h flip")

    def test_failed_close_keeps_position_and_stop(self):
        ex = FakeEx({"close": ERROR})
        pos = paper_pos("ETH"); pos.update({"mode": "live", "stop_cloid": "0xold"})
        cy = self.cycle("live", {"ETH": pos}, {"ETH": []}, {"ETH": 100.0}, ex=ex)
        self.assertIsNone(cy.close_position("ETH", pos, 100.0, "4h flip", 1000))
        self.assertNotIn("cancel", [c[0] for c in ex.calls])
        self.assertIn("ETH", cy.positions)
        self.assertEqual(L.trades(), [])

    def test_entry_fill_then_stop_rejected_closes_instead_of_holding(self):
        ex = FakeEx({"stop": ERROR})
        cy = self.cycle("live", {}, {"ETH": []}, {"ETH": 100.0}, ex=ex)
        z = K.size(1000.0, 100.3, 96.0, C.settings(), 10)
        self.assertIsNone(cy.execute_entry(self.cand(), z, 100.0, ctx()))
        kinds = [c[0] for c in ex.calls]
        self.assertEqual(kinds.count("stop"), 2)
        self.assertIn("market_close", kinds)
        self.assertNotIn("ETH", L.positions("live"))
        self.assertFalse((STATE / "HALT").exists())

    def test_entry_fill_recorded_before_stop(self):
        ex = FakeEx({"stop": TimeoutError("boom")})
        # the close also fails: the position must still be on disk and HALT set, never silently forgotten
        ex.script["close"] = ERROR
        cy = self.cycle("live", {}, {"ETH": []}, {"ETH": 100.0}, ex=ex)
        z = K.size(1000.0, 100.3, 96.0, C.settings(), 10)
        cy.execute_entry(self.cand(), z, 100.0, ctx())
        self.assertIn("ETH", L.positions("live"))
        self.assertTrue((STATE / "HALT").exists())

    def test_entry_exception_recovers_a_fill_the_exchange_holds(self):
        ex = FakeEx({"entry": TimeoutError("timeout")})
        cy = self.cycle("live", {}, {"ETH": []}, {"ETH": 100.0}, ex=ex, exch_pos={"ETH": {"szi": 2.5, "entryPx": 100.1}})
        z = K.size(1000.0, 100.3, 96.0, C.settings(), 10)
        pos = cy.execute_entry(self.cand(), z, 100.0, ctx())
        self.assertIsNotNone(pos)
        self.assertAlmostEqual(pos["entry"], 100.1)
        self.assertAlmostEqual(pos["sz"], 2.5)
        self.assertIn("stop", [c[0] for c in ex.calls])
        self.assertTrue(L.positions("live")["ETH"]["stop_cloid"])

    def test_trail_rejected_keeps_old_stop(self):
        ex = FakeEx({"stop": ERROR})
        pos = paper_pos("ETH"); pos.update({"mode": "live", "stop_cloid": "0xold"})
        CTX["ETH"] = ctx(line=98.0)
        cy = self.cycle("live", {"ETH": pos}, {"ETH": []}, {"ETH": 100.0}, ex=ex)
        cy.manage_exits()
        self.assertEqual(cy.positions["ETH"]["stop"], 95.0)
        self.assertEqual(cy.positions["ETH"]["stop_cloid"], "0xold")
        self.assertNotIn("cancel", [c[0] for c in ex.calls])

    def test_exchange_stop_fired_is_absorbed_before_exits(self):
        ex = FakeEx()
        pos = paper_pos("ETH"); pos.update({"mode": "live", "stop_cloid": "0xold", "opened_ts": 0})
        CY.H.user_fills = lambda addr: [{"coin": "ETH", "side": "A", "px": "94.9", "sz": "2.5", "time": 5000}]
        CTX["ETH"] = ctx(line=99.0)
        cy = self.cycle("live", {"ETH": pos}, {"ETH": []}, {"ETH": 100.0}, ex=ex, exch_pos={})
        cy.absorb_exchange_closes()
        cy.manage_exits()
        self.assertNotIn("ETH", cy.positions)
        self.assertEqual(L.trades()[0]["reason"], "stop (exchange)")
        self.assertEqual(ex.calls, [])


class Misc(Base):
    def test_pre_trade_zero_equity_refuses_without_crash(self):
        ok, checks = K.pre_trade({"coin": "ETH", "book": "eth-defi"}, {"refused": "x"}, {}, 0.0, C.settings(), {"fresh": True, "book_cap_pct": 2.5})
        self.assertFalse(ok)
        self.assertIn("equity positive", [c["check"] for c in checks if not c["ok"]])

    def test_rounding(self):
        self.assertEqual(H.round_px(84466.123, 5), 84466.0)
        self.assertEqual(H.round_px(288.19123, 3), 288.19)
        self.assertEqual(H.round_px(0.0123456, 0), 0.012346)
        self.assertEqual(H.round_sz(0.0056319, 5), 0.00563)
        self.assertEqual(H.round_sz(12.3456789, 2), 12.34)

    def test_halt_is_tracked_by_git(self):
        self.assertNotIn("state/HALT", (Path(__file__).resolve().parents[1] / ".gitignore").read_text())

    def test_order_ok(self):
        self.assertTrue(LV.order_ok(RESTING)[0])
        self.assertTrue(LV.order_ok(FILL(1, 1))[0])
        self.assertFalse(LV.order_ok(ERROR)[0])
        self.assertFalse(LV.order_ok({"status": "err"})[0])


if __name__ == "__main__":
    unittest.main()
