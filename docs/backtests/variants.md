# Variant backtest — trading more often (2026-09-25)

Question: can the executor trade much more often without losing its edge? Same engine rules as live (Momentum
Cloud 3/10 flips, stop on the trigger line, exits on trigger, daily or weekly turning, 1% risk per trade, 4% open-risk
cap, 6 positions, 0.045% taker fee and 0.05% slippage per side, 11%/yr funding). Binance candles as a proxy for
Hyperliquid. Script: `variants.py`.

| Variant | Names | Trades/week | Win | Avg R | PF | CAGR | Max DD |
|---|---|---|---|---|---|---|---|
| A core: 4h flips, Bitcoin gate (2020–26) | 12 | 0.72 | 37% | +0.28 | 1.45 | 9.7% | 23% |
| B wide: 4h flips, Bitcoin gate | 30 | 1.03 | 34% | +0.18 | 1.29 | 10.0% | 26% |
| C wide: 4h flips, no Bitcoin gate | 30 | 1.18 | 34% | +0.18 | 1.30 | 13.6% | 28% |
| D wide: 4h flips + pullbacks | 30 | 2.23 | 26% | +0.16 | 1.06 | 13.3% | 70% |
| E wide: 1h flips in 4h+D+W, Bitcoin gate (2023–26) | 30 | 3.48 | 30% | 0.00 | 0.97 | −1.8% | 44% |
| F wide: 1h flips, no Bitcoin gate (2023–26) | 30 | 3.79 | 30% | +0.01 | 0.99 | −0.3% | 45% |
| A′ core, 2023–26 only | 12 | 0.95 | 30% | +0.11 | 1.15 | 4.4% | 23% |
| C′ wide no gate, 2023–26 only | 30 | 1.43 | 29% | +0.03 | 1.01 | 6.5% | 28% |

Reading: more names and no Bitcoin gate (C) is the only change that trades noticeably more while staying clearly
positive over the full period; since 2023 it is about break-even. Pullbacks (D) raise trade count but drawdown
reaches 70%. One-hour triggers (E, F) trade five times as often with no edge after costs. The universe is today's
list, so survivorship flatters every variant; treat these as upper bounds. Live paper agents (docs/AGENTS.md) test
C and F against A with real fills.
