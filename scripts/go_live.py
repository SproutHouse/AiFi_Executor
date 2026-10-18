#!/usr/bin/env python3
"""go_live.py — the owner's switch from paper to live for ONE agent (docs/specs/FACTORY.md, Phase 5).

  go_live.py <agent> --pot 250          agent → mode "live"; a paper twin <agent>-twin starts beside it
  go_live.py <agent> --back             agent → mode "paper" again; its twin is disabled

Run only through the go-live workflow (workflow_dispatch), which asks the owner to type "LIVE <agent>" and refuses
GitHub's US-hosted runners unless the owner explicitly allows them. The twin runs the same recipe in paper with the
same pot, so the difference between the two is the cost of real execution (fills, slippage, funding timing).

A shadow experiment (an agent whose index row or settings carry "shadow", e.g. shadow-01: a recipe the lab FAILED,
paper-traded on the owner's decision) and any long-short book never go live: refused before anything else, and the
override phrase does not apply to them (cycle.paper_only would keep them in paper anyway).

Going live needs the AiFi Lab's verdict: the agent's shortlist entry in factory/factory.json must say "ready": true.
Only an explicit owner override, --override "LIVE WITHOUT READY <agent>", skips that (legacy agents are never on the
shortlist). Going back refuses while the agent still holds live positions: the paper engine never sees them, so they
would stay on the exchange with nothing but their resident stops. Flatten first, then go back.

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


def state_dir(aid):
    return C.ROOT / "state" if aid == "core" else C.ROOT / "state" / "agents" / aid


def live_positions(aid):
    """The agent's open live positions as its ledger knows them ({} when none); None when the file cannot be read."""
    p = state_dir(aid) / "positions_live.json"
    if not p.exists():
        return {}
    doc = C.load_json(p)
    return (doc.get("positions") or {}) if isinstance(doc, dict) else None


def ready(aid):
    """(True, "") when the lab's shortlist (factory/factory.json) marks the agent ready, else (False, why)."""
    f = C.load_json(C.ROOT / "factory" / "factory.json")
    if not isinstance(f, dict):
        return False, "factory/factory.json is missing or unreadable"
    row = next((r for r in f.get("shortlist") or [] if isinstance(r, dict) and r.get("agent") == aid), None)
    if row is None:
        return False, f"{aid} is not on the lab's shortlist"
    if row.get("ready") is not True:
        return False, f"{aid} is not Ready ({'; '.join(map(str, row.get('not_ready') or [])) or 'the lab has not marked it ready'})"
    return True, ""


def shadow_block(row, s):
    """Why this agent can never go live ("" when it can): a shadow experiment, or a long-short book."""
    from executor import cycle as CY
    if isinstance(row.get("shadow"), dict) or row.get("shadow"):
        return "a shadow experiment (its lab verdict is failed): paper only"
    return CY.paper_only(s)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("agent")
    ap.add_argument("--pot", type=float, help="the live wallet's starting balance in USD (the twin gets the same paper pot)")
    ap.add_argument("--back", action="store_true")
    ap.add_argument("--override", default="", help='"LIVE WITHOUT READY <agent>" to go live although the lab has not marked it Ready')
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
    if not a.back:
        why = shadow_block(row, s)
        if why:
            sys.exit(f"{a.agent} is {why}. It never goes live; no override applies.")
    twin = f"{a.agent}-twin"
    if a.back:
        held = live_positions(a.agent)
        if held is None or held:
            what = "its live positions file cannot be read" if held is None else f"it still holds live positions ({', '.join(sorted(held))})"
            sys.exit(f"{a.agent}: {what}. Back to paper would leave them on the exchange with only their stops: "
                     f"flatten first (control workflow: flatten {a.agent}), then BACK")
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
    ok, why = ready(a.agent)
    overridden = False
    if not ok:
        if a.override.strip() != f"LIVE WITHOUT READY {a.agent}":
            sys.exit(f"{why}. Live needs the lab's Ready (dashboard Shortlist). To go live anyway, set the override to exactly: "
                     f"LIVE WITHOUT READY {a.agent}" + (f" (you typed {a.override.strip()!r})" if a.override.strip() else ""))
        overridden = True
        print(f"OVERRIDE: {why}; going live on the owner's explicit instruction")
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
            if overridden:
                r["live"]["without_ready"] = True       # the record keeps that the lab had not marked it Ready
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
