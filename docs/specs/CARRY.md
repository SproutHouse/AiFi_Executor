# Carry bot — specification (Phase 1, frozen 2026-09-26)

_Evidence: `research/phase1/carry.py` over Hyperliquid's complete hourly funding history (`fetch_funding.py`),
results in `research/phase1/carry_results.json`. Parameters chosen on 2023–2024 and judged only on 2025–2026._

## The rule

| Item | Value |
|---|---|
| Position | short perp N + long spot N on Hyperliquid, delta-neutral; income = hourly funding × N |
| Basket | **HYPE, PUMP, XPL, BTC, ETH, ZEC** (every perp with a liquid spot leg, minus ENA and SOL, see below) |
| Enter | when the trailing **24-hour** mean funding, annualised, is **≥ 10%** |
| Exit | when the trailing 24-hour mean funding falls **below 0%** |
| Leverage | perp leg **≤ 2x**; capital per unit N = 1.5N |
| Per-asset cap | 30% of the carry bot's capital in any one asset |
| Orders | **both legs together, taker (IOC), in the same cycle** since 2026-10-16 (was maker-only; see "Execution evidence") |
| Delta | legs equal in coins; the pair is re-sized (both legs together) only when its notional drifts more than 25% from target |
| Regime | unwind on **crisis** (REGIME.md); weight 0.5 in bear and chop |
| Cadence | hourly, on an always-on runner (not GitHub's cron, which is unreliable at hourly) |

## Evidence

Net return on capital, maker fills (0.11% per round trip both legs), one rule for all assets:

| | 2023–2024 (chosen on) | 2025–2026 (unseen) |
|---|---|---|
| Mean of the basket | 14.8%/yr | **5.2%/yr** |

| Asset | 2025–26 net on capital | Time in market | Round trips | Hours with negative funding (all history) | Worst 30 days (annualised) |
|---|---|---|---|---|---|
| HYPE | 9.8% | 89% | 22 | 7% | +3.4% |
| PUMP | 8.0% | 91% | 18 | 7% | +3.6% |
| XPL | 6.6% | 89% | 22 | 7% | +3.2% |
| ZEC | 4.8% | 71% | 24 | 19% | −35.2% |
| BTC | 4.0% | 72% | 27 | 13% | −10.9% |
| ETH | 3.3% | 69% | 34 | 14% | −3.7% |
| ENA (excluded) | 3.2% | 58% | 41 | 33% | −57.8% |
| SOL (excluded) | 1.6% | 51% | 44 | 24% | −27.3% |

Taker fills (0.23% per round trip) cut roughly 0.5–1.5 points a year versus maker fills on paper. PUMP, XPL and ZEC listed
in 2025, so their numbers rest on less than 18 months.

### Execution evidence (2026-10-16 review)

Maker-only execution at an hourly cadence lost far more than the fee it saves. Each leg rested its own maker order, so
the first leg to fill was always the one the market had just moved against, and the pair stayed unhedged for hours.
On the paper bot from 2026-09-27 to 10-15: funding +4.52, fees −1.72, **leg and hedge P&L −23.2** on a 1,000 pot
(−2.04% in all), and capital committed reached 1.37× the pot. Replaying the engine's own carry code over ~205 days on
the same six coins: hedge P&L −157.8 with maker legs, −82.6 with maker legs kept equal and completed after one hour,
**−7.3 trading both legs together at market** (final equity 858.6 / 943.4 / 1,012.8). The lab's carry backtest
models none of this (funding minus a flat 0.11% fee), so its carry results are not evidence; the lab's auto search
has paused carry until a simulator that costs taker execution, basis and legging exists. The capture gate below
should be read net of leg P&L.

## Honest assessment

- **Carry has compressed.** BTC and ETH earned about 14%/yr on capital in 2023–24 and about 4% in 2025–26. The
  Doctrine's 5–15% range holds only at its low end today, except in the newer, smaller coins.
- **Against the benchmark.** The Doctrine's bar is the HLP vault (third-party figures of 10–25%/yr, to verify on the
  vault page). At ~5% for the basket, carry does not clearly beat HLP today; it earns its place as a low-volatility
  sleeve and as the harvester of the next euphoria, when funding historically ran above 30%/yr (REGIME.md).
- The projection ignores the spot-perp basis at entry and exit, spot-book slippage beyond the fee, and funding paid
  on a notional that drifts between rebalances. Live capture efficiency measures exactly these leaks.

## Go-live gate

1–2 weeks of integration on testnet; then 2–4 weeks live-small with **capture efficiency ≥ 80%** (funding actually
collected, net of fees, ÷ the funding the rule would have collected on its own record of positions). Pass: scale.
Fail: the leak is execution and is findable in the logs.

## What Phase 2 must build for it

Spot orders; post-only orders and a paper fill model that fills only when price trades through; two-leg positions
with delta rebalancing and reconciliation of both legs; funding as income in paper; the always-on hourly runner.

## Phase 2 status (2026-09-27)

Built and tested (`src/executor/carry.py`, carry mode in `cycle.py`, `tests/test_carry.py`):

- Spot pairs resolved from Hyperliquid's own metadata (UBTC `@142`, UETH `@151`, HYPE `@107`, UPUMP `@188`, UXPL `@210`,
  UZEC `@272`); spot prices rounded to 8 decimals, perps to 6.
- Two-leg positions: `entering → open → exiting → closed`. In taker mode (carry-1h since 2026-10-16) both legs trade
  together in one cycle. In maker mode, one resting order per leg, re-sized or cancelled every cycle and re-quoted
  only when older than `requote_hours` (2).
- Paper maker fills: an order fills only if price trades strictly through it, in a bar that opened after it was placed.
- Funding as income on the short leg from the exact hourly rates, never counted twice; theoretical funding kept alongside
  for the capture-efficiency gate. Capture is only meaningful over the gate's weeks: over a few hours fees dominate.
- Safety override (maker mode): legs out of balance by more than 2% (and at least one size step, on the coarser of the
  two legs' steps) for `max_unhedged_hours` (1) → the lagging leg completes with a taker order, cancelling its resting
  order. A gap smaller than one size step is left alone, with no alert (until 2026-10-16 such no-op overrides alerted
  the owner dozens of times).
- Live primitives: post-only (`Alo`) and immediate-or-cancel orders for perp and spot names. **Live carry is refused**
  (runs paper with a note) until the Phase 4 testnet run sets `carry_live_validated`.
- Agent `carry-1h` runs hourly in paper on GitHub's scheduler. Live needs the always-on runner (the self-hosted
  European machine), because GitHub's hourly schedule can slip; paper only loses fill timing, not correctness.
- Not yet wired: the crisis unwind waits for the regime layer (Phase 5); until then `regime_crisis()` never fires.

First dry run on live data (2026-09-27 01:14 UTC): enters PUMP (36%/yr), XPL (46%), ETH (10.9%), ZEC (11.4%) at 17% of the
pot per leg; HYPE and BTC below the 10% entry bar.

**2026-09-29:** the crisis unwind is wired: `cycle.regime_crisis()` reads the regime classifier (`market_regime.py`)
on BTC's daily bars; a crisis label exits every carry position and blocks entries until another label has held 5 days.
A missing reading never forces an unwind.

