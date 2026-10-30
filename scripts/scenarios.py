"""LeyBatt Pulse 2-3 year outlook: scenario model for lithium, copper, aluminium, LFP cathode, cells and the rupee.

Method (all in data/scenarios.json so the page can explain it):
  1. Price model. Each scenario gives an expected price path (from today's price through sourced forecast points).
     The simulated price is that path times a random swing:   log price[t] = path[t] + swing[t],
     swing[t] = (1 - k) * swing[t-1] + shock.   k (how fast a swing fades; shown as a half-life) and the shocks are
     fitted on each material's own monthly history. Shocks are re-drawn from the real historical monthly moves (bootstrap), so the occasional
     big jump is kept. Copper and aluminium draw the same historical month, so they keep their real correlation.
  2. Scenarios only move the target (anchors in data/scenario_config.json, each with a source). Every scenario uses the
     same random draws, so differences between scenarios come only from their assumptions.
  3. Value chain. Lithium, copper and aluminium go through the site's own cost model (data/costmodel.json): LFP cathode,
     the cost to make a 314 Ah storage cell, then the cell price = cost x (1 + makers' margin), with the margin fitted
     on the history of cell prices against modelled cost. The rupee path turns US$ into rupees.
  4. Risk scores for 2 and 3 years: 10 x the chance that the price is at least 25% above today's at that point.
  5. Back-test: the same model re-run from past months, using only data available then, to check how often the real
     price ended up inside the 10-90% range (should be about 80%).
Run:  python3 scripts/scenarios.py
"""
import bisect
import csv
import json
import math
import random
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HIST = DATA / "history"
IST = timezone(timedelta(hours=5, minutes=30))
VAT = 1.13
Q = (0.10, 0.25, 0.50, 0.75, 0.90)


def load(name, default=None):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def d(s):
    return date.fromisoformat(str(s)[:10])


def read_csv(name):
    p = HIST / name
    if not p.exists():
        return []
    with open(p, newline="") as f:
        return list(csv.DictReader(f))


def add_months(dt, n):
    y, m = divmod(dt.month - 1 + n, 12)
    return date(dt.year + y, m + 1, 1)


def month_key(dt):
    return date(dt.year, dt.month, 1)


def quantiles(xs, qs=Q):
    s = sorted(xs)
    n = len(s)
    out = []
    for q in qs:
        i = q * (n - 1)
        lo = int(math.floor(i)); hi = min(n - 1, lo + 1)
        out.append(s[lo] + (s[hi] - s[lo]) * (i - lo))
    return out


def month_end(daily):
    """[(date, value)] daily -> {month_start: last value in that month}"""
    out = {}
    for dt, v in sorted(daily):
        out[month_key(dt)] = v
    return dict(sorted(out.items()))


def month_avg(daily):
    acc = {}
    for dt, v in daily:
        acc.setdefault(month_key(dt), []).append(v)
    return {k: sum(v) / len(v) for k, v in sorted(acc.items())}


# ---------------------------------------------------------------- data
class Data:
    def __init__(self):
        self.fx = sorted((d(r["date"]), float(r["usd_inr"]), float(r["usd_cny"])) for r in read_csv("fx.csv") if r.get("usd_cny"))
        self.fx_dates = [r[0] for r in self.fx]
        li = []
        for r in read_csv("lithium_futures.csv"):
            try:
                dt, cny = d(r["date"]), float(r["cny_t"])
            except (KeyError, ValueError):
                continue
            rate = self.rate(dt, 2)
            if rate and cny > 0:
                li.append((dt, cny / rate))  # site basis: China price incl. VAT, at the day's ECB rate
        self.lithium = sorted(li)
        self.metal = {}
        for m in ("copper", "aluminium"):
            self.metal[m] = sorted((d(r["date"]), float(r["usd_t"])) for r in read_csv(f"{m}.csv") if r.get("usd_t"))
        self.inr = [(dt, inr) for dt, inr, _ in self.fx]
        self.latest = {r["id"]: r for r in (load("latest.json", []) or [])}
        self.raw = {r["material"]: r for r in (load("rawmats.json", []) or [])}
        self.cm = load("costmodel.json", {}) or {}
        self.cell314 = sorted(load("cell314.json", []) or [], key=lambda r: r["date"])
        self.ev = sorted(((load("evcells.json", {}) or {}).get("series", [])), key=lambda r: r["date"])
        self.curve = read_csv("lithium_curve.csv")

    def rate(self, dt, col):
        i = bisect.bisect_right(self.fx_dates, dt) - 1
        return self.fx[i][col] if i >= 0 else None

    @staticmethod
    def num(s):
        return float(re.sub(r"[^\d.]", "", str(s)) or 0)


# ---------------------------------------------------------------- calibration
def fit_reverting(monthly, bounds, default_hl, min_fit=96, scale=1.0):
    """Fit x[t+1]-x[t] = a + b*x[t] on monthly log prices. Returns k, half-life, shocks (centred residuals x scale), note.
    The pull-back speed is only fitted with at least min_fit months of history (short samples overstate it)."""
    xs = [math.log(v) for v in monthly.values()]
    if len(xs) < 13:
        return None
    y = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    x = xs[:-1]
    n = len(y)
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    b = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sxx if sxx else 0.0
    k_hat = -b
    lo, hi = bounds
    k_lo, k_hi = math.log(2) / hi, math.log(2) / lo
    if len(xs) < min_fit:
        k, how = math.log(2) / default_hl, f"{len(xs)} months of history is too short to fit reliably; default half-life {default_hl} months used"
    elif k_hat <= 0:
        k, how = math.log(2) / default_hl, f"history shows no clear pull back (fitted {k_hat:.3f}); default half-life {default_hl} months used"
    elif k_hat < k_lo or k_hat > k_hi:
        k = min(max(k_hat, k_lo), k_hi)
        how = f"fitted half-life {math.log(2) / k_hat:.0f} months, limited to the {lo}-{hi} month range"
    else:
        k, how = k_hat, "fitted on the history"
    mean = sum(xs) / len(xs)
    res = [y[i] - k * (mean - x[i]) for i in range(n)]
    mr = sum(res) / n
    res = [(r - mr) * scale for r in res]
    sd = math.sqrt(sum(r * r for r in res) / (n - 1))
    return {"k": k, "half_life": math.log(2) / k, "shocks": res, "sd": sd, "n": n, "how": how,
            "months": [m.isoformat() for m in list(monthly)[1:]]}


def fit_drift(monthly):
    xs = [math.log(v) for v in monthly.values()]
    y = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    n = len(y)
    mu = sum(y) / n
    sd = math.sqrt(sum((a - mu) ** 2 for a in y) / (n - 1))
    return {"mu": mu, "sd": sd, "shocks": [a - mu for a in y], "n": n, "months": [m.isoformat() for m in list(monthly)[1:]]}


# ---------------------------------------------------------------- targets
def target_path(now, start, months, points, long_run=None):
    """Monthly log target: from today's price, straight lines (in log terms) through the anchor points, flat after."""
    knots = [(start, math.log(now))] + [(d(p["date"]), math.log(p["usd"])) for p in points]
    if long_run:
        knots.append((d(long_run["by"]), math.log(long_run["usd"])))
    knots = sorted(knots)
    out = []
    for t in months:
        if t <= knots[0][0]:
            out.append(knots[0][1]); continue
        if t >= knots[-1][0]:
            out.append(knots[-1][1]); continue
        j = next(i for i in range(1, len(knots)) if knots[i][0] >= t)
        (t0, v0), (t1, v1) = knots[j - 1], knots[j]
        w = (t - t0).days / max(1, (t1 - t0).days)
        out.append(v0 + (v1 - v0) * w)
    return out


def curve_points(D, today):
    """Futures curve -> [{'date', 'usd'}] at mid-month of each contract, if the file is fresh."""
    pts = []
    for r in D.curve:
        try:
            when, close, month = d(r["date"]), float(r["cny_t"]), d(r["month"] + "-15")
        except (KeyError, ValueError):
            continue
        if (today - when).days > 10 or close <= 0 or month <= today:
            continue
        try:
            if float(r.get("volume") or 0) < 100:  # thinly traded months: a stale close is not a market view
                continue
        except ValueError:
            pass
        rate = D.rate(today, 2)
        pts.append({"date": month.isoformat(), "usd": close / rate, "contract": r.get("contract", "")})
    return sorted(pts, key=lambda p: p["date"])


# ---------------------------------------------------------------- cost model (same as the site's calculator)
def cathode_price(cm, li, fepo4):
    return cm.get("lc_per_t_lfp", 0.24) * li + cm.get("fepo4_per_t_lfp", 0.96) * fepo4 + cm["cathode_processing_usd_t"]


def cell_cost(cm, R, li, cu, al, graphite_mult=1.0):
    m = lambda usd_t, kg: usd_t * kg / 1000 / VAT  # noqa: E731
    lc, fe = cm.get("lc_per_t_lfp", 0.24), cm.get("fepo4_per_t_lfp", 0.96)
    mat = (m(li * lc, cm["cathode_kg"]) + m(R["Iron phosphate"] * fe, cm["cathode_kg"]) + m(cm["cathode_processing_usd_t"], cm["cathode_kg"])
           + m(R["Graphite anode"] * graphite_mult, cm["anode_kg"]) + m(R["LFP electrolyte"], cm["electrolyte_kg"])
           + R["Separator"] * cm["separator_m2"] / VAT
           + (cu + cm["cu_foil_fee_usd_t"] / VAT) * cm["cu_foil_kg"] / 1000
           + (al + cm["al_foil_fee_usd_t"] / VAT) * cm["al_foil_kg"] / 1000
           + cm["aux_usd_kwh"] + cm["structural_usd_kwh"])
    return mat / (cm["yield_pct"] / 100) + cm["mfg_usd_kwh"]


# ---------------------------------------------------------------- simulation
def simulate(x0, k, targets, shock_idx, shocks):
    """One path of log prices around the scenario path: price = path x random swing, where the swing fades with
    half-life ln2/k and gets a historical monthly shock each month (shock_idx[t] picks it; a shared index keeps
    correlation). The path starts at today's price, so the swing starts at zero."""
    y, out = x0 - (targets[0] if targets else x0), []
    y = 0.0 if abs(y) < 1e-9 else y
    for t, tg in enumerate(targets):
        y = (1 - k) * y + shocks[shock_idx[t] % len(shocks)]
        out.append(tg + y)
    return out


def summarise(paths, months, now):
    """paths: list of lists (values). Returns monthly quantiles, calendar-year averages and horizon stats."""
    H = len(months)
    bands = [quantiles([p[t] for p in paths]) for t in range(H)]
    years = {}
    for y in sorted({m.year for m in months}):
        idx = [i for i, m in enumerate(months) if m.year == y]
        if len(idx) < 3:
            continue
        avgs = [sum(p[i] for i in idx) / len(idx) for p in paths]
        q = quantiles(avgs)
        years[str(y)] = {"months": len(idx), "p10": q[0], "p50": q[2], "p90": q[4]}
    def at(h):
        if h > H:
            return None
        vals = [p[h - 1] for p in paths]
        q = quantiles(vals)
        up = sum(1 for v in vals if v >= now * 1.25) / len(vals)
        dn = sum(1 for v in vals if v <= now * 0.75) / len(vals)
        return {"month": months[h - 1].isoformat(), "p10": q[0], "p50": q[2], "p90": q[4], "up25": up, "down25": dn,
                "score": round(10 * up, 1)}
    return {"bands": [[round(v, 2) for v in b] for b in bands], "years": years, "m12": at(12), "m24": at(24), "m36": at(36)}


def level(bands, score):
    for b in bands:
        if score < b["max"]:
            return b["level"]
    return bands[-1]["level"]


# ---------------------------------------------------------------- back-test
def backtest(series_daily, name, horizons=(12, 24), min_hist=36, sims=800, cfg=None, seed=7):
    """From each past month with enough history, fit on data up to then, aim the target at that month's price
    (no outside information), simulate, and check whether the real price landed inside the 10-90% range."""
    me = month_end(series_daily)
    keys = list(me)
    rng = random.Random(seed)
    res = {h: {"in": 0, "n": 0, "above": 0, "below": 0} for h in horizons}
    for i in range(min_hist, len(keys)):
        hist = {k: me[k] for k in keys[:i + 1]}
        fit = fit_reverting(hist, cfg["half_life_bounds_months"], cfg["half_life_default_months"], cfg.get("min_fit_months", 96), cfg.get("shock_scale", 1.0))
        if not fit:
            continue
        x0 = math.log(me[keys[i]])
        for h in horizons:
            if i + h >= len(keys):
                continue
            ends = []
            for _ in range(sims):
                idx = [rng.randrange(len(fit["shocks"])) for _ in range(h)]
                ends.append(simulate(x0, fit["k"], [x0] * h, idx, fit["shocks"])[-1])
            p10, _, _, _, p90 = quantiles(ends)
            real = math.log(me[keys[i + h]])
            r = res[h]; r["n"] += 1
            if p10 <= real <= p90:
                r["in"] += 1
            elif real > p90:
                r["above"] += 1
            else:
                r["below"] += 1
    out = {"material": name, "from": keys[0].isoformat() if keys else None, "to": keys[-1].isoformat() if keys else None}
    for h, r in res.items():
        if r["n"]:
            out[f"m{h}"] = {"tests": r["n"], "inside": round(100 * r["in"] / r["n"]), "above": round(100 * r["above"] / r["n"]), "below": round(100 * r["below"] / r["n"])}
    return out


# ---------------------------------------------------------------- main
def main():
    cfg = load("scenario_config.json")
    rcfg = load("risk_config.json", {}) or {}
    bands_cfg = rcfg.get("bands") or [{"max": 4.0, "level": "Low"}, {"max": 6.5, "level": "Elevated"}, {"max": 10.01, "level": "High"}]
    D = Data()
    today = datetime.now(IST).date()
    H, N = cfg["horizon_months"], cfg["sims"]
    start = month_key(today)
    months = [add_months(start, i + 1) for i in range(H)]  # first simulated month = next month
    rng = random.Random(cfg["seed"])

    # today's prices (site headline values where available)
    li_now = D.num(D.latest["lithium"]["price"]) if "lithium" in D.latest else D.lithium[-1][1]
    cu_now = D.metal["copper"][-1][1]
    al_now = D.metal["aluminium"][-1][1]
    inr_now = D.inr[-1][1]
    R = {k: float(D.raw[k]["usd"]) for k in ("Iron phosphate", "Graphite anode", "LFP electrolyte", "Separator") if k in D.raw}
    cm = D.cm
    cath_now = D.num(D.latest["cathode"]["price"]) if "cathode" in D.latest else None
    k_cath = cath_now / cathode_price(cm, li_now, R["Iron phosphate"]) if cath_now else 1.0
    cell_now = float(D.cell314[-1]["usd_kwh"])
    ev_now = float(D.ev[-1]["usd_kwh"]) if D.ev else None
    ev_ratio = ev_now / cell_now if ev_now else None

    # calibration
    B, dflt, mf, sc = cfg["half_life_bounds_months"], cfg["half_life_default_months"], cfg.get("min_fit_months", 96), cfg.get("shock_scale", 1.0)
    fit = {"lithium": fit_reverting(month_end(D.lithium), B, dflt, mf, sc),
           "copper": fit_reverting(month_end(D.metal["copper"]), B, dflt, mf, sc),
           "aluminium": fit_reverting(month_end(D.metal["aluminium"]), B, dflt, mf, sc)}
    fx_fit = fit_drift(month_end([(dt, v) for dt, v in D.inr if dt >= date(2015, 1, 1)]))
    # makers' margin: cell price vs modelled cost on each cell-price date (lithium, copper, aluminium on that date)
    def on(series, dt):
        ds = [a for a, _ in series]
        i = bisect.bisect_right(ds, dt) - 1
        return series[i][1] if i >= 0 else None
    mg = {}
    for r in D.cell314:
        dt = d(r["date"]); li = on(D.lithium, dt); cu = on(D.metal["copper"], dt); al = on(D.metal["aluminium"], dt)
        if li and cu and al:
            mg[month_key(dt)] = float(r["usd_kwh"]) / cell_cost(cm, R, li, cu, al) - 1
    mg_vals = list(mg.values())
    mg_mean = sum(mg_vals) / len(mg_vals)
    mg_steps = [b - a for a, b in zip(mg_vals, mg_vals[1:])]
    mg_sd = math.sqrt(sum(s * s for s in mg_steps) / max(1, len(mg_steps) - 1)) if mg_steps else 0.03
    mg_now = cell_now / cell_cost(cm, R, li_now, cu_now, al_now) - 1
    mg_k = math.log(2) / 6  # margins in a price war revert within months; half-life 6 months (assumed)

    # targets per scenario
    curve = curve_points(D, today)
    A = cfg["anchors"]
    def li_target(sid):
        a = A["lithium"][sid]
        if a.get("same_as"):
            return li_target(a["same_as"])
        if a.get("method") == "futures_curve":
            return target_path(li_now, start, months, curve, a.get("long_run")) if curve else target_path(li_now, start, months, [], a.get("long_run"))
        return target_path(li_now, start, months, a["points"], a.get("long_run"))
    T = {s["id"]: {"lithium": li_target(s["id"]),
                   "copper": target_path(cu_now, start, months, A["copper"]["all"]["points"]),
                   "aluminium": target_path(al_now, start, months, A["aluminium"]["all"]["points"])} for s in cfg["scenarios"]}

    # shared random draws (common random numbers across scenarios)
    nl, nm, nf = len(fit["lithium"]["shocks"]), len(fit["copper"]["shocks"]), len(fx_fit["shocks"])
    draws = [{"li": [rng.randrange(nl) for _ in range(H)], "metal": [rng.randrange(nm) for _ in range(H)],
              "fx": [rng.randrange(nf) for _ in range(H)], "mg": [rng.gauss(0, 1) for _ in range(H)]} for _ in range(N)]
    # copper and aluminium: same historical month for both (their histories cover the same dates)
    al_shocks = fit["aluminium"]["shocks"]; cu_shocks = fit["copper"]["shocks"]
    curbs = cfg["curbs"]; curbs_from = d(curbs["from"]); prem = curbs["premium"]

    out_mats = {}
    scen_out = {}
    for s in cfg["scenarios"]:
        sid = s["id"]
        P = {k: [] for k in ("lithium", "copper", "aluminium", "cathode", "cell_cost", "cell_ess", "cell_ev", "inr", "cell_inr")}
        for dr in draws:
            li = [math.exp(v) for v in simulate(math.log(li_now), fit["lithium"]["k"], T[sid]["lithium"], dr["li"], fit["lithium"]["shocks"])]
            cu = [math.exp(v) for v in simulate(math.log(cu_now), fit["copper"]["k"], T[sid]["copper"], dr["metal"], cu_shocks)]
            al = [math.exp(v) for v in simulate(math.log(al_now), fit["aluminium"]["k"], T[sid]["aluminium"], dr["metal"], al_shocks)]
            fx, x = [], math.log(inr_now)
            for t in range(H):
                x += fx_fit["mu"] + fx_fit["shocks"][dr["fx"][t] % nf]; fx.append(math.exp(x))
            m, mpath = mg_now, []
            for t in range(H):
                m = m + mg_k * (mg_mean - m) + mg_sd * dr["mg"][t]; m = max(-0.25, min(0.6, m)); mpath.append(m)
            cath, cost, ess, ev, cinr = [], [], [], [], []
            for t in range(H):
                c_on = sid == "curbs" and months[t] >= curbs_from
                cath.append(k_cath * cathode_price(cm, li[t], R["Iron phosphate"]) * (1 + (prem["cathode"] if c_on else 0)))
                cc = cell_cost(cm, R, li[t], cu[t], al[t])
                cost.append(cc)
                price = cc * (1 + mpath[t]) * (1 + (prem["cell"] if c_on else 0))
                ess.append(price); ev.append(price * ev_ratio if ev_ratio else None); cinr.append(price * fx[t])
            for k, v in (("lithium", li), ("copper", cu), ("aluminium", al), ("cathode", cath), ("cell_cost", cost), ("cell_ess", ess), ("inr", fx), ("cell_inr", cinr)):
                P[k].append(v)
            if ev_ratio:
                P["cell_ev"].append(ev)
        nows = {"lithium": li_now, "copper": cu_now, "aluminium": al_now, "cathode": cath_now or k_cath * cathode_price(cm, li_now, R["Iron phosphate"]),
                "cell_cost": cell_cost(cm, R, li_now, cu_now, al_now), "cell_ess": cell_now, "cell_ev": ev_now, "inr": inr_now, "cell_inr": cell_now * inr_now}
        scen_out[sid] = {k: summarise(v, months, nows[k]) for k, v in P.items() if v}
        for k, v in scen_out[sid].items():
            for h in ("m24", "m36"):
                if v.get(h):
                    v[h]["level"] = level(bands_cfg, v[h]["score"])
        if sid == "base":
            out_mats["now"] = nows
        print(f"{sid:6s} lithium 2027 P50 {scen_out[sid]['lithium']['years'].get('2027', {}).get('p50', 0):,.0f} | 2028 {scen_out[sid]['lithium']['years'].get('2028', {}).get('p50', 0):,.0f} "
              f"| cell 2028 P50 {scen_out[sid]['cell_ess']['years'].get('2028', {}).get('p50', 0):.1f} | Li 24m risk {scen_out[sid]['lithium']['m24']['score']}")

    # recent history for the charts (month-end, last 5 years)
    cut = add_months(start, -60)
    def hist(series):
        return [[k.isoformat(), round(v, 2)] for k, v in month_end(series).items() if k >= cut]
    cell_hist = [[r["date"], float(r["usd_kwh"])] for r in D.cell314]
    history = {"lithium": hist(D.lithium), "copper": hist(D.metal["copper"]), "aluminium": hist(D.metal["aluminium"]),
               "inr": hist(D.inr), "cell_ess": cell_hist,
               "cell_ev": [[r["date"], float(r["usd_kwh"])] for r in D.ev]}

    # back-test
    bt = [backtest(D.metal["copper"], "copper", cfg=cfg), backtest(D.metal["aluminium"], "aluminium", cfg=cfg),
          backtest(D.lithium, "lithium", horizons=(6, 12), min_hist=18, cfg=cfg)]
    for b in bt:
        print("backtest", b)

    calib = {k: {"half_life_months": round(v["half_life"], 1), "monthly_swing_pct": round(100 * v["sd"], 1), "months_of_history": v["n"] + 1, "how": v["how"],
                 "from": v["months"][0][:7] if v["months"] else None} for k, v in fit.items()}
    calib["inr"] = {"drift_pct_a_year": round(100 * (math.exp(12 * fx_fit["mu"]) - 1), 1), "monthly_swing_pct": round(100 * fx_fit["sd"], 2), "months_of_history": fx_fit["n"] + 1, "from": "2015-01"}
    calib["margin"] = {"now_pct": round(100 * mg_now, 1), "average_pct": round(100 * mg_mean, 1), "monthly_swing_pct": round(100 * mg_sd, 1), "readings": len(mg_vals),
                       "half_life_months": 6, "how": "average and swings fitted on cell prices against the modelled cost since " + (min(mg).isoformat()[:7] if mg else "-") + "; half-life of 6 months assumed"}

    out = {"asof": today.isoformat(), "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "months": [m.isoformat() for m in months], "sims": N, "threshold": cfg["up_down_threshold"],
           "scenarios": cfg["scenarios"], "anchors": cfg["anchors"], "held_flat": cfg["held_flat"], "curbs": cfg["curbs"], "supply": cfg["supply"],
           "curve": [{"month": p["date"][:7], "usd": round(p["usd"]), "contract": p.get("contract")} for p in curve],
           "now": {k: (round(v, 2) if v else v) for k, v in out_mats["now"].items()},
           "calibration": calib, "calibration_note": cfg.get("calibration_note"), "shock_scale": cfg.get("shock_scale", 1.0), "history": history, "results": scen_out, "backtest": bt,
           "bands": bands_cfg}
    (DATA / "scenarios.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote data/scenarios.json", round((DATA / "scenarios.json").stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
