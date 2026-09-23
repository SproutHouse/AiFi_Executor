#!/usr/bin/env python3
"""Stage one of going live: prove the agent key can read and sign, and nothing more.
Prints the agent's address (must differ from HL_ACCOUNT_ADDRESS), the account value and positions, and with
--probe-order places a post-only buy 30% below the mark that can never fill, then cancels it by client id."""
import sys, _path  # noqa: F401
from executor import common as C, hl_data as H, live as LV


def main():
    key, addr = LV.creds()
    if not key or not addr:
        raise SystemExit("set HL_AGENT_KEY and HL_ACCOUNT_ADDRESS in the environment first")
    if not LV.available():
        raise SystemExit("pip install -r requirements-live.txt first")
    from eth_account import Account
    agent = Account.from_key(key).address
    print("agent address :", agent)
    print("master address:", addr)
    if agent.lower() == addr.lower():
        raise SystemExit("the key given is the MASTER key, not an agent key. Stop. Never put the master key here.")
    value, positions, _ = LV.account(addr)
    print(f"account value : {value:.2f} USDC · positions: {positions or 'none'}")
    print("open orders   :", len(H.frontend_open_orders(addr)))
    if "--probe-order" in sys.argv:
        ex, info, _ = LV.clients()
        ctx = H.meta_and_ctxs()["BTC"]
        px = H.round_px(float(ctx["markPx"]) * 0.7, int(ctx["szDecimals"]))
        sz = H.round_sz(max(11.0 / px, 10 ** -int(ctx["szDecimals"])), int(ctx["szDecimals"]))
        cl = LV.new_cloid()
        resp = ex.order("BTC", True, sz, px, {"limit": {"tif": "Alo"}}, reduce_only=False, cloid=cl)
        print("probe order   :", str(resp)[:200])
        print("cancel        :", str(LV.cancel(ex, "BTC", cl))[:200])
    print("OK: read paths work; agent key is not the master key.")


if __name__ == "__main__":
    main()
