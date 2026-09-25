"""cycle.py — one pass of the loop, run five minutes after every 4-hour close.

Order of work, and why: absorb positions the exchange already closed (a resident stop fired), so nothing
below acts on a position that no longer exists; expire stale proposals; manage exits on open positions
(exits never wait for anyone, and each position is handled on its own so one failure cannot stop the
others); reconcile the ledger with the exchange in live mode; then, and only then, look for entries.

State is written through after every open, close and trail, so a crash between two steps can never make
the ledger and the positions file disagree. A reading of "no data" on any timeframe keeps a position and
its stop exactly as they are; only an explicit bearish reading closes. In live mode a close happens before
its stop is cancelled, and a fresh fill is recorded and protected before anything else can fail. Every
refusal is written down with its reasons. The model is nowhere in this file.
"""
import time
from . import common as C, hl_data as H, binance_data as B, regime as R, signals as S, universe as U
from . import risk as K, hours as HR, proposals as P, ledger as L, paper as PA, live as LV

HALT = C.STATE / "HALT"


def resolve_mode(s):
    mode = s.get("mode", "paper")
    if mode == "live":
        key, addr = LV.creds()
        if not key or not addr:
            return "paper", "live requested but HL_AGENT_KEY / HL_ACCOUNT_ADDRESS missing: running paper"
        if not LV.available():
            return "paper", "live requested but the exchange SDK is not installed: running paper"
    return mode, ""


def freshness(h4, now_ts, s):
    if not h4:
        return False, "no trigger bars"
    T = h4[-1].get("T") or (h4[-1]["t"] + C.bar_seconds(s))
    late = (now_ts - T) / 60
    if late < 0:
        return False, "last bar has not closed"
    if late > s["data"]["late_run_minutes"]:
        return False, f"run started {late:.0f} min after the bar close, limit {s['data']['late_run_minutes']}"
    return True, f"{late:.0f} min after the bar close"


def bearish(d):
    return d == 1


def no_reading(d):
    return d is None


class Bars:
    """Candles per coin: daily, the trigger timeframe, and 4-hour gate bars when the trigger is 1-hour."""
    def __init__(self, s):
        self.s, self.cache, self.gates = s, {}, {}
        self.tf = C.trigger_tf(s)

    def get(self, coin):
        if coin not in self.cache:
            d = H.candles(coin, "1d", self.s["data"]["candle_days_daily"])
            days = self.s["data"].get("candle_days_trigger", self.s["data"]["candle_days_4h"]) if self.tf != "4h" else self.s["data"]["candle_days_4h"]
            h = H.candles(coin, self.tf, days)
            self.cache[coin] = (d, h)
        return self.cache[coin]

    def gate(self, coin):
        if self.tf == "4h":
            return None
        if coin not in self.gates:
            self.gates[coin] = H.candles(coin, "4h", self.s["data"]["candle_days_4h"])
        return self.gates[coin]

    def context(self, coin, now, ind):
        d, h = self.get(coin)
        return R.context(d, h, now, ind, self.gate(coin))


def describe(cand, sizing):
    return (f"{cand['coin']} long [{cand.get('book', '?')}] · {cand['kind']} tier {cand['tier']} · stop {cand['stop']:.5g} "
            f"({sizing.get('dist_pct', 0):.1f}% away) · size {sizing.get('notional_pct_equity', 0):.1f}% of pot at "
            f"{sizing.get('leverage', '?')}x · risk {sizing.get('risk_pct', 0):.2f}% of pot")


class Cycle:
    def __init__(self, dry=False, verbose=False):
        self.dry, self.verbose = dry, verbose
        self.counts = {"evaluated": 0, "triggers": 0, "refused": 0, "proposed": 0, "entered": 0}
        self.readings = []
        self.s = C.settings()
        self.now = C.now_ts()
        self.summary = []
        self.mode, self.mode_note = resolve_mode(self.s)
        self.hours_mode, self.local = HR.mode(self.s)
        self.halt = HALT.exists()
        self.halt_reason = HALT.read_text().strip() if self.halt else ""
        self.bars = Bars(self.s)
        self.ex = self.info = self.addr = None
        self.pot = None
        self.positions, self.marks, self.ctxs, self.exch_pos, self.rec_flags = {}, {}, {}, {}, {}
        self.btc = {"weekly_dir": None, "daily_dir": None}
        self.fresh, self.fresh_detail, self.btc_bull = False, "not loaded", False
        self.equity = self.unreal = self.cash = None
        self.thr = K.throttle([], self.s["throttle"])
        self.failed = False
        self.run_doc = None

    def say(self, line):
        self.summary.append(line)
        C.log("  " + line)

    def persist(self):
        """Write-through: the positions file and the paper pot after every change."""
        if self.dry:
            return
        if self.mode == "paper" and self.pot is not None:
            PA.save_pot(self.pot)
        L.save_positions(self.positions, self.mode)

    # ------------------------------------------------------------ market --
    def load_market(self):
        self.ctxs = H.meta_and_ctxs()
        self.marks = {k: float(v["markPx"]) for k, v in self.ctxs.items() if v.get("markPx")}
        btc_d, btc_h = self.bars.get("BTC")
        self.btc = R.context(btc_d, btc_h, self.now, self.s["indicators"])
        self.fresh, self.fresh_detail = freshness(btc_h, self.now, self.s)
        self.btc_bull = self.btc["weekly_dir"] == -1
        self.say(f"BTC weekly {R.label(self.btc['weekly_dir'])} · daily {R.label(self.btc['daily_dir'])} · data {self.fresh_detail}")

    # ---------------------------------------------------------- accounts --
    def load_account(self):
        self.positions = L.positions(self.mode)
        if self.mode == "paper":
            self.pot = PA.pot(self.s) if not self.dry else (C.load_json(PA.POT) or {"cash": float(self.s["pot_usd_paper"]), "start": float(self.s["pot_usd_paper"])})
            self.equity, self.unreal = PA.equity(self.pot, self.positions, self.marks)
            self.cash = self.pot["cash"]
        else:
            self.ex, self.info, self.addr = LV.clients()
            self.equity, self.exch_pos, _ = LV.account(self.addr)
            self.cash, self.unreal = self.equity, 0.0
        pts = L.equity_points(self.mode) + [{"equity": self.equity}]
        self.thr = K.throttle(pts, self.s["throttle"])

    # ------------------------------------------------------------- exits --
    def _record_close(self, coin, pos, px, reason, ts, fee):
        """Remove the position and persist FIRST, then append the trade: a crash in between loses one ledger
        line (recoverable from the run log) instead of closing the same position twice."""
        bench_exit = self.marks.get(pos.get("benchmark") or "")
        rec = L.build_close(pos, px, reason, ts, fee, pos.get("funding_paid", 0.0), bench_exit)
        self.positions.pop(coin, None)
        if self.mode == "paper":
            self.pot["cash"] += rec["gross"] - fee - pos.get("funding_paid", 0.0)
        self.persist()
        if not self.dry:
            L.append_trade(rec)
        rel = f" · {rec['rel_R']:+.2f} R vs {pos.get('benchmark')}" if rec.get("rel_R") is not None else ""
        self.say(f"{coin} [{pos.get('book')}]: closed on {reason} at {px:.5g} → {rec['R']:+.2f} R{rel}")
        C.notify("Executor: closed", f"{coin} ({pos.get('book')}) on {reason}: {rec['R']:+.2f} R{rel} after {rec['hours']:.0f}h")
        self.maybe_sweep(pos, rec, ts)
        return rec

    def close_position(self, coin, pos, px, reason, ts):
        if self.mode == "live":
            # close FIRST; the resident stop stays on the exchange until the close is confirmed
            try:
                resp = LV.close_market(self.ex, coin, None, LV.new_cloid())
                avg, second = LV.fill_from_response(resp)
            except Exception as e:  # noqa: BLE001
                avg, second = None, str(e)[:160]
            if avg is None:
                self.say(f"{coin}: close NOT filled ({second}); position and its resident stop kept, retry next cycle")
                C.notify("Executor: close failed", f"{coin} {reason}: {second}")
                return None
            px = avg
            fee = pos["sz"] * px * self.s["fee_taker_pct"] / 100
            if pos.get("stop_cloid"):
                try:
                    LV.cancel(self.ex, coin, LV.cloid_from(pos["stop_cloid"]))
                except Exception as e:  # noqa: BLE001
                    self.say(f"{coin}: leftover stop cancel failed ({str(e)[:80]}); harmless once flat, reconcile will report it")
        else:
            fee = PA.exit_fee(pos, px, self.s)
        return self._record_close(coin, pos, px, reason, ts, fee)

    def maybe_sweep(self, pos, rec, ts):
        """Book policy: a realised gain is earmarked for the book's benchmark while that benchmark's weekly is bullish."""
        _name, book = C.book_of(pos["coin"])
        if not book or not book["sweep"] or rec["pnl"] <= 0 or self.dry:
            return
        bench = book["benchmark"]
        try:
            ctx = self.bars.context(bench, self.now, self.s["indicators"])
        except Exception:  # noqa: BLE001
            return
        if ctx["weekly_dir"] == -1 and self.equity and self.equity > 0:
            L.record_sweep_intent(pos.get("book"), bench, rec["pnl"] / self.equity * 100, ts)
            self.say(f"{pos['coin']}: gain earmarked for {bench} ({rec['pnl'] / self.equity * 100:.2f}% of pot); execution is a later version")

    def absorb_exchange_closes(self):
        """Live only, before anything else: a ledger position the exchange no longer holds means the resident
        stop fired. Record it from the account's fills so no later step acts on a ghost position."""
        if self.mode != "live":
            return
        for coin, pos in list(self.positions.items()):
            if coin in self.exch_pos:
                continue
            px = self.exit_price_from_fills(coin, pos)
            if px is None:
                self.say(f"{coin}: not on the exchange and no sell fill found; left for reconcile to report")
                continue
            fee = pos["sz"] * px * self.s["fee_taker_pct"] / 100
            self._record_close(coin, pos, px, "stop (exchange)", self.now, fee)

    def manage_exits(self):
        for coin, pos in list(self.positions.items()):
            try:
                self.manage_exit(coin, pos)
            except Exception as e:  # noqa: BLE001 — one position's failure must not stop the others
                self.say(f"{coin}: exit management failed ({type(e).__name__}: {str(e)[:100]}); position kept"
                         + (", resident stop still on the exchange" if self.mode == "live" else ""))
                C.notify("Executor: exit check failed", f"{coin}: {type(e).__name__}: {str(e)[:200]}")
        self.persist()   # funding accrual and paper stop-check cursors

    def manage_exit(self, coin, pos):
        d, h = self.bars.get(coin)
        ctx = self.bars.context(coin, self.now, self.s["indicators"])
        row = self.ctxs.get(coin, {})
        if self.mode == "paper":
            try:
                PA.accrue_funding(pos, float(row.get("funding", 0) or 0), self.now)
            except (TypeError, ValueError):
                pass
            px, bt = PA.check_stop(pos, h, self.s)
            if px is not None:
                if not self.dry:
                    self.close_position(coin, pos, px, "stop", bt or self.now)
                return
        h4 = ctx.get("h4") or {}
        if no_reading(ctx.get("weekly_dir")) or no_reading(ctx.get("daily_dir")) or no_reading(h4.get("dir")) or ("gate4h" in ctx and no_reading(ctx["gate4h"])):
            self.say(f"{coin}: no reading on one timeframe (data gap); position and stop kept as they are")
            return
        g4 = ctx.get("gate4h")
        if bearish(ctx["weekly_dir"]) or bearish(ctx["daily_dir"]) or bearish(g4) or bearish(h4["dir"]):
            reason = ("weekly flip" if bearish(ctx["weekly_dir"]) else "daily flip" if bearish(ctx["daily_dir"])
                      else "4h flip" if (bearish(g4) or self.bars.tf == "4h") else f"{self.bars.tf} flip")
            mark = self.marks.get(coin)
            if not mark:
                self.say(f"{coin}: {reason} but no mark price; position kept until the next cycle")
            elif not self.dry:
                self.close_position(coin, pos, mark * (1 - self.s["paper_slippage_pct"] / 100) if self.mode == "paper" else mark, reason, self.now)
            return
        if h4.get("line") and h4["line"] > pos["stop"]:
            new_stop = h4["line"]
            if self.mode == "live" and not self.dry:
                self.replace_stop(coin, pos, new_stop)       # raises on rejection: the old stop then stays
            else:
                pos["stop"] = new_stop
                self.persist()
            self.say(f"{coin}: stop trailed to {new_stop:.5g}")

    def replace_stop(self, coin, pos, new_stop):
        """Place the new resident stop, confirm the exchange accepted it, persist, then cancel the old one."""
        row = self.ctxs.get(coin, {})
        szd = int(row.get("szDecimals", 3))
        cl = LV.new_cloid()
        stop_px = H.round_px(new_stop, szd)
        worst = H.round_px(new_stop * 0.97, szd)
        resp = LV.place_stop(self.ex, coin, H.round_sz(pos["sz"], szd), stop_px, worst, cl)
        ok, detail = LV.order_ok(resp)
        if not ok:
            raise RuntimeError(f"stop order rejected: {detail}")
        old = pos.get("stop_cloid")
        pos["stop"], pos["stop_cloid"] = stop_px, LV.raw(cl)
        self.persist()
        if old:
            try:
                LV.cancel(self.ex, coin, LV.cloid_from(old))
            except Exception as e:  # noqa: BLE001
                self.say(f"{coin}: old stop cancel failed ({str(e)[:80]}); two stops rest, the second is rejected as reduce-only when it triggers")

    # ----------------------------------------------------- reconciliation --
    def reconcile(self):
        self.rec_flags = {}
        if self.mode != "live":
            return
        r = LV.reconcile(self.positions, self.addr)
        if not r["ok"]:
            self.rec_flags = {"reconcile_mismatch": True, "reconcile_detail": "; ".join(r["problems"])}
            self.say("RECONCILIATION MISMATCH: " + "; ".join(r["problems"]))
            C.notify("Executor: reconciliation mismatch, entries halted", "; ".join(r["problems"])[:900])

    def exit_price_from_fills(self, coin, pos):
        try:
            fills = [f for f in H.user_fills(self.addr) if f.get("coin") == coin and f.get("side") == "A"
                     and int(f.get("time", 0)) // 1000 >= pos["opened_ts"]]
            if not fills:
                return None
            tot = sum(float(f["sz"]) for f in fills)
            return sum(float(f["px"]) * float(f["sz"]) for f in fills) / tot if tot else None
        except Exception:  # noqa: BLE001
            return None

    # ----------------------------------------------------------- entries --
    def recover_entry(self, coin, err):
        """After an exception during an entry: the request may have reached the exchange. Look before
        assuming nothing happened. Returns (avg_px, size) when a long exists, else (None, detail)."""
        try:
            _value, exch, _ = LV.account(self.addr)
        except Exception as e:  # noqa: BLE001
            return None, f"{err}; recovery read failed ({str(e)[:80]})"
        e = exch.get(coin)
        if e and e.get("szi", 0) > 0:
            return e["entryPx"], abs(e["szi"])
        return None, err

    def protect(self, coin, pos, stop):
        """Place the resident stop for a fresh fill; one retry, then close rather than hold unprotected."""
        last = ""
        for _attempt in range(2):
            try:
                self.replace_stop(coin, pos, stop)
                return True
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__}: {str(e)[:100]}"
                time.sleep(2)
        self.say(f"{coin}: could not place the resident stop ({last}); closing the position rather than holding it unprotected")
        C.notify("Executor: stop placement failed, closing", f"{coin}: {last}")
        rec = self.close_position(coin, pos, self.marks.get(coin) or pos["entry"], "no stop possible", self.now)
        if rec is None and not self.dry:
            HALT.write_text(f"{coin} open without a resident stop and the close failed {C.iso()}")
            self.halt, self.halt_reason = True, "unprotected position"
            C.notify("Executor: HALT", f"{coin} is open without a stop and could not be closed; intervene now")
        return False

    def execute_entry(self, cand, sizing, mark, ctx):
        coin = cand["coin"]
        context = {"btc_weekly": R.label(self.btc["weekly_dir"]), "pair_weekly": R.label(ctx["weekly_dir"]),
                   "pair_daily": R.label(ctx["daily_dir"]), "h4_range": cand.get("range"),
                   "funding_annual_pct": H.funding_annual_pct(self.ctxs.get(coin, {})), "hours_mode": self.hours_mode}
        rules = [f"LOGIC v{self.s.get('version', '?')}", f"agent:{C.AGENT}", f"trigger:{cand['kind']}", f"tier:{cand['tier']}", f"stop:{self.bars.tf}-line", "long-only", f"book:{cand.get('book')}"]
        if self.mode == "paper":
            pos = PA.open_position(cand, sizing, mark, self.s, self.now, "paper", context, rules)
            self.pot["cash"] -= pos["entry_fee"]
            self.positions[coin] = pos
            self.persist()
        else:
            row = self.ctxs[coin]
            szd = int(row.get("szDecimals", 3))
            sz = H.round_sz(sizing["notional"] / mark, szd)
            cap = H.round_px(mark * (1 + self.s["entry_slippage_cap_pct"] / 100), szd)
            ecl = LV.new_cloid()
            try:
                LV.set_isolated_leverage(self.ex, coin, sizing["leverage"])
                resp = LV.entry_ioc(self.ex, coin, sz, cap, ecl)
                avg, second = LV.fill_from_response(resp)
            except Exception as e:  # noqa: BLE001
                avg, second = self.recover_entry(coin, f"{type(e).__name__}: {str(e)[:100]}")
            if avg is None:
                self.say(f"{coin}: entry not filled ({second})")
                if not self.dry:
                    L.record_refusal(cand, f"IOC entry not filled: {second}", self.now, "execution")
                return None
            filled_sz = float(second) if isinstance(second, (int, float)) else sz
            pos = PA.open_position(cand, sizing, avg, self.s, self.now, "live", context, rules)
            pos.update({"entry": avg, "sz": filled_sz, "notional": avg * filled_sz, "entry_cloid": LV.raw(ecl),
                        "entry_fee": avg * filled_sz * self.s["fee_taker_pct"] / 100})
            self.positions[coin] = pos
            self.persist()                                     # the fill exists on the exchange: record it first
            if not self.protect(coin, pos, cand["stop"]):
                return None
        self.say(f"{coin}: ENTERED {describe(cand, sizing)}")
        C.notify("Executor: entered", describe(cand, sizing))
        return pos

    def find_entries(self):
        for book_name, book in C.books().items():
            for coin in book["names"]:
                try:
                    self.find_entry(coin, book_name, book)
                except Exception as e:  # noqa: BLE001
                    self.say(f"{coin}: entry check failed ({type(e).__name__}: {str(e)[:100]}); skipped this cycle")

    def find_entry(self, coin, book_name, book):
        if coin in self.positions:
            return
        row = self.ctxs.get(coin)
        if row is None:
            if self.verbose:
                self.say(f"{coin} [{book_name}]: not listed on Hyperliquid perpetuals")
            return
        try:
            d, h = self.bars.get(coin)
        except Exception as e:  # noqa: BLE001
            self.say(f"{coin}: candles unavailable ({str(e)[:80]})")
            return
        ctx = self.bars.context(coin, self.now, self.s["indicators"])
        cand, why = S.evaluate(coin, ctx, self.btc_bull, self.s.get("btc_gate", True))
        self.counts["evaluated"] += 1
        if cand:
            cand.update({"book": book_name, "benchmark": book["benchmark"], "bench_mark": self.marks.get(book["benchmark"])})
        h4r = ctx.get("h4") or {}
        try:
            vol_m = float(row.get("dayNtlVlm", 0)) / 1e6
        except (TypeError, ValueError):
            vol_m = None
        self.readings.append({"coin": coin, "book": book_name, "weekly": R.label(ctx["weekly_dir"]), "daily": R.label(ctx["daily_dir"]),
                              "h4": R.label(h4r.get("dir")), "range": h4r.get("range"), "line": h4r.get("line"), "close": h4r.get("close"),
                              "trigger": (cand["kind"] + " tier " + cand["tier"]) if cand else None, "why": None if cand else why[0],
                              "vol_m": vol_m, "funding_pct": H.funding_annual_pct(row), "days": ctx["days"], "mark": self.marks.get(coin)})
        if self.verbose:
            fa = H.funding_annual_pct(row)
            self.say(f"{coin} [{book_name}]: W {R.label(ctx['weekly_dir'])} · D {R.label(ctx['daily_dir'])} · 4h {R.label(h4r.get('dir'))} "
                     f"{h4r.get('range') or ''} · {cand['kind'] + ' tier ' + cand['tier'] if cand else why[0]} · "
                     f"vol {vol_m if vol_m is None else round(vol_m)}M · funding {fa if fa is None else round(fa, 1)}%/yr · {ctx['days']}d history")
        if not cand:
            return
        self.counts["triggers"] += 1
        mark = self.marks.get(coin)
        if not mark:
            return
        u_ok, u_reasons = U.check(coin, row, self.s["universe"], ctx["days"])
        second = B.last_price(coin)
        if second:
            dev = abs(mark - second) / second * 100
            sanity_ok, sanity_detail = dev <= self.s["data"]["sanity_band_pct"], f"mark vs Binance {dev:.2f}%"
        else:
            sanity_ok, sanity_detail = True, "no second source for this coin"
        worst_entry = mark * (1 + self.s["entry_slippage_cap_pct"] / 100)
        sizing = K.size(self.equity or 0.0, worst_entry, cand["stop"], self.s, row.get("maxLeverage"), self.thr["multiplier"])
        flags = {"halt": self.halt, "halt_reason": self.halt_reason, "throttle_halt": self.thr["halt"],
                 "drawdown_pct": self.thr["drawdown_pct"], "fresh": self.fresh, "fresh_detail": self.fresh_detail,
                 "sanity_ok": sanity_ok, "sanity_detail": sanity_detail, "universe_ok": u_ok, "universe_reasons": u_reasons,
                 "book_cap_pct": book.get("open_risk_cap_pct")}
        flags.update(self.rec_flags)
        ok, checks = K.pre_trade(cand, sizing, self.positions, self.equity or 0.0, self.s, flags)
        if not ok:
            failed = [c for c in checks if not c["ok"]]
            self.counts["refused"] += 1
            if not self.dry:
                L.record_refusal(cand, failed, self.now, "pre-trade")
            self.say(f"{coin}: signal {cand['kind']} tier {cand['tier']} REFUSED: " + "; ".join(f"{c['check']} ({c['detail']})" for c in failed))
            return
        ap = self.s.get("approval", {"mode": "online_hours"})
        if ap.get("mode") == "never":
            if cand["tier"] not in ap.get("auto_tiers", ["A"]):
                self.counts["refused"] += 1
                if not self.dry:
                    L.record_refusal(cand, f"tier {cand['tier']} is not automated and approvals are disabled", self.now, "policy")
                self.say(f"{coin}: signal {cand['kind']} tier {cand['tier']} recorded, not traded (tier not automated)")
                return
            auto = True
        else:
            auto = self.hours_mode == "auto" and cand["tier"] in self.s["offline_auto_tiers"]
        if auto and not self.dry:
            if self.execute_entry(cand, sizing, mark, ctx):
                self.counts["entered"] += 1
        else:
            why_wait = ("dry run" if self.dry else "online hours: approval required" if self.hours_mode == "approval"
                        else f"tier {cand['tier']} always needs approval")
            exp = HR.next_bar_close(self.now, C.bar_seconds(self.s))
            if self.dry:
                self.say(f"{coin}: would PROPOSE {P.new_id(coin, cand['kind'], self.now)} ({why_wait}) · {describe(cand, sizing)}")
                return
            doc = P.create(cand, sizing, checks, exp, why_wait, mark, self.mode)
            self.counts["proposed"] += 1
            self.say(f"{coin}: PROPOSED {doc['id']} ({why_wait}), expires {doc['expires']}")
            C.notify("Executor: approval needed", f"{describe(cand, sizing)} · id {doc['id']} · expires {doc['expires'][11:16]} UTC")

    # -------------------------------------------------------------- run ---
    def run(self):
        C.log(f"cycle {C.iso(self.now)} · mode {self.mode} · hours {self.hours_mode} ({self.local.strftime('%H:%M %Z')}) · dry {self.dry}")
        if self.mode_note:
            self.say(self.mode_note)
            C.notify("Executor: running paper instead of live", self.mode_note)
        if self.halt:
            self.say(f"HALT set: {self.halt_reason} (exits still managed, no entries)")
        try:
            self.load_market()
            self.load_account()
            self.absorb_exchange_closes()
            expired = P.expire_stale(self.now) if not self.dry else []
            for d in expired:
                L.record_refusal(d["candidate"], "proposal expired unapproved", self.now, "proposal")
                self.say(f"{d['candidate']['coin']}: proposal {d['id']} expired unapproved")
            self.manage_exits()
            self.reconcile()
            if self.thr["halt"]:
                self.say(f"THROTTLE HALT: drawdown {self.thr['drawdown_pct']:.1f}% ≥ {self.s['throttle']['halt_at_drawdown_pct']}%; no entries until reviewed")
            elif self.thr["multiplier"] < 1:
                self.say(f"throttle: drawdown {self.thr['drawdown_pct']:.1f}%, risk per trade halved")
            self.find_entries()
        except Exception as e:  # noqa: BLE001
            self.failed = True
            self.say(f"CYCLE ABORTED: {type(e).__name__}: {str(e)[:160]}")
            C.notify("Executor: cycle aborted", f"{type(e).__name__}: {str(e)[:200]}")
        finally:
            self.finish()
        if self.failed:
            raise SystemExit(1)
        return self.run_doc

    def finish(self):
        """Always runs: marks, write-through, the run record, the ledger page, the daily line."""
        c = self.counts
        self.say(f"evaluated {c['evaluated']} names · {c['triggers']} triggers · {c['refused']} refused · {c['proposed']} proposed · {c['entered']} entered · {len(self.positions)} open")
        if self.mode == "paper" and self.pot is not None:
            self.equity, self.unreal = PA.equity(self.pot, self.positions, self.marks)
        for coin, pos in self.positions.items():
            m = self.marks.get(coin)
            if m and pos.get("entry"):
                pos["mark"], pos["upnl_pct"] = m, (m / pos["entry"] - 1) * 100
        if not self.dry and (self.pot is not None or self.mode == "live"):
            self.persist()
            if self.equity is not None:
                L.equity_point(self.now, self.equity, self.cash if self.mode == "live" else self.pot["cash"], self.unreal or 0.0, self.mode)
        self.run_doc = {"t": C.iso(self.now), "agent": C.AGENT, "tf": self.bars.tf, "mode": self.mode, "hours": self.hours_mode, "dry": self.dry, "fresh": self.fresh,
                        "failed": self.failed, "btc_weekly": R.label(self.btc.get("weekly_dir")), "btc_daily": R.label(self.btc.get("daily_dir")),
                        "positions": sorted(self.positions), "open_proposals": [p["id"] for p in P.open_proposals()],
                        "throttle": self.thr, "halt": self.halt, "counts": self.counts, "summary": self.summary,
                        "readings": self.readings, "equity": self.equity, "hours_local": self.local.strftime("%H:%M %Z")}
        if not self.dry:
            C.write_json(C.STATE / "runs" / "last_run.json", self.run_doc)
            C.append_jsonl(C.STATE / "runs" / f"{C.iso(self.now)[:10]}.jsonl", self.run_doc)
            L.render_markdown(self.positions, self.summary, self.mode)
            if not self.failed and self.local.hour == self.s.get("daily_summary_local_hour", 8):
                pts = L.equity_points(self.mode)
                day_ago = [p for p in pts if p["ts"] <= self.now - 86400]
                chg = f"{(self.equity / day_ago[-1]['equity'] - 1) * 100:+.2f}% on the day" if self.equity and day_ago and day_ago[-1]["equity"] else "no prior day"
                C.notify("Executor: daily", f"{self.mode} · BTC weekly {R.label(self.btc.get('weekly_dir'))} · {len(self.positions)} open · "
                                            f"{len(P.open_proposals())} awaiting approval · pot {chg} · drawdown {self.thr['drawdown_pct']:.1f}%")
