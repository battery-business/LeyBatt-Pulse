"""Refresh long price histories for the Risk Navigator (run by GitHub Actions, which has open internet).

Writes data/history/<name>.csv with columns date,usd_t (one row per trading day or month).
Tries each source in turn and keeps the saved file if every source fails.
  copper, aluminium: LME cash settlement (daily, via Westmetall), else the World Bank Pink Sheet (monthly),
  else COMEX futures (Yahoo Finance), else IMF monthly via FRED
"""
import csv, io, json, re, sys, urllib.request
from datetime import datetime, timezone
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
        status, body = get(f"https://www.westmetall.com/en/markdaten.php?action=table&field={field}")
        rows = []
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plan = {"copper": [lambda: westmetall("LME_Cu_cash"), lambda: worldbank("Copper"), lambda: yahoo("HG=F", LB_PER_T), lambda: fred("PCOPPUSDM")],
            "aluminium": [lambda: westmetall("LME_Al_cash"), lambda: worldbank("Aluminum"), lambda: yahoo("ALI=F", 1.0), lambda: fred("PALUMUSDM")]}
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
