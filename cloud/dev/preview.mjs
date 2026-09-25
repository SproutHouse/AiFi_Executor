// cloud/dev/preview.mjs — run the dashboard Worker locally against an in-memory KV. Dev tool, never deployed.
// Usage: node cloud/dev/preview.mjs [kv.json] [port]
//   kv.json maps KV keys to string values, e.g. from `python3 scripts/dashboard_push.py --kv-json kv.json`
//   or `python3 scripts/dashboard_demo.py kv.json`. Default: cloud/dev/kv.json.
// Every request is signed in automatically (the harness mints the same cookie the Worker issues), so pages
// render without typing a password. Source files are re-read when they change: edit and reload.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cloud = path.resolve(here, "..");
const kvPath = path.resolve(process.argv[2] || path.join(here, "kv.json"));
const port = Number(process.argv[3] || 8788);
const PASSWORD = "preview";

function kvStore() {
  const raw = fs.existsSync(kvPath) ? JSON.parse(fs.readFileSync(kvPath, "utf8")) : {};
  return { get: async (k) => (k in raw ? (typeof raw[k] === "string" ? raw[k] : JSON.stringify(raw[k])) : null), put: async () => {} };
}

// Text-imported modules: whatever wrangler.toml marks as type "Text" (anything under ui/, plus any .css).
// Node's ESM loader refuses a ".css" file even when it holds JS, so each stylesheet is written as
// "<name>.css.js" and the importing modules' ".css" specifiers are rewritten to match.
const TEXT = (rel) => rel.startsWith("ui/");
const cssSpec = (src) => src.replace(/(\bfrom\s*["'][^"']+\.css)(["'])/g, "$1.js$2");
let cached = { stamp: "", mod: null };
function stamp() {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "dev" && f.name !== ".wrangler") walk(p); } else if (/\.(js|css)$/.test(f.name)) files.push(p); } };
  walk(cloud);
  return files.map((p) => p + ":" + fs.statSync(p).mtimeMs).join("|") + "|" + (fs.existsSync(kvPath) ? fs.statSync(kvPath).mtimeMs : 0);
}
async function worker() {
  const s = stamp();
  if (cached.mod && cached.stamp === s) return cached.mod;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "exec-preview-"));
  fs.writeFileSync(path.join(out, "package.json"), '{"type":"module"}');
  const copy = (d, rel = "") => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name), r = rel ? rel + "/" + f.name : f.name;
      if (f.isDirectory()) { if (f.name !== "dev" && f.name !== ".wrangler") { fs.mkdirSync(path.join(out, r), { recursive: true }); copy(p, r); } continue; }
      if (!/\.(js|css)$/.test(f.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      if (TEXT(r) || f.name.endsWith(".css")) fs.writeFileSync(path.join(out, f.name.endsWith(".css") ? r + ".js" : r), "export default " + JSON.stringify(src) + ";\n");
      else fs.writeFileSync(path.join(out, r), cssSpec(src));
    }
  };
  copy(cloud);
  const mod = (await import(pathToFileURL(path.join(out, "worker.js")).href + "?v=" + Date.now())).default;
  cached = { stamp: s, mod };
  return mod;
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
http.createServer(async (req, res) => {
  try {
    const w = await worker();
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const cookie = "ex=" + exp + "." + (await hmac(PASSWORD, "exec|" + exp));
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "cookie") headers.set(k, v);
    headers.set("cookie", cookie);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    const r = await w.fetch(new Request("http://localhost:" + port + req.url, { method: req.method, headers, body }), { DASHBOARD_PASSWORD: PASSWORD, EXEC: kvStore() });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end(String(e && e.stack || e));
  }
}).listen(port, () => console.log(`preview on http://localhost:${port}  (kv: ${kvPath})`));
