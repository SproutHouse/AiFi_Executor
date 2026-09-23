# Two-setting regime system — backtest summary (2026-09-22)

Prices: Binance daily and 4-hour candles fetched through the desk's own `fred_indicators.py`
(Momentum Cloud = Supertrend 3/10; Noodle Range = EMA36 of high/close/low). Hyperliquid prices
track Binance closely for these names, so Binance history stands in for it.

## Rules tested
- Regime per pair = direction of the last COMPLETED weekly Momentum Cloud bar (no peeking).
- Bull bias: long only. Bear bias: short (tested) or stand aside.
- Entry types: "flip" = daily (or 4h) Momentum Cloud turns to the bias side; "pullback" = price
  re-enters the Noodle band from the overextended side while momentum still agrees.
- Execution next bar open. Stop = the Momentum line, trailed each close. Exit on stop, on a
  momentum flip against, or when the weekly regime flips.
- Sizing: risk 1% of equity per trade; notional = risk ÷ stop distance. Fees 0.045% per side
  (Hyperliquid taker), slippage 0.05% per side, funding 8%/yr on notional while open
  (measured Hyperliquid funding over the last 90 days: longs paid 7–15%/yr on BTC, ETH, SOL, HYPE, TAO).

## Daily bars, 35 Hyperliquid-listed desk names, 2017-08 to 2026-09
| Variant | Trades | Win | Avg R | PF | Final | CAGR | Max DD |
|---|---|---|---|---|---|---|---|
| A flips, long in bull + short in bear | 442 | 39% | +0.09 | 1.15 | x1.61 | 5.4% | 50% |
| D flips, long-only | 110 | 35% | +0.43 | 1.79 | x1.84 | 6.9% | 28% |
| PD flips + pullbacks, long-only | 251 | 27% | +0.39 | 1.21 | x3.14 | 13.4% | 56% |
| PB pullbacks only, long-only | 228 | 23% | +0.61 | 1.23 | x4.15 | 16.9% | 57% |
| S longs + strict shorts (bear gate) | 395 | 34% | -0.03 | 0.89 | x0.62 | -5.2% | 82% |
| C flips vetoed when Overextended | 24 | 42% | +0.01 | 1.00 | x1.00 | 0% | 6% |
| M2 as PD+gate at 2% risk | 110 | 28% | +0.48 | 1.07 | x1.81 | 6.7% | 77% |
Shorts: every configuration negative (-0.03R to -0.23R per trade, n = 285–547).
BTC buy-and-hold over the same span: x20, CAGR 39%, max DD 83%.

## 4-hour bars, 12 liquid names (BTC ETH SOL DOGE LINK AAVE UNI NEAR SUI TAO TRX CRV), 2020-01 to 2026-09
Entries only while the pair's DAILY and WEEKLY Momentum Cloud are both bullish. Long-only.
| Variant | Trades/yr | Win | Avg R | PF | CAGR | Max DD | Avg hold | Cost per trade |
|---|---|---|---|---|---|---|---|---|
| 4h flips only | 45 | 37% | +0.35 | 1.56 | 18.7% | 22% | 5.4 d | 0.05 R |
| 4h flips + pullbacks | 86 | 29% | +0.27 | 1.19 | 22.5% | 45% | 4.2 d | 0.09 R |
| 4h flips + pullbacks, open-risk cap 4% | 74 | 29% | +0.44 | 1.26 | 30.9% | 45% | 4.1 d | 0.10 R |
| Daily flips + pullbacks, same names | 26 | 28% | +0.61 | 1.47 | 15.3% | 37% | 21 d | 0.07 R |
Year by year, 4h flips only: 2020 +13%, 2021 +67%, 2022 +1%, 2023 +40%, 2024 +5%, 2025 -7%, 2026 +21%.

## Regime switch quality (weekly Momentum Cloud)
- BTC since 2017: 11 flips; bullish stretches median 22 weeks, bearish median 44 weeks; no stretch
  shorter than 4 weeks. After a flip to bullish the next 4 weeks were positive 5 of 5 (median +15.8%).
  After a flip to bearish the next 4 weeks were positive 4 of 5 (median +2.7%): shorting the flip fails.
- ETH since 2017: 17 flips, none shorter than 4 weeks.

## What this says for the design
1. Two settings: BULL bias = long trend entries; BEAR bias = stand aside in USDC. Shorting had no edge here.
2. The pair's own weekly regime does the work; a market-wide breadth gate did not raise expectancy.
3. Never veto an entry for being Overextended: a momentum flip is overextended by construction.
   Use the Noodle band for pullback re-entries instead.
4. Correlation is the dominant risk: positions stop out together; cap total open risk (~4% of equity)
   and keep risk per trade at 1%. Doubling risk per trade doubled drawdown without raising CAGR.
5. Higher frequency helps only down to 4-hour bars: costs are 0.05–0.10 R per trade there.
   At 1-hour bars stop distances shrink to ~1–1.5% and costs would exceed 0.15 R per trade.

## Caveats
Survivorship (the universe is today's list); Binance as a proxy for Hyperliquid; constant funding;
daily-bar gap fills overstate some losses and understate some intraday stop-outs; no Hyperliquid
liquidity or delisting events modelled; parameters were not optimised, but variants were chosen after
seeing results, so treat expectancy as an upper bound until paper trading confirms it.
