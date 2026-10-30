"""One-off test: which free public sources can give ~5 years of history for battery prices?

Run by hand from GitHub Actions ("Probe history sources"). It only reads; it writes no data files and sends nothing.
Prints, for each candidate, whether it answered, how many readings came back and the first and last dates.
"""
import json, re, sys, time, traceback, urllib.parse, urllib.request
from io import StringIO

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = []
DETAIL = []
_print = print


def print(*a, **k):  # noqa: A001  keep detail lines so they can go into the notice
    DETAIL.append(" ".join(str(x) for x in a))
    _print(*a, **k)



def get(url, headers=None, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        enc = r.headers.get_content_charset() or "utf-8"
        return r.status, dict(r.headers), raw.decode(enc, "replace")


def report(name, ok, n=0, first="", last="", note=""):
    OUT.append((name, ok, n, first, last, note))
    print(f"[{'OK ' if ok else 'NO '}] {name}: n={n} {first} -> {last} | {note}", flush=True)


def probe(name):
    def wrap(fn):
        try:
            fn(name)
        except Exception as e:  # noqa: BLE001
            report(name, False, note=f"{type(e).__name__}: {str(e)[:160]}")
            traceback.print_exc(limit=1)
        time.sleep(1)
        return fn
    return wrap


# 1. control: the Sina daily feed the site already uses (futures, since July 2023)
@probe("Sina GFEX lithium futures LC0 (control)")
def _(name):
    s, h, b = get("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20x=/InnerFuturesNewService.getDailyKLine?symbol=LC0",
                  {"Referer": "https://finance.sina.com.cn/"})
    d = json.loads(b[b.find("([") + 1: b.rfind("])") + 1])
    report(name, len(d) > 100, len(d), d[0]["d"], d[-1]["d"])


# 2. 100ppi (SunSirs China) spot-vs-futures pages: spot price history for futures-listed commodities
@probe("100ppi spot/futures page: lithium carbonate")
def _(name):
    s, h, b = get("https://www.100ppi.com/sf/792.html")
    print("   100ppi sf page:", s, len(b), "bytes | start:", re.sub(r"\s+", " ", b[:400]))
    links = dict((re.sub(r"<[^>]+>", "", t).strip(), u) for u, t in re.findall(r'<li[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', b, flags=re.S))
    hit = {k: v for k, v in links.items() if "锂" in k}
    print("   100ppi items with 锂:", hit, "| total items:", len(links))
    if not hit:
        report(name, False, note=f"no lithium item among {len(links)} items"); return
    u = list(hit.values())[0]
    s, h, b2 = get("https://www.100ppi.com" + u if u.startswith("/") else u)
    dates = re.findall(r"(20\d\d-\d\d-\d\d)", b2)
    report(name, len(dates) > 30, len(set(dates)), min(dates) if dates else "", max(dates) if dates else "", u)


# 3. 99qh (fx168) spot trend: spot price paired with futures, full history in one call
@probe("99qh spot trend: lithium carbonate")
def _(name):
    s, h, b = get("https://www.99qh.com/data/spotTrend")
    nd = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', b, flags=re.S).group(1))
    prods = [p for grp in nd["props"]["pageProps"]["data"]["varietyListData"] for p in grp["productList"]]
    li = [p for p in prods if "锂" in p.get("name", "")]
    print("   99qh lithium products:", [(p["name"], p["productId"]) for p in li], "| total:", len(prods))
    if not li:
        report(name, False, note="no lithium product"); return
    s, h2, _b = get("https://centerapi.fx168api.com/app/common/v.js", {"Origin": "https://www.99qh.com", "Referer": "https://www.99qh.com"})
    tok = h2.get("_pcc") or h2.get("_Pcc") or ""
    q = urllib.parse.urlencode({"productId": li[0]["productId"], "pageNo": 1, "pageSize": 50000, "startDate": "", "endDate": "2050-01-01", "appCategory": "web"})
    s, h3, b3 = get("https://centerapi.fx168api.com/app/qh/api/spot/trend?" + q, {"_pcc": tok, "Origin": "https://www.99qh.com", "Referer": "https://www.99qh.com"})
    js = json.loads(b3)
    print("   99qh token present:", bool(tok), "| header keys:", [k for k in h2.keys()][:15], "| answer start:", b3[:300])
    data = js.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    rows = data["list"]
    rows = sorted(rows, key=lambda r: r["date"])
    sp = [r for r in rows if r.get("sp") not in (None, "", 0, "0")]
    report(name, len(sp) > 100, len(sp), sp[0]["date"] if sp else "", sp[-1]["date"] if sp else "", f"sample first {sp[0] if sp else None}")


# 4. SunSirs English commodity page (lithium carbonate is believed to be id 1162)
@probe("SunSirs commodity page 1162")
def _(name):
    s, h, b = get("https://www.sunsirs.com/uk/prodetail-1162.html")
    dates = re.findall(r"(20\d\d-\d\d-\d\d)", b)
    blocked = "安全检查" in b or "security check" in b.lower()
    title = re.search(r"<title>(.*?)</title>", b, flags=re.S)
    report(name, len(dates) > 30 and not blocked, len(set(dates)), min(dates) if dates else "", max(dates) if dates else "",
           f"status {s}, {len(b)} bytes, blocked={blocked}, title={(title.group(1).strip()[:80] if title else '')}")


# 5. Investing.com: find lithium instruments, then try their daily history from 2021
@probe("Investing.com lithium instruments")
def _(name):
    H = {"domain-id": "www", "Origin": "https://www.investing.com", "Referer": "https://www.investing.com/"}
    found = []
    for q in ("lithium carbonate", "lithium hydroxide", "spodumene"):
        try:
            s, h, b = get("https://api.investing.com/api/search/v2/search?q=" + urllib.parse.quote(q), H)
            js = json.loads(b)
            for it in (js.get("quotes") or [])[:6]:
                found.append((it.get("id"), it.get("description") or it.get("name"), it.get("exchange"), it.get("url")))
        except Exception as e:  # noqa: BLE001
            print("   investing search", q, type(e).__name__, str(e)[:100])
    print("   investing found:", found)
    best = None
    for iid, desc, ex, url in found[:8]:
        try:
            u = f"https://api.investing.com/api/financialdata/historical/{iid}?start-date=2021-01-01&end-date=2026-12-31&time-frame=Monthly&add-missing-rows=false"
            s, h, b = get(u, H)
            data = json.loads(b).get("data") or []
            ds = sorted(x.get("rowDateTimestamp", x.get("rowDate", ""))[:10] for x in data)
            print(f"   investing {iid} {desc}: {len(data)} monthly rows {ds[:1]} -> {ds[-1:]}")
            if data and (best is None or len(data) > best[0]):
                best = (len(data), ds[0], ds[-1], f"{iid} {desc} {url}")
        except Exception as e:  # noqa: BLE001
            print("   investing hist", iid, type(e).__name__, str(e)[:100])
    if best:
        report(name, best[0] >= 50, best[0], best[1], best[2], "monthly rows; " + best[3])
    else:
        report(name, False, note=f"{len(found)} instruments found, no history returned")


# 6. Yahoo Finance: CME battery-metal futures (lithium hydroxide, spodumene, cobalt)
@probe("Yahoo Finance CME battery-metal futures")
def _(name):
    syms = set()
    for q in ("lithium hydroxide", "spodumene", "cobalt metal"):
        try:
            s, h, b = get("https://query1.finance.yahoo.com/v1/finance/search?q=" + urllib.parse.quote(q))
            for it in json.loads(b).get("quotes", [])[:8]:
                print("   yahoo search", q, "->", it.get("symbol"), it.get("shortname"), it.get("quoteType"))
                if it.get("quoteType") == "FUTURE":
                    syms.add(it["symbol"])
        except Exception as e:  # noqa: BLE001
            print("   yahoo search", q, type(e).__name__, str(e)[:100])
    syms |= {"LTH=F", "SPD=F", "CVR=F"}
    best = None
    for sym in sorted(syms):
        try:
            res = None
            for rng, iv in (("max", "1d"), ("max", "1wk"), ("10y", "1mo")):
                s, h, b = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={iv}")
                r0 = json.loads(b)["chart"]["result"][0]
                nn = len([c for c in (r0["indicators"]["quote"][0].get("close") or []) if c])
                print(f"   yahoo {sym} range={rng} interval={iv}: {nn} points")
                if res is None or nn > len([c for c in (res["indicators"]["quote"][0].get("close") or []) if c]):
                    res = r0
            ts = [t for t, c in zip(res.get("timestamp") or [], res["indicators"]["quote"][0].get("close") or []) if c]
            fd = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))  # noqa: E731
            print(f"   yahoo {sym}: {len(ts)} days {fd(ts[0]) if ts else ''} -> {fd(ts[-1]) if ts else ''}")
            if ts and (best is None or len(ts) > best[0]):
                best = (len(ts), fd(ts[0]), fd(ts[-1]), sym)
        except Exception as e:  # noqa: BLE001
            print("   yahoo chart", sym, type(e).__name__, str(e)[:80])
    report(name, bool(best and best[0] > 200), *(best or (0, "", "", "")))


# 7. DailyMetalPrice: lithium page
@probe("DailyMetalPrice lithium")
def _(name):
    s, h, b = get("https://www.dailymetalprice.com/metalprices.php?c=li&u=kg&d=1825")
    dates = re.findall(r"(20\d\d-\d\d-\d\d|\w{3} \d{1,2}, 20\d\d)", b)
    report(name, len(dates) > 30, len(dates), dates[-1] if dates else "", dates[0] if dates else "", f"status {s}, {len(b)} bytes")


# 8. 100ppi general product pages (chemicals: lithium salts, LFP, graphite, electrolyte, LiPF6)
@probe("100ppi product list: battery chemicals")
def _(name):
    hits = {}
    for u in ("https://www.100ppi.com/price/", "https://www.100ppi.com/mprice/", "https://www.100ppi.com/"):
        try:
            s, h, b = get(u)
            for href, txt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', b, flags=re.S):
                t = re.sub(r"<[^>]+>", "", txt).strip()
                if any(k in t for k in ("锂", "石墨", "电解液", "六氟", "磷酸铁", "钴", "镍")) and len(t) < 20:
                    hits[t] = href
        except Exception as e:  # noqa: BLE001
            print("   100ppi", u, type(e).__name__, str(e)[:80])
    print("   100ppi battery items:", hits)
    deepest = None
    for t, href in list(hits.items())[:10]:
        try:
            full = href if href.startswith("http") else "https://www.100ppi.com" + (href if href.startswith("/") else "/" + href)
            s, h, b = get(full)
            dates = sorted(set(re.findall(r"(20\d\d-\d\d-\d\d)", b)))
            print(f"   100ppi {t}: {len(dates)} dates {dates[:1]} -> {dates[-1:]} ({full})")
            if dates and (deepest is None or dates[0] < deepest[1]):
                deepest = (len(dates), dates[0], dates[-1], f"{t} {full}")
        except Exception as e:  # noqa: BLE001
            print("   100ppi page", t, type(e).__name__, str(e)[:80])
    report(name, bool(deepest and deepest[0] > 30), *(deepest or (0, "", "", f"{len(hits)} items found")))


def esc(t):
    return str(t).replace("%", "%25").replace("\r", "").replace("\n", "%0A")


for name, ok, n, first, last, note in OUT:
    det = [l.strip() for l in DETAIL if l.startswith("   ") and any(w in l for w in name.lower().split()[:1])]
    _print(f"::notice title={esc(('OK ' if ok else 'NO ') + name)}::{esc(f'n={n} {first} -> {last} | {note}' + chr(10) + chr(10).join(det)[:3000])}")
_print("::warning title=all detail lines::" + esc("\n".join(l.strip() for l in DETAIL if l.startswith("   "))[:6000]))
print("\n==== SUMMARY ====")
for name, ok, n, first, last, note in OUT:
    print(f"{'OK ' if ok else 'NO '} | {name} | {n} | {first} -> {last} | {note}")
try:
    import os
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write("| Source | Works | Readings | From | To | Note |\n|---|---|---|---|---|---|\n")
        for name, ok, n, first, last, note in OUT:
            f.write(f"| {name} | {'yes' if ok else 'no'} | {n} | {first} | {last} | {str(note).replace('|', '/')[:150]} |\n")
except Exception:  # noqa: BLE001
    pass
sys.exit(0)
