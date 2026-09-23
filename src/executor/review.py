"""review.py — the Sunday scorecard. Numbers from the ledger; proposals only, never changes."""
from collections import defaultdict
from . import common as C, ledger as L


def bucket(tr, key):
    b = defaultdict(list)
    for x in tr:
        b[x.get(key) or "?"].append(x)
    return {k: L.stats(v) for k, v in b.items()}


def render(mode):
    tr = [x for x in L.trades() if x.get("mode") == mode]
    st = L.stats(tr)
    refused = C.read_jsonl(L.REFUSED)
    pts = L.equity_points(mode)
    lines = [f"# Weekly review — {C.iso()[:10]} ({mode})", ""]
    if not st["n"]:
        lines.append("No closed trades yet.")
    else:
        pf = f"{st['profit_factor']:.2f}" if st["profit_factor"] is not None else "n/a"
        lines += [f"- Closed trades {st['n']} · win rate {st['win_rate']:.0%} · average {st['avg_R']:+.2f} R · total {st['total_R']:+.1f} R · "
                  f"profit factor {pf} · worst losing streak {st['worst_losing_streak']} · costs {st['fees_R']:.2f} R per trade", ""]
        for key, title in (("tier", "By tier"), ("kind", "By trigger"), ("coin", "By coin"), ("reason", "By exit reason")):
            lines += [f"## {title}", "", "| Bucket | n | Win | Avg R | Total R |", "|---|---|---|---|---|"]
            for k, v in sorted(bucket(tr, key).items(), key=lambda kv: -kv[1]["total_R"]):
                lines.append(f"| {k} | {v['n']} | {v['win_rate']:.0%} | {v['avg_R']:+.2f} | {v['total_R']:+.1f} |")
            lines.append("")
    if pts:
        peak = max(p["equity"] for p in pts)
        lines += ["## Pot", "", f"- Equity points {len(pts)} · drawdown from peak {(peak - pts[-1]['equity']) / peak * 100:.1f}% · "
                  f"change since first point {(pts[-1]['equity'] / pts[0]['equity'] - 1) * 100:+.1f}%", ""]
    if refused:
        counts = defaultdict(int)
        for r in refused:
            d = r.get("detail")
            if isinstance(d, list):
                for c in d:
                    counts[c.get("check", "?")] += 1
            else:
                counts[str(d)[:40]] += 1
        lines += ["## Refused signals", "", "| Reason | Count |", "|---|---|"]
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
            lines.append(f"| {k} | {v} |")
        lines.append("")
    lines += ["## Gates", "", "- Live at half size needs: 30 closed trades, average above +0.2 R, drawdown under 20%, costs at most 0.12 R per trade.",
              "- Rule changes need: a versioned proposal that beat v1.0 on the last 12 months out of sample, then four weeks of paper.", ""]
    out = C.STATE / "review" / f"{C.iso()[:10]}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    head = lines[2] if st["n"] else "No closed trades yet."
    C.notify("Executor: weekly review", head[:900])
    return out
