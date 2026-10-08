"""Command Center data contract (docs/COMMAND_CENTER_SPEC.md §6, Package A: A0, A1, A2).

A0: clock.bar_s, cfg.kind / tf / btc_gate, the explicit carry skip in pos(), carry kept out of rec / stats / rseries /
cost_R, cap_ret_pct. A1: beat, act, carry[], carry_sum, tw, the unhedged alert, the five new event types, row v2 with
fit_row and scrub_assert, envelope v2. A2: the rows-dir push, `--fleet DIR`, run_agents.py's fleet step."""
import contextlib, io, json, math, os, re, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
import _path  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
import dashboard_push as DP  # noqa: E402
import cc_fixtures as F  # noqa: E402
import synthetic as S  # noqa: E402

REAL = Path(__file__).resolve().parent / "fixtures" / "real"
ROSTER = [{"id": "core", "name": "Core", "enabled": True, "desc": "The original rules."},
          {"id": "carry-1h", "name": "Carry", "enabled": True, "desc": "Short perp + long spot; collects funding."},
          {"id": "arena-01", "name": "A01 Rotation", "enabled": True, "desc": "Arena rotation bot.",
           "arena": {"recipe": "rot-e335df0b", "family": "rs_rotation", "enrolled": "2026-09-29", "tag": "bull specialist",
                     "dev_sharpe": 1.132, "dev_max_dd": 17.99}},
          {"id": "beat-1h", "name": "Beat", "enabled": True, "desc": "Heartbeat fixture."},
          {"id": "old-4h", "name": "Old", "enabled": False, "desc": "Retired."}]


def numbers_and_strings(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from numbers_and_strings(k)
            yield from numbers_and_strings(v)
    elif isinstance(o, (list, tuple)):
        for v in o:
            yield from numbers_and_strings(v)
    elif not isinstance(o, bool):
        yield o


def assert_no_money(tc, payload, money):
    for v in numbers_and_strings(payload):
        if isinstance(v, (int, float)):
            for m in money:
                tc.assertFalse(math.isclose(v, m, rel_tol=0, abs_tol=1e-9), f"money value {m} shipped")
        elif isinstance(v, str):
            for tok in re.findall(r"\d+(?:\.\d+)?", v):
                for m in money:
                    tc.assertFalse(math.isclose(float(tok), m, rel_tol=0, abs_tol=1e-9), f"money value {m} in text {v!r}")


def row_for(b, agent):
    with mock.patch.object(DP.C, "agents", lambda: ROSTER), mock.patch.object(DP.C, "AGENT", agent):
        return DP.agent_summary(b)


class Fixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.carry = DP.build(*F.carry_tree(d / "carry"), F.CARRY_NOW)
        cls.carry_late = DP.build(*F.carry_tree(d / "carry_late", F.STUCK1 + 4 * 3600 + 3600), F.STUCK1 + 4 * 3600 + 3600)
        cls.target = DP.build(*F.target_tree(d / "target"), F.TARGET_NOW)
        cls.beat_early = DP.build(*F.beat_tree(d / "beat", F.BEAT_TOP + 10 * 60), F.BEAT_TOP + 10 * 60)
        cls.beat_owed = DP.build(*F.beat_tree(d / "beat2", F.BEAT_TOP + 40 * 60), F.BEAT_TOP + 40 * 60)
        cls.syn_st, cls.syn_cfg = S.make_state(d / "syn", "paper")
        cls.syn = DP.build(cls.syn_st, cls.syn_cfg, S.NOW)
        cls.real = DP.build(REAL / "state", REAL / "config", 1790311646.06)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        DP.BAR = 4 * 3600


class A0(Fixtures):
    def test_bar_s_per_tf(self):
        with tempfile.TemporaryDirectory() as d:
            for tf, bar, n in (("1h", 3600, 24), ("4h", 14400, 18), ("1d", 86400, 14)):
                st, cfg = F.write_tree(Path(d) / tf, F.settings(trigger_tf=tf), [F.run_doc(F.T0 + 600)])
                L = DP.build(st, cfg, F.T0 + 1200)["latest"]
                self.assertEqual(L["clock"]["bar_s"], bar, tf)
                self.assertEqual(L["cfg"]["tf"], tf)
                self.assertEqual((L["beat"]["n"], L["clock"]["last_slot"]), (n, F.T0), tf)
        self.assertEqual(self.real["latest"]["clock"]["bar_s"], 14400)

    def test_cfg_kind_tf_and_btc_gate(self):
        self.assertEqual((self.syn["latest"]["cfg"]["kind"], self.syn["latest"]["cfg"]["btc_gate"]), ("flip", True))
        self.assertEqual({k: self.carry["latest"]["cfg"][k] for k in ("kind", "tf", "btc_gate")}, {"kind": "carry", "tf": "1h", "btc_gate": False})
        self.assertEqual({k: self.target["latest"]["cfg"][k] for k in ("kind", "tf", "btc_gate")}, {"kind": "target", "tf": "1d", "btc_gate": False})

    def test_carry_positions_are_skipped_not_dropped_by_accident(self):
        L = self.carry["latest"]
        self.assertEqual(L["pos"], [])
        self.assertEqual(L["risk"]["n_open"], 6)
        self.assertEqual(len(L["carry"]), 6)

    def test_carry_trades_never_count_as_R(self):
        L, G = self.carry["latest"], self.carry["ledger"]
        self.assertEqual(G["trades"]["cols"][-2:], ["cap_ret_pct", "t_rec"])
        rows = {r["c"]: r for r in (dict(zip(G["trades"]["cols"], x)) for x in G["trades"]["rows"])}
        self.assertEqual((rows["SOL"]["R"], rows["SOL"]["rel_R"], rows["SOL"]["cost_R"], rows["SOL"]["cap_ret_pct"]), (None, None, None, 0.12))
        self.assertEqual((rows["AVAX"]["R"], rows["AVAX"]["cap_ret_pct"]), (0.5, None))
        self.assertEqual(G["trades"]["total"], 2)
        self.assertEqual(G["stats"]["all"]["n"], 1)
        self.assertEqual(G["stats"]["all"]["cost_R"], round((0.1911 + 0.0377) / 10.07, 2))
        self.assertNotIn("carry", G["stats"]["kind"])
        self.assertEqual([r[1] for r in G["rseries"]], [0.5])
        self.assertEqual(G["verdict"]["gates"][0]["val"], 1)
        self.assertEqual((L["rec"]["n"], L["rec"]["closed_R"], L["rec"]["avg_R"]), (1, 0.5, 0.5))


class Carry(Fixtures):
    def test_pairs_carry_no_money(self):
        L = self.carry["latest"]
        for r in L["carry"] + [L["carry_sum"]]:
            for k in r:
                self.assertIsNone(DP.FORBIDDEN_KEY.match(k), k)
            self.assertNotIn("px", r)
        assert_no_money(self, {"carry": L["carry"], "carry_sum": L["carry_sum"], "alerts": L["alerts"], "events": L["events"]}, F.CARRY_MONEY)
        DP.scrub_assert(L["carry"], "carry", DP.money_set(F.CARRY_MONEY))
        self.assertEqual(sorted(L["carry"][0]), sorted(["id", "c", "st", "t_in", "cap_pct", "apr", "fund_pct", "cost_pct", "net_pct",
                                                        "capture_pct", "stuck_t", "exit_t", "open_pct"]))

    def test_pair_values(self):
        L, E = self.carry["latest"], F.CARRY_EQ[-1]
        by = {r["c"]: r for r in L["carry"]}
        self.assertEqual([r["c"] for r in L["carry"]][:2], ["ZEC", "PUMP"])                 # legs out of balance first
        p = F.CARRY_POS["PUMP"]
        self.assertEqual(by["PUMP"]["id"], f"PUMP-{p['opened_ts']}")
        self.assertEqual(by["PUMP"]["cap_pct"], round(p["capital"] / E * 100, 1))
        self.assertEqual(by["PUMP"]["fund_pct"], round(p["funding_income"] / E * 100, 3))
        self.assertEqual(by["PUMP"]["net_pct"], round((p["funding_income"] - p["fees"] + p["spot_pnl"] + p["perp_pnl"]) / E * 100, 2))
        z = F.CARRY_POS["ZEC"]                                                                  # a missing perp_pnl counts as 0
        self.assertEqual(by["ZEC"]["net_pct"], round((z["funding_income"] - z["fees"] + z["spot_pnl"]) / E * 100, 2))
        self.assertEqual(by["PUMP"]["capture_pct"], round((p["funding_income"] - p["fees"]) / p["theo_funding"] * 100))
        self.assertEqual((by["PUMP"]["apr"], by["PUMP"]["stuck_t"], by["XPL"]["stuck_t"]), (28.3, F.STUCK2, None))
        self.assertIsNone(by["HYPE"]["capture_pct"])                                           # exiting: no −302%
        self.assertIsNone(by["ETH"]["capture_pct"])                                            # nothing due yet: theo 0
        self.assertIsNotNone(by["BTC"]["capture_pct"])                                         # entering still has a capture

    def test_sum(self):
        cs, P = self.carry["latest"]["carry_sum"], F.CARRY_POS.values()
        fi, fees, theo = (sum(p[k] for p in P) for k in ("funding_income", "fees", "theo_funding"))
        self.assertEqual(cs["capture_pct"], round((fi - fees) / theo * 100))
        self.assertEqual({k: cs[k] for k in ("pairs", "open", "entering", "exiting", "stuck", "stuck_t", "fix_h", "gate_pct")},
                         {"pairs": 6, "open": 4, "entering": 1, "exiting": 1, "stuck": 2, "stuck_t": F.STUCK1, "fix_h": 3, "gate_pct": 80})
        E = F.CARRY_EQ[-1]
        self.assertEqual(cs["cap_pct"], round(sum(p["capital"] for p in P) / E * 100, 1))
        live = [(r["apr"], r["cap_pct"]) for r in self.carry["latest"]["carry"] if r["st"] != "exiting"]
        self.assertEqual(cs["apr"], round(sum(a * c for a, c in live) / sum(c for _a, c in live), 1))
        with tempfile.TemporaryDirectory() as d:
            gated = DP.build(*F.carry_tree(Path(d), carry_cfg={"capture_gate_pct": 90, "max_unhedged_hours": 4}), F.CARRY_NOW)
        self.assertEqual((gated["latest"]["carry_sum"]["gate_pct"], gated["latest"]["carry_sum"]["fix_h"]), (90, 4))

    def test_unhedged_info_then_warn(self):
        early = [a for a in self.carry["latest"]["alerts"] if a["k"] == "unhedged"]
        self.assertEqual([(a["lv"], a["c"], a["t"]) for a in early], [("info", "ZEC", F.STUCK1), ("info", "PUMP", F.STUCK2)])
        self.assertEqual(early[0]["text"], "ZEC: legs out of balance since {time}; the engine evens them after 3 h.")
        late = [a for a in self.carry_late["latest"]["alerts"] if a["k"] == "unhedged"]
        self.assertEqual([(a["lv"], a["c"]) for a in late], [("warn", "ZEC"), ("info", "PUMP")])
        self.assertEqual(late[0]["text"], "ZEC: legs out of balance since {time}, past the 3 h safety limit.")
        lv = [a["lv"] for a in self.carry_late["latest"]["alerts"]]
        self.assertEqual(lv, sorted(lv, key=["bad", "warn", "info"].index))                   # worst first, as before

    def test_exit_slow_and_exit_time(self):
        L = self.carry["latest"]
        hy = next(r for r in L["carry"] if r["c"] == "HYPE")
        out_t = max(e[0] for e in L["events"] if e[1] == "carry_out" and e[2] == "HYPE")
        self.assertEqual((hy["st"], hy["exit_t"]), ("exiting", out_t))                       # no exit_ts yet: the carry_out event
        slow = [a for a in L["alerts"] if a["k"] == "exit_slow"]
        self.assertEqual([(a["c"], a["lv"], a["t"]) for a in slow], [("HYPE", "warn" if F.CARRY_NOW - out_t >= 86400 else "info", out_t)])
        self.assertIsNone(next(r for r in L["carry"] if r["st"] != "exiting")["exit_t"])

    def test_carry_events_and_no_duplicate_bought(self):
        ev = self.carry["latest"]["events"]
        pump = self.carry["latest"]["carry"]
        t_open = F.CARRY_POS["PUMP"]["opened_ts"]
        self.assertIn([t_open, "carry_in", "PUMP", "carry", None, 2, "34.9", None, None], ev)
        self.assertFalse([e for e in ev if e[1] == "bought" and e[2] == "PUMP"])              # carry_in joined the open
        other = [e for e in ev if e[1] == "carry_in" and e[2] != "PUMP"]                      # opens no run line logged
        self.assertEqual(sorted(e[2] for e in other), sorted([c for c in F.CARRY_POS if c != "PUMP"] + ["SOL"]))   # SOL: the closed pair
        self.assertTrue(any(e[1] == "carry_out" and e[2] == "HYPE" and e[6] == "-0.2" for e in ev))
        closed = [e for e in ev if e[1] == "carry_closed"]
        self.assertEqual([(e[2], e[6], e[7]) for e in closed], [("SOL", "+0.02,62%", None)])  # matched: no extra "sold" row
        self.assertFalse([e for e in ev if e[1] == "sold" and e[2] == "SOL"])
        self.assertTrue(any(e[1] == "carry_fix" and e[2] == "ZEC" for e in ev))
        self.assertTrue(pump)

    def test_act_is_the_newest_action(self):
        a = self.carry["latest"]["act"]                                                       # SOL's close, run line + ledger row
        self.assertEqual((a["t"], a["ty"], a["cs"], a["n"], a["R"], a["cap_pct"]), (F.T0 + 2 * DP.DAY + 900, "carry_closed", ["SOL"], 1, None, 0.12))


class RecordedAt(Fixtures):
    def test_t_rec_is_the_check_that_recorded_the_close(self):
        # owner-13: a paper stop closes at the open of the bar that hit it; every list shows the check that wrote "sold"
        for b in (self.syn, self.real):
            G, L = b["ledger"], b["latest"]
            ix = {k: i for i, k in enumerate(G["trades"]["cols"])}
            sold = {}
            for e in L["events"]:
                if e[1] in ("sold", "carry_closed"):
                    sold.setdefault(e[2], []).append(e[0])
            for r in G["trades"]["rows"]:
                t_out, t_rec = r[ix["t_out"]], r[ix["t_rec"]]
                if t_out is None:
                    continue
                self.assertGreaterEqual(t_rec, t_out - 60)
                self.assertLessEqual(t_rec, t_out + 2 * DP.BAR)
                hits = [t for t in sold.get(r[ix["c"]], []) if t_out - 60 <= t <= t_out + 2 * DP.BAR]
                self.assertEqual(t_rec, min(hits) if hits else t_out)


class KindRules(unittest.TestCase):
    def test_check_lists_match_the_engine(self):
        src = (ROOT / "src" / "executor" / "cycle.py").read_text()
        def names(meth):
            body = src[src.index(f"def {meth}("):]
            body = body[:body.index("return all(")]
            return re.findall(r'\badd\("([^"]+)"', body)
        self.assertEqual(names("target_checks"), DP.TARGET_CHECKS)
        self.assertEqual(names("carry_checks"), DP.CARRY_CHECKS)


class Target(Fixtures):
    def test_weights(self):
        self.assertEqual(self.target["latest"]["tw"], [["LTC", 12, 12, "hold"], ["NEAR", 6, 7, "hold"], ["UNI", 7, 7, "hold"]])
        self.assertNotIn("tw", self.carry["latest"])
        self.assertNotIn("tw", self.syn["latest"])
        self.assertNotIn("carry", self.target["latest"])

    def test_parse_line_types_the_acting_lines(self):
        want = {"BTC: resized to 48% of pot, stop 71642": ("resized", "BTC", "target", None, "48", None, None),
                "PUMP: carry ENTERING · funding 34.9%/yr · 17% of pot per leg, maker orders resting": ("carry_in", "PUMP", "carry", None, "34.9", None, None),
                "HYPE: carry EXITING · funding -0.2%/yr below exit": ("carry_out", "HYPE", "carry", None, "-0.2", None, None),
                "HYPE: carry CLOSED · +0.12% of pot · capture 85%": ("carry_closed", "HYPE", "carry", None, "+0.12,85%", None, None),
                "ZEC: carry safety override · legs out of balance for 3h, lagging leg completed at market": ("carry_fix", "ZEC", "carry", None, None, None, None)}
        for line, ev in want.items():
            got = DP.parse_line(line)
            self.assertIsNot(got, DP.SKIP, line)
            self.assertEqual(tuple(got), ev)
            self.assertEqual(DP.LEVEL[ev[0]], 2)
        for line in F.A01_LINES[1:-1]:
            self.assertIs(DP.parse_line(line), DP.SKIP)                                        # weights stay a reading

    def test_act_beyond_the_events_window(self):
        L = self.target["latest"]
        self.assertFalse([e for e in L["events"] if e[1] in DP.ACTED])                        # 10 days on: nothing in 7 days
        self.assertEqual({k: L["act"][k] for k in ("t", "ty", "n")}, {"t": F.TARGET_OPEN, "ty": "bought", "n": 3})
        self.assertEqual(sorted(L["act"]["cs"]), ["LTC", "NEAR", "UNI"])
        with tempfile.TemporaryDirectory() as d:
            trade = {"coin": "LTC", "side": "long", "kind": "target", "tier": "T", "mode": "paper", "opened": F.iso(F.TARGET_OPEN),
                     "closed": F.iso(F.TARGET_OPEN + DP.DAY), "entry": 81.37, "exit": 80.0, "notional": 120.31, "risk_amt": 24.06,
                     "pnl": -2.11, "R": -0.09, "fees": 0.1, "funding": 0.01, "reason": "below its average", "hours": 24}
            b = DP.build(*F.target_tree(Path(d), positions=False, trades=[trade]), F.TARGET_NOW)
        self.assertEqual({k: b["latest"]["act"][k] for k in ("ty", "cs", "n", "R")}, {"ty": "sold", "cs": ["LTC"], "n": 1, "R": -0.09})
        with tempfile.TemporaryDirectory() as d:
            none = DP.build(*F.write_tree(Path(d), F.settings(), [F.run_doc(F.T0 + 600)]), F.T0 + 1200)
        self.assertIsNone(none["latest"]["act"])                                               # never traded: null


class Beat(Fixtures):
    def test_alphabet(self):
        b = self.beat_early["latest"]["beat"]
        self.assertEqual((b["s0"], b["n"]), (F.BEAT_S0, 24))
        self.assertEqual(b["k"], "...o-xlOL" + "o" * 14)                                      # newest slot not owed yet: dropped
        self.assertEqual(len(b["k"]), 23)
        b2 = self.beat_owed["latest"]["beat"]
        self.assertEqual(b2["k"], "...o-xlOL" + "o" * 14 + "-")                               # now owed and missing
        self.assertEqual(len(b2["k"]), 24)

    def test_act_groups_and_dedupes(self):
        a = self.beat_owed["latest"]["act"]
        self.assertEqual({k: a[k] for k in ("ty", "cs", "n", "R")}, {"ty": "sold", "cs": ["LINK"], "n": 1, "R": -1.02})


class Rows(Fixtures):
    def rows(self):
        return {"synthetic": row_for(self.syn, "core"), "real": row_for(self.real, "core"), "carry": row_for(self.carry, "carry-1h"),
                "carry_late": row_for(self.carry_late, "carry-1h"), "target": row_for(self.target, "arena-01"),
                "beat": row_for(self.beat_owed, "beat-1h")}

    def test_v1_types_unchanged(self):
        for name, r in self.rows().items():
            self.assertIsInstance(r["halt"], bool, name)
            self.assertIsInstance(r["thr"], str, name)
            self.assertIsInstance(r["failed"], bool, name)
            self.assertIsInstance(r["alerts"], int, name)
            self.assertNotIn("signals", r)
            for k in ("id", "name", "desc", "tf", "mode", "gen", "last_t", "pot_chg_pct", "n_open", "used_pct"):
                self.assertIn(k, r)
            self.assertTrue({"n", "tot_R", "avg_R", "rel_R_avg", "open_R", "win", "w", "l", "closed_R"} <= set(r["rec"]))
        syn = self.rows()["synthetic"]
        self.assertTrue(syn["halt"])                                                             # the fixture's HALT file
        self.assertEqual(syn["alerts"], len(self.syn["latest"]["alerts"]))

    def test_new_fields(self):
        r = self.rows()
        c, t = r["carry"], r["target"]
        self.assertEqual((c["kind"], c["bar_s"], c["enabled"], c["arena"], c["twin_of"]), ("carry", 3600, True, None, None))
        self.assertEqual(c["carry"], {k: v for k, v in self.carry["latest"]["carry_sum"].items() if k not in ("open_pct", "closed_pct")})
        self.assertEqual(sorted(c["held"]), sorted(F.CARRY_POS))
        self.assertEqual(c["deployed_pct"], round(sum(x["cap_pct"] for x in self.carry["latest"]["carry"]), 1))
        self.assertEqual(t["arena"], {"recipe": "rot-e335df0b", "family": "rs_rotation", "tag": "bull specialist", "enrolled": "2026-09-29"})
        self.assertEqual((t["kind"], t["bar_s"], t["n_names"]), ("target", 86400, len(self.target["latest"]["order"])))
        self.assertNotIn("carry", t)
        sb = c["sb"]
        self.assertEqual(sorted(sb), ["alerts", "cfg", "clock", "mode", "risk", "state"])
        self.assertEqual(sorted(sb["clock"]), sorted(DP.ROW_KEYS))
        self.assertEqual(sb["clock"]["bar_s"], 3600)
        self.assertEqual(sb["risk"], {"n_open": 6})
        self.assertEqual(sorted(sb["state"]), ["halt", "last", "thr"])
        self.assertEqual(r["carry_late"]["sb"]["alerts"][0]["k"], "unhedged")                  # warn rides along, info does not
        self.assertEqual([(a["lv"], a["k"]) for a in r["carry"]["sb"]["alerts"]], [("warn", "exit_slow")])   # HYPE closing for days
        self.assertEqual([a["lv"] for a in r["synthetic"]["sb"]["alerts"]][:1], ["bad"])
        b = r["beat"]
        self.assertEqual((b["beat"], b["act"], b["last24"]), (self.beat_owed["latest"]["beat"], self.beat_owed["latest"]["act"],
                                                              self.beat_owed["latest"]["last24"]))
        self.assertEqual(b["rec"]["w"] + b["rec"]["l"], self.beat_owed["ledger"]["stats"]["all"]["n"])
        spark = self.beat_owed["latest"]["pot"]["spark"]
        self.assertEqual(b["spark"], [v for _t, v in spark][-24:])
        self.assertEqual(b["spark_t"], [spark[-24:][0][0], spark[-1][0]])
        self.assertTrue(all(e[5] >= 2 and e[1] not in ("blocked", "board", "review") for e in b["recent"]))
        self.assertEqual(b["recent"], sorted(b["recent"], key=lambda e: -e[0]))
        self.assertLessEqual(len(b["recent"]), 3)

    def test_size_and_privacy(self):
        for name, r in self.rows().items():
            n = len(DP.dumps(r))
            self.assertLessEqual(n, DP.ROW_BUDGET, name)
            if name in ("synthetic", "real", "beat") and not r["sb"]["alerts"]:
                self.assertLessEqual(n, 1600, name)
        DP.scrub_assert(self.rows()["carry"], "exec:agents", self.carry["money"])
        assert_no_money(self, self.rows()["carry"], F.CARRY_MONEY)
        assert_no_money(self, self.rows()["synthetic"], S.MONEY)

    def test_fit_row_trims_in_order(self):
        r = row_for(self.carry_late, "carry-1h")
        pot = {"spark": [[1790000000 + i * 3600, round(-0.01 * i, 2)] for i in range(30)]}
        r.update(DP.spark_of(pot, 24))
        r["recent"] = [[1, "sold", "X", None, None, 2, None, 0.1, None]] * 3
        r["sb"]["alerts"] = [{"lv": "warn", "k": "late", "t": 1, "c": None, "text": "x" * 120}] * 3
        base = len(DP.dumps(r))
        DP.fit_row(r, pot, budget=base - 1)
        self.assertEqual((len(r["recent"]), len(r["spark"]), len(r["sb"]["alerts"])), (1, 24, 3))
        DP.fit_row(r, pot, budget=len(DP.dumps(r)) - 1)
        self.assertEqual((len(r["spark"]), len(r["sb"]["alerts"])), (12, 3))
        self.assertEqual(r["spark_t"], [1790000000 + 18 * 3600, 1790000000 + 29 * 3600])
        DP.fit_row(r, pot, budget=len(DP.dumps(r)) - 1)
        self.assertEqual(len(r["sb"]["alerts"]), 1)
        with self.assertRaises(AssertionError):
            DP.fit_row(r, None, budget=100)


class Envelope(Fixtures):
    def test_key_order_and_shape(self):
        with mock.patch.object(DP.C, "agents", lambda: ROSTER):
            env = DP.agents_index(None, self.syn)
        self.assertEqual(list(env), ["v", "gen", "fleet", "host", "order", "agents"])
        self.assertEqual(env["v"], 2)
        self.assertEqual(env["gen"], self.syn["latest"]["gen"])
        self.assertEqual(env["order"], ["core", "carry-1h", "arena-01", "beat-1h"])            # enabled roster ids
        self.assertEqual(env["fleet"], {"halt": False, "reason": None, "since": None})
        self.assertEqual(sorted(env["host"]), ["fails", "name", "ok", "t"])
        self.assertEqual([r["id"] for r in env["agents"]], ["core"])
        DP.scrub_assert(env, "exec:agents")

    def test_fleet_halt_in_the_envelope(self):
        f = DP.C.FLEET_HALT
        f.parent.mkdir(parents=True, exist_ok=True)
        try:
            f.write_text("fleet drawdown 12.3% beyond 10%")
            f.with_name("FLEET_HALT.since").write_text("2026-10-01T04:07:00.123Z")
            with mock.patch.object(DP.C, "agents", lambda: ROSTER):
                env = DP.envelope(None, [])
        finally:
            f.unlink()
            f.with_name("FLEET_HALT.since").unlink()
        self.assertEqual(env["fleet"], {"halt": True, "reason": "fleet drawdown 12.3% beyond 10%", "since": 1790827620})


class FleetStep(Fixtures):
    """`--fleet DIR`: one read of exec:agents, newest-gen merge, one bulk call, exec:factory only when it changed."""

    def run_fleet(self, rows_dir, remote_agents, remote_factory, factory="{\"v\":1}", strict=None):
        calls, reads = [], []

        def fake_api(path, payload=None, method=None):
            calls.append((path, payload))
            if path.startswith("/storage/kv/namespaces?"):
                return {"result": [{"title": DP.NAMESPACE_TITLE, "id": "ns1"}]}
            return {"success": True}

        def fake_get(ns, k):
            reads.append(k)
            return {"exec:agents": remote_agents, "exec:factory": remote_factory}.get(k)
        with mock.patch.object(DP, "api", fake_api), mock.patch.object(DP, "kv_get", fake_get), mock.patch.object(DP, "kv_get_strict", strict or fake_get), \
                mock.patch.object(DP, "factory_payload", lambda: factory), mock.patch.object(DP.C, "agents", lambda: ROSTER), \
                contextlib.redirect_stdout(io.StringIO()):
            DP.main(["--fleet", str(rows_dir)])
        bulks = [p for path, p in calls if path.endswith("/bulk")]
        return bulks, reads

    def test_failed_read_never_blanks_the_index(self):
        def boom(ns, k):
            raise DP.KVReadError("could not read exec:agents: HTTP 503")
        with tempfile.TemporaryDirectory() as d:
            DP.save_row(d, row_for(self.syn, "core"))
            with self.assertRaises(SystemExit) as cm:
                self.run_fleet(d, None, None, strict=boom)
        self.assertEqual(cm.exception.code, 1)

    def test_strict_read_404_is_missing_and_5xx_raises(self):
        import urllib.error
        def opener(code):
            def f(req, timeout=None):
                raise urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(b""))
            return f
        env = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}
        with mock.patch.dict("os.environ", env), mock.patch.object(DP.time, "sleep", lambda s: None):
            with mock.patch.object(DP.urllib.request, "urlopen", opener(404)):
                self.assertIsNone(DP.kv_get_strict("ns1", "exec:agents"))
            with mock.patch.object(DP.urllib.request, "urlopen", opener(503)), self.assertRaises(DP.KVReadError):
                DP.kv_get_strict("ns1", "exec:agents")
            with mock.patch.object(DP.urllib.request, "urlopen", side_effect=TimeoutError("slow")), self.assertRaises(DP.KVReadError):
                DP.kv_get_strict("ns1", "exec:agents")

    def test_merge(self):
        core_new = row_for(self.syn, "core")
        carry_new = row_for(self.carry, "carry-1h")
        remote = {"v": 1, "gen": "x", "agents": [
            dict(core_new, gen="2020-01-01T00:00:00.000Z", name="old core"),                     # older: replaced
            dict(carry_new, gen="2099-01-01T00:00:00.000Z", name="newer carry"),                  # newer than ours: kept
            {"id": "arena-01", "gen": "2026-09-30T00:00:00.000Z", "name": "A01 kept"},           # not pushed this job: kept
            {"id": "gone-1h", "gen": "2026-09-30T00:00:00.000Z", "name": "off the roster"}]}     # dropped
        with tempfile.TemporaryDirectory() as d:
            DP.save_row(d, core_new)
            DP.save_row(d, carry_new)
            Path(d, "junk.json").write_text("{not json")
            bulks, reads = self.run_fleet(d, json.dumps(remote), "{\"v\":1}")
        self.assertEqual(len(bulks), 1)
        self.assertEqual([x["key"] for x in bulks[0]], ["exec:agents"])                         # factory unchanged: not written
        self.assertEqual(reads, ["exec:agents", "exec:factory"])
        env = json.loads(bulks[0][0]["value"])
        self.assertEqual(list(env)[:2], ["v", "gen"])
        self.assertEqual([(r["id"], r["name"]) for r in env["agents"]], [("core", "Core"), ("carry-1h", "newer carry"), ("arena-01", "A01 kept")])

    def test_factory_only_when_changed_and_empty_dir(self):
        with tempfile.TemporaryDirectory() as d:
            bulks, _ = self.run_fleet(d, None, "{\"v\":1,\"old\":true}")
        self.assertEqual(len(bulks), 1)
        self.assertEqual([x["key"] for x in bulks[0]], ["exec:agents", "exec:factory"])
        env = json.loads(bulks[0][0]["value"])
        self.assertEqual((env["agents"], env["order"]), ([], ["core", "carry-1h", "arena-01", "beat-1h"]))
        bulks, _ = self.run_fleet(Path(d) / "missing", None, None, factory=None)              # no lab file, no rows
        self.assertEqual([x["key"] for x in bulks[0]], ["exec:agents"])


class RowsDirPush(Fixtures):
    """A push child with EXECUTOR_ROWS_DIR writes only its own keys and saves its row after the write succeeded."""

    def push(self, rows_dir, ok=True):
        calls, reads = [], []

        def fake_api(path, payload=None, method=None):
            calls.append((path, payload))
            if path.startswith("/storage/kv/namespaces?"):
                return {"result": [{"title": DP.NAMESPACE_TITLE, "id": "ns1"}]}
            return {"success": ok, "errors": ["boom"]}
        docs = DP.doc_texts(ROOT / "docs")
        index = {slug: DP.hashlib.sha256(t.encode()).hexdigest() for slug, t in docs.items()}

        def fake_get(ns, k):
            reads.append(k)
            return json.dumps(index) if k == "doc:index" else None
        env = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a", "EXECUTOR_ROWS_DIR": str(rows_dir)}
        with mock.patch.object(DP, "api", fake_api), mock.patch.object(DP, "kv_get", fake_get), mock.patch.dict("os.environ", env), \
                mock.patch.object(DP.C, "agents", lambda: ROSTER), contextlib.redirect_stdout(io.StringIO()):
            DP.main(["--state", str(self.syn_st), "--config", str(self.syn_cfg), "--now", str(S.NOW)])
        return [p for path, p in calls if path.endswith("/bulk")], reads

    def test_only_own_keys_then_the_row(self):
        with tempfile.TemporaryDirectory() as d:
            bulks, reads = self.push(d)
            self.assertEqual(len(bulks), 1)
            self.assertEqual([x["key"] for x in bulks[0]], ["exec:latest", "exec:ledger", "exec:stamp"])
            self.assertEqual(reads, ["doc:index"])                                              # no exec:agents, no exec:factory
            saved = json.loads(Path(d, "core.json").read_text())
            self.assertEqual(saved["v"], 2)
            self.assertEqual(saved["row"]["id"], "core")
            self.assertEqual(saved["row"]["gen"], self.syn["latest"]["gen"])
            self.assertEqual(DP.read_rows(d), [saved["row"]])

    def test_inline_push_keeps_its_own_keys_when_the_index_read_fails(self):
        calls = []

        def fake_api(path, payload=None, method=None):
            calls.append((path, payload))
            if path.startswith("/storage/kv/namespaces?"):
                return {"result": [{"title": DP.NAMESPACE_TITLE, "id": "ns1"}]}
            return {"success": True}

        def boom(ns, k):
            raise DP.KVReadError("could not read exec:agents: HTTP 500")
        env = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}
        with mock.patch.object(DP, "api", fake_api), mock.patch.object(DP, "kv_get", lambda ns, k: None), mock.patch.object(DP, "kv_get_strict", boom), \
                mock.patch.dict("os.environ", env), mock.patch.object(DP.C, "agents", lambda: ROSTER), contextlib.redirect_stdout(io.StringIO()), \
                self.assertRaises(SystemExit):
            os.environ.pop("EXECUTOR_ROWS_DIR", None)
            DP.main(["--state", str(self.syn_st), "--config", str(self.syn_cfg), "--now", str(S.NOW)])
        bulks = [p for path, p in calls if path.endswith("/bulk")]
        self.assertEqual(len(bulks), 1)
        keys = [x["key"] for x in bulks[0]]
        self.assertIn("exec:latest", keys)
        self.assertNotIn("exec:agents", keys)

    def test_no_row_after_a_failed_write(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                self.push(d, ok=False)
            self.assertEqual(list(Path(d).iterdir()), [])


class Runner(unittest.TestCase):
    """run_agents.py: the fleet step runs once per job, after every push, even after a failure; never without secrets."""

    def go(self, argv, secrets, fail=()):
        import run_agents as RA
        captured, order = [], []

        def fake_run(cmd, env, label):
            captured.append((label, cmd, dict(env)))
            order.append(label)
            return 1 if label in fail else 0
        roster = [{"id": "core", "enabled": True}, {"id": "fast-1h", "enabled": True}]
        os.environ["ALL_SECRETS"] = json.dumps(secrets)
        code = 0
        with mock.patch.object(RA, "run", fake_run), mock.patch.object(RA.C, "agents", lambda: roster), \
                mock.patch.object(RA, "agent_settings", lambda aid: {"trigger_tf": "1h"}), \
                mock.patch.object(RA, "fleet_guard", lambda: order.append("guard")), contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                RA.main(argv)
            except SystemExit as e:
                code = e.code
        return captured, order, code, out.getvalue()

    CF = {"CLOUDFLARE_API_TOKEN": "cf", "CLOUDFLARE_ACCOUNT_ID": "acct", "HL_AGENT_KEY": "k"}

    def test_fleet_step_after_a_failing_push_and_cycle(self):
        captured, order, code, _ = self.go(["--force"], self.CF, fail=("core push", "fast-1h cycle"))
        self.assertEqual(order, ["core cycle", "core push", "fast-1h cycle", "fast-1h push", "guard", "fleet push"])
        self.assertEqual(code, 1)                                                                # exit codes unchanged
        fleet = [c for c in captured if c[0] == "fleet push"]
        self.assertEqual(len(fleet), 1)
        _label, cmd, env = fleet[0]
        rows_dir = cmd[cmd.index("--fleet") + 1]
        self.assertTrue(Path(rows_dir).name.startswith("exec-rows-"))
        self.assertFalse(Path(rows_dir).exists())                                               # removed afterwards
        self.assertEqual({k for k in env if k.startswith(("CLOUDFLARE", "HL_", "EXECUTOR_AGENT", "EXECUTOR_ROWS", "ALERT"))},
                         {"CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"})
        for label, _cmd, e in captured:
            if label.endswith(" push") and label != "fleet push":
                self.assertEqual(e["EXECUTOR_ROWS_DIR"], rows_dir)
                self.assertNotIn("HL_AGENT_KEY", e)

    def test_skipped_without_secrets(self):
        captured, order, code, out = self.go(["--push-only"], {})
        self.assertEqual(order, ["guard"])
        self.assertIn("no Cloudflare secrets: fleet not pushed", out)
        self.assertEqual(code, 0)

    def test_fleet_only_skips_the_loop(self):
        _c, order, code, _ = self.go(["--fleet-only"], self.CF)
        self.assertEqual(order, ["guard", "fleet push"])
        self.assertEqual(code, 0)

    def test_dry_runs_no_fleet_step(self):
        _c, order, _code, _ = self.go(["--force", "--dry"], self.CF)
        self.assertEqual(order, ["core cycle", "fast-1h cycle"])


class Workflow(unittest.TestCase):
    def test_fleet_halt_branch(self):
        y = (ROOT / ".github" / "workflows" / "dashboard-sync.yml").read_text()
        self.assertIn("'FLEET_HALT', 'FLEET_HALT.since'", y)
        self.assertIn('if [ -n "$ONLY" ]; then python3 scripts/run_agents.py --push-only --only "$ONLY"; '
                      'elif [ "$FLEET" = "1" ]; then python3 scripts/run_agents.py --fleet-only; fi', y)
        self.assertIn("('host_beat.json', 'requests')", y)


if __name__ == "__main__":
    unittest.main()


class CheckNamesAreNotMoney(unittest.TestCase):
    """2026-10-08: Fast's page stopped updating for 3 days because a refusal by the "gross" exposure check put the key
    "gross" under funnel.week.by_check, and the money scrub refused the whole payload."""
    def test_check_names_pass_but_money_keys_still_fail(self):
        import dashboard_push as D
        D.scrub_assert({"funnel": {"week": {"by_check": {"gross": 2, "funding": 1}}}}, "exec:latest")
        with self.assertRaises(AssertionError):
            D.scrub_assert({"pos": {"gross": 12.5}}, "exec:latest")
