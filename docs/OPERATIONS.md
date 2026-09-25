# Operations runbook

## First-time setup

1. The private repository `SproutHouse/AiFi_Executor` exists (created 2026-09-23) and this checkout's
   `origin` points at it. Pushing needs a GitHub token with the **`workflow` scope**, because the repository
   contains `.github/workflows`; the token the Mac keychain holds for AiFi lacks it and GitHub refuses the
   push. Either add `workflow` to that classic token at github.com/settings/tokens, or create a fine-grained
   token limited to this repository with "Contents: write" and "Workflows: write", then
   `git credential-osxkeychain erase` for host github.com so the next `git push -u origin main` asks for the
   new token.
2. Settings → Branches: protect `main` (require the owner; allow the runner's pushes by not requiring
   pull requests, or add the runner to the bypass list).
3. Settings → Secrets and variables → Actions → `ALERT_WEBHOOK` = `https://ntfy.sh/<a long random topic>`.
   Subscribe to that topic in the ntfy app. Use a different topic from the desk's.
4. Actions → **cycle** → Run workflow once. Check the run log and that `state/` was committed.
5. Confirm the alert arrived. Paper mode is now running six times a day.
6. Let paper run for several days before any wallet work: you should see readings in `state/runs/`, at
   least one proposal alert, and refusals with reasons. This is the shakedown the skipped paper period
   would have given; do not shorten it below a few days.

## Every day

- With approval mode `never` (current), there are no proposals: tier A entries simply happen and you are
  told. If you switch back to `online_hours`, a proposal alert names the coin, the stop, the size and an
  id; to take it: GitHub mobile → Actions → **approve** → Run workflow → paste the id → confirm `yes`.
  To pass: do nothing; it expires at the next 4-hour close.
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

## Books

`config/books.json` holds the books. To retire a book, set `"enabled": false`; open positions in it still
exit by the rules. To move a name between books, edit the file and commit; the change applies from the next
cycle. The Sunday review's "Book verdicts" section tells you when a book has earned or lost its place.

## The dashboard

See [DASHBOARD.md](DASHBOARD.md). One-time: three secrets and the **deploy-dashboard** workflow. The bundle
then refreshes after every cycle on its own.

## Running outside the United States and Canada

GitHub's free runners are in US data centres and the free plan cannot choose a region, so the executor
can instead run on a server you control, registered with GitHub as a self-hosted runner. GitHub then only
schedules the jobs; every call to Hyperliquid leaves from your server.

Free, always-on, outside the US and Canada: Oracle Cloud Always Free, home region Frankfurt, Amsterdam or
Zurich, shape VM.Standard.A1.Flex with 1 OCPU and 6 GB, Ubuntu 24.04. Oracle asks for a card and identity
checks at signup; nothing is charged within the free limits. Two known quirks: Always Free capacity in
popular regions is sometimes "out of capacity", so retry another hour or choose a less busy region; and
Oracle reclaims idle Always Free instances unless the account is upgraded to Pay As You Go, which stays
free within the same limits.

1. Create the VM; add your SSH public key; note its public IP.
2. On GitHub: Settings → Actions → Runners → New self-hosted runner → Linux → copy the registration token.
3. SSH in and run the setup script with that token:
   `curl -fsSL https://raw.githubusercontent.com/SproutHouse/AiFi_Executor/main/ops/runner/setup.sh -o setup.sh && bash setup.sh <token>`
   It installs Python and the runner, opens only SSH in the firewall, turns on unattended security
   updates, and registers the runner as a service that survives reboots.
4. GitHub → Settings → Actions → Runners should show `executor-eu` as Idle.
5. GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable
   `RUNNER_LABEL` = `self-hosted`. From the next cycle every workflow except `runner-watch` runs on your
   server. Setting the variable back to `ubuntu-latest` (or deleting it) returns to GitHub's runners.
6. `runner-watch` runs on GitHub every six hours and only reads the repository: it alerts you if no cycle
   has run for five hours, which is how you learn the server is down. Stops on the exchange protect open
   positions meanwhile.

## Changing a rule or a parameter

Settings changes are commits, reviewed in the Sunday review's light. A rule change is a new `LOGIC.md`
version: it must beat the incumbent on the last twelve months out of sample in the backtests under
`docs/backtests/`, then run four weeks in paper, before it goes live.

## Troubleshooting

| Symptom | Meaning | Do |
|---|---|---|
| "run started N min after the bar close" | GitHub's cron was late; entries skipped for that bar | nothing; exits still ran |
| "reconciliation mismatch" | ledger and exchange disagree | look at the exchange UI; fix the ledger by hand or flatten; `resume` |
| "close NOT filled" | a market close failed; the position and its resident stop are kept | it retries next cycle; if it persists, close from the exchange UI |
| "stop placement failed, closing" | a fresh fill could not get its stop; the executor closed it | check the fill and the close on the exchange; nothing to do if both show |
| "HALT: open without a stop" | the close after a failed stop also failed | open the exchange UI now, set a stop or close by hand, then `resume` |
| "CYCLE ABORTED" | an unexpected error; state and the run record were still written | read the run log; exits ran up to the failure, stops are on the exchange |
| "running paper instead of live" | secrets or SDK missing | add the secrets; check the install step |
| No alerts at all | `ALERT_WEBHOOK` unset or wrong | set it; the log shows `alert (no channel)` |

## Local development

```bash
cd tests && python3 -m unittest -v && cd ..
EXECUTOR_STATE=$(mktemp -d) python3 scripts/run_cycle.py --dry --verbose
```
`EXECUTOR_STATE` points the state folder elsewhere so a local run never touches the committed record.
