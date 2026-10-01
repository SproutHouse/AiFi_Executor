"""cc_fixtures.py — small state trees for the Command Center data contract (docs/COMMAND_CENTER_SPEC.md §6, Package A).

  carry_tree   a 1h carry bot: six pairs (4 open, 1 exiting, 1 entering), two with legs out of balance, one closed carry
               trade and one closed flip trade in the ledger, a run that logged PUMP's entry at the pair's own open time.
  target_tree  a 1d rebalancer with A01's real 13 weight lines and three open target positions opened 10 days ago.
  beat_tree    a 1h signal bot whose last day holds every heartbeat character: before the first run, missed, failed only,
               late, and checks that bought or sold.

Every pot-currency figure is listed in the tree's `money`, so a test can assert that none reaches a payload.
"""
import json, shutil
from pathlib import Path

REAL = Path(__file__).resolve().parent / "real"
H = 3600
DAY = 86400
T0 = 1790380800                     # 2026-09-26T00:00:00Z, a day boundary (and so an hour and a 4-hour boundary)


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def settings(**over):
    s = json.loads((REAL / "config" / "settings.json").read_text())
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(s.get(k), dict):
            s[k] = dict(s[k], **v)
        else:
            s[k] = v
    return s


def run_doc(t, summary=(), fresh=True, failed=False, positions=(), readings=(), counts=None, late_min=None):
    d = {"t": iso(t), "mode": "paper", "fresh": fresh, "failed": failed, "halt": False, "btc_weekly": "Bullish", "btc_daily": "Bullish",
         "positions": list(positions), "counts": counts or {"evaluated": 1, "triggers": 0, "refused": 0, "proposed": 0, "entered": 0},
         "summary": list(summary), "readings": list(readings), "throttle": {"multiplier": 1.0, "drawdown_pct": 0.4, "halt": False}}
    if late_min is not None:
        d["late_min"] = late_min
    return d


def write_tree(root, s, runs, positions=None, trades=(), equity=(), books=None):
    root = Path(root)
    st, cfg = root / "state", root / "config"
    if root.exists():
        shutil.rmtree(root)
    (st / "runs").mkdir(parents=True)
    (st / "ledger").mkdir(parents=True)
    cfg.mkdir(parents=True)
    (cfg / "settings.json").write_text(json.dumps(s))
    if books is None:
        shutil.copy(REAL / "config" / "books.json", cfg / "books.json")
    else:
        (cfg / "books.json").write_text(json.dumps(books))
    (st / "runs" / "runs.jsonl").write_text("".join(json.dumps(d) + "\n" for d in runs))
    (st / "positions_paper.json").write_text(json.dumps({"mode": "paper", "positions": positions or {}}))
    (st / "ledger" / "trades.jsonl").write_text("".join(json.dumps(x) + "\n" for x in trades))
    (st / "ledger" / "equity.jsonl").write_text("".join(json.dumps({"ts": t, "t": iso(t), "mode": "paper", "equity": e}) + "\n" for t, e in equity))
    return st, cfg


# ---------------------------------------------------------------------------------------------------- carry --
CARRY_POT = 1007.31
CARRY_EQ = [CARRY_POT, 1003.17, 995.83]               # the last one is E
STUCK1 = T0 + 4 * DAY + 4 * H + 7 * 60                 # ZEC's legs out of balance since 04:07Z on day 4
STUCK2 = STUCK1 + 2 * H - 60                           # PUMP's since 06:06Z
CARRY_NOW = STUCK1 + 2 * H                             # both still inside the engine's 3 h + 1 bar


def _pair(coin, state, capital, fi, theo, fees, spot=None, perp=None, opened=T0 + 2 * H, stuck=None):
    p = {"coin": coin, "kind": "carry", "side": "carry", "mode": "paper", "state": state, "target_n": round(capital / 1.5, 4),
         "capital": capital, "book": "carry", "opened": iso(opened), "opened_ts": opened, "last_funding_ts": (CARRY_NOW - 600) * 1000,
         "legs": {"spot": {"pair": "@1", "sz": 12.3457, "entry": 31.337, "mark": 30.911}, "perp": {"sz": 12.3311, "entry": 31.402}},
         "orders": {}, "rules": ["LOGIC v1.3", "carry"], "funding_income": fi, "theo_funding": theo, "fees": fees}
    if spot is not None:
        p["spot_pnl"] = spot
    if perp is not None:
        p["perp_pnl"] = perp
    if stuck:
        p["stuck_since"] = stuck
    return p


CARRY_POS = {
    "PUMP": _pair("PUMP", "open", 251.13, 0.5701, 0.5648, 0.1581, 12.1421, -14.2289, stuck=STUCK2),
    "XPL": _pair("XPL", "open", 252.17, 0.3266, 0.3365, 0.1380, -2.5697, 2.5720),
    "ETH": _pair("ETH", "open", 253.19, 0.0, 0.0, 0.0926, None, -0.0155),              # no funding due yet: theo 0
    "ZEC": _pair("ZEC", "open", 254.23, 0.2438, 0.2449, 0.1496, -3.3679, None, stuck=STUCK1),
    "HYPE": _pair("HYPE", "exiting", 199.64, 0.0915, 0.0739, 0.3150, -1.5011, -0.4101, opened=T0 + 12 * H),
    "BTC": _pair("BTC", "entering", 165.53, 0.0102, 0.0841, 0.0921, 0.0313, -0.0207, opened=T0 + 20 * H),
}
CARRY_TRADES = [  # one finished carry pair (R = return on capital) and one flip trade, to prove they are kept apart
    {"coin": "SOL", "side": "carry", "kind": "carry", "tier": "C", "mode": "paper", "opened": iso(T0 + 3 * H), "closed": iso(T0 + 2 * DAY + 15 * 60),
     "entry": 141.23, "exit": None, "notional": 101.17, "risk_amt": 151.76, "pnl": 0.1821, "R": 0.0012, "fees": 0.1133,
     "funding": -0.2954, "gross": 0.0, "reason": "funding below exit", "hours": 45, "capture": 0.62, "book": "carry", "rel_R": None},
    {"coin": "AVAX", "side": "long", "kind": "flip", "tier": "A", "mode": "paper", "opened": iso(T0 + 4 * H), "closed": iso(T0 + 30 * H),
     "entry": 30.1, "exit": 31.6, "notional": 211.19, "risk_amt": 10.07, "pnl": 5.0351, "R": 0.5, "fees": 0.1911, "funding": 0.0377,
     "gross": 5.2639, "reason": "stop", "hours": 26, "book": "solana", "rel_R": 0.1},
]
CARRY_MONEY = [m for m in CARRY_EQ + [CARRY_POS[c][k] for c in CARRY_POS for k in ("capital", "funding_income", "theo_funding", "fees", "target_n")]
               + [CARRY_POS[c][k] for c in CARRY_POS for k in ("spot_pnl", "perp_pnl") if k in CARRY_POS[c]]
               + [x[k] for x in CARRY_TRADES for k in ("notional", "risk_amt", "pnl", "fees", "funding")] if m]


def carry_readings():
    return [{"coin": c, "book": "carry", "weekly": None, "daily": None, "h4": None, "range": None, "line": None, "close": None, "trigger": None,
             "why": "funding 10.9%/yr (24h mean)", "vol_m": 82.6, "funding_pct": apr, "days": None, "mark": 30.9}
            for c, apr in (("PUMP", 28.31), ("XPL", 11.04), ("ETH", 9.87), ("ZEC", 12.5), ("HYPE", -0.2), ("BTC", 10.66))]


def carry_tree(root, now=CARRY_NOW, carry_cfg=None):
    s = settings(strategy="carry", trigger_tf="1h", btc_gate=False, data={"late_run_minutes": 50},
                 carry=dict({"basket": list(CARRY_POS), "max_unhedged_hours": 3}, **(carry_cfg or {})))
    pump_open = CARRY_POS["PUMP"]["opened_ts"]
    runs = [run_doc(pump_open, ["PUMP: carry ENTERING · funding 34.9%/yr · 17% of pot per leg, maker orders resting"],
                    positions=["PUMP"], counts={"evaluated": 6, "triggers": 0, "refused": 0, "proposed": 0, "entered": 1}),
            run_doc(T0 + 12 * H + 15 * 60, ["HYPE: carry EXITING · funding -0.2%/yr below exit"]),
            run_doc(T0 + 2 * DAY + 15 * 60, ["SOL: carry CLOSED · +0.02% of pot · capture 62%"])]
    t = now // H * H - 6 * H
    while t <= now - 10 * 60:                                  # the last few hourly checks before now
        runs.append(run_doc(t + 7 * 60, ["ZEC: carry safety override · legs out of balance for 3h, lagging leg completed at market"]
                            if t == now // H * H - 6 * H else [], positions=list(CARRY_POS), readings=carry_readings()))
        t += H
    eq = [(T0 + 2 * H, CARRY_EQ[0]), (T0 + DAY, CARRY_EQ[1]), (now - 900, CARRY_EQ[2])]
    return write_tree(root, s, runs, CARRY_POS, CARRY_TRADES, eq)


# --------------------------------------------------------------------------------------------------- target --
A01_LINES = ["BTC weekly Bullish · daily Bullish · data 127 min after the bar close"] + [
    f"{c}: target {t}% of pot, holding {h}% → {a}" for c, t, h, a in (
        ("AAVE", 0, 0, "none"), ("ADA", 0, 0, "none"), ("AVAX", 0, 0, "none"), ("BNB", 0, 0, "none"), ("BTC", 0, 0, "none"),
        ("DOGE", 0, 0, "none"), ("ETH", 0, 0, "none"), ("LINK", 0, 0, "none"), ("LTC", 12, 12, "hold"), ("NEAR", 6, 7, "hold"),
        ("SOL", 0, 0, "none"), ("UNI", 7, 7, "hold"), ("XRP", 0, 0, "none"))] + [
    "evaluated 13 names · 0 triggers · 0 refused · 0 proposed · 0 entered · 3 open"]
TARGET_POT = 1002.11
TARGET_OPEN = T0 + 22 * 60                             # opened at the first daily check
TARGET_NOW = TARGET_OPEN + 10 * DAY                    # beyond the 7-day events window


def _tpos(coin, entry, notional, mark):
    return {"coin": coin, "side": "long", "kind": "target", "tier": "T", "mode": "paper", "entry": entry, "stop": entry * 0.8,
            "initial_stop": entry * 0.8, "notional": notional, "sz": notional / entry, "risk_amt": notional * 0.2, "leverage": 3,
            "entry_fee": 0.0531, "funding_paid": 0.0119, "opened": iso(TARGET_OPEN), "opened_ts": TARGET_OPEN, "book": "trend", "mark": mark}


TARGET_POS = {"LTC": _tpos("LTC", 81.37, 120.31, 82.1), "NEAR": _tpos("NEAR", 2.913, 70.17, 2.95), "UNI": _tpos("UNI", 7.311, 70.29, 7.2)}


def target_tree(root, now=TARGET_NOW, positions=True, trades=()):
    s = settings(strategy="target", trigger_tf="1d", btc_gate=False, data={"late_run_minutes": 180})
    runs = [run_doc(TARGET_OPEN, ["LTC: ENTERED LTC long [trend] · target tier T · stop 65.1 (20.0% away)"], positions=list(TARGET_POS))]
    t = TARGET_OPEN + DAY
    while t <= now - 3600:
        runs.append(run_doc(t, A01_LINES, positions=list(TARGET_POS) if positions else []))
        t += DAY
    eq = [(TARGET_OPEN, TARGET_POT), (now - 7200, TARGET_POT * 1.005)]
    return write_tree(root, s, runs, TARGET_POS if positions else {}, trades, eq)


# ----------------------------------------------------------------------------------------------------- beat --
BEAT_TOP = T0 + 2 * DAY                                # the newest hourly slot
BEAT_S0 = BEAT_TOP - 23 * H
BOUGHT = "LINK: ENTERED LINK long [eth-defi] · flip tier A · stop 12.8 (2.81% away)"
SOLD = "LINK [eth-defi]: closed on stop at 13.1 → -1.02 R"


def beat_tree(root, now):
    """Slots from the oldest: 3 before the first run, then fresh, missed, failed only, late, bought (fresh), sold (late),
    then fresh checks up to the slot before BEAT_TOP, which gets no run (so it is dropped while not owed yet)."""
    s = settings(trigger_tf="1h", data={"late_run_minutes": 35})
    runs = []
    for i in range(3, 23):
        S = BEAT_S0 + i * H
        if i == 4:
            continue                                                    # missed
        if i == 5:
            runs.append(run_doc(S + 12 * 60, failed=True))
        elif i == 6:
            runs.append(run_doc(S + 52 * 60, fresh=False))              # ran late
        elif i == 7:
            runs.append(run_doc(S + 14 * 60, [BOUGHT], positions=["LINK"]))
        elif i == 8:
            runs.append(run_doc(S + 50 * 60, [SOLD], fresh=False))
        else:
            runs.append(run_doc(S + 14 * 60))
    eq = [(BEAT_S0 + 3 * H, 1011.13), (BEAT_TOP - 600, 1009.87)]
    return write_tree(root, s, runs, {}, (), eq)
