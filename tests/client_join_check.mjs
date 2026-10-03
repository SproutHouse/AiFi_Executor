// tests/client_join_check.mjs — build the dashboard the way the Worker serves it and check the joined client.
// Run by tests/test_dashboard_client.py (node required); prints one JSON line {ok, problems[], facts{}}.
// It loads cloud/worker.js exactly as cloud/dev/preview.mjs does (ui/*.js and *.css imported as text) against an
// in-memory KV, then checks: the ui/ module contract (core declares the names, every other module is one block,
// no template literals), that the joined page script compiles, both app shells (the Command Center at "/" and a bot
// page at "/?a=<id>": one h1, every mount, one aria-live, data-view), the shell's ETag and 304, the redirect of a bad
// ?a, that doc and login pages never carry the app bundle, and that /api/ledger turns the review markdown into html.
// Then a clock harness runs ui/core.js in a vm context with DOM stubs and checks the per-bar clock rule
// (COMMAND_CENTER_SPEC §6.7 and §10 items 1–3, 5, 6) at bars of 1 h, 4 h and 1 d.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cloud = path.resolve(here, "..", "cloud");
const problems = [];
const facts = {};
const bad = (m) => problems.push(m);

// ------------------------------------------------------------------ module contract (source files) --
const ORDER = ["core", "gaterun", "now", "activity", "positions", "results", "rules", "arrival", "factory", "fleet", "bot", "boot"];
// The AiFi Lab page ("/lab", COMMAND_CENTER_SPEC §11) joins its own bundle: core + lab + boot.
const LAB_ORDER = ["core", "lab", "boot"];
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").trim();
for (const n of [...ORDER, "lab"]) {
  const p = path.join(cloud, "ui", n + ".js");
  if (!fs.existsSync(p)) { bad(`ui/${n}.js is missing`); continue; }
  const src = fs.readFileSync(p, "utf8");
  try { new vm.Script(src, { filename: `ui/${n}.js` }); } catch (e) { bad(`ui/${n}.js does not compile: ${e.message}`); }
  const c = code(src);
  if (c.includes("`")) bad(`ui/${n}.js has a template literal (the Worker's join keeps lines, not backticks)`);
  if (n !== "core" && !(c.startsWith("{") && c.endsWith("}"))) bad(`ui/${n}.js is not one block { ... } (only core.js may declare top-level names)`);
  if (!fs.existsSync(path.join(cloud, "ui", n + ".css")) && !["core", "boot"].includes(n)) bad(`ui/${n}.css is missing`);
}

// ------------------------------------------------------------------ the Worker, as preview.mjs runs it --
const out = fs.mkdtempSync(path.join(os.tmpdir(), "exec-join-"));
fs.writeFileSync(path.join(out, "package.json"), '{"type":"module"}');
const copy = (d, rel = "") => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name), r = rel ? rel + "/" + f.name : f.name;
    if (f.isDirectory()) { if (f.name !== "dev" && f.name !== ".wrangler") { fs.mkdirSync(path.join(out, r), { recursive: true }); copy(p, r); } continue; }
    if (!/\.(js|css)$/.test(f.name)) continue;
    const src = fs.readFileSync(p, "utf8");
    if (r.startsWith("ui/") || f.name.endsWith(".css")) fs.writeFileSync(path.join(out, f.name.endsWith(".css") ? r + ".js" : r), "export default " + JSON.stringify(src) + ";\n");
    else fs.writeFileSync(path.join(out, r), src.replace(/(\bfrom\s*["'][^"']+\.css)(["'])/g, "$1.js$2"));
  }
};
copy(cloud);
const W = (await import(pathToFileURL(path.join(out, "worker.js")).href)).default;
const PW = "check";
const exp = Math.floor(Date.now() / 1000) + 3600;
const cookie = "ex=" + exp + "." + crypto.createHmac("sha256", PW).update("exec|" + exp).digest("hex");
const KV = {
  "exec:lab:day:2026-10-02": '{"v":1,"date":"2026-10-02","trials":[]}',
  "exec:ledger": JSON.stringify({ v: 2, review: { date: "2026-09-20", md: "# Review\n\n1. one\n   wrapped\n2. two" } }),
  "doc:how_it_works": "# How it works\n\n1. first\n   still first\n2. second\n3. third",
};
const env = { DASHBOARD_PASSWORD: PW, EXEC: { get: async (k) => (k in KV ? KV[k] : null), put: async () => {} } };
const get = async (p, auth = true) => W.fetch(new Request("http://localhost" + p, { headers: auth ? { cookie } : {} }), env);

const get2 = async (p, headers = {}) => W.fetch(new Request("http://localhost" + p, { headers: { cookie, ...headers } }), env);
const shells = {};
for (const [p, view] of [["/", "fleet"], ["/?a=core", "bot"], ["/?a=fast-1h", "bot"]]) {
  const r = await get(p);
  const t = await r.text();
  shells[p] = { r, t };
  if (r.status !== 200) { bad(`${p} returned ${r.status}`); continue; }
  const h1s = (t.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) bad(`${p}: the app page has ${h1s} h1 elements, not 1`);
  for (const id of ["capsule", "railstat", "modepill", "ttl", "roster", "alerts", "view", "sheet", "sheetbg", "toast", "app"]) if (!t.includes(`id="${id}"`)) bad(`${p}: the app shell has no #${id}`);
  if ((t.match(/aria-live=/g) || []).length !== 1) bad(`${p}: the capsule must be the only aria-live region`);
  if (!t.includes(`data-view="${view}"`) || t.includes(`data-view="${view === "bot" ? "fleet" : "bot"}"`)) bad(`${p}: data-view is not "${view}"`);
  if (view === "bot" && !/<a[^>]*id="back"[^>]*data-back/.test(t)) bad(`${p}: the bot page has no "‹ All bots" (#back[data-back])`);
  if (view === "bot" && (t.match(/data-tab="/g) || []).length !== 8) bad(`${p}: expected the 4 tabs in the rail and the tab bar`);
  if (view === "fleet" && /class="tabbar/.test(t)) bad("/: the Command Center has no tab bar");
  if (r.headers.get("cache-control") !== "private, no-cache") bad(`${p}: cache-control is ${r.headers.get("cache-control")}, not "private, no-cache"`);
  if (!/^"[0-9a-f]{64}"$/.test(r.headers.get("etag") || "")) bad(`${p}: no sha-256 ETag`);
}
if (shells["/"].r.headers.get("etag") === shells["/?a=core"].r.headers.get("etag")) bad("the two shells share one ETag");
if (shells["/?a=core"].t !== shells["/?a=fast-1h"].t) bad("bot pages for different bots should share one shell");
const page = shells["/"].t, app = shells["/"].r;
facts.page_bytes = Buffer.byteLength(page);
const etag = app.headers.get("etag");
const r304 = await get2("/", { "if-none-match": etag });
if (r304.status !== 304) bad(`a matching If-None-Match on / returned ${r304.status}, not 304`);
const r304b = await get2("/?a=wide-4h", { "if-none-match": 'W/' + shells["/?a=core"].r.headers.get("etag") });
if (r304b.status !== 304) bad(`a matching (weak) If-None-Match on a bot page returned ${r304b.status}, not 304`);
const r200 = await get2("/", { "if-none-match": '"nope"' });
if (r200.status !== 200) bad(`a stale If-None-Match returned ${r200.status}, not 200`);
const r401 = await W.fetch(new Request("http://localhost/", { headers: { "if-none-match": etag } }), env);
if (r401.status === 304) bad("a 304 was answered before the auth check");
const badA = await get("/?a=Bad!");
if (badA.status !== 302 || badA.headers.get("location") !== "http://localhost/") bad(`/?a=Bad! returned ${badA.status} → ${badA.headers.get("location")}, not a 302 to /`);
const ag = await get("/api/agents");
if (ag.headers.get("cache-control") !== "no-store") bad(`/api/agents cache-control is ${ag.headers.get("cache-control")}, not no-store`);
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const client = scripts.find((s) => s.startsWith('(function(){"use strict";'));
if (!client) bad("the app page carries no joined client script");
else {
  facts.client_bytes = Buffer.byteLength(client);
  try { new vm.Script(client, { filename: "joined-client.js" }); } catch (e) { bad("the joined client does not compile: " + e.message); }
  if (client.includes("CORE API")) bad("the CORE API comment block reached the page");
  const guards = (client.match(/\.js did not load'/g) || []).length;
  if (guards !== ORDER.length - 1) bad(`expected ${ORDER.length - 1} guarded modules, found ${guards}`);
  for (const n of ORDER) if (!client.includes("/* ui/" + n + ".js */")) bad(`ui/${n}.js is not in the joined client`);
  const at = ORDER.map((n) => client.indexOf("/* ui/" + n + ".js */"));
  if (at.some((v, i) => i && v < at[i - 1])) bad("modules are not joined in the README order");
  if (/<\/script/i.test(client)) bad("the client contains an unescaped </script");
}
for (const p of ["/doc/how_it_works", "/login"]) {
  const r = await get(p, p !== "/login");
  const t = await r.text();
  if (t.includes('(function(){"use strict";')) bad(`${p} carries the app bundle`);
  if (p === "/doc/how_it_works" && !t.includes('<a class="btn" href="/">Dashboard</a>')) bad("the doc page's Dashboard button does not point to /");
  if (p === "/doc/how_it_works" && !/<ol>\s*<li>first still first<\/li>\s*<li>second<\/li>\s*<li>third<\/li>\s*<\/ol>/.test(t)) bad("md(): a wrapped list line did not stay in its item");
}
const L = await (await get("/api/ledger")).json();
if (!L.review || typeof L.review.html !== "string" || "md" in L.review) bad("/api/ledger did not turn review.md into review.html");
const miss = await get("/api/latest");
if (miss.status !== 404) bad(`/api/latest without data returned ${miss.status}, not 404`);
const unauth = await get("/api/latest", false);
if (unauth.status !== 401) bad(`/api/latest without a cookie returned ${unauth.status}, not 401`);
const st = await (await get("/api/stamp")).text();
if (st !== "{}") bad(`/api/stamp without data returned ${st}, not {}`);
for (const gone of ["/api/dates", "/api/day"]) if ((await get(gone)).status !== 404) bad(`${gone} still answers`);
// the AiFi Lab page: its own shell and bundle, and the lab's two routes (§11)
{
  const r = await get("/lab"), t = await r.text();
  if (r.status !== 200) bad(`/lab returned ${r.status}`);
  if ((t.match(/<h1[\s>]/g) || []).length !== 1) bad("/lab: the lab page has not exactly one h1");
  for (const id of ["ttl", "view", "sheet", "sheetbg", "toast", "app"]) if (!t.includes(`id="${id}"`)) bad(`/lab: the lab shell has no #${id}`);
  if (!t.includes('data-view="lab"')) bad('/lab: data-view is not "lab"');
  if ((t.match(/aria-live=/g) || []).length > 1) bad("/lab: more than one aria-live region");
  if (r.headers.get("cache-control") !== "private, no-cache" || !/^"[0-9a-f]{64}"$/.test(r.headers.get("etag") || "")) bad("/lab: not cached like the other shells");
  const lab = [...t.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.startsWith('(function(){"use strict";'));
  if (!lab) bad("/lab carries no joined client script");
  else {
    facts.lab_client_bytes = Buffer.byteLength(lab);
    try { new vm.Script(lab, { filename: "joined-lab-client.js" }); } catch (e) { bad("the lab client does not compile: " + e.message); }
    const at = LAB_ORDER.map((n) => lab.indexOf("/* ui/" + n + ".js */"));
    if (at.some((v) => v < 0) || at.some((v, i) => i && v < at[i - 1])) bad("the lab client is not core + lab + boot, in that order");
    if (lab.includes("/* ui/fleet.js */") || lab.includes("/* ui/bot.js */")) bad("the lab client carries the Command Center's modules");
  }
  if (client && client.includes("/* ui/lab.js */")) bad("the Command Center's client carries the lab module");
  if (!page.includes('href="/lab"')) bad("the Command Center does not link the AiFi Lab page");
  const miss = await get("/api/lab");
  if (miss.status !== 404) bad(`/api/lab without data returned ${miss.status}, not 404`);
  const d0 = await get("/api/lab/day?d=2026-10-02");
  if (d0.status !== 200 || (await d0.json()).date !== "2026-10-02") bad("/api/lab/day did not return the stored day");
  for (const q of ["", "?d=2026-13-01", "?d=26-10-02", "?d=2026-10-02x", "?d=..%2Fexec:agents"]) {
    const x = await get("/api/lab/day" + q);
    if (x.status !== 400) bad(`/api/lab/day${q} returned ${x.status}, not 400`);
  }
  if ((await get("/api/lab/day?d=2026-01-01")).status !== 404) bad("/api/lab/day for a day without a record is not 404");
  if ((await get("/api/lab", false)).status !== 401) bad("/api/lab without a cookie is not 401");
}
fs.rmSync(out, { recursive: true, force: true });

// ------------------------------------------------------------------ the clock harness (core.js in a vm) --
function coreContext(search, pathname) {
  const store = {}, ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const el = { dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} };
  const ctx = {
    console, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { documentElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    location: { search, hash: "", pathname: pathname || "/", href: "http://localhost" + (pathname || "/") + search, replace() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: ls, sessionStorage: ls, history: { replaceState() {}, back() {} }, addEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(cloud, "ui", "core.js"), "utf8"), ctx, { filename: "ui/core.js" });
  return ctx;
}
try {
  const C = coreContext("?a=fast-1h");
  const run = (src) => vm.runInContext(src, C);
  const T = (iso) => Date.parse(iso) / 1000;
  const bundle = (o) => ({ v: 2, gen: "2026-10-01T06:42:54Z", clock: o.clock, cfg: { late_min: o.lim, thr: [10, 20] },
    state: { halt: { set: false, reason: null, since: null }, thr: { state: "normal", mult: 1, dd_pct: 0 }, last: { t: o.clock.last_t, fresh: true, failed: false, late_min: 6, abort: null } },
    mode: { eff: "paper", req: "paper", note: "" }, alerts: o.alerts || [], risk: { n_open: o.n_open || 0 }, runs: [] });
  C.__b = null;
  const at = (b, iso) => { C.__b = b; C.__t = T(iso); return run("(function(){ const s = status(__b, __t); return { word: s.word, lvl: s.lvl, phase: s.K.phase, next: s.K.next }; })()"); };
  const expect = (what, got, want) => { if (got !== want) bad(`clock: ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  // §10.2 Fast: bar 1 h, last slot 06:00Z, lag 15, limit 35
  const fast = bundle({ clock: { last_t: T("2026-10-01T06:05:45Z"), last_slot: T("2026-10-01T06:00:00Z"), late_min: 6, lag_med_min: 15, lag_rng: [6, 24], lag_n: 42, limit_min: 35, sched_min: 5, bar_s: 3600 }, lim: 35, n_open: 1 });
  expect("Fast next", at(fast, "2026-10-01T06:42:54Z").next, T("2026-10-01T07:15:00Z"));
  expect("Fast at 06:42Z", at(fast, "2026-10-01T06:42:54Z").word, "On schedule");
  expect("Fast at 07:20Z", at(fast, "2026-10-01T07:20:00Z").word, "Due now");
  expect("Fast at 07:40Z", at(fast, "2026-10-01T07:40:00Z").word, "Late");
  expect("Fast at 08:00Z", at(fast, "2026-10-01T08:00:00Z").word, "Stale");
  // §10.1 Trend: bar 1 d, last slot 10-01 00:00Z, lag 75, limit 180, 2 open
  const trend = bundle({ clock: { last_t: T("2026-10-01T02:06:41Z"), last_slot: T("2026-10-01T00:00:00Z"), late_min: 127, lag_med_min: 75, lag_rng: [8, 135], lag_n: 15, limit_min: 180, sched_min: 5, bar_s: 86400 }, lim: 180, n_open: 2 });
  expect("Trend at 07:30Z", at(trend, "2026-10-01T07:30:00Z").word, "On schedule");
  expect("Trend at 23:00Z", at(trend, "2026-10-01T23:00:00Z").word, "On schedule");
  expect("Trend next", at(trend, "2026-10-01T23:00:00Z").next, T("2026-10-02T01:15:00Z"));
  const ex = at(trend, "2026-10-02T03:30:00Z");
  expect("Trend at 10-02 03:30Z", ex.word + "/" + ex.lvl, "Exits unchecked/bad");
  expect("Trend at 10-02 04:30Z", at(trend, "2026-10-02T04:30:00Z").word, "Stale");
  // §10.3 Core and Wide (4 h): byte-identical to the clock before the per-bar rule, for any now
  run("function __oldClock(b, now) { const k = clockOf(b), lim = limOf(b); if (!k || k.last_slot == null || k.last_t == null) return { phase: 'none', now, lim, lag: 20, C: null, next: null, nOpen: nOpen(b), exits: false };"
    + " const lag = (k.lag_n != null && k.lag_n < 3) ? 20 : (numv(k.lag_med_min) ?? 20); const C = k.last_slot + 14400, next = Math.round(C + lag * 60), lateAt = C + lim * 60, staleAt = C + 14400, exitsAt = C + 7200;"
    + " const phase = now < next ? 'countdown' : now < lateAt ? 'due' : now < staleAt ? 'late' : 'stale'; const n = nOpen(b);"
    + " return { phase, now, C, lag, lim, next, lateAt, staleAt, exitsAt, sched: C + (numv(k.sched_min) ?? 5) * 60, lastT: k.last_t, lastSlot: k.last_slot,"
    + " age: now - k.last_t, over: now - C, toNext: next - now, rng: Array.isArray(k.lag_rng) ? k.lag_rng : null, lagN: k.lag_n ?? null, nOpen: n, exits: phase === 'late' && now >= exitsAt && n > 0 }; }");
  const core4 = bundle({ clock: { last_t: T("2026-10-01T04:05:45Z"), last_slot: T("2026-10-01T04:00:00Z"), late_min: 6, lag_med_min: 17, lag_rng: [6, 27], lag_n: 41, limit_min: 45, sched_min: 5, bar_s: 14400 }, lim: 45, n_open: 2 });
  const wide4 = JSON.parse(JSON.stringify(core4)); delete wide4.clock.bar_s; wide4.cfg.late_min = 200; wide4.clock.lag_n = 2;
  const v1 = { last_run: { t: "2026-10-01T04:05:45Z", fresh: true, failed: false }, positions: { BTC: {} } };
  let diff = 0, n = 0;
  C.__AG = [{ id: "fast-1h", tf: "4h" }];                             // the row fallback must say 4 h here, not 1 h
  run("AGENTS = __AG");
  for (const b of [core4, wide4, v1]) for (let t = T("2026-10-01T03:00:00Z"); t < T("2026-10-02T03:00:00Z"); t += 397) {
    C.__b = b; C.__t = t; n++;
    if (run("JSON.stringify(clock(__b, __t))") !== run("JSON.stringify(__oldClock(__b, __t))")) diff++;
  }
  if (diff) bad(`clock: ${diff} of ${n} 4-hour clocks differ from the clock before the per-bar rule`);
  facts.clock_4h_compared = n;
  // barOf fallback chain: clock.bar_s → cfg.tf → the exec:agents row's tf → 4 h
  C.__AG = [{ id: "fast-1h", tf: "1h" }]; run("AGENTS = __AG");
  C.__b = { clock: { last_t: 1, last_slot: 0 }, cfg: { tf: "1d" } }; expect("barOf(cfg.tf)", run("barOf(__b)"), 86400);
  C.__b = { clock: { last_t: 1, last_slot: 0 }, cfg: {} }; expect("barOf(row tf)", run("barOf(__b)"), 3600);
  run("AGENTS = []"); expect("barOf(default)", run("barOf(__b)"), 14400);
  // A v1 row never reads "On schedule"; a fleet halt makes every row "Halted" (§3.9, §10.6, §10.12)
  expect("rowBundle(v1 row)", run("rowBundle({ id: 'core', tf: '4h', halt: true })"), null);
  C.__row = { id: "fast-1h", tf: "1h", gen: "x", sb: { clock: fast.clock, state: fast.state, cfg: fast.cfg, mode: fast.mode, alerts: [], risk: { n_open: 1 } } };
  C.__E = { fleet: { halt: true, reason: "drawdown", since: 1790830000 } };
  C.__t = T("2026-10-01T06:42:54Z");
  expect("fleet halt", run("status(rowBundle(__row, __E), __t).word"), "Halted");
  expect("row status = bundle status", run("status(rowBundle(__row, {}), __t).word"), at(fast, "2026-10-01T06:42:54Z").word);
  // The unhedged warn alert reads "Legs uneven" (§7)
  const carry = bundle({ clock: { ...fast.clock }, lim: 50, n_open: 6, alerts: [{ lv: "warn", k: "unhedged", t: T("2026-10-01T04:07:00Z"), c: "ZEC", text: "ZEC: legs out of balance since {time}, past the 3 h safety limit." }] });
  expect("unhedged warn", at(carry, "2026-10-01T06:42:54Z").word, "Legs uneven");
  // §10.5: no "4-hour" in the words a 1 h bot's page is built from (glossary, gate labels, kinds, exits)
  C.__b = fast;
  run("S.b = __b; BAR = barOf(__b); barWords()");
  const words = run("JSON.stringify([Object.keys(GLOSS).map(k => { const g = gloss(k); return g.t + ' ' + g.d; }), STAGE.n.w, GATES.map(g => g.label), KIND.flip, EXIT.h4, word.bar(), word.every(), word.kindName('flip', 3600)])");
  if (/4-hour|4 hours/.test(words)) bad("clock: a 1 h bot's vocabulary still says 4-hour: " + (words.match(/[^"]{0,40}4.hour[^"]{0,40}/) || [""])[0]);
  expect("word.bar(1 h)", run("word.bar()"), "hourly");
  expect("word.every(1 d)", run("word.every({ clock: { bar_s: 86400 } })"), "every day");
  expect("word.kindName", run("word.kindName('carry', 3600)"), "Funding collector · hourly");
  // routing helpers
  expect("PAGE on ?a=", run("PAGE + '/' + AGENT"), "bot/fast-1h");
  expect("botHref", run("botHref('trend-1d', '#overview/holding')"), "/?a=trend-1d#overview/holding");
  const M = coreContext("");
  expect("PAGE on /", vm.runInContext("PAGE + '/' + AGENT", M), "fleet/null");
  facts.clock_harness = "ran";
} catch (e) {
  bad("the clock harness threw: " + (e && e.stack || e));
}

// ------------------------------------------------------------------ hover tips and the Bot factory (core + fleet in a vm) --
// COMMAND_CENTER_SPEC §3.7 and §3.11: every tip key has plain words (no "undefined", "NaN" or money), every status word
// the engine can show has its own explanation, and the factory section renders the lab's full payload, an older one (no
// funnel / last / studies: "—", never 0), an unknown family, and none at all. The texts go to facts for
// tests/test_dashboard_client.py.
try {
  const C = coreContext("");
  vm.runInContext(fs.readFileSync(path.join(cloud, "ui", "fleet.js"), "utf8"), C, { filename: "ui/fleet.js" });
  const run = (src) => vm.runInContext(src, C);
  const text = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const T = (iso) => Date.parse(iso) / 1000;
  C.__exNow = Date.parse("2026-10-02T15:00:00Z");
  const clk = { last_t: T("2026-10-02T12:06:00Z"), last_slot: T("2026-10-02T12:00:00Z"), late_min: 6, lag_med_min: 15, lag_rng: [6, 24], lag_n: 42, limit_min: 45, sched_min: 5, bar_s: 14400 };
  const sb = { clock: clk, state: { halt: { set: false }, thr: { state: "normal", dd_pct: 1 }, last: { t: clk.last_t, fresh: true, failed: false } }, cfg: { late_min: 45, thr: [10, 20] }, mode: { eff: "paper", req: "paper" }, alerts: [], risk: { n_open: 0 } };
  C.__E = { v: 2, gen: "2026-10-02T12:10:00Z", fleet: { halt: false }, order: ["core", "old"], agents: [
    { id: "core", name: "Core", kind: "flip", bar_s: 14400, mode: "paper", desc: "Trades big coins every 4 hours.", gen: "x", sb },
    { id: "old", name: "Old", tf: "4h", last_t: T("2026-10-02T12:06:00Z") }] };
  run("S.E = __E; AGENTS = __E.agents");
  // every key: a title and a sentence in plain words
  const keys = JSON.parse(run("JSON.stringify(Object.keys(TIP))"));
  const ARGS = { st: "core", verdict: "ok", name: "core", kind: "core", mode: "paper", kill: "run", server: "Paris server", sort: "roster", fx: "tested", fam: "rs_rotation", sec: "record", beads: "18/18" };
  const empty = [], dirty = [];
  for (const k of keys) {
    C.__k = k + (ARGS[k] ? ":" + ARGS[k] : "");
    const t = text(run("tipText(__k, null)"));
    if (!t) empty.push(C.__k); else if (/undefined|NaN|\$|null/.test(t)) dirty.push(C.__k + " → " + t);
  }
  if (empty.length) bad("tips without words: " + empty.join(", "));
  if (dirty.length) bad("tips with broken words: " + dirty.join(" | "));
  // every status word status() and the master can show: a sentence of its own, never the generic fallback
  const STK = ["ok", "due", "late_now", "stale", "exits", "failed", "halt", "thr_halt", "thr_half", "late", "fallback", "unhedged", "exit_slow", "none", "v1"];
  C.__K = { phase: "late", C: T("2026-10-02T12:00:00Z"), next: T("2026-10-02T16:15:00Z"), lateAt: T("2026-10-02T12:45:00Z"), lastT: clk.last_t, age: 9 * 3600, lim: 45, rng: [6, 24] };
  const generic = run("stTip({ k: 'zzz', word: 'Check', lvl: 'warn', K: __K }, null, AGENTS[0])[1]");
  const words = {};
  for (const k of STK) {
    C.__st = { k, word: k, lvl: "warn", K: C.__K };
    const t = run("stTip(__st, null, AGENTS[0])[1]");
    words[k] = t;
    if (!t || t === generic || /undefined|NaN|null/.test(t)) bad("status word " + k + " has no tip of its own: " + t);
  }
  facts.tips = { keys: keys.length, status_words: STK.length, ok: text(run("tipText('st:core', null)")), v1: text(run("tipText('st:old', null)")), late_now: words.late_now,
    beads: text(run("tipText('beads:18/18', null)")), ropen: text(run("tipText('ropen', null)")), unknown_family: text(run("tipText('fam:vol_breakout', null)")) };
  // the Bot factory: the lab's full payload (cloud/dev/fx_factory_v2.json), an older one, an unknown family, none
  const full = JSON.parse(fs.readFileSync(path.join(cloud, "dev", "fx_factory_v2.json"), "utf8"))["exec:factory"];
  const old = JSON.parse(JSON.stringify(full));
  delete old.lab.funnel; delete old.lab.last; delete old.lab.studies; delete old.lab.by_family.bull_momentum;
  Object.assign(old.lab, { tried: 24, last_batch: "2026-09-30", vetoed: 0 });
  const odd = { v: 1, lab: { by_family: { vol_breakout: { tried: 3 } } } };
  const fx = (X, done) => { C.__X = X; C.__d = done; return text(run("COMP.fleetFactory(__X, __d)")); };
  facts.factory = { full: fx(full, true), old: fx(old, true), odd: fx(odd, true), none: fx(null, true), loading: fx(null, false) };
  for (const [k, t] of Object.entries(facts.factory)) if (/undefined|NaN|null/.test(t)) bad("factory (" + k + ") has broken words: " + t);
} catch (e) {
  bad("the tips and factory harness threw: " + (e && e.stack || e));
}
// ------------------------------------------------------------------ the AiFi Lab page (core + lab in a vm) --
// COMMAND_CENTER_SPEC §11 on the invented log in cloud/dev/fx_lab.json (never the lab's real data): the header and
// the Strategy log for the full payload, an empty one and an old / partial one; one strategy's sheet with and without
// its day record; and the Lab floor's replay plan (real order, 15–60 s, never more pods than slots).
try {
  const C = coreContext("", "/lab");
  vm.runInContext(fs.readFileSync(path.join(cloud, "ui", "lab.js"), "utf8"), C, { filename: "ui/lab.js" });
  const run = (src) => vm.runInContext(src, C);
  const text = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  C.__exNow = Date.parse("2026-10-02T15:00:00Z");
  if (run("PAGE") !== "lab") bad("lab harness: PAGE is not 'lab' on /lab");
  const FX = JSON.parse(fs.readFileSync(path.join(cloud, "dev", "fx_lab.json"), "utf8"));
  const L = FX["exec:lab"], D = FX["exec:lab:day:2026-10-02"];
  const page = (x) => { C.__L = x; return text(run("COMP.labPage(__L)")); };
  const old = { v: 1, rows: L.rows.slice(10).map(({ stage, gv, fail, veto, arena, hold, dfl, ...r }) => r) };
  facts.lab = { full: page(L), empty: page({ v: 1 }), old: page(old) };
  C.__L = L; C.__D = D;
  facts.lab.sheet_full = text(run("COMP.labSheet(__L, 'fx-a107', __D)"));
  facts.lab.sheet_summary = text(run("COMP.labSheet(__L, 'fx-n304', null)"));
  facts.lab.sheet_veto = text(run("COMP.labSheet(__L, 'fx-a106', __D)"));
  for (const [k, t] of Object.entries(facts.lab)) if (/undefined|NaN|\bnull\b|\$/.test(t)) bad("lab (" + k + ") has broken words: " + t.slice(0, 300));
  // the replay plan: run 0 (8 tests) on 9 slots and on 2 (a full bench makes the earliest finished test leave first)
  const plans = {};
  for (const [i, c] of [[0, 9], [0, 2], [1, 6]]) {
    const P = JSON.parse(run("JSON.stringify((function(){ const p = COMP.labPlan(__L, " + i + ", " + c + "); return { end: p.end, T: p.T, out: p.out.map(x => ({ id: x.r.id, at: x.r.at, slot: x.slot, s: x.s, done: x.done, out: x.out })) }; })())"));
    const key = i + "/" + c; plans[key] = { n: P.out.length, end: Math.round(P.end), T: P.T };
    const o = P.out;
    if (o.some((x, j) => j && (x.at < o[j - 1].at || x.s < o[j - 1].s))) bad("lab plan " + key + ": tests are not replayed in their real order");
    if (P.end > P.T + 1 || P.end < 15000 * 0.3) bad("lab plan " + key + ": the replay lasts " + Math.round(P.end) + " ms, not within its " + P.T + " ms");
    if (o.some((x) => !(x.s < x.done && x.done <= x.out))) bad("lab plan " + key + ": a test leaves before its verdict");
    for (const x of o) for (const y of o) if (x !== y && x.slot === y.slot && x.s < y.s && y.s < x.out) bad("lab plan " + key + ": two tests share slot " + x.slot);
    if (o.some((x) => x.slot < 0 || x.slot >= c)) bad("lab plan " + key + ": a slot outside the bench");
  }
  facts.lab.plans = plans;
  // the page's own tip words (added to core's TIP): every lane, counter, pip, check, proposer and verdict has words
  const specs = ["floor", "scouts", "bench", "auditor", "arena", "wall", "tested", "killed", "failed", "audit", "waiting", "exam", "passed", "rulebook", "log", "pip0", "pip1", "pip2", "pip3"].map((k) => "lab:" + k)
    .concat(["enough history", "cheap: Sharpe and trades", "cheap: earns anything", "trade count", "return on capital", "Sharpe", "deflated Sharpe", "max drawdown", "costs doubled",
      "neighbours", "beats holding the coins", "positive years", "no one-year wonder", "worst regime", "no lookahead", "works on other coins", "not a copy of a fleet bot", "holdout",
      "holdout budget"].map((k) => "chk:" + k), ["scout", "auto", "campaign", "seed"].map((k) => "lbby:" + k), ["k", "f", "w", "x", "t", "p", "a"].map((k) => "lbv:" + k));
  const silent = specs.filter((k) => { C.__k = k; const t = text(run("tipText(__k, null)")); return !t || /undefined|NaN|null/.test(t); });
  if (silent.length) bad("lab tips without words: " + silent.join(", "));
  facts.lab.tips = specs.length;
} catch (e) {
  bad("the lab harness threw: " + (e && e.stack || e));
}
console.log(JSON.stringify({ ok: problems.length === 0, problems, facts }));
