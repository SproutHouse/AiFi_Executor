#!/usr/bin/env python3
"""run_agents.py — run every due agent, each in its own process with only its own keys, then push its dashboard.

Called hourly (cycle.yml cron "5 * * * *"). An agent is due when its trigger bar closed less than
DUE_WINDOW_MIN minutes ago: 4-hour agents at 00/04/08/12/16/20 UTC, 1-hour agents every hour.

Isolation: the workflow passes each secret by name (never toJSON(secrets), which GitHub flags); this script removes
them all from its own environment, and each child process receives only what it needs:
  cycle child  → EXECUTOR_AGENT, its own HL_AGENT_KEY / HL_ACCOUNT_ADDRESS, ALERT_WEBHOOK
  push child   → EXECUTOR_AGENT, CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
Key names: agent "core" uses HL_AGENT_KEY and HL_ACCOUNT_ADDRESS; agent "wide-4h" uses HL_AGENT_KEY_WIDE_4H and
HL_ACCOUNT_ADDRESS_WIDE_4H. No agent can see another agent's key.

Usage: run_agents.py [--force] [--only a,b] [--push-only] [--dry]
"""
import json, os, subprocess, sys, time
from pathlib import Path
import _path  # noqa: F401
from executor import common as C

DUE_WINDOW_MIN = 50
PY_BIN = os.environ.get("EXECUTOR_PY") or sys.executable
HERE = Path(__file__).resolve().parent


def secrets():
    raw = os.environ.pop("ALL_SECRETS", "") or ""
    try:
        s = json.loads(raw) if raw else {}
    except ValueError:
        s = {}
    for k in list(os.environ):            # legacy individual secrets, if a workflow still passes them
        if k.startswith(("HL_AGENT_KEY", "HL_ACCOUNT_ADDRESS", "CLOUDFLARE_", "ALERT_WEBHOOK")):
            s.setdefault(k, os.environ.pop(k))
    return s


def suffix(agent_id):
    return "" if agent_id == "core" else "_" + agent_id.upper().replace("-", "_")


def agent_settings(agent_id):
    d = C.ROOT / "config" if agent_id == "core" else C.ROOT / "agents" / agent_id
    return C.load_json(d / "settings.json") or {}


def due(agent_id, now):
    return (now % C.bar_seconds(agent_settings(agent_id))) < DUE_WINDOW_MIN * 60


def base_env():
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "PYTHONPATH", "EXECUTOR_HOME", "SSL_CERT_FILE", "GITHUB_ACTIONS", "RUNNER_TEMP", "TMPDIR")
    return {k: v for k, v in os.environ.items() if k in keep}


def run(cmd, env, label):
    t0 = time.time()
    r = subprocess.run(cmd, env=env, cwd=str(C.ROOT))
    print(f"[{label}] exit {r.returncode} in {time.time() - t0:.0f}s", flush=True)
    return r.returncode


def main(argv):
    force, dry, push_only = "--force" in argv, "--dry" in argv, "--push-only" in argv
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    S = secrets()
    now = int(time.time())
    failed = []
    for a in C.agents():
        aid = a["id"]
        if not a.get("enabled", True) or (only and aid not in only):
            continue
        if not (force or push_only or due(aid, now)):
            print(f"[{aid}] not due ({C.trigger_tf(agent_settings(aid))} bars)", flush=True)
            continue
        if not push_only:
            env = base_env()
            env["EXECUTOR_AGENT"] = aid
            for name in ("HL_AGENT_KEY", "HL_ACCOUNT_ADDRESS"):
                v = S.get(name + suffix(aid))
                if v:
                    env[name] = v
            if S.get("ALERT_WEBHOOK"):
                env["ALERT_WEBHOOK"] = S["ALERT_WEBHOOK"]
            code = run([PY_BIN, str(HERE / "run_cycle.py")] + (["--dry"] if dry else []), env, aid + " cycle")
            if code:
                failed.append(aid)
        if dry:
            continue
        if S.get("CLOUDFLARE_API_TOKEN") and S.get("CLOUDFLARE_ACCOUNT_ID"):
            env = base_env()
            env.update({"EXECUTOR_AGENT": aid, "CLOUDFLARE_API_TOKEN": S["CLOUDFLARE_API_TOKEN"], "CLOUDFLARE_ACCOUNT_ID": S["CLOUDFLARE_ACCOUNT_ID"]})
            if run([PY_BIN, str(HERE / "dashboard_push.py")], env, aid + " push"):
                print(f"[{aid}] dashboard push failed (the cycle itself is unaffected)", flush=True)
        else:
            print(f"[{aid}] no Cloudflare secrets: dashboard not pushed", flush=True)
    if failed:
        print("failed agents: " + ", ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
