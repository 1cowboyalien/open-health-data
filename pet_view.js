/* Imaging → PET in the Library of the lab viewer (labs.html): FDG PET/CT scans.
   Loaded after imaging_view.js by make_lab_view.py, only when local/imaging/pet/pet.json exists (made outside this repo).
   Everything about the patient (dates, hospitals, scanners, numbers, report wording) comes from PET_DATA, never from this code.
   Panels (same hooks as the MRD and brain MRI panels, so they get the same ⤒ ↑ ↓ ⤓ − + × controls and Compare stacking):
     pet:dates = every PET as a point on the shared time axis, one row per scanner model (SUVs differ somewhat between machines)
     pet:mip   = turning whole-body pictures (maximum intensity projections), all scans side by side and in step, on one SUV
                 scale; or scaled by each scan's own liver, which takes out most of the wait-time and weight differences
     pet:ref   = reference organs over time: liver (our 3 cm ball, and the report's own number where it gives one), and each
                 half of the brain; SUV or SUL (lean body mass)
   Data: PET_DATA = {scans: [{date, site, scanner, model, px_mm, slice_mm, dose_mbq, dose_mci, weight_kg, height_m, wait_min,
           sul_factor, report: {file, short, liver: {mean, max?}}, liver: {mean, sd, region_ml}, brain: {mean, right, left, asym_pct, ml},
           mip: {file, views, w, h, mm, liver_row, top}}], suv_top, note}
   The pictures are served by serve_viewer.py from local/imaging/<mip.file> (.jpg). */
(() => {
  if (typeof PET_DATA === 'undefined' || !PET_DATA.scans || !PET_DATA.scans.length) return;
  const S = PET_DATA.scans.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const ID = 'pet:dates', IDM = 'pet:mip', IDR = 'pet:ref';
  const PANELS = {[ID]: {title: 'PET · Scan dates', unit: S.length + ' scans · by scanner', h0: 170},
                  [IDM]: {title: 'PET · Whole-body pictures', unit: 'turning · all scans in step', h0: 470},
                  [IDR]: {title: 'PET · Reference organs', unit: 'our measurements · liver and brain', h0: 300}};
  const SITE = Object.fromEntries(((typeof IMG_DATA !== 'undefined' && IMG_DATA.sites) || []).map(s => [s.key, s]));
  const LONG = k => (SITE[k] && SITE[k].long) || k, SHORT = k => (SITE[k] && SITE[k].short) || k;
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const MODELS = [...new Set(S.map(s => s.scanner))];
  const BODIES = new Map();
  const shortModel = m => /Quadra/i.test(m) ? 'Quadra' : /Discovery MI/i.test(m) ? 'GE DMI' : /mCT/i.test(m) ? 'mCT' : m.replace(/^(Siemens|GE) (Biograph )?/i, '').slice(0, 7);   // fits the 46 px label column; the tooltip has the full name
  const st = Object.assign({mode: 'all', pick: S[S.length - 1].date, scale: 'suv', play: true, view: 0, unit: 'suv'}, store.get('pet.view', {}));
  const save = () => store.set('pet.view', {mode: st.mode, pick: st.pick, scale: st.scale, play: st.play, unit: st.unit});

  function xAxis() {
    const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}};
  }
  const guide = {id: 'petGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  const facts = s => [s.scanner + ' · pixels ' + s.px_mm + ' mm', 'Tracer ' + s.dose_mci + ' mCi · weight ' + s.weight_kg + ' kg · scan began ' + s.wait_min + ' min after the injection'];
  const note = (body, txt) => { const n = document.createElement('div'); n.className = 'sub'; n.style.marginTop = '4px'; n.textContent = txt; body.appendChild(n); return n; };
  const kill = id => { const c = charts.get(id); if (c) { c.destroy(); charts.delete(id); } };

  /* ================= Scan dates ================= */
  function drawDates(id, body) {
    kill(id); body.innerHTML = '';
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'PET scan dates by scanner');
    box.appendChild(cv); body.appendChild(box);
    const pts = S.map(s => ({x: pos(ms(s.date)), y: MODELS.indexOf(s.scanner), s}));
    const c = new Chart(cv, {type: 'scatter', plugins: [guide, momentPlugin],
      data: {datasets: [{data: pts, pointRadius: 7, pointHoverRadius: 9, pointBackgroundColor: p => p.raw ? srcColor(p.raw.s.site) : '#888',
        pointBorderColor: '#fff', pointBorderWidth: 2}]},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); ch.canvas.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: (e, els, ch) => { if (!els.length) return; openPicture(ch.data.datasets[0].data[els[0].index].s.date); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, callbacks: {
          title: it => fd(it[0].raw.s.date) + ' · ' + LONG(it[0].raw.s.site),
          label: it => { const s = it.raw.s; return [s.report.short].concat(facts(s), ['Click: show its whole-body picture']); }}}},
        scales: {x: xAxis(), y: {min: -0.6, max: MODELS.length - 0.4, reverse: true, afterFit: s => { s.width = YW; },
          afterBuildTicks: a => { a.ticks = MODELS.map((_, i) => ({value: i})); },
          ticks: {color: css('--muted'), autoSkip: false, font: {size: 10}, callback: v => shortModel(MODELS[v] || '')}, grid: {color: css('--line')}}}}});
    charts.set(id, c); box.onmouseleave = () => setHover(null);
    note(body, 'One row per scanner model: SUVs are best compared on the same machine. Color = hospital. Click a scan to see its whole-body picture.');
  }

  /* ================= Whole-body pictures (turning MIPs) ================= */
  const IMGS = {};   // date -> Image (sprite of every view side by side)
  const img = s => { if (!IMGS[s.date]) { const i = new Image(); i.src = 'imaging/' + s.mip.file; i.onload = () => paintAll(); IMGS[s.date] = i; } return IMGS[s.date]; };
  const REF = (() => { const l = S.filter(s => s.liver).map(s => s.liver.mean).sort((a, b) => a - b); return l[Math.floor(l.length / 2)] || 2.5; })();   // median liver: the "÷ liver" picture shows every scan as if its liver were this bright
  let cells = [], timer = null, drag = null;
  function openPicture(date) {
    st.mode = 'one'; st.pick = date; save();
    if (!sel.includes(IDM)) setLabSel([IDM], true); else MRD.refresh(IDM);
  }
  function paint(cell) {
    const s = cell.s, m = s.mip, im = img(s), g = cell.cv.getContext('2d'), W = cell.cv.width, H = cell.cv.height;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (!im.complete || !im.naturalWidth) return;
    const v = ((st.view % m.views) + m.views) % m.views;
    g.imageSmoothingEnabled = true; g.drawImage(im, v * m.w, 0, m.w, m.h, 0, 0, W, H);
    if (st.scale === 'liver' && s.liver) {   // darkness = SUV / top; scaled so this scan's liver sits where the median liver does
      const k = REF / s.liver.mean, d = g.getImageData(0, 0, W, H), p = d.data;
      for (let i = 0; i < p.length; i += 4) { const y = 255 - Math.min(255, (255 - p[i]) * k); p[i] = p[i + 1] = p[i + 2] = y; }
      g.putImageData(d, 0, 0);
    }
  }
  function paintAll() { cells.forEach(c => c.cv.isConnected && paint(c)); const a = BODIES.get(IDM); if (a) { const r = a.querySelector('.petang'); if (r) r.value = ((st.view % 24) + 24) % 24; } }
  function tick() { clearTimeout(timer); timer = null; const b = BODIES.get(IDM);
    if (!st.play || !b || !b.isConnected || drag) return; st.view++; paintAll(); timer = setTimeout(tick, document.hidden ? 1000 : 140); }
  function drawPictures(id, body) {
    body.innerHTML = ''; clearTimeout(timer); timer = null;
    const H = hOf(id, PANELS[id].h0);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;font-size:12px;margin-bottom:6px';
    const btn = (t, tip, on, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = tip; b.style.cssText = 'font-size:11px;padding:1px 8px;line-height:17px' + (on ? ';outline:1px solid var(--accent)' : '');
      b.setAttribute('aria-pressed', !!on); b.onclick = e => { e.stopPropagation(); fn(); save(); drawPictures(id, body); }; return b; };
    bar.append(btn(st.play ? '❚❚ Pause' : '▶ Turn', st.play ? 'Stop turning' : 'Turn the pictures', false, () => { st.play = !st.play; }));
    const ang = document.createElement('input'); ang.type = 'range'; ang.min = 0; ang.max = 23; ang.step = 1; ang.className = 'petang'; ang.style.width = '90px';
    ang.setAttribute('aria-label', 'Turn: view angle'); ang.value = ((st.view % 24) + 24) % 24;
    ang.oninput = () => { st.play = false; st.view = +ang.value; paintAll(); }; bar.append(ang);
    bar.append(btn('All scans', 'Every scan side by side, turning in step', st.mode === 'all', () => { st.mode = 'all'; }),
               btn('One scan', 'One scan, large', st.mode === 'one', () => { st.mode = 'one'; }));
    const sw = document.createElement('span'); sw.style.cssText = 'display:inline-flex;gap:4px;align-items:center;padding-left:8px;border-left:1px solid var(--line)';
    sw.append('Scale:', btn('SUV 0–' + PET_DATA.suv_top, 'The same SUV scale for every scan (white = 0, black = ' + PET_DATA.suv_top + ' or more)', st.scale === 'suv', () => { st.scale = 'suv'; }),
              btn('÷ liver', 'Each scan scaled by its own liver (our 3 cm ball), so a longer wait or a weight change shifts it less', st.scale === 'liver', () => { st.scale = 'liver'; }));
    bar.append(sw);
    if (st.mode === 'one') { const pk = document.createElement('select'); pk.setAttribute('aria-label', 'Scan date'); pk.style.cssText = 'font-size:11px';
      S.filter(s => s.mip).forEach(s => { const o = document.createElement('option'); o.value = s.date; o.textContent = fd(s.date) + ' · ' + SHORT(s.site); o.selected = s.date === st.pick; pk.appendChild(o); });
      pk.onchange = () => { st.pick = pk.value; save(); drawPictures(id, body); }; bar.append(pk); }
    body.appendChild(bar);
    const list = S.filter(s => s.mip && (st.mode === 'all' || s.date === st.pick));
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;justify-content:safe center;overflow-x:auto;touch-action:pan-y;cursor:grab;user-select:none';
    const wrapW = Math.max(200, (body.clientWidth || 600) - 4), capH = 46, imgH = Math.max(120, H - 70 - capH);
    const m0 = list[0] ? list[0].mip : {w: 160, h: 270};
    let ch = imgH, cw = Math.round(ch * m0.w / m0.h);
    if (st.mode === 'all') { let per = list.length, fit = Math.floor((wrapW - 6 * (per - 1)) / per);
      if (fit < 64) { per = Math.ceil(list.length / 2); fit = Math.floor((wrapW - 6 * (per - 1)) / per); row.style.flexWrap = 'wrap'; row.style.rowGap = '8px'; }   // a phone: two rows of larger pictures
      if (cw > fit) { cw = fit; ch = Math.round(cw * m0.h / m0.w); } }
    cells = list.map(s => {
      const c = document.createElement('div'); c.style.cssText = 'flex:none;text-align:center;font-size:11px;line-height:1.3;width:' + cw + 'px';
      const cv = document.createElement('canvas'); cv.width = s.mip.w; cv.height = s.mip.h; cv.style.cssText = 'width:' + cw + 'px;height:' + ch + 'px;border:1px solid var(--line);border-radius:4px;background:#fff';
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Whole-body PET picture, ' + fd(s.date));
      const cap = document.createElement('div'); cap.style.cssText = 'color:var(--muted);overflow:hidden';
      const d1 = document.createElement('b'); d1.style.color = 'var(--ink)'; d1.textContent = st.mode === 'all' && cw < 70 ? s.date.slice(2, 7).replace('-', '/') : fd(s.date);
      cap.append(d1, document.createElement('br'), (cw < 70 ? '' : SHORT(s.site) + ' · ') + s.wait_min + ' min');
      if (s.liver && cw >= 70) cap.append(document.createElement('br'), 'liver ' + s.liver.mean.toFixed(1));
      c.title = fd(s.date) + ' · ' + LONG(s.site) + '\n' + s.report.short + '\n' + facts(s).join('\n') + (s.liver ? '\nLiver (our 3 cm ball): SUV ' + s.liver.mean.toFixed(2) : '');
      c.append(cv, cap); row.appendChild(c); return {s, cv};
    });
    body.appendChild(row);
    // drag sideways to turn (mouse or finger); a tap on a small picture opens it large
    row.onpointerdown = e => { drag = {x: e.clientX, v: st.view, moved: false}; row.setPointerCapture(e.pointerId); };
    row.onpointermove = e => { if (!drag) return; const dv = Math.round((e.clientX - drag.x) / 12); if (dv) drag.moved = true; st.view = drag.v - dv; paintAll(); };
    row.onpointerup = row.onpointercancel = e => { const d = drag; drag = null;
      if (d && !d.moved && st.mode === 'all') { const k = cells.findIndex(c => c.cv === e.target); if (k >= 0) { openPicture(cells[k].s.date); return; } }
      if (st.play) tick(); };
    note(body, (st.scale === 'suv' ? 'Same scale for every scan: white = SUV 0, black = SUV ' + PET_DATA.suv_top + ' or more. '
      : 'Each scan scaled by its own liver (to a liver of ' + REF.toFixed(1) + '). ') +
      'Brain, heart, kidneys and bladder are dark on every scan: they use (or pass out) a lot of sugar normally. Lined up on the liver; patient\'s right on the left when facing. Drag to turn' +
      (st.mode === 'all' ? '; tap a picture to see it large.' : '.') + ' Our pictures from the image files, not the hospital\'s.');
    paintAll(); if (st.play) timer = setTimeout(tick, 140);
    // the pictures are sized to the panel's width: draw again when it changes (Library shown or hidden, window resized, phone turned)
    if (!body._petRO) { let w0 = body.clientWidth; body._petRO = new ResizeObserver(() => { const w = body.clientWidth; if (w && Math.abs(w - w0) > 8 && body.isConnected) { w0 = w; drawPictures(id, body); } }); body._petRO.observe(body); }
  }

  /* ================= Reference organs over time ================= */
  function drawRef(id, body) {
    kill(id); body.innerHTML = '';
    const sul = st.unit === 'sul', f = s => sul ? (s.sul_factor || NaN) : 1, U = sul ? 'SUL' : 'SUV';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:4px';
    [['suv', 'SUV', 'Standardized uptake value by body weight (what reports use)'], ['sul', 'SUL', 'SUV by lean body mass (James formula): moves less when weight changes']].forEach(([k, t, tip]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = tip; b.setAttribute('aria-pressed', st.unit === k);
      b.style.cssText = 'font-size:11px;padding:1px 8px;line-height:17px' + (st.unit === k ? ';outline:1px solid var(--accent)' : '');
      b.onclick = e => { e.stopPropagation(); st.unit = k; save(); drawRef(id, body); }; bar.appendChild(b); });
    body.appendChild(bar);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + Math.max(140, hOf(id, PANELS[id].h0) - 60) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Liver and brain uptake on each PET');
    box.appendChild(cv); body.appendChild(box);
    const P = (s, v) => ({x: pos(ms(s.date)), y: v * f(s), s});
    const BR = '#7b68ee', BL = '#e07b39', LV = '#2e9e6e';
    const ds = [
      {label: 'Brain, right half', data: S.filter(s => s.brain).map(s => P(s, s.brain.right)), borderColor: BR, backgroundColor: BR, pointRadius: 4, borderWidth: 2, showLine: true},
      {label: 'Brain, left half', data: S.filter(s => s.brain).map(s => P(s, s.brain.left)), borderColor: BL, backgroundColor: BL, pointRadius: 4, borderWidth: 2, showLine: true},
      {label: 'Liver (ours)', data: S.filter(s => s.liver).map(s => P(s, s.liver.mean)), borderColor: LV, backgroundColor: LV, pointRadius: 4, borderWidth: 2, showLine: true},
      {label: 'Liver (report)', data: S.filter(s => s.report.liver).map(s => P(s, s.report.liver.mean)), borderColor: LV, backgroundColor: '#fff', pointRadius: 6, pointStyle: 'rectRot', borderWidth: 2, showLine: false}];
    const c = new Chart(cv, {type: 'scatter', plugins: [guide, momentPlugin], data: {datasets: ds},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
        plugins: {legend: {display: true, position: 'top', align: 'start', labels: {boxWidth: 10, boxHeight: 10, font: {size: 11}, color: css('--ink')}},
          tooltip: {callbacks: {title: it => fd(it[0].raw.s.date) + ' · ' + it[0].raw.s.scanner,
            label: it => it.dataset.label + ': ' + U + ' ' + it.parsed.y.toFixed(2),
            afterBody: it => { const s = it[0].raw.s; return (s.brain ? ['Right vs left half of the brain: ' + (s.brain.asym_pct > 0 ? '+' : '') + s.brain.asym_pct + ' %'] : ['Head not in this scan'])
              .concat(['Scan began ' + s.wait_min + ' min after the injection · weight ' + s.weight_kg + ' kg']); }}}},
        scales: {x: xAxis(), y: {min: 0, afterFit: s => { s.width = YW; }, title: {display: true, text: U, color: css('--muted'), font: {size: 10}},
          ticks: {color: css('--muted')}, grid: {color: css('--line')}}}}});
    charts.set(id, c); box.onmouseleave = () => setHover(null);
    note(body, 'Our own measurements from the image files, not the hospital\'s: liver = mean in a 3 cm ball in the right lobe (placed automatically; ◇ = the report\'s liver number where it gives one); ' +
      'brain halves split at the brain\'s middle. Brain lines missing = the head was not in that scan. Higher numbers on every organ at once usually mean a longer wait or a different scanner, not a body change.');
  }

  /* ================= plug into the viewer's hooks (after imaging_view.js) ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => typeof id === 'string' && id.startsWith('pet:');
  const DRAW = {[ID]: drawDates, [IDM]: drawPictures, [IDR]: drawRef};
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? (id === IDM && st.mode === 'one' ? fd(st.pick) : PANELS[id].unit) : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); BODIES.set(id, body); DRAW[id](id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); const b = BODIES.get(id); if (b && b.isConnected) DRAW[id](id, b); };

  /* Library: Imaging → PET (a second group under the Imaging heading the brain MRI file makes) */
  MRD.section = (el, q) => {
    o.section(el, q);
    if (q && !'imaging pet fdg sugar suv sul liver whole body mip pictures scanner scans'.includes(q)) return;
    let S0 = [...el.children].find(d => d.tagName === 'DETAILS' && d.querySelector(':scope>summary .st') && d.querySelector(':scope>summary .st').textContent === 'Imaging');
    if (!S0) S0 = section(el, 'img', 'Imaging', '1 group', true, 'sec', q);
    else { const n = S0.querySelector(':scope>summary .n'); if (n && /group/.test(n.textContent)) n.textContent = (parseInt(n.textContent) + 1) + ' groups'; }
    const ids = [ID, IDM, IDR], k = ids.filter(i => sel.includes(i)).length;
    // the Imaging heading's All / None (made for the brain MRI panels) also show / hide the PET panels
    S0.querySelectorAll(':scope>summary button.mini').forEach(b => { const t = b.textContent; if ((t === 'All' || t === 'None') && !b._pet) { const f = b.onclick; b._pet = true;
      b.onclick = e => { f(e); setLabSel(ids, t === 'All'); }; } });
    const G = section(S0, 'img:pet', 'PET', k ? k + '/' + ids.length : S.length + ' scans', true, 'grp', q);
    const s = G.firstChild;
    s.insertBefore(miniBtn('All', 'Show every PET panel', () => setLabSel(ids, true)), s.lastChild);
    s.insertBefore(miniBtn('None', 'Hide every PET panel', () => setLabSel(ids, false)), s.lastChild);
    s.insertBefore(groupOnlyBtn('PET panel', 'grp:pet', ids, soloLab && soloLab.key === 'grp:pet', !!(soloLab && soloLab.key.startsWith('id:pet:')), () => onlyLab('grp:pet', ids, 'PET')), s.lastChild);
    const row = (id, label, count, tip) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(id); cb.setAttribute('aria-label', 'Compare ' + PANELS[id].title);
      cb.onclick = e => { e.stopPropagation(); setLabSel([id], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      const only = onlyBtn('Show only ' + PANELS[id].title + ' (deselect the others)', () => onlyLab('id:' + id, [id], PANELS[id].title), soloLab && soloLab.key === 'id:' + id);
      d.append(cb, nm, only, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([id], cb.checked); };
      G.appendChild(d);
    };
    row(ID, 'Scan dates', S.length + ' · ' + MODELS.length + ' scanners', 'Every FDG PET/CT as a point on the timeline, one row per scanner model; the report\'s summary on hover');
    row(IDM, 'Whole-body pictures', S.filter(s => s.mip).length + ' scans', 'Turning whole-body pictures of every scan side by side, on one SUV scale or scaled by each scan\'s liver; drag to turn');
    row(IDR, 'Reference organs', 'liver · brain', 'Liver and each half of the brain on every scan (our measurements), SUV or SUL; the report\'s liver number where it gives one');
  };

  const saved = store.get('selected', []);
  if (saved.some(mine)) { sel = saved.filter(id => BYID[id] || MRD.isId(id)); }
  updateBar(); list(); render();
})();
