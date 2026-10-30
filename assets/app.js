(() => {
  'use strict';
  const FILES = ['meta', 'latest', 'lithium', 'cell314', 'cellbids', 'systems', 'rawmats', 'news', 'weekly', 'marketshare', 'forecasts', 'costmodel', 'evcells', 'events', 'risk', 'regulations', 'tenders', 'landed', 'indiastorage'];
  const VAT = 1.13;
  const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['3Y', 1096], ['5Y', 1827], ['All', 0]];
  const TABS = ['overview', 'materials', 'news', 'rules', 'calculator', 'storage', 'risk', 'brief', 'chain'];
  const SUBS = ['all', 'lithium', 'cells', 'systems'];
  const LEGACY = { lithium: 'materials/lithium', cells: 'materials/cells', systems: 'materials/systems' };
  const LAYER_COLOR = { lithium: '--amber', cathode: '--plum', cell314: '--blue', cell587: '--teal', evcell: '--magenta', pack: '--green', system: '--indigo' };
  const CAT_COLOR = { 'Lithium & materials': '--amber', 'Cell makers & competitors': '--blue', 'Packs & BMS': '--orange', 'R&D & new products': '--teal', 'Energy storage': '--indigo', 'EV market': '--green', 'India BESS': '--rose', 'India EV & battery makers': '--magenta', 'Regulation & trade': '--plum' };
  const catColor = (c) => css(CAT_COLOR[c] || '--slate');
  const CARD_TAB = { lithium: 'materials/lithium', cathode: 'materials/all', cell314: 'materials/cells', cell587: 'materials/cells', evcell: 'materials/cells', pack: 'materials/all', system: 'materials/systems' };

  const D = {};
  const S = {
    tab: 'overview',
    range: { lithium: 1827, cell: 0, sysweekly: 0, chain: 1827, metals: 1827 },
    hidden: { lithium: new Set(), sys: new Set() },
    news: { q: '', cat: '', effect: '' },
    sub: 'all',
    raw: { q: '', key: null, dir: 1, stage: '' },
    gapFrom: '2026-04-20',
    calc: null, calcBase: null, scen: 'latest',
  };

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (name, url) => { const a = el('a', null, name); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const fmtUsd0 = d3.format('$,.0f');
  const fmtUsd1 = d3.format('$,.1f');
  const pctS = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  const dayFmt = d3.utcFormat('%-d %b %Y');
  const shortDay = d3.utcFormat('%-d %b');
  const dirClass = (d) => (d === 'down' ? ' is-down' : d === 'up' ? ' is-up' : '');
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

  // ---------- tooltip ----------
  const tipEl = $('#tip');
  function showTip(ev, build) {
    tipEl.replaceChildren(); build(tipEl); tipEl.hidden = false;
    const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY - h - pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y < 8) y = ev.clientY + pad;
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = y + 'px';
  }
  const hideTip = () => { tipEl.hidden = true; };
  const tipRow = (t, color, label, value) => { const r = el('div', 'row'); if (color) { const s = el('span', 'sw'); s.style.background = color; r.appendChild(s); } if (label) r.appendChild(el('span', 'k', label)); if (value) r.appendChild(el('b', null, value)); t.appendChild(r); };
  const tipNote = (t, text) => t.appendChild(el('div', 'note', text));
  window.addEventListener('scroll', hideTip, { passive: true });

  const fail = (box, msg = 'Failed to load') => box.replaceChildren(el('div', 'fail', msg));
  const measure = (svg, texts, size = 12) => { const g = svg.append('g').attr('font-size', size); const w = d3.max(texts, (s) => g.append('text').text(s).node().getComputedTextLength()) || 0; g.remove(); return w; };
  const axisStyle = (g) => { g.attr('font-size', null).attr('font-family', null); g.selectAll('text').attr('fill', css('--muted')).attr('font-size', 12); g.selectAll('line').attr('stroke', css('--grid')); g.select('.domain').remove(); };
  const srcLinks = (p, rows) => {
    if (!p) return;
    p.replaceChildren(document.createTextNode('Sources: '));
    const byName = new Map();
    [...rows].sort((x, y) => d3.ascending(x.date || '', y.date || '')).forEach((r) => { if (!r.url) return; const e = byName.get(r.source) || { urls: new Set(), last: r.url }; e.urls.add(r.url); e.last = r.url; byName.set(r.source, e); });
    [...byName].forEach(([name, e], i) => { if (i) p.appendChild(document.createTextNode(' · ')); p.appendChild(link(e.urls.size > 1 ? `${name} (${e.urls.size} reports, latest)` : name, e.last)); });
  };

  // ---------- charts ----------
  // series: [{name, color, points:[{d, v, lo?, hi?, source, note?}]}]
  const thin = (pts, max = 400) => { if (pts.length <= max) return pts; const k = Math.ceil(pts.length / max); return pts.filter((p, i) => i % k === 0 || i === pts.length - 1); };
  function timeChart(box, series, { fmt, rangeDays = 0, height = 300, band = false }) {
    box.replaceChildren();
    const all = series.flatMap((s) => s.points);
    if (!all.length) { box.appendChild(el('div', 'empty', 'Nothing to show. Turn a series back on.')); return; }
    const maxD = d3.max(all, (p) => p.d);
    const cutoff = rangeDays ? new Date(+maxD - rangeDays * 864e5) : new Date(-8.64e15);
    const vis = series.map((s) => ({ ...s, points: thin(s.points.filter((p) => p.d >= cutoff).sort((a, b) => a.d - b.d)) })).filter((s) => s.points.length);
    const pts = vis.flatMap((s) => s.points.map((p) => ({ ...p, s })));
    if (!pts.length) { box.appendChild(el('div', 'empty', 'No readings in this period. Choose a longer range.')); return; }
    const W = box.clientWidth || 640, H = height;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const lo = d3.min(pts, (p) => (band && p.lo != null ? p.lo : p.v)), hi = d3.max(pts, (p) => (band && p.hi != null ? p.hi : p.v));
    const padY = (hi - lo) * 0.12 || hi * 0.05;
    const yS = d3.scaleLinear([Math.max(0, lo - padY), hi + padY], [H - 30, 14]).nice();
    const ticks = yS.ticks(5);
    const left = measure(svg, ticks.map(fmt)) + 12;
    const right = measure(svg, vis.map((s) => s.name + ' ' + fmt(s.points[s.points.length - 1].v))) + 16;
    let [x0, x1] = d3.extent(pts, (p) => p.d);
    if (+x0 === +x1) { x0 = new Date(+x0 - 3 * 864e5); x1 = new Date(+x1 + 3 * 864e5); }
    const xS = d3.scaleUtc([x0, x1], [left, W - right]);
    const span = (x1 - x0) / 864e5;
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(yS).tickValues(ticks).tickFormat(fmt).tickSize(-(W - left - right))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(xS).ticks(span > 1100 ? d3.utcYear.every(Math.max(1, Math.ceil(span / 365 / Math.max(2, Math.floor((W - left - right) / 70))))) : Math.max(2, Math.floor((W - left - right) / 90))).tickFormat(d3.utcFormat(span < 120 ? '%-d %b' : span > 1100 ? '%Y' : '%b %y')).tickSize(0).tickPadding(10)).call(axisStyle);
    svg.append('line').attr('x1', left).attr('x2', W - right).attr('y1', H - 30).attr('y2', H - 30).attr('stroke', css('--axis'));
    const r = pts.length > 60 ? 2.5 : 3.5;
    const dense = (s) => s.points.length > 150; // long daily histories: a clean line, no dots
    const labels = [];
    vis.forEach((s) => {
      if (band) {
        const bp = s.points.filter((p) => p.lo != null && p.hi != null);
        if (bp.length > 1) svg.append('path').datum(bp).attr('fill', s.color).attr('fill-opacity', 0.12).attr('d', d3.area().x((p) => xS(p.d)).y0((p) => yS(p.lo)).y1((p) => yS(p.hi)));
      }
      const withGaps = s.points.flatMap((p, i) => (i && (p.d - s.points[i - 1].d) / 864e5 > 75 ? [null, p] : [p])); // no line across months with no readings
      svg.append('path').datum(withGaps).attr('class', 'drawline').attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', d3.line().defined((p) => p != null).x((p) => xS(p.d)).y((p) => yS(p.v)));
      if (!dense(s)) svg.append('g').selectAll('circle').data(s.points).join('circle').attr('class', 'dot').attr('cx', (p) => xS(p.d)).attr('cy', (p) => yS(p.v)).attr('r', r).attr('fill', s.color).attr('stroke', css('--panel')).attr('stroke-width', 1.2);
      const last = s.points[s.points.length - 1];
      labels.push({ x: xS(last.d) + 8, y: yS(last.v) + 4, text: s.name + ' ' + fmt(last.v), color: s.color });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    labels.forEach((l) => svg.append('text').attr('x', l.x).attr('y', l.y).attr('font-size', 12).attr('font-weight', 600).attr('fill', l.color).text(l.text));
    // crosshair
    const rule = svg.append('line').attr('y1', 14).attr('y2', H - 30).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 3').attr('opacity', 0);
    const hl = svg.append('g');
    const sorted = [...pts].sort((a, b) => a.d - b.d);
    const bis = d3.bisector((p) => p.d).center;
    svg.append('rect').attr('x', left).attr('y', 0).attr('width', Math.max(0, W - left - right)).attr('height', H - 30).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [mx] = d3.pointer(ev);
        const near = sorted[bis(sorted, xS.invert(mx))];
        const same = sorted.filter((p) => +p.d === +near.d);
        rule.attr('x1', xS(near.d)).attr('x2', xS(near.d)).attr('opacity', 1);
        hl.selectAll('circle').data(same).join('circle').attr('cx', (p) => xS(p.d)).attr('cy', (p) => yS(p.v)).attr('r', r + 2.5).attr('fill', (p) => p.s.color).attr('stroke', css('--panel')).attr('stroke-width', 2);
        showTip(ev, (t) => {
          t.appendChild(el('div', 'k', dayFmt(near.d)));
          same.forEach((p) => tipRow(t, p.s.color, p.s.name, fmt(p.v) + (p.lo != null && band ? `  (${fmt(p.lo)}–${fmt(p.hi)})` : '')));
          const srcs = [...new Set(same.map((p) => p.source))].join(' · ');
          if (srcs) tipNote(t, 'Source: ' + srcs);
          same.filter((p) => p.note).forEach((p) => tipNote(t, p.note));
        });
      })
      .on('pointerleave', () => { rule.attr('opacity', 0); hl.selectAll('circle').remove(); hideTip(); });
    if (rangeDays) { // say so when a line has less history than the period chosen
      const late = vis.filter((s) => +s.points[0].d > +cutoff + 45 * 864e5);
      if (late.length) box.appendChild(el('p', 'chart-note', late.map((s) => `${s.name}: readings start ${d3.utcFormat('%b %Y')(s.points[0].d)}${s.since ? ` (${s.since})` : ''}`).join(' · ') + '.'));
    }
    drawIn(box);
  }

  function hBars(box, rows, { label, value, fmt, color, tip }) {
    box.replaceChildren();
    const W = box.clientWidth || 600, bh = 22, gap = 12, H = rows.length * (bh + gap) + 6;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const left = Math.min(W * 0.5, measure(svg, rows.map((r) => r[label])) + 12);
    const right = measure(svg, rows.map((r) => fmt(r[value]))) + 12;
    const xS = d3.scaleLinear([0, d3.max(rows, (r) => Math.abs(r[value])) || 1], [left, W - right]);
    rows.forEach((r, i) => {
      const y = 3 + i * (bh + gap);
      svg.append('text').attr('x', left - 8).attr('y', y + bh / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).attr('fill', css('--fg')).text(r[label]);
      svg.append('rect').attr('x', left).attr('y', y).attr('height', bh).attr('width', Math.max(2, xS(Math.abs(r[value])) - left)).attr('rx', 4).attr('fill', color(r, i))
        .on('pointermove', (ev) => showTip(ev, (t) => { tipRow(t, color(r, i), r[label], fmt(r[value])); if (tip) tip(t, r); }))
        .on('pointerleave', hideTip);
      svg.append('text').attr('x', xS(Math.abs(r[value])) + 6).attr('y', y + bh / 2 + 4).attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--fg')).text(fmt(r[value]));
    });
  }

  function vBars(box, rows, { label, value, fmt, color, tip, height = 260 }) {
    box.replaceChildren();
    const W = box.clientWidth || 600, H = height;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const vals = rows.map((r) => r[value]);
    const yS = d3.scaleLinear([Math.min(0, d3.min(vals)) * 1.2, Math.max(0, d3.max(vals)) * 1.2], [H - 30, 14]).nice();
    const ticks = yS.ticks(4);
    const left = measure(svg, ticks.map(fmt)) + 12;
    const xS = d3.scaleBand(rows.map((r) => r[label]), [left, W - 8]).padding(0.3);
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(yS).tickValues(ticks).tickFormat(fmt).tickSize(-(W - left - 8))).call(axisStyle);
    const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - left) / 64)));
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(xS).tickValues(rows.map((r) => r[label]).filter((_, i) => i % every === 0)).tickSize(0).tickPadding(10)).call(axisStyle);
    svg.append('line').attr('x1', left).attr('x2', W - 8).attr('y1', yS(0)).attr('y2', yS(0)).attr('stroke', css('--axis'));
    const bw = Math.min(48, xS.bandwidth()), off = (xS.bandwidth() - bw) / 2;
    rows.forEach((r, i) => {
      const v = r[value];
      svg.append('rect').attr('x', xS(r[label]) + off).attr('width', bw).attr('y', yS(Math.max(0, v))).attr('height', Math.max(1, Math.abs(yS(v) - yS(0)))).attr('rx', 3).attr('fill', color(r, i))
        .on('pointermove', (ev) => showTip(ev, (t) => { tipRow(t, color(r, i), r[label], fmt(v)); if (tip) tip(t, r); }))
        .on('pointerleave', hideTip);
      if (rows.length <= 8) svg.append('text').attr('x', xS(r[label]) + xS.bandwidth() / 2).attr('y', v >= 0 ? yS(v) - 6 : yS(v) + 14).attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--fg')).text(fmt(v));
    });
  }

  function spark(container, values, color, H = 30) {
    if (!values || values.length < 2) return;
    const W = 160;
    const x = d3.scaleLinear([0, values.length - 1], [2, W - 4]);
    const y = d3.scaleLinear(d3.extent(values), [H - 4, 4]);
    const svg = d3.select(container).append('svg').attr('class', 'spark').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'none').attr('width', '100%').attr('height', H).attr('aria-hidden', 'true');
    svg.append('path').attr('d', d3.line().x((_, i) => x(i)).y((v) => y(v))(values)).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2).attr('vector-effect', 'non-scaling-stroke');
    svg.append('circle').attr('cx', x(values.length - 1)).attr('cy', y(values[values.length - 1])).attr('r', 3).attr('fill', color);
  }

  // ---------- derived data ----------
  const futPts = () => (D.lithium || []).filter((r) => r.series === 'Futures').map((r) => ({ d: parse(r.date), v: +r.usd_t, source: r.source, note: r.note })).sort((a, b) => a.d - b.d);
  const spotPts = () => (D.lithium || []).filter((r) => r.series === 'Spot').map((r) => ({ d: parse(r.date), v: +r.usd_t, source: r.source, note: r.note, url: r.url })).sort((a, b) => a.d - b.d);
  // daily lithium futures since the Guangzhou contract began (Jul 2023), from the nightly history file; the site's own
  // readings win on the same day. Converted at each day's ECB rate on the same basis as the site's futures figures.
  const futHist = () => {
    const own = futPts(); const have = new Set(own.map((p) => +p.d));
    return [...((D.hist || {}).lithium || []).filter((p) => !have.has(+p.d)), ...own].sort((a, b) => a.d - b.d);
  };
  const FUT_SINCE = () => (((D.hist || {}).lithium || []).length ? 'the Guangzhou contract began trading then' : '');
  const liKg = () => { const cm = D.costmodel || {}; return (cm.lc_per_t_lfp || 0.24) * (cm.cathode_kg || 2.2); };
  const weekly = () => [...(D.weekly || [])].sort((a, b) => d3.ascending(a.date, b.date));
  const ilSpotMap = () => new Map((D.lithium || []).filter((r) => r.series === 'Spot' && /^InfoLink/.test(r.source)).map((r) => [r.date, +r.usd_t]));
  const cellMap = () => new Map((D.cell314 || []).map((r) => [r.date, +r.usd_kwh]));

  // ---------- renderers ----------
  function renderHeader() {
    const m = D.meta;
    if (m) {
      const ist = new Date(Date.now() + 5.5 * 36e5); const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
      const days = Math.round((today - parse(m.updated)) / 864e5);
      const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      $('#updated').textContent = `Updated ${m.updated_label} (${ago})`;
      $('#updated').title = m.note || '';
    }
    renderCounts();
    renderTicker();
  }
  // navy market strip under the header: one slow loop of prices, dates coming up and alert stories.
  // It pauses under the mouse or keyboard focus, can be dragged or swiped, and stays still for reduced motion.
  const TAPE = { pos: 0, half: 0, last: 0, raf: 0, hover: false, focus: false, drag: null, resumeAt: 0, eatClick: false, on: false, wired: false };
  function istToday() { const ist = new Date(Date.now() + 5.5 * 36e5); return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()); }
  function clip(t, n = 72) { // fallback when a story or date has no `short` line: first clause, cut at a word
    let s = String(t || '').split(/[:;(]| — | – |, (?=[a-z])/)[0].trim();
    if (s.length > n) s = s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,\s]+$/, '') + '…';
    return s;
  }
  function tapeItems() {
    const out = [];
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const M = Object.fromEntries((D.rawmats || []).map((r) => [r.material, r]));
    const unitOf = (u) => ({ 'per tonne': '/t', 'per kWh': '/kWh', 'per m²': '/m²' }[u] || '');
    const chg = (r) => { const m = String(r.move || '').match(/([+−-]?\d+(?:\.\d+)?)%/); if (m) return m[1].replace(/^[+−-]/, '') + '%'; return /stable|flat|steady/i.test(r.move || '') ? 'flat' : ''; };
    const price = (name, r, to) => r && out.push({ k: 'price', name, val: r.price + unitOf(r.unit), chg: chg(r), dir: chg(r) === 'flat' ? 'flat' : r.direction, tip: `${r.move || ''} · ${r.asof} · ${r.source}`, to });
    // headline prices, then the chain from ore to system, then metals
    price('Lithium carbonate', L.lithium, CARD_TAB.lithium);
    price('Spodumene', M['Spodumene SC6'], 'materials/lithium');
    price('Lithium hydroxide', M['Lithium hydroxide'], 'materials/lithium');
    price('LFP cathode', L.cathode, CARD_TAB.cathode);
    price('Iron phosphate', M['Iron phosphate'], 'materials/all');
    price('Electrolyte', M['LFP electrolyte'], 'materials/all');
    price('Separator', M['Separator'], 'materials/all');
    price('314 Ah cell', L.cell314, CARD_TAB.cell314);
    price('EV cell', L.evcell, CARD_TAB.evcell);
    const wk = weekly(); const w1 = wk[wk.length - 1], w0 = wk[wk.length - 2];
    if (w1 && w1.ac_2h) {
      const pc = w0 && w0.ac_2h ? (w1.ac_2h / w0.ac_2h - 1) * 100 : null;
      out.push({ k: 'price', name: '2-h system', val: `$${(+w1.ac_2h).toFixed(1)}/kWh`, chg: pc == null ? '' : Math.abs(pc) < 0.05 ? 'flat' : Math.abs(pc).toFixed(1) + '%', dir: pc == null || Math.abs(pc) < 0.05 ? 'flat' : pc < 0 ? 'down' : 'up', tip: `China AC system, week to ${w1.date} · InfoLink`, to: CARD_TAB.system });
    }
    price('4-h system', L.system, CARD_TAB.system);
    price('Copper', M.Copper, 'materials/all');
    price('Aluminium', M.Aluminium, 'materials/all');
    // the three highest risk scores (Risk Navigator, next 3 months)
    riskStripItems().forEach(({ m, ax, a }) => out.push({ k: 'risk', name: `${m.short} ${ax}`, score: a.score, level: a.level, change: a.change, id: m.id, tip: `${m.name}: ${ax} risk ${a.score}/10 (${a.level}), next 3 months` }));
    // dates in the next three weeks
    const today = istToday();
    const evs = (D.events || []).filter((e) => e.precision !== 'month' && +parse(e.end || e.date) >= today && (+parse(e.date) - today) / 864e5 <= 21)
      .sort((a, b) => d3.ascending(a.date, b.date)).slice(0, 4);
    evs.forEach((e) => {
      const days = Math.round((+parse(e.date) - today) / 864e5);
      const when = e.end && days <= 0 ? 'on now' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      out.push({ k: 'next', text: e.short || clip(e.what, 60), when, soon: days <= 7, tip: `${e.what} · ${e.source}` });
    });
    // alert stories from the last three weeks (newest first); if there are few, the latest stories
    const ns = sortedNews(); const cut = today - 21 * 864e5;
    let alerts = ns.filter((n) => n.alert && +parse(n.date) >= cut).slice(0, 4).map((n) => ({ n, lab: 'alert' }));
    if (alerts.length < 2) alerts = alerts.concat(ns.filter((n) => !n.alert).slice(0, 3 - alerts.length).map((n) => ({ n, lab: 'latest' })));
    alerts.forEach(({ n, lab }) => out.push({ k: lab, text: n.short || clip(n.headline), day: n.day, url: n.url, tip: n.headline }));
    return out;
  }
  function tapeSeg(items, live) {
    const seg = el('div', 'tk-seg'); let last = null;
    const LAB = { price: 'Prices', risk: 'Risk', next: 'Next', alert: 'Alert', latest: 'Latest' };
    items.forEach((it) => {
      if (it.k !== last) { seg.appendChild(el('span', 'tk-lab tk-lab-' + it.k, LAB[it.k])); last = it.k; }
      let b;
      if (it.k === 'price') {
        b = el('button', 'tick'); b.type = 'button';
        const arrow = it.dir === 'down' ? '▼' : it.dir === 'up' ? '▲' : '';
        b.append(el('span', 'tn', it.name), el('span', 'tv', it.val));
        if (it.chg) b.appendChild(el('span', 'tc ' + (it.dir === 'down' ? 'is-down' : it.dir === 'up' ? 'is-up' : 'is-flat'), it.chg === 'flat' ? 'flat' : arrow + it.chg));
        b.addEventListener('click', () => go(it.to));
      } else if (it.k === 'risk') {
        b = el('button', 'tick tk-risk'); b.type = 'button';
        b.append(el('span', 'tn', it.name), el('span', 'tv', it.score.toFixed(1)), el('span', 'tl lv-' + String(it.level).toLowerCase(), it.level));
        if (it.change != null && Math.abs(it.change) >= 0.05) b.appendChild(el('span', 'tc ' + (it.change > 0 ? 'is-up' : 'is-down'), (it.change > 0 ? '▲' : '▼') + Math.abs(it.change).toFixed(1)));
        b.addEventListener('click', () => { RISK.sel = it.id; go('risk'); });
      } else if (it.k === 'next') {
        b = el('button', 'tick tk-next'); b.type = 'button';
        b.append(el('span', 'tt', it.text), el('span', 'tw' + (it.soon ? ' soon' : ''), it.when));
        b.addEventListener('click', () => { go('overview'); const d = $('#ov-dates'); if (d) setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); });
      } else {
        b = el('a', 'tick tk-story'); b.href = it.url; b.target = '_blank'; b.rel = 'noopener'; b.draggable = false;
        b.append(el('span', 'tt', it.text), el('span', 'td', it.day + ' ↗'));
      }
      b.title = it.tip || '';
      if (!live) b.tabIndex = -1;
      seg.appendChild(b);
    });
    return seg;
  }
  function renderTicker() {
    const view = $('#ticker'); if (!view) return;
    cancelAnimationFrame(TAPE.raf); TAPE.on = false;
    const items = tapeItems(); const track = el('div', 'tk-track');
    track.appendChild(tapeSeg(items, true));
    view.replaceChildren(track);
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    view.classList.toggle('is-still', true);
    if (still) return; // reduced motion: a plain strip you can scroll sideways
    requestAnimationFrame(() => {
      const seg = track.firstChild;
      TAPE.half = seg.getBoundingClientRect().width;
      if (TAPE.half <= view.clientWidth) return; // everything fits: no need to move
      const copy = tapeSeg(items, false); copy.setAttribute('aria-hidden', 'true'); copy.inert = true; track.appendChild(copy);
      view.classList.remove('is-still'); view.scrollLeft = 0;
      TAPE.track = track; TAPE.view = view; TAPE.pos = norm(TAPE.pos); TAPE.on = true; TAPE.last = 0;
      wireTape(view); paint(); TAPE.raf = requestAnimationFrame(tick);
    });
  }
  const norm = (p) => (TAPE.half ? ((p % TAPE.half) + TAPE.half) % TAPE.half : 0);
  function paint() { if (TAPE.track) TAPE.track.style.transform = `translate3d(${-TAPE.pos}px,0,0)`; }
  function tick(t) {
    if (!TAPE.on) return;
    const dt = TAPE.last ? Math.min(t - TAPE.last, 100) / 1000 : 0; TAPE.last = t;
    if (!TAPE.hover && !TAPE.focus && !TAPE.drag && t >= TAPE.resumeAt) { TAPE.pos = norm(TAPE.pos + 34 * dt); paint(); }
    TAPE.raf = requestAnimationFrame(tick);
  }
  function wireTape(view) {
    if (TAPE.wired) return; TAPE.wired = true;
    const later = () => { TAPE.resumeAt = performance.now() + 2500; };
    view.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') TAPE.hover = true; });
    view.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') TAPE.hover = false; });
    view.addEventListener('pointerdown', (e) => { if (!TAPE.on || e.button > 0) return; TAPE.drag = { x: e.clientX, pos: TAPE.pos, moved: false, id: e.pointerId }; });
    view.addEventListener('pointermove', (e) => {
      const d = TAPE.drag; if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 6) { d.moved = true; try { view.setPointerCapture(d.id); } catch (err) { /* ignore */ } view.classList.add('is-drag'); }
      if (d.moved) { TAPE.pos = norm(d.pos - dx); paint(); }
    });
    const end = () => { const d = TAPE.drag; if (!d) return; if (d.moved) TAPE.eatClick = true; TAPE.drag = null; view.classList.remove('is-drag'); later(); };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    view.addEventListener('click', (e) => { if (TAPE.eatClick) { e.preventDefault(); e.stopPropagation(); TAPE.eatClick = false; } }, true);
    view.addEventListener('wheel', (e) => { if (!TAPE.on || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); TAPE.pos = norm(TAPE.pos + e.deltaX); paint(); later(); }, { passive: false });
    view.addEventListener('focusin', (e) => { // keyboard focus only: a mouse click also focuses, and must not stop the loop
      let kb = false; try { kb = e.target.matches(':focus-visible'); } catch (err) { /* old browser */ } if (!kb) return;
      TAPE.focus = true; const b = e.target.closest('.tick'); if (b && TAPE.on) { view.scrollLeft = 0; TAPE.pos = norm(b.offsetLeft - 24); paint(); } });
    view.addEventListener('focusout', () => { TAPE.focus = false; });
    view.addEventListener('scroll', () => { if (TAPE.on && view.scrollLeft) view.scrollLeft = 0; }); // focus can scroll the box; the loop moves by transform only
    let w = view.clientWidth;
    window.addEventListener('resize', () => { if (Math.abs(view.clientWidth - w) > 40) { w = view.clientWidth; renderTicker(); } });
  }

  let fitT = 0;
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { if (S.tab === 'overview') fitNews(); }, 200); });
  function renderOverview() {
    renderChainHero();
    renderSince();
    { const rp = !S.resizing; requestAnimationFrame(() => reveal($('#page-overview'), rp)); }
    // changes
    const w = weekly(); const ul = $('#changes'); ul.replaceChildren();
    if (w.length >= 2) {
      const a = w[w.length - 2], b = w[w.length - 1];
      $('#wow-sub').textContent = `InfoLink weekly prices, ${shortDay(parse(a.date))} → ${shortDay(parse(b.date))}. Lower is better for a buyer.`;
      const fut = futPts();
      const items = [
        ['Lithium carbonate, spot', a.lithium_usd_t, b.lithium_usd_t, fmtUsd0, '/t'],
        ['314 Ah LFP cell', a.cell314, b.cell314, fmtUsd1, '/kWh'],
        ['4-hour AC system', a.ac_4h, b.ac_4h, fmtUsd1, '/kWh'],
        ['2-hour DC system', a.dc_2h, b.dc_2h, fmtUsd1, '/kWh'],
      ];
      if (fut.length >= 2) items.unshift([`Lithium futures (${shortDay(fut[fut.length - 2].d)} → ${shortDay(fut[fut.length - 1].d)})`, fut[fut.length - 2].v, fut[fut.length - 1].v, fmtUsd0, '/t']);
      items.forEach(([name, x, y, f, u]) => {
        const ch = (y / x - 1) * 100; const li = el('li');
        li.append(el('span', null, name), el('span', 'v', f(y) + u), el('span', 'd' + (Math.abs(ch) < 0.05 ? '' : ch < 0 ? ' is-down' : ' is-up'), Math.abs(ch) < 0.05 ? 'flat' : pctS(ch)));
        ul.appendChild(li);
      });
    }
    // coming up: dates to watch and rule changes in one timeline
    datesList($('#ov-coming'), comingUp(null, 6));
    // latest news
    fitNews();
  }
  // latest news fills the right column to the height of the left one (6 stories when stacked on a phone)
  function fitNews() {
    const pv = $('#news-preview'); const panel = $('#ov-newspanel'); const col = $('.ov-col');
    if (!pv || !panel || !col) return;
    const all = sortedNews().slice(0, 14); pv.replaceChildren();
    const sideBySide = getComputedStyle($('.ov-grid')).gridTemplateColumns.split(' ').length > 1;
    if (!sideBySide || $('#page-overview').hidden) { all.slice(0, 6).forEach((n) => pv.appendChild(newsItem(n))); return; }
    const grid = $('.ov-grid'); grid.style.alignItems = 'start'; // measure natural heights, not stretched ones
    const target = col.getBoundingClientRect().height;
    for (const n of all) { // add stories until the next one would overflow
      const li = newsItem(n); pv.appendChild(li);
      if (panel.getBoundingClientRect().height > target && pv.children.length > 4) { li.remove(); break; }
    }
    grid.style.alignItems = '';
  }
  // cell makers' margin, from the cost model at today's prices (shown on the Cells step)
  function renderMargin(mb) {
    try {
      mb.replaceChildren();
      const base = calcBase(); const c = cellCost(base); const w = weekly(); const last = w[w.length - 1];
      const market = last.cell314, keep = market - c.total;
      const slope = (cellCost({ ...base, li: base.li + 1000 }).total - c.total) / 1000;
      const be = base.li + keep / slope;
      const k = el('div', 'kpis three');
      kpi(k, 'Cost to make a 314 Ah cell', perK(c.total), ['Built from today\'s material prices', null]);
      kpi(k, `Market price (${shortDay(parse(last.date))})`, perK(market), ['InfoLink average', null]);
      kpi(k, 'What makers keep', fmtUsd1(keep) + '/kWh', [`${(keep / market * 100).toFixed(0)}% of the price`, null], 'main');
      mb.appendChild(k);
      const bar = el('div', 'stackbar'); mb.appendChild(bar);
      stackBar(bar, [{ label: 'Cost to make', color: '--teal', v: c.total }, { label: 'Maker margin', color: '--green', v: Math.max(0, keep) }], Math.max(market, c.total));
      mb.appendChild(el('p', 'sub', keep > 0 ? `Makers would only be selling at cost if lithium carbonate rose to about ${fmtUsd0(Math.round(be / 100) * 100)}/t, ${((be / base.li - 1) * 100).toFixed(0)}% above today.` : 'At today\'s prices, cells sell below the modelled cost to make them.'));
    } catch (e) { console.error(e); fail(mb, 'Cost model unavailable'); }
  }
  // dates to watch + rule changes, optionally only those that concern one value-chain step
  function comingUp(step, n) {
    const today = istToday();
    const evs = (D.events || []).filter((e) => +parse(e.end || e.date) >= today || (e.precision === 'month' && +new Date(Date.UTC(parse(e.date).getUTCFullYear(), parse(e.date).getUTCMonth() + 1, 0)) >= today)).map((e) => ({ ...e }));
    const rules = [];
    (D.regulations || []).filter((r) => +parse(r.date) >= today).forEach((r) => {
      const words = String(r.short || r.title).toLowerCase().match(/[a-z]{5,}/g) || [];
      const twin = evs.find((e) => e.date === r.date && !e.affects && words.some((w) => String(e.what || '').toLowerCase().includes(w)));
      if (twin) twin.affects = r.affects; // same change already listed as a date: keep one entry
      else rules.push({ date: r.date, what: r.short || r.title, kind: 'Rule change', source: r.source, url: r.url, affects: r.affects });
    });
    let all = [...evs, ...rules];
    if (step) {
      const C = CHAIN.find((c) => c.id === step) || {};
      all = all.filter((x) => {
        const risk = (x.risk || []).map((r) => r.m);
        if ((C.risk || []).some((m) => risk.includes(m))) return true;
        if ((C.kinds || []).includes(x.kind)) return true;
        return C.words ? C.words.test((x.affects || []).join(' ')) : false;
      });
    }
    return all.sort((a, b) => d3.ascending(a.date, b.date)).slice(0, n);
  }
  function datesList(dl, items) {
    if (!dl) return; dl.replaceChildren();
    const today = istToday();
    if (!items.length) dl.appendChild(el('li', 'empty', 'Nothing dated coming up.'));
    items.forEach((e) => {
      const d = parse(e.date), month = e.precision === 'month';
      const days = Math.round((+d - today) / 864e5);
      const when = e.end && days <= 0 ? 'On now' : month ? (days < 45 ? 'This month' : `In about ${Math.round(days / 30)} months`) : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 60 ? `In ${days} days` : `In about ${Math.round(days / 30)} months`;
      const li = el('li');
      const db = el('div', 'dbox'); db.append(el('b', null, month ? d3.utcFormat('%b')(d) : d3.utcFormat('%-d %b')(d)), el('span', null, d3.utcFormat('%Y')(d)));
      const body = el('div', 'dbody'); const top = el('div', 'dmeta'); top.append(el('span', 'dwhen' + (days < 15 ? ' soon' : ''), when), el('span', 'dkind', e.kind || ''));
      body.append(top, el('div', 'dwhat', e.short && e.short.length > 30 ? e.what : e.what)); const src = el('div', 'dsrc'); if (e.url) src.appendChild(link(e.source, e.url)); body.appendChild(src);
      li.append(db, body); dl.appendChild(li);
    });
  }
  // overview: the three highest risk scores
  function renderOvRisk() {
    const ul = $('#ov-risk'); if (!ul) return; ul.replaceChildren();
    const rows = riskStripItems();
    if (!rows.length) { ul.appendChild(el('li', 'empty', 'Risk scores are not available yet.')); return; }
    rows.forEach(({ m, ax, a }) => {
      const top = [...(a.drivers || [])].sort((x, y) => (y.score * y.weight) - (x.score * x.weight))[0];
      const b = el('button', 'rw'); b.type = 'button';
      const name = el('div', 'rw-name'); name.append(el('b', null, m.short), el('span', null, ax === 'price' ? 'Price risk' : 'Supply risk'));
      const score = el('div', 'rw-score'); score.append(riskChip(a), riskDelta(a));
      b.append(name, score);
      if (top) b.appendChild(el('div', 'rw-why', `Main driver: ${top.label.toLowerCase()}${top.detail ? ' — ' + clip(top.detail, 90) : ''}`));
      b.addEventListener('click', () => { RISK.sel = m.id; RISK.h = 'h3'; go('risk'); });
      const li = el('li'); li.appendChild(b); ul.appendChild(li);
    });
  }
  // overview: the next rule dates
  function renderOvRules() {
    const ul = $('#ov-rules'); if (!ul) return; ul.replaceChildren();
    const today = istToday();
    const ahead = (D.regulations || []).filter((r) => +parse(r.date) >= today).sort((a, b) => d3.ascending(a.date, b.date)).slice(0, 3);
    if (!ahead.length) { ul.appendChild(el('li', 'empty', 'No dated rule changes ahead.')); return; }
    ahead.forEach((r) => {
      const d = parse(r.date); const days = Math.round((+d - today) / 864e5);
      const li = el('li'); li.style.setProperty('--sc', css(STATUS_COL[r.status] || '--slate'));
      const db = el('div', 'dbox'); db.append(el('b', null, d3.utcFormat('%-d %b')(d)), el('span', null, d3.utcFormat('%Y')(d)));
      const body = el('div');
      body.append(el('div', 'rn-when' + (days <= 30 ? ' soon' : ''), days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 60 ? `In ${days} days` : `In about ${Math.round(days / 30)} months`), el('div', 'rn-title', r.short || r.title), el('div', 'rn-meta', `${r.region} · ${r.status}`));
      if (isNewRule(r.id)) body.firstChild.appendChild(newTag('New or changed since your last visit'));
      const b = el('button', 'rn'); b.type = 'button'; b.append(db, body);
      b.addEventListener('click', () => { go('rules'); const card = document.getElementById('rule-' + r.id); if (card) { card.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1600); } });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function rangeSeg(key, onChange) {
    const seg = $(`[data-range-for="${key}"]`); if (!seg || seg.childElementCount) return;
    RANGES.forEach(([lab, days]) => {
      const b = el('button', null, lab); b.type = 'button'; b.setAttribute('aria-pressed', String(S.range[key] === days));
      b.addEventListener('click', () => { S.range[key] = days; $$('button', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onChange(); });
      seg.appendChild(b);
    });
  }
  function toggles(container, names, colors, hiddenSet, onChange) {
    container.replaceChildren();
    names.forEach((n, i) => {
      const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(!hiddenSet.has(n)));
      const sw = el('span', 'sw'); sw.style.background = colors[i]; b.append(sw, document.createTextNode(n));
      b.addEventListener('click', () => { hiddenSet.has(n) ? hiddenSet.delete(n) : hiddenSet.add(n); onChange(); });
      container.appendChild(b);
    });
  }

  function renderLithium() {
    const box = $('#lithium-chart');
    try {
      const names = ['Futures', 'Spot'], colors = [css('--amber'), css('--blue')];
      toggles($('#lithium-toggles'), names, colors, S.hidden.lithium, renderLithium);
      rangeSeg('lithium', renderLithium);
      const series = [{ name: 'Futures', color: colors[0], points: futHist(), since: FUT_SINCE() }, { name: 'Spot', color: colors[1], points: spotPts() }].filter((s) => !S.hidden.lithium.has(s.name));
      timeChart(box, series, { fmt: fmtUsd0, rangeDays: S.range.lithium, height: 320 });
      srcLinks($('#lithium-srcs'), D.lithium);
    } catch (e) { console.error(e); fail(box); }
    // week-on-week
    const wb = $('#lithium-wow');
    try {
      const w = weekly();
      const rows = w.slice(1).map((r, i) => ({ label: shortDay(parse(r.date)), pct: Math.round((r.lithium_usd_t / w[i].lithium_usd_t - 1) * 1000) / 10, note: r.note, date: r.date }));
      vBars(wb, rows, { label: 'label', value: 'pct', fmt: pctS, color: (r) => (r.pct < 0 ? css('--ok') : css('--warn')), tip: (t, r) => tipNote(t, r.note), height: 240 });
    } catch (e) { console.error(e); fail(wb); }
    // forecasts
    const tb = $('#forecast-table tbody'); tb.replaceChildren();
    const sp = spotPts(); const today = sp.length ? sp[sp.length - 1].v : null;
    (D.forecasts || []).forEach((f) => {
      const tr = tb.insertRow();
      tr.insertCell().textContent = f.who; tr.insertCell().textContent = f.period;
      const v = tr.insertCell(); v.className = 'num r'; v.textContent = f.low === f.high ? '~' + fmtUsd0(f.low) : `${fmtUsd0(f.low)}–${fmtUsd0(f.high)}`;
      const c = tr.insertCell(); c.className = 'num r';
      if (today) { const mid = (f.low + f.high) / 2; const ch = (mid / today - 1) * 100; c.textContent = pctS(ch); c.classList.add(ch < 0 ? 'is-down' : 'is-up'); }
      tr.insertCell().appendChild(link(f.source, f.url));
    });
  }

  function gapCompute(fromDate, kg) {
    const li = ilSpotMap(), ce = cellMap();
    const w = weekly(); const to = w[w.length - 1].date;
    const la = li.get(fromDate), lb = li.get(to), ca = ce.get(fromDate), cb = ce.get(to);
    if ([la, lb, ca, cb].some((v) => v == null)) throw new Error('missing');
    const exp = ((lb - la) * kg / 1000 / VAT) / ca * 100;
    return { to, rows: [
      { measure: 'Lithium carbonate, spot', pct: (lb / la - 1) * 100 },
      { measure: 'Cell move implied by lithium', pct: exp },
      { measure: 'Actual 314 Ah cell move', pct: (cb / ca - 1) * 100 },
    ] };
  }

  function evRows() {
    const ev = D.evcells; if (!ev || !(ev.series || []).length) return [];
    const s = [...ev.series].sort((a, b) => d3.ascending(a.date, b.date)); const last = s[s.length - 1], prev = s[s.length - 2];
    const L = (D.latest || []).find((r) => r.id === 'evcell') || {};
    return (ev.formats || []).map((f) => { const kwh = f.volts * f.ah / 1000; return { ...f, kwh, usd_kwh: last.usd_kwh, perCell: kwh * last.usd_kwh, asof: L.asof || shortDay(parse(last.date)), move: L.move || (prev ? pctS((last.usd_kwh / prev.usd_kwh - 1) * 100) : ''), direction: L.direction || 'flat', source: last.source, url: last.url, date: last.date }; });
  }
  function renderEv() {
    const box = $('#ev-chart'); const ev = D.evcells;
    try {
      if (!ev) throw new Error('no ev data');
      const evPts = ev.series.map((r) => ({ d: parse(r.date), v: r.usd_kwh, source: r.source, note: r.note }));
      const first = d3.min(evPts, (p) => p.d);
      const essPts = (D.cell314 || []).map((r) => ({ d: parse(r.date), v: +r.usd_kwh, source: r.source, note: r.note })).filter((p) => p.d >= first);
      timeChart(box, [{ name: 'EV prismatic LFP (230/324 Ah class)', color: css('--magenta'), points: evPts }, { name: '314 Ah storage (InfoLink)', color: css('--blue'), points: essPts }], { fmt: fmtUsd1, height: 260 });
      const tb = $('#ev-table tbody'); tb.replaceChildren();
      evRows().forEach((e) => {
        const tr = tb.insertRow();
        tr.insertCell().appendChild(el('span', 'item', e.format + ' LFP'));
        tr.insertCell().textContent = e.use;
        const ex = tr.insertCell(); ex.appendChild(link(e.examples, e.url));
        const en = tr.insertCell(); en.className = 'num r'; en.textContent = e.kwh.toFixed(3) + ' kWh';
        const pk = tr.insertCell(); pk.className = 'num r'; pk.textContent = fmtUsd1(e.usd_kwh);
        const pc = tr.insertCell(); pc.className = 'num r'; pc.appendChild(el('b', null, fmt2(e.perCell)));
      });
      const last = evPts[evPts.length - 1].v, ess = (ev.ess_benchmark || {}).usd_kwh;
      $('#ev-note').textContent = `EV cells average about ${fmtUsd1(last)}/kWh${ess ? `, ${fmtUsd1(last - ess)} (${((last / ess - 1) * 100).toFixed(0)}%) more than storage cells in the same TrendForce table (${fmtUsd1(ess)})` : ''}, and are up ${((last / ev.series[0].usd_kwh - 1) * 100).toFixed(0)}% since October 2025, which TrendForce puts down to rising raw-material costs. Price per cell = price per kWh × the cell's energy (volts × amp-hours). Real quotes vary with volume, maker and specification.`;
      srcLinks($('#ev-srcs'), [...ev.series, ...(ev.formats || [])]);
    } catch (e) { console.error(e); fail(box); }
  }
  function renderCells() {
    renderEv();
    const box = $('#cell-chart');
    try {
      rangeSeg('cell', renderCells);
      const pts = (D.cell314 || []).map((r) => ({ d: parse(r.date), v: +r.usd_kwh, lo: r.lo, hi: r.hi, source: r.source, note: r.note }));
      timeChart(box, [{ name: '314 Ah', color: css('--blue'), points: pts }], { fmt: fmtUsd1, rangeDays: S.range.cell, band: true, height: 300 });
      srcLinks($('#cell-srcs'), D.cell314);
    } catch (e) { console.error(e); fail(box); }
    // gap with selectable start
    const sel = $('#gap-from'); const gb = $('#gap-chart');
    try {
      const li = ilSpotMap(), ce = cellMap(); const w = weekly(); const to = w[w.length - 1].date;
      const dates = [...li.keys()].filter((d) => ce.has(d) && d < to).sort();
      if (!sel.childElementCount) {
        dates.slice().reverse().forEach((d) => sel.appendChild(new Option(dayFmt(parse(d)), d)));
        sel.addEventListener('change', () => { S.gapFrom = sel.value; renderCells(); });
      }
      if (!dates.includes(S.gapFrom)) S.gapFrom = dates[0];
      sel.value = S.gapFrom;
      const g = gapCompute(S.gapFrom, liKg());
      $('#gap-kg').textContent = liKg().toFixed(2);
      $('#gap-to').textContent = 'to ' + dayFmt(parse(g.to));
      hBars(gb, g.rows, { label: 'measure', value: 'pct', fmt: pctS, color: (r, i) => [css('--amber'), css('--blue'), css('--chart-muted')][i] });
    } catch (e) { console.error(e); fail(gb); }
    // tender bids vs the market
    const bb = $('#bids-chart');
    try { tenderChart(bb, $('#bids-legend')); srcLinks($('#bids-srcs'), (D.tenders || {}).rows || []); } catch (e) { console.error(e); fail(bb); }
    // market share
    const sb = $('#share-chart');
    try {
      const rows = D.marketshare || [];
      if (rows[0]) $('#share-sub').textContent = `Share of China EV battery installations, ${rows[0].period}. Hover for GWh.`;
      hBars(sb, rows, { label: 'maker', value: 'share', fmt: (v) => v.toFixed(1) + '%', color: (r) => (r.maker === 'All others' ? css('--chart-muted') : css('--teal')), tip: (t, r) => tipNote(t, `${r.gwh} GWh installed`) });
      srcLinks($('#share-srcs'), rows);
    } catch (e) { console.error(e); fail(sb); }
  }

  const TSIZE = { '314 Ah': '--slate', '≥500 Ah': '--blue', '587 Ah': '--amber' };
  function tenderChart(box, legend) {
    box.replaceChildren();
    const rows = ((D.tenders || {}).rows || []).map((r) => ({ ...r, d: parse(r.date) }));
    const mk = (D.cell314 || []).map((r) => ({ d: parse(r.date), v: +r.usd_kwh })).concat(weekly().map((w) => ({ d: parse(w.date), v: +w.cell314 })))
      .sort((a, b) => a.d - b.d).filter((p, i, arr) => !i || +p.d !== +arr[i - 1].d);
    const ys = rows.flatMap((r) => (r.kind === 'range' ? [r.lo, r.hi] : [r.usd_kwh])).concat(mk.map((p) => p.v));
    const t0 = d3.min([...rows.map((r) => r.d), ...mk.map((p) => p.d)]);
    const W = Math.max(320, box.clientWidth || 640), H = 300, mg = { t: 12, r: 16, b: 28, l: 46 };
    const x = d3.scaleUtc().domain([d3.utcMonth.offset(t0, -1), d3.utcMonth.offset(new Date(), 1)]).range([mg.l, W - mg.r]);
    const y = d3.scaleLinear().domain([Math.floor((d3.min(ys) - 3) / 5) * 5, Math.ceil((d3.max(ys) + 3) / 5) * 5]).range([H - mg.b, mg.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%');
    svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => '$' + v).tickSize(-(W - mg.l - mg.r)).tickPadding(8)).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 110))).tickFormat(d3.utcFormat('%b %y')).tickSize(0).tickPadding(8)).call(axisStyle);
    svg.append('path').datum(mk).attr('fill', 'none').attr('stroke', css('--blue')).attr('stroke-width', 2).attr('opacity', 0.55).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)));
    const tip = (r) => (ev) => showTip(ev, (t) => {
      t.appendChild(el('div', 'h', r.bidder === 'All bids (range)' ? r.buyer : `${r.bidder} · ${r.size}`));
      if (r.kind === 'range') tipRow(t, null, 'Bids', `${fmtUsd1(r.lo)}–${fmtUsd1(r.hi)}/kWh (${r.lo_yuan_wh}–${r.hi_yuan_wh} yuan/Wh)`);
      else tipRow(t, null, r.kind === 'list' ? 'List price' : 'Bid', `${fmtUsd1(r.usd_kwh)}/kWh${r.yuan_wh ? ` (${r.yuan_wh} yuan/Wh)` : ''}`);
      tipNote(t, `${r.buyer} · ${r.when} · ${r.source}`);
    });
    rows.forEach((r, i) => {
      const col = css(TSIZE[r.size] || '--slate');
      if (r.kind === 'range') {
        svg.append('rect').attr('x', x(r.d) - 5).attr('width', 10).attr('y', y(r.hi)).attr('height', Math.max(2, y(r.lo) - y(r.hi))).attr('rx', 3).attr('fill', col).attr('opacity', 0.35)
          .on('pointermove', tip(r)).on('pointerleave', hideTip);
        return;
      }
      const same = rows.filter((q, j) => j < i && q.date === r.date && q.size === r.size && q.kind !== 'range').length;
      const cx = x(r.d) + (r.size === '≥500 Ah' ? 10 : 0) + (same % 2 ? 4 : -4) * (same ? 1 : 0);
      const g = svg.append('g').style('cursor', 'default');
      if (r.kind === 'list') g.append('path').attr('d', d3.symbol(d3.symbolDiamond, 90)()).attr('transform', `translate(${cx},${y(r.usd_kwh)})`).attr('fill', col);
      else g.append('circle').attr('cx', cx).attr('cy', y(r.usd_kwh)).attr('r', 5).attr('fill', col).attr('stroke', css('--panel')).attr('stroke-width', 1.5);
      g.on('pointermove', tip(r)).on('pointerleave', hideTip);
    });
    if (legend) {
      legend.replaceChildren(); legend.className = 'tlegend';
      const add = (sw, txt) => { const s = el('span'); s.append(sw, document.createTextNode(txt)); legend.appendChild(s); };
      const line = el('i', 'ln'); line.style.background = css('--blue'); add(line, 'InfoLink 314 Ah market average');
      [['314 Ah', '314 Ah bids'], ['≥500 Ah', '500 Ah+ bids'], ['587 Ah', 'CATL 587 Ah list price']].forEach(([k, t]) => { const d = el('i', k === '587 Ah' ? 'dm' : 'dt'); d.style.background = css(TSIZE[k]); add(d, t); });
      const rg = el('i', 'rg'); rg.style.background = css('--slate'); add(rg, 'range of bids');
      const last = mk[mk.length - 1]; const lastBids = rows.filter((r) => r.kind === 'bid' && r.size === '314 Ah');
      if (last && lastBids.length) {
        const lowest = d3.min(lastBids.filter((r) => r.date === d3.max(lastBids, (q) => q.date)), (r) => r.usd_kwh);
        legend.appendChild(el('span', 'note', `Latest market average ${fmtUsd1(last.v)}/kWh; lowest 314 Ah bid in the latest tender ${fmtUsd1(lowest)}/kWh.`));
      }
    }
  }

  function renderSystems() {
    const box = $('#sys-chart');
    try {
      const defs = [['AC 1-hour', 'ac_1h', '--plum'], ['AC 2-hour', 'ac_2h', '--teal'], ['AC 4-hour', 'ac_4h', '--indigo'], ['DC 2-hour', 'dc_2h', '--amber']];
      toggles($('#sys-toggles'), defs.map((d) => d[0]), defs.map((d) => css(d[2])), S.hidden.sys, renderSystems);
      rangeSeg('sysweekly', renderSystems);
      const w = weekly();
      const series = defs.filter((d) => !S.hidden.sys.has(d[0])).map(([name, key, col]) => ({ name, color: css(col), points: w.map((r) => ({ d: parse(r.date), v: +r[key], source: r.source })) }));
      timeChart(box, series, { fmt: fmtUsd0, rangeDays: S.range.sysweekly, height: 300 });
      srcLinks($('#sys-srcs'), w);
    } catch (e) { console.error(e); fail(box); }
    const tb = $('#system-chart');
    try {
      const rows = (D.systems || []).map((r) => ({ ...r, usd_kwh: +r.usd_kwh }));
      vBars(tb, rows, { label: 'period', value: 'usd_kwh', fmt: fmtUsd1, color: (r, i) => (i === rows.length - 1 ? css('--indigo') : css('--chart-muted')), tip: (t, r) => { tipNote(t, 'Source: ' + r.source); if (r.note) tipNote(t, r.note); } });
      srcLinks($('#system-srcs'), D.systems);
    } catch (e) { console.error(e); fail(tb); }
  }

  // ---------- raw materials: price map ----------
  // Each step lists [kind, key, display name, short description]; kind 'latest' = latest.json id, 'raw' = rawmats material.
  const FLOW = [
    { step: 'Mined and refined inputs', color: '--amber', items: [['latest', 'lithium', 'Lithium carbonate', 'China futures price'], ['raw', 'Spodumene SC6', 'Spodumene', 'Lithium ore, 6% grade'], ['raw', 'Lithium hydroxide', 'Lithium hydroxide', 'Lithium salt, delivered Asia'], ['raw', 'Copper', 'Copper', 'World benchmark price'], ['raw', 'Aluminium', 'Aluminium', 'World benchmark price']] },
    { step: 'Cathode and anode', color: '--plum', items: [['raw', 'Iron phosphate', 'Iron phosphate', 'Raw material for the cathode'], ['latest', 'cathode', 'LFP cathode', 'Cathode powder, China'], ['raw', 'Graphite anode', 'Graphite anode', 'Artificial graphite, storage grade']] },
    { step: 'Other cell materials', color: '--teal', items: [['raw', 'LFP electrolyte', 'Electrolyte', 'Liquid inside LFP cells'], ['raw', 'Separator', 'Separator', 'Film between the electrodes'], ['raw', 'Copper foil', 'Copper foil', 'Carries current on the anode side'], ['raw', 'Aluminium foil', 'Aluminium foil', 'Carries current on the cathode side']] },
    { step: 'Cells', color: '--blue', items: [['latest', 'cell314', '314 Ah storage cell', 'China market average'], ['latest', 'cell587', '587 Ah storage cell', 'Latest tender bid'], ['ev', 0], ['ev', 1]] },
    { step: 'Packs and storage systems', color: '--indigo', items: [['latest', 'pack', 'Storage battery pack', 'Global average, yearly survey'], ['latest', 'system', '4-hour storage system', 'China tender awards']] },
  ];
  const CHART_OF = { lithium: 'lithium', cell314: 'cells', cell587: 'cells', evcell: 'cells', system: 'systems' }; // only items with a price history on the site
  const UNIT_SHORT = { 'per tonne': '/t', 'per kWh': '/kWh', 'per m²': '/m²' };
  const numOf = (p) => (/\d/.test(p || '') ? Number(String(p).replace(/[^0-9.]/g, '')) : null);
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // Age in days of an "as of" label such as "19 Oct", "21–24 Sep", "Feb 2026", "Jul", "2025".
  function ageDays(asof) {
    const ref = D.meta ? parse(D.meta.updated) : new Date();
    const t = String(asof || '');
    const yr = (t.match(/(20\d\d)/) || [])[1];
    const m = t.match(/(?:(\d{1,2})\s*(?:[–-]\s*(\d{1,2}))?\s+)?([A-Za-z]{3})[a-z]*/);
    let d;
    if (m && MON[m[3].toLowerCase()] != null) {
      const mo = MON[m[3].toLowerCase()], y = yr ? +yr : ref.getUTCFullYear();
      const day = m[2] || m[1];
      d = day ? new Date(Date.UTC(y, mo, +day)) : new Date(Date.UTC(y, mo + 1, 0));
      if (!yr && d > ref) d = new Date(Date.UTC(y - 1, d.getUTCMonth(), d.getUTCDate()));
    } else if (yr) d = new Date(Date.UTC(+yr, 11, 31));
    else return 999;
    return Math.round((ref - d) / 864e5);
  }
  // how often each source normally publishes (kept for the CSV and price map)
  const CADENCE_ID = { lithium: 'daily', cathode: 'weekly', cell314: 'weekly', cell587: 'irregular', evcell: 'weekly', pack: 'annual', system: 'monthly' };
  const CADENCE_RAW = { 'Lithium hydroxide': 'daily', Copper: 'daily', Aluminium: 'daily', 'Copper foil': 'irregular', 'Aluminium foil': 'irregular' };

  function allPrices() {
    const latest = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const raw = Object.fromEntries((D.rawmats || []).map((r) => [r.material, r]));
    const used = new Set();
    const steps = FLOW.map((f) => ({ ...f, rows: f.items.map(([kind, key, name, desc]) => {
      if (kind === 'ev') { const e = evRows()[key]; if (!e) return null; return { cad: 'weekly', name: e.format + ' EV cell', desc: `About ${fmt2(e.perCell).replace('.00', '')} per cell (${e.kwh.toFixed(2)} kWh) at the EV average`, price: fmtUsd1(e.usd_kwh), usd: e.usd_kwh, unit: 'per kWh', asof: e.asof, move: e.move, direction: e.direction, source: e.source, url: e.url, chart: 'cells', step: f.step }; }
      const r = kind === 'latest' ? latest[key] : raw[key]; if (!r) return null; used.add(key);
      return { cad: kind === 'latest' ? CADENCE_ID[key] : (CADENCE_RAW[key] || 'weekly'), name, desc, price: r.price, usd: r.usd != null ? r.usd : numOf(r.price), unit: r.unit, asof: r.asof, move: r.move, direction: r.direction, source: r.source, url: r.url, source2: r.source2, url2: r.url2, chart: CHART_OF[key] || null, step: f.step };
    }).filter(Boolean) }));
    // anything new in rawmats.json that the map does not know yet goes under "Other cell materials"
    (D.rawmats || []).filter((r) => !used.has(r.material)).forEach((r) => steps[2].rows.push({ name: r.material, desc: r.role, price: r.price, usd: r.usd, unit: r.unit, asof: r.asof, move: r.move, direction: r.direction, source: r.source, url: r.url, chart: null, step: steps[2].step }));
    return steps;
  }
  function renderMaterials() {
    const steps = allPrices();
    const ol = $('#price-flow'); ol.replaceChildren();
    steps.forEach((st, i) => {
      const li = el('li', 'step'); li.style.setProperty('--sc', css(st.color));
      const head = el('div', 'step-head'); head.append(el('span', 'num', String(i + 1)), el('h3', null, st.step));
      const grid = el('div', 'pcards');
      st.rows.forEach((r) => {
        const c = el('div', 'pcard');
        const pr = el('div', 'pp'); pr.append(el('span', 'v', r.price), el('span', 'u', UNIT_SHORT[r.unit] || (r.unit ? ' ' + r.unit : '')));
        const meta = el('div', 'pm');
        meta.append(document.createTextNode(r.asof + ' · '), link(r.source, r.url));
        c.append(el('div', 'pn', r.name), el('div', 'pd', r.desc || ''), pr);
        if (r.move) c.appendChild(el('span', 'chip' + dirClass(r.direction), r.move));
        c.appendChild(meta);
        if (r.chart) { const b = el('button', 'btn link small', 'See chart →'); b.type = 'button'; b.addEventListener('click', () => go('materials/' + r.chart)); c.appendChild(b); }
        grid.appendChild(c);
      });
      li.append(head, grid); ol.appendChild(li);
    });
    // table view
    const tb = $('#raw-table tbody'); tb.replaceChildren();
    steps.forEach((st) => st.rows.forEach((r) => {
      const tr = tb.insertRow();
      tr.insertCell().textContent = st.step;
      const it = tr.insertCell(); it.appendChild(el('span', 'item', r.name)); if (r.desc) it.appendChild(el('span', 'role', r.desc));
      const p = tr.insertCell(); p.className = 'num r'; p.textContent = r.price + (UNIT_SHORT[r.unit] || '');
      const a = tr.insertCell(); a.className = 'nowrap'; a.textContent = r.asof;
      tr.insertCell().appendChild(el('span', 'chip' + dirClass(r.direction), r.move || ''));
      const sc = tr.insertCell(); sc.appendChild(link(r.source, r.url)); if (r.source2) { sc.appendChild(document.createTextNode(' · ')); sc.appendChild(link(r.source2, r.url2)); }
    }));
  }
  function renderMaterialsPage() { ({ all: renderMaterials, lithium: renderLithium, cells: renderCells, systems: renderSystems })[S.sub](); }

  // ---------- cost calculator ----------
  const CM = () => D.costmodel || {};
  const rawRow = (name) => (D.rawmats || []).find((r) => r.material === name) || {};
  const fmt2 = d3.format('$.2f');
  const fmtSigned = (v) => (v < 0 ? '−' : '+') + '$' + Math.abs(v).toFixed(1);
  const perT = (v) => fmtUsd0(v) + '/t', perK = (v) => fmtUsd1(v) + '/kWh';
  const fmtM = (v) => (Math.abs(v) >= 100 ? d3.format('$,.0f')(v) : d3.format('$,.1f')(v)) + 'M';
  const INPUTS = [
    { k: 'li', g: 'Cathode', label: 'Lithium carbonate', min: 6000, max: 40000, step: 10, f: perT },
    { k: 'fe', g: 'Cathode', label: 'Iron phosphate', min: 800, max: 4500, step: 10, f: perT },
    { k: 'proc', g: 'Cathode', label: 'Cathode processing fee', min: 200, max: 3000, step: 10, f: perT },
    { k: 'gr', g: 'Anode, electrolyte, separator', label: 'Graphite anode', min: 1500, max: 7000, step: 10, f: perT },
    { k: 'el', g: 'Anode, electrolyte, separator', label: 'Electrolyte', min: 2000, max: 10000, step: 10, f: perT },
    { k: 'sep', g: 'Anode, electrolyte, separator', label: 'Separator', min: 0.08, max: 0.5, step: 0.005, f: (v) => fmt2(v) + '/m²' },
    { k: 'cu', g: 'Metals for the foils', label: 'Copper', min: 7000, max: 22000, step: 10, f: perT },
    { k: 'al', g: 'Metals for the foils', label: 'Aluminium', min: 1500, max: 5000, step: 10, f: perT },
    { k: 'mfg', g: 'Making the cell', label: 'Manufacturing cost', min: 2, max: 12, step: 0.1, f: perK },
    { k: 'yld', g: 'Making the cell', label: 'Production yield', min: 85, max: 99.5, step: 0.5, f: (v) => v.toFixed(1) + '%' },
    { k: 'margin', g: 'Cell price and storage system', label: 'Cell maker margin', min: -15, max: 20, step: 0.1, f: (v) => fmtSigned(v) + '/kWh' },
    { k: 'ros', g: 'Cell price and storage system', label: 'Rest of the system (PCS, container, cooling, fire, BMS/EMS, integration)', min: 5, max: 60, step: 0.1, f: perK },
  ];
  const ADV = [
    { k: 'cath_kg', label: 'LFP cathode per kWh', min: 1.8, max: 2.6, step: 0.01, f: (v) => v.toFixed(2) + ' kg' },
    { k: 'an_kg', label: 'Graphite per kWh', min: 0.9, max: 1.5, step: 0.01, f: (v) => v.toFixed(2) + ' kg' },
    { k: 'el_kg', label: 'Electrolyte per kWh', min: 0.8, max: 1.5, step: 0.01, f: (v) => v.toFixed(2) + ' kg' },
    { k: 'sep_m2', label: 'Separator per kWh', min: 9, max: 18, step: 0.1, f: (v) => v.toFixed(1) + ' m²' },
    { k: 'cu_kg', label: 'Copper foil per kWh', min: 0.2, max: 0.5, step: 0.005, f: (v) => v.toFixed(3) + ' kg' },
    { k: 'al_kg', label: 'Aluminium foil per kWh', min: 0.15, max: 0.4, step: 0.005, f: (v) => v.toFixed(3) + ' kg' },
    { k: 'cu_fee', label: 'Copper foil processing fee', min: 1000, max: 6000, step: 10, f: perT },
    { k: 'al_fee', label: 'Aluminium foil processing fee', min: 500, max: 4000, step: 10, f: perT },
    { k: 'aux', label: 'Other cell materials (binders, carbon, solvent)', min: 0.5, max: 4, step: 0.1, f: perK },
    { k: 'struct', label: 'Cell case and parts', min: 1, max: 6, step: 0.1, f: perK },
    { k: 'ratio', label: 'kWh of cells per kWh of system', min: 0.9, max: 1.4, step: 0.01, f: (v) => v.toFixed(2) },
  ];
  const INDIA = [
    { k: 'freight', label: 'Freight and insurance to India', min: 0, max: 15, step: 0.1, f: perK },
    { k: 'bcd', label: 'Basic customs duty', min: 0, max: 40, step: 0.5, f: (v) => v.toFixed(1) + '%' },
  ];
  const SPECS = [...INPUTS, ...ADV, ...INDIA];
  const SENS = ['li', 'fe', 'proc', 'gr', 'el', 'sep', 'cu', 'al', 'mfg'];
  const OTH = ['fe', 'gr', 'el', 'sep', 'al'];
  const othPct = () => Math.round(d3.mean(OTH, (k) => (S.calc[k] / S.calcBase[k] - 1) * 100));
  const SIMPLE = [
    INPUTS[0],
    INPUTS[6],
    { k: 'oth', label: 'All other materials (iron phosphate, graphite, electrolyte, separator, aluminium)', min: -30, max: 30, step: 1, base: 0, f: (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + '%', get: othPct, set: (v) => OTH.forEach((k) => { S.calc[k] = +(S.calcBase[k] * (1 + v / 100)).toFixed(3); }) },
  ];
  const SIMPLE_SCEN = ['latest', 'lp0', 'lp1', 'metals'];
  const GROUPS = [
    ['Lithium', '--amber', ['li']],
    ['Iron phosphate, cathode processing, graphite', '--plum', ['fe', 'proc', 'gr']],
    ['Electrolyte and separator', '--blue', ['el', 'sep']],
    ['Copper and aluminium foils', '--orange', ['cu', 'al']],
    ['Cell case, other materials, manufacturing, yield loss', '--muted', ['aux', 'struct', 'loss', 'mfg']],
  ];
  const r1 = (v) => Math.round(v * 10) / 10;

  function cellCost(s) {
    const cm = CM(); const lc = cm.lc_per_t_lfp || 0.24, fe = cm.fepo4_per_t_lfp || 0.96;
    const m = (usdT, kg) => (usdT * kg) / 1000 / VAT;
    const parts = [
      ['li', 'Lithium carbonate (in cathode)', '--amber', m(s.li * lc, s.cath_kg)],
      ['fe', 'Iron phosphate (in cathode)', '--plum', m(s.fe * fe, s.cath_kg)],
      ['proc', 'Cathode processing', '--magenta', m(s.proc, s.cath_kg)],
      ['gr', 'Graphite anode', '--slate', m(s.gr, s.an_kg)],
      ['el', 'Electrolyte', '--blue', m(s.el, s.el_kg)],
      ['sep', 'Separator', '--teal', (s.sep * s.sep_m2) / VAT],
      ['cu', 'Copper foil', '--orange', ((s.cu + s.cu_fee / VAT) * s.cu_kg) / 1000],
      ['al', 'Aluminium foil', '--indigo', ((s.al + s.al_fee / VAT) * s.al_kg) / 1000],
      ['aux', 'Other cell materials', '--chart-muted', s.aux],
      ['struct', 'Cell case and parts', '--green', s.struct],
    ];
    const mat = d3.sum(parts, (p) => p[3]);
    parts.push(['loss', 'Yield loss', '--rose', mat * (100 / s.yld - 1)]);
    parts.push(['mfg', 'Manufacturing', '--muted', s.mfg]);
    return { parts: parts.map(([k, label, color, v]) => ({ k, label, color, v })), total: d3.sum(parts, (p) => p[3]) };
  }

  function calcBase() {
    const cm = CM(); const w = weekly(); const last = w[w.length - 1];
    const sp = spotPts(); const li = sp[sp.length - 1];
    const b = {
      li: li ? li.v : last.lithium_usd_t, fe: rawRow('Iron phosphate').usd, proc: cm.cathode_processing_usd_t, gr: rawRow('Graphite anode').usd, el: rawRow('LFP electrolyte').usd, sep: rawRow('Separator').usd, cu: rawRow('Copper').usd, al: rawRow('Aluminium').usd,
      mfg: cm.mfg_usd_kwh, yld: cm.yield_pct, cath_kg: cm.cathode_kg, an_kg: cm.anode_kg, el_kg: cm.electrolyte_kg, sep_m2: cm.separator_m2, cu_kg: cm.cu_foil_kg, al_kg: cm.al_foil_kg,
      cu_fee: cm.cu_foil_fee_usd_t, al_fee: cm.al_foil_fee_usd_t, aux: cm.aux_usd_kwh, struct: cm.structural_usd_kwh, ratio: 1,
      freight: 0, bcd: cm.bcd_pct, rebate: 0, mwh: 100,
    };
    b.margin = last.cell314 - cellCost(b).total;
    b.ros = r1(last.ac_4h - last.cell314);
    return b;
  }
  function calcHints() {
    const cm = CM(); const w = weekly(); const last = w[w.length - 1]; const sp = spotPts(); const li = sp[sp.length - 1];
    const note = (i) => (cm.notes || [])[i] || {};
    const raw = (name) => { const r = rawRow(name); return [`Latest ${r.price} · ${r.source}, ${r.asof}`, r.url]; };
    return {
      li: [`Latest ${fmtUsd0(li.v)}/t · ${li.source}, ${shortDay(li.d)}`, li.url],
      fe: raw('Iron phosphate'), gr: raw('Graphite anode'), el: raw('LFP electrolyte'), sep: raw('Separator'), cu: raw('Copper'), al: raw('Aluminium'),
      proc: ['SMM cathode price less its lithium and iron phosphate, 15 Oct', note(2).url],
      mfg: ['SMM cell cost model assumption', note(4).url], yld: ['SMM cell cost model assumption', note(4).url],
      margin: [`Set so the cell price matches InfoLink's ${fmtUsd1(last.cell314)}/kWh (${shortDay(parse(last.date))})`, last.url],
      ros: [`InfoLink 4-hour system ${fmtUsd1(last.ac_4h)} minus cell ${fmtUsd1(last.cell314)}, ${shortDay(parse(last.date))}`, last.url],
      freight: ['Add your own quote', null], bcd: ['Concessional rate for storage systems (Mercom, 12 Oct)', note(6).url],
    };
  }
  function hashParams() {
    const q = (location.hash.split('?')[1] || ''); const out = {};
    new URLSearchParams(q).forEach((v, k) => { if ((k in (S.calcBase || {})) && v !== '' && isFinite(+v)) out[k] = +v; });
    return out;
  }
  function syncHash() {
    if (S.tab !== 'calculator') return;
    const q = [...Object.keys(S.calcBase).filter((k) => Math.abs(S.calc[k] - S.calcBase[k]) > 1e-9).map((k) => `${k}=${+S.calc[k].toFixed(4)}`), ...(S.calcMode === 'detail' ? ['mode=detail'] : [])].join('&');
    try { history.replaceState(null, '', '#calculator' + (q ? '?' + q : '')); } catch (e) { /* ignore */ }
  }
  function calcField(spec, hints, prefix = 'ci') {
    const b = spec.base != null ? spec.base : S.calcBase[spec.k];
    const f = el('div', 'field'); f.dataset.k = spec.k;
    const id = prefix + '-' + spec.k; const lab = el('label'); lab.htmlFor = id;
    const name = el('span', 'nm', spec.label); const out = el('output'); out.id = id + '-out';
    const rs = el('button', 'reset-one', '↺'); rs.type = 'button'; rs.title = 'Back to the latest value'; rs.setAttribute('aria-label', 'Reset ' + spec.label);
    rs.addEventListener('click', (e) => { e.preventDefault(); if (spec.set) spec.set(0); else S.calc[spec.k] = S.calcBase[spec.k]; S.scen = null; renderCalc(); });
    const right = el('span', 'val'); right.append(out, rs);
    lab.append(name, right);
    const inp = el('input'); inp.type = 'range'; inp.id = id;
    inp.min = String(b > 0 ? Math.min(spec.min, b * 0.5) : spec.min); inp.max = String(b > 0 ? Math.max(spec.max, b * 1.6) : spec.max); inp.step = String(spec.step);
    inp.addEventListener('input', () => { if (spec.set) spec.set(+inp.value); else S.calc[spec.k] = +inp.value; S.scen = null; renderCalc(); });
    f.append(lab, inp);
    const h = hints[spec.k];
    if (h) { const hint = el('div', 'hint'); if (h[1]) hint.appendChild(link(h[0], h[1])); else hint.textContent = h[0]; f.appendChild(hint); }
    return f;
  }
  function buildCalc() {
    const hints = calcHints();
    const box = $('#calc-inputs'); box.replaceChildren();
    const head = el('div', 'panel-head'); head.appendChild(el('h2', null, 'Inputs')); box.appendChild(head);
    box.appendChild(el('p', 'sub', 'Each slider starts at the latest public price; the link under it is the source. ↺ puts one back.'));
    let grp;
    INPUTS.forEach((spec) => { if (spec.g !== grp) { grp = spec.g; box.appendChild(el('h3', 'grp', grp)); } box.appendChild(calcField(spec, hints)); });
    const adv = el('details', 'adv'); adv.appendChild(el('summary', null, 'Advanced: quantities per kWh, foil fees, cell parts'));
    ADV.forEach((spec) => adv.appendChild(calcField(spec, hints)));
    box.appendChild(adv);
    const ib = $('#calc-india-in'); ib.replaceChildren();
    INDIA.forEach((spec) => ib.appendChild(calcField(spec, hints)));
    const rl = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'calc-rebate';
    cb.addEventListener('change', () => { S.calc.rebate = cb.checked ? (CM().export_rebate_pct || 6) : 0; S.scen = null; renderCalc(); });
    rl.append(cb, document.createTextNode(` China ends its ${CM().export_rebate_pct || 6}% battery export rebate (due 1 Jan 2027), passed on in full`));
    ib.appendChild(rl);
    $('#calc-mwh').addEventListener('input', (e) => { const v = +e.target.value; if (v > 0) { S.calc.mwh = v; renderCalc(); } });
    $('#cs-mwh').addEventListener('input', (e) => { const v = +e.target.value; if (v > 0) { S.calc.mwh = v; renderCalc(); } });
    const csi = $('#cs-inputs'); csi.replaceChildren();
    const sh = { ...hints, oth: ['Moves all of them together from today\'s prices', null] };
    SIMPLE.forEach((spec) => csi.appendChild(calcField(spec, sh, 'cs')));
    $('#cs-india').addEventListener('change', (e) => { S.calcIndia = e.target.checked; renderCalc(); });
    $('#cs-to-detail').addEventListener('click', () => { S.calcMode = 'detail'; renderCalc(); window.scrollTo({ top: 0 }); });
    $$('#calc-mode button').forEach((x) => x.addEventListener('click', () => { S.calcMode = x.dataset.mode; renderCalc(); }));
    // scenarios
    const b = S.calcBase, cm = CM();
    const gs = (D.forecasts || []).find((f) => /Goldman/.test(f.who) && /2027/.test(f.period));
    const scen = [
      ['latest', 'Today\'s prices', {}],
      ...(cm.lithium_points || []).map((p, i) => ['lp' + i, `Lithium at ${p.label} (${fmtUsd0(p.usd_t)})`, { li: p.usd_t }]),
      ...(gs ? [['gs', `Lithium at Goldman's 2027 view (${fmtUsd0(gs.low)})`, { li: gs.low }]] : []),
      ['metals', 'Copper and aluminium +20%', { cu: Math.round(b.cu * 1.2), al: Math.round(b.al * 1.2) }],
      ['cheap', 'All materials −10%', Object.fromEntries(['li', 'fe', 'gr', 'el', 'sep', 'cu', 'al'].map((k) => [k, +(b[k] * 0.9).toFixed(3)]))],
      ['rebate', 'China export rebate ends', { rebate: cm.export_rebate_pct || 6 }],
    ];
    const sc = $('#calc-scen'); sc.replaceChildren();
    scen.forEach(([id, lab, ch]) => {
      const btn = el('button', null, lab); btn.type = 'button'; btn.dataset.id = id; btn.style.setProperty('--cc', css('--teal'));
      btn.addEventListener('click', () => { S.calc = { ...S.calcBase, mwh: S.calc.mwh, freight: S.calc.freight, ...ch }; S.scen = id; renderCalc(); if (id === 'rebate') $('#calc-india-box').open = true; });
      sc.appendChild(btn);
    });
    $('#calc-reset').addEventListener('click', () => { S.calc = { ...S.calcBase }; S.scen = 'latest'; $('#calc-mwh').value = S.calc.mwh; renderCalc(); });
    $('#calc-share').addEventListener('click', () => {
      syncHash(); const url = location.href; const msg = $('#calc-share-msg');
      const done = () => { msg.textContent = 'Link copied. Anyone who opens it sees this scenario.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { msg.textContent = 'Copy this link: ' + url; });
      else msg.textContent = 'Copy this link: ' + url;
    });
    // method notes
    const ul = $('#calc-method'); ul.replaceChildren();
    const li0 = el('li'); li0.append(el('b', null, 'Formula. '), document.createTextNode('Cell cost = (materials + cell case) ÷ yield + manufacturing. Cell price = cell cost + maker margin. System = cell price × kWh of cells per kWh + rest of system. China prices include 13% VAT and the model removes it; copper and aluminium are international prices without VAT. Figures are per kWh of cell or system.'));
    ul.appendChild(li0);
    (cm.notes || []).forEach((n) => {
      const li = el('li'); li.append(el('b', null, n.what + '. '), document.createTextNode(n.text + ' '));
      li.appendChild(link(n.source, n.url)); if (n.source2) { li.appendChild(document.createTextNode(' · ')); li.appendChild(link(n.source2, n.url2)); }
      ul.appendChild(li);
    });
  }
  function stackBar(box, parts, total) {
    box.replaceChildren();
    parts.filter((p) => p.v > 0).forEach((p) => {
      const s = el('span'); s.style.width = (p.v / total * 100) + '%'; s.style.background = css(p.color);
      s.addEventListener('pointermove', (ev) => showTip(ev, (t) => tipRow(t, css(p.color), p.label, `${fmtUsd1(p.v)}/kWh · ${(p.v / total * 100).toFixed(0)}%`)));
      s.addEventListener('pointerleave', hideTip);
      box.appendChild(s);
    });
  }
  function legendList(box, parts, total) {
    box.replaceChildren();
    parts.forEach((p) => {
      const r = el('div', 'li'); const sw = el('span', 'sw'); sw.style.background = css(p.color);
      r.append(sw, el('span', 'lb', p.label), el('b', null, fmtUsd1(p.v)), el('span', 'pc', (p.v / total * 100).toFixed(0) + '%'));
      box.appendChild(r);
    });
  }
  function kpi(box, k, v, d, cls) {
    const c = el('div', 'kpi' + (cls ? ' ' + cls : '')); c.append(el('span', 'k', k), el('span', 'v', v));
    if (d) c.appendChild(el('span', 'd' + (d[1] == null ? '' : d[1] < -0.05 ? ' is-down' : d[1] > 0.05 ? ' is-up' : ''), d[0]));
    box.appendChild(c);
  }
  function sweepChart(box, s, market) {
    box.replaceChildren();
    const W = box.clientWidth || 600, H = 270;
    const x0 = Math.min(6000, s.li * 0.6), x1 = Math.max(40000, s.li * 1.3);
    const xs = d3.range(x0, x1 + 1, (x1 - x0) / 80);
    const pts = xs.map((x) => ({ x, v: cellCost({ ...s, li: x }).total }));
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const vmin = Math.min(d3.min(pts, (p) => p.v), market), vmax = Math.max(d3.max(pts, (p) => p.v), market);
    const yS = d3.scaleLinear([vmin * 0.92, vmax * 1.05], [H - 30, 12]).nice();
    const ticks = yS.ticks(5); const left = measure(svg, ticks.map(fmtUsd0)) + 12;
    const xS = d3.scaleLinear([x0, x1], [left, W - 12]);
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(yS).tickValues(ticks).tickFormat(fmtUsd0).tickSize(-(W - left - 12))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(xS).ticks(Math.max(3, Math.floor((W - left) / 80))).tickFormat((d) => '$' + d / 1000 + 'k').tickSize(0).tickPadding(10)).call(axisStyle);
    // squeeze zone: cost above market
    const over = pts.filter((p) => p.v >= market);
    if (over.length > 1) svg.append('path').datum(over).attr('fill', css('--bad')).attr('fill-opacity', 0.1).attr('d', d3.area().x((p) => xS(p.x)).y0(yS(market)).y1((p) => yS(p.v)));
    svg.append('line').attr('x1', left).attr('x2', W - 12).attr('y1', yS(market)).attr('y2', yS(market)).attr('stroke', css('--blue')).attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4');
    svg.append('text').attr('x', left + 6).attr('y', yS(market) - 6).attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--blue')).text(`Market cell price ${fmtUsd1(market)}`);
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css('--teal')).attr('stroke-width', 2.2).attr('d', d3.line().x((p) => xS(p.x)).y((p) => yS(p.v)));
    const now = cellCost(s).total;
    svg.append('circle').attr('cx', xS(s.li)).attr('cy', yS(now)).attr('r', 5).attr('fill', css('--teal')).attr('stroke', css('--panel')).attr('stroke-width', 2);
    const nowLab = `Now ${fmtUsd0(s.li)}/t → ${fmtUsd1(now)}`;
    const nlw = measure(svg, [nowLab]);
    svg.append('text').attr('x', Math.min(xS(s.li) + 8, W - 12 - nlw)).attr('y', yS(now) + 18).attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--teal')).text(nowLab);
    const slope = (cellCost({ ...s, li: s.li + 1000 }).total - now) / 1000;
    const be = s.li + (market - now) / slope;
    if (be > x0 && be < x1) {
      svg.append('line').attr('x1', xS(be)).attr('x2', xS(be)).attr('y1', yS(market)).attr('y2', H - 30).attr('stroke', css('--bad')).attr('stroke-dasharray', '3 3');
      const bl = `Break-even ${fmtUsd0(Math.round(be / 10) * 10)}/t`; const bw = measure(svg, [bl]);
      svg.append('text').attr('x', Math.min(xS(be) + 6, W - 12 - bw)).attr('y', H - 38).attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--bad')).text(bl);
    }
    const rule = svg.append('line').attr('y1', 12).attr('y2', H - 30).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 3').attr('opacity', 0);
    svg.append('rect').attr('x', left).attr('y', 0).attr('width', W - left - 12).attr('height', H - 30).attr('fill', 'transparent')
      .on('pointermove', (ev) => { const [mx] = d3.pointer(ev); const x = xS.invert(mx); const v = cellCost({ ...s, li: x }).total; rule.attr('x1', mx).attr('x2', mx).attr('opacity', 1);
        showTip(ev, (t) => { tipRow(t, css('--amber'), 'Lithium carbonate', fmtUsd0(x) + '/t'); tipRow(t, css('--teal'), 'Modelled cell cost', fmtUsd1(v) + '/kWh'); tipRow(t, css('--blue'), 'Margin at market price', fmtSigned(market - v)); }); })
      .on('pointerleave', () => { rule.attr('opacity', 0); hideTip(); });
    return { be, slope, now };
  }

  function renderCalc() {
    const kp = $('#calc-kpis');
    if (!D.costmodel || !weekly().length || !(D.rawmats || []).length) { fail(kp, 'Cost data failed to load'); return; }
    if (!S.calcBase) {
      S.calcBase = calcBase();
      S.calc = { ...S.calcBase, ...hashParams() };
      S.scen = Object.keys(hashParams()).length ? null : 'latest';
      S.calcMode = /[?&]mode=detail/.test(location.hash) ? 'detail' : 'simple';
      S.calcIndia = false;
      buildCalc();
    }
    const s = S.calc, b = S.calcBase, w = weekly(), last = w[w.length - 1];
    // sync inputs
    const syncField = (spec, prefix) => {
      const inp = $(`#${prefix}-${spec.k}`); if (!inp) return;
      const v = spec.get ? spec.get() : s[spec.k], v0 = spec.base != null ? spec.base : b[spec.k];
      inp.value = v; $(`#${prefix}-${spec.k}-out`).textContent = spec.f(v);
      inp.closest('.field').classList.toggle('changed', Math.abs(v - v0) > 1e-9);
    };
    SPECS.forEach((spec) => syncField(spec, 'ci'));
    SIMPLE.forEach((spec) => syncField(spec, 'cs'));
    const simple = S.calcMode !== 'detail';
    $('#calc-simple').hidden = !simple; $('#calc-detail').hidden = simple;
    $$('#calc-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === S.calcMode)));
    $$('#calc-scen button').forEach((x) => { x.hidden = simple && !SIMPLE_SCEN.includes(x.dataset.id); });
    $('#cs-india').checked = !!S.calcIndia;
    if (+$('#cs-mwh').value !== s.mwh) $('#cs-mwh').value = s.mwh;
    $('#calc-rebate').checked = s.rebate > 0;
    if (+$('#calc-mwh').value !== s.mwh) $('#calc-mwh').value = s.mwh;
    $$('#calc-scen button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.id === S.scen)));

    const c = cellCost(s), c0 = cellCost(b);
    const market = last.cell314, mDate = shortDay(parse(last.date));
    const price = c.total + s.margin;
    const sysP = price * s.ratio + s.ros;
    // KPIs
    kp.replaceChildren();
    const dc = c.total - c0.total;
    kpi(kp, 'Modelled cell cost', fmtUsd1(c.total), Math.abs(dc) < 0.05 ? ['At the latest prices', null] : [`${fmtSigned(dc)} (${pctS(dc / c0.total * 100)}) vs latest prices`, dc], 'main');
    const mm = market - c.total;
    kpi(kp, `Market cell price (InfoLink, ${mDate})`, fmtUsd1(market), [mm >= 0 ? `At this price makers earn ${fmtUsd1(mm)} (${(mm / market * 100).toFixed(0)}%) over the modelled cost` : `At this price makers lose ${fmtUsd1(-mm)} (${(-mm / market * 100).toFixed(0)}%) against the modelled cost`, -mm]);
    kpi(kp, 'Cell price in this scenario', fmtUsd1(price), [`Cost ${fmtSigned(s.margin)} margin · ` + (Math.abs(price - market) < 0.05 ? 'matches the market' : `${pctS((price / market - 1) * 100)} vs market`), Math.abs(price - market) < 0.05 ? null : price - market]);
    stackBar($('#calc-stack'), c.parts, c.total);
    legendList($('#calc-legend'), c.parts, c.total);
    // system + project
    const mwh = s.mwh, M = (v) => fmtM(v * mwh / 1000);
    const sysBox = $('#calc-sys'); sysBox.replaceChildren();
    const sysParts = [
      { label: 'Cells at cost', color: '--teal', v: c.total * s.ratio },
      { label: 'Cell maker margin', color: '--green', v: Math.max(0, s.margin) * s.ratio },
      { label: 'Rest of the system', color: '--indigo', v: s.ros },
    ];
    const sk = el('div', 'kpis'); sysBox.appendChild(sk);
    const ds = sysP - last.ac_4h;
    kpi(sk, '4-hour AC system, China', fmtUsd1(sysP), Math.abs(ds) < 0.05 ? [`Matches InfoLink's ${fmtUsd1(last.ac_4h)} (${mDate})`, null] : [`${fmtSigned(ds)} (${pctS(ds / last.ac_4h * 100)}) vs InfoLink ${fmtUsd1(last.ac_4h)}`, ds], 'main');
    kpi(sk, `Cells for ${d3.format(',')(mwh)} MWh`, M(price * s.ratio), [`${fmtUsd1(price * s.ratio)}/kWh of system`, null]);
    kpi(sk, `System for ${d3.format(',')(mwh)} MWh`, M(sysP), [`Excludes grid connection, land and EPC`, null]);
    const sb = el('div', 'stackbar'); sysBox.appendChild(sb); stackBar(sb, sysParts, d3.sum(sysParts, (p) => p.v));
    const sl = el('div', 'legend'); sysBox.appendChild(sl); legendList(sl, sysParts, d3.sum(sysParts, (p) => p.v));
    if (s.margin < 0) sysBox.appendChild(el('p', 'sub', `The margin is negative: cells sell ${fmtUsd1(-s.margin)}/kWh below modelled cost.`));
    // India landed
    const cm = CM();
    const reb = sysP * s.rebate / 100, cif = sysP + reb + s.freight, bcd = cif * s.bcd / 100, sws = bcd * (cm.sws_pct_of_bcd ?? 10) / 100, landed = cif + bcd + sws;
    const ib = $('#calc-india'); ib.replaceChildren();
    const ik = el('div', 'kpis'); ib.appendChild(ik);
    kpi(ik, 'Landed in India, before GST', fmtUsd1(landed), [`${pctS((landed / sysP - 1) * 100)} on the China price`, null], 'main');
    kpi(ik, `For ${d3.format(',')(mwh)} MWh`, M(landed), [`Of which duty ${M(bcd + sws)}`, null]);
    const iParts = [
      { label: 'China system price', color: '--indigo', v: sysP },
      { label: 'Export rebate passed on', color: '--plum', v: reb },
      { label: 'Freight and insurance', color: '--slate', v: s.freight },
      { label: 'Customs duty + surcharge', color: '--rose', v: bcd + sws },
    ].filter((p) => p.v > 0);
    const ibar = el('div', 'stackbar'); ib.appendChild(ibar); stackBar(ibar, iParts, landed);
    const il = el('div', 'legend'); ib.appendChild(il); legendList(il, iParts, landed);
    // sensitivity
    const tb = $('#calc-tornado');
    try {
      const rows = SENS.map((k) => { const spec = SPECS.find((x) => x.k === k); const up = cellCost({ ...s, [k]: s[k] * 1.2 }).total - c.total; return { k, label: spec.label, d: up, from: spec.f(s[k]), to: spec.f(s[k] * 1.2), color: (c.parts.find((p) => p.k === k) || {}).color || '--slate' }; }).sort((a, b2) => b2.d - a.d);
      hBars(tb, rows, { label: 'label', value: 'd', fmt: (v) => '+' + fmtUsd1(v), color: (r) => css(r.color), tip: (t, r) => tipNote(t, `${r.from} → ${r.to}; cell cost +${(r.d / c.total * 100).toFixed(1)}%`) });
    } catch (e) { console.error(e); fail(tb); }
    // lithium sweep
    const sw = $('#calc-sweep');
    try {
      const r = sweepChart(sw, s, market);
      const per = `Each $1,000/t on lithium carbonate moves cell cost by about ${fmtUsd1(r.slope * 1000)}/kWh.`;
      $('#calc-sweep-sub').textContent = r.now <= market
        ? `At today's market price of ${fmtUsd1(market)}/kWh, the modelled cost reaches the price if lithium carbonate rises to about ${fmtUsd0(Math.round(r.be / 10) * 10)}/t (${pctS((r.be / s.li - 1) * 100)} from the slider). ${per}`
        : `At these inputs the modelled cost is already above today's market price of ${fmtUsd1(market)}/kWh; lithium would need to fall to about ${fmtUsd0(Math.round(r.be / 10) * 10)}/t for makers to break even. ${per}`;
    } catch (e) { console.error(e); fail(sw); }
    // simple results
    const csk = $('#cs-kpis'); csk.replaceChildren();
    const chg = (v, v0, unit = '') => (Math.abs(v - v0) < 0.05 ? ['Today\'s prices', null] : [`${fmtSigned(v - v0)}${unit} (${pctS((v / v0 - 1) * 100)}) vs today`, v - v0]);
    const sys0 = (c0.total + b.margin) * b.ratio + b.ros;
    kpi(csk, 'Cell: cost to make', perK(c.total), chg(c.total, c0.total), 'main');
    kpi(csk, 'Cell: price to buyers', perK(price), [`Cost plus today's maker margin of ${fmtUsd1(s.margin)}`, null]);
    kpi(csk, '4-hour storage system', perK(sysP), chg(sysP, sys0));
    const land = (x) => (x * (1 + s.rebate / 100) + s.freight) * (1 + (s.bcd / 100) * (1 + (cm.sws_pct_of_bcd ?? 10) / 100));
    const projV = S.calcIndia ? land(sysP) : sysP, proj0 = S.calcIndia ? land(sys0) : sys0;
    kpi(csk, `${d3.format(',')(mwh)} MWh project${S.calcIndia ? ', landed in India' : ''}`, fmtM(projV * mwh / 1000), Math.abs(projV - proj0) < 0.05 ? [S.calcIndia ? 'Includes customs duty, before GST' : 'System only, before installation', null] : [`${fmtSigned((projV - proj0) * mwh / 1000)}M vs today`, projV - proj0]);
    const gparts = GROUPS.map(([label, color, keys]) => ({ label, color, v: d3.sum(c.parts.filter((p) => keys.includes(p.k)), (p) => p.v) }));
    stackBar($('#cs-stack'), gparts, c.total); legendList($('#cs-legend'), gparts, c.total);
    const swR = { slope: (cellCost({ ...s, li: s.li + 1000 }).total - c.total) / 1000 };
    const be = s.li + (market - c.total) / swR.slope;
    const ins = $('#cs-insight'); ins.replaceChildren();
    ins.append(el('b', null, 'Lithium is ' + (c.parts[0].v / c.total * 100).toFixed(0) + '% of cell cost. '), document.createTextNode(`Every $1,000/t on lithium carbonate adds about ${fmtUsd1(swR.slope * 1000)}/kWh to a cell. ` + (c.total <= market ? `Cell makers keep about ${fmtUsd1(market - c.total)}/kWh at today's market price, so lithium would have to reach about ${fmtUsd0(Math.round(be / 100) * 100)}/t before they sell at cost.` : `At these prices cells would cost more to make than today's market price of ${fmtUsd1(market)}/kWh.`)));
    const mini = $('#calc-mini'); mini.replaceChildren(); mini.hidden = S.calcMode !== 'detail';
    [['Cell cost', fmtUsd1(c.total)], ['Cell price', fmtUsd1(price)], ['4-h system', fmtUsd1(sysP)], ['India landed', fmtUsd1(landed)]].forEach(([k, v]) => { const x = el('span'); x.append(el('small', null, k), el('b', null, v)); mini.appendChild(x); });
    syncHash();
  }

  const sortedNews = () => [...(D.news || [])].sort((a, b) => d3.descending(a.date, b.date) || d3.descending(a.id, b.id));
  function newsItem(n, feed = false) {
    const li = el('li', feed ? 'story' : null); if (feed) li.id = 'story-' + n.id;
    li.style.setProperty('--cc', catColor(n.category));
    const meta = el('div', 'meta');
    if (isNewNews(n.id)) meta.appendChild(newTag('Added since your last visit'));
    if (feed) meta.append(el('span', 'cat', n.category || 'News'), el('span', 'chip' + dirClass(n.direction), n.effect));
    else meta.append(el('span', null, n.day), el('span', 'tag', n.category || 'News'), el('span', 'chip' + dirClass(n.direction), n.effect));
    const src = el('span'); src.appendChild(link(n.source, n.url)); if (n.source2) { src.appendChild(document.createTextNode(' · ')); src.appendChild(link(n.source2, n.url2)); }
    li.append(meta, el('div', 'h', n.headline), src);
    return li;
  }
  function renderNews() {
    const all = sortedNews();
    const cats = [...new Set(all.map((n) => n.category || 'News'))].sort((a, b) => all.filter((x) => x.category === b).length - all.filter((x) => x.category === a).length);
    const chips = $('#news-cats'); chips.replaceChildren();
    [['', 'All'], ...cats.map((c) => [c, c])].forEach(([val, lab]) => {
      const n = val ? all.filter((x) => (x.category || 'News') === val).length : all.length;
      const b = el('button', null, `${lab} (${n})`); b.type = 'button'; b.setAttribute('aria-pressed', String(S.news.cat === val));
      if (val) b.style.setProperty('--cc', catColor(val));
      b.addEventListener('click', () => { S.news.cat = val; renderNews(); });
      chips.appendChild(b);
    });
    const q = S.news.q.toLowerCase();
    const list = all.filter((n) => (!S.news.cat || (n.category || 'News') === S.news.cat) && (!S.news.effect || n.direction === S.news.effect) && (!q || [n.headline, n.sources, n.category, n.effect].join(' ').toLowerCase().includes(q)));
    const key = [S.news.cat, S.news.effect, q].join('|'); if (S.news.key !== key) { S.news.key = key; S.news.shown = 40; }
    const ist = new Date(Date.now() + 5.5 * 36e5); const todayISO = ist.toISOString().slice(0, 10);
    const yISO = new Date(+ist - 864e5).toISOString().slice(0, 10);
    const recent = all.filter((n) => n.date >= yISO).length;
    S.news.recent = recent;
    $('#news-status').textContent = list.length === all.length ? `${all.length} stories, newest first.` : `${list.length} of ${all.length} stories match.`;
    const ul = $('#news-list'); ul.replaceChildren();
    if (!list.length) ul.appendChild(el('li', 'empty', 'No stories match. Clear the search or pick another topic.'));
    let lastDay = null;
    list.slice(0, S.news.shown).forEach((n) => {
      if (n.date !== lastDay) {
        lastDay = n.date;
        const lab = n.date === todayISO ? 'Today' : n.date === yISO ? 'Yesterday' : d3.utcFormat('%A %-d %B')(parse(n.date));
        ul.appendChild(el('li', 'day-head', lab));
      }
      ul.appendChild(newsItem(n, true));
    });
    const more = $('#news-more'); const left = list.length - S.news.shown;
    more.hidden = left <= 0; more.textContent = `Show ${Math.min(40, left)} more (${left} left)`;
    if (!more.dataset.ready) { more.dataset.ready = '1'; more.addEventListener('click', () => { S.news.shown += 40; renderNews(); }); }
    newsSide(all, list);
  }
  // sidebar: this week at a glance, alerts, topics, dates ahead (all from the stories and dates already on the site)
  function newsSide(all) {
    const box = $('#news-side'); if (!box) return; box.replaceChildren();
    const ist = new Date(Date.now() + 5.5 * 36e5); const wk = new Date(+ist - 7 * 864e5).toISOString().slice(0, 10);
    const week = all.filter((n) => n.date >= wk);
    const card = (title, sub) => { const c = el('section', 'ns-card'); c.appendChild(el('h3', null, title)); if (sub) c.appendChild(el('p', 'sub', sub)); box.appendChild(c); return c; };
    // 1. this week
    const c1 = card('This week', `${week.length} stories in the last 7 days`);
    const cnt = (d) => week.filter((n) => n.direction === d).length;
    const g = el('div', 'ns-split');
    [['down', 'Push prices or demand down', '--ok'], ['up', 'Push prices or demand up', '--warn'], ['flat', 'Neutral or mixed', '--slate']].forEach(([d, lab, col]) => {
      const b = el('button', 'ns-stat'); b.type = 'button'; b.style.setProperty('--c', css(col)); b.setAttribute('aria-pressed', String(S.news.effect === d));
      b.append(el('b', null, String(cnt(d))), el('span', null, lab));
      b.addEventListener('click', () => { S.news.effect = S.news.effect === d ? '' : d; $('#news-effect').value = S.news.effect; renderNews(); });
      g.appendChild(b);
    });
    c1.appendChild(g);
    // 2. alerts
    const al = all.filter((n) => n.alert && n.date >= new Date(+ist - 14 * 864e5).toISOString().slice(0, 10)).slice(0, 5);
    if (al.length) {
      const c2 = card('Alerts', 'Stories flagged as important in the last two weeks');
      const ul = el('ul', 'ns-list'); c2.appendChild(ul);
      al.forEach((n) => {
        const li = el('li'); const b = el('button', 'ns-alert'); b.type = 'button';
        b.append(el('span', 'd', n.day || d3.utcFormat('%-d %b')(parse(n.date))), el('span', 't', n.short || n.headline));
        b.addEventListener('click', () => {
          S.news.cat = ''; S.news.effect = ''; S.news.q = ''; $('#news-search').value = ''; $('#news-effect').value = '';
          const idx = sortedNews().findIndex((x) => x.id === n.id); S.news.key = '||'; S.news.shown = Math.max(40, idx + 5); renderNews();
          const t = document.getElementById('story-' + n.id); if (t) { t.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600); }
        });
        li.appendChild(b); ul.appendChild(li);
      });
    }
    // 3. topics this week
    const cats = d3.rollups(week, (v) => v.length, (n) => n.category || 'News').sort((a, b) => b[1] - a[1]);
    if (cats.length) {
      const c3 = card('Topics this week', 'Click a topic to show only its stories');
      const mx = d3.max(cats, (x) => x[1]);
      cats.forEach(([cat, n]) => {
        const b = el('button', 'ns-bar'); b.type = 'button'; b.style.setProperty('--cc', catColor(cat)); b.setAttribute('aria-pressed', String(S.news.cat === cat));
        const tr = el('span', 'tr'); const f = el('i'); f.style.width = (100 * n / mx) + '%'; tr.appendChild(f);
        b.append(el('span', 'l', cat), tr, el('b', null, String(n)));
        b.addEventListener('click', () => { S.news.cat = S.news.cat === cat ? '' : cat; renderNews(); });
        c3.appendChild(b);
      });
    }
    // 4. coming up
    const up = comingUp(null, 4);
    if (up.length) {
      const c4 = card('Coming up', 'Dates to watch');
      const ul = el('ul', 'dates ns-dates'); c4.appendChild(ul); datesList(ul, up);
      const a = el('button', 'btn link', 'All regulations →'); a.type = 'button'; a.addEventListener('click', () => go('rules')); c4.appendChild(a);
    }
  }

  // ---------- risk navigator ----------
  // Scores come ready-made from data/risk.json (scripts/risk.py); this only draws them.
  const RISK = { h: 'h3', sel: null };
  const LVL = { Low: '--ok', Elevated: '--warn', High: '--bad' };
  const lvlColor = (lvl) => css(LVL[lvl] || '--slate');
  const scoreTxt = (v) => (v == null ? '–' : v.toFixed(1));
  function riskChip(ax) {
    const c = el('span', 'rchip' + (ax && ax.level ? ' lv-' + ax.level.toLowerCase() : ' lv-none'));
    c.append(el('b', null, scoreTxt(ax && ax.score)), el('span', null, ax && ax.level ? ax.level : 'Not scored'));
    return c;
  }
  function riskDelta(ax) {
    const ch = ax && ax.change;
    if (ch == null) return el('span', 'rdelta', '');
    const t = Math.abs(ch) < 0.05 ? 'no change' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}`;
    const s = el('span', 'rdelta' + (ch > 0.04 ? ' up' : ch < -0.04 ? ' down' : ''), t); s.title = 'Change since a week ago';
    return s;
  }
  function riskStripItems() {
    const R = D.risk; if (!R || !R.materials) return [];
    const rows = [];
    R.materials.forEach((m) => ['price', 'supply'].forEach((ax) => { const a = m.h3 && m.h3[ax]; if (a && a.score != null) rows.push({ m, ax, a }); }));
    return rows.sort((x, y) => y.a.score - x.a.score).slice(0, 3);
  }
  function renderRisk() {
    const R = D.risk;
    const det = $('#risk-detail'), tbl = $('#risk-table'), map = $('#risk-map');
    if (!R || !R.materials) { fail(map, 'Risk scores are not available yet'); tbl.replaceChildren(); det.replaceChildren(); return; }
    const mats = R.materials;
    if (!RISK.sel || !mats.some((m) => m.id === RISK.sel)) {
      const top = [...mats].sort((a, b) => Math.max(b.h3.price.score || 0, b.h3.supply.score || 0) - Math.max(a.h3.price.score || 0, a.h3.supply.score || 0))[0];
      RISK.sel = top && top.id;
    }
    // horizon switch
    const seg = $('#risk-h'); seg.replaceChildren();
    Object.entries(R.horizons).forEach(([k, h]) => {
      const b = el('button', null, h.label); b.type = 'button'; b.setAttribute('aria-pressed', String(RISK.h === k));
      b.addEventListener('click', () => { RISK.h = k; renderRisk(); }); seg.appendChild(b);
    });
    $('#risk-asof').textContent = `Scored ${d3.utcFormat('%-d %b %Y')(parse(R.asof))}`;
    // table
    tbl.replaceChildren();
    const th = el('thead'); const hr = el('tr');
    ['Material', 'Price risk', 'Supply risk'].forEach((t) => hr.appendChild(el('th', null, t))); th.appendChild(hr); tbl.appendChild(th);
    const tb = el('tbody');
    mats.forEach((m) => {
      const r = m[RISK.h]; const tr = el('tr', m.id === RISK.sel ? 'sel' : null); tr.tabIndex = 0;
      const n = el('td', 'rname'); n.append(el('b', null, m.short), el('span', null, m.group));
      const p = el('td'); p.append(riskChip(r.price), riskDelta(r.price));
      const s = el('td'); s.append(riskChip(r.supply), riskDelta(r.supply));
      tr.append(n, p, s);
      const pick = () => { RISK.sel = m.id; renderRisk(); $('#risk-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      tr.addEventListener('click', pick); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    const lg = $('#risk-legend'); lg.replaceChildren();
    [['Low', '0 – 3.9'], ['Elevated', '4 – 6.4'], ['High', '6.5 – 10']].forEach(([l, r]) => { const s = el('span', 'lv-' + l.toLowerCase()); s.append(el('i'), document.createTextNode(`${l} ${r}`)); lg.appendChild(s); });
    lg.appendChild(el('span', 'note', '▲▼ change since a week ago'));
    drawRiskMap(map, mats);
    renderRiskDetail(det, mats.find((m) => m.id === RISK.sel), R);
    renderRiskIndia($('#risk-india'), R.india || {});
    renderRiskMethod($('#risk-method'), R);
    loadOutlook();
  }

  // ---------- 2-3 year outlook (data/scenarios.json, written nightly by scripts/scenarios.py) ----------
  const OL = { scen: 'base', mat: 'lithium', loading: false };
  const fmtInr0 = (v) => '₹' + d3.format(',.0f')(v);
  const fmtInr2 = (v) => '₹' + d3.format(',.2f')(v);
  const OL_MATS = [
    { id: 'lithium', name: 'Lithium carbonate', unit: '/t', fmt: fmtUsd0 },
    { id: 'cathode', name: 'LFP cathode', unit: '/t', fmt: fmtUsd0 },
    { id: 'cell_ess', name: 'Storage cell (314 Ah)', unit: '/kWh', fmt: fmtUsd1 },
    { id: 'cell_ev', name: 'EV cell', unit: '/kWh', fmt: fmtUsd1 },
    { id: 'cell_inr', name: 'Storage cell in rupees', unit: '/kWh', fmt: fmtInr0, note: 'before customs duty and GST' },
    { id: 'copper', name: 'Copper', unit: '/t', fmt: fmtUsd0 },
    { id: 'aluminium', name: 'Aluminium', unit: '/t', fmt: fmtUsd0 },
    { id: 'inr', name: 'Rupees per US$', unit: '', fmt: fmtInr2 },
  ];
  const OL_COL = { base: '--l2', tight: '--orange', glut: '--l5', curbs: '--plum' };
  const scenWait = [];
  function ensureScen(cb) { // load data/scenarios.json once; run cb when it is in
    if (D.scen !== undefined) { cb(); return; }
    scenWait.push(cb); if (OL.loading) return; OL.loading = true;
    fetch('data/scenarios.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      OL.loading = false; D.scen = j; scenWait.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    });
  }
  function loadOutlook() { ensureScen(() => { if (S.tab === 'risk') renderOutlook(); }); }
  function renderOutlook() {
    const X = D.scen; const box = $('#outlook'); if (!box) return;
    if (!X || !X.results) { fail($('#ol-chart'), 'The outlook is not available yet'); return; }
    const mat = OL_MATS.find((m) => m.id === OL.mat) || OL_MATS[0];
    $('#ol-asof').textContent = `Run ${d3.utcFormat('%-d %b %Y')(parse(X.asof))} · ${d3.format(',')(X.sims)} simulated paths per scenario`;
    // scenario switch
    const seg = $('#ol-scen'); seg.replaceChildren();
    X.scenarios.forEach((sc) => { const b = el('button', null, sc.name); b.type = 'button'; b.setAttribute('aria-pressed', String(OL.scen === sc.id)); b.addEventListener('click', () => { OL.scen = sc.id; renderOutlook(); }); seg.appendChild(b); });
    const sc = X.scenarios.find((x) => x.id === OL.scen);
    const say = $('#ol-say'); say.replaceChildren(); const sw = el('i', 'ol-dot'); sw.style.background = css(OL_COL[sc.id]); say.append(sw, el('b', null, sc.short + '. '), document.createTextNode(sc.say));
    // material chips
    const mb = $('#ol-mats'); mb.replaceChildren();
    OL_MATS.filter((m) => X.results.base[m.id]).forEach((m) => { const b = el('button', 'ol-chip', m.name); b.type = 'button'; b.setAttribute('aria-pressed', String(OL.mat === m.id)); b.addEventListener('click', () => { OL.mat = m.id; renderOutlook(); }); mb.appendChild(b); });
    olChart($('#ol-chart'), X, mat);
    olYears($('#ol-years'), X, mat);
    olRisk($('#ol-risk'), X);
    olMethod($('#ol-method'), X);
  }
  function olChart(box, X, mat) {
    box.replaceChildren();
    const months = X.months.map(parse); const R = X.results[OL.scen][mat.id]; const now = X.now[mat.id];
    const hist = ((X.history || {})[mat.id] || []).map(([dd, v]) => ({ d: parse(dd), v: +v })).filter((p) => +p.d >= +months[0] - 3 * 366 * 864e5);
    const today = parse(X.asof);
    const W = box.clientWidth || 700, H = 340;
    const allV = [...hist.map((p) => p.v), now, ...R.bands.flatMap((b) => [b[0], b[4]]), ...X.scenarios.map((s) => X.results[s.id][mat.id].bands.map((b) => b[2])).flat()].filter((v) => v > 0);
    const y = d3.scaleLinear([Math.min(...allV) * 0.92, Math.max(...allV) * 1.04], [H - 30, 14]).nice();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H).attr('role', 'img').attr('aria-label', `${mat.name}: history and ${OL.scen} scenario range to ${d3.utcFormat('%b %Y')(months[months.length - 1])}`);
    const ticks = y.ticks(5); const left = measure(svg, ticks.map(mat.fmt)) + 12; const narrow = W < 560; const right = narrow ? Math.min(96, W * 0.27) : Math.min(150, W * 0.2);
    const x0 = hist.length ? hist[0].d : today;
    const x = d3.scaleUtc([x0, months[months.length - 1]], [left, W - right]);
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(y).tickValues(ticks).tickFormat(mat.fmt).tickSize(-(W - left - right))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(x).ticks(d3.utcYear.every(1)).tickFormat(d3.utcFormat(narrow ? "'%y" : '%Y')).tickSize(0).tickPadding(10)).call(axisStyle);
    const c = css(OL_COL[OL.scen]);
    const fut = [{ d: today, b: [now, now, now, now, now] }, ...months.map((m, i) => ({ d: m, b: R.bands[i] }))];
    svg.append('path').datum(fut).attr('fill', c).attr('fill-opacity', 0.13).attr('d', d3.area().x((p) => x(p.d)).y0((p) => y(p.b[0])).y1((p) => y(p.b[4])).curve(d3.curveMonotoneX));
    svg.append('path').datum(fut).attr('fill', c).attr('fill-opacity', 0.22).attr('d', d3.area().x((p) => x(p.d)).y0((p) => y(p.b[1])).y1((p) => y(p.b[3])).curve(d3.curveMonotoneX));
    // other scenarios' middles, thin and muted
    const labels = [];
    X.scenarios.filter((s) => s.id !== OL.scen).forEach((s) => {
      const b = X.results[s.id][mat.id].bands; const pts = [{ d: today, v: now }, ...months.map((m, i) => ({ d: m, v: b[i][2] }))];
      svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css(OL_COL[s.id])).attr('stroke-width', 1.2).attr('stroke-dasharray', '4 4').attr('opacity', 0.75).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)).curve(d3.curveMonotoneX));
      if (!narrow) labels.push({ y: y(pts[pts.length - 1].v), t: s.name, c: css(OL_COL[s.id]), w: 500 });
    });
    const mid = [{ d: today, v: now }, ...months.map((m, i) => ({ d: m, v: R.bands[i][2] }))];
    svg.append('path').datum(mid).attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2.4).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)).curve(d3.curveMonotoneX));
    labels.push({ y: y(mid[mid.length - 1].v), t: narrow ? mat.fmt(mid[mid.length - 1].v) : `${X.scenarios.find((s) => s.id === OL.scen).name} ${mat.fmt(mid[mid.length - 1].v)}`, c, w: 700 });
    if (hist.length > 1) svg.append('path').datum([...hist, { d: today, v: now }]).attr('fill', 'none').attr('stroke', css('--fg')).attr('stroke-width', 1.8).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)));
    svg.append('line').attr('x1', x(today)).attr('x2', x(today)).attr('y1', 14).attr('y2', H - 30).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 3');
    svg.append('text').attr('x', x(today) + 5).attr('y', 24).attr('font-size', 11.5).attr('fill', css('--muted')).text('Today');
    svg.append('circle').attr('cx', x(today)).attr('cy', y(now)).attr('r', 4).attr('fill', css('--fg'));
    labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    labels.forEach((l) => svg.append('text').attr('x', W - right + 8).attr('y', l.y + 4).attr('font-size', 11.5).attr('font-weight', l.w).attr('fill', l.c).text(l.t));
    // hover
    const rule = svg.append('line').attr('y1', 14).attr('y2', H - 30).attr('stroke', css('--axis')).attr('opacity', 0);
    const seq = [...hist.map((p) => ({ d: p.d, h: p.v })), { d: today, h: now }, ...months.map((m, i) => ({ d: m, b: R.bands[i] }))];
    const bis = d3.bisector((p) => p.d).center;
    svg.append('rect').attr('x', left).attr('y', 0).attr('width', W - left - right).attr('height', H - 30).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const p = seq[bis(seq, x.invert(d3.pointer(ev)[0]))]; rule.attr('x1', x(p.d)).attr('x2', x(p.d)).attr('opacity', 1);
        showTip(ev, (t) => {
          t.appendChild(el('div', 'k', d3.utcFormat('%b %Y')(p.d)));
          if (p.h != null) tipRow(t, css('--fg'), +p.d === +today ? 'Today' : 'Actual (month end)', mat.fmt(p.h));
          else { tipRow(t, c, 'Middle (P50)', mat.fmt(p.b[2])); tipRow(t, c, 'Likely range (P25–P75)', `${mat.fmt(p.b[1])} – ${mat.fmt(p.b[3])}`); tipRow(t, c, 'Wide range (P10–P90)', `${mat.fmt(p.b[0])} – ${mat.fmt(p.b[4])}`); }
        });
      }).on('pointerleave', () => { rule.attr('opacity', 0); hideTip(); });
    const lg = $('#ol-legend'); lg.replaceChildren();
    const item = (cls, txt, col) => { const s2 = el('span'); const i2 = el('i', cls); if (col) i2.style.setProperty('--c', col); s2.append(i2, document.createTextNode(txt)); lg.appendChild(s2); };
    item('lg-line', 'Actual', css('--fg')); item('lg-mid', 'Middle of the range', c); item('lg-band2', 'Half of outcomes (P25–P75)', c); item('lg-band', '8 in 10 outcomes (P10–P90)', c); item('lg-dash', 'Other scenarios (middle)', css('--muted'));
    if (mat.note) lg.appendChild(el('span', 'note', mat.unit + ' ' + mat.note));
  }
  function olYears(tbl, X, mat, scen = OL.scen, oddsEl = $('#ol-odds')) {
    tbl.replaceChildren(); const R = X.results[scen][mat.id]; const now = X.now[mat.id];
    const th = el('thead'); const hr = el('tr'); ['Period', 'Middle (P50)', '8 in 10 range (P10–P90)', 'Middle vs today'].forEach((t) => hr.appendChild(el('th', null, t))); th.appendChild(hr); tbl.appendChild(th);
    const tb = el('tbody'); const pctf = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) + '%';
    const nowRow = el('tr', 'now'); nowRow.append(el('td', null, `Today (${d3.utcFormat('%-d %b')(parse(X.asof))})`), el('td', 'num', mat.fmt(now) + mat.unit), el('td'), el('td')); tb.appendChild(nowRow);
    Object.entries(R.years).forEach(([yr, v]) => {
      if (+yr === parse(X.asof).getUTCFullYear()) return;
      const md = el('td', 'num b', mat.fmt(v.p50)); md.appendChild(el('span', 'rng', `${mat.fmt(v.p10)} – ${mat.fmt(v.p90)}`)); const tr = el('tr'); tr.append(el('td', null, v.months >= 12 ? `${yr} average` : `${yr} average (${v.months} months)`), md, el('td', 'num', `${mat.fmt(v.p10)} – ${mat.fmt(v.p90)}`), el('td', 'num ' + (v.p50 > now * 1.005 ? 'is-up' : v.p50 < now * 0.995 ? 'is-down' : ''), pctf(v.p50 / now - 1))); tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    const ul = oddsEl; ul.replaceChildren();
    [['m24', '2 years'], ['m36', '3 years']].forEach(([k, lab]) => { const r = R[k]; if (!r) return; const li = el('li'); li.append(el('b', null, `In ${lab} (${d3.utcFormat('%b %Y')(parse(r.month))}): `), document.createTextNode(`${Math.round(r.up25 * 100)}% chance of being at least 25% above today, ${Math.round(r.down25 * 100)}% chance of being at least 25% below.`)); ul.appendChild(li); });
  }
  function olRisk(tbl, X) {
    tbl.replaceChildren(); const sc = X.scenarios.find((s) => s.id === OL.scen);
    $('#ol-risk-sub').textContent = `${sc.name} scenario. Price risk = the chance (out of 10) that the price is at least 25% above today's at that point: 3.0 means a 30% chance. Supply risk is structural: how much the world depends on one country for it.`;
    const th = el('thead'); const hr = el('tr'); ['Material', 'Today', 'Middle in 2 years', 'Price risk, 2 years', 'Price risk, 3 years', 'Supply risk'].forEach((t) => hr.appendChild(el('th', null, t))); th.appendChild(hr); tbl.appendChild(th);
    const tb = el('tbody'); const RM = new Map(((D.risk || {}).materials || []).map((m) => [m.id, m]));
    OL_MATS.filter((m) => m.id !== 'inr' && m.id !== 'cell_inr' && X.results[OL.scen][m.id]).forEach((m) => {
      const r = X.results[OL.scen][m.id]; const tr = el('tr', m.id === OL.mat ? 'sel' : null); tr.tabIndex = 0;
      const n = el('td', 'rname'); n.append(el('b', null, m.name));
      const conc = RM.get(m.id) && ((RM.get(m.id).h12 || {}).supply || {}).drivers ? RM.get(m.id).h12.supply.drivers.find((x) => x.key === 'concentration') : null;
      const sup = conc && conc.score != null ? { score: conc.score, level: conc.score < 4 ? 'Low' : conc.score < 6.5 ? 'Elevated' : 'High' } : null;
      tr.append(n, el('td', 'num', m.fmt(X.now[m.id]) + m.unit), el('td', 'num', m.fmt(r.m24.p50) + m.unit));
      [r.m24, r.m36].forEach((h) => { const td = el('td'); td.append(riskChip(h), el('span', 'rdelta', `${Math.round(h.up25 * 100)}% chance`)); tr.appendChild(td); });
      const ts = el('td'); ts.appendChild(sup ? riskChip(sup) : el('span', 'sub', '–')); tr.appendChild(ts);
      const pick = () => { OL.mat = m.id; renderOutlook(); $('#ol-chart').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); };
      tr.addEventListener('click', pick); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }
  function olMethod(box, X) {
    box.replaceChildren();
    const p = (t) => box.appendChild(el('p', null, t));
    const h = (t) => box.appendChild(el('h4', null, t));
    const link = (parent, text, url) => { const a = el('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; parent.appendChild(a); return a; };
    h('How it works');
    const ol = el('ol', 'ol-steps'); box.appendChild(ol);
    [`Each scenario sets an expected price path from today's price through published forecasts (sources below).`,
     `Around that path, ${d3.format(',')(X.sims)} possible futures are simulated month by month. The size of the monthly swings is taken from each material's real price history, and a swing fades over time instead of building up for ever. Every scenario uses the same random draws, so the differences between scenarios come only from their assumptions.`,
     `Lithium, copper and aluminium are passed through the site's own cost model to work out LFP cathode, the cost to make a 314 Ah storage cell, and the cell price (cost plus the makers' margin, which also swings). The rupee path converts it to rupees.`,
     `The ranges show where 8 in 10 (P10–P90) and half (P25–P75) of the simulated futures land. Price risk for 2 and 3 years is 10 × the chance of being at least 25% above today's price.`].forEach((t) => ol.appendChild(el('li', null, t)));
    h('What the model learned from the history');
    const C = X.calibration; const ul = el('ul'); box.appendChild(ul);
    [['lithium', 'Lithium'], ['copper', 'Copper'], ['aluminium', 'Aluminium']].forEach(([k, n]) => { const c = C[k]; if (c) ul.appendChild(el('li', null, `${n}: swings about ${c.monthly_swing_pct}% in a typical month; a swing halves in about ${Math.round(c.half_life_months)} months (${c.how}). ${c.months_of_history} months of history from ${c.from}.`)); });
    if (C.inr) ul.appendChild(el('li', null, `Rupee: weakened about ${C.inr.drift_pct_a_year}% a year on average since 2015, swinging about ${C.inr.monthly_swing_pct}% a month.`));
    if (C.margin) ul.appendChild(el('li', null, `Cell makers' margin over the modelled cost: ${C.margin.now_pct}% today, ${C.margin.average_pct}% on average across ${C.margin.readings} monthly readings since Oct 2025; assumed to drift back to that average with a 6-month half-life.`));
    if (X.calibration_note) p(X.calibration_note);
    h('Track record (back-test)');
    p('The same model was re-run from past months using only the data available then, with no forecasts (the price expected to stay where it was), to check whether the real price later landed inside the 8-in-10 range. If the ranges are honest, that should happen about 80% of the time.');
    const bt = el('ul'); box.appendChild(bt);
    (X.backtest || []).forEach((b) => {
      const parts = ['m6', 'm12', 'm24'].filter((k) => b[k]).map((k) => `${k.slice(1)} months ahead: ${b[k].inside}% inside (${b[k].tests} tests; ${b[k].above}% above, ${b[k].below}% below)`);
      const name = { copper: 'Copper', aluminium: 'Aluminium', lithium: 'Lithium' }[b.material] || b.material;
      bt.appendChild(el('li', null, `${name}: ${parts.join('; ')}.`));
    });
    p('Copper and aluminium are close to the 80% target. Lithium is not: its only test period is the 2025–26 rally, when the price nearly quadrupled in a year, which a model with no outside information cannot foresee. That is why lithium leans on the scenarios, and why its ranges are wide.');
    h('Scenario assumptions and sources');
    const A = X.anchors;
    X.scenarios.forEach((s) => {
      const d2 = el('div', 'ol-src'); box.appendChild(d2); const t = el('p'); d2.appendChild(t);
      const dot = el('i', 'ol-dot'); dot.style.background = css(OL_COL[s.id]); t.append(dot, el('b', null, s.name + ': '), document.createTextNode(s.say));
      const li = A.lithium[s.id] && A.lithium[s.id].same_as ? null : A.lithium[s.id];
      if (li) { const q = el('p', 'sub'); q.append(document.createTextNode('Lithium: ' + li.note + ' Sources: ')); (li.sources || []).forEach((sr, i) => { if (i) q.append(document.createTextNode('; ')); link(q, sr.text, sr.url); }); d2.appendChild(q); }
      if (s.id === 'base' && X.curve && X.curve.length) d2.appendChild(el('p', 'sub', `Futures prices used tonight: ${X.curve.map((c) => `${d3.utcFormat('%b %y')(parse(c.month + '-01'))} ${fmtUsd0(c.usd)}`).join(' · ')} (US$/t; thinly traded months left out).`));
      if (s.id === 'glut') d2.appendChild(el('p', 'sub', 'Note: the futures market is currently pricing 2027 lower than Goldman Sachs, so this scenario only falls below Base from 2028.'));
      if (s.id === 'curbs') { const q = el('p', 'sub'); q.append(document.createTextNode(X.curbs.note + ' Source for the licence pause: ')); (X.curbs.sources || []).forEach((sr) => link(q, sr.text, sr.url)); d2.appendChild(q); }
    });
    ['copper', 'aluminium'].forEach((k) => { const a = A[k].all; const q = el('p', 'sub'); q.append(document.createTextNode(`${k === 'copper' ? 'Copper' : 'Aluminium'}: ${a.note} Sources: `)); a.sources.forEach((sr, i) => { if (i) q.append(document.createTextNode('; ')); link(q, sr.text, sr.url); }); box.appendChild(q); });
    p(X.held_flat.note);
    const sp = el('p', 'sub'); sp.append(document.createTextNode(X.supply.note + ' Source: ')); X.supply.sources.forEach((sr) => link(sp, sr.text, sr.url)); box.appendChild(sp);
    p('Prices are in US$ on the same basis as the rest of the site. This is a planning aid built from public data, not investment or procurement advice.');
  }
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('#ol-jump'); if (!a) return; e.preventDefault(); const o = $('#outlook'); if (o) o.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); });
  function drawRiskMap(box, mats) {
    box.replaceChildren();
    const pts = mats.map((m) => ({ m, x: m[RISK.h].price.score, y: m[RISK.h].supply.score })).filter((p) => p.x != null && p.y != null);
    const miss = mats.filter((m) => m[RISK.h].price.score == null).map((m) => m.short);
    $('#risk-map-note').textContent = miss.length ? `Not on the map yet: ${miss.join(', ')} (no price history to score price risk; supply risk is in the table).` : '';
    const W = Math.max(300, box.clientWidth || 520), H = Math.min(400, Math.max(280, W * 0.72));
    const mg = { t: 14, r: 16, b: 40, l: 44 };
    const x = d3.scaleLinear().domain([0, 10]).range([mg.l, W - mg.r]), y = d3.scaleLinear().domain([0, 10]).range([H - mg.b, mg.t]);
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('role', 'img').attr('aria-label', 'Risk map: price risk across, supply risk up');
    // zones: tint by the higher of the two scores
    const zones = [[0, 4, '--ok'], [4, 6.5, '--warn'], [6.5, 10, '--bad']];
    [...zones].reverse().forEach(([, hi, c]) => {
      const r = () => svg.append('rect').attr('x', x(0)).attr('y', y(hi)).attr('width', x(hi) - x(0)).attr('height', y(0) - y(hi));
      r().attr('fill', css('--panel')); r().attr('fill', css(c)).attr('opacity', 0.08);
    });
    [4, 6.5].forEach((v) => {
      svg.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', y(0)).attr('y2', y(10)).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 4');
      svg.append('line').attr('x1', x(0)).attr('x2', x(10)).attr('y1', y(v)).attr('y2', y(v)).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 4');
    });
    svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8)).call(axisStyle);
    svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).call(axisStyle);
    svg.append('text').attr('x', W - mg.r).attr('y', H - 6).attr('text-anchor', 'end').attr('fill', css('--muted')).attr('font-size', 12).text('Price risk →');
    svg.append('text').attr('transform', `translate(12,${mg.t}) rotate(-90)`).attr('text-anchor', 'end').attr('fill', css('--muted')).attr('font-size', 12).text('Supply risk →');
    svg.append('text').attr('x', x(10) - 6).attr('y', y(10) + 16).attr('text-anchor', 'end').attr('fill', css('--bad')).attr('font-size', 11.5).attr('font-weight', 700).text('High on both');
    // nudge labels that would overlap
    const placed = [];
    pts.sort((a, b) => b.y - a.y).forEach((p) => {
      let ly = y(p.y) + 4; const lx = x(p.x) + 11;
      placed.forEach((q) => { if (Math.abs(q.x - lx) < 90 && Math.abs(q.y - ly) < 14) ly = q.y + 14; });
      placed.push({ x: lx, y: ly }); p.ly = ly;
    });
    const lvlOf = (p) => (Math.max(p.x, p.y) >= 6.5 ? 'High' : Math.max(p.x, p.y) >= 4 ? 'Elevated' : 'Low');
    // a week ago: faint ring and trail; on first view each dot travels from there to today
    const cl = (v) => Math.max(0, Math.min(10, v));
    const move = !reduced() && !MOTION.risk.has(RISK.h); MOTION.risk.add(RISK.h);
    const trails = svg.append('g').attr('class', 'rtrails');
    let anyTrail = false;
    pts.forEach((p) => {
      const r = p.m[RISK.h]; p.x0 = cl(p.x - ((r.price && r.price.change) || 0)); p.y0 = cl(p.y - ((r.supply && r.supply.change) || 0));
      if (Math.abs(p.x0 - p.x) + Math.abs(p.y0 - p.y) < 0.1) return;
      anyTrail = true;
      trails.append('circle').attr('cx', x(p.x0)).attr('cy', y(p.y0)).attr('r', 4.5).attr('fill', 'none').attr('stroke', css('--muted')).attr('stroke-width', 1.2).attr('opacity', 0.55);
      const ln = trails.append('line').attr('x1', x(p.x0)).attr('y1', y(p.y0)).attr('x2', x(p.x0)).attr('y2', y(p.y0)).attr('stroke', css('--muted')).attr('stroke-width', 1.2).attr('stroke-dasharray', '2 3').attr('opacity', 0.7);
      if (move) ln.transition().duration(900).delay(250).ease(d3.easeCubicOut).attr('x2', x(p.x)).attr('y2', y(p.y)); else ln.attr('x2', x(p.x)).attr('y2', y(p.y));
    });
    $('#risk-map-note').textContent = ($('#risk-map-note').textContent ? $('#risk-map-note').textContent + ' ' : '') + (anyTrail ? 'Faint rings show where each item stood a week ago.' : '');
    const g = svg.append('g');
    pts.forEach((p, i) => {
      const sel = p.m.id === RISK.sel;
      const a = g.append('g').attr('class', 'rpt').attr('tabindex', 0).attr('role', 'button').attr('aria-label', `${p.m.name}: price risk ${p.x}, supply risk ${p.y}`).style('cursor', 'pointer');
      const dot = a.append('circle').attr('cx', x(move ? p.x0 : p.x)).attr('cy', y(move ? p.y0 : p.y)).attr('r', sel ? 9 : 7).attr('fill', lvlColor(lvlOf(p))).attr('stroke', sel ? css('--fg') : css('--panel')).attr('stroke-width', sel ? 2.5 : 2);
      if (move) dot.transition().duration(900).delay(250 + i * 40).ease(d3.easeCubicOut).attr('cx', x(p.x)).attr('cy', y(p.y));
      const lab = a.append('text').attr('x', x(p.x) > W - 110 ? x(p.x) - 11 : x(p.x) + 11).attr('text-anchor', x(p.x) > W - 110 ? 'end' : 'start').attr('y', p.ly).attr('font-size', 12.5).attr('font-weight', sel ? 700 : 600).attr('fill', css('--fg')).text(p.m.short);
      if (move) lab.attr('opacity', 0).transition().duration(400).delay(1000 + i * 40).attr('opacity', 1);
      const pick = () => { RISK.sel = p.m.id; renderRisk(); };
      a.on('click', pick).on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } })
        .on('mousemove', (ev) => showTip(ev, (t) => { t.appendChild(el('div', 'h', p.m.name)); tipRow(t, null, 'Price risk', `${scoreTxt(p.x)} ${p.m[RISK.h].price.level}`); tipRow(t, null, 'Supply risk', `${scoreTxt(p.y)} ${p.m[RISK.h].supply.level}`); }))
        .on('mouseleave', hideTip);
    });
  }
  function driverList(all) {
    const wrap = el('div');
    const ul = el('ul', 'drivers'); wrap.appendChild(ul);
    const drivers = all.filter((d) => d.score != null && d.weight);
    const off = all.filter((d) => !(d.score != null && d.weight));
    if (off.length) wrap.appendChild(el('p', 'doff', 'Not used here: ' + off.map((d) => `${d.label.toLowerCase()} (${(d.detail || '').replace(/\.$/, '').toLowerCase()})`).join('; ') + '.'));
    drivers.forEach((d) => {
      const li = el('li', d.score == null || !d.weight ? 'off' : null);
      const top = el('div', 'dtop');
      const dl = el('span', 'dl', d.label);
      if (d.assumed) { const t = el('span', 'atag', 'Assumption'); t.title = 'Not measured directly; see the assumptions for this material'; dl.appendChild(t); }
      top.append(dl, el('span', 'dw', d.score == null || !d.weight ? 'not used' : `${d.weight}% of score`));
      const bar = el('div', 'dbar'); const fill = el('i'); fill.style.width = `${(d.score || 0) * 10}%`;
      fill.style.background = lvlColor(d.score == null ? null : d.score >= 6.5 ? 'High' : d.score >= 4 ? 'Elevated' : 'Low');
      bar.appendChild(fill);
      const val = el('b', 'dv', scoreTxt(d.score));
      const row = el('div', 'drow'); row.append(bar, val);
      const det = el('div', 'dd'); det.appendChild(document.createTextNode(d.detail || ''));
      if (d.url) { det.appendChild(document.createTextNode(' · ')); det.appendChild(link('source', d.url)); }
      li.append(top, row, det);
      if (d.items && d.items.length) {
        const il = el('ul', 'ditems');
        d.items.slice(0, 6).forEach((it) => {
          const x = el('li'); x.appendChild(el('span', 'ds ' + (it.s > 0 ? 'up' : 'down'), it.s > 0 ? `+${it.s}` : String(it.s)));
          x.appendChild(el('span', 'dday', d3.utcFormat('%-d %b')(parse(it.date))));
          x.appendChild(it.url ? link(it.text, it.url) : el('span', null, it.text));
          il.appendChild(x);
        });
        li.appendChild(il);
      }
      ul.appendChild(li);
    });
    return wrap;
  }
  function renderRiskDetail(box, m, R) {
    box.replaceChildren(); if (!m) return;
    const r = m[RISK.h];
    const head = el('div', 'rd-head');
    const t = el('div'); t.append(el('div', 'rd-group', m.group), el('h2', 'rd-name', m.name));
    if (m.now) {
      const p = el('div', 'rd-now');
      const unit = m.unit || '';
      p.append(el('b', null, (m.now.value >= 100 ? fmtUsd0(m.now.value) : fmtUsd1(m.now.value)) + unit), document.createTextNode(` · ${d3.utcFormat('%-d %b %Y')(parse(m.now.date))} · `));
      p.appendChild(m.now.url ? link(m.now.source, m.now.url) : document.createTextNode(m.now.source));
      t.appendChild(p);
    }
    const sc = el('div', 'rd-scores');
    [['Price risk', r.price], ['Supply risk', r.supply]].forEach(([lab, ax]) => { const b = el('div', 'rd-score'); b.append(el('span', null, lab), riskChip(ax), riskDelta(ax)); sc.appendChild(b); });
    head.append(t, sc); box.appendChild(head);

    const cols = el('div', 'rd-cols');
    const pc = el('div', 'rd-col'); pc.append(el('h3', null, 'What drives the price score'), r.price.score == null ? el('p', 'sub', 'Not scored: there is no price history for this material yet. It builds up each day from the prices on this site.') : driverList(r.price.drivers));
    const scol = el('div', 'rd-col'); scol.append(el('h3', null, 'What drives the supply score'), driverList(r.supply.drivers));
    cols.append(pc, scol); box.appendChild(cols);

    if (m.assumptions && m.assumptions.length) {
      const ab = el('div', 'rd-assume'); ab.appendChild(el('h3', null, 'Data and assumptions for this material'));
      const ul = el('ul'); m.assumptions.forEach((x) => ul.appendChild(el('li', null, x))); ab.appendChild(ul); box.appendChild(ab);
    }
    // trend of the 3-month scores
    const tr = (m.trend || []).filter((x) => x[1] != null || x[2] != null);
    if (tr.length >= 2) {
      const tw = el('div', 'rd-trend'); tw.appendChild(el('h3', null, 'Score history (next-3-months view)'));
      const c = el('div', 'chart'); tw.appendChild(c); box.appendChild(tw);
      const W = Math.max(300, c.clientWidth || box.clientWidth - 40 || 600), H = 170, mg = { t: 10, r: 14, b: 24, l: 30 };
      const xs = d3.scaleUtc().domain(d3.extent(tr, (x) => parse(x[0]))).range([mg.l, W - mg.r]), ys = d3.scaleLinear().domain([0, 10]).range([H - mg.b, mg.t]);
      const svg = d3.select(c).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%');
      [4, 6.5].forEach((v) => svg.append('line').attr('x1', mg.l).attr('x2', W - mg.r).attr('y1', ys(v)).attr('y2', ys(v)).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 4'));
      svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(xs).ticks(Math.max(2, Math.min(tr.length, Math.floor(W / 85)))).tickFormat(d3.utcFormat('%-d %b')).tickSize(0).tickPadding(6)).call(axisStyle);
      svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(ys).tickValues([0, 4, 6.5, 10]).tickFormat(d3.format('~g')).tickSize(0).tickPadding(6)).call(axisStyle);
      [[1, '--accent', 'Price'], [2, '--plum', 'Supply']].forEach(([i, col, name]) => {
        const pts = tr.filter((x) => x[i] != null);
        if (pts.length < 2) return;
        svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css(col)).attr('stroke-width', 2.2).attr('d', d3.line().x((x) => xs(parse(x[0]))).y((x) => ys(x[i])));
        const lp = pts[pts.length - 1];
        svg.append('circle').attr('cx', xs(parse(lp[0]))).attr('cy', ys(lp[i])).attr('r', 3.5).attr('fill', css(col));
      });
      const lg = el('div', 'rd-tlegend'); [['--accent', 'Price risk'], ['--plum', 'Supply risk']].forEach(([cc, n]) => { const s = el('span'); const i = el('i'); i.style.background = css(cc); s.append(i, document.createTextNode(n)); lg.appendChild(s); });
      lg.appendChild(el('span', 'note', 'Scores before 27 Oct 2026 are rebuilt from the prices known at the time.'));
      tw.appendChild(lg);
    }
    // action
    const act = el('div', 'rd-action'); act.appendChild(el('h3', null, 'Typical responses at this level'));
    const ag = el('div', 'rd-acts');
    [['Price', r.price], ['Supply', r.supply]].forEach(([lab, ax]) => {
      if (!ax || !ax.level) return;
      const card = el('div', 'ract lv-' + ax.level.toLowerCase()); card.appendChild(el('div', 'ract-h', `${lab} risk: ${ax.level}`));
      const ul = el('ul'); ((R.playbook[lab.toLowerCase()] || {})[ax.level] || []).forEach((x) => ul.appendChild(el('li', null, x))); card.appendChild(ul); ag.appendChild(card);
    });
    act.append(ag, el('p', 'sub', 'General buying practice, not a recommendation. Check the drivers above and the latest news before acting.'));
    box.appendChild(act);
  }
  function renderRiskIndia(box, I) {
    box.replaceChildren();
    const fx = I.fx;
    const card = (title, cls) => { const c = el('div', 'icard ' + (cls || '')); c.appendChild(el('h3', null, title)); box.appendChild(c); return c; };
    if (fx) {
      const c = card('Rupee against the US dollar', 'ifx');
      const big = el('div', 'ifx-now'); big.append(el('b', null, `₹${fx.usd_inr.toFixed(2)}`), el('span', null, ` per US$ · ${d3.utcFormat('%-d %b %Y')(parse(fx.date))}`)); c.appendChild(big);
      const ch = el('div', 'ifx-ch');
      [['1 month', fx.m1], ['3 months', fx.m3], ['1 year', fx.y1]].forEach(([lab, v]) => {
        if (v == null) return;
        const s = el('span', v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : null); s.append(el('em', null, lab), document.createTextNode(` ${v > 0 ? 'rupee weaker' : 'rupee stronger'} ${Math.abs(v * 100).toFixed(1)}%`)); ch.appendChild(s);
      });
      c.appendChild(ch);
      const pts = (fx.series || []).map(([dd, v]) => ({ d: parse(dd), v }));
      if (pts.length > 5) {
        const holder = el('div', 'chart'); c.appendChild(holder);
        const W = 380, H = 130, mg = { t: 8, r: 8, b: 20, l: 34 };
        const xs = d3.scaleUtc().domain(d3.extent(pts, (p) => p.d)).range([mg.l, W - mg.r]);
        const ys = d3.scaleLinear().domain(d3.extent(pts, (p) => p.v)).nice().range([H - mg.b, mg.t]);
        const svg = d3.select(holder).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%');
        svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(xs).ticks(Math.max(2, Math.floor(W / 90))).tickFormat(d3.utcFormat('%b %y')).tickSize(0).tickPadding(6)).call(axisStyle);
        svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(ys).ticks(3).tickSize(0).tickPadding(6)).call(axisStyle);
        svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', css('--orange')).attr('stroke-width', 2).attr('d', d3.line().x((p) => xs(p.d)).y((p) => ys(p.v)));
      }
      const n = el('p', 'sub'); n.append(document.createTextNode('A weaker rupee raises the rupee cost of every imported material; it is one driver in each price score. Source: '), link(fx.source, fx.url)); c.appendChild(n);
    }
    const list = (title, items, cls) => {
      if (!items || !items.length) return;
      const c = card(title, cls); const ul = el('ul', 'ilist');
      items.forEach((it) => { const li = el('li'); li.appendChild(document.createTextNode(it.text + ' ')); const s = el('span', 'isrc'); s.appendChild(link(it.source, it.url)); li.appendChild(s); ul.appendChild(li); });
      c.appendChild(ul);
    };
    list('Import duties', I.duties);
    list('Cell making in India', I.capacity);
  }
  function renderRiskMethod(box, R) {
    if (box.childElementCount) return;
    const p = (html) => { const e = el('p'); e.innerHTML = html; return e; };
    box.append(
      p('<b>What the scores mean.</b> Each tracked material gets two scores from 0 to 10, seen from a buyer\'s side. <b>Price risk</b> is the risk that prices rise or swing hard. <b>Supply risk</b> is the risk of not getting material on time or on normal terms. 0–3.9 is Low, 4–6.4 Elevated, 6.5–10 High.'),
      p('<b>How they are built.</b> Each score is a weighted average of a few driver scores, and every driver is shown with its weight and the evidence behind it. Drivers with no data are left out and the weights shared among the rest; drivers that rest on an assumption are tagged so.'),
    );
    const tbl = el('table', 'rtable mtable');
    const rows = [
      ['Recent price trend', 'Price', 'Change over 1 and 3 months: −20% scores 0, flat 5, +20% 10'],
      ['How much the price swings', 'Price', 'Yearly volatility over the last 6 months: 5% scores 0, 60% or more 10'],
      ['What forecasters expect', 'Price', 'Average of tracked bank and broker forecasts vs today: −30% scores 0, +30% 10 (lithium only for now)'],
      ['Room above the cost to make', 'Price', 'Cell price vs the site\'s cost model: margin of 30% or more scores 0, no margin 10 (cells only)'],
      ['Lithium price risk passed through', 'Price', 'The lithium price score, for materials whose cost depends on lithium (cathode, cells)'],
      ['Price news / known cost changes ahead', 'Price', 'Stories and dated changes tagged with their likely effect (−3 to +3). News fades with a 3-week half-life; dated changes count more as they get closer'],
      ['Dependence on one country', 'Supply', 'China\'s share of world supply from the IEA (aluminium: IAI) divided by 10, less 3 where India has large production of its own'],
      ['Supply news', 'Supply', 'Disruptions and new capacity tagged −3 to +3, fading with a 1-month half-life; with no news the driver sits at 2'],
      ['Rule changes and deadlines ahead', 'Supply', 'Export controls, bans and other dated changes within the horizon, counting more as they get closer'],
    ];
    const th = el('thead'); const hr = el('tr'); ['Driver', 'Score', 'How it is measured'].forEach((x) => hr.appendChild(el('th', null, x))); th.appendChild(hr); tbl.appendChild(th);
    const tb = el('tbody'); rows.forEach((r) => { const tr = el('tr'); r.forEach((c) => tr.appendChild(el('td', null, c))); tb.appendChild(tr); }); tbl.appendChild(tb);
    const wrap = el('div', 'table-wrap'); wrap.appendChild(tbl); box.appendChild(wrap);
    const wt = (h) => Object.entries(R.weights[h]).map(([ax, w]) => `${ax === 'price' ? 'Price' : 'Supply'}: ` + Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')).join('. ');
    box.append(p(`<b>Weights.</b> Next 3 months — ${wt('h3')}. Next 12 months — ${wt('h12')}. The 12-month view leans more on forecasts, the cost floor, dated changes and structural dependence, and less on the latest moves.`));
    const bt = (R.backtest || []);
    if (bt.length) {
      box.append(p('<b>Back-test.</b> Only the price trend and price swings can be rebuilt for past dates (news tags, forecasts and the cost model were not kept back then), so the test uses those two drivers. Every two weeks a score was worked out from the prices known on that day; the table compares what happened over the next 3 months after the highest third of scores and after the lowest third. Windows overlap, so the real number of independent cases is smaller than shown.'));
      const t = el('table', 'rtable mtable bt');
      const hr = el('tr'); ['Material and period', 'Scores', 'Rose >5%', 'Fell >5%', 'Moved >10% either way', 'Average change'].forEach((x) => hr.appendChild(el('th', null, x)));
      const th = el('thead'); th.appendChild(hr); t.appendChild(th);
      const tb = el('tbody');
      bt.forEach((b) => {
        [['Highest third', b.high, `≥ ${b.cut_high}`], ['Lowest third', b.low, `≤ ${b.cut_low}`]].forEach(([lab, st, cut], i) => {
          const tr = el('tr', i ? 'bt-lo' : 'bt-hi');
          if (!i) { const td = el('td', 'btname'); td.rowSpan = 2; td.append(el('b', null, b.name), el('span', null, `${b.from.slice(0, 7)} to ${b.to.slice(0, 7)} · ${b.samples} dates`)); tr.appendChild(td); }
          tr.append(el('td', null, `${lab} (${cut})`), el('td', null, `${st.rise5}%`), el('td', null, `${st.fall5}%`), el('td', null, `${st.big10}%`), el('td', null, `${st.avg > 0 ? '+' : ''}${st.avg}%`));
          tb.appendChild(tr);
        });
      });
      t.appendChild(tb); const w = el('div', 'table-wrap'); w.appendChild(t); box.appendChild(w);
      const verdict = bt.map((b) => {
        const lift = b.high.rise5 - b.low.rise5, swing = b.high.big10 - b.low.big10;
        return `<b>${b.name}:</b> ` + (lift >= 10 ? `after high scores, rises of more than 5% were ${b.high.rise5}% likely against ${b.low.rise5}% after low scores, so the score has worked as an early warning.` : swing >= 10 ? `high scores were followed by bigger moves, but not more often by rises; treat the score as a warning of swings.` : `high scores have not been followed by more rises (${b.high.rise5}% vs ${b.low.rise5}%) and prices more often fell (${b.high.fall5}% vs ${b.low.fall5}%), so read its price score as a sign of possible swings, not of rising prices.`);
      });
      box.append(p(verdict.join(' ')));
    } else {
      box.append(p('<b>Back-test.</b> Not enough price history yet.'));
    }
    box.append(p('<b>Data sources.</b> Lithium: Guangzhou Futures Exchange lithium carbonate main contract, daily close since July 2023 (via Sina Finance), in US$ at each day\'s ECB rate. Copper and aluminium: LME cash settlement, daily since 2018 (via Westmetall). Exchange rates: ECB euro reference rates. Storage cells: InfoLink weekly. EV cells: TrendForce. Cathode, separator, electrolyte, graphite: SMM and TrendForce as listed on the Raw materials page. China\'s shares: IEA Global Critical Minerals Outlook 2025 and the International Aluminium Institute. All refreshed automatically each morning.'));
    box.append(p('<b>Limits.</b> Built only from public prices and news, not from deals reported by buyers and sellers, so it complements rather than replaces paid services such as CRU, Fastmarkets or Benchmark. News tags are a judgement made when each story is added. Use the drivers and links to check before acting.'));
  }

  // ---------- landed cost in India ----------
  const LAND = { ready: false };
  function landInit() {
    if (LAND.ready) return; const L = D.landed || {}; const fx = ((D.risk || {}).india || {}).fx || {};
    Object.assign(LAND, { ready: true, freightC: L.freight_usd_kwh ? L.freight_usd_kwh.cells : 1, freightB: L.freight_usd_kwh ? L.freight_usd_kwh.bess : 1,
      ins: L.insurance_pct_of_fob ?? 1.125, bcdC: (L.bcd_pct || {}).cells ?? 20, bcdB: (L.bcd_pct || {}).bess ?? 10, sws: L.sws_pct_of_bcd ?? 10, igst: L.igst_pct ?? 18,
      fx: fx.usd_inr ? +fx.usd_inr.toFixed(2) : 95, fxDate: fx.date, fxM3: fx.m3, rebate: L.export_rebate_pct ?? 6, after: false });
  }
  function landItems() {
    const w = weekly(); const last = w[w.length - 1] || {};
    const ev = [...((D.evcells || {}).series || [])].sort((a, b) => d3.ascending(a.date, b.date)).pop() || {};
    return [
      { id: 'cell314', name: '314 Ah storage cell', usd: +last.cell314, date: last.date, src: 'InfoLink', url: last.url, cls: 'C' },
      { id: 'evcell', name: 'EV cell (230 / 324 Ah)', usd: +ev.usd_kwh, date: ev.date, src: ev.source, url: ev.url, cls: 'C', flag: 'duty unconfirmed' },
      { id: 'dc2h', name: '2-hour DC block', usd: +last.dc_2h, date: last.date, src: 'InfoLink', url: last.url, cls: 'B' },
      { id: 'ac4h', name: '4-hour AC system', usd: +last.ac_4h, date: last.date, src: 'InfoLink', url: last.url, cls: 'B' },
    ].filter((r) => r.usd > 0);
  }
  function landCalc(usd, cls, after, fx) {
    const fob = usd * (after ? 1 + LAND.rebate / 100 : 1);
    const freight = cls === 'C' ? LAND.freightC : LAND.freightB, ins = fob * LAND.ins / 100;
    const av = fob + freight + ins, bcd = av * (cls === 'C' ? LAND.bcdC : LAND.bcdB) / 100, sws = bcd * LAND.sws / 100;
    const landed = av + bcd + sws, igst = landed * LAND.igst / 100;
    return { fob, freight, ins, av, bcd, sws, duty: bcd + sws, landed, igst, inr: landed * (fx || LAND.fx) };
  }
  const inr = (v) => '₹' + d3.format(',.0f')(v);
  function renderLandedOverview(box) {
    if (!box) return;
    try {
      landInit(); box.replaceChildren();
      const t = el('table', 'rtable landed-mini');
      const hr = el('tr'); ['', 'China price', 'Landed', 'Per kWh in ₹', 'From 1 Jan*'].forEach((x) => hr.appendChild(el('th', null, x)));
      const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
      landItems().forEach((it) => {
        const a = landCalc(it.usd, it.cls, false), b = landCalc(it.usd, it.cls, true);
        const tr = el('tr'); const n = el('td'); n.appendChild(el('b', null, it.name)); if (it.flag) n.appendChild(el('span', 'lflag', ' †'));
        tr.append(n, el('td', 'num', fmtUsd1(it.usd)), el('td', 'num', fmtUsd1(a.landed)), el('td', 'num strong', inr(a.inr)), el('td', 'num up', inr(b.inr)));
        tb.appendChild(tr);
      });
      t.appendChild(tb); const wrap = el('div', 'table-wrap'); wrap.appendChild(t); box.appendChild(wrap);
      box.appendChild(el('p', 'sub', `US$/kWh excluding VAT and IGST (reclaimable). US$1 = ₹${LAND.fx.toFixed(2)} (ECB${LAND.fxDate ? ', ' + d3.utcFormat('%-d %b')(parse(LAND.fxDate)) : ''}). Freight about $${LAND.freightC}/kWh, duty ${LAND.bcdC}% on cells and ${LAND.bcdB}% on storage systems plus surcharge. *If China's 6% export rebate end is passed on in full. † Duty for cells used in EV packs unconfirmed; 20% used.`));
    } catch (e) { console.error(e); fail(box); }
  }
  function renderLanded() {
    const inBox = $('#landed-in'); if (!inBox) return;
    landInit();
    if (!inBox.childElementCount) {
      const L = D.landed || {};
      const field = (k, label, step, unit, hint) => {
        const w = el('label', 'lfield'); w.appendChild(el('span', 'lk', label));
        const i = el('input', 'num-in'); i.type = 'number'; i.step = step; i.min = 0; i.value = LAND[k];
        i.addEventListener('input', () => { const v = parseFloat(i.value); if (!isNaN(v)) { LAND[k] = v; renderLanded(); renderLandedOverview(); } });
        const row = el('span', 'lrow'); row.append(i, el('span', 'lu', unit)); w.appendChild(row);
        if (hint) w.appendChild(el('span', 'lh', hint)); return w;
      };
      inBox.append(
        field('freightC', 'Freight, cells', '0.1', '$/kWh', 'Sea freight China–India'),
        field('freightB', 'Freight, storage systems', '0.1', '$/kWh', 'Heavy containers may cost more'),
        field('ins', 'Insurance', '0.125', '% of price', 'Customs default 1.125%'),
        field('bcdC', 'Duty on cells', '1', '%', 'Standard rate 20%'),
        field('bcdB', 'Duty on storage systems', '1', '%', 'Concessional 10%'),
        field('fx', 'Rupees per US$', '0.01', '₹', 'ECB rate today'),
      );
      const tg = el('label', 'ltoggle'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = LAND.after;
      cb.addEventListener('change', () => { LAND.after = cb.checked; renderLanded(); });
      tg.append(cb, document.createTextNode(" Show prices after China ends its 6% export rebate (1 Jan 2027)")); inBox.appendChild(tg);
      const rs = el('button', 'btn ghost small', 'Back to defaults'); rs.type = 'button';
      rs.addEventListener('click', () => { LAND.ready = false; inBox.replaceChildren(); landInit(); renderLanded(); renderLandedOverview(); });
      inBox.appendChild(rs);
    }
    const tbl = $('#landed-table'); tbl.replaceChildren();
    const hr = el('tr'); ['Item', 'China price', 'Freight + insurance', 'Duty + surcharge', 'Landed, US$/kWh', 'Landed, ₹/kWh', 'IGST (reclaimable)'].forEach((x) => hr.appendChild(el('th', null, x)));
    const th = el('thead'); th.appendChild(hr); tbl.appendChild(th); const tb = el('tbody');
    const bars = $('#landed-bars'); bars.replaceChildren();
    const items = landItems(); const maxL = d3.max(items, (it) => landCalc(it.usd, it.cls, LAND.after).landed) || 1;
    items.forEach((it) => {
      const a = landCalc(it.usd, it.cls, LAND.after);
      const tr = el('tr'); const n = el('td'); n.appendChild(el('b', null, it.name)); n.appendChild(el('span', 'role', `${it.src}, ${d3.utcFormat('%-d %b')(parse(it.date))}${it.flag ? ' · ' + it.flag : ''}`));
      tr.append(n, el('td', 'num', fmtUsd1(a.fob)), el('td', 'num', fmtUsd1(a.freight + a.ins)), el('td', 'num', fmtUsd1(a.duty)), el('td', 'num strong', fmtUsd1(a.landed)), el('td', 'num strong', inr(a.inr)), el('td', 'num muted', fmtUsd1(a.igst)));
      tb.appendChild(tr);
      const row = el('div', 'lbar'); row.appendChild(el('span', 'lbn', it.name));
      const bar = el('div', 'stackbar'); bar.style.width = (a.landed / maxL * 100) + '%';
      stackBar(bar, [{ label: LAND.after ? 'China price (+6%)' : 'China price', color: '--blue', v: a.fob }, { label: 'Freight + insurance', color: '--teal', v: a.freight + a.ins }, { label: 'Duty + surcharge', color: '--orange', v: a.duty }], a.landed);
      row.append(bar, el('b', 'lbv', fmtUsd1(a.landed))); bars.appendChild(row);
    });
    tbl.appendChild(tb);
    const lg = el('div', 'tlegend'); [['--blue', 'China price'], ['--teal', 'Freight + insurance'], ['--orange', 'Duty + surcharge']].forEach(([c, t]) => { const s = el('span'); const i = el('i', 'dt'); i.style.background = css(c); i.style.borderRadius = '3px'; s.append(i, document.createTextNode(t)); lg.appendChild(s); });
    bars.appendChild(lg);
    // notes
    const L = D.landed || {}; const nb = $('#landed-notes'); nb.replaceChildren();
    const cell = items.find((i) => i.id === 'cell314');
    if (cell && LAND.fxM3 != null) {
      const now = landCalc(cell.usd, 'C', LAND.after), was = landCalc(cell.usd, 'C', LAND.after, LAND.fx / (1 + LAND.fxM3));
      nb.appendChild(el('p', 'lnote strong', `Rupee effect: over the last 3 months the rupee ${LAND.fxM3 > 0 ? 'weakened' : 'strengthened'} ${Math.abs(LAND.fxM3 * 100).toFixed(1)}% against the dollar, which ${LAND.fxM3 > 0 ? 'added' : 'saved'} about ${inr(Math.abs(now.inr - was.inr))} per kWh on a 314 Ah cell at today's dollar price.`));
    }
    const note = (txt, src, url) => { const p = el('p', 'lnote'); p.appendChild(document.createTextNode(txt + ' ')); if (url) p.appendChild(link(src, url)); nb.appendChild(p); };
    note(L.fob_note || '', null, null);
    note((L.freight_usd_kwh || {}).note || '', (L.freight_usd_kwh || {}).source, (L.freight_usd_kwh || {}).url);
    note(`${L.insurance_note || ''} ${L.duty_note || ''}`, L.duty_source, L.duty_url);
    note(L.bcd_note || '', L.bcd_source, L.bcd_url);
    note(L.rebate_note || '', L.rebate_source, L.rebate_url);
  }

  // ---------- weekly brief ----------
  function briefChange(pts, end, days = 7) {
    const now = pts.filter((p) => p.d <= end).pop(); if (!now) return null;
    const ref = new Date(+now.d - (days - 1) * 864e5); // a week before the latest reading (weekly series move on Wednesdays)
    const past = pts.filter((p) => p.d <= ref).pop();
    if (!past || (ref - past.d) / 864e5 > 21) return { now, past: null, pct: null };
    return { now, past, pct: now.v / past.v - 1 };
  }
  function renderBrief() {
    const body = $('#brief-body'); if (!body) return; body.replaceChildren();
    const m = D.meta || {}; const end = parse(m.updated || new Date().toISOString().slice(0, 10)); const start = new Date(+end - 7 * 864e5);
    const f = d3.utcFormat('%a %-d %b %Y'), fs = d3.utcFormat('%-d %b');
    $('#brief-title').textContent = `Week to ${f(end)}`;
    $('#brief-sub').textContent = m.note || '';
    $('#brief-print').onclick = () => window.print();
    const sec = (title, cls) => { const s = el('section', 'bsec ' + (cls || '')); s.appendChild(el('h3', null, title)); body.appendChild(s); return s; };
    // 1. prices
    const w = weekly().map((r) => ({ ...r, d: parse(r.date) }));
    const ser = (k) => w.filter((r) => r[k] != null).map((r) => ({ d: r.d, v: +r[k] }));
    const ev = ((D.evcells || {}).series || []).map((r) => ({ d: parse(r.date), v: +r.usd_kwh })).sort((a, b) => a.d - b.d);
    const spot = (D.lithium || []).filter((r) => r.series === 'Spot').map((r) => ({ d: parse(r.date), v: +r.usd_t })).sort((a, b) => a.d - b.d);
    const fx = ((((D.risk || {}).india || {}).fx || {}).series || []).map(([d, v]) => ({ d: parse(d), v: +v }));
    const rows = [
      ['Lithium carbonate futures', futPts(), (v) => fmtUsd0(v) + '/t'], ['Lithium carbonate, China spot', spot, (v) => fmtUsd0(v) + '/t'],
      ['314 Ah storage cell', ser('cell314'), (v) => fmtUsd1(v) + '/kWh'], ['EV cell (230 / 324 Ah)', ev, (v) => fmtUsd1(v) + '/kWh'],
      ['2-hour DC block', ser('dc_2h'), (v) => fmtUsd1(v) + '/kWh'], ['4-hour AC system', ser('ac_4h'), (v) => fmtUsd1(v) + '/kWh'],
      ['Rupee per US$', fx, (v) => '₹' + v.toFixed(2)],
    ];
    const s1 = sec('Prices this week'); const t = el('table', 'rtable btable');
    const hr = el('tr'); ['', 'Latest', 'A week earlier', 'Change'].forEach((x) => hr.appendChild(el('th', null, x))); const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody');
    rows.forEach(([name, pts, fmt]) => {
      const c = briefChange(pts, end); if (!c) return;
      const tr = el('tr'); tr.append(el('td', null, name));
      tr.append(el('td', 'num', `${fmt(c.now.v)} · ${fs(c.now.d)}`), el('td', 'num muted', c.past ? fmt(c.past.v) : '–'));
      const ch = c.pct == null ? 'no comparable reading' : Math.abs(c.pct) < 0.0005 ? 'flat' : `${c.pct > 0 ? '▲' : '▼'} ${Math.abs(c.pct * 100).toFixed(1)}%`;
      tr.appendChild(el('td', 'num ' + (c.pct > 0.0005 ? 'up' : c.pct < -0.0005 ? 'down' : 'muted'), ch)); tb.appendChild(tr);
    });
    t.appendChild(tb); const tw = el('div', 'table-wrap'); tw.appendChild(t); s1.appendChild(tw);
    s1.appendChild(el('p', 'sub', 'US$ excluding VAT for China cell and system prices. ▲ means dearer for a buyer (for the rupee: weaker rupee). Each change compares the latest reading with the one about a week before it.'));
    // 2. risk
    const R = D.risk; const s2 = sec('Risk Navigator (next 3 months)');
    if (R && R.materials) {
      const ul = el('ul', 'blist');
      const moves = [];
      R.materials.forEach((mm) => ['price', 'supply'].forEach((ax) => { const a = mm.h3[ax]; if (a && a.score != null) moves.push({ mm, ax, a }); }));
      const high = moves.filter((x) => x.a.level === 'High');
      const big = moves.filter((x) => x.a.change != null && Math.abs(x.a.change) >= 0.3).sort((a, b) => Math.abs(b.a.change) - Math.abs(a.a.change)).slice(0, 5);
      high.forEach((x) => ul.appendChild(el('li', null, `High: ${x.mm.name} ${x.ax} risk ${x.a.score.toFixed(1)}/10`)));
      big.forEach((x) => ul.appendChild(el('li', null, `${x.mm.name} ${x.ax} risk ${x.a.change > 0 ? 'up' : 'down'} ${Math.abs(x.a.change).toFixed(1)} to ${x.a.score.toFixed(1)} (${x.a.level})`)));
      if (!ul.childElementCount) ul.appendChild(el('li', null, 'No material moved by more than 0.3 points, and none is High.'));
      s2.appendChild(ul);
    } else s2.appendChild(el('p', 'sub', 'Risk scores not available.'));
    // 3. rules
    const s3 = sec('Rules'); const ul3 = el('ul', 'blist');
    const regs = D.regulations || [];
    regs.filter((r) => r.changed && parse(r.changed) > start && parse(r.changed) <= end).forEach((r) => { const li = el('li'); li.append(el('b', null, 'Changed: '), document.createTextNode(`${r.title} (${r.status}; ${r.date_label}) `), link(r.source, r.url)); ul3.appendChild(li); });
    regs.filter((r) => { const d = parse(r.date); return d > end && (d - end) / 864e5 <= 60; }).sort((a, b) => d3.ascending(a.date, b.date))
      .forEach((r) => { const li = el('li'); li.append(el('b', null, `${fs(parse(r.date))}: `), document.createTextNode(`${r.short || r.title} (${r.region})`)); ul3.appendChild(li); });
    if (!ul3.childElementCount) ul3.appendChild(el('li', null, 'No rule changes this week and none due in the next 60 days.'));
    s3.appendChild(ul3);
    // 4. stories
    const s4 = sec('Top stories');
    const wk = (D.news || []).filter((n) => { const d = parse(n.date); return d > start && d <= end; });
    const pick = []; const seen = new Set();
    wk.filter((n) => n.alert).sort((a, b) => d3.descending(a.date, b.date)).forEach((n) => { if (pick.length < 6) { pick.push(n); seen.add(n.category); } });
    [...wk].sort((a, b) => d3.descending(a.date, b.date)).forEach((n) => { if (pick.length < 6 && !pick.includes(n) && !seen.has(n.category)) { pick.push(n); seen.add(n.category); } });
    const ol = el('ol', 'bnews');
    pick.forEach((n) => { const li = el('li'); const h = el('div', 'bnh'); h.append(el('span', 'bcat', n.category), document.createTextNode(` · ${n.day}`)); if (n.alert) h.appendChild(el('span', 'balert', 'Alert')); li.append(h, el('div', null, n.headline)); const s = el('div', 'bsrc'); s.appendChild(link(n.source, n.url)); li.appendChild(s); ol.appendChild(li); });
    if (!pick.length) ol.appendChild(el('li', null, 'No stories this week.'));
    s4.appendChild(ol);
    // 5. next 14 days
    const s5 = sec('Next 14 days'); const ul5 = el('ul', 'blist');
    (D.events || []).filter((e) => { const d = parse(e.date); return d > end && (d - end) / 864e5 <= 14; }).sort((a, b) => d3.ascending(a.date, b.date))
      .forEach((e) => { const li = el('li'); li.append(el('b', null, `${fs(parse(e.date))}: `), document.createTextNode(e.what + ' ')); li.appendChild(link(e.source, e.url)); ul5.appendChild(li); });
    if (!ul5.childElementCount) ul5.appendChild(el('li', null, 'Nothing dated in the next 14 days.'));
    s5.appendChild(ul5);
    // 6. landed
    try {
      landInit(); const s6 = sec('Landed in India today'); const ul6 = el('ul', 'blist');
      landItems().forEach((it) => { const a = landCalc(it.usd, it.cls, false); ul6.appendChild(el('li', null, `${it.name}: ${fmtUsd1(a.landed)}/kWh, about ₹${d3.format(',.0f')(a.inr)}/kWh (China price ${fmtUsd1(it.usd)} + freight, insurance and duty; excluding IGST)`)); });
      s6.appendChild(ul6);
    } catch (e) { console.error(e); }
  }

  // ---------- regulations ----------
  const RULES = { region: '', area: '', status: '', q: '' };
  const STATUS_COL = { 'In force': '--accent', 'Starts later': '--amber', 'Paused': '--plum', 'Proposed': '--slate', 'Bids under evaluation': '--teal' };
  const effectClass = (e) => (/^cost up|supply risk|competitor/i.test(e) ? 'ef-bad' : /cost down|supply easier/i.test(e) ? 'ef-good' : /demand up/i.test(e) ? 'ef-up' : 'ef-neutral');
  function ruleCard(r, today) {
    const c = el('article', 'rule'); c.style.setProperty('--sc', css(STATUS_COL[r.status] || '--slate'));
    const top = el('div', 'rule-top');
    top.append(el('span', 'rule-region', r.region), el('span', 'rule-area', r.area));
    if (isNewRule(r.id)) top.appendChild(newTag(r.changed ? `Changed: ${r.changed}` : 'New or changed since your last visit'));
    const st = el('span', 'rule-status', r.status); top.appendChild(st);
    c.appendChild(top);
    c.appendChild(el('h3', 'rule-title', r.title));
    const d = parse(r.date); const days = Math.round((+d - today) / 864e5);
    const when = el('div', 'rule-date'); when.appendChild(document.createTextNode(r.date_label || d3.utcFormat('%-d %b %Y')(d)));
    if (days > 0 && days <= 120) when.appendChild(el('b', 'rule-soon', days === 1 ? ' · tomorrow' : ` · in ${days} days`));
    c.appendChild(when);
    c.appendChild(el('p', 'rule-what', r.what));
    const imp = el('div', 'rule-impact'); imp.append(el('b', null, 'What it means for an Indian buyer'), el('p', null, r.impact)); c.appendChild(imp);
    const tags = el('div', 'rule-tags');
    (r.effects || []).forEach((e) => tags.appendChild(el('span', 'rtag ' + effectClass(e), e)));
    (r.affects || []).forEach((a) => tags.appendChild(el('span', 'rtag ef-affects', a)));
    c.appendChild(tags);
    const src = el('div', 'rule-src'); src.appendChild(link(r.source, r.url));
    if (r.url2) { src.appendChild(document.createTextNode(' · ')); src.appendChild(link(r.source2, r.url2)); }
    src.appendChild(el('span', 'rule-checked', ` · checked ${d3.utcFormat('%-d %b %Y')(parse(r.checked))}`));
    c.appendChild(src);
    return c;
  }
  function renderRules() {
    const all = D.regulations || [];
    const list = $('#rules-list'), next = $('#rules-next');
    if (!all.length) { fail(list, 'No regulations loaded'); return; }
    const ist = new Date(Date.now() + 5.5 * 36e5); const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    // stats
    const stats = $('#rules-stats'); stats.replaceChildren();
    const counts = d3.rollup(all, (v) => v.length, (r) => r.status);
    ['In force', 'Starts later', 'Paused', 'Bids under evaluation', 'Proposed'].forEach((s) => { if (!counts.get(s)) return; const b = el('span', 'rstat'); b.style.setProperty('--sc', css(STATUS_COL[s])); b.append(el('b', null, String(counts.get(s))), el('span', null, s)); stats.appendChild(b); });
    // coming up
    next.replaceChildren();
    const ahead = all.filter((r) => +parse(r.date) >= today).sort((a, b) => d3.ascending(a.date, b.date));
    if (!ahead.length) next.appendChild(el('li', 'empty', 'No dated rule changes ahead.'));
    ahead.forEach((r) => {
      const d = parse(r.date); const days = Math.round((+d - today) / 864e5);
      const li = el('li'); li.style.setProperty('--sc', css(STATUS_COL[r.status] || '--slate'));
      const db = el('div', 'dbox'); db.append(el('b', null, d3.utcFormat('%-d %b')(d)), el('span', null, d3.utcFormat('%Y')(d)));
      const body = el('div', 'rn-body');
      const meta = el('div', 'rn-meta'); meta.append(document.createTextNode(r.region + ' '), el('span', 'rule-status', r.status));
      body.append(el('div', 'rn-when' + (days <= 30 ? ' soon' : ''), days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 60 ? `In ${days} days` : `In about ${Math.round(days / 30)} months`), el('div', 'rn-title', r.short || r.title), meta);
      const b = el('button', 'rn'); b.type = 'button'; b.append(db, body);
      b.addEventListener('click', () => { const card = document.getElementById('rule-' + r.id); if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1600); } });
      li.appendChild(b); next.appendChild(li);
    });
    // filters
    const regions = ['', ...new Set(all.map((r) => r.region))];
    const chips = $('#rules-region'); chips.replaceChildren();
    regions.forEach((g) => { const b = el('button', null, g || 'All regions'); b.type = 'button'; b.setAttribute('aria-pressed', String(RULES.region === g)); b.addEventListener('click', () => { RULES.region = g; renderRules(); }); chips.appendChild(b); });
    const fill = (sel, label, vals, key) => {
      if (sel.dataset.ready) return; sel.dataset.ready = '1';
      [['', label], ...vals.map((v) => [v, v])].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); });
      sel.addEventListener('change', () => { RULES[key] = sel.value; renderRules(); });
    };
    fill($('#rules-area'), 'All areas', [...new Set(all.map((r) => r.area))].sort(), 'area');
    fill($('#rules-status'), 'Any status', [...new Set(all.map((r) => r.status))], 'status');
    const srch = $('#rules-search'); if (!srch.dataset.ready) { srch.dataset.ready = '1'; srch.addEventListener('input', () => { RULES.q = srch.value.trim().toLowerCase(); renderRules(); }); }
    // list: dated ahead first, then in force by newest
    const order = { 'Paused': 0, 'Starts later': 1, 'Bids under evaluation': 2, 'Proposed': 3, 'In force': 4 };
    const shown = all.filter((r) => (!RULES.region || r.region === RULES.region) && (!RULES.area || r.area === RULES.area) && (!RULES.status || r.status === RULES.status)
      && (!RULES.q || [r.title, r.what, r.impact, r.region, r.area, ...(r.affects || [])].join(' ').toLowerCase().includes(RULES.q)))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.status === 'In force' ? (d3.ascending(a.region === 'India' ? 0 : 1, b.region === 'India' ? 0 : 1) || d3.descending(a.date, b.date)) : d3.ascending(a.date, b.date)));
    $('#rules-count').textContent = `${shown.length} of ${all.length} rules`;
    list.replaceChildren();
    shown.forEach((r) => { const c = ruleCard(r, today); c.id = 'rule-' + r.id; list.appendChild(c); });
    if (!shown.length) list.appendChild(el('p', 'sub', 'No rules match these filters.'));
  }

  // ---------- alive: new since your last visit ----------
  // Kept in this browser only (localStorage); nothing is sent anywhere. A visit ends after 30 minutes away.
  const VISIT = { prev: null, first: false, news: new Set(), rules: new Set(), prices: new Map(), keepNews: new Set(), keepRules: new Set() };
  const isNewNews = (id) => VISIT.news.has(id) || VISIT.keepNews.has(id);
  const isNewRule = (id) => VISIT.rules.has(id) || VISIT.keepRules.has(id);
  const ruleSig = (r) => [r.status, r.date, r.changed || ''].join('|');
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return undefined; } };
  const writeJSON = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  function visitSnap() {
    return {
      p: Object.fromEntries((D.latest || []).map((r) => [r.id, [r.price, r.asof]])),
      n: (D.news || []).map((n) => n.id),
      r: Object.fromEntries((D.regulations || []).map((r) => [r.id, ruleSig(r)])),
    };
  }
  function visitInit() {
    let cur = readJSON('lbp-visit'); let prev = readJSON('lbp-prev');
    if (cur === undefined) return; // storage blocked: feature off
    const now = Date.now(), snap = visitSnap();
    if (!cur || !cur.snap) { prev = null; VISIT.first = true; cur = { last: now, snap }; }
    else if (now - cur.last > 30 * 60e3) { prev = { t: cur.last, snap: cur.snap }; cur = { last: now, snap }; }
    else { cur.last = now; cur.snap = snap; }
    writeJSON('lbp-visit', cur); writeJSON('lbp-prev', prev);
    VISIT.prev = prev; visitDiff();
    window.addEventListener('pagehide', () => { const c = readJSON('lbp-visit'); if (c) { c.last = Date.now(); writeJSON('lbp-visit', c); } });
  }
  function visitDiff() {
    VISIT.news.clear(); VISIT.rules.clear(); VISIT.prices.clear();
    const P = VISIT.prev && VISIT.prev.snap; if (!P) return;
    const seen = new Set(P.n || []);
    (D.news || []).forEach((n) => { if (!seen.has(n.id)) VISIT.news.add(n.id); });
    (D.regulations || []).forEach((r) => { if ((P.r || {})[r.id] !== ruleSig(r)) VISIT.rules.add(r.id); });
    (D.latest || []).forEach((r) => {
      const o = (P.p || {})[r.id]; if (!o || (o[0] === r.price && o[1] === r.asof)) return;
      const a = numOf(o[0]), b = numOf(r.price);
      VISIT.prices.set(r.id, { from: o[0], to: r.price, pct: a && b ? (b / a - 1) * 100 : null });
    });
  }
  // opening the News or Regulations tab counts as seeing them: the tab badge goes and stays gone,
  // while the 'New' labels on the items themselves stay for the rest of this visit
  function visitSeenTab(kind) {
    if (!VISIT.prev || !VISIT.prev.snap) return;
    const set = kind === 'news' ? VISIT.news : VISIT.rules; if (!set.size) return;
    const keep = kind === 'news' ? VISIT.keepNews : VISIT.keepRules; set.forEach((id) => keep.add(id));
    const snap = visitSnap();
    if (kind === 'news') VISIT.prev.snap.n = snap.n; else VISIT.prev.snap.r = snap.r;
    writeJSON('lbp-prev', VISIT.prev); visitDiff(); renderCounts();
  }
  function visitSeen() {
    VISIT.prev = { t: Date.now(), snap: visitSnap() }; VISIT.first = false;
    writeJSON('lbp-prev', VISIT.prev); visitDiff(); renderCounts(); go(S.tab, false);
  }
  const newTag = (title) => { const t = el('span', 'newtag', 'New'); if (title) t.title = title; return t; };
  function whenLabel(t) {
    const d = new Date(t), now = new Date();
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dd = Math.round((day0(now) - day0(d)) / 864e5);
    const hm = d3.timeFormat('%-I:%M %p')(d).toLowerCase();
    return dd === 0 ? `today, ${hm}` : dd === 1 ? `yesterday, ${hm}` : dd < 7 ? `${d3.timeFormat('%A')(d)}, ${hm}` : d3.timeFormat('%-d %b')(d);
  }
  function renderCounts() {
    const nc = $('#news-count'), rn = $('#rules-new');
    const nn = VISIT.news.size;
    nc.textContent = nn ? `${nn} new` : ((D.news || []).length || '');
    nc.classList.toggle('is-new', !!nn); nc.title = nn ? `${nn} ${nn === 1 ? 'story' : 'stories'} added since your last visit` : 'Stories on the site';
    const rc = VISIT.rules.size; rn.hidden = !rc; rn.textContent = rc ? `${rc} new` : ''; rn.title = 'New or changed since your last visit';
  }
  function renderSince() {
    const box = $('#since'); if (!box) return;
    box.replaceChildren();
    if (VISIT.first) {
      box.hidden = false; box.className = 'sincebar is-first';
      box.append(el('span', 'since-dot'), el('span', 'since-lead', 'Welcome.'), document.createTextNode(' From your next visit, this line will show what changed since you were last here: new stories, price moves and rule changes.'));
      return;
    }
    if (!VISIT.prev) { box.hidden = true; return; }
    box.hidden = false; box.className = 'sincebar';
    box.append(el('span', 'since-dot'), el('span', 'since-lead', `Since your last visit (${whenLabel(VISIT.prev.t)}):`));
    const parts = [];
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    [...VISIT.prices].filter(([, c]) => c.pct != null && Math.abs(c.pct) >= 0.05).sort((a, b) => Math.abs(b[1].pct) - Math.abs(a[1].pct)).slice(0, 3).forEach(([id, c]) => {
      const b = el('button', 'since-item'); b.type = 'button';
      b.append(document.createTextNode((L[id] && L[id].layer === 'Raw material' ? 'Lithium' : (L[id] ? L[id].label.replace(/,.*$/, '') : id)) + ' '), el('b', c.pct < 0 ? 'is-down' : 'is-up', pctS(c.pct)));
      b.title = `${c.from} → ${c.to}`; b.addEventListener('click', () => go(CARD_TAB[id] || 'materials')); parts.push(b);
    });
    const nn = VISIT.news.size, rc = VISIT.rules.size;
    if (nn) { const b = el('button', 'since-item'); b.type = 'button'; b.append(el('b', null, String(nn)), document.createTextNode(` new ${nn === 1 ? 'story' : 'stories'}`)); b.addEventListener('click', () => go('news')); parts.push(b); }
    if (rc) { const b = el('button', 'since-item'); b.type = 'button'; b.append(el('b', null, String(rc)), document.createTextNode(` ${rc === 1 ? 'rule' : 'rules'} new or changed`)); b.addEventListener('click', () => go('rules')); parts.push(b); }
    const flat = [...VISIT.prices].filter(([, c]) => c.pct == null || Math.abs(c.pct) < 0.05).length;
    if (flat && !parts.length) parts.push(el('span', 'since-item', `${flat} ${flat === 1 ? 'price' : 'prices'} re-checked, unchanged`));
    if (!parts.length) parts.push(el('span', 'since-item', 'nothing new yet. The next update is at about 4:00 am IST.'));
    parts.forEach((p, i) => { if (i) box.appendChild(el('span', 'since-sep', '·')); box.appendChild(p); });
    if (nn || rc || VISIT.prices.size) { const k = el('button', 'btn link since-clear', 'Mark all as seen'); k.type = 'button'; k.addEventListener('click', visitSeen); box.appendChild(k); }
  }

  // if the page stays open past the morning update, offer a reload
  let freshT = 0, lastFresh = 0;
  function checkFresh() {
    if (!D.meta || Date.now() - lastFresh < 5 * 60e3) return; lastFresh = Date.now();
    fetch('data/meta.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m || m.updated === D.meta.updated) return;
      const t = $('#toast'); t.replaceChildren(el('span', null, `Fresh data is in (${m.updated_label}).`));
      const b = el('button', 'btn small', 'Reload'); b.type = 'button'; b.addEventListener('click', () => location.reload());
      const x = el('button', 'btn link small', 'Later'); x.type = 'button'; x.addEventListener('click', () => { t.hidden = true; });
      t.append(b, x); t.hidden = false;
    }).catch(() => {});
  }
  function startFresh() { clearInterval(freshT); freshT = setInterval(() => { if (!document.hidden) checkFresh(); }, 10 * 60e3); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkFresh(); }); }

  // ---------- alive: motion (all of it off when the reader asks for reduced motion) ----------
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MOTION = { counted: false, glowed: false, risk: new Set(), drawn: new WeakSet() };
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function countUp(node, ms = 900) {
    if (node.classList.contains('counting')) return; // already counting: don't start from a half-way number
    const txt = node.textContent; const m = txt.match(/^(\D*?)(\d[\d,]*)(\.\d+)?(.*)$/); if (!m) return;
    const target = +(m[2].replace(/,/g, '') + (m[3] || '')); const dec = m[3] ? m[3].length - 1 : 0; const comma = m[2].includes(',');
    const f = d3.format((comma ? ',' : '') + '.' + dec + 'f'); const t0 = performance.now();
    node.classList.add('counting');
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); node.textContent = m[1] + f(target * ease(k)) + m[4]; if (k < 1) requestAnimationFrame(step); else { node.textContent = txt; node.classList.remove('counting'); } };
    requestAnimationFrame(step);
  }
  function drawLines(paths, ms = 1100, delay = 0) {
    paths.forEach((p) => {
      let len = 0; try { len = p.getTotalLength(); } catch (e) { return; } if (!len) return;
      p.style.strokeDasharray = `${len} ${len}`; p.style.strokeDashoffset = len; p.getBoundingClientRect();
      p.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.3,.6,.2,1) ${delay}ms`; p.style.strokeDashoffset = 0;
      setTimeout(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.style.transition = ''; }, ms + delay + 60);
    });
  }
  function drawIn(box) { // chart lines draw themselves the first time the chart scrolls into view
    if (reduced() || MOTION.drawn.has(box) || !('IntersectionObserver' in window)) return;
    MOTION.drawn.add(box);
    const svg = box.querySelector('svg'); if (!svg) return;
    const lines = [...svg.querySelectorAll('path.drawline')]; const dots = [...svg.querySelectorAll('circle.dot')];
    lines.forEach((p) => { p.style.opacity = 0; }); dots.forEach((c) => { c.style.opacity = 0; });
    const io = new IntersectionObserver((ents) => {
      if (!ents.some((e) => e.isIntersecting)) return; io.disconnect();
      const s2 = box.querySelector('svg'); if (s2 !== svg) return; // redrawn meanwhile
      lines.forEach((p) => { p.style.opacity = ''; }); drawLines(lines);
      dots.forEach((c) => { c.style.transition = 'opacity .4s ease 900ms'; c.style.opacity = ''; });
    }, { threshold: 0.25 });
    io.observe(box);
  }
  function overviewMotion() {
    if (reduced()) return;
    if (!MOTION.glowed && D.meta) {
      MOTION.glowed = true;
      const wd = parse(D.meta.updated).getUTCDay(); const lim = wd === 1 ? 3 : wd === 0 ? 2 : 1;
      (D.latest || []).forEach((r) => {
        if (ageDays(r.asof) > lim || /unchanged|stable|flat|survey/i.test(r.move || '')) return;
        const c = document.getElementById('card-' + r.id); if (c) { c.classList.add('glow'); c.addEventListener('animationend', () => c.classList.remove('glow'), { once: true }); }
      });
    }
  }

  // ---------- alive: alert spotlight ----------
  const SPOT = { i: 0, t: 0, hold: false, items: [] };
  function renderSpot() {
    const box = $('#spot'); if (!box) return;
    const today = istToday(), cut = today - 21 * 864e5;
    SPOT.items = sortedNews().filter((n) => n.alert && +parse(n.date) >= cut).slice(0, 6);
    if (!SPOT.items.length) { box.hidden = true; return; }
    box.hidden = false; SPOT.i = Math.min(SPOT.i, SPOT.items.length - 1);
    box.replaceChildren();
    const lab = el('span', 'spot-lab', 'Alert');
    const stage = el('div', 'spot-stage'); stage.setAttribute('aria-live', 'polite');
    const nav = el('div', 'spot-nav');
    const prev = el('button', 'spot-arrow', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous alert');
    const next = el('button', 'spot-arrow', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next alert');
    const dots = el('span', 'spot-dots');
    SPOT.items.forEach((_, i) => { const d = el('button', 'spot-dot'); d.type = 'button'; d.setAttribute('aria-label', `Alert ${i + 1} of ${SPOT.items.length}`); d.addEventListener('click', () => { spotShow(i); spotTimer(); }); dots.appendChild(d); });
    prev.addEventListener('click', () => { spotShow((SPOT.i - 1 + SPOT.items.length) % SPOT.items.length); spotTimer(); });
    next.addEventListener('click', () => { spotShow((SPOT.i + 1) % SPOT.items.length); spotTimer(); });
    nav.append(prev, dots, next);
    if (SPOT.items.length < 2) nav.hidden = true;
    box.append(lab, stage, nav);
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('pointerenter', () => { SPOT.hold = true; }); box.addEventListener('pointerleave', () => { SPOT.hold = false; });
      box.addEventListener('focusin', () => { SPOT.hold = true; }); box.addEventListener('focusout', () => { SPOT.hold = false; });
    }
    spotShow(SPOT.i, true); spotTimer();
  }
  function spotShow(i, instant) {
    const box = $('#spot'); const st = box && box.querySelector('.spot-stage'); if (!st) return;
    SPOT.i = i; const n = SPOT.items[i];
    const a = el('a', 'spot-item'); a.href = n.url; a.target = '_blank'; a.rel = 'noopener';
    const meta = el('span', 'spot-meta'); meta.append(el('span', null, n.day), el('span', 'tag', n.category || 'News'));
    if (isNewNews(n.id)) meta.appendChild(newTag());
    a.append(meta, el('span', 'spot-h', n.headline), el('span', 'spot-src', n.source + ' ↗'));
    if (!instant && !reduced()) a.classList.add('in');
    st.replaceChildren(a);
    $$('.spot-dot', box).forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
  }
  function spotTimer() {
    clearInterval(SPOT.t); if (reduced() || SPOT.items.length < 2) return;
    SPOT.t = setInterval(() => { if (SPOT.hold || document.hidden || S.tab !== 'overview') return; spotShow((SPOT.i + 1) % SPOT.items.length); }, 7000);
  }

  // ---------- India storage tenders (facts only) ----------
  const ST = { hours: 0 };
  function stRecent(tenders, h) {
    const last = d3.max(tenders, (t) => t.date); const cut = new Date(+parse(last) - 365 * 864e5);
    const lows = tenders.filter((t) => t.hours === h && parse(t.date) >= cut).map((t) => t.low).sort(d3.ascending);
    return lows.length ? { n: lows.length, q1: d3.quantile(lows, 0.25), med: d3.median(lows), q3: d3.quantile(lows, 0.75) } : null;
  }
  const stTenders = () => [...((D.indiastorage || {}).tenders || [])].sort((a, b) => d3.ascending(a.date, b.date));
  function tenderChart(chart, shown) {
      const HC = { 2: css('--blue'), 4: css('--orange') };
      chart.replaceChildren(); if (!shown.length) return;
      const W = chart.clientWidth || 700, H = 300, mg = { t: 18, r: 16, b: 30, l: 44 };
      const svg = d3.select(chart).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H);
      const dates = shown.map((t) => parse(t.date));
      const xs = d3.scaleUtc([new Date(+d3.min(dates) - 40 * 864e5), new Date(+d3.max(dates) + 40 * 864e5)], [mg.l, W - mg.r]);
      const ys = d3.scaleLinear([0, d3.max(shown, (t) => t.low) * 1.15], [H - mg.b, mg.t]).nice();
      svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(ys).ticks(5).tickFormat((v) => '₹' + v).tickSize(-(W - mg.l - mg.r))).call(axisStyle);
      svg.append('g').attr('transform', `translate(0,${H - mg.b})`).call(d3.axisBottom(xs).ticks(Math.max(3, Math.floor((W - mg.l - mg.r) / 90))).tickFormat(d3.utcFormat('%b %y')).tickSize(0).tickPadding(8)).call(axisStyle);
      shown.forEach((t) => {
        const c = HC[t.hours] || css('--slate');
        const a = svg.append('a').attr('href', t.url).attr('target', '_blank').attr('rel', 'noopener').attr('class', 'st-pt');
        a.append('circle').attr('cx', xs(parse(t.date))).attr('cy', ys(t.low)).attr('r', 7).attr('fill', c).attr('stroke', css('--panel')).attr('stroke-width', 2);
        a.on('pointermove', (ev) => showTip(ev, (tt) => {
          tt.appendChild(el('div', 'h', t.label)); tipRow(tt, c, `${t.hours}-hour · ${t.state}`, t.high && t.high !== t.low ? `₹${t.low}–${t.high} lakh` : `₹${t.low} lakh`);
          tipRow(tt, null, 'Reported', d3.utcFormat('%-d %b %Y')(parse(t.date))); tipNote(tt, 'Winners: ' + t.winners); tipNote(tt, 'Source: ' + t.source + ' (click to open)');
        })).on('pointerleave', hideTip);
      });
      svg.append('text').attr('x', mg.l).attr('y', 11).attr('font-size', 11.5).attr('fill', css('--muted')).text('₹ lakh per MW per month (lowest winning bid)');
  }
  function renderStorage() {
    const X = D.indiastorage; const chart = $('#st-chart'); if (!chart) return;
    if (!X) { fail(chart, 'India storage data not available'); return; }
    try {
      const tenders = stTenders(); const r2 = stRecent(tenders, 2), r4 = stRecent(tenders, 4);
      const lead = $('#st-lead'); lead.replaceChildren();
      const rng = (r) => `₹${r.q1.toFixed(2)}–${r.q3.toFixed(2)} lakh`;
      if (r2) lead.append(document.createTextNode('In the last 12 months, most 2-hour storage tenders were won at '), el('b', null, rng(r2)));
      if (r4) lead.append(document.createTextNode(' and 4-hour at '), el('b', null, rng(r4)));
      lead.append(document.createTextNode(' per MW per month.'));
      const seg = $('#st-hours'); seg.replaceChildren();
      [[0, 'All'], [2, '2-hour'], [4, '4-hour']].forEach(([h, t]) => { const b = el('button', null, t); b.type = 'button'; b.setAttribute('aria-pressed', String(ST.hours === h)); b.addEventListener('click', () => { ST.hours = h; renderStorage(); }); seg.appendChild(b); });
      const shown = tenders.filter((t) => !ST.hours || t.hours === ST.hours);
      const HC = { 2: css('--blue'), 4: css('--orange') };
      tenderChart(chart, shown);
      const lg = $('#st-legend'); lg.replaceChildren();
      [[css('--blue'), '2-hour'], [css('--orange'), '4-hour']].forEach(([c, t]) => { const s = el('span'); const i = el('i', 'dt'); i.style.background = c; s.append(i, document.createTextNode(t)); lg.appendChild(s); });
      const tb = $('#st-table'); tb.replaceChildren();
      const hr = el('tr'); ['Reported', 'Tender', 'Hours', 'MWh', 'Tariff, ₹ lakh/MW/month', 'Govt support (VGF)', 'Contract', 'Winners', 'Source'].forEach((h) => hr.appendChild(el('th', null, h))); const th = el('thead'); th.appendChild(hr); tb.appendChild(th);
      const body = el('tbody');
      [...shown].reverse().forEach((t) => {
        const tr = el('tr');
        tr.append(el('td', 'nowrap', d3.utcFormat('%-d %b %Y')(parse(t.date))), el('td', null, t.label), el('td', 'num', String(t.hours)), el('td', 'num', d3.format(',')(t.mwh)), el('td', 'num strong', t.high && t.high !== t.low ? `${t.low}–${t.high}` : String(t.low)), el('td', null, t.vgf), el('td', null, t.tenure ? t.tenure + ' yrs' : '–'), el('td', 'mk-note', t.winners));
        const s = el('td'); s.appendChild(link(t.source, t.url)); if (t.url2) { s.appendChild(document.createTextNode(' · ')); s.appendChild(link(t.source2, t.url2)); } tr.appendChild(s);
        body.appendChild(tr);
      });
      tb.appendChild(body);
      const et = $('#st-epc'); et.replaceChildren();
      const eh = el('tr'); ['Contract', 'MWh', 'Value', 'Per MWh', 'What it covers'].forEach((x) => eh.appendChild(el('th', null, x))); const ethd = el('thead'); ethd.appendChild(eh); et.appendChild(ethd);
      const eb = el('tbody');
      (X.epc_orders || []).forEach((o) => {
        const tr = el('tr'); const n = el('td'); n.appendChild(link(o.label, o.url)); n.appendChild(el('span', 'role', `${d3.utcFormat('%-d %b %Y')(parse(o.date))}${o.hours ? ` · ${o.hours}-hour` : ''}`));
        tr.append(n, el('td', 'num', d3.format(',')(o.mwh)), el('td', 'num', `₹${d3.format(',.0f')(o.inr_cr)} cr`), el('td', 'num strong', `₹${(o.inr_cr / o.mwh).toFixed(2)} cr`), el('td', 'mk-note', o.scope));
        eb.appendChild(tr);
      });
      et.appendChild(eb);
      const nb = $('#st-notes'); nb.replaceChildren();
      (X.market_notes || []).forEach((n) => { const li = el('li'); li.appendChild(document.createTextNode(n.text + ' ')); li.appendChild(link(n.source, n.url)); nb.appendChild(li); });
    } catch (e) { console.error(e); fail(chart, 'India storage page could not be drawn'); }
  }

  // ---------- value chain: hero on the overview and one page per step ----------
  const ICON = {
    mine: 'M3 10h18l-2.2 7.5a1 1 0 0 1-1 .7H6.2a1 1 0 0 1-1-.7L3 10zM6.5 10l2.5-4 2.5 2 3-3 3 5M8 21.5a1.2 1.2 0 1 0 0-.01M16 21.5a1.2 1.2 0 1 0 0-.01',
    flask: 'M9 3h6M10 3v6.2L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3M7.5 15h9',
    cell: 'M9.5 2.5h5M8 4.5h8a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 16 21.5H8A1.5 1.5 0 0 1 6.5 20V6A1.5 1.5 0 0 1 8 4.5zM12.8 8.5 10.5 13h3l-2.3 4.5',
    pack: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9zM3 7.5 12 12l9-4.5M12 12v9',
    grid: 'M12 2.5 8 21.5M12 2.5l4 19M9.2 8h5.6M8.4 13h7.2M3 21.5h18M5 8h14',
    news: 'M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2v-13zM17 9h3v9.5a2 2 0 0 1-4 0M7.5 9h6M7.5 12.5h6M7.5 16h4',
    rules: 'M12 3v18M7.5 21h9M5 7h14M5 7l-2.5 6a2.6 2.6 0 0 0 5 0L5 7M19 7l-2.5 6a2.6 2.6 0 0 0 5 0L19 7',
    calc: 'M6.5 2.5h11A1.5 1.5 0 0 1 19 4v16a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5zM8 6h8v3.5H8zM8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01',
    shield: 'M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6L12 2.5zM9 12l2.2 2.2L15.5 10',
    map: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5zM9 4v13.5M15 6.5V20',
  };
  // ---------- page headers: the value-chain step header, reused on every inner page ----------
  const HERO = {
    news: { icon: 'news', color: '--l2', eyebrow: 'News', title: 'What moved the battery market',
      say: () => 'From lithium mines to India\u2019s storage tenders, summarised in our own words with a link to every source.',
      key: () => { const all = D.news || []; const r = S.news.recent || 0; return { label: 'Added today and yesterday', value: String(r), unit: r === 1 ? ' story' : ' stories', move: `${all.length} in the last few weeks` }; } },
    rules: { icon: 'rules', color: '--l3', eyebrow: 'Regulations', title: 'The rules that move battery costs',
      say: () => 'Rules in India, China and elsewhere that change the cost, supply or demand for batteries, each checked against its source.',
      extra: () => { const d = el('div', 'rules-stats'); d.id = 'rules-stats'; return d; },
      key: () => { const ist = new Date(Date.now() + 5.5 * 36e5); const t0 = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()); const nx = (D.regulations || []).filter((r) => +parse(r.date) >= t0).sort((a, b) => d3.ascending(a.date, b.date))[0]; if (!nx) return null; const dd = Math.round((+parse(nx.date) - t0) / 864e5); return { label: 'Next rule change', value: dd === 0 ? 'Today' : String(dd), unit: dd === 0 ? '' : dd === 1 ? ' day' : ' days', move: nx.short || nx.title }; } },
    calculator: { icon: 'calc', color: '--l4', eyebrow: 'Calculator', title: 'What would a battery cost?',
      say: () => 'Move raw-material prices and see what a storage cell and a 4-hour storage system would cost. Starts at today\u2019s prices; estimates from public data, not quotes.',
      key: () => { try { const c = cellCost(calcBase()); return { label: 'Storage cell, cost to make today', value: fmtUsd1(c.total), unit: '/kWh', move: 'From today\u2019s material prices' }; } catch (e) { return null; } } },
    risk: { icon: 'shield', color: '--l1', eyebrow: 'Risk', title: 'Where the risk sits',
      say: () => 'Price and supply risk for what we buy, scored 0\u201310 from a buyer\u2019s point of view every morning, plus a three-year outlook.',
      extra: () => { const a = el('a', 'ol-jump', 'See the next three years \u2193'); a.href = '#risk'; a.id = 'ol-jump'; return a; },
      key: () => { const ms = (D.risk || {}).materials || []; let best = null; ms.forEach((m) => ['price', 'supply'].forEach((ax) => { const r = (m.h3 || {})[ax]; if (r && r.score != null && (!best || r.score > best.s)) best = { s: r.score, m, ax, lvl: r.level }; })); if (!best) return null; return { label: 'Highest risk, next 3 months', value: best.s.toFixed(1), unit: '/10', move: `${best.m.short} ${best.ax} risk \u00b7 ${best.lvl}`, dir: 'up' }; } },
    storage: { icon: 'grid', color: '--l5', eyebrow: 'India storage', title: 'India\u2019s battery storage tenders',
      say: () => 'What state utilities pay for grid batteries, tender by tender, and what Indian storage projects cost to build.',
      key: () => { const t = stTenders(); const l = t[t.length - 1]; if (!l) return null; return { label: 'Latest tender, lowest bid', value: `\u20b9${l.low}`, unit: ' lakh/MW-month', move: `${l.agency}, ${d3.utcFormat('%-d %b %Y')(parse(l.date))}` }; } },
    materials: { icon: 'map', color: '--l2', eyebrow: 'Prices', title: 'Every price, from lithium to a storage system',
      say: () => 'Each step is made from the one above it. All prices in US$, each linked to its source.',
      key: () => { const r = (D.latest || []).find((x) => x.id === 'lithium'); if (!r) return null; return { label: r.label, value: r.price, unit: UNIT_SHORT[r.unit] || '', move: r.move, dir: r.direction }; } },
  };
  function pageHero(tab) {
    const cfg = HERO[tab]; const pg = $(`#page-${tab}`); if (!cfg || !pg) return;
    let h = $(':scope > .pg-card', pg);
    if (!h) { h = el('section', 'chp-hero pg-card'); pg.insertBefore(h, pg.firstChild); }
    h.replaceChildren(); h.style.setProperty('--cc', css(cfg.color));
    const orb = el('span', 'ch-orb big'); orb.appendChild(svgIcon(cfg.icon, 34));
    const tx = el('div'); tx.append(el('p', 'ch-eyebrow', cfg.eyebrow), el('h1', 'chp-title', cfg.title), el('p', 'chp-say', cfg.say()));
    if (cfg.extra) tx.appendChild(cfg.extra());
    h.append(orb, tx);
    let k = null; try { k = cfg.key(); } catch (e) { k = null; }
    if (k) { const kv = el('div', 'chp-key'); const b = el('b', null, k.value); if (k.unit) b.appendChild(el('span', 'u', k.unit)); kv.append(el('span', 'l', k.label), b, el('span', 'm' + (k.dir ? dirClass(k.dir) : ''), k.move)); h.appendChild(kv); }
  }
  const CHAIN = [
    { id: 'mining', n: '01', name: 'Mining', title: 'Lithium and metals', icon: 'mine', color: '--l1', flow: [0], key: ['latest', 'lithium'], cats: ['Lithium & materials'], risk: ['lithium', 'copper', 'aluminium'], words: /lithium|copper|alumin/i, chart: 'lithium',
      say: 'Where the chain starts: lithium ore and salts, plus the copper and aluminium inside every cell.' },
    { id: 'materials', n: '02', name: 'Materials', title: 'Cathode, anode and cell materials', icon: 'flask', color: '--l2', flow: [1, 2], key: ['latest', 'cathode'], cats: ['R&D & new products', 'Regulation & trade'], risk: ['cathode', 'graphite'], words: /graphite|cathode|anode/i,
      say: 'Lithium becomes LFP cathode; graphite becomes the anode; electrolyte, separator and foils complete the cell.' },
    { id: 'cells', n: '03', name: 'Cells', title: 'Battery cells', icon: 'cell', color: '--l3', flow: [3], key: ['latest', 'cell314'], cats: ['Cell makers & competitors', 'India EV & battery makers'], risk: ['cell_ess', 'cell_ev'], words: /cell/i, chart: 'cells',
      say: 'Storage and EV cells: what they sell for and what the makers are doing.' },
    { id: 'systems', n: '04', name: 'Packs & systems', title: 'Packs and storage systems', icon: 'pack', color: '--l4', flow: [4], key: ['latest', 'system'], cats: ['Packs & BMS', 'Energy storage'], risk: [], words: /BESS|pack/i, chart: 'systems',
      say: 'Cells built into battery packs and containerised storage systems.' },
    { id: 'enduse', n: '05', name: 'End use', title: 'Grid storage and EVs in India', icon: 'grid', color: '--l5', flow: [], key: ['tender'], cats: ['India BESS', 'EV market'], risk: [], kinds: ['India tender'], words: /^EV$|\bEV\b(?! (cells|packs))/, chart: 'tenders',
      say: 'Who is buying: Indian storage tenders and the EV market.' },
  ];
  const svgIcon = (k, size = 28) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[k]); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.appendChild(p); return s; };
  function chainKey(c) {
    if (c.key[0] === 'tender') {
      const t = stTenders(); const l = t[t.length - 1]; if (!l) return null;
      return { label: 'Latest India storage tender', value: `₹${l.low}`, unit: ' lakh/MW', move: `a month · ${l.agency}, ${d3.utcFormat('%-d %b')(parse(l.date))}`, dir: 'flat' };
    }
    const r = (D.latest || []).find((x) => x.id === c.key[1]); if (!r) return null;
    return { label: r.label, value: r.price, unit: UNIT_SHORT[r.unit] || '', move: r.move, dir: r.direction };
  }
  function renderChainHero() {
    const box = $('#chain-hero'); if (!box) return; box.replaceChildren();
    const head = el('div', 'ch-head rv');
    const t1 = el('h2', 'ch-title'); t1.append(document.createTextNode('From the mine '), el('br', 'ch-br'), document.createTextNode('to the grid.'));
    head.append(el('p', 'ch-eyebrow', 'The battery value chain'), t1, el('p', 'ch-sub', 'Prices, news and risks for every step of the LFP battery chain. Updated every morning.'));
    box.appendChild(head);
    const row = el('ol', 'ch-row');
    CHAIN.forEach((c) => {
      const k = chainKey(c);
      const li = el('li', 'ch-step rv'); li.style.setProperty('--cc', css(c.color));
      const b = el('button', 'ch-node'); b.type = 'button'; b.setAttribute('aria-label', `${c.name}: open prices, news and risks`);
      const orb = el('span', 'ch-orb'); orb.appendChild(svgIcon(c.icon, 30));
      const txt = el('span', 'ch-txt'); txt.append(el('span', 'ch-n', c.n), el('span', 'ch-name', c.name));
      if (k) { const kv = el('span', 'ch-key'); kv.append(el('b', null, k.value), el('small', null, k.unit)); txt.appendChild(kv); txt.appendChild(el('span', 'ch-move' + dirClass(k.dir), k.move)); }
      txt.appendChild(el('span', 'ch-more', 'Explore ›'));
      b.append(orb, txt);
      b.addEventListener('click', () => go('chain/' + c.id));
      li.appendChild(b); row.appendChild(li);
    });
    box.appendChild(row);
    renderToday();
  }
  function renderToday() { // today's prices: the cards with small charts, under the hero
    const box = $('#today-band'); if (!box) return; box.replaceChildren();
    box.append(el('h2', 'tb-title rv', "Today's prices."), el('p', 'tb-sub rv', 'From lithium to a finished storage system. Click a card for its full history.'));
    const mon = d3.utcFormat('%b %Y');
    const evs = ((D.evcells || {}).series || []), fut = futPts(), wk = weekly();
    const sparks = {
      evcell: [evs.map((r) => r.usd_kwh), evs[0] && mon(parse(evs[0].date))],
      lithium: [fut.map((p) => p.v), fut[0] && mon(fut[0].d)],
      cell314: [wk.map((w) => w.cell314), wk[0] && mon(parse(wk[0].date))],
      system: [(D.systems || []).map((r) => +r.usd_kwh), (D.systems || [])[0] && (D.systems || [])[0].period],
    };
    const cards = el('div', 'cards tb-cards'); cards.id = 'cards'; box.appendChild(cards);
    (D.latest || []).forEach((r) => {
      const c = el('button', 'card rv layer-' + r.id); c.type = 'button'; c.id = 'card-' + r.id; c.title = 'Open its prices';
      const un = el('span', 'unit', `${r.unit} · ${r.asof}`);
      const vc = VISIT.prices.get(r.id); if (vc) un.appendChild(newTag(`Changed since your last visit: ${vc.from} → ${vc.to}`));
      c.append(el('span', 'layer', r.layer), el('span', 'label', r.label), el('span', 'price', r.price), un, el('span', 'move' + dirClass(r.direction), r.move));
      const sp = el('div', 'sparkbox');
      if (sparks[r.id] && sparks[r.id][0].length > 1) { spark(sp, sparks[r.id][0], css(LAYER_COLOR[r.id] || '--slate'), 64); sp.appendChild(el('span', 'since', 'Since ' + sparks[r.id][1])); }
      else sp.appendChild(el('span', 'none', 'No price history yet'));
      c.appendChild(sp);
      c.appendChild(el('span', 'src', 'Source: ' + r.source));
      c.addEventListener('click', () => go(CARD_TAB[r.id] || 'overview'));
      cards.appendChild(c);
    });
    overviewMotion();
  }
  // Apple-style reveal: sections rise and fade in as they scroll into view (off for reduced motion)
  // sections rise into view each time they enter the screen from below (Apple-style); off for reduced motion
  function reveal(root, replay = true) { // replay is false when a window resize re-rendered the page
    if (reduced() || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('rv-on');
    if (!reveal.io) reveal.io = new IntersectionObserver((ents) => ents.forEach((e) => {
      const n = e.target, r = e.boundingClientRect;
      if (e.isIntersecting) { if (n.classList.contains('pre')) playIn(n); }
      else if (e.rootBounds && r.height && r.top >= e.rootBounds.bottom) { // scrolled back below the screen: ready to play again
        clearTimeout(n._rvT); n.classList.remove('go'); n.classList.add('pre');
      }
    }), { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    $$('.rv', root).forEach((n) => {
      const k = Array.prototype.indexOf.call(n.parentNode.children, n) % 8; n.style.setProperty('--rd', (k * 70) + 'ms');
      if (replay) { clearTimeout(n._rvT); n.classList.remove('go'); n.classList.add('pre'); }
      reveal.io.unobserve(n); reveal.io.observe(n);
    });
  }
  function playIn(n) {
    const rd = parseFloat(n.style.getPropertyValue('--rd')) || 0;
    void n.offsetWidth; // make sure the hidden state is painted first so the rise always animates
    n.classList.remove('pre'); n.classList.add('go');
    clearTimeout(n._rvT); n._rvT = setTimeout(() => n.classList.remove('go'), 1300 + rd);
    if (n.matches('#today-band .card')) { // price counts up and the small chart draws itself, every time the card arrives
      const pr = $('.price', n); if (pr) setTimeout(() => countUp(pr), rd);
      drawLines($$('.spark path', n), 1000, rd + 150);
    }
  }
  // the hero gently fades and shrinks as the page scrolls past it
  let heroRaf = 0;
  window.addEventListener('scroll', () => {
    if (heroRaf || S.tab !== 'overview' || reduced()) return;
    heroRaf = requestAnimationFrame(() => {
      heroRaf = 0; const h = $('#chain-hero .ch-head'); if (!h || h.classList.contains('pre') || h.classList.contains('go')) return;
      const y = window.scrollY, k = Math.min(1, y / 520);
      h.style.opacity = String(1 - k * 0.85); h.style.transform = y > 0 ? `translateY(${(y * 0.22).toFixed(1)}px) scale(${(1 - k * 0.05).toFixed(3)})` : '';
    });
  }, { passive: true });
  // ---------- full chart with an optional forecast (opened from the value-chain step charts) ----------
  const FC = { keys: [], key: null, range: 1827, fc: false, scen: 'base', opener: null };
  const histPts = (rows, key) => [...(rows || [])].sort((a, b) => d3.ascending(a.date, b.date)).map((r) => ({ d: parse(r.date), v: +r[key], source: r.source })).filter((p) => p.v > 0);
  const FC_SERIES = {
    lithium: { name: 'Lithium carbonate', sub: 'Guangzhou futures, US$ per tonne', fmt: fmtUsd0, unit: '/t', mat: 'lithium', hist: () => futHist() },
    copper: { name: 'Copper', sub: 'LME cash settlement, US$ per tonne', fmt: fmtUsd0, unit: '/t', mat: 'copper', hist: () => (D.hist || {}).copper || [] },
    aluminium: { name: 'Aluminium', sub: 'LME cash settlement, US$ per tonne', fmt: fmtUsd0, unit: '/t', mat: 'aluminium', hist: () => (D.hist || {}).aluminium || [] },
    cathode: { name: 'LFP cathode', sub: 'China price, US$ per tonne', fmt: fmtUsd0, unit: '/t', mat: 'cathode', hist: () => [], note: 'The site has no LFP cathode price history yet, so this view starts from today’s price.' },
    cell_ess: { name: 'Storage cell (314 Ah)', sub: 'InfoLink average, US$ per kWh', fmt: fmtUsd1, unit: '/kWh', mat: 'cell_ess', hist: () => histPts(D.cell314, 'usd_kwh') },
    cell_ev: { name: 'EV cell', sub: 'TrendForce average, US$ per kWh', fmt: fmtUsd1, unit: '/kWh', mat: 'cell_ev', hist: () => histPts((D.evcells || {}).series, 'usd_kwh') },
    sys4: { name: '4-hour AC system', sub: 'China, InfoLink, US$ per kWh', fmt: fmtUsd1, unit: '/kWh', mat: null, hist: () => histPts(weekly(), 'ac_4h') },
    sys2: { name: '2-hour AC system', sub: 'China, InfoLink, US$ per kWh', fmt: fmtUsd1, unit: '/kWh', mat: null, hist: () => histPts(weekly(), 'ac_2h') },
    dc2: { name: '2-hour DC block', sub: 'China, InfoLink, US$ per kWh', fmt: fmtUsd1, unit: '/kWh', mat: null, hist: () => histPts(weekly(), 'dc_2h') },
  };
  function fcChart(box, { hist, fmt, rangeDays = 0, fc = null, height = 360, color = css('--l2'), legend = null, compact = false }) {
    box.replaceChildren();
    const today = fc ? parse(fc.asof) : (hist.length ? hist[hist.length - 1].d : new Date());
    const cutoff = rangeDays ? new Date(+today - rangeDays * 864e5) : new Date(-8.64e15);
    const hv = thin(hist.filter((p) => p.d >= cutoff));
    if (!hv.length && !fc) { box.appendChild(el('div', 'empty', 'No readings in this period.')); return; }
    const months = fc ? fc.months : [];
    const W = box.clientWidth || 700, H = height;
    const vals = [...hv.map((p) => p.v), ...(fc ? [fc.now, ...fc.bands.flatMap((b) => [b[0], b[4]]), ...fc.others.flatMap((o) => o.mids)] : [])].filter((v) => v > 0);
    const y = d3.scaleLinear([Math.min(...vals) * 0.92, Math.max(...vals) * 1.04], [H - 30, 14]).nice();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H);
    const ticks = y.ticks(5); const left = measure(svg, ticks.map(fmt)) + 12; const narrow = W < 560;
    const right = fc ? (narrow || compact ? Math.min(90, W * 0.26) : Math.min(150, W * 0.2)) : measure(svg, [fmt(hv[hv.length - 1].v)]) + 18;
    let x0 = hv.length ? hv[0].d : today, x1 = fc ? months[months.length - 1] : hv[hv.length - 1].d;
    if (+x0 === +x1) { x0 = new Date(+x0 - 15 * 864e5); x1 = new Date(+x1 + 15 * 864e5); }
    const x = d3.scaleUtc([x0, x1], [left, W - right]); const span = (x1 - x0) / 864e5;
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(y).tickValues(ticks).tickFormat(fmt).tickSize(-(W - left - right))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(x).ticks(span > 1100 ? d3.utcYear.every(narrow && span > 2000 ? 2 : 1) : Math.max(2, Math.floor((W - left - right) / 90))).tickFormat(d3.utcFormat(span > 1100 ? (narrow ? "'%y" : '%Y') : span < 120 ? '%-d %b' : '%b %y')).tickSize(0).tickPadding(10)).call(axisStyle);
    const labels = [];
    if (fc) {
      const fut = [{ d: today, b: [fc.now, fc.now, fc.now, fc.now, fc.now] }, ...months.map((m, i) => ({ d: m, b: fc.bands[i] }))];
      svg.append('path').datum(fut).attr('fill', color).attr('fill-opacity', 0.13).attr('d', d3.area().x((p) => x(p.d)).y0((p) => y(p.b[0])).y1((p) => y(p.b[4])).curve(d3.curveMonotoneX));
      svg.append('path').datum(fut).attr('fill', color).attr('fill-opacity', 0.22).attr('d', d3.area().x((p) => x(p.d)).y0((p) => y(p.b[1])).y1((p) => y(p.b[3])).curve(d3.curveMonotoneX));
      fc.others.forEach((o) => {
        const pts = [{ d: today, v: fc.now }, ...months.map((m, i) => ({ d: m, v: o.mids[i] }))];
        svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', o.color).attr('stroke-width', 1.2).attr('stroke-dasharray', '4 4').attr('opacity', 0.75).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)).curve(d3.curveMonotoneX));
        if (!narrow && !compact) labels.push({ y: y(pts[pts.length - 1].v), t: o.name, c: o.color, w: 500 });
      });
      const mid = [{ d: today, v: fc.now }, ...months.map((m, i) => ({ d: m, v: fc.bands[i][2] }))];
      svg.append('path').datum(mid).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.4).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)).curve(d3.curveMonotoneX));
      labels.push({ y: y(mid[mid.length - 1].v), t: narrow || compact ? fmt(mid[mid.length - 1].v) : `${fc.name} ${fmt(mid[mid.length - 1].v)}`, c: color, w: 700 });
      svg.append('line').attr('x1', x(today)).attr('x2', x(today)).attr('y1', 14).attr('y2', H - 30).attr('stroke', css('--axis')).attr('stroke-dasharray', '3 3');
      svg.append('text').attr('x', x(today) + 5).attr('y', 24).attr('font-size', 11.5).attr('fill', css('--muted')).text('Today');
    }
    if (hv.length) {
      const g = hv.flatMap((p, i) => (i && (p.d - hv[i - 1].d) / 864e5 > 75 ? [null, p] : [p]));
      if (fc) g.push({ d: today, v: fc.now });
      svg.append('path').datum(g).attr('class', 'drawline').attr('fill', 'none').attr('stroke', css('--fg')).attr('stroke-width', 1.8).attr('stroke-linejoin', 'round').attr('d', d3.line().defined((p) => p != null).x((p) => x(p.d)).y((p) => y(p.v)));
      if (hv.length <= 150) svg.append('g').selectAll('circle').data(hv).join('circle').attr('cx', (p) => x(p.d)).attr('cy', (p) => y(p.v)).attr('r', 2.6).attr('fill', css('--fg'));
      if (!fc) labels.push({ y: y(hv[hv.length - 1].v), t: fmt(hv[hv.length - 1].v), c: css('--fg'), w: 700 });
    }
    if (fc) svg.append('circle').attr('cx', x(today)).attr('cy', y(fc.now)).attr('r', 4).attr('fill', css('--fg'));
    labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    labels.forEach((l) => svg.append('text').attr('x', W - right + 8).attr('y', l.y + 4).attr('font-size', 11.5).attr('font-weight', l.w).attr('fill', l.c).text(l.t));
    const rule = svg.append('line').attr('y1', 14).attr('y2', H - 30).attr('stroke', css('--axis')).attr('opacity', 0);
    const seq = [...hv.map((p) => ({ d: p.d, h: p.v, src: p.source })), ...(fc ? months.map((m, i) => ({ d: m, b: fc.bands[i] })) : [])];
    const bis = d3.bisector((p) => p.d).center;
    svg.append('rect').attr('x', left).attr('y', 0).attr('width', Math.max(0, W - left - right)).attr('height', H - 30).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        if (!seq.length) return; const p = seq[bis(seq, x.invert(d3.pointer(ev)[0]))]; rule.attr('x1', x(p.d)).attr('x2', x(p.d)).attr('opacity', 1);
        showTip(ev, (t) => {
          if (p.h != null) { t.appendChild(el('div', 'k', dayFmt(p.d))); tipRow(t, css('--fg'), 'Actual', fmt(p.h)); if (p.src) tipNote(t, 'Source: ' + p.src); }
          else { t.appendChild(el('div', 'k', d3.utcFormat('%b %Y')(p.d) + ' · forecast')); tipRow(t, color, 'Middle', fmt(p.b[2])); tipRow(t, color, 'Half of outcomes', `${fmt(p.b[1])} – ${fmt(p.b[3])}`); tipRow(t, color, '8 in 10 outcomes', `${fmt(p.b[0])} – ${fmt(p.b[4])}`); }
        });
      }).on('pointerleave', () => { rule.attr('opacity', 0); hideTip(); });
    if (legend) {
      legend.replaceChildren();
      const item = (cls, txt, col) => { const s2 = el('span'); const i2 = el('i', cls); if (col) i2.style.setProperty('--c', col); s2.append(i2, document.createTextNode(txt)); legend.appendChild(s2); };
      if (hv.length) item('lg-line', 'Actual', css('--fg'));
      if (fc) { item('lg-mid', 'Forecast, middle', color); item('lg-band2', 'Half of outcomes', color); item('lg-band', '8 in 10 outcomes', color); if (fc.others.length) item('lg-dash', 'Other scenarios', css('--muted')); }
    }
    drawIn(box);
  }
  function fcData(X, mat, scen, includeOthers = true) {
    if (!X || !X.results || !X.results[scen] || !X.results[scen][mat]) return null;
    const sc = X.scenarios.find((s) => s.id === scen);
    return { asof: X.asof, months: X.months.map(parse), now: X.now[mat], bands: X.results[scen][mat].bands, name: sc.name,
      others: includeOthers ? X.scenarios.filter((s) => s.id !== scen).map((s) => ({ name: s.name, color: css(OL_COL[s.id]), mids: X.results[s.id][mat].bands.map((b) => b[2]) })) : [] };
  }
  function fullUi() {
    let ov = $('#fx-overlay'); if (ov) return ov;
    ov = el('div', 'fx-overlay'); ov.id = 'fx-overlay'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'fx-title');
    ov.innerHTML = `<div class="fx-sheet" tabindex="-1">
      <div class="fx-top"><div><p class="ch-eyebrow" id="fx-eyebrow"></p><h2 id="fx-title"></h2><p class="sub" id="fx-sub"></p></div><button type="button" class="fx-close" aria-label="Close">✕</button></div>
      <div class="ol-mats" id="fx-chips" role="group" aria-label="Series"></div>
      <div class="fx-controls"><div class="seg" id="fx-range" role="group" aria-label="Time range"></div>
        <label class="fx-switch"><input type="checkbox" id="fx-fc"><span class="tr" aria-hidden="true"></span><span>Show forecast</span></label></div>
      <div class="fx-scenwrap" id="fx-scenwrap" hidden><div class="seg ol-scen" id="fx-scen" role="group" aria-label="Scenario"></div><p class="ol-say" id="fx-say"></p></div>
      <div class="chart fx-chart" id="fx-chart"></div>
      <div class="ol-legend" id="fx-legend"></div>
      <p class="sub fx-note" id="fx-note"></p>
      <div id="fx-tablewrap" hidden><div class="table-wrap"><table class="rtable otable yrs" id="fx-years"></table></div><ul class="ol-odds" id="fx-odds"></ul>
        <p class="sub">Ranges, not predictions: a model of the price history around published forecasts, rerun every night. <a href="#risk" id="fx-how">How the forecast works →</a></p></div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeFull(); });
    $('.fx-close', ov).addEventListener('click', closeFull);
    $('#fx-fc', ov).addEventListener('change', (e) => { FC.fc = e.target.checked; drawFull(); });
    $('#fx-how', ov).addEventListener('click', (e) => { e.preventDefault(); closeFull(); go('risk'); setTimeout(() => { const o = $('#outlook'); if (o) o.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }, 120); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) closeFull(); });
    return ov;
  }
  function openFull(keys, key, eyebrow, opener) {
    loadHistory(); const ov = fullUi(); FC.keys = keys; FC.key = key || keys[0]; FC.opener = opener || document.activeElement;
    $('#fx-eyebrow').textContent = eyebrow || '';
    ov.hidden = false; document.documentElement.classList.add('fx-open');
    requestAnimationFrame(() => ov.classList.add('on'));
    ensureScen(drawFull); drawFull();
    $('.fx-close', ov).focus();
  }
  function closeFull() {
    const ov = $('#fx-overlay'); if (!ov || ov.hidden) return;
    ov.classList.remove('on'); hideTip();
    const done = () => { ov.hidden = true; document.documentElement.classList.remove('fx-open'); if (FC.opener && FC.opener.focus) FC.opener.focus(); };
    if (reduced()) done(); else setTimeout(done, 220);
  }
  function drawFull() {
    const ov = $('#fx-overlay'); if (!ov || ov.hidden) return;
    const sr = FC_SERIES[FC.key]; const X = D.scen;
    $('#fx-title').textContent = sr.name; $('#fx-sub').textContent = sr.sub;
    const chips = $('#fx-chips'); chips.replaceChildren(); chips.hidden = FC.keys.length < 2;
    FC.keys.forEach((k) => { const b = el('button', 'ol-chip', FC_SERIES[k].name); b.type = 'button'; b.setAttribute('aria-pressed', String(k === FC.key)); b.addEventListener('click', () => { FC.key = k; drawFull(); }); chips.appendChild(b); });
    const rg = $('#fx-range'); rg.replaceChildren();
    [['1Y', 366], ['3Y', 1096], ['5Y', 1827], ['All', 0]].forEach(([l, dd]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', String(FC.range === dd)); b.addEventListener('click', () => { FC.range = dd; drawFull(); }); rg.appendChild(b); });
    const can = !!(sr.mat && X && X.results && X.results.base[sr.mat]);
    const sw = $('#fx-fc'); sw.disabled = !can; sw.checked = can && FC.fc; sw.closest('.fx-switch').classList.toggle('off', !can);
    const show = can && FC.fc;
    $('#fx-scenwrap').hidden = !show; $('#fx-tablewrap').hidden = !show;
    if (show) {
      const sg = $('#fx-scen'); sg.replaceChildren();
      X.scenarios.forEach((s) => { const b = el('button', null, s.name); b.type = 'button'; b.setAttribute('aria-pressed', String(FC.scen === s.id)); b.addEventListener('click', () => { FC.scen = s.id; drawFull(); }); sg.appendChild(b); });
      const sc = X.scenarios.find((s) => s.id === FC.scen); const say = $('#fx-say'); say.replaceChildren(); const dot = el('i', 'ol-dot'); dot.style.background = css(OL_COL[sc.id]); say.append(dot, el('b', null, sc.short + '. '), document.createTextNode(sc.say));
      olYears($('#fx-years'), X, { id: sr.mat, fmt: sr.fmt, unit: sr.unit }, FC.scen, $('#fx-odds'));
    }
    const hist = sr.hist();
    fcChart($('#fx-chart'), { hist, fmt: sr.fmt, rangeDays: FC.range, fc: show ? fcData(X, sr.mat, FC.scen) : null, color: css(OL_COL[FC.scen]), legend: $('#fx-legend'), height: Math.max(300, Math.min(440, window.innerHeight * 0.46)) });
    const notes = [];
    if (sr.note) notes.push(sr.note);
    if (!sr.mat) notes.push('No forecast for packs and storage systems yet: the outlook model covers lithium, copper, aluminium, LFP cathode and cells.');
    else if (!X && D.scen === null) notes.push('The forecast could not be loaded right now.');
    else if (!X) notes.push('Loading the forecast…');
    if (show && FC.key === 'lithium') notes.push('History is the Guangzhou futures price, the same basis as the forecast.');
    if (!show && hist.length && FC.range && +hist[0].d > +new Date(Date.now() - FC.range * 864e5) + 45 * 864e5) notes.push(`Readings start ${d3.utcFormat('%b %Y')(hist[0].d)}${FC.key === 'lithium' ? ' (the Guangzhou contract began trading then)' : ''}.`);
    $('#fx-note').textContent = notes.join(' ');
  }
  window.addEventListener('resize', () => { const ov = $('#fx-overlay'); if (ov && !ov.hidden) { clearTimeout(drawFull.t); drawFull.t = setTimeout(drawFull, 150); } });
  function expandBtn(sec, keys, key, eyebrow, label = 'Full chart & forecast') {
    const b = el('button', 'chp-expand'); b.type = 'button'; b.append(document.createTextNode(label + ' '), el('span', null, '⤢'));
    b.addEventListener('click', () => openFull(keys, key, eyebrow, b));
    const h = $('.chp-h', sec); if (h) { const row = el('div', 'chp-hrow'); h.replaceWith(row); row.append(h, b); } else sec.appendChild(b);
    return b;
  }
  function renderChain() {
    const box = $('#chain-page'); if (!box) return;
    const i = Math.max(0, CHAIN.findIndex((c) => c.id === S.chain)); const c = CHAIN[i];
    box.replaceChildren(); box.style.setProperty('--cc', css(c.color));
    // step switcher
    const nav = el('nav', 'ch-switch'); nav.setAttribute('aria-label', 'Value chain steps');
    CHAIN.forEach((x) => { const b = el('button', null); b.type = 'button'; b.style.setProperty('--cc', css(x.color)); b.setAttribute('aria-current', String(x.id === c.id)); b.append(el('span', 'n', x.n), document.createTextNode(x.name)); b.addEventListener('click', () => go('chain/' + x.id)); nav.appendChild(b); });
    box.appendChild(nav);
    // hero
    const k = chainKey(c);
    const hero = el('header', 'chp-hero rv');
    const orb = el('span', 'ch-orb big'); orb.appendChild(svgIcon(c.icon, 40));
    const ht = el('div'); ht.append(el('p', 'ch-eyebrow', `Step ${c.n} · ${c.name}`), el('h2', 'chp-title', c.title), el('p', 'chp-say', c.say));
    hero.append(orb, ht);
    if (k) { const kv = el('div', 'chp-key'); kv.append(el('span', 'l', k.label), el('b', null, k.value + (k.unit || '')), el('span', 'm' + dirClass(k.dir), k.move)); hero.appendChild(kv); }
    box.appendChild(hero);
    const section = (t, sub) => { const s = el('section', 'chp-sec rv'); s.appendChild(el('h3', 'chp-h', t)); if (sub) s.appendChild(el('p', 'sub', sub)); box.appendChild(s); return s; };
    if (c.chart) {
      const s = section(c.chart === 'tenders' ? 'India storage tenders over time' : 'Price history', c.chart === 'tenders' ? 'Lowest winning bid of each tender, ₹ lakh per MW per month. Click a dot to open its source.' : 'Hover the chart for each reading and its source.');
      const cb = el('div', 'chart');
      const pts = (rows, key) => rows.map((r) => ({ d: parse(r.date), v: +r[key], source: r.source || 'InfoLink' })).filter((p) => p.v > 0);
      const draw = () => {
        const o = { rangeDays: S.range.chain };
        if (c.chart === 'lithium') timeChart(cb, [{ name: 'Futures', color: css('--l1'), points: futHist(), since: FUT_SINCE() }, { name: 'Spot', color: css('--l4'), points: spotPts() }], { fmt: fmtUsd0, ...o });
        else if (c.chart === 'cells') timeChart(cb, [{ name: '314 Ah storage', color: css('--l2'), points: pts([...(D.cell314 || [])].sort((x, y) => d3.ascending(x.date, y.date)), 'usd_kwh') }, { name: 'EV cell', color: css('--l5'), points: pts((D.evcells || {}).series || [], 'usd_kwh') }], { fmt: fmtUsd1, ...o });
        else if (c.chart === 'systems') timeChart(cb, [{ name: '2-hour AC', color: css('--l1'), points: pts(weekly(), 'ac_2h') }, { name: '4-hour AC', color: css('--l3'), points: pts(weekly(), 'ac_4h') }, { name: '2-hour DC block', color: css('--l5'), points: pts(weekly(), 'dc_2h') }], { fmt: fmtUsd1, ...o });
      };
      if (c.chart !== 'tenders') { const sg = el('div', 'seg chp-range'); sg.dataset.rangeFor = 'chain'; sg.setAttribute('role', 'group'); sg.setAttribute('aria-label', 'Time range'); s.appendChild(sg); rangeSeg('chain', draw); }
      s.appendChild(cb); draw();
      const FK = { lithium: ['lithium', 'copper', 'aluminium'], cells: ['cell_ess', 'cell_ev'], systems: ['sys4', 'sys2', 'dc2'] }[c.chart];
      if (FK) {
        const eb = `Step ${c.n} · ${c.name}`;
        expandBtn(s, FK, FK[0], eb, c.chart === 'systems' ? 'Full chart' : 'Full chart & forecast');
        cb.classList.add('zoomable'); cb.title = 'Click for the full chart' + (c.chart === 'systems' ? '' : ' and forecast');
        cb.addEventListener('click', () => openFull(FK, FK[0], eb, cb));
      }
      if (c.id === 'mining' && ((D.hist || {}).copper || []).length) {
        const ms = section('Copper and aluminium', 'LME cash settlement, US$ per tonne. Copper goes into anode foil and cables, aluminium into cathode foil, casings and racks.');
        const sg = el('div', 'seg chp-range'); sg.dataset.rangeFor = 'metals'; sg.setAttribute('role', 'group'); sg.setAttribute('aria-label', 'Time range'); ms.appendChild(sg);
        const mb = el('div', 'chart'); ms.appendChild(mb);
        const drawM = () => timeChart(mb, [{ name: 'Copper', color: css('--l1'), points: D.hist.copper }, { name: 'Aluminium', color: css('--l4'), points: D.hist.aluminium }], { fmt: fmtUsd0, rangeDays: S.range.metals, height: 280 });
        rangeSeg('metals', drawM); drawM();
        expandBtn(ms, ['copper', 'aluminium', 'lithium'], 'copper', `Step ${c.n} · ${c.name}`);
        mb.classList.add('zoomable'); mb.title = 'Click for the full chart and forecast'; mb.addEventListener('click', () => openFull(['copper', 'aluminium', 'lithium'], 'copper', `Step ${c.n} · ${c.name}`, mb));
        const src = el('p', 'sub'); const a = el('a', null, 'Westmetall (LME cash settlement)'); a.href = 'https://www.westmetall.com/en/markdaten.php'; a.target = '_blank'; a.rel = 'noopener'; src.append(document.createTextNode('Source: '), a, document.createTextNode('. Refreshed every night.')); ms.appendChild(src);
      }
      else if (c.chart === 'tenders') { tenderChart(cb, stTenders()); const lg = el('div', 'tlegend'); [['--blue', '2-hour'], ['--orange', '4-hour']].forEach(([cc, t]) => { const x = el('span'); const i2 = el('i', 'dt'); i2.style.background = css(cc); x.append(i2, document.createTextNode(t)); lg.appendChild(x); }); s.appendChild(lg); }
    }
    if (c.id === 'materials') {
      const s = section('LFP cathode: where the price could go', 'Base scenario to late 2029, worked out from lithium and the site\u2019s cost model. Click for scenarios and the yearly ranges.');
      const cb = el('div', 'chart zoomable'); s.appendChild(cb); cb.title = 'Click for the full forecast';
      const eb = `Step ${c.n} · ${c.name}`;
      expandBtn(s, ['cathode', 'lithium'], 'cathode', eb, 'Full forecast');
      cb.addEventListener('click', () => { FC.fc = true; openFull(['cathode', 'lithium'], 'cathode', eb, cb); });
      const lg = el('div', 'ol-legend'); s.appendChild(lg);
      ensureScen(() => { if (!cb.isConnected) return; const f = fcData(D.scen, 'cathode', 'base', false); if (f) fcChart(cb, { hist: [], fmt: fmtUsd0, fc: f, color: css('--l2'), legend: lg, height: 240, compact: true }); else cb.appendChild(el('div', 'empty', 'The outlook is not available yet.')); });
    }
    // prices
    const steps = allPrices();
    const rows = c.flow.flatMap((f) => (steps[f] || {}).rows || []);
    if (rows.length) {
      const s = section('Prices', 'Latest public price for each item, in US$ excluding VAT.');
      const g = el('div', 'chp-prices');
      rows.forEach((r) => {
        const card = el('div', 'chp-card');
        const pr = el('div', 'pp'); pr.append(el('span', 'v', r.price), el('span', 'u', UNIT_SHORT[r.unit] || (r.unit ? ' ' + r.unit : '')));
        card.append(el('div', 'pn', r.name), pr);
        if (r.move) card.appendChild(el('span', 'chip' + dirClass(r.direction), r.move));
        const meta = el('div', 'pm'); meta.append(document.createTextNode(r.asof + ' · '), link(r.source, r.url)); card.appendChild(meta);
        if (r.chart) { const b = el('button', 'btn link small', 'Price history →'); b.type = 'button'; b.addEventListener('click', () => go('materials/' + r.chart)); card.appendChild(b); }
        g.appendChild(card);
      });
      s.appendChild(g);
    }
    if (c.id === 'cells') { const s = section('How much cell makers keep', 'Cost to make a 314 Ah cell from today\'s material prices, against its market price.'); const mb = el('div'); s.appendChild(mb); renderMargin(mb); const lk = el('button', 'btn link', 'Cost calculator →'); lk.type = 'button'; lk.addEventListener('click', () => go('calculator')); s.appendChild(lk); }
    if (c.id === 'systems') { const s = section('Landed in India', 'China price plus freight, insurance and Indian duty, at today\'s rupee rate.'); const lb = el('div'); s.appendChild(lb); renderLandedOverview(lb); const lk = el('button', 'btn link', 'Change the assumptions →'); lk.type = 'button'; lk.addEventListener('click', () => go('calculator')); s.appendChild(lk); }
    if (c.id === 'enduse') {
      const s = section('India storage tenders', 'What state utilities pay the project owner each month for every MW of storage, for 12–15 years. Lowest winning bid of the latest tenders.');
      const g = el('div', 'chp-prices');
      stTenders().slice(-4).reverse().forEach((t) => {
        const card = el('div', 'chp-card');
        const pr = el('div', 'pp'); pr.append(el('span', 'v', `₹${t.low}`), el('span', 'u', ' lakh/MW/month'));
        card.append(el('div', 'pn', t.label), pr, el('span', 'chip', `${t.hours}-hour · ${t.state}`));
        const meta = el('div', 'pm'); meta.append(document.createTextNode(d3.utcFormat('%-d %b %Y')(parse(t.date)) + ' · '), link(t.source, t.url)); card.appendChild(meta);
        g.appendChild(card);
      });
      s.appendChild(g);
      const b = el('button', 'btn link', 'All India storage tenders and project costs →'); b.type = 'button'; b.addEventListener('click', () => go('storage')); s.appendChild(b);
    }
    // risk
    const R = D.risk; const mats = c.risk.map((id) => ((R || {}).materials || []).find((m) => m.id === id)).filter(Boolean);
    if (mats.length) {
      const s = section('Risk', 'Risk navigator scores for the next 3 months, 0–10 (higher is riskier for a buyer).');
      const g = el('div', 'chp-risk');
      mats.forEach((m) => {
        const b = el('button', 'chp-rcard'); b.type = 'button';
        b.append(el('b', null, m.short));
        const r1 = el('span', 'rr'); r1.append(el('span', 'l', 'Price'), riskChip(m.h3.price)); const r2 = el('span', 'rr'); r2.append(el('span', 'l', 'Supply'), riskChip(m.h3.supply));
        b.append(r1, r2); b.addEventListener('click', () => { RISK.sel = m.id; go('risk'); }); g.appendChild(b);
      });
      s.appendChild(g);
    }
    // dates and rule changes for this step
    const cu = comingUp(c.id, 5);
    if (cu.length) { const s = section('Coming up', 'Dates and rule changes that concern this step.'); const ul = el('ul', 'dates'); s.appendChild(ul); datesList(ul, cu); }
    // news
    const ns = sortedNews().filter((n) => c.cats.includes(n.category)).slice(0, 6);
    if (ns.length) {
      const s = section('News', null);
      const ul = el('ul', 'newslist compact'); ns.forEach((n) => ul.appendChild(newsItem(n))); s.appendChild(ul);
      const b = el('button', 'btn link', 'All news →'); b.type = 'button'; b.addEventListener('click', () => { S.news.cat = ''; go('news'); }); s.appendChild(b);
    }
    // previous / next
    const pn = el('div', 'chp-pn');
    if (i > 0) { const b = el('button', 'chp-prev'); b.type = 'button'; b.append(el('small', null, '← Previous'), el('b', null, CHAIN[i - 1].name)); b.addEventListener('click', () => go('chain/' + CHAIN[i - 1].id)); pn.appendChild(b); } else pn.appendChild(el('span'));
    if (i < CHAIN.length - 1) { const b = el('button', 'chp-next'); b.type = 'button'; b.append(el('small', null, 'Next →'), el('b', null, CHAIN[i + 1].name)); b.addEventListener('click', () => go('chain/' + CHAIN[i + 1].id)); pn.appendChild(b); }
    box.appendChild(pn);
    { const rp = !S.resizing; requestAnimationFrame(() => reveal(box, rp)); }
  }

  // ---------- tabs ----------
  const RENDER = { overview: renderOverview, materials: renderMaterialsPage, news: renderNews, calculator: () => { renderCalc(); renderLanded(); }, storage: renderStorage, chain: renderChain, risk: renderRisk, rules: renderRules, brief: renderBrief };
  function go(route, push = true) {
    const path = String(route || 'overview').split('?')[0];
    let [tab, sub] = (LEGACY[path] || path).split('/');
    if (!TABS.includes(tab)) tab = 'overview';
    if (tab === 'materials' && SUBS.includes(sub)) S.sub = sub;
    if (tab === 'chain' && sub) S.chain = sub;
    S.tab = tab; hideTip();
    if (tab === 'chain' || tab === 'materials') loadHistory(); // long histories only where a chart uses them
    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === (tab === 'chain' || tab === 'storage' || tab === 'materials' ? 'overview' : tab))));
    $$('.subpage').forEach((p) => { p.hidden = p.dataset.sub !== S.sub; });
    $$('#page-materials .subnav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === S.sub)));
    if (push) { try { history.replaceState(null, '', '#' + (tab === 'materials' && S.sub !== 'all' ? 'materials/' + S.sub : tab === 'chain' ? 'chain/' + (S.chain || 'mining') : tab)); } catch (e) { /* ignore */ } }
    try { pageHero(tab); RENDER[tab](); pageHero(tab); if (tab === 'rules') renderRules(); } catch (e) { console.error(e); }
    if (tab === 'news' || tab === 'rules') visitSeenTab(tab);
    if (tab !== 'overview' && tab !== 'chain') { // every other page: panels rise in like the overview (off for reduced motion)
      const pg = $(`#page-${tab}`);
      if (pg) { $$(':scope > .panel, :scope > .pg-card, :scope > .subpage > .panel, :scope > .calc-simple > .panel, :scope > .risk-grid > .panel', pg).forEach((n) => n.classList.add('rv')); const rp = !S.resizing; requestAnimationFrame(() => reveal(pg, rp)); }
    }
    if (push) window.scrollTo({ top: 0 });
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $$('#page-materials .subnav button').forEach((b) => b.addEventListener('click', () => go('materials/' + b.dataset.sub)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));

  // ---------- inputs ----------
  $('#news-search').addEventListener('input', (e) => { S.news.q = e.target.value; renderNews(); });
  $('#news-effect').addEventListener('change', (e) => { S.news.effect = e.target.value; renderNews(); });

  // ---------- CSV ----------
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.csv; const rows = key === 'indiatenders' ? ((D.indiastorage || {}).tenders || []) : key === 'tenders' ? ((D.tenders || {}).rows || []) : key === 'evseries' ? ((D.evcells || {}).series || []) : key === 'allprices' ? allPrices().flatMap((st) => st.rows.map(({ chart, ...r }) => r)) : D[key] || []; if (!rows.length) return;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `leybatt-pulse-${key}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }));

  // ---------- theme ----------
  const themes = ['light', 'dark'];
  let theme = store.get('bmi-theme') || 'light';
  if (!themes.includes(theme)) theme = 'light'; // older 'auto' choice falls back to light
  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', theme);
    $('#theme-btn').textContent = 'Theme: ' + theme[0].toUpperCase() + theme.slice(1);
  };
  $('#theme-btn').addEventListener('click', () => { theme = themes[(themes.indexOf(theme) + 1) % 2]; store.set('bmi-theme', theme); applyTheme(); go(S.tab, false); });
  applyTheme();

  let rt, rw = window.innerWidth; window.addEventListener('resize', () => { // width changes only: phones fire resize while scrolling
    if (Math.abs(window.innerWidth - rw) < 2) return; rw = window.innerWidth;
    clearTimeout(rt); rt = setTimeout(() => { S.resizing = true; try { go(S.tab, false); } finally { S.resizing = false; } }, 150);
  });

  // ---------- load ----------
  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then((res) => {
      FILES.forEach((f, i) => { D[f] = res[i]; });
      visitInit();
      renderHeader();
      go(location.hash.slice(1) || 'overview', false);
      startFresh();
    });
  // long price histories, refreshed nightly by GitHub: lithium futures (since Jul 2023), LME copper and aluminium (since 2018), ECB rates
  function loadHistory() {
    if (loadHistory.started) return; loadHistory.started = true;
    const get = (n) => fetch(`data/history/${n}.csv`, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    Promise.all(['lithium_futures', 'copper', 'aluminium', 'fx'].map(get)).then(([li, cu, al, fx]) => {
      const rows = (t) => (t || '').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r.length > 1 && /^\d{4}-/.test(r[0]));
      const rates = rows(fx).map((r) => [r[0], +r[2]]).filter((r) => r[1] > 1).sort((a, b) => d3.ascending(a[0], b[0]));
      let i = 0; const rateOn = (day) => { while (i + 1 < rates.length && rates[i + 1][0] <= day) i++; return rates[i] && rates[i][0] <= day ? rates[i][1] : null; };
      const lith = [];
      rows(li).sort((a, b) => d3.ascending(a[0], b[0])).forEach((r) => { const k = rateOn(r[0]); if (k && +r[1] > 0) lith.push({ d: parse(r[0]), v: Math.round(+r[1] / k), source: 'Guangzhou Futures Exchange daily close (via Sina Finance), converted at the ECB rate' }); });
      const lme = (t) => rows(t).map((r) => ({ d: parse(r[0]), v: +r[1], source: r[2] || 'LME cash settlement' })).filter((p) => p.v > 0).sort((a, b) => a.d - b.d);
      D.hist = { lithium: lith, copper: lme(cu), aluminium: lme(al) };
      if (S.tab === 'chain' || S.tab === 'materials') { S.resizing = true; try { RENDER[S.tab](); } finally { S.resizing = false; } }
      if (typeof drawFull === 'function') drawFull();
    });
  }
})();
