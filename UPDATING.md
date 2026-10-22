# Daily update runbook

This site is a static page (`index.html` + `assets/`) that reads everything it shows from `data/*.json`.
A daily update changes only the files in `data/`. Do not change the page layout during a routine update.

## Rules

- **US$ only.** Never show yuan/CNY. Convert with `scripts/convert.py` (US$1 = 6.70 yuan; cell and system prices from China have 13% VAT removed).
- **Public market data only.** Nothing internal about the site owner's company: no supplier negotiation notes, no internal programme details (bids, customers, targets). Public news about any company is fine.
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
| Separator (US$/m²), graphite anode, copper foil, aluminium foil | SMM separator and anode weekly reviews, SMM cobalt-lithium morning meeting summaries, SMM cost-model reports | When a new figure is published | `rawmats.json` |
| ≥500 Ah / 587 Ah cell prices | New tender results or price reports (ESS News, Energy-Storage.News, SMM) | When published | `cellbids.json`, `latest.json` id `cell587` |
| EV cells (prismatic LFP for vehicles; stands in for 230 Ah and 324 Ah cells) | TrendForce battery price page (trendforce.com/price/battery-price): row "Square LFP Battery Cell: for EV" | When the page's date changes (about weekly) | `evcells.json` → append to `series` (`date`, `usd_kwh` = yuan/Wh ÷ 1.13 × 1000 ÷ 6.70, `source` "TrendForce", `url`, `note`); update `ess_benchmark` from the "Energy Storage" row; update `latest.json` id `evcell` (`price`, `asof`, `move`, `direction`). Leave `formats` alone. |
| Pack prices | BloombergNEF annual battery price survey (December) | Yearly | `latest.json` id `pack` |
| InfoLink weekly table (lithium spot, 314 Ah cell avg/low/high, 2h DC and 1h/2h/4h AC systems) | Each InfoLink weekly article: infolink-group.com/energy-article/ess-spot-price-YYYYMMDD (usually Wednesday) | Weekly | `weekly.json` (append one row: `date`, `lithium_usd_t`, `cell314`, `cell314_lo`, `cell314_hi`, `dc_2h`, `ac_1h`, `ac_2h`, `ac_4h`, `note` = InfoLink's one-line reason, `source` = "InfoLink weekly", `url`). Also append the same lithium value to `lithium.json` as a `Spot` row with source "InfoLink weekly", and the same cell values to `cell314.json` (`usd_kwh`, `lo`, `hi`). |
| China EV battery installations and maker shares | CnEVPost monthly CABIA report (mid-month) | Monthly | `marketshare.json` (replace rows: `maker`, `share`, `gwh`, `period`, `source`, `url`) |
| Analyst lithium price forecasts | Reputable news reports of bank or broker forecasts | When published | `forecasts.json` (`who`, `period`, `low`, `high` in US$/t, `source`, `url`) |
| News | Bloomberg headlines on lithium/batteries/energy storage/EVs; ESS News; Energy-Storage.News; SMM; Mining Weekly; CnEVPost (China EV and battery data); company press releases (CATL, BYD, LG Energy Solution, Tesla, CALB, EVE, Panasonic, Samsung SDI, SK On); Indian sources (Saur Energy, pv magazine India, Mercom, ETAuto, Autocar Pro, FADA/Vahan EV sales, Indian cell makers such as Tata Agratas, Amara Raja, Exide, Ola, Reliance); regulation (MHI/PLI, MNRE/CEA, BIS, customs, EU Battery Regulation, US tariffs and FEOC rules) | Daily | `news.json`. Aim for a mix across categories, not only lithium. |

## Raw-materials table and cost calculator

- Every row in `rawmats.json` needs `material`, `role`, `price` (display string), `usd` (the same number, plain), `unit` ("per tonne" or "per m²"), `asof`, `move`, `direction`, `stage`, `source`, `url` (optional `source2`/`url2`). Keep `usd` and `price` in step: the cost calculator reads `usd`.
- `stage` is one of: Ore & lithium chemicals / Cathode & anode / Other cell materials / Metals. Rows from `latest.json` are added to the table automatically.
- The calculator takes its starting prices live from `lithium.json` (latest spot), `rawmats.json` (iron phosphate, graphite anode, LFP electrolyte, separator, copper, aluminium — keep these material names exactly) and `weekly.json` (cell and 4-hour system). A routine update needs no other change.
- `costmodel.json` holds quantities per kWh, fees and calibration with their sources. Change it only when a new public cost model or cathode price justifies it, and update its `notes` to match. If the LFP cathode price in `latest.json` changes a lot, recompute `cathode_processing_usd_t` = cathode price − 0.24 × lithium carbonate price − 0.96 × iron phosphate price (same day where possible).

## News categories (cover every one each week)

Each daily run should aim for a spread: at most 3 lithium items, and at least one item from the India categories and one from Packs & BMS or R&D whenever something new is published.

| Category | What goes in it | Where to look |
|---|---|---|
| Lithium & materials | Lithium, cathode, graphite, electrolyte prices and supply; mines and export bans | SMM, Mining Weekly, Bloomberg headlines |
| Cell makers & competitors | Global cell makers: results, new plants, market share, big supply deals (CATL, BYD, EVE, CALB, Hithium, Gotion, LGES, Samsung SDI, SK On, Panasonic) | CnEVPost, Battery-Tech Network, company press releases |
| Packs & BMS | Battery packs, cell-to-pack, swappable packs, thermal design, battery management systems (BMS) and BMS chips (NXP, TI, Infineon, ADI), pack makers | electrive, Charged EVs, Battery-Tech Network, CnEVPost, EVreporter |
| R&D & new products | New cells and chemistries (sodium-ion, solid-state, LMFP), new storage products, research results, patents | Battery-Tech Network, CarNewsChina, The Driven, Energy-Storage.News |
| Energy storage | Global storage tenders, prices, deployments, forecasts | ESS News, Energy-Storage.News, TrendForce/EnergyTrend, Wood Mackenzie |
| EV market | Global EV and NEV sales, new models, pack sizes | CnEVPost (CPCA/CAAM), electrive |
| India BESS | Indian storage tenders and awards (SECI, NTPC, NHPC, SJVN, state utilities), BESS factories and integrators (Tata Power, JSW, Waaree, Reliance, Trontek, GoodEnough) | Mercom India, Saur Energy, pv magazine India, ET EnergyWorld |
| India EV & battery makers | Indian EV sales (FADA/Vahan), e-bus and e-truck orders and launches (Tata Motors, Olectra, JBM, PMI, EKA, Switch, Eicher), Indian cell, pack and BMS makers (Tata Agratas, Amara Raja, Exide, Ola, Lohum, Log9, TVS Indeon, Exponent) | Autocar Professional, ETAuto, EVreporter, The Machine Maker, electrive |
| Regulation & trade | Tariffs, export rebates, PLI/MHI, BIS/CEA rules, EU Battery Regulation and passports, US FEOC rules | CnEVPost, Mercom, PIB, EU sources |

## Steps

1. Check each source above. Record only new, verified figures.
2. Append new rows to the series files (`lithium.json`, `cell314.json`, `systems.json`) with `date` (YYYY-MM-DD), value, `source`, `url`, `note`.
3. Update the matching card in `latest.json`: `price` (formatted, e.g. "$15,010"), `asof` (e.g. "21 Oct"), `move` (signed %, e.g. "−2.1% in a week", using a real minus sign "−"), `direction` (`down`/`up`/`flat`), `source`, `url`.
4. Add up to 8 new news items to `news.json` (fields: `id` = next `nNN`, `date`, `day` e.g. "21 Oct", `headline`, `category` = one of the categories listed below, `effect` (2–3 words), `direction` (`down` = pushes prices or demand down, `up` = pushes them up, `flat` = neutral), `source`, `url`, `sources` = source names joined by " · ", optional `source2`/`url2`). Keep about 40–50 items; drop the oldest beyond 60 days, but keep at least 3 items in every category.
5. Update `data/meta.json`: `updated` (YYYY-MM-DD), `updated_label` (e.g. "21 Oct 2026"), `note` (one line on which prices moved).
6. Validate: every file parses as JSON (`python3 -c "import json,glob;[json.load(open(f)) for f in glob.glob('data/*.json')]"`), and no displayed field (anything other than `url`/`url2`) contains "CNY", "RMB" or "yuan".
7. Commit to `main` with a message like `Daily update 21 Oct 2026` and push. GitHub Pages republishes within a few minutes.
