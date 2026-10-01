# The dashboard

> **v2 (2026-09-25):** the dashboard was rebuilt as "Mission control". The build spec, including tabs, status states,
> data contract, KV keys and acceptance criteria, is [DASHBOARD_SPEC.md](DASHBOARD_SPEC.md). The front end is split into
> modules under `cloud/ui/` (contract in `cloud/ui/README.md`) that the Worker joins into one script. Tabs are now Now,
> Activity, Positions, Results and Rules; old links redirect. Preview locally with `node cloud/dev/preview.mjs`.
> Known cosmetic follow-ups: a few tap targets under 44 px, light-theme pill contrast, two extra uses of solid magenta.

A private page, modelled on the AiFi dashboard and built from the same design tokens, with one difference
you can see from across the room: the accent is **magenta** where AiFi's is cyan, and the brand mark reads
"Ex". Everything else, the glass panels, the rail, the tabs, the light and dark themes, is shared, so the
two feel like one family.

## Where it lives and how it updates

A Cloudflare Worker (`cloud/worker.js`, free tier) serves the page and reads a JSON bundle from Workers KV.
After every cycle, approval, control action and Sunday review, `scripts/dashboard_push.py` rebuilds the
bundle from `state/` and `config/` and writes it to KV, along with the documents under `docs/`, so the page
is as current as the last run. Password-gated with a 30-day cookie; the password is a Worker secret.

## Tabs

| Tab | What it shows |
|---|---|
| Overview | pot change since start, drawdown and throttle state, open positions and open risk, last cycle status and counts, Bitcoin's regime, one card per book, every name's reading from the last cycle, and what the last cycle did |
| Book | open positions with mark, unrealised, stop and distance to stop, size and leverage; anything waiting for approval; the caps and universe filters in force; the books table |
| Trades | the pot's percent change over time, the record strip (n, win rate, average R, total R, profit factor, R against holding, worst streak, costs), tables by book, tier, trigger and exit reason, every closed trade, earmarked sweeps |
| Refused | why signals were refused, as a bar chart of reasons, and the last 150 refusals with their failed checks |
| Logic | the documents from this repository, rendered, plus the latest Sunday review |

Sizes are shown as percentages of the pot. The dashboard never shows a dollar amount.

## Deploying it, once

Add three repository secrets, `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts and Workers KV Storage
edit rights, the AiFi one works if it has both), `CLOUDFLARE_ACCOUNT_ID`, and `DASHBOARD_PASSWORD` (choose
a long one; it is only ever typed into the login page). Then Actions → **deploy-dashboard** → Run workflow.
The run creates the KV namespace if needed, deploys the Worker, sets the password, pushes the first bundle,
and prints the `workers.dev` address of the page in the deploy step's log. Bookmark it; add it to the phone's
home screen for an app-like view.

Redeploy the same way after any change under `cloud/`. The bundle refreshes on its own every cycle.

## Shortlist and Fleet (bot factory, 2026-09-30)

Tap the agent name in the top bar to open **Agents**, then:
- **Shortlist:** every AiFi Lab bot in the paper arena, with its evidence (backtest, unseen year, market regimes, paper vs backtest) and a Ready verdict with reasons. It links to the go-live workflow; the dashboard itself never switches anything.
- **Fleet:** the equal-risk split with regime weights, the correlation matrix, paper and live totals, and the fleet kill switch.

The data comes from `factory/factory.json`, written by the lab nightly and carried to KV (`exec:factory`, route
`/api/factory`) by the hourly push, which writes it only when it changed. The sheets live in `cloud/ui/factory.js`.

## Data contract: Command Center additions (2026-10-01)

The binding spec is [COMMAND_CENTER_SPEC.md](COMMAND_CENTER_SPEC.md) §6. Every change is additive, built by the same
allowlist serializer in `scripts/dashboard_push.py`, and passes `scrub_assert`. No new KV key. Only ratios, R, counts,
ids and times; carry pairs carry no prices.

**`exec:<id>:latest`** gains `clock.bar_s` (3600 / 14400 / 86400), `cfg.kind` (`flip` / `target` / `carry`), `cfg.tf`,
`cfg.btc_gate`, and:

| Field | What it is |
|---|---|
| `beat {s0, n, k}` | the heartbeat: one character per bar slot, oldest first (24 hourly, 18 four-hourly, 14 daily). `.` before the first run, `-` missed, `x` failed only, `o` on time, `l` late, `O` / `L` the same when the bot acted. The newest slot is left out while it is not owed yet. |
| `act {t, ty, cs, n, R, cap_pct, pct}` \| null | the newest action, any age: 7-day events of type bought / sold / resized / carry_in / carry_out / carry_closed, the newest closed trade, each open position or pair. Same type within 60 s is one action (`cs` ≤ 3 coins, `n` coins). `R` for sales only; `cap_pct` (return on capital) for a closed carry pair; `pct` (% of pot) for a resize. Null only when the bot never did anything. |
| `carry[]` (carry bots) | per pair: `id c st t_in cap_pct apr fund_pct cost_pct net_pct capture_pct stuck_t`. `capture_pct` is null while closing or before any funding is due. |
| `carry_sum` (carry bots) | `pairs open entering exiting stuck stuck_t fix_h gate_pct cap_pct apr fund_pct cost_pct net_pct capture_pct` |
| `tw` (target bots) | `[[coin, target %, holding %, action]]` from the last check's weight lines, rows that hold or act, ≤ 12 |
| alert `unhedged` | one per pair with legs out of balance: info until stuck + `max_unhedged_hours` + one bar, then warn |
| events | new types `resized`, `carry_in`, `carry_out`, `carry_closed`, `carry_fix` (level 2) |

Carry positions are skipped by `pos` (they are described by `carry[]`; `risk.n_open` still counts them), and closed
carry trades never count as R: `rec`, `stats` (and its buckets), `rseries`, `cost_R` and the verdict gates use the
other trades only.

**`exec:<id>:ledger`**: `trades.cols` gains `cap_ret_pct` (last column). Carry rows have `R`, `rel_R`, `cost_R` null and
`cap_ret_pct` = return on capital in %.

**`exec:agents`** is envelope v2: `{v: 2, gen, fleet: {halt, reason, since}, host: {name, t, fails, ok}, order: [enabled
roster ids], agents: [rows in roster order]}`. A row keeps every v1 field with its v1 type (`halt` bool, `thr` str,
`failed` bool, `alerts` int; `signals` is dropped) and adds `enabled kind bar_s n_names arena twin_of sb since wk_pct spark
spark_t last24 beat act recent held deployed_pct`, `rec.win w l closed_R`, and `carry` (= `carry_sum`) for carry bots.
`sb` is the status pseudo-bundle the page's `status()` runs on. A row is at most 2,048 B (`fit_row()` trims `recent`,
then `spark`, then `sb.alerts`).

**Write path.** `run_agents.py` gives each push child `EXECUTOR_ROWS_DIR`; the child writes only `latest`, `ledger`,
`stamp` (plus changed docs) and, after the write succeeded, saves its row there. Then, once per job and even after a
failed agent, the fleet guard runs and `dashboard_push.py --fleet DIR` reads `exec:agents` once, keeps the newer of each
row (by `gen`), keeps rows of agents not pushed this job, drops agents off the roster, rebuilds `fleet` / `host` / `order`
and writes `exec:agents` (plus `exec:factory` only when it changed) in one bulk call. Without Cloudflare secrets (the
Paris server) it prints "no Cloudflare secrets: fleet not pushed". `run_agents.py --fleet-only` runs just that step;
`dashboard-sync` calls it when a commit only changed `state/FLEET_HALT` or `FLEET_HALT.since`. A manual
`dashboard_push.py` (no rows dir) still read-merges `exec:agents` inline; `--kv-json` writes the v2 envelope directly.
