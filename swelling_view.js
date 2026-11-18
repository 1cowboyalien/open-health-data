/* Brain MRI · Swelling by lesion (Library → Imaging → Brain MRI), drawn for imaging_view.js through
   window.LesionSwelling.draw(id, body). Added by make_lab_view.py before imaging_view.js when local/imaging/imaging.json
   exists. Everything about the patient comes from IMG_DATA, never from this code.
   The chart: how much more (+) or less (−) room the brain around each lesion's place takes than on the normal control MRI,
   over time, on the shared time axis: one line per lesion and/or the total of all lesion places; treatments as bands.
   The grey band is each scan's own reference: the range of the same measure at lesion-free places on that scan. Points outside
   it are filled, points inside it hollow. The method only shows large effects (see IMG_DATA.swelling.limits).
   Data used: IMG_DATA.swelling {method, limits, control, place_mm, notes {date: text},
              place_scan (date the places are defined on), near_fluid [lesion ids next to the fluid spaces],
              band [{date, lo, hi, median, sd}]                       per scan, %, for ONE lesion place
              rows [{date, field, seq, lesion, outlined, pct, ml, region_ml, moved_mm, outside_band, band_lo, band_hi}],
              totals [{date, field, seq, pct, ml, region_ml, moved_mm, match, band_lo, band_hi, band_lo_ml, band_hi_ml, outside_band}]}
              (made by imaging/swelling/stretch_chart.py); IMG_DATA.lesion_series {lesions [{id,name,rgb}], treatments}.
   Projection (button): where the reading is likely to land in 1-3 months, drawn on the shared time axis as far as it runs (navigation
   bar: Future): a dashed LEVEL with a range, not a trend, because carrying the latest trend forward tested worst on the past scans.
              IMG_DATA.swelling.projection {base, months [{m,date}], rule, rule_words, typical_band {lo,hi},
                lesions [{id, last, last_date, level, n, region_ml, cells [{m, date, v, lo, hi, ml, lo_ml, hi_ml}]}], total {...same},
                backtest {n, place [{key,label,n,typical,mean,within5}], total [...], text, short}, volume_link {n, r, text}, note}
              (made by imaging/swelling/swelling_projection.py).
   Lesion buttons: LesionChips.row (lesion_chips.js), the same component and badge style as the other imaging panels. */
(() => {
  const LS = IMG_DATA.lesion_series, SW = IMG_DATA.swelling;
  if (!LS || !SW || !SW.rows || !SW.rows.length || !SW.band) return;
  const V = Object.assign({total: true, each: true, tx: true, hidden: [], unit: 'pct', proj: false}, store.get('img.swellChart2', {}));
  const PR = SW.projection && SW.projection.lesions && SW.projection.lesions.length ? SW.projection : null;
  const save = () => store.set('img.swellChart2', V);
  /* unit: 'pct' = % of each place (compares lesions; the grey band applies) · 'ml' = extra room in mL (amounts add up: the total is the largest line) */
  const ML = () => V.unit === 'ml';
  const val = r => ML() ? r.ml : r.pct;
  const LCOL = Object.fromEntries(LS.lesions.map(l => [l.id, 'rgb(' + l.rgb + ')']));
  const LNAME = Object.fromEntries(LS.lesions.map(l => [l.id, l.name]));
  const IDS = [...new Set(SW.rows.map(r => r.lesion))].sort();
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const pc = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  const fm = v => v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 1 : 0) + ' mL';
  let BODY = null, PID = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(PID, BODY); };

  if (!document.getElementById('swellCss')) { const st = document.createElement('style'); st.id = 'swellCss';
    st.textContent = '.msw-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}.msw-bar .lab{color:var(--muted);font-size:11px;margin-left:6px}' +
      '.msw-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.msw-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.msw-tbl{border-collapse:collapse;font-size:11.5px;margin-top:6px}.msw-tbl td,.msw-tbl th{padding:2px 8px;border-bottom:1px solid var(--line);text-align:right}.msw-tbl th{color:var(--ink2);font-weight:600}.msw-tbl td:first-child,.msw-tbl th:first-child{text-align:left}' +
      '.msw-warn{font-size:11.5px;border:1px solid var(--line);border-left:3px solid #e0a020;border-radius:4px;padding:4px 8px;margin:0 0 6px;color:var(--ink2)}';
    document.head.append(st); }

  /* the reference band (grey): per scan, the range of the same measure at lesion-free places; joined across scans */
  const bandPlugin = {id: 'mswBand', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    const B = ML() ? (V.total ? SW.totals.map(t => ({date: t.date, lo: t.band_lo_ml, hi: t.band_hi_ml})) : []) : (V.each ? SW.band : SW.totals.map(t => ({date: t.date, lo: t.band_lo, hi: t.band_hi})));
    if (B.length) { ctx.fillStyle = 'rgba(150,150,150,0.20)'; ctx.beginPath();
      B.forEach((b, i) => { const px = x.getPixelForValue(pos(ms(b.date))), py = y.getPixelForValue(b.hi); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      B.slice().reverse().forEach(b => ctx.lineTo(x.getPixelForValue(pos(ms(b.date))), y.getPixelForValue(b.lo)));
      ctx.closePath(); ctx.fill();
      if (V.proj && PR) {   // after the last scan: the usual width of that band (middle of all scans), lighter, as a guide for the projected readings
        const med = k => { const v = B.map(b => b[k]).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
        const x0 = x.getPixelForValue(pos(ms(B[B.length - 1].date))), y0 = y.getPixelForValue(med('hi')), y1 = y.getPixelForValue(med('lo'));
        if (x0 < a.right) { ctx.fillStyle = 'rgba(150,150,150,0.10)'; ctx.fillRect(x0, y0, a.right - x0, y1 - y0);
          ctx.strokeStyle = 'rgba(150,150,150,0.55)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(a.right, y0); ctx.moveTo(x0, y1); ctx.lineTo(a.right, y1); ctx.stroke(); ctx.setLineDash([]);
          const t = 'usual range of lesion-free places'; ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui'; if (a.right - x0 > ctx.measureText(t).width + 10) ctx.fillText(t, x0 + 5, y1 - 3);
          const r1 = PR.ranges && PR.ranges.place && PR.ranges.place[0], t2 = 'projection: a level, not a trend' + (r1 && !ML() && V.each ? ' · one place ±' + r1.hi + ' points' : '');
          ctx.fillStyle = '#e0a020'; ctx.font = 'bold 10px system-ui'; if (a.right - x0 > ctx.measureText(t2).width + 10) ctx.fillText(t2, x0 + 5, a.top + 34); } } }
    ctx.strokeStyle = css('--ink2'); ctx.globalAlpha = .6; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a.left, y.getPixelForValue(0)); ctx.lineTo(a.right, y.getPixelForValue(0)); ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui';
    ctx.fillText('0 = same as ' + fd(SW.control) + ' · grey = what lesion-free places read on each scan' + (ML() ? ' (for the total)' : ''), a.left + 4, a.top + 22);
    if (V.tx) (LS.treatments || []).forEach(tr => { let x0 = x.getPixelForValue(pos(ms(tr.start))), x1 = x.getPixelForValue(pos(ms(tr.end)));
      if (x1 - x0 < 6) { const m = (x0 + x1) / 2; x0 = m - 3; x1 = m + 3; }
      const wb = /whole-brain/i.test(tr.treatment);
      ctx.fillStyle = wb ? 'rgba(237,161,0,0.22)' : 'rgba(98,80,214,0.16)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.fillStyle = wb ? '#c98a00' : '#6250d6'; ctx.font = 'bold 10px system-ui'; ctx.fillText(wb ? 'WBRT' : 'SRS', x0 + 2, a.top + 10); });
    ctx.restore(); }};
  const guide = {id: 'mswGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  function xAxis() { const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}}; }
  const btn = (txt, on, fn, tip) => { const b = document.createElement('button'); b.className = 'msw-b' + (on ? ' on' : ''); b.textContent = txt; if (tip) b.title = tip; b.onclick = fn; return b; };
  const lab = t => { const s = document.createElement('span'); s.className = 'lab'; s.textContent = t; return s; };
  const latest = l => SW.rows.filter(x => x.lesion === l).sort((a, b) => ms(b.date) - ms(a.date))[0];
  /* the badge on a lesion's button: its latest reading; red up / green down only when it lies outside that scan's reference range */
  const chipBadge = l => { const r = latest(l); if (!r) return null;
    return {text: ML() ? fm(r.ml) : pc(r.pct), dir: !r.outside_band ? 'flat' : r.pct > 0 ? 'up' : 'down',
      tip: `Latest (${fd(r.date)}): ${pc(r.pct)} room vs ${fd(SW.control)}, ${r.outside_band ? 'outside' : 'inside'} that scan's reference range (${pc(r.band_lo)} to ${pc(r.band_hi)})` + (r.outside_band ? '' : ': no measurable change')}; };
  /* range bars of the projected points (same look as the lesion volumes' range bars) */
  const rangeBars = {id: 'mswRange', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); ctx.lineWidth = 1.3;
    const many = c.data.datasets.filter(d => / projected$/.test(d.label) && d.label !== 'Total projected').length > 5;   // 15 identical bars on top of each other say nothing
    c.data.datasets.forEach((d, di) => { if (!c.isDatasetVisible(di) || (many && d.label !== 'Total projected')) return;
      d.data.forEach(p => { if (!p.proj || p.lo == null) return; const px = x.getPixelForValue(p.x), y0 = y.getPixelForValue(p.lo), y1 = y.getPixelForValue(p.hi);
        ctx.strokeStyle = d.borderColor; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.moveTo(px - 3, y0); ctx.lineTo(px + 3, y0); ctx.moveTo(px - 3, y1); ctx.lineTo(px + 3, y1); ctx.stroke(); }); });
    ctx.restore(); }};

  function draw(id, body) {
    BODY = body; PID = id; body.innerHTML = '';
    if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }
    const warn = document.createElement('div'); warn.className = 'msw-warn';
    warn.innerHTML = '<b>Shows large effects only.</b> ' + (SW.limits || '') + ' Read filled points (outside the grey band); treat hollow ones as no measurable change.';
    body.append(warn);
    const bar = document.createElement('div'); bar.className = 'msw-bar';
    bar.append(lab('Measure'), btn('Percent', !ML(), () => { V.unit = 'pct'; save(); redraw(); }, '% of each place: compares lesions of different sizes; the grey band is one place\'s reference range on each scan'),
      btn('Amount (mL)', ML(), () => { V.unit = 'ml'; save(); redraw(); }, 'Extra room in mL compared with the control MRI: amounts add up, so the total is the largest line'));
    bar.append(lab('Show'), btn('Each lesion', V.each, () => { V.each = !V.each; save(); redraw(); }, 'One line per lesion place'),
      btn('Total', V.total, () => { V.total = !V.total; save(); redraw(); }, 'All lesion places together'),
      btn('Treatments', V.tx, () => { V.tx = !V.tx; save(); redraw(); }));
    if (PR) bar.append(btn('Projection', V.proj, () => { V.proj = !V.proj; save(); redraw(); }, 'Where the reading is likely to land in 1, 2 and 3 months, from how the past scans behaved: a level with a range, not a trend. Our measure, not symptoms.'));
    body.append(bar);
    body.append(LesionChips.row({ids: IDS, color: l => LCOL[l], name: l => LNAME[l] || '', hidden: V.hidden, badge: chipBadge,
      onChange: h => { V.hidden = h; save(); redraw(); },
      badgeNote: 'badge = latest reading: ↑ more room · ↓ less room than ordinary brain on that scan · grey = inside that scan\'s normal range'}));
    const ctl = {x: pos(ms(SW.control)), y: 0, control: true};
    const ds = [];
    const hollow = p => p.raw && p.raw.r && !p.raw.r.outside_band;
    const mk = (label, col, pts, extra) => Object.assign({label, data: pts, parsing: true, borderColor: col, backgroundColor: col, borderWidth: 1.6, tension: 0, showLine: true,
      pointStyle: p => p.raw && p.raw.r && p.raw.r.field === '3T' ? 'triangle' : 'circle', pointRadius: p => p.raw && p.raw.control ? 3 : hollow(p) ? 3.5 : 5.5, pointHoverRadius: 7,
      pointBackgroundColor: p => hollow(p) ? 'rgba(0,0,0,0)' : col, pointBorderColor: p => hollow(p) ? col : '#fff', pointBorderWidth: 1.4,
      segment: {borderColor: s => s.p1.raw && s.p1.raw.r && !s.p1.raw.r.outside_band && !(s.p0.raw && s.p0.raw.r && s.p0.raw.r.outside_band) ? col.replace('rgb', 'rgba').replace(')', ',0.35)') : undefined}}, extra);
    if (V.each) IDS.filter(l => !V.hidden.includes(l)).forEach(l => {
      const P = [Object.assign({}, ctl, {lesion: l})].concat(SW.rows.filter(r => r.lesion === l && val(r) != null).sort((a, b) => ms(a.date) - ms(b.date))
        .map(r => ({x: pos(ms(r.date)), y: val(r), r, lesion: l})));
      ds.push(mk(l, LCOL[l], P)); });
    if (V.total) ds.push(mk('Total', css('--ink'), [Object.assign({}, ctl, {lesion: 'Total'})].concat(SW.totals.filter(r => val(r) != null).map(r => ({x: pos(ms(r.date)), y: val(r), r: Object.assign({total: true}, r), lesion: 'Total'}))), {borderWidth: 3}));
    /* projection: a dashed level from the scans it is the average of to the last projected month, hollow points with range bars at each month */
    if (V.proj && PR) {
      const add = (label, col, P, rowsOf, w) => { const rr = rowsOf.slice().sort((a, b) => ms(a.date) - ms(b.date)), first = rr[Math.max(0, rr.length - P.n)];
        if (!first) return; const lv = ML() ? P.level * P.region_ml / 100 : P.level;
        const pts = [{x: pos(ms(first.date)), y: lv, fit: true}, {x: pos(ms(PR.base)), y: lv, fit: true}]
          .concat(P.cells.map(c => ({x: pos(ms(c.date)), y: ML() ? c.ml : c.v, lo: ML() ? c.lo_ml : c.lo, hi: ML() ? c.hi_ml : c.hi, proj: c, lesion: label, P})));
        ds.push({label: label + ' projected', data: pts, parsing: true, borderColor: col, backgroundColor: col, borderWidth: w, borderDash: [6, 4], tension: 0, showLine: true, clip: 0,
          pointStyle: 'circle', pointRadius: p => p.raw && p.raw.proj ? 4 : 0, pointHoverRadius: p => p.raw && p.raw.proj ? 7 : 0, pointBackgroundColor: 'rgba(0,0,0,0)', pointBorderColor: col, pointBorderWidth: 1.6}); };
      if (V.each) IDS.filter(l => !V.hidden.includes(l)).forEach(l => { const P = PR.lesions.find(q => q.id === l); if (P) add(l, LCOL[l], P, SW.rows.filter(r => r.lesion === l), 1.6); });
      if (V.total && PR.total) add('Total', css('--ink'), PR.total, SW.totals, 3);
    }
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, 360) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Swelling and shrinkage around each brain lesion over time, compared with the normal control MRI');
    box.append(cv); body.append(box);
    const all = ds.flatMap(d => d.data.flatMap(p => p.proj ? [p.y, p.lo, p.hi] : [p.y])), st = ML() ? 1 : 5, lo = Math.min(ML() ? -1 : -10, ...all), hi = Math.max(ML() ? 1 : 10, ...all);
    charts.set(id, new Chart(cv, {type: 'line', plugins: [bandPlugin, rangeBars, guide].concat(typeof momentPlugin === 'object' ? [momentPlugin] : []), data: {datasets: ds},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, filter: it => !it.raw.fit, callbacks: {
          title: it => it[0] ? (it[0].raw.proj ? fd(it[0].raw.proj.date) + ' · projected (+' + it[0].raw.proj.m + ' mo), not measured' : it[0].raw.control ? fd(SW.control) : fd(it[0].raw.r.date) + ' · ' + (it[0].raw.r.field || '') + (it[0].raw.r.seq ? ' ' + it[0].raw.r.seq : '')) : '',
          label: it => { const p = it.raw;
            if (p.proj) { const c = p.proj, u = ML() ? fm : pc;
              return [(p.lesion === 'Total' ? 'All lesion places' : p.lesion + ' ' + (LNAME[p.lesion] || '')) + ': likely near ' + u(ML() ? c.ml : c.v) + ' (range ' + u(ML() ? c.lo_ml : c.lo) + ' to ' + u(ML() ? c.hi_ml : c.hi) + ')',
                'the average of the last ' + p.P.n + ' scans; 8 in 10 past scans landed inside the range', 'A level, not a trend: ' + PR.backtest.short]; }
            if (p.control) return p.lesion + ': the normal control MRI (0 by definition)';
            const r = p.r, who = r.total ? 'All lesion places' : p.lesion + ' ' + (LNAME[p.lesion] || '');
            return [who + ': ' + pc(r.pct) + ' room vs ' + fd(SW.control) + (r.ml != null ? ' (' + fm(r.ml) + ' over ' + Math.round(r.region_ml) + ' mL of brain)' : ''),
              (r.outside_band ? 'OUTSIDE' : 'inside') + ' what lesion-free places read on this scan (' + pc(r.band_lo) + ' to ' + pc(r.band_hi) + (r.total ? ', for a region this size' : '') + ')' +
                (r.outside_band ? (r.pct > 0 ? ': more room than ordinary brain that day' : ': less room than ordinary brain that day') : ': no measurable change'),
              'tissue moved ' + r.moved_mm + ' mm (median)' + (r.total ? ' · fit to the control ' + r.match : '')]
              .concat(!r.total && r.outlined === false ? ['lesion not outlined on this scan: its place only'] : [], SW.notes && SW.notes[r.date] ? ['⚠ ' + SW.notes[r.date]] : []); }}}},
        scales: {x: xAxis(), y: {min: Math.floor(lo / st) * st, max: Math.ceil(hi / st) * st, afterFit: s => { s.width = typeof YW === 'number' ? YW : s.width; },
          title: {display: true, text: (ML() ? 'extra room, mL' : '% room') + ' vs ' + fd(SW.control), color: css('--muted')}, ticks: {color: css('--muted'), callback: v => (v > 0 ? '+' : '') + v + (ML() ? '' : '%')}, grid: {color: css('--line')}}}}}));
    if (V.proj && PR) drawProjection(body);
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.innerHTML = 'How much more (+, swollen or pushed) or less (−, shrunk) room the brain around each lesion takes than on the normal ' + fd(SW.control) + ' MRI, from a flexible fit of each scan to it. ' +
      'Place = brain within ' + SW.place_mm + ' mm of the lesion\'s position on the ' + (SW.place_scan ? fd(SW.place_scan) : 'baseline') + ' scan, the lesion itself left out, the same region on every scan. ' +
      '<b>Grey band = the same measure over every lesion-free place on each scan</b> (95% range): it soaks up scanner and sequence differences and any overall change of the brain. The map itself is a layer in the Slice viewer (Swelling), coloured only outside the same band. ' +
      '<b>Filled = outside the band; hollow = inside it (no measurable change).</b> ● 1.5T ▲ 3T. ' +
      (ML() ? '<b>Amount (mL)</b>: amounts add up, so the total is the largest line (overlapping places counted once); the band shown is for the total. ' : '') +
      '<b>Nearby fluid spaces count too</b>: lesions next to the ventricles' + (SW.near_fluid && SW.near_fluid.length ? ' (' + SW.near_fluid.join(', ') + ')' : '') + ' also rise when the ventricles enlarge. Our estimate, not a reading.';
    body.append(note);
  }
  /* ---- Projection box: the test behind it, where it is drawn, and the numbers (swelling_projection.py) ---- */
  const esc_ = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function drawProjection(body) {
    const u = ML() ? fm : pc, lastT = ms(PR.months[PR.months.length - 1].date), onAxis = X1 >= lastT;
    const short = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-top:8px;padding:6px 10px;border:2px solid #e0a020;border-radius:6px;font-size:12px';
    wrap.innerHTML = '<div class="msw-bar" style="margin-bottom:2px"><b style="color:#e0a020">Projection (a level with a range, not a trend)</b> <span class="sub">from the ' + fd(PR.base) + ' scan · the reading ' + esc_(PR.rule_words) + '</span></div>' +
      '<div style="margin:2px 0 6px"><b>How far to trust it:</b> ' + esc_(PR.backtest.text) + '</div>';
    const where = document.createElement('div'); where.className = 'msw-bar'; where.style.margin = '0 0 4px';
    if (onAxis) where.innerHTML = '<span class="sub">Drawn on the chart above: dashed lines with hollow points in the tinted part to the right of today.</span>';
    else { where.innerHTML = '<span class="sub">The timeline stops before the last projected month (' + fd(PR.months[PR.months.length - 1].date) + '): only the start of the dashed lines fits.</span>';
      if (typeof setFuture === 'function') where.append(btn('Show it on the timeline', false, () => setFuture(Math.max(FUT, futFor(lastT)), true), 'Lengthens the time axis of every panel so it reaches the last projected month (the same as Future in the navigation bar)')); }
    wrap.append(where);
    const rows = (V.each ? IDS.filter(l => !V.hidden.includes(l)).map(l => PR.lesions.find(q => q.id === l)).filter(Boolean) : []).concat(V.total && PR.total ? [Object.assign({id: 'Total'}, PR.total)] : []);
    const rng = c => u(ML() ? c.lo_ml : c.lo) + ' to ' + u(ML() ? c.hi_ml : c.hi);
    const same = rows.every(r => r.cells.every(c => rng(c) === rng(r.cells[0])));   // the range did not widen with time: one column
    let h = '<div style="overflow:auto"><table class="msw-tbl"><tr><th>Lesion place</th><th>latest reading<small style="display:block;font-weight:400;color:var(--muted)">' + short(PR.base) + '</small></th>' +
      '<th title="The average of the last scans (up to three): one scan alone is noisy">expected reading</th>' +
      (same ? '<th title="8 in 10 past scans landed inside this range around the expected reading">likely range, +1 to +3 months<small style="display:block;font-weight:400;color:var(--muted)">' + short(PR.months[0].date) + ' – ' + short(lastT ? PR.months[PR.months.length - 1].date : PR.base) + '</small></th>'
            : PR.months.map(m => '<th>range +' + m.m + ' mo<small style="display:block;font-weight:400;color:var(--muted)">' + short(m.date) + '</small></th>').join('')) + '</tr>';
    rows.forEach(r => { const lv = ML() ? r.level * r.region_ml / 100 : r.level, last = ML() ? r.last * r.region_ml / 100 : r.last;
      h += `<tr><td><b style="color:${r.id === 'Total' ? 'var(--ink)' : LCOL[r.id]}" title="${esc_(LNAME[r.id] || 'All lesion places together')}">${r.id}</b></td><td>${u(last)}</td><td><b>${u(lv)}</b> <small style="color:var(--muted)">avg of ${r.n}</small></td>` +
        (same ? `<td>${rng(r.cells[0])}</td>` : r.cells.map(c => `<td>${rng(c)}</td>`).join('')) + '</tr>'; });
    h += '</table></div><details style="margin-top:4px"><summary class="sub" style="cursor:pointer">The rules that were tested</summary><table class="msw-tbl"><tr><th>If the reading…</th><th>typical miss</th><th>within 5 points</th></tr>' +
      PR.backtest.place.map(q => `<tr><td>${q.key === PR.rule ? '<b>' + esc_(q.label) + '</b> (drawn)' : esc_(q.label)}</td><td>${q.typical} points</td><td>${q.within5}%</td></tr>`).join('') +
      '</table><div class="sub" style="margin-top:3px">' + PR.backtest.n + ' cases: each lesion place on each past scan, predicting a later scan ' + PR.backtest.ahead_days[0] + '–' + PR.backtest.ahead_days[1] + ' days ahead.</div></details>' +
      '<div class="sub" style="margin-top:4px">' + esc_(PR.note) + (PR.volume_link ? ' ' + esc_(PR.volume_link.text) : '') + '</div>';
    wrap.insertAdjacentHTML('beforeend', h); body.append(wrap);
  }
  window.LesionSwelling = {draw};
})();
