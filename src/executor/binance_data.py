"""binance_data.py — second price source for the sanity band. Public mirror, no key.
Used only to refuse an entry when Hyperliquid's mark and Binance's last price disagree."""
from . import common as C

MIRROR = "https://data-api.binance.vision/api/v3/ticker/price?symbol={pair}"


def last_price(coin):
    try:
        r = C.http_json(MIRROR.format(pair=f"{coin}USDT"), tries=2, timeout=15)
        return float(r["price"])
    except Exception:  # noqa: BLE001 — a missing second source is a data gap, not a crash
        return None
