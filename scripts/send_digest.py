#!/usr/bin/env python3
"""Battery IQ daily email digest.

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
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = "https://kaniket796.github.io/battery-monitor/"
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


def series_points():
    """Return {key: (label, unit, [(date, value, source, url), ...])} sorted by date."""
    out = {}
    lith = load("lithium", [])
    for key, ser, label in (("fut", "Futures", "Lithium carbonate futures"), ("spot", "Spot", "Lithium carbonate spot")):
        pts = [(r["date"], float(r["usd_t"]), r.get("source", ""), r.get("url", "")) for r in lith if r.get("series") == ser]
        pts.sort(key=lambda p: p[0])
        out[key] = (label, "/t", pts)
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
    # a reading counts as new if it was published since the last trading day (Friday's close is still new on Monday)
    fresh_from = (today - dt.timedelta(days=3 if today.weekday() == 0 else 2)).isoformat()

    rows, alerts = [], []
    for key, (label, unit, pts) in S.items():
        if not pts:
            continue
        last = pts[-1]
        prev = next((p for p in reversed(pts[:-1]) if p[0] < last[0]), None)
        chg = pct(last[1], prev[1]) if prev else None
        gap = (d(last[0]) - d(prev[0])).days if prev else 0
        new = last[0] >= fresh_from
        fmt = (lambda v: f"${v:,.0f}") if unit == "/t" else (lambda v: f"${v:,.1f}")
        extra = ""
        if key == "ev":
            extra = f" · 230 Ah ≈ ${last[1] * 0.736:,.2f}/cell · 324 Ah ≈ ${last[1] * 1.043:,.2f}/cell"
        rows.append({"label": label, "value": fmt(last[1]) + unit, "chg": chg, "vs": (f"since {day(prev[0])}" if gap > 21 else ""), "date": day(last[0]), "new": new,
                     "source": last[2], "url": last[3], "extra": extra})
        # alert rules
        if new and chg is not None and gap <= 21:
            limit = 5 if key in ("fut", "spot") else 3
            if abs(chg) >= limit:
                short = {"fut": "Lithium futures", "spot": "Lithium spot", "cell": "314 Ah cell", "ev": "EV cell", "sys": "4-h system"}[key]
                alerts.append(f"{short} {signed(chg)}")
            elif key in ("fut", "spot"):
                wk = value_on_or_before(pts, (d(last[0]) - dt.timedelta(days=7)).isoformat())
                if wk and abs(pct(last[1], wk[1])) >= 10:
                    alerts.append(f"{'Lithium futures' if key == 'fut' else 'Lithium spot'} {signed(pct(last[1], wk[1]))} in a week")

    recent = [n for n in news if n.get("date", "") >= (today - dt.timedelta(days=2)).isoformat()]
    recent.sort(key=lambda n: (not n.get("alert", False), n.get("date", "")), reverse=False)
    recent = sorted(recent, key=lambda n: (0 if n.get("alert") else 1, "".join(chr(255 - ord(c)) for c in n.get("date", ""))))
    top = recent[:5]
    for n in news:
        if n.get("alert") and n.get("date", "") >= (today - dt.timedelta(days=1)).isoformat():
            alerts.append(n.get("alert_reason") or n.get("category", "News"))

    up = []
    for e in sorted(events, key=lambda e: e["date"]):
        end = d(e.get("end", e["date"]))
        if e.get("precision") == "month":
            nxt = (d(e["date"]).replace(day=28) + dt.timedelta(days=4))
            end = nxt - dt.timedelta(days=nxt.day)
        if end >= today:
            up.append(e)
    up = up[:3]

    date_label = f"{today.day} {today.strftime('%b %Y')}"
    seen, uniq = set(), []
    for a in alerts:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    subject = (f"[ALERT] {', '.join(uniq[:2])} – " if uniq else "") + f"Battery IQ – {date_label}"

    # ---------- HTML ----------
    E = html.escape
    navy, muted, line, lime, green, amber = "#0e1a2b", "#566579", "#dde3eb", "#c4f23a", "#1f7a4d", "#b05f00"
    p = [f'<div style="font-family:Segoe UI,Arial,sans-serif;color:{navy};background:#ffffff;max-width:640px;margin:0 auto;padding:8px 4px;font-size:14px;line-height:1.5">']
    p.append(f'<div style="font-size:24px;font-weight:800;letter-spacing:-0.3px">Battery IQ</div>')
    p.append(f'<div style="height:4px;width:64px;background:{lime};border-radius:2px;margin:4px 0 6px"></div>')
    p.append(f'<div style="color:{muted};font-size:12.5px;margin-bottom:14px">Battery market intelligence · {E(date_label)}</div>')
    if uniq:
        p.append(f'<div style="background:#fff4e5;border:1px solid #f3c98b;border-radius:8px;padding:10px 12px;margin-bottom:12px"><b>Alert:</b> {E("; ".join(uniq))}</div>')
    note = meta.get("note", "")
    if note:
        p.append(f'<p style="margin:0 0 14px">{E(note)}</p>')
    p.append(f'<table style="border-collapse:collapse;width:100%;font-size:13.5px" cellpadding="0" cellspacing="0">')
    p.append(f'<tr><th align="left" style="padding:6px 8px;border-bottom:2px solid {navy}">Price</th><th align="right" style="padding:6px 8px;border-bottom:2px solid {navy}">Latest</th><th align="right" style="padding:6px 8px;border-bottom:2px solid {navy}">Change</th><th align="left" style="padding:6px 8px;border-bottom:2px solid {navy}">Date</th></tr>')
    for r in rows:
        if r["chg"] is None:
            ch, col = "–", muted
        else:
            ch, col = signed(r["chg"]) + (f'<div style="font-weight:400;font-size:11px">{E(r["vs"])}</div>' if r["vs"] else ""), (green if r["chg"] < 0 else amber if r["chg"] > 0 else muted)
        when = r["date"] + ("" if r["new"] else " · no new reading")
        p.append(f'<tr><td style="padding:7px 8px;border-bottom:1px solid {line}">{E(r["label"])}<div style="color:{muted};font-size:11.5px">{E(r["extra"].strip(" ·"))}</div></td>'
                 f'<td align="right" style="padding:7px 8px;border-bottom:1px solid {line};font-weight:700;white-space:nowrap">{E(r["value"])}</td>'
                 f'<td align="right" style="padding:7px 8px;border-bottom:1px solid {line};color:{col};font-weight:700;white-space:nowrap">{ch}</td>'
                 f'<td style="padding:7px 8px;border-bottom:1px solid {line};color:{muted};font-size:12.5px"><a href="{E(r["url"])}" style="color:{muted}">{E(when)}</a></td></tr>')
    p.append('</table>')
    p.append(f'<div style="color:{muted};font-size:11.5px;margin-top:4px">Change is against the previous reading. Lower is better for a buyer. US$, China prices excluding VAT.</div>')

    p.append(f'<h3 style="font-size:16px;margin:20px 0 6px">Top news</h3>')
    if top:
        p.append('<ul style="padding-left:18px;margin:0">')
        for n in top:
            p.append(f'<li style="margin:0 0 8px">{E(n["headline"])} <span style="color:{muted}">— <a href="{E(n["url"])}" style="color:#1652f0">{E(n["source"])}</a> · {E(n.get("category", ""))}</span></li>')
        p.append('</ul>')
    else:
        p.append(f'<p style="margin:0;color:{muted}">No new stories in the last two days.</p>')

    if up:
        p.append(f'<h3 style="font-size:16px;margin:18px 0 6px">Coming up</h3><ul style="padding-left:18px;margin:0">')
        for e in up:
            ed = d(e["date"])
            if e.get("end") and ed <= today:
                when = "on now"
            elif e.get("precision") == "month":
                when = ed.strftime("%b %Y")
            else:
                n_days = (ed - today).days
                when = f"{ed.day} {ed.strftime('%b %Y')} · in {n_days} day{'s' if n_days != 1 else ''}"
            p.append(f'<li style="margin:0 0 6px"><b>{E(when)}</b>: {E(e["what"])} <span style="color:{muted}">— <a href="{E(e["url"])}" style="color:#1652f0">{E(e["source"])}</a></span></li>')
        p.append('</ul>')

    p.append(f'<p style="margin:20px 0 6px"><a href="{SITE}" style="display:inline-block;background:{navy};color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:700">Open Battery IQ: prices, charts and cost calculator</a></p>')
    p.append(f'<p style="color:{muted};font-size:11.5px;margin:14px 0 0">Battery IQ — automated daily digest from public sources. Check the original source before relying on a figure.</p></div>')
    body_html = "".join(p)

    # plain-text version
    t = [f"Battery IQ — {date_label}", ""]
    if uniq:
        t += ["ALERT: " + "; ".join(uniq), ""]
    if note:
        t += [note, ""]
    for r in rows:
        ch = "–" if r["chg"] is None else signed(r["chg"]) + (" " + r["vs"] if r["vs"] else "")
        t.append(f"- {r['label']}: {r['value']} ({ch}) {r['date']}{'' if r['new'] else ', no new reading'}{(' — ' + r['extra'].strip(' ·')) if r['extra'] else ''}")
    t += ["", "Top news:"] + ([f"- {n['headline']} ({n['source']}: {n['url']})" for n in top] or ["- No new stories in the last two days."])
    if up:
        t += ["", "Coming up:"] + [f"- {e['date']}: {e['what']}" for e in up]
    t += ["", f"Full prices, charts and cost calculator: {SITE}", "", "Battery IQ — automated daily digest from public sources. Check the original source before relying on a figure."]
    return subject, body_html, "\n".join(t)


def main():
    today = dt.datetime.now(IST).date()
    subject, body_html, body_text = build(today)
    if len(sys.argv) > 2 and sys.argv[1] == "--dry-run":
        Path(sys.argv[2]).write_text(f"<!doctype html><meta charset=utf-8><title>{html.escape(subject)}</title>{body_html}", encoding="utf-8")
        print("SUBJECT:", subject)
        return
    user, pw = os.environ.get("GMAIL_USER", "").strip(), os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    to = [a.strip() for a in os.environ.get("MAIL_TO", "").split(",") if a.strip()]
    if not (user and pw and to):
        print("Email not sent: set the GMAIL_USER, GMAIL_APP_PASSWORD and MAIL_TO repository secrets.")
        sys.exit(1)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"Battery IQ <{user}>"
    msg["To"] = user
    msg["Bcc"] = ", ".join(to)
    msg.set_content(body_text)
    msg.add_alternative(body_html, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as s:
        s.login(user, pw)
        s.send_message(msg)
    print(f"Sent '{subject}' to {len(to)} recipient(s).")


if __name__ == "__main__":
    main()
