# Agents — several strategies, one engine, one dashboard

An **agent** is one strategy with its own rules, its own pot, its own exchange key and its own kill switch. All
agents run the same engine code; what differs is their configuration. The dashboard shows one agent at a time and a
**Compare** sheet (tap the agent name in the top bar) lists them side by side in R and % of each agent's own pot.

## The roster (`agents/index.json`)

| Agent | Rules | Backtest | Status |
|---|---|---|---|
| **Core** (`core`) | 12–14 names in `config/books.json`, 4-hour flips inside bullish daily and weekly, Bitcoin weekly must be bullish | 2020–26: 0.7 trades/week, +0.28 R, PF 1.45, max DD 23% | paper; the control |
| **Wide** (`wide-4h`) | 31 liquid names, same 4-hour rule, no Bitcoin gate, volume floor 5M, OI floor 5M | 2020–26: 1.2 trades/week, +0.18 R, PF 1.30, max DD 28%; 2023–26 about break-even | paper |
| **Trend** (`trend-1d`) | Doctrine bot 2: BTC+ETH held while the daily close is above its 50-day average, sized to 30% volatility (cap 2x), rebalanced only outside a 25% band, 15% resident stop. Target-weight mode, not flips | 2017–26: Sharpe 1.32, t 3.94, deflated Sharpe 0.992; walk-forward 2020–26 Sharpe 0.83 (docs/specs/TREND.md) | paper; judged yearly, sized as tuition |
| **Carry** (`carry-1h`) | Doctrine bot 1: short perp + long spot on HYPE, PUMP, XPL, BTC, ETH, ZEC; in at 24h funding ≥ 10%/yr, out below 0%; maker-only, perp ≤ 2x | full funding history: 14.8%/yr on capital 2023–24, 5.2% on unseen 2025–26 (docs/specs/CARRY.md) | paper; live refused until testnet-validated; gate = capture ≥ 80% |
| **Fast** (`fast-1h`) | 31 names, 1-hour flips inside a bullish 4-hour, daily and weekly | 2023–26: 3.8 trades/week, +0.01 R, PF 0.99, max DD 45%: **no proven edge** | paper-only experiment |

**Arena agents** (`arena-NN`, from 2026-09-29) are added and retired by the AiFi Lab, not by hand. Each is one recipe
that survived the lab's frozen gates and a locked holdout. It runs in paper with a $1,000 pot, and it is retired
automatically if its paper stops matching its backtest (specs/FACTORY.md). Their `desc` says in plain words what the
recipe holds and carries the recipe id; the backtest numbers live in the Lab's record (the bot page's Strategy section).

**Twins** (`<agent>-twin`) are started by the go-live workflow. When an agent goes live, its twin keeps running the same rules
in paper with the same pot; the gap between the two is the real cost of execution. A twin never goes live itself.
**The fleet** (`agents/fleet.json`, `state/FLEET_HALT`) is one kill switch and one optional size dial over every
agent (specs/FACTORY.md).

Evidence: [backtests/variants.md](backtests/variants.md). Trading more often on these signals mostly trades away the
edge; the live paper comparison exists to test that with real fills rather than argue about it.

## Isolation

| Thing | Core | Any other agent `<id>` |
|---|---|---|
| Config | `config/settings.json`, `config/books.json` | `agents/<id>/settings.json`, `agents/<id>/books.json` |
| State (positions, pot, ledger, runs, HALT) | `state/` | `state/agents/<id>/` |
| Exchange key secrets | `HL_AGENT_KEY`, `HL_ACCOUNT_ADDRESS` | `HL_AGENT_KEY_<ID>`, `HL_ACCOUNT_ADDRESS_<ID>` (id upper-cased, dashes to underscores: `wide-4h` → `_WIDE_4H`) |
| Dashboard data (KV) | `exec:latest`, `exec:ledger`, `exec:stamp` | `exec:<id>:latest`, `exec:<id>:ledger`, `exec:<id>:stamp` |
| Alerts | `Executor: …` | `[<id>] Executor: …` |

`scripts/run_agents.py` runs hourly. It removes every secret from its own environment and starts each agent's cycle
in a separate process that receives only that agent's key and address plus the alert webhook; the dashboard upload
runs in another process that receives only the Cloudflare token. `tests/test_agents.py` proves an agent never sees
another agent's key. An agent is run when its trigger bar has just closed: 4-hour agents at 00, 04, 08, 12, 16 and
20 UTC, 1-hour agents every hour.

**Use a separate Hyperliquid wallet per live agent.** Two agents on one account would see each other's positions
and trip each other's reconciliation.

## Adding an agent

1. Pick an id: lowercase letters, digits and dashes, 2–24 characters.
2. `mkdir agents/<id>` and copy a `settings.json` and `books.json` from an existing agent; change what differs
   (`trigger_tf` "4h" or "1h", `btc_gate`, `universe` floors, books). Keep `"mode": "paper"`.
3. Add `{"id", "name", "enabled": true, "desc"}` to `agents/index.json`. `desc` is the first sentence under the bot's
   name on its page, read by the owner, who is not a developer: one or two plain sentences on what it does and how it
   is judged ("Trades 31 coins every hour when the bigger trend agrees. No proven edge yet, so paper only."). No engine
   terms (flips, books, grades, recipe families) and at most about 170 characters (the exec:agents row budget).
4. Backtest the idea first (`docs/backtests/variants.py` shows how) and record the result in this file's table above.
5. Before it can go live, add its two secret names (`HL_AGENT_KEY_<ID>`, `HL_ACCOUNT_ADDRESS_<ID>`) to the env blocks of
   `.github/workflows/cycle.yml`, `control.yml` and `approve.yml`. Secrets are listed by name on purpose: passing all of
   them at once (`toJSON(secrets)`) makes GitHub hold the workflow as possibly malicious.
6. Commit and push. The next hourly run starts it in paper; the dashboard lists it after its first push.

Going live is per agent and follows OPERATIONS.md, with that agent's own wallet and its own two secrets.

## Controls

The **control**, **approve** workflows take an `agent` input (default `core`); halting or flattening one agent
never touches another. The **cycle** workflow can be run by hand with `only` and `force` to run chosen agents now.
