#!/usr/bin/env python3
"""dashboard_push.py — bundle v2 for the dashboard, and the privacy boundary between state/ and the page.

Every payload is built by an ALLOWLIST serializer: each field is set explicitly, nothing from state/ is passed
through, and no field carries a pot-currency amount (results are in R or % of pot, liquidity is a multiple of the
config minimum, coin prices sit only in `px` sub-objects). The effective mode's latest equity E is held in memory
only, to compute ratios. paper.json is never read. See docs/DASHBOARD_SPEC.md, "Data contract".

KV keys written by one push (one bulk call): exec:latest, exec:ledger, exec:stamp, plus doc:<slug> and doc:index only
when a document's sha256 changed (one doc:index read per push). exec:<date> and dates are no longer written.

  python3 scripts/dashboard_push.py                    push to Cloudflare (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID;
                                                       the namespace is found by its title, so no id is stored anywhere)
  python3 scripts/dashboard_push.py --kv-json FILE     write every KV pair to FILE instead (the local preview's KV)
  python3 scripts/dashboard_push.py --build-only FILE  write {latest, ledger, stamp} to FILE, touch nothing remote
  --state DIR / --config DIR / --docs DIR / --now TS   read another state tree (demo, tests) or pin the clock
"""
import argparse, hashlib, json, math, os, re, time, urllib.error, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import _path  # noqa: F401
from executor import common as C

V = 2
NAMESPACE_TITLE = "aifi-executor"
DOCS = {"how_it_works": "HOW_IT_WORKS.md", "logic": "LOGIC.md", "risk": "RISK.md", "universe": "UNIVERSE.md", "execution": "EXECUTION.md",
        "security": "SECURITY.md", "ledger": "LEDGER.md", "operations": "OPERATIONS.md", "decisions": "DECISIONS.md"}
BAR, DAY = 4 * 3600, 86400        # BAR is reset per agent in main() from settings.trigger_tf
WEEK = 7 * DAY
SCHED_MIN = 5                      # cycle.yml cron "5 0,4,8,12,16,20 * * *"
LAG_FALLBACK_MIN = 20
GATES_DEFAULT = {"n": 30, "avg_R": 0.2, "dd_pct": 20, "cost_R": 0.12}   # until settings.review_gates exists
RUNS_CAP, EVENTS_CAP, TRADES_CAP, SIGNALS_CAP, PINNED_CAP, SPARK_N, SLOTS_N = 60, 200, 300, 200, 20, 42, 42
LATEST_BUDGET, DX_KEEP = 50 * 1024, 12   # exec:latest raw bytes (spec §15); the newest runs that always keep dx

# The order risk.pre_trade runs its checks in (tests/test_dashboard_bundle.py asserts it equals what pre_trade returns).
PRE_TRADE_ORDER = ["not halted", "throttle allows entries", "data fresh and run on time", "no reconciliation mismatch",
                   "sizing accepted", "no open position in this coin", "below max positions", "equity positive", "open-risk cap",
                   "gross exposure cap", "book open-risk cap", "price sanity band", "universe filters"]
CHECK_CODES = {"not halted": "halt", "throttle allows entries": "thr", "data fresh and run on time": "fresh",
               "no reconciliation mismatch": "recon", "sizing accepted": "sizing", "no open position in this coin": "dup",
               "below max positions": "maxpos", "equity positive": "equity", "open-risk cap": "cap", "gross exposure cap": "gross",
               "book open-risk cap": "bookcap", "price sanity band": "sanity", "universe filters": "universe"}
OUTCOME = {"pre-trade": "blocked", "policy": "recorded", "proposal": "expired", "execution": "notfilled", "approval": "blocked"}
RSN = {"stop": "stop", "4h flip": "h4", "daily flip": "d", "weekly flip": "w", "manual flatten": "flatten",
       "no stop possible": "nostop", "stop (exchange)": "exch"}
# the fixed why strings in signals.py (lines 13, 15, 18, 28, 30)
WHY = {"weekly Momentum Cloud not bullish": "w", "daily Momentum Cloud not bullish": "d", "4-hour reading not ready": "n",
       "no trigger on the last 4-hour bar": "atu", "close not above the 4-hour line": "g"}
RANGE = {"Overextended": "O", "In Range": "I", "Suppressed": "S"}
LEVEL = {"failed": 3, "halt": 3, "thr_halt": 3, "recon": 3, "no_stop": 3, "close_failed": 3, "exit_failed": 3, "fallback": 3,
         "bought": 2, "sold": 2, "trail": 2, "regime": 2, "gap": 2, "thr_half": 2,
         "recorded": 1, "proposed": 1, "expired": 1, "notfilled": 1, "resume": 1, "sweep": 1, "review": 1, "late": 1,
         "entry_failed": 1, "not_on_exchange": 1, "board": 0}
STANDING = ("halt", "fallback", "thr_half", "thr_halt")   # standing states: one event on the transition, not one per run

FORBIDDEN_KEY = re.compile(r"^(equity|cash|unrealized|start|peak|notional|sz|risk_amt|entry_fee|funding_paid|fees|funding|gross|pnl|margin|"
                           r"min_notional_usd|pot_usd_paper|stop_cloid|entry_cloid|last_bar_t|last_funding_ts|rules|context_at_entry|"
                           r"review_md|timezone|hours_local|_doc)$")
FORBIDDEN_STR = re.compile(r"\b(USDC|USD)\b|\$\s?\d|equity \d|\bsz\b")
ISO_RX = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?")


# ------------------------------------------------------------------------------------------------ numbers --
def num(x, nd=2):
    """Round to nd decimals; integral values become ints; NaN, inf and junk become None; never -0."""
    if x is None or isinstance(x, bool):
        return None
    try:
        v = round(float(x), nd)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    if v == 0:
        return 0
    return int(v) if v == int(v) and abs(v) < 1e15 else v


def sig5(p):
    """Coin prices: 5 significant figures (only ever inside a `px` object)."""
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    if math.isnan(p) or math.isinf(p):
        return None
    if p == 0:
        return 0
    v = float(f"{p:.5g}")
    return int(v) if v == int(v) and abs(v) < 1e15 else v


def fnum(x):
    """A number as it appears inside a detail string: '0.73', '68', '169'."""
    v = num(x)
    return "" if v is None else str(v)


def ts_of(iso):
    if iso is None or isinstance(iso, bool):
        return None
    if isinstance(iso, (int, float)):
        return int(iso)
    try:
        return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def iso_ms(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def dir_of(label):
    """Bullish → 1, Bearish → 0, anything else → None (the page's direction encoding)."""
    return 1 if label == "Bullish" else 0 if label == "Bearish" else None


def initial(label):
    return "B" if label == "Bullish" else "b" if label == "Bearish" else "n"


def median(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def pos_ts(p):
    return int(p.get("opened_ts") or ts_of(p.get("opened")) or 0)


# ---------------------------------------------------------------------------------------- reason codes (§7) --
UNI_RX = [("vol", re.compile(r"24h volume ([\d.]+)M below ([\d.]+)M"), "ratio"),
          ("oi", re.compile(r"open interest ([\d.]+)M below ([\d.]+)M"), "ratio"),
          ("fund", re.compile(r"funding (-?\d+)"), "one"),
          ("days", re.compile(r"(\d+) daily bars"), "one"),
          ("lev", re.compile(r"max leverage (\d+)"), "one")]


def universe_codes(detail):
    out = []
    for part in [p.strip() for p in str(detail or "").split(";") if p.strip()]:
        if "not listed" in part:
            out.append(["list", None])
            continue
        if part.startswith("max leverage unreadable"):
            out.append(["lev", None])
            continue
        for code, rx, how in UNI_RX:
            m = rx.search(part)
            if m:
                if how == "ratio":
                    b = float(m.group(2))
                    out.append([code, num(float(m.group(1)) / b) if b else None])
                else:
                    out.append([code, num(m.group(1))])
                break
        else:
            out.append(["uni", None])
    return out or [["uni", None]]


def _first_num(rx, text):
    m = re.search(rx, str(text or ""))
    return num(m.group(1)) if m else None


def check_codes(check, detail):
    """One failed pre-trade check → [[code, value]...]. Values are % / ratios / minutes / counts only."""
    code = CHECK_CODES.get(check)
    if code is None:
        return [["check", None]]
    if code == "universe":
        return universe_codes(detail)
    val = None
    if code == "thr":
        val = _first_num(r"drawdown ([\d.]+)%", detail)
    elif code == "fresh":
        val = _first_num(r"(\d+) min after the bar close", detail)
    elif code == "maxpos":
        val = _first_num(r"(\d+) open of", detail)
    elif code in ("cap", "bookcap"):
        val = _first_num(r"([\d.]+)% (?:of equity )?after entry", detail)
    elif code == "gross":
        val = _first_num(r"([\d.]+)x after entry", detail)
    elif code == "sanity":
        val = _first_num(r"mark vs Binance ([\d.]+)%", detail)
    # halt, recon, sizing, dup, equity: the detail is dropped (free text, or a money figure)
    return [[code, val]]


def refusal_codes(r):
    """The normalised failing codes of one refusal record, in check order."""
    st, d = r.get("stage"), r.get("detail")
    if st == "pre-trade":
        out = []
        if isinstance(d, list):
            for c in d:
                if isinstance(c, dict) and c.get("ok") is not True:
                    out += check_codes(c.get("check"), c.get("detail"))
        return out or [["check", None]]
    if st == "policy":
        return [["tier", None]]
    if st == "proposal":
        return [["expired", None]]
    if st == "execution":
        return [["fill", None]]
    if st == "approval":
        if isinstance(d, list):
            return [["recheck", None]]
        return [["drift", _first_num(r"price ran ([\d.]+)% above", d)]]
    return [["check", None]]


def codes_str(codes):
    """[[vol, .38], [fund, 68], [maxpos, None]] → 'vol 0.38,fund 68,maxpos'."""
    return ",".join(c if v is None else f"{c} {fnum(v)}" for c, v in codes)


_CHK_SPLIT = re.compile(r"(?:^|; )(" + "|".join(re.escape(k) for k in sorted(CHECK_CODES, key=len, reverse=True)) + r") \(")


def split_reasons(text):
    """'check (detail); check (detail)' → [{check, detail}] (a universe detail may itself contain '; ')."""
    ms = list(_CHK_SPLIT.finditer(text))
    out = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        det = text[m.end():end]
        out.append({"check": m.group(1), "detail": det[:-1] if det.endswith(")") else det})
    return out


# --------------------------------------------------------------------------------------- line parser (§6) --
class Ev(tuple):
    """(type, c, kind, tier, detail, R, rel_R), plus `aux`: parsed parts the run-level join needs."""
    def __new__(cls, typ, c=None, kind=None, tier=None, detail=None, R=None, rel=None, aux=None):
        o = super().__new__(cls, (typ, c, kind, tier, detail, R, rel))
        o.aux = aux or {}
        return o


SKIP = "skip"
_P = {k: re.compile(v) for k, v in {
    "btc": r"^BTC weekly (.+?) · daily (.+?) · data (.*)$",
    "counts": r"^evaluated \d+ names · \d+ triggers · ",
    "sold": r"^(\S+) \[(.*?)\]: closed on (.+?) at \S+ → ([+-]?[\d.]+) R(?: · ([+-]?[\d.]+) R vs \S+)?$",
    "close_failed": r"^(\S+): close NOT filled \(",
    "stop_cancel": r"^(\S+): (?:leftover|old) stop cancel failed \(",
    "sweep": r"^(\S+): gain earmarked for (\S+) \(([\d.]+)% of pot\)",
    "not_on_exchange": r"^(\S+): not on the exchange and no sell fill",
    "exit_failed": r"^(\S+): exit management failed \((\w+)",
    "gap": r"^(\S+): no reading on one timeframe",
    "nomark": r"^(\S+): (?:weekly|daily|4h) flip but no mark price",
    "trail": r"^(\S+): stop trailed to ([\d.e+-]+)$",
    "recon": r"^RECONCILIATION MISMATCH",
    "no_stop": r"^(\S+): could not place the resident stop",
    "notfilled": r"^(\S+): entry not filled",
    "bought": r"^(\S+): ENTERED \S+ long \[(.*?)\] · (\w+) tier (\w+) · stop (\S+) \(([\d.]+)% away\)",
    "entry_failed": r"^(\S+): entry check failed \((\w+)",
    "candles": r"^(\S+): candles unavailable",
    "not_listed": r"^(\S+) \[(.*?)\]: not listed on Hyperliquid perpetuals$",
    "reading": r"^(\S+) \[(.*?)\]: W .+ · D .+ · 4h ",
    "blocked": r"^(\S+): signal (\w+) tier (\w+) REFUSED: (.*)$",
    "recorded": r"^(\S+): signal (\w+) tier (\w+) recorded, not traded",
    "would_propose": r"^(\S+): would PROPOSE ",
    "proposed": r"^(\S+): PROPOSED (\S+) \((.*)\), expires (\S+)$",
    "fallback": r"running paper$",
    "halt": r"^HALT set: (.*) \(exits still managed, no entries\)$",
    "expired": r"^(\S+): proposal (\S+) expired unapproved$",
    "thr_halt": r"^THROTTLE HALT: drawdown ([\d.]+)%",
    "thr_half": r"^throttle: drawdown ([\d.]+)%, risk per trade halved$",
    "failed": r"^CYCLE ABORTED: (\w+)",
}.items()}


def fallback_note(text):
    """A 'running paper' line (or the E3 mode_note) → (fixed note, detail code)."""
    t = str(text or "")
    if "SDK" in t:
        return "exchange SDK not installed", "sdk"
    if "HL_AGENT_KEY" in t or "ACCOUNT_ADDRESS" in t:
        return "exchange key or account address missing", "key"
    return "live requirements missing", None


# Free text (the owner's HALT reason) keeps a number only when its unit says it is not money (§6.2: % / R / ratios /
# minutes, plus hours, days and weeks). Every other number, with any currency sign, sign or k/M suffix, becomes "…",
# so "equity was 1000.0" ships as "equity was …". FREE_NUM is the number pattern; free_text_ok() is the assert.
_UNIT = r"(?P<u>\s?(?:%|×|x\b|R\b|min(?:ute)?s?\b|h\b|hrs?\b|hours?\b|-hours?\b|d\b|days?\b|-days?\b|w\b|wks?\b|weeks?\b))"
FREE_NUM = re.compile(r"[-+−]?(?:[$€£]\s?)?\d+(?:[.,']\d+)*(?:\s?[kKmMbB]\b)?" + _UNIT + "?")
_CURRENCY = re.compile(r"\b(?:USDC|USDT|USD|CAD|EUR|dollars?|bucks)\b|[$€£]", re.I)


def _keep(m):
    """A number with a unit, written plainly (no currency sign, no thousands grouping), is not money."""
    return bool(m.group("u")) and not re.search(r"[$€£,']|\d[.]\d+[.]", m.group(0))


def scrub_text(s):
    """Free text (an owner's HALT reason) → no money, no currency, no sizes, printable only. A number stays only
    when a unit says what it is ("12%", "0.5 R", "0.73×", "45 min"); any other number is replaced by "…"."""
    s = re.sub("[^\\x20-\\x7e\\xa0-\\u024f\\u2010-\\u2027\\u2212]", "", str(s))
    s = FREE_NUM.sub(lambda m: m.group(0) if _keep(m) else "…", s)
    s = _CURRENCY.sub("", s)
    s = re.sub(r"\bsz\b", "", s)
    s = re.sub(r"…(?:[\s:.,/=-]*…)+", "…", s)        # "3:12", "1 000", "2026-09-25" → one "…"
    s = re.sub(r"\s*[=:]\s*…", " …", s)              # "pot=…" → "pot …"
    return " ".join(s.split())


def free_text_ok(s):
    """True when (scrubbed) free text holds no number that is not plainly a %, R, ratio or duration."""
    return all(_keep(m) for m in FREE_NUM.finditer(str(s)))


def halt_reason(text):
    """HALT text → (template reason, embedded ISO or None). cycle.py and control.py --flatten embed an ISO."""
    t = str(text or "").strip()
    m = ISO_RX.search(t)
    base = " ".join(ISO_RX.sub("", t).split())
    if not base or base == "manual halt":
        reason = "manual halt"
    elif base.startswith("manual flatten"):
        reason = "manual flatten"
    elif "open without a resident stop" in base or base == "unprotected position":
        first = base.split()[0]
        reason = (first + " open without a stop") if re.fullmatch(r"[A-Z0-9]{2,12}", first) else "open without a stop"
    else:                                             # the owner's own words: the one free text in the bundle
        reason = scrub_text(scrub_text(base)[:80]) or "manual halt"     # again after the cut: "12|%" must not keep "12"
        if not free_text_ok(reason):                  # cannot happen by construction; fail closed if it ever does
            raise AssertionError("HALT reason kept a number without a unit")
    return reason, (m.group(0) if m else None)


def parse_line(line, fresh=True):
    """One summary line (one cycle.py say()) → Ev, SKIP (recognised, no event) or None (unparsed).
    Types starting with '_' are recognised markers that feed stage codes but are not events."""
    s = str(line)
    m = _P["btc"].match(s)
    if m:
        if fresh:
            return SKIP
        mins = re.search(r"(\d+) min after the bar close", m.group(3))
        return Ev("late", detail=mins.group(1) if mins else None, aux={"min": int(mins.group(1)) if mins else None})
    for k in ("counts", "stop_cancel", "reading", "would_propose"):
        if _P[k].match(s):
            return SKIP
    m = _P["not_listed"].match(s)
    if m:
        return Ev("_x", m.group(1))
    m = _P["sold"].match(s)
    if m:
        return Ev("sold", m.group(1), detail=RSN.get(m.group(3), "other"), R=num(m.group(4)),
                  rel=num(m.group(5)) if m.group(5) else None, aux={"book": m.group(2)})
    for k in ("close_failed", "not_on_exchange", "gap", "no_stop", "notfilled"):
        m = _P[k].match(s)
        if m:
            return Ev(k, m.group(1))
    m = _P["sweep"].match(s)
    if m:
        return Ev("sweep", m.group(1), detail=f"{m.group(2)} {fnum(m.group(3))}")
    m = _P["exit_failed"].match(s)
    if m:
        return Ev("exit_failed", m.group(1), detail=m.group(2))
    m = _P["nomark"].match(s)
    if m:
        return Ev("exit_failed", m.group(1), detail="nomark")
    m = _P["trail"].match(s)
    if m:
        return Ev("trail", m.group(1), aux={"stop": float(m.group(2))})
    if _P["recon"].match(s):
        return Ev("recon")
    m = _P["bought"].match(s)
    if m:
        return Ev("bought", m.group(1), m.group(3), m.group(4), detail=f"stop {fnum(m.group(6))}",
                  aux={"book": m.group(2), "stop": float(m.group(5))})
    m = _P["entry_failed"].match(s)
    if m:
        return Ev("entry_failed", m.group(1), detail=m.group(2))
    m = _P["candles"].match(s)
    if m:
        return Ev("entry_failed", m.group(1), detail="candles")
    m = _P["blocked"].match(s)
    if m:
        codes = []
        for it in split_reasons(m.group(4)):
            codes += check_codes(it["check"], it["detail"])
        return Ev("blocked", m.group(1), m.group(2), m.group(3), detail=codes_str(codes) or None, aux={"codes": codes})
    m = _P["recorded"].match(s)
    if m:
        return Ev("recorded", m.group(1), m.group(2), m.group(3))
    m = _P["proposed"].match(s)
    if m:
        pid = m.group(2)
        tier = re.search(r"tier (\w+) always", m.group(3))
        return Ev("proposed", m.group(1), pid.rsplit("-", 1)[-1] if "-" in pid else None, tier.group(1) if tier else None, aux={"id": pid})
    if _P["fallback"].search(s):
        return Ev("fallback", detail=fallback_note(s)[1])
    m = _P["halt"].match(s)
    if m:
        return Ev("halt", detail=halt_reason(m.group(1))[0])
    m = _P["expired"].match(s)
    if m:
        pid = m.group(2)
        return Ev("expired", m.group(1), pid.rsplit("-", 1)[-1] if "-" in pid else None, aux={"id": pid})
    m = _P["thr_halt"].match(s)
    if m:
        return Ev("thr_halt", detail=fnum(m.group(1)))
    m = _P["thr_half"].match(s)
    if m:
        return Ev("thr_half", detail=fnum(m.group(1)))
    m = _P["failed"].match(s)
    if m:
        return Ev("failed", detail=m.group(1))
    return None


# ------------------------------------------------------------------------------------------------ sources --
def _read_runs(state):
    docs = []
    rdir = state / "runs"
    if rdir.exists():
        for f in sorted(rdir.glob("*.jsonl")):
            docs += [d for d in C.read_jsonl(f) if isinstance(d, dict) and d.get("t")]
    last = C.load_json(rdir / "last_run.json") if rdir.exists() else None
    seen = {d["t"] for d in docs}
    if isinstance(last, dict) and last.get("t") and last["t"] not in seen:
        docs.append(last)
    docs = [d for d in docs if not d.get("dry") and ts_of(d.get("t"))]
    docs.sort(key=lambda d: ts_of(d["t"]))
    if not isinstance(last, dict) or not last.get("t"):
        last = docs[-1] if docs else {}
    return docs, last


class Src:
    """Everything the push reads, from one state tree and one config dir."""
    def __init__(self, state, config):
        self.state, self.config = Path(state), Path(config)
        self.s = C.load_json(self.config / "settings.json") or {}
        self.books_raw = [x for x in (C.load_json(self.config / "books.json") or {}).get("books", []) if isinstance(x, dict) and x.get("book")]
        self.books = {}
        for x in self.books_raw:
            if x.get("enabled", True):
                self.books[x["book"]] = {"benchmark": x.get("benchmark"), "share": x.get("pot_share_pct"), "cap": x.get("open_risk_cap_pct"),
                                         "names": [n["coin"] if isinstance(n, dict) else n for n in x.get("names", [])]}
        self.order, self.book_of = [], {}
        for bn, b in self.books.items():
            for c in b["names"]:
                if c not in self.order:
                    self.order.append(c)
                self.book_of.setdefault(c, bn)
        self.book_idx = {x["book"]: i for i, x in enumerate(self.books_raw)}
        self.runs, self.last_run = _read_runs(self.state)
        led = self.state / "ledger"
        self.refused = [r for r in C.read_jsonl(led / "refused.jsonl") if isinstance(r, dict)]
        self.trades_all = [x for x in C.read_jsonl(led / "trades.jsonl") if isinstance(x, dict)]
        self.eq_all = [p for p in C.read_jsonl(led / "equity.jsonl") if isinstance(p, dict)]
        self.sweeps = [w for w in C.read_jsonl(led / "sweeps.jsonl") if isinstance(w, dict)]
        self.transfers = (led / "transfers.jsonl").exists()
        self.halt_file = self.state / "HALT"
        self.proposals = {}
        pdir = self.state / "proposals"
        if pdir.exists():
            for f in sorted(pdir.glob("*.json")):
                d = C.load_json(f)
                if isinstance(d, dict) and d.get("id"):
                    self.proposals[d["id"]] = d
        rdir = self.state / "review"
        self.reviews = sorted(rdir.glob("*.md")) if rdir.exists() else []

    def positions(self, mode):
        p = (C.load_json(self.state / f"positions_{mode}.json", {}) or {}).get("positions", {})
        return p if isinstance(p, dict) else {}


# ------------------------------------------------------------------------------------------ run analysis --
class Run:
    """One run doc, analysed: parsed summary lines and the sets the stage codes need. Holds no money."""
    def __init__(self, doc):
        self.doc = doc
        self.t = ts_of(doc.get("t"))
        self.slot = self.t // BAR * BAR
        self.lm = int(doc["late_min"]) if isinstance(doc.get("late_min"), (int, float)) else round((self.t - self.slot) / 60)
        self.mode = doc.get("mode") or "paper"
        self.fresh, self.failed, self.halt = bool(doc.get("fresh")), bool(doc.get("failed")), bool(doc.get("halt"))
        self.pos_after = [p.get("coin") if isinstance(p, dict) else p for p in (doc.get("positions") or [])]
        self.counts = doc.get("counts") if isinstance(doc.get("counts"), dict) else None
        self.btc = initial(doc.get("btc_weekly")) + initial(doc.get("btc_daily"))
        rds = doc.get("readings")
        self.readings = {r["coin"]: r for r in rds if isinstance(r, dict) and r.get("coin")} if isinstance(rds, list) else {}
        self.parsed, self.unparsed, self.events = [], [], []
        self.entered, self.closed, self.trailed, self.proposed = {}, {}, {}, {}
        self.gaps, self.exit_err, self.notlisted, self.errors, self.flags = set(), set(), set(), set(), set()
        self.late_detail = None
        self.refs = defaultdict(list)
        for line in doc.get("summary") or []:
            ev = parse_line(line, self.fresh)
            if ev is SKIP:
                continue
            if ev is None:
                self.unparsed.append(line)
                continue
            typ, c = ev[0], ev[1]
            if typ == "_x":
                self.notlisted.add(c)
                continue
            self.parsed.append(ev)
            if typ == "bought":
                self.entered[c] = ev
            elif typ == "sold":
                self.closed[c] = ev
            elif typ == "trail":
                self.trailed[c] = ev
            elif typ == "gap":
                self.gaps.add(c)
            elif typ == "exit_failed":
                self.exit_err.add(c)
            elif typ == "entry_failed":
                self.errors.add(c)
            elif typ == "proposed":
                self.proposed[c] = ev
            elif typ == "late":
                self.late_detail = ev.aux.get("min")
            if typ in STANDING or typ == "recon":
                self.flags.add(typ)
        self.held = (set(self.pos_after) - set(self.entered)) | set(self.closed)
        if isinstance(doc.get("events"), list):          # E3: the engine's typed events replace the stopgap parse
            self.unparsed = []

    @property
    def n_open(self):
        return len(self.pos_after)


def elig_of(reading, uni):
    """Every failing universe code with its value. E2's `reading.elig` wins when present."""
    e = reading.get("elig")
    if isinstance(e, list):
        return [[x[0], num(x[1]) if len(x) > 1 else None] if isinstance(x, (list, tuple)) and x else [str(x), None] for x in e]
    if isinstance(e, dict):
        return [[k, num(v)] for k, v in e.items()]
    out = []
    vol, floor = reading.get("vol_m"), uni["vol_m"]
    if vol is None:
        out.append(["vol", None])
    elif floor and vol < floor:
        out.append(["vol", num(vol / floor)])
    fa = reading.get("funding_pct")
    if fa is not None and fa > uni["fund_pct"]:
        out.append(["fund", num(fa, 1)])
    days = reading.get("days")
    if days is not None and days < uni["days"]:
        out.append(["days", int(days)])
    return out


def stage_code(R, coin, uni):
    """§3.4: one stage code for one name in one run (the stopgap derivation; E1/E2 `reading.st` wins)."""
    rd = R.readings.get(coin)
    if coin in R.entered:
        return "E"
    if rd and rd.get("st"):
        return str(rd["st"])[:1]
    if coin in R.held:
        return "h"
    if coin in R.notlisted:
        return "x"
    if coin in R.errors:
        return "!"
    if rd is None:
        return "-"
    if rd.get("trigger"):
        stages = {r.get("stage") for r in R.refs.get(coin, [])}
        if "pre-trade" in stages:
            return "r"
        if "policy" in stages:
            return "p"
        if coin in R.proposed:
            return "P"
        if "execution" in stages:
            return "e"
        return "m"
    w = WHY.get(rd.get("why"))
    if w == "atu":
        if dir_of(rd.get("h4")) == 1:
            return "u"
        return "a" if not elig_of(rd, uni) else "t"
    return w or "-"


def dist_of(rd):
    """(line/close − 1)·100: + means 'needs', − means 'cushion'."""
    try:
        return (float(rd["line"]) / float(rd["close"]) - 1) * 100
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None


# ------------------------------------------------------------------------------------------------ builder --
class Bundle:
    def __init__(self, src, now):
        self.X, self.now_f = src, float(now)
        self.now = int(self.now_f)
        s = src.s
        self.req = s.get("mode", "paper")
        self.last = src.last_run or {}
        self.eff = self.last.get("mode") or self.req
        thr = s.get("throttle") or {}
        u = s.get("universe") or {}
        self.uni = {"vol_m": num((u.get("min_day_volume_usd") or 0) / 1e6), "oi_m": num((u.get("min_open_interest_usd") or 0) / 1e6),
                    "days": u.get("min_daily_bars", 0), "fund_pct": num(u.get("max_funding_annual_pct", 0)), "lev": u.get("min_max_leverage")}
        self.thr_cfg = [num(thr.get("halve_at_drawdown_pct", 10)), num(thr.get("halt_at_drawdown_pct", 20))]
        self.late_limit = (s.get("data") or {}).get("late_run_minutes", 45)
        self.fee = (s.get("fee_taker_pct") or 0) / 100
        g = s.get("review_gates") if isinstance(s.get("review_gates"), dict) else {}
        self.gates = {k: num(g.get(k, v), 3) for k, v in GATES_DEFAULT.items()}
        # E, the effective mode's latest equity, lives only here
        self.EQ = []
        for p in src.eq_all:
            if p.get("mode") == self.eff and isinstance(p.get("equity"), (int, float)):
                self.EQ.append((int(p.get("ts") or ts_of(p.get("t")) or 0), float(p["equity"])))
        self.EQ.sort()
        self.E = self.EQ[-1][1] if self.EQ and self.EQ[-1][1] > 0 else None
        # the pot figures no outgoing string may write (scrub_assert, scrub_md): first, latest and peak equity
        self.money = money_set([e for _t, e in self.EQ[:1] + self.EQ[-1:]] + [max((e for _t, e in self.EQ), default=None)]
                               + [s.get("pot_usd_paper")])
        live = sorted(int(p.get("ts") or ts_of(p.get("t")) or 0) for p in src.eq_all if p.get("mode") == "live")
        self.first_live = live[0] if live else None
        self.runs = [Run(d) for d in src.runs]
        self.run_at = {R.t: R for R in self.runs}
        for rf in src.refused:                        # the exact-t join: record_refusal and the run doc share C.iso(now)
            R = self.run_at.get(ts_of(rf.get("t")))
            if R:
                R.refs[rf.get("coin")].append(rf)
        self.eff_runs = [R for R in self.runs if R.mode == self.eff]
        self.last_eff = self.eff_runs[-1] if self.eff_runs else None
        self.positions = src.positions(self.eff)
        self.trades = sorted([x for x in src.trades_all if x.get("mode") == self.eff], key=lambda x: ts_of(x.get("closed")) or 0)
        self.stop0_by_open = {(c, R.t): ev.aux.get("stop") for R in self.runs for c, ev in R.entered.items()}
        self.unparsed_lines = []

    # -- helpers ------------------------------------------------------------------------------------------
    def ref_mode(self, rf):
        """A refusal's mode: its own (E5), else the run it joins, else paper until the first live equity point."""
        if rf.get("mode"):
            return rf["mode"]
        t = ts_of(rf.get("t"))
        if t in self.run_at:
            return self.run_at[t].mode
        return "live" if (self.first_live is not None and t is not None and t >= self.first_live) else "paper"

    def refs_eff(self):
        return [r for r in self.X.refused if self.ref_mode(r) == self.eff]

    def ratio(self, x, nd=2):
        """x as % of E."""
        if x is None or self.E is None:
            return None
        return num(x / self.E * 100, nd)

    # -- sections -----------------------------------------------------------------------------------------
    def cfg(self):
        s = self.X.s
        ap = s.get("approval") or {}
        return {"ver": s.get("version"), "risk_pct": num(s.get("risk_per_trade_pct")), "open_cap_pct": num(s.get("open_risk_cap_pct")),
                "gross_cap_x": num(s.get("gross_exposure_cap_x")), "lev_cap_x": num(s.get("leverage_cap_x")), "max_pos": s.get("max_positions"),
                "thr": list(self.thr_cfg), "late_min": self.late_limit, "sched_min": SCHED_MIN, "min_stop_pct": num(s.get("min_stop_distance_pct")),
                "fee_pct": num(s.get("fee_taker_pct"), 4), "approval": ap.get("mode", "online_hours"), "auto": list(ap.get("auto_tiers", ["A"])),
                "uni": dict(self.uni), "gates": dict(self.gates), "checks": list(PRE_TRADE_ORDER)}

    def mode_block(self):
        note = ""
        if self.req != self.eff:
            src = self.last.get("mode_note") or next((l for l in (self.last.get("summary") or []) if _P["fallback"].search(str(l))), None)
            note = fallback_note(src)[0] if src else "no live check yet"
        return {"eff": self.eff, "req": self.req, "note": note}

    def origin(self):
        R = self.eff_runs[0] if self.eff_runs else None
        return {"t": R.t, "mode": R.mode} if R else {"t": None, "mode": self.eff}

    def clock(self):
        L = self.last_eff
        lo = (self.now // BAR - SLOTS_N) * BAR
        lags = [R.lm for R in self.eff_runs if R.fresh and not R.failed and R.slot > lo]
        n = len(lags)
        return {"last_t": L.t if L else None, "last_slot": L.slot if L else None, "late_min": L.lm if L else None,
                "lag_med_min": num(median(lags) if n >= 3 else LAG_FALLBACK_MIN, 1), "lag_rng": [min(lags), max(lags)] if n else None,
                "lag_n": n, "limit_min": self.late_limit, "sched_min": SCHED_MIN}

    def halt(self):
        """From the HALT file, never from last_run. since: HALT.since, else the ISO in the HALT text, else null (never mtime)."""
        f = self.X.halt_file
        if not f.exists():
            return {"set": False, "reason": None, "since": None}
        try:
            text = f.read_text()
        except OSError:
            text = ""
        reason, iso = halt_reason(text)
        since = None
        side = f.with_name("HALT.since")
        if side.exists():
            try:
                m = ISO_RX.search(side.read_text())
                since = ts_of(m.group(0)) if m else None
            except OSError:
                since = None
        if since is None and iso:
            since = ts_of(iso)
        return {"set": True, "reason": reason, "since": since}

    def state(self, halt):
        L = self.last_eff
        doc = L.doc if L else {}
        th = doc.get("throttle") if isinstance(doc.get("throttle"), dict) else None
        if th is None:
            thr = {"state": "unknown", "mult": None, "dd_pct": None}
        else:
            mult = th.get("multiplier")
            st = "halted" if th.get("halt") else "halved" if (isinstance(mult, (int, float)) and mult < 1) else "normal"
            thr = {"state": st, "mult": num(mult), "dd_pct": num(th.get("drawdown_pct"))}
        abort = None
        for l in doc.get("summary") or []:
            m = _P["failed"].match(str(l))
            if m:
                abort = m.group(1)
        last = ({"t": L.t, "fresh": L.fresh, "failed": L.failed, "late_min": L.lm, "abort": abort} if L else
                {"t": None, "fresh": None, "failed": None, "late_min": None, "abort": None})
        return {"halt": halt, "thr": thr, "btc": {"w": dir_of(doc.get("btc_weekly")), "d": dir_of(doc.get("btc_daily"))}, "last": last}

    def alerts(self, halt, mode, state, proposals):
        """§6.1. Fixed templates; '{time}' is a literal placeholder the client fills from `t` in the phone's zone."""
        out = []
        L = self.last_eff
        t = L.t if L else None
        if state["last"]["failed"]:
            ty = state["last"]["abort"]
            out.append({"lv": "bad", "k": "failed", "t": t, "c": None,
                        "text": (f"The {{time}} check stopped early ({ty}). Exits may not have been checked." if ty else
                                 "The {time} check stopped early. Exits may not have been checked.")})
        if halt["set"]:
            head = "Halted since {time}" if halt["since"] else "Halted (since unknown)"
            out.append({"lv": "bad", "k": "halt", "t": halt["since"], "c": None, "text": f"{head}: {halt['reason']}. No new buys; exits still run."})
        thr = state.get("thr") or {}
        if thr.get("state") == "halted":
            out.append({"lv": "bad", "k": "thr_halt", "t": t, "c": None,
                        "text": f"Drawdown {fnum(num(thr.get('dd_pct'), 1))}% reached {fnum(self.thr_cfg[1])}%: buying stopped until reviewed."})
        for ev in (L.parsed if L else []):
            typ, c = ev[0], ev[1]
            if typ == "recon":
                out.append({"lv": "bad", "k": "recon", "t": t, "c": None, "text": "Exchange and ledger disagree; entries paused."})
            elif typ == "no_stop":
                out.append({"lv": "bad", "k": "no_stop", "t": t, "c": c,
                            "text": f"{c}: the resident stop could not be placed, so the position is closed rather than held unprotected."})
            elif typ == "close_failed":
                out.append({"lv": "bad", "k": "close_failed", "t": t, "c": c,
                            "text": f"{c}: the close was not filled; the position and its stop are kept for the next check."})
            elif typ == "exit_failed":
                out.append({"lv": "bad", "k": "exit_failed", "t": t, "c": c,
                            "text": (f"{c}: an exit signal came but there was no mark price; the position is kept for the next check."
                                     if ev[4] == "nomark" else f"{c}: the exit check failed ({ev[4]}); the position is kept.")})
        if thr.get("state") == "halved":
            out.append({"lv": "warn", "k": "thr_half", "t": t, "c": None, "text": f"Drawdown {fnum(num(thr.get('dd_pct'), 1))}%: risk per trade halved."})
        if mode["req"] != mode["eff"]:
            out.append({"lv": "warn", "k": "fallback", "t": t, "c": None, "text": f"Live requested, running paper: {mode['note']}."})
        if L and not L.fresh and not L.failed:
            n = L.late_detail if L.late_detail is not None else L.lm
            out.append({"lv": "warn", "k": "late", "t": t, "c": None, "text": f"The last check started {n} min after the close; buys skipped."})
        for ev in (L.parsed if L else []):
            typ, c = ev[0], ev[1]
            if typ == "gap":
                out.append({"lv": "warn", "k": "gap", "t": t, "c": c,
                            "text": f"{c}: no reading on one timeframe; the position and its stop are kept as they are."})
            elif typ == "entry_failed":
                out.append({"lv": "warn", "k": "entry_failed", "t": t, "c": c,
                            "text": (f"{c}: candles were unavailable; skipped this check." if ev[4] == "candles"
                                     else f"{c}: the entry check failed ({ev[4]}); skipped this check.")})
        if proposals:
            n = len(proposals)
            out.append({"lv": "info", "k": "proposals", "t": None, "c": None, "text": f"{n} legacy proposal{'' if n == 1 else 's'} open."})
        return out

    def pot(self):
        EQ = self.EQ
        net = True if self.eff == "paper" else bool(self.X.transfers)
        if not EQ or not EQ[0][1]:
            return {"since": None, "n_pts": len(EQ), "chg_pct": None, "wk_chg_pct": None, "net": net, "spark": []}
        base = EQ[0][1]
        wk = [e for t, e in EQ if t <= self.now - WEEK]
        ref = wk[-1] if wk else base
        return {"since": EQ[0][0], "n_pts": len(EQ), "chg_pct": num((EQ[-1][1] / base - 1) * 100),
                "wk_chg_pct": num((EQ[-1][1] / ref - 1) * 100) if ref else None, "net": net,
                "spark": [[t, num((e / base - 1) * 100)] for t, e in EQ[-SPARK_N:]]}

    def pos(self):
        out = []
        L = self.last_eff
        as_of = L.t if L else self.now
        e1 = {r["coin"]: r for r in L.readings.values() if r.get("st") == "h"} if L else {}
        for coin, p in self.positions.items():
            try:
                entry, stop, notional, risk_amt = float(p["entry"]), float(p["stop"]), float(p["notional"]), float(p["risk_amt"])
            except (KeyError, TypeError, ValueError):
                continue
            t_in = pos_ts(p)
            stop0 = float(p["initial_stop"]) if isinstance(p.get("initial_stop"), (int, float)) else stop
            mark = float(p["mark"]) if isinstance(p.get("mark"), (int, float)) and p["mark"] > 0 else None
            fee_in, fund = float(p.get("entry_fee") or 0), float(p.get("funding_paid") or 0)

            def net(px):          # net if closed at px now: price move − entry fee − estimated exit fee − funding
                return (px - entry) / entry * notional - fee_in - notional * (px / entry) * self.fee - fund
            risk = entry - stop0

            def rm(px):
                return int(round((float(px) - entry) / risk * 1000)) if risk > 0 else None
            hist = p.get("stops")
            if isinstance(hist, list) and hist:          # E4
                stops = []
                for h in hist:
                    ht, hp = (h[0], h[1]) if isinstance(h, (list, tuple)) else (h.get("t"), h.get("stop"))
                    stops.append([ts_of(ht), rm(hp)])
            else:
                stops = [[t_in, rm(stop0)]] + ([[as_of, rm(stop)]] if abs(stop - stop0) > 1e-12 else [])
            h = e1.get(coin, {})
            to_stop = num((mark - stop) / mark * 100) if mark else None
            out.append({"id": f"{coin}-{t_in}", "c": coin, "b": p.get("book") or self.X.book_of.get(coin), "kind": p.get("kind"), "tier": p.get("tier"),
                        "t_in": t_in, "bars": (as_of - t_in) // BAR if t_in else None, "as_of": as_of,
                        "r_now": num(net(mark) / risk_amt) if (mark and risk_amt) else None,
                        "r_lock": num(net(stop) / risk_amt) if risk_amt else None,
                        "pnl_pct": self.ratio(net(mark)) if mark else None,
                        "risk_pct": num(p["risk_pct"]) if isinstance(p.get("risk_pct"), (int, float)) else self.ratio(risk_amt),
                        "size_pct": self.ratio(notional, 1), "lev": p.get("leverage"), "to_stop_pct": to_stop,
                        "cost_R": num((fee_in + notional * (mark / entry) * self.fee + fund) / risk_amt) if (mark and risk_amt) else None,
                        "stops": stops,
                        "exits": {"h4_pct": to_stop, "d_pct": num((mark - h["dline"]) / mark * 100) if (mark and h.get("dline")) else None,
                                  "w_pct": num((mark - h["wline"]) / mark * 100) if (mark and h.get("wline")) else None},
                        "px": {"entry": sig5(entry), "stop0": sig5(stop0), "stop": sig5(stop), "mark": sig5(mark)}})
        out.sort(key=lambda x: (x["to_stop_pct"] is None, x["to_stop_pct"] or 0))
        return out

    def risk(self):
        s, P = self.X.s, self.positions
        ra = sum(float(p.get("risk_amt") or 0) for p in P.values())
        gross = sum(float(p.get("notional") or 0) for p in P.values())
        hit = 0.0
        for p in P.values():
            try:
                e, st, no = float(p["entry"]), float(p["stop"]), float(p["notional"])
            except (KeyError, TypeError, ValueError):
                continue
            hit += (st - e) / e * no - float(p.get("entry_fee") or 0) - no * (st / e) * self.fee - float(p.get("funding_paid") or 0)
        by = {}
        for bn, b in self.X.books.items():
            mine = [p for p in P.values() if p.get("book") == bn]
            by[bn] = {"used_pct": self.ratio(sum(float(p.get("risk_amt") or 0) for p in mine)), "cap_pct": num(b["cap"]),
                      "share_pct": num(b["share"]), "n": len(mine)}
        return {"n_open": len(P), "max": s.get("max_positions"), "used_pct": self.ratio(ra), "cap_pct": num(s.get("open_risk_cap_pct")),
                "gross_x": num(gross / self.E) if self.E else None, "gross_cap_x": num(s.get("gross_exposure_cap_x")),
                "stops_hit_pct": self.ratio(hit), "by_book": by}

    def rec(self, pos_rows):
        Rs = [float(x["R"]) for x in self.trades if isinstance(x.get("R"), (int, float))]
        rel = [float(x["rel_R"]) for x in self.trades if isinstance(x.get("rel_R"), (int, float))]
        open_R = sum(p["r_now"] for p in pos_rows if p["r_now"] is not None)
        return {"n": len(Rs), "tot_R": num(sum(Rs) + open_R), "avg_R": num(sum(Rs) / len(Rs)) if Rs else None,
                "rel_R_avg": num(sum(rel) / len(rel)) if rel else None, "n_rel": len(rel), "closed_R": num(sum(Rs)), "open_R": num(open_R)}

    def names(self):
        L = self.last_eff
        if not L:
            return []
        out = []
        for coin in self.X.order:
            st = stage_code(L, coin, self.uni)
            if st == "-":
                continue
            rd = L.readings.get(coin) or {}
            if st == "h" and rd.get("st") != "h":
                rd = {}
            w, d, h4 = dir_of(rd.get("weekly")), dir_of(rd.get("daily")), dir_of(rd.get("h4"))
            el = elig_of(rd, self.uni) if rd else None
            if st == "h":
                grp = "held"
            elif st == "!":
                grp = "error"
            elif st in ("x", "n") or w is None or d is None or h4 is None:
                grp = "nodata"
            elif w != 1 or d != 1:
                grp = "notset"
            elif h4 == 1:
                grp = "run"
            elif el == []:
                grp = "next"
            else:
                grp = "thin"
            m = re.match(r"(\w+) tier (\w+)", str(rd.get("trigger") or ""))
            vol, oi = rd.get("vol_m"), rd.get("oi_m")
            out.append({"c": coin, "b": self.X.book_of.get(coin), "st": st, "grp": grp, "w": w, "d": d, "h4": h4,
                        "rg": RANGE.get(rd.get("range")), "dist": num(dist_of(rd)) if rd else None,
                        "vx": num(vol / self.uni["vol_m"]) if (isinstance(vol, (int, float)) and self.uni["vol_m"]) else None,
                        "ox": num(oi / self.uni["oi_m"]) if (isinstance(oi, (int, float)) and self.uni["oi_m"]) else None,
                        "fund": num(rd.get("funding_pct"), 1), "days": int(rd["days"]) if isinstance(rd.get("days"), (int, float)) else None,
                        "elig": el, "sig": f"{m.group(1)} {m.group(2)}" if m else None,
                        "px": {"close": sig5(rd.get("close")), "line": sig5(rd.get("line"))} if rd else None})
        return out

    def books(self, names):
        by = {n["c"]: n for n in names}
        out = []
        for x in self.X.books_raw:
            nm = [n if isinstance(n, dict) else {"coin": n} for n in x.get("names", [])]
            known = [by[n["coin"]] for n in nm if n["coin"] in by and by[n["coin"]]["elig"] is not None]
            why = defaultdict(int)
            for n in known:
                for code, _v in n["elig"]:
                    why[code] += 1
            out.append({"b": x["book"], "bench": x.get("benchmark"), "share_pct": num(x.get("pot_share_pct")), "cap_pct": num(x.get("open_risk_cap_pct")),
                        "on": bool(x.get("enabled", True)), "sweep": bool(x.get("sweep_gains_to_benchmark", False)),
                        "names": [[n["coin"], 1 if n.get("note") == "backtested" else 0 if n.get("note") else None] for n in nm],
                        "tradeable": sum(1 for n in known if n["elig"] == []) if known else None, "of": len(nm), "why": dict(why)})
        return out

    # -- runs and events ----------------------------------------------------------------------------------
    def stop0_for(self, coin, entry_ts, rec=None):
        if rec and isinstance(rec.get("initial_stop"), (int, float)):
            return rec["initial_stop"]
        return self.stop0_by_open.get((coin, entry_ts))

    def trail_R(self, coin, R, stop):
        """A trailed stop in R of the position's first risk: (stop − entry)/(entry − stop0)."""
        entry = stop0 = None
        p = self.positions.get(coin)
        if p and pos_ts(p) <= R.t:
            entry, stop0 = p.get("entry"), self.stop0_for(coin, pos_ts(p), p)
        if entry is None:
            tr = [x for x in self.X.trades_all if x.get("coin") == coin and (ts_of(x.get("opened")) or 0) <= R.t <= (ts_of(x.get("closed")) or 0) + BAR]
            if tr:
                entry, stop0 = tr[-1].get("entry"), self.stop0_for(coin, ts_of(tr[-1].get("opened")), tr[-1])
        try:
            return num((stop - float(entry)) / (float(entry) - float(stop0)))
        except (TypeError, ValueError, ZeroDivisionError):
            return None

    def run_events(self):
        """Every run → event rows: the stopgap parse with its joins, standing-state dedupes, and the diffs
        (resume, regime, board) against the previous run. Also marks which ledger opens/closes a line covered."""
        trades = self.X.trades_all
        closes = [ts_of(x.get("closed")) or 0 for x in trades]
        self.matched_tr, self.matched_open = set(), set()
        prev, prev_rd, prev_btc = None, None, None
        for R in self.runs:
            rows = []
            if isinstance(R.doc.get("events"), list):            # E3: copy the engine's rows
                for e in R.doc["events"]:
                    if isinstance(e, dict):
                        rows.append([R.t, e.get("type"), e.get("c"), e.get("kind"), e.get("tier"),
                                     int(e.get("lv", LEVEL.get(e.get("type"), 1))), e.get("detail"), num(e.get("R")), num(e.get("rel_R"))])
                for c in R.entered:
                    self.matched_open.add((c, R.t))
            else:
                for ev in R.parsed:
                    typ, c, kind, tier, detail, Rv, rel = ev
                    if typ in STANDING and prev is not None and (typ in prev.flags or (typ == "halt" and prev.halt)):
                        continue
                    if typ == "sold":
                        cands = [i for i, x in enumerate(trades) if i not in self.matched_tr and x.get("coin") == c and closes[i] <= R.t + 60]
                        if cands:
                            i = max(cands, key=lambda j: closes[j])
                            self.matched_tr.add(i)
                            x = trades[i]
                            kind, tier = x.get("kind"), x.get("tier")
                            Rv = num(x["R"]) if isinstance(x.get("R"), (int, float)) else Rv
                            rel = num(x["rel_R"]) if isinstance(x.get("rel_R"), (int, float)) else None
                    elif typ == "bought":
                        self.matched_open.add((c, R.t))
                    elif typ == "trail":
                        Rv = self.trail_R(c, R, ev.aux["stop"])
                    elif typ in ("notfilled", "expired"):
                        want = "execution" if typ == "notfilled" else "proposal"
                        rf = next((x for x in R.refs.get(c, []) if x.get("stage") == want), None)
                        if rf:
                            kind, tier = kind or rf.get("kind"), rf.get("tier")
                    if typ in ("proposed", "expired") and (kind is None or tier is None):
                        cd = (self.X.proposals.get(ev.aux.get("id")) or {}).get("candidate") or {}
                        kind, tier = kind or cd.get("kind"), tier or cd.get("tier")
                    lv = LEVEL.get(typ, 1)
                    if typ == "blocked":
                        lv = 2 if tier == "A" else 1
                    elif typ == "late":
                        lv = 2 if R.n_open else 1
                    rows.append([R.t, typ, c, kind, tier, lv, detail, Rv, rel])
            if prev is not None and prev.halt and not R.halt:
                rows.append([R.t, "resume", None, None, None, 1, None, None, None])
            if "n" not in R.btc:
                if prev_btc is not None and prev_btc != R.btc:
                    rows.append([R.t, "regime", None, None, None, 2, f"{prev_btc}>{R.btc}", None, None])
                prev_btc = R.btc
            if R.readings:
                if prev_rd is not None:
                    busy = {r[2] for r in rows if r[2]}
                    for coin in self.X.order:
                        a, b = prev_rd.readings.get(coin), R.readings.get(coin)
                        if not a or not b or coin in busy:
                            continue
                        items = []
                        for k, lab in (("weekly", "w"), ("daily", "d"), ("h4", "h4")):
                            da, db = dir_of(a.get(k)), dir_of(b.get(k))
                            if da != db:
                                items.append(f"{lab} {'n' if da is None else da}>{'n' if db is None else db}")
                        ca, cb = stage_code(prev_rd, coin, self.uni), stage_code(R, coin, self.uni)
                        if (ca == "a") != (cb == "a"):
                            items.append("a in" if cb == "a" else "a out")
                        if items:
                            rows.append([R.t, "board", coin, None, None, 0, ",".join(items), None, None])
                prev_rd = R
            R.events = rows
            prev = R

    def runs_and_events(self):
        self.run_events()
        lo = self.now - WEEK
        win = [R for R in self.runs if R.t >= lo]
        events = [e for R in win for e in R.events]
        # ledger cross-check: closes and opens that no run line recorded (control.py --flatten, approvals)
        for i, x in enumerate(self.X.trades_all):
            ct = ts_of(x.get("closed")) or 0
            if i not in self.matched_tr and ct >= lo:
                events.append([ct, "sold", x.get("coin"), x.get("kind"), x.get("tier"), 2, RSN.get(x.get("reason"), "other"),
                               num(x.get("R")), num(x.get("rel_R"))])
        opens = [(x.get("coin"), ts_of(x.get("opened")), x) for x in self.X.trades_all] + [(c, pos_ts(p), p) for c, p in self.positions.items()]
        for c, ot, x in opens:
            if ot and ot >= lo and (c, ot) not in self.matched_open:
                self.matched_open.add((c, ot))
                events.append([ot, "bought", c, x.get("kind"), x.get("tier"), 2, None, None, None])
        for f in self.X.reviews:
            try:      # review.yml runs Sundays 12:00 UTC; the file name carries only the date
                rt = int(datetime.strptime(f.stem[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) + 12 * 3600
            except ValueError:
                continue
            if rt >= lo:
                events.append([rt, "review", None, None, None, 1, None, None, None])
        halt = self.halt()
        if halt["set"] and halt["since"] and halt["since"] >= lo and not any(R.halt for R in self.runs if R.t >= halt["since"]):
            events.append([halt["since"], "halt", None, None, None, 3, halt["reason"], None, None])
        seq = {id(e): i for i, e in enumerate(events)}
        events.sort(key=lambda e: (-e[0], seq[id(e)]))
        if len(events) > EVENTS_CAP:          # over the cap, board rows (level 0) go first
            loud = [e for e in events if e[5] >= 1][:EVENTS_CAP]
            keep = {id(e) for e in loud + [e for e in events if e[5] < 1][:EVENTS_CAP - len(loud)]}
            events = [e for e in events if id(e) in keep]
        runs = []
        for R in win[-RUNS_CAP:]:
            has = bool(R.readings)
            tg, rx, hx = {}, {}, {}
            if has:
                for c in self.X.order:
                    m = re.match(r"(\w)\w* tier (\w+)", str((R.readings.get(c) or {}).get("trigger") or ""))
                    if m:
                        tg[c] = m.group(1) + m.group(2)
            for c, rfs in R.refs.items():
                for rf in rfs:
                    if rf.get("stage") in ("pre-trade", "policy", "execution") and rf.get("kind") and c not in tg:
                        tg[c] = str(rf["kind"])[:1] + str(rf.get("tier") or "")
                    if rf.get("stage") in ("pre-trade", "execution"):
                        rx[c] = refusal_codes(rf)
            for c, ev in list(R.proposed.items()) + list(R.entered.items()):
                if c not in tg and ev[2]:
                    tg[c] = str(ev[2])[:1] + str(ev[3] or "")
            for c in sorted(R.held):
                if c in R.closed:
                    rv = next((e[7] for e in R.events if e[1] == "sold" and e[2] == c), R.closed[c][5])
                    hx[c] = "c" + (f"{rv:+.2f}" if rv is not None else "")
                elif c in R.exit_err:
                    hx[c] = "!"
                elif c in R.gaps:
                    hx[c] = "g"
                elif c in R.trailed:
                    rv = next((e[7] for e in R.events if e[1] == "trail" and e[2] == c), None)
                    hx[c] = "t" + (f"{rv:+.2f}" if rv is not None else "")
                else:
                    hx[c] = {"kept": "k", "trailed": "t", "closed": "c", "gap": "g"}.get((R.readings.get(c) or {}).get("action"), "?")
            dx = None
            if has:
                dx = []
                for c in self.X.order:
                    d = dist_of(R.readings[c]) if c in R.readings else None
                    dx.append(int(round(d * 10)) if d is not None else None)
            cn = R.counts
            runs.append({"t": R.t, "s": R.slot, "lm": R.lm, "ok": 1 if R.fresh else 0, "x": 1 if R.failed else 0, "h": 1 if R.halt else 0,
                         "m": "l" if R.mode == "live" else "p", "btc": R.btc,
                         "c": [int(cn.get(k, 0) or 0) for k in ("evaluated", "triggers", "refused", "proposed", "entered")] if cn else None,
                         "n_open": R.n_open, "lv": max([e[5] for e in R.events], default=0),
                         "rd": "".join(stage_code(R, c, self.uni) for c in self.X.order) if has else None,
                         "dx": dx, "tg": tg, "rx": rx, "hx": hx})
        return runs, events

    def funnel_one(self, since):
        runs = [R for R in self.eff_runs if R.t >= since]
        refs = [r for r in self.refs_eff() if (ts_of(r.get("t")) or 0) >= since]
        opened = [x for x in self.trades if (ts_of(x.get("opened")) or 0) >= since] + \
                 [p for p in self.positions.values() if pos_ts(p) >= since]
        f = {"checks": 0, "signals": 0, "passed": 0, "auto": 0, "auto_passed": 0, "bought": 0, "blocked": 0, "blocked_auto": 0,
             "recorded": 0, "expired": 0, "proposed": 0, "notfilled": 0, "by_check": {}}
        for R in runs:
            cn = R.counts or {}
            f["checks"] += int(cn.get("evaluated", 0) or 0)
            f["signals"] += int(cn.get("triggers", 0) or 0)
            f["bought"] += int(cn.get("entered", 0) or 0)
            f["proposed"] += len(R.proposed)
        by = defaultdict(int)
        for r in refs:
            st, tier = r.get("stage"), r.get("tier")
            if st == "pre-trade":
                f["blocked"] += 1
                f["blocked_auto"] += 1 if tier == "A" else 0
                by[refusal_codes(r)[0][0]] += 1
            elif st == "policy":
                f["recorded"] += 1
            elif st == "proposal":
                f["expired"] += 1
            elif st == "execution":
                f["notfilled"] += 1
            if tier == "A":
                f["auto"] += 1
        f["auto"] += sum(1 for x in opened if x.get("tier") == "A")
        f["passed"] = f["signals"] - f["blocked"]
        f["auto_passed"] = f["auto"] - f["blocked_auto"]
        f["by_check"] = dict(by)
        return f

    def last24(self):
        """Slots in the last 24 h whose close + limit has passed (or that already have a run)."""
        lim = self.late_limit * 60
        top = self.now // BAR * BAR
        by_slot = defaultdict(list)
        for R in self.eff_runs:
            by_slot[R.slot].append(R)
        first = self.eff_runs[0].slot if self.eff_runs else self.now + 1          # slots before the first check are not "missed"
        slots = [S for S in (top - k * BAR for k in range(DAY // BAR))
                 if first <= S and S > self.now - DAY and (S + lim <= self.now or by_slot.get(S))]
        out = {"slots": len(slots), "on_time": 0, "late": 0, "missed": 0, "failed": 0, "signals": 0, "bought": 0, "sold": 0}
        for S in slots:
            rs = by_slot.get(S, [])
            ok = [R for R in rs if not R.failed]
            if not rs:
                out["missed"] += 1
            elif any(R.fresh for R in ok):
                out["on_time"] += 1
            elif ok:
                out["late"] += 1
            else:
                out["failed"] += 1
            for R in rs:
                cn = R.counts or {}
                out["signals"] += int(cn.get("triggers", 0) or 0)
                out["bought"] += int(cn.get("entered", 0) or 0)
                out["sold"] += sum(1 for e in R.events if e[1] == "sold")
        return out

    def pinned(self):
        rows = []
        for r in self.refs_eff():
            if r.get("stage") == "pre-trade" and r.get("tier") == "A":
                code, val = refusal_codes(r)[0]
                rows.append([ts_of(r.get("t")), r.get("coin"), r.get("kind"), code, val])
        rows.sort(key=lambda x: -(x[0] or 0))
        return rows[:PINNED_CAP]

    def proposals(self):
        out = []
        for pid, d in sorted(self.X.proposals.items()):
            if d.get("status") == "open":
                cd = d.get("candidate") or {}
                out.append({"id": pid, "c": cd.get("coin"), "kind": cd.get("kind"), "tier": cd.get("tier"),
                            "expires": d.get("expires_ts") or ts_of(d.get("expires"))})
        return out

    def latest(self):
        halt, mode = self.halt(), self.mode_block()
        state = self.state(halt)
        proposals = self.proposals()
        pos_rows = self.pos()
        names = self.names()
        runs, events = self.runs_and_events()
        self.unparsed_lines = [l for R in self.runs if R.t >= self.now - WEEK for l in R.unparsed]
        return {"v": V, "gen": iso_ms(self.now_f), "mode": mode, "origin": self.origin(), "cfg": self.cfg(), "order": list(self.X.order),
                "books": self.books(names), "clock": self.clock(), "state": state, "alerts": self.alerts(halt, mode, state, proposals),
                "pot": self.pot(), "rec": self.rec(pos_rows), "risk": self.risk(), "pos": pos_rows, "names": names,
                "runs": runs, "events": events, "funnel": {"all": self.funnel_one(0), "week": self.funnel_one(self.now - WEEK)},
                "pinned": self.pinned(), "last24": self.last24(), "proposals": proposals, "diag": {"unparsed": len(self.unparsed_lines)}}

    @staticmethod
    def fit(L, budget=LATEST_BUDGET):
        """Keep exec:latest within its raw byte budget at the caps (60 runs × 40 names, 200 events). Over it, the
        per-name distances (dx) of the oldest runs go first (their stage codes stay), then board events (level 0)
        from the oldest. Every run, stage code and level ≥ 1 event stays. diag.trim says what was dropped."""
        if len(dumps(L)) <= budget:
            return L
        trim = L["diag"]["trim"] = {"dx": 0, "board": 0}
        runs, ev = L.get("runs") or [], L.get("events") or []
        for r in runs[:max(0, len(runs) - DX_KEEP)]:
            if len(dumps(L)) <= budget:
                break
            if r.get("dx") is not None:
                r["dx"] = None
                trim["dx"] += 1
        while len(dumps(L)) > budget:
            i = next((k for k in range(len(ev) - 1, -1, -1) if ev[k][5] < 1), None)
            if i is None:
                break
            del ev[i]
            trim["board"] += 1
        return L

    # -- ledger ----------------------------------------------------------------------------------------------
    @staticmethod
    def cost_R(x):
        try:
            return (float(x.get("fees") or 0) + float(x.get("funding") or 0)) / float(x["risk_amt"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            return None

    def stats(self, tr):
        """S, computed in R (replaces ledger.stats' pnl-based fields)."""
        Rs = [float(x["R"]) for x in tr if isinstance(x.get("R"), (int, float))]
        n = len(Rs)
        if not n:
            return {"n": 0, "win": None, "avg_R": None, "tot_R": 0, "pf": None, "rel_R": None, "n_rel": 0, "hrs": None, "streak": 0, "cost_R": None}
        up, down = sum(r for r in Rs if r > 0), sum(r for r in Rs if r <= 0)
        streak = worst = 0
        for r in Rs:
            streak = streak + 1 if r <= 0 else 0
            worst = max(worst, streak)
        rel = [float(x["rel_R"]) for x in tr if isinstance(x.get("rel_R"), (int, float))]
        hrs = [float(x["hours"]) for x in tr if isinstance(x.get("hours"), (int, float))]
        costs = [c for c in (self.cost_R(x) for x in tr) if c is not None]
        return {"n": n, "win": num(sum(1 for r in Rs if r > 0) / n), "avg_R": num(sum(Rs) / n), "tot_R": num(sum(Rs)),
                "pf": num(up / abs(down)) if down < 0 else None, "rel_R": num(sum(rel) / len(rel)) if rel else None, "n_rel": len(rel),
                "hrs": num(sum(hrs) / len(hrs), 1) if hrs else None, "streak": worst, "cost_R": num(sum(costs) / len(costs)) if costs else None}

    def e_close(self, ts):
        best = None
        for t, e in self.EQ:
            if t > ts:
                break
            best = e
        return best

    def ledger(self):
        tr = self.trades
        rows, rser = [], []
        for x in tr:
            t_in, t_out = ts_of(x.get("opened")), ts_of(x.get("closed"))
            ec, pnl = self.e_close(t_out or 0), x.get("pnl")
            rows.append([x.get("id") or f"{x.get('coin')}-{t_in}", x.get("coin"), x.get("book"), x.get("kind"), x.get("tier"), t_in, t_out,
                         num(x.get("hours"), 1), num(x.get("R")), num(x.get("rel_R")), num(self.cost_R(x)),
                         num(pnl / ec * 100) if (isinstance(pnl, (int, float)) and ec) else None, RSN.get(x.get("reason"), "other"),
                         sig5(x.get("entry")), sig5(x.get("exit")), sig5(x.get("initial_stop")), num(x.get("mfe_R")), num(x.get("mae_R"))])
            rser.append([t_out, num(x.get("R")), num(x.get("rel_R")), self.X.book_idx.get(x.get("book"))])

        def bucket(key):
            b = defaultdict(list)
            for x in tr:
                b[RSN.get(x.get("reason"), "other") if key == "reason" else (x.get(key) or "?")].append(x)
            return {k: self.stats(v) for k, v in b.items()}
        eq_pct, eq_dd, worst = [], [], 0.0
        if self.EQ and self.EQ[0][1]:
            base, peak = self.EQ[0][1], 0.0
            for i, (t, e) in enumerate(self.EQ):
                peak = max(peak, e)
                dd = (peak - e) / peak * 100 if peak > 0 else 0.0
                worst = max(worst, dd)
                last_of_day = i + 1 == len(self.EQ) or self.EQ[i + 1][0] // DAY != t // DAY
                if t >= self.now - 30 * DAY or last_of_day:     # every point for 30 days, then the last of each UTC day
                    eq_pct.append([t, num((e / base - 1) * 100)])
                    eq_dd.append([t, num(dd)])
        sig = []
        for r in self.refs_eff():
            code, val = refusal_codes(r)[0]
            sig.append([ts_of(r.get("t")), r.get("coin"), r.get("book") or self.X.book_of.get(r.get("coin")), r.get("kind"), r.get("tier"),
                        OUTCOME.get(r.get("stage"), "blocked"), code, val])
        for x in tr:
            sig.append([ts_of(x.get("opened")), x.get("coin"), x.get("book"), x.get("kind"), x.get("tier"), "bought", None, None])
        for c, p in self.positions.items():
            sig.append([pos_ts(p), c, p.get("book"), p.get("kind"), p.get("tier"), "bought", None, None])
        sig.sort(key=lambda x: -(x[0] or 0))
        keys = ["blocked", "recorded", "expired", "notfilled", "bought"]
        daily = defaultdict(lambda: [0] * len(keys))
        for x in sig:
            if x[0]:
                daily[datetime.fromtimestamp(x[0], tz=timezone.utc).strftime("%Y-%m-%d")][keys.index(x[5])] += 1
        st, G = self.stats(tr), self.gates
        early = st["n"] < G["n"]

        def gstate(ok):
            return "not_yet" if early else ("passing" if ok else "failing")
        gates = [{"k": "n", "val": st["n"], "target": G["n"], "state": "not_yet" if early else "passing"},
                 {"k": "avg_R", "val": st["avg_R"], "target": G["avg_R"], "state": gstate(st["avg_R"] is not None and st["avg_R"] > G["avg_R"])},
                 {"k": "dd", "val": num(worst), "target": G["dd_pct"], "state": "failing" if worst >= G["dd_pct"] else gstate(True)},
                 {"k": "cost_R", "val": st["cost_R"], "target": G["cost_R"], "state": gstate(st["cost_R"] is not None and st["cost_R"] <= G["cost_R"])}]
        vb = []
        for x in self.X.books_raw:
            mine = [t for t in tr if t.get("book") == x["book"]]
            rel = [t for t in mine if isinstance(t.get("rel_R"), (int, float)) and isinstance(t.get("R"), (int, float))]
            vb.append({"b": x["book"], "n": len(mine), "cum_R": num(sum(float(t.get("R") or 0) for t in mine)),
                       "hold_R": num(sum(float(t["R"]) - float(t["rel_R"]) for t in rel)) if rel else None})
        review = {"date": None, "md": ""}
        if self.X.reviews:
            f = self.X.reviews[-1]
            try:
                review = {"date": f.stem, "md": scrub_md(f.read_text(), self.money)}
            except OSError:
                pass
        return {"v": V, "gen": iso_ms(self.now_f),
                "trades": {"total": len(tr), "cols": ["id", "c", "b", "kind", "tier", "t_in", "t_out", "hours", "R", "rel_R", "cost_R", "pnl_pct",
                                                       "rsn", "entry", "exit", "stop0", "mfe_R", "mae_R"], "rows": rows[-TRADES_CAP:]},
                "rseries": rser,
                "stats": {"all": st, "book": bucket("book"), "tier": bucket("tier"), "kind": bucket("kind"), "reason": bucket("reason")},
                "eq": {"pct": eq_pct, "dd": eq_dd},
                "signals": {"total": len(sig), "rows": sig[:SIGNALS_CAP],
                            "daily": {"keys": keys, "rows": [[d] + v for d, v in sorted(daily.items())]}},
                "verdict": {"gates": gates, "books": vb},
                "sweeps": [[ts_of(w.get("t")), w.get("book"), w.get("benchmark"), num(w.get("pct_of_pot")), 1 if w.get("executed") else 0]
                           for w in self.X.sweeps],
                "review": review}


# A pot figure written as text: a standalone number (not part of an ISO time, an id or a word), optionally with a
# currency sign and thousands commas. Its value is compared with the pot figures the push holds in memory.
_NUM_TOKEN = re.compile(r"(?<![\w.:/'-])[-+−]?[$€£]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\w:/'-]|[.,]\d)")


def money_set(values):
    """Pot figures (the effective mode's first, latest and peak equity, the paper pot setting) → rounded values ≥ 1."""
    out = set()
    for v in values:
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) >= 1:
            out.add(round(abs(float(v)), 2))
    return out


def text_money(s, money):
    """The first pot figure written inside the string s, or None."""
    if not money:
        return None
    for m in _NUM_TOKEN.finditer(str(s)):
        try:
            v = round(float(m.group(1).replace(",", "") + (m.group(2) or "")), 2)
        except ValueError:
            continue
        if v in money:
            return m.group(0)
    return None


def scrub_md(text, money=()):
    """The Sunday review is the one free-text payload: any line matching the forbidden pattern, or writing one of
    the pot figures, is dropped."""
    return "\n".join(l for l in str(text).splitlines() if not FORBIDDEN_STR.search(l) and text_money(l, money) is None) + "\n"


# ------------------------------------------------------------------------------------------ privacy assert --
def scrub_assert(obj, where="bundle", money=()):
    """Walk every key and string of a payload; raise on a forbidden key, a forbidden string, a string that writes
    one of the pot figures in `money` (free text that slipped past the scrubber) or a non-finite number."""
    stack = [(obj, where)]
    while stack:
        o, path = stack.pop()
        if isinstance(o, dict):
            for k, v in o.items():
                if FORBIDDEN_KEY.match(str(k)) or FORBIDDEN_STR.search(str(k)):
                    raise AssertionError(f"forbidden key {k!r} at {path}")
                stack.append((v, f"{path}.{k}"))
        elif isinstance(o, (list, tuple)):
            stack.extend((v, f"{path}[{i}]") for i, v in enumerate(o))
        elif isinstance(o, str):
            if FORBIDDEN_STR.search(o):
                raise AssertionError(f"forbidden string at {path}: {o[:60]!r}")
            if text_money(o, money) is not None:
                raise AssertionError(f"a pot figure written as text at {path}")
        elif isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            raise AssertionError(f"non-finite number at {path}")


def build(state=None, config=None, now=None):
    """→ {"latest", "ledger", "stamp", "unparsed"}; the three payloads are privacy-asserted before anything is written."""
    B = Bundle(Src(state or C.STATE, config or C.CONFIG), time.time() if now is None else now)
    latest = B.fit(B.latest())
    ledger = B.ledger()
    stamp = {"v": V, "gen": latest["gen"], "t": latest["clock"]["last_t"]}
    for name, p in (("exec:latest", latest), ("exec:ledger", ledger), ("exec:stamp", stamp)):
        scrub_assert(p, name, B.money)
    return {"latest": latest, "ledger": ledger, "stamp": stamp, "unparsed": B.unparsed_lines}


def dumps(o):
    return json.dumps(o, separators=(",", ":"))


def doc_texts(docs_dir):
    return {slug: (Path(docs_dir) / fn).read_text() for slug, fn in DOCS.items() if (Path(docs_dir) / fn).exists()}


def key(name, agent=None):
    """KV key for this agent's payload: core keeps exec:<name>; any other agent uses exec:<agent>:<name>."""
    agent = agent or C.AGENT
    return f"exec:{name}" if agent == "core" else f"exec:{agent}:{name}"


def agent_summary(b):
    """One agent's row in exec:agents — the switcher and the Compare view read only this. Ratios and R only."""
    L = b["latest"]
    roster = {a["id"]: a for a in C.agents()}
    me = roster.get(C.AGENT, {"id": C.AGENT})
    g = lambda d, *k: (lambda v: v)(__import__("functools").reduce(lambda x, y: (x or {}).get(y) if isinstance(x, dict) else None, k, d))
    return {"id": C.AGENT, "name": me.get("name", C.AGENT), "desc": me.get("desc", ""), "tf": C.trigger_tf(C.settings()),
            "mode": g(L, "mode", "eff"), "gen": L.get("gen"), "last_t": g(L, "clock", "last_t"),
            "rec": {k: g(L, "rec", k) for k in ("n", "tot_R", "avg_R", "rel_R_avg", "open_R")},
            "pot_chg_pct": g(L, "pot", "chg_pct"), "n_open": g(L, "risk", "n_open"), "used_pct": g(L, "risk", "used_pct"),
            "halt": bool(g(L, "state", "halt", "set")), "thr": g(L, "state", "thr", "state"), "failed": bool(g(L, "state", "last", "failed")),
            "signals": g(L, "funnel", "all") if isinstance(g(L, "funnel", "all"), (list, dict)) else None,
            "alerts": len(L.get("alerts") or [])}


def agents_index(prev_raw, b):
    try:
        prev = json.loads(prev_raw) if prev_raw else {}
    except ValueError:
        prev = {}
    rows = {r["id"]: r for r in prev.get("agents", []) if isinstance(r, dict) and r.get("id")}
    rows[C.AGENT] = agent_summary(b)
    order = [a["id"] for a in C.agents() if a.get("enabled", True)]
    out = [rows[i] for i in order if i in rows] + [r for i, r in rows.items() if i not in order and i == C.AGENT]
    return {"v": 1, "gen": b["latest"].get("gen"), "agents": out}


def kv_pairs(b, docs, remote_index):
    """The pairs one push writes, in order: this agent's latest, ledger, stamp; then each doc:<slug> whose sha256
    differs from doc:index; then doc:index only when something changed. remote_index None → every doc is written."""
    pairs = {key("latest"): dumps(b["latest"]), key("ledger"): dumps(b["ledger"]), key("stamp"): dumps(b["stamp"])}
    index = {slug: hashlib.sha256(t.encode()).hexdigest() for slug, t in docs.items()}
    old = remote_index if isinstance(remote_index, dict) else {}
    changed = [slug for slug in docs if old.get(slug) != index[slug]]
    for slug in changed:
        pairs[f"doc:{slug}"] = docs[slug]
    if changed or set(old) != set(index):
        pairs["doc:index"] = dumps(index)
    return pairs, index


# --------------------------------------------------------------------------------------------- cloudflare --
def api(path, payload=None, method=None):
    tok, acct = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not tok or not acct:
        raise RuntimeError("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing")
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("PUT" if data else "GET"),
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if attempt == 2 or e.code < 500:
                raise RuntimeError(f"cloudflare {e.code}: {body}")
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError as e:
            if attempt == 2:
                raise RuntimeError(f"cloudflare: {e}")
            time.sleep(2 * (attempt + 1))


def kv_get(ns, key):
    """Raw value of one KV key, or None when it is missing or unreadable (the only read a push makes)."""
    acct, tok = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/storage/kv/namespaces/{ns}/values/{urllib.parse.quote(key, safe='')}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"}), timeout=30) as r:
            return r.read().decode()
    except Exception:  # noqa: BLE001 — a missing index only means every doc is rewritten once
        return None


def namespace_id():
    res = api("/storage/kv/namespaces?per_page=100")
    for ns in res.get("result", []):
        if ns.get("title") == NAMESPACE_TITLE:
            return ns["id"]
    raise RuntimeError(f"KV namespace '{NAMESPACE_TITLE}' not found; run the deploy-dashboard workflow first")


def write_kv_json(path, b, docs):
    """The local preview's KV: every key a fresh namespace would hold. Returns the pairs a real push would write,
    judged against the doc:index already in the file."""
    prev = C.load_json(path) or {}
    try:
        prev_index = json.loads(prev["doc:index"]) if isinstance(prev.get("doc:index"), str) else None
    except ValueError:
        prev_index = None
    pairs, index = kv_pairs(b, docs, prev_index)
    full = {k: v for k, v in prev.items() if k.startswith("exec:")}          # keep the other agents' payloads
    full.update({key("latest"): pairs[key("latest")], key("ledger"): pairs[key("ledger")], key("stamp"): pairs[key("stamp")], "doc:index": dumps(index)})
    full["exec:agents"] = dumps(agents_index(prev.get("exec:agents"), b))
    full.update({f"doc:{slug}": t for slug, t in docs.items()})
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(full, indent=1, ensure_ascii=False) + "\n")
    return pairs


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build bundle v2 and push it to the dashboard's KV.")
    ap.add_argument("--kv-json", metavar="FILE", help="write every KV pair to FILE instead of Cloudflare (no network)")
    ap.add_argument("--build-only", metavar="FILE", help="write {latest, ledger, stamp} to FILE (no network)")
    ap.add_argument("--state", help="state dir (default: $EXECUTOR_STATE or state/)")
    ap.add_argument("--config", help="config dir (default: config/)")
    ap.add_argument("--docs", help="docs dir (default: docs/)")
    ap.add_argument("--now", type=float, help="pin the clock (unix seconds)")
    a = ap.parse_args(argv)
    global BAR
    BAR = C.TF_SECONDS.get((C.load_json(Path(a.config or C.CONFIG) / "settings.json") or {}).get("trigger_tf", "4h"), 4 * 3600)
    b = build(a.state, a.config, a.now)
    for line in b["unparsed"]:               # the Action log is the only place the raw lines appear
        print(f"unparsed summary line: {line}")
    docs = doc_texts(a.docs or C.DOCS)
    if a.build_only:
        Path(a.build_only).write_text(json.dumps({k: b[k] for k in ("latest", "ledger", "stamp")}, indent=1))
        print(f"bundle → {a.build_only} (latest {len(dumps(b['latest']))} B, ledger {len(dumps(b['ledger']))} B)")
        return
    if a.kv_json:
        pairs = write_kv_json(a.kv_json, b, docs)
        print(f"kv → {a.kv_json}: a push would write {len(pairs)} keys ({', '.join(pairs)}); "
              f"latest {len(pairs[key('latest')])} B, ledger {len(pairs[key('ledger')])} B, unparsed {len(b['unparsed'])}")
        return
    ns = namespace_id()
    raw = kv_get(ns, "doc:index")
    try:
        remote_index = json.loads(raw) if raw else None
    except ValueError:
        remote_index = None
    pairs, _ = kv_pairs(b, docs, remote_index)
    pairs["exec:agents"] = dumps(agents_index(kv_get(ns, "exec:agents"), b))
    res = api(f"/storage/kv/namespaces/{ns}/bulk", [{"key": k, "value": v} for k, v in pairs.items()])
    if not res.get("success"):
        raise RuntimeError(f"bulk write failed: {res.get('errors')}")
    print(f"pushed {len(pairs)} keys to KV ({', '.join(pairs)}); latest {len(pairs[key('latest')])} B, ledger {len(pairs[key('ledger')])} B")


if __name__ == "__main__":
    main()
