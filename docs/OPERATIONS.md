# Operations runbook

## First-time setup

1. Create the private repository `AiFi_Executor` on GitHub under the SproutHouse account, empty, no
   README. Then from this checkout: `git remote add origin https://github.com/SproutHouse/AiFi_Executor.git && git push -u origin main`.
2. Settings → Branches: protect `main` (require the owner; allow the runner's pushes by not requiring
   pull requests, or add the runner to the bypass list).
3. Settings → Secrets and variables → Actions → `ALERT_WEBHOOK` = `https://ntfy.sh/<a long random topic>`.
   Subscribe to that topic in the ntfy app. Use a different topic from the desk's.
4. Actions → **cycle** → Run workflow once. Check the run log and that `state/` was committed.
5. Confirm the alert arrived. Paper mode is now running six times a day.

## Every day

- A proposal alert names the coin, the stop, the size as a percentage of the pot and an id. To take it:
  GitHub mobile → Actions → **approve** → Run workflow → paste the id → confirm `yes`. To pass: do nothing;
  it expires at the next 4-hour close.
- Entries, exits and problems each send one alert. At 08:00 local a one-line daily summary arrives.
- `state/ledger/LEDGER.md` is the book; `state/runs/last_run.json` says what the last cycle saw.

## Controls

Actions → **control** → Run workflow:

| Action | Effect |
|---|---|
| `halt` | no new entries until `resume`; exits and trailing continue |
| `resume` | clears the halt |
| `flatten` | closes every position at market, reduce-only, and halts |

The throttle halts on its own at a 20% drawdown; `resume` clears that too, so look at the review first.

## Going live, in order

1. Read Hyperliquid's Terms of Use clause 1.5 and confirm you are comfortable with it.
2. Create a fresh wallet on a hardware device or as a cold key. Fund it over Arbitrum with a small test
   deposit first, then the pot. Hyperliquid needs at least 5 USDC to activate an account.
3. In the Hyperliquid app, approve one named API/agent wallet for this executor. Check the agent address
   shown on the signing screen. Keep the master key offline.
4. Lock dependencies: generate the hash-locked `requirements-live.txt` (see SECURITY.md).
5. Locally, with the two variables exported for that shell only:
   `pip install -r requirements-live.txt && python3 scripts/verify_keys.py --probe-order`. It must print the
   agent address, confirm it differs from the master, read the account, place a post-only order 30% below
   the market and cancel it.
6. Add `HL_AGENT_KEY` and `HL_ACCOUNT_ADDRESS` as repository secrets.
7. `control → flatten` in paper mode so no paper positions linger, then set `"mode": "live"` in
   `config/settings.json`, commit, push.
8. Watch the first live cycle's log: reconciliation must read `ok`. The first entries will be at the sizes
   the pot dictates; keep the pot small until 30 live trades have matched the rules.
9. After 30 live trades with positive expectancy, consider raising the pot. Never raise the caps.

## Changing a rule or a parameter

Settings changes are commits, reviewed in the Sunday review's light. A rule change is a new `LOGIC.md`
version: it must beat the incumbent on the last twelve months out of sample in the backtests under
`docs/backtests/`, then run four weeks in paper, before it goes live.

## Troubleshooting

| Symptom | Meaning | Do |
|---|---|---|
| "run started N min after the bar close" | GitHub's cron was late; entries skipped for that bar | nothing; exits still ran |
| "reconciliation mismatch" | ledger and exchange disagree | look at the exchange UI; fix the ledger by hand or flatten; `resume` |
| "close NOT filled" | a market close failed | it retries next cycle; if it persists, close from the exchange UI |
| "running paper instead of live" | secrets or SDK missing | add the secrets; check the install step |
| No alerts at all | `ALERT_WEBHOOK` unset or wrong | set it; the log shows `alert (no channel)` |

## Local development

```bash
cd tests && python3 -m unittest -v && cd ..
EXECUTOR_STATE=$(mktemp -d) python3 scripts/run_cycle.py --dry --verbose
```
`EXECUTOR_STATE` points the state folder elsewhere so a local run never touches the committed record.
