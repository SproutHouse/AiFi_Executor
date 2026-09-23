"""common.py — paths, JSON helpers, HTTP, time zones and alerts. Standard library only.

Every module imports from here so there is one place for I/O behaviour. Paths
resolve from $EXECUTOR_HOME, else the repository root two levels above this file,
so the same code runs from a checkout, a worktree or a GitHub runner.
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(os.environ.get("EXECUTOR_HOME") or Path(__file__).resolve().parents[2])
CONFIG = ROOT / "config"
STATE = Path(os.environ.get("EXECUTOR_STATE") or ROOT / "state")
DOCS = ROOT / "docs"
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
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def read_jsonl(path):
    out = []
    try:
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
    except OSError:
        pass
    return out


def settings():
    s = load_json(CONFIG / "settings.json")
    if not s:
        raise RuntimeError("config/settings.json missing or invalid")
    return s


def allowlist():
    a = load_json(CONFIG / "allowlist.json") or {}
    return [x["coin"] for x in a.get("names", []) if x.get("enabled", True)]


def http_json(url, body=None, headers=None, tries=3, timeout=30):
    """GET (body None) or POST JSON; retries with backoff; raises after the last try."""
    hdr = {"User-Agent": "aifi-executor/1.0", "Accept": "application/json"}
    if body is not None:
        hdr["Content-Type"] = "application/json"
    hdr.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=hdr, method="POST" if data is not None else "GET")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError, OSError) as e:
            last = e
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url.split('?')[0]}: {str(last)[:160]}")


def notify(title, text):
    """Best-effort alert to ALERT_WEBHOOK (ntfy.sh, Slack or Discord). Returns True only
    when a channel accepted it. Callers never put dollar amounts in `text`."""
    url = (os.environ.get("ALERT_WEBHOOK") or "").strip()
    if not url.startswith("https://"):
        log(f"  alert (no channel): {title}: {text}")
        return False
    msg = f"{title}: {text}"
    if "hooks.slack.com" in url or "mattermost" in url:
        body, hdr = json.dumps({"text": msg}).encode(), {"Content-Type": "application/json"}
    elif "discord.com/api/webhooks" in url or "discordapp.com/api/webhooks" in url:
        body, hdr = json.dumps({"content": msg[:1900]}).encode(), {"Content-Type": "application/json"}
    else:
        body = text.encode()[:3000]
        hdr = {"Title": "".join(c for c in title if c.isascii())[:80] or "AiFi executor",
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
