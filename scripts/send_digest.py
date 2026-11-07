#!/usr/bin/env python3
"""LeyBatt Pulse daily email digest.

Builds the morning email from the data files in data/ (written by the 4 am update) and sends it
through Gmail SMTP. Run by .github/workflows/daily-digest.yml at about 5:15 am IST.

Settings (GitHub repository secrets, never stored in the repo):
  GMAIL_USER          the Gmail address that sends the email
  GMAIL_APP_PASSWORD  a Gmail app password for that address (not the normal password)
  MAIL_TO             comma-separated recipient addresses

Local preview without sending:  python3 scripts/send_digest.py --dry-run preview.html
"""
import datetime as dt
import html
import json
import os
import re
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = "https://battery-business.github.io/LeyBatt-Pulse/"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def load(name, default=None):
    try:
        return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def d(s):
    return dt.date.fromisoformat(s)


def day(s):
    x = d(s)
    return f"{x.day} {x.strftime('%b')}"


def pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


def signed(p):
    return ("+" if p > 0 else "−" if p < 0 else "±") + f"{abs(p):.1f}%"


IMPACT_LAB = {
    "cost": {1: "Lower battery costs", -1: "Higher battery costs", 0: "Battery costs: watch"},
    "demand": {1: "More {w} demand", -1: "Less {w} demand", 0: "Demand: watch"},
    "competition": {1: "Less competition", -1: "More competition", 0: "Competition: watch"},
    "supply": {1: "Easier supply", -1: "Supply risk", 0: "Supply: watch"},
    "policy": {1: "Supportive policy", -1: "Tighter rules", 0: "Policy change"},
}
SEG_LAB = {"EVs": "For EVs", "Batteries": "For batteries", "BESS": "For BESS"}
SEG_WORD = {"EVs": "EV", "Batteries": "battery", "BESS": "storage"}


def week_move(pts):
    """Latest reading vs the one about a week earlier (or the previous reading if readings are rarer), as on the website.
    pts: sorted [(date, value, ...)]. Returns (last, prev, pct) or None."""
    if len(pts) < 2:
        return None
    last, prev = pts[-1], None
    for p in reversed(pts[:-1]):
        prev = p
        if (d(last[0]) - d(p[0])).days >= 6:
            break
    return last, prev, pct(last[1], prev[1])


def outlook(mat, year="2028"):
    """Base-scenario yearly average (middle and 8-in-10 range) from data/scenarios.json, or None."""
    X = load("scenarios", {}) or {}
    y = (((X.get("results") or {}).get("base") or {}).get(mat) or {}).get("years", {}).get(year)
    if not y:
        return None
    return year, y["p50"], y["p10"], y["p90"], (X.get("now") or {}).get(mat)


def series_points():
    """Return {key: (label, unit, [(date, value, source, url), ...])} sorted by date."""
    out = {}
    lith = load("lithium", [])
    for key, ser, label in (("fut", "Futures", "Lithium carbonate futures"), ("spot", "Spot", "Lithium carbonate spot")):
        pts = [(r["date"], float(r["usd_t"]), r.get("source", ""), r.get("url", "")) for r in lith if r.get("series") == ser]
        pts.sort(key=lambda p: p[0])
        out[key] = (label, "/t", pts)
    lm = (load("markets", {}) or {}).get("lithium") or {}
    rec = lm.get("recent") or []
    if rec and (not out["fut"][2] or rec[-1][0] > out["fut"][2][-1][0]):
        out["fut"] = ("Lithium carbonate futures", "/t", [(dd, float(v), "Guangzhou futures close, at the ECB rate", lm.get("url", "")) for dd, v in rec])
    spot = [p for p in out["spot"][2] if p[2].startswith("SMM")]  # one source for spot, as on the website
    if spot:
        out["spot"] = (out["spot"][0], "/t", spot)
    wk = sorted(load("weekly", []), key=lambda r: r["date"])
    out["cell"] = ("314 Ah storage cell", "/kWh", [(r["date"], float(r["cell314"]), r.get("source", ""), r.get("url", "")) for r in wk])
    ev = load("evcells", {}) or {}
    evs = sorted(ev.get("series", []), key=lambda r: r["date"])
    out["ev"] = ("EV prismatic LFP cell (230/324 Ah class)", "/kWh", [(r["date"], float(r["usd_kwh"]), r.get("source", ""), r.get("url", "")) for r in evs])
    out["sys"] = ("4-hour storage system, China (weekly)", "/kWh", [(r["date"], float(r["ac_4h"]), r.get("source", ""), r.get("url", "")) for r in wk])
    return out


def value_on_or_before(pts, date):
    best = None
    for p in pts:
        if p[0] <= date:
            best = p
    return best


def build(today):
    meta = load("meta", {}) or {}
    news = load("news", []) or []
    events = load("events", []) or []
    S = series_points()
    # a reading counts as new if it was published today or yesterday (IST); older readings were already in an earlier email
    fresh_from = (today - dt.timedelta(days=1)).isoformat()
    latest = {r["id"]: r for r in (load("latest", []) or [])}

    rows, alerts = [], []
    acfg = load("alerts", {}) or {}
    mv = acfg.get("moves") or {}
    fam = lambda src: (src or "").split(" (")[0].strip()  # noqa: E731  "SMM daily review (GFEX close)" -> "SMM daily review"
    for key, (label, unit, pts) in S.items():
        if not pts:
            continue
        # a series can hold readings from more than one source on one day (e.g. SMM daily and InfoLink weekly spot):
        # take the latest day's reading from the source that also reported the day before, and compare like with like
        dates = sorted({p[0] for p in pts})
        on = lambda dd: [p for p in pts if p[0] == dd]  # noqa: E731
        before = on(dates[-2]) if len(dates) > 1 else []
        cands = on(dates[-1])
        last = next((p for p in cands if fam(p[2]) in {fam(b[2]) for b in before}), cands[-1])
        prev = next((b for b in before if fam(b[2]) == fam(last[2])), before[-1] if before else None)
        chg = pct(last[1], prev[1]) if prev else None
        gap = (d(last[0]) - d(prev[0])).days if prev else 0
        vs = ""
        # where the source states its own change for this same reading (same date, same price), show that figure,
        # so the email agrees with the summary line and the website
        card = latest.get({"fut": "lithium", "cell": "cell314", "ev": "evcell"}.get(key, ""), {})
        m = re.search(r"([+−-]?)(\d+(?:\.\d+)?)%\s*(.*)", card.get("move", ""))
        try:
            same = card.get("asof") == day(last[0]) and abs(float(re.sub(r"[^\d.]", "", card.get("price", "")) or "nan") - last[1]) < 0.051
        except ValueError:
            same = False
        if m and same:
            chg = float(m.group(2)) * (-1 if m.group(1) and m.group(1) in "−-" else 1)
            vs = m.group(3).strip()
        elif prev:
            vs = f"vs {day(prev[0])}"  # always say what the change is measured against, as the website does
        new = last[0] >= fresh_from
        fmt = (lambda v: f"${v:,.0f}") if unit == "/t" else (lambda v: f"${v:,.1f}")
        wm = week_move(pts)
        rows.append({"key": key, "label": label, "value": fmt(last[1]), "unit": unit, "num": last[1], "chg": chg, "vs": vs,
                     "wvalue": fmt(wm[0][1]) if wm else fmt(last[1]), "wnum": wm[0][1] if wm else last[1], "wchg": wm[2] if wm else None,
                     "wvs": f"vs {day(wm[1][0])}" if wm else "", "wdate": day(wm[0][0]) if wm else day(last[0]), "wurl": wm[0][3] if wm else last[3],
                     "date": day(last[0]), "new": new, "source": last[2], "url": last[3]})
        # alert rules: only on a reading this email is reporting for the first time
        if new and chg is not None and gap <= 21:
            limit = mv.get("lithium_pct", 5) if key in ("fut", "spot") else mv.get("other_pct", 3)
            if abs(chg) >= limit:
                short = {"fut": "Lithium futures", "spot": "Lithium spot", "cell": "314 Ah cell", "ev": "EV cell", "sys": "4-h system"}[key]
                alerts.append(f"{short} {signed(chg)}")
            elif key in ("fut", "spot"):
                wk = value_on_or_before(pts, (d(last[0]) - dt.timedelta(days=7)).isoformat())
                if wk and abs(pct(last[1], wk[1])) >= mv.get("lithium_week_pct", 10):
                    alerts.append(f"{'Lithium futures' if key == 'fut' else 'Lithium spot'} {signed(pct(last[1], wk[1]))} in a week")

    # level alerts: fire on the morning a new reading crosses a level set in data/alerts.json
    beyond = {}
    for lv in acfg.get("levels") or []:
        k = lv.get("key")
        if k not in S or not S[k][2]:
            continue
        pts = S[k][2]
        last = pts[-1]
        before = [p for p in pts if p[0] < last[0]]
        prev = before[-1] if before else None
        f_ = (lambda v: f"${v:,.0f}") if S[k][1] == "/t" else (lambda v: f"${v:,.1f}")  # noqa: E731
        for side, lvl in (("above", lv.get("above")), ("below", lv.get("below"))):
            if lvl is None:
                continue
            out_now = last[1] > lvl if side == "above" else last[1] < lvl
            out_prev = prev is not None and (prev[1] > lvl if side == "above" else prev[1] < lvl)
            if out_now:
                beyond[k] = f"{'Above' if side == 'above' else 'Below'} your {f_(lvl)} alert level"
                if last[0] >= fresh_from and not out_prev:
                    alerts.append(f"{lv.get('name', k)} {'rose above' if side == 'above' else 'fell below'} {f_(lvl)}{S[k][1]}: now {f_(last[1])} ({day(last[0])})")

    recent = [n for n in news if n.get("date", "") >= (today - dt.timedelta(days=2)).isoformat()]
    cut3 = (today - dt.timedelta(days=3)).isoformat()
    forus = sorted([n for n in news if n.get("so") and n.get("date", "") >= cut3 and (n.get("weight") or 0) >= 2],
                   key=lambda n: (-(n.get("weight") or 0), "".join(chr(255 - ord(c)) for c in n.get("date", ""))))[:4]
    if len(forus) < 3:
        forus = sorted([n for n in news if n.get("so") and (n.get("weight") or 0) >= 2], key=lambda n: n.get("date", ""), reverse=True)[:4]
    shown_ids = {n["id"] for n in forus}
    recent = sorted([n for n in recent if n["id"] not in shown_ids], key=lambda n: (-(n.get("weight") or 0), "".join(chr(255 - ord(c)) for c in n.get("date", ""))))
    top = recent[:4]

    up = []
    for e in sorted(events, key=lambda e: e["date"]):
        end = d(e.get("end", e["date"]))
        if e.get("precision") == "month":
            nxt = (d(e["date"]).replace(day=28) + dt.timedelta(days=4))
            end = nxt - dt.timedelta(days=nxt.day)
        if end >= today:
            up.append(e)
    nextd = [e for e in up if (d(e["date"]) - today).days <= 14 and ((e.get("weight") or 0) >= 2 or e.get("kind") == "Rule change")]
    have = {(e["date"], "rule") for e in nextd if e.get("kind") == "Rule change"}
    for r in load("regulations", []) or []:
        rd = d(r["date"])
        if today <= rd and (rd - today).days <= 14 and (r["date"], "rule") not in have:
            nextd.append({"date": r["date"], "what": r.get("short") or r["title"], "short": r.get("short") or r["title"], "kind": "Rule change",
                         "so": r.get("so") or r.get("impact", ""), "seg": r.get("seg", ""), "weight": 2, "source": r.get("source", ""), "url": r.get("url", "")})
    nextd = sorted(nextd, key=lambda e: (e["date"], -(e.get("weight") or 0)))[:5]
    up = up[:3]

    date_label = f"{today.strftime('%a')} {today.day} {today.strftime('%b %Y')}"
    seen, uniq = set(), []
    for a in alerts:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    subject = f"LeyBatt Pulse | Daily | {today.day} {today.strftime('%b')}"
    note = meta.get("note", "")

    # ---------- HTML (email-safe: tables and inline styles only) ----------
    # Look matches the website: light Apple-style page, white rounded cards, logo colours for the five value-chain steps.
    E = html.escape
    INK, MUTED, LINE, BG, SOFT, ACCENT, TEAL = "#1d1d1f", "#6e6e73", "#e8e8ed", "#f5f5f7", "#f5f5f7", "#1f698e", "#158a83"
    GREEN, AMBER, RED, BLUE = "#1f7a4d", "#b45309", "#b42318", ACCENT
    L = ["#1f5b9e", "#1f698e", "#1a8a8f", "#159d7f", "#1cab7c"]  # logo colours, one per step
    FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
    CAT = {"Lithium & materials": "#c27c02", "Cell makers & competitors": "#1f5bd8", "Packs & BMS": "#c8571b", "R&D & new products": "#0f8a80",
           "Energy storage": "#4a55c4", "EV market": "#2f8a4f", "India BESS": "#c2415d", "India EV & battery makers": "#a8388a", "Regulation & trade": "#8a4fb8"}

    def pill(chg, vs=""):
        if chg is None:
            return f'<span style="color:{MUTED};font-size:12px">–</span>'
        if abs(chg) < 0.05:
            bg, fg, txt = "#ececf0", MUTED, "no change"
        elif chg < 0:
            bg, fg, txt = "#e3f4ea", GREEN, f"▼ {abs(chg):.1f}%"
        else:
            bg, fg, txt = "#fdf0e1", AMBER, f"▲ {abs(chg):.1f}%"
        extra = f' <span style="color:{MUTED};font-size:11px">{E(vs)}</span>' if vs else ""
        return f'<span style="display:inline-block;background:{bg};color:{fg};font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap">{txt}</span>{extra}'

    def tile(label, value, unit, chg, when, url, vs="", sub="", color=ACCENT, ol="", flag=""):
        return (f'<td class="tile" width="50%" valign="top" style="padding:6px">'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-radius:18px">'
                f'<tr><td style="padding:16px 16px 14px">'
                f'<div style="font-size:12.5px;color:{MUTED};line-height:1.3"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{color};margin-right:6px"></span>{E(label)}</div>'
                f'<div style="font-size:26px;font-weight:700;color:{INK};letter-spacing:-0.6px;line-height:1.2;margin-top:6px">{E(value)}<span style="font-size:13px;font-weight:500;color:{MUTED};letter-spacing:0">{E(unit)}</span></div>'
                + (f'<div style="font-size:12px;color:{MUTED};margin-top:2px">{E(sub)}</div>' if sub else "")
                + f'<div style="margin-top:10px">{pill(chg, vs)}</div>'
                + (f'<div style="font-size:12px;font-weight:700;color:{AMBER};margin-top:8px">⚠ {E(flag)}</div>' if flag else "")
                + (f'<div style="font-size:12px;color:{INK};margin-top:9px;line-height:1.4"><b style="color:{ACCENT}">Outlook</b> {E(ol)}</div>' if ol else "")
                + f'<div style="font-size:11.5px;color:{MUTED};margin-top:8px"><a href="{E(url)}" style="color:{MUTED};text-decoration:underline">{E(when)}</a></div>'
                f'</td></tr></table></td>')

    R = {r["key"]: r for r in rows}
    tiles = []
    names = {"fut": "Lithium carbonate futures", "spot": "Lithium carbonate spot", "cell": "314 Ah storage cell", "ev": "EV prismatic LFP cell", "sys": "4-hour AC storage system, China spot"}
    tcol = {"fut": L[0], "spot": L[0], "cell": L[2], "ev": L[2], "sys": L[3]}
    for k in ("fut", "spot", "cell", "ev", "sys"):
        if k in R:
            r = R[k]
            when = r["date"] + ("" if r["new"] else " · no new reading")
            sub = f"230 Ah ≈ ${r['num'] * 0.736:,.2f} · 324 Ah ≈ ${r['num'] * 1.043:,.2f} per cell" if k == "ev" else ""
            tiles.append(tile(names[k], r["value"], r["unit"], r["chg"], when, r["url"], r["vs"], sub, tcol[k]))
    if len(tiles) % 2:
        tiles.append(f'<td class="tile" width="50%" valign="top" style="padding:6px">'
                     f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaf3f6;border-radius:18px"><tr><td style="padding:16px">'
                     f'<div style="font-size:12.5px;color:{ACCENT};font-weight:600">Lower is better for a buyer</div>'
                     f'<div style="font-size:15px;color:{INK};font-weight:700;margin-top:6px;line-height:1.4">Green ▼ means cheaper,<br>amber ▲ means dearer</div>'
                     f'<div style="font-size:11.5px;color:{MUTED};margin-top:8px">US$, China prices excluding VAT</div></td></tr></table></td>')
    tile_rows = "".join(f"<tr>{tiles[i]}{tiles[i + 1]}</tr>" for i in range(0, len(tiles), 2))

    def section(title, sub=""):
        return (f'<tr><td style="padding:30px 24px 8px" class="px">'
                f'<div style="font-size:22px;font-weight:800;color:{INK};letter-spacing:-0.5px;line-height:1.2">{E(title)}</div>'
                + (f'<div style="font-size:13.5px;color:{MUTED};margin-top:4px">{E(sub)}</div>' if sub else "")
                + '</td></tr>')

    # the value chain: five steps in the logo colours, as on the website's front page
    store = load("indiastorage", {}) or {}
    tl = sorted(store.get("tenders", []) or [], key=lambda t: t["date"])
    STEPS = [("mining", "01", "Mining", "fut", "lithium"), ("materials", "02", "Materials", None, "cathode"), ("cells", "03", "Cells", "cell", "cell314"),
             ("systems", "04", "Packs &amp; systems", "sys", "system"), ("enduse", "05", "End use", None, None)]
    UNIT = {"per tonne": "/t", "per kWh": "/kWh"}
    DIRC = {"down": GREEN, "up": AMBER}
    data = []
    for i, (sid, num, name, skey, lkey) in enumerate(STEPS):
        if skey and skey in R:  # same reading as the price card below, so the two never disagree
            r = R[skey]; ch = r["chg"]
            move = "–" if ch is None else ("no change" if abs(ch) < 0.05 else f'{"▼" if ch < 0 else "▲"} {abs(ch):.1f}% {r["vs"] or "vs previous"}')
            mcol = MUTED if ch is None or abs(ch) < 0.05 else (GREEN if ch < 0 else AMBER)
            data.append((sid, num, name, L[i], r["value"], r["unit"], move, mcol, f'{r["source"]}, {r["date"]}', r["url"]))
        elif lkey and lkey in latest:
            r = latest[lkey]
            data.append((sid, num, name, L[i], r["price"], UNIT.get(r.get("unit", ""), ""), r.get("move", ""), DIRC.get(r.get("direction"), MUTED),
                         f'{r.get("source", "")}, {r.get("asof", "")}', r.get("url", "")))
        elif sid == "enduse" and tl and tl[-1].get("low") is not None:
            t = tl[-1]; td_ = d(t["date"])
            data.append((sid, num, name, L[i], f'₹{t["low"]}', " lakh/MW-month", f'Latest India storage tender: {t["agency"]}', MUTED,
                         f'{t.get("source", "").split(",")[0]}, {td_.day} {td_.strftime("%b")}', t.get("url", "")))
    steps, mrows = [], []
    for j, (sid, num, name, c, val, unit, move, mcol, src, url) in enumerate(data):
        steps.append(
            f'<td width="20%" valign="top" style="padding:4px">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-radius:18px;border-top:3px solid {c}">'
            f'<tr><td style="padding:14px 8px 12px" align="center">'
            f'<div style="width:30px;height:30px;line-height:30px;border-radius:50%;background:{c};color:#ffffff;font-size:12px;font-weight:800;text-align:center;margin:0 auto">{num}</div>'
            f'<div style="font-size:13px;font-weight:700;color:{INK};margin-top:8px;line-height:1.25">{name}</div>'
            f'<div style="font-size:17px;font-weight:700;color:{INK};letter-spacing:-0.3px;margin-top:6px;white-space:nowrap">{E(val)}</div>'
            f'<div style="font-size:11px;color:{MUTED}">{E(unit.strip())}</div>'
            f'<div style="font-size:11px;font-weight:600;color:{mcol};margin-top:6px;line-height:1.35">{E(move)}</div>'
            f'<div style="font-size:10.5px;margin-top:6px;line-height:1.3"><a href="{E(url)}" style="color:{MUTED};text-decoration:underline">{E(src)}</a></div>'
            f'<div style="font-size:12px;margin-top:8px"><a href="{SITE}#chain/{sid}" style="color:{c};font-weight:700;text-decoration:none">Explore ›</a></div>'
            f'</td></tr></table></td>')
        bt = "" if j == 0 else f"border-top:1px solid {LINE};"
        mrows.append(  # phones: one compact line per step
            f'<tr><td width="40" valign="top" style="padding:12px 0 12px 14px;{bt}"><div style="width:28px;height:28px;line-height:28px;border-radius:50%;background:{c};color:#ffffff;font-size:11.5px;font-weight:800;text-align:center">{num}</div></td>'
            f'<td valign="top" style="padding:12px 8px;{bt}"><a href="{SITE}#chain/{sid}" style="font-size:14.5px;font-weight:700;color:{INK};text-decoration:none">{name} <span style="color:{c}">›</span></a>'
            f'<div style="font-size:11px;margin-top:3px;line-height:1.3"><a href="{E(url)}" style="color:{MUTED};text-decoration:underline">{E(src)}</a></div></td>'
            f'<td valign="top" align="right" style="padding:12px 14px 12px 0;{bt}"><div style="font-size:16px;font-weight:700;color:{INK};white-space:nowrap">{E(val)}<span style="font-size:11px;font-weight:500;color:{MUTED}">{E(unit.strip())}</span></div>'
            f'<div style="font-size:11px;font-weight:600;color:{mcol};margin-top:3px;line-height:1.3">{E(move)}</div></td></tr>')
    chain_html = ""
    if steps:
        chain_html = (f'<tr><td style="padding:4px 20px 0" class="px">'
                      f'<div class="dsk"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>{"".join(steps)}</tr></table></div>'
                      f'<!--[if !mso]><!--><div class="mob" style="display:none;max-height:0;overflow:hidden;mso-hide:all">'
                      f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-radius:18px">{"".join(mrows)}</table></div><!--<![endif]-->'
                      f'</td></tr>')

    # risk navigator: the four materials with the highest score (next 3 months)
    risk = load("risk", {}) or {}
    rmats = [m for m in risk.get("materials", []) if m.get("h3")]
    rmats.sort(key=lambda m: -max(m["h3"]["price"]["score"] or 0, m["h3"]["supply"]["score"] or 0))
    rmats = rmats[:4]
    LV = {"Low": ("#e3f4ea", GREEN), "Elevated": ("#fdf0e1", AMBER), "High": ("#fde4e1", RED)}

    def rchip(ax):
        if not ax or ax.get("score") is None:
            return f'<span style="font-size:12px;color:{MUTED}">not scored</span>'
        bg, fg = LV.get(ax["level"], ("#ececf0", MUTED))
        ch = ax.get("change")
        arrow = "" if ch is None or abs(ch) < 0.05 else f'<span style="font-size:11px;color:{RED if ch > 0 else GREEN};font-weight:700"> {"▲" if ch > 0 else "▼"}{abs(ch):.1f}</span>'
        return (f'<span style="display:inline-block;background:{bg};color:{fg};font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap">'
                f'<b style="color:{INK};font-size:14px">{ax["score"]:.1f}</b> {E(ax["level"])}</span>{arrow}')
    risk_html = ""
    if rmats:
        rows_h = "".join(
            f'<tr><td style="padding:10px 0 10px 16px;border-top:1px solid {LINE};font-size:14px;font-weight:700;color:{INK}">{E(m["short"])}</td>'
            f'<td style="padding:10px 6px;border-top:1px solid {LINE}">{rchip(m["h3"]["price"])}</td>'
            f'<td style="padding:10px 16px 10px 0;border-top:1px solid {LINE}">{rchip(m["h3"]["supply"])}</td></tr>' for m in rmats)
        risk_html = (f'<tr><td style="padding:2px 24px 0" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-radius:18px">'
                     f'<tr><td style="font-size:11px;color:{MUTED};text-transform:uppercase;letter-spacing:.6px;padding:14px 0 8px 16px">Material</td>'
                     f'<td style="font-size:11px;color:{MUTED};text-transform:uppercase;letter-spacing:.6px;padding:14px 6px 8px">Price risk</td>'
                     f'<td style="font-size:11px;color:{MUTED};text-transform:uppercase;letter-spacing:.6px;padding:14px 16px 8px 0">Supply risk</td></tr>{rows_h}'
                     f'<tr><td colspan="3" style="height:6px;font-size:0;line-height:0">&nbsp;</td></tr></table>'
                     f'<div style="font-size:12px;color:{MUTED};margin-top:10px">Scored 0–10 for the next 3 months (Low &lt;4, Elevated 4–6.4, High 6.5+); ▲▼ change in a week. '
                     f'<a href="{SITE}#risk" style="color:{ACCENT};font-weight:600;text-decoration:none">See what drives each score ›</a></div></td></tr>')

    news_html = ""
    if top:
        for n in top:
            c = CAT.get(n.get("category", ""), "#5f6e86")
            flag = (f'<span style="display:inline-block;background:#fdf0e1;color:{AMBER};font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px">Alert</span>' if n.get("alert") else "")
            news_html += (f'<tr><td style="padding:5px 24px" class="px">'
                          f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-left:3px solid {c};border-radius:14px">'
                          f'<tr><td style="padding:13px 16px">'
                          f'<div style="font-size:11.5px;font-weight:700;color:{c}">{E(n.get("category", ""))}{flag}<span style="color:{MUTED};font-weight:400"> · {E(n.get("day", ""))}</span></div>'
                          f'<div style="font-size:15px;line-height:1.45;color:{INK};margin-top:5px"><a href="{E(n["url"])}" style="color:{INK};text-decoration:none">{E(n["headline"])}</a></div>'
                          + (f'<div style="font-size:13.5px;line-height:1.45;color:{INK};margin-top:6px"><b>{E(SEG_LAB.get(n.get("seg"), "What it means"))}:</b> {E(n["so"])}</div>' if n.get("so") else "")
                          + f''
                          f'<div style="font-size:12.5px;margin-top:7px"><a href="{E(n["url"])}" style="color:{ACCENT};text-decoration:none;font-weight:600">Read on {E(n["source"])} ›</a></div>'
                          f'</td></tr></table></td></tr>')
    else:
        news_html = f'<tr><td style="padding:6px 24px;color:{MUTED};font-size:14px" class="px">No new stories in the last two days.</td></tr>'

    def datebox(top_line, bottom_line=""):
        return (f'<div style="background:{SOFT};color:{INK};font-weight:800;font-size:14px;text-align:center;border-radius:12px;padding:8px 4px;white-space:nowrap">{E(top_line)}'
                + (f'<div style="font-size:11px;font-weight:400;color:{MUTED};margin-top:1px">{E(bottom_line)}</div>' if bottom_line else "") + '</div>')

    up_html = ""
    for i, e in enumerate(up):
        ed = d(e["date"])
        if e.get("end") and ed <= today:
            when, chip, yr = "On now", f"{ed.day} {ed.strftime('%b')}", str(ed.year)
        elif e.get("precision") == "month":
            n_days = (ed - today).days
            when, chip, yr = (f"In about {max(1, round(n_days / 30))} month{'s' if round(n_days / 30) > 1 else ''}" if n_days > 31 else "This month"), ed.strftime("%b"), str(ed.year)
        else:
            n_days = (ed - today).days
            when = "Today" if n_days == 0 else "Tomorrow" if n_days == 1 else f"In {n_days} days"
            chip, yr = f"{ed.day} {ed.strftime('%b')}", str(ed.year)
        soon = (ed - today).days <= 7
        up_html += (f'<tr><td style="padding:0 24px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                    f'<td width="68" valign="top" style="padding:12px 0;{"" if i == 0 else f"border-top:1px solid {LINE};"}">{datebox(chip, yr)}</td>'
                    f'<td valign="top" style="padding:12px 0 12px 14px;{"" if i == 0 else f"border-top:1px solid {LINE};"}">'
                    f'<div style="font-size:12px;font-weight:700;color:{RED if soon else MUTED}">{E(when)} <span style="font-weight:400;color:{MUTED}">&nbsp;{E(e.get("kind", ""))}</span></div>'
                    f'<div style="font-size:14.5px;color:{INK};line-height:1.45;margin-top:3px"><a href="{E(e["url"])}" style="color:{INK};text-decoration:none">{E(e["what"])}</a></div>'
                    f'<div style="font-size:12px;margin-top:4px"><a href="{E(e["url"])}" style="color:{MUTED}">{E(e["source"])}</a></div>'
                    f'</td></tr></table></td></tr>')

    # rules coming up: the next three regulation dates (skip one already listed above as a rule change on the same day)
    shown = {e["date"] for e in up if "rule" in e.get("kind", "").lower()}
    rules_up = [r for r in sorted(load("regulations", []) or [], key=lambda r: r["date"]) if d(r["date"]) >= today and r["date"] not in shown][:3]
    STC = {"In force": BLUE, "Starts later": "#c27c02", "Paused": "#8a4fb8", "Proposed": "#5f6e86", "Bids under evaluation": "#0f8a80"}
    rules_html = ""
    for i, r in enumerate(rules_up):
        rd = d(r["date"]); n_days = (rd - today).days
        when = "Today" if n_days == 0 else "Tomorrow" if n_days == 1 else f"In {n_days} days" if n_days < 60 else f"In about {round(n_days / 30)} months"
        c = STC.get(r.get("status"), "#5f6e86")
        bt = "" if i == 0 else f"border-top:1px solid {LINE};"
        rlab = f"{rd.day} {rd.strftime('%b')}"
        rules_html += (f'<tr><td style="padding:0 24px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                       f'<td width="68" valign="top" style="padding:12px 0;{bt}">{datebox(rlab, str(rd.year))}</td>'
                       f'<td valign="top" style="padding:12px 0 12px 14px;{bt}">'
                       f'<div style="font-size:12px;font-weight:700;color:{RED if n_days <= 30 else MUTED}">{E(when)} <span style="display:inline-block;background:{SOFT};color:{c};font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;margin-left:4px">{E(r["status"])}</span></div>'
                       f'<div style="font-size:14.5px;font-weight:700;color:{INK};line-height:1.4;margin-top:3px"><a href="{E(r["url"])}" style="color:{INK};text-decoration:none">{E(r.get("short") or r["title"])}</a></div>'
                       f'<div style="font-size:12px;color:{MUTED};margin-top:3px">{E(r["region"])} · <a href="{E(r["url"])}" style="color:{MUTED}">{E(r["source"])}</a></div>'
                       f'</td></tr></table></td></tr>')
    if rules_html:
        rules_html += f'<tr><td style="padding:6px 24px 0;font-size:12.5px" class="px"><a href="{SITE}#rules" style="color:{ACCENT};font-weight:600;text-decoration:none">All regulations and what they mean ›</a></td></tr>'

    alert_html = ""
    if uniq:
        alert_html = (f'<tr><td style="padding:2px 24px 10px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-radius:16px">'
                      f'<tr><td style="padding:13px 16px;font-size:14px;color:{INK};line-height:1.5"><b style="color:{AMBER}">⚠ Price alert</b>&nbsp; {E(" · ".join(uniq))}</td></tr></table></td></tr>')

    def chips(n, mx=2):
        out = ""
        for x in (n.get("impact") or [])[:mx]:
            lab = IMPACT_LAB.get(x.get("k"), {}).get(x.get("s"))
            if not lab:
                continue
            lab = lab.replace("{w}", SEG_WORD.get(n.get("seg"), "market"))
            bg, fg = (("#ececf0", MUTED) if x.get("k") == "competition" or not x["s"] else ("#e3f4ea", GREEN) if x["s"] > 0 else ("#fde4e1", RED))
            out += f'<span style="display:inline-block;background:{bg};color:{fg};font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin:0 4px 4px 0;white-space:nowrap">{E(lab)}</span>'
        return out

    # one bottom line from the data: where cell costs are going, and the most pressing date
    bl = []
    if "fut" in R and R["fut"]["wchg"] is not None:
        c = R["fut"]["wchg"]
        bl.append("Lithium is steady, so cell costs hold" if abs(c) < 2 else (f"Lithium is down {abs(c):.0f}% on the week, so cell costs keep easing" if c < 0 else f"Lithium is up {c:.0f}% on the week, a risk for cell costs"))
    key_date = next((e for e in nextd if (e.get("weight") or 0) >= 3), None)
    if key_date:
        nd = (d(key_date["date"]) - today).days
        bl.append(f'{key_date.get("short") or key_date["what"]} {"today" if nd <= 0 else "tomorrow" if nd == 1 else f"in {nd} days"}')
    bottom = ". ".join(bl) + ("." if bl else "")

    forus_html = ""
    for n in forus:
        bc = {"EVs": L[0], "Batteries": L[2], "BESS": L[4]}.get(n.get("seg"), LINE)
        forus_html += (f'<tr><td style="padding:5px 24px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border-left:3px solid {bc};border-radius:14px">'
                       f'<tr><td style="padding:12px 16px">'
                       f'<div><span style="font-size:11.5px;font-weight:800;color:{bc};margin-right:6px">{E(SEG_LAB.get(n.get("seg"), ""))}</span>{chips(n)}<span style="font-size:11.5px;color:{MUTED}">{E(n.get("day", ""))}</span></div>'
                       f'<div style="font-size:15px;font-weight:700;line-height:1.45;color:{INK};margin-top:2px">{E(n["so"])}</div>'
                       f'<div style="font-size:12.5px;line-height:1.45;color:{MUTED};margin-top:5px"><a href="{E(n["url"])}" style="color:{MUTED};text-decoration:none">{E(n.get("short") or n["headline"])}</a> · <a href="{E(n["url"])}" style="color:{ACCENT};text-decoration:none;font-weight:600">{E(n["source"])} ›</a></div>'
                       f'</td></tr></table></td></tr>')

    soon_html = ""
    for i, e in enumerate(nextd):
        nd = (d(e["date"]) - today).days
        big = "Today" if nd <= 0 else str(nd)
        unit_ = "" if nd <= 0 else ("day" if nd == 1 else "days")
        hot = (e.get("weight") or 0) >= 3
        bt = "" if i == 0 else f"border-top:1px solid {LINE};"
        us_line = (f'<div style="font-size:13px;color:{INK};line-height:1.45;margin-top:4px">{E(e.get("so", ""))}</div>' if hot and e.get("so") else "")
        soon_html += (f'<tr><td style="padding:0 24px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                      f'<td width="58" valign="top" align="center" style="padding:12px 0;{bt}"><div style="font-size:{22 if nd > 0 else 14}px;font-weight:800;color:{AMBER if hot else INK};line-height:1">{big}</div>'
                      f'<div style="font-size:11px;color:{MUTED};margin-top:2px">{unit_}</div></td>'
                      f'<td valign="top" style="padding:12px 0 12px 12px;{bt}"><div style="font-size:14.5px;font-weight:700;color:{INK};line-height:1.4"><a href="{E(e.get("url", ""))}" style="color:{INK};text-decoration:none">{E(e.get("short") or e["what"])}</a></div>'
                      f'<div style="font-size:12px;color:{MUTED};margin-top:2px">{d(e["date"]).day} {d(e["date"]).strftime("%b")} · {E(e.get("kind", ""))} · <a href="{E(e.get("url", ""))}" style="color:{MUTED}">{E(e.get("source", ""))}</a></div>{us_line}'
                      f'</td></tr></table></td></tr>')

    # key prices: one comparison (about a week back), and where each is heading
    OLM = {"fut": "lithium", "cell": "cell_ess", "ev": "cell_ev"}
    ktiles = []
    for k in ("fut", "cell", "ev", "sys"):
        if k not in R:
            continue
        r = R[k]
        sub = ""
        if k == "fut" and "spot" in R:
            sub = f'China spot {R["spot"]["wvalue"]} ({R["spot"]["wdate"]})'
        if k == "ev":
            sub = f"230 Ah ≈ ${r['wnum'] * 0.736:,.0f} · 324 Ah ≈ ${r['wnum'] * 1.043:,.0f} a cell"
        ol = outlook(OLM.get(k, ""))
        oltxt = ""
        if ol:
            yr, mid, lo, hi, _now = ol
            f_ = (lambda v: f"${v / 1000:.1f}k") if hi >= 10000 else (lambda v: f"${v:,.0f}") if hi >= 1000 else (lambda v: f"${v:,.1f}")
            oltxt = f"{yr}: about {f_(mid)} · range {f_(lo)}–{f_(hi)}"
        ktiles.append(tile(names[k], r["wvalue"], r["unit"], r["wchg"], r["wdate"], r["wurl"], r["wvs"], sub, tcol[k], oltxt, beyond.get(k, "")))
    if len(ktiles) % 2:
        ktiles.append('<td class="tile" width="50%"></td>')
    ktile_rows = "".join(f"<tr>{ktiles[i]}{ktiles[i + 1]}</tr>" for i in range(0, len(ktiles), 2))

    strip = "".join(f'<td width="20%" style="height:4px;background:{c};font-size:0;line-height:0">&nbsp;</td>' for c in L)

    # NOTE: the hidden preview line below must keep ending with the words "Leyland Pulse briefing".
    # Aniket's Power Automate flow cuts everything above them, which removes the company's
    # external-sender CAUTION box before forwarding the digest to the team.
    logo = f"{SITE}assets/email-mark.png"
    mq = ("@media (max-width:520px){ .tile { display:block !important; width:100% !important; } .px { padding-left:16px !important; padding-right:16px !important; } "
          ".dsk { display:none !important; } .mob { display:block !important; max-height:none !important; overflow:visible !important; } .hero { font-size:26px !important; } }")
    body_html = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>{mq}</style></head>
<body style="margin:0;padding:0;background:{BG}">
<!--LP-BODY-START--><div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:{BG};opacity:0">{E(" ".join(note.split()[:28])) if note else "Battery prices, risk scores and news"} - Leyland Pulse briefing</div><style>{mq}</style>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};font-family:{FONT}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden">
<tr><td style="padding:20px 24px 18px" class="px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td valign="middle" width="50"><img src="{logo}" width="44" height="44" alt="" style="display:block;border:0"></td>
  <td valign="middle" style="padding-left:8px"><div style="font-size:24px;line-height:1.05;letter-spacing:-0.4px;white-space:nowrap"><span style="font-weight:800;color:{INK}">LeyBatt</span><span style="font-family:'Segoe UI Light','Segoe UI',Helvetica,Arial,sans-serif;font-weight:300;color:{TEAL};padding-left:4px">Pulse</span></div>
   <div style="font-size:10px;font-weight:600;color:{MUTED};margin-top:5px;letter-spacing:2.2px;text-transform:uppercase">Battery market intelligence</div></td>
  <td valign="middle" align="right"><span style="display:inline-block;background:{SOFT};color:{INK};font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px;white-space:nowrap">{E(date_label)}</span></td>
 </tr></table></td></tr>
<tr><td style="padding:0;font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>{strip}</tr></table></td></tr>
{section("Key prices", "Latest reading, change on about a week earlier, and the base-scenario outlook.")}
{alert_html}
<tr><td style="padding:0 18px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{ktile_rows}</table></td></tr>
<tr><td style="padding:8px 24px 0;font-size:12px;color:{MUTED};line-height:1.5" class="px">Lithium is a China price including 13% VAT; cells and systems exclude it. Outlook: middle of the simulated yearly average and the range 8 in 10 outcomes fall in, not a prediction. <a href="{SITE}#risk" style="color:{ACCENT};font-weight:600;text-decoration:none">How the outlook works ›</a></td></tr>
<tr><td style="padding:26px 24px 4px" class="px">
 <div style="font-size:12px;font-weight:700;color:{ACCENT};letter-spacing:1.4px;text-transform:uppercase">What matters today</div>
 <div class="hero" style="font-size:24px;font-weight:800;color:{INK};letter-spacing:-0.6px;line-height:1.25;margin-top:8px">{E(bottom) if bottom else "Today's battery market."}</div></td></tr>
{forus_html}
<tr><td style="padding:6px 24px 0;font-size:12.5px" class="px"><a href="{SITE}#news" style="color:{ACCENT};font-weight:600;text-decoration:none">All stories, most important first ›</a></td></tr>
{section("Next 14 days") if soon_html else ""}
{soon_html}
{section("Risk navigator") if risk_html else ""}
{risk_html}
{section("More news") if top else ""}
{news_html if top else ""}
{section("Rules coming up") if rules_html else ""}
{rules_html}
<tr><td align="center" style="padding:34px 24px 10px"><a href="{SITE}" style="display:inline-block;background:{ACCENT};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:999px">Open LeyBatt Pulse ›</a>
 <div style="font-size:12.5px;color:{MUTED};margin-top:10px">Charts, the full value chain, all news and the cost calculator</div></td></tr>
<tr><td style="padding:20px 24px 24px;font-size:11.5px;line-height:1.5;color:{MUTED};text-align:center" class="px">
 LeyBatt Pulse is an automated daily digest built from public sources every morning at about 5:15 am IST.</td></tr>
</table></td></tr></table><!--LP-BODY-END--></body></html>"""
    # plain-text version
    t = [f"LeyBatt Pulse | Daily | {date_label}", ""]
    t += ["Key prices (change on about a week earlier):"]
    if uniq:
        t.append("PRICE ALERT: " + "; ".join(uniq))
    for k in ("fut", "cell", "ev", "sys"):
        if k in R:
            r = R[k]
            t.append(f"- {names[k]}: {r['wvalue']}{r['unit']} ({'–' if r['wchg'] is None else signed(r['wchg']) + ' ' + r['wvs']}) {r['wdate']}")
    t.append("")
    if bottom:
        t += ["WHAT MATTERS TODAY: " + bottom, ""]
    for n in forus:
        t.append(f"- {SEG_LAB.get(n.get('seg'), '')}: {n['so']} ({n.get('short') or n['headline']}; {n['source']}: {n['url']})")
    if nextd:
        t += ["", "Next 14 days:"] + [f"- {e['date']}: {e.get('short') or e['what']}" for e in nextd]
    if note:
        t += ["", note]
    for r in []:
        ch = "–" if r["chg"] is None else signed(r["chg"]) + (" " + r["vs"] if r["vs"] else "")
        t.append(f"- {r['label']}: {r['value']}{r['unit']} ({ch}) {r['date']}{'' if r['new'] else ', no new reading'}")
    if rmats:
        fmt = lambda ax: "not scored" if ax.get("score") is None else f"{ax['score']:.1f} {ax['level']}"  # noqa: E731
        t += ["", "Risk navigator (next 3 months, 0-10):"] + [f"- {m['short']}: price {fmt(m['h3']['price'])}, supply {fmt(m['h3']['supply'])}" for m in rmats] + [f"  Details: {SITE}#risk"]
    if top:
        t += ["", "More news:"] + [f"- {n['headline']}" + (f" {SEG_LAB.get(n.get('seg'), 'What it means')}: {n['so']}" if n.get("so") else "") + f" ({n['source']}: {n['url']})" for n in top]
    if rules_up:
        t += ["", "Rules coming up:"] + [f"- {r['date']}: {r.get('short') or r['title']} ({r['region']}, {r['status']})" for r in rules_up] + [f"  Details: {SITE}#rules"]
    t += ["", f"Full prices, charts and cost calculator: {SITE}", "", "LeyBatt Pulse — automated daily digest from public sources."]
    return subject, body_html, "\n".join(t)


def main():
    today = dt.datetime.now(IST).date()
    subject, body_html, body_text = build(today)
    if len(sys.argv) > 2 and sys.argv[1] == "--dry-run":
        Path(sys.argv[2]).write_text(body_html, encoding="utf-8")
        print("SUBJECT:", subject)
        return
    user, pw = os.environ.get("GMAIL_USER", "").strip(), os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    # accept commas, semicolons, spaces or new lines between addresses; drop anything that is not an address
    raw = [x.strip(" <>\"'") for x in re.split(r"[,;\s]+", os.environ.get("MAIL_TO", "")) if x.strip()]
    ok = [x for x in raw if re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", x)]
    bad = len(raw) - len(ok)
    to = []
    for x in ok:  # an address typed twice gets one email
        if x.lower() not in [y.lower() for y in to]:
            to.append(x)
    if bad:
        print(f"::warning::Ignored {bad} entr{'y' if bad == 1 else 'ies'} in MAIL_TO that did not look like an email address.")
    # GMAIL_USER must be one address (the sender). If several were entered, use the first to log in
    # and treat the rest as extra recipients, so a mix-up between the two secrets still delivers.
    users = [x.strip(" <>\"'") for x in re.split(r"[,;\s]+", user) if x.strip()]
    users = [x for x in users if re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", x)]
    if not users:
        print("::error::Email not sent: GMAIL_USER does not contain a valid Gmail address.")
        sys.exit(1)
    user = users[0]
    if len(users) > 1:
        print(f"::warning::GMAIL_USER had {len(users)} addresses; used the first to send and added the others to the recipients. Put recipients only in MAIL_TO.")
        to += [x for x in users[1:] if x.lower() not in [y.lower() for y in to]]
    only = [x.strip(" <>\"'") for x in re.split(r"[,;\s]+", os.environ.get("ONLY_TO", "")) if x.strip()]
    only = [x for x in only if re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", x)]
    test = bool(only)
    if os.environ.get("ONLY_TO", "").strip() and not test:
        print("::error::Email not sent: 'Send only to' was filled in but is not an email address.")
        sys.exit(1)
    if test:  # a manual test run: send only to the address(es) typed in, not to everyone in MAIL_TO
        to = only
    if os.environ.get("CHECK_ONLY", "").lower() == "true":
        print(f"::notice::Check only, nothing sent: the email would go to {len(to)} recipient(s).")
        return
    subject = " ".join(subject.split())
    if not (user and pw and to):
        missing = [n for n, v in (("GMAIL_USER", user), ("GMAIL_APP_PASSWORD", pw), ("MAIL_TO", to)) if not v]
        print(f"::error::Email not sent: these repository secrets are missing or empty: {', '.join(missing)}")
        sys.exit(1)
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"LeyBatt Pulse <{user}>"
        msg["To"] = user
        msg["Bcc"] = ", ".join(to)
        msg.set_content(body_text)
        msg.add_alternative(body_html, subtype="html")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as s:
            s.login(user, pw)
            refused = s.send_message(msg)
        if refused:
            print(f"::warning::Gmail refused {len(refused)} recipient address(es); check MAIL_TO for typos.")
    except smtplib.SMTPAuthenticationError:
        print("::error::Gmail refused the login: check GMAIL_USER and that GMAIL_APP_PASSWORD is a current 16-letter app password (2-Step Verification must be on).")
        sys.exit(1)
    except Exception as e:  # report the kind of failure without exposing secrets
        print(f"::error::Email not sent: {type(e).__name__}: {str(e)[:200]}")
        sys.exit(1)
    print(f"::notice::Sent '{subject}' to {len(to)} recipient(s){' (test: only the address typed in)' if test else ''}.")


if __name__ == "__main__":
    main()
