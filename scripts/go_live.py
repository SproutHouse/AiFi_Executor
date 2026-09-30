#!/usr/bin/env python3
"""go_live.py — the owner's switch from paper to live for ONE agent (docs/specs/FACTORY.md, Phase 5).

  go_live.py <agent> --pot 250          agent → mode "live"; a paper twin <agent>-twin starts beside it
  go_live.py <agent> --back             agent → mode "paper" again; its twin is disabled

Run only through the go-live workflow (workflow_dispatch), which asks the owner to type "LIVE <agent>" and refuses
GitHub's US-hosted runners unless the owner explicitly allows them. The twin runs the same recipe in paper with the
same pot, so the difference between the two is the cost of real execution (fills, slippage, funding timing).

What it never does: create keys, move money, or change another agent. Before this, the owner must have made the
agent's own Hyperliquid wallet, funded it with the pot, created an API (agent) wallet on it, and added the two
secrets HL_AGENT_KEY_<ID> and HL_ACCOUNT_ADDRESS_<ID> (docs/OPERATIONS.md). Without them the engine keeps running
paper and says why (cycle.resolve_mode), so a missing secret can never half-enable live trading.
"""
import argparse, json, re, shutil, sys
import _path  # noqa: F401
from executor import common as C

INDEX = C.ROOT / "agents" / "index.json"


def cfg_dir(aid):
    return C.ROOT / "config" if aid == "core" else C.ROOT / "agents" / aid


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("agent")
    ap.add_argument("--pot", type=float, help="the live wallet's starting balance in USD (the twin gets the same paper pot)")
    ap.add_argument("--back", action="store_true")
    a = ap.parse_args(argv)
    idx = json.loads(INDEX.read_text())
    rows = {r["id"]: r for r in idx["agents"]}
    if a.agent != "core" and a.agent not in rows:
        sys.exit(f"no agent {a.agent!r} in agents/index.json")
    row = rows.get(a.agent) or {"id": "core"}
    if row.get("twin_of"):
        sys.exit("a twin is the paper reference for a live agent; it never goes live itself")
    sp = cfg_dir(a.agent) / "settings.json"
    s = json.loads(sp.read_text())
    twin = f"{a.agent}-twin"
    if a.back:
        s["mode"] = "paper"
        sp.write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n")
        for r in idx["agents"]:
            if r["id"] == a.agent and r.get("live"):
                r["live"]["ended"] = C.iso()[:10]
            if r["id"] == twin:
                r["enabled"] = False
        INDEX.write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n")
        print(f"{a.agent} back to paper; {twin} disabled")
        return
    if not a.pot or a.pot <= 0:
        sys.exit("--pot is required (the live wallet's starting balance)")
    if s.get("mode") == "live":
        sys.exit(f"{a.agent} is already live")
    if not row.get("enabled", True):
        sys.exit(f"{a.agent} is disabled (retired); enable it deliberately first")
    if s.get("strategy") == "carry" and not s.get("carry_live_validated"):
        sys.exit("carry live order handling is not validated on testnet yet (docs/specs/CARRY.md, Phase 4)")
    coins = (s.get("target") or {}).get("coins") or (s.get("carry") or {}).get("basket") or []
    if any(":" in c for c in coins):
        sys.exit("builder-market (HIP-3) coins are paper-only until their live order path is validated (docs/specs/MARKETS.md)")
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,23}", twin):
        sys.exit(f"twin id {twin!r} would be too long")
    tdir = C.ROOT / "agents" / twin
    tdir.mkdir(parents=True, exist_ok=True)
    ts = dict(s, mode="paper", pot_usd_paper=a.pot, twin_of=a.agent)
    ts["_agent_note"] = f"Paper twin of {a.agent}, started {C.iso()[:10]} when it went live with a {a.pot:.0f} USD pot. Same rules, same pot, paper fills: the gap to the live agent is the cost of real execution."
    (tdir / "settings.json").write_text(json.dumps(ts, indent=2, ensure_ascii=False) + "\n")
    shutil.copy(cfg_dir(a.agent) / "books.json", tdir / "books.json")
    s["mode"] = "live"
    sp.write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n")
    out = []
    for r in idx["agents"]:
        if r["id"] == twin:
            continue
        if r["id"] == a.agent:
            r["live"] = {"since": C.iso()[:10], "pot_usd": a.pot}
        out.append(r)
        if r["id"] == a.agent:
            out.append({"id": twin, "name": (r.get("name") or a.agent) + " twin", "enabled": True, "twin_of": a.agent,
                        "desc": f"Paper twin of {r.get('name') or a.agent} (live since {C.iso()[:10]}): same rules and pot in paper; the gap is the cost of real execution."})
    if a.agent == "core" and not any(r["id"] == twin for r in out):
        out.insert(1, {"id": twin, "name": "Core twin", "enabled": True, "twin_of": "core", "desc": "Paper twin of Core."})
    idx["agents"] = out
    INDEX.write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n")
    print(f"{a.agent} → live (pot {a.pot:.0f}); paper twin {twin} added. The next cycle trades live if its two secrets exist, "
          f"otherwise it keeps running paper and alerts.")


if __name__ == "__main__":
    main()
