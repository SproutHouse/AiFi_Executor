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
        self.assertLess(size, 440_000)  # 420 KB until 2026-10-02; +20 KB for the hover-tip words (core TIP) and the Bot factory section

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


if __name__ == "__main__":
    unittest.main()
