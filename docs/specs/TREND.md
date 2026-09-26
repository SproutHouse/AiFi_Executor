# Trend bot — specification (Phase 1, frozen 2026-09-26)

_Evidence: `research/phase1/trend_wf.py`, results in `research/phase1/trend_results.json`. Binance daily candles
2017–2026 for BTC and ETH. Parameters below are FROZEN: changing any of them is a new bot, re-tested from zero._

## The rule

| Item | Value |
|---|---|
| Markets | BTC and ETH perpetuals on Hyperliquid, 50/50 |
| Signal | once a day, at the 00:00 UTC daily close: **long if the close is above its 50-day simple moving average, otherwise flat** |
| Direction | **long or flat only.** No shorts (see "Departures from the Doctrine") |
| Size | each coin targets 30% annualised volatility, from its 30-day realised volatility: weight = 0.30 ÷ vol, capped at 2x |
| Rebalance | daily, toward the target weight; Phase 2 adds a no-trade band (target ±25%) and must re-test it before launch |
| Protective stop | an exchange-resident, reduce-only stop 15% below each entry, as outage and gap insurance only (the rule exits at the close long before). Phase 2 must confirm it never fires in the backtest's normal operation |
| Costs assumed | 0.045% taker + 0.05% slippage per unit turned over; longs pay 10%/yr funding, shorts get no credit |

## Evidence

| Measure | Value |
|---|---|
| Variants tried (all counted) | 28: SMA 50/100/150/200, time-series momentum 30/60/90/120/180, Donchian 20/40/55/100, daily Momentum Cloud; each long/short and long/flat |
| This rule, full sample 2017–2026 | Sharpe 1.32, t = 3.94, 30.6%/yr, max drawdown 34% |
| Deflated Sharpe probability (28 trials) | 0.992 (bar: 0.95) — passes |
| Walk-forward 2020–2026 (rule re-picked every January from prior data only) | Sharpe 0.83, t = 2.15, 18.2%/yr, max drawdown 40%; years +44, +39, −27, +19, +33, +13, +18% |
| Walk-forward picks | 2020 SMA100 L/S · 2021–22 Donchian20 long/flat · 2023 Cloud long/flat · **2024–26 SMA50 long/flat** |
| Plateau (long/flat SMA, full sample) | 50: 1.32 · 100: 1.06 · 150: 0.98 — a broad plateau, not a spike |

## Verdict against the Doctrine's gate

- In-sample process gate: **passed** (t ≥ 3 and deflated Sharpe ≥ 0.95).
- Out-of-sample: **positive but not proven** (t = 2.15 < 3). By the Doctrine's own arithmetic a true Sharpe near 0.8
  needs about six years of live data to confirm. It therefore goes live only **sized as tuition**, reviewed yearly
  against this distribution, never monthly against hope.

## Departures from the Doctrine

- **No short side.** Across every rule family, long/flat beat long/short (e.g. SMA-50: Sharpe 1.32 vs 1.15; the short
  leg added drawdown without return). This matches the executor's earlier backtests. The Doctrine's "full short in
  trending bear" is not supported by this data.
- **Daily close, not a moving-average crossover of two averages**: one average, one comparison, the fewest knobs.

## What Phase 2 must build for it

Daily trigger timeframe; a target-weight execution mode (the engine currently sizes by stop distance); the no-trade
band; the resident 15% stop on a target-weight position; reconciliation of target versus actual weight.
