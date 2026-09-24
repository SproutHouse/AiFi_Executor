# Universe — books and filters

Three gates, all must pass, every cycle.

## 1. Books, `config/books.json`

One engine, several books. A book is an allowlist of names, a benchmark coin the book is scored against, a
share of the pot and a risk cap of its own. Rules, indicators, sizing and the global caps are the same for
every book. Edited by the owner only; the bot never adds a name or a book.

| Book | Benchmark | Names | Pot share | Book risk cap |
|---|---|---|---|---|
| bitcoin | BTC | BTC | 20% | 1.0% |
| eth-defi | ETH | ETH, AAVE, UNI, LINK, CRV | 35% | 2.5% |
| solana | SOL | SOL, JUP, JTO, PENGU, PUMP | 25% | 2.0% |
| hype | HYPE | HYPE | 10% | 1.0% |
| bnb | BNB | BNB, CAKE | 10% | 1.0% |

Backtested names: BTC, ETH, AAVE, UNI, LINK, CRV, SOL. The others are marked untested in the file and rely
on the filters below and on the book verdict in the Sunday review. Robinhood Chain has no book: its oldest
name has about 250 daily bars and most have under 30; it becomes a candidate when names pass 280 daily bars.
Second-tier names that only trade on-chain (PancakeSwap, Raydium, Hyperliquid's own small caps) are not in
any book: they need per-chain wallets and carry the rug risk this system is built to exclude.

## 2. The filters, recomputed from live market data, `src/executor/universe.py`

| Filter | Threshold | Why |
|---|---|---|
| 24-hour notional volume | ≥ 30M USDC | thin books mean slippage and manipulation |
| Open interest | ≥ 10M USDC | a market that can be squeezed or delisted, as JELLY was, is excluded |
| Exchange max leverage | ≥ 3 | Hyperliquid caps young or risky markets lower |
| Funding against longs | ≤ 30% annualised | crowded longs pay to hold; the trade cost is no longer small |
| History | ≥ 280 daily bars | the weekly Momentum Cloud needs real history to mean anything |

On 2026-09-23 JUP, JTO, BNB, CAKE, LINK and CRV sat below the volume floor on Hyperliquid. They stay on
their books and are refused with the reason recorded until liquidity returns.

## 3. The book verdict

After 30 closed trades a book is judged on its average R against holding its benchmark. A book that does not
beat holding proposes moving its pot share into the benchmark. That is the rule that turns "accumulate the
blue chip" into a measurement instead of a hope.

## Adding a name or a book

1. The desk has cleared the name on fundamentals.
2. Hyperliquid lists the perpetual with 280 daily bars.
3. Preferably, run `docs/backtests/backtest_4h.py` with the name added to `NAMES`.
4. Add it to the right book in `config/books.json`, note it as untested if it was not backtested, commit.
