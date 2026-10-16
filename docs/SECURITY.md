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

- **Public** (SproutHouse/AiFi_Executor), a separate repository from the desk: secrets are repository-scoped, so the
  agent key never sits beside the desk's tokens. Being public means every bot's exact rules (`agents/*/settings.json`),
  the lab's shortlist (`factory/factory.json`) and the docs are readable by anyone; once a bot is live its ledger would
  be too. Making the repository private is planned before the first live bot (it needs the dashboard push moved off
  GitHub's minutes first).
- `main` is **not** protected today (no branch protection, no ruleset). Four identities push to it: the server
  (`aifi-host`, `state/` only, hourly), the lab (`aifi-lab`: arena enrolments and `factory/`), the owner (`aifi`) and
  GitHub's runner (`aifi-runner`). Whatever lands on `main` runs on the trading server within the hour (the server
  pulls every 5 minutes), so a token that can push here can run code there. Before the first live bot: a ruleset
  blocking force-push and deletion on `main`; a server-side allow-list of the agents that may trade live, with hard
  size caps, read by `cycle.resolve_mode` from `~/.aifi-host/env` (a push cannot change it); separate Cloudflare tokens
  (KV-only for the hourly jobs, Worker-edit only for deploys, behind an approval); the lab routine pushing only
  `queue/`.
- The one GitHub action used, `actions/checkout`, is pinned to a commit hash (v7.0.1). No third-party
  actions; Python is the runner's system interpreter. The dashboard deploy runs `wrangler` through npx by
  major version; pin it to an exact version before relying on it routinely.
- The account is the trust root: passkey or hardware key for GitHub. Tokens: prefer a fine-grained token
  limited to this repository (Contents write, Workflows write) over a classic token with broad scopes; the
  `workflow` scope is required to push workflow files at all. Never store a token in this repository.
- No auto-commit or sync tooling of any kind in this checkout.

## The trading server (alwaysdata, Paris)

Since 2026-09-30 cycles and orders run on an alwaysdata server (`config/host.json` = `alwaysdata`,
`ops/alwaysdata/tick.sh`, scheduled tasks at :05 hourly and every 5 minutes). Its secrets live in `~/.aifi-host/env`
(chmod 600): the GitHub token `aifi-server` (Contents read/write on this repository only) and, per live agent, its
own agent key. The Cloudflare token is not on the server. Fine-grained GitHub tokens expire (30 days by default):
note the expiry of `aifi-server` and of the lab's `EXECUTOR_TOKEN` and renew them before they lapse; the server
alerts once if it cannot pull or push for an hour.

## The self-hosted runner (older option)

When `RUNNER_LABEL` points at your own server, that server sees the secrets during a job. Keep it dedicated
to this one purpose, inbound firewall closed except SSH with keys, unattended security updates on, the
runner running as its own unprivileged user (the setup script does all of this), and nothing else installed.
Anyone who can push a workflow to this repository can run code on that server, which is one more reason the
account and the branch stay locked down. `runner-watch` stays on GitHub's runners on purpose: it never
touches the exchange and it is what tells you the server went quiet.

## Supply chain

- Paper mode imports nothing outside the Python standard library.
- Live mode installs `hyperliquid-python-sdk` pinned to version 0.24.0, without hashes yet. **Before the first live
  order**, replace `requirements-live.txt` with a fully hash-locked set of the SDK and every transitive
  dependency (`pip download` the pinned set, `pip hash` each wheel, install with `--require-hashes`), and
  review each dependency's release before every version bump.

## Exchange-side controls

Isolated margin per position; leverage at most 3x with the liquidation price at least twice the stop
distance away; every stop resident on the exchange, reduce-only, on the mark price; every close reduce-only;
client order ids on every order; caps on open risk, gross exposure and position count.

## Kill switches

`control → halt` writes `state/HALT`, which is tracked by git and committed by the run, so it survives a
fresh checkout; `control → resume` deletes it. `control → flatten` closes everything and sets it. The
executor also sets it by itself in one case: a live fill whose stop could not be placed and whose close
then failed, so you are paged to intervene. Revoking the agent key from the master wallet remains the hard
stop that needs no code at all.

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

## The alwaysdata host (2026-09-30)

When `config/host.json` says `alwaysdata`, the cycle runs on a shared-hosting account in Paris, and live agents'
API keys sit in `~/.aifi-host/env` there (chmod 600, never in the repo, never printed).

**What that means:**
- **The host could, in principle, read that file.** That is accepted because an API (agent) wallet can trade but can never withdraw, move funds or change the account; each live agent has its own wallet holding only its own pot; and the master keys never leave the owner.
- **The server's GitHub token is narrow:** Contents on AiFi_Executor only, so it cannot touch the lab or any other repo.
- **The Cloudflare token stays on GitHub.**

**If the host is ever suspected compromised:**
1. Revoke each agent's API wallet in Hyperliquid.
2. Revoke the `aifi-server` token.
3. Set `config/host.json` back to `github`.

