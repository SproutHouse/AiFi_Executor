# Execution — schedule, orders, reconciliation, paper engine

## Schedule

GitHub Actions cron `5 0,4,8,12,16,20 * * *` (UTC): five minutes after each 4-hour close.

| UTC close | Toronto, summer (EDT) | Toronto, winter (EST) | Mode |
|---|---|---|---|
| 00:00 | 20:00 | 19:00 | approval |
| 04:00 | 00:00 | 23:00 | auto (tier A) |
| 08:00 | 04:00 | 03:00 | auto (tier A) |
| 12:00 | 08:00 | 07:00 | auto (tier A) |
| 16:00 | 12:00 | 11:00 | approval |
| 20:00 | 16:00 | 15:00 | approval |

GitHub's cron can start late. If a run begins more than 45 minutes after the bar close, entries for that bar
are skipped and recorded; exits and trailing still run. Stops are unaffected because they sit on the
exchange.

## Order of work in a cycle, `src/executor/cycle.py`

1. Resolve mode. Live needs `HL_AGENT_KEY`, `HL_ACCOUNT_ADDRESS` and the SDK; otherwise the cycle runs paper
   and says so.
2. Load market context and Bitcoin's regime; judge data freshness.
3. Load positions and equity; compute the throttle.
4. Expire proposals past the last bar close.
5. Manage exits: stop check (paper), regime and 4-hour flips, trailing.
6. Live: reconcile the ledger against the exchange (below).
7. Look for entries book by book, name by name; run the pre-trade checklist including the book's own risk
   cap; execute or propose by the hour. Every candidate carries its book and the benchmark's mark at entry.
8. Write state, equity point, run summary, `LEDGER.md`; send the daily line at 08:00 local.

## Orders in live mode, `src/executor/live.py`

| Action | Order | Notes |
|---|---|---|
| Set leverage | isolated, the value the sizing chose | before the first order in a coin |
| Entry | limit, IOC, price mark × 1.003, unique client id | fills up to the cap or not at all; never rests |
| Stop | reduce-only trigger, `tpsl: sl`, market on trigger, trigger on **mark price**, worst price stop × 0.97 | placed immediately after the fill; the exchange enforces it |
| Trail | place the new stop, then cancel the old by client id | never lowered |
| Close | `market_close`, reduce-only by construction | a failed close keeps the position and alerts; retried next cycle |
| Rounding | size to `szDecimals`; price to 5 significant figures and at most 6 − szDecimals decimals | Hyperliquid's rules |

Every order carries a client order id (a random 128-bit hex), so a retried request cannot place a
duplicate. Nothing here has been run against a funded account yet; stage one of going live proves it
with a minimum-size order (see OPERATIONS.md).

## Reconciliation, live only

The exchange is the truth; the ledger is derived. Each cycle:

- A ledger position the exchange no longer holds means the resident stop fired: the exit price is taken from
  the account's fills and the trade is recorded as `stop (exchange)`.
- Then any of these halts new entries and alerts: a position on the exchange the ledger does not know; a
  size that differs by more than 2%; a position without a resting reduce-only stop.
- Exits are never blocked by a mismatch.

## Data checks before any entry

- Freshness: the last completed 4-hour bar closed within the last 45 minutes.
- Sanity band: Hyperliquid mark within 2% of Binance's last price when a Binance pair exists.
- Universe filters on live volume, open interest, funding and max leverage.

## Paper engine, `src/executor/paper.py`

Same position records as live. Entry at mark × 1.0005 with a 0.045% fee. Funding accrued from the coin's
actual hourly rate at each cycle. Stop checked on every completed 4-hour bar since the last check: the first
bar whose low touches the stop fills at min(open, stop) × 0.9995, so a gap through the stop is charged in
full. Regime exits fill at mark × 0.9995. The pot starts at `pot_usd_paper` and lives in `state/paper.json`.
