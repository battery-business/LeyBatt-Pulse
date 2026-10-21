(() => {
  const FILES = ['meta', 'latest', 'lithium', 'cell314', 'cellbids', 'systems', 'rawmats', 'news'];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmtUsd0 = d3.format('$,.0f');
  const fmtUsd1 = d3.format('$,.1f');
  const dayFmt = d3.utcFormat('%-d %b %Y');
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const GAP_FROM = '2026-04-20'; // last InfoLink reading before the 2026 lithium slide

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (name, url) => { const a = el('a', null, name); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const dirClass = (d) => (d === 'down' ? ' is-down' : d === 'up' ? ' is-up' : '');

  const tip = (box) => { let t = box.querySelector('.tip'); if (!t) { t = el('div', 'tip'); t.hidden = true; box.appendChild(t); } return t; };
  const showTip = (box, t, x, y, lines) => {
    t.replaceChildren();
    lines.forEach(([k, v]) => { const row = el('div'); if (k) row.appendChild(el('span', 'k', k + (v ? '  ' : ''))); if (v) row.appendChild(document.createTextNode(v)); t.appendChild(row); });
    t.hidden = false;
    t.style.left = Math.max(0, Math.min(box.clientWidth - t.offsetWidth, x + 12)) + 'px';
    t.style.top = Math.max(0, y - t.offsetHeight - 8) + 'px';
  };
  const fail = (box) => { box.replaceChildren(el('div', 'fail', 'Failed to load')); };
  const srcLinks = (p, rows) => {
    p.replaceChildren(document.createTextNode('Sources: '));
    const seen = new Map();
    rows.forEach((r) => { if (r.url && !seen.has(r.url)) seen.set(r.url, r.source); });
    [...seen].forEach(([url, name], i) => { if (i) p.appendChild(document.createTextNode(' · ')); p.appendChild(link(name, url)); });
  };
  const measure = (svg, texts) => {
    const g = svg.append('g').attr('font-size', 12);
    const w = d3.max(texts, (s) => g.append('text').text(s).node().getComputedTextLength()) || 0;
    g.remove(); return w;
  };
  const axisStyle = (g) => { g.attr('font-size', null).attr('font-family', null); g.selectAll('text').attr('fill', css('--muted')).attr('font-size', 12); g.selectAll('line').attr('stroke', css('--grid')); g.select('.domain').remove(); };

  function lineChart(box, rows, { y, series, fmt, colors, height = 280 }) {
    box.replaceChildren();
    const W = box.clientWidth || 600, H = height;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const groups = d3.groups(rows, (r) => (series ? r[series] : 'all'));
    groups.forEach(([, g]) => g.sort((a, b) => d3.ascending(a.date, b.date)));
    const yS = d3.scaleLinear([0, d3.max(rows, (r) => r[y]) * 1.12], [H - 28, 12]).nice();
    const ticks = yS.ticks(5);
    const left = measure(svg, ticks.map(fmt)) + 10;
    const right = measure(svg, groups.map(([k, g]) => (series ? k + ' ' : '') + fmt(g[g.length - 1][y]))) + 14;
    const xS = d3.scaleUtc(d3.extent(rows, (r) => parse(r.date)), [left, W - right]);
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(yS).tickValues(ticks).tickFormat(fmt).tickSize(-(W - left - right))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 28})`).call(d3.axisBottom(xS).ticks(Math.max(2, Math.floor((W - left - right) / 90))).tickFormat(d3.utcFormat('%b %y')).tickSize(0).tickPadding(10)).call(axisStyle);
    svg.append('line').attr('x1', left).attr('x2', W - right).attr('y1', H - 28).attr('y2', H - 28).attr('stroke', css('--axis'));
    const t = tip(box);
    const labels = [];
    groups.forEach(([k, g], i) => {
      const col = colors[i % colors.length];
      svg.append('path').datum(g).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', d3.line().x((r) => xS(parse(r.date))).y((r) => yS(r[y])));
      svg.append('g').selectAll('circle').data(g).join('circle').attr('cx', (r) => xS(parse(r.date))).attr('cy', (r) => yS(r[y])).attr('r', 4).attr('fill', col).attr('stroke', css('--panel')).attr('stroke-width', 1.5)
        .on('mouseenter', (ev, r) => { const [mx, my] = d3.pointer(ev, box); showTip(box, t, mx, my, [[dayFmt(parse(r.date)), ''], [series ? r[series] : '', fmt(r[y])], [r.source, ''], ...(r.note ? [[r.note, '']] : [])]); })
        .on('mouseleave', () => { t.hidden = true; });
      const last = g[g.length - 1];
      labels.push({ x: xS(parse(last.date)) + 8, y: yS(last[y]) + 4, text: (series ? k + ' ' : '') + fmt(last[y]), col });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    labels.forEach((l) => svg.append('text').attr('x', l.x).attr('y', l.y).attr('font-size', 12).attr('font-weight', 600).attr('fill', l.col).text(l.text));
  }

  function hBars(box, rows, { label, value, fmt, color }) {
    box.replaceChildren();
    const W = box.clientWidth || 600, bh = 22, gap = 12, H = rows.length * (bh + gap) + 8;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const left = Math.min(W * 0.55, measure(svg, rows.map((r) => r[label])) + 12);
    const right = measure(svg, rows.map((r) => fmt(r[value]))) + 10;
    const xS = d3.scaleLinear([0, d3.max(rows, (r) => Math.abs(r[value]))], [left, W - right]);
    const t = tip(box);
    rows.forEach((r, i) => {
      const yy = 4 + i * (bh + gap);
      svg.append('text').attr('x', left - 8).attr('y', yy + bh / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).attr('fill', css('--fg')).text(r[label]);
      svg.append('rect').attr('x', left).attr('y', yy).attr('height', bh).attr('width', Math.max(2, xS(Math.abs(r[value])) - left)).attr('rx', 4).attr('fill', color(r, i))
        .on('mouseenter', (ev) => { const [mx, my] = d3.pointer(ev, box); showTip(box, t, mx, my, [[r[label], ''], ['', fmt(r[value])], ...(r.source ? [[r.source, '']] : [])]); })
        .on('mouseleave', () => { t.hidden = true; });
      svg.append('text').attr('x', xS(Math.abs(r[value])) + 6).attr('y', yy + bh / 2 + 4).attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--fg')).text(fmt(r[value]));
    });
  }

  function vBars(box, rows, { label, value, fmt, height = 260 }) {
    box.replaceChildren();
    const W = box.clientWidth || 600, H = height;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    const yS = d3.scaleLinear([0, d3.max(rows, (r) => r[value]) * 1.18], [H - 28, 12]).nice();
    const ticks = yS.ticks(4);
    const left = measure(svg, ticks.map(fmt)) + 10;
    const xS = d3.scaleBand(rows.map((r) => r[label]), [left, W - 8]).padding(0.35);
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(yS).tickValues(ticks).tickFormat(fmt).tickSize(-(W - left - 8))).call(axisStyle);
    svg.append('g').attr('transform', `translate(0,${H - 28})`).call(d3.axisBottom(xS).tickSize(0).tickPadding(10)).call(axisStyle);
    const t = tip(box);
    const bw = Math.min(56, xS.bandwidth()), off = (xS.bandwidth() - bw) / 2;
    rows.forEach((r, i) => {
      svg.append('rect').attr('x', xS(r[label]) + off).attr('width', bw).attr('y', yS(r[value])).attr('height', H - 28 - yS(r[value])).attr('rx', 4)
        .attr('fill', i === rows.length - 1 ? css('--blue') : css('--chart-muted'))
        .on('mouseenter', (ev) => { const [mx, my] = d3.pointer(ev, box); showTip(box, t, mx, my, [[r[label], ''], ['', fmt(r[value])], [r.source, ''], ...(r.note ? [[r.note, '']] : [])]); })
        .on('mouseleave', () => { t.hidden = true; });
      svg.append('text').attr('x', xS(r[label]) + xS.bandwidth() / 2).attr('y', yS(r[value]) - 6).attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 600).attr('fill', css('--fg')).text(fmt(r[value]));
    });
  }

  // Lithium fall vs cell move, from the last pre-slide reading to the latest cell reading
  function gapRows(lithium, cell) {
    const spot = lithium.filter((r) => r.series === 'Spot').sort((a, b) => d3.ascending(a.date, b.date));
    const onOrBefore = (rows, d) => rows.filter((r) => r.date <= d).pop();
    const cells = [...cell].sort((a, b) => d3.ascending(a.date, b.date));
    const to = cells[cells.length - 1].date;
    const la = onOrBefore(spot, GAP_FROM), lb = onOrBefore(spot, to);
    const ca = onOrBefore(cells, GAP_FROM), cb = cells[cells.length - 1];
    const r1 = (x) => Math.round(x * 10) / 10;
    const expected = -((la.usd_t - lb.usd_t) * 0.55 / 1000 / 1.13) / ca.usd_kwh * 100;
    return { from: ca.date, to, rows: [
      { measure: 'Lithium carbonate, spot', pct: r1((lb.usd_t / la.usd_t - 1) * 100) },
      { measure: 'Cell move implied by lithium', pct: r1(expected) },
      { measure: 'Actual 314 Ah cell move', pct: r1((cb.usd_kwh / ca.usd_kwh - 1) * 100) },
    ] };
  }

  let D = {};
  function render() {
    const C = { amber: css('--amber'), blue: css('--blue'), muted: css('--chart-muted') };
    // header
    const L = Object.fromEntries((D.latest || []).map((r) => [r.id, r]));
    const take = document.getElementById('takeaway');
    if (L.lithium && L.cell314 && L.system) {
      take.replaceChildren(
        document.createTextNode('Lithium carbonate futures are at '), el('b', null, L.lithium.price), document.createTextNode(` a tonne (${L.lithium.move}), while 314 Ah storage cells sit at `),
        el('b', null, L.cell314.price), document.createTextNode(`/kWh (${L.cell314.move}) and China 4-hour systems at `), el('b', null, L.system.price), document.createTextNode('/kWh.'));
    }
    if (D.meta) document.getElementById('updated').textContent = `Last updated ${D.meta.updated_label}. All prices in US$; China VAT removed from cell and system prices. ${D.meta.note || ''}`.trim();
    // cards
    const cards = document.getElementById('cards'); cards.replaceChildren();
    (D.latest || []).forEach((r) => {
      const c = el('div', 'card'); c.id = 'card-' + r.id;
      c.append(el('span', 'layer', r.layer), el('span', 'label', r.label), el('span', 'price', r.price), el('span', 'unit', `${r.unit} · ${r.asof}`), el('span', 'move' + dirClass(r.direction), r.move));
      const s = el('span', 'src', 'Source: '); s.appendChild(link(r.source, r.url)); c.appendChild(s);
      cards.appendChild(c);
    });
    // news
    const nb = document.querySelector('#news-table tbody'); nb.replaceChildren();
    [...(D.news || [])].sort((a, b) => d3.descending(a.date, b.date) || d3.ascending(a.id, b.id)).forEach((r) => {
      const tr = nb.insertRow();
      const c1 = tr.insertCell(); c1.className = 'nowrap'; c1.textContent = r.day;
      tr.insertCell().textContent = r.headline;
      tr.insertCell().appendChild(el('span', 'chip' + dirClass(r.direction), r.effect));
      const c4 = tr.insertCell(); c4.className = 'nowrap'; c4.appendChild(link(r.source, r.url));
      if (r.source2) { c4.appendChild(document.createTextNode(' · ')); c4.appendChild(link(r.source2, r.url2)); }
    });
    // raw materials
    const rb = document.querySelector('#raw-table tbody'); rb.replaceChildren();
    (D.rawmats || []).forEach((r) => {
      const tr = rb.insertRow();
      tr.insertCell().textContent = r.material; tr.insertCell().textContent = r.role;
      const p = tr.insertCell(); p.className = 'num'; p.textContent = r.price;
      const a = tr.insertCell(); a.className = 'nowrap'; a.textContent = r.asof;
      const m = tr.insertCell(); m.className = 'nowrap'; m.appendChild(el('span', 'chip' + dirClass(r.direction), r.move));
      tr.insertCell().appendChild(link(r.source, r.url));
    });
    // charts
    const draw = (id, sel, srcSel, fn) => { const box = document.querySelector(sel); try { if (!D[id]) throw 0; fn(box, D[id]); if (srcSel) srcLinks(document.querySelector(srcSel), D[id]); } catch (e) { fail(box); } };
    draw('lithium', '#lithium-chart', '#lithium-srcs', (b, rows) => lineChart(b, rows, { y: 'usd_t', series: 'series', fmt: fmtUsd0, colors: [C.amber, C.blue] }));
    draw('cell314', '#cell-chart', '#cell-srcs', (b, rows) => lineChart(b, rows, { y: 'usd_kwh', fmt: fmtUsd1, colors: [C.blue] }));
    draw('systems', '#system-chart', '#system-srcs', (b, rows) => vBars(b, rows, { label: 'period', value: 'usd_kwh', fmt: fmtUsd1 }));
    draw('cellbids', '#bids-chart', '#bids-srcs', (b, rows) => hBars(b, rows, { label: 'label', value: 'usd_kwh', fmt: fmtUsd1, color: (r) => (r.kind === '≥500 Ah tender' ? C.blue : r.kind === 'List price' ? C.amber : C.muted) }));
    const gb = document.querySelector('#gap-chart');
    try {
      const g = gapRows(D.lithium, D.cell314);
      document.getElementById('gap-sub').textContent = `${dayFmt(parse(g.from))} to ${dayFmt(parse(g.to))}. Expected move assumes about 0.55 kg of lithium carbonate per kWh of cell, an industry rule of thumb.`;
      hBars(gb, g.rows, { label: 'measure', value: 'pct', fmt: (v) => d3.format('+.1f')(v) + '%', color: (r, i) => [C.amber, C.blue, C.muted][i] });
    } catch (e) { fail(gb); }
  }

  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then((res) => { FILES.forEach((f, i) => { D[f] = res[i]; }); render(); });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);
})();
