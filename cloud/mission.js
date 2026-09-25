// AiFi Executor dashboard — mission control vocabulary (spec §11–§13). Appended after design.js's CSS.
// design.js stays a clean AiFi copy; every executor-wide addition and override lives here: tokens, the
// fixes, the shell (topbar, capsule, rail mirror, alert rail), mode pills, the .st-<code> stage vocabulary,
// sheet/tip/toast basics, 44px hit areas and the motion kit. A module's own components live in
// ui/<module>.css under its prefix (nw- gr- dl- ac- ps- rs- ru- ar-), see ui/README.md.
// Tokens only (var(--…)); the few literal colours are the spec's contrast tokens.
export const MISSION_CSS = `
.agentbtn{cursor:pointer;max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sheet tr.on td{background:var(--accent-soft)}

/* ================= tokens ================= */
:root{--dur-1:180ms;--dur-2:350ms;--dur-3:600ms;--muted:#8d95a2;
  --hatch:repeating-linear-gradient(45deg,var(--line-2) 0 1.5px,transparent 1.5px 5px)}
/* light health colours: at least 4.7:1 as pill text on their own -soft tint over card glass, even where the page's
   magenta, violet or teal light sits under the glass (backdrop saturate 150%); the spec's #15784a/#8a5a0f/#b53a35
   measured 4.1-4.4 there */
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){--good:#136d43;--warn:#84560e;--bad:#a83631}}
:root[data-theme=light]{--good:#136d43;--warn:#84560e;--bad:#a83631}

/* ================= fixes ================= */
.brand .mark{background:linear-gradient(135deg,var(--accent),var(--violet));box-shadow:none}
.bar .fill{left:0;width:100%;transform-origin:left;transform:scaleX(var(--k,0));background:var(--fill,var(--ink-2));transition:transform var(--dur-3) var(--ease)}
.tbl td.empty{text-align:center;white-space:normal}
.tbl th{z-index:2;-webkit-backdrop-filter:none;backdrop-filter:none;background:color-mix(in srgb,var(--bg) 70%,var(--glass-2))}
ul.list{padding:0;margin:0;list-style:none}
/* markdown tables (docs, Sunday review) sit in a disclosure, closed under 900px (core.js mdTables) */
.doc details.mdt{margin:var(--s3) 0}
.mdt summary{gap:10px;font-size:13.5px}
.mdt summary .mdt-s{min-width:0;overflow-wrap:anywhere}
.mdt summary .sub{margin-left:auto;font-weight:500;white-space:nowrap}
.mdt summary::after{margin-left:0}
details.disc.mdt .body{padding:0 12px 12px}
.doc .mdt .tbl{margin:0}
/* words break only between words (no "BO OK"); a wide table scrolls inside its .tbl with the edge fade */
.doc .mdt th,.doc .mdt td{overflow-wrap:normal;word-break:normal;min-width:6ch}
.doc .mdt th{white-space:nowrap}
.tip{position:relative;z-index:1}   /* a tip's 44px hit area sits above the bar or number next to it */
.vh{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
html.hid .bg,html.play .bg{animation-play-state:paused}
.meter i{background:var(--fill,var(--ink-2))}
.meter.sx i{width:100%;transform-origin:left;transform:scaleX(var(--k,0));transition:transform var(--dur-3) var(--ease)}
@media(max-width:640px){.bar{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px}.bar .name{grid-column:1/-1}}
/* magenta rule (spec §1.6): solid accent only for "the bot acted" and the clock; identity is text or a
   1px outline; only the big verdict pill glows */
.td.g,.td.r{box-shadow:none}
.tk{color:var(--accent);background:var(--glass-2);border-color:var(--line)}
.tk:hover{background:var(--glass-3);border-color:var(--accent-line)}
.seg .ind{background:var(--glass-3);box-shadow:inset 0 1px 0 var(--hi),0 0 0 1px var(--line)}
.seg button[aria-pressed=true]{color:var(--ink)}
.fchip[aria-pressed=true]{background:var(--glass-3);color:var(--accent);border-color:var(--accent-line)}
.shell .btn.primary,.sheet .btn.primary{background:transparent;color:var(--accent);border-color:var(--accent-line);box-shadow:none}
.shell .btn.primary:hover,.sheet .btn.primary:hover{background:var(--accent-soft);filter:none}
.crumbs .btn[aria-current=page]{color:var(--accent);border-color:var(--accent-line);background:var(--glass-3)}

/* ================= shell ================= */
.app{margin-top:var(--s4)}
/* rail: brand is a div (one h1 per page), status block is a button that mirrors the capsule */
.rail .brand .bn{font-size:17px;font-weight:600;letter-spacing:-.015em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rail nav .pill{transition:transform var(--dur-2) var(--ease),height var(--dur-2) var(--ease),opacity var(--dur-1)}
.rail nav a::before{content:"";position:absolute;inset:-2px 0}
.rail .rfoot{text-align:left;font-size:inherit}
.rail .rfoot .btn{justify-content:center}
.rail .status{width:100%;text-align:left;cursor:pointer;transition:background-color var(--dur-1)}
.rail .status:hover{background:var(--glass-3)}
.rail .status .age{display:block;font-family:var(--mono);font-size:12px;font-weight:500;color:var(--ink-2);font-variant-numeric:tabular-nums}
.rail .status.warn{background:var(--warn-soft);border-color:transparent}
.rail .status.bad{background:var(--bad-soft);border-color:transparent}
/* the 6px "new events" dot on a tab (Activity), toggled with class "new" on the tab's links: an accent tint (spec §2,
   §1.6 tint tier) with a 1px accent outline so it still reads on the glass; never a solid magenta mark */
.tabbar a{position:relative}
.rail nav a.new::after,.tabbar a.new::after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line);pointer-events:none}
.rail nav a.new::after{left:25px;top:8px}
.tabbar a.new::after{left:calc(50% + 8px);top:5px}
/* tablet rail (641–900): labels stay for screen readers */
@media(max-width:900px){
  .rail nav a span:not(.k),.rail .status .txt{display:block;position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
  .rail .brand .bn{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%)}
  .rail nav a.new::after{left:calc(50% + 6px)}}
/* topbar, 52px: desktop [h1][capsule] ··· [mode][theme]; phone [Ex][capsule, flex][mode][theme] */
.topbar{padding-top:9px;padding-bottom:8px}
.topbar .row{flex-wrap:nowrap;min-height:34px;min-width:0}
.topbar h1{flex:none;white-space:nowrap}
.topbar .ctl{flex:none;flex-wrap:nowrap}
.tmark{display:none}
@media(max-width:640px){
  .tmark{display:flex;flex:none;align-items:center;position:relative}
  .tmark .mark{width:28px;height:28px;border-radius:8px;font-size:12px}
  .topbar .row{gap:8px}
  .topbar .capsule{flex:1 1 auto}}

/* ================= capsule (the only aria-live region) ================= */
.capsule{position:relative;display:inline-flex;align-items:center;gap:8px;height:32px;min-width:0;max-width:100%;padding:0 12px 0 11px;border-radius:var(--r-pill);background:var(--glass-2);border:1px solid var(--line);box-shadow:inset 0 1px 0 var(--hi);color:var(--ink);font-size:13px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color var(--dur-1),border-color var(--dur-1)}
.capsule:hover{background:var(--glass-3);color:var(--ink)}
.capsule .dot{width:8px;height:8px}
.capsule .cw{min-width:0;overflow:hidden;text-overflow:ellipsis}
.capsule .ca{flex:none;font-family:var(--mono);font-size:12px;font-weight:500;color:var(--ink-2);font-variant-numeric:tabular-nums}
.capsule.warn{background:var(--warn-soft);border-color:transparent}
.capsule.bad{background:var(--bad-soft);border-color:transparent}
.capsule.mute{color:var(--ink-2)}
.dot.due{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.dot.mute{background:var(--muted);box-shadow:none}

/* ================= mode and state pills ================= */
/* PAPER is .pill.pt (violet, design.js; text pulled toward ink for 4.5:1 in light, never faded). LIVE is an accent
   outline with a static 6px dot. Red never means live. */
.pill.pt{color:color-mix(in srgb,var(--violet) 72%,var(--ink))}
.pill.live{color:var(--accent);background:transparent;border-color:var(--accent-line)}
.pill.live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}
.pill.auto{color:var(--accent);background:transparent;border-color:var(--accent-line)}
.pill.info{color:color-mix(in srgb,var(--accent) 84%,var(--ink));background:var(--accent-soft);border-color:transparent}
.pill.big.ok{box-shadow:0 0 0 1px var(--good-soft),0 8px 26px var(--good-glow)}
.pill.big.warn{box-shadow:0 0 0 1px var(--warn-soft),0 8px 26px var(--warn-glow)}
.pill.big.bad{box-shadow:0 0 0 1px var(--bad-soft),0 8px 26px var(--bad-glow)}
.pill.big.info{box-shadow:0 0 0 1px var(--accent-soft),0 8px 26px var(--accent-glow)}

/* ================= alert rail and banners ================= */
.alerts{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-bottom:var(--s4)}
.alerts:empty{display:none}
.banner .bt{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.banner .bt b{font-weight:600}
.banner .act{flex:none;align-self:center;position:relative;margin-left:auto;padding-left:6px;font-weight:600;color:var(--ink);white-space:nowrap;text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:3px}
.banner .act:hover{color:var(--accent);text-decoration-color:currentColor}
.banner.bad .ic{color:var(--bad)}.banner.warn .ic{color:var(--warn)}.banner.good .ic{color:var(--good)}.banner.info .ic{color:var(--ink-2)}
@media(max-width:640px){.banner{flex-wrap:wrap}.banner .bt{flex-basis:calc(100% - 28px)}.banner .act{margin-left:28px;padding-left:0}}

/* ================= brief and bmeter (ported verbatim from AiFi design.js) ================= */
.brief{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:6px;border-radius:var(--r)}
.brief .bi{display:flex;flex-direction:column;gap:3px;padding:10px 16px;border-radius:12px;min-width:0;color:inherit;text-decoration:none;position:relative;transition:background .2s}
.brief .bi+.bi::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:1px;background:var(--line)}
.brief a.bi:hover{background:var(--glass-2);color:inherit}
.brief a.bi:hover::after{content:"›";position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--muted)}
.brief .bk{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.brief .bv{display:flex;align-items:center;gap:7px;font-size:16px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brief .bv .dot{width:8px;height:8px}
.brief .bs{font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@container (max-width:620px){.brief{grid-template-columns:repeat(2,minmax(0,1fr))}.brief .bi{padding:10px 12px}.brief .bs{white-space:normal;overflow:visible;line-height:1.35}.brief .bi:nth-child(3)::before{display:none}.brief .bi:nth-child(n+3){border-top:1px solid var(--line);border-radius:0 0 12px 12px}}
.bmeter{position:relative;height:8px;border-radius:4px;background:var(--glass-2);border:1px solid var(--line);margin:2px 0 2px}
.bmeter i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--good)}
.bmeter i.low{background:var(--warn)}
.bmeter span{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;border-radius:1px;background:var(--ink)}
/* .brief switches to 2×2 by its container: give an ancestor .cq (or .mission) */
.cq,.mission{container-type:inline-size}

/* ================= one state vocabulary (spec §12): .st-<code> ================= */
/* Each class sets variables only; components read them. --st: edge/dot colour · --st-bg: chip or tile fill
   · --st-ink: text on --st-bg · --st-cell: tape/heartbeat cell fill (may be a pattern) · --st-ring and
   --st-ls: outline colour and style. Codes "!" and "-" are written class="st-!" / class="st--". */
[class^="st-"],[class*=" st-"]{--st:var(--muted);--st-bg:transparent;--st-ink:var(--ink-2);--st-cell:transparent;--st-ring:transparent;--st-ls:solid}
.st-h{--st:var(--good);--st-ink:var(--good);--st-ring:var(--good)}
.st-x{--st:color-mix(in srgb,var(--bad) 45%,transparent);--st-bg:var(--bad-soft);--st-cell:var(--hatch)}
[class~="st-!"]{--st:var(--bad);--st-bg:var(--bad-soft);--st-ink:var(--bad);--st-cell:var(--bad)}
.st-w,.st-d{--st:var(--muted);--st-ink:var(--muted);--st-cell:color-mix(in srgb,var(--muted) 38%,transparent)}
.st-n,.st-g{--st:var(--muted);--st-ink:var(--muted);--st-cell:color-mix(in srgb,var(--muted) 18%,transparent)}
.st-a{--st:var(--accent-line);--st-bg:var(--accent-soft);--st-ink:var(--accent);--st-cell:color-mix(in srgb,var(--accent) 34%,transparent)}
.st-t{--st:var(--warn);--st-ink:var(--warn);--st-ring:var(--warn);--st-cell:color-mix(in srgb,var(--warn) 30%,transparent)}
.st-u{--st:color-mix(in srgb,var(--good) 50%,transparent);--st-bg:var(--good-soft);--st-ink:var(--good);--st-cell:color-mix(in srgb,var(--good) 30%,transparent)}
.st-m{--st:var(--muted);--st-ink:var(--muted);--st-ring:var(--muted);--st-ls:dashed}
.st-r{--st:var(--warn);--st-bg:var(--warn-soft);--st-ink:var(--warn);--st-cell:var(--warn)}
.st-p{--st:var(--ink-2);--st-ink:var(--ink-2);--st-ring:var(--ink-2)}
.st-P{--st:var(--ink-2);--st-ink:var(--ink-2);--st-ring:var(--ink-2);--st-cell:color-mix(in srgb,var(--ink-2) 45%,transparent)}
.st-e{--st:var(--bad);--st-bg:var(--bad-soft);--st-ink:var(--bad);--st-cell:var(--bad)}
.st-E{--st:var(--accent);--st-bg:var(--accent);--st-ink:var(--accent-ink);--st-cell:var(--accent)}
[class~="st--"]{--st:var(--line-2);--st-ink:var(--muted);--st-cell:var(--hatch)}
/* consumers */
.stg-edge{box-shadow:inset 3px 0 0 var(--st,var(--line-2))}
.stg-cell{background:var(--st-cell,transparent);outline:1px var(--st-ls,solid) var(--st-ring,transparent);outline-offset:-1px}
.stg-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--st,var(--muted));flex:none}
.stg-word{color:var(--st-ink,var(--ink-2))}
.hatch{background-image:var(--hatch)}

/* ================= facts, missing values, captions, new dot ================= */
dl.facts,.sheet dl.facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:var(--s3) 0;font-size:var(--fs-sm);color:var(--ink)}
dl.facts dt{color:var(--muted);min-width:0}
dl.facts dd{margin:0;min-width:0;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);overflow-wrap:anywhere}
dl.facts dd .sub,dl.facts dd .na{font-family:var(--font)}
.na{color:var(--muted);font-size:var(--fs-sm)}
.cap{color:var(--muted);font-size:var(--fs-xs);line-height:1.45}
.newdot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent-line);flex:none;vertical-align:middle}
.mask-r{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 32px),transparent)}
.mask-l{-webkit-mask-image:linear-gradient(to right,transparent,#000 32px);mask-image:linear-gradient(to right,transparent,#000 32px)}
.mask-l.mask-r{-webkit-mask-image:linear-gradient(to right,transparent,#000 32px,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(to right,transparent,#000 32px,#000 calc(100% - 32px),transparent)}

/* ================= sheet, tip and toast ================= */
.sheet h2{font-size:var(--fs-xl);letter-spacing:-.02em;margin:0 0 var(--s2);padding-right:44px}
.sheet .x{z-index:3}
.sheet .sec{margin-top:var(--s5)}
.sheet .sec>h3{font-size:var(--fs-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:var(--s2)}
.sheet .pn{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:var(--s5);padding-top:var(--s3);border-top:1px solid var(--line)}
html.noscroll,html.noscroll body{overflow:hidden}
.tipbox{background:color-mix(in srgb,var(--bg) 90%,var(--ink));border:1px solid var(--line-2)}
.tipbox.on{pointer-events:auto}
.tipbox .btn{margin-top:8px}
.toast{position:fixed;left:50%;bottom:28px;z-index:45;display:flex;align-items:center;gap:10px;width:max-content;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border-radius:14px;border:1px solid var(--line-2);background:color-mix(in srgb,var(--bg) 92%,transparent);-webkit-backdrop-filter:blur(var(--blur)) saturate(150%);backdrop-filter:blur(var(--blur)) saturate(150%);box-shadow:inset 0 1px 0 var(--hi),var(--shadow);color:var(--ink);font-size:var(--fs-sm);line-height:1.4;opacity:0;visibility:hidden;pointer-events:none;transform:translate(-50%,12px);transition:opacity var(--dur-2) var(--ease),transform var(--dur-2) var(--ease),visibility 0s linear var(--dur-2)}
.toast.on{opacity:1;visibility:visible;pointer-events:auto;transform:translate(-50%,0);transition-delay:0s}
.toast .btn{flex:none}
@media(max-width:640px){.toast{bottom:calc(84px + env(safe-area-inset-bottom))}}

/* ================= 44px hit areas ================= */
/* A transparent ::before at least 44×44 centred on the control (sized from the padding box, so borders
   never shave it to 42). .hit adds it to anything; .hit.round makes it a circle (dial beads, whose hit
   must not cover the centre text); .hit6 is the spec's "inset −6px" for 32px chips and buttons. */
.hit,.btn,.fchip,button.tk,a.tk{position:relative}
.hit::before,.btn::before,.capsule::before,.tmark::before,.tip::before,.fchip::before,button.tk::before,a.tk::before,.banner .act::before{content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%)}
.hit.round::before{border-radius:50%}
.hit6{position:relative}.hit6::before{content:"";position:absolute;inset:-7px}
button.tk,a.tk{cursor:pointer}
/* a coin chip is at least 44px wide, so two chips side by side ("UNI, SOL") never share a hit area */
button.tk,a.tk{min-width:44px;justify-content:center}
/* wrapped filter-chip rows: 28–30px chips 16px apart, so each 44px hit area is its own */
.fchips{row-gap:16px}
@media(pointer:coarse){.seg button{min-height:38px}}

/* ================= motion kit (spec §13): transform and opacity only ================= */
@keyframes pop{0%,100%{transform:scale(1)}45%{transform:scale(1.35)}}
@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scale(.6)}to{transform:scale(1)}}
.enter{animation:enter var(--dur-3) var(--ease) both}
.pop1{animation:pop var(--dur-2) var(--ease) 1}
.grow1{animation:grow var(--dur-2) var(--ease) 1}
.pulse1{animation:pulse var(--dur-3) var(--ease) 1}

/* ================= visibility helpers ================= */
@media(max-width:640px){
  .vh-sm{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
  .wide-only{display:none!important}}
@media(min-width:641px){.phone-only{display:none!important}}

/* ================= reduced motion: final states, no pulses ================= */
@media(prefers-reduced-motion:reduce){
  .enter,.pop1,.grow1,.pulse1{animation:none!important}
  .bar .fill,.meter i,.rail nav .pill,.toast,.capsule{transition:none!important}}
`;
