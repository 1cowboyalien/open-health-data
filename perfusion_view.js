/* Brain MRI · Perfusion by lesion (Library → Imaging → Brain MRI), drawn for imaging_view.js through
   window.LesionPerfusion.draw(id, body). Added by make_lab_view.py before imaging_view.js when local/imaging/imaging.json
   exists. Everything about the patient comes from IMG_DATA, never from this code. (Tried out first in MRI (test), 2026-11-17.)
   The chart: perfusion per lesion over time: blood volume (rCBV, from the hospital's DSC map) and blood flow
   (ASL) inside each lesion's outline, as a ratio to normal brain on the same map; treatments as bands.
   Data used: IMG_DATA.perfusion {method, small_mm3, rows [{date, lesion, name, field, vol_mm3, small, coverage, skip?,
              rcbv_mean_ratio, rcbv_p90_ratio, rcbv_ring_ratio, rcbv_vessel, asl_mean_ratio, asl_p90_ratio, asl_ring_ratio,
              asl_vessel, asl_coverage, ktrans_mean?, ktrans_normal?}]} (made by imaging/perfusion/perfusion.py);
              IMG_DATA.lesion_series {lesions [{id,name,rgb}], treatments}.
   Lesion buttons: LesionChips.row (lesion_chips.js), the same component and badge style as the other imaging panels. */
(() => {
  const LS = IMG_DATA.lesion_series, PF = IMG_DATA.perfusion;
  if (!LS || !PF || !PF.rows || !PF.rows.length) return;
  const PANEL = {h0: 340};
  const MEAS = {rcbv: {label: 'Blood volume (rCBV)', short: 'rCBV', dash: undefined}, asl: {label: 'Blood flow (ASL)', short: 'ASL', dash: [5, 4]}};
  const V = Object.assign({m: 'both', tx: true, hidden: [], ref: 'normal'}, store.get('img.perfChart', store.get('mrit.perf', {})));   // (saved under mrit.perf while in MRI (test))
  const val = (r, k) => r[k + (V.ref === 'near' ? '_vs_near' : '_mean_ratio')];   // the value drawn: × normal brain, or × nearby brain
  const WHY = {ring: 'against vessels: the 1–4 mm ring around it is brighter than the lesion', 'bright surroundings': 'a bright vessel stripe runs through the area: nearby brain is as bright as the lesion'};
  const save = () => store.set('img.perfChart', V);
  const LCOL = Object.fromEntries(LS.lesions.map(l => [l.id, 'rgb(' + l.rgb + ')']));
  const LNAME = Object.fromEntries(LS.lesions.map(l => [l.id, l.name]));
  const IDS = [...new Set(PF.rows.map(r => r.lesion))].sort();
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const x2 = v => v == null ? '–' : v.toFixed(v >= 10 ? 0 : 1) + '×';
  const esc_ = t => String(t).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
  let BODY = null;
  let PID = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(PID, BODY); };

  if (!document.getElementById('mritPerfCss')) { const st = document.createElement('style'); st.id = 'mritPerfCss';
    st.textContent = '.mrp-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}.mrp-bar .lab{color:var(--muted);font-size:11px;margin-left:6px}' +
      '.mrp-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.mrp-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.mrp-tbl{border-collapse:collapse;font-size:11px;margin-top:8px}.mrp-tbl td,.mrp-tbl th{padding:2px 7px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}' +
      '.mrp-tbl th{color:var(--ink2);font-weight:600}.mrp-tbl td:first-child,.mrp-tbl th:first-child{text-align:left}.mrp-tbl .na{color:var(--muted)}' +
      '.mrp-tbl .hi{color:#e34948;font-weight:700}.mrp-tbl .vs{color:var(--muted);text-decoration:line-through}.mrp-tbl small{color:var(--muted);font-size:9.5px}';
    document.head.append(st); }

  const txPlugin = {id: 'mrpTx', beforeDatasetsDraw(c) { if (!V.tx) return; const {ctx, chartArea: a, scales: {x}} = c;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    (LS.treatments || []).forEach(t => { let x0 = x.getPixelForValue(pos(ms(t.start))), x1 = x.getPixelForValue(pos(ms(t.end)));
      if (x1 - x0 < 6) { const m = (x0 + x1) / 2; x0 = m - 3; x1 = m + 3; }
      const wb = /whole-brain/i.test(t.treatment);
      ctx.fillStyle = wb ? 'rgba(237,161,0,0.22)' : 'rgba(98,80,214,0.16)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.fillStyle = wb ? '#c98a00' : '#6250d6'; ctx.font = 'bold 10px system-ui'; ctx.fillText(wb ? 'WBRT' : 'SRS', x0 + 2, a.top + 10); });
    ctx.restore(); }};
  /* reference line at 1× = normal brain on the same map */
  const refLine = {id: 'mrpRef', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {y}} = c, py = y.getPixelForValue(1);
    if (py < a.top || py > a.bottom) return; ctx.save(); ctx.strokeStyle = css('--ink2'); ctx.globalAlpha = .6; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui'; ctx.fillText((V.ref === 'near' ? 'same as nearby brain' : 'normal brain') + ' = 1×', a.left + 4, py - 3); ctx.restore(); }};
  const guide = {id: 'mrpGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  function xAxis() { const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}}; }

  const btn = (txt, on, fn, tip) => { const b = document.createElement('button'); b.className = 'mrp-b' + (on ? ' on' : ''); b.textContent = txt; if (tip) b.title = tip; b.onclick = fn; return b; };
  const lab = t => { const s = document.createElement('span'); s.className = 'lab'; s.textContent = t; return s; };

  /* the badge on a lesion's button: its latest value in the current view (blood volume unless only blood flow is shown; x normal or
     x nearby brain as chosen). Red up at 1.5x or more (the table's rule), green down at two-thirds or less, grey in between;
     a value that is mostly not the lesion's own (vessel spill) stays grey with a warning mark */
  function chipBadge(l, k) {
    const r = PF.rows.filter(x => x.lesion === l && val(x, k) != null).sort((a, b) => ms(b.date) - ms(a.date))[0]; if (!r) return null;
    const v = val(r, k), spill = !!r[k + '_vessel'], lastK = PF.rows.reduce((m, x) => val(x, k) != null && x.date > m ? x.date : m, ''), stale = r.date < lastK;
    return {text: x2(v), dir: spill ? 'flat' : v >= 1.5 ? 'up' : v <= 1 / 1.5 ? 'down' : 'flat', weak: spill || !!r.small, stale,
      tip: (stale ? 'No value on the latest scan with this map (' + fd(lastK) + ')\n' : '') + 'Latest ' + MEAS[k].label + ' (' + fd(r.date) + ', ' + r.field + '): ' + x2(v) + (V.ref === 'near' ? ' nearby brain' : ' normal brain') +
        (spill ? '\n⚠ mostly not the lesion\'s own value: ' + (WHY[r[k + '_vessel_why']] || WHY.ring) : '') + (r.small ? '\n⚠ small: only a few perfusion pixels, noisy' : '')};
  }
  function draw(id, body) {
    BODY = body; PID = id; body.innerHTML = '';
    if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }
    const ms_ = V.m === 'both' ? ['rcbv', 'asl'] : [V.m];
    /* toolbar */
    const bar = document.createElement('div'); bar.className = 'mrp-bar';
    bar.append(lab('Show'));
    [['rcbv', 'Blood volume'], ['asl', 'Blood flow'], ['both', 'Both']].forEach(([k, t]) => bar.append(btn(t, V.m === k, () => { V.m = k; save(); redraw(); },
      k === 'rcbv' ? 'rCBV: blood volume from the contrast perfusion scan (DSC), solid lines' : k === 'asl' ? 'ASL: blood flow measured without contrast, dashed lines' : 'Both: rCBV solid, ASL dashed')));
    bar.append(lab('Compare with'));
    [['normal', 'Normal brain', 'Lesion ÷ normal brain across the whole scan'], ['near', 'Nearby brain', 'Lesion ÷ the brain within ' + (PF.near_mm || 15) + ' mm of it: does it stand out from its own surroundings?']]
      .forEach(([k, t, tip]) => bar.append(btn(t, V.ref === k, () => { V.ref = k; save(); redraw(); }, tip)));
    bar.append(btn('Treatments', V.tx, () => { V.tx = !V.tx; save(); redraw(); }));
    body.append(bar);
    const bk = ms_[0];   // the measure the badges show
    body.append(LesionChips.row({ids: IDS, color: l => LCOL[l], name: l => LNAME[l] || '', hidden: V.hidden, badge: l => chipBadge(l, bk),
      onChange: h => { V.hidden = h; save(); redraw(); },
      badgeNote: 'badge = latest ' + (bk === 'rcbv' ? 'blood volume' : 'blood flow') + ': ↑ 1.5× or more · ↓ two-thirds or less · grey = about the same as ' + (V.ref === 'near' ? 'nearby' : 'normal') + ' brain · faded = not on the latest scan'}));
    /* one line per lesion per measure */
    const ds = [];
    IDS.filter(l => !V.hidden.includes(l)).forEach(l => ms_.forEach(k => {
      const P = PF.rows.filter(r => r.lesion === l && val(r, k) != null).sort((a, b) => ms(a.date) - ms(b.date))
        .map(r => { const f = r[k + '_mean_ratio'] ? val(r, k) / r[k + '_mean_ratio'] : 1;      // same scale as the value drawn (normal or nearby brain)
          return {x: pos(ms(r.date)), y: val(r, k), r, k, lo: r[k + '_lo'] != null ? r[k + '_lo'] * f : null, hi: r[k + '_hi'] != null ? r[k + '_hi'] * f : null}; });
      if (!P.length) return;
      const col = LCOL[l];
      ds.push({label: l + ' ' + MEAS[k].short, data: P, parsing: true, borderColor: col, backgroundColor: col, borderWidth: k === 'rcbv' ? 2 : 1.6, borderDash: MEAS[k].dash, showLine: true, tension: 0,
        pointStyle: p => p.raw && p.raw.r.field === '3T' ? 'triangle' : 'circle', pointRadius: p => p.raw && p.raw.r.small ? 3.5 : 5, pointHoverRadius: 7,
        pointBackgroundColor: p => p.raw && p.raw.r[k + '_vessel'] ? 'rgba(0,0,0,0)' : col, pointBorderColor: p => p.raw && p.raw.r[k + '_vessel'] ? col : '#fff', pointBorderWidth: 1.4,
        segment: {borderColor: s => s.p1.raw && s.p1.raw.r[k + '_vessel'] || s.p0.raw && s.p0.raw.r[k + '_vessel'] ? col.replace('rgb', 'rgba').replace(')', ',0.35)') : undefined}});
    }));
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANEL.h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Perfusion inside each brain lesion over time, as a ratio to normal brain');
    box.append(cv); body.append(box);
    const ymax = Math.max(V.ref === 'near' ? 2 : 3, ...ds.flatMap(d => d.data.filter(p => !p.r[p.k + '_vessel']).map(p => p.y))) * 1.08;   // vessel-spill points may run off the top
    /* position range: a thin bar from the lowest to the highest value the lesion would read if the map sat 2 mm off in any direction */
    const rangeBars = {id: 'mrpRange', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c;
      ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); ctx.lineWidth = 1.3;
      c.data.datasets.forEach((d, di) => { if (!c.isDatasetVisible(di)) return;
        d.data.forEach(p => { if (p.lo == null || p.hi == null || !(p.hi > p.lo)) return;
          const px = x.getPixelForValue(p.x), y0 = y.getPixelForValue(p.lo), y1 = y.getPixelForValue(p.hi); if (Math.abs(y0 - y1) < 3) return;
          ctx.strokeStyle = d.borderColor; ctx.globalAlpha = .5;
          ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.moveTo(px - 3, y0); ctx.lineTo(px + 3, y0); ctx.moveTo(px - 3, y1); ctx.lineTo(px + 3, y1); ctx.stroke(); }); });
      ctx.restore(); }};
    /* perfusion has no projection (none has been tested on the past scans): say so where the projected dates are marked, so the
       amber date lines of the shared Projection switch (projection_dates.js) are not read as "nothing expected" */
    const noProj = {id: 'mrpNoProj', afterDatasetsDraw(c) { const P = window.Projection; if (!P || !P.active()) return; const {ctx, chartArea: a, scales: {x}} = c;
      const x0 = x.getPixelForValue(pos(P.first)); if (!(x0 > a.left && x0 < a.right)) return;
      ctx.save(); ctx.font = '10px system-ui'; ctx.fillStyle = css('--muted'); ctx.textBaseline = 'top';
      const L = ['no projection for perfusion:', 'none tested on the past scans'], w = Math.max(...L.map(t => ctx.measureText(t).width));
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = css('--card');   // outlined so the date lines do not cut through the words
      if (a.right - x0 > w + 8) L.forEach((t, i) => { ctx.strokeText(t, x0 + 5, a.top + 26 + i * 11); ctx.fillText(t, x0 + 5, a.top + 26 + i * 11); });
      ctx.restore(); }};
    charts.set(id, new Chart(cv, {type: 'line', plugins: [txPlugin, refLine, rangeBars, guide, noProj].concat(typeof momentPlugin === 'object' ? [momentPlugin] : []), data: {datasets: ds},
      options: {animation: false, maintainAspectRatio: false, clip: 6, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, callbacks: {
          title: it => it[0] ? fd(it[0].raw.r.date) + ' · ' + it[0].raw.r.field : '',
          label: it => { const {r, k} = it.raw;
            return [r.lesion + ' ' + MEAS[k].label + ': ' + x2(r[k + '_mean_ratio']) + ' normal brain (top 10%: ' + x2(r[k + '_p90_ratio']) + ')',
              (r[k + '_vs_near'] != null ? x2(r[k + '_vs_near']) + ' nearby brain (nearby: middle ' + x2(r[k + '_near_ratio']) + ', top 10% ' + x2(r[k + '_near_p90_ratio']) + ' normal)' : 'nearby brain: not enough covered'),
              LNAME[r.lesion] + ' · ' + r.vol_mm3 + ' mm³ outlined'].concat(
              r[k + '_lo'] != null && r[k + '_hi'] > r[k + '_lo'] ? ['position range ' + x2(r[k + '_lo']) + ' – ' + x2(r[k + '_hi']) + ' normal brain (if the map sat 2 mm off in any direction)'] : [],
              r[k + '_position'] === 'corrected' ? ['map placed through the ' + r[k + '_offset_mm'] + ' mm offset measured between this perfusion scan and the T1']
                : r[k + '_position'] ? ['⚠ the offset between this perfusion scan and the T1 could not be measured: the value may sit a few mm off'] : [],
              r[k + '_vessel'] ? ['⚠ ' + (WHY[r[k + '_vessel_why']] || WHY.ring) + ' (ring ' + x2(r[k + '_ring_ratio']) + '), so this value is mostly not the lesion\'s own'] : [],
              r.small ? ['small: only a few perfusion pixels, noisy'] : [],
              k === 'rcbv' && r.ktrans_mean != null ? ['DCE leakiness (Ktrans) ' + (r.ktrans_mean / r.ktrans_normal).toFixed(0) + '× normal brain'] : []); }}}},
        scales: {x: xAxis(), y: {min: 0, max: Math.ceil(ymax), afterFit: s => { s.width = typeof YW === 'number' ? YW : s.width; },
          title: {display: true, text: V.ref === 'near' ? '× nearby brain' : '× normal brain', color: css('--muted')}, ticks: {color: css('--muted'), callback: v => v + '×'}, grid: {color: css('--line')}}}}}));
    /* lesion × scan grid: rCBV / ASL (struck through = vessel spill; red = 1.5× or more and not vessel spill) */
    const dates = [...new Set(PF.rows.map(r => r.date))].sort();
    const cell = (r, k) => { if (!r) return '<span class="na">·</span>'; const v = val(r, k);
      if (v == null) return '<span class="na" title="' + (k === 'rcbv' ? (r.skip || 'not measured') : 'not lined up with our outlines or outside the ASL coverage') + '">–</span>';
      return '<span class="' + (r[k + '_vessel'] ? 'vs' : v >= 1.5 ? 'hi' : '') + '"' + (r[k + '_vessel'] ? ' title="' + (WHY[r[k + '_vessel_why']] || WHY.ring) + '"' : '') + '>' + x2(v) + '</span>'; };
    let h = '<div style="overflow-x:auto"><table class="mrp-tbl"><tr><th>Lesion <small>rCBV / ASL</small></th>' + dates.map(d => '<th>' + new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) + " '" + d.slice(2, 4) + '<br><small>' + (PF.rows.find(r => r.date === d) || {}).field + '</small></th>').join('') + '</tr>';
    IDS.forEach(l => { h += '<tr><td><b style="color:' + LCOL[l] + '">' + l + '</b> <small>' + (LNAME[l] || '') + '</small></td>' +
      dates.map(d => { const r = PF.rows.find(q => q.lesion === l && q.date === d); return '<td>' + (r ? cell(r, 'rcbv') + ' / ' + cell(r, 'asl') : '<span class="na">·</span>') + '</td>'; }).join('') + '</tr>'; });
    body.insertAdjacentHTML('beforeend', h + '</table></div>');
    const kt = PF.rows.filter(r => r.ktrans_mean != null);
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.innerHTML = 'How much blood is in each lesion compared with normal brain on the same scan (1× = normal). Growing tumor usually builds new vessels (high); ' +
      'radiation damage usually doesn\'t (low). <b>Our own estimate from the hospital\'s maps, not a reading.</b> Solid = blood volume (rCBV, contrast perfusion); dashed = blood flow (ASL, no contrast). ' +
      '● 1.5T, ▲ 3T: <b>values from different scanners don\'t compare well</b>; compare a lesion with normal brain on the same scan. <b>Compare with Nearby brain</b> = lesion ÷ the brain within ' + (PF.near_mm || 15) + ' mm of it (does it stand out from its own surroundings; brain surface and vessels nearby raise the baseline). ' +
      'Hollow / struck through = the value is mostly not the lesion\'s own: it sits against veins (blood volume), or a bright vessel stripe runs through the area (blood flow). Small dots = lesion only a few perfusion pixels. ' +
      '"Normal brain" mixes grey and white matter, so ratios read lower than the usual "vs white matter" figures. Blood-volume maps cover a slab of the head, so a lesion above or below it has no value. <b>Each map is placed through the offset measured between its scan and the T1 of the same visit</b> (a few mm: head movement and, for blood volume, image distortion); where that could not be measured the hover box says so. <b>Thin bars = the value if the map sat 2 mm off in any direction</b>: a long bar means the reading is fragile (small lesion, or next to something bright). ' +
      (kt.length ? 'Vessel leakiness (DCE Ktrans), ' + fd(kt[0].date) + ' only: ' + kt.map(r => r.lesion + ' ' + (r.ktrans_mean / r.ktrans_normal).toFixed(0) + '×').join(', ') + ' normal brain (every enhancing lesion leaks, so compare lesions with each other). ' : '') +
      (PF.viewer_note ? esc_(PF.viewer_note) + ' ' : '') +   // case-specific remarks come from the (private) data file, never from this code
      'Library → Imaging → Brain MRI → Slice viewer can show these maps as a colour layer (Perfusion). ' +
      '<b>No projection for perfusion</b>: none has been tested against the past scans, so when Projection is on in Lesions over time or Swelling the amber lines here only mark its dates.';
    body.append(note);
  }

  window.LesionPerfusion = {draw};
})();
