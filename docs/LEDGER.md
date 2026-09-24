# The ledger — files and fields

All under `state/`, committed by the runner after every cycle. Human-readable views are generated; the
JSON is the record.

| File | Content |
|---|---|
| `positions_paper.json`, `positions_live.json` | open positions for that mode: coin, kind, tier, entry, stop, initial stop, notional, size, risk, leverage, fees so far, funding so far, opened, client order ids, context at entry, rule ids |
| `paper.json` | the paper pot: cash and starting balance |
| `ledger/trades.jsonl` | one line per closed trade (fields below) |
| `ledger/refused.jsonl` | every signal that did not become a trade, with the failed checks and their details, and every expired or rejected proposal |
| `ledger/equity.jsonl` | one equity point per cycle: equity, cash, unrealised, mode |
| `ledger/LEDGER.md` | the rendering: open positions, summary statistics, last 50 trades, refusal count, last run |
| `proposals/<id>.json` | proposals with status open, executed, expired, rejected or failed, the candidate, sizing and the checks that passed |
| `runs/last_run.json`, `runs/<date>.jsonl` | what each cycle saw and did, including counts of names evaluated, triggers, refusals, proposals, entries |
| `ledger/sweeps.jsonl` | realised gains earmarked for a book's benchmark under the sweep policy (recorded, not yet executed) |
| `review/<date>.md` | the Sunday review, including the verdict per book |

## A closed trade

`coin, side, kind, tier, mode, book, benchmark, opened, closed, entry, exit, stop_at_exit, notional, leverage,
risk_amt, gross, fees, funding, pnl, R, bench_ret, rel_R, reason, hours, rules, context_at_entry`

- `R = pnl / risk_amt`. Minus 1 R is a trade that lost exactly what it was allowed to lose.
- `rel_R = (pnl − bench_ret × notional) / risk_amt`: the trade's result against simply holding the book's
  benchmark for the same hours. A positive R with a negative rel_R means the trade made money but holding the
  blue chip would have made more.
- `reason` is one of `stop`, `stop (exchange)`, `4h flip`, `daily flip`, `weekly flip`, `manual flatten`.
- `rules` lists the rule ids that fired, so a review can group by rule.
- `context_at_entry` records Bitcoin's weekly, the pair's weekly and daily, the 4-hour range state, the
  funding rate and the hours mode, so the review can find conditions worth refusing in future.

## Reading the record honestly

Judge the system on R, not on the pot's currency value, and never on fewer than 30 closed trades. The
Sunday review prints the sample size before any rate. A ledger with many refusals is a healthy ledger: the
refusal file is what lets a later review measure whether a filter earns its keep.
