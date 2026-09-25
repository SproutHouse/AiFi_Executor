#!/usr/bin/env python3
"""Manual controls. --flatten closes everything now and sets HALT; --halt "reason" stops new entries;
--resume clears HALT. Exits are never blocked by HALT."""
import argparse, _path  # noqa: F401
from executor import common as C, ledger as L, paper as PA
from executor.cycle import Cycle, HALT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flatten", action="store_true")
    ap.add_argument("--halt", default=None)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    if a.resume:
        if HALT.exists():
            HALT.unlink()
        HALT.with_name("HALT.since").unlink(missing_ok=True)   # dashboard: "halted since"
        C.notify("Executor: resumed", "HALT cleared; entries allowed again from the next cycle")
        print("resumed"); return
    if a.halt is not None:
        HALT.write_text(a.halt or "manual halt"); HALT.with_name("HALT.since").write_text(C.iso()); C.notify("Executor: halted", a.halt or "manual halt"); print("halted"); return
    if a.flatten:
        cy = Cycle(dry=False); cy.load_market(); cy.load_account()
        for coin, pos in list(cy.positions.items()):
            mark = cy.marks.get(coin)
            if mark:
                cy.close_position(coin, pos, mark * (1 - cy.s["paper_slippage_pct"] / 100) if cy.mode == "paper" else mark, "manual flatten", cy.now)
        if cy.mode == "paper":
            PA.save_pot(cy.pot)
        L.save_positions(cy.positions, cy.mode)
        L.render_markdown(cy.positions, cy.summary, cy.mode)
        HALT.write_text(f"manual flatten {C.iso()}")
        HALT.with_name("HALT.since").write_text(C.iso())
        C.notify("Executor: flattened", f"{len(cy.summary)} actions; HALT set")
        print("\n".join(cy.summary) or "nothing to close"); return
    ap.print_help()


if __name__ == "__main__":
    main()
