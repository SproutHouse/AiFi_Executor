# Decisions and evidence

_The why behind the rules, so a future change argues with the evidence rather than with a memory._

## 2026-09-22 · Venue

Kraken was the first suggestion and was dropped on the owner's rule: no venue that requires identity
verification. Hyperliquid fits: no KYC; terms restrict the US and Ontario, not Quebec; agent keys that can
trade but not withdraw; perpetuals for 38 of the desk's 55 names; an MIT Python SDK and CCXT support.
No-KYC centralised exchanges were checked and rejected: MEXC prohibits Canada and ended unverified access in
February 2026; BloFin excludes Canada; Phemex names Quebec; CoinEx is winding down.

## 2026-09-22 · No model in the loop

The article that prompted this (Miles Deutscher, "How to Build an AI Trading Bot", September 2026) puts a
Claude chat session holding a read-write key in charge of orders. Rejected: a chat session cannot be replayed
or scored, and a key in a chat context is a key at risk. The desk's own rule applies: tokens only for
interpretation, never for arithmetic. Here there is no interpretation to do.

## 2026-09-22 · Long-only

Backtests on Binance history through the desk's indicator port, 2017 to 2026, 35 names: shorts on weekly
bearish flips lost in every variant (−0.03 to −0.23 R per trade, n = 285 to 547), even with a strict bear
gate. After Bitcoin's weekly cloud flipped bearish, the next four weeks were up 4 times in 5. The bear
setting is therefore flat, not short. Details: [backtests/backtest_summary.md](backtests/backtest_summary.md).

## 2026-09-22 · Four-hour bars inside daily and weekly

Long-only 4-hour flips inside a bullish daily and weekly, 12 liquid names, 2020 to 2026: 45 trades a year,
win 37%, +0.35 R, profit factor 1.56, max drawdown 22%, costs 0.05 R per trade. Adding pullbacks raised total
R but doubled the drawdown; they are tier B and need approval. Sub-4-hour bars would push costs above
0.15 R per trade, so the bar is frozen.

## 2026-09-22 · Never veto an overextended entry

A veto on entries when price was above the Noodle band removed 95% of trades: a momentum flip is
overextended by construction. The band is used for pullback re-entries instead.

## 2026-09-22 · Risk per trade and caps

1% risk per trade; 2% doubled drawdown to 77% without raising the return. Positions stop out together, so
the open-risk cap of 4% is the real unit of risk, and the position count adds little diversification.

## 2026-09-23 · Hours model

Owner's decision: approval-only from 10:00 to 22:00 Toronto time, automatic for tier A overnight. Exits
never wait for approval, because waiting adds risk without adding judgement.

## 2026-09-23 · Skipping the paper period

Owner's decision to start live with a small pot rather than run 8 to 12 weeks of paper. Our note: the
backtest is an upper bound (survivorship, variants chosen after seeing results), and paper's main value was
proving the plumbing. Mitigations built in: paper mode is the default until the key secrets are set,
exchange-resident stops, the throttle, caps, reconciliation, and the stage-one key verification with a
minimum-size order.

## 2026-09-23 · Separate repository, same account

Secrets are repository-scoped; the desk's repository carries a runner token and auto-commit tooling. A
second GitHub account would isolate further but GitHub's terms allow one free personal account, so the
account is the trust root and is hardened instead.

## 2026-09-23 · What the article's setup prompt added

Adopted: staged acceptance tests; an explicit operating-context file (pot, maximum loss, approval latency,
autonomy); a pre-trade checklist that logs every refusal; logging market conditions and refused signals;
`/pause`-style controls, implemented as GitHub workflows rather than a chat bot. Rejected: the model holding
keys; Telegram as a control plane; Pine Script conversion. Added beyond both: exchange-resident stops,
reduce-only exits, client order ids, reconciliation, data freshness and sanity band, late-run window, order
rounding, emergency flatten, dependency locking, master-key hygiene, tax-ready records.

## 2026-09-23 · Books instead of one bot per ecosystem

The owner proposed a separate self-improving bot per ecosystem, each accumulating that chain's blue chip.
Kept: scoring each book against its blue chip, which is the honest benchmark. Changed: one engine with
several books rather than several engines, because five books at 1% risk each are one correlated bet and
need one global cap, because a book alone generates too few trades to learn from without fitting noise, and
because only Hyperliquid-listed, aged, liquid names pass the venue rule. Robinhood Chain and the on-chain
second tier wait for history and for a spend-capped wallet design.

## 2026-09-24 · No approvals

After the first overnight cycle produced two tier B proposals, the owner decided execution should follow the
rules without a human, emotional step. Tier A now executes at any hour; tier B is recorded and not traded,
because the backtest showed pullbacks doubled drawdown for extra R, and an unattended tier B needs its own
evidence first. The approval workflow and the online-hours model stay available as a setting.

## 2026-09-24 · Run from Europe

The owner wants no grey area about where the executor's requests originate. GitHub's free runners cannot
choose a region, so the workflows now take their runner from a repository variable, and a setup script
turns an Oracle Always Free VM in Frankfurt, Amsterdam or Zurich into a self-hosted runner. A GitHub-hosted
watchdog that never touches the exchange reports when the server goes quiet. The Python setup action was
dropped at the same time: the code is standard library, and live mode builds its own venv.

## 2026-09-25 · First full review

A line-by-line review against LOGIC.md found the rules implemented as written and the paper loop sound, and
found five live-path defects that could have left a real position unprotected or counted a trade twice:
stop cancelled before the close, no failure handling around a live entry, state persisted only at the end
of the run, data gaps treated as bearish, and exits managed before stops the exchange had fired were
absorbed. Also: the HALT file was ignored by git, so the kill switch did not survive a GitHub run, and a
zero-equity pot crashed the pre-trade check. All were fixed as v1.3 with tests that drive the cycle against
a fake exchange. Deferred to after 30 live trades: enabling tier B, retiring or re-scoping the bnb book and
the names the volume filter keeps refusing, and stripping pot-unit amounts from the dashboard API.

## 2026-09-25 · Several agents instead of one busier bot

The owner found the executor too idle (13 cycles, 9 signals, 0 trades: 4 blocked by the volume floor, 3 tier B, 2
expired proposals) and wants several agents with different parameters, separate keys, one dashboard. A backtest of
more-frequent variants (docs/backtests/variants.md) showed that more names without the Bitcoin gate trades ~1.7× as
often with a smaller but positive edge, while pullbacks and 1-hour triggers trade far more with little or no edge.
Decision: keep Core unchanged as the control; add Wide (31 names, no Bitcoin gate, 5M floors) and Fast (1-hour, paper
experiment); run all in paper and let the Compare sheet decide which earns a live wallet. The engine gained an agent
setting that isolates config, state, keys, KV keys and alerts; the runner went hourly.

## Open questions

- Pot size and maximum acceptable loss in the owner's own numbers, before live.
- Whether Lighter should become a second venue for names Hyperliquid lacks.
- Whether the desk's Research Cleared tick should feed allowlist proposals automatically.
- Tax characterisation of frequent perpetual trading in Canada: keep the ledger exportable with CAD rates;
  ask an accountant.
