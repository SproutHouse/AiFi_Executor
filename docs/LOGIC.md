# Decision logic — version 1.3

_Every rule here is implemented in the file named beside it, and only there. Change the rule in the code,
bump the version, add a changelog line. Never let this page and the code disagree._

## 1. Data and definitions

| Term | Definition | Where |
|---|---|---|
| Bar | Hyperliquid candle for the coin's perpetual: `t` open time, `o h l c v`. Only **completed** bars are used, judged by the candle's close time against the clock | `hl_data.candles` |
| Daily | 1d candles, UTC days | `hl_data.candles` |
| Weekly | Daily bars aggregated into **Monday-anchored** weeks, matching TradingView's crypto week. The forming week is excluded | `indicators.weekly_from_daily`, `regime.context` |
| 4-hour | 4h candles, UTC aligned (00, 04, 08, 12, 16, 20) | `hl_data.candles` |
| Momentum Cloud | `supertrend(factor 3, ATR 10)` with Pine semantics: RMA-seeded ATR, band locking. Direction −1 bullish, +1 bearish | `indicators.supertrend` |
| Noodle Range | EMA 36 of highs (upper band), closes (mid) and lows (lower band), Pine-seeded, plus a 200 EMA of closes for context | `indicators.bands` |
| Range state | close above upper = Overextended · below lower = Suppressed · else In Range | `indicators.range_state` |
| Line | the Momentum Cloud value on a bar; for a bullish bar it sits below price and is the stop | `regime.context` |

Parameters: `config/settings.json → indicators`. They are frozen in v1.0.

## 2. Regime, per pair

| Reading | Rule | Where |
|---|---|---|
| Weekly | direction of the Momentum Cloud on the last completed week | `regime.context` |
| Daily | direction on the last completed UTC day | `regime.context` |
| 4-hour | direction, line, band values and range state on the last completed 4-hour bar | `regime.context` |
| Market | Bitcoin's weekly direction, read the same way | `cycle.load_market` |

**Setting A, bull bias:** weekly bullish AND daily bullish → the pair may be entered long.
**Setting B, flat:** anything else → no new entries in the pair; open positions exit (section 5).
There is no short setting in v1.

## 3. Triggers, on the last completed 4-hour bar

| Trigger | Rule | Tier | Where |
|---|---|---|---|
| Flip | 4-hour direction is bullish now and was bearish on the previous bar | **A** if Bitcoin's weekly is bullish, else B | `signals.evaluate` |
| Pullback | 4-hour direction bullish on this bar and the previous one; this close inside the band (lower ≤ close ≤ upper); previous close above the previous upper band | **B** | `signals.evaluate` |
| Guard | close must be above the 4-hour line | — | `signals.evaluate` |

Tier A executes on its own. Tier B is recorded and not traded (section 6).

## 4. Entry

| Rule | Value | Where |
|---|---|---|
| Reference price | Hyperliquid mark at cycle time | `cycle.find_entries` |
| Sizing price | mark × (1 + 0.3%), the worst fill accepted | `cycle.find_entries` |
| Live order | limit, immediate-or-cancel, price = mark × (1 + 0.3%), rounded to the coin's tick | `live.entry_ioc` |
| Paper fill | mark × (1 + 0.05%), taker fee 0.045% | `paper.open_position` |
| Initial stop | the 4-hour line on the signal bar | `signals.evaluate` |
| Not filled | the signal is recorded as refused; nothing is retried | `cycle.execute_entry` |

## 5. Exits, checked every cycle, never waiting for approval

| Exit | Rule | Where |
|---|---|---|
| Stop | live: exchange-resident reduce-only trigger at the stop, market on trigger, judged on mark price. Paper: first completed 4-hour bar whose low ≤ stop fills at min(open, stop) less slippage | `live.place_stop`, `paper.check_stop` |
| Trail | when the 4-hour direction is bullish and its line is above the current stop, the stop moves up to the line. It never moves down | `cycle.manage_exits` |
| 4-hour flip | 4-hour direction bearish → close at mark | `cycle.manage_exits` |
| Daily flip | daily direction not bullish → close at mark | `cycle.manage_exits` |
| Weekly flip | weekly direction not bullish → close at mark | `cycle.manage_exits` |
| Manual | `control flatten` closes everything reduce-only and sets HALT (a tracked file, so it survives the run) | `scripts/control.py` |
| No reading | if the weekly, daily or 4-hour reading is missing (a data gap), the position and its stop are kept exactly as they are and the gap is reported; only an explicit bearish reading closes | `cycle.manage_exit` |
| Live close order | the reduce-only market close is sent first for the whole exchange size; the resident stop is cancelled only after the fill is confirmed. A failed close keeps both the position and its stop | `cycle.close_position` |
| Live fill order | a fresh fill is written to the positions file before the stop is placed; the stop gets one retry, then the position is closed rather than held unprotected; if that close also fails, HALT is set and you are paged | `cycle.execute_entry`, `cycle.protect` |
| Recovery | an exception during an entry is followed by a read of the exchange: a long that exists is recorded and protected, never assumed absent | `cycle.recover_entry` |

## 6. Approval policy

| Rule | Value | Where |
|---|---|---|
| Mode (v1.2, owner's decision 2026-09-24) | `never`: no human approval. Tier A executes on its own at any hour. Tier B signals are recorded as refused with the reason "tier not automated" and not traded, so their frequency stays measurable | `settings.approval`, `cycle.find_entry` |
| Alternative mode | `online_hours`: 10:00 ≤ local hour < 22:00 America/Toronto → every entry is a proposal; otherwise tier A executes and tier B is a proposal | `hours.mode`, `settings.offline_auto_tiers` |
| Enabling tier B | add "B" to `settings.approval.auto_tiers`; a rule change, so it needs the versioning discipline in section 8 | `settings.approval` |
| Proposal expiry | the next 4-hour close (UTC) | `hours.next_bar_close` |
| Approval drift | refused if mark has risen more than 1% above the mark at signal time | `scripts/approve.py` |
| Approval recheck | every pre-trade check runs again with the current book | `scripts/approve.py` |

## 6b. Books

A book is an allowlist, a benchmark coin, a pot share and a risk cap of its own; rules, indicators, sizing
and the global caps are shared by every book and frozen. `config/books.json`, read by `common.books`.

| Rule | Value | Where |
|---|---|---|
| Membership | a coin belongs to exactly one book; the first book listing it wins | `common.book_of` |
| Book risk cap | open risk within the book ≤ the book's `open_risk_cap_pct` of the pot, checked under the global 4% | `risk.pre_trade` |
| Benchmark | each position stores the benchmark's mark at entry; each closed trade records the benchmark's return over the same hours and **R against holding the benchmark** = (pnl − benchmark return × notional) / risk | `ledger.record_close` |
| Book verdict | the Sunday review judges a book only at 30 closed trades; a book that does not beat holding its benchmark proposes moving its pot share to the benchmark | `review.render` |
| Sweep | when a book has `sweep_gains_to_benchmark` on and the benchmark's weekly is bullish, a realised gain is earmarked for the benchmark in `state/ledger/sweeps.jsonl`. v1.1 records the intent; the spot conversion is a later version | `cycle.maybe_sweep` |

## 7. Pre-trade checklist, all must pass

not halted · throttle not halted · data fresh and run on time · no reconciliation mismatch · sizing accepted ·
no open position in the coin · below max positions · open-risk cap · book open-risk cap · gross exposure cap ·
price sanity band · universe filters. Implemented in `risk.pre_trade`; every failure is written to `state/ledger/refused.jsonl`.

## 8. What is frozen and what adapts

Frozen: indicator parameters, trigger definitions, exit rules, 1% risk, the caps, the hours.
Adapting by construction: the regime readings, the universe filters (recomputed every cycle from live
market data), the drawdown throttle, the trailing stop.
Never automatic: any change to this page. See [DECISIONS.md](DECISIONS.md) for the versioning discipline.

## Changelog

- **v1.3 — 2026-09-25.** Execution safety from the first full review, no rule changes: write-through
  persistence after every open, close and trail; data gaps keep positions instead of closing them; live
  closes happen before their stop is cancelled; fresh fills are recorded before the stop is placed, with a
  retry and a fail-closed close; entry exceptions trigger a recovery read; stops the exchange fired are
  absorbed before exits are managed; one position's failure cannot stop the others; HALT is tracked by git;
  zero equity refuses instead of crashing.
- **v1.2 — 2026-09-24.** Approval mode `never`: tier A executes on its own around the clock; tier B is
  recorded, not traded. The owner's reason: execution should follow the rules, not a human mood. Everything
  else unchanged.
- **v1.1 — 2026-09-23.** Books: per-book allowlist, benchmark, pot share and risk cap under the global cap;
  relative R against holding the benchmark on every closed trade; book verdicts in the Sunday review; sweep
  intent recorded. No change to triggers, exits, sizing or global caps.
- **v1.0 — 2026-09-23.** Initial rules. Long-only. Flip and pullback triggers on 4-hour bars inside a
  bullish daily and weekly; tier A/B by Bitcoin's weekly; exchange-resident trailing stop on the 4-hour
  line; exits on 4-hour, daily or weekly flip. Evidence in [backtests/backtest_summary.md](backtests/backtest_summary.md).
