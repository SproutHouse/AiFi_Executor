// AiFi Executor dashboard — Cloudflare Worker. Auth, API, app shell, document pages.
// Data comes from KV, written after every cycle by scripts/dashboard_push.py. CSS from design.js.
import { CSS, FONTS } from "./design.js";
import CLIENT from "./client.js";

const APP = "AiFi Executor";
const COOKIE = "ex";
const DAY = 86400;
const DOCS = ["how_it_works", "logic", "risk", "universe", "execution", "security", "ledger", "operations", "decisions"];
const DOC_TITLES = { how_it_works: "How it works", logic: "Decision logic", risk: "Risk", universe: "Universe and books",
                     execution: "Execution", security: "Security", ledger: "The ledger", operations: "Runbook", decisions: "Decisions" };

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
    if (p === "/api/latest") return kvJson(env, "exec:latest");
    if (p === "/api/dates") return kvJson(env, "dates");
    if ((m = p.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/))) return kvJson(env, "exec:" + m[1]);
    if ((m = p.match(/^\/api\/doc\/([a-z_]{3,20})$/)) && DOCS.includes(m[1])) {
      const raw = await env.EXEC.get("doc:" + m[1]);
      return json({ slug: m[1], title: DOC_TITLES[m[1]], html: md(raw || "_This document has not been pushed yet._") });
    }
    if ((m = p.match(/^\/doc\/([a-z_]{3,20})$/)) && DOCS.includes(m[1])) return docPage(env, m[1]);
    return new Response("not found", { status: 404 });
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
function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function redirect(to, setCookie) {
  const h = { Location: to };
  if (setCookie) h["Set-Cookie"] = setCookie;
  return new Response(null, { status: 302, headers: h });
}
async function kvJson(env, key) {
  const v = await env.EXEC.get(key);
  if (v === null) return json({ error: "no data for " + key }, 404);
  if (key.startsWith("exec:")) {
    const b = JSON.parse(v);
    b.review_html = b.review_md ? md(b.review_md) : "";
    return json(b);
  }
  return new Response(v, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
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
  const out = []; let i = 0, list = null, para = [];
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
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(m[1]) + "</li>"); i++; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(m[1]) + "</li>"); i++; continue; }
    if (/^\s*$/.test(l)) { flushP(); closeList(); i++; continue; }
    if (/^<!--/.test(l) || /^_.*_$/.test(l.trim()) && i < 4) { i++; continue; }
    closeList(); para.push(l.trim()); i++;
  }
  flushP(); closeList();
  return out.join("\n");
}

// ------------------------------------------------------------------ pages --
const HEAD = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0a0b0f"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Executor"><title>${esc(title)}</title><script>try{var t=localStorage.getItem('aifi.theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>${FONTS}<style>${CSS}</style></head><body><div class="bg" aria-hidden="true"></div>`;
const SHEET = '<div class="sheet-bg" id="sheetbg"></div><div class="sheet glass" id="sheet" role="dialog" aria-modal="true"></div>';
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const NAV = [
  ["overview", "Overview", '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="14" width="8" height="7" rx="2"/>'],
  ["book", "Book", '<path d="M4 5h16v14H4z"/><path d="M4 10h16M9 5v14"/>'],
  ["trades", "Trades", '<path d="M4 17l5-6 4 3 7-9"/><path d="M15 5h5v5"/>'],
  ["refused", "Refused", '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'],
  ["logic", "Logic", '<path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3z"/><path d="M4 19a3 3 0 0 1 3-3h13"/>'],
];
const THEME_BTN = '<button class="btn icon" type="button" data-theme-toggle title="Light / dark" aria-label="toggle theme">' + SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>') + '</button>';
const FOOT = '<div class="foot">Deterministic rules, no model. Every number comes from the state the cycle commits. Sizes are percentages of the pot; the dashboard never shows dollar amounts.</div>';

function appPage() {
  const links = (cls) => NAV.map(([id, label, d], i) => `<a href="#${id}" data-tab="${id}"${cls ? '' : ' class="nav"'}>${SVG(d)}<span>${label}</span>${cls ? '' : `<span class="k">${i + 1}</span>`}</a>`).join("");
  return HEAD(APP) + `
<div class="shell">
  <aside class="rail glass">
    <a class="brand" href="/"><span class="mark">Ex</span><h1>${APP}</h1></a>
    <nav aria-label="sections"><span class="pill"></span>${links(false)}</nav>
    <div class="foot" style="text-align:left;font-size:inherit;margin-top:auto">
      <div class="status"><span class="dot rundot"></span><span class="txt" id="runtxt"><b>Loading</b>&nbsp;</span></div>
      <a class="btn small ghost" href="/logout" style="justify-content:center">Log out</a>
    </div>
  </aside>
  <div class="main"><div class="wrap">
    <div class="topbar"><div class="row"><h1 id="ttl">Overview</h1><span class="when" id="gen"></span>
      <div class="ctl"><span class="pill" id="modepill">…</span><a class="btn" href="#logic/how_it_works">How it works</a>${THEME_BTN}</div></div></div>
    <div id="app" style="margin-top:var(--s4)"><div id="view"><div class="card"><div class="empty">Loading the executor…</div></div></div></div>
    ${FOOT}
  </div></div>
</div>
<nav class="tabbar glass" aria-label="sections">${links(true)}</nav>
${SHEET}
<script>${CLIENT}</script></body></html>`;
}
const PAGE_TOP = (title, right) => `<div class="wrap" style="max-width:1120px"><div class="topbar"><div class="row"><a class="brand" href="/" style="display:flex;align-items:center;gap:10px"><span class="mark">Ex</span></a><h1>${esc(title)}</h1><div class="ctl">${right || ""}<a class="btn" href="/">Dashboard</a>${THEME_BTN}</div></div></div>`;
async function docPage(env, slug) {
  const raw = await env.EXEC.get("doc:" + slug);
  const others = DOCS.map(s => `<a class="btn small${s === slug ? " primary" : ""}" href="/doc/${s}">${esc(DOC_TITLES[s])}</a>`).join(" ");
  return html(HEAD(DOC_TITLES[slug]) + PAGE_TOP(DOC_TITLES[slug]) + `<div class="crumbs">${others}</div><div class="card doc rise">${md(raw || "_This document has not been pushed yet._")}</div>${FOOT}</div><script>${CLIENT}</script></body></html>`);
}
function loginPage(msg) {
  return HEAD(APP + " · sign in") + `<div class="login-wrap"><div class="card login rise${msg ? " shake" : ""}"><div class="brand"><span class="mark">Ex</span><h1>${APP}</h1></div><p class="sub" style="margin:0">Private. Enter the dashboard password.</p><form method="post" action="/login"><input class="field" type="password" name="password" autocomplete="current-password" autofocus required placeholder="password">${msg ? '<div class="err">' + esc(msg) + "</div>" : ""}<button class="btn primary" type="submit" style="width:100%;justify-content:center;height:40px">Sign in</button></form></div></div><script>${CLIENT}</script></body></html>`;
}
function setupPage() {
  return HEAD(APP + " · not configured") + `<div class="login-wrap"><div class="card login rise"><h1>Not configured</h1><p class="ink2">The Worker has no <code>DASHBOARD_PASSWORD</code> secret yet. Run the <b>deploy-dashboard</b> workflow with the secret set, or from <code>cloud/</code>: <pre>npx wrangler secret put DASHBOARD_PASSWORD</pre></p></div></div></body></html>`;
}
