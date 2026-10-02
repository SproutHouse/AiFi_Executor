"""Dashboard client (cloud/worker.js + cloud/ui/*): the joined page script and the module contract.

Runs tests/client_join_check.mjs with node, which loads the Worker the way cloud/dev/preview.mjs does and checks that
every ui/ module compiles and keeps the block contract (only core.js declares top-level names), that the joined client
compiles and carries every module in the README order, the app shell's one h1 and mounts, that doc and login pages
never load the app bundle, and the ledger and stamp routes; then the hover-tip words and the Bot factory section in a vm
(COMMAND_CENTER_SPEC §3.7, §3.11). Skipped when node is not installed."""
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


if __name__ == "__main__":
    unittest.main()
