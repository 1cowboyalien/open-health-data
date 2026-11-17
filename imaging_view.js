/* Imaging → Brain MRI in the Library of the lab viewer (labs.html): scan dates, slice viewer (NiiVue), lesions over time,
   radiation dose by lesion. Used by open-health-data/make_lab_view.py (as imaging_view.js) and by the simulation build.
   Everything about the patient (hospitals, scans, lesions, doses, default view) comes from IMG_DATA, never from this code.
   It plugs into the hooks the viewer already calls for MRD panels (MRD.isId/title/unit/h0/panel/refresh/section),
   so the panels get the same ⤒ ↑ ↓ ⤓ − + × controls and Compare stacking.
   Panels:  img:brain:dates  = every brain MRI as a point on the shared time axis
            img:brain:viewer = NiiVue slice viewer (axial/coronal/sagittal + 3D) with our lesion outlines L01…
   Data: IMG_DATA = {brain_mri: [...], viewer_scans: [{date, t1c, labels, lesions:[{id,n,name,rgb,enh,axial,ras}]}]}. */
(() => {
  const ROWS = IMG_DATA.brain_mri;
  const SCANS = IMG_DATA.viewer_scans || [];
  const ID = 'img:brain:dates', IDV = 'img:brain:viewer', IDL = 'img:brain:lesions', IDD = 'img:brain:dose';
  const LS = IMG_DATA.lesion_series || {lesions: [], reports: [], measured: [], treatments: [], scans: []};
  const PANELS = {[ID]: {title: 'Brain MRI · Scan dates', unit: ROWS.length + ' scans', h0: 190},
                  [IDV]: {title: 'Brain MRI · Slice viewer', unit: 'our lesion outlines', h0: 520},
                  [IDL]: {title: 'Brain MRI · Lesions over time', unit: 'our volumes (mm³) · trends · report sizes', h0: 380},
                  [IDD]: {title: 'Brain MRI · Radiation dose by lesion', unit: 'estimated', h0: 260}};
  const DOSE = IMG_DATA.dose;   // ESTIMATED radiation dose (imaging/radiation_dose), or null
  const NIIVUE = 'https://cdn.jsdelivr.net/npm/@niivue/niivue@0.69.0/+esm';   // jsDelivr bundles it as a browser module (unpkg's build file did not import)
  // health systems come from the (private) data file, never from this public code: [{key, short, long}]
  const SITE_LIST = IMG_DATA.sites || [];
  const SITES = SITE_LIST.map(s => s.key);
  const SHORT = Object.fromEntries(SITE_LIST.map(s => [s.key, s.short || s.key]));
  const LONG = Object.fromEntries(SITE_LIST.map(s => [s.key, s.long || s.short || s.key]));
  const BODIES = new Map();
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

  /* ================= Scan dates panel (points on the time axis) ================= */
  function xAxis() {
    const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}};
  }
  const guide = {id: 'imgGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};

  function drawDates(id, body) {
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = '';
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Brain MRI scan dates by hospital');
    box.appendChild(cv); body.appendChild(box);
    const used = SITES.filter(s => ROWS.some(r => r.site === s));
    const pts = ROWS.map(r => ({x: pos(ms(r.date)), y: used.indexOf(r.site), r}));
    const hasView = d => SCANS.some(s => s.date === d);
    const c = new Chart(cv, {type: 'scatter', plugins: [guide, momentPlugin],
      data: {datasets: [{data: pts, parsing: true,
        pointRadius: p => p.raw && p.raw.r.images ? (hasView(p.raw.r.date) ? 8 : 6) : 5, pointHoverRadius: 9,
        pointBackgroundColor: p => p.raw && p.raw.r.images ? srcColor(p.raw.r.site) : '#fff',
        pointBorderColor: p => p.raw && hasView(p.raw.r.date) ? '#fff' : (p.raw ? srcColor(p.raw.r.site) : '#888'),
        pointBorderWidth: p => p.raw && (hasView(p.raw.r.date) || !p.raw.r.images) ? 2 : 1}]},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null);
          ch.canvas.style.cursor = els.length && hasView(ch.data.datasets[0].data[els[0].index].r.date) ? 'pointer' : 'default'; },
        onClick: (e, els, ch) => { if (!els.length) return; const r = ch.data.datasets[0].data[els[0].index].r;
          if (hasView(r.date)) openViewer(r.date); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, callbacks: {
          title: it => { const r = it[0].raw.r; return fd(r.date) + ' · ' + LONG[r.site]; },
          label: it => { const r = it.raw.r; return [r.finding, (r.scanner ? r.scanner + (r.field ? ' · ' + r.field + 'T' : '') : 'scanner unknown'),
            r.images ? r.images.toLocaleString() + ' images on file' + (r.partial ? ' (partial)' : '') : 'no images on file (request on CD)']
            .concat(hasView(r.date) ? ['Click: open in the slice viewer'] : []); }}}},
        scales: {x: xAxis(),
          y: {min: -0.6, max: used.length - 0.4, reverse: true, afterFit: s => { s.width = YW; },
            afterBuildTicks: a => { a.ticks = used.map((_, i) => ({value: i})); },
            ticks: {color: css('--muted'), autoSkip: false, callback: v => SHORT[used[v]] || ''},
            grid: {color: css('--line')}}}}});
    charts.set(id, c); box.onmouseleave = () => setHover(null);
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.textContent = 'Filled = images on file · hollow = report only · white ring = measured (click to open in the slice viewer). Color = hospital.';
    body.appendChild(note);
  }

  /* ================= Slice viewer panel (NiiVue) ================= */
  const V = {el: null, nv: null, NV: null, scan: null, loading: null, cut: true, radio: store.get('img.radio', true), noseLeft: store.get('img.noseLeft', true),
             dose: Object.assign({key: '', op: 35, lines: true, blend: 25}, store.get('img.dose', {})),
             size: store.get('img.size', 0), full: false};   // size: viewer height in px (0 = the panel's height); full: filling the window
  window.__imgViewer = V;   // for testing in the browser console
  if (typeof saveEdits === 'function') { const _save = saveEdits;
    saveEdits = function () { const mine = (E.moments || []).filter(m => m.imgView); E.moments = (E.moments || []).filter(m => !m.imgView);
      try { return _save.apply(this, arguments); } finally { E.moments.push(...mine); } }; }
  const DDEF = {layout: 'grid', lbPlane: 'A', lbStep: '5', lbPlus: false, outline: 'fill', pixels: 'smooth', xhair: 'on', xcolor: '1,1,1,0.55',
                xgap: '0', x3d: true, orient: 'edges', cbar: false, cutDepth: 0, cutAz: 180, cutEl: 20, cutFace: 'tint', les2d: 'shiny'};
  V.disp = Object.assign({}, DDEF, store.get('img.disp', {}));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function viewerEl() {
    if (V.el) return V.el;
    const w = document.createElement('div'); w.className = 'nvwrap';
    w.innerHTML = `<style>
      .nvwrap{display:flex;gap:10px;align-items:stretch}
      .nvwrap .nvmain{flex:1;min-width:0}
      .nvwrap .nvbox{position:relative;background:#000;border-radius:6px;overflow:hidden}
      .nvwrap .nvbox canvas{width:100%;height:100%;display:block;outline:none}
      .nvwrap .nvside{width:250px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:4px}
      .nvwrap .nvles{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:4px;cursor:pointer;font-size:12px}
      .nvwrap .nvles:hover,.nvwrap .nvles.on{background:color-mix(in srgb,var(--ink) 10%,transparent)}
      .nvwrap .nvsw{width:11px;height:11px;border-radius:2px;flex:none}
      .nvwrap .nvles .v{margin-left:auto;color:var(--muted);white-space:nowrap}
      .nvwrap .nvbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;font-size:12px}
      .nvwrap .nvread{min-height:1.4em;margin-top:4px}
      .nvwrap .nvdisp{margin:0 0 6px;font-size:12px}
      .nvwrap .nvdisp summary{cursor:pointer;color:var(--muted)}
      .nvwrap .nvgrid{display:flex;flex-wrap:wrap;gap:6px 14px;padding:6px 2px}
      .nvwrap.nvfull{position:fixed;inset:0;z-index:9999;background:var(--bg);padding:10px 12px;overflow:auto}
      .nvwrap button.on{outline:1px solid var(--accent)}
    </style>
    <div class="nvmain"><div class="nvbar">
        <label>Scan <select data-r="scan"></select></label>
        <label>Outlines <input data-r="op" type="range" min="0" max="100" value="55" style="width:90px"></label>
        <button type="button" data-r="cut" class="on" title="Cut the 3D view open so the lesions inside show">3D: cut open</button>
        <button type="button" data-r="radio" title="Radiologist view: the patient's right is on the screen's left (as the hospitals show it). Click for neurologist view (patient's left on the left).">L/R: radiologist</button>
        <button type="button" data-r="nose" title="Side (sagittal) view: which way the face points">Side view: face left</button>
        <span title="Make the viewer taller or shorter (handy on big, high-resolution screens). Remembered in this browser.">Size <input data-r="size" type="range" min="300" max="2400" step="20" style="width:110px"> <span class="sub" data-r="sizel"></span></span>
        <button type="button" data-r="fit" title="Make the viewer as tall as the window">Fit height</button>
        <button type="button" data-r="full" title="Fill the whole window with the viewer (Esc to close)">⛶ Full window</button>
        <span class="sub" data-r="status"></span></div>
      <div class="nvbar">
        <span class="sub">3D zoom</span><button type="button" data-z3="-1" title="Zoom the 3D view out">−</button><button type="button" data-z3="1" title="Zoom the 3D view in">+</button>
        <span class="sub">Slice zoom</span><button type="button" data-z2="-1" title="Zoom the slice views out">−</button><button type="button" data-z2="1" title="Zoom the slice views in (around the crosshair)">+</button>
        <button type="button" data-r="zreset" title="Reset both zooms">Reset zoom</button>
        <span title="3D view only: 0 = solid, 100 = glass (only the edges of the head and brain stay visible, so the lesions show through)">3D see-through <button type="button" data-step="glass" data-d="-10" aria-label="3D more solid">−</button><input data-r="glass" type="range" min="0" max="100" value="0" style="width:60px"><button type="button" data-step="glass" data-d="10" aria-label="3D more see-through">+</button></span>
        <span class="sub" style="margin-left:6px">Contrast</span>
        <span title="Darkest: values at or below this show black">Low <button type="button" data-step="lo" data-d="-25" aria-label="Low down">−</button><input data-r="lo" type="range" min="0" max="1000" style="width:60px"><button type="button" data-step="lo" data-d="25" aria-label="Low up">+</button></span>
        <span title="Mid-tones: − = darker greys, + = brighter greys">Mid <button type="button" data-step="mid" data-d="-10" aria-label="Mid-tones darker">−</button><input data-r="mid" type="range" min="-100" max="100" value="0" style="width:60px"><button type="button" data-step="mid" data-d="10" aria-label="Mid-tones brighter">+</button></span>
        <span title="Brightest: values at or above this show white. Past 100% nothing reaches full white, so the whole image gets darker.">High <button type="button" data-step="hi" data-d="-25" aria-label="High down">−</button><input data-r="hi" type="range" min="0" max="2000" style="width:70px"><button type="button" data-step="hi" data-d="25" aria-label="High up">+</button><span class="sub" data-r="hipct"></span></span>
        <button type="button" data-r="cauto" title="Reset contrast to the scan's own range">Auto</button>
        <button type="button" data-r="clesion" title="Darker brain, enhancing lesions stand out">Lesions</button></div>
      <div class="nvbar" data-r="dosebar" title="ESTIMATED radiation dose from our model of the treatment records, not the hospitals' dose files">
        <span class="sub" style="color:#e0a020">Radiation dose (estimated)</span>
        <select data-r="dose"><option value="">off</option></select>
        <span title="How see-through the colour wash is">wash <input data-r="dop" type="range" min="0" max="100" value="35" style="width:70px"></span>
        <span title="3D view only: how solid the dose looks (low = see-through cloud; the 3D cut also slices through the dose while it's shown)">3D strength <input data-r="dblend" type="range" min="5" max="100" value="25" style="width:60px"></span>
        <label title="Isodose lines: the prescription dose and 12 Gy (combined: 100 and 60 Gy EQD2)"><input type="checkbox" data-r="dlines" checked> lines</label>
        <span class="sub" data-r="dlegend"></span></div>
      <div class="nvbar" data-r="views"></div>
      <details class="nvdisp" data-r="disp"><summary>Display options</summary><div class="nvgrid">
        <label>Layout <select data-o="layout">
          <option value="grid">Four views · grid</option><option value="row">Four views · row</option><option value="column">Four views · column</option>
          <option value="hero">Hero: big axial + small views</option><option value="axial">One view · axial</option><option value="coronal">One view · coronal</option>
          <option value="sagittal">One view · sagittal</option><option value="render">3D only</option><option value="lightbox">Light box (many slices)</option></select></label>
        <label>Light box plane <select data-o="lbPlane"><option value="A">axial</option><option value="C">coronal</option><option value="S">sagittal</option></select></label>
        <label>every <select data-o="lbStep"><option>3</option><option selected>5</option><option>8</option><option>10</option></select> mm</label>
        <label><input type="checkbox" data-o="lbPlus"> + coronal &amp; sagittal row</label>
        <label title="Shiny 3D = each lesion's 3D model drawn over the slices (shows every lesion, even ones not in this slice). Flat = the lesion's colour filled in on the slice.">Lesions on slices <select data-o="les2d"><option value="shiny">shiny 3D</option><option value="flat">flat colour</option></select></label>
        <label>Lesions <select data-o="outline"><option value="fill">filled</option><option value="outline">outline only</option></select></label>
        <label>Pixels <select data-o="pixels"><option value="smooth">smooth</option><option value="sharp">sharp (as scanned)</option></select></label>
        <label>Crosshair <select data-o="xhair"><option value="on">on</option><option value="off">off</option></select></label>
        <label>colour <select data-o="xcolor"><option value="1,1,1,0.55">white</option><option value="1,0.2,0.2,0.9">red</option><option value="0.2,1,0.3,0.9">green</option><option value="1,0.85,0.1,0.9">yellow</option></select></label>
        <label>centre gap <select data-o="xgap"><option value="0">none</option><option value="4">small</option><option value="10">large</option></select></label>
        <label><input type="checkbox" data-o="x3d" checked> crosshair in 3D</label>
        <label>Orientation letters <select data-o="orient"><option value="edges">on the edges</option><option value="corners">in the corners</option><option value="off">off</option></select></label>
        <label><input type="checkbox" data-o="cbar"> brightness scale bar</label>
        <label title="Slide right to push the cut through the head and out the far side (middle = cut through the centre)">3D cut depth <span class="sub">less</span> <input type="range" data-o="cutDepth" min="-170" max="170" value="0" style="width:110px;direction:rtl"> <span class="sub">more</span></label>
        <button type="button" data-r="cutflip" title="Cut from the opposite side of the head (turns the cut angle by 180°)">⇄ cut from other side</button>
        <label>angle <input type="range" data-o="cutAz" min="0" max="360" value="180" style="width:70px"></label>
        <label>tilt <input type="range" data-o="cutEl" min="-90" max="90" value="20" style="width:60px"></label>
        <label>cut face <select data-o="cutFace"><option value="tint">tinted</option><option value="clear">clear</option></select></label>
      </div></details>
      <div class="nvbox" data-r="box"><canvas data-r="cv"></canvas></div>
      <div class="sub nvread" data-r="read">Click or drag in a view to move the crosshair; scroll to change slice; right-drag to adjust brightness.</div></div>
    <div class="nvside" data-r="list"></div>`;
    const R = k => w.querySelector(`[data-r="${k}"]`);
    V.R = R; V.el = w;
    R('lo').value = 0; R('hi').value = 1000;
    SCANS.forEach(s => { const o = document.createElement('option'); o.value = s.date; o.textContent = fd(s.date) + ' · ' + (s.viewing ? 'viewing only' : s.lesions.length + ' lesions'); R('scan').appendChild(o); });
    R('scan').onchange = () => load(R('scan').value);
    R('op').oninput = () => { if (LV() && V.disp.outline !== 'outline') { V.nv.setOpacity(LI(), R('op').value / 100); } };
    R('cut').onclick = () => { V.cut = !V.cut; R('cut').classList.toggle('on', V.cut); applyCut(); };
    w.querySelectorAll('[data-z3]').forEach(b => b.onclick = () => zoom3(+b.dataset.z3));
    w.querySelectorAll('[data-z2]').forEach(b => b.onclick = () => zoom2(+b.dataset.z2));
    R('zreset').onclick = () => { if (!V.nv) return; V.nv.volScaleMultiplier = 1; const p = V.nv.scene.pan2Dxyzmm; V.nv.setPan2Dxyzmm([0, 0, 0, 1]); V.nv.drawScene(); };
    ['lo', 'hi', 'mid'].forEach(k => R(k).oninput = applyContrast);
    w.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const r = R(b.dataset.step);
      r.value = Math.max(+r.min, Math.min(+r.max, +r.value + +b.dataset.d)); b.dataset.step === 'glass' ? applyGlass() : applyContrast(); });
    R('glass').oninput = applyGlass;
    R('cauto').onclick = () => setContrast(0, 1000, 0);
    R('clesion').onclick = () => setContrast(150, 700, -25);
    w.querySelectorAll('[data-o]').forEach(c => { const k = c.dataset.o;
      if (c.type === 'checkbox') c.checked = !!V.disp[k]; else c.value = String(V.disp[k]);
      c.oninput = c.onchange = () => { V.disp[k] = c.type === 'checkbox' ? c.checked : (c.type === 'range' ? +c.value : c.value);
        store.set('img.disp', V.disp); applyDisplay(); }; });
    (DOSE ? DOSE.maps : []).forEach(m => { const o = document.createElement('option'); o.value = m.key; o.textContent = m.label; R('dose').appendChild(o); });
    if (!DOSE) R('dosebar').style.display = 'none';
    R('dose').value = V.dose.key; R('dop').value = V.dose.op; R('dlines').checked = V.dose.lines;
    R('dose').onchange = () => { V.dose.key = R('dose').value; saveDose(); applyDose(); };
    R('dop').oninput = () => { V.dose.op = +R('dop').value; saveDose(); const w = doseVol('wash'); if (w) { V.nv.setOpacity(V.nv.volumes.indexOf(w), V.dose.op / 100); } };
    R('dblend').value = V.dose.blend; R('dblend').oninput = () => { V.dose.blend = +R('dblend').value; saveDose(); applyDose3D(); };
    R('dlines').onchange = () => { V.dose.lines = R('dlines').checked; saveDose(); applyDose(); };
    R('cutflip').onclick = () => { V.disp.cutAz = (V.disp.cutAz + 180) % 360; w.querySelector('[data-o="cutAz"]').value = V.disp.cutAz;
      if (!V.cut) { V.cut = true; R('cut').classList.add('on'); } store.set('img.disp', V.disp); applyCut();
      if (V.nv) { const sc = V.nv.scene; V.nv.setRenderAzimuthElevation(((sc.renderAzimuth || 0) + 180) % 360, sc.renderElevation || 15); } };   // turn round to face the new cut
    // viewer size (like Pathology's Size slider): a fixed height in px, the window's height, or the whole window
    const toolbarH = () => R('box').getBoundingClientRect().top - w.getBoundingClientRect().top;
    R('size').oninput = () => { V.size = +R('size').value; store.set('img.size', V.size); sizeBox(IDV); };
    R('size').onkeydown = e => e.stopPropagation();
    R('sizel').ondblclick = () => { V.size = 0; store.set('img.size', 0); sizeBox(IDV); };
    R('sizel').title = 'Double-click to go back to the panel height';
    /* the pinned bar at the top of the page (time window, keyframes) covers part of the window: fit the images into
       the space below it and scroll them there (before, part of the viewer stayed hidden under that bar) */
    const pinH = () => { const p = document.querySelector('.navpin'); return p && getComputedStyle(p).position === 'sticky' ? p.getBoundingClientRect().height : 0; };
    R('fit').onclick = () => { const room = innerHeight - pinH() - 16, withBar = room - toolbarH();
      V.size = Math.max(300, Math.floor((withBar >= 420 ? withBar : room) / 20) * 20); store.set('img.size', V.size); sizeBox(IDV);
      requestAnimationFrame(() => { const top = (withBar >= 420 ? w : R('box')).getBoundingClientRect().top; scrollBy(0, top - pinH() - 8); }); };
    const setFull = on => { V.full = on; w.classList.toggle('nvfull', on); R('full').classList.toggle('on', on);
      R('full').textContent = on ? '✕ Close full window' : '⛶ Full window'; document.body.style.overflow = on ? 'hidden' : ''; sizeBox(IDV); };
    R('full').onclick = () => setFull(!V.full);
    addEventListener('keydown', e => { if (e.key === 'Escape' && V.full) setFull(false); });
    addEventListener('resize', () => { if (V.full) sizeBox(IDV); });
    R('radio').onclick = () => { V.radio = !V.radio; store.set('img.radio', V.radio); applyOrient(); };
    R('nose').onclick = () => { V.noseLeft = !V.noseLeft; store.set('img.noseLeft', V.noseLeft); applyOrient(); };

    return w;
  }
  /* ---- zoom ---- */
  function zoom3(d) { if (!V.nv) return; V.nv.volScaleMultiplier = Math.max(0.4, Math.min(6, (V.nv.volScaleMultiplier || 1) * (d > 0 ? 1.25 : 0.8))); V.nv.drawScene(); }
  const zoomOf2 = () => (V.nv.scene.pan2Dxyzmm || [0, 0, 0, 1])[3] || 1;
  function zoom2(d) { if (!V.nv) return; const z0 = zoomOf2(); let z = Math.max(1, Math.min(8, z0 * (d > 0 ? 1.4 : 1 / 1.4)));
    if (z < 1.01) z = 1;   // 1.4 × 1/1.4 is not exactly 1: snap back to the unzoomed view
    centre2(z); }
  /* keep the crosshair point at the centre of each slice view when zoomed in. Measured in NiiVue 0.69: a view's centre is
     (volume middle − pan) / zoom, so pan = volume middle − zoom × point (the old −point × (z−1)/z drifted off-centre). */
  function centre2(z) { if (!V.nv) return; if (z === 1) { V.nv.setPan2Dxyzmm([0, 0, 0, 1]); return; }
    const mm = V.nv.frac2mm(V.nv.scene.crosshairPos), c = V.nv.frac2mm([0.5, 0.5, 0.5]);
    V.nv.setPan2Dxyzmm([...[0, 1, 2].map(i => c[i] - z * mm[i]), z]); }
  /* ---- contrast: Low / High = black and white points within the scan's range; Mid = gamma ---- */
  function range() { const v = V.nv && V.nv.volumes[0]; if (!v) return [0, 1]; const lo = v.robust_min ?? v.global_min, hi = v.robust_max ?? v.global_max; return [lo, hi]; }
  function setContrast(lo, hi, mid) { V.R('lo').value = lo; V.R('hi').value = hi; V.R('mid').value = mid; applyContrast(); }
  function applyContrast() {
    if (!V.nv || !V.nv.volumes[0]) return;
    let lo = +V.R('lo').value, hi = +V.R('hi').value; if (hi <= lo + 5) { hi = Math.min(2000, lo + 5); V.R('hi').value = hi; }
    const [a, b] = range(), v = V.nv.volumes[0];
    v.cal_min = a + (b - a) * lo / 1000; v.cal_max = a + (b - a) * hi / 1000;
    V.nv.setGamma(Math.pow(2, (+V.R('mid').value) / 50));   // + = brighter mid-tones (direction reversed 2026-11-15 after testing)
    V.R('hipct').textContent = Math.round(hi / 10) + '%';
    V.nv.updateGLVolume();
  }
  /* ---- saved views (kept in this browser) ---- */
  const VKEY = 'img.views';
  /* the view the viewer opens with: the saved view picked as default (★), else the data file's default_view, else the first scan */
  const BUILTIN_VIEW = IMG_DATA.default_view || null;
  const defaultView = () => { const n = store.get('img.defaultView', null); return (n && views().find(v => v.name === n)) || BUILTIN_VIEW; };
  const views = () => store.get(VKEY, []);
  function snapshot(name) {
    const nv = V.nv, sc = nv.scene;
    return {name, date: V.scan.date, mm: Array.from(nv.frac2mm(sc.crosshairPos)).slice(0, 3), disp: Object.assign({}, V.disp),
      pan: Array.from(sc.pan2Dxyzmm || [0, 0, 0, 1]), az: sc.renderAzimuth, el: sc.renderElevation, z3: nv.volScaleMultiplier || 1,
      lo: +V.R('lo').value, hi: +V.R('hi').value, mid: +V.R('mid').value, op: +V.R('op').value, cut: V.cut,
      radio: V.radio, noseLeft: V.noseLeft, glass: +V.R('glass').value, dose: Object.assign({}, V.dose)};
  }
  async function recall(v) {
    if (!V.scan || V.scan.date !== v.date) await load(v.date);
    const nv = V.nv, NV = V.NV;
    V.disp = Object.assign({}, DDEF, v.disp || (v.single ? {layout: 'axial'} : {})); store.set('img.disp', V.disp);
    V.el.querySelectorAll('[data-o]').forEach(c => { const k = c.dataset.o; if (c.type === 'checkbox') c.checked = !!V.disp[k]; else c.value = String(V.disp[k]); });
    V.R('op').value = v.op; nv.setOpacity(LI(), v.op / 100);
    V.cut = v.cut; V.R('cut').classList.toggle('on', V.cut); applyDisplay();
    setContrast(v.lo, v.hi, v.mid);
    if (v.radio !== undefined) { V.radio = v.radio; V.noseLeft = v.noseLeft; applyOrient(); }
    if (v.glass !== undefined) { V.R('glass').value = v.glass; applyGlass(); }
    if (v.dose) { V.dose = Object.assign({}, v.dose); saveDose(); V.R('dose').value = V.dose.key; V.R('dop').value = V.dose.op; V.R('dlines').checked = V.dose.lines; V.R('dblend').value = V.dose.blend ?? 25; await applyDose(); }
    nv.scene.crosshairPos = nv.mm2frac(v.mm);
    nv.volScaleMultiplier = v.z3; nv.setRenderAzimuthElevation(v.az, v.el); nv.setPan2Dxyzmm(v.pan);
    const vals = []; vals[LI()] = {value: LV().getValue(...LV().mm2vox(v.mm))}; readout({values: vals, mm: v.mm});
  }
  function viewsBar() {   // inline name box: the app's built-in browser blocks prompt()/confirm()
    const box = V.R('views'); box.innerHTML = '';
    const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'name this view'; name.value = defaultName();
    name.style.cssText = 'width:150px'; name.setAttribute('aria-label', 'Name for the saved view');
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '★ Save view';
    add.title = 'Save the current scan, position, layout, zoom, 3D angle, contrast and outline settings under this name (also shown in Moments)';
    const save = () => { if (!V.nv || !V.scan) return; const nm = name.value.trim(); if (!nm) { name.focus(); return; }
      const list = views().filter(x => x.name !== nm); list.push(snapshot(nm)); store.set(VKEY, list); syncMoments(); viewsBar();
      V.R('status').textContent = 'Saved "' + nm + '"'; setTimeout(() => { if (V.R('status').textContent.startsWith('Saved')) V.R('status').textContent = ''; }, 2500); };
    add.onclick = save; name.onkeydown = e => { if (e.key === 'Enter') save(); };
    box.append(name, add);
    const lab = document.createElement('span'); lab.className = 'sub'; lab.textContent = views().length ? 'Saved:' : 'No saved views yet'; box.append(lab);
    views().forEach(v => {
      const chip = document.createElement('span'); chip.style.cssText = 'display:inline-flex;align-items:center;gap:2px';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = v.name;
      b.title = 'Recall: ' + fd(v.date) + ' · ' + ((v.disp && v.disp.layout) || (v.single ? 'axial' : 'grid'));
      b.onclick = () => recall(v);
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Delete this saved view (click twice)';
      x.onclick = () => { if (x.dataset.armed) { store.set(VKEY, views().filter(y => y.name !== v.name)); syncMoments(); viewsBar(); return; }
        x.dataset.armed = '1'; x.textContent = 'delete?'; setTimeout(() => { if (x.isConnected) { delete x.dataset.armed; x.textContent = '×'; } }, 3000); };
      const isDef = store.get('img.defaultView', null) === v.name;
      const st = document.createElement('button'); st.type = 'button'; st.textContent = isDef ? '★ default' : '☆';
      st.title = isDef ? 'The viewer opens with this view. Click to go back to the built-in default.' : 'Open the viewer with this view from now on';
      st.onclick = () => { store.set('img.defaultView', isDef ? null : v.name); viewsBar(); };
      chip.append(b, st, x); box.append(chip);
    });
  }
  /* saved views also appear as moments (group "Saved MRI views") on the scan date; generated, not written to the edits file */
  const MGROUP = 'Saved MRI views';
  function syncMoments() {
    if (typeof E === 'undefined') return;
    E.moments = (E.moments || []).filter(m => !m.imgView);
    views().forEach(v => E.moments.push({id: 'imgview-' + v.name.replace(/[^A-Za-z0-9]+/g, '-'), title: 'MRI view: ' + v.name, group: MGROUP,
      date: v.date, time: '', end: '', note: 'Saved slice-viewer view. Click to open it.', color: 'purple', kind: 'test', line: true, on: true, links: [], imgView: v.name}));
    list(); render();
  }
  const _openMoment = openMoment;
  openMoment = function (m, pre) {   // clicking a saved-view moment opens the view instead of the moment editor
    if (m && m.imgView) { const v = views().find(x => x.name === m.imgView); if (v) { openViewer(v.date); setTimeout(() => recall(v), 600); return; } }
    return _openMoment.apply(this, arguments);
  };
  function defaultName() { const on = V.R('list').querySelector('.nvles.on');
    return (on ? on.dataset.id + ' ' : '') + (V.scan ? V.scan.date : ''); }
  /* ---- orientation: radiologist (patient right on screen left) or neurologist; sagittal face direction ---- */
  function applyOrient() {
    V.R('radio').textContent = 'L/R: ' + (V.radio ? 'radiologist' : 'neurologist');
    V.R('radio').classList.toggle('on', V.radio);
    V.R('nose').textContent = 'Side view: face ' + (V.noseLeft ? 'left' : 'right');
    if (!V.nv) return;
    V.nv.setRadiologicalConvention(V.radio);
    V.nv.opts.sagittalNoseLeft = V.noseLeft;
    V.nv.drawScene();
  }
  /* ---- 3D see-through: gradient opacity + silhouette (3D render only; slices unchanged) ---- */
  async function applyGlass() {   // needs 3D lighting on: without it the render goes blank (seen 2026-11-15)
    if (!V.nv) return; const g = +V.R('glass').value / 100;
    if (g > 0) { await V.nv.setVolumeRenderIllumination(0.5); await V.nv.setGradientOpacity(g, g); }
    else { await V.nv.setGradientOpacity(0, 0); await V.nv.setVolumeRenderIllumination(0); }
    V.nv.drawScene();
  }
  function applyCut() { if (!V.nv) return; const d = V.disp;
    V.nv.setClipPlane(V.cut ? [d.cutDepth / 100, d.cutAz, d.cutEl] : [2, 0, 0]);
    V.nv.setClipPlaneColor(d.cutFace === 'clear' ? [0, 0, 0, 0] : [0.7, 0, 0.7, 0.5]); }
  /* mm range of the scan along an axis (0 = x/R-L, 1 = y/A-P, 2 = z/S-I), trimmed to the useful part */
  function mmRange(axis, f0, f1) { const a = [0.5, 0.5, 0.5], b = [0.5, 0.5, 0.5]; a[axis] = f0; b[axis] = f1;
    const p = V.nv.frac2mm(a)[axis], q = V.nv.frac2mm(b)[axis]; return [Math.min(p, q), Math.max(p, q)]; }
  function lightboxString() {
    const d = V.disp, ax = {A: 2, C: 1, S: 0}[d.lbPlane], step = +d.lbStep;
    const [lo, hi] = ax === 2 ? mmRange(2, 0.22, 0.97) : mmRange(ax, 0.12, 0.88);
    const vals = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) vals.push(Math.round(v));
    const per = Math.max(4, Math.ceil(Math.sqrt(vals.length * 1.6)));   // about 1.6x wider than tall
    const rows = []; for (let i = 0; i < vals.length; i += per) rows.push(d.lbPlane + ' ' + vals.slice(i, i + per).join(' '));
    if (d.lbPlus) { const c = V.nv.frac2mm(V.nv.scene.crosshairPos); rows.push('C ' + Math.round(c[1]) + ' S ' + Math.round(c[0])); }
    return 'L ' + rows.join(' ; ');
  }
  function applyDisplay() {
    if (!V.nv) return; const nv = V.nv, NV = V.NV, d = V.disp, ST = NV.SLICE_TYPE;
    // layout
    nv.setSliceMosaicString(''); nv.setHeroImage(0);
    if (['grid', 'row', 'column', 'hero'].includes(d.layout)) {
      nv.setSliceType(ST.MULTIPLANAR);
      nv.setMultiplanarLayout({grid: NV.MULTIPLANAR_TYPE.GRID, row: NV.MULTIPLANAR_TYPE.ROW, column: NV.MULTIPLANAR_TYPE.COLUMN, hero: NV.MULTIPLANAR_TYPE.ROW}[d.layout]);
      if (d.layout === 'hero') { nv.opts.heroSliceType = ST.AXIAL; nv.setHeroImage(0.6); }
    } else if (d.layout === 'lightbox') { nv.setSliceType(ST.AXIAL); nv.setSliceMosaicString(lightboxString()); }
    else nv.setSliceType({axial: ST.AXIAL, coronal: ST.CORONAL, sagittal: ST.SAGITTAL, render: ST.RENDER}[d.layout]);
    // lesions filled or outlined, pixels, crosshair, labels
    // outline only = NiiVue's label outline with the fill made fully transparent (outline needs the label intent, set at load)
    nv.setAtlasOutline(d.outline === 'outline' ? 1 : 0);
    nv.setOpacity(LI(), d.outline === 'outline' ? 0 : V.R('op').value / 100);
    nv.setMeshThicknessOn2D(d.les2d === 'shiny' ? Infinity : 0);   // shiny = the lesions' 3D models drawn over the slices
    V.R('op').disabled = d.outline === 'outline'; V.R('op').title = d.outline === 'outline' ? 'Fill opacity (off while showing outlines only)' : 'Fill opacity';
    nv.setInterpolation(d.pixels === 'sharp');
    nv.setCrosshairWidth(d.xhair === 'on' ? 1 : 0);
    nv.setCrosshairColor(d.xcolor.split(',').map(Number));
    nv.opts.crosshairGap = +d.xgap; nv.opts.show3Dcrosshair = !!d.x3d;
    nv.setIsOrientationTextVisible(d.orient !== 'off'); nv.setCornerOrientationText(d.orient === 'corners');
    nv.opts.isColorbar = !!d.cbar; if (LV()) LV().colorbarVisible = false;
    applyCut(); nv.updateGLVolume(); nv.drawScene();
    V.el.querySelectorAll('[data-o^="lb"]').forEach(c => c.closest('label').style.opacity = d.layout === 'lightbox' ? 1 : 0.45);
  }
  /* ---- radiation dose overlay (ESTIMATED, imaging/radiation_dose): colour wash + isodose lines; volumes after t1c and lesions ---- */
  const LV = () => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('lesions_'));   // the lesion label layer (its position changes when dose layers are added)
  const LI = () => V.nv.volumes.indexOf(LV());
  function saveDose() { store.set('img.dose', V.dose); }
  const doseVol = kind => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('dose' + kind + '_'));
  /* 3D: overlays are drawn solid by default, so the dose hid the head (seen 2026-11-15). While a dose is shown: see-through overlays
     (renderOverlayBlend) and the cut plane also cuts the overlays (isClipAllVolumes); back to normal when dose is off. */
  // the dose map is on the baseline grid: it fits every scan shown aligned onto that grid (not a scan without lesions)
  const doseOK = () => !!(V.scan && V.scan.aligned && V.scan.lesions.length);
  function applyDose3D() { if (!V.nv) return; const on = !!(DOSE && V.dose.key && doseOK());
    V.nv.opts.renderOverlayBlend = on ? V.dose.blend / 100 : 1; V.nv.opts.isClipAllVolumes = on; V.nv.updateGLVolume(); V.nv.drawScene(); }
  async function applyDose() {
    if (!V.nv || !DOSE) return; const nv = V.nv;
    const tok = V.doseTok = (V.doseTok || 0) + 1;   // a newer call (or a scan change) makes this one stop; files arriving late are removed
    const mine = [];   // the layers this call added
    const stale = () => { if (tok === V.doseTok && doseOK()) return false; mine.forEach(v => { if (nv.volumes.includes(v)) nv.removeVolume(v); }); nv.drawScene(); return true; };
    for (const v of nv.volumes.filter(v => v.name && v.name.startsWith('dose'))) nv.removeVolume(v);
    const m = DOSE.maps.find(x => x.key === V.dose.key);
    V.R('dlegend').innerHTML = '';
    if (!m || !doseOK()) { if (m) V.R('dlegend').textContent = V.scan && V.scan.aligned ? 'no dose shown on a scan without lesions' : 'dose is on the aligned scans only'; applyDose3D(); return; }
    const tot = !!m.total, [lo, hi] = m.range || [5, 40];   // stored in 0.1 Gy steps
    mine.push(await nv.addVolumeFromUrl({url: m.file, name: 'dosewash_' + m.key + '.nii.gz', colormap: tot ? 'inferno' : 'jet', opacity: V.dose.op / 100, cal_min: lo * 10, cal_max: hi * 10}));
    if (stale()) return;
    if (V.dose.lines) {
      mine.push(await nv.addVolumeFromUrl({url: m.iso, name: 'doselines_' + m.key + '.nii.gz', opacity: 1}));
      if (stale()) return;
      const v = doseVol('lines'); v.setColormapLabel({R: [0, 255, 255], G: [0, 230, 255], B: [0, 60, 255], A: [0, 255, 255], I: [0, 1, 2], labels: ['', m.levels[0] + ' ' + m.unit, m.levels[1] + ' ' + m.unit]});
    }
    nv.moveVolumeToTop(LV());   // lesions drawn above the dose so the dose wash doesn't dull their colours
    applyDose3D();
    V.R('dlegend').innerHTML = `colour ${lo}→${hi} ${m.unit} (blue→red${tot ? ', dark→bright' : ''})` + (V.dose.lines ? ` · lines: <b style="color:#fff">${m.levels[1]}</b> and <b style="color:#ffe63c">${m.levels[0]}</b> ${m.unit}` : '') +
      ` · <span title="${esc(DOSE.notes[m.key] || (m.key === 'total_gy' ? 'Each course added in plain Gy, not adjusted for dose per session.': 'Each course added as EQD2 (alpha/beta 2, normal brain)'))}">how estimated ⓘ</span>`;
  }
  function doseAt(mm) { const w = doseVol('wash'); if (!w || !mm) return '';
    const m = DOSE.maps.find(x => x.key === V.dose.key); const v = w.getValue(...w.mm2vox(mm)); return ` · dose here ≈ ${(v / 10).toFixed(1)} ${m.unit} (estimated)`; }
  function sizeBox(id) { if (!V.el) return; const box = V.R('box');
    const h = V.full ? Math.max(300, innerHeight - (box.getBoundingClientRect().top - V.el.getBoundingClientRect().top) - 50) : (V.size || hOf(id, PANELS[id].h0));
    box.style.height = h + 'px'; V.R('list').style.maxHeight = (h + 30) + 'px';
    V.R('size').value = h; V.R('sizel').textContent = V.full ? 'full window' : V.size ? h + ' px' : 'panel height';
    if (V.nv) requestAnimationFrame(() => V.nv.resizeListener()); }
  async function lib() { if (!V.NV) { V.R('status').textContent = 'loading NiiVue…'; V.NV = await import(NIIVUE); } return V.NV; }
  async function load(date) {
    const scan = SCANS.find(s => s.date === date) || SCANS[0]; if (!scan) return;
    if (V.scan === scan && V.nv) return;
    V.scan = scan; V.R('scan').value = scan.date;
    /* one load at a time: NiiVue's loads overlap badly (an older scan finishing last replaced the newer one).
       Each pick waits for the load before it; picks that were overtaken while waiting are skipped. */
    const tok = V.loadTok = (V.loadTok || 0) + 1;
    V.queue = (V.queue || Promise.resolve()).catch(() => {}).then(() => tok === V.loadTok ? loadNow(scan) : null);
    return V.queue;
  }
  async function loadNow(scan) {
    const NV = await lib();
    if (!V.nv) {
      V.nv = new NV.Niivue({backColor: [0, 0, 0, 1], show3Dcrosshair: true, multiplanarShowRender: NV.SHOW_RENDER.ALWAYS,
        crosshairColor: [1, 1, 1, 0.55], dragAndDropEnabled: false, isColorbar: false, loadingText: 'loading scan…'});
      await V.nv.attachToCanvas(V.R('cv'));
      V.nv.onLocationChange = d => readout(d);
    }
    V.R('status').textContent = 'loading scan…';
    V.doseTok = (V.doseTok || 0) + 1;   // cancel any dose still loading for the previous scan
    await V.nv.loadVolumes([{url: scan.t1c, name: 't1c_' + scan.date + '.nii.gz'}, {url: scan.labels, name: 'lesions_' + scan.date + '.nii.gz', opacity: V.R('op').value / 100}]);   // NiiVue reads the file type from the name
    const L = scan.lesions, max = Math.max(...L.map(l => l.n));
    const cm = {R: [0], G: [0], B: [0], A: [0], I: [0], labels: ['']};
    for (let n = 1; n <= max; n++) { const l = L.find(x => x.n === n);
      cm.R.push(l ? l.rgb[0] : 0); cm.G.push(l ? l.rgb[1] : 0); cm.B.push(l ? l.rgb[2] : 0); cm.A.push(l ? 255 : 0); cm.I.push(n);
      cm.labels.push(l ? l.id + ' ' + l.name : ''); }
    LV().hdr.intent_code = 1002;   // NIfTI 'label' intent: NiiVue draws outlines only for label volumes
    LV().setColormapLabel(cm); V.nv.updateGLVolume();
    // lesions also as 3D surface models: they stay visible in the cut-open space even while the dose overlay is cut and see-through
    await V.nv.loadMeshes(L.filter(l => l.mesh).map(l => ({url: l.mesh, name: l.id + '.obj', rgba255: [...l.rgb, 255]})));
    V.nv.setMeshThicknessOn2D(V.disp.les2d === 'shiny' ? Infinity : 0);
    applyDisplay(); V.nv.setRenderAzimuthElevation(110, 15);
    lesionList(scan); V.R('status').textContent = '';
    applyContrast(); applyOrient(); applyGlass(); viewsBar(); await applyDose();
    const big = L.slice().sort((a, b) => b.enh - a.enh)[0]; if (big) jump(big);
  }
  const volOf = l => (typeof L !== 'undefined' && L.rule === 'old' && l.enh_old != null) ? l.enh_old : l.enh;   // outline rule switch
  function lesionList(scan) {   // (not 'list': that name is the viewer's own Library function)
    const box = V.R('list'); const tot = scan.lesions.reduce((a, l) => a + volOf(l), 0);
    if (!scan.lesions.length) { box.innerHTML = `<div class="sub" style="padding:3px 5px">${fd(scan.date)}${scan.field ? ' · ' + scan.field + ' scanner' : ''} · ${esc(scan.note || 'no lesions outlined')}</div>`; return; }
    const fld = scan.field ? (scan.field === '3T' ? ` · <b style="color:#e0a020" title="3T shows enhancement more strongly than 1.5T; our edge rule corrects most of it, small lesions can still differ">3T scanner ▲</b>` : ' · 1.5T scanner ◆') : '';
    box.innerHTML = `<div class="sub" style="padding:3px 5px">${fd(scan.date)} · ${scan.lesions.length} lesions · ${(tot / 1000).toFixed(1)} cm³ enhancing (our outlines${typeof L !== 'undefined' && L.rule === 'old' ? ', old 1.45× rule' : ''})${fld}</div>` +
      scan.lesions.map(l => `<div class="nvles" data-id="${l.id}" title="${esc(l.name)} · ${volOf(l).toLocaleString()} mm³ · longest axial ${l.axial} mm. Click to go there.">
        <span class="nvsw" style="background:rgb(${l.rgb})"></span><b>${l.id}</b><span>${esc(l.name)}</span><span class="v">${(volOf(l) / 1000).toFixed(2)} cm³</span></div>`).join('');
    box.querySelectorAll('.nvles').forEach(e => e.onclick = () => jump(scan.lesions.find(l => l.id === e.dataset.id)));
  }
  function jump(l) {
    if (!V.nv || !l) return;
    V.nv.scene.crosshairPos = V.nv.mm2frac(l.ras);
    if (zoomOf2() > 1) centre2(zoomOf2());   // zoomed in: bring the lesion to the middle, or it can be off-screen
    V.nv.drawScene();
    V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', e.dataset.id === l.id));
    V.R('read').innerHTML = `<b style="color:rgb(${l.rgb})">${l.id}</b> ${esc(l.name)} · ${volOf(l).toLocaleString()} mm³ enhancing · longest axial ${l.axial} mm`;
  }
  function readout(d) {
    const li = V.nv ? LI() : 1, v = d && d.values && d.values[li] ? Math.round(d.values[li].value) : 0;
    const l = V.scan && V.scan.lesions.find(x => x.n === v);
    V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', !!l && e.dataset.id === l.id));
    const mm = d && d.mm ? ' · position ' + d.mm.slice(0, 3).map(x => x.toFixed(0)).join(', ') + ' mm' : '';
    V.R('read').innerHTML = (l ? `<b style="color:rgb(${l.rgb})">${l.id}</b> ${esc(l.name)} · ${volOf(l).toLocaleString()} mm³ enhancing${mm}`
                             : `No lesion outline here${mm}`) + (d && d.mm ? doseAt(d.mm) : '');
  }
  function openViewer(date) {
    if (!sel.includes(IDV)) setLabSel([IDV], true);
    setTimeout(() => { load(date); const w = document.querySelector(`.cmp[data-id="${IDV}"]`); if (w) w.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 50);
  }
  function drawViewer(id, body) {
    const w = viewerEl(); body.innerHTML = ''; body.appendChild(w); sizeBox(id);
    if (!SCANS.length) { V.R('status').textContent = 'No measured scans yet.'; return; }
    if (!V.loading) V.loading = (V.scan ? load(V.scan.date) : (defaultView() ? load(defaultView().date).then(() => recall(defaultView())) : load(SCANS[0].date))).catch(err => { V.R('status').textContent = 'Could not load: ' + err; V.loading = null; });
  }

  /* ================= Lesions over time (Timeline · Lines · Grid) ================= */
  const L = {view: store.get('img.lesView2', 'volume'), hidden: new Set(store.get('img.lesHidden', [])),
             showTx: store.get('img.lesTx', true), showMeas: store.get('img.lesMeas', true), field: store.get('img.lesField', 'all'), rule: store.get('img.lesRule', 'new'),
             doseNum: store.get('img.lesDoseNum', true), doseStrip: store.get('img.lesDoseStrip', true)};
  /* ---- radiation dose per lesion (ESTIMATED): unit switch shared by Lesions over time and Radiation dose by lesion ---- */
  const DU = {get: () => store.get('img.doseUnit', 'gy'), set: u => store.set('img.doseUnit', u)};
  const DROWS = DOSE ? DOSE.rows : [];
  // radiation courses come from the data file: {key: {label, kind: 'whole' | 'focal'}}, in time order
  const COURSES = (DOSE && DOSE.course_info) || {};
  const CLAB = Object.fromEntries(Object.entries(COURSES).map(([k, c]) => [k, c.label]));
  const FOCAL_COLORS = ['#7b68ee', '#e05cc0', '#3fb6c6', '#e07b39', '#8fbf3f'];
  const CCOL = (() => { let n = 0; return Object.fromEntries(Object.entries(COURSES).map(([k, c]) => [k, c.kind === 'whole' ? '#d9a21b' : FOCAL_COLORS[n++ % FOCAL_COLORS.length]])); })();
  const isWhole = k => (COURSES[k] || {}).kind === 'whole';
  const dval = r => DU.get() === 'eqd2' ? r.eqd2_tumor : r.gy;
  const drun = r => DU.get() === 'eqd2' ? r.eqd2_tumor_running : r.gy_running;
  const dunit = () => DU.get() === 'eqd2' ? 'Gy EQD2' : 'Gy';
  const doseRows = lid => DROWS.filter(r => r.lesion === lid);
  const runAt = (lid, d) => { let v = 0; doseRows(lid).forEach(r => { if (r.end <= d) v = drun(r); }); return v; };
  function heat(v) {   // 0 → pale yellow, high → deep red (scale top: 150 EQD2 / 100 Gy)
    const f = Math.max(0, Math.min(1, v / (DU.get() === 'eqd2' ? 150 : 100))), S = [[255, 237, 160], [254, 178, 76], [240, 59, 32], [128, 0, 38]];
    const i = Math.min(2, Math.floor(f * 3)), g = f * 3 - i, a = S[i], b = S[i + 1];
    return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * g))})`; }
  function unitButtons(onChange) {
    const s = document.createElement('span'); s.title = 'EQD2 = dose converted to the same 2 Gy-per-session scale (tumour alpha/beta 10), so courses with different doses per session courses can be added. Gy = dose as prescribed.';
    [['gy', 'Gy'], ['eqd2', 'EQD2']].forEach(([u, lab]) => s.append(lbtn(lab, '', DU.get() === u, () => { DU.set(u); onChange(); })));
    return s; }
  const LCOL = Object.fromEntries(LS.lesions.map(l => [l.id, 'rgb(' + l.rgb + ')']));
  const LNAME = Object.fromEntries(LS.lesions.map(l => [l.id, l.name]));
  const TREND = {up: {c: '#e34948', t: 'grew'}, down: {c: '#1baf7a', t: 'shrank'}, stable: {c: '#8a8984', t: 'stable'},
                 mixed: {c: '#eda100', t: 'mixed'}, new: {c: '#e34948', t: 'new'}, '': {c: 'transparent', t: ''}};
  const shownL = () => LS.lesions.filter(l => !L.hidden.has(l.id));
  const txFor = id => LS.treatments.filter(t => t.lesions.includes(id));
  const sizeR = mm => mm == null ? 3.5 : mm === 0 ? 3 : Math.max(3.5, Math.min(13, 2.5 + Math.sqrt(mm) * 2.4));
  const lbtn = (label, title, on, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; if (on) b.className = 'on'; b.onclick = fn; return b; };

  /* treatments drawn on the chart: WBRT as a full-height band, SRS as a bar on each targeted lesion's row */
  function txPlugin(rowOf) {   // WBRT band behind; SRS drawn on top as outlined bars (min 6 px, or they vanish at wide zoom)
    const geom = (c, t) => { const {x} = c.scales; let x0 = x.getPixelForValue(pos(ms(t.start))), x1 = x.getPixelForValue(pos(ms(t.end)));
      if (x1 - x0 < 6) { const m = (x0 + x1) / 2; x0 = m - 3; x1 = m + 3; } return [x0, x1]; };
    const clip = (ctx, a) => { ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); };
    return {id: 'lesTx',
      beforeDatasetsDraw(c) { if (!L.showTx) return; const {ctx, chartArea: a} = c; clip(ctx, a);
        LS.treatments.filter(t => /whole-brain/i.test(t.treatment) || !rowOf).forEach(t => { const [x0, x1] = geom(c, t);
          const wb = /whole-brain/i.test(t.treatment);
          ctx.fillStyle = wb ? 'rgba(237,161,0,0.22)' : 'rgba(98,80,214,0.16)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
          ctx.fillStyle = wb ? '#c98a00' : '#6250d6'; ctx.font = 'bold 10px system-ui'; ctx.fillText(wb ? 'WBRT' : 'SRS', x0 + 2, a.top + 10); });
        ctx.restore(); },
      afterDatasetsDraw(c) { if (!L.showTx || !rowOf) return; const {ctx, chartArea: a, scales: {y}} = c; clip(ctx, a);
        LS.treatments.filter(t => !/whole-brain/i.test(t.treatment)).forEach(t => { const [x0, x1] = geom(c, t);
          t.lesions.forEach(id => { const r = rowOf(id); if (r == null) return; const yc = y.getPixelForValue(r);
            ctx.fillStyle = 'rgba(98,80,214,0.25)'; ctx.fillRect(x0, yc - 8, x1 - x0, 16);
            ctx.strokeStyle = '#8b7bff'; ctx.lineWidth = 1.5; ctx.setLineDash(t.confidence === 'low' ? [3, 2] : []); ctx.strokeRect(x0, yc - 8, x1 - x0, 16); }); });
        ctx.setLineDash([]); ctx.restore(); }};
  }

  /* dose on the timeline: Gy on each SRS box (A), a dose-so-far strip under each row (B), total column at the right (A) */
  function dosePlugin(rowOf) {
    return {id: 'lesDose',
      beforeDatasetsDraw(c) { if (!DOSE || !L.doseStrip) return; const {ctx, chartArea: a, scales: {x, y}} = c; ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
        LS.lesions.forEach(l => { const r = rowOf(l.id); if (r == null) return; const yc = y.getPixelForValue(r), rows = doseRows(l.id); if (!rows.length) return;
          rows.forEach((d, i) => { const x0 = x.getPixelForValue(pos(ms(d.end))), nx = rows[i + 1] ? x.getPixelForValue(pos(ms(rows[i + 1].end))) : a.right;
            ctx.fillStyle = heat(drun(d)); ctx.globalAlpha = 0.85; ctx.fillRect(x0, yc + 9, Math.max(0, nx - x0), 4); }); });
        ctx.restore(); },
      afterDatasetsDraw(c) { if (!DOSE || !L.doseNum) return; const {ctx, chartArea: a, scales: {x, y}} = c; ctx.save(); ctx.font = 'bold 10px system-ui'; ctx.textBaseline = 'middle';
        LS.lesions.forEach(l => { const r = rowOf(l.id); if (r == null) return; const yc = y.getPixelForValue(r), rows = doseRows(l.id);
          rows.filter(d => d.targeted && !isWhole(d.course)).forEach(d => { const px = x.getPixelForValue(pos(ms(d.end)));
            if (px < a.left || px > a.right - 56) return; ctx.fillStyle = CCOL[d.course]; ctx.fillText(Math.round(dval(d)), px + 6, yc - 1); });
          if (rows.length) { const tot = drun(rows[rows.length - 1]), t = String(Math.round(tot)), w = ctx.measureText(t).width;   // total: just inside the right edge
            ctx.fillStyle = css('--card'); ctx.globalAlpha = .85; ctx.fillRect(a.right - w - 8, yc - 7, w + 6, 14); ctx.globalAlpha = 1;
            ctx.textAlign = 'right'; ctx.fillStyle = heat(tot); ctx.fillText(t, a.right - 4, yc); ctx.textAlign = 'start'; } });
        ctx.fillStyle = css('--muted'); ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText('total', a.right - 4, a.top - 1); ctx.textAlign = 'start';
        ctx.restore(); }};
  }

  /* scanner strength: 3T shows enhancement more strongly than 1.5T, so our volumes from 3T scans read larger.
     Our measurements: ◆ = 1.5T, ▲ = 3T; the Scanner switch shows one strength only; Lines draws a jump between strengths dotted. */
  const is3T = m => m && m.field === '3T';
  /* outline rule switch: new = edge 1/3 of the way to each lesion's own peak (default since 2026-11-16, corrects most of the
     1.5T/3T difference); old = edge at 1.45 x median brain. Both sets are in the data so the difference can be shown. */
  const OLD = () => L.rule === 'old' && LS.measured_old && LS.measured_old.length;
  /* Lines height: fixed from EVERY size of the shown lesions (reports, our measurements on 1.5T and 3T, new and old rule),
     so the scanner and outline-rule switches only hide or change points and the axis never jumps (user's request 2026-11-16) */
  function linesMax(S) {
    const ids = new Set(S.map(l => l.id)), vals = [];
    LS.reports.forEach(r => { if (ids.has(r.lesion) && r.mm != null) vals.push(r.mm); });
    [LS.measured, LS.measured_old || []].forEach(arr => arr.forEach(m => { if (ids.has(m.lesion) && !m.none) vals.push(m.axial_mm); }));
    const top = Math.max(10, ...vals) * 1.08;
    return Math.ceil(top / 5) * 5;
  }
  const MEAS = () => OLD() ? LS.measured_old : LS.measured;
  const measShape = m => is3T(m) ? 'triangle' : 'rectRot';
  const fieldOf = raw => raw ? (raw.meas ? raw.meas.field : raw.r ? raw.r.field : '') : '';
  const fieldOK = m => L.field === 'all' || m.field === L.field;
  /* the view buttons shared by every view of this panel (saved as img.lesView2: volume trends became the first view, 2026-11-17) */
  const LES_VIEWS = [['volume', 'Volume trends', 'Our measured volume of each lesion over time, with fitted trends and doubling times'],
    ['periods', 'Doubling times', 'Doubling or halving time of each lesion in each treatment period'],
    ['timeline', 'Timeline', 'One row per lesion; dots = what each report said'], ['lines', 'Report sizes (mm)', 'Size in mm over time as the reports gave it, one line per lesion'],
    ['grid', 'Grid', 'Lesions x scan dates, with the reported size in each cell']];
  function lesViewBtns(id, body) {
    const bar = document.createElement('div'); bar.className = 'nvbar'; bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px';
    LES_VIEWS.filter(([v]) => window.LesionTrends || (v !== 'volume' && v !== 'periods')).forEach(([v, lab, tip]) =>
      bar.append(lbtn(lab, tip, L.view === v, () => { L.view = v; store.set('img.lesView2', v); drawLesions(id, body); })));
    return bar;
  }
  function lesToolbar(body, id) {
    const bar = document.createElement('div'); bar.className = 'nvbar'; bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px';
    bar.append(...lesViewBtns(id, body).childNodes);
    const chk = (label, key, prop) => { const lab = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = L[prop];
      cb.onchange = () => { L[prop] = cb.checked; store.set(key, cb.checked); drawLesions(id, body); }; lab.append(cb, ' ' + label); bar.append(lab); };
    chk('treatments', 'img.lesTx', 'showTx'); chk('our measurements', 'img.lesMeas', 'showMeas');
    const fs = document.createElement('span'); fs.title = 'Our measurements by scanner strength. 3T shows enhancing tumour more strongly than 1.5T; our edge rule corrects most of it, but small lesions can still differ.';
    fs.append(Object.assign(document.createElement('span'), {className: 'sub', textContent: '· scanner:'}));
    [['all', 'all'], ['1.5T', '1.5T ◆'], ['3T', '3T ▲']].forEach(([v, lab]) => fs.append(lbtn(lab, '', L.field === v, () => { L.field = v; store.set('img.lesField', v); drawLesions(id, body); })));
    bar.append(fs);
    if (LS.measured_old && LS.measured_old.length) {
      const rs = document.createElement('span');
      rs.title = 'How our outlines are drawn. New (default): the edge sits a third of the way from the brain around a lesion to its own brightest point, which follows each scan\'s contrast and corrects most of the 1.5T/3T difference. Old: the edge sits at 1.45 x the brain\'s brightness on every scan, so 3T scans read larger. Switch to show the difference.';
      rs.append(Object.assign(document.createElement('span'), {className: 'sub', textContent: '· outlines:'}));
      [['new', 'new ⅓ rule'], ['old', 'old 1.45×']].forEach(([v, lab]) => rs.append(lbtn(lab, '', L.rule === v, () => { L.rule = v; store.set('img.lesRule', v); drawLesions(id, body); if (V.scan) lesionList(V.scan); })));
      bar.append(rs);
    }
    if (DOSE) { const sp = document.createElement('span'); sp.className = 'sub'; sp.style.color = '#e0a020'; sp.textContent = '· dose (estimated):'; bar.append(sp);
      chk('numbers', 'img.lesDoseNum', 'doseNum'); chk('strip', 'img.lesDoseStrip', 'doseStrip'); bar.append(unitButtons(() => drawLesions(id, body))); }
    // lesion chips: click to hide/show
    const chips = document.createElement('div'); chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px';
    LS.lesions.forEach(l => { const c = document.createElement('button'); c.type = 'button'; c.title = l.name + ' (click to hide/show)';
      c.style.cssText = `font-size:11px;padding:1px 6px;border-radius:10px;border:1px solid ${LCOL[l.id]};background:${L.hidden.has(l.id) ? 'transparent' : LCOL[l.id] + ''};color:${L.hidden.has(l.id) ? 'var(--muted)' : '#000'};opacity:${L.hidden.has(l.id) ? 0.6 : 1}`;
      c.textContent = l.id; c.onclick = () => { L.hidden.has(l.id) ? L.hidden.delete(l.id) : L.hidden.add(l.id); store.set('img.lesHidden', [...L.hidden]); drawLesions(id, body); };
      chips.append(c); });
    const all = lbtn('All', 'Show every lesion', false, () => { L.hidden.clear(); store.set('img.lesHidden', []); drawLesions(id, body); });
    const LY = LS.reports.reduce((m, r) => r.date > m ? r.date : m, '').slice(0, 4);   // latest report year
    const act = lbtn('Active ' + LY, 'Only lesions mentioned in ' + LY + ' reports', false, () => {
      const on = new Set(LS.reports.filter(r => r.date >= LY).map(r => r.lesion)); L.hidden = new Set(LS.lesions.map(l => l.id).filter(x => !on.has(x)));
      store.set('img.lesHidden', [...L.hidden]); drawLesions(id, body); });
    chips.append(all, act);
    body.append(bar, chips);
    // mixed-scanner warning: hard to miss on purpose (the user asked to be made to notice it, 2026-11-16)
    if (L.showMeas) {
      const vis = MEAS().filter(m => !m.none && !L.hidden.has(m.lesion));
      const n3 = vis.filter(is3T).length, n15 = vis.filter(m => m.field === '1.5T').length;
      const warn = document.createElement('div');
      if (L.field === 'all' && n3 && n15) {
        warn.style.cssText = 'margin:2px 0 8px;padding:6px 10px;border:2px solid #e0a020;border-radius:6px;background:color-mix(in srgb,#e0a020 14%,transparent);font-size:12px';
        warn.innerHTML = `<b style="color:#e0a020">⚠ Mixed scanners.</b> ${n3} of our measurements are from <b>3T ▲</b> scanners and ${n15} from <b>1.5T ◆</b>. ` +
          (OLD() ? `3T shows tumour enhancement more strongly, and the <b>old 1.45× rule</b> does not correct for it: ▲ volumes read larger, so a jump between ▲ and ◆ may be the scanner, not the lesion. Compare like with like: `
        : `3T shows tumour enhancement more strongly. Our outlining corrects most of this (edge set relative to each lesion's own brightness), but small lesions can still differ by scanner: a jump between ▲ and ◆ may be partly the scanner. Compare like with like: `);
        [['1.5T', 'Show 1.5T only'], ['3T', 'Show 3T only']].forEach(([v, lab]) => warn.append(lbtn(lab, '', false, () => { L.field = v; store.set('img.lesField', v); drawLesions(id, body); }), ' '));
      } else if (L.field !== 'all') {
        const hid = vis.filter(m => m.field !== L.field).length;
        warn.style.cssText = 'margin:2px 0 8px;padding:4px 10px;border:1px solid #e0a020;border-radius:6px;font-size:12px';
        warn.innerHTML = `<b style="color:#e0a020">Showing ${L.field} measurements only</b> (${hid} from other scanners hidden).`;
        warn.append(' ', lbtn('Show all', '', false, () => { L.field = 'all'; store.set('img.lesField', 'all'); drawLesions(id, body); }));
      }
      if (warn.innerHTML) body.append(warn);
    }
  }

  function lesTooltip(p) {
    if (p.meas) return [`${p.lesion} ${LNAME[p.lesion]}`, p.meas.none ? 'Our check: nothing at this place (normal scan, before the lesion appeared)'
      : `Our measurement: ${(p.meas.enh_mm3 / 1000).toFixed(2)} cm³ enhancing · longest axial ${p.meas.axial_mm} mm` + (p.meas.field ? ` · ${p.meas.field} scanner` + (is3T(p.meas) ? ' (compare with care across 1.5T)' : '') : '')];
    const r = p.r, tr = TREND[r.trend || ''];
    return [`${r.lesion} ${LNAME[r.lesion]}`, (r.mm != null ? (r.kind === 'punctate' ? 'punctate (~2 mm)' : r.kind === 'resolved' ? 'resolved' : r.kind === 'nonenhancing' ? 'non-enhancing' : r.mm + ' mm') : 'no size given') + (tr.t ? ' · ' + tr.t : ''),
            ...r.text.split(' | ').map(t => t.length > 90 ? t.slice(0, 88) + '…' : t)].concat(r.ambiguous ? ['(report wording fits more than one of our lesions)'] : []);
  }

  function drawLesions(id, body) {
    if ((L.view === 'volume' || L.view === 'periods') && !window.LesionTrends) L.view = 'timeline';
    if (L.view === 'volume' || L.view === 'periods') return window.LesionTrends.draw(id, body, L.view, lesViewBtns(id, body), () => drawLesions(id, body));
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = ''; lesToolbar(body, id);
    const H = hOf(id, PANELS[id].h0);
    if (L.view === 'grid') return lesGrid(body);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + H + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Brain lesions over time');
    box.appendChild(cv); body.appendChild(box); box.onmouseleave = () => setHover(null);
    const S = shownL(), row = Object.fromEntries(S.map((l, i) => [l.id, i]));
    const reps = LS.reports.filter(r => row[r.lesion] != null), meas = L.showMeas ? MEAS().filter(m => row[m.lesion] != null && fieldOK(m)) : [];
    const common = {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
      onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
      plugins: {legend: {display: false}, tooltip: {displayColors: false, callbacks: {title: it => fd(it[0].raw.date), label: it => lesTooltip(it.raw)}}}};
    let cfg;
    if (L.view === 'timeline') {
      const data = reps.map(r => ({x: pos(ms(r.date)), y: row[r.lesion], date: r.date, lesion: r.lesion, r}));
      const mdata = meas.map(m => ({x: pos(ms(m.date)), y: row[m.lesion], date: m.date, lesion: m.lesion, meas: m}));
      cfg = {type: 'scatter', plugins: [guide, momentPlugin, txPlugin(id_ => row[id_]), dosePlugin(id_ => row[id_])],
        data: {datasets: [
          {data, parsing: true, pointStyle: p => p.raw && (p.raw.r.kind === 'resolved' ? 'crossRot' : 'circle'),
           pointRadius: p => p.raw ? sizeR(p.raw.r.mm) : 3, pointHoverRadius: p => p.raw ? sizeR(p.raw.r.mm) + 2 : 5,
           pointBackgroundColor: p => p.raw && !p.raw.r.ambiguous && p.raw.r.kind !== 'nonenhancing' && p.raw.r.mm != null ? LCOL[p.raw.lesion] : 'rgba(0,0,0,0)',
           pointBorderColor: p => p.raw ? (TREND[p.raw.r.trend || ''].c !== 'transparent' ? TREND[p.raw.r.trend].c : LCOL[p.raw.lesion]) : '#888',
           pointBorderWidth: p => p.raw && p.raw.r.trend ? 2.2 : 1.4},
          {data: mdata, parsing: true, pointStyle: p => p.raw ? measShape(p.raw.meas) : 'rectRot', pointRadius: p => p.raw ? Math.max(4, Math.min(12, 3 + Math.cbrt(p.raw.meas.enh_mm3) / 2)) : 4,
           pointBackgroundColor: p => p.raw && !p.raw.meas.none ? LCOL[p.raw.lesion] : 'rgba(0,0,0,0)', pointBorderColor: p => p.raw && p.raw.meas.none ? LCOL[p.raw.lesion] : '#fff', pointBorderWidth: 1.5}]},
        options: Object.assign({}, common, {scales: {x: xAxis(),
          y: {min: -0.6, max: S.length - 0.4, reverse: true, afterFit: s => { s.width = YW; }, afterBuildTicks: a => { a.ticks = S.map((_, i) => ({value: i})); },
              ticks: {autoSkip: false, color: c => LCOL[S[c.tick.value] && S[c.tick.value].id] || css('--muted'), font: {weight: 'bold', size: 10}, callback: v => S[v] ? S[v].id : ''},
              grid: {color: css('--line')}}}})};
    } else {   // lines: size in mm over time
      const ds = S.map(l => {
        const pts = reps.filter(r => r.lesion === l.id && r.mm != null).map(r => ({x: pos(ms(r.date)), y: r.mm, date: r.date, lesion: l.id, r}))
          .concat(meas.filter(m => m.lesion === l.id).map(m => ({x: pos(ms(m.date)), y: m.axial_mm, date: m.date, lesion: l.id, meas: m})))
          .sort((a, b) => a.x - b.x);   // one line per lesion through report sizes AND our measurements (◆)
        return {label: l.id, data: pts, parsing: true, borderColor: LCOL[l.id], backgroundColor: LCOL[l.id], borderWidth: 2, tension: 0.15,
                segment: {borderDash: s => (s.p0.raw && s.p0.raw.meas && s.p0.raw.meas.none) ? [2, 4]
                            : ((s.p0.raw && s.p0.raw.meas) || (s.p1.raw && s.p1.raw.meas)) && fieldOf(s.p0.raw) && fieldOf(s.p1.raw) && fieldOf(s.p0.raw) !== fieldOf(s.p1.raw) ? [1, 3]   // jump between 1.5T and 3T
                            : (s.p0.raw && s.p0.raw.r && s.p0.raw.r.ambiguous) || (s.p1.raw && s.p1.raw.r && s.p1.raw.r.ambiguous) ? [4, 3] : undefined,
                          borderColor: s => s.p0.raw && s.p0.raw.meas && s.p0.raw.meas.none ? LCOL[l.id].replace('rgb(', 'rgba(').replace(')', ',0.35)') : undefined},   // from "nothing there": when it appeared is unknown
                pointRadius: p => !p.raw ? 3.5 : p.raw.meas ? 6 : p.raw.r.ambiguous ? 3 : 3.5,
                pointStyle: p => p.raw && p.raw.meas ? measShape(p.raw.meas) : p.raw && p.raw.r.kind === 'resolved' ? 'crossRot' : 'circle',
                pointBorderColor: p => p.raw && p.raw.meas && !p.raw.meas.none ? '#fff' : LCOL[l.id], pointBorderWidth: p => p.raw && p.raw.meas ? 1.5 : 1,
                pointBackgroundColor: p => !p.raw ? LCOL[l.id] : p.raw.meas ? (p.raw.meas.none ? 'rgba(0,0,0,0)' : LCOL[l.id]) : p.raw.r.ambiguous ? 'rgba(0,0,0,0)' : LCOL[l.id], spanGaps: true, showLine: true};
      });
      cfg = {type: 'line', plugins: [guide, momentPlugin, txPlugin(null)], data: {datasets: ds},
        options: Object.assign({}, common, {scales: {x: xAxis(), y: {min: 0, max: linesMax(S), afterFit: s => { s.width = YW; },
          title: {display: true, text: 'mm', color: css('--muted')}, ticks: {color: css('--muted')}, grid: {color: css('--line')}}}})};
    }
    charts.set(id, new Chart(cv, cfg));
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.innerHTML = L.view === 'timeline'
      ? 'Dot = a report mentioned the lesion; size = reported size (✕ resolved, ring only = no size or the wording fits two lesions). Ring colour: <b style="color:#e34948">grew</b> · <b style="color:#1baf7a">shrank</b> · <b style="color:#8a8984">stable</b>. ◆ = our own measurement on a 1.5T scanner, ▲ = on a 3T scanner (mostly corrected; small lesions can still differ). Purple box = SRS on that lesion (dashed = unverified); orange band = whole-brain radiation.' +
        (DOSE ? ` <span style="color:#e0a020">Dose (estimated, ${dunit()}): number after a treatment box = dose that course gave the lesion; strip under each row = dose so far (pale = little, dark red = most); right column = total.</span>` : '')
      : 'Size, not volume: longest width in mm as each report gave it (different hospitals and readers: trends, not exact), joined with our own measurements (◆ = our longest axial width on a 1.5T scanner, ▲ = on 3T; a dotted stretch between the two strengths may be partly the scanner; hover it for our volume in cm³; hollow ◆ at 0 = our check found nothing there, 7/31/2023; the faint dotted stretch after it only means "appeared some time in between"). Dashed = report wording fits two lesions. Bands: orange = whole-brain radiation, purple = SRS.';
    body.appendChild(note);
  }

  function lesGrid(body) {
    const S = shownL(), dates = [...new Set(LS.scans.concat(MEAS().map(m => m.date)))].sort();
    const cell = (lid, d) => LS.reports.find(r => r.lesion === lid && r.date === d);
    const meas = (lid, d) => L.showMeas && MEAS().find(m => m.lesion === lid && m.date === d && fieldOK(m));
    const inWin = d => { const t = ms(d); return t >= W.a && t <= W.b; };
    const txDates = d => LS.treatments.filter(t => t.start <= d).map(t => t.start);
    let h = '<div style="overflow:auto;max-height:' + (hOf(IDL, PANELS[IDL].h0) + 40) + 'px"><table class="lesgrid" style="border-collapse:collapse;font-size:11px">';
    const md = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});   // "Jun 27"
    h += '<tr><th class="sub" style="position:sticky;left:0;background:var(--bg);text-align:left;font-weight:500;padding:2px 4px">date</th>' + dates.map(d => `<th title="${fd(d)}" style="padding:2px 4px;font-weight:500;white-space:nowrap;${inWin(d) ? '' : 'opacity:.45'}">${md(d)}<br><span class="sub">${d.slice(0, 4)}</span></th>`).join('') +
      (DOSE ? `<th style="padding:2px 6px;color:#e0a020" title="Estimated total radiation dose to the lesion's centre">dose<br><span class="sub">${dunit()}</span></th>` : '') + '</tr>';
    // treatment row
    h += '<tr><td style="position:sticky;left:0;background:var(--bg)" class="sub">treated</td>' + dates.map((d, i) => {
      const tx = LS.treatments.filter(t => t.start > (dates[i - 1] || '0') && t.start <= d);
      return `<td style="text-align:center;color:#6250d6" title="${tx.map(t => t.treatment + ' ' + t.start).join('; ')}">${tx.map(t => /whole/i.test(t.treatment) ? 'WBRT' : 'SRS').join(' ')}</td>`; }).join('') + '</tr>';
    S.forEach(l => {
      h += `<tr><td style="position:sticky;left:0;background:var(--bg);white-space:nowrap;padding-right:6px" title="${l.name}"><b style="color:${LCOL[l.id]}">${l.id}</b> <span class="sub">${l.name.length > 22 ? l.name.slice(0, 21) + '…' : l.name}</span></td>`;
      dates.forEach(d => {
        const r = cell(l.id, d), m = meas(l.id, d), tr = r ? TREND[r.trend || ''] : null;
        const txt = r ? (r.kind === 'resolved' ? '✕' : r.kind === 'nonenhancing' ? 'ne' : r.kind === 'punctate' ? '·' : r.mm != null ? Math.round(r.mm) : '—') + (r.ambiguous ? '?' : '') : '';
        const bg = tr && tr.c !== 'transparent' ? `background:color-mix(in srgb, ${tr.c} 28%, transparent)` : '';
        const tip = (r ? lesTooltip({r}).slice(1).join('\n') : '') + (m ? (r ? '\n' : '') + (m.none ? 'Our check: nothing at this place (normal scan)' : `Ours: ${(m.enh_mm3 / 1000).toFixed(2)} cm³, ${m.axial_mm} mm` + (m.field ? ', ' + m.field + ' scanner' : '')) : '');
        h += `<td title="${tip.replace(/"/g, '&quot;')}" style="text-align:center;padding:2px 4px;border:1px solid var(--line);${bg};${inWin(d) ? '' : 'opacity:.45'}">${txt}${m ? `<div style="font-size:9px;color:${LCOL[l.id]}">${m.none ? '◇ none' : (is3T(m) ? '▲' : '◆') + (m.enh_mm3 / 1000).toFixed(1)}</div>` : ''}</td>`;
      });
      if (DOSE) { const rr = doseRows(l.id), tot = rr.length ? drun(rr[rr.length - 1]) : null;
        h += `<td style="text-align:center;padding:2px 6px;border:1px solid var(--line);font-weight:600;color:#000;background:${tot != null ? heat(tot) : 'transparent'}" title="${rr.map(r => CLAB[r.course] + ': ' + Math.round(dval(r)) + ' ' + dunit()).join('\n')}">${tot != null ? Math.round(tot) : ''}</td>`; }
      h += '</tr>';
    });
    h += '</table></div><div class="sub" style="margin-top:4px">Cells: longest size in mm as reported · "·" punctate · "ne" non-enhancing · "✕" resolved · "—" mentioned without a size · "?" wording fits two lesions. Colour: red grew, green shrank, grey stable. ◆ = our measured volume (cm³) on 1.5T, ▲ = on 3T. Dimmed columns are outside the time window. Hover a cell for the report wording.</div>';
    const wrap = document.createElement('div'); wrap.innerHTML = h; body.appendChild(wrap);
  }

  /* ================= Radiation dose by lesion (stacked bars, one per lesion, split by course) ================= */
  function drawDose(id, body) {
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = '';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px';
    bar.append(unitButtons(() => { drawDose(id, body); const b = BODIES.get(IDL); if (b && b.isConnected) drawLesions(IDL, b); }));
    const warn = document.createElement('span'); warn.className = 'sub'; warn.style.color = '#e0a020';
    warn.textContent = DOSE.estimate_note || 'ESTIMATED dose, not the hospitals\' dose files.';
    bar.append(warn); body.append(bar);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Estimated radiation dose to each brain lesion, by course');
    box.append(cv); body.append(box);
    const les = [...new Set(DROWS.map(r => r.lesion))].sort();
    const ds = Object.keys(CLAB).map(k => ({label: CLAB[k], backgroundColor: CCOL[k], borderColor: CCOL[k], borderWidth: 0,
      data: les.map(l => { const r = DROWS.find(x => x.lesion === l && x.course === k); return r ? Math.round(dval(r) * 10) / 10 : 0; })}));
    const conf = Object.fromEntries((DOSE.courses || []).map(c => [c.course, c]));
    charts.set(id, new Chart(cv, {type: 'bar', data: {labels: les, datasets: ds},
      options: {animation: false, maintainAspectRatio: false,
        scales: {x: {stacked: true, ticks: {color: c => LCOL[les[c.index]] || css('--muted'), font: {weight: 'bold', size: 10}}, grid: {display: false}},
                 y: {stacked: true, title: {display: true, text: dunit() + ' (dose at the lesion centre)', color: css('--muted')}, ticks: {color: css('--muted')}, grid: {color: css('--line')}}},
        plugins: {legend: {labels: {color: css('--ink'), boxWidth: 12}},
          tooltip: {callbacks: {title: it => it[0].label + ' ' + (LNAME[it[0].label] || ''),
            label: it => { const k = Object.keys(CLAB)[it.datasetIndex], r = DROWS.find(x => x.lesion === it.label && x.course === k), c = conf[k] || {};
              return r ? `${CLAB[k]} (${c.start}–${c.end}): ${r.gy} Gy · ${r.eqd2_tumor} EQD2${r.targeted ? (isWhole(k) ? '' : ' · targeted') : ' · spill-over'} · ${c.confidence} confidence` : ''; },
            footer: it => { const r = DROWS.filter(x => x.lesion === it[0].label); return r.length ? 'Total so far: ' + Math.round(drun(r[r.length - 1])) + ' ' + dunit() : ''; }}}}}}));
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.textContent = 'Each bar = one lesion; colours = the radiation courses it received. ' + (DOSE.course_note || '') + ' EQD2 uses alpha/beta 10 for tumour. Spill-over = dose from a nearby target.';
    body.append(note);
  }

  /* ================= plug into the viewer's hooks (same object the MRD panels use) ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => typeof id === 'string' && id.startsWith('img:');
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? (id === IDV && V.scan ? fd(V.scan.date) : PANELS[id].unit) : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); BODIES.set(id, body); (id === IDV ? drawViewer : id === IDL ? drawLesions : id === IDD ? drawDose : drawDates)(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); if (id === IDV || id === IDD) return;   // the slice viewer doesn't follow the time window
    const b = BODIES.get(id); if (b && b.isConnected) (id === IDL ? drawLesions : drawDates)(id, b); };

  /* Library: Imaging → Brain MRI → Scan dates / Slice viewer */
  MRD.section = (el, q) => {
    o.section(el, q);
    if (q && !'imaging brain mri scans slice viewer lesions over time radiation dose'.includes(q)) return;
    const S = section(el, 'img', 'Imaging', '1 group', true, 'sec', q);
    const ids = [ID, IDL, IDV].concat(DOSE ? [IDD] : []), k = ids.filter(i => sel.includes(i)).length;
    const G = section(S, 'img:brain', 'Brain MRI', k ? k + '/' + ids.length : ROWS.length + ' scans', true, 'grp', q);
    // All / None / Only on the Imaging heading and the Brain MRI group (same buttons and behaviour as Vitals)
    [[S, 'grp:Imaging', 'Imaging', 'imaging panel'], [G, 'grp:img:brain', 'Brain MRI', 'brain MRI panel']].forEach(([D, key, label, what]) => { const s = D.firstChild;
      s.insertBefore(miniBtn('All', 'Show every ' + what, () => setLabSel(ids, true)), s.lastChild);
      s.insertBefore(miniBtn('None', 'Hide every ' + what, () => setLabSel(ids, false)), s.lastChild);
      s.insertBefore(groupOnlyBtn(what, key, ids, soloLab && soloLab.key === key, !!(soloLab && soloLab.key.startsWith('id:img:')), () => onlyLab(key, ids, label)), s.lastChild); });
    const row = (id, label, count, tip) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(id); cb.setAttribute('aria-label', 'Compare ' + PANELS[id].title);
      cb.onclick = e => { e.stopPropagation(); setLabSel([id], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      const only = onlyBtn('Show only ' + PANELS[id].title + ' (deselect the others)', () => onlyLab('id:' + id, [id], PANELS[id].title), soloLab && soloLab.key === 'id:' + id);   // shows on hover, like lab rows
      d.append(cb, nm, only, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([id], cb.checked); };
      G.appendChild(d);
    };
    row(ID, 'Scan dates', ROWS.length + ' · ' + ROWS.filter(r => !r.images).length + ' no images', 'Every brain MRI as a point on the timeline');
    row(IDL, 'Lesions over time', LS.lesions.length + ' lesions · ' + LS.scans.length + ' reports', 'Each lesion (L01…): our measured volumes with trends and doubling times, plus what every report said (timeline, sizes, grid); treatments marked');
    row(IDV, 'Slice viewer', SCANS.length + ' measured', 'Scroll through a scan in 3 planes + 3D with our lesion outlines (L01…)');
    if (DOSE) row(IDD, 'Radiation dose by lesion', 'estimated', 'Estimated radiation dose each lesion received, split by course (stacked bars)');
  };

  syncMoments(); (window.momentSyncers = window.momentSyncers || []).push(syncMoments);   // again after the shared edits load
  const saved = store.get('selected', []);
  if (saved.some(mine)) { sel = saved.filter(id => BYID[id] || MRD.isId(id)); }
  updateBar(); list(); render();
})();
