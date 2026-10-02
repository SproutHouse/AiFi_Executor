# Bull Momentum (family `bull_momentum`)

Status: engine-ready, paper only through the AiFi Lab arena (2026-10-02). Code: `src/executor/momentum.py` (gates and
scores) and `src/executor/families.py` (`_bull_momentum`). Research: AiFi Lab `reports/bull/` (private repo).

## The idea in one paragraph

Crypto rallies are broad: when the market is in a bullish swing, the coins that have been strongest for the last few
weeks tend to stay strongest for the next week. So the bot answers two questions every day: **is the market in a
bullish swing right now?** (a *gate*), and **which coins have the strongest momentum?** (a *score*). Gate open: hold
the top K coins by score, re-ranked every R days and on the day the gate opens. Gate closed: hold nothing.

## Why this exists (what the lab measured, development period 2018 → 2025-09, holdout never read)

- **The gate matters more than anything else.** Thirty-two gates were scored against the bullish swings an
  after-the-fact zigzag finds in the 13-coin basket. The Executor's regime (Bitcoin vs its 200-day average, 5-day
  hold), which A01 Rotation uses, ranked near the bottom: right 63% of the time it said bull, 18 days late into a
  swing, 30 days late out. The best gates (breadth: 60% of the coins above their 50-day average; "combo": Bitcoin
  above its 100-day average AND half the coins above their 50-day) were right 82% of the time, 18-19 days late in and
  7-8 days late out. Nothing can see a swing on its first day: every gate needs about two to three weeks of rise.
- **Scores have real but modest skill.** Inside bull weeks, the best scores' rank correlation with next week's
  return (IC) is 0.06-0.075 (t about 3), on both halves of the period and on both universes; the planted random
  score sits at 0. The 30-day horizon beats 7 and 90 days. The ensemble (average rank of return, steadiness,
  trend-line quality and closeness to the high) is the most stable; "resid" (strength beyond Bitcoin's move) gives the
  biggest top-3 edge.
- **Every look was charged.** The study's 162 configurations count as 84 independent trials in the family's
  deflated-Sharpe bar (N = rho + (1 - rho) M), so a bull_momentum recipe must beat a luck bar of about 0.75 Sharpe.

## Settings

| Setting | Range | Meaning |
|---|---|---|
| `gate` | none, regime, btc_sma, btc_cross, btc_mom, btc_slope, btc_cloud, breadth, index_sma, combo, vote | the bull detector (`momentum.GATES`) |
| `gate_n` | 10-300 | the gate's lookback (days); unused by none, regime, btc_cloud |
| `breadth_min` | 0.3-0.9 | share of coins that must be above their average (breadth, combo, vote) |
| `gate_hold` | 1-10 | days a new gate reading must persist before the state flips (1 = at once) |
| `rank` | ret, skip, sharpe, clenow, high, accel, smooth, resid, ma_dist, multi, ensemble | the momentum score (`momentum.SCORES`) |
| `n` | 5-180 | the score's lookback (days) |
| `k` | 1-10 | coins held |
| `rebalance_days` | 1-30 | re-rank when the epoch day number is divisible by this (same rule as rs_rotation, so engine and lab agree) |
| `buffer` | 0-5 | a held coin stays while it ranks inside the top K + buffer (fewer trades for the same idea) |
| `filter_n` | 0-300 | a coin must also be above its own N-day average (0 = off); checked daily |
| `abs_mom` | true/false | a coin must be up over the score's N days to be picked |

Plus the common target settings (vol_target, cap_x, vol_days, band, stop_pct, gross_cap). Each held coin gets 1/K of
the pot, scaled by vol_target / its realised volatility, capped at cap_x.

## Parity and causality

- Every gate reading and score for day i uses bars up to day i. Tests: `tests/test_bull_momentum.py` (every gate and
  every score recomputed on truncated history), plus the lab's peek audit on every recipe.
- Scores and gate windows are computed directly over their window (no running sums), so the engine's 1,500-day
  history and the lab's 2017+ history give the same numbers. The selection carries state only through `buffer`
  and the gate's hysteresis; both reset whenever the gate closes, which every studied gate does several times a year.
  The test trims 250 days of history and checks every weight matches.
- Gates that read Bitcoin need BTC among the recipe's coins (the lab refuses the recipe otherwise). Breadth and the
  index read the recipe's own coins. A day without a gate reading (a Bitcoin data gap) is a data gap for every coin:
  the engine keeps what it holds.
- Volume is not offered as a score: the lab's volume (Binance) and the engine's (Hyperliquid) differ.
