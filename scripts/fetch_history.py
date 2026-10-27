"""Refresh long price histories for the Risk Navigator (run by GitHub Actions, which has open internet).

Writes data/history/<name>.csv with columns date,usd_t (one row per trading day or month).
Tries each source in turn and keeps the saved file if every source fails.
  copper    : COMEX copper futures (Yahoo Finance HG=F, US$/lb -> US$/t), else IMF monthly via FRED
  aluminium : COMEX aluminium futures (Yahoo Finance ALI=F, US$/t), else IMF monthly via FRED
"""
import csv, io, json, sys, urllib.request
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
            print(f"  {host} {symbol}: {type(e).__name__} {str(e)[:120]}")
    return [], None


def fred(series):
    try:
        status, body = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}")
        rd = csv.reader(io.StringIO(body)); next(rd)
        rows = [(d, round(float(v), 1)) for d, v in rd if v not in (".", "")]
        if len(rows) > 24:
            return rows, f"IMF via FRED {series} (monthly)"
    except Exception as e:  # noqa: BLE001
        print(f"  FRED {series}: {type(e).__name__} {str(e)[:120]}")
    return [], None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plan = {"copper": [lambda: yahoo("HG=F", LB_PER_T), lambda: fred("PCOPPUSDM")],
            "aluminium": [lambda: yahoo("ALI=F", 1.0), lambda: fred("PALUMUSDM")]}
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
