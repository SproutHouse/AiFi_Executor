# Phase 1 — results and exit gate (2026-09-26)

Phase 1 turned the AiFi Bot Doctrine into exact, evidence-backed rules before any trading code.

| Item | Result | Spec |
|---|---|---|
| Carry projection | Built from the full hourly funding history. One rule for all assets: 14.8%/yr on capital in 2023–24, **5.2% on unseen 2025–26**. Best now: HYPE ~9.8%, PUMP ~8%, XPL ~6.6%; BTC/ETH ~3–4% | [CARRY.md](CARRY.md) |
| Trend rule | Daily close vs 50-day SMA, **long/flat**, BTC+ETH, vol-targeted. Passes the in-sample gate (t 3.94, deflated Sharpe 0.992 over 28 trials); walk-forward t 2.15 — live only as tuition. **No short side**: shorts did not pay | [TREND.md](TREND.md) |
| Regime classifier | Trend / volatility / funding dials, 5-day confirmation, crisis only in falling markets; 7.7 changes a year; weights for every bot | [REGIME.md](REGIME.md) |
| Accounts | Sub-accounts need $100k volume first → one wallet per live bot until then; 3 agents per master; never reuse an agent address; expiry to read at approval | [ACCOUNTS.md](ACCOUNTS.md) |

## Exit gate

Each bot has a written spec with its numbers and evidence, before code: **met** for carry, trend and regime.
Two items stay open because they need a funded Hyperliquid account: the agent expiry duration and a testnet run.

## Where the evidence disagreed with the Doctrine

1. The trend bot should not short: in every rule family, long/flat beat long/short.
2. Carry is at the low end of the Doctrine's range today and does not clearly beat the HLP benchmark; it is worth
   building as a low-volatility sleeve and for the next euphoria, not as the main earner right now.
3. Sub-accounts are not available at launch.

## Reproduce

```bash
cd research/phase1
python3 fetch_funding.py            # full hourly funding history → data/ (gitignored)
python3 carry.py                    # carry projection → carry_results.json
python3 trend_wf.py                 # trend walk-forward → trend_results.json (needs data/binance_1d.json)
python3 regime.py                   # regime classifier → regime_results.json
```
