#!/usr/bin/env python3
"""dashboard_push.py — build one JSON bundle from state/ and config/ and write it to the dashboard's KV.
Keys: exec:latest, exec:<date>, dates, doc:<slug>. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID;
the KV namespace is found by its title ("aifi-executor"), so no id is stored anywhere.
--build-only <file> writes the bundle to a file and touches nothing remote."""
import json, os, sys, time, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timezone
import _path  # noqa: F401
from executor import common as C, ledger as L

NAMESPACE_TITLE = "aifi-executor"
DOCS = {"how_it_works": "HOW_IT_WORKS.md", "logic": "LOGIC.md", "risk": "RISK.md", "universe": "UNIVERSE.md", "execution": "EXECUTION.md",
        "security": "SECURITY.md", "ledger": "LEDGER.md", "operations": "OPERATIONS.md", "decisions": "DECISIONS.md"}


def bucket(tr, key):
    b = defaultdict(list)
    for x in tr:
        b[x.get(key) or "?"].append(x)
    return {k: L.stats(v) for k, v in b.items()}


def build():
    s = C.settings(); mode = s.get("mode", "paper")
    positions = L.positions(mode)
    trades = [x for x in L.trades() if x.get("mode") == mode]
    refused = C.read_jsonl(L.REFUSED)
    eq = L.equity_points(mode)
    last_run = C.load_json(C.STATE / "runs" / "last_run.json", {}) or {}
    pot = C.load_json(C.STATE / "paper.json", {}) or {}
    start = float(pot.get("start") or (eq[0]["equity"] if eq else 0) or 0)
    now_eq = eq[-1]["equity"] if eq else start
    peak = max([p["equity"] for p in eq] + [start]) if (eq or start) else 0
    counts = defaultdict(int)
    for r in refused:
        d = r.get("detail")
        if isinstance(d, list):
            for c in d:
                counts[c.get("check", "?")] += 1
        else:
            counts[str(d)[:60]] += 1
    reviews = sorted((C.STATE / "review").glob("*.md")) if (C.STATE / "review").exists() else []
    review_md = reviews[-1].read_text() if reviews else ""
    open_props = []
    pdir = C.STATE / "proposals"
    if pdir.exists():
        for f in sorted(pdir.glob("*.json")):
            d = C.load_json(f)
            if d and d.get("status") == "open":
                open_props.append({"id": d["id"], "coin": d["candidate"]["coin"], "kind": d["candidate"]["kind"], "tier": d["candidate"]["tier"], "expires": d["expires"]})
    books = json.load(open(C.CONFIG / "books.json"))
    today = C.iso()[:10]
    runs_today = len(C.read_jsonl(C.STATE / "runs" / f"{today}.jsonl"))
    next_close = ((C.now_ts() // C.BAR_SECONDS) + 1) * C.BAR_SECONDS
    return {
        "generated": C.iso(), "date": today, "mode": mode,
        "settings": {k: s[k] for k in ("version", "risk_per_trade_pct", "open_risk_cap_pct", "gross_exposure_cap_x", "leverage_cap_x", "max_positions",
                                       "throttle", "universe", "approval", "timezone", "fee_taker_pct") if k in s},
        "books": books.get("books", []),
        "last_run": last_run, "runs_today": runs_today, "next_cycle": C.iso(next_close + 300),
        "positions": positions, "proposals_open": open_props,
        "pot": {"start": start, "equity": now_eq, "change_pct": (now_eq / start - 1) * 100 if start else 0.0,
                "peak": peak, "drawdown_pct": (peak - now_eq) / peak * 100 if peak else 0.0, "points": len(eq)},
        "equity": [{"t": p["t"], "pct": (p["equity"] / start - 1) * 100 if start else 0.0} for p in eq],
        "trades": trades[-200:], "stats": L.stats(trades), "by_book": bucket(trades, "book"), "by_tier": bucket(trades, "tier"),
        "by_kind": bucket(trades, "kind"), "by_reason": bucket(trades, "reason"),
        "refused": refused[-200:], "refused_total": len(refused), "refused_counts": dict(counts),
        "sweeps": C.read_jsonl(L.SWEEPS)[-50:],
        "review_md": review_md, "review_date": reviews[-1].stem if reviews else None,
    }


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


def namespace_id():
    res = api("/storage/kv/namespaces?per_page=100")
    for ns in res.get("result", []):
        if ns.get("title") == NAMESPACE_TITLE:
            return ns["id"]
    raise RuntimeError(f"KV namespace '{NAMESPACE_TITLE}' not found; run the deploy-dashboard workflow first")


def main():
    b = build()
    if "--build-only" in sys.argv:
        out = sys.argv[sys.argv.index("--build-only") + 1]
        C.write_json(out, b); print(f"bundle → {out} ({len(json.dumps(b))} bytes)"); return
    ns = namespace_id()
    dates_raw = api(f"/storage/kv/namespaces/{ns}/values/dates") if False else None
    try:
        req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/storage/kv/namespaces/{ns}/values/dates",
                                     headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dates = json.loads(r.read().decode())
    except Exception:  # noqa: BLE001
        dates = []
    if b["date"] not in dates:
        dates = sorted(set(dates + [b["date"]]))[-120:]
    pairs = {"exec:latest": json.dumps(b), f"exec:{b['date']}": json.dumps(b), "dates": json.dumps(dates)}
    for slug, fn in DOCS.items():
        p = C.DOCS / fn
        if p.exists():
            pairs[f"doc:{slug}"] = p.read_text()
    res = api(f"/storage/kv/namespaces/{ns}/bulk", [{"key": k, "value": v} for k, v in pairs.items()])
    if not res.get("success"):
        raise RuntimeError(f"bulk write failed: {res.get('errors')}")
    print(f"pushed {len(pairs)} keys to KV ({len(pairs['exec:latest'])} bytes bundle)")


if __name__ == "__main__":
    main()
