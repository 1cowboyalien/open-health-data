/* MRI (test) section in the Library of the lab viewer (labs.html): a place to try new brain MRI views before they
   join the Imaging section. Used by make_lab_view.py when local/imaging/imaging.json exists (after imaging_view.js).
   Everything about the patient comes from IMG_DATA.lesion_series, never from this code.
   Panel mrit:vol = tumor volume trend lines on the shared time axis:
     one line per lesion through our own measured enhancing volumes (mm³), and/or the total of the lesions shown;
     linear or log scale; optional fitted trend (straight line on the log scale = steady % growth or shrinkage)
     over the points inside the time window, with its doubling or halving time; treatments as bands.
   Data used: lesion_series.lesions [{id,name,rgb}], measured [{lesion,date,enh_mm3,axial_mm,field,none?,note?}],
              treatments [{start,end,treatment,lesions,confidence}]; brain_mri [{date,partial}] for partial scans. */
(() => {
  const LS = IMG_DATA.lesion_series, ID = 'mrit:vol';
  if (!LS || !LS.measured || !LS.measured.length) return;
  const PANEL = {title: 'MRI test · Tumor volume trends', unit: 'mm³, our measurements', h0: 380};
  const V0 = {total: true, scale: 'log', fit: 'window', hidden: [], tx: true, view: 'chart'};   // opens with the total and the fitted trends (doubling times) showing
  const V = Object.assign({}, V0, store.get('mrit.view', {}));
  if (V.show) { V.total = V.show !== 'each'; if (V.show === 'total') V.hidden = LS.lesions.map(l => l.id); delete V.show; }   // older saved setting
  const save = () => store.set('mrit.view', V);
  const LCOL = Object.fromEntries(LS.lesions.map(l => [l.id, 'rgb(' + l.rgb + ')']));
  const LNAME = Object.fromEntries(LS.lesions.map(l => [l.id, l.name]));
  const PARTIAL = new Set((IMG_DATA.brain_mri || []).filter(r => r.partial).map(r => r.date));
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const fv = v => v >= 1000 ? (v / 1000).toFixed(2) + ' cm³' : Math.round(v) + ' mm³';
  const fdays = d => Math.abs(d) >= 365 ? (Math.abs(d) / 365.25).toFixed(1) + ' yr' : Math.abs(d) >= 60 ? (Math.abs(d) / 30.44).toFixed(1) + ' mo' : Math.round(Math.abs(d)) + ' d';
  const shape = f => f === '3T' ? 'triangle' : 'circle';
  const shown = () => LS.lesions.filter(l => !V.hidden.includes(l.id) && LS.measured.some(m => m.lesion === l.id && !m.none));
  let BODY = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(ID, BODY); };

  if (!document.getElementById('mritCss')) { const st = document.createElement('style'); st.id = 'mritCss';
    st.textContent = '.mrit-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}' +
      '.mrit-bar .lab{color:var(--muted);font-size:11px;margin-left:6px}' +
      '.mrit-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.mrit-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.mrit-chip{font-size:11px;padding:0 7px;border-radius:9px;border:2px solid;background:transparent;cursor:pointer;font-weight:600}.mrit-chip.off{opacity:.35;border-style:dashed}' +
      '.mrit-tbl{border-collapse:collapse;font-size:11.5px;margin-top:6px}.mrit-tbl td,.mrit-tbl th{padding:2px 8px;border-bottom:1px solid var(--line);text-align:right}.mrit-tbl th{color:var(--ink2);font-weight:600}.mrit-tbl td:first-child,.mrit-tbl th:first-child{text-align:left}' +
      '.mrit-up{color:#e34948}.mrit-dn{color:#1baf7a}.mrit-chip small{font-weight:500;margin-left:4px;font-size:10px}' +
      '.mrit-per td{vertical-align:top}.mrit-per td small{display:block;color:var(--muted);font-size:10px}.mrit-per .tg{color:#6250d6;font-weight:700}.mrit-per td.na{color:var(--muted)}';
    document.head.append(st); }

  /* points per lesion, sorted by date; "none" = our check found nothing there (0) */
  const ptsOf = id => LS.measured.filter(m => m.lesion === id).map(m => ({t: ms(m.date), date: m.date, v: m.none ? 0 : m.enh_mm3, m}))
    .sort((a, b) => a.t - b.t);
  /* total per scan date over the lesions shown (a scan that measured fewer lesions than usual is marked partial) */
  function totals(S) {
    const by = new Map();
    LS.measured.filter(m => !m.none && S.some(l => l.id === m.lesion)).forEach(m => {
      const e = by.get(m.date) || {date: m.date, t: ms(m.date), v: 0, n: 0, field: m.field}; e.v += m.enh_mm3; e.n++; by.set(m.date, e); });
    return [...by.values()].sort((a, b) => a.t - b.t).map(e => Object.assign(e, {partial: PARTIAL.has(e.date)}));
  }
  /* least-squares line through log(volume) vs time for the points inside the window: rate per day, doubling/halving time */
  function fitLog(pts, a = W.a, b = W.b) {
    const p = pts.filter(q => q.v > 0 && q.t >= a && q.t <= b); if (p.length < 2) return null;
    const n = p.length, mx = p.reduce((s, q) => s + q.t, 0) / n, my = p.reduce((s, q) => s + Math.log(q.v), 0) / n;
    let sxx = 0, sxy = 0; p.forEach(q => { sxx += (q.t - mx) ** 2; sxy += (q.t - mx) * (Math.log(q.v) - my); });
    if (!sxx) return null; const k = sxy / sxx * DAY;   // per day
    const f = t => Math.exp(my + sxy / sxx * (t - mx));
    return {k, n, t0: p[0].t, t1: p[n - 1].t, f, dbl: k ? Math.LN2 / k : Infinity, last: p[n - 1], mixed: new Set(p.map(q => q.field || (q.m && q.m.field))).size > 1};
  }
  /* rate wording: k = growth per day on the log scale */
  const MINGAP = 14;   // days: two scans closer than this give no step rate (scanner and outline noise outweigh real change)
  const rateTxt = (k, short) => !k || !isFinite(k) || Math.abs(Math.LN2 / k) > 3650 ? 'flat' : (k > 0 ? (short ? '↑' : '×2 in ') : (short ? '↓' : '½ in ')) + fdays(Math.LN2 / k).replace(' ', short ? '' : ' ');
  const perMonth = k => { const pm = (Math.exp(k * 30.44) - 1) * 100; return (pm > 0 ? '+' : '') + (Math.abs(pm) >= 100 ? pm.toFixed(0) : pm.toFixed(1)) + '%/mo'; };
  const upCls = k => k > 0 ? 'mrit-up' : 'mrit-dn';
  /* treatment periods: each starts at the last scan before the treatment (the baseline it is judged against) and runs
     until the next treatment starts; a scan just before a treatment therefore ends one period and starts the next */
  const TX = (LS.treatments || []).slice().sort((a, b) => a.start < b.start ? -1 : 1);
  const SCANT = [...new Set(LS.measured.map(m => m.date))].sort().map(ms);
  const PERIODS = TX.map((t, i) => { const s = ms(t.start), before = SCANT.filter(x => x < s).pop();
    return {t, a: before == null ? s : before, b: i + 1 < TX.length ? ms(TX[i + 1].start) - 1 : Infinity,
      label: 'After ' + (/whole-brain/i.test(t.treatment) ? 'WBRT' : 'SRS') + ' ' + t.start.slice(0, 4), wb: /whole-brain/i.test(t.treatment)}; });
  const periodFit = (pts, P) => fitLog(pts, P.a, P.b);
  /* latest rate of a lesion: fit over the last treatment period that has 2+ points (else null) */
  const latest = id => { const pts = ptsOf(id).map(p => Object.assign({field: p.m.field}, p)); for (let i = PERIODS.length - 1; i >= 0; i--) { const f = periodFit(pts, PERIODS[i]); if (f) return Object.assign(f, {P: PERIODS[i]}); } return null; };

  const txPlugin = {id: 'mritTx', beforeDatasetsDraw(c) { if (!V.tx) return; const {ctx, chartArea: a, scales: {x}} = c;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    (LS.treatments || []).forEach(t => { let x0 = x.getPixelForValue(pos(ms(t.start))), x1 = x.getPixelForValue(pos(ms(t.end)));
      if (x1 - x0 < 6) { const m = (x0 + x1) / 2; x0 = m - 3; x1 = m + 3; }
      const wb = /whole-brain/i.test(t.treatment);
      ctx.fillStyle = wb ? 'rgba(237,161,0,0.22)' : 'rgba(98,80,214,0.16)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.fillStyle = wb ? '#c98a00' : '#6250d6'; ctx.font = 'bold 10px system-ui'; ctx.fillText(wb ? 'WBRT' : 'SRS', x0 + 2, a.top + 10); });
    ctx.restore(); }};
  const guide = {id: 'mritGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  function xAxis() { const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}}; }

  function toolbar(body) {
    const bar = document.createElement('div'); bar.className = 'mrit-bar';
    const grp = (label, key, opts) => { const s = document.createElement('span'); s.className = 'lab'; s.textContent = label; bar.append(s);
      opts.forEach(([val, txt, tip]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mrit-b' + (V[key] === val ? ' on' : ''); b.textContent = txt; b.title = tip;
        b.onclick = () => { V[key] = val; save(); redraw(); }; bar.append(b); }); };
    grp('View', 'view', [['chart', 'Chart', 'Volume lines over time'], ['periods', 'Doubling times', 'Doubling or halving time of each lesion in each treatment period']]);
    grp('Scale', 'scale', [['log', 'Log', 'Log scale: equal steps = equal % change; small lesions stay readable'], ['linear', 'Linear', 'Plain mm³']]);
    grp('Trend', 'fit', [['off', 'Off', 'No fitted trend'], ['window', 'Fit in window', 'Fit a steady-% trend (straight on the log scale) to the points inside the time window; zoom or move the window to fit a stretch, e.g. after the last treatment']]);
    const tot = document.createElement('button'); tot.type = 'button'; tot.className = 'mrit-b' + (V.total ? ' on' : ''); tot.textContent = 'Total: ' + (V.total ? 'on' : 'off');
    tot.title = 'Show or hide the total line: the lesions ticked below, added up per scan (with every lesion hidden, it adds up all of them)';
    tot.onclick = () => { V.total = !V.total; save(); redraw(); }; bar.prepend(tot);
    const tx = document.createElement('button'); tx.type = 'button'; tx.className = 'mrit-b' + (V.tx ? ' on' : ''); tx.textContent = 'Treatments'; tx.title = 'Show radiation courses as bands';
    tx.onclick = () => { V.tx = !V.tx; save(); redraw(); }; bar.append(tx);
    body.append(bar);
    const chips = document.createElement('div'); chips.className = 'mrit-bar';
    LS.lesions.filter(l => LS.measured.some(m => m.lesion === l.id && !m.none)).forEach(l => { const b = document.createElement('button'); b.type = 'button';
      const off = V.hidden.includes(l.id); b.className = 'mrit-chip' + (off ? ' off' : ''); b.style.borderColor = LCOL[l.id]; b.style.color = LCOL[l.id]; b.textContent = l.id; const lf = latest(l.id);
      if (lf) { const sm = document.createElement('small'); sm.className = upCls(lf.k); sm.textContent = rateTxt(lf.k, true); b.append(sm); }
      b.title = l.name + (lf ? '\nLatest: ' + rateTxt(lf.k) + ' (' + perMonth(lf.k) + ') ' + lf.P.label.toLowerCase() + ', ' + lf.n + ' scans' + (lf.mixed ? ', 1.5T and 3T mixed' : '') : '') + (off ? '\n(hidden: click to show)' : '\n(click to hide; double-click: show only this one)');
      b.onclick = () => { V.hidden = off ? V.hidden.filter(x => x !== l.id) : V.hidden.concat(l.id); save(); redraw(); };
      b.ondblclick = () => { V.hidden = LS.lesions.map(x => x.id).filter(x => x !== l.id); save(); redraw(); };
      chips.append(b); });
    const all = document.createElement('button'); all.type = 'button'; all.className = 'mrit-b'; all.textContent = 'All'; all.onclick = () => { V.hidden = []; save(); redraw(); };
    const none = document.createElement('button'); none.type = 'button'; none.className = 'mrit-b'; none.textContent = 'None'; none.title = 'Hide every lesion line (with Total on, only the total is left)';
    none.onclick = () => { V.hidden = LS.lesions.map(x => x.id); save(); redraw(); };
    chips.append(all, none); body.append(chips);
  }

  /* tooltip lines: change since the previous scan, as a rate */
  function step(r) {
    const q = r.prev; if (!q || !(r.v > 0)) return [];
    const d = (r.t - q.t) / DAY, short = new Date(q.t).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
    if (d < MINGAP) return ['Since ' + short + ': only ' + Math.round(d) + ' days apart, too close to read a rate' + (q.field !== r.field ? ' (and a different scanner)' : '')];
    const k = Math.log(r.v / q.v) / d, pct = (r.v / q.v - 1) * 100;
    return ['Since ' + short + ' (' + fdays(d) + '): ' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '% · ' + rateTxt(k) + ' (' + perMonth(k) + ')'].concat(
      q.field !== r.field ? ['⚠ ' + q.field + ' → ' + r.field + ': part of this change may be the scanner'] : []);
  }

  /* Doubling times view: one row per lesion, one column per treatment period */
  function drawPeriods(body, S) {
    const L = S.length ? S : LS.lesions.filter(l => LS.measured.some(m => m.lesion === l.id && !m.none));
    const dt = t => new Date(t).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
    const cell = (f, targeted) => {
      if (!f) return `<td class="na">${targeted ? '<span class="tg" title="Treated in this course">◎</span> ' : ''}—</td>`;
      const span = (f.t1 - f.t0) / DAY;
      return `<td class="${upCls(f.k)}" title="${f.n} scans, ${dt(f.t0)} – ${dt(f.t1)}${f.mixed ? '; 1.5T and 3T mixed: part may be the scanner' : ''}">` +
        `${targeted ? '<span class="tg" title="Treated in this course">◎</span> ' : ''}<b>${rateTxt(f.k)}</b>${f.mixed ? ' *' : ''}<small>${perMonth(f.k)} · ${f.n} scans${span < 30 ? ' · short span' : ''}</small></td>`; };
    let h = '<div style="overflow:auto"><table class="mrit-tbl mrit-per"><tr><th>Lesion</th>' +
      PERIODS.map(P => `<th title="${P.t.treatment}, ${P.t.start}; from the last scan before it until the next treatment">${P.label}<small style="display:block;font-weight:400;color:var(--muted)">${P.t.start}</small></th>`).join('') + '<th>Latest</th></tr>';
    L.forEach(l => { const pts = ptsOf(l.id).map(p => Object.assign({field: p.m.field}, p)), lf = latest(l.id);
      h += `<tr><td><b style="color:${LCOL[l.id]}" title="${LNAME[l.id]}">${l.id}</b></td>` + PERIODS.map(P => cell(periodFit(pts, P), P.t.lesions.includes(l.id) && !P.wb)).join('') +
        (lf ? `<td class="${upCls(lf.k)}"><b>${rateTxt(lf.k)}</b></td>` : '<td class="na">—</td>') + '</tr>'; });
    if (V.total) { const T = totals(L).filter(e => !e.partial);
      h += '<tr><td><b>Total</b></td>' + PERIODS.map(P => cell(fitLog(T, P.a, P.b), false)).join('') + '<td></td></tr>'; }
    body.insertAdjacentHTML('beforeend', h + '</table></div>');
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '6px';
    note.innerHTML = 'Each cell: a steady-% trend fitted to that lesion\'s scans from the last scan before the treatment until the next treatment starts (so it includes the response to that treatment). ' +
      '<span class="mrit-up">×2 in … = doubling time</span> (growing), <span class="mrit-dn">½ in … = halving time</span> (shrinking). ◎ = SRS aimed at this lesion in that course (whole-brain radiation covers all). ' +
      '* = the scans mix 1.5T and 3T, so part of the change may be the scanner. "short span" = under a month between first and last scan: read loosely. Fits need 2+ scans with the lesion seen.';
    body.append(note);
  }

  function draw(id, body) {
    BODY = body; const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = ''; toolbar(body);
    const S = shown(), log = V.scale === 'log';
    if (V.view === 'periods') return drawPeriods(body, S);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANEL.h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Tumor volume over time, one line per brain lesion');
    box.append(cv); body.append(box); box.onmouseleave = () => setHover(null);
    const ds = [], fits = [];
    const lineDs = (label, col, pts, extra) => Object.assign({label, data: pts, parsing: true, borderColor: col, backgroundColor: col, borderWidth: 2, tension: 0, showLine: true, spanGaps: true,
      pointStyle: p => p.raw ? shape(p.raw.field) : 'circle', pointRadius: p => p.raw && p.raw.v === 0 ? 3 : 4.5, pointHoverRadius: 7,
      pointBackgroundColor: p => p.raw && (p.raw.v === 0 || p.raw.partial) ? 'rgba(0,0,0,0)' : col, pointBorderColor: p => p.raw && (p.raw.v === 0 || p.raw.partial) ? col : '#fff', pointBorderWidth: 1.4,
      segment: {borderDash: s => s.p0.raw && s.p1.raw && s.p0.raw.field !== s.p1.raw.field ? [2, 3] : undefined}}, extra);
    S.forEach(l => {
      const P = ptsOf(l.id).filter(p => !log || p.v > 0).map(p => ({x: pos(p.t), y: p.v, v: p.v, t: p.t, date: p.date, field: p.m.field, lesion: l.id, m: p.m}));
      P.forEach((p, i) => { p.prev = P.slice(0, i).reverse().find(q => q.v > 0); });
      ds.push(lineDs(l.id, LCOL[l.id], P));
      if (V.fit === 'window') { const f = fitLog(ptsOf(l.id).map(p => Object.assign({}, p))); if (f) fits.push(Object.assign(f, {label: l.id, col: LCOL[l.id]})); }
    });
    if (V.total) {
      const T = totals(S.length ? S : LS.lesions), col = css('--ink');
      const TP = T.map(e => ({x: pos(e.t), y: e.v, v: e.v, t: e.t, date: e.date, field: e.field, n: e.n, partial: e.partial, total: true}));
      TP.forEach((p, i) => { p.prev = p.partial ? null : TP.slice(0, i).reverse().find(q => !q.partial); });
      ds.push(lineDs('Total', col, TP, {borderWidth: 3}));
      if (V.fit === 'window') { const f = fitLog(T.filter(e => !e.partial)); if (f) fits.push(Object.assign(f, {label: 'Total', col})); }
    }
    fits.forEach(f => { const N = 24, pts = []; for (let i = 0; i <= N; i++) { const t = f.t0 + (f.t1 - f.t0) * i / N; pts.push({x: pos(t), y: f.f(t), fit: f}); }
      ds.push({label: f.label + ' trend', data: pts, parsing: true, borderColor: f.col, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, showLine: true, fill: false}); });
    /* trend labels in a column right of the chart, each joined to its line's end by a thin leader */
    const endLab = {id: 'mritEnd', afterDatasetsDraw(c) { if (!fits.length) return; const {ctx, chartArea: a, scales: {x, y}} = c, H = c.height;
      ctx.save(); ctx.font = 'bold 10.5px system-ui'; ctx.textBaseline = 'middle';
      const L = fits.map(f => ({f, px: Math.min(a.right, x.getPixelForValue(pos(f.t1))), ey: y.getPixelForValue(f.f(f.t1)), txt: f.label + ' ' + rateTxt(f.k)}))
        .filter(o => o.px >= a.left).map(o => Object.assign(o, {py: Math.max(a.top, Math.min(a.bottom, o.ey))})).sort((p, q) => p.py - q.py);
      const G = 13; for (let i = 1; i < L.length; i++) L[i].py = Math.max(L[i].py, L[i - 1].py + G);
      const over = L.length ? L[L.length - 1].py - (H - 8) : 0; if (over > 0) L.forEach(o => { o.py -= over; });   // push the stack up if it runs off the bottom
      for (let i = L.length - 2; i >= 0; i--) L[i].py = Math.min(L[i].py, L[i + 1].py - G);
      const lx = a.right + 14;
      L.forEach(o => { ctx.strokeStyle = o.f.col; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.px, Math.max(a.top, Math.min(a.bottom, o.ey))); ctx.lineTo(lx - 3, o.py); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = o.f.col; ctx.fillText(o.txt, lx, o.py); });
      ctx.restore(); }};
    const cfg = {type: 'line', plugins: [txPlugin, guide, endLab].concat(typeof momentPlugin === 'object' ? [momentPlugin] : []), data: {datasets: ds},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: {padding: {right: fits.length ? 118 : 0}},
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, filter: it => !it.raw.fit, callbacks: {
          title: it => it[0] ? fd(it[0].raw.date) : '',
          label: it => { const r = it.raw; const st = step(r);
            if (r.total) return ['Total ' + fv(r.v) + ' · ' + r.n + ' lesion' + (r.n > 1 ? 's' : '') + (r.partial ? ' · partial scan' : '') + ' · ' + r.field].concat(st);
            return [r.lesion + ' ' + (r.v === 0 ? 'nothing found' : fv(r.v)) + ' · ' + r.field + (r.m.axial_mm ? ' · ' + r.m.axial_mm + ' mm wide' : ''), LNAME[r.lesion]].concat(r.m.note ? [r.m.note] : [], st); }}}},
        scales: {x: xAxis(), y: {type: log ? 'logarithmic' : 'linear', min: log ? 5 : 0, afterFit: s => { s.width = typeof YW === 'number' ? YW : s.width; },
          title: {display: true, text: 'mm³ (enhancing)', color: css('--muted')},
          ticks: {color: css('--muted'), callback: v => log ? ([5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].includes(v) ? (v >= 1000 ? v / 1000 + 'k' : v) : '') : v},
          grid: {color: css('--line')}}}}};
    charts.set(id, new Chart(cv, cfg));
    if (fits.length) {
      let h = '<table class="mrit-tbl"><tr><th>Trend in window</th><th>points</th><th>from</th><th>to</th><th>change / month</th><th>doubling or halving time</th></tr>';
      fits.forEach(f => { const pm = (Math.exp(f.k * 30.44) - 1) * 100, up = f.k > 0;
        h += `<tr><td><b style="color:${f.col}">${f.label}</b></td><td>${f.n}</td><td>${fd(new Date(f.t0).toISOString().slice(0, 10))}</td><td>${fd(new Date(f.t1).toISOString().slice(0, 10))}</td>` +
             `<td class="${up ? 'mrit-up' : 'mrit-dn'}">${up ? '+' : ''}${pm.toFixed(0)}%</td><td class="${up ? 'mrit-up' : 'mrit-dn'}">${isFinite(f.dbl) ? (up ? 'doubles every ' : 'halves every ') + fdays(f.dbl) : 'flat'}</td></tr>`; });
      body.insertAdjacentHTML('beforeend', h + '</table>');
    }
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.innerHTML = 'Our own measured enhancing volume per lesion (not the reports\' sizes). ● = 1.5T scanner, ▲ = 3T; ' +
      '<b>a dotted stretch joins a 1.5T and a 3T scan, so part of that change may be the scanner</b> (small lesions can differ up to ~2× between scanners). ' +
      'Hollow = nothing found (0, linear scale only) or a partial scan. Total = sum of the lesions shown on each scan. ' +
      (V.fit === 'window' ? 'Dashed = fitted steady-% trend through the points inside the time window (needs 2+ points); move or zoom the window to fit a different stretch. ' : '') +
      'Hover a point for the rate since the previous scan (none for scans under ' + MINGAP + ' days apart). Arrows on the chips = latest rate (last treatment period with 2+ scans). Bands: orange = whole-brain radiation, purple = SRS. Test section: views here may change.';
    body.append(note);
  }

  /* ================= plug into the viewer's hooks ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => id === ID;
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANEL.title : o.title(id);
  MRD.unit = id => mine(id) ? PANEL.unit : o.unit(id);
  MRD.h0 = id => mine(id) ? PANEL.h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); draw(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); redraw(); };
  MRD.section = (el, q) => {
    o.section(el, q);
    if (q && !'mri test tumor volume trend lines brain lesions growth doubling'.includes(q)) return;
    const S = section(el, 'mrit', 'MRI (test)', 'try-outs', false, 'sec', q);
    const d = document.createElement('div'); d.className = 't';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(ID); cb.setAttribute('aria-label', 'Show ' + PANEL.title);
    cb.onclick = e => { e.stopPropagation(); setLabSel([ID], cb.checked); };
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = 'Tumor volume trends'; nm.title = 'Measured volume of each brain lesion over time, with optional fitted trend lines';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = LS.measured.filter(m => !m.none).length + ' points';
    d.append(cb, nm, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([ID], cb.checked); };
    S.append(d);
  };

  const saved = store.get('selected', []);
  if (saved.includes(ID) && !sel.includes(ID)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
