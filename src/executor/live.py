"""live.py — the Hyperliquid execution adapter. UNTESTED against a funded account until stage one of the
live phase; every call is written against hyperliquid-python-sdk 0.24.0 signatures.

Only the agent key is ever present here (HL_AGENT_KEY). It can place and cancel orders and nothing else;
withdrawals and transfers are master-signed actions the agent cannot perform. HL_ACCOUNT_ADDRESS is the
master wallet's public address, used to read state.
"""
import os, uuid
from . import common as C
from . import hl_data as H


def available():
    try:
        import hyperliquid  # noqa: F401
        import eth_account  # noqa: F401
        return True
    except ImportError:
        return False


def creds():
    return (os.environ.get("HL_AGENT_KEY") or "").strip(), (os.environ.get("HL_ACCOUNT_ADDRESS") or "").strip()


def clients():
    from eth_account import Account
    from hyperliquid.exchange import Exchange
    from hyperliquid.info import Info
    from hyperliquid.utils import constants
    key, addr = creds()
    if not key or not addr:
        raise RuntimeError("live mode needs HL_AGENT_KEY and HL_ACCOUNT_ADDRESS")
    wallet = Account.from_key(key)
    ex = Exchange(wallet, constants.MAINNET_API_URL, account_address=addr)
    info = Info(constants.MAINNET_API_URL, skip_ws=True)
    return ex, info, addr


def new_cloid():
    from hyperliquid.utils.types import Cloid
    return Cloid.from_str("0x" + uuid.uuid4().hex)


def cloid_from(raw):
    from hyperliquid.utils.types import Cloid
    return Cloid.from_str(raw)


def raw(cloid):
    return cloid.to_raw() if hasattr(cloid, "to_raw") else str(cloid)


def set_isolated_leverage(ex, coin, lev):
    return ex.update_leverage(int(lev), coin, is_cross=False)


def entry_ioc(ex, coin, sz, cap_px, cloid):
    """Marketable limit, immediate-or-cancel: fills up to cap_px or not at all. Never rests."""
    return ex.order(coin, True, sz, cap_px, {"limit": {"tif": "Ioc"}}, reduce_only=False, cloid=cloid)


def place_stop(ex, coin, sz, stop_px, worst_px, cloid):
    """Exchange-resident stop: reduce-only trigger order, market on trigger, judged on the mark price."""
    return ex.order(coin, False, sz, worst_px, {"trigger": {"triggerPx": stop_px, "isMarket": True, "tpsl": "sl"}},
                    reduce_only=True, cloid=cloid)


def cancel(ex, coin, cloid):
    return ex.cancel_by_cloid(coin, cloid)


def close_market(ex, coin, sz, cloid):
    return ex.market_close(coin, sz=sz, cloid=cloid)


def fill_from_response(resp):
    """Returns (avg_px, total_sz) for a filled order, or (None, detail) otherwise."""
    try:
        statuses = resp["response"]["data"]["statuses"]
        st = statuses[0]
        if "filled" in st:
            return float(st["filled"]["avgPx"]), float(st["filled"]["totalSz"])
        return None, str(st)[:200]
    except (KeyError, IndexError, TypeError, ValueError):
        return None, str(resp)[:200]


def account(addr):
    st = H.user_state(addr)
    value = float(st["marginSummary"]["accountValue"])
    positions = {}
    for ap in st.get("assetPositions", []):
        p = ap.get("position", {})
        szi = float(p.get("szi", 0) or 0)
        if szi != 0:
            positions[p["coin"]] = {"szi": szi, "entryPx": float(p.get("entryPx") or 0),
                                    "liquidationPx": p.get("liquidationPx"), "leverage": p.get("leverage")}
    return value, positions, st


def reconcile(local, addr):
    """Exchange is the truth. Any long the ledger does not know, any ledger position the exchange does not
    hold, a size that differs beyond rounding, or a missing resting stop is a mismatch that halts entries."""
    value, exch, _ = account(addr)
    orders = H.frontend_open_orders(addr)
    stops = {}
    for o in orders:
        if o.get("reduceOnly") and o.get("orderType", "").lower().startswith("stop"):
            stops.setdefault(o["coin"], []).append(o)
    problems = []
    for coin, pos in local.items():
        e = exch.get(coin)
        if not e:
            problems.append(f"{coin}: in ledger, not on exchange")
            continue
        if abs(e["szi"] - pos["sz"]) / max(pos["sz"], 1e-9) > 0.02:
            problems.append(f"{coin}: size differs (exchange {e['szi']:.6g}, ledger {pos['sz']:.6g})")
        if coin not in stops:
            problems.append(f"{coin}: no resting reduce-only stop on the exchange")
    for coin in exch:
        if coin not in local:
            problems.append(f"{coin}: on exchange, not in ledger")
    return {"ok": not problems, "problems": problems, "account_value": value, "exchange_positions": exch}
