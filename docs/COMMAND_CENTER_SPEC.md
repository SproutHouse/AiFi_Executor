# AiFi Executor Command Center: final build spec

_The synthesis of the three judged designs. The backbone is **Pragmatic-builder**, which scored highest on every panel (7.8 / 8.0 / 8.0). From **Operator-first** it takes the command-center layer: the fleet verdict, the Needs-you rail, the fleet log, the bead heartbeat and the stuck-carry alert. From **Portfolio-manager-first** it takes stable tile order, plain win/loss words, the carry "too early" grace, ETag caching, the one-write-per-job fleet step and the FLEET_HALT sync. It resolves every must-fix item from all three panels._

_All facts below were checked against the repo at `c6a72c3`: `cloud/ui/core.js`, `cloud/worker.js`, `scripts/dashboard_push.py`, `scripts/run_agents.py`, `.github/workflows/dashboard-sync.yml`, `tests/client_join_check.mjs`, `state/agents/carry-1h/positions_paper.json`, the `runs/last_run.json` files, and `cloud/dev/kv.json` (snapshot `exec:agents.gen = 2026-10-01T06:42:54Z`). Example times are in the phone's zone (America/Toronto, EDT), so the snapshot moment is **Thu Oct 1, 2:42 am**._

---

## 1. Goal and principles

**Goal.** Opening the dashboard lands on a **Command Center**:
- One glass header answers three questions in about three seconds: *is anything wrong, what just happened, when is the next check?*
- Below it, every bot is a large tile.
- Tapping a tile opens that bot's own page. Its first screen answers *how is it doing, what did it trade, how often, did it win or lose?*
- The owner is not a developer, so the page uses plain words, big numbers, and status that is obvious at a glance on a phone and on a laptop.

**Binding principles.** These are DASHBOARD_SPEC §1, restated. Every element below obeys them.
1. **Honest motion.** Something moves only because the real clock moved, a recorded check arrived, or the owner acted. There is no shimmer, no idle loop except the `.bg` drift, and no reordering of tiles the owner did not ask for. Under `prefers-reduced-motion`, everything is instant.
2. **Words first.** Every state is a word. Colour and glyph support the word. `aria-label`s carry the words for dense cells such as beads and sparklines.
3. **Only R and % of pot.** No money amounts anywhere. Coin prices appear only in sheets, captioned "market price, not your money". New KV keys are ratios, R, counts, ids or times only.
4. **Phone local time**, relative first ("3:15 am · in 32 m"). UTC appears only as a muted secondary where the bar schedule matters.
5. **One state vocabulary.** There is one status engine, core `status()`, used for the tile, the capsule, the Needs-you rail and the bot page.
6. **Magenta rule.** Solid magenta means *the bot acted* or *the clock*. Tint means *could act next*. A 1px outline or text means *identity*. Green, amber and red mean health only and always travel with a word. Violet means PAPER only.
7. **Glow rule.** Exactly one glowing element per page: the fleet verdict pill on the master, the bot verdict pill on a bot page.
8. **Missing is never zero.** A missing value renders "—" (muted "not in this data", or "after its next check" for old rows). A missing throttle reads "unknown".
9. **Never infer by absence without saying so.** Any fallback inference is labelled as one.

---

## 2. Routes and navigation

### 2.1 Pages

The Worker route and app shell stay the same. The Worker renders one of two shells, chosen by the presence of `?a`.

| URL | Page | Shell `data-view` | Data loaded |
|---|---|---|---|
| `/` (no `a`) | **Command Center** (master, landing page) | `fleet` | `/api/agents` (exec:agents) + `/api/factory` (exec:factory). No per-bot bundle. |
| `/?a=<id>` | **Bot page** | `bot` | `/api/latest?a=`, `/api/stamp?a=`, `/api/ledger?a=` (lazy), `/api/agents` (roster, prev/next, row extras), `/api/factory` (arena bots and fleet share) |
| `/?a=core` | Core's bot page; the Worker still maps `core` to the `exec:latest`, `exec:ledger` and `exec:stamp` keys | `bot` | as above |
| `/doc/<slug>` | Unchanged. The "Dashboard" button now points to `/` | none | none |

- No new API route and no new KV key.
- `/` with an invalid `a` (failing `/^[a-z][a-z0-9-]{1,23}$/`) answers a 302 to `/`.

### 2.2 Bot page tabs and anchors

| Key | Tab hash | Label | Module | Notes |
|---|---|---|---|---|
| 1 | `#overview` (default) | Overview | **new `ui/bot.js`** (C) | Anchors: `overview-hero`, `overview-record`, `overview-traded`, `overview-pace`, `overview-holding`, `overview-equity`, `overview-health`, `overview-gaterun`, `overview-ondeck`, `overview-strategy` |
| 2 | `#results` | **Trades** | results.js, package C: kind-aware (a collector's verdict is its capture gate, its trades and sheet are in % of capital, never R; a rebalancer's verdict is the yearly line; neither shows the R record or R-per-trade cards; with no R line the curve opens on Pot %) | Existing anchors `results-verdict\|curve\|record\|r\|trades\|review\|sweeps` |
| 3 | `#activity` | Activity | activity.js | Signal bots: as today. Target and carry bots: timeline only (funnel, signals, tape and readings hidden); its chips are All · "Trades & rebalances" (bought, sold, trail, resized) or "Carry actions" (carry_in, carry_out, carry_closed, carry_fix) · Health, and no check header says "no signals" |
| 4 | `#rules/<doc>` | Rules | rules.js, package C: "In force" is kind-aware (target: Holds / Exits / Judged from `cfg.target` and `L.tw`; carry: Opens / Exits / Coins / Judged from `cfg.carry`; each with its own `cfg.checks` list) | |

### 2.3 Old tabs and sheets

| Old | New |
|---|---|
| **Now** tab | Removed as a route. `#now` → `#overview`. Its jobs move to the Overview hero, Wins & losses, What it traded, and the Health disclosures. now.js shrinks to `COMP.onDeck` only. |
| **Positions** tab | Removed as a route. `#positions` and `#book` → `#overview/holding`. Position cards are reused in Overview › Holding now (`COMP.positionCard`). |
| **Results** tab | Kept, relabelled **Trades**. `#trades` → `#results`. |
| **Activity** tab | Kept. `#refused` → `#activity/signals`. Kind-aware (signal bots only show funnel, signals, tape and readings). |
| **Rules** tab | Kept. `#logic/x` → `#rules/x`. |
| The `overview → now` redirect in core `REDIRECT` | **Deleted.** `overview` is now a real tab. |
| `#agentbtn`, `SHEETS.agents` (compare table), the `ex.agent` auto-home | **Deleted.** The master replaces them. `switchAgent(id)` stays as a shim, `location.href = botHref(id)`, because factory.js "Open" calls it. It never writes `ex.agent`. |
| Dial (dial.js + dial.css) | **Deleted.** Its 6-beads-a-day geometry is wrong for 1h and 1d bots; the heartbeat strip replaces it. |
| Sheets `pos`, `trade`, `name`, `cycle`, `health` | Kept as they are. |
| Sheets `shortlist`, `fleet` | Kept. Opened from the master Lab strip and from an arena bot's Strategy section. |
| New sheet `fleethealth` (B, fleet.js) | Opened by the master capsule: every bot's `status().items`, grouped bad, then warn, then info, each with "Open bot ›". |

### 2.4 Movement

**Master → bot**
- Each tile is one `<a class="fl-tile" href="/?a=<id>">`, a single tap target with no nested buttons. Long-press or cmd-click opens it in a new tab.
- On click, fleet.js writes these sessionStorage keys, each in try/catch:
  - `ex.fl.from='1'`
  - `ex.fl.y=<scrollY>`
  - `ex.fl.last=<id>`
- It then sets `style.viewTransitionName='bot-hero'` **on the tapped tile only**, and navigates as a **full page load**. This keeps core's documented isolation rule: no module cache carries one bot's numbers into another.

**Bot → master**
- The topbar starts with "‹ All bots" (`a#back[data-back] href="/"`). Core's click handler calls `goFleet()`:
  - If `sessionStorage['ex.fl.from']==='1'`, it removes the flag and calls `history.back()`. The bfcache restores the master with its scroll position.
  - Otherwise it does `location.href='/'`.
- Esc (when no sheet or tip is open) and the Ex mark do the same.
- `document.referrer` is never used: worker.js sends `referrer-policy: no-referrer`.

**Back must mean "All bots"**
- On bot pages, core turns every same-page hash navigation into `history.replaceState` + `route()`. This covers tab links, `[data-tab]`, status-item act links and in-page anchors.
- So tab switching adds no history entries, and both the browser Back button and `history.back()` return to the fleet.

**Bot → bot**
- ‹ › arrows in the Overview hero ("Fast · 3 of 6"), plus the `[` and `]` keys on desktop.
- They use `location.replace(botHref(id, location.hash))`, so Back still returns to the fleet.
- The order is `exec:agents.order`.
- On desktop, the rail on a bot page also shows the mini roster (status dot + name links). A roster link, and any other
  `a[href^="/?a="]` or `switchAgent()` on a bot page, also uses `location.replace`, so Back still returns to the fleet.

**Master → bot.** Every way into a bot from the master (tile, Needs-you row, fleet log row, rail roster, a sheet's "Open
bot ›") sets `ex.fl.from = '1'`, `ex.fl.y` and `ex.fl.last` (one document-level click handler), so "All bots" is
`history.back()` to the same scroll for each of them.

**Restoring the master**
- If the master loads fresh (not from bfcache) and `ex.fl.y` exists, it jumps there after its first render.
- In both cases (fresh load or bfcache), the `ex.fl.last` tile gets a one-time 1.2 s `--accent-line` outline (identity tier). The keys are then cleared.

**Caching**
- The app HTML moves from `no-store` to `cache-control: private, no-cache` plus an `ETag`. The ETag is the sha-256 of the page per shell, computed once per isolate.
- `If-None-Match` answers 304 **after** the auth check.
- `/api/*`, login, setup and doc pages stay `no-store`.

**View transition (optional, where supported)**
- fleet.css carries:
  - `@view-transition{navigation:auto}`
  - `@media (prefers-reduced-motion: reduce){@view-transition{navigation:none}}`
- bot.css gives `.bt-hero` `view-transition-name:bot-hero`.
- Browsers without support navigate instantly.

### 2.5 Deep links and legacy links

- **Legacy hash on `/`.** Before boot, core rewrites `/#<old>` with `location.replace('/?a=' + (valid lsGet('ex.agent') || 'core') + '#' + mapped)`. The map:

  | Old hash | New hash |
  |---|---|
  | `now`, `overview` | `overview` |
  | `positions`, `book` | `overview/holding` |
  | `results`, `trades` | `results` |
  | `refused` | `activity/signals` |
  | `activity` | `activity` |
  | `logic/x`, `rules/x` | `rules/x` |

  Old bookmarks and alert links therefore keep working. `ex.agent` is read for this one redirect and never written again.
- `/?a=<id>#overview/holding` (and any anchor in 2.2) scrolls via the existing `route()` and `holdAnchor`.
- Fleet log rows link to `/?a=<id>#activity/timeline`.
- `#overview/gaterun` and `#overview/ondeck` open their disclosures (C, `hook('route')`).

### 2.6 Keys

- **Master:** Tab moves through the tiles in visual order; Enter opens one.
- **Bot page:**
  - 1–4 switch tabs.
  - `[` and `]` go to the previous or next bot.
  - Esc returns to the fleet.
- No key fires while focus is in a field or a modifier is held.

---

## 3. Master page: Command Center

The module is `ui/fleet.js` + `fleet.css`, prefix `fl-`, owned by B. It renders `VIEWS.fleet` into `#view`.
- Notation: **A** = a row of `exec:agents.agents[]`; **E** = the `exec:agents` envelope; **X** = `exec:factory`.
- Example values are the 06:42Z snapshot at 2:42 am.

### 3.0 Topbar (sticky glass, 52px)

Contents: `[Ex mark → /] [h1#ttl "Command center" (visually hidden ≤640px)] [#capsule] [#modepill "6 paper"] [theme]`.

**The capsule** is the only `aria-live` region. It shows the worst fleet level:

| Fleet level | Capsule text |
|---|---|
| ok | "All clear" + "checked 39 min ago" (the newest row's `last_t`) |
| mute (no row on schedule: every enabled row is v1) | "Waiting" + "checked … ago" · wide "schedule after the next check"; "No bots yet" with no rows. The verdict pill is the non-glowing `.pill.big.mute` "Waiting" |
| info | "Due" |
| warn | "1 to check · Carry" |
| bad | "1 needs you" |
| offline | "Offline · last seen 2:42 am" |

- Tapping the capsule opens `SHEETS.fleethealth`.
- The mode pill reads "6 paper", or "2 live · 4 paper", from `A.mode`.
- There is no tabbar on the master. The rail (≥641px) holds: brand, "Command center" (current), `#roster` (dot + name + short status word), "Rules & docs" (→ `/doc/how_it_works`), `#railstat`, and Log out.

### 3.1 Alert rail (`#alerts`)

Shown only when relevant.

| When | Level | Text |
|---|---|---|
| `E.fleet.halt` | bad | "Fleet halted since {since}: {reason}. No bot buys; exits still run." with "How to resume ›" (control workflow link) |
| Every row's status phase is late or stale **and** (`E.host.t` is missing or older than 2 h) | bad | "Runner down? No bot has checked in since {newest last_t}; the Paris server's last tick was {host.t}." |
| Offline after load | info | "Offline · showing 2:42 am" |

### 3.2 Fleet header (one glass card `section.fl-head`)

**(a) Verdict.** The only glowing element on the page.
- `.pill.big` word, computed from the worst `status(rowBundle(A))` level:
  - **All clear** (ok)
  - **Due** (info)
  - **Watch** (warn)
  - **Needs you** (bad)
- A one-sentence explanation follows, worst first. Bot names link to their tiles. Examples:
  - "All clear · 6 of 6 bots on schedule."
  - "Needs you · Trend: exits not checked since 10:06 pm."
  - "Watch · Carry: ZEC legs out of balance since 12:07 am, past the 3 h safety limit."

**(b) Four KPI cells.** Value in IBM Plex Mono at `--fs-xl`, with a muted sub-line. Four across on desktop, 2×2 on phone. All sums are client-side.

| Cell | Value (snapshot) | Sub-line | Source |
|---|---|---|---|
| **Bots** | "6 of 6 OK" | "0 late · 0 failed · 0 halted" | Count of rows whose status lvl ∈ {ok, info}. The sub-line splits the other rows so it adds up to (total − OK): late = `k` ∈ late_now / stale / exits (a late daily bot holding positions reads "Exits unchecked"), failed, halted = halt / thr_halt; then " · n waiting" (v1 rows) and " · n other" only when non-zero |
| **Last 24 h** | "62 of 62" | "checks on time · 23 signals · 0 bought · 1 sold" | On time / slots are counted on the same extended beat the strips draw (`COMP.beat24`: the pushed `A.beat` plus "-" for every close past its late limit since, beads whose close is within the last 24 h, `.` not counted); raw `A.last24` only for a row without a beat. So a stalled runner shows "36 of 62" after 10 h and "0 of 62" after a day, never a frozen "62 of 62". Signals / bought / sold stay Σ `A.last24`, with " · as of {oldest late row's last_t}" when any reporting row is late or stale. Checked at push time: 62 of 62 |
| **Open** | "6 · 6" | "positions · carry pairs · in 4 bots" | Σ `A.n_open` over rows with `A.kind` not carry (Fast 1 + Trend 2 + A01 3); Σ `A.carry.pairs` over carry rows; count of rows with `n_open>0`. Positions and pairs are never summed together; a row without `kind` (v1) is in neither and the sub-line adds "n of m bots reporting". |

KPI values are numbers only, one line (`white-space: nowrap`); the words sit in the sub-line.
| **Fleet (paper)** | "−0.17%" | "drawdown 0.78% · lab, as of 12:44 am" | `X.fleet.totals.paper.ret_pct` and `.dd_pct`, dated by **`X.gen`**. "—" plus "the lab hasn't published" when absent. Never computed on the client. A live total joins only when `X.fleet.totals.live` exists. |

**(c) Switch row.** Small pills that **wrap** onto a second line and never scroll sideways, so on phone they stay above the fold.

| Pill | Wording and level | Source |
|---|---|---|
| Kill switch | "Fleet running" (good), or "Fleet halted" (bad). Missing → "Kill switch —" (muted) | `E.fleet.halt` |
| Market | "Market: bull since Aug 24 · lab" (good/warn/bad as `factory.js regimeLine`) | `X.regime.now` and `.since` |
| Server | "Paris server · last tick 2:07 am" (good). Warn when `now − host.t > 75 min` ("no tick for 2 h") or `fails == 1`. Bad when `fails ≥ 2` ("2 failed runs in a row") | `E.host.name` (`alwaysdata` → "Paris server", `github` → "GitHub runner"), `E.host.t`, `E.host.fails`, `E.host.ok` |
| Next check | "Next check: Fast ≈ 3:15 am · in 32:41" | Minimum over rows of `clock(rowBundle(A)).next`. This is **the only per-second ticker on the master** (`every1s`). |

### 3.3 Needs-you rail (renders only when non-empty)

- One compact row per item, worst first: `[dot] <Bot> · <status item sentence> · Open ›` (→ `/?a=<id>#overview`).
- Items, in this order:
  1. every `status(rowBundle(A)).items` entry with lvl bad or warn, using the exact sentences the bot page shows (one truth);
  2. info "Decision for you: A01 Rotation is ready to go live ›" when `X.shortlist[].ready`.
- At most 4 rows, then "and N more ›", which opens `SHEETS.fleethealth`.
- The snapshot renders **no rail**: there are no bad or warn items, and Carry's stuck legs are within the engine's 3 h limit, so they are info (§4, §5).

### 3.4 Controls row

- **Sort** (`.seg.quiet`):
  - **Roster** (default; `E.order` = agents/index.json order)
  - **Needs attention**: level rank bad < warn < info < ok, then live before paper, then roster
  - **Return**: `A.pot_chg_pct` descending; missing goes last, never treated as 0
  - **Most active**: `A.last24.bought + .sold`, then `A.recent.length`
- **Filter chips** with counts appear only with **≥ 7 bots**:
  - "All · Signal traders · Rebalancers · Funding collectors · Live · Arena"
  - Chips with a count of 0 are hidden.
- A **Compact** toggle appears with **≥ 9 bots**. Compact is the default on phones at ≥ 9 bots.
- Choices persist in localStorage `ex.fl.sort`, `ex.fl.f`, `ex.fl.dense` (via lsGet/lsSet).
- **Tiles never reorder while visible.** Order is computed on load, on return to visible, and on an owner sort or filter change. Arrivals update tiles in place.

### 3.5 Tile grid

- `display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr)); gap:var(--s4); align-items:stretch`.
- Columns:
  - 1 at ≤ 640px;
  - 2 at 641–1099px;
  - 3 at ≥ 1100px (inside the 1360px wrap with the 232px rail).
- Retired rows (`A.enabled===false`) sit in a closed `details` "Retired (n)" below the grid. Muted tiles there show the word "Retired".
- Roster ids in `E.order` that have no row render a muted tile: "Waiting for its first check".

### 3.6 Fleet log: "What just happened"

- Merged from every `A.recent`, newest first, 10 rows. Desktop shows two columns below the grid; phone shows one.
- Each row: `[bot name chip] [fmt.when(t)] [word.event(row) sentence]`. Examples:
  - "Fast · 1:05 am · Stop raised on CRV, locks +0.38 R"
  - "Carry · Wed 12:19 pm · Started closing HYPE carry · funding −0.2%/yr"
  - "Fast · Wed 10:17 am · Sold AVAX −0.20 R (stop)"
- Consecutive `trail` rows for the same bot and coin collapse into one: "CRV stop raised 3× since 11:05 pm, locks +0.38 R".
- Trade-type rows get the solid accent dot; health rows get neutral dots.
- **Since you last looked.**
  - localStorage `ex.fl.seen` = the newest `t` shown, written after the master has been visible for 5 s.
  - A thin "new" divider marks the boundary.
  - A one-line digest sits above: "Since 11:38 pm: 1 stop raised (CRV) · nothing bought or sold".
  - If a bot's oldest kept `recent` row is still newer than `ex.fl.seen`, its count reads "3+".
- Empty: "Nothing traded in the last week."

### 3.7 Lab strip (one line)

- "AiFi Lab · 24 recipes tried · 2 survived · 1 in the arena · 0 ready for you".
- Sources: `X.lab.tried`, `X.lab.survivors`, `X.shortlist.length`, the count of `X.shortlist[].ready`.
- Buttons `[Shortlist]` `[Fleet split]` open the existing `SHEETS.shortlist` and `SHEETS.fleet`.

### 3.8 Footer

The existing FOOT sentence, then "Rules & docs · Log out".

### 3.9 States

| State | Rendering |
|---|---|
| **Loading** | Header with "—" values, plus N static placeholder tiles reading "Loading…" (N = `lsGet('ex.fl.n', 6)`). No shimmer. |
| **Empty** (`agents: []` or 404) | One card: "No bot has reported yet. Each bot appears here after its first check." No header, no KPI zeros; the Lab strip (`#fl-labw`) stays below it. |
| **Fetch errors** | The existing `bootCard`s: 401 "Signed out" + Sign in; network "Can't reach the dashboard" + Retry; 5xx or parse "The fleet data couldn't be read" + Retry. |
| **Offline after load** | Tiles keep their data. The capsule reads "Offline · last seen 2:42 am". The 30 s tick keeps recomputing status, so tiles honestly turn Late or Stale. |
| **Stale tile** | The status line reads "Stale · no check for 9 h" in red. The tile gets a 3px inset `--bad` left edge and a 1px `--bad` border. The caption adds "as of Tue 4:05 pm". Numbers dim to 60%. |
| **Failed / Halted / Buying stopped / Exits unchecked** | The status word comes from `status()` (bad tier styling). The problem sentence replaces the age text. |
| **Due** | Accent dot, the word "Due now · usually by 3:24 am". No animation. |
| **Paper / live** | `A.mode`: `.pill.pt` "Paper" (violet), or "Live" (1px accent outline + static dot). If `sb.mode.req ≠ eff`: amber pill "Paper (live requested)". |
| **Fleet halted** | Banner (3.1). `rowBundle` forces `state.halt` from `E.fleet`, so every tile reads "Halted". |
| **Retired** | §3.5. |
| **Old (v1) row** | No `A.sb`: the status line reads info "Checked 40 min ago · schedule after its next check". Never "On schedule". `A.halt===true` → "Halted", `A.failed===true` → "Failed" (v1 booleans). Missing cells show "—", and the heartbeat reads "heartbeat after its next check". |
| **Filter matches nothing** | "No bot matches 'Live'. Show all ›" |

### 3.10 Refresh

- Poll `/api/agents` (one KV read):
  - every **60 s** while any row's clock is in `[next − 5 min, lateAt + 10 min]`;
  - otherwise every **300 s**;
  - never while hidden;
  - immediately on `visibilitychange` to visible and on `pageshow`;
  - backing off to 5 min after 3 errors.
- `/api/factory` goes through `loadFactory()`, cached for 5 min.
- The 30 s tick recomputes every tile status and every `[data-ago]`.

---

## 4. Tile anatomy

The tile (`a.fl-tile`) is about **236 px** tall on phone, at most 7 rows.
- Surface `--glass`, 1px `--line` border, `--r` radius, **no `backdrop-filter`** (blur budget).
- Padding 16px (14px ≤ 360px).
- Elements are listed in priority order. NEW fields come from package A (§6.3).

| # | Element | Content (snapshot example) | Exact source |
|---|---|---|---|
| 1 | **Name + type** (row 1) | **Fast** · `Signal trader · hourly` chip · `Paper` pill (right) | `A.name`. Type = `word.kindName(A.kind, A.bar_s)`: flip → "Signal trader", target → "Rebalancer", carry → "Funding collector"; bar → "hourly" / "every 4 h" / "daily". Arena adds " · Arena day 2 of 42" (`A.arena` + `X.shortlist[agent==A.id].days`, rounded down to a whole day). Mode pill from `A.mode` / `A.sb.mode`. |
| 2 | **Status line** (dominant) | `●` **On schedule** · checked 37 min ago · next ≈ 3:15 am | Word, dot and level from **core `status(rowBundle(A))`** (§6.6), never a second engine. Age is a `data-ago` span on `A.sb.clock.last_t`. "next ≈" = `fmt.time(clock(rowBundle(A)).next)`. Warn/bad: the age is replaced by `status().wide` ("· no check for the 3:00 am close"), wrapping to 2 lines at most. |
| 3 | **Big number + sparkline** | **−0.15%** (`--fs-2xl` mono, sign always shown, `fmt.cls` colour; exactly 0 is neutral "0.00% · flat"). Caption "since Sep 26" (+ " · this week −x%" only when `now − A.since ≥ 7 d`). Sparkline right, about 140×40. | `A.pot_chg_pct` (v1), `A.since` (NEW), `A.wk_pct` (NEW), `A.spark` + `A.spark_t` (NEW) → `COMP.sparkSvg`. aria-label "Pot over the last 24 checks, from +0.10% to −0.15%". Fewer than 2 points: "line appears after two checks". Missing → "—". |
| 4 | **Three plain stats** (by kind) | see the table below | NEW and v1 fields as listed |
| 5 | **Heartbeat strip** | 24 beads (hourly) / 18 (4 h = 3 days) / 14 (daily = 2 weeks), plus a hollow accent "next" bead; right-aligned "24/24" with a `title` carrying the strip's aria-label (what the count means) | `A.beat {s0,n,k}` (NEW) → `COMP.beatStrip`. Alphabet in §6.1. aria-label "Last 24 hourly checks: 24 on time, 1 with a trade; next about 3:15 am". Grid `repeat(n+1, minmax(0,12px))`, gap 3px, so 25 beads fit the 311px inner width at 375px (about 9.5px each). |
| 6 | **Last trade in words** | `●` Sold AVAX −0.20 R · Wed 10:17 am | `A.act` (NEW). Verbs: `bought` "Bought", `sold` "Sold … R", `resized` "Resized BTC to 48% of pot", `carry_in` "Started collecting on PUMP", `carry_out` "Started closing HYPE", `carry_closed` "Closed HYPE carry · +0.12% of capital". Solid accent dot when `now − act.t < 24 h`, else ink-2. "No trades yet" **only** when `A.act === null` **and** `A.sb` exists. A v1 row shows "—". |
| 7 | **Problem line** (warn/bad only) | "ZEC: legs out of balance since 12:07 am, past the 3 h safety limit." | The head item's sentence from `status()`. For info-level carry notes, see the carry cell sub-line instead. |

**Stats per kind (row 4).** Value at `--fs-md`/650 mono; label at `--fs-xs` muted.

| Kind | Cell 1 | Cell 2 | Cell 3 |
|---|---|---|---|
| **Signal trader** (core, wide, fast) | **Trades** "4" · sub "closed" (`A.rec.n`) | **Won** "1 of 4" · sub "3 lost" (`A.rec.w`, `A.rec.l`; "—" when n = 0) | **Holding** "1 coin" · sub "+0.72 R open" (`A.n_open`, `A.rec.open_R`; "Nothing" when 0) |
| **Rebalancer** (trend, arena) | **Holding** "BTC, ETH" (`A.held`); with 3 or more coins the value is "3 coins" and the tickers (first 3 + "+n") are its caption, since three tickers never fit a 98px cell | **Invested** "68% of pot" (`A.deployed_pct`) | **Closed trades** "0" · sub "judged yearly" (Trend) / "day 2 of 42" (arena) (`A.rec.n`) |
| **Funding collector** (carry) | **Pairs** "6" · sub "1 closing · 2 evening legs" (`A.carry.pairs`, `.exiting`, `.stuck`) | **Funding kept** "34%" · sub "of what it could earn · too early" (`A.carry.capture_pct`; "too early" while `now − A.since < 14 d`; after that amber text "below 80% gate" when under `A.carry.gate_pct`) | **Capital in use** "138%" · sub "of pot" (`A.carry.cap_pct`) |

**Never on a tile:**
- On deck counts, blocked-signal detail, per-tile countdowns, backtest sub-lines, "% at risk", slot counts.
- R for carry, profit factor, tips.

**Accessible name.** The tile's `aria-label` is a sentence, for example: "Fast, signal trader, hourly, paper. On schedule, checked 37 minutes ago, next about 3:15 am. Pot down 0.15% since September 26. 4 trades, 1 won, 3 lost. Last: sold AVAX, minus 0.20 R."

**Compact tile** (≥ 9 bots or toggle): 64px, one line.
- `[dot] Name · status word · pot % · last trade (ellipsis)`.
- On ≥ 641px it adds a 24-bead micro strip.

**Snapshot tiles (sanity reference)**

| Tile | Big number | Stats | Last trade |
|---|---|---|---|
| Core | 0.00% flat | Trades 0 · Won — · Holding Nothing | "No trades yet" |
| Wide | 0.00% flat | Trades 0 · Won — · Holding Nothing | "No trades yet" |
| Fast | −0.15% | Trades 4 · Won 1 of 4 · Holding 1 coin, +0.72 R | Sold AVAX −0.20 R · Wed 10:17 am |
| Trend | −0.35% | Holding BTC, ETH · Invested 68% (67.7) · 0 closed | Bought BTC, ETH · Sat 8:22 pm |
| Carry | −1.11% | Pairs 6 · Funding kept 34% · Capital in use 138% | Started closing HYPE · Wed 12:19 pm |
| A01 Rotation | +0.50% | Holding LTC, NEAR, UNI · Invested 26% · 0 closed | Bought LTC, NEAR, UNI · Tue 8:23 pm |

All six tiles read **On schedule**. Next checks:

| Bot | Next check |
|---|---|
| Core, Wide | ≈ 4:17 am / 4:16 am |
| Fast | ≈ 3:15 am |
| Carry | ≈ 3:16 am |
| Trend | ≈ 9:15 pm |
| A01 | ≈ 9:11 pm |

---

## 5. Bot detail page (`/?a=<id>`, `VIEWS.overview`, package C)

**Sources**
- **L** = `S.b` (`exec:<id>:latest`).
- **G** = `S.ledger` (via `loadLedger()`; sections that need it show "Loading trades…" and redraw when it lands).
- **A** = `rowOf(AGENT)`.
- **X** = `loadFactory()`.
- Every section is wrapped in core `safe()`, so one bad field draws one small card.

**Layout**
- Phone: one column, in the order below.
- Desktop (≥ 1100px): the hero full width, then left column (Wins & losses, What it traded, How often) and right column (Holding now, Equity, Health, Strategy).
- The first scroll answers the owner's three questions: wins and losses, what it traded, how often.

### 5.0 Topbar (B's shell)

`[‹ All bots] [h1#ttl = bot name] [#capsule = this bot's status()] [#modepill] [theme]`.
- The per-bot alert rail `#alerts` stays. It shows bad items and the paper fallback on every tab, and warn items on Overview.

### 5.1 Hero (`#overview-hero`, `.bt-hero`, view-transition target)

1. **Identity.**
   - Type chip `word.kindName(kindOf(L), barOf(L))`.
   - `A.desc` in ink-2 (two lines, "more" disclosure). `desc` is written for the owner: one or two plain sentences on what the bot does and how it is judged, no engine terms (docs/AGENTS.md step 3).
   - ‹ prev · "3 of 6" · next › (`AGENTS` order).
2. **Verdict.** `S.st.word` as the one glowing pill, then `S.st.sentence`.
3. **Schedule line.** "Last check 2:05 am · 6 min after the hourly close · next ≈ 3:15 am (in 32 m)".
   - Sources: `L.clock.last_t`, `L.state.last.late_min`, `word.bar()`, `clock().next`, `fmt.rel`.
4. **Big number.** `fmt.pct(L.pot.chg_pct)` at `--fs-3xl`, "since Sat Sep 26 · 5 days" (`L.pot.since`).
   - "This week" appears only when `now − L.pot.since ≥ 7 d`.
   - **Signal bots** get a second number: `fmt.R(L.rec.tot_R)` with "closed −0.86 R · open +0.72 R" (`L.rec.closed_R`, `L.rec.open_R`), plus a `tip('R')`, the one place R is explained ("1 R = what the bot planned to risk on a trade, about 1% of the pot").
   - It shows "—" when `L.rec.n==0` and no position is open.
5. **Sparkline.** `COMP.sparkSvg(L.pot.spark values)`. A tap goes to `#results/curve`.
6. **Heartbeat.** `COMP.beatStrip(L.beat || A.beat, {big:true})` with 44px-tall tap targets per bead, each exactly one bead pitch wide (the bead plus half the 4px gap on each side), so neighbouring targets tile and never overlap; 25 targets 44px wide cannot fit 311px. A tap opens a tip ("Wed 8:27 pm · on time, 27 min after the close · 2 signals, nothing bought"). Signal bots also get "Replay this check ›" (`data-tip-cursor`).
   - Fallback: `COMP.punctuality(S.b)` only.
7. **Last trade line.** `L.act` (fallback `A.act`), same wording as the tile.

### 5.2 Wins & losses (`#overview-record`): success and failure

**Signal trader**

| Cell | Example | Source |
|---|---|---|
| Closed trades | "4 · 26 more before a verdict" | `G.stats.all.n`, `L.cfg.gates.n` |
| Won / lost | "1 won · 3 lost (25%)" | Count of `R>0` / `R≤0` in `G.trades.rows`; `G.stats.all.win` |
| Average trade | "−0.21 R · ≈ −0.21% of pot" | `G.stats.all.avg_R`; mean of the `pnl_pct` column |
| Best / worst | "Best ZEC +0.24 R · Worst SOL −0.82 R" | max/min of R in `G.trades.rows` with `c` and `t_out` |

- **Verdict pill** (evidence, not health): "Too early · 4 of 30 trades". Neutral until `n ≥ gates.n`, then "Go-live checks passing 4/4" (good) or "Failing: average R" (bad).
  - Sources: `G.verdict.gates[{k,val,target,state}]`, with a link to `#results/verdict`.
- A `details` "More numbers" holds:
  - profit factor `G.stats.all.pf` ("0.22 · under 1 means losses outweigh wins"; "—" when there is no loss);
  - vs holding `G.stats.all.rel_R`;
  - average hold `G.stats.all.hrs` h;
  - longest losing run `G.stats.all.streak`;
  - costs per trade `G.stats.all.cost_R`.
- `n = 0`: "No closed trades yet." Total R shows "—".

**Rebalancer**

| Cell | Source |
|---|---|
| Holding "2 coins" | `L.pos.length` |
| Invested "68% of pot" | Σ `L.pos[].size_pct` |
| Open result "−0.35% of pot · −0.09 R" | Σ `L.pos[].pnl_pct`, `L.rec.open_R` |
| Drawdown "0.67% · risk halves at 25%, stops at 45%" | `L.state.thr.dd_pct`, `L.cfg.thr` |

- Verdict: Trend reads "Judged yearly · day 5 of 365" (from `L.origin.t`). Arena reads `X.shortlist[].not_ready[0]` ("2 of 42 days in the arena"), or "Ready for you" (good).

**Funding collector**

| Cell | Source |
|---|---|
| Pairs "6 · 5 open · 1 closing" | `L.carry_sum.pairs`, `.open`, `.exiting` |
| Funding kept "34% of what it could earn" | `L.carry_sum.capture_pct`, against "go-live gate 80%" (`.gate_pct`) |
| Collected "+0.14% of pot · costs 0.09%" | `.fund_pct`, `.cost_pct` |
| Result "−1.07% of pot" · "the pot since it started" | `L.pot.chg_pct`, the hero's own figure |

- **"Where it came from"** row (waterfall in words): "funding +0.16% · price moves −1.14% (−1.43% booked, +0.29% still open) · costs −0.10% [· closed pairs X%] → −1.07% of pot". Booked price moves are `net − fund + cost`; still open is `carry_sum.open_pct` (both legs at the last check's marks); closed pairs is `carry_sum.closed_pct`. " · the rest is rounding" only when pot − (net + open + closed) is under 0.02 points, else " · X other". Each pair card's net adds its own `open_pct` ("(+0.05% still open)").
- Verdict: "Too early · judged over 2–4 weeks (day 5 of 14)" while `now − L.origin.t < 14 d`. After that: "Capture below the 80% gate" (warn word) or "Capture gate met" (good).
- Closed carry trades: count of `G.trades.rows` with `kind=='carry'`, shown as "% of capital" (`cap_ret_pct`). **Never R.**

### 5.3 What it traded (`#overview-traded`): one merged log, newest first

- Shows 8 rows, then "Show more" (up to 30), then "All trades ›" (`#results/trades`).
- Merged from three sources:
  - (a) **Closed trades**, `G.trades.rows` by `G.trades.cols`. Line 1: "AVAX · sold after 29.7 h". Line 2: "−0.20 R (−0.21% of pot) · stop · Wed 9:00 am" (`word.exit(rsn)`). Carry rows show `cap_ret_pct` "% of capital". A tap opens `SHEETS.trade(id)`.
  - (b) **Open entries**, `L.pos[]` ("CRV · bought Mon 2:17 pm · open +0.72 R", tap → `SHEETS.pos(id)`) and `L.carry[]` ("PUMP · collecting since Sat 10:14 pm · uses 25% of pot").
  - (c) **Actions that don't close a trade**, `L.events` of type `bought` (target), `resized`, `carry_in`, `carry_out`, `carry_closed`, `carry_fix` ("ZEC · evened its legs at market · Tue 8:22 pm").
- Dedupe rule: an event and an open entry with the same coin and `t` within 60 s are shown once.
- Phone: two-line list rows. Desktop: the same list at full width (no table).
- **By coin** (signal bots): `G.trades.rows` grouped by `c`, showing coin · trades · won · total R, top 6 by |total R|, as a list.
- Empty, by kind:
  - flip: "Nothing traded yet. It buys when an hourly flip passes every check."
  - target: "Nothing traded yet."
  - carry: "No pairs yet: funding is below the entry rate."

### 5.4 How often (`#overview-pace`): frequency

1. **Cadence sentence.** "Checks every hour · 24 of 24 on time in the last 24 h · usually 15 min after the close (6–24)". Late, missed and failed counts are added when above 0.
   - Sources: `word.every()`, `L.last24`, `L.clock.lag_med_min`, `L.clock.lag_rng`.
2. **Trade pace.** "5 buys in 5.2 days (about 6.8 a week) · 4 closed · average hold 19.2 h".
   - Buys = `G.trades.total + L.pos.length + (L.carry||[]).length`.
   - Days = `(now − L.origin.t)/86400`.
   - Hold = `G.stats.all.hrs`.
   - Target bots use "entries and rebalances".
3. **14-day strip**, one column per **phone-local day**.
   - Bought: solid accent, from `G.signals.rows` with outcome `bought` (each row carries its own time).
   - Exits: accent outline, from `G.trades.rows[t_out]`.
   - Refused: ink-2 tint, from `G.signals.rows` outcomes blocked/recorded/expired/notfilled.
   - Rebalances and carry actions: accent outline, from `L.events`. Within the 7-day window only; older columns note "rebalances shown for 7 days".
   - When `G.signals.total > G.signals.rows.length`, days older than the oldest row read "—".
   - Columns are 20px wide on phone. aria-label: "Tue Sep 29: 2 bought, 9 refused".
   - Opens and closes count once (signal rows, `trades.t_out`); the outline adds only `resized`, `carry_out` and `carry_fix` ("1 carry action").
   - `G.signals.daily` (UTC days) is **not** used.
4. **Signal funnel** (signal bots only). "Last 7 days: 92 signals → 58 passed the checks → 5 bought. Most refusals: book cap full (13), volume too low (10), open-risk cap (5)." Then "Why signals didn't trade ›" (`#activity/signals`).
   - Sources: `L.funnel.week` and the top 3 of `.by_check` via `word.reason`.
   - Hidden for target and carry bots. "0 signals" never shows for them.
5. **Recent activity.** The 6 newest `L.events` with level ≥ 1 (`word.event`), then "Full log ›" (`#activity/timeline`).

### 5.5 Holding now (`#overview-holding`): open positions, including carry

**Signal trader and rebalancer**
- `COMP.positionCard(p, {first: i===0})` for each `L.pos[]` (existing R-ladder cards; a tap opens `SHEETS.pos`).
- Rebalancers add a **Weights** list above the cards, from `L.tw`: "BTC · target 36% · holding 35% · hold".
- **Risk line, signal bots only:** "1.01% of pot at risk (cap 4%) · 1 of 6 slots".
- **Stops line, all non-carry bots, worded by sign:** "If every stop were hit: +0.36% of pot (the stops have locked in gains)" for Fast; "If every stop were hit: −10.27% of pot" for Trend.
  - Sources: `L.risk.used_pct`, `cap_pct`, `n_open`, `max`, `stops_hit_pct`.
- Rebalancers **never** show "% at risk" or slots, on the card or in its sheet (positions.js keys on `p.kind === 'target'`, so the sheet outside the page wrapper agrees). Their exit sentence is "Exits if its protective stop (14.2% below) is touched, or when a rebalance takes its target weight to 0." — never a daily or weekly turn, and no "No fixed target" line.

**Funding collector:** one card per `L.carry[]`, stuck pairs first.
- Header: coin chip + state word (Entering / Collecting / Closing). If `stuck_t`: "legs uneven since 12:07 am".
- Line 1: "uses 25.3% of pot · funding now 28.3%/yr" (`cap_pct`, `apr`).
- Line 2: "collected +0.05% · costs 0.02% · net −0.17% of pot" (`fund_pct`, `cost_pct`, `net_pct`).
- Capture bar against the 80% gate: "kept 72% of its funding" (`capture_pct`; "—" while closing or before any funding is due).
- Stuck line: "the engine evens the legs by 3:07 am" (`stuck_t + carry_sum.fix_h·3600`).
- A closing pair shows "closing since Wed 12:19 pm" (`exit_t`); no finish time is promised.
- Sum line: "6 pairs use 138% of the pot (sized at entry)" with a tip.
- **Never** "% at risk", slots or R.
- Fallback when `L.carry` is missing: "6 pairs open · details after the next check" (`L.risk.n_open`).

### 5.6 Equity (`#overview-equity`)

- An inline SVG (no library) from `G.eq.pct`: line, zero baseline, and a drawdown band from `G.eq.dd`, 100% × 140px.
- Text: "Now 2.68% below its peak · worst 2.86% · risk halves at 10%, buying stops at 20%" (`L.state.thr.dd_pct`, max of `G.eq.dd`, `L.cfg.thr`).
- "Interactive curve ›" → `#results/curve`, which keeps the lazy lightweight-charts curve.

### 5.7 Health and schedule (`#overview-health`)

- Every `S.st.items` entry as `banner()`.
- `COMP.punctuality(S.b)`.
- Halt state from `L.state.halt` (a fleet halt names itself).
- Drawdown meter.
- "Data pushed 37 min after the check" (`L.gen` vs `L.clock.last_t`).
- Signal bots only, as closed disclosures:
  - **"Risk limits"**: C renders it from `L.risk.by_book` + `L.books`; plain list rows.
  - **"Last check, step by step"** (`id="overview-gaterun"`): mounts `COMP.gateRun(host, null, {autoplay:false})` on open.
  - **"On deck"** (`id="overview-ondeck"`): `COMP.onDeck(host, {b:S.b})` on open.
  - A "Board over time ›" link to `#activity/tape`.
- None of these appear for target or carry bots.

### 5.8 Strategy and evidence (`#overview-strategy`)

- A plain sentence from `L.cfg`: "Rules v1.3 · risks 1% of pot per trade · up to 6 positions · risk halves at a 10% drawdown, buying stops at 20%". Then "31 coins in 7 books" (`L.order.length`, `L.books[].b`).
- "Bitcoin gate on" appears only when `L.cfg.btc_gate`.
- **Arena bots**, from `X.shortlist[agent==AGENT]`:
  - the hypothesis;
  - a **backtest vs paper** table:

    | Measure | Backtest | Paper so far |
    |---|---|---|
    | Return | 17.3%/yr (7.75 yrs) | +0.50% in 2 days |
    | Worst drawdown | 18.0% | 0.21% |
    | Sharpe | 1.13 (holdout 0.76) | too early |
    | Matches its backtest | — | 100% of 26 checks |
    | Days in arena | — | 2 of 42 |

  - `not_ready[]` as a list;
  - "Ready for you" plus "How to switch it live ›" (`data-sheet="shortlist"`).
- **Fleet share**: `X.fleet.members[agent].share_pct` ("34.4% of the fleet, equal risk"), or `X.fleet.excluded[agent].why`.
- Links: "Full rules ›" (`#rules`), "Weekly review ›" (`#results/review`), "Controls ›" (read-only link to the GitHub control workflow with the inputs to type).

### 5.9 Per-kind differences

| Section | Signal trader | Rebalancer | Funding collector |
|---|---|---|---|
| Hero second number | Total R | none | none |
| Wins & losses | R cells + go-live gates | holding / invested / open / drawdown | pairs / funding kept / collected / net + waterfall |
| What it traded | closed trades + open + by coin | entries + `resized` events | `carry_in` / `carry_out` / `carry_closed` / `carry_fix` + closed in % of capital |
| How often | funnel and refusals shown | funnel **hidden** | funnel **hidden** |
| Holding now | R-ladders + risk line | weights list + cards, no "% at risk" or slots | pair cards, no R or risk |
| Health disclosures | Risk limits, Gate Run, On deck | none | none |
| Activity tab | as today | timeline only | timeline only |
| Heartbeat | 24 (1 h) / 18 (4 h) beads | 14 daily beads | 24 hourly beads |

---

## 6. Data contract (package A)

Every change is additive and stdlib only. Every value passes through the allowlist serializer and `scrub_assert`. **No new KV keys.**

### 6.1 `exec:<id>:latest` (`Bundle.latest()`)

| Field | Type | How computed | Size |
|---|---|---|---|
| `clock.bar_s` | int | Module `BAR` (already set per agent in `main()`): 3600 / 14400 / 86400 | 12 B |
| `cfg.kind` | `"flip"\|"target"\|"carry"` | `settings.strategy` or `"flip"` | 15 B |
| `cfg.tf` | str | `C.trigger_tf(settings)` | 10 B |
| `cfg.btc_gate` | bool | `settings.get("btc_gate", True)` (the engine default; core true, others false today) | 16 B |
| `beat` | `{s0:int, n:int, k:str}` | New `Bundle.beat()` over **all** `self.eff_runs` grouped by `R.slot`. `n = {3600:24, 14400:18, 86400:14}[BAR]`; slots `top−(n−1)·BAR … top`, oldest first; `s0` = first slot. Per slot (see the alphabet after this table). The newest slot is dropped when it is not owed yet and has no run. | ≤ 60 B |
| `act` | `{t, ty, cs:[≤3], n, R, cap_pct}` \| null | New `Bundle.last_act()`. Candidates (rule after this table); newest `t` wins; same `ty` within 60 s are grouped into `cs` (≤ 3) and `n`. | ≤ 90 B |
| `carry` | list (carry kind only) | New `Bundle.carry_rows()` from `self.positions` entries with `kind=="carry"` plus `self.last_eff.readings[c].funding_pct`. Per pair, keys in the next table. | about 6 × 130 B |
| `carry_sum` | object (carry kind only) | Keys in the next table | about 230 B |
| `tw` | `[[c, tgt_pct, held_pct, act]]` (target kind only) | From `self.last_eff.doc.summary` with `^(\S+): target (\d+)% of pot, holding (\d+)% → (\w+)$`. Keep rows where tgt > 0, held > 0 or act ∉ {none}; at most 12. Today: Trend BTC 36/35 hold, ETH 34/33 hold; A01 LTC 12/12, NEAR 6/7, UNI 7/7. `parse_line` still returns SKIP for these lines. | ≤ 300 B |
| `alerts` += k `unhedged` | one per pair with `stuck_since` | `{lv, k:"unhedged", t:stuck_since, c}` (texts after the next table) | ≤ 2 × 110 B |
| `alerts` += k `exit_slow` | one per pair closing too long | `{lv, k:"exit_slow", t:exit_t, c}` (texts after the `carry_sum` table) | ≤ 110 B |
| `events` new types | 9-column event row, unchanged shape | `resized`, `carry_in`, `carry_out`, `carry_closed`, `carry_fix` (regexes after the next table). `LEVEL` = 2 for all five. | — |

**Beat alphabet** (one character per slot):

| Char | Meaning |
|---|---|
| `.` | before the first run |
| `-` | no run and `S + late_limit·60 ≤ now` (missed) |
| `x` | only failed runs |
| `o` | any fresh, not-failed run |
| `l` | ok runs, none fresh (ran late) |
| `O` / `L` | as `o` / `l`, when the slot's `R.events` contain an **acted** type: `bought`, `sold`, `resized`, `carry_in`, `carry_out`, `carry_closed` |

**`act` candidates:**
1. the 7-day `events` of the acted types (`R` only for `sold`);
2. the newest closed trade in `self.trades`, any age (`ty` `carry_closed` for carry, with `cap_pct = R·100` and `R = null`);
3. each open position (`ty` `bought`, `t = pos_ts`);
4. each carry position (`ty` `carry_in`, `t = opened_ts`).

`act` is null **only** when there are no trades, no positions and no events. This fixes the "No trades yet" after 7 days bug.

**`carry[]` pair keys:**

| Key | Value |
|---|---|
| `id` | `f"{c}-{opened_ts}"` |
| `c` | coin |
| `st` | raw `p.state` (`entering` / `open` / `exiting`) |
| `t_in` | `opened_ts` |
| `cap_pct` | `ratio(capital, 1)` |
| `apr` | `num(funding_pct, 1)`, or null |
| `fund_pct` | `ratio(funding_income, 3)` |
| `cost_pct` | `ratio(fees, 3)` |
| `net_pct` | `ratio(funding_income − fees + (spot_pnl or 0) + (perp_pnl or 0))`; absent legs count as 0, as in `carry.closed_record()` |
| `capture_pct` | `round(carry.capture(p)·100)` when `theo_funding > 1e-9` **and** `st != "exiting"`, else null (this suppresses HYPE's −302%) |
| `stuck_t` | `stuck_since` or null |

No prices, so no `px`.

**`carry_sum` keys:**

| Key | Value | Snapshot |
|---|---|---|
| `pairs` | count | 6 |
| `open`, `entering`, `exiting` | state counts | 5 / 0 / 1 |
| `stuck` | pairs with `stuck_since` | 2 |
| `stuck_t` | earliest `stuck_since` | 04:07Z |
| `fix_h` | `settings.carry.max_unhedged_hours` | 3 |
| `gate_pct` | `settings.carry.capture_gate_pct` or 80 | 80 |
| `cap_pct` | Σ | 138.1 |
| `apr` | capital-weighted over pairs not exiting | 14.6 |
| `fund_pct`, `cost_pct`, `net_pct` | Σ | 0.14 / 0.09 / −1.39 |
| `capture_pct` | `round((Σfunding_income − Σfees)/Σtheo_funding·100)`, null if Σtheo ≤ 0 | 34 (checked: (1.4116 − 0.9322)/1.4177 = 33.8%) |
| `open_pct` | Σ open P&L on both legs at the last check's marks (spot mark, perp mark from the run's readings); bot page only, left out of `row.carry` | +0.29 |
| `closed_pct` | Σ `pnl` of closed carry trades; bot page only | null |

Each pair row also carries `exit_t` (`pos.exit_ts`, which the engine sets when a pair starts closing, else the newest
`carry_out` event; null unless exiting) and `open_pct`.

**`exit_slow` alert** (`{lv, k:"exit_slow", t: exit_t, c}`): a pair still closing after `requote_hours + max_unhedged_hours`
is info ("{c}: closing since {time} and not finished."), after 24 h warn ("… not finished after 24 h."). Core words it
"Closing slow", so a stuck close reaches the tile and the Needs-you rail instead of "All clear".

**`unhedged` alert texts** (one `{time}` placeholder, filled from `t`):
- **`lv:"info"`** while `now < stuck_t + fix_h·3600 + BAR`: "{c}: legs out of balance since {time}; the engine evens them after 3 h."
- **`lv:"warn"`** after that: "{c}: legs out of balance since {time}, past the 3 h safety limit."
- Today ZEC (since 04:07Z, 12:07 am) and PUMP (since 06:06Z, 2:06 am) are both **info**. This matches how routine the overrides are: 6 in 4 days in the run logs.

**New event regexes** (they replace the single `carry` SKIP pattern):

| Type | Regex | `detail` |
|---|---|---|
| `resized` | `^(\S+): resized to (\d+)% of pot, stop \S+$` | `"48"` |
| `carry_in` | `^(\S+): carry ENTERING · funding ([-\d.]+)%/yr` | `"34.9"` |
| `carry_out` | `^(\S+): carry EXITING · funding ([-\d.]+)%/yr` | `"-0.2"` |
| `carry_closed` | `^(\S+): carry CLOSED · ([+-][\d.]+)% of pot · capture (\S+)` | `"+0.03,85%"` (% of pot, never % of capital: worded "of pot") |
| `carry_fix` | `^(\S+): carry safety override · ` | none |

In `run_events`, `carry_in` adds `(c, R.t)` to `matched_open` (so the ledger cross-check emits no duplicate `bought` for the same open). `carry_closed` matches a ledger close the way `sold` does.

**Fixes inside existing methods:**
- **Carry positions fix:** `pos()` gets `if p.get("kind") == "carry": continue` before parsing. The skip is explicit, no longer a KeyError. `risk.n_open` still counts them (6), so the tile and the bot page agree.
- `rec()` excludes `kind=="carry"` trades from `Rs` and `rel`. Carry "R" is return on capital, so carry rows no longer feed `tot_R` or `avg_R`.
- **Size:** about +0.3 KB on every bot, +1.2 KB on carry, +0.3 KB on target. Fast (40.1 KB) stays under the 50 KB `fit()` budget.

### 6.2 `exec:<id>:ledger`

- `trades.cols` also gets **`t_rec` appended**: the time of the check that recorded the close (the coin's `sold` / `carry_closed` event within two bars after `t_out`, else `t_out`). A paper stop's `t_out` is the open of the bar that hit it; every list, the tile and the hero show `t_rec`, so one sale has one time. A stop exit above the entry price reads "trailing stop, locked in gain".
- `cfg.checks` is the check list of the bot's kind (`PRE_TRADE_ORDER`, `TARGET_CHECKS` or `CARRY_CHECKS`; a test reads cycle.py's `add("…")` names so they cannot drift), and `cfg.target` / `cfg.carry` carry the settings the Rules tab words (sma, band, stop_pct, family, rebalance_days, top, n_coins, vol_target_pct / enter_apr, exit_apr, window_h, basket_n, fix_h, gate_pct, min_spot_vol_m).
- `trades.cols` gets **`cap_ret_pct` appended** (results.js reads rows by column name, so this is safe). For `kind=="carry"` rows: `R`, `rel_R` and `cost_R` → null, and `cap_ret_pct = num(R·100)`. Other rows: null.
- `stats()` (and its book/tier/kind/reason buckets), `rseries`, `cost_R` and the verdict gates use **non-carry rows only**. Carry `cost_R` would otherwise be `(fees − funding_income)/capital`.
- No other change. The `cadence` field from the Operator design is **not** added: phone-local day strips come from the t-level `signals.rows`, `trades.rows` and `events`.

### 6.3 `exec:agents` row v2 (`agent_summary(b)`)

**Kept, same names and same types**, so the live v1 client keeps working during the rollout:
- `id`, `name`, `desc`, `tf`, `mode`, `gen`, `last_t`
- `rec{n, tot_R, avg_R, rel_R_avg, open_R}`
- `pot_chg_pct`, `n_open`, `used_pct`
- **`halt` (bool)**, **`thr` (str)**, **`failed` (bool)**, **`alerts` (int count)**

**Dropped:** `signals` (the funnel). No page reads it: the v1 `SHEETS.agents` does not use it. This saves about 300 B.

**New fields:**

| Field | Type | Source |
|---|---|---|
| `enabled` | bool | roster `enabled` |
| `kind`, `bar_s` | str, int | `L.cfg.kind`, `L.clock.bar_s` |
| `n_names` | int | `len(L.order)` |
| `arena` | `{recipe, family, tag, enrolled}` \| null | roster `arena`, allowlisted |
| `twin_of` | str \| null | roster `twin_of` (future; null today) |
| `sb` | status pseudo-bundle | `{clock: L.clock (last_t, last_slot, late_min, lag_med_min, lag_rng, lag_n, limit_min, sched_min, bar_s), state: {halt, thr, last} from L.state, cfg: {thr, late_min} from L.cfg, mode: L.mode, alerts: ≤ 3 of L.alerts with lv bad\|warn, worst first, risk: {n_open}}`. About 450–700 B. |
| `since` | int \| null | `L.pot.since` |
| `wk_pct` | float \| null | `L.pot.wk_chg_pct` |
| `spark`, `spark_t` | `[≤24 floats]`, `[t0, t1]` | tail of `L.pot.spark` (2 dp) and its first and last `t` |
| `rec.win`, `rec.w`, `rec.l`, `rec.closed_R` | float \| null, int, int, float | `G.stats.all.win`; counts of non-carry `G.trades.rows` with R > 0 and R ≤ 0; `L.rec.closed_R` |
| `last24` | object | copy of `L.last24` |
| `beat`, `act` | as in §6.1 | copies of `L.beat`, `L.act` |
| `recent` | `[≤3 event rows]` | `L.events` with `lv ≥ 2` and type ∉ {blocked, board, review}, newest first |
| `held` | `[≤8 coins]` | `L.pos[].c` + `L.carry[].c` |
| `deployed_pct` | float \| null | Σ `L.pos[].size_pct` + Σ `L.carry[].cap_pct` (1 dp) |
| `carry` | object (carry only) | copy of `L.carry_sum` |

**Row size**
- Typical 1.4–1.6 KB; asserted ≤ 2,048 B.
- `fit_row()` trims in this order: `recent` → 1 row, then `spark` → 12 points, then `sb.alerts` → 1.
- About 9 KB for 6 bots, about 27 KB for 17.
- `scrub_assert(row, "exec:agents", B.money)` runs in the push child before the row is written (today only a test covers it).

### 6.4 `exec:agents` envelope v2

```json
{"v": 2, "gen": "<iso>",
 "fleet": {"halt": false, "reason": null, "since": null},
 "host":  {"name": "alwaysdata", "t": 1790834826, "fails": 0, "ok": true},
 "order": ["core","wide-4h","fast-1h","trend-1d","carry-1h","arena-01"],
 "agents": [ ...rows in roster order, enabled and disabled... ]}
```

- Keys come in this order, so `v` and `gen` lead.
- `fleet`:
  - `halt` = `C.FLEET_HALT.exists()`;
  - `reason` = `halt_reason(text)[0]`;
  - `since` = ISO in `FLEET_HALT.since` → seconds.
- `host`, from `state/host_beat.json` (`t` ISO → seconds, `fails_in_a_row`, `exit == 0`) and `config/host.json.host`. Python version and mode are not copied.
- `order` = enabled roster ids.
- The Worker's empty default `{"v":1,"agents":[]}` stays.

### 6.5 Write path (fixes the read-modify-write race on exec:agents)

1. **Push child.** When `EXECUTOR_ROWS_DIR` is set, `dashboard_push.py` bulk-writes **only** `exec:<id>:latest`, `:ledger`, `:stamp`, plus docs when their sha changed. **After a successful write** it saves `{"v":2,"row":…}` to `$EXECUTOR_ROWS_DIR/<id>.json`. It no longer reads `exec:agents` or `exec:factory`.
   - Without the variable (standalone or manual runs), today's behaviour is kept: inline read-merge of `exec:agents`, with a v2 envelope.
2. **New `dashboard_push.py --fleet DIR`**, one call per job. It:
   - reads `exec:agents` once;
   - merges: each row from DIR replaces the remote row when its `gen` ≥ the remote `gen`; rows for agents not pushed in this job are kept; rows for agents no longer in the roster are dropped;
   - rebuilds `fleet`, `host` and `order`;
   - runs `scrub_assert(envelope, "exec:agents")`;
   - writes `exec:agents`, **plus `exec:factory` only when its bytes differ from the remote value** (moved here from every push), in **one** bulk call.
   - An empty DIR is valid: it refreshes the envelope only.
3. **`run_agents.py`**:
   - Creates the rows dir with `tempfile.mkdtemp(prefix="exec-rows-", dir=os.environ.get("RUNNER_TEMP") or None)` and passes `EXECUTOR_ROWS_DIR` to each push child.
   - Wraps the loop in `try/finally`. The `finally` block:
     1. runs `fleet_guard()` (unchanged; before the fleet write, so a fresh halt is included);
     2. if not `--dry` **and** Cloudflare secrets are present, runs `dashboard_push.py --fleet <dir>` with the Cloudflare-only env. On the Paris server there are no secrets, so it prints "no Cloudflare secrets: fleet not pushed" and skips.
     3. removes the dir.
   - New flag `--fleet-only` skips the loop.
   - A failed agent push leaves that bot's previous row, which the client shows as Late or Stale by clock. Exit codes are unchanged.
4. **`dashboard-sync.yml`.** The path filter now also emits `fleet=1` when `state/FLEET_HALT` or `state/FLEET_HALT.since` changed. The run step becomes:

   `if [ -n "$ONLY" ]; then python3 scripts/run_agents.py --push-only --only "$ONLY"; elif [ "$FLEET" = "1" ]; then python3 scripts/run_agents.py --fleet-only; fi`

   `host_beat.json` and `requests/` still do not trigger it. So a fleet halt from `fleet_guard` on the server, or from `control.yml`, reaches the master within one sync job.
5. **`--kv-json`** writes the v2 envelope directly, so the local preview gets the full shape.

**Residual race.** Two different jobs (for example `control.yml` and `dashboard-sync`) within KV's ~60 s staleness can still overwrite each other's row. That is rare. It heals on the next hourly sync, and every tile shows its own "checked … ago".

### 6.6 KV write impact (free plan, about 1,000/day shared with the AiFi desk)

| Fleet | Pushes/day | Today (4 keys per push) | After (3 per push + 1 fleet per job) |
|---|---|---|---|
| 6 bots (fast 24, carry 24, core 6, wide 6, trend 3, A01 3: daily bots re-run 3× in their 180-min window) | 66 | 66 × 4 = **264** (+ factory ≤ 1, docs rare) | 66 × 3 + 24 hourly sync jobs + ≤ 1 factory ≈ **223** |
| about 17 bots (3 × 1h, 2 × 4h, 12 × 1d) | 72 + 12 + 36 = 120 | **480** | 360 + 24 + 1 ≈ **385** (≤ 400) |
| Each FLEET_HALT change | — | invisible until the next agent push | +1 write |

Reads also drop. Push children no longer read `exec:agents` or `exec:factory`; the fleet step makes 2 reads per job.

### 6.7 Computed client-side, never shipped

- **Status.** Every status word, level, phase and countdown: `status(rowBundle(A))` on the master, `status(S.b)` on bot pages.
- **Per-bar clock rule** in core `clock()`. With `bar = barOf(b)`:

  | Quantity | Formula |
  |---|---|
  | `C` | `last_slot + bar` |
  | `next` | `C + lag·60` (`lag = 20` when `lag_n < 3`) |
  | `lateAt` | `C + lim·60` |
  | `staleAt` | `C + min(bar, max(14400, lim·60 + 3600))` |
  | `exitsAt` | `C + min(7200, bar)` |

  - 4 h: identical to today.
  - 1 h (Fast, lim 35): due 3:15, late 3:35, stale 4:00 am.
  - 1 d (Trend, lim 180): due from 9:15 pm, late 11:00 pm, Exits unchecked from 11:00 pm (positions held), stale midnight.
- `rowBundle(A, E)`:

  `A.sb ? {v:2, gen:A.gen, clock:{...A.sb.clock, bar_s: A.sb.clock.bar_s || A.bar_s || TF[A.tf]}, state: (E.fleet && E.fleet.halt && !A.sb.state.halt.set) ? {...A.sb.state, halt:{set:true, reason:'fleet halt: '+(E.fleet.reason||'no reason given'), since:E.fleet.since}} : A.sb.state, cfg:A.sb.cfg, mode:A.sb.mode, alerts:A.sb.alerts||[], risk:A.sb.risk, runs:[]} : null`
- Beads after the push: `-` for slots past `slot + lim` with no newer row, plus the hollow "next" bead.
- Fleet aggregates, the verdict, the Needs-you rail, the log merge, trail collapsing, "since you last looked", sort and filter.
- By-coin stats, best and worst trade, pace, local-day buckets, "this week" (only when `now − since ≥ 7 d`), carry "too early" (`now − origin < 14 d`), the price-gap term.

---

## 7. Visual language

**Tokens.** Only `design.js` and `mission.js` tokens; no raw colours.

| Element | Treatment |
|---|---|
| Glass with blur | Topbar, rail, the fleet header card, sheets |
| Tiles | `--glass` + `--line` + inset `--hi` top highlight, **no backdrop-filter** |
| Pressed tile | `--glass-3` |
| Radius | `--r` on cards/tiles; `--r-md` on inner cells; `--r-pill` on pills |
| Spacing | `--s3` inside tiles; `--s4` grid gap |

**Magenta (`--accent`) tiers**

| Tier | Where it appears |
|---|---|
| **Solid: the bot acted** | Heartbeat bead ring on `O`/`L`; the last-trade dot (< 24 h); acted rows in the fleet log and trade log; bought columns in the 14-day strip |
| **Solid: the clock** | The hollow "next" bead outline; the due dot; the Next-check ticker digits |
| **Tint `--accent-soft`** | Unused on the master. On the bot page: armed names in On deck (existing) |
| **1px outline / text: identity** | Active nav; `.tk` coin chips; the Live pill; the return-focus outline on the last-opened tile |
| **Never** | Health, borders of healthy tiles, big numbers |

**Status words and colours.** One table for all surfaces. The word always shows; colour supports it.

| Level | Dot | Tile edge | Words |
|---|---|---|---|
| ok | `--good` | none (a calm fleet looks calm) | On schedule |
| info | `--accent` (clock) | none | Due now · No checks yet · notes |
| warn | `--warn` | 3px inset `--warn` left edge | Late · Ran late · Paper fallback · Risk halved · Legs uneven (`unhedged` warn; core maps `k:'unhedged'` to this word instead of "Check") · Check |
| bad | `--bad` | 3px inset left edge + 1px `--bad` border | Failed · Halted · Buying stopped · Stale · Exits unchecked · Needs you |
| mute | `--muted` | none | Retired · Waiting for its first check · Checked … · schedule after its next check (v1 row) |

- **Beads:** `o` `--good` fill; `O` `--good` + 2px `--accent` ring; `l` `--warn`; `L` `--warn` + ring; `x` `--bad`; `-` hollow dashed `--muted`; `.` a faint `--line` ring (so a young daily strip reads as a full row with empty early slots); next: hollow `--accent` outline.
- **Paper** is violet `.pill.pt` only. **Live** is the accent outline pill with a static dot.

**Typography**

| Element | Style |
|---|---|
| Tile name | `--fs-lg` / 650 |
| Status word | `--fs-lg` / 600 |
| Big number on tile | `--fs-2xl` IBM Plex Mono, tabular |
| Hero big number | `--fs-3xl` |
| Stat values | `--fs-md` / 650 mono |
| Labels | `--fs-xs` muted, sentence case |
| KPI values | `--fs-xl` mono |
| Verdict pill | `--fs-xl` / 650 |
| Body | `--fs-md` |
| Log rows | `--fs-sm` |

**Motion (honest only)**

| Cause | What moves |
|---|---|
| Real clock | The single fleet Next-check ticker (1 s, `every1s`, visible only). "checked … ago" and "next ≈" update on the 30 s tick. A phase flip swaps the word with no loop. **No pulses on tiles.** |
| Recorded check arrives (row `gen` changed) | That tile plays the existing `@keyframes pulse` once on its border. A changed big number counts up (`countUp` ≤ 600 ms). The new bead plays `.grow1`. New log rows `.rise`. At most one toast per poll ("Fast checked · nothing traded", "2 bots checked · 1 trade"). **Tiles never reorder.** |
| Owner's action | Hover lift −2px (`.card.lift`); press `scale(.985)`; the view transition (about 250 ms, `--ease`); sort and filter re-render instantly (no FLIP); first paint of tiles uses `stagger`, capped at 12. |
| Reduced motion | All of the above become instant; view transitions off. |

---

## 8. Mobile and desktop layouts

### Phone, 375 × 812

- 16px gutter, 343px content, tile inner width 311px. No horizontal page scroll. Tap targets ≥ 44px.

**Master**

| Element | Approx. height |
|---|---|
| Topbar `[Ex 28px] [capsule flex:1] [modepill] [◐]` | 52px |
| Fleet header: verdict + 2-line sentence | ~84px |
| KPI 2×2 (cells about 163px wide, 64px tall) | ~136px |
| Switch pills, wrapping onto 2 lines (kill switch, market, server, next check) | ~64px |
| Header bottom | ~**400px** |

- The verdict, all four KPIs, the kill switch and the server are **visible above the fold**.
- Needs-you rows follow (44px each, only when present). The first tile starts at about 420–470px.
- Controls: `.seg.quiet` sort scrolls inside its own mask. Filter chips only at ≥ 7 bots.
- Tiles: one column, about 236px each. 6 bots ≈ 1.5k px. At ≥ 9 bots the Compact rows default to 64px each (17 bots ≈ 1.2k px).
- Fleet log in one column, then the Lab strip and footer. No tabbar; safe-area bottom padding.

**Bot page**
- Topbar `[‹ 44px] [h1 name, ellipsis] [capsule short] [modepill]`; the theme toggle moves into Rules on phone.
- Bottom tabbar with 4 items (about 86px each).
- Hero stacked: chip + desc, verdict, schedule, big number, sparkline, heartbeat (beads up to 14px), last trade, ‹ › top-right.
- Wins & losses 2×2. Trade log as 2-line rows. 14-day strip 14 × 20px. Pair and position cards full width. Disclosures closed.

### Tablet, 641–1099px

- Rail with labels visually hidden ≤ 900px (existing `.vh` pattern).
- Tiles in 2 columns. Bot page in one column.

### Desktop, ≥ 1100px

- Rail 232px:
  - master: brand, Command center, roster with status dots, Rules & docs, status, Log out;
  - bot page: ‹ All bots, 4 tabs, roster, status, Log out.
- Master: KPI cells 4 across, switch pills in one row, tiles in 3 columns, fleet log in 2 columns read down (CSS columns, newest top-left; the "new" divider spans both).
- Bot page: hero full width; left column Wins & losses / What it traded / How often; right column Holding now / Equity / Health / Strategy. Cards use `container-type:inline-size`.

### Themes

Light and dark from the existing tokens. Tiles use `--glass` in both. Status tints use the `-soft` tokens already tuned in mission.js (≥ 4.7:1 contrast in light).

---

## 9. Build plan: three parallel packages with strict file ownership

**Ownership rule.** Each file below has exactly one owner. Nobody edits a file outside their list.
- The brief's lists are extended where a file had to have an owner: `run_agents.py` and `dashboard-sync.yml` go to A; the mechanical sweep of existing ui modules goes to B. These are shell and clock concerns, and core.js, which drives them, is B's.
- **core.js has a single owner (B).** The per-bar clock fix lives in `clock()`, so it is B's, together with the routing hooks.

### Package A: data layer

**Owns:**
- `scripts/dashboard_push.py`
- `scripts/run_agents.py`
- `.github/workflows/dashboard-sync.yml`
- `tests/*.py`, `tests/fixtures/**`
- `docs/DASHBOARD.md` (data contract section)

**Deliverables, in order:**
- **A0 (day 1, ships first, tiny):**
  - `clock.bar_s`, `cfg.kind`, `cfg.tf`, `cfg.btc_gate`;
  - the explicit carry skip in `pos()`;
  - carry excluded from `rec()`, `stats()`, `rseries`, `cost_R`;
  - `cap_ret_pct`.
- **A1:** `beat`, `act`, `carry[]`, `carry_sum`, `tw`, the `unhedged` alert, the five event types (with `matched_open`/`matched_tr` joins), row v2 (§6.3) with `fit_row()` and `scrub_assert` per row, envelope v2.
- **A2:** the rows-dir push mode, `--fleet DIR`, `run_agents.py` try/finally + `--fleet-only` + secrets guard, the `dashboard-sync.yml` FLEET_HALT branch.

**Tests (unittest):**
- `bar_s` per tf (1h/4h/1d).
- `cfg.kind` per settings.
- A carry fixture:
  - `pos()` returns no carry row while `risk.n_open == 6`;
  - `carry[]` keys pass FORBIDDEN_KEY and no string carries a fixture money figure;
  - `carry_sum.capture_pct == round((Σfi − Σfees)/Σtheo·100)`;
  - `capture_pct` is null for exiting pairs and for theo ≤ 0;
  - `unhedged` is info at `--now` = stuck + 2 h and warn at stuck + 4 h + 1 bar.
- A target fixture: arena's 13 lines → 3 `tw` rows; `parse_line` returns typed events (not SKIP) for resized and all four carry verbs; no duplicate `bought` for a `carry_in` open.
- Beat alphabet: a fixture with a pre-start slot, a missed slot, a failed-only slot, a late slot and an acted slot gives the exact string; length = n or n−1.
- `act` 10 days after the last event still returns the ledger or position action (not null).
- Ledger carry rows: R null and `cap_ret_pct` set; `stats.all.n` excludes carry.
- Row v1 field **types** unchanged (`halt` bool, `thr` str, `alerts` int, `failed` bool).
- Row ≤ 2,048 B on every fixture, and ≤ 1,600 B with no alerts.
- Envelope key order `v, gen, …`.
- `--fleet`: newest-gen merge, keeps rows of agents not pushed, exactly one bulk call, `exec:factory` only when changed.
- Rows-dir mode bulk keys == `[latest, ledger, stamp]` (+ docs); standalone mode unchanged (the existing assertion at test_dashboard_bundle.py:250 still holds).
- `run_agents`: the fleet step runs once after a failing push, is skipped without secrets, and `--fleet-only` skips the loop.
- `tests/test_dashboard_client.py` keeps `client_bytes < 420_000`.

### Package B: master page, routing, shell, clock

**Owns:**
- `cloud/worker.js`
- `cloud/ui/core.js`
- **new** `cloud/ui/fleet.js` + `cloud/ui/fleet.css`
- `cloud/ui/README.md`
- `cloud/ui/boot.js`
- the mechanical sweep files `cloud/ui/gaterun.js`, `activity.js`, `now.js`, `rules.js`, `positions.js`, `arrival.js`
- **deletes** `cloud/ui/dial.js` + `dial.css`
- `cloud/dev/preview.mjs` + new committed samples `cloud/dev/fx_agents_v2.json` (`fx_*`, not matched by the gitignored `kv*.json`)
- `tests/client_join_check.mjs` (the one test file B owns)

**Deliverables:**
- **B0 (Deploy 0, with A0):**
  - `let BAR`, set from `barOf(S.b)` in `start()`;
  - `barOf(b)`, with fallback chain `b.clock.bar_s` → `TF[b.cfg.tf]` → `TF[rowOf(AGENT).tf]` → 14400; `boot()` awaits `loadAgents()` in parallel with latest so the fallback is ready;
  - the per-bar `clock()` rule (§6.7);
  - `pollEvery()`: 60 s in `[next−5 min, staleAt)`, else 600 s;
  - `word.bar()` / `word.every()` replacing the 19 + 15 + 10 + 11 + 5 + 2 literal "4-hour" strings in core / gaterun / activity / now / rules / positions;
  - activity.js's 4 h heartbeat grid only when `bar_s == 14400` (else `COMP.beatStrip`);
  - `AWORD.unhedged = 'Legs uneven'`.
- **B1, shell:**
  - `appPage(view)` with `data-view`, two navs, `#back`, `#roster`; every mount (`capsule`, `railstat`, `modepill`, `ttl`, `alerts`, `view`, `sheet`, `sheetbg`, `toast`, `app`) in **both** shells; one h1; the capsule as the only aria-live;
  - ETag + `private, no-cache` + 304;
  - invalid `?a` → `/`;
  - docPage's "Dashboard" button → `/`;
  - MODULES and CSS order: `core, gaterun, now, activity, positions, results, rules, arrival, factory, fleet, bot, boot`.
- **B2, core routing:**
  - `PAGE`; `AGENT` null on `/`;
  - legacy-hash redirect; remove the `ex.agent` auto-home and `#agentbtn`/`SHEETS.agents`; `switchAgent` shim;
  - `TABS`/`TITLE`/`REDIRECT` for bot pages (2.2, 2.3);
  - hash navigation by `replaceState`;
  - `goFleet()`, `botHref()`;
  - fleet branches in `boot`, `start`, `route`, `renderView`, `refreshShell`, `paintCapsule`/`capState`, `paintAlerts`, `tick30`, `startTimers`, `sync1s`, `poll`/`pollEvery` (master polls `/api/agents`; `S.b` stays null);
  - `rowBundle()`, `rowOf()`, `kindOf()`, `word.kindName()`, `loadFactory()`, hook `agents`;
  - `word.event` + `EV_IC` for the 5 new types;
  - status act hrefs `#positions` → `#overview/holding`; warn banners on `overview`;
  - setCursor and arrival.js `'now'` checks → `'overview'`.
- **B3, fleet.js:** `VIEWS.fleet`, `COMP.beatStrip`, `COMP.sparkSvg`, `COMP.roster`, `SHEETS.fleethealth`; header, rail, tiles, compact, log, Lab strip, states, refresh, arrival; sessionStorage return and outline; view-transition at-rule; the master `refreshShell`, all of §3 and §4.
- **B4, trims:**
  - now.js shrinks to `COMP.onDeck`;
  - remove dial from ORDER;
  - **client byte budget:** today 367,296 B. −dial (≈ 19 KB leaned), −now.js view (≈ 30 KB), +fleet.js (≤ 26 KB raw), +bot.js (≤ 30 KB raw), +core (≤ 6 KB) → about 350 KB, under the 420,000 B test.
- **Join check additions:**
  - new ORDER (guard count = ORDER.length − 1);
  - `bot` and `fleet` present;
  - fetch both `/` and `/?a=core`: one h1 each, all mounts, one aria-live, `data-view` correct;
  - `/?a=Bad!` → 302;
  - 304 on a matching `If-None-Match`;
  - a **clock harness** that evaluates `core.js` in a `vm` context with stubs (`document.documentElement`, `location`, `matchMedia`, `localStorage`) and asserts the §10 clock statements at bar 3600 / 14400 / 86400.

### Package C: bot detail page

**Owns:** **new** `cloud/ui/bot.js` + `cloud/ui/bot.css` only (prefix `bt-`, one block, no backticks, design tokens only).

- **Day-0 commit:** `bot.js` = `{\n}` and `bot.css` = empty, so B's imports resolve. This lands before or together with B1.
- Registers `VIEWS.overview = {title:'Overview', render(root, why), after(root) → cleanup, leave()}`, plus `hook('route', (tab, sub) => …)` to open the `gaterun`/`ondeck` disclosures, and `hook('agents', redraw-if-row-changed)`.
- Implements all of §5.

### Interface B ↔ C (exact)

**C may read from core:**

| Name | Meaning |
|---|---|
| `PAGE === 'bot'` | page detection |
| `AGENT` (string) | the bot id |
| `S.b`, `S.st`, `S.tab`, `S.sub` | current bundle, status, tab, sub-anchor |
| `loadLedger()`, `S.ledger` | the ledger |
| `AGENTS` (rows array) | from `/api/agents` |
| `rowOf(id)` → row \| null | one row |
| `loadFactory(force?)` → Promise<factory\|null> | 5-min cache of `/api/factory` |
| `barOf(b)` → seconds | bar length |
| `kindOf(b)` | `cfg.kind` → `row.kind` → inference (any `pos[].kind==='target'` or event kind `'target'` → target; any event kind `'carry'` → carry; else flip; labelled "inferred" in the type chip tooltip) |
| `word.bar(b)` | `'hourly'\|'4-hour'\|'daily'` |
| `word.every(b)` | `'every hour'\|'every 4 hours'\|'every day'` |
| `word.kindName(kind, bar_s)` | e.g. "Signal trader · hourly" |
| `botHref(id, hash?)` | `/?a=<id>` (+ hash) |
| `goFleet()` | back-to-fleet logic |
| plus every existing CORE API helper | `fmt`, `word.event`, `status`, `clock`, `banner`, `tip`, `chip`, `safe`, `val`, `every1s`, `countUp`, `stagger`, `redraw`, `into` |

**C may call these components:**
- From B: `COMP.beatStrip(beat, {big, nextT})` → html; `COMP.sparkSvg(values, {w, h, t0, t1, label})` → html.
- Existing: `COMP.positionCard`, `COMP.gateRun`, `COMP.onDeck`, `COMP.punctuality`.
- Always guarded: `COMP.x ? … : placeholder`.

**Sheets:** C may open `pos`, `trade`, `name`, `cycle`, `health`, `shortlist`, `fleet` via `data-*` attributes. C adds no sheet.

**Anchors C must provide:**
- `id="overview-hero|record|traded|pace|holding|equity|health|gaterun|ondeck|strategy"`.
- B's `REDIRECT` and status act hrefs point at `overview/holding` and `overview/health`.

**What B guarantees to C:**
- `VIEWS.overview` is called only on bot pages, with `S.b` loaded.
- `#ttl` holds the bot name.
- Tab hash changes never add history entries.
- `hook('agents')` fires after each `AGENTS` (re)load. Core reloads AGENTS at boot and after each arrival.

### Interface A → B/C: fields and fallbacks for older bundles and rows

| Field (A) | Reader | Fallback when missing |
|---|---|---|
| `L.clock.bar_s` | B (`barOf`), C | `TF[L.cfg.tf]` → `TF[row.tf]` (a v1 field) → 14400 |
| `L.cfg.kind` / `row.kind` | B, C (`kindOf`) | inference (above); tile type chip "—" on v1 rows |
| `L.cfg.btc_gate` | C | hide the Bitcoin gate line |
| `L.beat` / `row.beat` | C / B | `row.beat` → `COMP.punctuality(S.b)` only; tile "heartbeat after its next check" |
| `L.act` / `row.act` | C / B | C computes the same rule from `G.trades.rows`, `L.pos`, `L.events`; tile shows "—" (never "No trades yet") |
| `L.carry[]`, `L.carry_sum` / `row.carry` | C / B | "6 pairs open · details after the next check" (`risk.n_open`); tile carry cells "—" |
| `L.tw` | C | omit the weights list; cards lead with `size_pct` |
| alert `unhedged` | B (status), C | none (no alert) |
| event types `resized`, `carry_*` | B (`word.event`), C | absent: those log rows simply don't appear |
| `G.trades.cols` `cap_ret_pct`, carry R null | C | for `kind=='carry'` rows compute `R·100` client-side and never show R |
| `row.sb` | B (`rowBundle`) | v1 status fallback (§3.9). Never "On schedule". |
| `row.since`, `wk_pct`, `spark`, `spark_t` | B | caption "since —", no sparkline |
| `row.rec.win`, `w`, `l` | B | "Won —" |
| `row.last24` | B | KPI cell "—" and excluded from sums (shown as "n of m bots reporting") |
| `row.recent` | B | that bot contributes nothing to the log |
| `row.held`, `deployed_pct`, `n_names` | B | "—" |
| `row.enabled`, `arena`, `twin_of` | B | treated as enabled / non-arena / no twin |
| `E.fleet`, `E.host`, `E.order` | B | "Kill switch —", "Server —" (muted); order = `agents[]` order |

### Merge and deploy order

1. A0 + B0 → **Deploy 0** (the daily-red and hourly-late clock fix). B0 alone is already correct through the row `tf` fallback.
2. A1 + A2 → push changes. Backward compatible with the live v1 client: row v1 types are unchanged, and the v1 client ignores `v:2`.
3. C day-0 stub → B1–B4 + C → **Deploy 1**: a Worker deploy of the new UI.

All three packages work in parallel against this contract. Each engineer regenerates a local `cloud/dev/kv.json` (gitignored) with `EXECUTOR_AGENT=<id> python3 scripts/dashboard_push.py --kv-json cloud/dev/kv.json` for each agent once A1 is on their branch. Until then they use B's committed `fx_agents_v2.json` overlay (`node cloud/dev/preview.mjs cloud/dev/kv.json 8788 --overlay cloud/dev/fx_agents_v2.json`).

---

## 10. Acceptance checklist

Statements are tested with `window.__exNow` / `--now`, against `fx_agents_v2.json` or `kv.json` built from the 06:42Z snapshot unless stated.

**Clock and status**
1. Trend (`bar_s` 86400, `last_slot` 10-01 00:00Z, `lag_med` 75, lim 180, 2 open) reads **On schedule** at 10-01 07:30Z and at 10-01 23:00Z, with "next ≈ 9:15 pm". It reads **Exits unchecked** (bad) at 10-02 03:30Z and **Stale** at 10-02 04:30Z if no new check landed.
2. Fast (`bar_s` 3600, `last_slot` 06:00Z, lag 15, lim 35) shows "next ≈ 3:15 am". It is **Due now** at 07:20Z, **Late** at 07:40Z and **Stale** at 08:00Z.
3. Core and Wide (4 h) give byte-identical `clock()` output before and after the change for any `now`.
4. The tile and the bot page show the same status word for the same bot at the same `now`: both come from `status()`, on `rowBundle(row)` and on `S.b` respectively.
5. No string "4-hour" renders on any Fast, Carry, Trend or A01 page or tile.
6. A v1 row (no `sb`) never renders "On schedule". A v1 row with `halt:true` renders "Halted".

**Master page**

7. `/` renders the Command Center. Six tiles in roster order: Core, Wide, Fast, Trend, Carry, A01 Rotation. The verdict reads "All clear · 6 of 6 bots on schedule."
8. KPIs read:
   - "6 of 6 OK";
   - "62 of 62" / "checks on time · 23 signals · 0 bought · 1 sold";
   - "6 · 6" / "positions · carry pairs · in 4 bots";
   - "−0.17%" / "drawdown 0.78% · lab, as of 12:44 am".
9. The switch row shows "Fleet running", "Market: bull since Aug 24 · lab", "Paris server · last tick 2:07 am", and exactly one ticking "Next check: Fast ≈ 3:15 am · in …".
10. At 375 × 812 the verdict, all four KPIs, the kill-switch pill and the server pill are within the first 812px with no horizontal scroll. Tiles are ≤ 240px tall (on phone row 1 and every stat caption keep one line, with an ellipsis), and 24 + 1 beads fit inside the tile.
11. When a poll returns a row with a newer `gen` and a worse status, no tile changes position. The Needs-you rail gains a row with the bot page's exact sentence.
12. Setting `E.fleet.halt` shows the bad banner, and every tile reads "Halted". A FLEET_HALT-only commit triggers `run_agents.py --fleet-only` in dashboard-sync.
13. The Carry tile shows "Pairs 6 · 1 closing · 2 evening legs", "Funding kept 34% · too early", "Capital in use 138%", status **On schedule**, and no R or "% at risk". At `--now` = ZEC stuck + 4 h 1 min (no fix), its status is **Legs uneven** (warn) with "ZEC: legs out of balance since 12:07 am, past the 3 h safety limit."
14. Core's tile reads "No trades yet". Trend's tile still reads "Bought BTC, ETH" at `--now` = 10-08 (beyond the 7-day events window).
15. The fleet log lists Fast's CRV stop raises as one collapsed row. With `ex.fl.seen` set to 11:38 pm it shows the "new" divider and a digest line.
16. Retired rows (`enabled:false`) render only inside the closed "Retired" group.

**Navigation**

17. Tapping a tile loads `/?a=<id>` as a full page. "‹ All bots" returns to the master at the same scroll position, with a one-time outline on that tile. This works through Overview → Trades → Activity hops (no history entries from tabs), and the same holds for a Needs-you row, a fleet log row, the rail roster and the fleet-health sheet's "Open bot ›".
18. `/#results` redirects to `/?a=core#results` (or to the stored `ex.agent`). `/#now` lands on `#overview`; `/#positions` lands on `#overview/holding`.
19. The second request for `/` with the returned ETag gets 304. `/api/agents` still returns `no-store`.
20. ‹ ›, the rail roster and a sheet's "Open" on a bot page replace the history entry, so Back returns to the fleet.

**Bot page**

21. Fast's Overview shows, before the Holding section: "4 · 26 more before a verdict", "1 won · 3 lost (25%)", "Best ZEC +0.24 R · Worst SOL −0.82 R", the merged trade log (AVAX, LINK, SOL, ZEC closed + CRV open), and "5 buys in 5.2 days (about 6.8 a week)".
22. Trend's page shows no funnel, no "signals", no "% at risk" and no slot count. It shows the weights list "BTC · target 36% · holding 35% · hold" and "If every stop were hit: −10.27% of pot".
23. Fast reads "If every stop were hit: +0.36% of pot (the stops have locked in gains)".
24. Carry's page shows six pair cards (ZEC and PUMP first), HYPE capture "—", overall "kept 34%", the Result cell equal to the hero's pot figure and the waterfall "funding … · price moves … (… booked, … still open) · costs … → {pot} of pot", and "Too early · judged over 2–4 weeks (day 5 of 14)".
25. A01's Strategy shows the backtest vs paper table (17.3%/yr vs +0.50%, 18.0% vs 0.21%, 100% of 26 checks, 2 of 42 days).
26. The 14-day strip buckets by the phone's local day: a fixture signal at 10-01 02:30Z appears under Sep 30 in America/Toronto.
27. Core and Wide show "—" for total R and average R (never "0.00 R"). A null win rate shows "—".

**Data, privacy, budget**

28. `scrub_assert` passes on every `exec:agents` row and on the envelope. No new key matches `FORBIDDEN_KEY`. No carry key carries a price or money amount.
29. Rows-dir push bulk-writes exactly `latest`, `ledger`, `stamp` (+ changed docs). One sync job writes `exec:agents` exactly once, and `exec:factory` only when it changed.
30. The modelled writes/day for the 6-bot schedule are ≤ 225, and for the 17-bot schedule ≤ 400.
31. `node tests/client_join_check.mjs` reports `ok:true`: the new ORDER with `fleet` and `bot`, both shells valid, the clock harness passing. `client_bytes < 420,000`.
32. Under `prefers-reduced-motion: reduce`, there are no view transitions, pulses, count-ups or bead grows, and the only change per second is the ticker's digits.