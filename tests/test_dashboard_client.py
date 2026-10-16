"""Dashboard client (cloud/worker.js + cloud/ui/*): the joined page script and the module contract.

Runs tests/client_join_check.mjs with node, which loads the Worker the way cloud/dev/preview.mjs does and checks that
every ui/ module compiles and keeps the block contract (only core.js declares top-level names), that the joined client
compiles and carries every module in the README order, the app shell's one h1 and mounts, that doc and login pages
never load the app bundle, and the ledger and stamp routes; then the hover-tip words and the Bot factory section in a vm
(COMMAND_CENTER_SPEC §3.7, §3.11), and the AiFi Lab page (§11). Skipped when node is not installed."""
import json, shutil, subprocess, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class JoinedClient(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run(["node", str(HERE / "client_join_check.mjs")], capture_output=True, text=True, timeout=120)
        cls.stderr = p.stderr
        line = (p.stdout.strip().splitlines() or ["{}"])[-1]
        try:
            cls.res = json.loads(line)
        except ValueError:
            cls.res = {"ok": False, "problems": ["the checker printed no result: " + (p.stdout + p.stderr)[-800:]]}

    def test_contract_and_page(self):
        self.assertEqual(self.res.get("problems"), [], self.stderr[-800:])
        self.assertTrue(self.res.get("ok"))

    def test_client_is_lean(self):
        # §15 targets 95 KB for the client; the modules are far past it, so this guards against regressions only.
        size = (self.res.get("facts") or {}).get("client_bytes")
        self.assertIsNotNone(size)
        # 420 KB until 2026-10-02; +20 KB for the hover-tip words (core TIP) and the Bot factory section; +15 KB on 2026-10-16
        # for the review's honesty fixes: the lab's evidence on the Shortlist and an arena bot's page (not luck now, vs Bitcoin,
        # execution, edge), "Page behind" and who to suspect when a bot is stale, lifetime carry with the hedge result, and
        # % of pot first on every sale (449.9 KB measured)
        self.assertLess(size, 455_000)

    def test_tips_have_words(self):
        # COMMAND_CENTER_SPEC §3.11: every TIP key and every status word has plain words (checked in the harness); a few
        # dynamic ones carry this bot's own cadence, times and counts.
        t = (self.res.get("facts") or {}).get("tips")
        self.assertIsNotNone(t, self.res.get("problems"))
        self.assertGreaterEqual(t["keys"], 40)
        self.assertRegex(t["ok"], r"^On schedule It checks the market every 4 hours\. Its last check \(2 h ago\) ran on time\. Next check about .+\.$")
        self.assertIn("hasn’t sent its schedule yet", t["v1"])
        self.assertIn("past its 45-min limit", t["late_now"])
        self.assertIn("18 of the last 18 ran on time", t["beads"])
        self.assertIn("R is the amount this bot planned to risk on one trade: +1 R means it won what it risked", t["ropen"])
        self.assertTrue(t["unknown_family"].startswith("Vol breakout"))

    def test_factory_section_full_and_old_shape(self):
        # COMMAND_CENTER_SPEC §3.7: the lab's funnel with its newer fields, and an older exec:factory without them.
        fx = (self.res.get("facts") or {}).get("factory")
        self.assertIsNotNone(fx, self.res.get("problems"))
        full, old = fx["full"], fx["old"]
        self.assertIn("Every night the AiFi Lab invents new bot recipes", full)
        self.assertRegex(full, r"42 tested 37 passed the quick check 8 passed the full audit 6 waiting for the final-year test "
                               r"2 passed the unseen final year 1 turned down at the lab’s final review 1 trading in the arena \(paper\) 0 ready for you")
        self.assertIn("Last night : 18 recipes tested, 0 passed", full)
        self.assertRegex(full, r"Bull-market momentum 18 tested · 0 passed .*Strongest-coins rotation 3 tested · 1 passed")
        self.assertIn("Research: Bull Momentum · Best bull detector", full)
        self.assertIn("Shortlist Fleet split", full)
        # older payload: tried and survivors stand in, the steps it cannot know read "—" (never 0), no "last night"
        self.assertRegex(old, r"24 tested — passed the quick check — passed the full audit 2 passed the unseen final year "
                              r"1 trading in the arena \(paper\) 0 ready for you")
        self.assertIn("Latest batch, Sep 30", old)
        self.assertNotIn("Last night", old)
        self.assertNotIn("Research", old)
        self.assertNotIn("waiting for the final-year test", old)
        self.assertNotIn("Bull-market momentum", old)
        # an unknown family reads as its own words; nothing published, or still loading, says so
        self.assertIn("Vol breakout 3 tested · — passed", fx["odd"])
        self.assertIn("— trading in the arena", fx["odd"])
        self.assertIn("The lab hasn’t published its record yet.", fx["none"])
        self.assertNotIn("Shortlist", fx["none"])
        self.assertIn("Loading the lab’s record…", fx["loading"])

    def test_lab_page(self):
        # COMMAND_CENTER_SPEC §11: the AiFi Lab page on the invented log (cloud/dev/fx_lab.json), its own small bundle,
        # and payloads that are empty or of an older shape. The route and shell checks run in the harness itself.
        f = self.res.get("facts") or {}
        lab = f.get("lab")
        self.assertIsNotNone(lab, self.res.get("problems"))
        self.assertLess(f["lab_client_bytes"], 200_000)  # core + lab + boot only
        full = lab["full"]
        self.assertRegex(full, r"20 tested 3 killed early 10 failed the audit 3 waiting for the exam 1 failed the exam "
                               r"2 passed every check 1 turned down by the auditor · 1 in the arena")
        self.assertIn("Rulebook v2 · about 25 min of testing a night · 25 arena slots", full)
        self.assertIn("Bull-market momentum 8 tested · 2 passed", full)
        self.assertIn("Vol squeeze 1 tested · 0 passed", full)  # a family the dashboard has no name for
        self.assertIn("Showing the 18 newest of 20.", full)
        self.assertIn("All 18 Passed 2 Failed 10 Killed early 3 Waiting for exam 3", full)
        self.assertIn("Vol squeeze · Auto scout · stopped at: Quick check · Sharpe −0.20 Killed early", full)
        self.assertIn("stopped at: Different from the fleet", full)
        self.assertIn("Passed → Arena", full)
        self.assertIn("Turned down by the auditor", full)
        self.assertLess(full.index("Fri Oct 2"), full.index("Thu Oct 1"))  # newest day first
        # empty: every number "—", never 0; old shape (no stage, fail, gv, totals, families, runs): counted from the rows
        self.assertIn("— tested — killed early — failed the audit", lab["empty"])
        self.assertIn("The lab hasn’t logged a test yet.", lab["empty"])
        self.assertIn("8 tested 1 killed early 6 failed the audit", lab["old"])
        self.assertIn("Rulebook —", lab["old"])
        # the sheet: with its day record every check, the backtest, the final exam and the auditor; without, the summary
        sf = lab["sheet_full"]
        for s in ("Passed → Arena", "Open arena-09 in the arena ›", "Quick check passed Full audit passed Other coins passed Final exam passed",
                  "Protective stop: 20%", "All 7 settings, as the lab wrote them", "✓ Luck test", "Return a year +24.6%",
                  "98% sure it isn’t luck", "Final exam: the unseen year Return +12.0% Sharpe 1.02", "Note: An invented note"):
            self.assertIn(s, sf)
        self.assertIn("Turned down: An invented reason", lab["sheet_veto"])
        ss = lab["sheet_summary"]
        self.assertIn("The full record of this test isn’t stored", ss)
        self.assertIn("Failed checks ✗ Beats just holding", ss)
        self.assertIn("Full audit failed here Other coins not reached", ss)
        self.assertNotIn("Settings", ss)
        # the replay: 15–60 s whatever the bench size (order and slots are checked in the harness)
        for k, p in lab["plans"].items():
            self.assertLessEqual(p["end"], 60_000, k)
            self.assertGreaterEqual(p["end"], 4_500, k)


    def test_worker_login_and_lab_guard(self):
        # worker.js: a constant-time password check with a fixed pause after a wrong one; the lab's payloads lose any money
        # key and currency text on the way out (the push guards exec:factory too), and keep the lab's own names
        w = (self.res.get("facts") or {}).get("worker")
        self.assertIsNotNone(w, self.res.get("problems"))
        self.assertGreaterEqual(w["wrong_ms"], 900)
        self.assertEqual(w["factory"]["shortlist"][0], {"agent": "a", "paper": {"ret_pct": 1}, "hypothesis": "—"})
        self.assertEqual(w["lab"], {"v": 1, "rules": "v2", "runs": [{"start": "2026-10-16T00:00:00Z"}]})

    def test_review_page_behind_and_stale(self):
        # 2026-10-16 (D1b): a page behind its bot says so, with both times and why, and never blames the runner while the
        # server's heartbeat is fresh; the clock then runs from the bot's newest check
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        f = r["failing"]
        self.assertEqual((f["word"], f["lvl"], f["items"]), ("Page behind", "bad", ["behind"]))
        self.assertRegex(f["text"], r"^Page behind · it checked at .+, but this page still shows .+: a privacy check refused the new numbers "
                                    r"\(failing since .+\)\. The bot itself is running\.$")
        self.assertEqual(f["next"], 1792145160)                       # 10:06Z: from the 09:05Z check the state records
        self.assertEqual(f["age"], "2h 59m")                          # the pill says how far behind (06:05:45Z → 09:05:40Z)
        self.assertEqual((r["pending"]["word"], r["pending"]["lvl"]), ("Page behind", "warn"))
        self.assertIn("the update has not landed yet", r["pending"]["text"])
        self.assertIn("though the server is running: this bot’s checks are not landing", r["stale_up"])
        self.assertIn("The server may be down: its last tick was", r["stale_down"])
        self.assertIn("The server, or the dashboard update, may be down", r["stale_none"])
        for k in ("stale_up", "stale_down", "stale_none"):
            self.assertNotIn("runner may be down", r[k])

    def test_review_percent_of_pot_first(self):
        # D8: a sale and a raised stop read % of pot first, R in brackets; an older row without the 10th column keeps R
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        self.assertEqual(r["sold"], "Sold LINK −0.52% of pot ( −0.50 R , stop hit)")
        self.assertEqual(r["sold_old"], "Sold LINK −0.50 R (stop hit)")
        self.assertEqual(r["trail"], "LINK stop raised, locks +0.41% of pot ( +0.38 R )")
        m = r["master"]
        self.assertIn("Sold HYPE −0.61% of pot (−0.55 R) ·", m)                 # the tile's last trade
        self.assertIn("Holding 2 coins +0.31% open (+0.40 R)", m)
        self.assertIn("Bought INJ · sold AAVE ·", m)                          # a rotation shows both of its actions (D17)

    def test_review_master(self):
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        m = r["master"]
        # D7: the executor's own paper pot, never the lab's figure
        self.assertIn("Fleet (paper) −2.71% drawdown 2.90% · worst 3.40% · 8 bots", m)
        self.assertNotIn("−3.44%", m)
        # D1b: a bare row whose push failed and a row behind its state; the tile says how old its numbers are
        self.assertEqual((r["words"]["wide-4h"], r["words"]["fast-1h"], r["words"]["core"]), ("Page behind", "Page behind", "On schedule"))
        self.assertIn("2 page behind", m)
        self.assertRegex(m, r"Fast Signal trader · hourly Paper Page behind · checked .+, page shows .+ · as of ")
        self.assertRegex(m, r"Next check: Fast ≈ ")                       # from its newest check, not "due now"
        # D5: lifetime capture and the hedge result on the carry tile
        self.assertIn("Funding kept 61% below 80% gate Hedge result −2.38% of pot", m)
        # D10: the log says how many of a bot's week's events did not fit
        self.assertIn("A03 Bull 4 older events this week on its page ›", m)
        self.assertNotIn("runner may be down", m)

    def test_review_lab_evidence(self):
        # the lab's 2026-10-16 contract on the Shortlist (invented fixture cloud/dev/fx_factory_v3.json); Ready only when true
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        s = r["shortlist"]
        self.assertNotIn("Real, not luck", s)
        self.assertIn("Not luck, now: 62% sure (99.1% at its trial; 214 recipes tried by now)", s)
        self.assertIn("Backtest (2,740 days): bot +420.0% · Bitcoin +610.0% held, +300.0% at the same risk · beats it by 4.1%/yr (t 1.4)", s)
        self.assertIn("Paper (13 days): bot +0.6% · Bitcoin −1.2% held, −0.5% at the same risk · beats it by 9.5%/yr (t 0.3)", s)
        self.assertIn("Execution verified ✓ 38 orders · 11 days invested · 100% of checks clean · paper vs backtest +0.12%", s)
        self.assertIn("Edge evidence: moderate (t 1.4 of 2.0 needed, about 5 more months)", s)
        self.assertIn("Execution verified ✗", s)
        self.assertIn("✗ orders matched the backtest 27 of 30", s)
        self.assertIn("trails it by 0.8%/yr (t −0.3)", s)
        self.assertIn("Edge evidence: strong (t 2.2 of 2.0 needed)", s)
        self.assertIn("Not luck, now: — (99.7% at its trial) vs Bitcoin — Execution verified — Edge evidence: —", s)   # an older entry
        self.assertIn("Paper so far · lab, ", s)                             # the lab's snapshot is dated
        self.assertEqual(s.count("Ready for you"), 1)                          # A09 only: ready "yes" is not ready
        self.assertIn("1 ready for you", s)
        self.assertIn("4 trading in the arena (paper) 1 ready for you", r["factory"])

    def test_review_arena_bot_page(self):
        # D4: "Paper so far" is the bot's own pot (+0.09%), never the lab's day-old copy (−2.07%); lab numbers say "lab, <time>"
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        b = r["bot"]
        self.assertIn("Return 25.0%/yr (7.5 yrs) +0.09% in 12 days", b)
        self.assertIn("Worst drawdown 19.0% 3.72%", b)
        self.assertNotIn("−2.07%", b)
        self.assertIn("100% of 420 checks lab, ", b)
        self.assertIn("Days in arena — 13 of 42", b)
        self.assertIn("Day 13 of 42 in the arena", b)
        self.assertIn("Not luck, now: 62% sure", b)
        self.assertIn("Edge evidence: moderate", b)
        self.assertNotIn("Ready for you", b)
        self.assertIn("Fleet share: 50% of the fleet, equal risk · lab, ", b)
        # D13 / D14 / D15: the stops from the last prices, invested at market, drawdown from the latest point
        self.assertIn("If every stop were hit: −12.40% of pot from here ( −10.10% against the entries)", b)
        self.assertIn("Invested 7.4% of pot at the last prices", b)
        self.assertIn("Drawdown 1.50%", b)

    def test_review_carry_lifetime(self):
        # D5 / D9: lifetime capture, a hedge line, a waterfall that adds up, closed pairs on the capital they used
        r = (self.res.get("facts") or {}).get("review")
        self.assertIsNotNone(r, self.res.get("problems"))
        c = r["carry"]
        self.assertIn("Funding kept 61% of what it could earn every pair, closed ones too · go-live gate 80%", c)
        self.assertIn("Hedge result : −2.38% of pot ( −4.22% booked, +1.84% still open)", c)
        self.assertIn("funding +0.47% · costs −0.18% · hedge −2.38% → −2.08% of pot · the rest is rounding", c)
        self.assertIn("4 pairs closed · −1.89% on the capital they used", c)
        self.assertNotIn("of capital in total", c)
        o = r["carry_old"]                                                     # an older bundle: open pairs, said so
        self.assertIn("Funding kept 70% of what it could earn open pairs only", o)
        self.assertIn("Hedge result : — of pot", o)


if __name__ == "__main__":
    unittest.main()
