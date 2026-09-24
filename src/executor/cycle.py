"""cycle.py — one pass of the loop, run five minutes after every 4-hour close.

Order of work, and why: expire stale proposals; manage exits on open positions (exits never wait for
anyone); reconcile the ledger with the exchange in live mode; then, and only then, look for entries.
Every refusal is written down with its reasons. The model is nowhere in this file.
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
        return False, "no 4-hour bars"
    T = h4[-1].get("T") or (h4[-1]["t"] + C.BAR_SECONDS)
    late = (now_ts - T) / 60
    if late < 0:
        return False, "last bar has not closed"
    if late > s["data"]["late_run_minutes"]:
        return False, f"run started {late:.0f} min after the bar close, limit {s['data']['late_run_minutes']}"
    return True, f"{late:.0f} min after the bar close"


class Bars:
    def __init__(self, s):
        self.s, self.cache = s, {}

    def get(self, coin):
        if coin not in self.cache:
            d = H.candles(coin, "1d", self.s["data"]["candle_days_daily"])
            h = H.candles(coin, "4h", self.s["data"]["candle_days_4h"])
            self.cache[coin] = (d, h)
        return self.cache[coin]


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

    def say(self, line):
        self.summary.append(line)
        C.log("  " + line)

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
    def close_position(self, coin, pos, px, reason, ts):
        bench_exit = self.marks.get(pos.get("benchmark") or "")
        if self.mode == "paper":
            fee = PA.exit_fee(pos, px, self.s)
            rec = L.record_close(pos, px, reason, ts, fee, pos.get("funding_paid", 0.0), bench_exit)
            self.pot["cash"] += rec["gross"] - fee - pos.get("funding_paid", 0.0)
        else:
            if pos.get("stop_cloid"):
                try:
                    LV.cancel(self.ex, coin, LV.cloid_from(pos["stop_cloid"]))
                except Exception as e:  # noqa: BLE001
                    self.say(f"{coin}: stop cancel failed ({str(e)[:80]}); continuing to close")
            resp = LV.close_market(self.ex, coin, pos["sz"], LV.new_cloid())
            avg, detail = LV.fill_from_response(resp)
            if avg is None:
                self.say(f"{coin}: close NOT filled ({detail}); position kept, will retry next cycle")
                C.notify("Executor: close failed", f"{coin} {reason}: {detail}")
                return None
            px = avg
            fee = pos["sz"] * px * self.s["fee_taker_pct"] / 100
            rec = L.record_close(pos, px, reason, ts, fee, pos.get("funding_paid", 0.0), bench_exit)
        del self.positions[coin]
        rel = f" · {rec['rel_R']:+.2f} R vs {pos.get('benchmark')}" if rec.get("rel_R") is not None else ""
        self.say(f"{coin} [{pos.get('book')}]: closed on {reason} at {px:.5g} → {rec['R']:+.2f} R{rel}")
        C.notify("Executor: closed", f"{coin} ({pos.get('book')}) on {reason}: {rec['R']:+.2f} R{rel} after {rec['hours']:.0f}h")
        self.maybe_sweep(pos, rec, ts)
        return rec

    def maybe_sweep(self, pos, rec, ts):
        """Book policy: a realised gain is earmarked for the book's benchmark while that benchmark's weekly is bullish."""
        _name, book = C.book_of(pos["coin"])
        if not book or not book["sweep"] or rec["pnl"] <= 0:
            return
        bench = book["benchmark"]
        try:
            d, h = self.bars.get(bench)
            ctx = R.context(d, h, self.now, self.s["indicators"])
        except Exception:  # noqa: BLE001
            return
        if ctx["weekly_dir"] == -1 and self.equity > 0:
            L.record_sweep_intent(pos.get("book"), bench, rec["pnl"] / self.equity * 100, ts)
            self.say(f"{pos['coin']}: gain earmarked for {bench} ({rec['pnl'] / self.equity * 100:.2f}% of pot); execution is a later version")

    def manage_exits(self):
        for coin, pos in list(self.positions.items()):
            d, h = self.bars.get(coin)
            ctx = R.context(d, h, self.now, self.s["indicators"])
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
                    continue
            if ctx["weekly_dir"] != -1 or ctx["daily_dir"] != -1 or (ctx["h4"] and ctx["h4"]["dir"] == 1):
                reason = ("weekly flip" if ctx["weekly_dir"] != -1 else "daily flip" if ctx["daily_dir"] != -1 else "4h flip")
                mark = self.marks.get(coin)
                if mark and not self.dry:
                    self.close_position(coin, pos, mark * (1 - self.s["paper_slippage_pct"] / 100) if self.mode == "paper" else mark, reason, self.now)
                continue
            h4 = ctx["h4"]
            if h4 and h4["dir"] == -1 and h4["line"] and h4["line"] > pos["stop"]:
                new_stop = h4["line"]
                if self.mode == "live" and not self.dry:
                    self.replace_stop(coin, pos, new_stop)
                else:
                    pos["stop"] = new_stop
                self.say(f"{coin}: stop trailed to {new_stop:.5g}")

    def replace_stop(self, coin, pos, new_stop):
        row = self.ctxs.get(coin, {})
        szd = int(row.get("szDecimals", 3))
        cl = LV.new_cloid()
        stop_px = H.round_px(new_stop, szd)
        worst = H.round_px(new_stop * 0.97, szd)
        LV.place_stop(self.ex, coin, H.round_sz(pos["sz"], szd), stop_px, worst, cl)
        if pos.get("stop_cloid"):
            try:
                LV.cancel(self.ex, coin, LV.cloid_from(pos["stop_cloid"]))
            except Exception as e:  # noqa: BLE001
                self.say(f"{coin}: old stop cancel failed ({str(e)[:80]})")
        pos["stop"], pos["stop_cloid"] = stop_px, LV.raw(cl)

    # ----------------------------------------------------- reconciliation --
    def reconcile(self):
        self.rec_flags = {}
        if self.mode != "live":
            return
        # a position the exchange no longer holds means the resident stop fired: record it from fills
        for coin, pos in list(self.positions.items()):
            if coin not in self.exch_pos:
                px = self.exit_price_from_fills(coin, pos)
                if px:
                    fee = pos["sz"] * px * self.s["fee_taker_pct"] / 100
                    rec = L.record_close(pos, px, "stop (exchange)", self.now, fee, pos.get("funding_paid", 0.0), self.marks.get(pos.get("benchmark") or ""))
                    del self.positions[coin]
                    self.say(f"{coin}: exchange stop fired at {px:.5g} → {rec['R']:+.2f} R")
                    C.notify("Executor: stop fired", f"{coin}: {rec['R']:+.2f} R")
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
    def execute_entry(self, cand, sizing, mark, ctx):
        coin = cand["coin"]
        context = {"btc_weekly": R.label(self.btc["weekly_dir"]), "pair_weekly": R.label(ctx["weekly_dir"]),
                   "pair_daily": R.label(ctx["daily_dir"]), "h4_range": cand.get("range"),
                   "funding_annual_pct": H.funding_annual_pct(self.ctxs.get(coin, {})), "hours_mode": self.hours_mode}
        rules = ["LOGIC v1.1", f"trigger:{cand['kind']}", f"tier:{cand['tier']}", "stop:4h-line", "long-only", f"book:{cand.get('book')}"]
        if self.mode == "paper":
            pos = PA.open_position(cand, sizing, mark, self.s, self.now, "paper", context, rules)
            self.pot["cash"] -= pos["entry_fee"]
        else:
            row = self.ctxs[coin]
            szd = int(row.get("szDecimals", 3))
            LV.set_isolated_leverage(self.ex, coin, sizing["leverage"])
            sz = H.round_sz(sizing["notional"] / mark, szd)
            cap = H.round_px(mark * (1 + self.s["entry_slippage_cap_pct"] / 100), szd)
            ecl = LV.new_cloid()
            resp = LV.entry_ioc(self.ex, coin, sz, cap, ecl)
            avg, detail = LV.fill_from_response(resp)
            if avg is None:
                self.say(f"{coin}: entry not filled ({detail})")
                L.record_refusal(cand, f"IOC entry not filled: {detail}", self.now, "execution")
                return None
            pos = PA.open_position(cand, sizing, avg, self.s, self.now, "live", context, rules)
            pos.update({"entry": avg, "sz": sz, "notional": avg * sz, "entry_cloid": LV.raw(ecl), "entry_fee": avg * sz * self.s["fee_taker_pct"] / 100})
            self.replace_stop(coin, pos, cand["stop"])
        self.positions[coin] = pos
        self.say(f"{coin}: ENTERED {describe(cand, sizing)}")
        C.notify("Executor: entered", describe(cand, sizing))
        return pos

    def find_entries(self):
        books = C.books()
        for book_name, book in books.items():
            for coin in book["names"]:
                self.find_entry(coin, book_name, book)

    def find_entry(self, coin, book_name, book):
        if True:
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
            ctx = R.context(d, h, self.now, self.s["indicators"])
            cand, _why = S.evaluate(coin, ctx, self.btc_bull)
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
                                  "trigger": (cand["kind"] + " tier " + cand["tier"]) if cand else None, "why": None if cand else _why[0],
                                  "vol_m": vol_m, "funding_pct": H.funding_annual_pct(row), "days": ctx["days"], "mark": self.marks.get(coin)})
            if self.verbose:
                h4 = ctx.get("h4") or {}
                fa = H.funding_annual_pct(row)
                self.say(f"{coin} [{book_name}]: W {R.label(ctx['weekly_dir'])} · D {R.label(ctx['daily_dir'])} · 4h {R.label(h4.get('dir'))} "
                         f"{h4.get('range') or ''} · {cand['kind'] + ' tier ' + cand['tier'] if cand else _why[0]} · "
                         f"vol {float(row.get('dayNtlVlm', 0)) / 1e6:.0f}M · funding {fa if fa is None else round(fa, 1)}%/yr · {ctx['days']}d history")
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
            sizing = K.size(self.equity, worst_entry, cand["stop"], self.s, row.get("maxLeverage"), self.thr["multiplier"])
            flags = {"halt": self.halt, "halt_reason": self.halt_reason, "throttle_halt": self.thr["halt"],
                     "drawdown_pct": self.thr["drawdown_pct"], "fresh": self.fresh, "fresh_detail": self.fresh_detail,
                     "sanity_ok": sanity_ok, "sanity_detail": sanity_detail, "universe_ok": u_ok, "universe_reasons": u_reasons,
                     "book_cap_pct": book.get("open_risk_cap_pct")}
            flags.update(self.rec_flags)
            ok, checks = K.pre_trade(cand, sizing, self.positions, self.equity, self.s, flags)
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
                why = ("dry run" if self.dry else "online hours: approval required" if self.hours_mode == "approval"
                       else f"tier {cand['tier']} always needs approval")
                exp = HR.next_bar_close(self.now, C.BAR_SECONDS)
                if self.dry:
                    self.say(f"{coin}: would PROPOSE {P.new_id(coin, cand['kind'], self.now)} ({why}) · {describe(cand, sizing)}")
                    return
                doc = P.create(cand, sizing, checks, exp, why, mark, self.mode)
                self.counts["proposed"] += 1
                self.say(f"{coin}: PROPOSED {doc['id']} ({why}), expires {doc['expires']}")
                C.notify("Executor: approval needed", f"{describe(cand, sizing)} · id {doc['id']} · expires {doc['expires'][11:16]} UTC")

    # -------------------------------------------------------------- run ---
    def run(self):
        C.log(f"cycle {C.iso(self.now)} · mode {self.mode} · hours {self.hours_mode} ({self.local.strftime('%H:%M %Z')}) · dry {self.dry}")
        if self.mode_note:
            self.say(self.mode_note)
            C.notify("Executor: running paper instead of live", self.mode_note)
        if self.halt:
            self.say(f"HALT set: {self.halt_reason} (exits still managed, no entries)")
        self.load_market()
        self.load_account()
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
        c = self.counts
        self.say(f"evaluated {c['evaluated']} names · {c['triggers']} triggers · {c['refused']} refused · {c['proposed']} proposed · {c['entered']} entered · {len(self.positions)} open")
        if self.mode == "paper":
            self.equity, self.unreal = PA.equity(self.pot, self.positions, self.marks)
            if not self.dry:
                PA.save_pot(self.pot)
        for coin, pos in self.positions.items():
            m = self.marks.get(coin)
            if m and pos.get("entry"):
                pos["mark"], pos["upnl_pct"] = m, (m / pos["entry"] - 1) * 100
        if not self.dry:
            L.save_positions(self.positions, self.mode)
            L.equity_point(self.now, self.equity, self.cash if self.mode == "live" else self.pot["cash"], self.unreal, self.mode)
        run_doc = {"t": C.iso(self.now), "mode": self.mode, "hours": self.hours_mode, "dry": self.dry, "fresh": self.fresh,
                   "btc_weekly": R.label(self.btc["weekly_dir"]), "btc_daily": R.label(self.btc["daily_dir"]),
                   "positions": sorted(self.positions), "open_proposals": [p["id"] for p in P.open_proposals()],
                   "throttle": self.thr, "halt": self.halt, "counts": self.counts, "summary": self.summary,
                   "readings": self.readings, "equity": self.equity, "hours_local": self.local.strftime("%H:%M %Z")}
        if not self.dry:
            C.write_json(C.STATE / "runs" / "last_run.json", run_doc)
            C.append_jsonl(C.STATE / "runs" / f"{C.iso(self.now)[:10]}.jsonl", run_doc)
            L.render_markdown(self.positions, self.summary, self.mode)
            if self.local.hour == self.s.get("daily_summary_local_hour", 8) and self.hours_mode in ("approval", "auto"):
                pts = L.equity_points(self.mode)
                day_ago = [p for p in pts if p["ts"] <= self.now - 86400]
                chg = f"{(self.equity / day_ago[-1]['equity'] - 1) * 100:+.2f}% on the day" if day_ago and day_ago[-1]["equity"] else "no prior day"
                C.notify("Executor: daily", f"{self.mode} · BTC weekly {R.label(self.btc['weekly_dir'])} · {len(self.positions)} open · "
                                            f"{len(P.open_proposals())} awaiting approval · pot {chg} · drawdown {self.thr['drawdown_pct']:.1f}%")
        return run_doc
