/* MRD tests (Signatera ctDNA): the Library section, the full Signatera page and two panels that can be
   ticked into Compare like lab charts, inlined by make_lab_view.py.
   Data: D.mrd = {rows, alleles, vars} from local/mrd_tests.tsv, mrd_alleles.tsv, mrd_variants.tsv (flatten_mrd.py,
   liftover_mrd.py). Uses the viewer's time window (W, pos, ticks), hover line (hoverX, setHover), moment lines
   (momentPlugin), chart registry (charts), heights (hOf/setH) and selection (sel, setLabSel), so MRD panels move,
   line up and behave like the rest of the Stage. Everything is wrapped in one object so names don't clash.
   Panel ids (in sel, Compare): 'mrd:ot' = Over time, 'mrd:var' = Tumor variants tracked, 'mrd:ns' = Northstar Response
   (BillionToOne, D.mrd.other: a Tumor Methylation Score, its own scale, never drawn on the Signatera MTM/mL axis). */
const MRD = (() => {
  const M = D.mrd;
  const NONE = {has: false, isId: () => false, active: () => false, section() {}, render() {}, close() {}, panel() {}, refresh() {}, title: () => ''};
  if (!M || !M.rows || !M.rows.length) return NONE;

  /* ---------- styles (only these panels use them) ---------- */
  const st = document.createElement('style');
  st.textContent = `
:root{--nd:#9a9994;--amb:#c7871b}@media (prefers-color-scheme:dark){:root{--nd:#77766f}}
.mrdp .pos{color:var(--hi);font-weight:600}.mrdp .ndt{color:var(--ink2)}.mrdp td.num,.mrdp td.mono{font-variant-numeric:tabular-nums;white-space:nowrap}
.mrdp .stat b.pos{color:var(--hi)}
.mrdp .legend .dot{width:10px;height:10px;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:5px}
.mrdp .note{font-size:12.5px;color:var(--ink2);margin-top:10px}
.mrdh{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between}
.mrdp .bar button{font-size:12px;padding:2px 9px}
.hm{border-collapse:separate;border-spacing:3px;font-size:12px;width:auto}
.hm td,.hm th{border:0;padding:0;text-align:center}
.hm th{font-weight:500;color:var(--ink2);padding:0 2px 4px;white-space:nowrap;font-size:11.5px;line-height:1.3}
.hm th.call{font-size:10.5px;font-weight:600}
.hm td.lab{text-align:left;padding-right:10px;white-space:nowrap;color:var(--ink2);font-size:12px}
.hm td.lab b{color:var(--ink);font-weight:500}
.hm td.c{width:62px;height:24px;border-radius:4px;font-variant-numeric:tabular-nums;font-size:11px}
.hm td.z{background:var(--bg);color:var(--muted)}
.hm tr.cnt td{font-weight:600;font-size:12px;padding-top:4px}
.hm .hov{box-shadow:inset 0 0 0 2px var(--muted)}.hm th.hov{box-shadow:none;color:var(--ink);text-decoration:underline}
.hm [data-d]{cursor:crosshair}
.mscale{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2);margin-top:10px;flex-wrap:wrap}
.mscale i{display:inline-block;width:22px;height:12px;border-radius:3px}
.tt{display:inline-block;font-size:10px;font-weight:600;line-height:14px;padding:0 4px;border-radius:4px;border:1px solid var(--line);color:var(--ink2);margin-left:3px;vertical-align:1px}
.tt.ts{border-color:var(--ink2)}.tt.tv{border-style:dashed}
.bld{font-size:10px;font-weight:600;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-left:4px}
.vcard{border:1px solid var(--line);border-left:0;border-right:0;padding:6px 16px 2px;margin:0 -16px;margin-top:-1px}.vcard:first-child{margin-top:6px}
.vhead{display:flex;align-items:baseline;gap:8px;font-size:13px;flex-wrap:wrap}.vhead b{font-weight:600}.vhead .sub{font-size:12px}
.vhead .pk{margin-left:auto;font-size:12px;color:var(--ink2)}
.vbox{position:relative;height:96px}.vbox.last{height:118px}`;
  document.head.appendChild(st);

  /* ---------- data helpers ---------- */
  const NS = (M.other || []).filter(r => r.test === 'Northstar Response' && r.draw_date);
  const ROWS = M.rows, ALLELES = M.alleles || [], VARS = M.vars || {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const vnum = t => +t.split('_')[1];
  const V = t => VARS[t] || {};
  /* each tracked variant has its own colour (V1, V2 ... in a fixed order), the same in every view and in the minimized bar */
  const VPAL = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324', '#a9a9a9', '#c0392b', '#aaffc3'];
  const VC = t => VPAL[(vnum(t) - 1) % VPAL.length];
  window.SIG_VCOL = VC;
  const geneTxt = t => V(t).gene ? (V(t).near ? 'near ' : '') + V(t).gene : '';
  const geneHtml = t => V(t).gene ? (V(t).near ? '<span class="ndt">near</span> ' : '') + `<i>${esc(V(t).gene)}</i>` : '';
  const effTxt = t => (V(t).effect || '') + (V(t).prot ? ' ' + V(t).prot : '');
  const tsShort = t => V(t).change_type === 'Transition' ? 'Ts' : 'Tv';
  const tsTag = t => `<span class="tt ${tsShort(t).toLowerCase()}" title="${V(t).change_type || ''}">${tsShort(t)}</span>`;
  const nf = n => (+n).toLocaleString('en-US');
  const loc37 = t => `${V(t).chrom}:${nf(V(t).pos_grch37)}`, loc38 = t => V(t).pos_grch38 ? `${V(t).chrom_grch38}:${nf(V(t).pos_grch38)}` : '–';
  const locTxt = t => `GRCh37 ${loc37(t)} · GRCh38 ${loc38(t)}`;
  const locHtml = t => `<span class="bld">GRCh37</span> ${loc37(t)} <span class="bld">GRCh38</span> ${loc38(t)}`;
  const pctS = v => (v * 100).toFixed(v * 100 >= 0.1 ? 2 : 3) + '%';
  const ADATES = [...new Set(ALLELES.map(a => a.draw_date))].sort();
  const posCount = d => ALLELES.filter(a => a.draw_date === d && a.call === 'POSITIVE').length;
  const ALL_T = [...new Set(ALLELES.map(a => a.target_id))].sort((a, b) => vnum(a) - vnum(b));
  const NT = ALL_T.length;
  const NEVER = new Set(ALL_T.filter(t => !ALLELES.some(a => a.target_id === t && a.call === 'POSITIVE')));
  const done = ROWS.filter(r => r.result !== 'NOT PERFORMED');
  const det = done.filter(r => r.result === 'DETECTED');
  const LAST = ROWS[ROWS.length - 1];
  const inW = d => { const t = ms(d); return t >= W.a && t <= W.b; };
  const X = d => pos(ms(d));
  // Our allele-based score for a draw: mean allele ratio over all tracked variants (not found = 0), and how many were found.
  // Unlike Natera's call it needs no minimum number of variants: one variant found already counts as a signal.
  const SCORE = Object.fromEntries(ADATES.map(d => { const a = ALLELES.filter(x => x.draw_date === d);
    return [d, {mean: a.reduce((s, x) => s + +x.allele_ratio, 0) / a.length * 100, n: a.filter(x => +x.allele_ratio > 0).length, of: a.length}]; }));

  /* ---------- panels that can be ticked into Compare ---------- */
  const PANELS = {'mrd:ot': {title: 'Signatera · Over time', unit: 'MTM/mL or allele score'}};
  if (ADATES.length) PANELS['mrd:var'] = {title: 'Signatera · Tumor variants tracked', unit: NT + ' variants'};
  const SIG_IDS = Object.keys(PANELS);
  if (NS.length) PANELS['mrd:ns'] = {title: 'Northstar Response · Over time', unit: 'Tumor Methylation Score (log)'};
  const IDS = Object.keys(PANELS);

  /* ---------- settings (remembered in this browser; shared by the page and the Compare panels) ---------- */
  let on = store.get('mrd.on', false), view = store.get('mrd.view', 'grid'), measure = store.get('mrd.measure', 'allele');
  let logMode = store.get('mrd.log', false), hideNever = store.get('mrd.hideNever', false), sameY = false, orderMost = false, hoverT = null;
  /* Over time starts in Allele-based each time it is turned on (ticked in the Library or the full page opened);
     switching to Natera MTM/mL holds while it stays on. Presets keep their own saved choice. */
  let otOn = sel.includes('mrd:ot');
  function startAllele() { if (ADATES.length) { measure = 'allele'; store.set('mrd.measure', measure); } }
  const shownT = () => ALL_T.filter(t => !(hideNever && NEVER.has(t)));
  const rowOf = t => shownT().indexOf(t) + 1;
  const active = () => on && mode === 'single';

  /* ---------- shared chart pieces: the viewer's x axis (0-100 via pos, compressed early years), hover line, moments ---------- */
  function xAxis(show = true) {
    const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {display: show, color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }, drawTicks: show}};
  }
  const guide = {id: 'mrdGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  const hov = (e, els, c) => { const xv = c.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); };
  const yw = w => ({afterFit: s => { s.width = w; }});
  const plugins = (...more) => [guide, momentPlugin, ...more];
  function keep(key, canvas, cfg) { const c = new Chart(canvas, cfg); charts.set(key, c); canvas.parentElement.onmouseleave = () => setHover(null); return c; }
  function drop(prefix) { [...charts.keys()].filter(k => k.startsWith(prefix)).forEach(k => { charts.get(k).destroy(); charts.delete(k); }); }
  const R = (box, r) => box.querySelector(`[data-r="${r}"]`);
  const btn = (label, title, fn, isOn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title || label; if (isOn) b.className = 'on'; b.onclick = fn; return b; };

  /* ---------- Over time: Natera MTM/mL, or our allele-based score ---------- */
  const LEG = {
    natera: `<span><span class="dot" style="background:var(--hi)"></span>Detected</span><span><span class="dot" style="border:2px solid var(--nd);width:9px;height:9px"></span>Not detected (0.00)</span><span>✕ Test not performed</span><span><span class="dot" style="border:2px solid var(--accent);width:12px;height:12px"></span>Also in a hospital record</span><span>━ between two found values · ┅ next to a negative or unknown draw</span>`,
    allele: `<span><span class="dot" style="background:var(--hi)"></span>2 or more variants found (Natera would call positive)</span><span><span class="dot" style="background:var(--amb)"></span>1 variant found (Natera calls negative)</span><span><span class="dot" style="border:2px solid var(--nd);width:9px;height:9px"></span>none found</span><span><span class="dot" style="background:var(--nd);width:6px;height:6px;opacity:.6"></span>no allele file (unknown)</span><span>✕ Test not performed</span><span>━ between two found values · ┅ next to a negative or unknown draw</span>`};
  const NOTE = {
    natera: 'MTM/mL = mean tumor molecules per mL of plasma. Natera states a limit of detection of 0.3 MTM/mL (95% analytical sensitivity); results below it are still reported as detected when at least two tumor variants are found. Natera\'s history lists only the number for each draw, so "Detected" here means a value above 0.',
    allele: `Allele-based score (ours, not Natera's): the mean allele ratio across all ${NT} tracked variants, in %, with variants not found counted as 0. It counts a single variant as a signal, where Natera needs at least two. A single variant can also be sequencing noise, which is why Natera requires two, so the amber points are worth watching rather than proof of disease. Natera's MTM/mL also folds in plasma volume and cfDNA amount, which the allele files don't include, so the two numbers are on different scales. Only the ${ADATES.length} draws with allele files can be scored.`};
  /* builds the controls once, then draw() redraws the chart (window moves, setting changes) */
  function overTime(box, key, opt) {
    box.classList.add('mrdp');
    box.innerHTML = `<div class="mrdh">${opt.title ? '<b>Over time</b>' : '<span></span>'}<div class="bar" data-r="ctl"></div></div><div class="legend" data-r="leg"></div>
      <div style="position:relative;height:${hOf(key, opt.h)}px;margin-top:6px"><canvas role="img" aria-label="Signatera results over time"></canvas></div>
      ${opt.note ? '<div class="note" data-r="note"></div>' : ''}`;
    const ctl = R(box, 'ctl'), cv = box.querySelector('canvas');
    const redrawAll = () => refreshAll();
    function controls() {
      ctl.innerHTML = '<span class="sub">Measure</span>';
      ctl.append(btn('Natera MTM/mL', 'Natera\'s own number and call', () => { measure = 'natera'; store.set('mrd.measure', measure); redrawAll(); }, measure === 'natera'));
      if (ADATES.length) ctl.append(btn('Allele-based', 'Our score from the allele files', () => { measure = 'allele'; store.set('mrd.measure', measure); redrawAll(); }, measure === 'allele'));
      const s = document.createElement('span'); s.className = 'sub'; s.style.marginLeft = '8px'; s.textContent = 'Scale'; ctl.append(s);
      ctl.append(btn('Linear', '', () => { logMode = false; store.set('mrd.log', false); redrawAll(); }, !logMode), btn('Log, found only', '', () => { logMode = true; store.set('mrd.log', true); redrawAll(); }, logMode));
      if (opt.height) ctl.append(btn('−', 'Shorter', () => { setH(key, hOf(key, opt.h) - 40); window.render(); }), btn('+', 'Taller', () => { setH(key, hOf(key, opt.h) + 40); window.render(); }));
    }
    function draw() {
      drop(key + '#');
      if (measure === 'allele' && !ADATES.length) measure = 'natera';
      controls();
      R(box, 'leg').innerHTML = LEG[measure]; if (opt.note) R(box, 'note').textContent = NOTE[measure];
      const hi = css('--hi'), amb = css('--amb'), nd = css('--nd'), ac = css('--accent'), grid = css('--line'), ink = css('--ink2');
      const lineStyle = isPos => ({borderColor: ink, borderWidth: 2, pointRadius: 0, tension: 0, order: 3, spanGaps: false,
        segment: {borderDash: c => (isPos(c.p0.raw) && isPos(c.p1.raw)) ? undefined : [2, 4], borderColor: c => (isPos(c.p0.raw) && isPos(c.p1.raw)) ? ink : ink + '99'}});
      let ds, yAx, tip;
      if (measure === 'natera') {
        const pts = r => ({x: X(r.draw_date), y: r.result === 'NOT PERFORMED' ? 0 : +r.value, r});
        const shown = logMode ? det : ROWS;
        ds = [
          {type: 'line', data: done.map(pts).map(p => logMode && p.r.result !== 'DETECTED' ? {...p, y: null} : p), ...lineStyle(p => p.r.result === 'DETECTED')},
          {data: shown.filter(r => r.result === 'DETECTED').map(pts), pointBackgroundColor: hi, pointBorderColor: hi, pointRadius: 5, order: 1},
          {data: shown.filter(r => r.result === 'NOT DETECTED').map(pts), pointBackgroundColor: 'transparent', pointBorderColor: nd, pointBorderWidth: 2, pointRadius: 4, order: 1},
          {data: shown.filter(r => r.result === 'NOT PERFORMED').map(pts), pointStyle: 'crossRot', pointBorderColor: nd, pointBorderWidth: 2, pointRadius: 6, order: 1},
          {data: shown.filter(r => r.also_in).map(pts), pointBackgroundColor: 'transparent', pointBorderColor: ac, pointBorderWidth: 2, pointRadius: 8, pointHoverRadius: 8, order: 2}];
        yAx = logMode ? {...yw(YW), type: 'logarithmic', min: 0.01, max: 1.5, grid: {color: grid}, ticks: {color: css('--muted'), callback: v => [0.01, 0.03, 0.1, 0.3, 1].includes(+v.toPrecision(1)) ? v : ''}}
                      : {...yw(YW), min: 0, suggestedMax: 1, grid: {color: grid}, ticks: {color: css('--muted'), maxTicksLimit: opt.compact ? 4 : 8}};
        tip = c => { const r = c.raw.r; return `${fd(r.draw_date)}: ` + (r.result === 'NOT PERFORMED' ? 'test not performed' : `${r.value} MTM/mL` + (r.result === 'DETECTED' ? ' (detected)' : ' (not detected)')); };
      } else {
        const P = ROWS.map(r => { const s = SCORE[r.draw_date], k = r.result === 'NOT PERFORMED' ? 'np' : !s ? 'u' : s.n >= 2 ? 'm' : s.n === 1 ? 's' : 'z';
          return {x: X(r.draw_date), y: s ? s.mean : 0, r, s, k}; });
        const pick = (...ks) => P.filter(p => ks.includes(p.k) && (!logMode || p.y > 0));
        ds = [
          {type: 'line', data: P.filter(p => p.k !== 'np').map(p => logMode && !(p.y > 0) ? {x: p.x, y: null, r: p.r, k: p.k} : p), ...lineStyle(p => p.y > 0)},
          {data: pick('m'), pointBackgroundColor: hi, pointBorderColor: hi, pointRadius: 5, order: 1},
          {data: pick('s'), pointBackgroundColor: amb, pointBorderColor: amb, pointRadius: 5, order: 1},
          {data: pick('z'), pointBackgroundColor: 'transparent', pointBorderColor: nd, pointBorderWidth: 2, pointRadius: 4, order: 1},
          {data: pick('u'), pointBackgroundColor: nd + '99', pointBorderColor: nd + '99', pointRadius: 2.5, order: 1},
          {data: pick('np'), pointStyle: 'crossRot', pointBorderColor: nd, pointBorderWidth: 2, pointRadius: 6, order: 1}];
        yAx = logMode ? {...yw(YW), type: 'logarithmic', min: 0.001, max: 0.2, grid: {color: grid}, afterBuildTicks: a => { a.ticks = [0.001, 0.003, 0.01, 0.03, 0.1].map(v => ({value: v})); }, ticks: {color: css('--muted'), callback: v => v + '%'}}
                      : {...yw(YW), min: 0, suggestedMax: 0.1, grid: {color: grid}, ticks: {color: css('--muted'), maxTicksLimit: opt.compact ? 4 : 8, callback: v => (+v).toFixed(3).replace(/0+$/, '') + '%'}};
        tip = c => { const p = c.raw, r = p.r, nat = r.result === 'NOT PERFORMED' ? 'test not performed' : `Natera ${r.value} MTM/mL, ${r.result === 'DETECTED' ? 'positive' : 'negative'}`;
          return p.s ? [`${fd(r.draw_date)}: mean allele ratio ${p.s.mean.toFixed(4)}%`, `${p.s.n} of ${p.s.of} variants found`, nat] : [`${fd(r.draw_date)}: no allele file`, nat]; };
      }
      keep(key + '#c', cv, {type: 'scatter', data: {datasets: ds}, plugins: plugins(),
        options: {maintainAspectRatio: false, animation: false, onHover: hov, layout: TLAY(),
          plugins: {legend: {display: false}, tooltip: {filter: i => i.datasetIndex > 0 && (measure === 'allele' || i.datasetIndex < 4), callbacks: {label: tip}}},
          scales: {x: xAxis(), y: yAx}}});
    }
    draw();
    draw.box = box;
    return draw;
  }

  /* ---------- Northstar Response (BillionToOne): Tumor Methylation Score over time, on its own log scale ----------
     A different test from Signatera (tumor-naive, methylation at >2000 places; reportable range >= 10, shaded), so it gets its
     own chart on the shared time axis and is never put on the MTM/mL axis. The lab's call for each draw is in the tooltip. */
  const NS_FLOOR = 10;
  const NS_NOTE = 'Northstar Response (BillionToOne) counts tumor DNA in the blood that carries a chemical tag (methylation) at more than 2,000 places often tagged in cancer. It does not use the tumor\'s own mutations (Signatera does), so a Tumor Methylation Score is not MTM/mL and the two numbers cannot be compared directly. The lab calls a change an increase or decrease only when it passes its statistical threshold. Scores under 10 (shaded) are below the reportable range. The lab says the test tracks change over time and is not meant for minimal residual disease detection.';
  function northstar(box, key, opt) {
    box.classList.add('mrdp');
    box.innerHTML = `<div class="mrdh">${opt.title ? '<b>Northstar Response</b> <span class="sub">BillionToOne · tumor-naive methylation · a different test and scale from Signatera</span>' : '<span></span>'}<div class="bar" data-r="ctl"></div></div>
      <div class="legend"><span><span class="dot" style="background:var(--amb);border-radius:2px;transform:rotate(45deg)"></span>Tumor Methylation Score (log scale)</span><span><span class="dot" style="background:var(--line);border-radius:2px"></span>Below the reportable range (&lt;${NS_FLOOR})</span></div>
      <div style="position:relative;height:${hOf(key, opt.h)}px;margin-top:6px"><canvas role="img" aria-label="Northstar Tumor Methylation Score over time"></canvas></div>
      ${opt.note ? `<div class="note">${NS_NOTE}</div>` : ''}`;
    const ctl = R(box, 'ctl'), cv = box.querySelector('canvas');
    if (opt.height) ctl.append(btn('−', 'Shorter', () => { setH(key, hOf(key, opt.h) - 40); window.render(); }), btn('+', 'Taller', () => { setH(key, hOf(key, opt.h) + 40); window.render(); }));
    function draw() {
      drop(key + '#');
      const amb = css('--amb'), grid = css('--line'), ink = css('--ink2'), card = css('--card');
      const pts = NS.map(r => ({x: X(r.draw_date), y: +r.value, r}));
      const top = Math.max(1000, ...pts.map(p => p.y * 3));
      const shade = {id: 'nsFloor', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {y}} = c, t = Math.max(a.top, y.getPixelForValue(NS_FLOOR));
        ctx.save(); ctx.fillStyle = grid; ctx.globalAlpha = .6; ctx.fillRect(a.left, t, a.right - a.left, a.bottom - t); ctx.restore(); }};
      const labels = {id: 'nsLbl', afterDatasetsDraw(c) { const {ctx, chartArea: a} = c, m = c.getDatasetMeta(1); ctx.save(); ctx.fillStyle = css('--ink'); ctx.font = '12px ' + getComputedStyle(document.body).fontFamily; ctx.textBaseline = 'middle';
        m.data.forEach((p, i) => { if (p.x < a.left || p.x > a.right) return; const last = i === m.data.length - 1;   // the newest label to the right, earlier ones to the left, so close draws don't overlap
          ctx.textAlign = last ? 'left' : 'right'; ctx.fillText(String(Math.round(pts[i].y)), p.x + (last ? 9 : -9), p.y); }); ctx.restore(); }};
      keep(key + '#c', cv, {type: 'scatter', plugins: plugins(shade, labels),
        data: {datasets: [
          {type: 'line', data: pts, borderColor: ink, borderWidth: 2, pointRadius: 0, tension: 0, order: 2},
          {data: pts, pointStyle: 'rectRot', pointRadius: 6, pointHoverRadius: 7, pointBackgroundColor: amb, pointBorderColor: card, pointBorderWidth: 2, order: 1}]},
        options: {maintainAspectRatio: false, animation: false, onHover: hov, layout: TLAY(),
          plugins: {legend: {display: false}, tooltip: {filter: i => i.datasetIndex === 1, callbacks: {label: c => { const r = c.raw.r;
            return [`${fd(r.draw_date)}: Tumor Methylation Score ${r.value}`, 'Northstar: ' + r.result.charAt(0) + r.result.slice(1).toLowerCase(), 'Not on the Signatera MTM/mL scale']; }}}},
          scales: {x: xAxis(), y: {...yw(YW), type: 'logarithmic', min: 3, max: top, grid: {color: grid},
            afterBuildTicks: a => { a.ticks = [10, 100, 1000, 10000, 100000].filter(v => v <= top).map(v => ({value: v})); },
            ticks: {color: css('--muted'), callback: v => (+v).toLocaleString('en-US')}}}}});
    }
    draw();
    draw.box = box;
    return draw;
  }

  /* ---------- Tumor variants: Grid / Timeline / Lines / Charts ---------- */
  const DESC = {
    grid: 'Each row is one of the tumor\'s mutations Natera follows; each column a draw with an allele file (inside the time window). A cell shows the allele ratio: the share of that position\'s DNA in the blood carrying the mutation (%). Natera calls a draw positive only when at least two variants are found. The columns are draws, not a time scale: the column nearest the date cursor is outlined, and hovering a column puts the cursor on that draw in every panel.',
    dots: 'The same data on the time axis, lined up with every other panel. Dot area = allele ratio; a small grey ring = tested, not found. The top row marks draws Natera sent no allele file for.',
    lines: 'One line per variant on a log scale, so small values stay visible. A line dropping to the floor means that variant was not found in that draw; lines break where draws without an allele file come in between. Hover a line to pick it out.',
    stack: 'One small chart per variant, like the lab charts: a point at every Signatera draw, joined by a line. Hover anywhere to line up a date across all charts.'};
  function gridHtml() {
    const cols = ADATES.filter(inW), hi = css('--hi');
    const vals = ALLELES.filter(a => +a.allele_ratio > 0).map(a => +a.allele_ratio);
    const lmin = Math.log10(Math.min(...vals)), lmax = Math.log10(Math.max(...vals));
    const alpha = v => 0.18 + 0.82 * (Math.log10(v) - lmin) / ((lmax - lmin) || 1);
    const pct = v => (v * 100).toFixed(v * 100 >= 0.1 ? 2 : 3);
    const byDraw = Object.fromEntries(ROWS.map(r => [r.draw_date, r]));
    const cell = (t, d) => ALLELES.find(a => a.target_id === t && a.draw_date === d);
    if (!cols.length) return ['<tr><td class="ndt">No draws with allele files in this time window.</td></tr>', ''];
    let h = '<tr><th></th>' + cols.map(d => `<th data-d="${d}">${fd(d).replace(/, (\d{4})/, '<br>$1')}</th>`).join('') + '</tr>';
    h += '<tr><th></th>' + cols.map(d => { const r = byDraw[d] || {}; return `<th data-d="${d}" class="call ${r.result === 'DETECTED' ? 'pos' : 'ndt'}">${r.result === 'DETECTED' ? r.value + ' MTM' : 'Negative'}</th>`; }).join('') + '</tr>';
    for (const t of shownT()) {
      const v = V(t);
      h += `<tr><td class="lab" title="Variant ${vnum(t)} · ${esc(geneTxt(t))} · ${v.change_type || ''} · ${esc(effTxt(t))} · ${locTxt(t)}"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${VC(t)}"></span><b>V${vnum(t)}</b> · ${geneHtml(t)} · ${v.chrom} ${v.ref}&gt;${v.alt}${tsTag(t)}</td>` + cols.map(d => {
        const a = cell(t, d), x = a ? +a.allele_ratio : 0;
        return x > 0 ? `<td data-d="${d}" class="c" style="background:color-mix(in srgb, ${VC(t)} ${Math.round(alpha(x) * 100)}%, transparent);color:${alpha(x) > 0.55 ? '#fff' : 'var(--ink)'}" title="${fd(d)} · ${v.ref}>${v.alt} · ${locTxt(t)} · ${pct(x)}%">${pct(x)}</td>`
                     : `<td data-d="${d}" class="c z" title="${fd(d)} · not detected">·</td>`; }).join('') + '</tr>';
    }
    h += '<tr class="cnt"><td class="lab"><b>Variants found</b></td>' + cols.map(d => `<td data-d="${d}">${posCount(d)}</td>`).join('') + '</tr>';
    const ex = [Math.min(...vals), 0.0005, Math.max(...vals)];
    return [h, 'Allele ratio (%): <i style="background:var(--bg)"></i> not found ' + ex.map(v => `<i style="background:color-mix(in srgb, ${hi} ${Math.round(alpha(v) * 100)}%, transparent)"></i> ${pct(v)}`).join(' ')];
  }
  // Timeline row labels, drawn inside the standard axis width so the plot lines up with every other panel:
  // bold "V1" on top, the gene (italic, "~" = next to it) underneath. The change and Ts/Tv are in the tooltip and the Grid.
  const rowLabels = {id: 'mrdRows', afterDraw(c) {
    const g = c.ctx, y = c.scales.y, x = c.chartArea.left - 6, fam = getComputedStyle(document.body).fontFamily, maxW = c.chartArea.left - 10;
    g.save(); g.textAlign = 'right';
    for (const tk of y.ticks) {
      const r = tk.value, py = y.getPixelForValue(r);
      if (r === 0) { g.textBaseline = 'middle'; g.font = `10.5px ${fam}`; g.fillStyle = css('--ink2'); g.fillText('no file', x, py); continue; }
      const tid = shownT()[r - 1], v = V(tid); if (!tid) continue;
      g.textBaseline = 'alphabetic'; g.font = `600 11px ${fam}`; g.fillStyle = css('--ink'); g.fillText('V' + vnum(tid), x, py - 1);
      let gene = v.gene ? (v.near ? '~' : '') + v.gene : '';
      g.font = `italic 9.5px ${fam}`; g.fillStyle = css('--ink2');
      while (gene.length > 3 && g.measureText(gene).width > maxW) gene = gene.slice(0, -2) + '…';
      g.textBaseline = 'top'; g.fillText(gene, x, py + 1);
    }
    g.restore(); }};
  // Timeline column headers, like the Grid: date + Natera result for each draw with a file; crowded labels are grouped and
  // centred on their dates, with a thin leader line to the exact date
  const heads = {id: 'mrdHeads',
    beforeDatasetsDraw(c) { const g = c.ctx, A = c.chartArea; g.save(); g.strokeStyle = css('--muted'); g.globalAlpha = .35; g.setLineDash([2, 3]);
      for (const d of ADATES.filter(inW)) { const x = c.scales.x.getPixelForValue(X(d)); g.beginPath(); g.moveTo(x, A.top); g.lineTo(x, A.bottom); g.stroke(); } g.restore(); },
    afterDraw(c) {
      const g = c.ctx, xs = c.scales.x, A = c.chartArea, fam = getComputedStyle(document.body).fontFamily, byDraw = Object.fromEntries(ROWS.map(r => [r.draw_date, r]));
      const H = ADATES.filter(inW).map(d => { const r = byDraw[d] || {}, dt = r.result === 'DETECTED';
        return {x: xs.getPixelForValue(X(d)), l1: new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}), l2: d.slice(0, 4), l3: dt ? r.value + ' MTM' : 'Negative', dt}; });
      g.save(); g.textAlign = 'center';
      for (const h of H) { g.font = `600 11px ${fam}`; h.w = Math.max(g.measureText(h.l1).width, g.measureText(h.l3).width) + 8; }
      let groups = H.map(h => ({items: [h]}));
      const lay = gr => { const w = gr.items.reduce((s, h) => s + h.w, 0), mid = gr.items.reduce((s, h) => s + h.x, 0) / gr.items.length;
        gr.l = Math.min(Math.max(mid - w / 2, A.left - 40), A.right + 12 - w); gr.r = gr.l + w; };
      for (let ch = true; ch;) { ch = false; groups.forEach(lay);
        for (let k = 1; k < groups.length; k++) if (groups[k].l < groups[k - 1].r) { groups[k - 1].items.push(...groups[k].items); groups.splice(k, 1); ch = true; break; } }
      for (const gr of groups) { let x = gr.l; for (const h of gr.items) { h.p = x + h.w / 2; x += h.w; } }
      const y0 = A.top - 62;
      for (const h of H) {
        g.fillStyle = css('--ink2'); g.font = `11.5px ${fam}`; g.fillText(h.l1, h.p, y0 + 12); g.fillText(h.l2, h.p, y0 + 25);
        g.font = `600 10.5px ${fam}`; g.fillStyle = h.dt ? css('--hi') : css('--ink2'); g.fillText(h.l3, h.p, y0 + 39);
        g.strokeStyle = css('--muted'); g.lineWidth = 1; g.beginPath(); g.moveTo(h.p, y0 + 44); g.lineTo(h.x, A.top - 4); g.stroke(); }
      g.restore(); }};

  function variants(box, key, opt) {
    box.classList.add('mrdp');
    box.innerHTML = `<div class="mrdh">${opt.title ? `<b>Tumor variants tracked <span class="sub" data-r="vsub"></span></b>` : '<span class="sub" data-r="vsub"></span>'}<div class="bar" data-r="views"></div></div>
      <label class="sub" style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-top:4px"><input type="checkbox" data-r="hide"> Hide variants never found <span>(${[...NEVER].map(t => 'V' + vnum(t)).join(', ') || 'none'})</span></label>
      <div class="sub" data-r="desc"></div>
      <div data-r="grid"><div style="overflow-x:auto;margin-top:10px"><table class="hm" data-r="hm"></table></div><div class="mscale" data-r="scale"></div>
        <div class="note">V1–V${NT} = the ${NT} tracked variants. <span class="tt ts">Ts</span> transition (A↔G or C↔T) · <span class="tt tv">Tv</span> transversion (purine↔pyrimidine).</div></div>
      <div data-r="vchart" class="hide" style="position:relative;margin-top:10px"><canvas></canvas></div>
      <div class="legend hide" data-r="vleg"></div>
      <div data-r="stack" class="hide"><div class="bar" style="margin:10px 0 2px" data-r="stctl"></div><div data-r="stlist"></div>
        <div class="legend"><span><span class="dot" style="background:var(--hi)"></span>Found</span><span><span class="dot" style="border:2px solid var(--nd);width:9px;height:9px"></span>Tested, not found</span><span><span class="dot" style="background:var(--nd);width:7px;height:7px;opacity:.6"></span>No allele file (this variant unknown)</span></div></div>
      <div class="note" data-r="vnote"></div>`;
    const hide = R(box, 'hide'); hide.checked = hideNever;
    hide.onchange = () => { hideNever = hide.checked; store.set('mrd.hideNever', hideNever); refreshAll(); };
    R(box, 'vchart').addEventListener('mouseleave', () => { if (hoverT) { hoverT = null; draw(); } });
    function draw() {
      drop(key + '#');
      hide.checked = hideNever;
      const vb = R(box, 'views'); vb.innerHTML = '<span class="sub">View</span>';
      [['grid', 'Grid'], ['dots', 'Timeline'], ['lines', 'Lines'], ['stack', 'Charts']].forEach(([v, l]) => vb.append(btn(l, '', () => { view = v; hoverT = null; store.set('mrd.view', v); refreshAll(); }, view === v)));
      if (opt.height && (view === 'lines' || view === 'stack')) vb.append(btn('−', 'Shorter', () => { setH(key, hOf(key, 440) - 40); window.render(); }), btn('+', 'Taller', () => { setH(key, hOf(key, 440) + 40); window.render(); }));
      R(box, 'desc').textContent = DESC[view]; R(box, 'vsub').textContent = `(${shownT().length}, in ${ADATES.length} draws)`;
      R(box, 'vnote').textContent = `Natera sent allele files for ${ADATES.length} of ${done.length} draws. For the others, per-variant results are unknown.`;
      R(box, 'grid').classList.toggle('hide', view !== 'grid'); R(box, 'stack').classList.toggle('hide', view !== 'stack');
      R(box, 'vchart').classList.toggle('hide', view === 'grid' || view === 'stack'); R(box, 'vleg').classList.toggle('hide', view === 'grid' || view === 'stack');
      if (view === 'grid') {
        const [h, sc] = gridHtml(), hm = R(box, 'hm'); hm.innerHTML = h; R(box, 'scale').innerHTML = sc;
        // the date cursor: outline the draw column nearest the cursor (within 3 weeks); hovering a column moves the cursor there
        const mark = () => { let best = null;
          if (hoverX != null) { const tc = unpos(hoverX); let bd = 21 * DAY; ADATES.filter(inW).forEach(d => { const dd = Math.abs(ms(d) - tc); if (dd <= bd) { bd = dd; best = d; } }); }
          hm.querySelectorAll('[data-d]').forEach(e => e.classList.toggle('hov', e.dataset.d === best)); };
        charts.set(key + '#g', {draw: mark, destroy() {}});
        hm.onmouseover = e => { const c = e.target.closest('[data-d]'); if (c) setHover(pos(ms(c.dataset.d))); };
        hm.onmouseleave = () => setHover(null);
        mark(); return;
      }
      if (view === 'stack') return stack();
      const hi = css('--hi'), nd = css('--nd'), gridc = css('--line');
      R(box, 'vchart').style.height = view === 'dots' ? (90 + 30 * (shownT().length + 1)) + 'px' : hOf(key, 440) + 'px';
      const tip = c => { const a = c.raw.a; return a ? [`V${vnum(a.target_id)} · ${geneTxt(a.target_id)} · ${V(a.target_id).chrom} ${a.ref}>${a.alt} (${(V(a.target_id).change_type || '').toLowerCase()}) · ${fd(a.draw_date)}: ` + (+a.allele_ratio > 0 ? pctS(+a.allele_ratio) : 'not found'), locTxt(a.target_id)] : `${fd(c.raw.d)}: ${c.raw.v} MTM/mL, no allele file`; };
      let cfg;
      if (view === 'dots') {
        const maxV = Math.max(...ALLELES.map(a => +a.allele_ratio)), rad = v => 3 + 13 * Math.sqrt(v / maxV);
        const vis = new Set(shownT()), found = ALLELES.filter(a => vis.has(a.target_id) && +a.allele_ratio > 0), miss = ALLELES.filter(a => vis.has(a.target_id) && +a.allele_ratio === 0);
        const nofile = done.filter(r => !ADATES.includes(r.draw_date));
        cfg = {type: 'bubble', plugins: plugins(rowLabels, heads), data: {datasets: [
          {data: found.map(a => ({x: X(a.draw_date), y: rowOf(a.target_id), r: rad(+a.allele_ratio), a})), backgroundColor: c => c.raw && c.raw.a ? VC(c.raw.a.target_id) + 'cc' : hi, borderColor: c => c.raw && c.raw.a ? VC(c.raw.a.target_id) : hi, borderWidth: 1},
          {data: miss.map(a => ({x: X(a.draw_date), y: rowOf(a.target_id), r: 2.5, a})), backgroundColor: 'transparent', borderColor: nd, borderWidth: 1},
          {data: nofile.map(r => ({x: X(r.draw_date), y: 0, r: 2.5, d: r.draw_date, v: r.value})), backgroundColor: nd, borderColor: nd, pointStyle: 'line', borderWidth: 2, rotation: 90}]},
          options: {maintainAspectRatio: false, animation: false, onHover: hov, layout: TLAY(62), clip: false,   // no extra room for big bubbles, so the plot keeps the shared edges
            plugins: {legend: {display: false}, tooltip: {callbacks: {label: tip}}},
            scales: {x: xAxis(), y: {...yw(YW), reverse: true, min: -0.6, max: shownT().length + 0.6, grid: {color: c => c.tick.value === 0 ? 'transparent' : gridc},
              afterBuildTicks: a => { a.ticks = [0, ...shownT().map(rowOf)].map(v => ({value: v})); }, ticks: {autoSkip: false, callback: () => ''}}}}};
        cfg.data.datasets.forEach(d => d.data = d.data.filter(p => p.x >= -0.5 && p.x <= 100.5));   // only dots inside the window
        R(box, 'vleg').innerHTML = 'Allele ratio: ' + [0.0001, 0.001, maxV].map(v => { const d = 2 * rad(v); return `<span><span class="dot" style="width:${d}px;height:${d}px;background:${hi}cc"></span>${pctS(v)}</span>`; }).join('') +
          `<span><span class="dot" style="border:1px solid ${nd};width:6px;height:6px"></span>not found</span><span style="color:${nd}">| draw with no allele file</span><span>~gene = next to that gene · hover a dot for the change and position</span>`;
      } else {
        const FLOOR = 0.003;
        const ds = shownT().map(t => {
          const pts = ALLELES.filter(a => a.target_id === t).sort((a, b) => a.draw_date < b.draw_date ? -1 : 1)
            .map(a => ({x: X(a.draw_date), y: +a.allele_ratio > 0 ? +a.allele_ratio * 100 : FLOOR, a, t: ms(a.draw_date)}))
            .flatMap((p, i, arr) => { const nx = arr[i + 1]; const gap = nx && done.some(r => !ADATES.includes(r.draw_date) && ms(r.draw_date) > p.t && ms(r.draw_date) < nx.t); return gap ? [p, {x: (p.x + nx.x) / 2, y: null}] : [p]; });
          const isOn = hoverT === t, dim = hoverT && !isOn;
          return {type: 'line', label: 'V' + vnum(t), t, data: pts, borderColor: dim ? gridc : isOn ? VC(t) : VC(t) + 'a6', borderWidth: isOn ? 3 : 1.5, spanGaps: false,
            pointRadius: pts.map(p => p.y === null ? 0 : p.y === FLOOR ? 2 : isOn ? 5 : 3.5), pointBackgroundColor: pts.map(p => p.y === FLOOR ? nd : dim ? gridc : VC(t)), pointBorderWidth: 0, tension: 0, order: isOn ? 0 : 1};
        });
        cfg = {type: 'line', plugins: plugins(), data: {datasets: ds}, options: {maintainAspectRatio: false, animation: false, layout: TLAY(), interaction: {mode: 'nearest', intersect: false},
          onHover: (e, els, c) => { hov(e, els, c); const t = els.length ? c.data.datasets[els[0].datasetIndex].t : null; if (t !== hoverT) { hoverT = t; setTimeout(draw, 0); } },
          plugins: {legend: {display: false}, tooltip: {callbacks: {label: tip}}},
          scales: {x: xAxis(), y: {...yw(YW), type: 'logarithmic', min: 0.0025, max: 1, grid: {color: gridc},
            afterBuildTicks: a => { a.ticks = [FLOOR, 0.01, 0.03, 0.1, 0.3, 1].map(v => ({value: v})); }, ticks: {color: css('--muted'), autoSkip: false, callback: v => v === FLOOR ? 'not found' : v + '%'}}}}};
        R(box, 'vleg').innerHTML = hoverT ? `<span><b style="color:${VC(hoverT)}">V${vnum(hoverT)} · ${esc(geneTxt(hoverT))}</b> highlighted</span>` : '<span>Hover a line to highlight one variant</span>';
      }
      keep(key + '#v', R(box, 'vchart').querySelector('canvas'), cfg);
    }
    function stack() {
      const sc = R(box, 'stctl'); sc.innerHTML = '<span class="sub">Y-axis</span>';
      sc.append(btn('Own scale per variant', '', () => { sameY = false; draw(); }, !sameY), btn('Same scale for all', '', () => { sameY = true; draw(); }, sameY));
      const o = document.createElement('span'); o.className = 'sub'; o.style.marginLeft = '10px'; o.textContent = 'Order'; sc.append(o);
      sc.append(btn('Variant number', '', () => { orderMost = false; draw(); }, !orderMost), btn('Most often found', '', () => { orderMost = true; draw(); }, orderMost));
      const hi = css('--hi'), nd = css('--nd'), gridc = css('--line'), vh = Math.max(70, Math.round(hOf(key, 440) * 96 / 440));
      const maxAll = Math.max(...ALLELES.map(a => +a.allele_ratio)) * 100;
      const nFound = t => ALLELES.filter(a => a.target_id === t && a.call === 'POSITIVE').length;
      const tids = shownT(); if (orderMost) tids.sort((a, b) => nFound(b) - nFound(a) || vnum(a) - vnum(b));
      const list = R(box, 'stlist'); list.innerHTML = '';
      tids.forEach((t, i) => {
        const mine = ALLELES.filter(a => a.target_id === t), v = V(t), peak = mine.reduce((m, a) => +a.allele_ratio > +m.allele_ratio ? a : m, mine[0]);
        const pts = done.map(r => { const a = mine.find(x => x.draw_date === r.draw_date);
          return a ? {x: X(r.draw_date), y: +a.allele_ratio * 100, a, k: +a.allele_ratio > 0 ? 'f' : 'n'} : {x: X(r.draw_date), y: 0, d: r.draw_date, v: r.value, k: 'u'}; });
        const last = i === tids.length - 1, card = document.createElement('div'); card.className = 'vcard';
        card.innerHTML = `<div class="vhead"><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${VC(t)}"></span><b>V${vnum(t)}</b> <span class="sub">· ${geneHtml(t)} · ${v.chrom} ${v.ref}&gt;${v.alt} ${(v.change_type || '').toLowerCase()} · ${esc(effTxt(t))}</span></span><span class="sub">${locHtml(t)}</span><span class="sub">found in ${nFound(t)} of ${ADATES.length} files</span>` +
          `<span class="pk">${+peak.allele_ratio > 0 ? 'peak ' + pctS(+peak.allele_ratio) + ', ' + fd(peak.draw_date) : 'never found'}</span></div><div class="vbox" style="height:${vh + (last ? 22 : 0)}px"><canvas></canvas></div>`;
        list.appendChild(card);
        const ownMax = Math.max(...pts.map(p => p.y));
        keep(key + '#st' + t, card.querySelector('canvas'), {type: 'line', plugins: plugins(),
          data: {datasets: [{data: pts, borderColor: VC(t) + 'b3', borderWidth: 1.5, tension: 0,
            segment: {borderColor: s => (s.p0.raw.k === 'u' || s.p1.raw.k === 'u') ? nd + '66' : undefined, borderDash: s => (s.p0.raw.k === 'u' || s.p1.raw.k === 'u') ? [3, 3] : undefined},
            pointRadius: pts.map(p => p.k === 'f' ? 4 : p.k === 'n' ? 3 : 2), pointHoverRadius: pts.map(p => p.k === 'f' ? 6 : 4),
            pointBackgroundColor: pts.map(p => p.k === 'f' ? VC(t) : p.k === 'n' ? css('--card') : nd + '99'),
            pointBorderColor: pts.map(p => p.k === 'f' ? VC(t) : nd), pointBorderWidth: pts.map(p => p.k === 'n' ? 1.5 : 0)}]},
          options: {maintainAspectRatio: false, animation: false, onHover: hov, layout: TLAY(), interaction: {mode: 'nearest', axis: 'x', intersect: false},
            plugins: {legend: {display: false}, tooltip: {callbacks: {title: () => '', label: c => { const p = c.raw; return fd(p.a ? p.a.draw_date : p.d) + ': ' + (p.k === 'f' ? pctS(p.y / 100) : p.k === 'n' ? 'not found' : 'no allele file (draw reported ' + p.v + ' MTM/mL)'); }}}},
            scales: {x: xAxis(last), y: {...yw(YW), min: 0, max: sameY ? +(maxAll * 1.1).toFixed(2) : (ownMax > 0 ? undefined : 0.05), suggestedMax: ownMax * 1.15 || 0.05, grid: {color: gridc},
              ticks: {color: css('--muted'), maxTicksLimit: 3, font: {size: 10.5}, callback: v => v === 0 ? '0' : (+v).toPrecision(2).replace(/\.?0+$/, '') + '%'}}}}});
      });
    }
    draw();
    draw.box = box;
    return draw;
  }

  /* every live panel (page or Compare) keeps its redraw function here, so a setting changed in one updates all */
  const LIVE = new Map();   // key -> draw()
  function refreshAll() { LIVE.forEach((f, k) => { if (!f.box.isConnected) { LIVE.delete(k); return; } f(); }); }   // panels no longer on screen are forgotten

  /* ---------- the full Signatera page (One test view) ---------- */
  function page() {
    const s = $('mrd');
    const stage = '<span class="pmove"><button data-mm="top" title="Move this panel to the top" aria-label="Move the Signatera panel to the top">⤒</button><button data-mm="-1" title="Move this panel up" aria-label="Move the Signatera panel up">↑</button><button data-mm="1" title="Move this panel down" aria-label="Move the Signatera panel down">↓</button><button data-mm="bottom" title="Move this panel to the bottom" aria-label="Move the Signatera panel to the bottom">⤓</button></span><button data-mmin title="Minimize this panel to its title bar (click again to open it)">' + minLabel('__det') + '</button><button data-mclose title="Close this panel (bring it back with + at the top right)" aria-label="Close this panel">×</button>';
    s.classList.add('mrdp');
    s.innerHTML = `<div class="dethead" style="margin-top:16px"><div><h2>Signatera <span class="sub">ctDNA · ${esc(LAST.vendor || 'Natera')} · tumor-informed MRD test</span></h2><div class="sub" data-r="desc"></div></div>${stage}</div>
<div class="stats" data-r="stats"></div>
<div class="card" data-r="ot"></div>
${NS.length ? '<div class="card" data-r="ns"></div>' : ''}
${ADATES.length ? `<div class="card" data-r="var"></div>
<div class="card"><b>Variant positions</b>
  <div class="sub">Natera reports positions on hs37d5 (GRCh37 / hg19). GRCh38 positions come from the UCSC hg19→hg38 chain file, cross-checked with Ensembl (which also confirmed the reference base at both). Both are kept. Genes and effects: Ensembl VEP (GRCh38, one standard transcript per variant); hover an effect for the exact notation. Natera picks these mutations as trackable markers of the tumor, so most are not known cancer drivers.</div>
  <div style="overflow-x:auto;margin-top:8px"><table data-r="pos"></table></div></div>` : ''}
<div class="card"><b>All draws</b> <span class="sub" data-r="tsub"></span><div style="overflow-x:auto"><table data-r="tbl"></table></div></div>`;
    s.querySelector('[data-mmin]').onclick = () => setMin('__det', !isMin('__det'));
    s.querySelector('[data-mclose]').onclick = () => setClosed('det', true);
    s.querySelectorAll('[data-mm]').forEach(b => b.onclick = () => moveStage('__det', b.dataset.mm === 'top' || b.dataset.mm === 'bottom' ? b.dataset.mm : +b.dataset.mm));
    const o = mode === 'single' ? stageOrder() : [], i = o.indexOf('__det');
    s.querySelector('[data-mm="top"]').disabled = s.querySelector('[data-mm="-1"]').disabled = i <= 0;
    s.querySelector('[data-mm="bottom"]').disabled = s.querySelector('[data-mm="1"]').disabled = i >= o.length - 1;
    // header and stats
    const max = det.reduce((a, r) => +r.value > +a.value ? r : a, det[0]), last = done[done.length - 1];
    let streak = 0; for (let k = done.length - 1; k >= 0 && done[k].result !== 'DETECTED'; k--) streak++;
    const nIn = done.filter(r => inW(r.draw_date)).length, fIn = ADATES.filter(inW).length;
    R(s, 'desc').textContent = `${nIn} of ${done.length} draws in window` + (ADATES.length ? `, ${fIn} with allele files` : '') + ` · all draws ${fd(done[0].draw_date)} to ${fd(last.draw_date)}`;
    const stat = (v, l, cls = '') => `<div class="stat"><b class="${cls}">${v}</b><span>${l}</span></div>`;
    R(s, 'stats').innerHTML = stat(last.result === 'DETECTED' ? last.value + ' MTM/mL' : 'Not detected', 'Latest, ' + fd(last.draw_date), last.result === 'DETECTED' ? 'pos' : '') +
      stat(done.length, 'Draws') + stat(det.length, 'Detected') + (max ? stat(max.value, 'Highest, ' + fd(max.draw_date), 'pos') : '') +
      (streak && streak < done.length ? stat(streak, 'Not detected in a row, since ' + fd(done[done.length - streak].draw_date)) : '');
    // panels
    LIVE.set('mrd:ot@page', overTime(R(s, 'ot'), 'mrd:ot@page', {title: true, note: true, h: 280, height: true}));
    if (NS.length) LIVE.set('mrd:ns@page', northstar(R(s, 'ns'), 'mrd:ns@page', {title: true, note: true, h: 200, height: true}));
    if (ADATES.length) {
      LIVE.set('mrd:var@page', variants(R(s, 'var'), 'mrd:var@page', {title: true, height: true}));
      R(s, 'pos').innerHTML = '<tr><th>Variant</th><th>Gene</th><th>Effect</th><th>Change</th><th>Type</th><th>GRCh37 / hs37d5 (Natera)</th><th>GRCh38</th><th>Shift</th><th>Check</th></tr>' +
        ALL_T.map(t => { const v = V(t), d = v.pos_grch38 ? v.pos_grch38 - v.pos_grch37 : null;
          return `<tr><td><b>V${vnum(t)}</b></td><td>${geneHtml(t)}</td><td class="ndt" title="${esc(v.hgvsc || '')}${v.hgvsp ? ' · ' + esc(v.hgvsp) : ''}">${esc(effTxt(t))}</td><td>${v.ref}&gt;${v.alt}</td><td class="ndt">${v.change_type || ''}</td><td class="mono">${loc37(t)}</td><td class="mono">${loc38(t)}</td><td class="mono ndt">${d == null ? '' : (d > 0 ? '+' : '') + nf(d)}</td><td class="ndt">${v.check === 'ok' ? 'ref base matches ✓' : esc(v.check || '')}</td></tr>`; }).join('');
    }
    // draws table (inside the window)
    const rows = ROWS.filter(r => inW(r.draw_date)).reverse();
    R(s, 'tsub').textContent = `(${rows.length} in window, newest first)`;
    R(s, 'tbl').innerHTML = '<tr><th>Draw date</th><th>MTM/mL</th><th>Result</th>' + (ADATES.length ? '<th>Variants found</th><th>Our score</th>' : '') + '<th>Where it\'s recorded</th></tr>' + rows.map(r => {
      const where = r.result === 'NOT PERFORMED' ? r.source : 'Natera report' + (r.also_in ? ' · ' + r.also_in : '');
      const res = r.result === 'DETECTED' ? '<span class="pos">Detected</span>' : r.result === 'NOT PERFORMED' ? '<span class="ndt">Test not performed</span>' : '<span class="ndt">Not detected</span>';
      const sc = SCORE[r.draw_date];
      const vf = ADATES.length ? (sc ? `<td class="num">${sc.n} of ${sc.of}</td><td class="num">${sc.mean.toFixed(4)}%</td>` : '<td class="ndt">no file</td><td></td>') : '';
      return `<tr><td>${fd(r.draw_date)}</td><td class="num">${r.value || '–'}</td><td>${res}</td>${vf}<td class="ndt">${esc(where)}</td></tr>`; }).join('');
  }

  /* ---------- Compare: one panel per ticked id, inside the viewer's own card (with ⤒↑↓⤓ − + ×) ---------- */
  function panel(id, body) {
    const f = id === 'mrd:ot' ? overTime(body, id, {title: false, note: false, h: H0[id], compact: true})
      : id === 'mrd:ns' ? northstar(body, id, {title: false, note: false, h: H0[id]}) : variants(body, id, {title: false});
    LIVE.set(id, f);
  }
  function refresh(id) { const f = LIVE.get(id); if (f && f.box.isConnected) f(); }
  const H0 = {'mrd:ot': 160, 'mrd:var': 440, 'mrd:ns': 150};

  /* a test's group heading in the MRD section: a tick box (all of its panels on/off) and All / None / Only,
     the same for every test so each one can be turned on and off by itself */
  function groupHead(S, key, name, ids, idle, q) {
    const k = ids.filter(id => sel.includes(id)).length, both = ids.length > 1;
    const G = window.section(S, key, name, k ? k + '/' + ids.length : idle, true, 'grp', q), gs = G.firstChild;
    const cb0 = document.createElement('input'); cb0.type = 'checkbox'; cb0.checked = k === ids.length; cb0.indeterminate = k > 0 && k < ids.length;
    cb0.title = 'Tick or untick ' + (both ? 'every ' + name + ' panel' : 'the ' + name + ' panel') + ' for Compare'; cb0.setAttribute('aria-label', cb0.title);
    cb0.onclick = e => { e.stopPropagation(); setLabSel(ids, cb0.checked); }; gs.insertBefore(cb0, gs.firstChild);
    panelBtns(G, name + ' panel', 'grp:' + key, ids, name);
    return G;
  }

  /* ---------- Library section: Signatera group, a tick box per panel (Compare), the name opens the full page ---------- */
  function section(el, q) {
    const nowOn = sel.includes('mrd:ot'); if (nowOn && !otOn) startAllele(); otOn = nowOn;
    if (q && !'mrd ctdna signatera natera minimal residual disease tumor variants over time northstar billiontoone methylation'.includes(q)) return;
    const S = window.section(el, 'mrd', 'MRD tests', NS.length ? '2 tests' : '1 test', true, 'sec', q);
    panelBtns(S, 'MRD panel', 'grp:mrd', IDS, 'MRD tests');
    const G = groupHead(S, 'mrd:sig', 'Signatera', SIG_IDS, done.length + ' draws', q);
    // the whole-test row: opens the full page
    const pg = document.createElement('div'); pg.className = 't' + (active() ? ' on' : '');
    const pn = document.createElement('span'); pn.className = 'nm'; pn.innerHTML = 'Signatera <span class="tag">' + esc(LAST.vendor || 'Natera') + ' · full page</span>';
    pn.title = 'Open the full Signatera page: results, variants, positions and every draw';
    const pc = document.createElement('span'); pc.className = 'n'; pc.textContent = done.length + (det.length ? ' · ' + det.length + ' detected' : '');
    const go = document.createElement('button'); go.type = 'button'; go.className = 'mini goto'; go.textContent = '⌖';
    go.title = 'Find Signatera on the timeline: step through its draws'; go.setAttribute('aria-label', go.title);
    go.onclick = e => { e.preventDefault(); e.stopPropagation(); startFind(); };
    pg.append(pn, go, pc); pg.onclick = open; G.appendChild(pg);
    // one row per panel: tick = Compare; name = full page
    SIG_IDS.forEach(id => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(id); cb.setAttribute('aria-label', 'Compare ' + PANELS[id].title);
      cb.onclick = e => { e.stopPropagation(); setLabSel([id], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = PANELS[id].title.replace('Signatera · ', ''); nm.title = PANELS[id].title + ' (tick to compare; click to open the full page)';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = id === 'mrd:var' ? NT + ' · ' + ADATES.length + ' files' : '';
      d.append(cb, nm, n); d.onclick = open;
      d.onmouseenter = () => setHlLab(id); d.onmouseleave = () => setHlLab(null);
      G.appendChild(d);
    });
    if (NS.length) {   // Northstar Response: its own group (a different test), one panel
      const N = groupHead(S, 'mrd:ns', 'Northstar Response', ['mrd:ns'], NS.length + ' draws', q);
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes('mrd:ns'); cb.setAttribute('aria-label', 'Compare ' + PANELS['mrd:ns'].title);
      cb.onclick = e => { e.stopPropagation(); setLabSel(['mrd:ns'], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.innerHTML = 'Over time <span class="tag">BillionToOne · methylation score</span>';
      nm.title = 'Northstar Response Tumor Methylation Score (tick to compare; click to open the MRD page)';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = 'latest ' + NS[NS.length - 1].value;
      d.append(cb, nm, n); d.onclick = open;
      d.onmouseenter = () => setHlLab('mrd:ns'); d.onmouseleave = () => setHlLab(null);
      N.appendChild(d);
    }
  }
  function open() { if (!on) startAllele(); on = true; store.set('mrd.on', true); setMode('single'); }

  /* ---------- Find: step through the Signatera draws (⌖ in the Library), like the medications' Find bar ----------
     Each step moves the window to the draw (keeping its length, or 3 months when it is longer than 6), makes sure an
     Over time chart is on screen (the full page in One test view, the panel in Compare), puts the hover line on the
     draw and scrolls the chart into view. "Signal only" steps through draws Natera called detected or where the
     allele file shows any variant. */
  let MF = null;
  const signal = r => r.result === 'DETECTED' || (SCORE[r.draw_date] && SCORE[r.draw_date].n > 0);
  function findList() { return ROWS.filter(r => !MF.sig || signal(r)); }
  function startFind() {
    if (typeof FIND !== 'undefined' && FIND) { FIND = null; setHlDrug(null); }   // one Find bar at a time
    MF = {sig: store.get('mrd.findsig', false), i: 0};
    const L = findList(), j = L.findIndex(r => inW(r.draw_date));
    findGo(j >= 0 ? j : 0);
  }
  function findGo(i) {
    const L = findList(); if (!L.length) return;
    MF.i = i = Math.max(0, Math.min(L.length - 1, i)); const r = L[i], t = ms(r.draw_date);
    let len = W.b - W.a; if (len > 180 * DAY) len = 90 * DAY; const a = Math.max(X0, Math.min(centreStart(t, len), X1 - len));
    const shown = mode === 'single' ? active() : sel.includes('mrd:ot');
    if (!shown) { if (mode === 'single') { on = true; store.set('mrd.on', true); } else { sel.push('mrd:ot'); store.set('selected', sel); }
      W = {a, b: a + len}; store.set('window', W); syncWin(); updateBar(); list(); window.render(); }
    else setWin(a, a + len);
    findBar(); setLock(t); setTimeout(() => { setHover(pos(t)); findScroll(); }, 40);   // cursor locked on the draw
  }
  function findScroll() {
    const c = charts.get('mrd:ot@page#c') || charts.get('mrd:ot#c'); if (!c) return;
    const r = c.canvas.getBoundingClientRect(), top = document.querySelector('.navpin').getBoundingClientRect().bottom + 10;
    if (r.top < top || r.bottom > innerHeight - 20) scrollBy({top: r.top - top - 40, behavior: 'smooth'});
  }
  function findBar() {
    const bar = $('findBar'); bar.innerHTML = ''; bar.classList.toggle('hide', !MF); if (!MF) return;
    const L = findList(), r = L[MF.i], n = L.length, s = SCORE[r.draw_date];
    const ic = document.createElement('span'); ic.className = 'wl'; ic.textContent = '⌖';
    const nb = document.createElement('b'); nb.textContent = 'Signatera';
    const k = document.createElement('span'); k.className = 'sub'; k.textContent = (MF.i + 1) + ' of ' + n + (MF.sig ? ' with a signal' : ' draws');
    const b = (txt, tip, i, off) => { const x = btn(txt, tip, () => findGo(i)); x.disabled = off; return x; };
    const d = document.createElement('span');
    d.textContent = fd(r.draw_date) + ' · ' + (r.result === 'NOT PERFORMED' ? 'test not performed' : (r.value || '0') + ' MTM/mL, ' + (r.result === 'DETECTED' ? 'detected' : 'not detected')) +
      (s ? ' · ' + s.n + ' of ' + s.of + ' variants found' : '') + ' · ' + (r.result === 'NOT PERFORMED' ? r.source : 'Natera report' + (r.also_in ? ' · ' + r.also_in : ''));
    const sg = btn('Signal only', 'Step only through draws Natera called detected or with any variant in the allele file', () => {
      const cur = L[MF.i]; MF.sig = !MF.sig; store.set('mrd.findsig', MF.sig);
      const L2 = findList(); let j = L2.findIndex(x => x.draw_date >= cur.draw_date); findGo(j >= 0 ? j : L2.length - 1); }, MF.sig);
    bar.append(ic, nb, k, b('⏮', 'First', 0, MF.i === 0), b('◀', 'Previous', MF.i - 1, MF.i === 0), b('▶', 'Next', MF.i + 1, MF.i === n - 1), b('⏭', 'Last', n - 1, MF.i === n - 1), d, sg);
    const x = btn('×', 'Close the Find bar', () => { MF = null; findBar(); }); x.style.marginLeft = 'auto'; bar.appendChild(x);
  }

  function render() { LIVE.forEach((f, k) => { if (k.endsWith('@page')) LIVE.delete(k); }); page(); }
  function close() { if (on) { on = false; store.set('mrd.on', false); } }
  /* display settings, saved in Panel presets (med_timeline.js viewNow/applyView) */
  function getSettings() { return {mrd: {view, measure, log: logMode, hideNever}}; }
  function setSettings(o) { const m = o && o.mrd; if (!m) return;
    if (m.view) { view = m.view; store.set('mrd.view', view); } if (m.measure) { measure = m.measure; store.set('mrd.measure', measure); }
    if ('log' in m) { logMode = !!m.log; store.set('mrd.log', logMode); } if ('hideNever' in m) { hideNever = !!m.hideNever; store.set('mrd.hideNever', hideNever); }
    otOn = sel.includes('mrd:ot'); refreshAll(); }
  return {has: true, isId: id => !!PANELS[id], active, section, getSettings, setSettings, render, close, panel, refresh, title: id => (PANELS[id] || {}).title || id, unit: id => (PANELS[id] || {}).unit || '', h0: id => H0[id] || 160};
})();
