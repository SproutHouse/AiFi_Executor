"""The fleet (Phase 6) and the owner's go-live switch (Phase 5): the fleet kill switch halts entries on every agent
but never exits, the fleet size dial applies only when the owner turns regime weights on, the live-drawdown guard
sets the switch, and go_live.py flips exactly one agent with a paper twin and refuses what is not validated."""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
import _path  # noqa: F401
from executor import common as C, cycle as CY
import test_cycle as TC

ROOT = Path(__file__).resolve().parents[1]


def sandbox():
    """A throwaway EXECUTOR_HOME with copies of config/ and agents/ (the real repo is never touched)."""
    home = Path(tempfile.mkdtemp(prefix="exec-home-"))
    shutil.copytree(ROOT / "config", home / "config")
    shutil.copytree(ROOT / "agents", home / "agents")
    (home / "state").mkdir()
    return home


def run(home, *args):
    env = dict(os.environ, EXECUTOR_HOME=str(home), EXECUTOR_STATE=str(home / "state"), EXECUTOR_FLEET_HALT=str(home / "state" / "FLEET_HALT"),
               PYTHONPATH=str(ROOT / "src"), ALERT_WEBHOOK="")
    env.pop("EXECUTOR_AGENT", None)
    return subprocess.run([sys.executable] + list(args), env=env, capture_output=True, text=True, cwd=str(ROOT))


class FleetHalt(TC.Base):
    def tearDown(self):
        C.FLEET_HALT.unlink(missing_ok=True)
        super().tearDown()

    def test_fleet_halt_blocks_entries_not_exits(self):
        C.FLEET_HALT.parent.mkdir(parents=True, exist_ok=True)
        C.FLEET_HALT.write_text("drill")
        cy = self.cycle("paper", {"ETH": TC.paper_pos("ETH")}, {"ETH": [{"t": 14400, "T": 28799, "o": 96, "h": 97, "l": 94, "c": 94.5}]}, {"ETH": 100.0})
        self.assertTrue(cy.halt)
        self.assertIn("fleet halt: drill", cy.halt_reason)
        TC.CTX.update({"ETH": TC.ctx()})
        cy.manage_exits()                                   # the stop at 95 still fires: exits never wait on a halt
        self.assertNotIn("ETH", cy.positions)


class FleetDial(unittest.TestCase):
    def test_dial_only_when_owner_turns_it_on(self):
        real = C.FLEET_CFG
        tmp = Path(tempfile.mkdtemp()) / "fleet.json"
        try:
            C.FLEET_CFG = tmp
            tmp.write_text(json.dumps({"apply_regime_weights": False, "size_mult": {"core": 0.5}}))
            self.assertEqual(C.fleet_mult("core"), 1.0)
            tmp.write_text(json.dumps({"apply_regime_weights": True, "size_mult": {"core": 0.5}}))
            self.assertEqual(C.fleet_mult("core"), 0.5)
            self.assertEqual(C.fleet_mult("trend-1d"), 1.0)
            tmp.write_text(json.dumps({"apply_regime_weights": True, "size_mult": {"core": 7}}))
            self.assertEqual(C.fleet_mult("core"), 1.0)            # clamped to 0..1: the dial can only shrink
        finally:
            C.FLEET_CFG = real


class Guard(unittest.TestCase):
    def test_live_drawdown_sets_the_fleet_halt(self):
        home = sandbox()
        st = home / "state" / "agents" / "trend-1d" / "ledger"
        st.mkdir(parents=True)
        pts = [{"ts": i, "equity": e, "mode": "live"} for i, e in enumerate([1000, 1100, 900])]
        st.joinpath("equity.jsonl").write_text("\n".join(json.dumps(p) for p in pts) + "\n")
        code = "import sys; sys.path.insert(0,'scripts'); import run_agents as R; print(R.fleet_guard())"
        r = run(home, "-c", code)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((home / "state" / "FLEET_HALT").exists())
        self.assertIn("fleet drawdown 18.2%", (home / "state" / "FLEET_HALT").read_text())

    def test_paper_equity_never_trips_it(self):
        home = sandbox()
        st = home / "state" / "agents" / "trend-1d" / "ledger"
        st.mkdir(parents=True)
        st.joinpath("equity.jsonl").write_text(json.dumps({"ts": 1, "equity": 1000, "mode": "paper"}) + "\n" + json.dumps({"ts": 2, "equity": 500, "mode": "paper"}) + "\n")
        r = run(home, "-c", "import sys; sys.path.insert(0,'scripts'); import run_agents as R; print(R.fleet_guard())")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse((home / "state" / "FLEET_HALT").exists())


class GoLive(unittest.TestCase):
    def test_flips_one_agent_and_adds_a_twin(self):
        home = sandbox()
        r = run(home, "scripts/go_live.py", "trend-1d", "--pot", "250")
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        s = json.loads((home / "agents" / "trend-1d" / "settings.json").read_text())
        t = json.loads((home / "agents" / "trend-1d-twin" / "settings.json").read_text())
        idx = json.loads((home / "agents" / "index.json").read_text())
        ids = [a["id"] for a in idx["agents"]]
        self.assertEqual(s["mode"], "live")
        self.assertEqual((t["mode"], t["pot_usd_paper"], t["twin_of"]), ("paper", 250.0, "trend-1d"))
        self.assertEqual(ids[ids.index("trend-1d") + 1], "trend-1d-twin")
        others = [json.loads((home / "agents" / a / "settings.json").read_text())["mode"] for a in ("wide-4h", "fast-1h", "carry-1h")]
        self.assertEqual(others, ["paper"] * 3)
        r = run(home, "scripts/go_live.py", "trend-1d", "--pot", "250")
        self.assertNotEqual(r.returncode, 0)                       # already live
        r = run(home, "scripts/go_live.py", "trend-1d", "--back")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads((home / "agents" / "trend-1d" / "settings.json").read_text())["mode"], "paper")

    def test_refuses_unvalidated_carry_and_twins(self):
        home = sandbox()
        r = run(home, "scripts/go_live.py", "carry-1h", "--pot", "250")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("testnet", r.stderr + r.stdout)
        run(home, "scripts/go_live.py", "trend-1d", "--pot", "100")
        r = run(home, "scripts/go_live.py", "trend-1d-twin", "--pot", "100")
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
