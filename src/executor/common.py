"""common.py — paths, JSON helpers, HTTP, time zones and alerts. Standard library only.

Every module imports from here so there is one place for I/O behaviour. Paths
resolve from $EXECUTOR_HOME, else the repository root two levels above this file,
so the same code runs from a checkout, a worktree or a GitHub runner.
"""
import json, os, re, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(os.environ.get("EXECUTOR_HOME") or Path(__file__).resolve().parents[2])
# One engine, several agents. EXECUTOR_AGENT picks whose config, state, ledger and kill switch this process uses.
# "core" keeps the original locations (config/, state/); any other agent lives in agents/<id>/ and state/agents/<id>/.
AGENT = (os.environ.get("EXECUTOR_AGENT") or "core").strip()
if not re.fullmatch(r"[a-z][a-z0-9-]{1,23}", AGENT):
    raise RuntimeError(f"invalid EXECUTOR_AGENT {AGENT!r}")
CONFIG = ROOT / "config" if AGENT == "core" else ROOT / "agents" / AGENT
STATE = Path(os.environ.get("EXECUTOR_STATE") or (ROOT / "state" if AGENT == "core" else ROOT / "state" / "agents" / AGENT))
DOCS = ROOT / "docs"
# The fleet: one kill switch and one size dial over every agent (docs/specs/FACTORY.md, Phase 6). agents/fleet.json is
# the owner's and the lab's settings; state/FLEET_HALT is the switch (set by the control workflow or by the fleet
# drawdown guard in run_agents.py). Exits are never blocked by it, exactly like an agent's own HALT.
FLEET_CFG = ROOT / "agents" / "fleet.json"
FLEET_HALT = Path(os.environ.get("EXECUTOR_FLEET_HALT") or (ROOT / "state" / "FLEET_HALT"))
BAR_SECONDS = 4 * 3600


def log(msg):
    print(msg, flush=True)


def now_utc():
    return datetime.now(timezone.utc)


def now_ts():
    return int(time.time())


def iso(ts=None):
    dt = datetime.fromtimestamp(ts, tz=timezone.utc) if ts is not None else now_utc()
    return dt.isoformat().replace("+00:00", "Z")


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    """Atomic write: a half-written state file is worse than none."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=False) + "\n")
    os.replace(tmp, path)


def append_jsonl(path, obj):
    """Append one record as one line. If the file's last write was torn (no final newline), the record starts on a
    fresh line so it is never glued onto the damaged one and lost with it."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
    with path.open("a+b") as f:                # appends always land at the end; the read only looks at the last byte
        end = f.seek(0, os.SEEK_END)
        if end:
            f.seek(end - 1)
            if f.read(1) != b"\n":
                data = b"\n" + data
        f.write(data)


def read_jsonl(path):
    """Every decodable record of a JSON-lines file. A damaged line (a write torn by a crash, a merge marker) is skipped
    and counted, never raised: one bad line in equity.jsonl used to abort every cycle before exits were managed.
    Each distinct damage is alerted once (alert_once), not every cycle."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")    # a torn multi-byte character must not raise
    except OSError:
        return []
    out, bad = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            bad.append(line)
    if bad:
        _damaged(path, bad)
    return out


def _damaged(path, bad):
    import hashlib
    try:
        name = str(Path(path).resolve().relative_to(ROOT.resolve()))
    except (OSError, ValueError):
        name = str(path)
    log(f"  {name}: {len(bad)} damaged line(s) skipped")
    sig = hashlib.sha1("\n".join(bad).encode("utf-8", "replace")).hexdigest()[:12]
    alert_once(f"damaged:{name}:{sig}", f"{name}: {len(bad)} damaged line(s) skipped (a torn write or a merge marker); every other "
               "line is read and the bot keeps running. Repair or delete the damaged line when convenient.",
               "high", "Executor: damaged ledger line")


def settings():
    s = load_json(CONFIG / "settings.json")
    if not s:
        raise RuntimeError(f"{CONFIG}/settings.json missing or invalid")
    return s


TF_SECONDS = {"1h": 3600, "4h": 4 * 3600, "1d": 86400}


def trigger_tf(s):
    tf = s.get("trigger_tf", "4h")
    if tf not in TF_SECONDS:
        raise RuntimeError(f"trigger_tf {tf!r} not supported")
    return tf


def bar_seconds(s):
    return TF_SECONDS[trigger_tf(s)]


def agents():
    """The agent roster (agents/index.json). "core" is always present, config in config/."""
    idx = load_json(ROOT / "agents" / "index.json") or {}
    out = [a for a in idx.get("agents", []) if re.fullmatch(r"[a-z][a-z0-9-]{1,23}", a.get("id", ""))]
    if not any(a["id"] == "core" for a in out):
        out.insert(0, {"id": "core", "name": "Core", "enabled": True})
    return out


def books():
    """Enabled books from config/books.json: {book: {benchmark, pot_share_pct, open_risk_cap_pct, sweep, names[]}}"""
    b = load_json(CONFIG / "books.json") or {}
    out = {}
    for x in b.get("books", []):
        if x.get("enabled", True):
            out[x["book"]] = {"benchmark": x["benchmark"], "pot_share_pct": x.get("pot_share_pct"),
                              "open_risk_cap_pct": x.get("open_risk_cap_pct"),
                              "sweep": bool(x.get("sweep_gains_to_benchmark", False)),
                              "names": [n["coin"] if isinstance(n, dict) else n for n in x.get("names", [])]}
    return out


def allowlist():
    """Union of every enabled book's names, first book wins on a duplicate."""
    seen = []
    for b in books().values():
        for c in b["names"]:
            if c not in seen:
                seen.append(c)
    return seen


def book_of(coin):
    for name, b in books().items():
        if coin in b["names"]:
            return name, b
    return None, None


def http_json(url, body=None, headers=None, tries=3, timeout=30):
    """GET (body None) or POST JSON; retries with backoff; raises after the last try."""
    hdr = {"User-Agent": "aifi-executor/1.0", "Accept": "application/json"}
    if body is not None:
        hdr["Content-Type"] = "application/json"
    hdr.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    last = None
    attempt = 0
    while attempt < tries:
        try:
            req = urllib.request.Request(url, data=data, headers=hdr, method="POST" if data is not None else "GET")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:                       # rate limited: back off hard, and allow a few extra tries
                tries = max(tries, 6)
                time.sleep(min(30, 4 * 2 ** min(attempt, 3)))
            elif attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
            last = e
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
        attempt += 1
    raise RuntimeError(f"{url.split('?')[0]}: {str(last)[:160]}")


# The owner's rule: the phone makes a sound only when there is something to do. ntfy priorities: 5 urgent (live money at
# risk now: a stop missing, a close that failed, the ledger and the exchange disagreeing), 4 high (act today), 3 default,
# 2 low (silent, in the notification drawer), 1 min (not shown, only in the app's list). Paper trades are not pushed.
PRIORITY = {"urgent": "5", "max": "5", "high": "4", "default": "3", "low": "2", "min": "1"}
SENT = STATE / "alerts_sent.json"


def alert(msg, priority="default", title=None):
    """Push one alert to ALERT_WEBHOOK (ntfy.sh, Slack or Discord) at a priority: urgent | high | default | low (or min).
    ntfy gets a `Priority` header (5/4/3/2/1) and a short ASCII `Title`; Slack and Discord get the title in the text,
    urgent ones marked. Best effort: returns True only when a channel accepted it, never raises. Callers never put
    dollar amounts in `msg`."""
    return _send(title or "Executor", str(msg), priority)


def notify(title, text, priority="default"):
    """The original two-part alert (title, text), now with an optional priority; every existing call keeps working."""
    return _send(title, text, priority)


def alert_once(key, msg, priority="default", title=None, every_hours=None):
    """alert(), unless `key` was delivered before (ever, or within the last `every_hours`). The keys live in
    state/alerts_sent.json, so a standing problem pages once instead of every cycle. A key counts as sent only when a
    channel accepted it, so a process without the webhook (a dashboard push) can never swallow the real alert."""
    sent = load_json(SENT, {}) or {}
    last = sent.get(key)
    now = now_ts()
    if isinstance(last, (int, float)) and (every_hours is None or now - last < every_hours * 3600):
        log(f"  alert (already sent): {title or 'Executor'}: {msg}")
        return False
    ok = alert(msg, priority, title)
    if ok:
        sent[key] = now
        if len(sent) > 300:                        # keep the file small: the newest keys only
            sent = dict(sorted(sent.items(), key=lambda kv: kv[1] if isinstance(kv[1], (int, float)) else 0)[-300:])
        try:
            write_json(SENT, sent)
        except OSError:
            pass
    return ok


def ntfy_priority(priority):
    """'urgent' | 'high' | 'default' | 'low' | 'min' (or 5..1) → ntfy's Priority header value; anything else → '3'."""
    p = str(priority).strip().lower()
    return PRIORITY.get(p) or (p if p in ("1", "2", "3", "4", "5") else "3")


def _send(title, text, priority="default"):
    pr = ntfy_priority(priority)
    if AGENT != "core":
        title = f"[{AGENT}] {title}"
    url = (os.environ.get("ALERT_WEBHOOK") or "").strip()
    if not url.startswith("https://"):
        log(f"  alert (no channel, priority {pr}): {title}: {text}")
        return False
    msg = f"{title}: {text}"
    if "hooks.slack.com" in url or "mattermost" in url:
        body, hdr = json.dumps({"text": ("URGENT · " if pr == "5" else "") + msg}).encode(), {"Content-Type": "application/json"}
    elif "discord.com/api/webhooks" in url or "discordapp.com/api/webhooks" in url:
        body, hdr = json.dumps({"content": (("URGENT · " if pr == "5" else "") + msg)[:1900]}).encode(), {"Content-Type": "application/json"}
    else:
        body = text.encode()[:3000]
        hdr = {"Title": "".join(c for c in title if c.isascii())[:80] or "AiFi executor", "Priority": pr,
               "Content-Type": "text/plain; charset=utf-8"}
    hdr["User-Agent"] = "aifi-executor/1.0"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=hdr, method="POST"), timeout=20) as r:
                r.read()
            return True
        except Exception as e:  # noqa: BLE001 — alerting must never crash the run
            if attempt == 2:
                log(f"  alert webhook failed: {str(e)[:120]}")
            else:
                time.sleep(2 * (attempt + 1))
    return False


def local_now(tz_name):
    return datetime.now(ZoneInfo(tz_name))


def pct(x, nd=2):
    return f"{x * 100:.{nd}f}%"


def fleet():
    return load_json(FLEET_CFG) or {}


def fleet_mult(agent=None):
    """The fleet's size dial for this agent, 0..1. Only applied when the owner turned on apply_regime_weights (the
    lab then writes size_mult from the regime weights); paper arena agents keep 1.0 so they stay comparable with
    their backtests."""
    f = fleet()
    if not f.get("apply_regime_weights"):
        return 1.0
    try:
        return max(0.0, min(1.0, float((f.get("size_mult") or {}).get(agent or AGENT, 1.0))))
    except (TypeError, ValueError):
        return 1.0


def host():
    """Where cycles run and orders are sent from: "github" or "alwaysdata" (config/host.json, one switch for both)."""
    return (load_json(ROOT / "config" / "host.json") or {}).get("host", "github")
