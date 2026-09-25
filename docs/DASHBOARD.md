# The dashboard

> **v2 (2026-09-25):** the dashboard was rebuilt as "Mission control". The build spec, including tabs, status states,
> data contract, KV keys and acceptance criteria, is [DASHBOARD_SPEC.md](DASHBOARD_SPEC.md). The front end is split into
> modules under `cloud/ui/` (contract in `cloud/ui/README.md`) that the Worker joins into one script. Tabs are now Now,
> Activity, Positions, Results and Rules; old links redirect. Preview locally with `node cloud/dev/preview.mjs`.
> Known cosmetic follow-ups: a few tap targets under 44 px, light-theme pill contrast, two extra uses of solid magenta.

A private page, modelled on the AiFi dashboard and built from the same design tokens, with one difference
you can see from across the room: the accent is **magenta** where AiFi's is cyan, and the brand mark reads
"Ex". Everything else, the glass panels, the rail, the tabs, the light and dark themes, is shared, so the
two feel like one family.

## Where it lives and how it updates

A Cloudflare Worker (`cloud/worker.js`, free tier) serves the page and reads a JSON bundle from Workers KV.
After every cycle, approval, control action and Sunday review, `scripts/dashboard_push.py` rebuilds the
bundle from `state/` and `config/` and writes it to KV, along with the documents under `docs/`, so the page
is as current as the last run. Password-gated with a 30-day cookie; the password is a Worker secret.

## Tabs

| Tab | What it shows |
|---|---|
| Overview | pot change since start, drawdown and throttle state, open positions and open risk, last cycle status and counts, Bitcoin's regime, one card per book, every name's reading from the last cycle, and what the last cycle did |
| Book | open positions with mark, unrealised, stop and distance to stop, size and leverage; anything waiting for approval; the caps and universe filters in force; the books table |
| Trades | the pot's percent change over time, the record strip (n, win rate, average R, total R, profit factor, R against holding, worst streak, costs), tables by book, tier, trigger and exit reason, every closed trade, earmarked sweeps |
| Refused | why signals were refused, as a bar chart of reasons, and the last 150 refusals with their failed checks |
| Logic | the documents from this repository, rendered, plus the latest Sunday review |

Sizes are shown as percentages of the pot. The dashboard never shows a dollar amount.

## Deploying it, once

Add three repository secrets, `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts and Workers KV Storage
edit rights, the AiFi one works if it has both), `CLOUDFLARE_ACCOUNT_ID`, and `DASHBOARD_PASSWORD` (choose
a long one; it is only ever typed into the login page). Then Actions → **deploy-dashboard** → Run workflow.
The run creates the KV namespace if needed, deploys the Worker, sets the password, pushes the first bundle,
and prints the `workers.dev` address of the page in the deploy step's log. Bookmark it; add it to the phone's
home screen for an app-like view.

Redeploy the same way after any change under `cloud/`. The bundle refreshes on its own every cycle.
