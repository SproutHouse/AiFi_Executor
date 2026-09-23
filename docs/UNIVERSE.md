# Universe — what may be traded

Two gates, both must pass, every cycle.

## 1. The allowlist, `config/allowlist.json`

Edited by the owner only. A name is added when it has passed the desk's research, has at least 280 daily
bars on Hyperliquid, and ideally appears in a backtest. The bot never adds a name by itself. Seeded on
2026-09-23 with the twelve liquid names the 4-hour backtest covered: BTC, ETH, SOL, DOGE, LINK, AAVE, UNI,
NEAR, SUI, TAO, TRX, CRV.

Notes from the evidence: ZEC and AAVE were among the worst names in the daily backtest; AAVE is kept because
it is deep and liquid, ZEC is not on the list.

## 2. The filters, recomputed from live market data, `src/executor/universe.py`

| Filter | Threshold | Why |
|---|---|---|
| 24-hour notional volume | ≥ 30M USDC | thin books mean slippage and manipulation |
| Open interest | ≥ 10M USDC | a market that can be squeezed or delisted, as JELLY was, is excluded |
| Exchange max leverage | ≥ 3 | Hyperliquid caps young or risky markets lower |
| Funding against longs | ≤ 30% annualised | crowded longs pay to hold; the trade cost is no longer small |
| History | ≥ 280 daily bars | the weekly Momentum Cloud needs real history to mean anything |

A name that fails a filter is refused with the reason recorded, and can pass again the next cycle.

## Adding a name

1. The desk has cleared it on fundamentals (the Research Cleared tick in the AiFi Assets table).
2. `python3 -c` a quick check that Hyperliquid lists the perp and it has 280 daily bars.
3. Optional but preferred: run `docs/backtests/backtest_4h.py` with the name added to `NAMES`.
4. Add the row to `config/allowlist.json` with a note; commit.
