"""Leyland Pulse Risk Navigator: price and supply risk scores (0-10) for each tracked material.

Reads the site's data files, writes:
  data/risk.json          today's scores with the drivers behind them (read by the page and the email)
  data/risk_history.json  one row of scores per day, for the trend lines and week-on-week change
  data/pricelog.json      a daily log of the latest price of each material, so histories build up over time

Everything is rule-based and explainable: each score is a weighted average of a few 0-10 driver scores,
with the weights in data/risk_config.json. Drivers without data are left out and the weights re-shared.
Run:  python3 scripts/risk.py            (normal daily run)
      python3 scripts/risk.py --rebuild  (also rebuilds past weekly scores from the data available then)
"""
import csv
import json
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
VAT = 1.13
IST = timezone(timedelta(hours=5, minutes=30))
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def load(name, default=None):
    p = DATA / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def save(name, obj):
    (DATA / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def d(s):
    return date.fromisoformat(s[:10])


def clip(x, lo=0.0, hi=10.0):
    return max(lo, min(hi, x))


def r1(x):
    return None if x is None else round(x, 1)


def pct(x):
    return f"{'+' if x >= 0 else '−'}{abs(x) * 100:.1f}%"


def asof_date(text, today):
    """'23 Oct' -> 2026-10-23; 'Feb 2026' -> 2026-02-01; '19–22 Oct' -> 2026-10-22; 'Sep' -> 2026-09-30."""
    t = str(text or "").strip().lower().replace("–", "-")
    m = re.search(r"(\d{1,2})\s*([a-z]{3})[a-z]*\s*(\d{4})?$", t)
    if m:
        mon = MONTHS.get(m.group(2))
        if mon:
            yr = int(m.group(3)) if m.group(3) else today.year
            out = date(yr, mon, int(m.group(1)))
            return out if out <= today else date(yr - 1, mon, int(m.group(1)))
    m = re.search(r"([a-z]{3})[a-z]*\s*(\d{4})?$", t)
    if m and MONTHS.get(m.group(1)):
        mon = MONTHS[m.group(1)]
        yr = int(m.group(2)) if m.group(2) else today.year
        if not m.group(2) and mon > today.month:
            yr -= 1
        return date(yr, mon, 1) if m.group(2) else (date(yr, mon, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return None


# ---------------------------------------------------------------- inputs
class Inputs:
    def __init__(self, today):
        self.today = today
        self.cfg = load("risk_config.json")
        self.latest = {r["id"]: r for r in load("latest.json", [])}
        self.raw = {r["material"]: r for r in load("rawmats.json", [])}
        self.lithium = load("lithium.json", [])
        self.cell314 = load("cell314.json", [])
        self.weekly = sorted(load("weekly.json", []), key=lambda r: r["date"])
        self.ev = (load("evcells.json", {}) or {}).get("series", [])
        self.cm = load("costmodel.json", {})
        self.forecasts = load("forecasts.json", [])
        self.news = load("news.json", [])
        self.events = load("events.json", [])
        self.pricelog = load("pricelog.json", [])
        self.fx = self._csv("fx.csv", lambda r: (d(r["date"]), float(r["usd_inr"]), float(r["usd_cny"])))
        self.lifut = self._csv("lithium_futures.csv", lambda r: (d(r["date"]), float(r["cny_t"])))
        self.hist = {}
        for name in ("copper", "aluminium"):
            p = DATA / "history" / f"{name}.csv"
            if p.exists():
                with open(p) as f:
                    self.hist[name] = [(d(r["date"]), float(r["usd_t"]), r.get("source", "")) for r in csv.DictReader(f) if r.get("usd_t")]

    @staticmethod
    def _csv(name, row):
        p = DATA / "history" / name
        if not p.exists():
            return []
        out = []
        with open(p) as f:
            for r in csv.DictReader(f):
                try:
                    out.append(row(r))
                except (KeyError, ValueError):
                    continue
        return sorted(out)

    def fx_at(self, t, col):
        """US$ to rupee (col 1) or US$ to yuan (col 2) on the last ECB day on or before t."""
        lo, hi = 0, len(self.fx) - 1
        if hi < 0 or self.fx[0][0] > t:
            return None
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.fx[mid][0] <= t:
                lo = mid
            else:
                hi = mid - 1
        return self.fx[lo][col]

    # the latest price of each material, with where it came from
    def current(self):
        L, R = self.latest, self.raw
        num = lambda s: float(re.sub(r"[^\d.]", "", str(s)) or 0)  # noqa: E731
        out = {}
        if "lithium" in L:  # the site's headline lithium price (Guangzhou futures settlement)
            r = L["lithium"]; out["lithium"] = (asof_date(r["asof"], self.today), num(r["price"]), r["source"], r.get("url"))
        else:
            spot = sorted((r for r in self.lithium if r.get("series") == "Spot"), key=lambda r: r["date"])
            if spot:
                r = spot[-1]; out["lithium"] = (d(r["date"]), float(r["usd_t"]), "China spot · " + r["source"], r["url"])
        if "cathode" in L:
            r = L["cathode"]; out["cathode"] = (asof_date(r["asof"], self.today), num(r["price"]), r["source"], r.get("url"))
        if "Graphite anode" in R:
            r = R["Graphite anode"]; out["graphite"] = (asof_date(r["asof"], self.today), float(r["usd"]), r["source"], r.get("url"))
        if self.weekly:
            r = self.weekly[-1]; out["cell_ess"] = (d(r["date"]), float(r["cell314"]), "InfoLink weekly", r.get("url"))
        if self.ev:
            r = sorted(self.ev, key=lambda x: x["date"])[-1]; out["cell_ev"] = (d(r["date"]), float(r["usd_kwh"]), r["source"], r.get("url"))
        for mid, name in (("copper", "Copper"), ("aluminium", "Aluminium")):
            if name in R:
                r = R[name]; out[mid] = (asof_date(r["asof"], self.today), float(r["usd"]), r["source"], r.get("url"))
        return {k: v for k, v in out.items() if v[0]}

    def update_pricelog(self):
        """Add today's latest prices to the log when a material has a newer reading than the last logged one."""
        log = self.pricelog
        last = {}
        for row in log:
            last[row["m"]] = row
        for mid, (dt, v, src, url) in self.current().items():
            prev = last.get(mid)
            if prev and (prev["date"] >= dt.isoformat()):
                continue
            log.append({"m": mid, "date": dt.isoformat(), "v": v, "source": src, "url": url})
        log.sort(key=lambda r: (r["m"], r["date"]))
        self.pricelog = log
        return log

    # price series for one material: list of (date, value), oldest first, de-duplicated by date
    def series(self, mid):
        pts = {}
        def add(dt, v):
            if dt and v:
                pts[dt] = float(v)
        if mid == "lithium" and self.lifut and self.fx:
            for dt, cny in self.lifut:
                rate = self.fx_at(dt, 2)
                if rate:
                    add(dt, round(cny / rate, 1))
            return sorted(pts.items())
        if mid == "lithium":
            for r in self.lithium:
                if r.get("series") == "Spot":
                    add(d(r["date"]), r["usd_t"])
        elif mid == "rupee":
            for dt, inr, _ in self.fx:
                add(dt, inr)
            return sorted(pts.items())
        elif mid == "cathode":
            return self.cathode_series()
        elif mid == "cell_ess":
            for r in self.cell314:
                add(d(r["date"]), r["usd_kwh"])
            for r in self.weekly:
                add(d(r["date"]), r["cell314"])
        elif mid == "cell_ev":
            for r in self.ev:
                add(d(r["date"]), r["usd_kwh"])
        elif mid in self.hist:
            for dt, v, _ in self.hist[mid]:
                add(dt, v)
        for r in self.pricelog:
            if r["m"] == mid:
                add(d(r["date"]), r["v"])
        return sorted(pts.items())


    def cathode_series(self):
        """LFP cathode price worked out from lithium: 0.24 t lithium carbonate + 0.96 t iron phosphate + processing
        per tonne (site cost model), iron phosphate and processing held at today's values, scaled to SMM's latest price."""
        li = self.series("lithium")
        cm, R = self.cm, self.raw
        try:
            lc, fer = cm.get("lc_per_t_lfp", 0.24), cm.get("fepo4_per_t_lfp", 0.96)
            fe, proc = float(R["Iron phosphate"]["usd"]), float(cm["cathode_processing_usd_t"])
        except (KeyError, TypeError, ValueError):
            return []
        raw = [(dt, lc * v + fer * fe + proc) for dt, v in li]
        cur = self.current().get("cathode")
        if not raw or not cur:
            return []
        base = value_at(raw, cur[0]) or raw[-1][1]
        k = cur[1] / base
        return [(dt, round(v * k, 1)) for dt, v in raw]


# ---------------------------------------------------------------- drivers
def upto(series, t):
    return [(dt, v) for dt, v in series if dt <= t]


def value_at(series, t, max_gap=None):
    s = upto(series, t)
    if not s:
        return None
    if max_gap is not None and (t - s[-1][0]).days > max_gap:
        return None
    return s[-1][1]


def change(series, t, days):
    """Change from the last reading on or before t-days to the last reading on or before t."""
    now = value_at(series, t)
    past = [(dt, v) for dt, v in series if dt <= t - timedelta(days=days)]
    if now is None or not past or (t - timedelta(days=days) - past[-1][0]).days > max(20, days // 2):
        return None
    return now / past[-1][1] - 1


def volatility(series, t, window=180):
    pts = [(dt, v) for dt, v in series if t - timedelta(days=window) <= dt <= t]
    rets = []
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        gap = (d1 - d0).days
        if gap <= 0 or v0 <= 0 or v1 <= 0:
            continue
        rets.append(math.log(v1 / v0) / math.sqrt(gap / 365.0))
    if len(rets) < 5:
        return None, len(rets)
    mu = sum(rets) / len(rets)
    sd = math.sqrt(sum((r - mu) ** 2 for r in rets) / (len(rets) - 1))
    return sd, len(rets)


def tag_sum(items, mid, kind, t, window, tau, date_key="date", future=False):
    """Weighted sum of risk tags. Past news fades with age (half-life tau days); future dates count more as they near."""
    total, used = 0.0, []
    for it in items:
        tags = [g for g in (it.get("risk") or []) if g.get("m") == mid and g.get("k") == kind]
        if not tags:
            continue
        dt = d(it[date_key])
        if future:
            days = (dt - t).days
            if days < 0 or days > window:
                continue
            w = 1 - days / window * 0.7  # a date 0 days away counts fully, one at the horizon edge 30%
        else:
            age = (t - dt).days
            if age < 0 or age > window:
                continue
            w = 0.5 ** (age / tau)
        for g in tags:
            total += g["s"] * w
            used.append((it, g["s"], w))
    return total, used


def cell_cost(inp, li):
    """Cost to make one kWh of LFP storage cell (US$), same method as the site's cost calculator."""
    cm, R = inp.cm, inp.raw
    try:
        lc, fe = cm.get("lc_per_t_lfp", 0.24), cm.get("fepo4_per_t_lfp", 0.96)
        m = lambda usd_t, kg: usd_t * kg / 1000 / VAT  # noqa: E731
        mat = (m(li * lc, cm["cathode_kg"]) + m(R["Iron phosphate"]["usd"] * fe, cm["cathode_kg"]) + m(cm["cathode_processing_usd_t"], cm["cathode_kg"])
               + m(R["Graphite anode"]["usd"], cm["anode_kg"]) + m(R["LFP electrolyte"]["usd"], cm["electrolyte_kg"])
               + R["Separator"]["usd"] * cm["separator_m2"] / VAT
               + (R["Copper"]["usd"] + cm["cu_foil_fee_usd_t"] / VAT) * cm["cu_foil_kg"] / 1000
               + (R["Aluminium"]["usd"] + cm["al_foil_fee_usd_t"] / VAT) * cm["al_foil_kg"] / 1000
               + cm["aux_usd_kwh"] + cm["structural_usd_kwh"])
        return mat / (cm["yield_pct"] / 100) + cm["mfg_usd_kwh"], m(li * lc, cm["cathode_kg"])
    except (KeyError, TypeError):
        return None, None


def level(cfg, score):
    if score is None:
        return None
    for b in cfg["bands"]:
        if score < b["max"]:
            return b["level"]
    return cfg["bands"][-1]["level"]


def combine(parts, weights):
    use = [(k, p) for k, p in parts.items() if p.get("score") is not None and weights.get(k, 0) > 0]
    tot = sum(weights[k] for k, _ in use)
    if not use or tot <= 0:
        return None, []
    score = sum(p["score"] * weights[k] for k, p in use) / tot
    out = []
    for k, p in parts.items():
        w = weights.get(k, 0)
        out.append({**p, "key": k, "weight": round(100 * w / tot) if (p.get("score") is not None and w > 0) else 0})
    return round(score, 1), out


# ---------------------------------------------------------------- scoring
def score_material(inp, mat, t, horizon, li_price_score=None, light=False):
    cfg, H = inp.cfg, cfg_h(inp.cfg, horizon)
    mid = mat["id"]
    s = inp.series(mid)
    p = {}

    # price drivers
    m1, m3 = change(s, t, 30), change(s, t, 90)
    if m1 is not None or m3 is not None:
        x = (0.6 * m1 + 0.4 * m3) if (m1 is not None and m3 is not None) else (m1 if m1 is not None else m3)
        det = " · ".join(v for v in [f"1 month {pct(m1)}" if m1 is not None else "", f"3 months {pct(m3)}" if m3 is not None else ""] if v)
        p["momentum"] = {"label": "Recent price trend", "score": r1(clip(5 + 25 * x)), "detail": det + " (rising prices push the score up)"}
    else:
        p["momentum"] = {"label": "Recent price trend", "score": None, "detail": "Not enough price history yet"}
    if mid == "cell_ev" and p["momentum"]["score"] is None:
        ess = inp.series("cell_ess")
        e3 = change(ess, t, 90)
        card = inp.latest.get("evcell") or {}
        mm = re.search(r"([+−-]?\d+(?:\.\d+)?)%", str(card.get("move", "")))
        card_dt = asof_date(card.get("asof"), inp.today) if card else None
        e1 = (float(mm.group(1).replace("−", "-")) / 100) if (mm and card_dt and 0 <= (t - card_dt).days <= 30) else change(ess, t, 30)
        if e1 is not None or e3 is not None:
            x = (0.6 * e1 + 0.4 * e3) if (e1 is not None and e3 is not None) else (e1 if e1 is not None else e3)
            src1 = "TrendForce's latest EV cell move" if (mm and card_dt and 0 <= (t - card_dt).days <= 30) else "storage cell 1-month change"
            p["momentum"] = {"label": "Recent price trend", "score": r1(clip(5 + 25 * x)), "assumed": True,
                             "detail": f"{src1} {pct(e1) if e1 is not None else 'n/a'} · storage cell 3-month change {pct(e3) if e3 is not None else 'n/a'} (EV cell readings are too sparse; storage cells used as a stand-in)"}
    vol, n = volatility(s, t)
    vol_proxy = False
    if vol is None and mid == "cell_ev":
        vol, n = volatility(inp.series("cell_ess"), t); vol_proxy = vol is not None
    if vol is not None:
        p["volatility"] = {"label": "How much the price swings", "score": r1(clip((vol - 0.05) / 0.55 * 10)),
                           "detail": f"About {vol * 100:.0f}% a year, from {n} price moves in the last 6 months" + (" of storage cells (assumed to swing like EV cells)" if vol_proxy else ""),
                           **({"assumed": True} if vol_proxy else {})}
    else:
        p["volatility"] = {"label": "How much the price swings", "score": None, "detail": "Not enough readings in the last 6 months"}

    for key, av in (mat.get("assumed") or {}).items():
        if key in p and p[key]["score"] is None:
            p[key] = {**p[key], "score": av["score"], "detail": av["detail"], "assumed": True, **({"url": av["url"]} if av.get("url") else {})}

    fx = inp.series("rupee")
    f1, f3 = change(fx, t, 30), change(fx, t, 90)
    if f1 is not None or f3 is not None:
        x = (0.6 * f1 + 0.4 * f3) if (f1 is not None and f3 is not None) else (f1 if f1 is not None else f3)
        now = value_at(fx, t)
        word = lambda v: ("weaker" if v > 0 else "stronger") + f" by {abs(v) * 100:.1f}%"  # noqa: E731
        p["rupee"] = {"label": "Rupee against the US$", "score": r1(clip(5 + 100 * x)),
                      "detail": f"US$1 = ₹{now:.2f}; rupee {word(f1) if f1 is not None else 'n/a'} in a month, {word(f3) if f3 is not None else 'n/a'} in 3 months (a weaker rupee makes imports dearer; ±5% scores 0 or 10)",
                      "url": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"}
    else:
        p["rupee"] = {"label": "Rupee against the US$", "score": None, "detail": "No exchange-rate history"}

    if mid == "lithium" and inp.forecasts:
        spot = value_at(s, t)
        mids = [((f["low"] + f["high"]) / 2, f) for f in inp.forecasts if f.get("low") and f.get("high")]
        if spot and mids:
            e = sum(m for m, _ in mids) / len(mids) / spot - 1
            who = ", ".join(f"{f['who']} {f['period']}" for _, f in mids)
            p["expectations"] = {"label": "What forecasters expect", "score": r1(clip(5 + e * 100 / 6)), "detail": f"Average forecast {pct(e)} vs today ({who})", "url": mids[0][1].get("url")}
    if "expectations" not in p:
        p["expectations"] = {"label": "What forecasters expect", "score": None, "detail": "No public forecasts tracked"}

    if mid in ("cell_ess", "cell_ev") and not light:
        li = value_at(inp.series("lithium"), t)
        price = value_at(s, t)
        cost, li_part = cell_cost(inp, li) if li else (None, None)
        if cost and price:
            mg = (price - cost) / price
            p["floor"] = {"label": "Room above the cost to make", "score": r1(clip(10 - mg * 100 / 3)),
                          "detail": f"Price ${price:.1f}/kWh vs modelled cost ${cost:.1f}/kWh: {'margin ' + format(mg * 100, '.0f') + '%' if mg >= 0 else 'below cost'} (thin margin = little room to fall)"
                          + (" · EV cells cost a little more to make than storage cells, so the real margin is thinner" if mid == "cell_ev" else "")}
    if "floor" not in p:
        p["floor"] = {"label": "Room above the cost to make", "score": None, "detail": "Only modelled for cells"}

    if mat.get("upstream") and li_price_score is not None:
        p["upstream"] = {"label": "Lithium price risk passed through", "score": li_price_score, "detail": f"Lithium price risk {li_price_score}/10 feeds into this material's cost"}
    else:
        p["upstream"] = {"label": "Lithium price risk passed through", "score": None, "detail": "Not linked to lithium" if not mat.get("upstream") else "Lithium score not available"}

    tot, used = tag_sum(inp.news, mid, "price", t, 60, 21)
    p["price_news"] = {"label": "Price news", "score": r1(clip(5 + 1.25 * tot)) if used else None,
                       "detail": f"{len(used)} recent stories ({'pushing prices up' if tot > 0 else 'pushing prices down' if tot < 0 else 'mixed'})" if used else "No tagged price news in the last 60 days",
                       "items": [{"id": it.get("id"), "date": it["date"], "text": it.get("short") or it["headline"], "url": it.get("url"), "s": sg} for it, sg, _ in used]}
    tot, used = tag_sum(inp.events, mid, "price", t, H["days"], 0, future=True)
    p["price_dates"] = {"label": "Known cost changes ahead", "score": r1(clip(5 + 1.5 * tot)) if used else None,
                        "detail": f"{len(used)} dated change(s) within the horizon" if used else "None within the horizon",
                        "items": [{"date": it["date"], "text": it.get("short") or it["what"], "url": it.get("url"), "s": sg} for it, sg, _ in used]}

    # supply drivers
    q = {}
    c = mat.get("conc") or {}
    if c.get("share") is not None:
        sc = c["share"] / 10 - (3 if mat.get("india_supply") else 0)
        q["concentration"] = {"label": "Dependence on one country", "score": r1(clip(sc)), "detail": c.get("what", ""), "url": c.get("url")}
    tot, used = tag_sum(inp.news, mid, "supply", t, 90, 30)
    q["supply_news"] = {"label": "Supply news", "score": r1(clip(2 + 1.5 * tot)),
                        "detail": (f"{len(used)} recent stories ({'tightening' if tot > 0 else 'easing' if tot < 0 else 'mixed'})" if used else "No supply disruptions reported in the last 90 days"),
                        "items": [{"id": it.get("id"), "date": it["date"], "text": it.get("short") or it["headline"], "url": it.get("url"), "s": sg} for it, sg, _ in used]}
    tot, used = tag_sum(inp.events, mid, "supply", t, H["days"], 0, future=True)
    q["supply_dates"] = {"label": "Rule changes and deadlines ahead", "score": r1(clip(2 + 2 * tot)),
                         "detail": f"{len(used)} dated change(s) within the horizon" if used else "None within the horizon",
                         "items": [{"date": it["date"], "text": it.get("short") or it["what"], "url": it.get("url"), "s": sg} for it, sg, _ in used]}

    W = cfg["weights"][horizon]
    ps, pparts = combine(p, W["price"])
    ss, sparts = combine(q, W["supply"])
    have = sum(1 for k in ("momentum", "volatility", "expectations", "floor", "upstream") if p[k]["score"] is not None)
    obs = len([1 for dt, _ in s if dt >= t - timedelta(days=180)])
    assumed = sum(1 for k in p if p[k].get("assumed") and p[k].get("score") is not None)
    if mid == "cathode":
        obs = len([1 for dt, _ in inp.series("lithium") if dt >= t - timedelta(days=180)])
    conf = "High" if (obs >= 15 and have >= 3) else "Medium" if (obs >= 4 and have >= 2) else "Low"
    if mid == "cathode" and conf == "High":
        conf = "Medium"  # trend is worked out from lithium, not measured
    if mat.get("conf_cap") == "Low" or assumed >= 2:
        conf = "Low"
    elif assumed == 1 and conf == "High":
        conf = "Medium"
    if ps is not None and have == 0:
        ps, conf = None, "Low"
    return {"price": {"score": ps, "level": level(cfg, ps), "drivers": pparts},
            "supply": {"score": ss, "level": level(cfg, ss), "drivers": sparts},
            "confidence": conf, "obs180": obs}


def cfg_h(cfg, h):
    return cfg["horizons"][h]


def score_all(inp, t, light=False):
    out = {}
    mats = inp.cfg["materials"]
    for h in ("h3", "h12"):
        li = score_material(inp, next(m for m in mats if m["id"] == "lithium"), t, h, light=light)
        lps = li["price"]["score"]
        res = {"lithium": li}
        for m in mats:
            if m["id"] != "lithium":
                res[m["id"]] = score_material(inp, m, t, h, lps, light=light)
        out[h] = res
    return out


# ---------------------------------------------------------------- back-test
def backtest(inp, mid, step_days=14, ahead=91):
    """Score every two weeks from price trend and swings only (the drivers that can be rebuilt for the past),
    then compare what the price did over the next 3 months after the highest third of scores and the lowest third."""
    s = inp.series(mid)
    if len(s) < 150:
        return None
    first, last = s[0][0] + timedelta(days=200), s[-1][0] - timedelta(days=ahead)
    rows = []
    t = first
    while t <= last:
        m1, m3 = change(s, t, 30), change(s, t, 90)
        vol, _ = volatility(s, t)
        if m1 is not None and m3 is not None and vol is not None:
            ms = clip(5 + 25 * (0.6 * m1 + 0.4 * m3)); vs = clip((vol - 0.05) / 0.55 * 10)
            sc = (ms * 30 + vs * 20) / 50
            fut = change(s, t + timedelta(days=ahead), ahead)
            if fut is not None:
                rows.append((sc, fut))
        t += timedelta(days=step_days)
    if len(rows) < 24:
        return None
    srt = sorted(rows, key=lambda r: r[0])
    third = len(srt) // 3
    lo, hi = [f for _, f in srt[:third]], [f for _, f in srt[-third:]]
    cut_lo, cut_hi = srt[third - 1][0], srt[-third][0]

    def stat(xs):
        return {"n": len(xs), "rise5": round(100 * sum(1 for x in xs if x > 0.05) / len(xs)),
                "fall5": round(100 * sum(1 for x in xs if x < -0.05) / len(xs)),
                "big10": round(100 * sum(1 for x in xs if abs(x) > 0.10) / len(xs)),
                "avg": round(100 * sum(xs) / len(xs), 1)}
    names = {"lithium": "Lithium carbonate", "copper": "Copper", "aluminium": "Aluminium"}
    return {"material": mid, "name": names.get(mid, mid), "from": s[0][0].isoformat(), "to": s[-1][0].isoformat(),
            "samples": len(rows), "step_days": step_days, "cut_low": round(cut_lo, 1), "cut_high": round(cut_hi, 1),
            "high": stat(hi), "low": stat(lo), "all": stat([f for _, f in rows])}


# ---------------------------------------------------------------- main
def compact(res):
    return {m: [r["price"]["score"], r["supply"]["score"]] for m, r in res.items()}


def india_block(inp, today):
    fx = inp.series("rupee")
    out = dict(inp.cfg.get("india", {}))
    if fx:
        last_dt, last = fx[-1]
        wk = [(dt, v) for dt, v in fx if dt >= today - timedelta(days=400)]
        thin = [[dt.isoformat(), v] for i, (dt, v) in enumerate(wk) if i % 3 == 0 or i == len(wk) - 1]
        out["fx"] = {"date": last_dt.isoformat(), "usd_inr": last, "usd_cny": inp.fx[-1][2],
                     "m1": change(fx, today, 30), "m3": change(fx, today, 90), "y1": change(fx, today, 365),
                     "series": thin, "source": "ECB euro reference rates (cross rates)",
                     "url": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"}
    return out


def main():
    rebuild = "--rebuild" in sys.argv
    today = datetime.now(IST).date()
    inp = Inputs(today)
    inp.update_pricelog()
    save("pricelog.json", inp.pricelog)

    hist = load("risk_history.json", [])
    hist = [h for h in hist if h["date"] != today.isoformat()]
    if rebuild:
        hist = [h for h in hist if not h.get("rebuilt")]
        known = {h["date"] for h in hist}
        for k in range(1, 13):
            t = today - timedelta(days=7 * k)
            if t.isoformat() in known:
                continue
            past = Inputs(t)
            past.news = [n for n in inp.news if n["date"] <= t.isoformat()]
            past.events = inp.events
            past.pricelog = [r for r in inp.pricelog if r["date"] <= t.isoformat()]
            sc = score_all(past, t)
            hist.append({"date": t.isoformat(), "rebuilt": True, "h3": compact(sc["h3"]), "h12": compact(sc["h12"])})

    scores = score_all(inp, today)
    hist.append({"date": today.isoformat(), "h3": compact(scores["h3"]), "h12": compact(scores["h12"])})
    hist.sort(key=lambda h: h["date"])
    save("risk_history.json", hist)

    def week_ago(h, mid, idx):
        old = [x for x in hist if x["date"] <= (today - timedelta(days=6)).isoformat()]
        if not old:
            return None
        v = old[-1].get(h, {}).get(mid, [None, None])[idx]
        return v

    cur = inp.current()
    mats = []
    for m in inp.cfg["materials"]:
        mid = m["id"]
        ent = {"id": mid, "name": m["name"], "short": m["short"], "group": m["group"], "unit": m["unit"], "assumptions": m.get("assumptions", [])}
        if mid in cur:
            dt, v, src, url = cur[mid]
            ent["now"] = {"value": v, "date": dt.isoformat(), "source": src, "url": url}
        for h in ("h3", "h12"):
            r = scores[h][mid]
            for idx, ax in ((0, "price"), (1, "supply")):
                prev = week_ago(h, mid, idx)
                sc = r[ax]["score"]
                r[ax]["change"] = None if (prev is None or sc is None) else round(sc - prev, 1)
            ent[h] = r
        ent["trend"] = [[x["date"], *x.get("h3", {}).get(mid, [None, None])] for x in hist][-26:]
        mats.append(ent)

    bt = [b for b in (backtest(inp, "lithium"), backtest(inp, "copper"), backtest(inp, "aluminium")) if b]
    out = {"asof": today.isoformat(), "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "horizons": inp.cfg["horizons"], "bands": inp.cfg["bands"], "weights": inp.cfg["weights"],
           "playbook": inp.cfg["playbook"], "materials": mats, "backtest": bt, "india": india_block(inp, today)}
    save("risk.json", out)
    for m in mats:
        r = m["h3"]
        print(f"{m['short']:<14} price {r['price']['score']!s:>4} {r['price']['level'] or '-':<9} supply {r['supply']['score']!s:>4} {r['supply']['level']:<9} conf {r['confidence']}")
    for b in bt:
        print("backtest", b["material"], b["from"], b["to"], b["samples"], "top", b["high"], "bottom", b["low"])


if __name__ == "__main__":
    main()
