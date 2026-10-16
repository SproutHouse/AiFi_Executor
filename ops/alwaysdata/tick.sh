#!/usr/bin/env bash
# The executor's heartbeat on alwaysdata (Paris). Two scheduled tasks call this script:
#   cycle      at :05 every hour  → pull, run every due agent (scripts/run_agents.py), commit and push state
#   requests   every 5 minutes    → pull, execute flatten/approve requests the control and approve workflows filed
#                                   under state/requests/ (so no order ever leaves GitHub's US machines), push
# Secrets come from ~/.aifi-host/env (chmod 600): GH_TOKEN (Contents read/write on AiFi_Executor only), ALERT_WEBHOOK, and
# per live agent HL_AGENT_KEY[_<ID>] / HL_ACCOUNT_ADDRESS[_<ID>]. The Cloudflare token is NOT here: the dashboard
# is pushed by GitHub (dashboard-sync workflow) when this server's state commit lands.
# One run at a time (flock); logs in ~/aifi-host/logs/<date>.log, kept 14 days.
set -uo pipefail
MODE="${1:-cycle}"
BASE="${AIFI_BASE:-$HOME/aifi-host}"
REPO="$BASE/AiFi_Executor"
ENVF="${AIFI_ENV:-$HOME/.aifi-host/env}"
mkdir -p "$BASE/logs"
exec >>"$BASE/logs/$(date -u +%F).log" 2>&1
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BASE/.lock"
  flock -n 9 || { echo "$(date -u +%FT%TZ) $MODE: previous run still going; skipped"; exit 0; }
else                                           # no flock: an atomic mkdir lock, cleared if older than 30 minutes
  find "$BASE" -maxdepth 1 -name .lockdir -mmin +30 -exec rmdir {} \; 2>/dev/null
  mkdir "$BASE/.lockdir" 2>/dev/null || { echo "$(date -u +%FT%TZ) $MODE: previous run still going; skipped"; exit 0; }
  trap 'rmdir "$BASE/.lockdir" 2>/dev/null' EXIT
fi
find "$BASE/logs" -name '*.log' -mtime +14 -delete 2>/dev/null || true
ts() { date -u +%FT%TZ; }
[ -r "$ENVF" ] || { echo "$(ts) $MODE: $ENVF missing"; exit 1; }
set -a; . "$ENVF"; set +a
PY=python3; [ -x "$BASE/venv/bin/python" ] && PY="$BASE/venv/bin/python"
export EXECUTOR_PY="$PY" EXECUTOR_HOST_NAME=alwaysdata
cd "$REPO" || exit 1
# alert MESSAGE [PRIORITY]: ntfy priority 5 urgent, 4 high (act today), 3 default, 2 low (recoveries)
alert() { [ -n "${ALERT_WEBHOOK:-}" ] && curl -fsS -m 20 -H "Title: Executor host (alwaysdata)" -H "Priority: ${2:-3}" -d "$1" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true; }
# streak NAME ok|fail MESSAGE MINUTES: one alert when a failure has lasted MINUTES, one quiet note when it recovers;
# nothing in between (a GitHub hiccup that heals by itself never reaches the phone). State: $BASE/.streak_NAME
streak() {
  local f="$BASE/.streak_$1" now since alerted
  now=$(date +%s)
  if [ "$2" = ok ]; then
    [ -f "$f" ] || return 0
    read -r since alerted < "$f"; rm -f "$f"
    [ "$alerted" = 1 ] && alert "$1 recovered after $(( (now - since) / 60 )) min" 2
    return 0
  fi
  if [ -f "$f" ]; then read -r since alerted < "$f"; else since=$now; alerted=0; fi
  if [ "$alerted" = 0 ] && [ $(( now - since )) -ge $(( ${4:-0} * 60 )) ]; then alert "$3" 4; alerted=1; fi
  echo "$since $alerted" > "$f"
}
sync_in() {
  if git pull -q --rebase --autostash; then streak git-pull ok; return 0; fi
  git rebase --abort >/dev/null 2>&1; echo "$(ts) $MODE: git pull failed"
  streak git-pull fail "The server has not been able to pull from GitHub for an hour, so it runs on its last good copy and would not see a new halt. Check githubstatus.com; if GitHub is fine, the server's GH_TOKEN may have expired (renew it in ~/.aifi-host/env)." 60
  return 1
}
push_out() {   # $1 = commit message; commits state only, retries on a race with the lab or the owner
  git add -A state
  git diff --cached --quiet && { echo "$(ts) $MODE: no state change"; return 0; }
  git commit -q -m "$1"
  for i in 1 2 3 4 5; do
    git push -q && { echo "$(ts) $MODE: pushed"; streak state-push ok; return 0; }
    sleep $((i * 5)); git pull -q --rebase --autostash || git rebase --abort >/dev/null 2>&1
  done
  echo "$(ts) $MODE: PUSH FAILED"
  streak state-push fail "The server has not been able to push the bots' state to GitHub for an hour, so the dashboard is frozen (the bots keep running). Check githubstatus.com, then the server's GH_TOKEN in ~/.aifi-host/env." 60
  return 1
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
    if [ "$code" -eq 0 ]; then streak agents ok; else
      streak agents fail "A bot's hourly cycle has failed for two hours in a row (exit $code). Its positions keep their stops; see the latest log in ~/aifi-host/logs on the server." 60
    fi
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
