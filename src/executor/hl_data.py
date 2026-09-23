"""hl_data.py — read-only Hyperliquid info API, standard library only.

Everything here is public data and needs no key. Candles come from Hyperliquid
itself so the executor prices what it trades; weekly bars are aggregated from
daily bars Monday-anchored to match the TradingView charts the desk uses (Hyperliquid's
native 1w candle is Thursday-anchored).
"""
import time
from . import common as C

API = "https://api.hyperliquid.xyz/info"
INTERVAL_SECONDS = {"4h": 4 * 3600, "1d": 86400}


def info(body):
    return C.http_json(API, body)


def meta_and_ctxs():
    """{coin: {szDecimals, maxLeverage, dayNtlVlm, openInterest, funding, markPx, oraclePx, midPx, ...}}"""
    meta, ctxs = info({"type": "metaAndAssetCtxs"})
    out = {}
    for i, u in enumerate(meta["universe"]):
        if u.get("isDelisted"):
            continue
        row = dict(u)
        row.update(ctxs[i] if i < len(ctxs) else {})
        out[u["name"]] = row
    return out


def candles(coin, interval, days, completed_only=True):
    """Bars as {t, o, h, l, c, v} with t in seconds, ascending. The forming bar is dropped
    when completed_only, judged by the bar's close time against the clock."""
    now_ms = int(time.time() * 1000)
    raw = info({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval,
                                                  "startTime": now_ms - days * 86400000, "endTime": now_ms}})
    bars = []
    for r in raw:
        if completed_only and int(r["T"]) >= now_ms:
            continue
        bars.append({"t": int(r["t"]) // 1000, "T": int(r["T"]) // 1000, "o": float(r["o"]), "h": float(r["h"]),
                     "l": float(r["l"]), "c": float(r["c"]), "v": float(r["v"])})
    bars.sort(key=lambda b: b["t"])
    return bars


def all_mids():
    return {k: float(v) for k, v in info({"type": "allMids"}).items()}


def l2(coin):
    return info({"type": "l2Book", "coin": coin})


def user_state(address):
    return info({"type": "clearinghouseState", "user": address})


def frontend_open_orders(address):
    return info({"type": "frontendOpenOrders", "user": address})


def user_fills(address):
    return info({"type": "userFills", "user": address})


def funding_annual_pct(ctx):
    """Hyperliquid quotes funding per hour; longs pay when positive."""
    try:
        return float(ctx.get("funding", 0.0)) * 24 * 365 * 100
    except (TypeError, ValueError):
        return None


def notional_oi_usd(ctx):
    try:
        return float(ctx["openInterest"]) * float(ctx["markPx"])
    except (KeyError, TypeError, ValueError):
        return None


def round_sz(sz, sz_decimals):
    q = 10 ** int(sz_decimals)
    return int(sz * q) / q


def round_px(px, sz_decimals, max_decimals=6):
    """Hyperliquid perps: at most 5 significant figures and at most (6 - szDecimals) decimals."""
    if px <= 0:
        return px
    import math
    sig = 5
    mag = math.floor(math.log10(px))
    dec_sig = max(0, sig - 1 - mag)
    dec = min(dec_sig, max_decimals - int(sz_decimals))
    return round(px, dec)
