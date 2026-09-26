#!/usr/bin/env python3
"""with_agent_keys.py <python> <script> [args…] — run a script for one agent (EXECUTOR_AGENT) with only that agent's
exchange key and address taken from ALL_SECRETS, plus the alert webhook. Used by the control and approve workflows."""
import json, os, sys
agent = os.environ.get("EXECUTOR_AGENT") or "core"
try:
    S = json.loads(os.environ.pop("ALL_SECRETS", "") or "{}")
except ValueError:
    S = {}
for k in list(os.environ):                 # secrets passed individually by the workflow
    if k.startswith(("HL_AGENT_KEY", "HL_ACCOUNT_ADDRESS", "ALERT_WEBHOOK")):
        S.setdefault(k, os.environ[k])
suf = "" if agent == "core" else "_" + agent.upper().replace("-", "_")
env = {k: v for k, v in os.environ.items() if not k.startswith(("HL_", "CLOUDFLARE_", "ALERT_WEBHOOK"))}
for name in ("HL_AGENT_KEY", "HL_ACCOUNT_ADDRESS"):
    if S.get(name + suf):
        env[name] = S[name + suf]
if S.get("ALERT_WEBHOOK"):
    env["ALERT_WEBHOOK"] = S["ALERT_WEBHOOK"]
os.execvpe(sys.argv[1], sys.argv[1:], env)
