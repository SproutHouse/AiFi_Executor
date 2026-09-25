// tests/client_join_check.mjs — build the dashboard the way the Worker serves it and check the joined client.
// Run by tests/test_dashboard_client.py (node required); prints one JSON line {ok, problems[], facts{}}.
// It loads cloud/worker.js exactly as cloud/dev/preview.mjs does (ui/*.js and *.css imported as text) against an
// in-memory KV, then checks: the ui/ module contract (core declares the names, every other module is one block,
// no template literals), that the joined page script compiles, the app shell's one h1 and mounts, that doc and
// login pages never carry the app bundle, and that /api/ledger turns the review markdown into html.
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
const ORDER = ["core", "gaterun", "dial", "now", "activity", "positions", "results", "rules", "arrival", "boot"];
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").trim();
for (const n of ORDER) {
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
  "exec:ledger": JSON.stringify({ v: 2, review: { date: "2026-09-20", md: "# Review\n\n1. one\n   wrapped\n2. two" } }),
  "doc:how_it_works": "# How it works\n\n1. first\n   still first\n2. second\n3. third",
};
const env = { DASHBOARD_PASSWORD: PW, EXEC: { get: async (k) => (k in KV ? KV[k] : null), put: async () => {} } };
const get = async (p, auth = true) => W.fetch(new Request("http://localhost" + p, { headers: auth ? { cookie } : {} }), env);

const app = await get("/");
const page = await app.text();
if (app.status !== 200) bad(`/ returned ${app.status}`);
facts.page_bytes = Buffer.byteLength(page);
const h1s = (page.match(/<h1[\s>]/g) || []).length;
if (h1s !== 1) bad(`the app page has ${h1s} h1 elements, not 1`);
for (const id of ["capsule", "railstat", "modepill", "ttl", "alerts", "view", "sheet", "sheetbg", "toast", "app"]) if (!page.includes(`id="${id}"`)) bad(`the app shell has no #${id}`);
if ((page.match(/aria-live=/g) || []).length !== 1) bad("the capsule must be the only aria-live region");
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
fs.rmSync(out, { recursive: true, force: true });
console.log(JSON.stringify({ ok: problems.length === 0, problems, facts }));
