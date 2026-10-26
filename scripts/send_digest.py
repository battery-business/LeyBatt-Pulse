#!/usr/bin/env python3
"""Battery Pulse daily email digest.

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
    # a reading counts as new if it was published today or yesterday (IST); older readings were already in an earlier email
    fresh_from = (today - dt.timedelta(days=1)).isoformat()
    latest = {r["id"]: r for r in (load("latest", []) or [])}

    rows, alerts = [], []
    for key, (label, unit, pts) in S.items():
        if not pts:
            continue
        last = pts[-1]
        prev = next((p for p in reversed(pts[:-1]) if p[0] < last[0]), None)
        chg = pct(last[1], prev[1]) if prev else None
        gap = (d(last[0]) - d(prev[0])).days if prev else 0
        vs = ""
        if gap > 21:
            # our own history has a gap (e.g. TrendForce EV cells): use the source's own change on its previous reading
            card = latest.get({"ev": "evcell"}.get(key, ""), {})
            m = re.search(r"([+−-]?)(\d+(?:\.\d+)?)%", card.get("move", ""))
            if m:
                chg = float(m.group(2)) * (-1 if m.group(1) in "−-" and m.group(1) else 1)
            else:
                vs = f"since {day(prev[0])}"
        new = last[0] >= fresh_from
        fmt = (lambda v: f"${v:,.0f}") if unit == "/t" else (lambda v: f"${v:,.1f}")
        rows.append({"key": key, "label": label, "value": fmt(last[1]), "unit": unit, "num": last[1], "chg": chg, "vs": vs,
                     "date": day(last[0]), "new": new, "source": last[2], "url": last[3]})
        # alert rules: only on a reading this email is reporting for the first time
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

    date_label = f"{today.strftime('%a')} {today.day} {today.strftime('%b %Y')}"
    seen, uniq = set(), []
    for a in alerts:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    subject = f"Battery Pulse | Daily | {today.day} {today.strftime('%b')}"
    note = meta.get("note", "")

    # ---------- HTML (email-safe: tables and inline styles only) ----------
    E = html.escape
    NAVY, INK2, MUTED, LINE, BG, LIME, GREEN, AMBER, BLUE = "#0e1a2b", "#1c2c4f", "#5b6b80", "#e3e8ef", "#eef2f7", "#c4f23a", "#1f7a4d", "#b45309", "#1652f0"
    FONT = "'Segoe UI',Helvetica,Arial,sans-serif"
    CAT = {"Lithium & materials": "#c27c02", "Cell makers & competitors": "#1f5bd8", "Packs & BMS": "#c8571b", "R&D & new products": "#0f8a80",
           "Energy storage": "#4a55c4", "EV market": "#2f8a4f", "India BESS": "#c2415d", "India EV & battery makers": "#a8388a", "Regulation & trade": "#8a4fb8"}

    def pill(chg, vs=""):
        if chg is None:
            return f'<span style="color:{MUTED};font-size:12px">–</span>'
        if abs(chg) < 0.05:
            bg, fg, txt = "#eef1f5", MUTED, "no change"
        elif chg < 0:
            bg, fg, txt = "#e3f4ea", GREEN, f"▼ {abs(chg):.1f}%"
        else:
            bg, fg, txt = "#fdf0e1", AMBER, f"▲ {abs(chg):.1f}%"
        extra = f' <span style="color:{MUTED};font-size:11px">{E(vs)}</span>' if vs else ""
        return f'<span style="display:inline-block;background:{bg};color:{fg};font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap">{txt}</span>{extra}'

    def tile(label, value, unit, chg, when, url, vs="", sub=""):
        return (f'<td class="tile" width="50%" valign="top" style="padding:6px">'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid {LINE};border-radius:12px">'
                f'<tr><td style="padding:12px 14px">'
                f'<div style="font-size:12px;color:{MUTED};line-height:1.3">{E(label)}</div>'
                f'<div style="font-size:24px;font-weight:800;color:{NAVY};letter-spacing:-0.3px;line-height:1.25;margin-top:4px">{E(value)}<span style="font-size:13px;font-weight:600;color:{MUTED}">{E(unit)}</span></div>'
                + (f'<div style="font-size:12px;color:{MUTED};margin-top:2px">{E(sub)}</div>' if sub else "")
                + f'<div style="margin-top:8px">{pill(chg, vs)}</div>'
                f'<div style="font-size:11.5px;color:{MUTED};margin-top:6px"><a href="{E(url)}" style="color:{MUTED};text-decoration:underline">{E(when)}</a></div>'
                f'</td></tr></table></td>')

    R = {r["key"]: r for r in rows}
    tiles = []
    names = {"fut": "Lithium carbonate futures", "spot": "Lithium carbonate spot", "cell": "314 Ah storage cell", "ev": "EV prismatic LFP cell", "sys": "4-hour storage system (China)"}
    for k in ("fut", "spot", "cell", "ev", "sys"):
        if k in R:
            r = R[k]
            when = r["date"] + ("" if r["new"] else " · no new reading")
            sub = f"230 Ah ≈ ${r['num'] * 0.736:,.2f} · 324 Ah ≈ ${r['num'] * 1.043:,.2f} per cell" if k == "ev" else ""
            tiles.append(tile(names[k], r["value"], r["unit"], r["chg"], when, r["url"], r["vs"], sub))
    if len(tiles) % 2:
        tiles.append(f'<td class="tile" width="50%" valign="top" style="padding:6px">'
                     f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{NAVY};border-radius:12px"><tr><td style="padding:14px">'
                     f'<div style="font-size:12px;color:#9fb0c6">Lower is better for a buyer</div>'
                     f'<div style="font-size:14px;color:#ffffff;font-weight:700;margin-top:6px;line-height:1.4">Green ▼ means cheaper,<br>amber ▲ means dearer</div>'
                     f'<div style="font-size:11.5px;color:#9fb0c6;margin-top:8px">US$, China prices excluding VAT</div></td></tr></table></td>')
    tile_rows = "".join(f"<tr>{tiles[i]}{tiles[i + 1]}</tr>" for i in range(0, len(tiles), 2))

    def section(title):
        return (f'<tr><td style="padding:22px 24px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="width:4px;background:{LIME};border-radius:2px">&nbsp;</td>'
                f'<td style="padding-left:10px;font-size:17px;font-weight:800;color:{NAVY}">{E(title)}</td></tr></table></td></tr>')

    news_html = ""
    if top:
        for n in top:
            c = CAT.get(n.get("category", ""), "#5f6e86")
            flag = (f'<span style="display:inline-block;background:#fdf0e1;color:{AMBER};font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px">Alert</span>' if n.get("alert") else "")
            news_html += (f'<tr><td style="padding:6px 24px">'
                          f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid {LINE};border-left:4px solid {c};border-radius:10px">'
                          f'<tr><td style="padding:11px 14px">'
                          f'<div style="font-size:11.5px;font-weight:700;color:{c}">{E(n.get("category", ""))}{flag}<span style="color:{MUTED};font-weight:400"> · {E(n.get("day", ""))}</span></div>'
                          f'<div style="font-size:14.5px;line-height:1.45;color:{NAVY};margin-top:4px">{E(n["headline"])}</div>'
                          f'<div style="font-size:12px;margin-top:6px"><a href="{E(n["url"])}" style="color:{BLUE};text-decoration:none;font-weight:600">Read on {E(n["source"])} →</a></div>'
                          f'</td></tr></table></td></tr>')
    else:
        news_html = f'<tr><td style="padding:6px 24px;color:{MUTED};font-size:14px">No new stories in the last two days.</td></tr>'

    up_html = ""
    for e in up:
        ed = d(e["date"])
        if e.get("end") and ed <= today:
            when, chip = "On now", f"{ed.day} {ed.strftime('%b')}"
        elif e.get("precision") == "month":
            n_days = (ed - today).days
            when, chip = (f"In about {max(1, round(n_days / 30))} month{'s' if round(n_days / 30) > 1 else ''}" if n_days > 31 else "This month"), ed.strftime("%b %y")
        else:
            n_days = (ed - today).days
            when = "Today" if n_days == 0 else "Tomorrow" if n_days == 1 else f"In {n_days} days"
            chip = f"{ed.day} {ed.strftime('%b')}"
        soon = (ed - today).days <= 7
        up_html += (f'<tr><td style="padding:6px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                    f'<td width="64" valign="top"><div style="background:{NAVY};color:{LIME};font-weight:800;font-size:13px;text-align:center;border-radius:8px;padding:8px 4px;white-space:nowrap">{E(chip)}</div></td>'
                    f'<td valign="top" style="padding-left:12px">'
                    f'<div style="font-size:12px;font-weight:700;color:{"#b42318" if soon else MUTED}">{E(when)} · <span style="font-weight:400;color:{MUTED}">{E(e.get("kind", ""))}</span></div>'
                    f'<div style="font-size:14px;color:{NAVY};line-height:1.4;margin-top:2px">{E(e["what"])}</div>'
                    f'<div style="font-size:12px;margin-top:2px"><a href="{E(e["url"])}" style="color:{MUTED}">{E(e["source"])}</a></div>'
                    f'</td></tr></table></td></tr>')

    alert_html = ""
    if uniq:
        alert_html = (f'<tr><td style="padding:18px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f59e0b;border-radius:10px">'
                      f'<tr><td style="padding:12px 14px;font-size:14px;color:{NAVY}"><b style="color:{AMBER}">⚠ Alert</b>&nbsp; {E(" · ".join(uniq))}</td></tr></table></td></tr>')

    logo = f"{SITE}assets/email-mark.png"
    body_html = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<style>@media (max-width:520px){{ .tile {{ display:block !important; width:100% !important; }} .px {{ padding-left:16px !important; padding-right:16px !important; }} }}</style></head>
<body style="margin:0;padding:0;background:{BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};font-family:{FONT}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid {LINE}">
<tr><td style="background:{NAVY};padding:22px 24px 18px" class="px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td valign="middle" width="56"><img src="{logo}" width="46" height="28" alt="" style="display:block;border:0"></td>
  <td valign="middle" style="padding-left:10px"><div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;line-height:1.1">Battery Pulse</div>
   <div style="font-size:12.5px;color:#9fb0c6;margin-top:4px">Daily battery market intelligence</div></td>
  <td valign="middle" align="right"><span style="display:inline-block;background:{LIME};color:{NAVY};font-size:12px;font-weight:800;padding:5px 10px;border-radius:999px;white-space:nowrap">{E(date_label)}</span></td>
 </tr></table></td></tr>
<tr><td style="height:4px;background:{LIME};font-size:0;line-height:0">&nbsp;</td></tr>
{alert_html}
<tr><td style="padding:18px 24px 4px;font-size:15px;line-height:1.6;color:{NAVY}" class="px">{E(note) if note else "Here are today's battery market prices and news."}</td></tr>
{section("Prices")}
<tr><td style="padding:0 18px" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{tile_rows}</table></td></tr>
{section("Top news")}
{news_html}
{section("Coming up") if up_html else ""}
{up_html}
<tr><td align="center" style="padding:26px 24px 8px"><a href="{SITE}" style="display:inline-block;background:{LIME};color:{NAVY};font-size:15px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:10px">Open Battery Pulse →</a>
 <div style="font-size:12px;color:{MUTED};margin-top:8px">Charts, the full price map, all news and the cost calculator</div></td></tr>
<tr><td style="padding:18px 24px 22px;background:#f6f8fb;border-top:1px solid {LINE};font-size:11.5px;line-height:1.5;color:{MUTED}" class="px">
 Battery Pulse is an automated daily digest built from public sources every morning at about 5:15 am IST. Check the original source before relying on a figure.</td></tr>
</table></td></tr></table></body></html>"""
    # plain-text version
    t = [f"Battery Pulse | Daily | {date_label}", ""]
    if uniq:
        t += ["ALERT: " + "; ".join(uniq), ""]
    if note:
        t += [note, ""]
    for r in rows:
        ch = "–" if r["chg"] is None else signed(r["chg"]) + (" " + r["vs"] if r["vs"] else "")
        t.append(f"- {r['label']}: {r['value']}{r['unit']} ({ch}) {r['date']}{'' if r['new'] else ', no new reading'}")
    t += ["", "Top news:"] + ([f"- {n['headline']} ({n['source']}: {n['url']})" for n in top] or ["- No new stories in the last two days."])
    if up:
        t += ["", "Coming up:"] + [f"- {e['date']}: {e['what']}" for e in up]
    t += ["", f"Full prices, charts and cost calculator: {SITE}", "", "Battery Pulse — automated daily digest from public sources. Check the original source before relying on a figure."]
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
        msg["From"] = f"Battery Pulse <{user}>"
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
