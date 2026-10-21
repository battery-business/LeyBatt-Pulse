# Daily update runbook

This site is a static page (`index.html` + `assets/`) that reads everything it shows from `data/*.json`.
A daily update changes only the files in `data/`. Do not change the page layout during a routine update.

## Rules

- **US$ only.** Never show yuan/CNY. Convert with `scripts/convert.py` (US$1 = 6.70 yuan; cell and system prices from China have 13% VAT removed).
- **Public market data only.** No company names of the site owner, no supplier negotiation notes, no internal programme details (bids, customers, targets).
- **Every number needs a working source link** (`source` + `url`). Only add a figure you read on a page you opened. Search snippets alone are not enough.
- **Never invent or interpolate.** If a source has not published since the last update, leave the old row; its date shows it is older.
- **Summarise news in your own words.** Never copy article text. Bloomberg is usually readable only as a headline: summarise the headline and link it.
- If an article cannot be opened, add "(headline only, not verified)" to the headline.

## Sources to check each weekday

| What | Where | Cadence | File |
|---|---|---|---|
| Lithium carbonate futures (GFEX most-active) and China spot | SMM daily lithium review (news.metal.com), Trading Economics lithium, SunSirs | Daily | `lithium.json` (append rows), `latest.json` id `lithium` |
| 314 Ah cell, spodumene, lithium carbonate spot, China system prices | InfoLink energy-storage spot price page (infolink-group.com/spot-price-energy-storage/) | Weekly (Wed/Thu) | `cell314.json` (append), `rawmats.json` (Spodumene), `latest.json` id `cell314` |
| China storage tender awards | TrendForce / EnergyTrend monthly report (energytrend.com/research) | Monthly, mid-month | `systems.json` (append month), `latest.json` id `system` |
| Lithium hydroxide | LME lithium hydroxide CIF page | Daily | `rawmats.json` |
| Copper, aluminium | Trading Economics commodity pages | Daily | `rawmats.json` (copper: US$/lb × 2204.62) |
| LFP cathode, iron phosphate, electrolyte | SMM news articles | When published | `latest.json` id `cathode`, `rawmats.json` |
| ≥500 Ah / 587 Ah cell prices | New tender results or price reports (ESS News, Energy-Storage.News, SMM) | When published | `cellbids.json`, `latest.json` id `cell587` |
| Pack prices | BloombergNEF annual battery price survey (December) | Yearly | `latest.json` id `pack` |
| News | Bloomberg headlines on lithium/batteries/energy storage; ESS News; Energy-Storage.News; SMM; Mining Weekly; Saur Energy / pv magazine India / Mercom for Indian BESS tenders | Daily | `news.json` |

## Steps

1. Check each source above. Record only new, verified figures.
2. Append new rows to the series files (`lithium.json`, `cell314.json`, `systems.json`) with `date` (YYYY-MM-DD), value, `source`, `url`, `note`.
3. Update the matching card in `latest.json`: `price` (formatted, e.g. "$15,010"), `asof` (e.g. "21 Oct"), `move` (signed %, e.g. "−2.1% in a week", using a real minus sign "−"), `direction` (`down`/`up`/`flat`), `source`, `url`.
4. Add up to 6 new news items to `news.json` (fields: `id` = next `nNN`, `date`, `day` e.g. "21 Oct", `headline`, `effect`, `direction`, `source`, `url`, `sources` = source names joined by " · ", optional `source2`/`url2`). Drop items older than 21 days.
5. Update `data/meta.json`: `updated` (YYYY-MM-DD), `updated_label` (e.g. "21 Oct 2026"), `note` (one line on which prices moved).
6. Validate: every file parses as JSON (`python3 -c "import json,glob;[json.load(open(f)) for f in glob.glob('data/*.json')]"`), and no displayed field (anything other than `url`/`url2`) contains "CNY", "RMB" or "yuan".
7. Commit to `main` with a message like `Daily update 21 Oct 2026` and push. GitHub Pages republishes within a few minutes.
