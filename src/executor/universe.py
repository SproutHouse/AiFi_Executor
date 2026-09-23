"""universe.py — which names may be traded at all. Every refusal carries its reason.
Filters use Hyperliquid's own market context (24h volume, open interest, funding, max leverage) and the
length of the pair's daily history, so a young or thin market is excluded by construction."""
from . import hl_data as H


def check(coin, row, u, days_of_history=None):
    if row is None:
        return False, ["not listed on Hyperliquid perpetuals"]
    reasons = []
    try:
        vol = float(row.get("dayNtlVlm", 0))
    except (TypeError, ValueError):
        vol = 0.0
    if vol < u["min_day_volume_usd"]:
        reasons.append(f"24h volume {vol / 1e6:.1f}M below {u['min_day_volume_usd'] / 1e6:.0f}M")
    oi = H.notional_oi_usd(row)
    if oi is None or oi < u["min_open_interest_usd"]:
        reasons.append(f"open interest {(oi or 0) / 1e6:.1f}M below {u['min_open_interest_usd'] / 1e6:.0f}M")
    try:
        if int(row.get("maxLeverage", 0)) < u["min_max_leverage"]:
            reasons.append(f"max leverage {row.get('maxLeverage')} below {u['min_max_leverage']}")
    except (TypeError, ValueError):
        reasons.append("max leverage unreadable")
    fa = H.funding_annual_pct(row)
    if fa is not None and fa > u["max_funding_annual_pct"]:
        reasons.append(f"funding {fa:.0f}%/yr against longs above {u['max_funding_annual_pct']}%")
    if days_of_history is not None and days_of_history < u["min_daily_bars"]:
        reasons.append(f"{days_of_history} daily bars below {u['min_daily_bars']}")
    return (not reasons), reasons
