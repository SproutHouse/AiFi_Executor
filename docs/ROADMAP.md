# Roadmap

| Phase | What | Gate to the next |
|---|---|---|
| 0 · now | Paper mode on GitHub Actions, alerts, approvals, ledger, Sunday review | owner's go, secrets set |
| 1 | Live, small pot: key verification, first minimum-size cycle, reconciliation clean | 30 live trades, positive expectancy in R, drawdown under 20% |
| 2 | Raise the pot; autonomy level 1 (tier A auto around the clock if wanted) | another 30 trades matching the rules |
| 3 · built 2026-09-24 | Dashboard, modelled on the AiFi dashboard with a magenta accent: a Cloudflare Worker reading a bundle every cycle pushes (positions, equity curve in %, ledger, refusals, readings, documents, review). See DASHBOARD.md | deploy needs the Cloudflare secrets |
| 4 | Desk integration: weekly book-membership proposals from the desk's Research Cleared names | — |
| 5 | Sweep execution: convert earmarked gains into the book's benchmark on Hyperliquid spot, once spot orders are verified live | book verdicts positive |
| 6 | New books as they earn it: Robinhood Chain when its names pass 280 daily bars; on-chain second tier behind a spend-capped wallet | evidence first |
| later | Second venue (Lighter) for names Hyperliquid lacks; shorts only if the ledger produces bear-regime evidence; a Solana/Base leg via a spend-capped wallet | evidence first |

Never on the roadmap: leverage above 3x, sub-4-hour bars, a model placing orders, the master key on a server.

## Bot Doctrine build (from 2026-09-26)

Phase 1 (specs from data) done: [specs/PHASE1.md](specs/PHASE1.md). Next: Phase 2, engine capabilities (daily bars and target-weight mode for trend; spot, post-only, two-leg positions, funding income and an always-on hourly runner for carry), each test-first.
