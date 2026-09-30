#!/usr/bin/env bash
# One-time setup on an alwaysdata account (free plan is enough: 1 GB disk, 256 MB RAM). Run over SSH:
#   curl -fsSL https://raw.githubusercontent.com/SproutHouse/AiFi_Executor/main/ops/alwaysdata/install.sh -o install.sh && bash install.sh
# Safe to run again. It clones the public repo, prepares ~/.aifi-host/env (you fill it), checks Python, a dry cycle and the
# push token, and prints the two scheduled tasks to add in the alwaysdata admin panel. It never prints a secret.
set -euo pipefail
# Server only. On a Mac (or anywhere that is not a Linux server) it stops before touching anything.
if [ "$(uname -s)" != "Linux" ]; then
  echo "This installer is for the alwaysdata server, not this $(uname -s) machine: nothing was changed."
  echo "Log in first:  ssh <account>@ssh-<account>.alwaysdata.net   then run it there."; exit 1
fi
BASE="$HOME/aifi-host"; REPO="$BASE/AiFi_Executor"; ENVF="$HOME/.aifi-host/env"
mkdir -p "$BASE/logs" "$HOME/.aifi-host"; chmod 700 "$HOME/.aifi-host"
[ -d "$REPO/.git" ] || git clone -q https://github.com/SproutHouse/AiFi_Executor "$REPO"
cd "$REPO"; git pull -q --rebase --autostash || true
git config user.name "aifi-host"; git config user.email "desk@aifi.invalid"
git config credential.helper '!f() { echo username=x-access-token; echo "password=${GH_TOKEN}"; }; f'
if [ ! -s "$ENVF" ]; then
  cp ops/alwaysdata/env.example "$ENVF"; chmod 600 "$ENVF"
  echo "Created $ENVF. Fill GH_TOKEN and ALERT_WEBHOOK (e.g. nano $ENVF), then run this script again."; exit 0
fi
chmod 600 "$ENVF"; set -a; . "$ENVF"; set +a
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN is empty in $ENVF"; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3, 9), sys.version; print("python", sys.version.split()[0])'
if grep -lq '"mode": *"live"' config/settings.json agents/*/settings.json 2>/dev/null; then
  [ -x "$BASE/venv/bin/python" ] || python3 -m venv "$BASE/venv"
  "$BASE/venv/bin/pip" install -q -r requirements-live.txt && echo "exchange SDK installed (a live agent is configured)"
fi
echo "dry cycle (reads Hyperliquid from Paris, writes nothing):"
EXECUTOR_STATE="$(mktemp -d)" EXECUTOR_AGENT=core python3 scripts/run_cycle.py --dry | tail -3
git push --dry-run -q 2>/dev/null && echo "push token: ok" || { echo "push token: REFUSED (check GH_TOKEN: Contents read and write on AiFi_Executor)"; exit 1; }
chmod +x ops/alwaysdata/tick.sh
cat <<MSG

Ready. In the alwaysdata admin panel → Advanced → Scheduled tasks, add two tasks (type: Execute the command):
  1. Command: $REPO/ops/alwaysdata/tick.sh cycle      Frequency (cron): 5 * * * *
  2. Command: $REPO/ops/alwaysdata/tick.sh requests   Frequency (cron): */5 * * * *
Until config/host.json in the repo says "alwaysdata", the tasks stand by and GitHub keeps running cycles.
Once both tasks exist, set it (or ask Claude to): from that commit on, this server runs every cycle. Logs: $BASE/logs/
MSG
