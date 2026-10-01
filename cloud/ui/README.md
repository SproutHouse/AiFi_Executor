# Dashboard front end — module contract

The page script is not one file. `cloud/worker.js` joins these modules, in this order, into ONE script inside one IIFE:

```
'(function(){"use strict";' + core + gaterun + now + activity + positions + results + rules + arrival + factory + fleet + bot + boot + '})();'
```

At join time the Worker drops the `CORE API` comment block, whole-line `//` comments, blank lines and indentation (line
breaks stay, so ASI is untouched; a module containing a backtick is joined as written), puts a `;` line between modules,
and wraps every module except core in `try { … } catch (e) { console.error(…) }`, so a throw at the top level of one
module cannot stop the ones after it (boot.js is last). Never use a template literal or a string that spans lines.

The CSS is appended in the same order: `design.js` (AiFi tokens, magenta accent) → `mission.js` (shared executor
vocabulary, spec §11–13) → `ui/<module>.css` (gaterun, now, activity, positions, results, rules, arrival, factory, fleet, bot).

## Pages (docs/COMMAND_CENTER_SPEC.md §2)

The Worker serves one bundle into two shells, chosen by `?a`: `/` is the **Command Center** (`PAGE === 'fleet'`,
`AGENT === null`, `data-view="fleet"`, view `VIEWS.fleet`, data `/api/agents` + `/api/factory`, no bundle: `S.b` stays
null) and `/?a=<id>` is **one bot's page** (`PAGE === 'bot'`, `data-view="bot"`, tabs `overview` (bot.js), `results`
(labelled Trades), `activity`, `rules`). Both shells carry every mount (`#capsule` the only aria-live, `#modepill`,
`#railstat`, `#ttl` the one h1, `#roster`, `#alerts`, `#view`, `#sheet`/`#sheetbg`, `#toast`, `#app`); the bot page adds
`#back` ("‹ All bots", `[data-back]` → `goFleet()`) and the four-tab bar. An invalid `?a` is a 302 to `/`. The shell HTML
is `private, no-cache` with a sha-256 ETag (a 304 only after the auth check). Moving between bots is a full page load,
so no module state ever carries one bot's numbers into another. On a bot page every same-page hash link is
`history.replaceState` + `route()`: tabs add no history entries, so Back always means "All bots". An old `/#tab` link is
sent on (before boot) to `/?a=<stored ex.agent or core>#<new tab>`. Wrangler imports every `ui/*.js` and `ui/*.css` as text (see
`wrangler.toml` rules); `cloud/dev/preview.mjs` does the same locally.

## Rules

1. **core.js is the only module that declares top-level names.** Every other module wraps its whole body in one block
   `{ ... }` so its private names never collide, and exports only by assigning into the registries below. The
   authoritative list of shared names and signatures is the `CORE API` comment at the top of `core.js`.
2. **Registries** (declared in core.js):
   - `VIEWS[tab] = { title, render(root, why) → html | nothing, after?(root) → cleanup?, leave?() }` for the bot page's
     tabs `overview` (bot.js), `results`, `activity`, `rules`, and `VIEWS.fleet` (the master); `why` is `'route'`,
     `'arrival'` or `'redraw'` (core's `redraw()`). A missing view renders a quiet placeholder.
   - `COMP[name]` shared components. Always guard: `COMP.x ? COMP.x(...) : placeholder`. Current exports:
     - `COMP.gateRun(el, runOrT, opts)` → controller `{el, run(), play(), skip(), step(), redraw()}` (gaterun.js).
       `runOrT` null follows the shared cursor. `opts`: `autoplay` (default true), `play`, `sheet`, `bar`, `follow`.
     - `COMP.cycleBar(el?)` → html (gaterun.js).
     - `COMP.onDeck(el, {at, b})` → html (now.js, which now holds only On deck). Any element with `[data-ondeck]` is
       redrawn when the shared cursor moves.
     - `COMP.positionCard(p, {first})`, `COMP.ladder(p, {mini})`, `COMP.stopWords(p, {tips})`, `COMP.fitLadders(root)`
       (positions.js).
     - `COMP.punctuality(b)` → html, the Health sheet strip (activity.js).
     - `COMP.beatStrip(beat, {big, nextT, bar, lim, fresh})` → html, the heartbeat strip of a `{s0, n, k}` beat;
       `COMP.beat24(beat, {bar, lim, now})` → `{on, slots, late, missed, failed}` over the last 24 h of that same extended
       beat (a close missed since the push counts as soon as it is past its late limit), or null: every "last 24 h" count;
       `COMP.sparkSvg(values, {w, h, t0, t1, label})` → html, the pot sparkline (numbers or `[t, v]` pairs);
       `COMP.roster()` → html, the rail's mini roster; `COMP.fleetSummary()` (master only) and `COMP.fleetLoading()`
       (fleet.js).
   - `SHEETS[kind] = (arg, el) → html | {html, after?(sheetEl) → cleanup?, cls?}`, opened by ONE delegated click on the
     nearest `[data-cursor] [data-health] [data-cycle] [data-name] [data-pos] [data-trade] [data-sheet="kind:arg"]`.
     Kinds: `name` (gaterun; `data-at` = run t), `cycle` (gaterun), `pos` (positions), `trade` (results), `health`
     (core default), `shortlist` and `fleet` (factory), `fleethealth` (fleet.js; the master's capsule opens it).
     A module claims a click with `e.preventDefault()`.
   - Hooks: register with `hook(name, fn)` (several per name). `arrival(prev, next)` (bot page), `tick1s()`, `tick30s()`,
     `route(tab, sub)`, `theme(t)`, `hide()`, `show()`, `status(st)` (after every `refreshShell()`), `agents(rows, env)`
     (after every `/api/agents` load: boot, each bot-page arrival, each master poll).
3. **Shared state** lives in core's `S`: `S.E` (the `exec:agents` envelope; its rows are `AGENTS`, one by `rowOf(id)`),
   `S.b` (the `exec:latest` bundle, bot pages only), `S.ledger` (lazy `exec:ledger`, via
   `loadLedger()`), `S.cursor` (the shared cycle cursor, spec §5, set with `setCursor(t, opts)`, followed with
   `onCursor(fn)`), `S.tab`, `S.sub`, `S.prev` (the previous bundle, for arrival diffs), `S.st` (the current `status()`).
   Time comes from `nowMs()` / `nowS()` so tests can override it (`window.__exNow`).
4. **Shared helpers from core** every module should use rather than re-implement: `esc`, `$`, `$$`, `num`, `isObj`,
   `cap1`, `fmt.*` (spec §14), `val()/na()/safe()` for missing data (spec §1.8), `STAGE`/`GATES` (spec §12),
   `GLOSS` + `tip(key)`, `word.*`, `chip()`, `icon()`, `openSheet()`, `closeSheet()`, `stagger()`, `countUp()`,
   `reduced`, `setSeg()/initSegs()`, `masks()`, `mdTables()` (markdown tables into a disclosure), `getJSON()`, `loadLedger()`, `loadLWC()` (lazy lightweight-charts),
   `every1s()`, `toast()`, `setPlay()`, `refreshShell()`; and for pages and bars: `PAGE`, `AGENT`, `BAR` (this bot's bar,
   set in `start()`), `barOf(b)`, `kindOf(b)`/`kindInfo(b)`, `rowBundle(row)`, `word.bar()`/`word.every()`/
   `word.kindName(kind, bar_s)`, `botHref(id, hash?)`, `goFleet()`, `botStep(±1)`, `loadAgents()`, `loadFactory(force?)`.
   Never write "4-hour" into a sentence: a bot may check hourly or daily; say `word.bar()` (or `word.every()`).
5. **Anchors.** `route()` scrolls to `id="<tab>-<sub>"` (and opens it when it is a `details`):
   `overview-hero|record|traded|pace|holding|equity|health|gaterun|ondeck|strategy` (bot.js),
   `activity-heartbeat|timeline|signals|outcomes|tape|readings` (`#refused` lands on `activity-signals`),
   `results-verdict|curve|record|r|trades|review|sweeps`, `rules-glossary/<key>`. The old tabs redirect: `#now` →
   `#overview`, `#positions` and `#book` → `#overview/holding`, `#trades` → `#results`, `#logic/x` → `#rules/x`.
6. **CSS.** Shared, un-prefixed classes and the `.st-*` vocabulary live in `cloud/mission.js`. A module's own classes live
   in its `ui/<module>.css` and carry its prefix: now `nw-`, gaterun `gr-`, activity `ac-`, positions `ps-`,
   results `rs-`, rules `ru-`, arrival `ar-`, factory `fx-`, fleet `fl-` (also the shells' own bits), bot `bt-`. Use design tokens (`var(--…)`) only; no raw colours except where
   `design.js` itself uses them. design.js still defines bare `.deck`, `.plan`, `.setup` and `.trend .tl`: do not reuse
   those names.
7. **localStorage keys**, never trusted to exist: `ex.seenEv`, `ex.seen`, `ex.gr`, `ex.nw.R`, `ex.r.<pos id>` (per bot),
   `ex.fl.sort`, `ex.fl.f`, `ex.fl.dense`, `ex.fl.seen`, `ex.fl.n` (the master) (JSON, through `lsGet`/`lsSet`), `ex.agent`
   (read once by the legacy redirect, never written), and `aifi.theme` (a raw string, shared with AiFi and the pre-paint
   script). sessionStorage (through `ssGet`/`ssSet`): `ex.fl.from`, `ex.fl.y`, `ex.fl.last` (master → bot → back).
8. **Honesty rules** (spec §1) apply everywhere: motion only for real clock, a recorded check arriving, or the owner's
   action; words first; only R and % of pot; phone-local times; missing is "—", never zero; magenta tiers.
