// AiFi Executor dashboard — Cloudflare Worker. Auth, API, app shell, document pages.
// Data comes from KV, written after every push by scripts/dashboard_push.py: exec:latest, exec:ledger,
// exec:stamp and doc:<slug>. CSS = design.js (AiFi tokens, magenta accent) + mission.js (the executor's
// shared vocabulary) + ui/<module>.css. The page script is the ui/ modules joined into ONE IIFE, in the
// order cloud/ui/README.md fixes; wrangler.toml imports every ui/*.js and ui/*.css as text.
import { CSS as DESIGN_CSS, FONTS } from "./design.js";
import { MISSION_CSS } from "./mission.js";
import CORE from "./ui/core.js";
import GATERUN from "./ui/gaterun.js";
import DIAL from "./ui/dial.js";
import NOW from "./ui/now.js";
import ACTIVITY from "./ui/activity.js";
import POSITIONS from "./ui/positions.js";
import RESULTS from "./ui/results.js";
import RULES from "./ui/rules.js";
import ARRIVAL from "./ui/arrival.js";
import BOOT from "./ui/boot.js";
import GATERUN_CSS from "./ui/gaterun.css";
import DIAL_CSS from "./ui/dial.css";
import NOW_CSS from "./ui/now.css";
import ACTIVITY_CSS from "./ui/activity.css";
import POSITIONS_CSS from "./ui/positions.css";
import RESULTS_CSS from "./ui/results.css";
import RULES_CSS from "./ui/rules.css";
import ARRIVAL_CSS from "./ui/arrival.css";

const APP = "AiFi Executor";
const COOKIE = "ex";
const DAY = 86400;
const DOCS = ["how_it_works", "logic", "risk", "universe", "execution", "security", "ledger", "operations", "decisions"];
const DOC_TITLES = { how_it_works: "How it works", logic: "Decision logic", risk: "Risk", universe: "Universe and books",
                     execution: "Execution", security: "Security", ledger: "The ledger", operations: "Runbook", decisions: "Decisions" };

// ------------------------------------------------------------ the bundle --
// One script, one IIFE, modules in README order. core.js alone declares top-level names; every other
// module is one block. Modules are joined with ";" on its own line so a missing semicolon or a trailing
// line comment in one file can never swallow the next; then the text is made safe to inline in <script>.
const MODULES = [["core", CORE], ["gaterun", GATERUN], ["dial", DIAL], ["now", NOW], ["activity", ACTIVITY],
                 ["positions", POSITIONS], ["results", RESULTS], ["rules", RULES], ["arrival", ARRIVAL], ["boot", BOOT]];
const inlineSafe = (s) => String(s).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
// Size (spec §15): the CORE API comment block, whole-line // comments, blank lines and indentation are dropped
// at join time (about 65 KB). Line breaks stay, so automatic semicolon insertion is untouched. This is safe
// because no module has a template literal or a string that spans lines; a module that ever gains a backtick
// is joined as written.
function lean(src) {
  const s = String(src || "").replace(/^\/\* =+ CORE API =+\n[\s\S]*?\*\/\n/m, "");
  const lines = s.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  return lines.some(l => l.includes("`")) ? s : lines.join("\n");
}
// Isolation: a throw at the top level of one module must not stop the modules after it (boot.js is last).
// core.js declares the shared names, so it alone is joined bare; every other module is already one block.
const guard = (n, src) => n === "core" ? src
  : "try {\n" + src + "\n} catch (e) { try { console.error('[executor] ui/" + n + ".js did not load', e); } catch (_) {} }";
const CLIENT = inlineSafe('(function(){"use strict";\n'
  + MODULES.map(([n, src]) => "/* ui/" + n + ".js */\n" + guard(n, lean(src))).join("\n;\n")
  + "\n})();");
// CSS comments and indentation are dropped the same way (no stylesheet has "/*" inside a string or url()).
const leanCss = (c) => String(c || "").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => l.trim()).filter(Boolean).join("\n");
const CSS = [DESIGN_CSS, MISSION_CSS, GATERUN_CSS, DIAL_CSS, NOW_CSS, ACTIVITY_CSS, POSITIONS_CSS, RESULTS_CSS, RULES_CSS, ARRIVAL_CSS].map(leanCss).join("\n");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/healthz") return new Response("ok");
    if (p === "/login") return login(request, env, url);
    if (p === "/logout") return redirect(url.origin + "/login", `${COOKIE}=; Path=/; Max-Age=0`);
    if (!env.DASHBOARD_PASSWORD) return html(setupPage(), 503);
    if (!(await authed(request, env))) {
      if (p.startsWith("/api/")) return json({ error: "unauthorised" }, 401);
      return redirect(url.origin + "/login");
    }
    let m;
    if (p === "/") return html(appPage());
    if (p === "/api/latest") return kvRaw(env, "exec:latest");
    if (p === "/api/ledger") return ledger(env);
    if (p === "/api/stamp") return kvRaw(env, "exec:stamp", "{}");
    if ((m = p.match(/^\/api\/doc\/([a-z_]{3,20})$/)) && DOCS.includes(m[1])) {
      const raw = await env.EXEC.get("doc:" + m[1]);
      return json({ slug: m[1], title: DOC_TITLES[m[1]], html: md(raw || "_This document has not been pushed yet._") });
    }
    if ((m = p.match(/^\/doc\/([a-z_]{3,20})$/)) && DOCS.includes(m[1])) return docPage(env, m[1]);
    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};

// ------------------------------------------------------------------ auth --
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function cookieVal(request) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  return m ? m[1] : null;
}
async function authed(request, env) {
  const v = cookieVal(request);
  if (!v) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return sig === (await hmac(env.DASHBOARD_PASSWORD, "exec|" + exp));
}
async function login(request, env, url) {
  if (!env.DASHBOARD_PASSWORD) return html(setupPage(), 503);
  if (request.method === "POST") {
    const form = await request.formData();
    const pw = String(form.get("password") || "");
    if (pw.length && pw === env.DASHBOARD_PASSWORD) {
      const exp = Math.floor(Date.now() / 1000) + 30 * DAY;
      const sig = await hmac(env.DASHBOARD_PASSWORD, "exec|" + exp);
      return redirect(url.origin + "/", `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * DAY}`);
    }
    return html(loginPage("Wrong password."), 401);
  }
  return html(loginPage());
}

// --------------------------------------------------------------- helpers --
const NOSTORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...NOSTORE, "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...NOSTORE } });
}
function redirect(to, setCookie) {
  const h = { Location: to };
  if (setCookie) h["Set-Cookie"] = setCookie;
  return new Response(null, { status: 302, headers: h });
}
// Raw text passthrough: the push already wrote exactly what the client reads, so nothing is parsed here.
async function kvRaw(env, key, fallback) {
  const v = await env.EXEC.get(key);
  if (v === null && fallback == null) return json({ error: "no data yet" }, 404);
  return new Response(v === null ? fallback : v, { headers: { "content-type": "application/json", ...NOSTORE } });
}
// The ledger carries the newest Sunday review as markdown; it travels to the client once, as html.
async function ledger(env) {
  const v = await env.EXEC.get("exec:ledger");
  if (v === null) return json({ error: "no data yet" }, 404);
  let L;
  try { L = JSON.parse(v); } catch (e) { return json({ error: "the ledger could not be read" }, 500); }
  if (L && L.review && typeof L.review === "object") {
    L.review.html = L.review.md ? md(L.review.md) : "";
    delete L.review.md;
  }
  return json(L);
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// -------------------------------------------------------------- markdown --
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\[([^\]]+)\]\([A-Za-z0-9_./-]+\.md\)/g, "$1");
  return s;
}
function md(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = []; let i = 0, list = null, para = [], li = "";
  const flushP = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    let l = lines[i];
    if (/^```/.test(l)) { flushP(); closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); i++; continue; }
    if (/^\s*\|/.test(l)) { flushP(); closeList(); const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
      if (body.length) out.push('<div class="tbl"><table><thead><tr>' + cells(body[0]).map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>" + body.slice(1).map(r => "<tr>" + cells(r).map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>");
      continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flushP(); closeList(); const n = Math.min(m[1].length + 1, 4); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flushP(); closeList(); out.push("<hr>"); i++; continue; }
    if ((m = l.match(/^>\s?(.*)/))) { flushP(); closeList(); out.push("<blockquote>" + inline(m[1]) + "</blockquote>"); i++; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } li = m[1]; out.push("<li>" + inline(li) + "</li>"); i++; continue; }
    if ((m = l.match(/^\s*(\d+)[.)]\s+(.*)/))) { flushP(); if (list !== "ol") { closeList(); out.push(m[1] === "1" ? "<ol>" : `<ol start="${Number(m[1])}">`); list = "ol"; } li = m[2]; out.push("<li>" + inline(li) + "</li>"); i++; continue; }
    // An indented line while a list is open is the wrapped rest of the last item, not a new paragraph.
    // Closing the list here is what used to restart "How it works" at 1, 1, 1 with orphaned lines between.
    // The item is re-rendered whole so bold or code that spans the wrap still pairs up.
    if (list && /^\s{2,}\S/.test(l)) { li += " " + l.trim(); out[out.length - 1] = "<li>" + inline(li) + "</li>"; i++; continue; }
    if (/^\s*$/.test(l)) { flushP(); closeList(); i++; continue; }
    if (/^<!--/.test(l) || /^_.*_$/.test(l.trim()) && i < 4) { i++; continue; }
    closeList(); para.push(l.trim()); i++;
  }
  flushP(); closeList();
  return out.join("\n");
}

// ------------------------------------------------------------------ pages --
// Two theme-color metas so the iPhone status bar follows the OS scheme. A stored manual theme is applied
// before first paint and rewrites both metas; the client does the same on every toggle.
const THEME_BOOT = "<script>(function(){try{var t=localStorage.getItem('aifi.theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;var c=t==='light'?'#eef1f6':'#0a0b0f',m=document.querySelectorAll('meta[name=theme-color]');for(var i=0;i<m.length;i++)m[i].setAttribute('content',c)}}catch(e){}})()</script>";
const ICON = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f04ec2"/><stop offset="1" stop-color="#9d8ff7"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><text x="16" y="21" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="13" font-weight="800" fill="#1b0713">Ex</text></svg>');
const HEAD = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0a0b0f" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#eef1f6" media="(prefers-color-scheme: light)"><meta name="color-scheme" content="dark light"><meta name="robots" content="noindex,nofollow"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Executor"><link rel="icon" href="${ICON}"><title>${esc(title)}</title>${THEME_BOOT}${FONTS}<style>${CSS}</style></head><body><div class="bg" aria-hidden="true"></div>`;
const SHEET = '<div class="sheet-bg" id="sheetbg"></div><div class="sheet glass" id="sheet" role="dialog" aria-modal="true" aria-label="Details"></div>';
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// The five tabs (spec §2). 24px, stroke 1.7 from design.js; the Activity dots are drawn thicker so they
// read as beads on the rail rather than vanishing into the line.
const NAV = [
  ["now", "Now", '<path d="M3 12h4l2-6 4 12 2-6h6"/>'],
  ["activity", "Activity", '<path d="M6 5v14"/><path d="M6 6h.01M6 12h.01M6 18h.01" stroke-width="4"/><path d="M10 6h10M10 12h10M10 18h7"/>'],
  ["positions", "Positions", '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'],
  ["results", "Results", '<path d="M4 17l5-6 4 3 7-9"/><path d="M15 5h5v5"/>'],
  ["rules", "Rules", '<path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3z"/><path d="M4 19a3 3 0 0 1 3-3h13"/>'],
];
const THEME_BTN = '<button class="btn icon" type="button" data-theme-toggle title="Light / dark" aria-label="Switch light or dark theme">' + SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>') + '</button>';
const FOOT = '<div class="foot">Deterministic rules, no model. Every figure comes from the state each check commits, in R and percent of the pot; the dashboard never shows money amounts.</div>';
// Doc pages get the theme toggle only, never the app bundle.
const PAGE_JS = "<script>(function(){var d=document.documentElement;function dark(){var t=d.dataset.theme;return t==='dark'||(t!=='light'&&!matchMedia('(prefers-color-scheme: light)').matches)}document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.addEventListener('click',function(){var n=dark()?'light':'dark';d.dataset.theme=n;try{localStorage.setItem('aifi.theme',n)}catch(e){}document.querySelectorAll('meta[name=theme-color]').forEach(function(m){m.setAttribute('content',n==='light'?'#eef1f6':'#0a0b0f')})})})})();</script>";

// The app shell (spec §2). Mount points the client fills: #capsule (health capsule, the only aria-live
// region), #modepill, #railstat (the capsule's mirror), #ttl (the one h1), #alerts (alert rail, every tab),
// #view (the tab), #sheet/#sheetbg, #toast.
function appPage() {
  const rail = NAV.map(([id, label, d], i) => `<a href="#${id}" data-tab="${id}" class="nav" aria-keyshortcuts="${i + 1}">${SVG(d)}<span>${label}</span><span class="k" aria-hidden="true">${i + 1}</span></a>`).join("");
  const tabs = NAV.map(([id, label, d]) => `<a href="#${id}" data-tab="${id}">${SVG(d)}<span>${label}</span></a>`).join("");
  return HEAD(APP) + `
<div class="shell">
  <aside class="rail glass">
    <a class="brand" href="#now"><span class="mark" aria-hidden="true">Ex</span><div class="bn">${APP}</div></a>
    <nav aria-label="Sections"><span class="pill" aria-hidden="true"></span>${rail}</nav>
    <div class="foot rfoot">
      <button class="status" type="button" id="railstat" data-health><span class="dot"></span><span class="txt"><b>Checking…</b><span class="age"></span></span></button>
      <a class="btn small ghost" href="/logout">Log out</a>
    </div>
  </aside>
  <div class="main"><div class="wrap">
    <header class="topbar"><div class="row">
      <a class="brand tmark" href="#now" aria-label="${APP}, back to Now"><span class="mark" aria-hidden="true">Ex</span></a>
      <h1 id="ttl" class="vh-sm">Now</h1>
      <button class="capsule" type="button" id="capsule" data-health aria-live="polite"><span class="dot"></span><span class="cw">Checking…</span></button>
      <div class="ctl"><span class="pill mute" id="modepill">…</span>${THEME_BTN}</div>
    </div></header>
    <main class="app" id="app"><div class="alerts" id="alerts"></div><div id="view"><div class="card"><div class="empty">Loading the executor…<noscript> This dashboard needs JavaScript.</noscript></div></div></div></main>
    ${FOOT}
  </div></div>
</div>
<nav class="tabbar glass" aria-label="Sections">${tabs}</nav>
${SHEET}
<div class="toast" id="toast"></div>
<script>${CLIENT}</script></body></html>`;
}
const PAGE_TOP = (title, right) => `<div class="wrap" style="max-width:1120px"><header class="topbar"><div class="row"><a class="brand" href="/" style="display:flex;align-items:center;gap:10px" aria-label="${APP} dashboard"><span class="mark" aria-hidden="true">Ex</span></a><h1>${esc(title)}</h1><div class="ctl">${right || ""}${THEME_BTN}</div></div></header>`;
async function docPage(env, slug) {
  const raw = await env.EXEC.get("doc:" + slug);
  const others = DOCS.map(s => `<a class="btn small" href="/doc/${s}"${s === slug ? ' aria-current="page"' : ""}>${esc(DOC_TITLES[s])}</a>`).join(" ");
  return html(HEAD(DOC_TITLES[slug]) + PAGE_TOP(DOC_TITLES[slug], `<a class="btn" href="/#rules/${slug}">Dashboard</a>`) + `<nav class="crumbs" aria-label="Documents">${others}</nav><div class="card doc rise">${md(raw || "_This document has not been pushed yet._")}</div>${FOOT}</div>${PAGE_JS}</body></html>`);
}
function loginPage(msg) {
  return HEAD(APP + " · sign in") + `<div class="login-wrap"><div class="card login rise${msg ? " shake" : ""}"><div class="brand"><span class="mark" aria-hidden="true">Ex</span><h1>${APP}</h1></div><p class="sub" style="margin:0">Private. Enter the dashboard password.</p><form method="post" action="/login"><input class="field" type="password" name="password" autocomplete="current-password" autofocus required placeholder="password" aria-label="Password">${msg ? '<div class="err">' + esc(msg) + "</div>" : ""}<button class="btn primary" type="submit" style="width:100%;justify-content:center;height:40px">Sign in</button></form></div></div></body></html>`;
}
function setupPage() {
  return HEAD(APP + " · not configured") + `<div class="login-wrap"><div class="card login rise"><h1>Not configured</h1><p class="ink2">The Worker has no <code>DASHBOARD_PASSWORD</code> secret yet. Run the <b>deploy-dashboard</b> workflow with the secret set, or from <code>cloud/</code>: <pre>npx wrangler secret put DASHBOARD_PASSWORD</pre></p></div></div></body></html>`;
}
