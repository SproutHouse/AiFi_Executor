# Security — keys, secrets, repository, incidents

## Threat model

What can go wrong: the agent key leaks; the repository or the GitHub account is compromised; a dependency
is poisoned; the bot's view of the book diverges from the exchange; the bot is offline while a position is
open; a bad price feed sizes or triggers a trade. Each has a control below.

## Keys

| Key | Where it lives | What it can do |
|---|---|---|
| Master wallet | hardware wallet or cold key, never on any machine that runs this code | everything, including withdrawals and approving or revoking agents |
| Agent key | GitHub Actions secret `HL_AGENT_KEY` only | place, modify and cancel orders. Cannot withdraw, transfer, or approve other agents |
| Account address | GitHub Actions secret `HL_ACCOUNT_ADDRESS` | public; used to read state |

Rules: approve exactly one named agent for this executor; verify the agent's address on the signing screen
before approving; `scripts/verify_keys.py` refuses to proceed if the key given is the master; rotate the
agent every quarter; revoking the agent from the master is the hard kill switch.

## Secrets

Repository secrets only, never environment or organisation secrets shared with other repositories. Never in
files, never in logs; GitHub masks exact matches, so the code never prints keys or signatures. Notifications
carry percentages of the pot, never dollar amounts, because the ntfy topic is only as private as its name.

## Repository

- Private, under the same account as AiFi but a separate repository: secrets are repository-scoped, so the
  agent key never sits beside the desk's tokens or its auto-commit tooling.
- Branch protection on `main`; only the owner pushes; the runner commits `state/` with its own identity.
- Actions pinned to commit hashes (`actions/checkout` v7.0.1, `actions/setup-python` v7.0.0). No third-party
  actions.
- The account is the trust root: passkey or hardware key for GitHub, no shared personal access tokens.
- No auto-commit or sync tooling of any kind in this checkout.

## Supply chain

- Paper mode imports nothing outside the Python standard library.
- Live mode installs `hyperliquid-python-sdk` pinned to 0.24.0 with its wheel hash. **Before the first live
  order**, replace `requirements-live.txt` with a fully hash-locked set of the SDK and every transitive
  dependency (`pip download` the pinned set, `pip hash` each wheel, install with `--require-hashes`), and
  review each dependency's release before every version bump.

## Exchange-side controls

Isolated margin per position; leverage at most 3x with the liquidation price at least twice the stop
distance away; every stop resident on the exchange, reduce-only, on the mark price; every close reduce-only;
client order ids on every order; caps on open risk, gross exposure and position count.

## Operational controls

Approvals, halts and flattening go through GitHub workflows from the GitHub mobile app behind two-factor.
There is deliberately no chat-bot control plane: a Telegram bot that can pause or resume a key-holding
process is attack surface for no gain. Alerts are one-way.

## If you suspect a leak

1. From the master wallet, revoke the agent. Orders from the leaked key now fail.
2. Run `control → flatten` if any position is open, or close positions from the exchange UI.
3. Rotate: approve a new agent, replace `HL_AGENT_KEY`, run `scripts/verify_keys.py`.
4. Check the account's fills for anything the ledger does not know, and record what happened in
   `docs/DECISIONS.md`.
