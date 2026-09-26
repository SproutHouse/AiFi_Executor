# Regime classifier — specification (Phase 1, frozen 2026-09-26)

_Evidence: `research/phase1/regime.py`, results in `research/phase1/regime_results.json`. BTC daily 2018–2026;
Hyperliquid BTC funding from 2023-05._

## Dials and labels

| Dial | Definition |
|---|---|
| Trend | BTC daily close vs its 200-day SMA with a ±2% band: above the band = up, below = down, inside = previous state |
| Volatility | 30-day realised volatility as a percentile of the trailing 365 days |
| Funding | BTC 7-day mean funding, annualised |

Labels, first match wins: **crisis** (vol percentile ≥ 90 **and** close below its 50-day SMA) · **bear** (trend down)
· **euphoria** (trend up and funding ≥ 20%/yr) · **bull** (trend up) · **chop** (trend undefined).
A new label must hold **5 consecutive days** to take effect; **crisis takes effect at once**.

## Evidence (2018–2026)

| Label | Share of days | BTC next-day return, annualised | BTC funding (carry income), 2023+ |
|---|---|---|---|
| bull | 42% | +65% | +9.0% |
| bear | 42% | +23% | +5.9% |
| euphoria | 8% | +41% | +32.8% |
| crisis | 6% | +69% | +4.3% |
| chop | 2% | −119% | — |

67 label changes in 8.7 years (7.7 a year); 13 of 68 stretches lasted a week or less. Two versions were tested:
crisis on volatility alone churned more (9.3 changes a year) and fired on violent rallies; the version above requires
a falling market and 5-day confirmation.

**Crisis is a risk rule, not a forecast.** Crisis days averaged a positive next-day return because crashes rebound
violently. Going flat in crisis is justified by liquidation and gap risk, and it is cheap: the trend bot is already
flat (crisis requires price below the 50-day average), and carry earned only ~4%/yr in crisis.

## Weights (hypotheses to log, not fitted numbers)

| Bot | euphoria | bull | chop | bear | crisis |
|---|---|---|---|---|---|
| Carry | 1.0, perp leverage ≤ 2x, kill armed | 1.0 | 0.5 | 0.5 (its own funding rule decides) | **0 — unwind** |
| Trend | 1.0 | 1.0 | 0.5 | 0.5 | 0 (already flat by rule) |
| Core / Wide (4-hour flips) | 1.0 | 1.0 | 0.5 | 0.5 | 0 |

The classifier's daily state, its three dial values and the weights applied are logged and versioned per day, so any
losing regime change can be traced to the classifier or to the bot.

Regime on 2026-09-25: **bull**.
