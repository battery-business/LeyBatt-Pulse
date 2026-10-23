(() => {
  'use strict';
  const FILES = ['meta', 'latest', 'lithium', 'cell314', 'cellbids', 'systems', 'rawmats', 'news', 'weekly', 'marketshare', 'forecasts', 'costmodel', 'evcells'];
  const VAT = 1.13;
  const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['All', 0]];
  const TABS = ['overview', 'materials', 'news', 'calculator'];
  const SUBS = ['all', 'lithium', 'cells', 'systems'];
  const LEGACY = { lithium: 'materials/lithium', cells: 'materials/cells', systems: 'materials/systems' };
  const LAYER_COLOR = { lithium: '--amber', cathode: '--plum', cell314: '--blue', cell587: '--teal', evcell: '--magenta', pack: '--green', system: '--indigo' };
  const CAT_COLOR = { 'Lithium & materials': '--amber', 'Cell makers & competitors': '--blue', 'Packs & BMS': '--orange', 'R&D & new products': '--teal', 'Energy storage': '--indigo', 'EV market': '--green', 'India BESS': '--rose', 'India EV & battery makers': '--magenta', 'Regulation & trade': '--plum' };
  const catColor = (c) => css(CAT_COLOR[c] || '--slate');
  const CARD_TAB = { lithium: 'materials/lithium', cathode: 'materials/all', cell314: 'materials/cells', cell587: 'materials/cells', evcell: 'materials/cells', pack: 'materials/all', system: 'materials/systems' };

  const D = {};
  const S = {
    tab: 'overview',
    range: { lithium: 0, cell: 0, sysweekly: 0 },
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
  function timeChart(box, series, { fmt, rangeDays = 0, height = 300, band = false }) {
    box.replaceChildren();
    const all = series.flatMap((s) => s.points);
    if (!all.length) { box.appendChild(el('div', 'empty', 'Nothing to show. Turn a series back on.')); return; }
    const maxD = d3.max(all, (p) => p.d);
    const cutoff = rangeDays ? new Date(+maxD - rangeDays * 864e5) : new Date(-8.64e15);
    const vis = series.map((s) => ({ ...s, points: s.points.filter((p) => p.d >= cutoff).sort((a, b) => a.d - b.d) })).filter((s) => s.points.length);
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
    svg.append('g').attr('transform', `translate(0,${H - 30})`).call(d3.axisBottom(xS).ticks(Math.max(2, Math.floor((W - left - right) / 90))).tickFormat(d3.utcFormat(span < 120 ? '%-d %b' : '%b %y')).tickSize(0).tickPadding(10)).call(axisStyle);
    svg.append('line').attr('x1', left).attr('x2', W - right).attr('y1', H - 30).attr('y2', H - 30).attr('stroke', css('--axis'));
    const r = pts.length > 60 ? 2.5 : 3.5;
    const labels = [];
    vis.forEach((s) => {
      if (band) {
        const bp = s.points.filter((p) => p.lo != null && p.hi != null);
        if (bp.length > 1) svg.append('path').datum(bp).attr('fill', s.color).attr('fill-opacity', 0.12).attr('d', d3.area().x((p) => xS(p.d)).y0((p) => yS(p.lo)).y1((p) => yS(p.hi)));
      }
      svg.append('path').datum(s.points).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', d3.line().x((p) => xS(p.d)).y((p) => yS(p.v)));
      svg.append('g').selectAll('circle').data(s.points).join('circle').attr('cx', (p) => xS(p.d)).attr('cy', (p) => yS(p.v)).attr('r', r).attr('fill', s.color).attr('stroke', css('--panel')).attr('stroke-width', 1.2);
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

  function spark(container, values, color) {
    if (!values || values.length < 2) return;
    const W = 160, H = 30;
    const x = d3.scaleLinear([0, values.length - 1], [2, W - 4]);
    const y = d3.scaleLinear(d3.extent(values), [H - 3, 3]);
    const svg = d3.select(container).append('svg').attr('class', 'spark').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'none').attr('width', '100%').attr('height', H).attr('aria-hidden', 'true');
    svg.append('path').attr('d', d3.line().x((_, i) => x(i)).y((v) => y(v))(values)).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.6).attr('vector-effect', 'non-scaling-stroke');
    svg.append('circle').attr('cx', x(values.length - 1)).attr('cy', y(values[values.length - 1])).attr('r', 2.6).attr('fill', color);
  }

  // ---------- derived data ----------
  const futPts = () => (D.lithium || []).filter((r) => r.series === 'Futures').map((r) => ({ d: parse(r.date), v: +r.usd_t, source: r.source, note: r.note })).sort((a, b) => a.d - b.d);
  const spotPts = () => (D.lithium || []).filter((r) => r.series === 'Spot').map((r) => ({ d: parse(r.date), v: +r.usd_t, source: r.source, note: r.note, url: r.url })).sort((a, b) => a.d - b.d);
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
    $('#news-count').textContent = (D.news || []).length || '';
    renderTicker();
  }
  // navy price strip under the header: the headline prices, newest moves, one click to their chart
  function renderTicker() {
    const box = $('#ticker'); if (!box) return; box.replaceChildren();
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const cu = (D.rawmats || []).find((r) => r.material === 'Copper');
    const items = [['lithium', 'Lithium'], ['cathode', 'LFP cathode'], ['cell314', '314 Ah cell'], ['evcell', 'EV cell'], ['system', '4-h system']]
      .filter(([id]) => L[id]).map(([id, name]) => ({ name, r: L[id], to: CARD_TAB[id] }));
    if (cu) items.push({ name: 'Copper', r: cu, to: 'materials' });
    items.forEach(({ name, r, to }) => {
      const b = el('button', 'tick'); b.type = 'button'; b.title = `${r.move || ''} · ${r.asof} · ${r.source}`;
      const m = String(r.move || '').match(/([+−-]?\d+(?:\.\d+)?)%/);
      const dir = r.direction === 'down' ? 'is-down' : r.direction === 'up' ? 'is-up' : 'is-flat';
      const arrow = r.direction === 'down' ? '▼' : r.direction === 'up' ? '▲' : '';
      const unit = { 'per tonne': '/t', 'per kWh': '/kWh', 'per m²': '/m²' }[r.unit] || '';
      b.append(el('span', 'tn', name), el('span', 'tv', r.price + unit), el('span', 'tc ' + dir, m ? `${arrow}${m[1].replace(/^[+−-]/, '')}%` : '–'));
      b.addEventListener('click', () => go(to));
      box.appendChild(b);
    });
  }

  function renderOverview() {
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const take = $('#takeaway');
    if (L.lithium && L.cell314 && L.system) {
      take.replaceChildren(document.createTextNode('Lithium carbonate futures are at '), el('b', null, L.lithium.price), document.createTextNode(` a tonne (${L.lithium.move}), while 314 Ah storage cells sit at `), el('b', null, L.cell314.price), document.createTextNode(`/kWh (${L.cell314.move}) and China 4-hour systems at `), el('b', null, L.system.price), document.createTextNode(`/kWh (${L.system.move}).`));
    }
    const sparks = { evcell: ((D.evcells || {}).series || []).map((r) => r.usd_kwh), lithium: futPts().map((p) => p.v), cell314: weekly().map((w) => w.cell314), system: (D.systems || []).map((r) => +r.usd_kwh) };
    const cards = $('#cards'); cards.replaceChildren();
    (D.latest || []).forEach((r) => {
      const c = el('button', 'card layer-' + r.id); c.type = 'button'; c.id = 'card-' + r.id; c.title = 'Open its prices';
      c.append(el('span', 'layer', r.layer), el('span', 'label', r.label), el('span', 'price', r.price), el('span', 'unit', `${r.unit} · ${r.asof}`), el('span', 'move' + dirClass(r.direction), r.move));
      if (sparks[r.id]) spark(c, sparks[r.id], css(LAYER_COLOR[r.id] || '--slate'));
      c.appendChild(el('span', 'src', 'Source: ' + r.source));
      c.addEventListener('click', () => go(CARD_TAB[r.id] || 'overview'));
      cards.appendChild(c);
    });
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
    // news preview
    const pv = $('#news-preview'); pv.replaceChildren();
    sortedNews().slice(0, 6).forEach((n) => pv.appendChild(newsItem(n)));
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
      const series = [{ name: 'Futures', color: colors[0], points: futPts() }, { name: 'Spot', color: colors[1], points: spotPts() }].filter((s) => !S.hidden.lithium.has(s.name));
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
    // bids
    const bb = $('#bids-chart');
    try {
      hBars(bb, (D.cellbids || []).map((r) => ({ ...r, usd_kwh: +r.usd_kwh })), { label: 'label', value: 'usd_kwh', fmt: fmtUsd1, color: (r) => (r.kind === '≥500 Ah tender' ? css('--blue') : r.kind === 'List price' ? css('--amber') : css('--chart-muted')), tip: (t, r) => tipNote(t, 'Source: ' + r.source) });
      srcLinks($('#bids-srcs'), D.cellbids);
    } catch (e) { console.error(e); fail(bb); }
    // market share
    const sb = $('#share-chart');
    try {
      const rows = D.marketshare || [];
      if (rows[0]) $('#share-sub').textContent = `Share of China EV battery installations, ${rows[0].period}. Hover for GWh.`;
      hBars(sb, rows, { label: 'maker', value: 'share', fmt: (v) => v.toFixed(1) + '%', color: (r) => (r.maker === 'All others' ? css('--chart-muted') : css('--teal')), tip: (t, r) => tipNote(t, `${r.gwh} GWh installed`) });
      srcLinks($('#share-srcs'), rows);
    } catch (e) { console.error(e); fail(sb); }
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
  function allPrices() {
    const latest = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const raw = Object.fromEntries((D.rawmats || []).map((r) => [r.material, r]));
    const used = new Set();
    const steps = FLOW.map((f) => ({ ...f, rows: f.items.map(([kind, key, name, desc]) => {
      if (kind === 'ev') { const e = evRows()[key]; if (!e) return null; return { name: e.format + ' EV cell', desc: `About ${fmt2(e.perCell).replace('.00', '')} per cell (${e.kwh.toFixed(2)} kWh) at the EV average`, price: fmtUsd1(e.usd_kwh), usd: e.usd_kwh, unit: 'per kWh', asof: e.asof, move: e.move, direction: e.direction, source: e.source, url: e.url, chart: 'cells', step: f.step }; }
      const r = kind === 'latest' ? latest[key] : raw[key]; if (!r) return null; used.add(key);
      return { name, desc, price: r.price, usd: r.usd != null ? r.usd : numOf(r.price), unit: r.unit, asof: r.asof, move: r.move, direction: r.direction, source: r.source, url: r.url, source2: r.source2, url2: r.url2, chart: CHART_OF[key] || null, step: f.step };
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
        const fresh = ageDays(r.asof) <= 10;
        const meta = el('div', 'pm'); const dot = el('i', 'fdot ' + (fresh ? 'fresh' : 'old')); dot.title = fresh ? 'Updated in the last 10 days' : 'Older figure, still the latest public one';
        meta.append(dot, document.createTextNode(r.asof + ' · '), link(r.source, r.url));
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
  function newsItem(n) {
    const li = el('li');
    li.style.setProperty('--cc', catColor(n.category));
    const meta = el('div', 'meta');
    meta.append(el('span', null, n.day), el('span', 'tag', n.category || 'News'), el('span', 'chip' + dirClass(n.direction), n.effect));
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
    $('#news-status').textContent = `Showing ${list.length} of ${all.length} stories, newest first.`;
    const ul = $('#news-list'); ul.replaceChildren();
    if (!list.length) ul.appendChild(el('li', 'empty', 'No stories match. Clear the search or pick another category.'));
    list.forEach((n) => ul.appendChild(newsItem(n)));
  }

  // ---------- tabs ----------
  const RENDER = { overview: renderOverview, materials: renderMaterialsPage, news: renderNews, calculator: renderCalc };
  function go(route, push = true) {
    const path = String(route || 'overview').split('?')[0];
    let [tab, sub] = (LEGACY[path] || path).split('/');
    if (!TABS.includes(tab)) tab = 'overview';
    if (tab === 'materials' && SUBS.includes(sub)) S.sub = sub;
    S.tab = tab; hideTip();
    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.subpage').forEach((p) => { p.hidden = p.dataset.sub !== S.sub; });
    $$('.subnav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === S.sub)));
    if (push) { try { history.replaceState(null, '', '#' + (tab === 'materials' && S.sub !== 'all' ? 'materials/' + S.sub : tab)); } catch (e) { /* ignore */ } }
    try { RENDER[tab](); } catch (e) { console.error(e); }
    if (push) window.scrollTo({ top: 0 });
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $$('.subnav button').forEach((b) => b.addEventListener('click', () => go('materials/' + b.dataset.sub)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));

  // ---------- inputs ----------
  $('#news-search').addEventListener('input', (e) => { S.news.q = e.target.value; renderNews(); });
  $('#news-effect').addEventListener('change', (e) => { S.news.effect = e.target.value; renderNews(); });

  // ---------- CSV ----------
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.csv; const rows = key === 'evseries' ? ((D.evcells || {}).series || []) : key === 'allprices' ? allPrices().flatMap((st) => st.rows.map(({ chart, ...r }) => r)) : D[key] || []; if (!rows.length) return;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `battery-monitor-${key}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }));

  // ---------- theme ----------
  const themes = ['light', 'dark', 'auto'];
  let theme = store.get('bmi-theme') || 'light';
  if (!themes.includes(theme)) theme = 'light';
  const applyTheme = () => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    $('#theme-btn').textContent = 'Theme: ' + theme[0].toUpperCase() + theme.slice(1);
  };
  $('#theme-btn').addEventListener('click', () => { theme = themes[(themes.indexOf(theme) + 1) % 3]; store.set('bmi-theme', theme); applyTheme(); go(S.tab, false); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => go(S.tab, false));
  applyTheme();

  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => go(S.tab, false), 150); });

  // ---------- load ----------
  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then((res) => {
      FILES.forEach((f, i) => { D[f] = res[i]; });
      renderHeader();
      go(location.hash.slice(1) || 'overview', false);
    });
})();
