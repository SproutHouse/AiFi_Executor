#!/usr/bin/env python3
"""Execute an approved proposal: python3 scripts/approve.py --id <proposal id> --confirm yes
Re-checks that the proposal is open, not expired, that price has not run more than the allowed drift above
the signal mark, and that every pre-trade check still passes with the current book."""
import argparse, _path  # noqa: F401
from executor import common as C, hl_data as H, binance_data as B, regime as R, risk as K, proposals as P, ledger as L, universe as U
from executor.cycle import Cycle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--confirm", default="no")
    a = ap.parse_args()
    if a.confirm.lower() != "yes":
        raise SystemExit("refused: --confirm yes is required")
    doc = P.load(a.id)
    if not doc:
        raise SystemExit(f"no proposal {a.id}")
    if doc["status"] != "open":
        raise SystemExit(f"proposal is {doc['status']}, not open")
    cy = Cycle(dry=False)
    if doc["expires_ts"] <= cy.now:
        doc["status"] = "expired"; P.save(doc); raise SystemExit("proposal expired at the last bar close")
    if doc["mode"] != cy.mode:
        raise SystemExit(f"proposal was made in {doc['mode']} mode, executor is in {cy.mode}")
    cy.load_market(); cy.load_account(); cy.reconcile()
    cand = doc["candidate"]; coin = cand["coin"]
    mark = cy.marks.get(coin)
    drift = (mark / doc["mark_at_signal"] - 1) * 100 if mark and doc.get("mark_at_signal") else 0.0
    if drift > cy.s.get("approval_max_drift_pct", 1.0):
        doc["status"] = "rejected"; doc["why_closed"] = f"price ran {drift:.2f}% above the signal mark"; P.save(doc)
        L.record_refusal(cand, doc["why_closed"], cy.now, "approval")
        raise SystemExit(doc["why_closed"])
    if mark <= cand["stop"]:
        doc["status"] = "rejected"; doc["why_closed"] = "mark at or below the stop"; P.save(doc)
        raise SystemExit(doc["why_closed"])
    row = cy.ctxs.get(coin) or {}
    d, h = cy.bars.get(coin); ctx = R.context(d, h, cy.now, cy.s["indicators"])
    u_ok, u_reasons = U.check(coin, row, cy.s["universe"], ctx["days"])
    second = B.last_price(coin)
    sanity_ok = True if not second else abs(mark - second) / second * 100 <= cy.s["data"]["sanity_band_pct"]
    sizing = K.size(cy.equity, mark * (1 + cy.s["entry_slippage_cap_pct"] / 100), cand["stop"], cy.s, row.get("maxLeverage"), cy.thr["multiplier"])
    flags = {"halt": cy.halt, "halt_reason": cy.halt_reason, "throttle_halt": cy.thr["halt"], "drawdown_pct": cy.thr["drawdown_pct"],
             "fresh": True, "fresh_detail": "manual approval", "sanity_ok": sanity_ok, "sanity_detail": "", "universe_ok": u_ok,
             "universe_reasons": u_reasons}
    flags.update(cy.rec_flags)
    ok, checks = K.pre_trade(cand, sizing, cy.positions, cy.equity, cy.s, flags)
    if not ok:
        failed = [c for c in checks if not c["ok"]]
        doc["status"] = "rejected"; doc["why_closed"] = "; ".join(c["check"] for c in failed); P.save(doc)
        L.record_refusal(cand, failed, cy.now, "approval")
        raise SystemExit("refused: " + doc["why_closed"])
    pos = cy.execute_entry(cand, sizing, mark, ctx)
    doc["status"] = "executed" if pos else "failed"
    doc["executed"] = C.iso(cy.now); doc["fill"] = pos["entry"] if pos else None
    P.save(doc)
    if cy.mode == "paper":
        from executor import paper as PA
        PA.save_pot(cy.pot)
    L.save_positions(cy.positions, cy.mode)
    L.render_markdown(cy.positions, cy.summary, cy.mode)
    print("\n".join(cy.summary))


if __name__ == "__main__":
    main()
