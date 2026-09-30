# More markets: Phase 7 of the bot factory

_Researched and built 2026-09-29. Paper only._

## Hyperliquid builder markets (HIP-3)

Hyperliquid lets third parties deploy their own perp exchanges on its chain. On 2026-09-29 there were ten:
xyz, flx, vntl, hyna, km, abcd, cash, para, mkts and io. The largest by far is **xyz**, which has 151 listed
markets. It trades like the main venue and needs no KYC. Coin names carry the exchange as a prefix, for example
`xyz:SP500`.

| Group | Markets (24h volume on 2026-09-29) |
|---|---|
| Indices | S&P 500 `xyz:SP500` (179M), Nasdaq-100 `xyz:XYZ100` (208M) |
| Commodities | Brent `xyz:BRENTOIL` (280M), WTI `xyz:CL` (246M), silver (125M), gold (63M), copper, natural gas |
| Stocks | NVDA (116M), META, GOOGL, TSLA, AAPL, MSFT, AMZN, AMD, MU, MSTR, COIN, ORCL, INTC and more |

These are the factory's first markets outside crypto. They matter for the fleet: gold, oil and US indices move
on different drivers from crypto, so bots that trade them can lower the fleet's overall correlation.

## How the factory handles them

- **Backtest history:** their own candles only start in 2025-26, so the lab backtests on the underlying's daily history from Yahoo Finance (free, no key), back to 2017. Each mapping was checked against the live perp price on 2026-09-29, and all were within 1.1% except HOOD at 3.2% (see `lab/data.py → MARKETS`, 21 markets). Futures-based markets (gold, oil, copper, gas) use Yahoo's continuous contract, which carries small jumps when the contract rolls.
- **Weekday calendar:** the perps trade all week, but their underlying doesn't. The engine therefore reads weekday bars only for builder-market coins (`hl_data.weekdays`), the same calendar the backtest used. On weekends a target is held, not recomputed.
- **Engine support:** `hl_data.meta_and_ctxs(dexes)` reads each builder exchange an agent needs. Candles and funding use the prefixed name.
- **Paper only:** `cycle.resolve_mode` runs paper for any agent holding a builder-market coin until `builder_live_validated` is set, and `go_live.py` refuses such agents. Placing live orders on a builder exchange must first be proven on a small live test.
- **Parity:** the lab's Phase 0 replay includes a cross-asset recipe (BTC + S&P 500 + gold). The engine and the backtest agree within 0.16% of equity on every day.
- **Regime gates:** gates read the market regime from BTC, which says nothing about gold or oil. The auto scout never gates stock or commodity baskets by regime. Cross-asset baskets may be gated.

## Venues considered and rejected

- **Lighter** (zk perp DEX): its terms prohibit anyone who lives in or is located in Canada, the US and the UK, among others. That fails the owner's venue rule, so it is **rejected**.
- **Non-KYC centralised exchanges:** closed to Canada (see DECISIONS.md).

## Next, when evidence asks for it

- **More builder exchanges** (flx, km/mkts, io), once one of their markets has volume worth trading.
- **A live test for builder markets:** one minimum-size order and cancel through the SDK's perp-exchange support, then `builder_live_validated`.
