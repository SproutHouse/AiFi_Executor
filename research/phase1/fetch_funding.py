"""Download the complete hourly funding history for each coin from Hyperliquid's public API (fundingHistory,
500 rows per call). Output: data/funding_<COIN>.json as [[t_ms, rate_per_hour, premium], ...], oldest first."""
import json, os, sys, time, urllib.request
COINS = sys.argv[1:] or "BTC ETH SOL HYPE ZEC ENA PUMP XPL XRP NEAR SUI UNI TAO LINK LTC AAVE DOGE ONDO WLD ARB".split()
os.makedirs("data", exist_ok=True)
def post(b):
    for a in range(6):
        try:
            r = urllib.request.Request("https://api.hyperliquid.xyz/info", data=json.dumps(b).encode(), headers={"Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(r, timeout=30))
        except Exception as e:
            time.sleep(4 * (a + 1))
    raise RuntimeError("fundingHistory failed")
for c in COINS:
    fn = f"data/funding_{c}.json"
    if os.path.exists(fn):
        continue
    rows, start = [], 1672531200000          # 2023-01-01; the API returns from the coin's listing
    while True:
        page = post({"type": "fundingHistory", "coin": c, "startTime": start})
        if not page:
            break
        rows += [[int(p["time"]), float(p["fundingRate"]), float(p.get("premium", 0))] for p in page]
        nxt = int(page[-1]["time"]) + 1
        if len(page) < 500 or nxt <= start:
            break
        start = nxt
        time.sleep(0.4)
    json.dump(rows, open(fn, "w"))
    print(c, len(rows), time.strftime("%Y-%m-%d", time.gmtime(rows[0][0] / 1000)) if rows else "-", flush=True)
