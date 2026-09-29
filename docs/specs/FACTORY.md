# The bot factory — Executor side

_Started 2026-09-29. The research side lives in the private AiFi Lab repository; this page covers what the
Executor provides and what it accepts._

The factory's job is to create bots with different strategies, test them, and keep only the ones that are real.
A bot is a **recipe**: a strategy family, its settings and its coins. The lab:
- proposes recipes;
- backtests them with the Executor's own code;
- tries to break them, against frozen rules and a count of every trial;
- sends survivors here as **arena agents** (paper).

The owner decides whether a bot ever trades real money.

## What the Executor provides

- **`src/executor/families.py`:** the strategy families as pure, causal functions. The lab computes a whole history with `targets()`; the engine trades `latest()`. Same code, so a backtest is a faithful preview.
- **`src/executor/market_regime.py`:** the regime classifier (REGIME.md) as a pure function. The lab uses it to score bull and bear phases separately; the engine uses it for regime gates and the carry crisis unwind.
- **Target mode with a recipe block:**
  ```json
  "target": {"family": "rs_rotation", "params": {...}, "coins": [...], "band": 0.25, "stop_pct": 20, "book": "arena"}
  ```
  See EXECUTION.md.

## Parity proof

The lab replays the real `cycle.py` day by day in a sandbox and compares what the engine held with what the
backtest held. On 2026-09-29 it ran three recipes in three families, one of them gated by regime, over 8 to 12 months each:

| Recipe | Largest holding gap | Mean holding gap | Return, engine vs backtest |
|---|---|---|---|
| Trend | 0.84% of equity | 0.04% | +10.06% vs +9.40% |
| Rotation | 0.26% | under 0.01% | +7.63% vs +7.32% |
| Breakout | 3.55% | 0.05% | +0.39% vs −0.06% |

The replay found two engine rules the backtest had missed, and the harness now models both:
- a stop of 0% meant "stop at the entry price", so every recipe now keeps a 5–40% stop;
- entries are refused while funding is above 30%/yr.

## Arena agents

- **Where they live:** `agents/arena-NN/`, entered in `agents/index.json` with an `"arena"` block (recipe id, family, enrolment date, backtest Sharpe and drawdown).
- **How they run:** hourly with the others, in **paper only**. They have no keys and no live path. Their throttle is set from their own backtest drawdown.
- **When they're retired:** the lab disables an arena agent when:
  - its engine weights stop matching the backtest;
  - its paper drawdown exceeds 1.25× the backtest's worst;
  - its return falls below the backtest's 5th percentile for the same length of time.

  A retired agent's state and ledger stay in the repo.
- **Limits:** at most 10 arena agents at a time.

## Why the engine is long-or-flat

The lab can research short recipes. Phase 1 found shorts did not pay in any trend family, so the engine's short side
will be built only if lab recipes that short pass every gate. Until then, a short signal is held at zero.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 Foundations | Price and funding since 2017, daily regime labels, one code path for backtest, paper and live | done 2026-09-29 |
| 1 Recipes | Bots as recipe files; families in the engine; pass/fail rules frozen | done 2026-09-29 |
| 2 Lab | Trial registry with a rising bar, per-regime scoring, cost, neighbour, lookahead and holdout checks | done 2026-09-29 |
| 3 Research loop | Scout (Claude + auto), builder, auditor and registrar as a nightly batch | built; first batch run by hand |
| 4 Paper arena | Survivors enrolled automatically; demotion when paper stops matching | built |
| 5 Shortlist and go-live | Evidence tab on the dashboard; owner switches a bot live at small size with a paper twin | next |
| 6 Fleet | Capital split by risk and correlation, regime weights, retirement, one fleet kill switch | later |
| 7 More markets | Other venues and asset types (Hyperliquid equity and commodity markets, Lighter) | later |
