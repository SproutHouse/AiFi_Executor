# AiFi Executor

A deterministic trend executor for Hyperliquid perpetuals. It reads the same two indicators as the AiFi
desk, Momentum Cloud and Noodle Range, decides with fixed rules, sizes by risk, and keeps every stop on the
exchange. There is no language model anywhere in the loop.

**Status: paper mode.** It goes live only when the owner sets the agent-key secrets and flips `mode` in
`config/settings.json`. Read [docs/OPERATIONS.md](docs/OPERATIONS.md) before doing that.

## The guardrails that never move

- Long-only in version 1.0. Shorting had negative expectancy in every backtest variant.
- Only the Hyperliquid **agent key** is ever present on the runner. It can place and cancel orders and
  nothing else; withdrawals and transfers need the master key, which never touches this repository.
- Risk per trade is 1% of the pot; open risk is capped at 4%; leverage at 3x; positions at 6.
- Every stop is an exchange-resident, reduce-only trigger order on the mark price. If this bot is down,
  the exchange still exits.
- No human approval: tier A signals execute on their own at any hour; tier B signals are recorded and not
  traded. Exits never wait for anyone. The online-hours approval model remains available as a setting.
- Names are grouped into books per ecosystem, each scored against its blue chip; a book that does not beat
  holding its blue chip over 30 trades is proposed for retirement.
- Every refusal is written down with its reasons. Rules change only by a new version that beat the old one
  out of sample; the bot cannot edit its own parameters.

## Read this first

| File | What it is |
|---|---|
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Setup and going live, one step at a time, nothing assumed |
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | The plain-English version |
| [docs/LOGIC.md](docs/LOGIC.md) | The exact rules, versioned |
| [docs/RISK.md](docs/RISK.md) | Sizing, caps, throttle, what leverage is for |
| [docs/UNIVERSE.md](docs/UNIVERSE.md) | Which names may be traded and why |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Schedule, order types, reconciliation, the paper engine |
| [docs/SECURITY.md](docs/SECURITY.md) | Keys, secrets, repository hardening, incident steps |
| [docs/LEDGER.md](docs/LEDGER.md) | The record: files, fields, what R means |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Runbook: setup, approving, halting, going live |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why it is built this way, with the evidence |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, gates, the dashboard |
| [docs/backtests/](docs/backtests/) | The backtests and their summary |

## Layout

```
config/    settings.json (every parameter) · books.json (books: names, benchmark, pot share, cap) · OWNER_CONTEXT.md
src/executor/  common · indicators · hl_data · binance_data · regime · signals · universe · risk · hours
               proposals · ledger · paper · live · cycle · review
scripts/   run_cycle.py · approve.py · control.py · review.py · verify_keys.py
state/     positions_<mode>.json · paper.json · proposals/ · ledger/ · runs/ · review/   (committed by the runner)
tests/     unit tests, standard library only:  cd tests && python3 -m unittest -v
.github/workflows/  cycle (every 4h) · approve (your tap) · control (halt/resume/flatten) · review (Sunday)
```

## Run it locally

```bash
cd tests && python3 -m unittest -v && cd ..
EXECUTOR_STATE=$(mktemp -d) python3 scripts/run_cycle.py --dry --verbose
```

Python 3.9 or newer, standard library only in paper mode. Live mode additionally needs the pinned
`hyperliquid-python-sdk` from `requirements-live.txt`.
