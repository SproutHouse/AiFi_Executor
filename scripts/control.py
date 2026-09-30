#!/usr/bin/env python3
"""Manual controls. --flatten closes everything now and sets HALT; --halt "reason" stops new entries;
--resume clears HALT. --fleet-halt "reason" / --fleet-resume do the same for EVERY agent at once (state/FLEET_HALT).
Exits are never blocked by any halt."""
import argparse, _path  # noqa: F401
from executor import common as C, ledger as L, paper as PA
from executor.cycle import Cycle, HALT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flatten", action="store_true")
    ap.add_argument("--halt", default=None)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--fleet-halt", default=None, help="stop new entries on EVERY agent (exits still run)")
    ap.add_argument("--fleet-resume", action="store_true")
    a = ap.parse_args()
    if a.fleet_resume:
        C.FLEET_HALT.unlink(missing_ok=True)
        C.FLEET_HALT.with_name("FLEET_HALT.since").unlink(missing_ok=True)
        C.notify("Executor: fleet resumed", "fleet halt cleared; every agent may enter again from its next cycle")
        print("fleet resumed"); return
    if a.fleet_halt is not None:
        C.FLEET_HALT.parent.mkdir(parents=True, exist_ok=True)
        C.FLEET_HALT.write_text(a.fleet_halt or "manual fleet halt")
        C.FLEET_HALT.with_name("FLEET_HALT.since").write_text(C.iso())
        C.notify("Executor: FLEET HALTED", (a.fleet_halt or "manual") + " · no agent enters; exits still run")
        print("fleet halted"); return
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
