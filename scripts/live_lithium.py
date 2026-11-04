#!/usr/bin/env python3
"""Lithium carbonate futures during the trading day, for the website (data/live.json).

Browsers on some company networks cannot reach Sina Finance directly, so GitHub fetches the latest
5-minute bar of the Guangzhou main contract (LC0) every 15 minutes while the market is open, converts
it to US$ at the latest ECB rate (the same basis as the site's futures chart) and saves it here.
Run by .github/workflows/live.yml. Writes nothing if the feed does not answer.
"""
import csv
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "live.json"
UA = {"User-Agent": "Mozilla/5.0 (LeyBatt Pulse data job)", "Referer": "https://finance.sina.com.cn/"}
SRC = "Guangzhou Futures Exchange LC0 main contract, latest 5-minute price (via Sina Finance), at the ECB rate"
URL = "https://finance.sina.com.cn/futures/quotes/LC0.shtml"


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("gbk", "replace")


def minute_bar():
    """Latest 5-minute bar: (Beijing time 'YYYY-MM-DD HH:MM', close yuan/t)."""
    body = get("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_lc=/InnerFuturesNewService.getFewMinLine?symbol=LC0&type=5")
    data = json.loads(body[body.find("([") + 1: body.rfind("])") + 1])
    rows = [x for x in data if x.get("c") and x.get("d")]
    if not rows:
        raise ValueError("no bars")
    last = rows[-1]
    return str(last["d"])[:16], float(last["c"])


def main():
    try:
        when, cny = minute_bar()
    except Exception as e:  # noqa: BLE001
        print(f"::warning::5-minute bars: {type(e).__name__} {str(e)[:120]}; nothing written")
        return 0
    with open(ROOT / "data" / "history" / "fx.csv") as f:
        fx = [r for r in csv.DictReader(f) if r.get("usd_cny")]
    rate, rate_date = float(fx[-1]["usd_cny"]), fx[-1]["date"]
    day = when[:10]
    prev = None
    with open(ROOT / "data" / "history" / "lithium_futures.csv") as f:
        for r in csv.DictReader(f):
            if r.get("cny_t") and r["date"] < day:
                prev = (r["date"], float(r["cny_t"]))
    if prev and abs(cny / prev[1] - 1) > 0.15:  # Guangzhou's daily limit is well below this: treat as a bad reading
        print(f"::warning::{cny:,.0f} is more than 15% from the last close {prev[1]:,.0f}; nothing written")
        return 0
    bj = datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=8)))
    ist = bj.astimezone(timezone(timedelta(hours=5, minutes=30)))
    out = {"time_bj": when, "time_ist": ist.strftime("%Y-%m-%d %H:%M"), "day": day, "cny_t": cny, "usd_t": round(cny / rate),
           "rate": rate, "rate_date": rate_date, "source": SRC, "url": URL, "checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    if prev:
        out.update({"prev_date": prev[0], "prev_usd_t": round(prev[1] / rate), "chg_pct": round((cny / prev[1] - 1) * 100, 2)})
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    if old.get("time_bj") == out["time_bj"] and old.get("cny_t") == out["cny_t"]:
        print("No new price since the last check.")
        return 0
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"live.json: {when} Beijing, {cny:,.0f} yuan/t = ${out['usd_t']:,}/t")
    return 0


if __name__ == "__main__":
    sys.exit(main())
