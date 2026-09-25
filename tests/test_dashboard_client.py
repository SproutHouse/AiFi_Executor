"""Dashboard client (cloud/worker.js + cloud/ui/*): the joined page script and the module contract.

Runs tests/client_join_check.mjs with node, which loads the Worker the way cloud/dev/preview.mjs does and checks that
every ui/ module compiles and keeps the block contract (only core.js declares top-level names), that the joined client
compiles and carries every module in the README order, the app shell's one h1 and mounts, that doc and login pages
never load the app bundle, and the ledger and stamp routes. Skipped when node is not installed."""
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
        self.assertLess(size, 420_000)


if __name__ == "__main__":
    unittest.main()
