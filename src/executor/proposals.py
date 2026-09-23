"""proposals.py — entries that wait for the owner's tap. A proposal expires at the next 4-hour close."""
import time
from . import common as C

DIR = C.STATE / "proposals"


def new_id(coin, kind, ts):
    return f"{time.strftime('%Y%m%d-%H%M', time.gmtime(ts))}-{coin}-{kind}"


def create(cand, sizing, checks, expires_at, why, mark, mode):
    ts = C.now_ts()
    doc = {"id": new_id(cand["coin"], cand["kind"], ts), "status": "open", "created": C.iso(ts),
           "expires": C.iso(expires_at), "expires_ts": expires_at, "why_waiting": why, "mode": mode,
           "candidate": cand, "sizing": sizing, "checks": checks, "mark_at_signal": mark}
    C.write_json(DIR / f"{doc['id']}.json", doc)
    return doc


def load(pid):
    return C.load_json(DIR / f"{pid}.json")


def save(doc):
    C.write_json(DIR / f"{doc['id']}.json", doc)


def open_proposals():
    out = []
    if DIR.exists():
        for p in sorted(DIR.glob("*.json")):
            d = C.load_json(p)
            if d and d.get("status") == "open":
                out.append(d)
    return out


def expire_stale(now_ts):
    expired = []
    for d in open_proposals():
        if d["expires_ts"] <= now_ts:
            d["status"] = "expired"
            d["closed"] = C.iso(now_ts)
            save(d)
            expired.append(d)
    return expired
