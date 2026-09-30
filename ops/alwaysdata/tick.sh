#!/usr/bin/env bash
# The executor's heartbeat on alwaysdata (Paris). Two scheduled tasks call this script:
#   cycle      at :05 every hour  → pull, run every due agent (scripts/run_agents.py), commit and push state
#   requests   every 5 minutes    → pull, execute flatten/approve requests the control and approve workflows filed
#                                   under state/requests/ (so no order ever leaves GitHub's US machines), push
# Secrets come from ~/.aifi/env (chmod 600): GH_TOKEN (Contents read/write on AiFi_Executor only), ALERT_WEBHOOK, and
# per live agent HL_AGENT_KEY[_<ID>] / HL_ACCOUNT_ADDRESS[_<ID>]. The Cloudflare token is NOT here: the dashboard
# is pushed by GitHub (dashboard-sync workflow) when this server's state commit lands.
# One run at a time (flock); logs in ~/aifi/logs/<date>.log, kept 14 days.
set -uo pipefail
MODE="${1:-cycle}"
BASE="${AIFI_BASE:-$HOME/aifi}"
REPO="$BASE/AiFi_Executor"
ENVF="${AIFI_ENV:-$HOME/.aifi/env}"
mkdir -p "$BASE/logs"
exec >>"$BASE/logs/$(date -u +%F).log" 2>&1
exec 9>"$BASE/.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) $MODE: previous run still going; skipped"; exit 0; }
find "$BASE/logs" -name '*.log' -mtime +14 -delete 2>/dev/null || true
ts() { date -u +%FT%TZ; }
[ -r "$ENVF" ] || { echo "$(ts) $MODE: $ENVF missing"; exit 1; }
set -a; . "$ENVF"; set +a
PY=python3; [ -x "$BASE/venv/bin/python" ] && PY="$BASE/venv/bin/python"
export EXECUTOR_PY="$PY" EXECUTOR_HOST_NAME=alwaysdata
cd "$REPO" || exit 1
alert() { [ -n "${ALERT_WEBHOOK:-}" ] && curl -fsS -m 20 -H "Title: Executor host (alwaysdata)" -d "$1" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true; }
sync_in() {
  git pull -q --rebase --autostash && return 0
  git rebase --abort >/dev/null 2>&1; echo "$(ts) $MODE: git pull failed"; alert "git pull failed on the server; the cycle ran on the last good copy"; return 1
}
push_out() {   # $1 = commit message; commits state only, retries on a race with the lab or the owner
  git add -A state
  git diff --cached --quiet && { echo "$(ts) $MODE: no state change"; return 0; }
  git commit -q -m "$1"
  for i in 1 2 3 4 5; do
    git push -q && { echo "$(ts) $MODE: pushed"; return 0; }
    sleep $((i * 5)); git pull -q --rebase --autostash || git rebase --abort >/dev/null 2>&1
  done
  echo "$(ts) $MODE: PUSH FAILED"; alert "state push failed 5 times; the commit is kept on the server and retried next run"; return 1
}
echo "$(ts) $MODE: start"
case "$MODE" in
  cycle)
    sync_in
    HOST=$("$PY" -c "import json;print(json.load(open('config/host.json')).get('host','github'))" 2>/dev/null || echo github)
    if [ "$HOST" != "alwaysdata" ]; then echo "$(ts) cycle: config/host.json says $HOST; standing by"; exit 0; fi
    "$PY" scripts/run_agents.py ${AIFI_AGENTS:+--only "$AIFI_AGENTS"}; code=$?
    "$PY" scripts/host_beat.py cycle "$code" || true
    push_out "Cycle $(date -u +%FT%H:%MZ) (alwaysdata)"
    [ "$code" -eq 0 ] || alert "one or more agents failed this cycle (exit $code); see the log on the server"
    ;;
  requests)
    sync_in || exit 1
    ls state/requests/*.json >/dev/null 2>&1 || { echo "$(ts) requests: none"; exit 0; }
    "$PY" scripts/run_requests.py
    push_out "Requests $(date -u +%FT%H:%MZ) (alwaysdata)"
    ;;
  *) echo "usage: tick.sh cycle|requests"; exit 2 ;;
esac
echo "$(ts) $MODE: done"
