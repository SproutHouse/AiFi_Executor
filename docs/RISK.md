# Risk — sizing, caps, throttle

_Implemented in `src/executor/risk.py`; values in `config/settings.json`._

## Sizing by risk

```
distance   = (entry − stop) / entry
risk       = pot equity × 1%  (× 0.5 when the throttle is on)
notional   = risk / distance
leverage   = the highest integer ≤ 3 whose liquidation buffer (1/leverage × 0.9) is at least 2 × distance
margin     = notional / leverage           (isolated margin per position)
```

Worked example, pot 1,000 units, entry 100, stop 96: distance 4%, risk 10, notional 250 (25% of the pot),
leverage 3, margin 83. A 20% stop gives distance 20%, notional 50, and leverage drops to 2 so the liquidation
price stays beyond twice the stop distance.

If the notional wanted exceeds 3 × equity, the notional is capped and the risk taken is **less** than 1%,
never more. Notionals below Hyperliquid's minimum of 10 USDC are refused. Stops closer than 0.2% are refused
as noise.

## What leverage is for

Leverage does not add expectancy; in the backtests raising risk per trade from 1% to 2% doubled the drawdown
and did not raise the return. Leverage here only lets a small pot express the notional the risk formula asks
for, with isolated margin so one position cannot consume the others' margin.

## Caps, all in `settings.json`

| Cap | Value | Why |
|---|---|---|
| Risk per trade | 1% of the pot | expectancy is thin and losing streaks run 18 to 24 trades |
| Open risk across positions | 4% of the pot | crypto positions stop out together; this is the real risk unit |
| Gross exposure | 3 × equity | bounds funding and margin use |
| Leverage per position | 3x, isolated | liquidation always beyond twice the stop |
| Positions | 6 | the effective number of independent bets is 1 or 2 anyway |
| Minimum notional | 10 USDC | exchange minimum |
| Minimum stop distance | 0.2% | below it, costs exceed the risk taken |

## The throttle

Drawdown is measured from the pot's peak equity across all recorded cycles.

| Drawdown from peak | Effect |
|---|---|
| under 10% | normal |
| 10% or more | risk per trade halves to 0.5% |
| 20% or more | no new entries; exits continue; the Sunday review and the owner decide |

The throttle was not in the backtest. It is a safety rule, not a claimed edge.

## Sizing the pot

The pot is the balance of the Hyperliquid wallet and nothing else. Size it as an amount whose complete loss
changes nothing about your plans; the default assumption is 5% of the portfolio. Because every rule above
is a percentage of the pot, a 1% risk per trade on a 5% pot is 0.05% of the portfolio.

## Costs

Taker fee 0.045% per side; paper slippage 0.05% per side; funding accrued from Hyperliquid's actual hourly
rate while a position is open. In the 4-hour backtest costs were 0.05 to 0.10 R per trade. Sub-4-hour bars
would push that above 0.15 R, which is why the bar size is frozen.
