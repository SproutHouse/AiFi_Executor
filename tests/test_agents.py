"""Multi-agent isolation: each agent resolves its own config and state, and each child process of the runner
receives only its own exchange key (never another agent's, never the Cloudflare token)."""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
import _path  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]


def paths_for(agent):
    code = "import sys;sys.path.insert(0,'src');from executor import common as C;print(C.CONFIG);print(C.STATE)"
    env = dict(os.environ, EXECUTOR_AGENT=agent)
    env.pop("EXECUTOR_STATE", None)
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True)
    return out.returncode, out.stdout.split(), out.stderr


class Paths(unittest.TestCase):
    def test_core_keeps_original_locations(self):
        code, (cfg, st), _ = paths_for("core")
        self.assertEqual(code, 0)
        self.assertTrue(cfg.endswith("/config"))
        self.assertTrue(st.endswith("/state"))

    def test_other_agent_is_isolated(self):
        code, (cfg, st), _ = paths_for("wide-4h")
        self.assertEqual(code, 0)
        self.assertTrue(cfg.endswith("/agents/wide-4h"))
        self.assertTrue(st.endswith("/state/agents/wide-4h"))

    def test_bad_agent_id_refused(self):
        code, _, err = paths_for("../etc")
        self.assertNotEqual(code, 0)
        self.assertIn("invalid EXECUTOR_AGENT", err)


class RunnerKeys(unittest.TestCase):
    def test_each_child_gets_only_its_own_key(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import run_agents as RA
        captured = []
        RA.run = lambda cmd, env, label: captured.append((label, dict(env))) or 0
        RA.C.agents = lambda: [{"id": "core", "enabled": True}, {"id": "wide-4h", "enabled": True}]
        RA.agent_settings = lambda aid: {"trigger_tf": "4h"}
        secrets = {"HL_AGENT_KEY": "k-core", "HL_ACCOUNT_ADDRESS": "a-core", "HL_AGENT_KEY_WIDE_4H": "k-wide",
                   "HL_ACCOUNT_ADDRESS_WIDE_4H": "a-wide", "CLOUDFLARE_API_TOKEN": "cf", "CLOUDFLARE_ACCOUNT_ID": "acct", "ALERT_WEBHOOK": "https://x"}
        os.environ["ALL_SECRETS"] = json.dumps(secrets)
        RA.main(["--force"])
        by = {label: env for label, env in captured}
        self.assertEqual(by["core cycle"].get("HL_AGENT_KEY"), "k-core")
        self.assertEqual(by["wide-4h cycle"].get("HL_AGENT_KEY"), "k-wide")
        for label, env in captured:
            blob = json.dumps(env)
            if label.endswith("cycle"):
                self.assertNotIn("cf", [env.get("CLOUDFLARE_API_TOKEN")])
                self.assertNotIn("CLOUDFLARE_API_TOKEN", env)
                other = "k-wide" if label.startswith("core") else "k-core"
                self.assertNotIn(other, blob)
            else:
                self.assertNotIn("HL_AGENT_KEY", env)
                self.assertEqual(env.get("CLOUDFLARE_API_TOKEN"), "cf")
        self.assertNotIn("ALL_SECRETS", os.environ)

    def test_due_windows(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import run_agents as RA
        RA.agent_settings = lambda aid: {"trigger_tf": "4h" if aid == "slow" else "1h"}
        t4 = 1790380800            # a 4-hour boundary (00:00 UTC)
        self.assertTrue(RA.due("slow", t4 + 5 * 60))
        self.assertFalse(RA.due("slow", t4 + 3600 + 5 * 60))
        self.assertTrue(RA.due("fast", t4 + 3600 + 5 * 60))


if __name__ == "__main__":
    unittest.main()
