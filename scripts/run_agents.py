#!/usr/bin/env python3
"""run_agents.py — run every due agent, each in its own process with only its own keys, then push its dashboard.

Called hourly (cycle.yml cron "5 * * * *"). An agent is due when its trigger bar closed less than
DUE_WINDOW_MIN minutes ago: 4-hour agents at 00/04/08/12/16/20 UTC, 1-hour agents every hour.

Isolation: the workflow passes each secret by name (never toJSON(secrets), which GitHub flags); this script removes
them all from its own environment, and each child process receives only what it needs:
  cycle child  → EXECUTOR_AGENT, its own HL_AGENT_KEY / HL_ACCOUNT_ADDRESS, ALERT_WEBHOOK
  push child   → EXECUTOR_AGENT, EXECUTOR_ROWS_DIR, CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
  fleet step   → CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID only
Key names: agent "core" uses HL_AGENT_KEY and HL_ACCOUNT_ADDRESS; agent "wide-4h" uses HL_AGENT_KEY_WIDE_4H and
HL_ACCOUNT_ADDRESS_WIDE_4H. No agent can see another agent's key.

The fleet index (docs/COMMAND_CENTER_SPEC.md §6.5): each push child writes only its own keys and saves its exec:agents row
into a per-job rows dir; after the loop (in a `finally`, so it runs even after a failed agent) the fleet guard runs, then
ONE `dashboard_push.py --fleet <dir>` merges every row into exec:agents. A failed push leaves that bot's previous row,
which the page shows as Late or Stale by its own clock. `--fleet-only` skips the loop (a FLEET_HALT-only commit).

Usage: run_agents.py [--force] [--only a,b] [--push-only] [--fleet-only] [--dry]
"""
import json, os, shutil, subprocess, sys, tempfile, time
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
    """Due inside the window after the agent's bar closes. Daily agents use their own late limit (GitHub's cron can
    slip for hours), and their cycle is idempotent, so running twice inside the window changes nothing."""
    s = agent_settings(agent_id)
    window = DUE_WINDOW_MIN
    if C.trigger_tf(s) == "1d":
        window = max(DUE_WINDOW_MIN, int((s.get("data") or {}).get("late_run_minutes", 180)))
    return (now % C.bar_seconds(s)) < window * 60


def base_env():
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "PYTHONPATH", "EXECUTOR_HOME", "SSL_CERT_FILE", "GITHUB_ACTIONS", "RUNNER_TEMP", "TMPDIR")
    return {k: v for k, v in os.environ.items() if k in keep}


def run(cmd, env, label):
    t0 = time.time()
    r = subprocess.run(cmd, env=env, cwd=str(C.ROOT))
    print(f"[{label}] exit {r.returncode} in {time.time() - t0:.0f}s", flush=True)
    return r.returncode


def main(argv):
    force, dry, push_only, fleet_only = "--force" in argv, "--dry" in argv, "--push-only" in argv, "--fleet-only" in argv
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    S = secrets()
    now = int(time.time())
    failed = []
    rows_dir = tempfile.mkdtemp(prefix="exec-rows-", dir=os.environ.get("RUNNER_TEMP") or None)
    try:
        if not fleet_only:
            agents_loop(S, now, force, dry, push_only, only, failed, rows_dir)
    finally:
        try:
            if not dry:
                try:
                    fleet_guard()              # before the fleet write, so a fresh halt is in it
                finally:
                    fleet_push(S, rows_dir)
        finally:
            shutil.rmtree(rows_dir, ignore_errors=True)
    if failed:
        print("failed agents: " + ", ".join(failed), flush=True)
        sys.exit(1)


def cf_env(S):
    env = base_env()
    env.update({"CLOUDFLARE_API_TOKEN": S["CLOUDFLARE_API_TOKEN"], "CLOUDFLARE_ACCOUNT_ID": S["CLOUDFLARE_ACCOUNT_ID"]})
    return env


def fleet_push(S, rows_dir):
    """One exec:agents write per job: the rows the push children saved, plus the fleet kill switch and the host beat."""
    if not (S.get("CLOUDFLARE_API_TOKEN") and S.get("CLOUDFLARE_ACCOUNT_ID")):
        print("no Cloudflare secrets: fleet not pushed", flush=True)
        return None
    code = run([PY_BIN, str(HERE / "dashboard_push.py"), "--fleet", rows_dir], cf_env(S), "fleet push")
    if code:
        print("fleet push failed (the cycles and the agents' own pages are unaffected)", flush=True)
    return code


def agents_loop(S, now, force, dry, push_only, only, failed, rows_dir):
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
            env = cf_env(S)
            env.update({"EXECUTOR_AGENT": aid, "EXECUTOR_ROWS_DIR": rows_dir})
            if run([PY_BIN, str(HERE / "dashboard_push.py")], env, aid + " push"):
                print(f"[{aid}] dashboard push failed (the cycle itself is unaffected)", flush=True)
        else:
            print(f"[{aid}] no Cloudflare secrets: dashboard not pushed", flush=True)


def fleet_guard():
    """The fleet kill switch's automatic trigger: when the LIVE agents together are down more than
    agents/fleet.json max_live_dd_pct from their peaks, set state/FLEET_HALT (no agent enters; exits still run).
    Fleet drawdown = 1 - sum(current equity) / sum(each agent's own peak), which never understates the real one."""
    f = C.fleet()
    lim = f.get("max_live_dd_pct")
    if not lim or C.FLEET_HALT.exists():
        return None
    cur = peak = 0.0
    for a in C.agents():
        if not a.get("enabled", True):
            continue
        st = C.ROOT / "state" if a["id"] == "core" else C.ROOT / "state" / "agents" / a["id"]
        pts = [p for p in C.read_jsonl(st / "ledger" / "equity.jsonl") if p.get("mode") == "live" and p.get("equity")]
        if pts:
            cur += pts[-1]["equity"]
            peak += max(p["equity"] for p in pts)
    if peak <= 0:
        return None
    dd = (1 - cur / peak) * 100
    print(f"fleet (live): drawdown {dd:.1f}% (limit {lim}%)", flush=True)
    if dd > float(lim):
        C.FLEET_HALT.parent.mkdir(parents=True, exist_ok=True)
        C.FLEET_HALT.write_text(f"fleet drawdown {dd:.1f}% beyond {lim}%")
        C.FLEET_HALT.with_name("FLEET_HALT.since").write_text(C.iso())
        C.notify("Executor: FLEET HALTED", f"live agents together are down {dd:.1f}% (limit {lim}%); no agent enters, exits still run. "
                                          "Resume with the control workflow (fleet-resume) once reviewed.")
    return dd


if __name__ == "__main__":
    main(sys.argv[1:])
