"""Refresh long price histories for the Risk Navigator (run by GitHub Actions, which has open internet).

Writes data/history/<name>.csv with columns date,usd_t (one row per trading day or month).
Tries each source in turn and keeps the saved file if every source fails.
  copper, aluminium: LME cash settlement (daily, via Westmetall), else the World Bank Pink Sheet (monthly),
  else COMEX futures (Yahoo Finance), else IMF monthly via FRED
  lithium_futures   : Guangzhou Futures Exchange lithium carbonate main contract (LC0), daily close in yuan/t, via Sina
  fx                : ECB daily euro reference rates, turned into US$-rupee and US$-yuan cross rates
"""
import csv, io, json, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "history"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
LB_PER_T = 2204.62


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read().decode("utf-8", "replace")


def yahoo(symbol, factor):
    rows = []
    for host in ("query1", "query2"):
        try:
            status, body = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?range=10y&interval=1d")
            res = json.loads(body)["chart"]["result"][0]
            ts, close = res["timestamp"], res["indicators"]["quote"][0]["close"]
            rows = [(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), round(c * factor, 1)) for t, c in zip(ts, close) if c]
            if len(rows) > 200:
                return rows, f"Yahoo Finance {symbol}"
        except Exception as e:  # noqa: BLE001
            print(f"::warning::{host} {symbol}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def fred(series):
    try:
        status, body = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}")
        rd = csv.reader(io.StringIO(body)); next(rd)
        rows = [(d, round(float(v), 1)) for d, v in rd if v not in (".", "")]
        if len(rows) > 24:
            return rows, f"IMF via FRED {series} (monthly)"
    except Exception as e:  # noqa: BLE001
        print(f"::warning::FRED {series}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def stooq(symbol, factor):
    try:
        status, body = get(f"https://stooq.com/q/d/l/?s={symbol}&i=d")
        rd = csv.DictReader(io.StringIO(body))
        rows = [(r["Date"], round(float(r["Close"]) * factor, 1)) for r in rd if r.get("Close")]
        if len(rows) > 200:
            return rows[-2600:], f"Stooq {symbol}"
        print(f"::warning::Stooq {symbol}: only {len(rows)} rows; first bytes {body[:80]!r}")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::Stooq {symbol}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def westmetall(field):
    """Daily LME cash settlement prices (US$/t) from westmetall.com tables."""
    try:
        rows, body = [], ""
        this_year = datetime.now(timezone.utc).year
        pages = [f"https://www.westmetall.com/en/markdaten.php?action=table&field={field}"]
        pages += [f"https://www.westmetall.com/en/markdaten.php?action=table&field={field}&year={y}" for y in range(this_year - 8, this_year)]
        for url in pages:
            try:
                status, page = get(url)
            except Exception as e:  # noqa: BLE001
                print(f"::warning::Westmetall {url[-30:]}: {type(e).__name__}"); continue
            body += page
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, flags=re.S | re.I):
            tds = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
            if len(tds) < 2:
                continue
            try:
                dt = datetime.strptime(tds[0].replace("\xa0", " "), "%d. %B %Y").strftime("%Y-%m-%d")
                v = float(tds[1].replace(",", ""))
            except ValueError:
                continue
            rows.append((dt, round(v, 1)))
        rows = sorted(set(rows))
        if len(rows) > 200:
            return rows[-2600:], f"LME cash settlement via Westmetall"
        print(f"::warning::Westmetall {field}: only {len(rows)} rows; first bytes {body[:80]!r}")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::Westmetall {field}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def worldbank(column):
    """Monthly prices (US$/t) from the World Bank Pink Sheet historical workbook."""
    try:
        status, page = get("https://www.worldbank.org/en/research/commodity-markets")
        m = re.search(r'href="([^"]*CMO-Historical-Data-Monthly\.xlsx)"', page)
        if not m:
            print("::warning::World Bank: link to the monthly workbook not found"); return [], None
        url = m.group(1) if m.group(1).startswith("http") else "https://www.worldbank.org" + m.group(1)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r:
            blob = r.read()
        import openpyxl  # installed by the workflow
        wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
        ws = wb["Monthly Prices"]
        head, rows = None, []
        for row in ws.iter_rows(values_only=True):
            if head is None:
                if row and any(str(c or "").strip().lower() == column.lower() for c in row):
                    head = [str(c or "").strip().lower() for c in row]
                continue
            lab = str(row[0] or "")
            mm = re.match(r"(\d{4})M(\d{2})", lab)
            if not mm:
                continue
            v = row[head.index(column.lower())]
            if isinstance(v, (int, float)):
                rows.append((f"{mm.group(1)}-{mm.group(2)}-15", round(float(v), 1)))
        if len(rows) > 24:
            return rows[-240:], "World Bank Pink Sheet (monthly)"
        print(f"::warning::World Bank {column}: only {len(rows)} rows")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::World Bank {column}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def sina_futures(symbol):
    """Daily bars of a China futures main continuous contract (e.g. LC0 = Guangzhou lithium carbonate), yuan/t."""
    day = datetime.now(timezone.utc).strftime("%Y_%m_%d")
    url = (f"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_{symbol}{day}="
           f"/InnerFuturesNewService.getDailyKLine?symbol={symbol}&_={day}")
    try:
        req = urllib.request.Request(url, headers={**UA, "Referer": "https://finance.sina.com.cn/"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
        data = json.loads(body[body.find("([") + 1: body.rfind("])") + 1])
        rows = [(x["d"], float(x["c"])) for x in data if x.get("c")]
        # today's bar is still moving until the close (15:00 Beijing); keep only finished days
        bj = datetime.now(timezone.utc) + timedelta(hours=8)
        if rows and rows[-1][0] == bj.strftime("%Y-%m-%d") and (bj.hour, bj.minute) < (15, 15):
            rows = rows[:-1]
        if len(rows) > 200:
            return rows, f"Guangzhou Futures Exchange {symbol} main contract, daily close (via Sina Finance)"
        print(f"::warning::Sina {symbol}: only {len(rows)} rows; first bytes {body[:80]!r}")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::Sina {symbol}: {type(e).__name__} {str(e)[:150]}")
    return [], None


def sina_curve(prefix="LC", n=13):
    """Latest close of each Guangzhou lithium carbonate contract over the next 12 months (the futures curve), yuan/t.
    Used by scripts/scenarios.py as the market's own expected path for the Base scenario."""
    bj = datetime.now(timezone.utc) + timedelta(hours=8)
    rows = []
    for i in range(n):
        yy, mm = divmod(bj.month - 1 + i, 12)
        yy += bj.year; mm += 1
        sym = f"{prefix}{yy % 100:02d}{mm:02d}"
        url = (f"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_{sym}=/InnerFuturesNewService.getDailyKLine?symbol={sym}")
        try:
            req = urllib.request.Request(url, headers={**UA, "Referer": "https://finance.sina.com.cn/"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8", "replace")
            data = json.loads(body[body.find("([") + 1: body.rfind("])") + 1])
            last = data[-1]
            close = float(last["c"])
            when = datetime.strptime(last["d"][:10], "%Y-%m-%d").date()
            if close > 0 and (bj.date() - when).days <= 10:
                rows.append((sym, f"{yy}-{mm:02d}", when.isoformat(), close, float(last.get("v") or 0)))
        except Exception as e:  # noqa: BLE001
            print(f"::warning::Sina {sym}: {type(e).__name__} {str(e)[:120]}")
    return rows


def ecb_fx():
    """Daily ECB reference rates -> US$ to rupee and US$ to yuan (cross rates through the euro)."""
    import zipfile
    try:
        req = urllib.request.Request("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r:
            blob = r.read()
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            text = z.read(z.namelist()[0]).decode("utf-8")
        rows = []
        for rec in csv.DictReader(io.StringIO(text)):
            try:
                usd, inr, cny = float(rec["USD"]), float(rec[" INR"] if " INR" in rec else rec["INR"]), float(rec[" CNY"] if " CNY" in rec else rec["CNY"])
            except (KeyError, ValueError, TypeError):
                try:
                    k = {kk.strip(): vv for kk, vv in rec.items()}
                    usd, inr, cny = float(k["USD"]), float(k["INR"]), float(k["CNY"])
                except (KeyError, ValueError, TypeError):
                    continue
            if rec["Date"] >= "2015-01-01":
                rows.append((rec["Date"], round(inr / usd, 4), round(cny / usd, 4)))
        rows.sort()
        if len(rows) > 200:
            return rows
        print(f"::warning::ECB: only {len(rows)} rows")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::ECB rates: {type(e).__name__} {str(e)[:150]}")
    return []


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plan = {"copper": [lambda: westmetall("LME_Cu_cash"), lambda: worldbank("Copper"), lambda: yahoo("HG=F", LB_PER_T), lambda: fred("PCOPPUSDM")],
            "aluminium": [lambda: westmetall("LME_Al_cash"), lambda: worldbank("Aluminum"), lambda: yahoo("ALI=F", 1.0), lambda: fred("PALUMUSDM")]}
    fx = ecb_fx()
    if fx:
        with open(OUT / "fx.csv", "w", newline="") as f:
            w = csv.writer(f); w.writerow(["date", "usd_inr", "usd_cny", "source"])
            for d, inr, cny in fx:
                w.writerow([d, inr, cny, "ECB euro reference rates (cross rates)"])
        print(f"fx: {len(fx)} rows, {fx[0][0]} to {fx[-1][0]}")
    else:
        print("::warning::Could not refresh exchange rates; keeping the saved copy.")
    rows, src = sina_futures("LC0")
    if rows:
        with open(OUT / "lithium_futures.csv", "w", newline="") as f:
            w = csv.writer(f); w.writerow(["date", "cny_t", "source"])
            for d, v in rows:
                w.writerow([d, v, src])
        print(f"lithium: {len(rows)} rows, {rows[0][0]} to {rows[-1][0]}")
    else:
        print("::warning::Could not refresh the lithium futures history; keeping the saved copy.")
    curve = sina_curve()
    if len(curve) >= 4:
        with open(OUT / "lithium_curve.csv", "w", newline="") as f:
            w = csv.writer(f); w.writerow(["contract", "month", "date", "cny_t", "volume", "source"])
            for row in curve:
                w.writerow([*row, "Guangzhou Futures Exchange contract close (via Sina Finance)"])
        print(f"lithium curve: {len(curve)} contracts, {curve[0][1]} to {curve[-1][1]}")
    else:
        print(f"::warning::Lithium futures curve: only {len(curve)} contracts answered; keeping the saved copy.")
    for name, tries in plan.items():
        for t in tries:
            rows, src = t()
            if rows:
                with open(OUT / f"{name}.csv", "w", newline="") as f:
                    w = csv.writer(f); w.writerow(["date", "usd_t", "source"])
                    for d, v in rows:
                        w.writerow([d, v, src])
                print(f"{name}: {len(rows)} rows from {src}, {rows[0][0]} to {rows[-1][0]}")
                break
        else:
            print(f"::warning::Could not refresh the {name} price history; keeping the saved copy.")


if __name__ == "__main__":
    sys.exit(main())
