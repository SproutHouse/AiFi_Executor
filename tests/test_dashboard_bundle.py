"""Bundle v2 (scripts/dashboard_push.py): the privacy boundary and the contract the page is built on.

Covers docs/DASHBOARD_SPEC.md, data contract §8: forbidden keys, values and strings across all three payloads; the
live baseline; halt read from the HALT file and HALT.since; risk.used_pct equal to what risk.pre_trade checks; the
real rd strings and funnel from tests/fixtures/real; the check order; plus the KV key plan (no exec:<date>, no
dates, doc:* only when a hash changed) and the --kv-json flag."""
import contextlib, io, json, math, re, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
import _path  # noqa: F401
from executor import risk as K

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
import dashboard_push as DP  # noqa: E402
import synthetic as S  # noqa: E402

REAL = Path(__file__).resolve().parent / "fixtures" / "real"
REAL_NOW = 1790311646.06        # 2026-09-25T04:47:26.060Z, 27 minutes after the 04:20Z check
KEY_RX = re.compile(r"^(equity|cash|unrealized|start|peak|notional|sz|risk_amt|entry_fee|funding_paid|fees|funding|gross|pnl|margin|"
                    r"min_notional_usd|pot_usd_paper|stop_cloid|entry_cloid|last_bar_t|last_funding_ts|rules|context_at_entry|"
                    r"review_md|timezone|hours_local|_doc)$")
STR_RX = re.compile(r"\b(USDC|USD)\b|\$\s?\d|equity \d|\bsz\b")
NUM_IN_TEXT = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")


def walk(o, path="$"):
    """Yield (path, key or None, value) for every node of a JSON tree."""
    if isinstance(o, dict):
        for k, v in o.items():
            yield path, k, v
            yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")
    else:
        yield path, None, o


def payloads(b):
    return {"exec:latest": b["latest"], "exec:ledger": b["ledger"], "exec:stamp": b["stamp"]}


class Synthetic(unittest.TestCase):
    """The hand-made fixture: every stage of refusal, two positions, five trades, HALT, a failed run, a recon run."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.st, cls.cfg = S.make_state(Path(cls.tmp.name) / "paper", "paper")
        cls.b = DP.build(cls.st, cls.cfg, S.NOW)
        cls.L = cls.b["latest"]
        # round-trip through JSON exactly as the push writes it
        cls.wire = {k: json.loads(DP.dumps(v)) for k, v in payloads(cls.b).items()}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_forbidden_keys(self):
        for name, p in self.wire.items():
            for path, k, _v in walk(p):
                if k is not None:
                    self.assertIsNone(KEY_RX.match(k), f"{name}: forbidden key {k!r} at {path}")

    def test_forbidden_values(self):
        money = [float(m) for m in S.MONEY]
        for name, p in self.wire.items():
            for path, _k, v in walk(p):
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    for m in money:
                        self.assertFalse(math.isclose(v, m, rel_tol=0, abs_tol=1e-9), f"{name}: money value {m} at {path}")
                if isinstance(v, str):                        # a figure written as text counts too ("pot 1234.56")
                    for tok in NUM_IN_TEXT.findall(v):
                        x = float(tok.replace(",", ""))
                        for m in money:
                            self.assertFalse(math.isclose(x, m, rel_tol=0, abs_tol=1e-9), f"{name}: money value {m} in text at {path}")
            raw = DP.dumps(p)
            for m in ("1234.56", "377.19", "842.47", "12.3456", "843.12", "1260.9", "1000.0"):
                self.assertNotIn(m, raw, f"{name} carries {m}")

    def test_forbidden_strings(self):
        for name, p in self.wire.items():
            for path, k, v in walk(p):
                for s in (k, v):
                    if isinstance(s, str):
                        self.assertIsNone(STR_RX.search(s), f"{name}: forbidden string {s[:60]!r} at {path}")
        self.assertNotIn("Insufficient margin", DP.dumps(self.wire["exec:latest"]) + DP.dumps(self.wire["exec:ledger"]))

    def test_no_raw_passthrough(self):
        L = self.L
        self.assertEqual(sorted(L), sorted(["v", "gen", "mode", "origin", "cfg", "order", "books", "clock", "state", "alerts", "pot", "rec",
                                            "risk", "pos", "names", "runs", "events", "funnel", "pinned", "last24", "proposals", "diag"]))
        self.assertEqual(L["v"], 2)
        self.assertRegex(L["gen"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        self.assertEqual(set(self.b["stamp"]), {"v", "gen", "t"})
        self.assertEqual(self.b["stamp"]["gen"], L["gen"])
        self.assertEqual(self.b["stamp"]["t"], L["clock"]["last_t"])
        for k in ("timezone", "online_hours", "pot_usd_paper", "min_notional_usd"):
            self.assertNotIn(k, L["cfg"])
        self.assertNotIn("EDT", DP.dumps(L))

    def test_open_risk_equals_pre_trade(self):
        s = json.loads((self.cfg / "settings.json").read_text())
        positions = json.loads((self.st / "positions_paper.json").read_text())["positions"]
        E = S.PAPER_EQ[-1]
        ok, checks = K.pre_trade({"coin": "BTC", "book": "bitcoin"}, {}, positions, E, s, {"fresh": True, "book_cap_pct": 1.0})
        detail = next(c["detail"] for c in checks if c["check"] == "open-risk cap")
        self.assertEqual(self.L["risk"]["used_pct"], float(re.match(r"([\d.]+)%", detail).group(1)))
        self.assertGreater(self.L["risk"]["used_pct"], 0)

    def test_check_order(self):
        s = json.loads((self.cfg / "settings.json").read_text())
        cand = {"coin": "BTC", "book": "bitcoin"}
        _ok, checks = K.pre_trade(cand, {"risk_amt": 1.0, "notional": 10.0}, {}, 1000.0, s, {"book_cap_pct": 1.0})
        self.assertEqual(self.L["cfg"]["checks"], [c["check"] for c in checks])
        self.assertEqual(DP.PRE_TRADE_ORDER, [c["check"] for c in checks])

    def test_halt_from_file(self):
        last = json.loads((self.st / "runs" / "last_run.json").read_text())
        self.assertFalse(last["halt"])
        h = self.L["state"]["halt"]
        self.assertTrue(h["set"])
        self.assertEqual(h["since"], S.HALT_SINCE_TS)
        self.assertEqual(h["reason"], "stopping for the weekend, pot …")
        a = next(x for x in self.L["alerts"] if x["k"] == "halt")
        self.assertEqual((a["lv"], a["t"]), ("bad", S.HALT_SINCE_TS))
        self.assertIn("{time}", a["text"])
        self.assertTrue(any(e[1] == "halt" and e[0] == S.HALT_SINCE_TS for e in self.L["events"]))

    def test_positions_are_ratios(self):
        pos = {p["c"]: p for p in self.L["pos"]}
        self.assertEqual([p["c"] for p in self.L["pos"]], ["SOL", "LINK"])        # closest to its stop first
        link, E = pos["LINK"], S.PAPER_EQ[-1]
        P = S.POSITIONS["LINK"]
        fee = 0.045 / 100
        net = (P["mark"] - P["entry"]) / P["entry"] * P["notional"] - P["entry_fee"] - P["notional"] * P["mark"] / P["entry"] * fee - P["funding_paid"]
        self.assertEqual(link["r_now"], round(net / P["risk_amt"], 2))
        self.assertEqual(link["pnl_pct"], round(net / E * 100, 2))
        self.assertEqual(link["size_pct"], round(P["notional"] / E * 100, 1))
        self.assertEqual(link["risk_pct"], 1)                                            # E4 field wins
        self.assertEqual(link["to_stop_pct"], round((P["mark"] - P["stop"]) / P["mark"] * 100, 2))
        self.assertEqual(link["stops"][0][1], -1000)
        self.assertEqual(len(link["stops"]), 3)
        self.assertEqual(link["px"], {"entry": 13.214, "stop0": 12.843, "stop": 13.366, "mark": 13.894})
        sol = pos["SOL"]
        self.assertEqual(len(sol["stops"]), 2)                                           # legacy: first stop + current
        self.assertEqual(sol["stops"][1][1], round((114.9 - 117.02) / (117.02 - 113.07) * 1000))
        self.assertEqual(self.L["rec"]["open_R"], round(link["r_now"] + sol["r_now"], 2))

    def test_refusal_stages_and_reason_codes(self):
        L, G = self.L, self.b["ledger"]
        rows = {r[1]: r for r in G["signals"]["rows"] if r[5] != "bought"}
        self.assertEqual(rows["CRV"][5:], ["blocked", "vol", 0.36])
        self.assertEqual(rows["UNI"][5:7], ["recorded", "tier"])
        self.assertEqual(rows["ETH"][5:7], ["expired", "expired"])
        self.assertEqual(rows["BNB"][5:], ["notfilled", "fill", None])
        self.assertEqual(rows["HYPE"][5:], ["blocked", "drift", 1.23])
        self.assertEqual(rows["AAVE"][5:7], ["blocked", "recheck"])
        self.assertEqual(rows["JUP"][5:], ["blocked", "maxpos", 6])
        run0 = next(r for r in L["runs"] if r["t"] == S.T0)
        self.assertEqual(run0["rx"]["CRV"], [["vol", 0.36], ["fund", 68]])
        self.assertEqual(run0["tg"], {"LINK": "fA", "CRV": "pB", "UNI": "pB"})
        run1 = next(r for r in L["runs"] if r["t"] == S.T0 + S.H)
        self.assertEqual(run1["rx"]["BNB"], [["fill", None]])
        self.assertEqual(L["pinned"], [[S.T0 - S.H, "JUP", "flip", "maxpos", 6]])

    def test_runs_and_alerts(self):
        L = self.L
        failed = next(r for r in L["runs"] if r["x"])
        self.assertIsNone(failed["rd"])
        ev = {(e[0], e[1]) for e in L["events"]}
        self.assertIn((S.T0 + 2 * S.H, "failed"), ev)
        self.assertIn((S.T0 + S.H, "recon"), ev)
        self.assertIn((S.T0 + S.H, "notfilled"), ev)
        recon = next(e for e in L["events"] if e[1] == "recon")
        self.assertIsNone(recon[6])                                                      # detail dropped
        last = L["runs"][-1]
        self.assertEqual(last["hx"], {"LINK": "t+0.41", "SOL": "g"})                   # (13.366 − 13.214) / (13.214 − 12.843)
        self.assertEqual(last["rd"][L["order"].index("LINK")], "h")
        first = L["runs"][0]
        self.assertEqual(first["rd"][L["order"].index("LINK")], "E")
        kinds = {a["k"] for a in L["alerts"]}
        self.assertEqual(kinds, {"halt", "gap", "proposals"})
        self.assertEqual(L["proposals"], [{"id": "20260925-0021-AAVE-pullback", "c": "AAVE", "kind": "pullback", "tier": "B",
                                           "expires": S.T0 + 4 * S.H}])
        self.assertEqual(L["diag"]["unparsed"], 0)

    def test_ledger(self):
        G = self.b["ledger"]
        self.assertEqual(G["trades"]["total"], 5)
        self.assertEqual(len(G["trades"]["cols"]), len(G["trades"]["rows"][0]))
        eth = dict(zip(G["trades"]["cols"], next(r for r in G["trades"]["rows"] if r[1] == "ETH")))
        self.assertEqual((eth["R"], eth["rel_R"], eth["rsn"]), (2.1, 0.35, "h4"))
        self.assertEqual(eth["cost_R"], round((0.5332 + 0.4646) / 11.9876, 2))
        hype = dict(zip(G["trades"]["cols"], next(r for r in G["trades"]["rows"] if r[1] == "HYPE")))
        self.assertEqual(hype["rsn"], "flatten")
        st = G["stats"]["all"]
        self.assertEqual(st["n"], 5)
        self.assertEqual(st["pf"], round((2.1 + 0.44 + 3.3) / (1.02 + 0.38), 2))
        self.assertEqual(st["streak"], 1)
        self.assertEqual([g["state"] for g in G["verdict"]["gates"]], ["not_yet"] * 4)
        self.assertEqual(G["review"]["date"], "2026-09-20")
        self.assertNotIn("$", G["review"]["md"])
        self.assertEqual(G["sweeps"][0][1:], ["eth-defi", "ETH", 0.42, 0])

    def test_kv_plan(self):
        docs = {"risk": "# Risk\n", "logic": "# Logic\n"}
        pairs, index = DP.kv_pairs(self.b, docs, None)
        self.assertEqual(list(pairs), ["exec:latest", "exec:ledger", "exec:stamp", "doc:risk", "doc:logic", "doc:index"])
        pairs2, _ = DP.kv_pairs(self.b, docs, index)
        self.assertEqual(list(pairs2), ["exec:latest", "exec:ledger", "exec:stamp"])     # nothing changed: 3 writes
        pairs3, _ = DP.kv_pairs(self.b, dict(docs, risk="# Risk v2\n"), index)
        self.assertEqual(list(pairs3), ["exec:latest", "exec:ledger", "exec:stamp", "doc:risk", "doc:index"])
        self.assertFalse(any(k.startswith("exec:20") or k == "dates" for k in pairs))

    def test_kv_json_flag(self):
        out = Path(self.tmp.name) / "kv.json"
        with contextlib.redirect_stdout(io.StringIO()):
            DP.main(["--kv-json", str(out), "--state", str(self.st), "--config", str(self.cfg), "--now", str(S.NOW)])
        kv = json.loads(out.read_text())
        self.assertTrue({"exec:latest", "exec:ledger", "exec:stamp", "doc:index"} <= set(kv))
        self.assertTrue(all(k in ("exec:latest", "exec:ledger", "exec:stamp", "exec:agents", "doc:index") or k.startswith("doc:") for k in kv))
        idx = json.loads(kv["exec:agents"])
        self.assertEqual(idx["agents"][0]["id"], "core")
        bad = {"equity", "cash", "notional", "pnl", "risk_amt", "start", "peak"}
        self.assertFalse(bad & set(json.dumps(idx).replace('"', ' ').split()), "agents index carries a money field")
        self.assertEqual(json.loads(kv["exec:latest"])["v"], 2)
        self.assertEqual(set(json.loads(kv["doc:index"])), {k[4:] for k in kv if k.startswith("doc:") and k != "doc:index"})

    def test_cloudflare_push_path(self):
        """Same API calls as before: find the namespace by title, read doc:index once, one bulk PUT. Nothing real is called."""
        calls = []
        docs = DP.doc_texts(ROOT / "docs")
        index = {slug: DP.hashlib.sha256(t.encode()).hexdigest() for slug, t in docs.items()}

        def fake_api(path, payload=None, method=None):
            calls.append((path, payload))
            if path.startswith("/storage/kv/namespaces?"):
                return {"result": [{"title": "other", "id": "x"}, {"title": DP.NAMESPACE_TITLE, "id": "ns1"}]}
            return {"success": True}
        env = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}
        with mock.patch.object(DP, "api", fake_api), mock.patch.object(DP, "kv_get", return_value=json.dumps(index)) as get, \
                mock.patch.dict("os.environ", env), contextlib.redirect_stdout(io.StringIO()):
            DP.main(["--state", str(self.st), "--config", str(self.cfg), "--now", str(S.NOW)])
        self.assertEqual([c.args for c in get.call_args_list], [("ns1", "doc:index"), ("ns1", "exec:agents")])
        self.assertEqual(calls[1][0], "/storage/kv/namespaces/ns1/bulk")
        self.assertEqual([x["key"] for x in calls[1][1]], ["exec:latest", "exec:ledger", "exec:stamp", "exec:agents"])
        self.assertEqual(len(calls), 2)

    def test_scrubber_refuses_a_leak(self):
        with self.assertRaises(AssertionError):
            DP.scrub_assert({"a": {"notional": 1}})
        with self.assertRaises(AssertionError):
            DP.scrub_assert({"a": ["pot was $1,000"]})
        DP.scrub_assert({"a": ["volume 0.73× the minimum", "{time}"]})
        money = DP.money_set([1000.0, 987.65])
        for leak in ("equity was 1000.0, pausing", "pot=1,000 stop", "down to 987.65", "(1000)"):
            with self.assertRaises(AssertionError, msg=leak):
                DP.scrub_assert({"a": [leak]}, money=money)
        DP.scrub_assert({"a": ["20260925-1000-AAVE-pullback", "2026-09-25T10:00:00.000Z", "LINK-1000", "vol 0.73", "132"]}, money=money)

    def test_free_text_never_keeps_a_number(self):
        """The owner's HALT reason is the one free text in exec:latest: any number without a unit becomes '…'."""
        cases = {"equity was 1000.0, pausing for the weekend": "equity was …, pausing for the weekend",
                 "pausing: pot 1000.0 after the dip": "pausing: pot … after the dip",
                 "pot=1000.0 USDC stop": "pot … stop",
                 "down to 987.65 from 1000": "down to … from …",
                 "pot $1,234.56, 1.2k in positions": "pot … in positions",
                 "drawdown 12%, back in 45 min, 0.73× volume, risk 0.5 R": "drawdown 12%, back in 45 min, 0.73× volume, risk 0.5 R",
                 "until Sep 28 at 3:12 pm": "until Sep … at … pm",
                 "1000,12% and 1000 12%": "… and … 12%"}
        for text, want in cases.items():
            got = DP.halt_reason(text)[0]
            self.assertEqual(got, want, text)
            self.assertTrue(DP.free_text_ok(got), got)
        long = "x" * 78 + " 12%"                                         # the 80-character cut must not strand "12"
        self.assertTrue(DP.free_text_ok(DP.halt_reason(long)[0]))

    def test_halt_reason_with_a_pot_figure(self):
        """A HALT reason naming the pot reaches neither exec:latest nor the alert nor the halt event."""
        for text in ("equity was 1234.56, pausing for the weekend", "pot=1234.56 USDC stop", "down to 1260.9 from 1234.56"):
            with tempfile.TemporaryDirectory() as d:
                st, cfg = S.make_state(Path(d), "paper")
                (st / "HALT").write_text(text)
                last = json.loads((st / "runs" / "last_run.json").read_text())
                last["summary"].insert(0, f"HALT set: {text} (exits still managed, no entries)")
                (st / "runs" / "last_run.json").write_text(json.dumps(last))
                b = DP.build(st, cfg, S.NOW)
            raw = DP.dumps(b["latest"]) + DP.dumps(b["ledger"])
            for m in ("1234.56", "1260.9", "1,234"):
                self.assertNotIn(m, raw, text)
            self.assertIn("…", b["latest"]["state"]["halt"]["reason"])
            self.assertIn(b["latest"]["state"]["halt"]["reason"], next(a["text"] for a in b["latest"]["alerts"] if a["k"] == "halt"))


class Live(unittest.TestCase):
    """mode=live: the first live equity point is the baseline and paper.json is never opened."""

    def test_live_baseline(self):
        with tempfile.TemporaryDirectory() as d:
            st, cfg = S.make_state(Path(d), "live")
            self.assertFalse((st / "paper.json").exists())
            real_open, real_read = open, Path.read_text

            def guard_open(f, *a, **k):
                assert not str(f).endswith("paper.json"), "paper.json opened"
                return real_open(f, *a, **k)

            def guard_read(p, *a, **k):
                assert not str(p).endswith("paper.json"), "paper.json read"
                return real_read(p, *a, **k)
            with mock.patch("builtins.open", guard_open), mock.patch.object(Path, "read_text", guard_read):
                b = DP.build(st, cfg, S.NOW)
        L = b["latest"]
        self.assertEqual(L["mode"], {"eff": "live", "req": "live", "note": ""})
        self.assertEqual(L["pot"]["chg_pct"], round((S.LIVE_EQ[-1] / S.LIVE_POT - 1) * 100, 2))
        self.assertEqual(L["pot"]["since"], S.T0 + S.H)
        self.assertFalse(L["pot"]["net"])
        self.assertEqual(L["state"]["thr"]["dd_pct"], 2.42)
        self.assertEqual(L["origin"]["mode"], "live")
        self.assertEqual(L["risk"]["used_pct"], round((12.3456 + 6.1728) / S.LIVE_EQ[-1] * 100, 2))
        self.assertEqual(b["ledger"]["trades"]["total"], 0)                             # the five trades are paper
        for name, p in payloads(b).items():
            raw = DP.dumps(p)
            for m in ("377.19", "371.29", "1234.56"):
                self.assertNotIn(m, raw, name)

    def test_fallback_note(self):
        with tempfile.TemporaryDirectory() as d:
            st, cfg = S.make_state(Path(d), "paper", halt=False)
            s = json.loads((cfg / "settings.json").read_text())
            s["mode"] = "live"
            (cfg / "settings.json").write_text(json.dumps(s))
            last = json.loads((st / "runs" / "last_run.json").read_text())
            last["summary"].insert(0, "live requested but HL_AGENT_KEY / HL_ACCOUNT_ADDRESS missing: running paper")
            (st / "runs" / "last_run.json").write_text(json.dumps(last))
            L = DP.build(st, cfg, S.NOW)["latest"]
        self.assertEqual(L["mode"], {"eff": "paper", "req": "live", "note": "exchange key or account address missing"})
        a = next(x for x in L["alerts"] if x["k"] == "fallback")
        self.assertEqual(a["text"], "Live requested, running paper: exchange key or account address missing.")


class Real(unittest.TestCase):
    """The executor's real first nine checks (tests/fixtures/real), with the spec's verified ground truth."""

    @classmethod
    def setUpClass(cls):
        cls.b = DP.build(REAL / "state", REAL / "config", REAL_NOW)
        cls.L = cls.b["latest"]

    def test_rd_strings(self):
        rd = {r["t"]: r["rd"] for r in self.L["runs"]}
        self.assertEqual(rd[1790266854], "aatutuuudwdatu")
        self.assertEqual(rd[1790281235], "aaturuuudwdatu")
        self.assertEqual(rd[1790296047], "aatpuruudwdatu")
        self.assertEqual(rd[1790310000], "aatuuuuudwdatu")
        self.assertEqual(sum(1 for r in self.L["runs"] if r["rd"] is None), 5)
        early = next(r for r in self.L["runs"] if r["t"] == 1790223895)
        self.assertEqual(early["tg"], {"JUP": "pB", "ETH": "pB", "HYPE": "pB"})
        self.assertEqual(early["rx"], {"JUP": [["vol", 0.26]]})

    def test_funnel(self):
        f = self.L["funnel"]["all"]
        self.assertEqual({k: f[k] for k in ("checks", "signals", "passed", "auto", "auto_passed", "bought", "blocked", "blocked_auto",
                                           "recorded", "proposed", "expired", "notfilled")},
                         {"checks": 124, "signals": 8, "passed": 5, "auto": 1, "auto_passed": 0, "bought": 0, "blocked": 3, "blocked_auto": 1,
                          "recorded": 3, "proposed": 2, "expired": 2, "notfilled": 0})
        self.assertEqual(f["by_check"], {"vol": 3})
        self.assertEqual(f["blocked"] + f["recorded"] + f["expired"] + f["notfilled"], f["signals"])

    def test_clock_and_last24(self):
        self.assertEqual(self.L["clock"], {"last_t": 1790310000, "last_slot": 1790308800, "late_min": 20, "lag_med_min": 21,
                                           "lag_rng": [20, 27], "lag_n": 7, "limit_min": 45, "sched_min": 5})
        self.assertEqual(self.L["last24"], {"slots": 6, "on_time": 6, "late": 0, "missed": 0, "failed": 0, "signals": 5, "bought": 0, "sold": 0})
        self.assertEqual(self.L["origin"], {"t": 1790203756, "mode": "paper"})
        self.assertEqual(self.b["stamp"], {"v": 2, "gen": "2026-09-25T04:47:26.060Z", "t": 1790310000})

    def test_names_and_books(self):
        n = {x["c"]: x for x in self.L["names"]}
        self.assertEqual(len(n), 14)
        groups = {}
        for x in self.L["names"]:
            groups.setdefault(x["grp"], []).append(x["c"])
        self.assertEqual(groups, {"next": ["BTC", "ETH", "HYPE"], "thin": ["AAVE", "BNB"], "run": ["UNI", "LINK", "CRV", "SOL", "JUP", "CAKE"],
                                  "notset": ["JTO", "PENGU", "PUMP"]})
        self.assertEqual((n["BTC"]["dist"], n["ETH"]["dist"], n["HYPE"]["dist"]), (3.28, 4.38, 8.11))
        self.assertEqual((n["AAVE"]["dist"], n["AAVE"]["vx"]), (4.19, 0.43))
        self.assertEqual(n["BNB"]["vx"], 0.25)
        self.assertEqual(n["CRV"]["elig"], [["vol", 0.38], ["fund", 67.6]])
        self.assertEqual(n["LINK"]["vx"], 1.12)
        self.assertEqual(n["BTC"]["px"], {"close": 84221, "line": 86983})
        books = {b["b"]: (b["tradeable"], b["of"]) for b in self.L["books"]}
        self.assertEqual(books, {"bitcoin": (1, 1), "eth-defi": (3, 5), "solana": (2, 5), "hype": (1, 1), "bnb": (0, 2)})

    def test_pinned_events_and_empty_ledger(self):
        self.assertEqual(self.L["pinned"], [[1790281235, "LINK", "flip", "vol", 0.73]])
        link = next(e for e in self.L["events"] if e[2] == "LINK")
        self.assertEqual(link, [1790281235, "blocked", "LINK", "flip", "A", 2, "vol 0.73", None, None])
        lates = [e for e in self.L["events"] if e[1] == "late"]
        self.assertEqual([e[6] for e in lates], ["132", "169"])
        expired = [e for e in self.L["events"] if e[1] == "expired"]
        self.assertEqual([(e[2], e[3], e[4]) for e in expired], [("ETH", "pullback", "B"), ("HYPE", "pullback", "B")])
        self.assertEqual(self.L["alerts"], [])
        self.assertEqual(self.L["pot"]["chg_pct"], 0)
        G = self.b["ledger"]
        self.assertEqual(G["trades"]["total"], 0)
        self.assertEqual(G["signals"]["total"], 8)
        self.assertEqual([g["state"] for g in G["verdict"]["gates"]], ["not_yet"] * 4)

    def test_privacy_on_real_data(self):
        for name, p in payloads(self.b).items():
            raw = DP.dumps(p)
            self.assertNotIn("1000.0", raw, name)
            self.assertNotIn("EDT", raw, name)
            for _path, k, v in walk(json.loads(raw)):
                if k is not None:
                    self.assertIsNone(KEY_RX.match(k), f"{name}: {k}")
                if isinstance(v, str):
                    self.assertIsNone(STR_RX.search(v), f"{name}: {v}")
        self.assertLessEqual(len(DP.dumps(self.L)), 12 * 1024)


class Demo(unittest.TestCase):
    """The mature demo state goes through the same serializer: 40 names, 6 positions, 300 trades, 60 runs, 200 events,
    ≤ 50 KB."""

    def test_budget_fit(self):
        """Over 50 KB, the oldest runs lose their dx first, then the oldest board events; nothing else is dropped."""
        runs = [{"t": i, "rd": "a" * 40, "dx": list(range(100, 140)), "hx": {}} for i in range(60)]
        ev = [[1000 - i, "board" if i % 2 else "blocked", "BTC", None, None, 0 if i % 2 else 2, "d 0>1", None, None] for i in range(200)]
        L = {"runs": runs, "events": ev, "pad": "x" * 30000, "diag": {"unparsed": 0}}
        DP.Bundle.fit(L)
        self.assertLessEqual(len(DP.dumps(L)), DP.LATEST_BUDGET)
        self.assertEqual(len(L["runs"]), 60)
        self.assertTrue(all(r["dx"] is not None for r in L["runs"][-DP.DX_KEEP:]))
        self.assertEqual(sum(1 for e in L["events"] if e[5] >= 1), 100)
        self.assertEqual(L["diag"]["trim"]["dx"], sum(1 for r in L["runs"] if r["dx"] is None))
        small = {"runs": runs[:2], "events": [], "diag": {"unparsed": 0}}
        DP.Bundle.fit(small)
        self.assertNotIn("trim", small["diag"])

    def test_mature_demo(self):
        import dashboard_demo as DD
        world = DD.World("mature", 7, REAL_NOW)
        world.build()
        with tempfile.TemporaryDirectory() as d:
            st, cfg = world.write(Path(d))
            b = DP.build(st, cfg, REAL_NOW)
        L = b["latest"]
        self.assertEqual(b["unparsed"], [])
        self.assertEqual((len(L["order"]), len(L["pos"]), b["ledger"]["trades"]["total"]), (40, 6, 300))
        self.assertTrue(any(x["n"] > 30 for x in b["ledger"]["verdict"]["books"]))
        self.assertLessEqual(len(DP.dumps(L)), 50 * 1024)
        flags = {(r["ok"], r["x"], r["h"]) for r in L["runs"]}
        self.assertTrue({(0, 0, 0), (0, 1, 0), (1, 0, 1), (1, 0, 0)} <= flags)          # late, failed, halted, normal
        slots = [r["s"] for r in L["runs"]]
        self.assertTrue(any(slots.count(s) == 2 for s in slots))                         # a two-run slot
        self.assertTrue(any(e[1] == "thr_half" for e in L["events"]))
        # the caps the 50 KB budget is sized for: 60 runs in the 7-day window and 200 events
        self.assertEqual((len(L["runs"]), len(L["events"])), (DP.RUNS_CAP, DP.EVENTS_CAP))
        self.assertTrue(all(r["t"] >= REAL_NOW - DP.WEEK for r in L["runs"]))
        self.assertEqual(sum(1 for r in L["runs"] if r["rd"] is not None and r["dx"] is not None) + L["diag"].get("trim", {}).get("dx", 0),
                         sum(1 for r in L["runs"] if r["rd"] is not None))
        self.assertTrue(all(r["dx"] is not None for r in L["runs"][-DP.DX_KEEP:] if r["rd"] is not None))
        # Now › Latest has quiet checks to fold: the newest two carry no event of level 1 or more
        loud_t = {e[0] for e in L["events"] if e[5] >= 1}
        self.assertEqual([r["t"] in loud_t for r in L["runs"][-2:]], [False, False])
        raw = DP.dumps(L) + DP.dumps(b["ledger"])
        self.assertNotIn("2500.0", raw)
        self.assertNotIn(str(DD.START), raw)


if __name__ == "__main__":
    unittest.main()
