// AiFi Executor dashboard — design system (AiFi tokens, magenta accent). THE single source of visual truth.
// Every page the Worker renders pulls its CSS from here; DESIGN.md explains
// the tokens and the rules in plain words. Liquid glass on a deep, faintly
// tinted ground: translucent panels that blur what drifts behind them, one
// cyan accent, semantic colour that always travels with a word.

export const TOKENS = `
:root{
  /* ---- ground & glass (dark is the default) ---- */
  --bg:#0a0b0f;
  --bg-tint-1:rgba(240,78,194,.16);   /* magenta blob */
  --bg-tint-2:rgba(139,124,246,.16);  /* violet blob */
  --bg-tint-3:rgba(37,199,164,.12);   /* teal blob */
  --glass:rgba(255,255,255,.055);     /* cards */
  --glass-2:rgba(255,255,255,.085);   /* nested surfaces, inputs, hover rows */
  --glass-3:rgba(255,255,255,.13);    /* pressed / selected */
  --line:rgba(255,255,255,.10);       /* every hairline */
  --line-2:rgba(255,255,255,.18);     /* emphasised rule */
  --hi:rgba(255,255,255,.10);         /* the top-edge highlight on glass */
  --ink:#f2f4f8; --ink-2:#b9bfca; --muted:#7f8794;
  --accent:#f04ec2; --accent-ink:#1b0713;
  --accent-soft:rgba(240,78,194,.14); --accent-line:rgba(240,78,194,.55); --accent-glow:rgba(240,78,194,.35);
  --violet:#9d8ff7; --violet-soft:rgba(157,143,247,.16);
  --good:#41d18f; --good-soft:rgba(65,209,143,.16); --good-glow:rgba(65,209,143,.3);
  --warn:#f0b04a; --warn-soft:rgba(240,176,74,.16); --warn-glow:rgba(240,176,74,.3);
  --bad:#ff6b6b;  --bad-soft:rgba(255,107,107,.16);  --bad-glow:rgba(255,107,107,.3);
  --shadow:0 24px 70px rgba(0,0,0,.5);
  --shadow-sm:0 10px 30px rgba(0,0,0,.35);
  --blur:22px;
  /* ---- type ---- */
  --font:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --fs-xs:11px; --fs-sm:12.5px; --fs-md:14px; --fs-lg:16px; --fs-xl:20px; --fs-2xl:28px; --fs-3xl:36px;
  --lh:1.5;
  /* ---- space & shape ---- */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px; --s6:28px; --s7:40px;
  --r:18px; --r-md:12px; --r-sm:8px; --r-pill:999px;
  --rail:232px; --wrap:1360px;
  --ease:cubic-bezier(.16,1,.3,1);
}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){
  --bg:#eef1f6; --bg-tint-1:rgba(184,49,138,.18); --bg-tint-2:rgba(124,110,240,.16); --bg-tint-3:rgba(30,180,150,.14);
  --glass:rgba(255,255,255,.58); --glass-2:rgba(255,255,255,.72); --glass-3:rgba(255,255,255,.9);
  --line:rgba(20,30,45,.10); --line-2:rgba(20,30,45,.18); --hi:rgba(255,255,255,.9);
  --ink:#0f1720; --ink-2:#3d4653; --muted:#6b7480;
  --accent:#b8318a; --accent-ink:#ffffff; --accent-soft:rgba(184,49,138,.12); --accent-line:rgba(184,49,138,.5); --accent-glow:rgba(184,49,138,.25);
  --violet:#6e5ee8; --violet-soft:rgba(110,94,232,.12);
  --good:#1f9d63; --good-soft:rgba(31,157,99,.13); --good-glow:rgba(31,157,99,.22);
  --warn:#b7791f; --warn-soft:rgba(183,121,31,.14); --warn-glow:rgba(183,121,31,.22);
  --bad:#d9534f;  --bad-soft:rgba(217,83,79,.13);  --bad-glow:rgba(217,83,79,.22);
  --shadow:0 24px 70px rgba(30,40,60,.16); --shadow-sm:0 10px 30px rgba(30,40,60,.10)}}
:root[data-theme=light]{
  --bg:#eef1f6; --bg-tint-1:rgba(184,49,138,.18); --bg-tint-2:rgba(124,110,240,.16); --bg-tint-3:rgba(30,180,150,.14);
  --glass:rgba(255,255,255,.58); --glass-2:rgba(255,255,255,.72); --glass-3:rgba(255,255,255,.9);
  --line:rgba(20,30,45,.10); --line-2:rgba(20,30,45,.18); --hi:rgba(255,255,255,.9);
  --ink:#0f1720; --ink-2:#3d4653; --muted:#6b7480;
  --accent:#b8318a; --accent-ink:#ffffff; --accent-soft:rgba(184,49,138,.12); --accent-line:rgba(184,49,138,.5); --accent-glow:rgba(184,49,138,.25);
  --violet:#6e5ee8; --violet-soft:rgba(110,94,232,.12);
  --good:#1f9d63; --good-soft:rgba(31,157,99,.13); --good-glow:rgba(31,157,99,.22);
  --warn:#b7791f; --warn-soft:rgba(183,121,31,.14); --warn-glow:rgba(183,121,31,.22);
  --bad:#d9534f;  --bad-soft:rgba(217,83,79,.13);  --bad-glow:rgba(217,83,79,.22);
  --shadow:0 24px 70px rgba(30,40,60,.16); --shadow-sm:0 10px 30px rgba(30,40,60,.10)}
@media(max-width:640px){:root{--blur:16px;--r:16px}}
`;

export const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:dark light;-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs-md)/var(--lh) var(--font);-webkit-font-smoothing:antialiased;min-height:100vh;transition:background-color .4s ease,color .4s ease}
a{color:var(--ink);text-decoration:none}a:hover{color:var(--accent)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--r-sm)}
code,.mono,.num{font-family:var(--mono);font-size:.93em;font-variant-numeric:tabular-nums}
code{background:var(--glass-2);border:1px solid var(--line);padding:1px 5px;border-radius:var(--r-sm)}
pre{background:var(--glass-2);border:1px solid var(--line);border-radius:var(--r-md);padding:var(--s3) var(--s4);overflow-x:auto;font-family:var(--mono);font-size:var(--fs-sm);line-height:1.55}
pre code{background:none;border:0;padding:0}
h1,h2,h3,h4{margin:0;font-weight:600;letter-spacing:-.015em;text-wrap:balance}
h1{font-size:var(--fs-xl)}h3{font-size:var(--fs-lg)}
.eyebrow{font-size:var(--fs-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
h2.eyebrow{margin-bottom:var(--s3)}
.sub{color:var(--muted);font-size:var(--fs-sm)}.ink2{color:var(--ink-2)}
.pos{color:var(--good)}.neg{color:var(--bad)}
.note{color:var(--muted);font-size:var(--fs-sm);line-height:1.5}
.hide{display:none!important}
/* ---- the light behind the glass ---- */
.bg{position:fixed;inset:-25%;z-index:-1;pointer-events:none;
  background:
    radial-gradient(38% 34% at 18% 22%,var(--bg-tint-1),transparent 70%),
    radial-gradient(34% 30% at 82% 28%,var(--bg-tint-2),transparent 70%),
    radial-gradient(40% 36% at 55% 88%,var(--bg-tint-3),transparent 70%);
  animation:drift 48s ease-in-out infinite alternate;will-change:transform;transition:opacity .6s}
@keyframes drift{from{transform:translate3d(-2%,-1%,0) rotate(-1.5deg)}to{transform:translate3d(2%,2%,0) rotate(1.5deg)}}
/* ---- glass surfaces ---- */
.glass,.card{background:var(--glass);-webkit-backdrop-filter:blur(var(--blur)) saturate(150%);backdrop-filter:blur(var(--blur)) saturate(150%);border:1px solid var(--line);border-radius:var(--r);box-shadow:inset 0 1px 0 var(--hi),var(--shadow-sm)}
.card{padding:var(--s5);position:relative;transition:transform .25s var(--ease),box-shadow .25s var(--ease),background-color .4s ease}
.card.lift:hover{transform:translateY(-2px);box-shadow:inset 0 1px 0 var(--hi),var(--shadow)}
.inset{background:var(--glass-2);border:1px solid var(--line);border-radius:var(--r-md);padding:var(--s3) var(--s4)}
/* ---- motion ---- */
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--accent-glow)}50%{box-shadow:0 0 0 6px transparent}}
.rise{animation:rise .6s var(--ease) both}
.fade{animation:fade .35s ease both}
@media(prefers-reduced-motion:reduce){
  .bg{animation:none}
  .rise{animation:fade .2s ease both}
  *,*::before,*::after{transition-duration:.01ms!important;animation-duration:.01ms!important;scroll-behavior:auto!important}
  .rise,.fade{animation-duration:.2s!important}}
`;

export const COMPONENTS = `
/* ================= shell ================= */
.shell{display:flex;min-height:100vh}
.rail{position:fixed;left:0;top:0;bottom:0;width:var(--rail);z-index:30;display:flex;flex-direction:column;padding:var(--s4) var(--s3);gap:var(--s3);border-radius:0;border-width:0 1px 0 0;box-shadow:none;transition:width .35s var(--ease)}
.rail .brand{display:flex;align-items:center;gap:10px;padding:6px 8px 12px;min-height:44px}
.brand .mark{width:30px;height:30px;flex:none;border-radius:9px;background:linear-gradient(135deg,var(--accent),#7de9f0);display:grid;place-items:center;color:var(--accent-ink);font-weight:800;font-size:13px;letter-spacing:-.02em;box-shadow:0 6px 18px var(--accent-glow)}
.brand h1{font-size:17px;white-space:nowrap;overflow:hidden;transition:opacity .25s}
.rail nav{position:relative;display:flex;flex-direction:column;gap:2px}
.rail nav .pill{position:absolute;left:0;right:0;top:0;height:40px;border-radius:12px;background:var(--glass-3);border:1px solid var(--line);box-shadow:inset 0 1px 0 var(--hi);transition:transform .4s var(--ease),height .4s var(--ease),opacity .3s;opacity:0;pointer-events:none}
.rail nav .pill.on{opacity:1}
.rail nav a{position:relative;z-index:1;display:flex;align-items:center;gap:11px;height:40px;padding:0 11px;border-radius:12px;color:var(--ink-2);font-weight:500;font-size:13.5px;white-space:nowrap;transition:color .2s}
.rail nav a svg{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .3s var(--ease)}
.rail nav a:hover{color:var(--ink)}.rail nav a:hover svg{transform:translateY(-1px)}
.rail nav a[aria-current=page]{color:var(--ink)}
.rail nav a[aria-current=page] svg{stroke:var(--accent)}
.rail nav a .k{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:0 5px;line-height:16px}
.rail .foot{margin-top:auto;display:flex;flex-direction:column;gap:8px}
.rail .status{display:flex;align-items:center;gap:10px;font-size:var(--fs-sm);color:var(--ink-2);padding:10px 11px;border-radius:12px;background:var(--glass-2);border:1px solid var(--line)}
.rail .status .txt{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rail .status b{display:block;color:var(--ink);font-weight:600}
.dot{width:9px;height:9px;flex:none;border-radius:50%;background:var(--muted)}
.dot.ok{background:var(--good);box-shadow:0 0 0 3px var(--good-soft)}.dot.gap{background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft)}.dot.bad{background:var(--bad);box-shadow:0 0 0 3px var(--bad-soft)}
.main{flex:1;min-width:0;margin-left:var(--rail);transition:margin-left .35s var(--ease)}
.wrap{max-width:var(--wrap);margin:0 auto;padding:var(--s4) var(--s6) 90px}
/* top bar */
.topbar{position:sticky;top:0;z-index:20;margin:0 calc(-1*var(--s6));padding:var(--s3) var(--s6);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 62%,transparent);-webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%)}
.topbar .row{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap}
.topbar h1{font-size:22px;letter-spacing:-.02em}
.topbar .ctl{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.topbar .when{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:var(--fs-sm)}
/* bottom tab bar on phones */
.tabbar{display:none}
@media(max-width:900px){
  :root{--rail:76px}
  .rail .brand h1,.rail nav a span:not(.k),.rail nav a .k,.rail .status .txt{display:none}
  .rail{padding:var(--s3) 10px;align-items:stretch}
  .rail .brand{justify-content:center;padding:6px 0 10px}
  .rail nav a{justify-content:center;padding:0}
  .rail .status{justify-content:center;padding:10px}
  .wrap{padding:var(--s3) var(--s4) 90px}.topbar{margin:0 calc(-1*var(--s4));padding:var(--s3) var(--s4)}}
@media(max-width:640px){
  :root{--rail:0px}
  .rail{display:none}
  .main{margin-left:0}
  .tabbar{display:flex;position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:30;padding:6px;gap:2px;border-radius:20px;box-shadow:var(--shadow)}
  .tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0 5px;border-radius:14px;color:var(--muted);font-size:10.5px;font-weight:500;transition:background .2s,color .2s}
  .tabbar a svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .tabbar a[aria-current=page]{color:var(--accent);background:var(--glass-3)}
  .wrap{padding-bottom:110px}
  .topbar h1{font-size:19px}
  /* one compact row: title, day, theme. The date is in the Today card and
     "How it works" is the Logic tab in the bottom bar. */
  .topbar .row{flex-wrap:nowrap}
  .topbar .when,.topbar .ctl a.btn{display:none}
  .topbar .ctl{flex-wrap:nowrap;margin-left:auto}
  .topbar select.field{max-width:170px}}
/* ================= controls ================= */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:11px;border:1px solid var(--line);background:var(--glass-2);color:var(--ink);font-size:var(--fs-sm);font-weight:500;line-height:1.2;white-space:nowrap;transition:background .2s,border-color .2s,transform .2s var(--ease),box-shadow .2s;box-shadow:inset 0 1px 0 var(--hi)}
.btn:hover{background:var(--glass-3);border-color:var(--line-2);transform:translateY(-1px)}
.btn:active{transform:translateY(0) scale(.98)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent;box-shadow:0 8px 20px var(--accent-glow)}
.btn.primary:hover{filter:brightness(1.06)}
.btn.ghost{background:transparent;box-shadow:none}
.btn.small{padding:5px 10px;font-size:var(--fs-xs);border-radius:9px}
.btn.icon{width:34px;height:34px;padding:0;justify-content:center;border-radius:10px}
.btn.icon svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.btn:disabled{opacity:.45;cursor:default;transform:none}
input.field,select.field{height:34px;padding:0 12px;border-radius:11px;border:1px solid var(--line);background:var(--glass-2);color:var(--ink);font-size:var(--fs-sm);box-shadow:inset 0 1px 0 var(--hi);outline:0;transition:border-color .2s,box-shadow .2s}
input.field{min-width:min(180px,100%)}
input.field:focus,select.field:focus{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}
input.field::placeholder{color:var(--muted)}
select.field{-webkit-appearance:none;appearance:none;padding-right:30px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px;background-repeat:no-repeat;cursor:pointer}
.search{position:relative}
.search svg{position:absolute;left:10px;top:9px;width:16px;height:16px;stroke:var(--muted);fill:none;stroke-width:1.8;pointer-events:none}
.search input{padding-left:32px}
/* segmented control with a sliding indicator */
.seg{position:relative;display:inline-flex;max-width:100%;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:3px;border-radius:var(--r-pill);background:var(--glass-2);border:1px solid var(--line);box-shadow:inset 0 1px 0 var(--hi)}
.seg::-webkit-scrollbar{display:none}
.seg button{flex:none}
.seg button{position:relative;z-index:1;padding:5px 12px;border-radius:var(--r-pill);font-size:var(--fs-sm);font-weight:500;color:var(--ink-2);transition:color .25s;white-space:nowrap}
.seg button[aria-pressed=true]{color:var(--accent-ink)}
.seg .ind{position:absolute;top:3px;bottom:3px;left:0;width:0;border-radius:var(--r-pill);background:var(--accent);box-shadow:0 4px 14px var(--accent-glow);transition:transform .35s var(--ease),width .35s var(--ease)}
.seg.quiet .ind{background:var(--glass-3);box-shadow:inset 0 1px 0 var(--hi)}
.seg.quiet button[aria-pressed=true]{color:var(--ink)}
/* pills & chips */
.pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:600;letter-spacing:.02em;border:1px solid var(--line);background:var(--glass-2);color:var(--ink-2);white-space:nowrap;line-height:20px;font-family:var(--font)}
.pill.bull,.pill.hold,.pill.ok,.pill.good{color:var(--good);background:var(--good-soft);border-color:transparent}
.pill.cool,.pill.watch,.pill.gap,.pill.warn{color:var(--warn);background:var(--warn-soft);border-color:transparent}
.pill.bear,.pill.cut,.pill.bad,.pill.FAIL{color:var(--bad);background:var(--bad-soft);border-color:transparent}
.pill.nodata,.pill.mute{color:var(--muted)}
.pill.accent{color:var(--accent);background:var(--accent-soft);border-color:transparent}
.pill.src{color:var(--accent);background:var(--accent-soft);border-color:transparent}
.pill.big{font-size:var(--fs-md);height:34px;padding:0 14px;line-height:32px;font-weight:700;letter-spacing:.04em}
.pill.big.bull{box-shadow:0 0 0 1px var(--good-soft),0 8px 26px var(--good-glow)}
.pill.big.cool{box-shadow:0 0 0 1px var(--warn-soft),0 8px 26px var(--warn-glow)}
.pill.big.bear{box-shadow:0 0 0 1px var(--bad-soft),0 8px 26px var(--bad-glow)}
.tk{display:inline-flex;align-items:center;font-family:var(--mono);font-weight:600;font-size:.92em;color:var(--accent);padding:0 6px;border-radius:7px;background:var(--accent-soft);border:1px solid transparent;line-height:1.5;transition:background .2s,transform .2s var(--ease)}
.tk:hover{background:var(--glass-3);border-color:var(--accent-line);transform:translateY(-1px)}
.tag{display:inline-block;padding:1px 7px;border-radius:6px;font-size:var(--fs-xs);color:var(--ink-2);background:var(--glass-2);border:1px solid var(--line);font-family:var(--mono)}
/* tooltip hint */
.tip{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--line-2);color:var(--muted);font-size:10px;font-weight:700;vertical-align:1px;margin-left:4px;cursor:help;transition:color .2s,border-color .2s}
.tip:hover,.tip:focus-visible{color:var(--accent);border-color:var(--accent-line)}
.tipbox{position:fixed;z-index:60;max-width:300px;padding:10px 12px;font-size:var(--fs-sm);line-height:1.45;color:var(--ink);border-radius:var(--r-md);box-shadow:var(--shadow);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .18s,transform .18s var(--ease)}
.tipbox.on{opacity:1;transform:none}
/* ================= layout blocks ================= */
.stack{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4)}
.stack>*,.hero>*,.grid2>*,.grid4>*,.strip>*,.rcard>*,.setup>*,.plan>*,.cand>*{min-width:0}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:var(--s4)}
@media(max-width:640px){.hero,.strip{grid-template-columns:minmax(0,1fr)}}
.grid2{display:grid;grid-template-columns:1.6fr 1fr;gap:var(--s4)}
.grid2.even{grid-template-columns:1fr 1fr}
@media(max-width:1000px){.grid2,.grid2.even{grid-template-columns:1fr}}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s4)}
@media(max-width:1000px){.grid4{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.grid4{grid-template-columns:1fr}}
.card .head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s3);margin-bottom:var(--s3);flex-wrap:wrap}
.card .head .ttl{display:flex;flex-direction:column;gap:3px}
.card .head h2,.card .head h3{font-size:15px;font-weight:600}
.card .head .acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
/* today line */
.today{display:flex;gap:var(--s4);align-items:center;flex-wrap:wrap;padding:var(--s4) var(--s5)}
.today .line{font-size:17px;line-height:1.45;flex:1;min-width:min(260px,100%)}
.today .line b{font-weight:600}
.today .meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:var(--fs-sm)}
/* stat cards */
.stat{display:flex;flex-direction:column;gap:10px}
.stat .lbl{display:flex;align-items:center;gap:8px;color:var(--ink-2);font-size:13px;font-weight:500}
.stat .lbl .ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--glass-2);border:1px solid var(--line)}
.stat .lbl .ic svg{width:15px;height:15px;stroke:var(--accent);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.stat .val{font-size:var(--fs-3xl);font-weight:650;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums}
.stat .val small{font-size:var(--fs-lg);font-weight:500;color:var(--muted);margin-left:4px;letter-spacing:0}
.stat .row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:var(--fs-sm)}
.stat .bottom{margin-top:auto}
.stat .pos-chips{display:flex;gap:6px;flex-wrap:wrap}
.stat .pos-chips .pc{display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 6px;border-radius:9px;background:var(--glass-2);border:1px solid var(--line);font-size:var(--fs-xs)}
.stat .pos-chips .pc i{width:7px;height:7px;border-radius:50%;background:var(--muted)}.stat .pos-chips .pc.HOLD i{background:var(--good)}.stat .pos-chips .pc.WATCH i{background:var(--warn)}.stat .pos-chips .pc.CUT i{background:var(--bad)}
.stat .chips{display:flex;gap:6px;flex-wrap:wrap}
.stat.regime::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(60% 55% at 90% 0%,var(--glow,transparent),transparent 70%);opacity:.9}
.stat.regime.bull{--glow:var(--good-soft)}.stat.regime.cool{--glow:var(--warn-soft)}.stat.regime.bear{--glow:var(--bad-soft)}
.change{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;padding:7px 10px;border-radius:10px;background:var(--glass-2);border:1px solid var(--line);font-size:var(--fs-sm)}
.change .drv{color:var(--muted);flex:1 1 100%;line-height:1.45}
/* pipeline chips */
.steps{display:flex;gap:5px;flex-wrap:wrap}
.step{width:18px;height:18px;border-radius:6px;border:1px solid var(--line);background:var(--glass-2);position:relative;transition:transform .2s var(--ease)}
.step:hover{transform:scale(1.25)}
.step.ok{background:var(--good-soft);border-color:var(--good)}.step.partial{background:var(--warn-soft);border-color:var(--warn)}
.step.gap{background:var(--warn-soft);border-color:var(--warn)}.step.FAIL{background:var(--bad-soft);border-color:var(--bad)}
.step.skipped{border-style:dashed;border-color:var(--warn)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px 14px;font-size:var(--fs-sm)}
.kv div{display:flex;flex-direction:column;gap:1px}
.kv .k{color:var(--muted);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em}
.kv .v{color:var(--ink);font-family:var(--mono);font-size:13px}
/* setups list */
.setups{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.setup{display:block;padding:14px 16px;border-radius:14px;background:var(--glass-2);border:1px solid var(--line);transition:transform .25s var(--ease),border-color .25s,background .25s}
.setup:hover{transform:translateY(-1px);border-color:var(--line-2);background:var(--glass-3)}
.setup .rank{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-family:var(--mono);font-weight:700;font-size:14px;color:var(--accent);background:var(--accent-soft);border:1px solid transparent}
.setup.parked .rank{color:var(--muted);background:var(--glass-2);border-color:var(--line)}
.setup .hd{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;min-width:0}
.setup .badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.setup .badges:empty{display:none}
.setup .hd .asset{font-family:var(--mono);font-weight:700;font-size:17px}
.setup .hd .sc{margin-left:auto;color:var(--muted);font-size:var(--fs-sm);font-family:var(--mono);white-space:nowrap;text-align:right}
.setup .thesis{margin:6px 0 8px;color:var(--ink-2);font-size:13.5px;line-height:1.5}
.setup .trig{margin:0 0 8px;font-size:var(--fs-sm);line-height:1.5;color:var(--ink-2)}.setup .trig b{color:var(--muted);font-weight:600;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;margin-right:6px}
.setup .meta{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:var(--fs-sm)}
.setup .meta div{display:flex;gap:6px;align-items:baseline;min-width:0}
.setup .meta .k{color:var(--muted);flex:none;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em}
.setup .meta .v{color:var(--ink);min-width:0}
.setup .tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.setup details{margin-top:8px}
.setup summary{cursor:pointer;color:var(--muted);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;list-style:none;display:inline-flex;align-items:center;gap:6px}
.setup summary::-webkit-details-marker{display:none}
.setup summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .25s var(--ease)}
.setup details[open] summary::before{transform:rotate(45deg)}
.setup details p{margin:6px 0 0;color:var(--ink-2);font-size:var(--fs-sm);font-family:var(--mono);line-height:1.5}
.setups.parked-list .setup{opacity:.86}
.setup.top{border-color:var(--accent-line);box-shadow:0 0 0 1px var(--accent-soft),0 12px 34px var(--accent-glow)}
.setup.top .rank{background:var(--accent);color:var(--accent-ink)}
@media(max-width:640px){.setup{padding:12px}.setup .hd .sc{font-size:var(--fs-xs)}.setup .hd .asset{font-size:16px}.plan div{grid-template-columns:52px minmax(0,1fr)}}
/* banners */
.banner{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--glass-2);font-size:var(--fs-sm);line-height:1.45}
.banner.warn{border-color:var(--warn-soft);background:var(--warn-soft);color:var(--ink)}
.banner.bad{border-color:var(--bad-soft);background:var(--bad-soft)}
.banner.good{border-color:var(--good-soft);background:var(--good-soft)}
.banner .ic{flex:none;width:18px;height:18px;margin-top:1px}
.banner .ic svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.list{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.list .it{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-radius:12px;background:var(--glass-2);border:1px solid var(--line);font-size:var(--fs-sm);line-height:1.45}
.list .it .ic{flex:none;width:18px;text-align:center}
/* chart card */
.chart-card{min-width:0}
.chart-card .body{min-width:0;height:clamp(300px,40vw,440px);border-radius:var(--r-md);border:1px solid var(--line);background:var(--glass-2);overflow:hidden;position:relative;margin-top:var(--s3)}
.chart-card .body .lwc{position:absolute;inset:0}
.nochart{height:100%;display:grid;place-items:center;text-align:center;padding:var(--s6);color:var(--ink-2);font-size:var(--fs-md);line-height:1.5}
.nochart p{margin:0;max-width:52ch}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-family:var(--mono);font-size:var(--fs-xs);color:var(--ink-2);margin-top:8px}
.legend .sw{display:inline-block;width:14px;height:0;border-top:2px solid currentColor;vertical-align:middle;margin-right:5px}
.legend .sw.dash{border-top-style:dashed}
/* ================= reports deck ================= */
.deckhead{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);margin-bottom:var(--s3)}
.deckhead .nav{display:flex;align-items:center;gap:8px}
.dots{display:flex;gap:6px;align-items:center}
.dots button{width:8px;height:8px;border-radius:50%;background:var(--line-2);padding:0;transition:width .3s var(--ease),background .3s}
.dots button[aria-current=true]{background:var(--accent);width:24px;border-radius:4px}
.deck{display:flex;gap:var(--s4);overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:2px;margin:-2px}
.deck::-webkit-scrollbar{display:none}
.rcard{flex:0 0 100%;scroll-snap-align:start;display:grid;grid-template-columns:1.25fr 1fr;grid-template-areas:"hd hd" "sum side" "acts acts";gap:var(--s3) var(--s5)}
@media(max-width:900px){.rcard{grid-template-columns:1fr;grid-template-areas:"hd" "sum" "side" "acts"}}
.rcard .rhead{grid-area:hd;display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s3);padding-bottom:var(--s3);border-bottom:1px solid var(--line)}
.rcard .rhead h3{font-size:18px}
.rcard .summary{grid-area:sum;min-width:0;font-size:14.5px;line-height:1.6;color:var(--ink-2)}
.rcard .summary p{margin:0 0 8px}.rcard .summary p:last-child{margin-bottom:0}
.rcard .side{grid-area:side;min-width:0}
.rcard .racts{grid-area:acts;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:var(--s3);border-top:1px solid var(--line)}
.nums{display:flex;gap:14px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--muted)}
.nums b{color:var(--ink);font-family:var(--mono);font-weight:500}
table.calls{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
table.calls td{padding:7px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.calls tr:last-child td{border-bottom:0}
table.calls td.l{text-align:left}table.calls td.num{text-align:right;font-family:var(--mono);white-space:nowrap;color:var(--ink-2)}
/* ================= tables ================= */
.tbl{overflow-x:auto;border-radius:var(--r-md);border:1px solid var(--line);background:var(--glass-2)}
.tbl table{width:100%;border-collapse:separate;border-spacing:0;font-size:var(--fs-sm);white-space:nowrap}
.tbl th{position:sticky;top:0;z-index:1;text-align:right;font-weight:600;font-size:var(--fs-xs);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 40%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.tbl th.l,.tbl td.l{text-align:left}
.tbl th.sort{cursor:pointer;user-select:none}
.tbl th.sort:hover{color:var(--ink)}
.tbl th[aria-sort=ascending]::after{content:" ▲";font-size:9px}.tbl th[aria-sort=descending]::after{content:" ▼";font-size:9px}
.tbl td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;vertical-align:middle}
.tbl td.num{font-family:var(--mono)}
.tbl tbody tr{transition:background .18s}
.tbl tbody tr:hover{background:var(--glass-3)}
.tbl tbody tr:last-child td{border-bottom:0}
.tbl .name{color:var(--muted);margin-left:6px}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:var(--s3)}
.fchips{display:flex;gap:6px;flex-wrap:wrap}
.fchip{padding:5px 11px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--glass-2);font-size:var(--fs-xs);font-weight:600;color:var(--ink-2);transition:all .2s}
.fchip[aria-pressed=true]{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.health{display:inline-flex;align-items:center;gap:6px}
.health i{width:9px;height:9px;border-radius:50%;background:var(--muted);flex:none}
.health.g i{background:var(--good);box-shadow:0 0 8px var(--good-glow)}.health.y i{background:var(--warn)}.health.r i{background:var(--bad)}
/* sector bars */
.bars{display:grid;gap:7px}
.bar{display:grid;grid-template-columns:130px 1fr 64px;gap:10px;align-items:center;font-size:var(--fs-sm)}
.bar .track{position:relative;height:9px;border-radius:5px;background:var(--glass-2);border:1px solid var(--line);overflow:hidden}
.bar .zero{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line-2)}
.bar .fill{position:absolute;top:0;bottom:0;border-radius:5px;transition:width .8s var(--ease)}
/* scorecard */
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--s3)}
.strip .t{padding:14px 16px;border-radius:14px;background:var(--glass-2);border:1px solid var(--line)}
.strip .t .k{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px}
.strip .t .v{font-size:26px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.strip .t .s{color:var(--muted);font-size:var(--fs-xs);margin-top:4px}
.meter{height:6px;border-radius:3px;background:var(--glass-3);overflow:hidden;margin-top:10px}
.meter i{display:block;height:100%;border-radius:3px;background:var(--accent);width:0;transition:width .9s var(--ease)}
details.disc{border:1px solid var(--line);border-radius:14px;background:var(--glass-2);overflow:hidden}
details.disc summary{cursor:pointer;padding:12px 16px;font-weight:600;font-size:14px;list-style:none;display:flex;align-items:center;gap:8px}
details.disc summary::-webkit-details-marker{display:none}
details.disc summary::after{content:"";margin-left:auto;width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .3s var(--ease)}
details.disc[open] summary::after{transform:rotate(45deg)}
details.disc .body{padding:0 16px 16px}
/* ================= documents ================= */
.doc{font-size:15px;line-height:1.65;max-width:78ch;overflow-wrap:anywhere}
.doc code{word-break:break-word}
.doc a{word-break:break-all}
.doc>h1{font-size:var(--fs-2xl);margin:var(--s2) 0 var(--s4)}
.doc>h2,.doc>h3,.doc>h4{margin:var(--s6) 0 var(--s2);padding-bottom:6px;border-bottom:1px solid var(--line);text-transform:none;letter-spacing:-.01em;color:var(--ink)}
.doc>h2{font-size:var(--fs-xl)}.doc>h3{font-size:var(--fs-lg)}.doc>h4{font-size:var(--fs-md);border:0}
.doc p{margin:var(--s2) 0}
.doc ul,.doc ol{padding-left:22px;margin:var(--s2) 0}.doc li{margin:4px 0}
.doc blockquote{border-left:3px solid var(--accent-line);margin:var(--s3) 0;padding:6px 14px;color:var(--ink-2);background:var(--accent-soft);border-radius:0 var(--r-sm) var(--r-sm) 0}
.doc hr{border:0;border-top:1px solid var(--line);margin:var(--s5) 0}
.doc table{font-size:var(--fs-sm)}.doc .tbl{margin:var(--s3) 0;max-width:100%}.doc th,.doc td{text-align:left;white-space:normal}.doc td{vertical-align:top}
.doc pre{margin:var(--s3) 0;white-space:pre-wrap}
.doc.wide{max-width:none}
.crumbs{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:var(--s3) 0 var(--s4);font-size:var(--fs-sm)}
.crumbs b{font-size:var(--fs-lg)}
/* ================= sheet (popover) ================= */
.sheet-bg{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .3s;pointer-events:none}
.sheet-bg.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;z-index:50;left:50%;top:50%;width:min(980px,calc(100vw - 32px));max-height:min(88vh,980px);transform:translate(-50%,-48%) scale(.97);opacity:0;pointer-events:none;overflow:auto;padding:var(--s5) var(--s6);box-shadow:var(--shadow);transition:transform .38s var(--ease),opacity .28s;overscroll-behavior:contain}
.sheet.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
@media(max-width:640px){.sheet{left:0;top:auto;bottom:0;width:100%;max-height:92vh;border-radius:var(--r) var(--r) 0 0;padding:var(--s4) var(--s4) calc(var(--s6) + env(safe-area-inset-bottom));transform:translateY(24px);}.sheet.on{transform:none}}
.sheet .x{position:sticky;top:0;float:right;margin:-4px -6px 0 0;z-index:2}
.sheet .ph{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding-right:44px}
.sheet .ph .t{font-size:var(--fs-2xl);font-weight:700;font-family:var(--mono);letter-spacing:-.02em}
.sheet .facts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:var(--fs-sm);color:var(--ink-2);margin:var(--s3) 0}
.sheet .facts b{color:var(--ink);font-family:var(--mono);font-weight:500}
.sheet .chart{height:clamp(280px,42vw,440px);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--glass-2);margin:var(--s2) 0;position:relative}
.sheet .chart .lwc{position:absolute;inset:0}
.sheet .chart iframe,.chart-card .body iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.sheet .links{display:flex;gap:8px;flex-wrap:wrap;margin-top:var(--s3)}
.tfs{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:var(--s2)}
/* ================= login ================= */
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:var(--s4)}
.login{width:min(400px,100%);padding:var(--s6)}
.login.shake{animation:shake .5s both}
.login .brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.login input.field{width:100%;height:42px;font-size:15px;margin:12px 0 14px}
.login .err{color:var(--bad);font-size:var(--fs-sm);margin:-6px 0 10px}
/* ---- setups: why / plan / trend ---- */
.why{margin:8px 0 0;font-size:14px;line-height:1.5;color:var(--ink);overflow-wrap:anywhere}
.why>b:first-child{display:inline-block;min-width:min(36px,100%);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-right:8px;font-weight:700}
.why.but{color:var(--ink-2);font-size:var(--fs-sm);margin-top:4px}
.why.but>b:first-child{color:var(--warn)}
.whyline{font-size:var(--fs-sm);color:var(--ink-2);margin-top:3px;line-height:1.45}
.whyline.but{color:var(--muted)}
.setup{container-type:inline-size}
.plan{display:grid;grid-template-columns:minmax(0,1fr);gap:6px 18px;margin:10px 0 0;padding:10px 12px;border-radius:12px;background:var(--glass);border:1px solid var(--line);font-size:var(--fs-sm)}
@container (min-width:520px){.plan{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sheet .plan{grid-template-columns:minmax(0,1fr)}
.plan div{display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px;align-items:baseline;min-width:0}
.plan .k{color:var(--muted);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.plan .v{color:var(--ink);line-height:1.45}
.plan .v .sub{color:var(--muted)}
.trend{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;align-items:start;margin-top:10px}
.trend .tcs{display:flex;flex-wrap:wrap;gap:6px}
.trend .tl{display:inline-flex;align-items:center;height:22px;white-space:nowrap;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-right:2px}
.trend .tc{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:var(--r-pill);background:var(--glass);border:1px solid var(--line);font-size:var(--fs-xs);color:var(--ink-2);white-space:nowrap}
.trend .tc b{color:var(--ink);font-weight:600}
@media(max-width:380px){.trend{grid-template-columns:1fr;gap:6px}}
.td{width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block;flex:none}
.td.g{background:var(--good);box-shadow:0 0 6px var(--good-glow)}.td.r{background:var(--bad);box-shadow:0 0 6px var(--bad-glow)}.td.y{background:var(--warn)}.td.b{background:#5aa0ff}.td.n{background:var(--ink-2)}
.pill.pt{color:var(--violet);background:var(--violet-soft);border-color:transparent}
.setup .thesis{margin:10px 0 0}
.setup .thesis.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;min-width:0;max-width:100%;overflow-wrap:anywhere}
.setup .thesis.clamp:hover{color:var(--ink)}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.btn.tvb{color:var(--accent)}.btn.tvb svg{stroke:var(--accent)}
.newmark:empty{display:none}
.dropped{margin-top:10px;font-size:var(--fs-sm);color:var(--muted)}
/* ---- radar ---- */
.radar .cands{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0}
.radar .cand{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--glass-2);border:1px solid var(--line);transition:opacity .3s}
.radar .cand .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.radar .cand .w{font-size:var(--fs-sm);color:var(--ink-2);margin-top:2px;line-height:1.45}
.radar .cand .bt{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.radar .cand.q{opacity:.62}
@media(max-width:640px){.list .it{flex-wrap:wrap}.radar .cand{grid-template-columns:1fr}.radar .cand .bt{justify-content:flex-start}}
/* util */
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.spacer{flex:1}
.empty{padding:var(--s4);color:var(--muted);font-size:var(--fs-sm);text-align:center}
.foot{margin-top:var(--s6);color:var(--muted);font-size:var(--fs-xs);text-align:center}
`;

export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">';
export const CSS = TOKENS + BASE + COMPONENTS;
