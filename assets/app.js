(() => {
  'use strict';
  const FILES = ['meta', 'latest', 'lithium', 'cell314', 'cellbids', 'systems', 'rawmats', 'news', 'weekly', 'marketshare', 'forecasts'];
  const VAT = 1.13;
  const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['All', 0]];
  const TABS = ['overview', 'lithium', 'cells', 'materials', 'news', 'calculator'];
  const LAYER_COLOR = { lithium: '--amber', cathode: '--plum', cell314: '--blue', cell587: '--teal', pack: '--green', system: '--indigo' };
  const CAT_COLOR = { 'Lithium & materials': '--amber', 'Cell makers & competitors': '--blue', 'Energy storage': '--indigo', 'EV market': '--green', 'India': '--rose', 'Regulation & trade': '--plum', 'Technology': '--teal' };
  const catColor = (c) => css(CAT_COLOR[c] || '--slate');
  const CARD_TAB = { lithium: 'lithium', cathode: 'materials', cell314: 'cells', cell587: 'cells', pack: 'cells', system: 'cells' };

  const D = {};
  const S = {
    tab: 'overview',
    range: { lithium: 0, cell: 0, sysweekly: 0 },
    hidden: { lithium: new Set(), sys: new Set() },
    news: { q: '', cat: '', effect: '' },
    raw: { q: '', key: null, dir: 1 },
    gapFrom: '2026-04-20',
    calc: { ref: null, li: null, kg: 0.55 },
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
  const spotPts = () => (D.lithium || []).filter((r) => r.series === 'Spot').map((r) => ({ d: parse(r.date), v: +r.usd_t, source: r.source, note: r.note })).sort((a, b) => a.d - b.d);
  const weekly = () => [...(D.weekly || [])].sort((a, b) => d3.ascending(a.date, b.date));
  const ilSpotMap = () => new Map((D.lithium || []).filter((r) => r.series === 'Spot' && /^InfoLink/.test(r.source)).map((r) => [r.date, +r.usd_t]));
  const cellMap = () => new Map((D.cell314 || []).map((r) => [r.date, +r.usd_kwh]));

  // ---------- renderers ----------
  function renderHeader() {
    const m = D.meta;
    if (m) {
      const days = Math.round((Date.now() - parse(m.updated)) / 864e5);
      const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      $('#updated').textContent = `Updated ${m.updated_label} (${ago})`;
      $('#updated').title = m.note || '';
    }
    $('#news-count').textContent = (D.news || []).length || '';
  }

  function renderOverview() {
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const take = $('#takeaway');
    if (L.lithium && L.cell314 && L.system) {
      take.replaceChildren(document.createTextNode('Lithium carbonate futures are at '), el('b', null, L.lithium.price), document.createTextNode(` a tonne (${L.lithium.move}), while 314 Ah storage cells sit at `), el('b', null, L.cell314.price), document.createTextNode(`/kWh (${L.cell314.move}) and China 4-hour systems at `), el('b', null, L.system.price), document.createTextNode(`/kWh (${L.system.move}).`));
    }
    const sparks = { lithium: futPts().map((p) => p.v), cell314: weekly().map((w) => w.cell314), system: (D.systems || []).map((r) => +r.usd_kwh) };
    const cards = $('#cards'); cards.replaceChildren();
    (D.latest || []).forEach((r) => {
      const c = el('button', 'card layer-' + r.id); c.type = 'button'; c.id = 'card-' + r.id; c.title = 'Open the ' + (CARD_TAB[r.id] || 'overview') + ' tab';
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

  function renderCells() {
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
      const g = gapCompute(S.gapFrom, S.calc.kg);
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
    renderSystems();
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

  function renderMaterials() {
    const tb = $('#raw-table tbody'); tb.replaceChildren();
    const q = S.raw.q.toLowerCase();
    let rows = (D.rawmats || []).map((r) => ({ ...r, price_num: /\d/.test(r.price) ? Number(r.price.replace(/[^0-9.]/g, '')) : -1 }));
    if (q) rows = rows.filter((r) => [r.material, r.role, r.source].join(' ').toLowerCase().includes(q));
    if (S.raw.key) {
      const k = S.raw.key, dir = S.raw.dir;
      const rank = { down: 0, flat: 1, up: 2, none: 3 };
      rows.sort((a, b) => dir * (k === 'price_num' ? a[k] - b[k] : k === 'direction' ? rank[a[k]] - rank[b[k]] : d3.ascending(String(a[k]), String(b[k]))));
    }
    $$('#raw-table th').forEach((th) => { const b = $('button', th); th.removeAttribute('aria-sort'); if (b && b.dataset.sort === S.raw.key) th.setAttribute('aria-sort', S.raw.dir > 0 ? 'ascending' : 'descending'); });
    if (!rows.length) { const tr = tb.insertRow(); const td = tr.insertCell(); td.colSpan = 6; td.className = 'empty'; td.textContent = 'No materials match that filter.'; return; }
    rows.forEach((r) => {
      const tr = tb.insertRow();
      tr.insertCell().textContent = r.material; tr.insertCell().textContent = r.role;
      const p = tr.insertCell(); p.className = 'num r'; p.textContent = r.price;
      const a = tr.insertCell(); a.className = 'nowrap'; a.textContent = r.asof;
      const m = tr.insertCell(); m.className = 'nowrap'; m.appendChild(el('span', 'chip' + dirClass(r.direction), r.move));
      tr.insertCell().appendChild(link(r.source, r.url));
    });
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

  function renderCalc() {
    const w = weekly(); if (!w.length) return;
    const refSel = $('#calc-ref'), liIn = $('#calc-li'), kgIn = $('#calc-kg');
    const sp = spotPts(); const latestLi = sp.length ? sp[sp.length - 1].v : w[w.length - 1].lithium_usd_t;
    if (!refSel.childElementCount) {
      w.slice().reverse().forEach((r) => refSel.appendChild(new Option(dayFmt(parse(r.date)), r.date)));
      S.calc.ref = w[w.length - 1].date; S.calc.li = latestLi;
      refSel.addEventListener('change', () => { S.calc.ref = refSel.value; renderCalc(); });
      liIn.addEventListener('input', () => { S.calc.li = +liIn.value; renderCalc(); });
      kgIn.addEventListener('input', () => { S.calc.kg = +kgIn.value; renderCalc(); });
      $('#calc-reset').addEventListener('click', () => { S.calc = { ref: w[w.length - 1].date, li: latestLi, kg: 0.55 }; renderCalc(); });
      const fut = futPts(); const peak = fut.length ? d3.greatest(fut, (p) => p.v) : null;
      const presets = [['Latest spot', latestLi], ...(peak ? [['May 2026 futures peak', peak.v]] : []), ['30 Sep spot', (spotPts().find((p) => +p.d === +parse('2026-09-30')) || {}).v], ['Goldman 2027 view', (D.forecasts || []).find((f) => /2027/.test(f.period))?.low], ['Mid-2025', (spotPts()[0] || {}).v]].filter((p) => p[1]);
      const pr = $('#calc-presets');
      presets.forEach(([lab, v]) => { const b = el('button', null, `${lab} ${fmtUsd0(v)}`); b.type = 'button'; b.addEventListener('click', () => { S.calc.li = Math.round(v / 100) * 100; renderCalc(); }); pr.appendChild(b); });
    }
    refSel.value = S.calc.ref; liIn.value = S.calc.li; kgIn.value = S.calc.kg;
    $('#calc-li-out').textContent = fmtUsd0(S.calc.li) + ' /t';
    $('#calc-kg-out').textContent = S.calc.kg.toFixed(2) + ' kg';
    const ref = w.find((r) => r.date === S.calc.ref) || w[w.length - 1];
    const dCell = (S.calc.li - ref.lithium_usd_t) * S.calc.kg / 1000 / VAT;
    const cell = ref.cell314 + dCell, sys = ref.ac_4h + dCell;
    const res = $('#calc-results'); res.replaceChildren();
    const card = (k, v, d) => { const c = el('div', 'result'); c.append(el('span', 'k', k), el('span', 'v', v)); if (d) c.appendChild(el('span', 'd' + (d[1] < -0.05 ? ' is-down' : d[1] > 0.05 ? ' is-up' : ''), d[0])); res.appendChild(c); };
    const lch = (S.calc.li / ref.lithium_usd_t - 1) * 100;
    card('Lithium vs reference week', fmtUsd0(S.calc.li), [`${pctS(lch)} vs ${fmtUsd0(ref.lithium_usd_t)}`, lch]);
    card('Implied 314 Ah cell price', fmtUsd1(cell) + '/kWh', [`${dCell >= 0 ? '+' : '−'}$${Math.abs(dCell).toFixed(1)} (${pctS(dCell / ref.cell314 * 100)})`, dCell]);
    card('Cell cost per GWh', '$' + cell.toFixed(1) + 'M', [`vs $${ref.cell314.toFixed(1)}M in the reference week`, dCell]);
    card('Implied 4-hour AC system', fmtUsd1(sys) + '/kWh', [`${pctS(dCell / ref.ac_4h * 100)} vs ${fmtUsd1(ref.ac_4h)}`, dCell]);
    $('#calc-explain').textContent = `Reference week ${dayFmt(parse(ref.date))}: lithium ${fmtUsd0(ref.lithium_usd_t)}/t, cell ${fmtUsd1(ref.cell314)}/kWh, 4-hour system ${fmtUsd1(ref.ac_4h)}/kWh (InfoLink). Change in cell cost = change in lithium price × ${S.calc.kg.toFixed(2)} kg per kWh, with China's 13% VAT removed. The system figure assumes about 1 kWh of cells per kWh of system and holds all other costs fixed.`;
    if (S.tab === 'cells') renderCells();
  }

  // ---------- tabs ----------
  const RENDER = { overview: renderOverview, lithium: renderLithium, cells: renderCells, materials: renderMaterials, news: renderNews, calculator: renderCalc };
  function go(tab, push = true) {
    if (tab === 'systems') tab = 'cells';
    if (!TABS.includes(tab)) tab = 'overview';
    S.tab = tab; hideTip();
    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (push) { try { history.replaceState(null, '', '#' + tab); } catch (e) { /* ignore */ } }
    try { RENDER[tab](); } catch (e) { console.error(e); }
    if (push) window.scrollTo({ top: 0 });
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));

  // ---------- inputs ----------
  $('#news-search').addEventListener('input', (e) => { S.news.q = e.target.value; renderNews(); });
  $('#news-effect').addEventListener('change', (e) => { S.news.effect = e.target.value; renderNews(); });
  $('#raw-search').addEventListener('input', (e) => { S.raw.q = e.target.value; renderMaterials(); });
  $$('#raw-table th button').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.sort; S.raw.dir = S.raw.key === k ? -S.raw.dir : 1; S.raw.key = k; renderMaterials(); }));

  // ---------- CSV ----------
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.csv; const rows = D[key] || []; if (!rows.length) return;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `battery-monitor-${key}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }));

  // ---------- theme ----------
  const themes = ['auto', 'light', 'dark'];
  let theme = store.get('bpm-theme') || 'auto';
  const applyTheme = () => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    $('#theme-btn').textContent = 'Theme: ' + theme[0].toUpperCase() + theme.slice(1);
  };
  $('#theme-btn').addEventListener('click', () => { theme = themes[(themes.indexOf(theme) + 1) % 3]; store.set('bpm-theme', theme); applyTheme(); go(S.tab, false); });
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
