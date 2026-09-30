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

The lab replays the real `cycle.py` day by day in a sandbox. Both the engine and the backtest start from an empty book on the same day, and it compares what each held every day. On 2026-09-29 it ran four recipes in four families (one gated by regime, one mixing crypto with S&P 500 and gold markets), over 8 to 12 months each:

| Recipe | Largest holding gap | Return, engine vs backtest |
|---|---|---|
| Trend | 0.02% of equity | +9.54% vs +9.42% |
| Rotation (bull-only) | 0.02% | +7.60% vs +7.32% |
| Breakout | 0.04% | −0.90% vs −1.43% |
| Cross-asset momentum | 0.16% | +10.53% vs +9.94% |

The replay found three engine rules the backtest had missed, and the backtest now models all three:
- a stop of 0% meant "stop at the entry price", so every recipe now keeps a 5–40% stop;
- entries are refused while funding is above 30%/yr;
- paper equity left out funding owed on open positions until they closed. That was an engine inaccuracy, now fixed in `paper.equity`.

The Phase 0 gate now fails if the largest gap exceeds 1% of equity or the returns differ by more than 1 point.

## Arena agents

- **Where they live:** `agents/arena-NN/`, entered in `agents/index.json` with an `"arena"` block (recipe id, family, enrolment date, backtest Sharpe and drawdown).
- **How they run:** hourly with the others, in **paper only**. They have no keys and no live path. Their throttle is set from their own backtest drawdown.
- **When they're retired:** the lab disables an arena agent when:
  - its engine weights stop matching the backtest;
  - its paper drawdown exceeds 1.25× the backtest's worst;
  - its return falls below the backtest's 5th percentile for the same length of time.

  A retired agent's state and ledger stay in the repo.
- **Limits:** at most 10 arena agents at a time.

## Shortlist and going live (Phase 5)

The dashboard's **Agents** view has a **Shortlist** sheet. It shows every arena bot's evidence packet: backtest,
the locked unseen year, returns by market regime, and paper results against the backtest. It also gives a
**Ready** verdict with the reasons a bot is not ready yet. Ready means all of these:
- at least the minimum time in the arena;
- behaving as tested;
- engine weights matching the backtest on at least 80% of checks;
- paper drawdown within the backtest's worst.

Ready is evidence. The only switch is the **go-live** workflow, run by the owner. It:
- asks for the agent, the pot, and the typed confirmation `LIVE <agent>`;
- refuses GitHub's US-hosted runners unless the owner explicitly allows them;
- refuses carry and builder-market bots until their live order paths are validated;
- flips that one agent to live and starts a **paper twin** beside it (`<agent>-twin`, same rules and pot). The gap between the two is the real cost of execution.

`BACK <agent>` returns the agent to paper. Before going live, the owner:
1. creates the agent's own Hyperliquid wallet and funds it;
2. approves an API wallet on it (which can trade but never withdraw);
3. adds the secrets `HL_AGENT_KEY_<ID>` and `HL_ACCOUNT_ADDRESS_<ID>`. The workflows already carry slots for `arena-01` to `arena-10`.

If a secret is missing, the engine keeps running paper and says so.

A live bot that stops matching its backtest is **halted** by the lab: no new entries, exits still run. It is
never switched off; the owner decides what happens next.

## The fleet (Phase 6)

The **Fleet** sheet shows:
- how capital would be split so each bot adds the same share of fleet risk (equal risk contribution on backtest daily returns since 2023-06, with volatility floors of 5% for carry and 10% for directional bots, and at most 40% per bot);
- that split trimmed by the regime weights in REGIME.md;
- the correlation matrix, paper and live totals, and the kill switch.

Moving money between live wallets is always the owner's job. In the engine (`agents/fleet.json`, `state/FLEET_HALT`):
- **Fleet kill switch:** `control → fleet-halt` stops new entries on every agent, and `fleet-resume` clears it. `run_agents.py` sets it by itself when the live agents together fall `max_live_dd_pct` (15%) from their peaks. Exits always run.
- **Regime sizing (off by default):** with `apply_regime_weights: true`, the lab writes a `size_mult` per LIVE agent, and the engine scales that agent's new positions by it (1 in bull, 0.5 in bear, 0 in crisis). Paper arena agents are never scaled, so they stay comparable with their backtests.

## More markets (Phase 7)

Hyperliquid's builder exchange **xyz** lists S&P 500, Nasdaq-100, gold, oil, silver, copper and large US stocks
as perps. The lab backtests them on 2017+ history of the underlying, and the engine paper-trades them. See MARKETS.md.

## Why the engine is long-or-flat

The lab can research short recipes. Phase 1 found shorts did not pay in any trend family, so the engine's short side
will be built only if lab recipes that short pass every gate. Until then, a short signal is held at zero.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 Foundations | Price and funding since 2017, daily regime labels, one code path for backtest, paper and live | done 2026-09-29 |
| 1 Recipes | Bots as recipe files; families in the engine; pass/fail rules frozen | done 2026-09-29 |
| 2 Lab | Trial registry with a rising bar, per-regime scoring, cost, neighbour, lookahead and holdout checks, beats-holding test | done 2026-09-29 |
| 3 Research loop | Scout (Claude + auto), builder, auditor, registrar; nightly Claude routine plus the lab's nightly Action | done 2026-09-29 |
| 4 Paper arena | Survivors enrolled after the auditor's review; demoted (paper) or halted (live) when they stop matching | done 2026-09-29 |
| 5 Shortlist and go-live | Shortlist sheet, go-live workflow with paper twin, arena key slots | done 2026-09-30 |
| 6 Fleet | Equal-risk split with regime weights, correlation, fleet kill switch and drawdown guard, optional regime sizing | done 2026-09-30 |
| 7 More markets | Hyperliquid builder markets (indices, commodities, stocks) in the lab and in paper; Lighter rejected (Canada) | done 2026-09-30 (paper) |
