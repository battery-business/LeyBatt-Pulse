# Daily update runbook

This site is a static page (`index.html` + `assets/`) that reads everything it shows from `data/*.json`.
A daily update changes only the files in `data/`. Do not change the page layout during a routine update.

## Rules

- **US$ only.** Never show yuan/CNY. Convert with `scripts/convert.py` (US$1 = 6.70 yuan; cell and system prices from China have 13% VAT removed).
- **One VAT basis per kind of price.** China raw-material prices (lithium carbonate, LFP cathode, iron phosphate, graphite anode, electrolyte, separator) stay as quoted in China, *including* 13% VAT; the site labels them so, and the cost model and forecasts assume it. Cell and system prices *exclude* VAT. Never mix the two in one series.
- **One source per series.** Keep each series to the source named in the table below. The site compares like with like (e.g. lithium spot changes use SMM readings only).
- **Exact dates.** Give `asof` as a day ("22 Oct"), not a month, whenever the source gives one: the site shows each price's age ("2 weeks old") from it.
- **Changes always say what they compare against:** write `move` as "−1.5% vs 16 Oct" (never "on the day", "since …", "vs previous"). For lithium, the 314 Ah cell, the EV cell, the storage systems, copper and aluminium the site works the change out itself from the series (latest reading vs about a week earlier), so only the series files matter for those.
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
| China storage tender awards | TrendForce / EnergyTrend monthly report (energytrend.com/research) | Monthly, mid-month | `systems.json` (append month), `latest.json` id `system` (this entry is shown as the reference "tender awards" price; the headline 4-hour system price comes from `weekly.json` automatically) |
| Lithium hydroxide | LME lithium hydroxide CIF page | Daily | `rawmats.json` |
| Copper, aluminium | **Automatic**: LME cash prices from the nightly job (`data/markets.json`, written by `scripts/fetch_history.py`). Do not edit these rows by hand any more. | Nightly | — |
| LFP cathode, iron phosphate, electrolyte | SMM news articles | When published | `latest.json` id `cathode`, `rawmats.json` |
| Separator (US$/m²), graphite anode, copper foil, aluminium foil | SMM separator and anode weekly reviews, SMM cobalt-lithium morning meeting summaries, SMM cost-model reports | When a new figure is published | `rawmats.json` |
| ≥500 Ah / 587 Ah cell prices | New tender results or price reports (ESS News, Energy-Storage.News, SMM) | When published | `cellbids.json`, `latest.json` id `cell587` |
| EV cells (prismatic LFP for vehicles; stands in for 230 Ah and 324 Ah cells) | TrendForce battery price page (trendforce.com/price/battery-price): row "Square LFP Battery Cell: for EV" | When the page's date changes (about weekly) | `evcells.json` → append to `series` (`date`, `usd_kwh` = yuan/Wh ÷ 1.13 × 1000 ÷ 6.70, `source` "TrendForce", `url`, `note`); update `ess_benchmark` from the "Energy Storage" row; update `latest.json` id `evcell` (`price`, `asof`). Leave `formats` alone. This is **one average for all EV prismatic LFP cells**: never present it as a price for a particular cell size. |
| Pack prices | BloombergNEF annual battery price survey (December) | Yearly | `latest.json` id `pack` |
| InfoLink weekly table (lithium spot, 314 Ah cell avg/low/high, 2h DC and 1h/2h/4h AC systems) | Each InfoLink weekly article: infolink-group.com/energy-article/ess-spot-price-YYYYMMDD (usually Wednesday) | Weekly | `weekly.json` (append one row: `date`, `lithium_usd_t`, `cell314`, `cell314_lo`, `cell314_hi`, `dc_2h`, `ac_1h`, `ac_2h`, `ac_4h`, `note` = InfoLink's one-line reason, `source` = "InfoLink weekly", `url`). Also append the same lithium value to `lithium.json` as a `Spot` row with source "InfoLink weekly", and the same cell values to `cell314.json` (`usd_kwh`, `lo`, `hi`). |
| China EV battery installations and maker shares | CnEVPost monthly CABIA report (mid-month) | Monthly | `marketshare.json` (replace rows: `maker`, `share`, `gwh`, `period`, `source`, `url`) |
| Analyst lithium price forecasts | Reputable news reports of bank or broker forecasts | When published | `forecasts.json` (`who`, `period`, `low`, `high` in US$/t, `source`, `url`) |
| News | Bloomberg headlines on lithium/batteries/energy storage/EVs; ESS News; Energy-Storage.News; SMM; Mining Weekly; CnEVPost (China EV and battery data); company press releases (CATL, BYD, LG Energy Solution, Tesla, CALB, EVE, Panasonic, Samsung SDI, SK On); Indian sources (Saur Energy, pv magazine India, Mercom, ETAuto, Autocar Pro, FADA/Vahan EV sales, Indian cell makers such as Tata Agratas, Amara Raja, Exide, Ola, Reliance); regulation (MHI/PLI, MNRE/CEA, BIS, customs, EU Battery Regulation, US tariffs and FEOC rules) | Daily | `news.json`. Aim for a mix across categories, not only lithium. |

## What it means (every story, date and rule)

The site, the News page and the morning email lead with a one-line read of what each item means for one of three segments. Read `data/profile.json` first. Keep the wording neutral: no "we", "us", "our" and no company names other than those in the story itself.

On **every news item you add**, write:
- `seg`: the segment it matters most to: `EVs` (electric buses, trucks, cars, two-wheelers, charging and swapping), `Batteries` (cells, packs, BMS, lithium and cell materials, cell makers) or `BESS` (battery energy storage: tenders, projects, prices, makers).
- `so`: one plain sentence, at most about 25 words: what happened in a few words, then what it means for that segment, e.g. "500 battery-swap heavy e-trucks on Indian freight corridors: a large test of swapping against plug-in charging for heavy trucks." Shown as "For EVs: …", "For batteries: …" or "For BESS: …".
- `impact`: one to three tags, most important first, each `{"k": <key>, "s": <1, -1 or 0>}`. Keys: `cost` (battery costs: lower = 1, higher = -1), `demand` (demand in that segment: more = 1), `competition` (new makers, capacity or products: more = -1), `supply` (cells and materials easier to get = 1; risk = -1), `policy` (supportive = 1, tighter rules = -1). `0` means unclear direction.
- `weight`: 3 = high impact (Indian e-bus and e-truck orders, launches and results; Indian storage tenders of 1 GWh or more and storage policy; Chinese export controls, rebates or taxes on batteries; a big shift in the lithium or cell price outlook), 2 = relevant (storage and cell markets, Indian pack and cell makers, smaller Indian tenders), 1 = background (car models in China, research far from market, events outside India's markets). Plain daily price recaps get weight 1.

On **every date you add to `events.json`**, also write `weight` (same scale) and, for weight 2–3, `seg` and `so`. The overview's "Next 14 days" and the email's countdown show dates of weight 2–3 and every rule change.

On **regulations**, `seg` and `so` (optional) replace `impact` in the "What it means" box: write them when a rule matters mainly for EV or storage demand rather than for cell buyers.

## Raw-materials table and cost calculator

- Every row in `rawmats.json` needs `material`, `role`, `price` (display string), `usd` (the same number, plain), `unit` ("per tonne" or "per m²"), `asof`, `move`, `direction`, `stage`, `source`, `url` (optional `source2`/`url2`). Keep `usd` and `price` in step: the cost calculator reads `usd`.
- `stage` is one of: Ore & lithium chemicals / Cathode & anode / Other cell materials / Metals. Rows from `latest.json` are added to the table automatically.
- The calculator takes its starting prices live from `lithium.json` (latest spot), `rawmats.json` (iron phosphate, graphite anode, LFP electrolyte, separator, copper, aluminium — keep these material names exactly) and `weekly.json` (cell and 4-hour system). A routine update needs no other change.
- `costmodel.json` holds quantities per kWh, fees and calibration with their sources. Change it only when a new public cost model or cathode price justifies it, and update its `notes` to match. If the LFP cathode price in `latest.json` changes a lot, recompute `cathode_processing_usd_t` = cathode price − 0.24 × lithium carbonate price − 0.96 × iron phosphate price (same day where possible).

## Moving strip under the header

The navy strip loops the full price board, the dates in the next 21 days (from `events.json`) and the alert stories from the last 21 days (from `news.json`). It is built from the data files automatically; the only thing an update must add is the `short` line on alert stories and new dates (see below). If `short` is missing, the page cuts the long text at its first clause, which reads worse.

## Cell team and pack team trackers

The Cells step and the Packs & systems step carry five small trackers, plus the Chinese cell maker grid. Add a row only from a page you opened, with `source`, `url` and `date` (the date it was reported, YYYY-MM-DD); never estimate a number the source did not give (use null). Keep `id`s stable. When a news item you add fits a tracker, add the row in the same run.

- `cellmodels.json` → `rows`: a new cell announced, launched, sampled or bid (not a price report): `id`, `date`, `maker`, `cell`, `chemistry` (LFP, LMFP, sodium-ion, solid-state, semi-solid, NMC, LMR), `format`, `size` (e.g. "587 Ah"), `spec` (energy density, cycle life, charging, as claimed), `use` (Storage, EV, Two-wheelers…), `stage` (Samples, Pilot line, Products launched, Mass production, Bidding in tenders, Planned), `when` (production timing as stated).
- `plants.json` → `rows`: an Indian factory for `kind` Cells, Packs or Storage systems: `id`, `date`, `company`, `location`, `capacity` (as stated), `gwh` (number or null), `stage` (Announced, Proposed, Planned, Building, Expanding, Running), `start`, `note`. Update the existing row (and its `date`, `source`, `url`) when a plant moves stage.
- `vehicles.json` → `rows`: an electric bus or truck sold, ordered or launched in India with published pack details: `id`, `date`, `maker`, `model`, `type`, `pack_kwh` (as published, text), `chemistry`, `cell_supplier`, `charging`, `range_km`, `note`.
- `standards.json` → `rows`: battery swapping, safety or charging standards and swap networks: `id`, `name`, `kind` (Standard, Industry standard, Network), `scope`, `status`, `body`, `date`, `applies`. Update `status` when it changes.
- `safety.json` → `rows`: a battery fire or recall involving an electric bus, truck or storage system (India first, then major ones elsewhere): `id`, `date` (of the incident), `kind` (E-bus fire, E-truck fire, BESS fire, Recall), `place`, `country`, `operator`, `what`, `cause` (exactly as reported, "Not determined" if not), `lesson` (only if the source states one, else null). State facts only; no blame beyond the source.
- `cellmakers.json` → `rows` (one per Chinese cell maker, shown as the "Chinese cell makers by size" grid on the Cells step): `maker`, `aliases` (names as they appear in `tenders.json` bidders, so the maker's bids show in the price column), `cells` = list of `ah` (number), `use` (`BESS` or `Auto`), `name` (model or series, optional), `status` (`Mass production`, `In production`, `Launched`, `Shown`; "production" shows as solid, the others outlined), `note`, `source`, `url`. When a story you add reports a Chinese maker launching or mass-producing an LFP cell of a new size, add it to that maker's `cells` (or move its `status` up), from the page you opened, and set `updated`. Only Chinese makers; never add a size or price the source did not give. Prices in the grid come from `tenders.json` automatically.

## Live lithium during the trading day (`live.json`)

Some company networks block Sina Finance in the browser, so a GitHub Action (`.github/workflows/live.yml`, `scripts/live_lithium.py`) fetches the latest 5-minute Guangzhou lithium carbonate futures price every 15 minutes while the market is open (06:30–09:00 and 11:00–12:30 IST, weekdays) and writes `data/live.json`. The site shows it on the lithium card with a "Live" tag and checks for a newer price every 5 minutes. Never edit `live.json` by hand; a daily update leaves it alone.

## Site structure

Tabs: **Today** (the value chain, what matters today, today's prices), **News**, **Regulations**, **Bidding desk** (landed cost and outlook, cost to make a cell, India tenders and EPC) and **Risk**. The detailed lithium, cell and storage-system price panels sit inside their value-chain steps (Mining, Cells, Packs & systems); old links to `#materials/lithium`, `#materials/cells` and `#materials/systems` open those steps. `#materials/all` is the table of every price.

## Page code changes

Browsers and GitHub Pages keep `assets/app.js` and `assets/style.css` for a few minutes. Whenever either file changes, change the `?v=` number after it in `index.html` (and the stylesheet's in `live-test.html`), for example to the current date and time, so every reader gets the new page and the new code together. Data-only updates (the daily run) don't need this.

## New since your last visit

"New since your last visit" (tags, tab counts and the line above the headline) is worked out in each reader's browser by comparing the data files with what that browser saw last time; it needs no upkeep, but it relies on stable `id`s for stories and rules, so never renumber them.

`live-test.html` (not linked from the page) checks whether a browser can reach the Sina live lithium feed.

## Regulations (`regulations.json`)

The Regulations tab lists rules that change the cost, supply or demand for batteries for an Indian buyer. One entry per rule:
`id` (short, stable), `title`, `short` (≤ 55 characters, used in "Coming up"), `region` (India / China / EU / Other), `area` (Incentives / Trade & duty / Grid & storage rules / Standards & safety / Recycling & passports / Export controls & tax), `status` (In force / Starts later / Paused / Proposed / Bids under evaluation), `date` (YYYY-MM-DD: the next date that matters, otherwise the start date), `date_label` (plain words), `what` (what the rule says, own words), `impact` (what it means for an Indian buyer of cells, BESS or EVs), `effects` (from: Cost up, Cost down, Supply risk, Supply easier, Demand up, Compliance; "(long term)" allowed), `affects` (e.g. Cells, Storage cells, EV cells, EV packs, BESS, Cathode, Graphite, Lithium), `source`, `url`, optional `source2`/`url2`, `checked` (YYYY-MM-DD you last confirmed it on a source page).

When a rule changes in substance (status, date, rate), also set `changed` to today's date.

Daily: when a news item you add changes a rule (new rule, new date, status change such as a pause ending, a proposal being notified, bids opened), update that entry from a page you opened, set `checked` to today, and also update the matching `events.json` date. Add a new entry for any important new rule. Mondays: re-check the entries whose `date` is within the next 60 days and refresh `checked`. Never change a status or date without a source; keep internal company details out.

## Cell tender prices (`tenders.json`)

The Cells page compares public cell procurement bids with InfoLink's market average. When you find a new public storage-cell procurement result (ESS News, Energy-Storage.News, EnergyTrend, SMM) with prices per bidder, append one row per bid to `rows`: `date` (award or shortlist date, YYYY-MM-DD), `when` (e.g. "Nov 2026"), `buyer` (e.g. "CGN 5 GWh cell procurement"), `size` ("314 Ah", "≥500 Ah" or "587 Ah"), `kind` ("bid", or "range" with `lo`/`hi` when only a range is published, or "list" for list prices), `bidder`, `yuan_wh` (as published, including VAT), `usd_kwh` = `python3 scripts/convert.py kwh <yuan_wh>`, `source`, `url`. System-level awards (whole containers) go in `systems.json`, not here.

## India storage tenders (`indiastorage.json`)

The End use step of the value chain and the India storage page chart standalone battery storage tender results. When a news check finds a new **result** (not a tender launch) with discovered tariffs (Mercom, pv magazine India, Renewable Watch, SolarQuarter, Power Line, Energetica), append one row to `tenders`: `id` (`t-<agency>-<year>`, unique), `date` (the date the result was reported, YYYY-MM-DD), `label` (e.g. "GUVNL Phase X 500 MW / 1 GWh"), `agency`, `state`, `mw`, `mwh`, `hours` (mwh ÷ mw, rounded), `low` and `high` (lowest and highest winning tariff in ₹ lakh per MW per month, e.g. ₹2,32,000 → 2.32; use the same number for both if only one is reported, or `high: null` if only the lowest is known), `vgf` (as reported, e.g. "₹18 lakh/MWh", "Yes (PSDF)", or "Not stated"), `tenure` (contract years, or null), `winners` (short list), `source`, `url` (and `source2`/`url2` if a second article fills a gap). One row per tender, never per winner. Tariffs quoted in ₹/kWh (FDRE, RTC) are a different product: leave them out. Also add a new turnkey BESS EPC order with a disclosed value to `epc_orders` (`date`, `label`, `mwh`, `hours` or null, `inr_cr`, `fx` = that day's ECB US$-to-rupee rate from `data/history/fx.csv`, `scope` exactly as reported, `source`, `url`).

## Landed in India (`landed.json`)

Freight, insurance, duty and rebate assumptions for the "Landed in India" panels. The page reads today's cell and system prices and the ECB rupee rate by itself, so a routine update changes nothing here. Change a default only when a new public source justifies it (a customs notification, a new freight index reading), and update its note and source in the same edit.

## Risk Navigator (tags only)

The Risk tab scores price and supply risk (0–10) for seven materials. A GitHub Action (`.github/workflows/risk.yml`, `scripts/risk.py`) recalculates everything after each push: never edit `data/risk.json`, `data/risk_history.json`, `data/pricelog.json` or `data/history/` by hand. Weights, the China-share figures, the stated assumptions for each material and the India facts (duties, cell capacity) live in `data/risk_config.json`; change them only with a new public source, and update the matching assumption text. The job also refreshes long price histories into `data/history/`: Guangzhou lithium carbonate futures (daily since July 2023, via Sina), LME copper and aluminium (daily since 2018, via Westmetall) and ECB exchange rates (US$-rupee, US$-yuan).

Each run also scores the same data as it stood a week earlier, so every driver carries `prev` (last week's score), `prev_detail`, `moved` (points it added to or took off the overall score) and, for news and date drivers, `new_items` / `gone_items` (the stories or dates that came in or dropped out since then). The site uses these to say why a score eased or rose under "What drives the score"; the week-on-week change shown is taken from that same run, so the reasons add up to it (to rounding).

The one thing a daily update adds is **risk tags** on news items and dates that change the supply or price outlook of a tracked material:
`"risk": [{"m": "<material>", "k": "supply" or "price", "s": <-3 to 3>}]`
- Materials: `lithium`, `cathode` (LFP cathode), `graphite` (anode), `cell_ess` (storage cells), `cell_ev` (EV cells), `copper`, `aluminium`.
- Sign: positive = tighter supply or upward price pressure for a buyer; negative = easier supply or downward pressure.
- Size: 1 = notable (one company or a small share of supply); 2 = significant (a country, a large producer, a tax or rebate change); 3 = major (an export ban or control, a shutdown of more than about 5% of world supply).
- `supply`: export controls and bans, mine or plant stoppages, new capacity starting (negative), sanctions, shipping disruption. `price`: tax, rebate or duty changes, price hikes or cuts announced by big makers, strong demand or glut signals, forecasts.
- Do not tag plain price reports (the prices already feed the score). Tag the date in `events.json` too when the change has a start date. Leave items with no clear effect untagged.

## 2-3 year outlook (`scenario_config.json`)
The Risk tab's "The next three years" section comes from `data/scenarios.json`, which `scripts/scenarios.py` rewrites every night in the risk workflow (never edit `scenarios.json` by hand). It simulates lithium, copper, aluminium, LFP cathode, cells and the rupee under four scenarios, using the price history in `data/history/` (including the nightly Guangzhou futures curve, `lithium_curve.csv`) and the anchors in `data/scenario_config.json`.
- Update an anchor only when a new public forecast appears, from a page you opened: lithium `tight` (bullish bank or Fastmarkets/Benchmark forecasts), `glut` (bearish forecasts), `base.long_run` (a published long-term price); `copper.all` and `aluminium.all` (World Bank Commodity Markets Outlook, each April and October). Give the yearly average at `YYYY-07-01`, in US$/t on the site basis (yuan forecasts: divide by 6.70; do not remove VAT for lithium), and update that anchor's `note` and `sources` (text with publisher and date, URL).
- Forecast charts show one line (the middle), one shaded band (8 in 10 outcomes, P10–P90) and a thin "one possible path": `path` in each result, a typical simulated track (ends at the 40th–60th percentile, median monthly volatility), written by `scenarios.py`. The 1Y/3Y range buttons cut the forecast to the same span ahead.
- Never change `horizon_months`, `sims`, `seed`, the calibration settings, `curbs.premium` or the scenario list in a routine update. Run `python3 scripts/scenarios.py` after editing to check it still runs.

## Morning email

The email is sent by GitHub Actions (`.github/workflows/daily-digest.yml` running `scripts/send_digest.py`) at about 5:15 am IST, built from the data files — the daily run does not send email itself. To make it useful:
- Write `meta.json` `note` as two short plain sentences (under 45 words in all): first the price picture, then the single most important story. It is the preview line people see in their inbox (the email itself opens with "What matters today", built from the `so` lines).
- On a news item that meets an alert rule, add `"alert": true` and `"alert_reason"` (2–4 words, e.g. "1.6 GWh India tender"). Also add `"short"`: the story in at most 70 characters, own words, plain (e.g. "Andhra Pradesh tenders 5 GWh of standalone battery storage"). It runs in the moving strip under the site header, so it must make sense on its own. Alert rules: an Indian battery-storage tender or award of 1 GWh or more; a change to Indian customs duty, PLI, BIS or battery rules; a Chinese export rebate, export control or tariff change on batteries, cells or lithium; a new product, price cut or large order from a competitor in Indian electric buses, trucks or batteries. Price alerts are worked out by the script.

### Price alerts (`alerts.json`)

The email's price alerts come from `data/alerts.json`, Aniket's own settings: a `levels` list (for `fut` lithium futures, `cell` 314 Ah cell, `ev` EV cell, `sys` 4-hour system: an `above` and a `below` price, or null) and `moves` (the one-reading change, in %, that triggers an alert). A level alert fires on the morning a new reading crosses the level; while the price stays beyond it, that tile says so. Alerts sit at the top of "Key prices". Never change `alerts.json` in a routine update; only when Aniket asks.

## Dates to watch (`events.json`)

When a news item you add names a future date that matters to a buyer — a tender bid deadline, a commissioning deadline, a rule or tariff that starts on a date, a big factory start, a trade show — also add it to `events.json`: `date` (YYYY-MM-DD; for a month only, use the 1st and add `"precision": "month"`), optional `end` for multi-day events, `what` (one line, own words), `kind` (India tender / Rule change / Supply / India competitor / Event), `source`, `url` (the same article). Also add `short` (at most 50 characters, written so a countdown can follow it, e.g. "SECI 3.2 GWh storage bids due" → the strip shows "… in 4 days"). Past dates drop off the page automatically; delete entries more than 60 days old.

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
4. Add up to 8 new news items to `news.json` (fields: `id` = next `nNN`, `date`, `day` e.g. "21 Oct", `headline`, `seg`, `so`, `impact`, `weight` (see "What it means"), `category` = one of the categories listed below, `effect` (2–3 words), `direction` (`down` = pushes prices or demand down, `up` = pushes them up, `flat` = neutral), `source`, `url`, `sources` = source names joined by " · ", optional `source2`/`url2`). Pruning: delete `weight` 1 stories once they are more than 14 days old, unless they carry `risk` tags (those stay until 90 days old, because they feed the Risk Navigator; the site already hides them after 14 days). Keep `weight` 2–3 stories for at least 30 days; beyond that drop the oldest first, but keep at least 3 items in every category.
5. Update `data/meta.json`: `updated` (YYYY-MM-DD), `updated_label` (e.g. "21 Oct 2026"), `note` (one line on which prices moved).
6. Validate: every file parses as JSON (`python3 -c "import json,glob;[json.load(open(f)) for f in glob.glob('data/*.json')]"`), and no displayed field (anything other than `url`/`url2`) contains "CNY", "RMB" or "yuan".
7. Commit to `main` with a message like `Daily update 21 Oct 2026` and push. GitHub Pages republishes within a few minutes.

## Header search (`assets/search.js`)

The search box in the header (also Ctrl K / ⌘K, or `/`) runs entirely in the visitor's browser: no AI model, no API, nothing sent anywhere. It indexes what the site has already loaded each time it opens: prices, risk scores, the 3-year outlook, news, regulations, upcoming dates, the five cell and pack trackers, the glossary and the main pages and sections. New stories, rules, tracker rows and prices are picked up automatically; nothing to update by hand.
- A result jumps to the exact card or section (price cards `#pc-<key>`, chain sections `#sec-<title>`, `#news?story=`, `#rules?rule=`).
- Industry synonyms and intent words live at the top of `search.js` (`SYN`, `INTENT`). Add a synonym there when people use a word the site does not (e.g. a new abbreviation).
- The last row always offers "Search the web", which opens an ordinary Google search in a new tab.
- Direct answers are worked out in the browser from the same data (never guessed): a price now, its change over a day / week / month / 3 or 6 months / year ("How much did lithium fall this month?"), a 2027–2029 outlook ("EV cell price 2028"), the landed cost in India from the Bidding desk ("landed cost of 314 Ah cell"), and a date ("When does the China export pause end?"). Matched words are highlighted, with a snippet when they matched only in the story's "What it means" text.
- A "Didn't find what you needed?" link under the results opens an email to `profile.json` → `feedback_email` with the search filled in; it is hidden while that field is empty.
