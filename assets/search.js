/* LeyBatt Pulse: header search.
   Runs entirely in the browser: no AI model, no tokens, nothing sent anywhere. It builds an index from the data the
   site has already loaded (prices, risk, outlook, news, rules, dates, trackers, glossary, pages), understands the
   industry's synonyms and small typos, answers directly where it can and jumps to the exact card or section.
   When the site has nothing, the last row opens a normal Google search in a new tab. */
(() => {
  'use strict';
  const W = () => window.LBP;
  const $ = (s, r = document) => r.querySelector(s);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dShort = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

  // ---------- words ----------
  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/₂/g, '2').replace(/[’']/g, '')
    .replace(/(\d)\s*(ah|gwh|mwh|kwh|mw|gw)\b/g, '$1$2');
  const toks = (t) => norm(t).split(/[^a-z0-9.%]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w && w.length > 0);
  const STOP = new Set('a an the of for in on to at by is are was were be what whats which who how much many does do did show me tell about find get give latest current currently today now please and or with from vs versus our my any there this that it its india indian s'.split(' '));
  // words that say what kind of answer is wanted: they boost a type but are not required to match
  const INTENT = {
    price: 'price', prices: 'price', cost: 'price', costs: 'price', rate: 'price', rates: 'price', expensive: 'price', cheap: 'price', cheaper: 'price', value: 'price',
    news: 'news', story: 'news', stories: 'news', headline: 'news', headlines: 'news', update: 'news', updates: 'news',
    rule: 'rule', rules: 'rule', regulation: 'rule', regulations: 'rule', policy: 'rule', policies: 'rule', law: 'rule', scheme: 'rule', notification: 'rule',
    risk: 'risk', risky: 'risk', score: 'risk', scores: 'risk',
    forecast: 'outlook', forecasts: 'outlook', outlook: 'outlook', future: 'outlook', prediction: 'outlook', predict: 'outlook', projection: 'outlook', '2027': 'outlook', '2028': 'outlook', '2029': 'outlook', 'next': 'outlook', 'years': 'outlook',
    when: 'date', date: 'date', dates: 'date', deadline: 'date', deadlines: 'date', due: 'date', upcoming: 'date',
    meaning: 'term', mean: 'term', means: 'term', define: 'term', definition: 'term', stand: 'term', full: 'term', form: 'term', abbreviation: 'term',
  };
  // synonyms: a query word also counts as these words
  const SYN = {
    li2co3: ['lithium', 'carbonate'], lce: ['lithium', 'carbonate'], carbonate: ['lithium', 'carbonate'], li: ['lithium'], lithium: ['lithium'],
    lioh: ['lithium', 'hydroxide'], hydroxide: ['hydroxide'], sc6: ['spodumene'], ore: ['spodumene'],
    lfp: ['lfp', 'iron', 'phosphate'], lifepo4: ['lfp'], cathode: ['cathode'], anode: ['anode', 'graphite'], graphite: ['graphite', 'anode'],
    bess: ['storage', 'bess', 'system'], ess: ['storage', 'bess'], storage: ['storage', 'bess'], grid: ['storage', 'grid'], container: ['system', 'storage'], containerised: ['system'],
    cell: ['cell', 'cells'], cells: ['cell', 'cells'], battery: ['battery', 'cell', 'pack'], batteries: ['battery', 'cell', 'pack'],
    '314ah': ['314'], '314': ['314'], '587ah': ['587'], '587': ['587'], '280ah': ['280'],
    ev: ['ev', 'electric', 'vehicle'], evs: ['ev', 'electric', 'vehicle'], electric: ['ev', 'electric'], vehicle: ['vehicle', 'ev'], vehicles: ['vehicle', 'ev'], bus: ['bus', 'buses'], buses: ['bus', 'buses'], ebus: ['bus'], truck: ['truck', 'trucks'], trucks: ['truck'], lcv: ['truck', 'vehicle'],
    pack: ['pack', 'packs'], packs: ['pack', 'packs'], bms: ['bms'], pcs: ['pcs'],
    tender: ['tender', 'tenders', 'auction', 'bid'], tenders: ['tender', 'tenders'], auction: ['tender', 'auction'], bid: ['bid', 'tender'], bids: ['bid', 'tender'], bidding: ['bid', 'bidding', 'tender'], award: ['tender', 'awards'], awards: ['tender', 'awards'], tariff: ['tariff', 'tender'],
    calculator: ['calculator', 'cost'], calc: ['calculator'], landed: ['landed', 'duty'], import: ['landed', 'import', 'duty'], imports: ['landed', 'import'],
    duty: ['duty', 'bcd', 'customs'], duties: ['duty', 'bcd', 'customs'], customs: ['bcd', 'customs', 'duty'], bcd: ['bcd', 'customs', 'duty'], gst: ['gst', 'igst'], igst: ['igst', 'gst'], tax: ['tax', 'duty', 'gst', 'vat'],
    pli: ['pli', 'incentive'], acc: ['acc', 'pli'], incentive: ['incentive', 'pli'], incentives: ['incentive', 'pli'], subsidy: ['subsidy', 'vgf', 'incentive'], subsidies: ['subsidy', 'vgf'], vgf: ['vgf', 'viability'], grant: ['vgf', 'grant'],
    china: ['china', 'chinese'], chinese: ['china', 'chinese'], export: ['export'], exports: ['export'], control: ['control', 'controls', 'curbs'], controls: ['control', 'curbs'], ban: ['ban', 'control', 'curbs'], curbs: ['curbs', 'control'],
    fire: ['fire', 'fires', 'safety'], fires: ['fire', 'fires', 'safety'], safety: ['safety', 'fire'], recall: ['recall', 'recalls'], recalls: ['recall'], accident: ['fire', 'safety'], incident: ['fire', 'safety'],
    swap: ['swap', 'swapping'], swapping: ['swapping', 'swap'], standard: ['standard', 'standards', 'is'], standards: ['standard', 'standards'], ais: ['ais'], bis: ['bis', 'standard'],
    plant: ['plant', 'plants', 'factory'], plants: ['plant', 'factory'], factory: ['factory', 'plant', 'gigafactory'], factories: ['factory', 'plant'], gigafactory: ['factory', 'plant', 'gigafactory'], capacity: ['capacity', 'gwh', 'plant'], manufacturing: ['factory', 'plant', 'making'],
    copper: ['copper'], aluminium: ['aluminium'], aluminum: ['aluminium'], al: ['aluminium'], cu: ['copper'], metal: ['copper', 'aluminium'], metals: ['copper', 'aluminium'], lme: ['lme', 'copper', 'aluminium'],
    rupee: ['rupee', 'inr', 'exchange'], inr: ['rupee', 'inr'], dollar: ['dollar', 'rupee', 'exchange'], usd: ['dollar', 'rupee'], fx: ['rupee', 'exchange'], currency: ['rupee', 'exchange'], forex: ['rupee', 'exchange'],
    electrolyte: ['electrolyte'], separator: ['separator'], foil: ['foil'], foils: ['foil'], phosphate: ['phosphate', 'iron'],
    epc: ['epc'], supplier: ['supplier', 'maker'], suppliers: ['supplier', 'maker'], maker: ['maker', 'makers'], makers: ['maker', 'makers'], competitor: ['competitor', 'maker'], competitors: ['competitor', 'maker'],
    sodium: ['sodium'], 'na-ion': ['sodium'], solid: ['solid'], gfex: ['gfex', 'guangzhou', 'futures'], futures: ['futures', 'gfex'], spot: ['spot'],
    margin: ['margin', 'room', 'cost'], profit: ['margin', 'room'], volatility: ['swings', 'volatility'], supply: ['supply'], demand: ['demand'],
  };
  const lev = (a, b, max) => { // edit distance, stopping early once it is past max
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
      if (best > max) return max + 1; prev = cur;
    }
    return prev[b.length];
  };

  // ---------- index ----------
  let IDX = null;
  const TYPE = { price: 'Price', risk: 'Risk', outlook: 'Outlook', page: 'Page', news: 'News', rule: 'Regulation', date: 'Date', track: 'Tracker', term: 'Meaning' };
  const BASE = { page: 1.25, price: 1.3, risk: 1.05, outlook: 1.05, term: 1.0, rule: 1.0, track: 0.95, date: 0.9, news: 0.85 };
  function add(list, it) {
    const t = new Set(toks(it.title)), k = new Set(toks((it.keys || '') + ' ' + (it.sub || ''))), x = new Set(toks(it.text || ''));
    it._t = t; it._k = k; it._x = x; it._all = [...new Set([...t, ...k, ...x])]; it._title = norm(it.title);
    list.push(it);
  }
  function buildIndex() {
    const L = W(); if (!L || !L.D || !L.D.latest) return null;
    const { D, CHAIN, OL_MATS, UNIT_SHORT } = L; const out = [];
    const stepOf = (i) => (CHAIN.find((c) => c.flow.includes(i)) || {}).id || 'mining';
    const chainGo = (step, sel) => () => { L.go('chain/' + step); if (sel) L.focusOn(sel); };
    const CHART = { lithium: 'lithium', cell314: 'cell_ess', evcell: 'cell_ev', system: 'sys4', Copper: 'copper', Aluminium: 'aluminium' };
    // prices
    try {
      L.allPrices().forEach((st, i) => st.rows.forEach((r) => {
        if (r.key == null || !r.price) return;
        const step = stepOf(i); const unit = UNIT_SHORT[r.unit] || (r.unit ? ' ' + r.unit : '');
        const ch = CHART[r.key];
        add(out, { type: 'price', title: r.name, sub: [r.price + unit, r.move, r.asof].filter(Boolean).join(' · '), keys: `${r.desc || ''} ${st.step} ${r.key}`, text: r.source || '',
          go: chainGo(step, '#' + L.priceId(r.key)), alt: ch ? { label: 'Chart', go: () => { location.hash = `chain/${step}?chart=${ch}`; } } : null });
      }));
    } catch (e) { console.error(e); }
    // risk scores
    ((D.risk || {}).materials || []).forEach((m) => {
      const r = m.h3 || {}; const p = r.price || {}, s = r.supply || {};
      const ch = (a) => (a.change == null || Math.abs(a.change) < 0.05 ? '' : ` ${a.change > 0 ? '▲' : '▼'}${Math.abs(a.change).toFixed(1)}`);
      add(out, { type: 'risk', title: `${m.name}: price and supply risk`, sub: `Next 3 months · price ${p.score == null ? '–' : p.score.toFixed(1)} ${p.level || ''}${ch(p)} · supply ${s.score == null ? '–' : s.score.toFixed(1)} ${s.level || ''}${ch(s)}`,
        keys: `${m.short} ${m.group} risk score supply price why eased rose drivers`,
        go: () => { L.RISK.sel = m.id; L.go('risk'); L.renderRisk(); L.focusOn('#risk-detail'); } });
    });
    // 3-year outlook
    const X = D.scen;
    if (X && X.results && X.results.base) OL_MATS.forEach((m) => {
      const res = X.results.base[m.id]; if (!res || !res.years) return;
      const yrs = Object.entries(res.years).sort((a, b) => a[0].localeCompare(b[0])).map(([y, v]) => `${y} ${m.fmt(v.p50)}`).join(' · ');
      add(out, { type: 'outlook', title: `${m.name}: next 3 years`, sub: `Base case, yearly average: ${yrs}${m.unit}`, keys: `forecast outlook future 2027 2028 2029 scenario projection ${m.id.replace('_', ' ')}`,
        go: () => { L.go('risk'); setTimeout(() => L.jumpOutlook(m.id), 60); } });
    });
    // pages and sections
    const P = [
      ['Today: what matters', 'Today', 'home overview summary daily briefing what matters today value chain', () => L.go('overview')],
      ['Coming up: key dates', 'Today', 'dates deadlines upcoming calendar events next', () => { L.go('overview'); L.focusOn('#ov-coming'); }],
      ['News', 'All stories, filter by EVs, batteries or BESS', 'news stories headlines feed', () => L.go('news')],
      ['Regulations', 'Every rule, with status and dates', 'rules regulations policy duty incentive law', () => L.go('rules')],
      ['Rule changes coming up', 'Regulations', 'upcoming deadlines rule dates next', () => { L.go('rules'); L.focusOn('#rules-next'); }],
      ['Bidding desk: landed cost and outlook', 'China price to landed in India, now and 2027–2029', 'bidding desk landed cost import duty bid price quote', () => L.go('bid')],
      ['Cost calculator', 'Bidding desk', 'calculator cost build up estimate bom bill of materials what if', () => L.go('calculator')],
      ['India storage tenders and EPC', 'Bidding desk', 'tenders tariff seci ntpc auction epc carry recover', () => L.go('storage')],
      ['Risk map and scores', 'Risk', 'risk map scores navigator supply price', () => { L.go('risk'); L.focusOn('#risk-map'); }],
      ['3-year outlook', 'Risk', 'forecast outlook scenarios 2027 2028 2029 future prices', () => { L.go('risk'); setTimeout(() => L.jumpOutlook(), 60); }],
      ['Rupee and India facts', 'Risk', 'rupee dollar exchange rate duties cell making capacity india', () => { L.go('risk'); L.focusOn('#risk-india'); }],
      ['How the risk scores work', 'Risk', 'method methodology how scores calculated weights', () => { L.go('risk'); L.focusOn('#risk-method'); }],
    ];
    CHAIN.forEach((c) => P.push([`${c.name}: ${c.title}`, `Value chain step ${Number(c.n)}`, `${c.say} ${c.id}`, () => L.go('chain/' + c.id)]));
    const SECS = [
      ['cells', 'What’s inside a cell price', 'cell cost breakdown bom materials margin'], ['cells', 'Chinese cell makers by size', 'chinese cell makers sizes ah 100 314 324 392 588 bess automotive vehicle catl byd calb eve gotion svolt hithium rept envision cornex sunwoda'],
      ['cells', 'New cells', 'new cell launches models chemistry sodium'], ['cells', 'Cell factories in India', 'cell plants factories gigafactory capacity gwh india'],
      ['cells', 'Rules that hit cells', 'cell rules duties testing incentives'], ['cells', 'Landed in India, now and 2027–2029', 'cell landed import duty rupees'],
      ['systems', 'What’s inside a storage system price', 'system cost breakdown pcs container'], ['systems', 'Battery packs in Indian e-buses and e-trucks', 'pack bus truck ev vehicles kwh'],
      ['systems', 'Pack and storage-system plants in India', 'pack plants assembly factories bess'], ['systems', 'Battery swapping and safety standards', 'swapping standards is 17896 ais 038 bis'],
      ['systems', 'Battery fires and recalls', 'fires recalls safety incidents accidents'], ['systems', 'Rules that hit packs and storage systems', 'pack system rules duties'],
      ['systems', 'Landed in India, now and 2027–2029', 'system landed import duty rupees'],
    ];
    SECS.forEach(([step, t, k]) => P.push([t, step === 'cells' ? 'Cells' : 'Packs & systems', k, () => { L.go('chain/' + step); L.focusOn('#' + L.secId(t)); }]));
    P.forEach(([title, sub, keys, go]) => add(out, { type: 'page', title, sub, keys, go }));
    // trackers
    const T = (file, step, sec, fn) => ((D[file] || {}).rows || []).forEach((r) => { const o = fn(r); if (o) add(out, { type: 'track', ...o, go: () => { L.go('chain/' + step); L.focusOn('#' + L.secId(sec)); } }); });
    T('cellmakers', 'cells', 'Chinese cell makers by size', (r) => { const by = (u) => r.cells.filter((c) => c.use === u).map((c) => c.ah).sort((x, y) => x - y).join(', '); const bs = by('BESS'), au = by('Auto');
      return { title: `${r.maker}: cell sizes`, sub: [bs ? 'Storage ' + bs + ' Ah' : '', au ? 'Vehicle ' + au + ' Ah' : ''].filter(Boolean).join(' · '), keys: `chinese cell maker sizes ah bess automotive vehicle storage ${(r.aliases || []).join(' ')}`, text: r.cells.map((c) => `${c.ah}ah ${c.ah} ${c.name || ''} ${c.note || ''}`).join(' ') }; });
    T('cellmodels', 'cells', 'New cells', (r) => ({ title: `${r.maker} ${r.cell || ''}`.trim(), sub: [r.chemistry, r.size, r.stage, r.when].filter(Boolean).join(' · '), keys: 'new cell launch', text: `${r.format || ''} ${r.spec || ''} ${r.use || ''}` }));
    T('plants', 'cells', 'Cell factories in India', (r) => ({ title: `${r.company}: ${r.location || r.kind || ''}`, sub: [r.capacity, r.stage, r.start].filter(Boolean).join(' · '), keys: `plant factory ${r.kind || ''}`, text: r.note || '' }));
    T('vehicles', 'systems', 'Battery packs in Indian e-buses and e-trucks', (r) => ({ title: `${r.maker} ${r.model}`, sub: [r.pack_kwh ? r.pack_kwh + ' kWh' : '', r.chemistry, r.type].filter(Boolean).join(' · '), keys: 'vehicle pack ev bus truck', text: `${r.cell_supplier || ''} ${r.charging || ''} ${r.note || ''}` }));
    T('standards', 'systems', 'Battery swapping and safety standards', (r) => ({ title: r.name, sub: [r.kind, r.status, r.body].filter(Boolean).join(' · '), keys: 'standard', text: `${r.scope || ''} ${r.applies || ''}` }));
    T('safety', 'systems', 'Battery fires and recalls', (r) => ({ title: `${r.kind || 'Incident'}: ${r.place}${r.country ? ', ' + r.country : ''}`, sub: [dShort(r.date), r.operator].filter(Boolean).join(' · '), keys: 'fire safety incident recall', text: `${r.what || ''} ${r.cause || ''} ${r.lesson || ''}` }));
    // regulations
    (D.regulations || []).forEach((r) => add(out, { type: 'rule', when: r.date, whenLabel: dShort(r.date), title: r.short || r.title, sub: [r.status, r.date_label || dShort(r.date), r.region].filter(Boolean).join(' · '), keys: `${r.title} ${r.area || ''} ${(r.affects || []).join(' ')} ${r.id.replace(/-/g, ' ')}`, text: `${r.what || ''} ${r.impact || ''}`,
      go: () => { location.hash = 'rules?rule=' + r.id; } }));
    // dated events
    const today = new Date().toISOString().slice(0, 10);
    (D.events || []).filter((e) => (e.end || e.date) >= today).forEach((e) => add(out, { type: 'date', when: e.date, whenLabel: dShort(e.date), title: e.short || e.what, sub: `${dShort(e.date)}${e.end && e.end !== e.date ? ' – ' + dShort(e.end) : ''}`, keys: `${e.kind || ''} date deadline`, text: e.what,
      go: () => { L.go('overview'); L.focusOn('#ov-coming'); }, src: e.url }));
    // news
    const news = Array.isArray(D.news) ? D.news : (D.news || {}).items || [];
    news.forEach((n) => add(out, { type: 'news', title: n.headline, sub: [n.day || dShort(n.date), n.sources || n.source, n.seg ? 'For ' + n.seg : ''].filter(Boolean).join(' · '), keys: `${n.category || ''} ${n.effect || ''}`, text: n.so || '', date: n.date,
      go: () => { location.hash = 'news?story=' + n.id; } }));
    // glossary
    (L.GLOSS || []).forEach(([re, def]) => {
      const src = re.source; let name = src.includes('lakh') ? 'Lakh per MW per month' : src.split('|')[0].replace(/\\b/g, '').replace(/\[–-\]/g, '–').replace(/\\/g, '');
      const alt = src.split('|').slice(1).join(' ').replace(/\\b/g, '').replace(/\\/g, '');
      add(out, { type: 'term', title: name, sub: def, keys: alt + ' meaning definition', go: null });
    });
    return out;
  }

  // ---------- ranking ----------
  function search(q) {
    const raw = toks(q); if (!raw.length) return [];
    const intents = new Set(raw.map((w) => INTENT[w]).filter(Boolean));
    if (/^\s*(what\s+(is|are|does)|whats|define|meaning\s+of)\b/i.test(q) || /\bstand\s+for\b/i.test(q)) intents.add('term');
    let need = raw.filter((w) => !STOP.has(w) && !INTENT[w]);
    if (!need.length) need = raw.filter((w) => !STOP.has(w)); // "forecast" alone, "price" alone
    if (!need.length) return [];
    const qn = norm(q).trim();
    const res = [];
    for (const it of IDX) {
      let sc = 0, hit = 0; const hits = [];
      for (const w of need) {
        const forms = [w, ...(SYN[w] || [])];
        let best = 0, bt = null;
        const take = (v, t) => { if (v > best) { best = v; bt = t; } };
        for (const f of forms) {
          const syn = f === w ? 1 : 0.85;
          if (it._t.has(f)) take(3 * syn, f);
          else if (it._k.has(f)) take(2.2 * syn, f);
          else if (it._x.has(f)) take(1.1 * syn, f);
          if (best >= 3 * syn) continue;
          if (f.length >= 3) for (const t of it._all) { // prefix: "lith", "regul", "calc"
            if (t.length > f.length && t.startsWith(f)) { take((it._t.has(t) ? 2.4 : it._k.has(t) ? 1.8 : 0.9) * syn, t); break; }
          }
        }
        if (!best && w.length >= 5) { // small typos: "lithum", "regulaton", "alumnium" (not short names like CATL)
          const max = w.length >= 8 ? 2 : 1;
          for (const t of it._all) { if (t.length >= 4 && lev(w, t, max) <= max) { take(it._t.has(t) ? 2 : it._k.has(t) ? 1.5 : 0.7, t); if (best >= 2) break; } }
        }
        if (best) { hit++; sc += best; if (bt) hits.push(bt); }
      }
      if (!hit) continue;
      const cover = hit / need.length;
      if (need.length >= 2 && cover < 0.6) continue; // two words: both must match; three: two; four: three
      sc *= cover * cover * BASE[it.type];
      if (qn.length >= 3 && it._title.includes(qn)) sc += 3;
      if (qn.length >= 3 && it._title.startsWith(qn)) sc += 2; // "CATL" -> "CATL: cell sizes" before stories that mention CATL
      if (intents.has(it.type)) sc *= 1.6;
      if (intents.has('price') && it.type === 'outlook') sc *= 1.05;
      if (intents.has('date') && it.type === 'rule') sc *= 1.25;
      if (intents.has('term') && it.type === 'term') sc *= 2.2;
      if (it.type === 'news' && it.date) { const age = (Date.now() - Date.parse(it.date)) / 864e5; sc *= age < 14 ? 1.1 : age < 60 ? 1 : 0.9; }
      res.push({ it, sc, hits });
    }
    res.sort((a, b) => b.sc - a.sc);
    // keep the list readable: at most 4 news stories and 3 of any other kind beyond the top
    const cap = { news: 4, price: 4, risk: 3, outlook: 3, page: 4, rule: 4, track: 4, date: 3, term: 2 }; const n = {}; const out = [];
    for (const r of res) { const t = r.it.type; n[t] = (n[t] || 0) + 1; if (n[t] <= cap[t]) out.push(r); if (out.length >= 9) break; }
    out.forEach((r) => { r.it._hits = r.hits; });
    return out;
  }

  // ---------- direct answers: worked out from the site's own data, never guessed ----------
  const f0 = (v) => '$' + Math.round(v).toLocaleString('en-US'), f1 = (v) => '$' + v.toFixed(1);
  const dd = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const inr0 = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  function whichSeries(w, q) {
    const L = W(), D = L.D; const has = (...xs) => xs.some((x) => w.includes(x));
    const S = {
      spot: { label: 'Lithium carbonate, China spot', pts: () => L.smmSpot(), f: f0, u: '/t', step: 'mining', key: 'lithium', ol: 'lithium' },
      fut: { label: 'Lithium carbonate futures', pts: () => { const m = new Map(); [...(L.futHist() || []), ...(L.liFut() || [])].forEach((p) => { if (p && p.d) m.set(+p.d, p); }); return [...m.values()]; }, f: f0, u: '/t', step: 'mining', key: 'lithium', ol: 'lithium' },
      ev: { label: 'EV prismatic LFP cell', pts: () => L.ptsOf((D.evcells || {}).series, 'usd_kwh'), f: f1, u: '/kWh', step: 'cells', key: 'evcell', ol: 'cell_ev', land: 'evcell' },
      sys: { label: '4-hour AC storage system, China', pts: () => L.ptsOf(L.weekly(), 'ac_4h'), f: f1, u: '/kWh', step: 'systems', key: 'system', land: 'ac4h' },
      cell: { label: '314 Ah storage cell', pts: () => L.ptsOf(D.cell314, 'usd_kwh'), f: f1, u: '/kWh', step: 'cells', key: 'cell314', ol: 'cell_ess', land: 'cell314' },
    };
    if (has('lithium', 'carbonate', 'li2co3', 'lce', 'gfex')) return S[has('spot') ? 'spot' : 'fut'];
    if (has('ev', 'evs', 'vehicle', 'automotive', 'bus', 'truck') && has('cell', 'cells', 'battery')) return S.ev;
    if (has('system', 'systems', 'container', 'bess', '4h', '4-hour', '4hour')) return S.sys;
    if (has('cell', 'cells', '314', '314ah')) return S.cell;
    return null;
  }
  const atOrBefore = (pts, t) => { let v = null; for (const p of pts) { if (+p.d <= t) v = p; else break; } return v; };
  function answer(q) {
    const L = W(); if (!L || !L.D) return null;
    const KW = ['lithium', 'carbonate', 'system', 'systems', 'storage', 'battery', 'landed', 'vehicle', 'container'];
    const w = toks(q).map((t) => (t.length >= 5 && !KW.includes(t) ? KW.find((k) => lev(t, k, 1) <= 1) || t : t)); // "lithum" -> lithium
    const qs = ' ' + w.join(' ') + ' ' + norm(q) + ' ';
    const ser = whichSeries(w, q);
    // when is …?  -> the soonest matching date
    if (/^\s*when\b/i.test(q) || /\b(deadline|due date|ends?|starts?)\b/i.test(q)) {
      const res = search(q).filter((r) => r.it.type === 'date' || (r.it.type === 'rule' && r.it.when));
      const r = res[0];
      if (r && r.it.when) {
        const days = Math.round((Date.parse(r.it.when) - Date.now()) / 864e5);
        return { kind: 'date', big: `${r.it.whenLabel}${days >= 0 ? ` · in ${days === 0 ? 'less than a day' : days === 1 ? '1 day' : days + ' days'}` : ` · ${-days} days ago`}`, small: r.it.title, go: r.it.go, src: r.it.src };
      }
    }
    if (!ser) return null;
    const pts = [...ser.pts()].filter((p) => p && p.v > 0).sort((a, b) => a.d - b.d); if (!pts.length) return null;
    const last = pts[pts.length - 1];
    const go = () => { L.go('chain/' + ser.step); L.focusOn('#' + L.priceId(ser.key)); };
    // a year -> the outlook
    const yr = (qs.match(/ (2027|2028|2029) /) || [])[1];
    if (yr && ser.ol && L.D.scen && L.D.scen.results) {
      const res = L.D.scen.results.base[ser.ol]; const v = res && res.years && res.years[yr];
      if (v) return { kind: 'outlook', big: `${ser.label}, ${yr}: about ${ser.f(v.p50)}${ser.u}`, small: `Base case, average for the year. 8 in 10 simulated outcomes: ${ser.f(v.p10)} to ${ser.f(v.p90)}. Today ${ser.f(last.v)}${ser.u} (${dd(last.d)}).`, go: () => { L.go('risk'); setTimeout(() => L.jumpOutlook(ser.ol), 60); }, cta: 'Open the 3-year outlook' };
    }
    // landed in India
    if (ser.land && /\b(landed|land|import|imported|duty|customs|in india|india price|rupee|inr|₹)\b/.test(qs)) {
      try {
        const LAND = L.land(); const P = L.bidPrice(ser.land, 'now', 'base'); if (P) {
          const c = L.landCalc(P.mid, ser.land === 'ac4h' ? 'B' : 'C', LAND.after, P.fx);
          return { kind: 'landed', big: `${ser.label} landed in India: about ${inr0(c.inr)}/kWh`, small: `China price ${f1(P.mid)}/kWh, plus freight, insurance, customs duty and surcharge, at ₹${(P.fx || LAND.fx).toFixed(2)} per US$; IGST (reclaimable) not included${ser.land === 'evcell' ? '; the duty rate for EV cells is not confirmed' : ''}. Estimate from the Bidding desk's assumptions.`, go: () => L.go('bid'), cta: 'Open the Bidding desk' };
        }
      } catch (e) { /* the landed panel is not ready */ }
    }
    // how much did it move over a period?
    const per = /\b(today|day|daily|yesterday)\b/.test(qs) ? [1, 'a day'] : /\b(week|weekly|7 days)\b/.test(qs) ? [7, 'the last week'] : /\b(3 months|three months|quarter|90 days)\b/.test(qs) ? [91, 'the last 3 months']
      : /\b(6 months|six months|half year)\b/.test(qs) ? [182, 'the last 6 months'] : /\b(year|12 months|annual|yoy)\b/.test(qs) ? [365, 'the last year'] : /\b(month|monthly|30 days)\b/.test(qs) ? [30, 'the last month'] : null;
    const moveQ = per || /\b(fall|fell|drop|dropped|rise|rose|up|down|change|changed|move|moved|how much|trend)\b/.test(qs);
    if (moveQ) {
      const [days, lab0] = per || [7, 'the last week'];
      let then = atOrBefore(pts, +last.d - days * 864e5); let lab = lab0;
      if (!then && pts.length > 1) { then = pts[0]; lab = `the readings on this site (since ${dd(then.d)})`; } // shorter history than asked: say so
      if (then && then !== last) {
        const pc = (last.v / then.v - 1) * 100;
        const dy = (d) => (then.d.getUTCFullYear() !== last.d.getUTCFullYear() ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : dd(d));
        return { kind: 'move', big: `${ser.label}: ${pc > 0 ? 'up' : pc < 0 ? 'down' : 'flat'} ${Math.abs(pc).toFixed(1)}% over ${lab}`, small: `${ser.f(then.v)}${ser.u} on ${dy(then.d)} → ${ser.f(last.v)}${ser.u} on ${dy(last.d)}${last.source ? ` (${last.source})` : ''}.`, go, cta: 'Open the price' };
      }
    }
    // otherwise: the price now
    if (/\b(price|prices|cost|costs|rate|how much|now|today|current|latest)\b/.test(qs)) {
      const prev = atOrBefore(pts, +last.d - 7 * 864e5);
      const pc = prev && prev !== last ? (last.v / prev.v - 1) * 100 : null;
      return { kind: 'price', big: `${ser.label}: ${ser.f(last.v)}${ser.u}`, small: `${dd(last.d)}${last.source ? ' · ' + last.source : ''}${pc != null ? ` · ${pc > 0 ? '▲' : pc < 0 ? '▼' : ''}${Math.abs(pc).toFixed(1)}% vs ${dd(prev.d)}` : ''}`, go, cta: 'Open the price' };
    }
    return null;
  }

  // highlight the words that matched; show a snippet when they matched only in the hidden text
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function marked(text, hits) {
    const span = mk('span'); const str = String(text || '');
    const tk = [...new Set((hits || []).filter((h) => h && h.length >= 2))].sort((a, b) => b.length - a.length);
    if (!tk.length) { span.textContent = str; return span; }
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${tk.map(esc).join('|')})`, 'giu');
    let i = 0; let m;
    while ((m = re.exec(str))) { const st = m.index + m[1].length; if (st > i) span.appendChild(document.createTextNode(str.slice(i, st))); const e = mk('mark', null, str.slice(st, st + m[2].length)); span.appendChild(e); i = st + m[2].length; if (re.lastIndex === m.index) re.lastIndex++; }
    if (i < str.length) span.appendChild(document.createTextNode(str.slice(i)));
    return span;
  }
  function snippet(it) {
    const hs = (it._hits || []).filter((h) => !it._t.has(h) && !it._k.has(h) && it._x.has(h)); if (!hs.length || !it.text) return null;
    const low = norm(it.text); let at = -1; let hw = '';
    for (const h of hs) { const k = low.search(new RegExp(`(^|[^a-z0-9])${esc(h)}`)); if (k >= 0 && (at < 0 || k < at)) { at = k; hw = h; } }
    if (at < 0) return null;
    const a = Math.max(0, at - 50), b = Math.min(it.text.length, at + 90);
    return (a > 0 ? '…' : '') + it.text.slice(a, b).trim() + (b < it.text.length ? '…' : '');
  }

  // ---------- interface ----------
  let box, input, list, sel = 0, items = [], lastQ = '', opener = null;
  const SUGGEST = ['Lithium price', 'Storage cell price', 'Cost calculator', 'BCD on BESS', 'Lithium forecast 2028', 'Cell factories in India', 'Battery fires', 'What is VGF'];
  function ui() {
    if (box) return box;
    box = mk('div', 'sx'); box.id = 'sx'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Search LeyBatt Pulse');
    const sheet = mk('div', 'sx-sheet');
    const bar = mk('div', 'sx-bar');
    const ic = mk('span', 'sx-ic'); ic.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    input = mk('input', 'sx-in'); input.type = 'search'; input.placeholder = 'Ask about a price, rule, risk, forecast, plant…'; input.setAttribute('aria-label', 'Search'); input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'sx-list'); input.setAttribute('aria-expanded', 'true');
    const close = mk('button', 'sx-close', 'Esc'); close.type = 'button'; close.setAttribute('aria-label', 'Close search'); close.addEventListener('click', hide);
    bar.append(ic, input, close);
    list = mk('div', 'sx-list'); list.id = 'sx-list'; list.setAttribute('role', 'listbox');
    const foot = mk('div', 'sx-foot', 'Searches this site only, in your browser. Nothing you type is sent anywhere unless you choose “Search the web”.');
    sheet.append(bar, list, foot); box.appendChild(sheet); document.body.appendChild(box);
    box.addEventListener('mousedown', (e) => { if (e.target === box) hide(); });
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = items[sel]; if (r) pick(r); }
      else if (e.key === 'Escape') { e.preventDefault(); hide(); }
      else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    });
    return box;
  }
  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; paintSel(); }
  function paintSel() { [...list.querySelectorAll('.sx-row')].forEach((r, i) => { r.setAttribute('aria-selected', String(i === sel)); if (i === sel) r.scrollIntoView({ block: 'nearest' }); }); }
  function webRow(q) { return { web: true, q }; }
  function render(q) {
    lastQ = q; list.replaceChildren(); items = []; sel = 0;
    if (!IDX) IDX = buildIndex();
    if (!IDX) { list.appendChild(mk('div', 'sx-empty', 'Still loading the site’s data… try again in a moment.')); return; }
    if (!q.trim()) {
      const w = mk('div', 'sx-sugg'); w.appendChild(mk('div', 'sx-lab', 'Try'));
      const chips = mk('div', 'sx-chips');
      SUGGEST.forEach((s) => { const b = mk('button', 'sx-chip', s); b.type = 'button'; b.addEventListener('click', () => { input.value = s; render(s); input.focus(); }); chips.appendChild(b); });
      w.appendChild(chips); list.appendChild(w); return;
    }
    const res = search(q);
    let ans = null; try { ans = answer(q); } catch (e) { ans = null; }
    items = [...(ans ? [{ answer: ans, go: ans.go }] : []), ...res.map((r) => r.it), webRow(q)];
    if (!res.length && !ans) list.appendChild(mk('div', 'sx-empty', 'Nothing on the site matches that.'));
    items.forEach((it, i) => {
      const row = mk('div', 'sx-row' + (it.web ? ' sx-web' : '') + (i === 0 && !it.web && (it.type === 'price' || it.type === 'term' || it.type === 'outlook' || it.type === 'risk') ? ' sx-top' : ''));
      row.setAttribute('role', 'option'); row.id = 'sx-o' + i; row.setAttribute('aria-selected', String(i === 0));
      if (it.answer) {
        row.className = 'sx-row sx-answer'; const a = it.answer;
        const m = mk('div', 'sx-main'); m.append(mk('div', 'sx-alab', a.kind === 'date' ? 'Date' : a.kind === 'outlook' ? 'Outlook' : a.kind === 'landed' ? 'Estimate' : 'Answer'), mk('div', 'sx-abig', a.big), mk('div', 'sx-s', a.small));
        row.append(m, mk('span', 'sx-go', (a.cta || 'Open') + ' →'));
      } else if (it.web) {
        row.append(mk('span', 'sx-type', 'Web'), mk('div', 'sx-main'));
        row.lastChild.append(mk('div', 'sx-t', `Search the web for “${q.trim()}”`), mk('div', 'sx-s', 'Opens Google in a new tab'));
      } else {
        row.append(mk('span', 'sx-type t-' + it.type, TYPE[it.type]));
        const m = mk('div', 'sx-main'); const t = mk('div', 'sx-t'); t.appendChild(marked(it.title, it._hits)); m.appendChild(t);
        if (it.sub) { const sb = mk('div', 'sx-s'); sb.appendChild(marked(it.sub, it._hits)); m.appendChild(sb); }
        const sn = snippet(it); if (sn) { const x = mk('div', 'sx-snip'); x.appendChild(marked(sn, it._hits)); m.appendChild(x); }
        row.appendChild(m);
        if (it.alt) { const a = mk('button', 'sx-alt', it.alt.label + ' →'); a.type = 'button'; a.addEventListener('click', (e) => { e.stopPropagation(); hide(); it.alt.go(); }); row.appendChild(a); }
        else if (it.go) row.appendChild(mk('span', 'sx-go', '→'));
      }
      row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; paintSel(); } });
      row.addEventListener('click', () => pick(it));
      list.appendChild(row);
    });
    const fb = feedbackLink(q); if (fb) list.appendChild(fb);
  }
  function feedbackLink(q) { // "Didn't find it?" opens an email to the site owner with the search filled in
    const L = W(); const to = L && L.D && L.D.profile && L.D.profile.feedback_email; if (!to || !q.trim()) return null;
    const a = mk('a', 'sx-fb'); a.textContent = 'Didn’t find what you needed? Tell us what you were looking for';
    a.href = `mailto:${to}?subject=${encodeURIComponent('LeyBatt Pulse search: ' + q.trim())}&body=${encodeURIComponent(`I searched for: ${q.trim()}\n\nI was looking for: \n`)}`;
    return a;
  }
  function pick(it) {
    if (it.web) { window.open('https://www.google.com/search?q=' + encodeURIComponent(it.q.trim()), '_blank', 'noopener'); return; }
    if (!it.go) return; // a meaning: it is already shown in full, so the box stays open
    hide(); it.go();
  }
  function show(prefill) {
    ui(); IDX = IDX || buildIndex(); opener = document.activeElement;
    try { const L = W(); if (L && L.loadHistory) L.loadHistory(); } catch (e) { /* answers fall back to recent readings */ }
    box.hidden = false; document.documentElement.classList.add('sx-open');
    input.value = prefill != null ? prefill : lastQ; render(input.value);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }
  function hide() { if (!box || box.hidden) return; box.hidden = true; document.documentElement.classList.remove('sx-open'); if (opener && opener.focus) try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }

  // header button and shortcuts (Ctrl/⌘ K, or / when not typing)
  function mount() {
    const act = document.querySelector('.top-actions'); if (!act || document.getElementById('sx-btn')) return;
    const b = mk('button', 'sx-btn'); b.id = 'sx-btn'; b.type = 'button'; b.setAttribute('aria-label', 'Search the site');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sx-btn-t">Search</span><kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K') + '</kbd>';
    b.addEventListener('click', () => show());
    act.insertBefore(b, act.firstChild);
  }
  document.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (box && !box.hidden) hide(); else show(); }
    else if (e.key === '/' && !typing && !(box && !box.hidden)) { e.preventDefault(); show(''); }
  });
  // rebuild the index when the data changes (live lithium, late loads)
  setInterval(() => { IDX = null; }, 5 * 60 * 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
