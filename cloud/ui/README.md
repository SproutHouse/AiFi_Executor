# Dashboard front end — module contract

The page script is not one file. `cloud/worker.js` joins these modules, in this order, into ONE script inside one IIFE:

```
'(function(){"use strict";' + core + gaterun + dial + now + activity + positions + results + rules + arrival + boot + '})();'
```

At join time the Worker drops the `CORE API` comment block, whole-line `//` comments, blank lines and indentation (line
breaks stay, so ASI is untouched; a module containing a backtick is joined as written), puts a `;` line between modules,
and wraps every module except core in `try { … } catch (e) { console.error(…) }`, so a throw at the top level of one
module cannot stop the ones after it (boot.js is last). Never use a template literal or a string that spans lines.

The CSS is appended in the same order: `design.js` (AiFi tokens, magenta accent) → `mission.js` (shared executor
vocabulary, spec §11–13) → `ui/<module>.css`. Wrangler imports every `ui/*.js` and `ui/*.css` as text (see
`wrangler.toml` rules); `cloud/dev/preview.mjs` does the same locally.

## Rules

1. **core.js is the only module that declares top-level names.** Every other module wraps its whole body in one block
   `{ ... }` so its private names never collide, and exports only by assigning into the registries below. The
   authoritative list of shared names and signatures is the `CORE API` comment at the top of `core.js`.
2. **Registries** (declared in core.js):
   - `VIEWS[tab] = { title, render(root, why) → html | nothing, after?(root) → cleanup?, leave?() }` for the five tabs
     `now`, `activity`, `positions`, `results`, `rules`; `why` is `'route'`, `'arrival'` or `'redraw'` (core's `redraw()`).
   - `COMP[name]` shared components. Always guard: `COMP.x ? COMP.x(...) : placeholder`. Current exports:
     - `COMP.gateRun(el, runOrT, opts)` → controller `{el, run(), play(), skip(), step(), redraw()}` (gaterun.js).
       `runOrT` null follows the shared cursor. `opts`: `autoplay` (default true), `play`, `sheet`, `bar`, `follow`.
     - `COMP.cycleBar(el?)` → html (gaterun.js).
     - `COMP.dial(el, opts?)` → cleanup function (dial.js).
     - `COMP.onDeck(el, {at, b})` → html (now.js).
     - `COMP.positionCard(p, {first})`, `COMP.ladder(p, {mini})`, `COMP.stopWords(p, {tips})`, `COMP.fitLadders(root)`
       (positions.js).
     - `COMP.punctuality(b)` → html, the Health sheet strip (activity.js).
   - `SHEETS[kind] = (arg, el) → html | {html, after?(sheetEl) → cleanup?, cls?}`, opened by ONE delegated click on the
     nearest `[data-cursor] [data-health] [data-cycle] [data-name] [data-pos] [data-trade] [data-sheet="kind:arg"]`.
     Kinds: `name` (gaterun; `data-at` = run t), `cycle` (gaterun), `pos` (positions), `trade` (results), `health`
     (core default). A module claims a click with `e.preventDefault()`.
   - Hooks: register with `hook(name, fn)` (several per name). `arrival(prev, next)`, `tick1s()`, `tick30s()`,
     `route(tab, sub)`, `theme(t)`, `hide()`, `show()`, `status(st)` (after every `refreshShell()`).
3. **Shared state** lives in core's `S`: `S.b` (the `exec:latest` bundle), `S.ledger` (lazy `exec:ledger`, via
   `loadLedger()`), `S.cursor` (the shared cycle cursor, spec §5, set with `setCursor(t, opts)`, followed with
   `onCursor(fn)`), `S.tab`, `S.sub`, `S.prev` (the previous bundle, for arrival diffs), `S.st` (the current `status()`).
   Time comes from `nowMs()` / `nowS()` so tests can override it (`window.__exNow`).
4. **Shared helpers from core** every module should use rather than re-implement: `esc`, `$`, `$$`, `num`, `isObj`,
   `cap1`, `fmt.*` (spec §14), `val()/na()/safe()` for missing data (spec §1.8), `STAGE`/`GATES` (spec §12),
   `GLOSS` + `tip(key)`, `word.*`, `chip()`, `icon()`, `openSheet()`, `closeSheet()`, `stagger()`, `countUp()`,
   `reduced`, `setSeg()/initSegs()`, `masks()`, `mdTables()` (markdown tables into a disclosure), `getJSON()`, `loadLedger()`, `loadLWC()` (lazy lightweight-charts),
   `every1s()`, `toast()`, `setPlay()`, `refreshShell()`.
5. **Anchors.** `route()` scrolls to `id="<tab>-<sub>"`: `now-gaterun`, `now-ondeck`, `now-holding`, `now-latest`,
   `activity-heartbeat|timeline|signals|outcomes|tape|readings` (`#refused` lands on `activity-signals`),
   `positions-risk|books|approval`, `results-verdict|curve|record|r|trades|review|sweeps`, `rules-glossary/<key>`.
6. **CSS.** Shared, un-prefixed classes and the `.st-*` vocabulary live in `cloud/mission.js`. A module's own classes live
   in its `ui/<module>.css` and carry its prefix: now `nw-`, gaterun `gr-`, dial `dl-`, activity `ac-`, positions `ps-`,
   results `rs-`, rules `ru-`, arrival `ar-`. Use design tokens (`var(--…)`) only; no raw colours except where
   `design.js` itself uses them. design.js still defines bare `.deck`, `.plan`, `.setup` and `.trend .tl`: do not reuse
   those names.
7. **localStorage keys**, never trusted to exist: `ex.seenEv`, `ex.seen`, `ex.gr`, `ex.nw.R`, `ex.r.<pos id>` (JSON,
   through `lsGet`/`lsSet`), and `aifi.theme` (a raw string, shared with AiFi and the pre-paint script).
8. **Honesty rules** (spec §1) apply everywhere: motion only for real clock, a recorded check arriving, or the owner's
   action; words first; only R and % of pot; phone-local times; missing is "—", never zero; magenta tiers.
