# Accounts and keys — findings (Phase 1, 2026-09-26)

_From Hyperliquid's official documentation (sub-accounts, nonces and API wallets, fees). A testnet session was not
possible: testnet access requires a funded mainnet account, which only the owner can create._

| Question | Finding | Consequence |
|---|---|---|
| Sub-account per bot (the Doctrine's design) | "Up to 10 sub-accounts can be created after reaching $100,000 in volume" | **Not available at launch.** Each live bot gets its own master wallet until volume unlocks sub-accounts, as the executor's agents are already built. Migrate later. |
| API (agent) wallets | 3 per master account, +2 per sub-account | One named agent per bot fits inside one master per bot |
| Agent scope | "A master account can approve API wallets to sign on behalf of the master account or any of the sub-accounts" | Agents are not scoped. With one master per bot this is moot; after migrating to sub-accounts, the per-bot universe watchdog becomes necessary |
| Agent expiry | Agents expire and are pruned; the duration is not stated in the docs | Read the expiry shown on the approval screen when each agent is created; Phase 2 builds a rotation reminder that fires 14 days before it |
| Reusing an agent address | "strongly suggested to not reuse their addresses" | Rotation always creates a fresh agent |
| Nonces | tracked per signer | One agent per bot, never shared (already the design) |
| Fees, base tier | perps 0.015% maker / 0.045% taker; spot 0.040% maker / 0.070% taker | Carry round trip, both legs: 0.11% maker, 0.23% taker |
| Sub-account fees | share the master's fee tier; referral discounts do not apply | — |

Still to confirm on testnet once an account exists: the agent expiry duration, and whether an agent approved on one
master can be restricted in any way.
