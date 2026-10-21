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
const ORDER = ["core", "gaterun", "now", "activity", "positions", "results", "rules", "arrival", "factory", "ident", "fleet", "bot", "boot"];
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
// 2026-10-16: the login compares in constant time and pauses after a wrong password; a forged cookie is refused; the
// lab's payloads (exec:factory, exec:lab, exec:lab:day) lose any money key and currency text on the way out
{
  const post = (pw) => W.fetch(new Request("http://localhost/login", { method: "POST", body: new URLSearchParams({ password: pw }) }), env);
  const t0 = Date.now(), wrong = await post("nope"), dt = Date.now() - t0;
  if (wrong.status !== 401) bad(`a wrong password returned ${wrong.status}, not 401`);
  if (dt < 900) bad(`a wrong password was answered after ${dt} ms, not after the fixed pause`);
  const right = await post(PW);
  if (right.status !== 302 || !/^ex=\d+\.[0-9a-f]{64};/.test(right.headers.get("set-cookie") || "")) bad("the right password did not sign in");
  const forged = await W.fetch(new Request("http://localhost/api/agents", { headers: { cookie: "ex=" + exp + "." + "0".repeat(64) } }), env);
  if (forged.status !== 401) bad(`a forged cookie returned ${forged.status}, not 401`);
  const LK = { "exec:factory": JSON.stringify({ v: 1, shortlist: [{ agent: "a", paper: { ret_pct: 1, equity: 1043.2 }, hypothesis: "turns $1,000 into more" }] }),
    "exec:lab": JSON.stringify({ v: 1, rules: "v2", runs: [{ start: "2026-10-16T00:00:00Z", pnl: 3 }] }), "exec:lab:day:2026-10-02": '{"v":1,"date":"2026-10-02","trials":[]}' };
  const env2 = { DASHBOARD_PASSWORD: PW, EXEC: { get: async (k) => (k in LK ? LK[k] : null), put: async () => {} } };
  const g2 = async (p) => (await W.fetch(new Request("http://localhost" + p, { headers: { cookie } }), env2)).text();
  const fx = JSON.parse(await g2("/api/factory")), lab = JSON.parse(await g2("/api/lab")), day = await g2("/api/lab/day?d=2026-10-02");
  if (JSON.stringify(fx.shortlist[0]) !== JSON.stringify({ agent: "a", paper: { ret_pct: 1 }, hypothesis: "—" })) bad("/api/factory kept money: " + JSON.stringify(fx));
  if (JSON.stringify(lab) !== JSON.stringify({ v: 1, rules: "v2", runs: [{ start: "2026-10-16T00:00:00Z" }] })) bad("/api/lab kept money or lost the lab's own names: " + JSON.stringify(lab));
  if (day !== LK["exec:lab:day:2026-10-02"]) bad("a clean lab day did not pass through untouched");
  facts.worker = { wrong_ms: dt, factory: fx, lab };
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
  // one missed hourly check is Late, not Stale (2026-10-16): an hourly bot is stale after two missed checks
  expect("Fast at 08:00Z", at(fast, "2026-10-01T08:00:00Z").word, "Late");
  expect("Fast at 08:59Z", at(fast, "2026-10-01T08:59:00Z").word, "Late");
  expect("Fast at 09:00Z", at(fast, "2026-10-01T09:00:00Z").word, "Stale");
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
  const words = run("JSON.stringify([Object.keys(GLOSS).map(k => { const g = gloss(k); return g.t + ' ' + g.d; }), STAGE.n.w, GATES.map(g => g.label), KIND.flip, EXIT.h1, word.bar(), word.every(), word.kindName('flip', 3600)])");
  if (/4-hour|4 hours/.test(words)) bad("clock: a 1 h bot's vocabulary still says 4-hour: " + (words.match(/[^"]{0,40}4.hour[^"]{0,40}/) || [""])[0]);
  // exit codes name their own timeframe: on an hourly bot "4h flip" (h4) is its 4-hour gate turning, "1h flip" (h1) its own bar
  expect("EXIT.h1", run("EXIT.h1"), "hourly turn");
  expect("EXIT.h4 on a 1 h bot", run("EXIT.h4"), "4-hour turn");
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
  const STK = ["ok", "due", "late_now", "stale", "exits", "failed", "halt", "thr_halt", "thr_half", "late", "fallback", "unhedged", "exit_slow", "none", "v1", "behind"];
  C.__K = { phase: "late", C: T("2026-10-02T12:00:00Z"), next: T("2026-10-02T16:15:00Z"), lateAt: T("2026-10-02T12:45:00Z"), lastT: clk.last_t, age: 9 * 3600, lim: 45, rng: [6, 24] };
  const generic = run("stTip({ k: 'zzz', word: 'Check', lvl: 'warn', K: __K }, null, AGENTS[0])[1]");
  const words = {};
  for (const k of STK) {
    C.__st = { k, word: k, lvl: "warn", K: C.__K, pb: { ran: C.__K.lastT + 7200, pf: { why: "data check" } }, shown: C.__K.lastT };
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

// ------------------------------------------------------------------ the 2026-10-16 review (core + factory + fleet [+ bot] in a vm) --
// A page behind its bot says so ("Page behind") and never blames the runner while the server's heartbeat is fresh; the
// master's Fleet (paper) KPI is the executor's own paper pot (E.paper); a sale reads % of pot first, R in brackets; a
// rotation shows both of its actions; the log says how many of a bot's week's events did not fit its row; carry shows
// lifetime capture and the hedge result; the lab's evidence (cloud/dev/fx_factory_v3.json, invented) renders on the
// Shortlist and an arena bot's page, and "Ready for you" appears only for ready === true. Texts go to facts.review.
const RV = (search) => {
  const C = coreContext(search);
  C.__FX = JSON.parse(fs.readFileSync(path.join(cloud, "dev", "fx_factory_v3.json"), "utf8"))["exec:factory"];
  C.__LG = { v: 2, gen: "x", trades: { total: 0, cols: ["id", "c", "kind", "t_out", "R", "cap_ret_pct", "t_rec"], rows: [] }, stats: { all: { n: 0 } }, eq: { pct: [], dd: [] },
    signals: { total: 0, rows: [], daily: { keys: [], rows: [] } }, verdict: { gates: [], books: [] } };
  vm.runInContext("getJSON = async (u) => { u = String(u); if (u.indexOf('/api/factory') === 0) return __FX; if (u.indexOf('/api/ledger') === 0) return __LG; throw { kind: 'missing' }; }", C);
  return C;
};
const tick = () => new Promise((r) => setTimeout(r, 5));
const load = (C, mods) => { for (const n of mods) vm.runInContext(fs.readFileSync(path.join(cloud, "ui", n + ".js"), "utf8"), C, { filename: "ui/" + n + ".js" }); };
try {
  const text = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const T = (iso) => Date.parse(iso) / 1000;
  const NOW = Date.parse("2026-10-16T09:10:00Z");
  const clk = { last_t: T("2026-10-16T06:05:45Z"), last_slot: T("2026-10-16T06:00:00Z"), late_min: 6, lag_med_min: 6, lag_rng: [6, 7], lag_n: 42, limit_min: 35, sched_min: 5, bar_s: 3600 };
  const sbOf = (c) => ({ clock: c, state: { halt: { set: false }, thr: { state: "normal", dd_pct: 1 }, last: { t: c.last_t, fresh: true, failed: false } }, cfg: { late_min: c.limit_min, thr: [10, 20] },
    mode: { eff: "paper", req: "paper" }, alerts: [], risk: { n_open: 0 } });
  const host = { name: "alwaysdata", t: T("2026-10-16T09:07:00Z"), fails: 0, ok: true }, old = Object.assign({}, host, { t: T("2026-10-16T05:07:00Z") });
  const fast = { id: "fast-1h", name: "Fast", kind: "flip", bar_s: 3600, mode: "paper", gen: "2026-10-16T06:07:00Z", since: T("2026-09-26T03:13:10Z"), sb: sbOf(clk) };
  const fastBehind = Object.assign({}, fast, { ran_t: T("2026-10-16T09:05:40Z"), push_fail: { since: T("2026-10-16T07:06:00Z"), why: "data check: forbidden key 'gross' at exec:latest.funnel.week.by_check" } });
  // 1. the status words (core alone): behind and failing, behind and pending, and stale with the server up, down or unknown
  const C = RV("");
  C.__exNow = NOW;
  const st = (row, E) => { C.__r = row; C.__E2 = E; return JSON.parse(vm.runInContext("JSON.stringify((function(){ const s = status(rowBundle(__r, __E2)); return { word: s.word, lvl: s.lvl, k: s.k, sentence: s.sentence, items: s.items.map(i => i.k), next: s.K.next, age: s.age }; })())", C)); };
  const failing = st(fastBehind, { host, gen: "2026-10-16T09:07:30Z" }), pending = st(Object.assign({}, fast, { ran_t: T("2026-10-16T09:05:40Z") }), { host });
  facts.review = { failing: { word: failing.word, lvl: failing.lvl, text: text(failing.sentence), items: failing.items, next: failing.next, age: failing.age }, pending: { word: pending.word, lvl: pending.lvl, text: text(pending.sentence) },
    stale_up: text(st(fast, { host }).sentence), stale_down: text(st(fast, { host: old, gen: "2026-10-16T09:07:30Z" }).sentence), stale_none: text(st(fast, { host: old, gen: "2026-10-16T05:07:30Z" }).sentence),
    sold: text(vm.runInContext("word.event([1792140000, 'sold', 'LINK', 'flip', 'A', 2, 'stop', -0.5, null, -0.52]).html", C)),
    sold_old: text(vm.runInContext("word.event([1792140000, 'sold', 'LINK', 'flip', 'A', 2, 'stop', -0.5, null]).html", C)),
    trail: text(vm.runInContext("word.event([1792140000, 'trail', 'LINK', 'flip', 'A', 2, null, 0.38, null, 0.41]).html", C)) };
  for (const [k, v] of Object.entries(facts.review)) if (/runner may be down|undefined|NaN/.test(JSON.stringify(v))) bad("review (" + k + "): " + JSON.stringify(v).slice(0, 200));
  // 2. the master: E.paper, a bare row whose push failed, % of pot first, a rotation, the log's "more", lifetime carry, the factory
  const M = RV("");
  load(M, ["factory", "ident", "fleet"]);
  M.__exNow = NOW;
  const d4 = { last_t: T("2026-10-16T08:05:46Z"), last_slot: T("2026-10-16T08:00:00Z"), late_min: 6, lag_med_min: 6, lag_rng: [6, 6], lag_n: 42, limit_min: 45, sched_min: 5, bar_s: 14400 };
  const d1 = { last_t: T("2026-10-16T00:07:31Z"), last_slot: T("2026-10-16T00:00:00Z"), late_min: 7, lag_med_min: 8, lag_rng: [7, 9], lag_n: 12, limit_min: 180, sched_min: 5, bar_s: 86400 };
  const h1 = Object.assign({}, clk, { last_t: T("2026-10-16T09:06:40Z"), last_slot: T("2026-10-16T09:00:00Z"), limit_min: 50 });
  M.__E = { v: 2, gen: "2026-10-16T09:07:30Z", fleet: { halt: false }, host, order: ["core", "wide-4h", "fast-1h", "carry-1h", "arena-03"],
    paper: { n: 8, ret_pct: -2.71, dd_pct: 2.9, dd_max_pct: 3.4, since: T("2026-09-23T22:49:16Z"), t: T("2026-10-16T09:06:40Z") },
    agents: [
      { id: "core", name: "Core", kind: "flip", bar_s: 14400, mode: "paper", gen: "2026-10-16T08:07:00Z", since: T("2026-09-23T22:49:16Z"), sb: sbOf(d4), ran_t: d4.last_t, n_open: 2,
        rec: { n: 3, w: 0, l: 3, open_R: 0.4 }, open_pct: 0.31, act: { t: T("2026-10-16T08:05:46Z"), ty: "sold", cs: ["HYPE"], n: 1, R: -0.55, pot_pct: -0.61 },
        recent: [[T("2026-10-16T08:05:46Z"), "sold", "HYPE", "flip", "A", 2, "stop", -0.55, null, -0.61]], recent_more: 0 },
      { id: "wide-4h", name: "Wide", desc: "", enabled: true, push_fail: { since: T("2026-10-16T08:07:00Z"), why: "data check" } },
      fastBehind,
      { id: "carry-1h", name: "Carry", kind: "carry", bar_s: 3600, mode: "paper", gen: "2026-10-16T09:07:00Z", since: T("2026-09-27T02:14:13Z"), sb: sbOf(h1), ran_t: h1.last_t, n_open: 5, pot_chg_pct: -2.08,
        carry: { pairs: 5, open: 5, entering: 0, exiting: 0, stuck: 0, cap_pct: 107.9, capture_pct: 61, capture_scope: "all", leg_pct: -2.38, gate_pct: 80 } },
      { id: "arena-03", name: "A03 Bull", kind: "target", bar_s: 86400, mode: "paper", gen: "2026-10-16T02:09:00Z", since: T("2026-10-06T00:09:15Z"), sb: sbOf(d1), ran_t: d1.last_t, n_open: 3,
        arena: { recipe: "fx-b0000003", family: "bull_momentum", tag: "invented", enrolled: "2026-10-05" }, held: ["INJ", "NEAR", "ZRO"], deployed_pct: 21,
        act: { t: T("2026-10-16T00:07:31Z"), ty: "bought", cs: ["INJ"], n: 1, also: [["sold", ["AAVE"], 1]] },
        recent: [[T("2026-10-16T00:07:31Z"), "bought", "INJ", "target", "T", 2, "stop 20", null, null], [T("2026-10-16T00:07:31Z"), "sold", "AAVE", "target", "T", 2, "other", -0.29, null, -0.31]], recent_more: 4 }] };
  vm.runInContext("S.E = __E; AGENTS = __E.agents.filter(isObj)", M);
  await vm.runInContext("loadFactory(true)", M);
  await tick();
  facts.review.master = text(vm.runInContext("VIEWS.fleet.render({}, 'route')", M));
  facts.review.words = JSON.parse(vm.runInContext("JSON.stringify(Object.fromEntries(Object.entries(COMP.fleetSummary().sts).map(([k, s]) => [k, s.word])))", M));
  facts.review.shortlist = text(vm.runInContext("(function(){ const o = SHEETS.shortlist(); return typeof o === 'string' ? o : o.html; })()", M));
  facts.review.factory = text(vm.runInContext("COMP.fleetFactory(__FX, true)", M));
  for (const k of ["master", "shortlist"]) if (/undefined|NaN|\bnull\b|\$\d/.test(facts.review[k])) bad("review " + k + " has broken words: " + facts.review[k].slice(0, 300));
  // 3. an arena bot's Overview (bot.js): its own paper numbers, the lab's labelled, the evidence block
  const B = RV("?a=arena-02");
  load(B, ["factory", "ident", "fleet", "bot"]);
  B.__exNow = NOW;
  B.__E = { v: 2, gen: "2026-10-16T09:07:30Z", fleet: { halt: false }, host, order: ["arena-02"], agents: [{ id: "arena-02", name: "A02 Bull", kind: "target", bar_s: 86400, mode: "paper",
    gen: "2026-10-16T02:09:00Z", sb: sbOf(d1), ran_t: d1.last_t, arena: { recipe: "fx-b0000002", family: "bull_momentum", tag: "invented", enrolled: "2026-10-03" }, desc: "An invented arena bot." }] };
  B.__L = { v: 2, gen: "2026-10-16T02:09:00.000Z", mode: { eff: "paper", req: "paper", note: "" }, origin: { t: T("2026-10-04T00:08:17Z"), mode: "paper" },
    cfg: { kind: "target", tf: "1d", thr: [25, 45], late_min: 180, gates: { n: 30 } }, order: ["INJ"], books: [], clock: d1,
    state: { halt: { set: false }, thr: { state: "normal", dd_pct: 1.59 }, btc: {}, last: { t: d1.last_t, fresh: true, failed: false, late_min: 7 } }, alerts: [],
    pot: { since: T("2026-10-04T00:08:17Z"), n_pts: 39, chg_pct: 0.09, wk_chg_pct: 1.24, net: true, spark: [[T("2026-10-15T00:07:00Z"), -0.5], [d1.last_t, 0.09]], dd_pct: 1.5, dd_max_pct: 3.72 },
    rec: { n: 2, tot_R: -0.07, closed_R: -0.9, open_R: 0.83 }, risk: { n_open: 1, stops_hit_pct: -10.1, stops_drop_pct: -12.4 },
    pos: [{ id: "INJ-1", c: "INJ", kind: "target", size_pct: 7.0, val_pct: 7.4, pnl_pct: 0.3, r_now: 0.4, t_in: T("2026-10-15T00:07:00Z") }],
    names: [], runs: [], events: [], funnel: {}, pinned: [], last24: {}, proposals: [], diag: {}, beat: { s0: T("2026-10-03T00:00:00Z"), n: 14, k: "oooooooooooooo" }, act: null, tw: [] };
  B.__root = { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
  vm.runInContext("S.E = __E; AGENTS = __E.agents; S.b = __L; BAR = barOf(__L); VIEWS.overview.render(__root, 'route'); VIEWS.overview.after(__root)", B);
  await tick(); await tick();
  facts.review.bot = text(vm.runInContext("VIEWS.overview.render(__root, 'redraw')", B));
  // 4. a carry bot's Wins & losses with the lifetime view, and an older bundle without it
  const K = RV("?a=carry-1h");
  load(K, ["factory", "ident", "fleet", "bot"]);
  K.__exNow = NOW;
  K.__E = { v: 2, gen: "x", fleet: { halt: false }, host, order: ["carry-1h"], agents: [{ id: "carry-1h", name: "Carry", kind: "carry", bar_s: 3600, sb: sbOf(h1), ran_t: h1.last_t }] };
  K.__L = Object.assign({}, B.__L, { cfg: { kind: "carry", tf: "1h", thr: [10, 20], late_min: 50 }, clock: h1, origin: { t: T("2026-09-27T02:14:13Z"), mode: "paper" }, pos: [], carry: [],
    carry_sum: { pairs: 5, open: 5, entering: 0, exiting: 0, stuck: 0, stuck_t: null, fix_h: 3, gate_pct: 80, cap_pct: 107.9, apr: 10.6, fund_pct: 0.29, cost_pct: 0.085, net_pct: -2.33,
      capture_pct: 61, capture_scope: "all", leg_pct: -2.38, leg_open_pct: 1.84, capture_open_pct: 70, fund_all_pct: 0.47, cost_all_pct: 0.18, closed_n: 4, closed_ret_pct: -1.89, open_pct: 1.88, closed_pct: -1.67 },
    pot: Object.assign({}, B.__L.pot, { since: T("2026-09-27T02:14:13Z"), chg_pct: -2.08 }) });
  vm.runInContext("S.E = __E; AGENTS = __E.agents; S.b = __L; BAR = barOf(__L)", K);
  facts.review.carry = text(vm.runInContext("VIEWS.overview.render({}, 'route')", K));
  K.__L.carry_sum = { pairs: 5, open: 5, gate_pct: 80, cap_pct: 107.9, fund_pct: 0.29, cost_pct: 0.085, net_pct: -2.33, capture_pct: 70 };   // an older bundle
  facts.review.carry_old = text(vm.runInContext("VIEWS.overview.render({}, 'route')", K));
  for (const k of ["bot", "carry", "carry_old"]) if (/undefined|NaN|\bnull\b|\$\d/.test(facts.review[k])) bad("review " + k + " has broken words: " + facts.review[k].slice(0, 300));
} catch (e) {
  bad("the review harness threw: " + (e && e.stack || e));
}
// ------------------------------------------------------------------ identity: sigil + constellation (core + ident in a vm) --
// COMMAND_CENTER_SPEC §3.12: the sigil is a pure function of the rules (same rules → the same svg, whatever the state;
// each family its own mark; an unknown family a neutral glyph, never a throw); the constellation puts longs left of the
// line and shorts right of it, is laid out per coin (order-free), says "in cash" when empty and eases when holdings move.
try {
  const I = coreContext("");
  load(I, ["ident"]);
  const run = (src) => vm.runInContext(src, I);
  I.__x = null; I.__o = null;
  const sigil = (x, o) => { I.__x = x; I.__o = o || {}; return run("COMP.sigil(__x, __o)"); };
  const sky = (h, o) => { I.__x = h; I.__o = o || {}; return run("COMP.sky(__x, __o)"); };
  const markOf = (svg) => svg.replace(/^[\s\S]*?(<path class="ix-tks"[^>]*>)?(?=<(path|circle|rect) class="ix-m)/, "").replace(/<\/svg>$/, "");
  const fams = { trend: { kind: "target", bar_s: 86400, n_names: 2 }, carry: { kind: "carry", bar_s: 3600, n_names: 6 },
    ls: { kind: "target", bar_s: 86400, shadow: { family: "ls_xs" }, n_names: 30 }, rot: { kind: "target", bar_s: 86400, arena: { family: "bull_momentum" }, n_names: 35 },
    setups: { kind: "flip", bar_s: 14400, n_names: 14 }, gen: { kind: "target", bar_s: 86400, arena: { family: "vol_breakout" } } };
  const id = {};
  id.families = Object.fromEntries(Object.entries(fams).map(([k, x]) => [k, run("COMP.identOf(" + JSON.stringify(x) + ").f")]));
  const marks = Object.entries(fams).map(([k, x]) => markOf(sigil(Object.assign({ id: "b-" + k }, x))));
  id.marks_distinct = new Set(marks).size;
  const row = { id: "trend-1d", kind: "target", bar_s: 86400, sig: { f: "trend", tf: "1d", n: 2 }, pot_chg_pct: -3.4, last_t: 1 };
  const row2 = Object.assign({}, row, { pot_chg_pct: 9.9, last_t: 2, hold: [["BTC", 30, "l"]] });     // same rules, other state
  id.same_rules_same_svg = sigil(row) === sigil(row2) && sigil(row) === sigil(JSON.parse(JSON.stringify(row)));
  id.rules_change_svg = sigil(row) !== sigil(Object.assign({}, row, { sig: { f: "trend", tf: "1d", n: 3 } }));
  const dash = (x) => (sigil(x).match(/stroke-dasharray="([^"]+)"/) || [])[1];
  id.cadence_distinct = new Set([dash({ kind: "carry", bar_s: 3600 }), dash({ kind: "carry", bar_s: 14400 }), dash({ kind: "carry", bar_s: 86400 })]).size;
  id.ticks = ((sigil({ sig: { f: "rot", tf: "1d", n: 13, k: 3 } }).match(/class="ix-tks" d="([^"]+)"/) || [])[1] || "").split("M").length - 1;
  id.unknown = sigil({ sig: { f: "weird", tf: "2w", n: "x" } });
  id.unknown_kind = run("COMP.identOf({ kind: 'zzz' }).f") + "," + run("COMP.identOf(null).f") + "," + run("COMP.identOf({ cfg: { kind: 'target', tf: '1d', target: { family: 'ls_xs', ls: { top_n: 30 } } } }).n");
  id.retired = sigil(Object.assign({ enabled: false }, row), { off: true });
  // the constellation: a long-short book (coordinates from each star's translate)
  const LS = [{ c: "SOL", w: 9.2, s: "l" }, { c: "AVAX", w: 7.1, s: "l" }, { c: "LINK", w: 8.4, s: "l" }, { c: "DOGE", w: 8.8, s: "s" }, { c: "ADA", w: 7.4, s: "s" }, { c: "LTC", w: 9.6, s: "s" }];
  const stars = (svg) => [...svg.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\)">[\s\S]*?<circle class="ix-(l|s|dim)"/g)].map((m) => ({ x: +m[1], y: +m[2], s: m[3] }));
  const ls = sky(LS, { key: "t1", f: "ls" }), st = stars(ls);
  id.ls = { n: st.length, longs_left: st.filter((p) => p.s === "l").every((p) => p.x < 120), shorts_right: st.filter((p) => p.s === "s").every((p) => p.x > 120),
    divider: ls.includes('class="ix-div"'), labels: ls.includes(">long<") && ls.includes(">short<") };
  id.order_free = stars(sky(LS, { key: "t4", f: "ls" })).map((p) => p.x + "," + p.y).join() === stars(sky(LS.slice().reverse(), { key: "t5", f: "ls" })).map((p) => p.x + "," + p.y).join();
  const empty = sky([], { key: "e", f: "ls" });
  id.empty = { dim: empty.includes('class="ix-dim"'), words: empty.includes(">in cash<"), no_divider: !empty.includes("ix-div"), mini: sky([], { key: "e2", mini: true }).includes("ix-dim") };
  id.long_only_cash = sky([{ c: "BTC", w: 35.5, s: "l" }], { key: "c", f: "trend" }).includes('class="ix-cash"');
  sky([{ c: "BTC", w: 30, s: "l" }, { c: "ETH", w: 20, s: "l" }], { key: "mv", f: "trend" });
  const moved = sky([{ c: "BTC", w: 45, s: "l" }, { c: "SOL", w: 10, s: "l" }], { key: "mv", f: "trend" });
  id.eases = { moved: /class="ix-mv" style="--fx:/.test(moved), arrived: moved.includes('class="ix-new"'), still: !/ix-mv|ix-new/.test(sky([{ c: "BTC", w: 45, s: "l" }, { c: "SOL", w: 10, s: "l" }], { key: "mv", f: "trend" })) };
  id.carry_pair = (sky([{ c: "ETH", w: 16.7, s: "c" }], { key: "cp" }).match(/class="ix-[ls]"/g) || []).length;
  I.__h = LS; id.words = run("COMP.skyWords(__h)"); id.words_empty = run("COMP.skyWords([])"); id.words_long = run("COMP.skyWords([{ c: 'BTC', w: 35.5, s: 'l' }])");
  id.row_hold = run("JSON.stringify(COMP.holdOfRow({ hold: [['BTC', 35.5, 'l'], ['DOGE', 8, 's'], ['ETH', 16.7, 'c'], ['bad']] }))") + "|" + run("COMP.holdOfRow({})");
  I.__A = row; run("AGENTS = [__A]"); id.tip = run("tipText('sigil:trend-1d', null)") || ""; id.tip = String(id.tip).replace(/<[^>]*>/g, " ");
  facts.ident = id;
  for (const k of ["unknown", "retired", "words", "words_empty", "words_long", "tip"]) if (/undefined|NaN|\bnull\b/.test(id[k])) bad("ident " + k + " has broken output: " + String(id[k]).slice(0, 200));
} catch (e) {
  bad("the identity harness threw: " + (e && e.stack || e));
}
console.log(JSON.stringify({ ok: problems.length === 0, problems, facts }));
