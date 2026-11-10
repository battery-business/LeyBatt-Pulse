/* LeyBatt Pulse — Plant power tab: electricity needed per kWh of LFP cells made.
   Bottom-up model: electrode drying from solvent evaporated, formation from energy through the cells,
   dry rooms month by month from the local climate, plus fixed loads that run whatever the output.
   Inputs and sources: data/powermodel.json. Two views: Simple and Detailed. */
(() => {
  'use strict';
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const MDAYS = [30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28, 31];
  const STR = ['dryerHeat', 'regenHeat', 'fuel', 'tariff'];
  const SHORT = { dry: 'electrode drying', vac: 'vacuum drying', air: 'compressed air', form: 'formation', asm: 'assembly', pcw: 'process chilled water', cal: 'calendering', mix: 'mixing', nmp: 'NMP recovery', coat: 'coater drives', fill: 'filling', fix: 'formation fixtures', age: 'ageing', formcool: 'formation cooling', dryroom: 'dry rooms', hvac: 'air-conditioning of other halls', misc: 'lighting and offices', loss: 'losses' };
  const GROUPS = [
    ['Electrode making', ['mix', 'dry', 'coat', 'nmp', 'cal'], 'Mixing, coating and drying the electrodes, NMP solvent recovery, calendering'],
    ['Dry rooms', ['dryroom'], 'Rooms kept at −40 °C dew point for cell assembly, running 24×7'],
    ['Formation and ageing', ['form', 'formcool', 'fix', 'age'], 'First charge and capacity test of every cell, then ageing'],
    ['Cell assembly', ['vac', 'asm', 'fill'], 'Vacuum drying, stacking or winding, welding, electrolyte filling'],
    ['Utilities and buildings', ['air', 'pcw', 'hvac', 'misc', 'loss'], 'Compressed air, chilled water, air-conditioning, lighting, losses'],
  ];
  const STORE_KEY = 'lbp-power-mode';
  let M = null, P = null, built = { s: false, d: false }, mode = 'simple', preset = 'base';
  const L = () => window.LBP;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (v, d = 1) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt0 = (v) => fmt(v, 0);
  const cr = (v) => v / 1e7;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  try { const m = localStorage.getItem(STORE_KEY); if (m === 'detail' || m === 'simple') mode = m; } catch (e) { /* ignore */ }

  // ===================== model =====================
  const satP = (T) => (T >= 0 ? 6.112 * Math.exp(17.62 * T / (243.12 + T)) : 6.112 * Math.exp(22.46 * T / (272.62 + T))); // hPa
  const W = (Td, Pa) => { const p = satP(Td); return 0.622 * p / (Pa - p); }; // kg water / kg dry air
  const H = (T, w) => 1.006 * T + w * (2501 + 1.86 * T); // kJ/kg
  const regenQ = (dp) => 1.1 + 0.02 * Math.max(0, -30 - dp); // kWh heat per kg water at the desiccant wheel
  const copAt = (p, T) => Math.max(2, p.copRef * (1 - 0.02 * (T - 30)));
  const avgCop = (p) => p.climT.reduce((a, T, i) => a + copAt(p, T) * MDAYS[i], 0) / 365;
  const climFactor = (p) => p.climT.reduce((a, T, i) => a + Math.max(0, T - 18) * MDAYS[i], 0) / 365 / 12;
  function dryRoom(p, Pa) { // per m² of dry room
    const wSup = W(p.roomDp - 10, Pa), mfa = p.faFlow * 1.15, qreg = regenQ(p.roomDp) * (1 - p.purge / 100);
    const rEl = p.regenHeat === 'elec' ? 1 / 0.98 : 0.02, rFuel = p.regenHeat === 'boiler' ? 1 / (p.boilerEff / 100) : 0;
    const months = p.climT.map((T, i) => {
      const dp = Math.min(p.climDp[i], T), wa = W(dp, Pa), ha = H(T, wa);
      const wc = Math.min(wa, W(p.coilDp, Pa)), hc = H(Math.min(T, p.coilDp + 2), wc);
      const pre = Math.max(0, ha - hc) * mfa / 3600; // kW heat per m²
      const moist = mfa * Math.max(0, wc - wSup) + p.intMoist / 1000; // kg/h
      const regen = moist * qreg, post = regen * p.carry / 100 + p.intHeat / 1000, cop = copAt(p, T);
      const fan = 1.1 * p.ach * p.ceiling * p.sfp / 1000, h = MDAYS[i] * 24;
      return { el: ((pre + post) / cop + regen * rEl + fan) * h, th: regen * rFuel * h };
    });
    return { months, annual: months.reduce((a, m) => ({ el: a.el + m.el, th: a.th + m.th }), { el: 0, th: 0 }) };
  }
  function genHvac(p) {
    const months = p.climT.map((T, i) => ((p.hallGain + 5 * Math.max(0, T - 22)) / 1000 / copAt(p, T) + 0.010) * MDAYS[i] * 24);
    return { months, annual: months.reduce((a, b) => a + b, 0) };
  }
  function run(p, util) {
    const u = (util != null ? util : p.util) / 100, y = p.yield / 100, cap = p.cap * 1e6, out = cap * u;
    const Pa = 1013.25 * Math.pow(1 - 2.25577e-5 * p.elev, 5.25588);
    const hEl = (s) => (s === 'elec' ? 1 / 0.98 : s === 'hp' ? 1 / p.hpCop : 0.02), hFuel = (s) => (s === 'boiler' ? 1 / (p.boilerEff / 100) : 0);
    const nmp = p.camKg / (p.camFrac / 100) * (1 - p.cathSolids / 100) / (p.cathSolids / 100);
    const water = p.anoKg / (p.anoFrac / 100) * (1 - p.anoSolids / 100) / (p.anoSolids / 100);
    const qDry = (nmp * p.nmpHeat + water * p.waterHeat) * (1 - p.dryerRecov / 100) + nmp * p.nmpDistil;
    const steps = [];
    const push = (key, name, group, el, th, fixed) => { const k = cap / y * (fixed + (1 - fixed) * u); steps.push({ key, name, group, el: el * k, th: th * k, fixed }); };
    push('mix', 'Slurry mixing', 'Electrode', p.mixing, 0, 0.2);
    push('dry', 'Coating and electrode drying (heat)', 'Electrode', qDry * hEl(p.dryerHeat), qDry * hFuel(p.dryerHeat), 0.25);
    push('coat', 'Coater drives, pumps and fans', 'Electrode', p.coaterMech, 0, 0.25);
    push('nmp', 'NMP condensing and recovery', 'Electrode', nmp * p.nmpChill, 0, 0.3);
    push('cal', 'Calendering, slitting and notching', 'Electrode', p.calender, 0, 0.2);
    push('vac', 'Vacuum drying (electrodes, cells)', 'Assembly', p.vacdry, 0, 0.3);
    push('asm', 'Stacking or winding, welding, sealing', 'Assembly', p.assembly * (0.5 + 0.5 * 280 / p.cellAh), 0, 0.2);
    push('fill', 'Electrolyte filling', 'Assembly', p.filling, 0, 0.2);
    const vf = 1.05, dcIn = vf / (p.ice / 100) + p.extraCycles * vf / 0.995 + vf * p.shipSoc / 100, dcOut = 1 + p.extraCycles;
    const acIn = dcIn / (p.convEff / 100), acBack = +p.regen ? dcOut * p.regenEff / 100 : 0, formHeat = Math.max(0, acIn - acBack - p.shipSoc / 100);
    push('form', 'Formation and grading (net of energy fed back)', 'Formation', acIn - acBack, 0, 0.05);
    push('formcool', 'Cooling of formation losses', 'Formation', formHeat / avgCop(p), 0, 0.05);
    push('fix', 'Formation fixtures, hot-press heating', 'Formation', p.fixtures, 0, 0.3);
    push('age', 'Ageing rooms (45 °C and ambient)', 'Formation', p.htDays * 0.02 + p.rtDays * 0.008 * climFactor(p), 0, 0.6);
    push('air', 'Compressed air and nitrogen', 'Utilities', p.compAir, 0, 0.4);
    push('pcw', 'Process chilled water', 'Utilities', p.procCool, 0, 0.4);
    const dr = dryRoom(p, Pa), area = p.dryArea * p.cap, gh = genHvac(p);
    steps.push({ key: 'dryroom', name: 'Dry rooms (dehumidifying, cooling, fans)', group: 'Dry rooms', el: dr.annual.el * area, th: dr.annual.th * area, fixed: 1 });
    steps.push({ key: 'hvac', name: 'Air-conditioning of other halls and stores', group: 'Buildings', el: gh.annual * p.condArea * p.cap, th: 0, fixed: 1 });
    steps.push({ key: 'misc', name: 'Lighting, IT, labs, offices, effluent plant', group: 'Buildings', el: p.misc * cap, th: 0, fixed: 1 });
    let elSum = steps.reduce((a, s) => a + s.el, 0);
    const loss = elSum * p.losses / 100; steps.push({ key: 'loss', name: 'Transformer and distribution losses', group: 'Utilities', el: loss, th: 0, fixed: 0.5 }); elSum += loss;
    const thSum = steps.reduce((a, s) => a + s.th, 0);
    const varEl = steps.filter((s) => s.key !== 'dryroom' && s.key !== 'hvac').reduce((a, s) => a + s.el, 0);
    const monthly = MONTHS.map((m, i) => ({ m, dry: dr.months[i].el * area, hvac: gh.months[i] * p.condArea * p.cap, proc: varEl * MDAYS[i] / 365, hours: MDAYS[i] * 24 }));
    const mt = monthly.reduce((a, x) => a + x.dry + x.hvac + x.proc, 0), kk = elSum / mt;
    monthly.forEach((x) => { x.dry *= kk; x.hvac *= kk; x.proc *= kk; x.total = x.dry + x.hvac + x.proc; });
    const avgMW = elSum / 8760 / 1000, mdMW = Math.max(...monthly.map((x) => x.total / x.hours)) / 1000 / (p.lf / 100), cdMVA = mdMW / (p.pf / 100) * (1 + p.cdMargin / 100);
    const bill = { energy: 0, tod: 0, demand: 0, wheel: 0, fac: 0, ed: 0, re: 0, other: 0 };
    monthly.forEach((x, i) => {
      const grid = x.total * (1 - p.reShare / 100), kvah = grid / (p.pf / 100), reb = i >= 6 ? p.solarRebW : p.solarRebS;
      const tm = 7 / 24 * p.todPeak / 100 - p.solarHrs / 24 * reb / 100;
      const e = kvah * p.ec, w = kvah * p.wheel, t = kvah * p.ec * tm, f = kvah * p.fac;
      const d = Math.max((x.total / x.hours) / (p.lf / 100) / (p.pf / 100), 0.75 * cdMVA * 1000) * p.dc;
      const re = x.total * p.reShare / 100 * p.reCost, ed = +p.edOn ? (e + w + t + f + d) * p.ed / 100 : 0, o = grid * p.other;
      Object.entries({ energy: e, tod: t, demand: d, wheel: w, fac: f, ed, re, other: o }).forEach(([k, v]) => { bill[k] += v; });
      x.cost = e + w + t + f + d + re + ed + o;
    });
    const elecCost = Object.values(bill).reduce((a, b) => a + b, 0), fuelCost = thSum * p.fuelCost;
    const co2Grid = elSum * (1 - p.reShare / 100) * p.gridEf / 1000, co2Fuel = thSum * p.fuelEf / 1000;
    return { u, out, steps, elSum, thSum, elInt: elSum / out, thInt: thSum / out, avgMW, mdMW, cdMVA, monthly, bill, elecCost, fuelCost, co2Grid, co2Fuel, nmp, water, dcIn, dcOut, acIn, acBack, dr, cells: out * 1000 / (p.cellAh * p.vnom) };
  }

  // ===================== inputs =====================
  // [id, label, unit, min, max, step, confidence, help, select options]
  const G = () => [
    { t: 'Plant and output', open: true, f: [
      ['cap', 'Nameplate capacity', 'GWh a year', 1, 20, 0.5, 'H', 'Good cells a year at full rate.'],
      ['util', 'Output', '% of nameplate', 10, 100, 1, 'M', 'Actual output ÷ nameplate. Ramp-up years run far lower.'],
      ['yield', 'Overall yield', '%', 75, 99, 0.5, 'M', 'Good kWh out ÷ kWh started. Energy spent on scrapped cells is charged to good ones.'],
      ['cellAh', 'Representative cell', '', 0, 0, 0, 'H', 'Sets the number of cells, which drives per-cell assembly energy.', [[230, '230 Ah (EV)'], [314, '314 Ah (storage)'], [324, '324 Ah (EV)'], [392, '392 Ah (storage)']]],
    ] },
    { t: 'Electrode making', f: [
      ['camKg', 'Cathode active material', 'kg LFP per kWh', 1.9, 2.8, 0.05, 'M', 'Rule of thumb: 2.2–2.5 t of LFP per GWh.'],
      ['cathSolids', 'Cathode slurry solids', '%', 45, 75, 1, 'M', 'Higher solids means less NMP to evaporate.'],
      ['anoKg', 'Anode graphite', 'kg per kWh', 0.8, 1.4, 0.05, 'M', 'Water-based anode slurry.'],
      ['anoSolids', 'Anode slurry solids', '%', 35, 60, 1, 'M', ''],
      ['nmpHeat', 'Oven heat per kg NMP evaporated', 'kWh heat per kg', 2, 9, 0.1, 'L', 'Ovens heat large volumes of air to keep NMP vapour far below its flammable limit, so this is many times NMP’s own latent heat.'],
      ['waterHeat', 'Oven heat per kg water evaporated', 'kWh heat per kg', 1.5, 6, 0.1, 'L', ''],
      ['dryerRecov', 'Oven exhaust heat recovery', '%', 0, 60, 1, 'M', ''],
      ['nmpChill', 'NMP condensing chillers', 'kWh per kg NMP', 0.1, 1, 0.05, 'L', ''],
      ['nmpDistil', 'On-site NMP purification heat', 'kWh heat per kg NMP', 0, 2, 0.1, 'L', '0 = recovered NMP is sent out for re-refining.'],
      ['mixing', 'Slurry mixing', 'kWh per kWh', 0, 2, 0.05, 'L', ''],
      ['coaterMech', 'Coater drives, pumps, fans', 'kWh per kWh', 0, 1.5, 0.05, 'L', ''],
      ['calender', 'Calendering, slitting, notching', 'kWh per kWh', 0, 2, 0.05, 'L', ''],
    ] },
    { t: 'Cell assembly', f: [
      ['vacdry', 'Vacuum drying ovens', 'kWh per kWh', 0, 3, 0.05, 'L', ''],
      ['assembly', 'Stacking or winding, welding, sealing', 'kWh per kWh', 0, 3, 0.05, 'L', 'For a 280 Ah cell; half of it scales with the number of cells.'],
      ['filling', 'Electrolyte filling', 'kWh per kWh', 0, 1, 0.05, 'L', ''],
    ] },
    { t: 'Formation and ageing', f: [
      ['ice', 'First-charge efficiency', '%', 80, 97, 0.5, 'M', 'The rest of the first charge builds the protective layer on the anode.'],
      ['shipSoc', 'Charge level when shipped', '%', 10, 60, 5, 'M', ''],
      ['extraCycles', 'Extra full test cycles', 'cycles', 0, 2, 1, 'M', 'Beyond the single capacity-test discharge.'],
      ['convEff', 'Charger efficiency (AC to DC)', '%', 70, 96, 1, 'M', ''],
      ['regen', 'Formation equipment', '', 0, 0, 0, 'M', 'Regenerative equipment feeds discharge energy back to the plant.', [[1, 'Feeds energy back'], [0, 'Burns it as heat']]],
      ['regenEff', 'Discharge energy fed back', '%', 50, 95, 1, 'M', ''],
      ['fixtures', 'Fixtures, hot-press heating', 'kWh per kWh', 0, 1, 0.05, 'L', ''],
      ['htDays', 'Ageing at 45 °C', 'days', 0, 5, 0.5, 'M', ''],
      ['rtDays', 'Ageing at room temperature', 'days', 0, 30, 1, 'M', ''],
    ] },
    { t: 'Dry rooms', f: [
      ['dryArea', 'Dry-room floor area', 'm² per GWh', 1000, 5000, 100, 'L', 'The biggest single uncertainty: take it from the plant layout.'],
      ['roomDp', 'Dry-room dew point', '°C', -60, -30, 5, 'M', '−40 °C is typical for LFP assembly; drier costs more desiccant heat.'],
      ['faFlow', 'Fresh outdoor air', 'm³/h per m²', 5, 40, 1, 'L', 'Replaces machine exhaust and keeps rooms pressurised; the main weather-driven load.'],
      ['ach', 'Recirculation air changes', 'per hour', 10, 60, 1, 'L', ''],
      ['ceiling', 'Room height', 'm', 3, 8, 0.5, 'M', ''],
      ['sfp', 'Fan power', 'W per m³/h', 0.2, 1, 0.05, 'M', ''],
      ['coilDp', 'Pre-cooling coil dew point', '°C', 5, 14, 1, 'M', 'Outdoor air is chilled to this dew point before the desiccant wheel.'],
      ['purge', 'Desiccant heat recovery', '% saved', 0, 50, 5, 'M', 'Energy-recovery designs claim 35–50% less regeneration heat.'],
      ['carry', 'Regeneration heat carried into supply air', '%', 10, 60, 1, 'L', ''],
      ['intHeat', 'Machine and lighting heat in dry rooms', 'W/m²', 0, 300, 10, 'L', 'Removed by chillers; the machines’ own power is counted in the process steps.'],
      ['intMoist', 'Moisture from people and airlocks', 'g/h per m²', 0, 10, 0.5, 'L', ''],
    ] },
    { t: 'Utilities and buildings', f: [
      ['condArea', 'Other air-conditioned floor area', 'm² per GWh', 0, 15000, 500, 'L', 'Formation, ageing and electrode halls, stores, offices.'],
      ['hallGain', 'Heat load in those halls', 'W/m²', 20, 150, 5, 'L', ''],
      ['copRef', 'Chiller efficiency (COP) at 30 °C outside', '', 2.5, 7, 0.1, 'M', 'Falls about 2% for each degree hotter.'],
      ['compAir', 'Compressed air and nitrogen', 'kWh per kWh', 0, 2, 0.05, 'L', ''],
      ['procCool', 'Process chilled water', 'kWh per kWh', 0, 2, 0.05, 'L', ''],
      ['misc', 'Lighting, IT, labs, effluent plant', 'kWh per kWh', 0, 2, 0.05, 'L', ''],
      ['losses', 'Transformer and distribution losses', '%', 0, 5, 0.5, 'M', ''],
    ] },
    { t: 'Heat supply', f: [
      ['dryerHeat', 'Electrode oven heat from', '', 0, 0, 0, 'M', 'A boiler moves this load from electricity to fuel.', [['elec', 'Electric heaters'], ['hp', 'Industrial heat pump'], ['boiler', 'Boiler or thermal oil (fuel)']]],
      ['hpCop', 'Heat pump COP', '', 1.5, 4.5, 0.1, 'L', 'Oven air at 120–150 °C limits heat-pump efficiency.'],
      ['regenHeat', 'Desiccant regeneration heat from', '', 0, 0, 0, 'M', 'Needs about 140 °C or more, so no heat-pump option.', [['elec', 'Electric heaters'], ['boiler', 'Steam or boiler (fuel)']]],
      ['boilerEff', 'Boiler efficiency', '%', 70, 95, 1, 'M', ''],
      ['fuel', 'Boiler fuel', '', 0, 0, 0, 'L', '', [...Object.entries(M.fuels).map(([k, v]) => [k, v.name]), ['custom', 'Custom']]],
      ['fuelCost', 'Fuel cost', '₹ per kWh of heat', 0.5, 10, 0.1, 'L', 'Piped gas at about ₹55 per m³ is about ₹5.6 per kWh of heat (assumed).'],
      ['fuelEf', 'Fuel emissions', 'kg CO₂ per kWh', 0, 0.4, 0.001, 'M', ''],
    ] },
    { t: 'Tariff and cost', f: [
      ['tariff', 'MSEDCL HT-Industry tariff', '', 0, 0, 0, 'M', 'Check against the current MERC tariff schedule before relying on it.', [...Object.entries(M.tariffs).map(([k, v]) => [k, `${v.name} (₹${v.ec}, ₹${v.dc}/kVA)`]), ['custom', 'Custom']]],
      ['ec', 'Energy charge', '₹ per kVAh', 4, 12, 0.01, 'M', ''],
      ['wheel', 'Wheeling charge', '₹ per kVAh', 0, 2, 0.01, 'M', 'Nil for supply at 66 kV and above.'],
      ['dc', 'Demand charge', '₹ per kVA a month', 300, 900, 5, 'M', ''],
      ['fac', 'Fuel adjustment charge', '₹ per kVAh', -1, 2, 0.01, 'L', ''],
      ['pf', 'Power factor', '%', 90, 100, 0.1, 'M', 'kVAh = kWh ÷ power factor.'],
      ['lf', 'Load factor', '%', 60, 98, 1, 'M', 'Average ÷ peak demand within a month.'],
      ['cdMargin', 'Contract demand margin', '%', 0, 40, 1, 'M', ''],
      ['todPeak', 'Peak-hour surcharge, 17:00–24:00', '% of energy charge', 0, 40, 1, 'M', ''],
      ['solarRebS', 'Solar-hour rebate, Apr–Sep', '% of energy charge', 0, 40, 1, 'M', ''],
      ['solarRebW', 'Solar-hour rebate, Oct–Mar', '% of energy charge', 0, 40, 1, 'M', ''],
      ['solarHrs', 'Solar-rebate window', 'hours a day', 0, 10, 1, 'L', ''],
      ['edOn', 'Electricity duty', '', 0, 0, 0, 'M', 'Mega and Ultra-Mega projects have historically been exempted; confirm under the current policy.', [[1, 'Payable'], [0, 'Exempt']]],
      ['ed', 'Electricity duty rate', '% of charges', 0, 15, 0.1, 'H', ''],
      ['other', 'Other levies', '₹ per kWh', 0, 1, 0.01, 'L', ''],
      ['reShare', 'Renewable power share', '% of kWh', 0, 100, 1, 'M', 'Open access or captive, priced at its landed cost.'],
      ['reCost', 'Renewable landed cost', '₹ per kWh', 2, 10, 0.05, 'L', ''],
      ['gridEf', 'Grid emission factor', 't CO₂ per MWh', 0.4, 0.9, 0.001, 'H', 'CEA, FY2023-24 grid average.'],
      ['fx', 'Exchange rate', '₹ per US$', 75, 100, 0.5, 'L', ''],
    ] },
  ];

  function init() {
    M = (L().D || {}).powermodel; if (!M) return false;
    if (!P) reset();
    return true;
  }
  function reset(set) {
    P = Object.assign(clone(M.defaults), { climT: M.climate.temp_c.slice(), climDp: M.climate.dewpoint_c.slice(), ramp: M.ramp.slice() }, set || {});
  }
  function setVal(id, v) {
    if (!STR.includes(id)) { v = +v; if (isNaN(v)) return; }
    P[id] = v;
    if (id === 'tariff' && M.tariffs[v]) Object.assign(P, { ec: M.tariffs[v].ec, wheel: M.tariffs[v].wheel, dc: M.tariffs[v].dc });
    if (['ec', 'wheel', 'dc'].includes(id)) P.tariff = 'custom';
    if (id === 'fuel' && M.fuels[v]) Object.assign(P, { fuelCost: M.fuels[v].cost, fuelEf: M.fuels[v].ef });
    if (['fuelCost', 'fuelEf'].includes(id)) P.fuel = 'custom';
    preset = null;
  }

  // ===================== chart helpers =====================
  function bindTips(box) {
    const lbp = L();
    $$('[data-tip]', box).forEach((n) => {
      const html = n.getAttribute('data-tip');
      n.addEventListener('pointermove', (ev) => lbp.showTip(ev, (t) => { t.innerHTML = html; }));
      n.addEventListener('pointerdown', (ev) => lbp.showTip(ev, (t) => { t.innerHTML = html; }));
      n.addEventListener('pointerleave', lbp.onLeave(lbp.hideTip));
    });
  }
  const sw = (c) => `<span class='sw' style='background:${c}'></span>`;
  const row = (c, k, v) => `<div class='row'>${c ? sw(c) : ''}<span class='k'>${k}</span><b>${v}</b></div>`;
  function tickN(max) { const e = Math.pow(10, Math.floor(Math.log10(max || 1))); for (const n of [4, 5, 3, 6, 2]) { const q = max / n * 100 / e; if (Math.abs(q - Math.round(q)) < 1e-6) return n; } return 4; }
  function niceMax(v) { const e = Math.pow(10, Math.floor(Math.log10(v || 1))); const m = v / e; return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => m <= x + 1e-9) * e; }
  function rbar(x, y, w, h, r, side) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (side === 'right') return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    if (side === 'left') return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 12}" fill="${o.fill || css('--muted')}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
  function hstack(box, rows, colors, opts = {}) {
    const Wd = box.clientWidth || 600, narrow = Wd < 520, labW = narrow ? 0 : Math.min(opts.labW || 300, Wd * 0.42);
    const bar = narrow ? 14 : Math.min(16, (opts.rowH || 28) - 10), rowH = narrow ? bar + 26 : opts.rowH || 28, top = 4, valW = opts.valW || 56, Hh = top + rows.length * rowH + 22;
    const max = opts.max || niceMax(Math.max(...rows.map((r) => r.vals.reduce((a, b) => a + b, 0))) || 1);
    const x0 = narrow ? 1 : labW + 8, x1 = Wd - valW, sx = (v) => x0 + (x1 - x0) * v / max, n = Math.min(tickN(max), narrow ? 3 : 6);
    let s = `<svg width="${Wd}" height="${Hh}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (let i = 0; i <= n; i++) { const v = max * i / n, x = sx(v); s += `<line x1="${x}" x2="${x}" y1="${top}" y2="${Hh - 20}" stroke="${css(i ? '--grid' : '--axis')}"/>` + txt(x, Hh - 5, fmt(v, max < 5 ? 1 : 0), { anchor: 'middle', size: 11.5 }); }
    rows.forEach((r, i) => {
      const y = narrow ? top + i * rowH + 20 : top + i * rowH + (rowH - bar) / 2, tot = r.vals.reduce((a, b) => a + b, 0);
      s += narrow ? txt(0, y - 6, r.label, { fill: css('--fg'), size: 12.5 }) : txt(labW, y + bar / 2 + 4, r.label, { anchor: 'end', fill: css('--fg'), size: 12.5 });
      const segs = r.vals.map((v, k) => ({ v, k })).filter((o) => o.v > 0); let acc = 0;
      segs.forEach((o, j) => {
        const xa = sx(acc), xb = sx(acc + o.v); acc += o.v; const last = j === segs.length - 1, w = Math.max(0, xb - xa - (last ? 0 : 2)); if (w <= 0) return;
        s += last ? `<path d="${rbar(xa, y, w, bar, 4, 'right')}" fill="${colors[o.k]}"/>` : `<rect x="${xa}" y="${y}" width="${w}" height="${bar}" fill="${colors[o.k]}"/>`;
      });
      s += txt(sx(tot) + 6, y + bar / 2 + 4, opts.valFmt ? opts.valFmt(tot, r) : fmt(tot), { fill: css('--fg'), size: 12.5, weight: 600 });
      if (r.tip) s += `<rect x="0" y="${top + i * rowH}" width="${Wd}" height="${rowH}" fill="transparent" data-tip="${esc(r.tip)}"/>`;
    });
    box.innerHTML = s + '</svg>'; bindTips(box);
  }
  function vstack(box, cats, series, colors, opts) {
    const Wd = box.clientWidth || 600, Hh = opts.h || 240, Lm = 46, R = 6, T = 10, B = 24;
    const max = niceMax(Math.max(...cats.map((c, i) => series.reduce((a, s) => a + s[i], 0))) || 1), n = tickN(max);
    const step = (Wd - Lm - R) / cats.length, bw = Math.min(24, step * 0.6), sy = (v) => T + (Hh - T - B) * (1 - v / max);
    let s = `<svg width="${Wd}" height="${Hh}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (let i = 0; i <= n; i++) { const v = max * i / n, y = sy(v); s += `<line x1="${Lm}" x2="${Wd - R}" y1="${y}" y2="${y}" stroke="${css(i ? '--grid' : '--axis')}"/>` + txt(Lm - 6, y + 4, fmt0(v), { anchor: 'end', size: 11.5 }); }
    cats.forEach((c, i) => {
      const x = Lm + step * i + (step - bw) / 2; let acc = 0; const parts = series.map((sr, k) => ({ v: sr[i], k })).filter((o) => o.v > 0);
      parts.forEach((o, j) => { const ya = sy(acc), yb = sy(acc + o.v); acc += o.v; const last = j === parts.length - 1;
        s += last ? `<path d="${rbar(x, yb, bw, ya - yb, 4, 'top')}" fill="${colors[o.k]}"/>` : `<rect x="${x}" y="${yb + 2}" width="${bw}" height="${Math.max(0, ya - yb - 2)}" fill="${colors[o.k]}"/>`; });
      s += txt(x + bw / 2, Hh - 7, c, { anchor: 'middle', size: 11.5 });
      s += `<rect x="${Lm + step * i}" y="${T}" width="${step}" height="${Hh - T - B}" fill="transparent" data-tip="${esc(opts.tip(i))}"/>`;
    });
    box.innerHTML = s + '</svg>'; bindTips(box);
  }
  function lineChart(box, xs, ys, cur, opts = {}) {
    const Wd = box.clientWidth || 600, Hh = opts.h || 230, Lm = 40, R = 16, T = 14, B = 26;
    const ymax = niceMax(Math.max(...ys, cur.y) * 1.05), n = tickN(ymax), xmin = xs[0], xmax = xs[xs.length - 1];
    const sx = (v) => Lm + (Wd - Lm - R) * (v - xmin) / (xmax - xmin), sy = (v) => T + (Hh - T - B) * (1 - v / ymax);
    let s = `<svg width="${Wd}" height="${Hh}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (let i = 0; i <= n; i++) { const v = ymax * i / n, y = sy(v); s += `<line x1="${Lm}" x2="${Wd - R}" y1="${y}" y2="${y}" stroke="${css(i ? '--grid' : '--axis')}"/>` + txt(Lm - 6, y + 4, fmt0(v), { anchor: 'end', size: 11.5 }); }
    [20, 40, 60, 80, 100].forEach((v) => { s += txt(sx(v), Hh - 7, v + '%', { anchor: 'middle', size: 11.5 }); });
    s += `<path d="${xs.map((x, i) => (i ? 'L' : 'M') + sx(x) + ',' + sy(ys[i])).join('')}" fill="none" stroke="${css('--blue')}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${sx(cur.x)}" cy="${sy(cur.y)}" r="5" fill="${css('--blue')}" stroke="${css('--panel')}" stroke-width="2"/>`;
    s += txt(Math.min(sx(cur.x) + 9, Wd - 64), sy(cur.y) - 10, `${fmt(cur.y)} kWh`, { fill: css('--fg'), weight: 600 });
    s += `<line class="pw-xh" x1="0" x2="0" y1="${T}" y2="${Hh - B}" stroke="${css('--axis')}" opacity="0"/><rect class="pw-hit" x="${Lm}" y="${T}" width="${Wd - Lm - R}" height="${Hh - T - B}" fill="transparent"/>`;
    box.innerHTML = s + '</svg>';
    const hit = $('.pw-hit', box), xh = $('.pw-xh', box), lbp = L();
    const mv = (ev) => { const r = box.getBoundingClientRect(); let i = Math.round(((ev.clientX - r.left - Lm) / (Wd - Lm - R) * (xmax - xmin)) / (xs[1] - xs[0])); i = Math.max(0, Math.min(xs.length - 1, i));
      xh.setAttribute('x1', sx(xs[i])); xh.setAttribute('x2', sx(xs[i])); xh.setAttribute('opacity', 1);
      lbp.showTip(ev, (t) => { t.innerHTML = `<b>${xs[i]}% of nameplate</b>` + row(css('--blue'), 'Electricity per kWh of cells', fmt(ys[i]) + ' kWh') + (opts.extra ? opts.extra(i) : ''); }); };
    hit.addEventListener('pointermove', mv); hit.addEventListener('pointerdown', mv);
    hit.addEventListener('pointerleave', lbp.onLeave(() => { lbp.hideTip(); xh.setAttribute('opacity', 0); }));
  }
  function tornado(box, rows, base) {
    const Wd = box.clientWidth || 600, labW = Math.min(200, Wd * 0.45), rowH = 28, bar = 14, T = 4, Hh = T + rows.length * rowH + 22;
    const m = niceMax(Math.max(...rows.map((r) => Math.max(Math.abs(r.lo - base), Math.abs(r.hi - base)))) * 1.1 || 1);
    const x0 = labW + 8, x1 = Wd - 30, mid = (x0 + x1) / 2, sx = (d) => mid + (x1 - x0) / 2 * d / m;
    let s = `<svg width="${Wd}" height="${Hh}" role="img" aria-label="What moves the estimate">`;
    [-m, -m / 2, 0, m / 2, m].forEach((v) => { s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${Hh - 20}" stroke="${css(v === 0 ? '--axis' : '--grid')}"/>` + txt(sx(v), Hh - 5, (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), m < 10 ? 1 : 0), { anchor: 'middle', size: 11.5 }); });
    rows.forEach((r, i) => {
      const y = T + i * rowH + (rowH - bar) / 2;
      s += txt(labW, y + bar / 2 + 4, r.label, { anchor: 'end', fill: css('--fg'), size: 12.5 });
      [[r.lo, css('--blue')], [r.hi, css('--orange')]].forEach(([v, c]) => { const d = v - base; if (Math.abs(d) < 1e-6) return; const xa = sx(Math.min(0, d)), xb = sx(Math.max(0, d)); s += `<path d="${rbar(xa, y, Math.max(1, xb - xa), bar, 4, d > 0 ? 'right' : 'left')}" fill="${c}"/>`; });
      const sg = (d) => (d >= 0 ? '+' : '−') + fmt(Math.abs(d));
      s += `<rect x="0" y="${T + i * rowH}" width="${Wd}" height="${rowH}" fill="transparent" data-tip="${esc(`<b>${r.label}</b>` + row(css('--blue'), r.loTxt, `${fmt(r.lo)} kWh (${sg(r.lo - base)})`) + row(css('--orange'), r.hiTxt, `${fmt(r.hi)} kWh (${sg(r.hi - base)})`))}"/>`;
    });
    box.innerHTML = s + '</svg>'; bindTips(box);
  }
  const legend = (items) => `<div class="pw-legend">${items.map(([c, t]) => `<span><i style="background:var(${c})"></i>${t}</span>`).join('')}</div>`;

  // ===================== views =====================
  function seg(id, opts, cur, label) { return `<div class="seg" id="${id}" role="group" aria-label="${esc(label)}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${String(String(v) === String(cur))}">${t}</button>`).join('')}</div>`; }
  function buildSimple() {
    const box = $('#pw-simple');
    box.innerHTML = `
      <div class="pw-sgrid">
        <div class="panel pw-ctl" style="--sec:var(--teal)">
          <div class="panel-head"><h2>The plant</h2></div>
          <label class="pw-sf"><span class="lbl">Nameplate capacity</span><span class="pw-sv"><input class="num-in" type="number" id="pws-cap" min="1" max="20" step="0.5"> <span class="lbl">GWh a year</span></span><input type="range" id="pws-capr" min="1" max="20" step="0.5"></label>
          <label class="pw-sf"><span class="lbl">Output this year</span><span class="pw-sv"><b id="pws-utilv"></b> <span class="lbl">% of nameplate</span></span><input type="range" id="pws-util" min="10" max="100" step="1"></label>
          <div class="pw-sf"><span class="lbl">Heat for electrode ovens and dry rooms</span><div id="pws-heat"></div></div>
          <div class="pw-sf"><span class="lbl">Equipment</span><div id="pws-tech"></div></div>
          <div class="pw-sf"><span class="lbl">Electricity duty</span><div id="pws-ed"></div></div>
          <p class="sub">A ${esc(M.climate.place)} plant making LFP prismatic cells. Detailed view: every assumption, editable.</p>
        </div>
        <div class="panel" style="--sec:var(--blue)">
          <div class="panel-head"><h2>What it needs</h2><span class="sub">Estimate from public data</span></div>
          <div class="kpis big" id="pws-kpis"></div>
          <p class="pw-say" id="pws-say"></p>
        </div>
      </div>
      <div class="pw-sgrid two">
        <div class="panel" style="--sec:var(--blue)">
          <div class="panel-head"><h2>Where the power goes</h2><span class="sub">kWh per kWh of cells</span></div>
          <div class="pw-chart" id="pws-groups"></div>
        </div>
        <div class="panel" style="--sec:var(--blue)">
          <div class="panel-head"><h2>Lower output, more power per cell</h2></div>
          <p class="sub">Much of the plant runs whether or not lines are busy, so ramp-up years use far more power per kWh. Dot = this year.</p>
          <div class="pw-chart" id="pws-util-ch"></div>
        </div>
      </div>
      <div class="pw-more"><button class="btn small" type="button" id="pws-detail">See every step and assumption in the detailed view →</button></div>`;
    const cap = $('#pws-cap'), capr = $('#pws-capr');
    cap.addEventListener('input', () => { if (cap.value === '') return; setVal('cap', cap.value); capr.value = P.cap; update(); });
    capr.addEventListener('input', () => { setVal('cap', capr.value); cap.value = P.cap; update(); });
    $('#pws-util').addEventListener('input', (e) => { setVal('util', e.target.value); update(); });
    $('#pws-detail').addEventListener('click', () => setMode('detail', true));
    built.s = true;
  }
  function syncSimple() {
    const cap = $('#pws-cap'); if (cap !== document.activeElement) cap.value = P.cap; $('#pws-capr').value = P.cap;
    $('#pws-util').value = P.util; $('#pws-utilv').textContent = P.util;
    const heat = P.dryerHeat === 'boiler' && P.regenHeat === 'boiler' ? 'boiler' : P.dryerHeat !== 'boiler' && P.regenHeat === 'elec' ? 'elec' : 'mix';
    $('#pws-heat').innerHTML = seg('pws-heat-s', [['elec', 'Electric'], ['boiler', 'Gas or biomass boiler']], heat, 'Heat source');
    const best = M.presets.best.set, isBest = Object.keys(best).every((k) => String(P[k]) === String(best[k]));
    const isBase = Object.keys(best).every((k) => String(P[k]) === String(M.defaults[k]));
    $('#pws-tech').innerHTML = seg('pws-tech-s', [['base', 'Typical today'], ['best', 'Best available']], isBest ? 'best' : isBase ? 'base' : '', 'Equipment');
    $('#pws-ed').innerHTML = seg('pws-ed-s', [[1, 'Payable'], [0, 'Exempt']], +P.edOn, 'Electricity duty');
    $$('#pws-heat-s button').forEach((b) => b.addEventListener('click', () => { const v = b.dataset.v; P.dryerHeat = v === 'boiler' ? 'boiler' : (P.dryerHeat === 'hp' ? 'hp' : 'elec'); P.regenHeat = v; preset = null; update(); }));
    $$('#pws-tech-s button').forEach((b) => b.addEventListener('click', () => { const src = b.dataset.v === 'best' ? best : Object.fromEntries(Object.keys(best).map((k) => [k, M.defaults[k]])); const keepBoiler = P.dryerHeat === 'boiler'; Object.assign(P, src); if (keepBoiler) P.dryerHeat = 'boiler'; preset = null; update(); }));
    $$('#pws-ed-s button').forEach((b) => b.addEventListener('click', () => { P.edOn = +b.dataset.v; preset = null; update(); }));
  }
  function renderSimple(r) {
    syncSimple();
    const out = r.out, tot = r.elecCost + r.fuelCost;
    $('#pws-kpis').innerHTML = [
      ['main', 'Electricity per kWh of cells', `${fmt(r.elInt)}<span class="u"> kWh</span>`, r.thInt > 0.05 ? `plus ${fmt(r.thInt)} kWh of fuel heat` : `at ${P.util}% output`],
      ['', 'Electricity a year', `${fmt0(r.elSum / 1e6)}<span class="u"> million kWh</span>`, `${fmt(r.avgMW)} MW on average`],
      ['', 'Grid connection', `${fmt0(r.cdMVA)}<span class="u"> MVA</span>`, `peak about ${fmt(r.mdMW)} MW`],
      ['', 'Energy bill a year', `₹${fmt0(cr(tot))}<span class="u"> crore</span>`, `₹${fmt0(tot / out)} per kWh of cells`],
    ].map(([c, k, v, d]) => `<div class="kpi ${c}"><span class="k">${k}</span><span class="v">${v}</span><span class="d pw-dim">${d}</span></div>`).join('');
    const groups = GROUPS.map(([name, keys, what]) => { const v = r.steps.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.el, 0) / out; return { name, v, what }; }).sort((a, b) => b.v - a.v);
    hstack($('#pws-groups'), groups.map((g) => ({ label: g.name, vals: [g.v], tip: `<b>${g.name}</b>` + row(css('--blue'), 'Per kWh of cells', fmt(g.v) + ' kWh') + row(null, 'Share', fmt0(100 * g.v / r.elInt) + '%') + `<div class='note'>${g.what}</div>` })),
      [css('--blue')], { valFmt: (t) => `${fmt(t)} · ${fmt0(100 * t / r.elInt)}%`, valW: 86, labW: 190, rowH: 34, aria: 'Electricity by plant area' });
    const g1 = groups[0], g2 = groups[1];
    const fixedShare = r.steps.reduce((a, s) => a + s.el * (s.fixed / (s.fixed + (1 - s.fixed) * r.u)), 0) / r.elSum;
    $('#pws-say').textContent = `${g1.name} and ${g2.name.toLowerCase()} take ${fmt0(100 * (g1.v + g2.v) / r.elInt)}% of the power. About ${fmt0(100 * fixedShare)}% runs whatever the output, so a year at lower output costs more per kWh of cells. ${r.thInt > 0.05 ? `Boilers add ${fmt(r.thInt)} kWh of fuel heat per kWh of cells.` : 'All heat here comes from electricity.'}`;
    const xs = [], ys = [], mu = []; for (let x = 20; x <= 100; x += 5) { const q = run(P, x); xs.push(x); ys.push(q.elInt); mu.push(q.elSum / 1e6); }
    lineChart($('#pws-util-ch'), xs, ys, { x: P.util, y: r.elInt }, { aria: 'Electricity per kWh against output', extra: (i) => row(null, 'Electricity a year', fmt0(mu[i]) + ' million kWh') });
  }

  function buildDetail() {
    const box = $('#pw-detail');
    box.innerHTML = `
      <div class="panel pw-bar">
        <div class="chips" id="pwd-presets" role="group" aria-label="Starting points"></div>
        <div class="pw-acts"><button class="btn ghost small" type="button" id="pwd-reset">Back to defaults</button><button class="btn small" type="button" id="pwd-copy">Copy summary</button></div>
      </div>
      <div class="pw-dgrid">
        <aside class="pw-inputs" id="pwd-inputs" aria-label="Assumptions"></aside>
        <div class="pw-res">
          <div class="kpis pw-k6" id="pwd-kpis"></div>
          <div class="panel" style="--sec:var(--blue)">
            <div class="panel-head"><h2>Where the electricity goes</h2></div>
            <p class="sub" id="pwd-bd-sub"></p>
            ${legend([['--blue', 'Grows with output'], ['--orange', 'Runs even when lines are idle']])}
            <div class="pw-chart" id="pwd-bd"></div>
            <details class="pw-det"><summary>Show as a table</summary><div class="table-wrap" id="pwd-bd-t"></div></details>
          </div>
          <div class="pw-two">
            <div class="panel" style="--sec:var(--teal)">
              <div class="panel-head"><h2>Month by month</h2></div>
              <p class="sub">Electricity, MWh a month, April to March. Humid monsoon air raises the dry-room and air-conditioning load.</p>
              ${legend([['--blue', 'Process and utilities'], ['--orange', 'Dry rooms'], ['--teal', 'Other halls’ air-conditioning']])}
              <div class="pw-chart" id="pwd-mon"></div>
            </div>
            <div class="panel" style="--sec:var(--teal)">
              <div class="panel-head"><h2>Output drives the number</h2></div>
              <p class="sub">kWh of electricity per kWh of good cells as output changes. Dot = current setting.</p>
              <div class="pw-chart" id="pwd-util"></div>
            </div>
          </div>
          <div class="panel" style="--sec:var(--teal)">
            <div class="panel-head"><h2>Ramp-up years</h2></div>
            <p class="sub">Type the output for each year; everything else follows the assumptions.</p>
            <div class="table-wrap" id="pwd-ramp"></div>
          </div>
          <div class="pw-two">
            <div class="panel" style="--sec:var(--amber)">
              <div class="panel-head"><h2>What moves the estimate</h2></div>
              <p class="sub">Change in kWh per kWh when one assumption moves by the step shown.</p>
              ${legend([['--blue', 'Assumption lower'], ['--orange', 'Assumption higher']])}
              <div class="pw-chart" id="pwd-tor"></div>
            </div>
            <div class="panel" style="--sec:var(--amber)">
              <div class="panel-head"><h2>Against published figures</h2></div>
              <p class="sub">kWh per kWh of cells. Published plant figures are design values.</p>
              ${legend([['--blue', 'Electricity'], ['--orange', 'Fuel heat'], ['--teal', 'All energy, split not given']])}
              <div class="pw-chart" id="pwd-bench"></div>
            </div>
          </div>
          <div class="panel" style="--sec:var(--plum)">
            <div class="panel-head"><h2>Energy bill and emissions</h2></div>
            <p class="sub" id="pwd-bill-sub"></p>
            <div class="table-wrap" id="pwd-bill"></div>
            <p class="sub" id="pwd-co2"></p>
          </div>
          <details class="panel pw-method">
            <summary><h2>How the estimate works</h2></summary>
            <div class="pw-mtext" id="pwd-method"></div>
            <h3 class="pw-h3">Climate: ${esc(M.climate.place)}</h3>
            <div class="table-wrap" id="pwd-clim"></div>
            <p class="sub">${esc(M.climate.note)}</p>
          </details>
          <details class="panel pw-method">
            <summary><h2>Sources</h2></summary>
            <ul class="method pw-src">${M.sources.map((s) => `<li>${esc(s.t)} <a href="${esc(s.url)}" target="_blank" rel="noopener">Source</a></li>`).join('')}</ul>
            <p class="sub">Confidence on each assumption: H = published or contractual, M = industry range, L = engineering assumption, to be confirmed by the equipment makers.</p>
          </details>
        </div>
      </div>`;
    const inp = $('#pwd-inputs');
    G().forEach((g) => {
      const d = document.createElement('details'); d.className = 'pw-grp'; if (g.open) d.open = true;
      d.innerHTML = `<summary>${g.t}</summary><div class="pw-gb">${g.f.map(([id, label, unit, min, max, step, conf, help, sel]) => {
        const c = `<span class="pw-conf c${conf}" title="Confidence">${conf}</span>`;
        if (sel) return `<div class="pw-f" id="pwf-${id}"><div class="pw-fr"><span class="pw-fl">${label}${c}</span><select class="select pw-sel" data-id="${id}">${sel.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div>${help ? `<p class="pw-help">${help}</p>` : ''}</div>`;
        return `<div class="pw-f" id="pwf-${id}"><div class="pw-fr"><span class="pw-fl">${label}${c}</span><span class="pw-fv"><input type="number" data-id="${id}" step="${step}"><span class="pw-u">${unit}</span></span></div><input type="range" data-r="${id}" min="${min}" max="${max}" step="${step}">${help ? `<p class="pw-help">${help}</p>` : ''}</div>`;
      }).join('')}</div>`;
      inp.appendChild(d);
    });
    inp.addEventListener('input', (e) => { const t = e.target, id = t.dataset.id || t.dataset.r; if (!id || t.value === '') return; setVal(id, t.value); update(id); });
    $('#pwd-reset').addEventListener('click', () => { reset(); preset = 'base'; update(); });
    $('#pwd-copy').addEventListener('click', () => { const s = summary(); try { navigator.clipboard.writeText(s).then(() => toast('Summary copied'), () => window.prompt('Copy:', s)); } catch (e) { window.prompt('Copy:', s); } });
    $('#pwd-ramp').addEventListener('input', (e) => { const i = e.target.dataset.ramp; if (i == null || e.target.value === '') return; P.ramp = P.ramp.slice(); P.ramp[+i] = Math.max(5, Math.min(100, +e.target.value)); update(); });
    let h = '<table class="rtable pw-clim"><tr><th></th>' + MONTHS.map((m) => `<th>${m}</th>`).join('') + '</tr>';
    h += '<tr><td>Mean °C</td>' + MONTHS.map((m, i) => `<td><input type="number" step="0.5" data-c="climT:${i}"></td>`).join('') + '</tr>';
    h += '<tr><td>Dew point °C</td>' + MONTHS.map((m, i) => `<td><input type="number" step="0.5" data-c="climDp:${i}"></td>`).join('') + '</tr></table>';
    $('#pwd-clim').innerHTML = h;
    $('#pwd-clim').addEventListener('input', (e) => { const c = e.target.dataset.c; if (!c || e.target.value === '') return; const [a, i] = c.split(':'); P[a] = P[a].slice(); P[a][+i] = +e.target.value; preset = null; update(); });
    built.d = true;
  }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.replaceChildren(document.createTextNode(msg)); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
  function syncDetail(skip) {
    $$('#pwd-inputs [data-id]').forEach((e) => { if (e === document.activeElement && e.dataset.id === skip) return; e.value = P[e.dataset.id]; });
    $$('#pwd-inputs [data-r]').forEach((e) => { e.value = P[e.dataset.r]; });
    const show = (id, on) => { const f = $('#pwf-' + id); if (f) f.hidden = !on; };
    show('hpCop', P.dryerHeat === 'hp'); show('regenEff', +P.regen === 1); show('ed', +P.edOn === 1); show('reCost', P.reShare > 0);
    const fuelOn = P.dryerHeat === 'boiler' || P.regenHeat === 'boiler'; ['boilerEff', 'fuel', 'fuelCost', 'fuelEf'].forEach((i) => show(i, fuelOn));
    $$('#pwd-clim input').forEach((e) => { if (e === document.activeElement) return; const [a, i] = e.dataset.c.split(':'); e.value = P[a][+i]; });
    const pr = $('#pwd-presets');
    pr.innerHTML = Object.entries(M.presets).map(([k, v]) => `<button type="button" data-p="${k}" aria-pressed="${String(preset === k)}">${esc(v.name)}</button>`).join('');
    $$('button', pr).forEach((b) => b.addEventListener('click', () => { reset(M.presets[b.dataset.p].set); preset = b.dataset.p; update(); }));
  }
  function renderDetail(r, skip) {
    syncDetail(skip);
    const out = r.out, tot = r.elecCost + r.fuelCost, co2 = r.co2Grid + r.co2Fuel;
    $('#pwd-kpis').innerHTML = [
      ['main', 'Electricity per kWh of cells', `${fmt(r.elInt)}<span class="u"> kWh</span>`, r.thInt > 0.05 ? `plus ${fmt(r.thInt)} kWh fuel heat` : `at ${P.util}% output`],
      ['', 'Electricity a year', `${fmt0(r.elSum / 1e6)}<span class="u"> MU</span>`, `${fmt(out / 1e6, 2)} GWh of cells`],
      ['', 'Average and peak', `${fmt(r.avgMW)}<span class="u"> MW</span>`, `peak ${fmt(r.mdMW)} MW · ${fmt0(r.cdMVA)} MVA contract`],
      ['', 'Energy bill a year', `₹${fmt0(cr(tot))}<span class="u"> cr</span>`, r.fuelCost > 0 ? `incl. ₹${fmt0(cr(r.fuelCost))} cr fuel` : `₹${fmt(r.elecCost / r.elSum, 2)} per kWh average`],
      ['', 'Per kWh of cells', `₹${fmt0(tot / out)}`, `US$${fmt(tot / out / P.fx, 2)}`],
      ['', 'CO₂ per kWh of cells', `${fmt(co2 * 1000 / out)}<span class="u"> kg</span>`, `${fmt0(co2)} t a year`],
    ].map(([c, k, v, d]) => `<div class="kpi ${c}"><span class="k">${k}</span><span class="v">${v}</span><span class="d pw-dim">${d}</span></div>`).join('');
    // breakdown
    const steps = r.steps.slice().sort((a, b) => b.el - a.el);
    const rows = steps.map((s) => {
      const e = s.el / out, fx = ['dryroom', 'hvac', 'misc'].includes(s.key) ? e : e * s.fixed / (s.fixed + (1 - s.fixed) * r.u), vr = e - fx;
      return { label: s.name, vals: [vr, fx], tip: `<b>${esc(s.name)}</b>` + row(null, 'Per kWh of cells', fmt(e, 2) + ' kWh') + row(null, 'A year', fmt(s.el / 1e6, 1) + ' MU · ' + fmt(100 * s.el / r.elSum) + '%') + row(css('--blue'), 'Grows with output', fmt(vr, 2)) + row(css('--orange'), 'Runs when idle', fmt(fx, 2)) + (s.th > 0 ? row(null, 'Plus fuel heat', fmt(s.th / out, 2) + ' kWh') : '') };
    }).filter((x) => x.vals[0] + x.vals[1] > 0.005);
    hstack($('#pwd-bd'), rows, [css('--blue'), css('--orange')], { valFmt: (t) => fmt(t, t < 1 ? 2 : 1), aria: 'Electricity by step', rowH: 26 });
    const top3 = steps.slice(0, 3), fixedTot = rows.reduce((a, x) => a + x.vals[1], 0);
    $('#pwd-bd-sub').textContent = `kWh of electricity per kWh of good cells, step by step. ${top3.map((s) => SHORT[s.key]).join(', ').replace(/^./, (c) => c.toUpperCase())} make up ${fmt0(100 * top3.reduce((a, s) => a + s.el, 0) / r.elSum)}%. ${fmt0(100 * fixedTot / r.elInt)}% runs whatever the output.`;
    let t = '<table class="rtable pw-num"><tr><th>Step</th><th>kWh per kWh</th><th>MU a year</th><th>Share</th><th>Fuel heat</th></tr>';
    steps.forEach((s) => { t += `<tr><td>${esc(s.name)}</td><td>${fmt(s.el / out, 2)}</td><td>${fmt(s.el / 1e6, 1)}</td><td>${fmt(100 * s.el / r.elSum)}%</td><td>${s.th > 0 ? fmt(s.th / out, 2) : '–'}</td></tr>`; });
    $('#pwd-bd-t').innerHTML = t + `<tr class="pw-tot"><td>Total</td><td>${fmt(r.elInt, 2)}</td><td>${fmt(r.elSum / 1e6, 1)}</td><td>100%</td><td>${r.thInt > 0 ? fmt(r.thInt, 2) : '–'}</td></tr></table>`;
    // monthly
    const Mo = r.monthly;
    vstack($('#pwd-mon'), MONTHS, [Mo.map((x) => x.proc / 1000), Mo.map((x) => x.dry / 1000), Mo.map((x) => x.hvac / 1000)], [css('--blue'), css('--orange'), css('--teal')], { aria: 'Electricity by month',
      tip: (i) => `<b>${MONTHS[i]} · ${fmt0(Mo[i].total / 1000)} MWh</b>` + row(css('--blue'), 'Process and utilities', fmt0(Mo[i].proc / 1000)) + row(css('--orange'), 'Dry rooms', fmt0(Mo[i].dry / 1000)) + row(css('--teal'), 'Other halls’ air-conditioning', fmt0(Mo[i].hvac / 1000)) + `<div class='note'>${P.climT[i]} °C, dew point ${P.climDp[i]} °C · bill ₹${fmt(cr(Mo[i].cost), 1)} crore</div>` });
    const xs = [], ys = [], mu = []; for (let x = 20; x <= 100; x += 5) { const q = run(P, x); xs.push(x); ys.push(q.elInt); mu.push(q.elSum / 1e6); }
    lineChart($('#pwd-util'), xs, ys, { x: P.util, y: r.elInt }, { aria: 'Electricity per kWh against output', extra: (i) => row(null, 'A year', fmt0(mu[i]) + ' MU') });
    // ramp
    const fo = document.activeElement && document.activeElement.dataset.ramp;
    let rt = '<table class="rtable pw-num pw-ramp"><tr><th>Year</th><th>Output %</th><th>Cells GWh</th><th>MU</th><th>Avg MW</th><th>kWh per kWh</th><th>Bill ₹ cr</th><th>₹ per kWh</th></tr>';
    P.ramp.forEach((v, i) => { const q = run(P, v), c = q.elecCost + q.fuelCost; rt += `<tr><td>Year ${i + 1}</td><td><input type="number" min="5" max="100" step="1" data-ramp="${i}" value="${v}"></td><td>${fmt(q.out / 1e6, 2)}</td><td>${fmt0(q.elSum / 1e6)}</td><td>${fmt(q.avgMW)}</td><td>${fmt(q.elInt)}</td><td>${fmt0(cr(c))}</td><td>${fmt0(c / q.out)}</td></tr>`; });
    $('#pwd-ramp').innerHTML = rt + '</table>';
    if (fo != null) { const f = $(`#pwd-ramp [data-ramp="${fo}"]`); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) { /* number inputs */ } } }
    // tornado
    const tz = [
      ['util', 'Output', (v) => Math.max(10, v - 15), (v) => Math.min(100, v + 15), '15 points lower', '15 points higher'],
      ['dryArea', 'Dry-room area', (v) => v * 0.75, (v) => v * 1.25, '25% less', '25% more'],
      ['nmpHeat', 'Oven heat per kg NMP', (v) => v * 0.75, (v) => v * 1.25, '25% less', '25% more'],
      ['cathSolids', 'Cathode slurry solids', (v) => v - 5, (v) => v + 5, '5 points lower', '5 points higher'],
      ['faFlow', 'Dry-room fresh air', (v) => v * 0.7, (v) => v * 1.3, '30% less', '30% more'],
      ['roomDp', 'Dry-room dew point', (v) => v - 10, (v) => Math.min(-30, v + 10), '10 °C drier', '10 °C less dry'],
      ['yield', 'Yield', (v) => v - 4, (v) => Math.min(99, v + 4), '4 points lower', '4 points higher'],
      ['copRef', 'Chiller efficiency', (v) => v * 0.8, (v) => v * 1.2, '20% lower', '20% higher'],
      ['condArea', 'Other air-conditioned area', (v) => v * 0.75, (v) => v * 1.25, '25% less', '25% more'],
      ['convEff', 'Charger efficiency', (v) => v - 5, (v) => Math.min(98, v + 5), '5 points lower', '5 points higher'],
    ].map(([id, label, lo, hi, lt, ht]) => ({ label, lo: run({ ...P, [id]: lo(P[id]) }).elInt, hi: run({ ...P, [id]: hi(P[id]) }).elInt, loTxt: lt, hiTxt: ht }))
      .sort((a, b) => Math.max(Math.abs(b.lo - r.elInt), Math.abs(b.hi - r.elInt)) - Math.max(Math.abs(a.lo - r.elInt), Math.abs(a.hi - r.elInt)));
    tornado($('#pwd-tor'), tz, r.elInt);
    // benchmarks
    const bench = [{ label: 'This estimate', vals: [r.elInt, r.thInt, 0], tip: `<b>This estimate</b>` + row(css('--blue'), 'Electricity', fmt(r.elInt) + ' kWh') + row(css('--orange'), 'Fuel heat', fmt(r.thInt) + ' kWh') }]
      .concat(M.benchmarks.map((b) => ({ label: b.label, vals: [b.el || 0, b.th || 0, b.total || 0], tip: `<b>${esc(b.label)}</b>` + (b.total ? row(css('--teal'), 'All energy', fmt(b.total) + ' kWh') : row(css('--blue'), 'Electricity', fmt(b.el) + ' kWh') + row(css('--orange'), 'Fuel heat', fmt(b.th) + ' kWh')) + `<div class='note'>${esc(b.note)} ${esc(b.source)}.</div>` })));
    hstack($('#pwd-bench'), bench, [css('--blue'), css('--orange'), css('--teal')], { valFmt: (t) => fmt(t), labW: 200, aria: 'Published figures' });
    // bill
    const b = r.bill, line = (n, v, basis) => `<tr><td>${n}</td><td>${fmt(cr(v), 1)}</td><td>${fmt(100 * v / tot)}%</td><td>${fmt(v / out, 1)}</td><td class="pw-basis">${basis}</td></tr>`;
    let bt = '<table class="rtable pw-num"><tr><th>Item</th><th>₹ crore</th><th>Share</th><th>₹ per kWh of cells</th><th>Basis</th></tr>';
    bt += line('Energy charge', b.energy, `₹${P.ec} per kVAh`);
    bt += line('Time of day (peak surcharge less solar rebate)', b.tod, 'flat 24-hour load');
    bt += line('Demand charge', b.demand, `₹${P.dc} per kVA a month`);
    if (b.wheel) bt += line('Wheeling', b.wheel, `₹${P.wheel} per kVAh`);
    if (b.fac) bt += line('Fuel adjustment', b.fac, `₹${P.fac} per kVAh`);
    bt += line('Electricity duty', b.ed, +P.edOn ? `${P.ed}% of the charges` : 'exempt');
    if (b.re) bt += line('Renewable power', b.re, `${P.reShare}% at ₹${P.reCost} per kWh`);
    if (b.other) bt += line('Other levies', b.other, '');
    if (r.fuelCost) bt += line('Boiler fuel', r.fuelCost, `${fmt0(r.thSum / 1e6)} GWh of heat at ₹${P.fuelCost}`);
    $('#pwd-bill').innerHTML = bt + `<tr class="pw-tot"><td>Total</td><td>${fmt(cr(tot), 1)}</td><td>100%</td><td>${fmt(tot / out, 1)}</td><td class="pw-basis">US$${fmt(tot / out / P.fx, 2)} per kWh of cells</td></tr></table>`;
    $('#pwd-bill-sub').textContent = `At ${P.util}% output, ${fmt(out / 1e6, 2)} GWh of good cells (${fmt(r.cells / 1e6, 2)} million ${P.cellAh} Ah cells). Average power price ₹${fmt(r.elecCost / r.elSum, 2)} per kWh including demand charge and duty.`;
    $('#pwd-co2').textContent = `CO₂: grid ${fmt0(r.co2Grid)} t${r.co2Fuel > 0 ? ` plus fuel ${fmt0(r.co2Fuel)} t` : ''} a year, ${fmt(co2 * 1000 / out)} kg per kWh of cells, at ${P.gridEf} t per MWh for grid power.`;
    // method
    const drm = r.dr.months, wet = drm[3].el / (MDAYS[3] * 24) * 1000, dryM = drm[10].el / (MDAYS[10] * 24) * 1000;
    $('#pwd-method').innerHTML = `
      <p><b>Process steps</b> are kWh per kWh of cells at full rate. Each has a share that runs when lines are idle (ovens kept hot, chillers and compressors running), so at lower output the per-kWh figure rises. Energy spent on scrapped cells is charged to good ones through the yield.</p>
      <p><b>Electrode drying</b> follows the solvent evaporated: cathode LFP ÷ active share × (liquid ÷ solids). At these settings, ${fmt(r.nmp, 2)} kg of NMP and ${fmt(r.water, 2)} kg of water per kWh of cells, times the oven heat per kg.</p>
      <p><b>Formation</b> counts the energy pushed into each cell (first charge, any extra test cycles, recharge to shipping level) ÷ charger efficiency, less what regenerative equipment feeds back: ${fmt(r.dcIn, 2)} kWh in and ${fmt(r.dcOut, 2)} kWh out per kWh of cells, ${fmt(r.acIn - r.acBack, 2)} kWh net from the grid.</p>
      <p><b>Dry rooms</b> are worked out month by month from the climate: outdoor air is chilled to the coil dew point, a desiccant wheel takes out the rest down to the room dew point, and regeneration heat, chillers (less efficient in hot weather) and fans are added. They run 24×7: ${fmt0(r.dr.annual.el)} kWh per m² a year of electricity${r.dr.annual.th > 0 ? ` plus ${fmt0(r.dr.annual.th)} kWh of fuel heat` : ''}; about ${fmt0(wet)} W/m² in July and ${fmt0(dryM)} W/m² in February.</p>
      <p><b>The bill</b> follows the MSEDCL HT-Industry structure: energy charge per kVAh, peak-hour surcharge and solar-hour rebate on a flat 24-hour load, demand charge on the higher of the month’s peak or 75% of contract demand, wheeling (nil at 66 kV and above), electricity duty on these charges, and any renewable share at its landed price.</p>
      <p><b>Not included:</b> making cathode and anode materials, module and pack lines, and construction power.</p>`;
  }
  function summary() {
    const r = run(P), out = r.out, tot = r.elecCost + r.fuelCost;
    const top = r.steps.slice().sort((a, b) => b.el - a.el).slice(0, 4).map((s) => `  - ${s.name}: ${fmt(s.el / out)} kWh per kWh (${fmt0(100 * s.el / r.elSum)}%)`).join('\n');
    return `LFP cell plant, ${M.climate.place}: electricity estimate (LeyBatt Pulse)
Nameplate ${P.cap} GWh, output ${P.util}%, yield ${P.yield}% → ${fmt(out / 1e6, 2)} GWh of good cells a year
Electricity: ${fmt(r.elInt)} kWh per kWh of cells${r.thInt > 0.05 ? ` (+ ${fmt(r.thInt)} kWh fuel heat)` : ''}
A year: ${fmt0(r.elSum / 1e6)} million kWh; average ${fmt(r.avgMW)} MW, peak ${fmt(r.mdMW)} MW, contract demand about ${fmt0(r.cdMVA)} MVA
Energy bill: ₹${fmt0(cr(tot))} crore a year, ₹${fmt0(tot / out)} per kWh of cells
Largest loads:
${top}
Tariff: ₹${P.ec}/kVAh, ₹${P.dc}/kVA a month, wheeling ₹${P.wheel}/kVAh, electricity duty ${+P.edOn ? P.ed + '%' : 'exempt'}`;
  }

  // ===================== entry =====================
  function setMode(m, scroll) {
    mode = m; try { localStorage.setItem(STORE_KEY, m); } catch (e) { /* ignore */ }
    $$('#pw-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $('#pw-simple').hidden = m !== 'simple'; $('#pw-detail').hidden = m !== 'detail';
    update();
    if (scroll) { const h = $('#pw-mode'); if (h) h.scrollIntoView({ block: 'start' }); }
  }
  function update(skip) {
    if (!M) return;
    const r = run(P);
    try {
      if (mode === 'simple') { if (!built.s) buildSimple(); renderSimple(r); } else { if (!built.d) buildDetail(); renderDetail(r, skip); }
    } catch (e) { console.error(e); }
  }
  let wired = false;
  function render() {
    if (!init()) { const b = $('#pw-simple'); if (b) b.innerHTML = '<div class="panel"><p class="sub">The plant power model did not load.</p></div>'; return; }
    if (!wired) { $$('#pw-mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode))); wired = true; }
    $$('#pw-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#pw-simple').hidden = mode !== 'simple'; $('#pw-detail').hidden = mode !== 'detail';
    update();
  }
  function headline() {
    if (!init()) return null;
    const r = run(P);
    return { label: 'Electricity per kWh of LFP cells', value: fmt(r.elInt), unit: ' kWh', move: `${fmt0(r.elSum / 1e6)} million kWh a year at ${P.cap} GWh, ${P.util}% output` };
  }
  window.PowerTab = { render, headline, run };
})();
