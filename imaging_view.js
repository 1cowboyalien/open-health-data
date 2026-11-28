/* Imaging → Brain MRI in the Library of the lab viewer (labs.html): scan dates, slice viewer (NiiVue), lesions over time,
   radiation dose by lesion. Used by open-health-data/make_lab_view.py (as imaging_view.js) and by the simulation build.
   Everything about the patient (hospitals, scans, lesions, doses, default view) comes from IMG_DATA, never from this code.
   It plugs into the hooks the viewer already calls for MRD panels (MRD.isId/title/unit/h0/panel/refresh/section),
   so the panels get the same ⤒ ↑ ↓ ⤓ − + × controls and Compare stacking.
   Panels:  img:brain:dates  = every brain MRI as a point on the shared time axis
            img:brain:viewer = NiiVue slice viewer (axial/coronal/sagittal + 3D) with our lesion outlines L01…
            img:brain:3d     = the phone start screen's 3D timelapse (phone_view.js, Brain3D.mount), when IMG_DATA.phone3d says its model exists
   Data: IMG_DATA = {brain_mri: [...], viewer_scans: [{date, t1c, labels, lesions:[{id,n,name,rgb,enh,axial,ras}], marks?:[{id,label,rgb,note,ras}] (plan points: a row under the lesions that moves the crosshair there),
          series?: [{key, label, short, file, badge, note, probe, labels?, lesions?, lesions_note?}], series_main?, perf?: [{key, label, file, note?}]}]}
          (series = other kinds of picture of that date; perf note = said beside the perfusion scale, e.g. a map we computed ourselves). */
(() => {
  const ROWS = IMG_DATA.brain_mri;
  const SCANS = IMG_DATA.viewer_scans || [];
  const ID = 'img:brain:dates', IDV = 'img:brain:viewer', IDL = 'img:brain:lesions', IDD = 'img:brain:dose', IDP = 'img:brain:perf', IDW = 'img:brain:swell', ID3 = 'img:brain:3d';
  const LS = IMG_DATA.lesion_series || {lesions: [], reports: [], measured: [], treatments: [], scans: []};
  const PANELS = {[ID]: {title: 'Brain MRI · Scan dates', unit: ROWS.length + ' scans', h0: 190},
                  [IDV]: {title: 'Brain MRI · Slice viewer', unit: 'our lesion outlines', h0: 520},
                  [IDL]: {title: 'Brain MRI · Lesions over time', unit: 'our volumes (mm³) · trends · report sizes', h0: 380},
                  [IDD]: {title: 'Brain MRI · Radiation dose by lesion', unit: 'estimated', h0: 260},
                  [IDP]: {title: 'Brain MRI · Perfusion by lesion', unit: 'blood volume & flow · × normal brain', h0: 340},
                  [IDW]: {title: 'Brain MRI · Swelling by lesion', unit: '% room vs the normal control MRI', h0: 360},
                  [ID3]: {title: 'Brain MRI · 3D timelapse', unit: 'every scan · shapes blended between scans', h0: 640}};
  const B3D = !!IMG_DATA.phone3d;   // the 3D model (local/phone/model.json) exists, so phone_view.js is on the page
  const SWELL = !!(window.LesionSwelling && IMG_DATA.swelling && IMG_DATA.swelling.rows.length);   // swelling_view.js (swelling / shrinkage per lesion)
  const PERF = !!(window.LesionPerfusion && IMG_DATA.perfusion && IMG_DATA.perfusion.rows.length);   // perfusion_view.js (blood flow / volume per lesion)
  const DOSE = IMG_DATA.dose;   // radiation dose (imaging/radiation_dose), or null. ESTIMATED, except the maps and courses the data file marks `real`: a hospital's own dose file
  const DOSE_REAL = !!(DOSE && (DOSE.maps || []).some(m => m.real));   // at least one course is a hospital's dose file
  const DOSE_TAG = DOSE_REAL ? 'part estimated' : 'estimated';
  if (DOSE_REAL) PANELS[IDD].unit = DOSE_TAG;
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
             /* every colour layer starts OFF when the viewer opens (radiation too, since 2026-11-18): sliders are remembered, and a saved
                view switches its layers on only when the user picks it, not when the viewer opens with it */
             dose: Object.assign({key: '', op: 35, lines: true, blend: 25}, store.get('img.dose', {}), {key: ''}),
             perf: Object.assign({key: '', min: 130, op: 60}, store.get('img.perf', {}), {key: ''}),   // perfusion layer: map, show-above level (x100), wash %
             swell: Object.assign({key: '', thr: 0, op: 60}, store.get('img.swell', {}), {key: ''}),   // swelling layer: map, show-beyond level in % (0 = the scan's own normal range), wash %
             tone: store.get('img.tone', true),   // brightness matched across scan dates (display only)
             proj: Object.assign({m: 1, sc: 'full'}, store.get('img.proj', {}), {on: false}),   // simulated future scan: months ahead, scenario; always starts off
             grid: Object.assign({x: 4}, store.get('img.grid', {}), {on: false}),   // bent grid (swelling as movement): how many times larger than real it is drawn; always starts off
             ser: '',   // another series of the same scan date ('' = the measured one); never remembered, so every visit starts on the measured series
             size: store.get('img.size', 0), full: false};   // size: viewer height in px (0 = the panel's height); full: filling the window
  window.__imgViewer = V;   // for testing in the browser console
  if (typeof saveEdits === 'function') { const _save = saveEdits;
    saveEdits = function () { const mine = (E.moments || []).filter(m => m.imgView); E.moments = (E.moments || []).filter(m => !m.imgView);
      try { return _save.apply(this, arguments); } finally { E.moments.push(...mine); } }; }
  const DDEF = {layout: 'auto', lbPlane: 'A', lbStep: '5', lbPlus: false, outline: 'fill', pixels: 'smooth', xhair: 'on', xcolor: '1,1,1,0.55',
                xgap: '0', x3d: true, orient: 'edges', cbar: false, cutDepth: 0, cutAz: 180, cutEl: 20, cutFace: 'tint', les2d: 'shiny'};
  V.disp = Object.assign({}, DDEF, store.get('img.disp', {}));
  // one-time move from the old default (grid) to 'auto' (row on wide screens, grid on tall ones)
  if (V.disp.layout === 'grid' && !store.get('img.layoutAuto', false)) { V.disp.layout = 'auto'; store.set('img.disp', V.disp); }
  store.set('img.layoutAuto', true);
  const TALL = window.matchMedia('(orientation: portrait)');
  const layOf = d => d.layout === 'auto' ? (TALL.matches ? 'grid' : 'row') : d.layout;
  TALL.addEventListener('change', () => { if (V.disp.layout === 'auto') { applyDisplay(); sizeBox(IDV); } });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function viewerEl() {
    if (V.el) return V.el;
    const w = document.createElement('div'); w.className = 'nvwrap';
    w.innerHTML = `<style>
      .nvwrap{display:flex;gap:10px;align-items:stretch}
      .nvwrap .nvmain{flex:1;min-width:0}
      .nvwrap .nvbox{position:relative;background:#000;border-radius:6px;overflow:hidden}
      .nvwrap .nvbox canvas{width:100%;height:100%;display:block;outline:none}
      .nvwrap.nvblank [data-r="list"],.nvwrap.nvblank [data-r="read"]{visibility:hidden}.nvwrap.nvblank [data-r="scan"]{opacity:.4}.nvwrap .nvnone{position:absolute;inset:0;z-index:6;background:#000;color:#ddd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:12px;font-size:13px}.nvwrap .nvnone b{font-size:15px;color:#fff}.nvwrap .nvnone span{color:#aaa;max-width:420px}
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
      .nvwrap .nvbar button,.nvwrap .nvbar select,.nvwrap .nvdisp select,.nvwrap .nvdisp button{font-size:11px;padding:1px 7px;line-height:17px}
      .nvwrap .nvbar{gap:6px 8px;margin-bottom:4px}.nvwrap .nvbar.nvcol,.nvwrap .nvdisp.nvcol{display:none!important}
      .nvwrap .nvsecs{display:inline-flex;gap:3px;margin-left:auto;padding-left:8px;border-left:1px solid var(--line)}
      .nvwrap .nvsecs button.open{background:var(--accent);border-color:var(--accent);color:#fff}
      .nvwrap .nvsecs button.act::after{content:' •';color:#e0a020}
      .nvwrap .nvdisp summary{display:none}
      /* a narrow screen (a phone): the lesion list goes under the viewer instead of beside it (beside it, its 250 px left the
         viewer and its controls about 65 px, and they ran over the list); the section buttons wrap */
      @media (max-width:760px){.nvwrap{flex-direction:column}.nvwrap .nvside{width:auto;max-height:230px!important}.nvwrap .nvsecs{flex-wrap:wrap;margin-left:0;padding-left:0;border-left:0}}
    </style>
    <div class="nvmain"><div class="nvbar">
        <label>Scan <select data-r="scan"></select></label>
        <span data-r="serbar" style="display:none" title="Other kinds of picture from the same scan date. Every date opens on its measured series; the outlines and volumes always come from that one."><label>Series <select data-r="series"></select></label></span>
        <span data-r="projbar" style="display:none;padding:1px 6px;border:1px dashed #e0a020;border-radius:6px" title="A simulation, not a scan: the latest scan's images with each lesion outline grown or shrunk to the size it would have if its latest rate carried on. A scenario from our own measurements, not a forecast.">
          <label style="color:#e0a020"><input type="checkbox" data-r="projon"> Simulate</label>
          <select data-r="projm" aria-label="How far ahead"></select> <select data-r="projsc" aria-label="Which rate"></select></span>
        <label>Outlines <input data-r="op" type="range" min="0" max="100" value="55" style="width:90px"></label>
        <button type="button" data-r="cut" class="on" title="Cut the 3D view open so the lesions inside show">3D: cut open</button>
        <button type="button" data-r="radio" title="Radiologist view: the patient's right is on the screen's left (as the hospitals show it). Click for neurologist view (patient's left on the left).">L/R: radiologist</button>
        <button type="button" data-r="nose" title="Side (sagittal) view: which way the face points">Side view: face left</button>
        <button type="button" data-r="fit" title="Make the viewer as tall as the window">Fit height</button>
        <button type="button" data-r="full" title="Fill the whole window with the viewer (Esc to close)">⛶ Full window</button>
        <span class="sub" data-r="status"></span>
        <span class="nvsecs" data-r="secs" role="group" aria-label="More controls"></span></div>
      <div class="nvbar" data-sec="image">
        <span title="Make the viewer taller or shorter (handy on big, high-resolution screens). Remembered in this browser.">Size <input data-r="size" type="range" min="200" max="2400" step="20" style="width:90px"> <span class="sub" data-r="sizel"></span></span>
        <span class="sub">3D zoom</span><button type="button" data-z3="-1" title="Zoom the 3D view out">−</button><button type="button" data-z3="1" title="Zoom the 3D view in">+</button>
        <span class="sub">Slice zoom</span><button type="button" data-z2="-1" title="Zoom the slice views out">−</button><button type="button" data-z2="1" title="Zoom the slice views in (around the crosshair)">+</button>
        <button type="button" data-r="zreset" title="Reset both zooms">Reset zoom</button>
        <span title="3D view only: 0 = solid, 100 = glass (only the edges of the head and brain stay visible, so the lesions show through)">3D see-through <button type="button" data-step="glass" data-d="-10" aria-label="3D more solid">−</button><input data-r="glass" type="range" min="0" max="100" value="0" style="width:60px"><button type="button" data-step="glass" data-d="10" aria-label="3D more see-through">+</button></span>
        <span class="sub" style="margin-left:6px">Contrast</span>
        <span title="Darkest: values at or below this show black">Low <button type="button" data-step="lo" data-d="-25" aria-label="Low down">−</button><input data-r="lo" type="range" min="0" max="1000" style="width:60px"><button type="button" data-step="lo" data-d="25" aria-label="Low up">+</button></span>
        <span title="Mid-tones: − = darker greys, + = brighter greys">Mid <button type="button" data-step="mid" data-d="-10" aria-label="Mid-tones darker">−</button><input data-r="mid" type="range" min="-100" max="100" value="0" style="width:60px"><button type="button" data-step="mid" data-d="10" aria-label="Mid-tones brighter">+</button></span>
        <span title="Brightest: values at or above this show white. Past 100% nothing reaches full white, so the whole image gets darker.">High <button type="button" data-step="hi" data-d="-25" aria-label="High down">−</button><input data-r="hi" type="range" min="0" max="2000" style="width:70px"><button type="button" data-step="hi" data-d="25" aria-label="High up">+</button><span class="sub" data-r="hipct"></span></span>
        <button type="button" data-r="cauto" title="Reset contrast to the full range">Auto</button>
        <button type="button" data-r="clesion" title="Darker brain, enhancing lesions stand out">Lesions</button>
        <label data-r="tonewrap" style="display:none" title="Shows the same tissue at the same grey on every scan date: air black, then fluid, grey matter, white matter and scalp/marrow fat at fixed levels, so scans from different scanners and sequence types look alike and the Low / Mid / High settings carry over from date to date. Display only: our measurements use the scan's own values. It also evens out how bright enhancement looks, so with this on, brightness alone does not mean 'more enhancing'; untick to see the scan's own contrast."><input type="checkbox" data-r="tone"> match brightness across scans</label>
        <span class="sub" data-r="tonel"></span></div>
      <div class="nvbar" data-sec="dose" data-r="dosebar" title="${DOSE_REAL ? "Radiation dose. A course marked 'dose file' is the hospital's own dose map, placed on these scans; the others are ESTIMATED from our model of the treatment records" : "ESTIMATED radiation dose from our model of the treatment records, not the hospitals' dose files"}">
        <span class="sub" style="color:#e0a020">Radiation dose (${DOSE_TAG})</span>
        <select data-r="dose"><option value="">off</option></select>
        <span title="How see-through the colour wash is">wash <input data-r="dop" type="range" min="0" max="100" value="35" style="width:70px"></span>
        <span title="3D view only: how solid the dose looks (low = see-through cloud; the 3D cut also slices through the dose while it's shown)">3D strength <input data-r="dblend" type="range" min="5" max="100" value="25" style="width:60px"></span>
        <label title="Isodose lines: the prescription dose and 12 Gy (combined: 100 and 60 Gy EQD2)"><input type="checkbox" data-r="dlines" checked> lines</label>
        <span class="sub" data-r="dlegend"></span></div>
      <div class="nvbar" data-sec="perf" data-r="perfbar" title="Blood flow / blood volume from the hospital's perfusion maps, as × normal brain on the same scan (our estimate, not a reading)">
        <span class="sub" style="color:#e05ad0">Perfusion</span>
        <select data-r="perf"><option value="">off</option><option value="asl">Blood flow (ASL)</option><option value="rcbv">Blood volume (rCBV)</option></select>
        <span title="Colour only where the map is at least this many times normal brain">show above <input data-r="pmin" type="range" min="50" max="300" step="10" style="width:70px"> <b data-r="pminl"></b></span>
        <span title="How see-through the colour wash is">wash <input data-r="pop" type="range" min="0" max="100" style="width:60px"></span>
        <span class="sub" data-r="plegend"></span></div>
      <div class="nvbar" data-sec="swell" data-r="swellbar" title="How much more (swollen) or less (shrunk, squeezed) room the brain takes than on the normal control MRI, from a flexible fit (our estimate, not a reading). It shows large effects only and understates them.">
        <span class="sub" style="color:#ff7a59">Swelling</span>
        <select data-r="swell"><option value="">off</option></select>
        <span title="Colour only where the change is beyond this. 'This scan's normal range' = outside what 95% of the lesion-free brain shows on the same scan, the fairest setting: inside it the map cannot tell a change from noise.">show beyond <select data-r="sthr"><option value="0">this scan's normal range</option><option value="5">±5%</option><option value="10">±10%</option><option value="15">±15%</option><option value="20">±20%</option><option value="30">±30%</option></select></span>
        <span title="How see-through the colour wash is">wash <input data-r="sop" type="range" min="0" max="100" style="width:60px"></span>
        <span class="sub" data-r="slegend"></span>
        <span data-r="sgridwrap" style="margin-left:4px;padding-left:8px;border-left:1px solid var(--line)">
          <label title="The same fit shown as movement: a straight grid laid on the brain as it was on the control MRI, each point moved to where that tissue sits on this scan. Lines spread apart where the tissue takes more room and crowd together where it takes less. Slice views only. Large effects only, like the colour layer."><input type="checkbox" data-r="sgrid"> bent grid</label>
          <span title="How many times larger than real the movement is drawn. The real movement is a millimetre or two, too small to see at ×1.">movement × <select data-r="sgx"><option value="1">1 (real)</option><option value="2">2</option><option value="4">4</option><option value="8">8</option><option value="12">12</option></select></span>
          <span class="sub" data-r="sglegend"></span></span></div>
      <div class="nvbar" data-sec="views" data-r="views"></div>
      <details class="nvdisp" data-sec="disp" data-r="disp" open><summary>Display options</summary><div class="nvgrid">
        <label>Layout <select data-o="layout">
          <option value="auto">Four views · auto (row on wide screens, grid on tall)</option><option value="grid">Four views · grid</option><option value="row">Four views · row</option><option value="column">Four views · column</option>
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
      <div data-r="simbar" style="display:none;font-size:12px;margin:0 0 4px;padding:5px 9px;border:2px solid #e0a020;border-radius:6px;background:color-mix(in srgb,#e0a020 14%,transparent)"></div>
      <div data-r="serban" style="display:none;font-size:12px;margin:0 0 4px;padding:5px 9px;border:2px solid #e0a020;border-radius:6px;background:color-mix(in srgb,#e0a020 14%,transparent)"></div>
      <div data-r="pscale" style="display:none;font-size:11px;color:var(--muted);margin:0 0 3px;line-height:26px"></div>
      <div data-r="sscale" style="display:none;font-size:11px;color:var(--muted);margin:0 0 3px;line-height:26px"></div>
      <div class="nvbox" data-r="box"><canvas data-r="cv"></canvas><canvas data-r="gridcv" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none"></canvas></div>
      <div class="sub nvread" data-r="read">Click or drag in a view to move the crosshair; scroll to change slice; right-drag to adjust brightness.</div></div>
    <div class="nvside" data-r="list"></div>`;
    const R = k => w.querySelector(`[data-r="${k}"]`);
    V.R = R; V.el = w;
    /* the extra control rows open from small buttons at the end of the first row (remembered in this browser);
       a dot marks a colour layer that is switched on while its row is closed */
    const SECS = [['image', 'Zoom & contrast'], ['dose', 'Dose'], ['perf', 'Perfusion'], ['swell', 'Swelling'], ['views', 'Saved views'], ['disp', 'Display']];
    const secOpen = store.get('img.secs', {});
    const secSync = () => SECS.forEach(([k]) => { const row = w.querySelector(`[data-sec="${k}"]`), b = w.querySelector(`[data-secb="${k}"]`); if (!row || !b) return;
      row.classList.toggle('nvcol', !secOpen[k]); b.classList.toggle('open', !!secOpen[k]); const dv = row.style.display === 'none' ? 'none' : ''; if (b.style.display !== dv) b.style.display = dv;
      const sel = {dose: 'dose', perf: 'perf', swell: 'swell'}[k]; b.classList.toggle('act', !!(sel && R(sel) && R(sel).value)); });
    SECS.forEach(([k, label]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.secb = k; b.textContent = label;
      b.title = 'Show or hide the ' + label.toLowerCase() + ' controls';
      b.onclick = () => { secOpen[k] = !secOpen[k]; if (!secOpen[k]) delete secOpen[k]; store.set('img.secs', secOpen); secSync(); if (V.nv) requestAnimationFrame(() => sizeBox(IDV)); };
      R('secs').appendChild(b); });
    w.addEventListener('change', () => requestAnimationFrame(secSync));
    new MutationObserver(secSync).observe(w, {attributes: true, attributeFilter: ['style'], subtree: true, childList: false});
    requestAnimationFrame(secSync);
    R('lo').value = 0; R('hi').value = 1000;
    SCANS.forEach(s => { const o = document.createElement('option'); o.value = s.date; o.textContent = fd(s.date) + ' · ' + (s.viewing ? 'viewing only' : s.lesions.length + ' lesions'); R('scan').appendChild(o); });
    R('scan').onchange = () => load(R('scan').value).catch(() => {});   // a failed load is reported in the viewer (loadFailed)
    R('series').onchange = () => { V.ser = R('series').value; load(R('scan').value).catch(() => {}); };
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
    (DOSE ? DOSE.maps : []).forEach(m => { const o = document.createElement('option'); o.value = m.key; o.textContent = m.label + (m.real ? ' (dose file)' : ''); R('dose').appendChild(o); });
    if (!DOSE) R('dosebar').style.display = 'none';
    R('dose').value = V.dose.key; R('dop').value = V.dose.op; R('dlines').checked = V.dose.lines;
    R('dose').onchange = () => { V.dose.key = R('dose').value; saveDose(); applyDose(); };
    R('dop').oninput = () => { V.dose.op = +R('dop').value; saveDose(); const w = doseVol('wash'); if (w) { V.nv.setOpacity(V.nv.volumes.indexOf(w), V.dose.op / 100); } };
    R('dblend').value = V.dose.blend; R('dblend').oninput = () => { V.dose.blend = +R('dblend').value; saveDose(); applyDose3D(); };
    R('dlines').onchange = () => { V.dose.lines = R('dlines').checked; saveDose(); applyDose(); };
    if (!SCANS.some(s => s.perf && s.perf.length)) R('perfbar').style.display = 'none';
    const pminl = () => { R('pminl').textContent = (V.perf.min / 100).toFixed(1) + '×'; };
    R('perf').value = V.perf.key; R('pmin').value = V.perf.min; R('pop').value = V.perf.op; pminl();
    R('perf').onchange = () => { V.perf.key = R('perf').value; savePerf(); applyPerf(); };
    R('pmin').oninput = () => { V.perf.min = +R('pmin').value; savePerf(); pminl(); const p = perfVol(); if (p) { p.cal_min = V.perf.min; V.nv.updateGLVolume(); } perfLegend(); };
    R('pop').oninput = () => { V.perf.op = +R('pop').value; savePerf(); const p = perfVol(); if (p) V.nv.setOpacity(V.nv.volumes.indexOf(p), V.perf.op / 100); };
    // swelling layer: the choices (fine detail, 15 mm average) come from the data
    const SWK = new Map(); SCANS.forEach(s => (s.swell || []).forEach(x => SWK.set(x.key, x.label)));
    SWK.forEach((lab, k) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; R('swell').appendChild(o); });
    if (!SWK.size) R('swellbar').style.display = 'none';
    R('swell').value = V.swell.key; R('sthr').value = String(V.swell.thr); R('sop').value = V.swell.op;
    R('swell').onchange = () => { V.swell.key = R('swell').value; saveSwell(); applySwell(); };
    R('sthr').onchange = () => { V.swell.thr = +R('sthr').value; saveSwell(); swellLevels(); gridLegend(); if (V.nv && V.grid.on) V.nv.drawScene(); };
    R('sop').oninput = () => { V.swell.op = +R('sop').value; saveSwell(); const p = swellVol(); if (p) V.nv.setOpacity(V.nv.volumes.indexOf(p), V.swell.op / 100); };
    // bent grid: on/off and how much larger than real the movement is drawn
    if (!SCANS.some(s => s.grid)) R('sgridwrap').style.display = 'none'; else R('swellbar').style.display = '';
    R('sgrid').checked = false; R('sgx').value = String(V.grid.x);
    R('sgrid').onchange = () => { V.grid.on = R('sgrid').checked; applyGrid(); };
    R('sgx').onchange = () => { V.grid.x = +R('sgx').value; store.set('img.grid', {x: V.grid.x}); gridLegend(); if (V.nv) V.nv.drawScene(); };
    // brightness matching across scan dates (display only)
    if (TONE) R('tonewrap').style.display = '';
    R('tone').checked = !!V.tone;
    R('tone').onchange = () => { V.tone = R('tone').checked; store.set('img.tone', V.tone); applyTone(); applyContrast(); };
    // simulated future scan: months ahead and scenario from the data (growth_model.py + make_projection.py)
    const PB = projBase();
    if (PB) { R('projbar').style.display = '';
      const md = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
      const seenM = new Set(), seenS = new Set();
      PB.proj.forEach(p => { if (!seenM.has(p.m)) { seenM.add(p.m); const o = document.createElement('option'); o.value = p.m; o.textContent = '+' + p.m + ' month' + (p.m > 1 ? 's' : '') + ' (' + md(p.date) + ')'; R('projm').appendChild(o); }
        if (!seenS.has(p.scenario)) { seenS.add(p.scenario); const o = document.createElement('option'); o.value = p.scenario; o.textContent = p.scenario_label; R('projsc').appendChild(o); } });
      if (!seenM.has(+V.proj.m)) V.proj.m = PB.proj[0].m; if (!seenS.has(V.proj.sc)) V.proj.sc = PB.proj[0].scenario;
      R('projm').value = String(V.proj.m); R('projsc').value = V.proj.sc;
      const go = () => { V.proj.on = R('projon').checked; V.proj.m = +R('projm').value; V.proj.sc = R('projsc').value; store.set('img.proj', V.proj);
        load(V.proj.on ? PB.date : (V.scan ? V.scan.date : PB.date)).catch(() => {}); };
      R('projon').onchange = go; R('projm').onchange = R('projsc').onchange = () => { if (!R('projon').checked) { V.proj.m = +R('projm').value; V.proj.sc = R('projsc').value; store.set('img.proj', V.proj); return; } go(); }; }
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
  /* ---- brightness matching (imaging/viewer_mock/tone.py): the same tissue at the same grey on every scan date. Display only.
     Each scan carries the knots {x, y} of a piecewise-linear map from its own values to standard levels (air 0 … white matter 1000 …);
     the map is applied to the loaded image in the browser (a copy of the scan's own values is kept to switch back), and the contrast
     sliders then work on the fixed range 0…TONE.top, so a setting means the same on every date. A scan without a map (not a T1) keeps its own. ---- */
  const TONE = IMG_DATA.tone || null;
  function applyTone() {
    const v = V.nv && V.nv.volumes[0]; if (!v || !V.scan) return;
    const T = V.scan.tone, h = v.hdr || {}, plain = (!h.scl_slope || h.scl_slope === 1) && !h.scl_inter && v.img && v.img.BYTES_PER_ELEMENT <= 2;   // whole-number brightness, as our exports are
    V.R('tonel').textContent = !TONE || !V.tone ? '' : !T ? 'this scan is a different kind: shown with its own contrast' : !plain ? 'not available for this file' : '';
    const want = !!(V.tone && TONE && T && plain);
    if (want && !V.toned) {
      if (!V.raw) { V.raw = v.img.slice(); V.rawStats = {gmin: v.global_min, gmax: v.global_max, rmin: v.robust_min, rmax: v.robust_max}; }
      const raw = V.raw, img = v.img, x = T.x, y = T.y, n = x.length;
      let lo = Infinity, hi = -Infinity; for (let i = 0; i < raw.length; i++) { const q = raw[i]; if (q < lo) lo = q; if (q > hi) hi = q; }
      const lut = new Int16Array(hi - lo + 1); let top = 0;
      for (let q = lo; q <= hi; q++) { let k = 1; while (k < n - 1 && q > x[k]) k++;   // the segment q falls in (the last one also carries values above the top knot)
        const m = Math.max(0, Math.min(32767, Math.round(y[k - 1] + (q - x[k - 1]) * (y[k] - y[k - 1]) / (x[k] - x[k - 1])))); lut[q - lo] = m; if (m > top) top = m; }
      for (let i = 0; i < raw.length; i++) img[i] = lut[raw[i] - lo];
      v.global_min = 0; v.global_max = top; v.robust_min = 0; v.robust_max = TONE.top; V.toned = true;
    } else if (!want && V.toned) {
      v.img.set(V.raw); const s = V.rawStats; v.global_min = s.gmin; v.global_max = s.gmax; v.robust_min = s.rmin; v.robust_max = s.rmax; V.toned = false;
    }
  }
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
      radio: V.radio, noseLeft: V.noseLeft, glass: +V.R('glass').value, dose: Object.assign({}, V.dose), perf: Object.assign({}, V.perf),
      swell: Object.assign({}, V.swell), grid: Object.assign({}, V.grid), tone: !!V.tone, ser: V.ser || ''};
  }
  /* opening = the viewer is opening with this view (the default): position, layout and contrast apply, but the colour layers
     (radiation, perfusion, swelling) stay off until the user picks a view or a layer */
  async function recall(v, opening) {
    if (V.proj.on) { V.proj.on = false; V.R('projon').checked = false; }   // a saved view is a real scan, never the simulation
    V.ser = opening ? '' : (v.ser || '');   // a picked view shows the series it was saved with; the viewer itself always opens on the measured one
    if (!V.scan || V.scan.date !== v.date || V.scan.sim || (V.scan.ser ? V.scan.ser.key : '') !== V.ser) await load(v.date);
    if (v.tone !== undefined && !!v.tone !== !!V.tone) { V.tone = !!v.tone; store.set('img.tone', V.tone); V.R('tone').checked = V.tone; applyTone(); }
    const nv = V.nv, NV = V.NV;
    V.disp = Object.assign({}, DDEF, v.disp || (v.single ? {layout: 'axial'} : {}));
    if (opening && V.disp.layout === 'grid') V.disp.layout = 'auto';   // views saved with the old default open in the new one (row on wide screens, grid on tall)
    store.set('img.disp', V.disp);
    V.el.querySelectorAll('[data-o]').forEach(c => { const k = c.dataset.o; if (c.type === 'checkbox') c.checked = !!V.disp[k]; else c.value = String(V.disp[k]); });
    V.R('op').value = v.op; nv.setOpacity(LI(), v.op / 100);
    V.cut = v.cut; V.R('cut').classList.toggle('on', V.cut); applyDisplay();
    setContrast(v.lo, v.hi, v.mid);
    if (v.radio !== undefined) { V.radio = v.radio; V.noseLeft = v.noseLeft; applyOrient(); }
    if (v.glass !== undefined) { V.R('glass').value = v.glass; applyGlass(); }
    if (v.perf && !opening) { V.perf = Object.assign({}, v.perf); savePerf(); V.R('perf').value = V.perf.key; V.R('pmin').value = V.perf.min; V.R('pop').value = V.perf.op; V.R('pminl').textContent = (V.perf.min / 100).toFixed(1) + '×'; await applyPerf(); }
    if (v.swell && !opening) { V.swell = Object.assign({}, v.swell); saveSwell(); V.R('swell').value = V.swell.key; V.R('sthr').value = String(V.swell.thr); V.R('sop').value = V.swell.op; await applySwell(); }
    if (v.grid && !opening) { V.grid = Object.assign({x: 4}, v.grid); store.set('img.grid', {x: V.grid.x}); V.R('sgrid').checked = !!V.grid.on; V.R('sgx').value = String(V.grid.x); await applyGrid(); }
    if (v.dose && !opening) { V.dose = Object.assign({}, v.dose); saveDose(); V.R('dose').value = V.dose.key; V.R('dop').value = V.dose.op; V.R('dlines').checked = V.dose.lines; V.R('dblend').value = V.dose.blend ?? 25; await applyDose(); }
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
    nv.setSliceMosaicString(''); nv.setHeroImage(0); const lay = layOf(d);
    if (['grid', 'row', 'column', 'hero'].includes(lay)) {
      nv.setSliceType(ST.MULTIPLANAR);
      nv.setMultiplanarLayout({grid: NV.MULTIPLANAR_TYPE.GRID, row: NV.MULTIPLANAR_TYPE.ROW, column: NV.MULTIPLANAR_TYPE.COLUMN, hero: NV.MULTIPLANAR_TYPE.ROW}[lay]);
      if (lay === 'hero') { nv.opts.heroSliceType = ST.AXIAL; nv.setHeroImage(0.6); }
    } else if (lay === 'lightbox') { nv.setSliceType(ST.AXIAL); nv.setSliceMosaicString(lightboxString()); }
    else nv.setSliceType({axial: ST.AXIAL, coronal: ST.CORONAL, sagittal: ST.SAGITTAL, render: ST.RENDER}[lay]);
    if (V.rowLay !== (lay === 'row')) { V.rowLay = lay === 'row'; requestAnimationFrame(() => sizeBox(IDV)); }
    // lesions filled or outlined, pixels, crosshair, labels
    // outline only = NiiVue's label outline with the fill made fully transparent (outline needs the label intent, set at load)
    nv.setAtlasOutline(d.outline === 'outline' ? 1 : 0);
    if (LI() >= 0) nv.setOpacity(LI(), d.outline === 'outline' ? 0 : V.R('op').value / 100);   // outlines may not be loaded yet (e.g. the phone turns first)
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
  /* ---- radiation dose overlay (imaging/radiation_dose; estimated, except a map marked `real`): colour wash + isodose lines; volumes after t1c and lesions ---- */
  const LV = () => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('lesions_'));   // the lesion label layer (its position changes when dose layers are added)
  const LI = () => V.nv.volumes.indexOf(LV());
  function saveDose() { store.set('img.dose', V.dose); }
  const doseVol = kind => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('dose' + kind + '_'));
  /* 3D: overlays are drawn solid by default, so the dose hid the head (seen 2026-11-15). While a dose is shown: see-through overlays
     (renderOverlayBlend) and the cut plane also cuts the overlays (isClipAllVolumes); back to normal when dose is off. */
  // the dose map is on the baseline grid: it fits every scan shown aligned onto that grid (not a scan without lesions)
  const doseOK = () => !!(V.scan && V.scan.aligned && V.scan.lesions.length);
  function applyDose3D() { if (!V.nv) return; const on = !!(DOSE && V.dose.key && doseOK()) || !!perfVol() || !!swellVol();   // the perfusion and swelling layers too
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
      ` · <span title="${esc(DOSE.notes[m.key] || (m.key === 'total_gy' ? 'Each course added in plain Gy, not adjusted for dose per session.': 'Each course added as EQD2 (alpha/beta 2, normal brain)'))}">${m.real ? "hospital's dose file ⓘ" : 'how estimated ⓘ'}</span>`;
  }
  /* ---- perfusion layer (imaging/perfusion): blood flow (ASL) or blood volume (rCBV) as × normal brain, ×100, on the baseline grid ---- */
  function savePerf() { store.set('img.perf', V.perf); }
  const perfVol = () => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('perf_'));
  const PCM = 'plasma', PMAX = 300;   // colour map and top of the scale (3× normal brain, ×100)
  /* colour scale drawn from NiiVue's own colour map, so it matches the image: show-above level → 3×, ticks every 0.5× */
  function perfScale() {
    const cm = V.nv.colormapFromKey(PCM), lo = V.perf.min, W = 170;
    const grad = cm.I.map((i, k) => `rgb(${cm.R[k]},${cm.G[k]},${cm.B[k]}) ${(i / 255 * 100).toFixed(1)}%`).join(',');
    let ticks = lo % 50 ? `<span style="position:absolute;left:0;top:13px;transform:translateX(-50%);font-size:9.5px;color:var(--ink)">${(lo / 100).toFixed(1)}</span>` : '';
    for (let v = Math.ceil(lo / 50) * 50; v <= PMAX; v += 50) { if (lo % 50 && v - lo < 25) continue; const x = (v - lo) / (PMAX - lo) * W;
      ticks += `<span style="position:absolute;left:${x}px;top:10px;height:4px;border-left:1px solid var(--muted)"></span>` +
               `<span style="position:absolute;left:${x}px;top:13px;transform:translateX(-50%);font-size:9.5px;color:var(--muted)">${v / 100}${v === PMAX ? '×+' : ''}</span>`; }
    return `<span title="Colour = × normal brain on this scan. Below ${(lo / 100).toFixed(1)}×: no colour (move 'show above'). Over 3×: brightest yellow." ` +
      `style="position:relative;display:inline-block;width:${W}px;height:26px;vertical-align:middle;margin:0 18px 0 6px">` +
      `<span style="position:absolute;left:0;top:0;width:${W}px;height:10px;border-radius:2px;background:linear-gradient(to right,${grad})"></span>${ticks}</span>`;
  }
  function perfLegend() { const m = V.scan && (V.scan.perf || []).find(x => x.key === V.perf.key); if (!m) return;
    // the scale sits right above the images (pscale); the bar keeps only the reading note
    const sc = V.R('pscale'); sc.style.display = 'block';
    sc.innerHTML = `<span style="white-space:nowrap"><b style="color:#e05ad0">${m.key === 'asl' ? 'Blood flow (ASL)' : 'Blood volume (rCBV)'}</b> × normal brain</span>${perfScale()}<span style="white-space:nowrap">no colour below ${(V.perf.min / 100).toFixed(1)}×</span>` +
      (m.note ? ` <span style="color:#e0a020">${esc(m.note)}</span>` : '');   // e.g. a map we computed ourselves because the hospital sent none (from the data)
    V.R('plegend').innerHTML = 
      `<span title="${m.note ? esc(m.note[0].toUpperCase() + m.note.slice(1)) + '. Our estimate, not a reading.' : "Our estimate from the hospital's map, not a reading."} ${m.key === 'asl' ? 'Bright stripes along the back and midline can be blood still in the arteries (ASL arterial transit), not tumor.' : 'Veins, sinuses and the brain surface are bright on this map; a lesion against them borrows their value.'} Normal grey matter reads above 1× because normal brain mixes grey and white matter. The map covers ${m.key === 'asl' ? 'most of the head' : 'a slab of the head only'}.">how to read ⓘ</span>`; }
  async function applyPerf() {
    if (!V.nv) return; const nv = V.nv;
    const tok = V.perfTok = (V.perfTok || 0) + 1;
    for (const v of nv.volumes.filter(v => v.name && v.name.startsWith('perf_'))) nv.removeVolume(v);
    const m = V.scan && (V.scan.perf || []).find(x => x.key === V.perf.key);
    V.R('plegend').textContent = V.perf.key && !m ? 'no ' + (V.perf.key === 'asl' ? 'blood-flow' : 'blood-volume') + ' map for this scan (' + SCANS.filter(s => (s.perf || []).some(x => x.key === V.perf.key)).length + ' scans have one)' : '';
    if (!m) { V.R('pscale').style.display = 'none'; applyDose3D(); nv.drawScene(); return; }
    const v = await nv.addVolumeFromUrl({url: m.file, name: 'perf_' + m.key + '.nii.gz', colormap: PCM, opacity: V.perf.op / 100, cal_min: V.perf.min, cal_max: PMAX});
    if (tok !== V.perfTok || !V.scan || !(V.scan.perf || []).includes(m)) { if (nv.volumes.includes(v)) nv.removeVolume(v); nv.drawScene(); return; }
    nv.moveVolumeToTop(LV()); applyDose3D(); nv.drawScene(); perfLegend();
  }
  function perfAt(mm) { const p = perfVol(); if (!p || !mm) return '';
    const v = p.getValue(...p.mm2vox(mm)); return v > 0 ? ` · ${V.perf.key === 'asl' ? 'flow' : 'blood volume'} here ${(v / 100).toFixed(1)}× normal brain` : ''; }
  /* ---- swelling layer (imaging/swelling/stretch_layer.py): % more (+) or less (−) room than on the normal control MRI, ×10,
     on a 2 mm grid in the scan's own space. Two colour maps: warm = more room (swollen), cool = less room (shrunk / squeezed).
     Colour starts at the 'show beyond' level: by default the scan's own normal range (lo…hi of the lesion-free brain, from the data),
     because inside that range the map cannot tell a change from noise. Scale top: ±SMAX %. ---- */
  function saveSwell() { store.set('img.swell', V.swell); }
  const swellVol = () => V.nv && V.nv.volumes.find(v => v.name && v.name.startsWith('swell_'));
  const SCMP = 'warm', SCMN = 'winter', SMAX = 40;
  const swellOf = () => V.scan && (V.scan.swell || []).find(x => x.key === V.swell.key);
  const swellBand = m => V.swell.thr > 0 ? [-V.swell.thr, V.swell.thr] : [m.lo, m.hi];   // % below / above which colour shows
  function swellLevels() { const p = swellVol(), m = swellOf(); if (!p || !m) return; const [lo, hi] = swellBand(m);
    p.cal_min = hi * 10; p.cal_max = SMAX * 10; p.cal_minNeg = -SMAX * 10; p.cal_maxNeg = lo * 10;
    V.nv.updateGLVolume(); swellLegend(); }
  function swellScale(lo, hi) {
    const grad = (key, rev) => { const cm = V.nv.colormapFromKey(key), st = cm.I.map((i, k) => [i / 255 * 100, `rgb(${cm.R[k]},${cm.G[k]},${cm.B[k]})`]);
      return (rev ? st.map(([p, c]) => [100 - p, c]).reverse() : st).map(([p, c]) => `${c} ${p.toFixed(1)}%`).join(','); };
    const W = 96, lab = (x, t, a) => `<span style="position:absolute;left:${x}px;top:13px;transform:translateX(${a || '-50%'});font-size:9.5px;color:var(--muted);white-space:nowrap">${t}</span>`;
    return `<span title="Blue = less room than on the control MRI (shrunk or squeezed), red to yellow = more room (swollen). Nothing is coloured between ${lo}% and +${hi}%." style="position:relative;display:inline-block;width:${2 * W + 46}px;height:26px;vertical-align:middle;margin:0 16px 0 6px">` +
      `<span style="position:absolute;left:0;top:0;width:${W}px;height:10px;border-radius:2px;background:linear-gradient(to right,${grad(SCMN, true)})"></span>` +
      `<span style="position:absolute;left:${W}px;top:0;width:46px;height:10px;text-align:center;font-size:9px;line-height:10px;color:var(--muted)">no colour</span>` +
      `<span style="position:absolute;left:${W + 46}px;top:0;width:${W}px;height:10px;border-radius:2px;background:linear-gradient(to right,${grad(SCMP)})"></span>` +
      lab(0, '−' + SMAX + '%', '0') + lab(W, lo + '%', '-100%') + lab(W + 46, '+' + hi + '%', '0') + lab(2 * W + 46, '+' + SMAX + '%', '-100%') + `</span>`;
  }
  function swellLegend() { const m = swellOf(); if (!m) return; const [lo, hi] = swellBand(m), sc = V.R('sscale'); sc.style.display = 'block';
    const ctl = IMG_DATA.swelling && IMG_DATA.swelling.control;
    sc.innerHTML = `<span style="white-space:nowrap"><b style="color:#ff7a59">Swelling</b> · room vs the ${ctl ? fd(ctl) : 'control'} MRI</span>${swellScale(lo, hi)}` +
      `<span style="white-space:nowrap">${V.swell.thr > 0 ? 'your level: ±' + V.swell.thr + '%' : 'this scan\'s normal range: ' + lo + '% to +' + hi + '%'}</span>`;
    V.R('slegend').innerHTML = `<span title="${esc((IMG_DATA.swelling && IMG_DATA.swelling.limits) || '')} ${m.key === 'avg' ? 'This map is the average over the brain within 15 mm of each point, the same measure the Swelling-by-lesion chart plots.' : 'This map is the fit itself (about 4 mm detail); it is noisier than the 15 mm average.'} Fluid spaces count too (bigger ventricles read as more room). Our estimate, not a reading.">how to read ⓘ</span>`; }
  async function applySwell() {
    if (!V.nv) return; const nv = V.nv;
    const tok = V.swellTok = (V.swellTok || 0) + 1;
    for (const v of nv.volumes.filter(v => v.name && v.name.startsWith('swell_'))) nv.removeVolume(v);
    const m = swellOf();
    V.R('slegend').textContent = V.swell.key && !m ? 'no swelling map for this scan (' + SCANS.filter(s => (s.swell || []).some(x => x.key === V.swell.key)).length + ' scans have one)' : '';
    if (!m) { V.R('sscale').style.display = 'none'; applyDose3D(); nv.drawScene(); return; }
    const [lo, hi] = swellBand(m);
    const v = await nv.addVolumeFromUrl({url: m.file, name: 'swell_' + m.key + '.nii.gz', colormap: SCMP, colormapNegative: SCMN, opacity: V.swell.op / 100,
      cal_min: hi * 10, cal_max: SMAX * 10, cal_minNeg: -SMAX * 10, cal_maxNeg: lo * 10});
    if (tok !== V.swellTok || !V.scan || !(V.scan.swell || []).includes(m)) { if (nv.volumes.includes(v)) nv.removeVolume(v); nv.drawScene(); return; }
    nv.moveVolumeToTop(LV()); applyDose3D(); swellLevels(); nv.drawScene();
  }
  function swellAt(mm) { const p = swellVol(); if (!p || !mm) return '';
    const v = p.getValue(...p.mm2vox(mm)); return v ? ` · room here ${v > 0 ? '+' : '−'}${Math.abs(v / 10).toFixed(0)}% vs the control MRI` : ''; }
  /* ---- bent grid (imaging/swelling/grid_layer.py): the same flexible fit as the swelling layers, shown as movement. Each scan has
     one small file (4 mm grid; five whole-number layers: movement along patient right / front / up in 0.01 mm, room change in % × 10,
     depth inside the brain outline in 0.1 mm). On every slice view a straight grid is laid on the slice and each point is moved by
     the in-slice part of the movement, drawn V.grid.x times larger than real; lines are coloured like the colour layer (grey inside
     the scan's normal range). Drawn as lines on a canvas over NiiVue's, redrawn after every NiiVue draw, from NiiVue's own record
     of where each slice view sits (screenSlices: checked against canvasPos2frac in all four left/right and nose settings, 2026-11-18). ---- */
  const GRIDS = new Map();   // file -> Promise of the parsed file
  async function gridFile(url) {
    if (!GRIDS.has(url)) GRIDS.set(url, (async () => {
      const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
      let buf = await r.arrayBuffer(); const m = new Uint8Array(buf, 0, 2);
      if (m[0] === 0x1f && m[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const dv = new DataView(buf), dim = i => dv.getInt16(40 + 2 * i, true), nx = dim(1), ny = dim(2), nz = dim(3), nt = dim(4), off = dv.getFloat32(108, true);
      if (dv.getInt32(0, true) !== 348 || dv.getInt16(70, true) !== 4 || nt < 5) throw new Error('not a grid file');
      const M = [0, 1, 2].map(i => [0, 1, 2, 3].map(j => dv.getFloat32(280 + 16 * i + 4 * j, true))), [a, b, c] = M;   // voxel -> world, from the header
      const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      const inv = [[(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
                   [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
                   [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det]];
      return {nx, ny, nz, d: new Int16Array(buf, off, nx * ny * nz * nt), inv, t: [a[3], b[3], c[3]]};
    })().catch(e => { GRIDS.delete(url); throw e; }));
    return GRIDS.get(url);
  }
  const GSC = [0.01, 0.01, 0.01, 0.1, 0.1];
  /* the file's five values at a world point (trilinear): out = [right, front, up movement in mm, room change %, depth inside the brain mm]; false outside the file */
  function gridAt(G, mm, out) {
    const x = mm[0] - G.t[0], y = mm[1] - G.t[1], z = mm[2] - G.t[2], I = G.inv;
    const fi = I[0][0] * x + I[0][1] * y + I[0][2] * z, fj = I[1][0] * x + I[1][1] * y + I[1][2] * z, fk = I[2][0] * x + I[2][1] * y + I[2][2] * z;
    if (!(fi >= 0 && fj >= 0 && fk >= 0 && fi <= G.nx - 1 && fj <= G.ny - 1 && fk <= G.nz - 1)) return false;
    const i = Math.min(G.nx - 2, fi | 0), j = Math.min(G.ny - 2, fj | 0), k = Math.min(G.nz - 2, fk | 0), u = fi - i, v = fj - j, w = fk - k;
    const sy = G.nx, sz = G.nx * G.ny, n = sz * G.nz, o = i + j * sy + k * sz, d = G.d;
    const w0 = (1 - u) * (1 - v) * (1 - w), w1 = u * (1 - v) * (1 - w), w2 = (1 - u) * v * (1 - w), w3 = u * v * (1 - w), w4 = (1 - u) * (1 - v) * w, w5 = u * (1 - v) * w, w6 = (1 - u) * v * w, w7 = u * v * w;
    for (let q = 0; q < 5; q++) { const p = o + q * n;
      out[q] = (d[p] * w0 + d[p + 1] * w1 + d[p + sy] * w2 + d[p + sy + 1] * w3 + d[p + sz] * w4 + d[p + sz + 1] * w5 + d[p + sz + sy] * w6 + d[p + sz + sy + 1] * w7) * GSC[q]; }
    return true;
  }
  /* line colours: the colour layer's own maps in 12 steps each (so lines and wash agree), grey inside the normal range */
  let GLUT = null;
  function gridLut() { if (GLUT) return GLUT;
    const mk = key => { const cm = V.nv.colormapFromKey(key), n = 12, o = [];
      for (let q = 0; q < n; q++) { const f = (q + 0.5) / n * 255; let k = 1; while (k < cm.I.length - 1 && cm.I[k] < f) k++;
        const t = Math.max(0, Math.min(1, (f - cm.I[k - 1]) / Math.max(1, cm.I[k] - cm.I[k - 1]))), mix = ch => Math.round(cm[ch][k - 1] + (cm[ch][k] - cm[ch][k - 1]) * t);
        o.push(`rgb(${mix('R')},${mix('G')},${mix('B')})`); } return o; };
    return GLUT = {warm: mk(SCMP), cool: mk(SCMN)}; }
  const gridBand = () => { if (V.swell.thr > 0) return [-V.swell.thr, V.swell.thr];
    const f = V.scan && (V.scan.swell || []).find(x => x.key === 'fine'); return f ? [f.lo, f.hi] : [-10, 10]; };   // the grid shows the fit as it is: the 'fine detail' range
  const GREY = 'rgba(255,255,255,0.55)';
  const gridColour = (pct, lo, hi, L) => pct > hi ? L.warm[Math.min(11, Math.max(0, Math.floor((pct - hi) / (SMAX - hi) * 12)))]
    : pct < lo ? L.cool[Math.min(11, Math.max(0, Math.floor((lo - pct) / (SMAX + lo) * 12)))] : GREY;
  const HV = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];   // per slice view (axial, coronal, sagittal): the world axis that runs across, up, and into the screen
  function drawGrid() {
    const cv = V.R && V.R('gridcv'), nv = V.nv; if (!cv || !nv) return;
    const gl = nv.gl.canvas; if (cv.width !== gl.width || cv.height !== gl.height) { cv.width = gl.width; cv.height = gl.height; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    const G = V.gridData; if (!V.grid.on || !G || !V.scan || G.date !== V.scan.date) return;
    const tiles = (nv.screenSlices || []).filter(s => s.axCorSag <= 2 && s.AxyzMxy && s.AxyzMxy.length >= 5 && s.fovMM && s.fovMM[0] && s.fovMM[1]);
    if (!tiles.length) return;
    const X = V.grid.x, [lo, hi] = gridBand(), L = gridLut(), out = new Float32Array(5), mm = [0, 0, 0];
    const ppm = Math.abs(tiles[0].leftTopWidthHeight[2] / tiles[0].fovMM[0]);        // screen pixels per mm
    const S = [4, 6, 8, 10, 12, 16, 20, 24].find(q => q * ppm >= 14) || 24, step = Math.max(1, 2 / ppm);   // squares at least ~14 px; a sample every ~2 px (1 mm at least)
    if (S !== V.gridStep) { V.gridStep = S; gridLegend(); }
    g.lineWidth = Math.max(1, (nv.uiData && nv.uiData.dpr) || 1); g.lineJoin = 'round';
    for (const s of tiles) {
      const [ih, iv, id] = HV[s.axCorSag], lt = s.leftTopWidthHeight, a = s.AxyzMxy, m0 = s.leftTopMM, f = s.fovMM;
      const h0 = Math.min(m0[0], m0[0] + f[0]), h1 = Math.max(m0[0], m0[0] + f[0]), v0 = Math.min(m0[1], m0[1] + f[1]), v1 = Math.max(m0[1], m0[1] + f[1]);
      const px = h => lt[0] + (h - m0[0]) / f[0] * lt[2], py = v => lt[1] + (1 - (v - m0[1]) / f[1]) * lt[3];
      g.save(); g.beginPath(); g.rect(Math.min(lt[0], lt[0] + lt[2]), lt[1], Math.abs(lt[2]), lt[3]); g.clip();
      const line = (alongV, cst, t0, t1) => { let open = false, col = '';
        for (let t = t0; t <= t1; t += step) { const h = alongV ? cst : t, v = alongV ? t : cst;
          mm[ih] = h; mm[iv] = v; mm[id] = a[2] + a[4] * (v - a[1]) - a[3] * (h - a[0]);      // the point of this slice under that screen position
          if (!gridAt(G, mm, out) || out[4] <= 0) { if (open) { g.stroke(); open = false; } continue; }   // outside the brain: the line stops
          const x = px(h + X * out[ih]), y = py(v + X * out[iv]), c = gridColour(out[3], lo, hi, L);
          if (!open) { g.beginPath(); g.strokeStyle = c; g.moveTo(x, y); col = c; open = true; }
          else if (c !== col) { g.lineTo(x, y); g.stroke(); g.beginPath(); g.strokeStyle = c; g.moveTo(x, y); col = c; }
          else g.lineTo(x, y); }
        if (open) g.stroke(); };
      for (let h = Math.ceil(h0 / S) * S; h <= h1; h += S) line(true, h, v0, v1);
      for (let v = Math.ceil(v0 / S) * S; v <= v1; v += S) line(false, v, h0, h1);
      g.restore();
    }
  }
  function gridLegend() { const lg = V.R('sglegend'), m = V.scan && V.scan.grid; if (!V.grid.on || !m || !V.gridData) return;
    const ctl = IMG_DATA.swelling && IMG_DATA.swelling.control, [lo, hi] = gridBand();
    lg.innerHTML = (m.control ? 'the control MRI itself: the grid is straight by definition' :
      `the ${ctl ? fd(ctl) : 'control'} grid moved with the tissue, drawn ×${V.grid.x}${V.grid.x > 1 ? ' larger than real' : ''} · tissue moved ${m.moved_mm.median} mm typically (1 in 20 places over ${m.moved_mm.p95} mm)`) +
      ` · squares ${V.gridStep || '–'} mm · <span title="${esc('Each grid point is a piece of brain as it lay on the control MRI, drawn where that piece sits on this scan (only the part of the movement that lies in the slice; the movement is multiplied so it shows). Lines spreading apart = that tissue takes more room than on the control MRI, crowding together = less. Grey lines = inside this scan\'s normal range (' + lo + '% to +' + hi + '%), coloured like the colour layer beyond it. Before drawing, one shift and turn of the whole brain left over from lining the two scans up (' + (m.whole_brain ? m.whole_brain.shift_mm + ' mm, ' + m.whole_brain.turn_deg + '°' : 'small') + ') is taken out. It is the same fit as the colour layer, with the same limits: large effects only, understated about 3×; scanner differences bend the grid a little everywhere. Our estimate, not a reading.')}">how to read ⓘ</span>`; }
  async function applyGrid() {
    const lg = V.R('sglegend'), m = V.scan && V.scan.grid; V.gridData = null; V.gridTok = (V.gridTok || 0) + 1; const tok = V.gridTok;
    if (!V.grid.on) { lg.textContent = ''; drawGrid(); return; }
    if (!m) { lg.textContent = 'no bent grid for this scan (' + SCANS.filter(s => s.grid).length + ' scans have one)'; drawGrid(); return; }
    if (typeof DecompressionStream === 'undefined') { lg.textContent = 'this browser cannot unpack the grid file (it needs a browser from 2023 or later)'; drawGrid(); return; }
    const date = V.scan.date; lg.textContent = 'loading the grid…';
    try { const G = await gridFile(m.file); if (tok !== V.gridTok || !V.scan || V.scan.date !== date) return;
      V.gridData = Object.assign({date}, G); V.gridStep = 0; gridLegend(); if (V.nv) V.nv.drawScene(); }
    catch (e) { if (tok === V.gridTok) { lg.textContent = 'could not load the grid (' + e.message + ')'; drawGrid(); } }
  }
  function gridHere(mm) { const G = V.gridData; if (!V.grid.on || !G || !mm || !V.scan || !V.scan.grid || V.scan.grid.control) return '';
    const o = new Float32Array(5); if (!gridAt(G, mm, o) || o[4] <= 0) return '';
    return ` · tissue here moved ${Math.hypot(o[0], o[1], o[2]).toFixed(1)} mm since the control MRI`; }
  /* test with a known answer (browser console): the page must read, at three brain points, the values grid_layer.py wrote for them */
  V.gridCheck = async () => { const m = V.scan && V.scan.grid; if (!m) return null; const G = await gridFile(m.file), o = new Float32Array(5); let mmErr = 0, pctErr = 0, n = 0;
    (m.probe || []).forEach(p => { if (!gridAt(G, p.slice(0, 3), o)) return; n++; for (let q = 0; q < 3; q++) mmErr = Math.max(mmErr, Math.abs(o[q] - p[3 + q])); pctErr = Math.max(pctErr, Math.abs(o[3] - p[6])); });
    return {date: V.scan.date, points: n, worst_mm: +mmErr.toFixed(3), worst_pct: +pctErr.toFixed(2), ok: n === (m.probe || []).length && mmErr <= 0.02 && pctErr <= 0.2}; };
  function doseAt(mm) { const w = doseVol('wash'); if (!w || !mm) return '';
    const m = DOSE.maps.find(x => x.key === V.dose.key); const v = w.getValue(...w.mm2vox(mm)); return ` · dose here ≈ ${(v / 10).toFixed(1)} ${m.unit} (${m.real ? 'dose file' : 'estimated'})`; }
  function sizeBox(id) { if (!V.el) return; const box = V.R('box');
    const rowH = V.rowLay && box.clientWidth ? Math.max(200, Math.round(box.clientWidth / 4) + 6) : 0;   // four views in a row: one square view tall
    /* a narrow screen (a phone) with the panel still at its standard height: about as tall as it is wide, which is what the four
       views take when they sit two by two (at the standard 520 px half the box was empty). A height the person chose stands. */
    const def = hOf(id, PANELS[id].h0), sq = innerWidth <= 760 && def === PANELS[id].h0 && box.clientWidth ? Math.min(def, Math.round(box.clientWidth * 1.08)) : def;
    const h = V.full ? Math.max(300, innerHeight - (box.getBoundingClientRect().top - V.el.getBoundingClientRect().top) - 50) : (V.size || rowH || sq);
    box.style.height = h + 'px'; V.R('list').style.maxHeight = (h + 30) + 'px';
    V.R('size').value = h; V.R('sizel').textContent = V.full ? 'full window' : V.size ? h + ' px' : 'panel height';
    if (V.nv) requestAnimationFrame(() => V.nv.resizeListener()); }
  async function lib() { if (!V.NV) { V.R('status').textContent = 'loading NiiVue…'; V.NV = await import(NIIVUE); } return V.NV; }
  /* ---- simulated future scan (volumetry/growth_model.py + viewer_mock/make_projection.py): the latest measured scan's images with
     each outline grown or shrunk to its projected size. It is a 'scan' object like the real ones (same images, other outlines and
     volumes, marked sim), so everything else in the viewer works on it unchanged. ---- */
  function projBase() { return SCANS.find(s => s.proj && s.proj.length) || null; }
  const SIMS = new Map();
  function simScan(base) { const p = base.proj.find(x => x.m === +V.proj.m && x.scenario === V.proj.sc) || base.proj[0];
    if (!SIMS.has(p.key)) SIMS.set(p.key, Object.assign({}, base, {labels: p.labels, lesions: p.lesions, sim: p, real: base, note: ''}));
    return SIMS.get(p.key); }
  function simBanner() { const b = V.R('simbar'), s = V.scan && V.scan.sim; if (!s) { b.style.display = 'none'; return; }
    const G = (IMG_DATA.growth && IMG_DATA.growth.projection) || {};
    b.style.display = 'block';
    b.innerHTML = `<b style="color:#e0a020">SIMULATION, not a scan.</b> These are the ${fd(V.scan.date)} images; each outline is drawn at the size it would have on <b>${fd(s.date)}</b> ` +
      `(+${s.m} month${s.m > 1 ? 's' : ''}) if <b>${esc(s.scenario_label)}</b>. ${esc((G.backtest && (G.backtest.short || G.backtest.text)) || '')} ` +
      `<span class="sub" title="${esc((G.backtest && G.backtest.text) || '')} ${esc(G.note || '')}">how it was tested ⓘ</span> · A scenario, not a forecast. Untick Simulate for the real outlines.`; }
  /* ---- other series of the same scan date (data: scan.series = [{key, label, short, file, badge, note, probe}], scan.series_main = the
     measured one's label), e.g. a FLAIR, or a copy rebuilt from a hospital website. Like the simulation it is a 'scan' object with one
     thing swapped, here the picture: outlines, volumes, 3D models and layers stay those of the measured series, so everything else in
     the viewer works unchanged. What the series is and how far to trust it comes from the data (badge, note) and is shown in a banner
     while it is up. No brightness matching (tone: null): another kind of picture keeps its own contrast. ---- */
  const SERS = new Map();
  function serScan(base, key) { const s = (base.series || []).find(x => x.key === key); if (!s) return base;
    const k = (base.sim ? base.sim.key : base.date) + '|' + key;
    /* a series can bring its own outlines and volumes (s.labels, s.lesions: provisional numbers taken on that series itself) */
    if (!SERS.has(k)) SERS.set(k, Object.assign({}, base, {t1c: s.file, tone: null, ser: s, main: base}, s.labels ? {labels: s.labels, lesions: s.lesions || []} : {}));
    return SERS.get(k); }
  function serBar(real) { const list = real.series || [], bar = V.R('serbar'), sel = V.R('series');
    bar.style.display = list.length ? '' : 'none'; sel.innerHTML = '';
    [{key: '', label: real.series_main || 'Measured series'}].concat(list).forEach(s => { const o = document.createElement('option'); o.value = s.key; o.textContent = s.label; sel.appendChild(o); });
    sel.value = V.ser || ''; }
  function serBanner() { const b = V.R('serban'), s = V.scan && V.scan.ser; if (!s) { b.style.display = 'none'; return; }
    const m = V.scan.series_main;
    b.style.display = 'block';
    b.innerHTML = `<b style="color:#e0a020">${esc(s.badge || 'Another series of this scan')}.</b> ${esc(s.note || '')} ` +
      (s.labels ? `The outlines and volumes shown here are ${esc(s.lesions_note || 'taken on this series')}.`
                : `The outlines and volumes come from ${m ? esc(m) : 'the measured series'}; they are drawn here only to show the place. Pick that one under Series to go back.`); }
  /* its own check (like gridCheck): the picture on screen must hold the values the data builder read at three points */
  V.seriesCheck = () => { const s = V.scan && V.scan.ser, v = V.nv && V.nv.volumes[0]; if (!s || !v || !s.probe) return null;
    let worst = 0; const got = s.probe.map(p => { const val = v.getValue(...v.mm2vox(p.ras)); worst = Math.max(worst, Math.abs(val - p.v)); return val; });
    return {series: s.key, points: s.probe.length, want: s.probe.map(p => p.v), got, worst}; };
  async function load(date) {
    const real = SCANS.find(s => s.date === date) || SCANS[0]; if (!real) return;
    blank(null);   // a scan was picked: drop the "no MRI yet" message
    if (V.proj.on && !(real.proj && real.proj.length)) { V.proj.on = false; V.R('projon').checked = false; }   // the simulation exists for the latest measured scan only
    if (V.ser && !(real.series || []).some(x => x.key === V.ser)) V.ser = '';   // this date has no such series: its measured one
    serBar(real);
    let scan = V.proj.on ? simScan(real) : real;
    if (V.ser) scan = serScan(scan, V.ser);
    if (V.scan === scan && V.nv) return;
    /* switching between the real outlines and a simulation of the same scan: stay where the user is looking */
    V.keep = V.nv && V.scan && V.scan.date === scan.date ? {mm: Array.from(V.nv.frac2mm(V.nv.scene.crosshairPos)).slice(0, 3), pan: Array.from(V.nv.scene.pan2Dxyzmm || [0, 0, 0, 1]),
      az: V.nv.scene.renderAzimuth, el: V.nv.scene.renderElevation} : null;
    V.scan = scan; V.R('scan').value = scan.date; V.picked = null;   // picked: the lesion the user chose while this scan was loading
    /* one load at a time: NiiVue's loads overlap badly (an older scan finishing last replaced the newer one).
       Each pick waits for the load before it; picks that were overtaken while waiting are skipped. */
    const tok = V.loadTok = (V.loadTok || 0) + 1;
    const p = V.queue = (V.queue || Promise.resolve()).catch(() => {})
      .then(() => tok === V.loadTok ? loadNow(scan).catch(err => { if (tok === V.loadTok) loadFailed(scan, err); throw err; }) : null);
    p.catch(() => {});   // reported in the viewer by loadFailed; callers that wait still see the failure
    return p;
  }
  /* A scan that can't be fetched: say which one and why, in words, instead of leaving "loading scan…" up (seen 2026-11-18 on a
     copy of the site without the scan files: the first pick showed "Error: Not Found", every later pick stayed on "loading scan…").
     V.scan is cleared so picking the same date again tries again. */
  function loadFailed(scan, err) {
    const m = String((err && err.message) || err || ''), st = V.R('status');
    const why = /not found|404/i.test(m) ? 'the scan file is not on this server'
      : /failed to fetch|network|load failed|aborted/i.test(m) ? 'the connection to the server dropped'
      : m ? 'the scan could not be read (' + m + ')' : 'unknown error';
    V.scan = null; V.loading = null;
    if (scan.ser) { V.ser = ''; V.R('series').value = ''; V.R('serban').style.display = 'none'; }   // the next pick shows the measured series
    st.textContent = `Couldn't load the ${fd(scan.date)} scan${scan.ser ? ' (' + scan.ser.label + ')' : ''}: ${why}. Pick it again to retry, or choose another date.`;
    st.dataset.err = '1'; st.style.color = '#e0703a';
    console.warn('scan load failed', scan.date, err);
  }
  async function loadNow(scan) {
    const NV = await lib();
    if (!V.nv) {
      V.nv = new NV.Niivue({backColor: [0, 0, 0, 1], show3Dcrosshair: true, multiplanarShowRender: NV.SHOW_RENDER.ALWAYS,
        crosshairColor: [1, 1, 1, 0.55], dragAndDropEnabled: false, isColorbar: false, loadingText: 'loading scan…',
        /* slices in head (world) space, not along the scan's own grid: the follow-up scans sit on the baseline grid, which is
           tilted ~9° front-to-back, and in grid space the crosshair landed up to ~15 mm from the lesion it marks (seen 2026-11-17) */
        isSliceMM: true});
      await V.nv.attachToCanvas(V.R('cv'));
      V.nv.onLocationChange = d => readout(d);
      /* the bent grid lies on its own canvas over NiiVue's: redraw it after every NiiVue draw (NiiVue calls this.drawScene for every change) */
      const draw0 = V.nv.drawScene.bind(V.nv), after = () => { try { drawGrid(); } catch (e) { console.warn('bent grid', e); } };
      V.nv.drawScene = function () { const r = draw0.apply(null, arguments); if (r && typeof r.then === 'function') r.then(after, after); else after(); return r; };
    }
    V.R('status').textContent = 'loading scan…'; delete V.R('status').dataset.err; V.R('status').style.color = '';
    V.doseTok = (V.doseTok || 0) + 1;   // cancel any dose still loading for the previous scan
    await V.nv.loadVolumes([{url: scan.t1c, name: 't1c_' + scan.date + (scan.ser ? '_' + scan.ser.key : '') + '.nii.gz'}, {url: scan.labels, name: 'lesions_' + scan.date + (scan.ser && scan.ser.labels ? '_' + scan.ser.key : '') + '.nii.gz', opacity: V.R('op').value / 100}]);   // NiiVue reads the file type from the name
    V.raw = null; V.toned = false; applyTone();   // a fresh image: match its brightness (if on) before anything is drawn from it
    const L = scan.lesions, max = Math.max(0, ...L.map(l => l.n));
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
    lesionList(scan); simBanner(); serBanner(); V.R('status').textContent = '';
    if (!L.length) V.R('read').textContent = 'Click or drag in a view to move the crosshair; scroll to change slice; right-drag to adjust brightness.';   // not the previous scan's lesion
    applyContrast(); applyOrient(); applyGlass(); viewsBar(); await applyDose(); await applyPerf(); await applySwell(); await applyGrid();
    const big = L.slice().sort((a, b) => b.enh - a.enh)[0]; const pk = V.picked && scan.lesions.includes(V.picked) ? V.picked : null;
    if (pk) jump(pk, true);   // a lesion picked during loading wins (loading the images resets the crosshair, so go there again now)
    else if (V.keep && V.scan === scan) { const k = V.keep; V.nv.scene.crosshairPos = V.nv.mm2frac(k.mm); V.nv.setRenderAzimuthElevation(k.az, k.el); V.nv.setPan2Dxyzmm(k.pan); V.nv.drawScene();
      const here = scan.lesions.find(l => Math.hypot(l.ras[0] - k.mm[0], l.ras[1] - k.mm[1], l.ras[2] - k.mm[2]) < 12);   // same place as before: mark the lesion there, if any
      V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', !!here && e.dataset.id === here.id));
      if (here) say(here); else V.R('read').textContent = 'Click or drag in a view to move the crosshair; scroll to change slice; right-drag to adjust brightness.'; }
    else if (big) jump(big, true);
    V.keep = null;
  }
  const volOf = l => (typeof L !== 'undefined' && L.rule === 'old' && l.enh_old != null) ? l.enh_old : l.enh;   // outline rule switch
  function lesionList(scan) {   // (not 'list': that name is the viewer's own Library function)
    const box = V.R('list'); const tot = scan.lesions.reduce((a, l) => a + volOf(l), 0);
    if (!scan.lesions.length) { box.innerHTML = `<div class="sub" style="padding:3px 5px">${fd(scan.date)}${scan.field ? ' · ' + scan.field + ' scanner' : ''} · ${esc(scan.note || 'no lesions outlined')}</div>`; return; }
    const fld = scan.field ? (scan.field === '3T' ? ` · <b style="color:#e0a020" title="3T shows enhancement more strongly than 1.5T; our edge rule corrects most of it, small lesions can still differ">3T scanner ▲</b>` : ' · 1.5T scanner ◆') : '';
    if (scan.sim) {   // simulation: today's volume -> projected volume for each lesion, with what the projection cannot say
      const s = scan.sim, f2 = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' cm³' : Math.round(v) + ' mm³', now = scan.lesions.reduce((a, l) => a + l.now, 0);
      const G = (IMG_DATA.growth && IMG_DATA.growth.projection) || {}, mx = G.max_seen_mm3;
      box.innerHTML = `<div style="padding:3px 5px;font-size:12px"><b style="color:#e0a020">Simulated ${fd(s.date)}</b> <span class="sub">(+${s.m} mo · ${esc(s.scenario_label)})</span><br>` +
        `<span class="sub">total ${f2(now)} → <b>${f2(tot)}</b> · today → then</span></div>` +
        scan.lesions.map(l => { const tag = l.no_rate ? 'no rate yet (first scan with it): shown unchanged' : l.below ? 'under what a scan can show' : l.beyond ? 'larger than any lesion measured so far' + (mx ? ' (' + f2(mx) + ')' : '') + ': steady doubling cannot go on this long' : '';
          return `<div class="nvles" data-id="${l.id}" title="${esc(l.name)} · today ${l.now.toLocaleString()} mm³, ${l.now_mm} mm wide → ${l.enh.toLocaleString()} mm³` + (l.lo != null && l.hi > l.lo ? ` (${l.lo.toLocaleString()}–${l.hi.toLocaleString()} from the range of the two scans)` : '') + `, about ${l.axial} mm wide${tag ? '. ' + tag : ''}. Click to go there.">
          <span class="nvsw" style="background:rgb(${l.rgb})"></span><b>${l.id}</b><span class="sub" style="white-space:nowrap">${f2(l.now)} →</span><span class="v" style="color:${l.enh > l.now * 1.15 ? '#e34948' : l.enh < l.now * 0.87 ? '#1baf7a' : 'var(--muted)'}"><b>${f2(l.enh)}</b> · ${l.axial} mm${l.beyond ? ' ⚠' : ''}</span></div>`; }).join('');
      box.querySelectorAll('.nvles').forEach(e => e.onclick = () => { const l = V.scan && V.scan.lesions.find(x => x.id === e.dataset.id); if (l) jump(l); });
      return;
    }
    const shown = scan.ser ? `<div style="padding:0 5px 3px;font-size:11px;color:#e0a020" title="${esc(scan.ser.note || '')}">on screen: ${esc(scan.ser.short || scan.ser.label)}; outlines and volumes ${scan.ser.labels ? esc(scan.ser.lesions_note || 'taken on this series') : 'from ' + esc(scan.series_main || 'the measured series')}</div>` : '';
    box.innerHTML = `<div class="sub" style="padding:3px 5px">${fd(scan.date)} · ${scan.lesions.length} lesions · ${(tot / 1000).toFixed(1)} cm³ enhancing (our outlines${typeof L !== 'undefined' && L.rule === 'old' ? ', old 1.45× rule' : ''})${fld}</div>` + shown +
      scan.lesions.map(l => `<div class="nvles" data-id="${l.id}" title="${esc(l.name)} · ${volOf(l).toLocaleString()} mm³ · longest axial ${l.axial} mm. Click to go there.">
        <span class="nvsw" style="background:rgb(${l.rgb})"></span><b>${l.id}</b><span>${esc(l.name)}</span><span class="v">${(volOf(l) / 1000).toFixed(2)} cm³</span></div>`).join('') +
      ((scan.marks || []).length ? '<div class="sub" style="padding:5px 5px 1px">Plan points <span title="Points from a radiation plan file, placed on this scan through our alignment (about 1-2 mm). Click one: the crosshair moves onto it.">ⓘ</span></div>' +
        scan.marks.map(m => `<div class="nvles nvmark" data-mark="${esc(m.id)}" title="${esc(m.note)} Click to put the crosshair on it.">
        <span class="nvsw" style="background:rgb(${m.rgb});border-radius:50%;box-shadow:0 0 0 1px #888"></span><span>${esc(m.label)}</span></div>`).join('') : '');
    box.querySelectorAll('.nvles').forEach(e => e.onclick = () => { if (e.dataset.mark) { markJump(e.dataset.mark); return; }
      const l = V.scan && V.scan.lesions.find(x => x.id === e.dataset.id); if (l) jump(l); });   // the scan shown/loading now, not the one this list was made for
  }
  function markJump(id) {   // a plan point: the crosshair goes onto it, the line under the images says what it is
    const m = V.scan && (V.scan.marks || []).find(x => x.id === id); if (!V.nv || !m) return;
    V.nv.scene.crosshairPos = V.nv.mm2frac(m.ras);
    if (zoomOf2() > 1) centre2(zoomOf2());
    V.nv.drawScene();
    V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', e.dataset.mark === id));
    V.R('read').innerHTML = `<b style="color:rgb(${m.rgb})">◉ ${esc(m.label)}</b> · crosshair is on it · ${esc(m.note)}` + perfAt(m.ras) + swellAt(m.ras) + gridHere(m.ras);
  }
  function jump(l, auto) {
    if (!auto) V.picked = l;
    if (!V.nv || !l) return;
    V.nv.scene.crosshairPos = V.nv.mm2frac(l.ras);
    if (zoomOf2() > 1) centre2(zoomOf2());   // zoomed in: bring the lesion to the middle, or it can be off-screen
    V.nv.drawScene();
    V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', e.dataset.id === l.id));
    say(l);
  }
  function say(l) {   // the line under the images for one lesion (real or simulated)
    V.R('read').innerHTML = (V.scan && V.scan.sim ? `<b style="color:rgb(${l.rgb})">${l.id}</b> ${esc(l.name)} · <b style="color:#e0a020">simulated</b> ${l.enh.toLocaleString()} mm³, about ${l.axial} mm wide (today ${l.now.toLocaleString()} mm³, ${l.now_mm} mm)`
      : `<b style="color:rgb(${l.rgb})">${l.id}</b> ${esc(l.name)} · ${volOf(l).toLocaleString()} mm³ enhancing · longest axial ${l.axial} mm`) + perfAt(l.ras) + swellAt(l.ras) + gridHere(l.ras);
  }
  function readout(d) {
    const li = V.nv ? LI() : 1, v = d && d.values && d.values[li] ? Math.round(d.values[li].value) : 0;
    const l = V.scan && V.scan.lesions.find(x => x.n === v);
    V.R('list').querySelectorAll('.nvles').forEach(e => e.classList.toggle('on', !!l && e.dataset.id === l.id));
    const mm = d && d.mm ? ' · position ' + d.mm.slice(0, 3).map(x => x.toFixed(0)).join(', ') + ' mm' : '';
    V.R('read').innerHTML = (l ? `<b style="color:rgb(${l.rgb})">${l.id}</b> ${esc(l.name)} · ${V.scan.sim ? '<b style="color:#e0a020">simulated</b> ' : ''}${volOf(l).toLocaleString()} mm³${V.scan.sim ? '' : ' enhancing'}${mm}`
                             : `No lesion outline here${mm}`) + (d && d.mm ? doseAt(d.mm) + perfAt(d.mm) + swellAt(d.mm) + gridHere(d.mm) : '');
  }
  function openViewer(date) {
    if (!sel.includes(IDV)) setLabSel([IDV], true);
    setTimeout(() => { load(date).catch(() => {}); const w = document.querySelector(`.cmp[data-id="${IDV}"]`); if (w) w.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 50);
  }
  window.openMriViewer = openViewer;   // the phone start screen's Latest MRI card (phone_view.js)
  /* follow the locked cursor ("go to a date", make_lab_view.py goToDate): the latest scan on or before that day; before the
     first scan a plain message instead of pictures. Only while the viewer is open; a scan picked by hand stays until the next jump. */
  const SC_ORD = SCANS.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  function scanOn(t) { const d = new Date(t).toISOString().slice(0, 10); let s = null; SC_ORD.forEach(x => { if (x.date <= d) s = x; }); return s; }
  function blank(t) { if (!V.el) return; const box = V.R('box'); let m = box.querySelector('.nvnone');
    V.el.classList.toggle('nvblank', t != null); const hu = V.el.closest('.cmp') && V.el.closest('.cmp').querySelector('.cmph .u'); if (hu) hu.style.visibility = t != null ? 'hidden' : '';
    if (t == null) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('div'); m.className = 'nvnone'; box.appendChild(m); }
    m.innerHTML = `<b>No brain MRI yet on ${fd(new Date(t).toISOString().slice(0, 10))}</b><span>The first scan in the viewer is ${fd(SC_ORD[0].date)}. Move the cursor later to see it.</span>`; }
  function follow(t) { if (t == null || !SC_ORD.length || !V.el || !document.body.contains(V.el)) return;
    const s = scanOn(t); if (!s) { blank(t); return; }
    blank(null); if (!V.scan || V.scan.date !== s.date || V.scan.sim) load(s.date).catch(() => {}); }
  document.addEventListener('ohd:date', e => follow(e.detail.t));
  function drawViewer(id, body) {
    const w = viewerEl(); body.innerHTML = ''; body.appendChild(w); sizeBox(id);
    if (!SCANS.length) { V.R('status').textContent = 'No measured scans yet.'; return; }
    const lt = window.lockT ? window.lockT() : null, ls = lt == null ? undefined : scanOn(lt);
    if (!V.scan && ls === null) { blank(lt); return; }   // locked before the first scan: nothing to show yet
    if (!V.loading) V.loading = (V.scan ? load(V.scan.date) : ls ? load(ls.date) : (defaultView() ? load(defaultView().date).then(() => recall(defaultView(), true)) : load(SCANS[0].date))).catch(err => { if (!V.R('status').dataset.err) V.R('status').textContent = 'Could not load: ' + err; V.loading = null; });
  }

  /* ================= Lesions over time (Timeline · Lines · Grid) ================= */
  const L = {view: store.get('img.lesView2', 'volume'), hidden: new Set(store.get('img.lesHidden', (store.get('img.trends', {}).hidden || []))),   // (before 2026-11-18 the volume views kept their own selection)
             showTx: store.get('img.lesTx', true), showMeas: store.get('img.lesMeas', true), field: store.get('img.lesField', 'all'), rule: store.get('img.lesRule', 'new'),
             doseNum: store.get('img.lesDoseNum', true), doseStrip: store.get('img.lesDoseStrip', true)};
  /* ---- radiation dose per lesion (estimated, except courses marked `real`): unit switch shared by Lesions over time and Radiation dose by lesion ---- */
  const DU = {get: () => store.get('img.doseUnit', 'gy'), set: u => store.set('img.doseUnit', u)};
  const DROWS = DOSE ? DOSE.rows : [];
  // radiation courses come from the data file: {key: {label, kind: 'whole' | 'focal'}}, in time order
  const COURSES = (DOSE && DOSE.course_info) || {};
  const CLAB = Object.fromEntries(Object.entries(COURSES).map(([k, c]) => [k, c.label]));
  const CREAL = k => !!(COURSES[k] && COURSES[k].real);   // this course's dose is a hospital's dose file, not our estimate
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
  /* one lesion selection for every view of the panel (volume trends and doubling times included: lesion_trends_view.js gets it as `sel`) */
  const setHiddenL = h => { L.hidden = new Set(h); store.set('img.lesHidden', [...L.hidden]); };
  const LSEL = {get: () => [...L.hidden], set: setHiddenL};
  /* the badge on a lesion's button in the report views: the size the latest report gave, coloured by the trend it stated */
  const LASTREP = LS.reports.reduce((m, r) => r.date > m ? r.date : m, '');
  const reportBadge = lid => { const r = LS.reports.filter(x => x.lesion === lid).sort((a, b) => a.date < b.date ? 1 : -1)[0]; if (!r) return null;
    const tr = TREND[r.trend || ''].t, stale = r.date < LASTREP;
    return {text: r.kind === 'resolved' ? 'resolved' : r.kind === 'punctate' ? 'punctate' : r.kind === 'nonenhancing' ? 'non-enhancing' : r.mm != null ? r.mm + ' mm' : (tr || 'mentioned'),
      dir: r.trend === 'up' || r.trend === 'new' ? 'up' : r.trend === 'down' || r.kind === 'resolved' ? 'down' : 'flat', weak: !!r.ambiguous, stale,
      tip: (stale ? 'Not mentioned in the latest report (' + fd(LASTREP) + ')\n' : '') + 'Latest report that mentions it (' + fd(r.date) + '): ' + (tr || 'no trend given') + (r.ambiguous ? '\n⚠ the report wording fits more than one of our lesions' : '')}; };
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
          const xe = typeof FUT === 'number' && FUT && W.b > NOW ? Math.min(a.right, x.getPixelForValue(pos(NOW))) : a.right;   // dose so far: up to today, not into the future part of the axis
          rows.forEach((d, i) => { const x0 = x.getPixelForValue(pos(ms(d.end))), nx = rows[i + 1] ? x.getPixelForValue(pos(ms(rows[i + 1].end))) : xe;
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
  /* states = a lesion's state on a measured scan where it has no outline (not seen, or a pinpoint): rows shaped like the "none" rows */
  const STATES = LS.states || [];
  const MEAS = () => (OLD() ? LS.measured_old : LS.measured).concat(STATES);
  const noneTxt = m => m.below && m.note && !/normal scan/.test(m.note) ? 'Ours: ' + m.note : 'Our check: nothing at this place (normal scan, before the lesion appeared)';
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
    if (DOSE) { const sp = document.createElement('span'); sp.className = 'sub'; sp.style.color = '#e0a020'; sp.textContent = '· dose (' + DOSE_TAG + '):'; bar.append(sp);
      chk('numbers', 'img.lesDoseNum', 'doseNum'); chk('strip', 'img.lesDoseStrip', 'doseStrip'); bar.append(unitButtons(() => drawLesions(id, body))); }
    // lesion buttons: the component every imaging panel shares (lesion_chips.js); the badge is what the latest report said
    const LY = LS.reports.reduce((m, r) => r.date > m ? r.date : m, '').slice(0, 4);   // latest report year
    const act = LesionChips.btn('Active ' + LY, false, () => {
      const on = new Set(LS.reports.filter(r => r.date >= LY).map(r => r.lesion)); setHiddenL(LS.lesions.map(l => l.id).filter(x => !on.has(x))); drawLesions(id, body); },
      'Only lesions mentioned in ' + LY + ' reports');
    body.append(bar, LesionChips.row({ids: LS.lesions.map(l => l.id), color: i => LCOL[i], name: i => LNAME[i], hidden: [...L.hidden], badge: reportBadge,
      onChange: h => { setHiddenL(h); drawLesions(id, body); }, extra: [act],
      badgeNote: 'badge = the latest report: ↑ grew or new · ↓ shrank or resolved · grey = stable, mixed or no trend given · faded = not in the latest report'}));
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
    if (p.meas) return [`${p.lesion} ${LNAME[p.lesion]}`, p.meas.none ? noneTxt(p.meas)
      : `Our measurement: ${(p.meas.enh_mm3 / 1000).toFixed(2)} cm³ enhancing · longest axial ${p.meas.axial_mm} mm` + (p.meas.field ? ` · ${p.meas.field} scanner` + (is3T(p.meas) ? ' (compare with care across 1.5T)' : '') : '')];
    const r = p.r, tr = TREND[r.trend || ''];
    return [`${r.lesion} ${LNAME[r.lesion]}`, (r.mm != null ? (r.kind === 'punctate' ? 'punctate (~2 mm)' : r.kind === 'resolved' ? 'resolved' : r.kind === 'nonenhancing' ? 'non-enhancing' : r.mm + ' mm') : 'no size given') + (tr.t ? ' · ' + tr.t : ''),
            ...r.text.split(' | ').map(t => t.length > 90 ? t.slice(0, 88) + '…' : t)].concat(r.ambiguous ? ['(report wording fits more than one of our lesions)'] : []);
  }

  function drawLesions(id, body) {
    if (window.Projection) Projection.sync();   // a view without the Projection switch may have replaced one with it: the date lines follow
    if ((L.view === 'volume' || L.view === 'periods') && !window.LesionTrends) L.view = 'timeline';
    if (L.view === 'volume' || L.view === 'periods') return window.LesionTrends.draw(id, body, L.view, lesViewBtns(id, body), () => drawLesions(id, body), LSEL);
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
        (DOSE ? ` <span style="color:#e0a020">Dose (${DOSE_TAG}, ${dunit()}): number after a treatment box = dose that course gave the lesion; strip under each row = dose so far (pale = little, dark red = most); right column = total.</span>` : '')
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
      (DOSE ? `<th style="padding:2px 6px;color:#e0a020" title="${DOSE_REAL ? 'Total radiation dose to the lesion, part estimated' : 'Estimated total radiation dose to the lesion'} (how each number was made: see the note in Radiation dose by lesion)">dose<br><span class="sub">${dunit()}</span></th>` : '') + '</tr>';
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
        const tip = (r ? lesTooltip({r}).slice(1).join('\n') : '') + (m ? (r ? '\n' : '') + (m.none ? noneTxt(m) : `Ours: ${(m.enh_mm3 / 1000).toFixed(2)} cm³, ${m.axial_mm} mm` + (m.field ? ', ' + m.field + ' scanner' : '')) : '');
        h += `<td title="${tip.replace(/"/g, '&quot;')}" style="text-align:center;padding:2px 4px;border:1px solid var(--line);${bg};${inWin(d) ? '' : 'opacity:.45'}">${txt}${m ? `<div style="font-size:9px;color:${LCOL[l.id]}">${m.none ? (m.below === 'tiny' ? '◇ tiny' : '◇ none') : (is3T(m) ? '▲' : '◆') + (m.enh_mm3 / 1000).toFixed(1)}</div>` : ''}</td>`;
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
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', (DOSE_REAL ? 'Radiation dose' : 'Estimated radiation dose') + ' to each brain lesion, by course');
    box.append(cv); body.append(box);
    const les = [...new Set(DROWS.map(r => r.lesion))].sort();
    const ds = Object.keys(CLAB).map(k => ({label: CLAB[k] + (CREAL(k) ? ' (dose file)' : ''), backgroundColor: CCOL[k], borderColor: CCOL[k], borderWidth: 0,
      data: les.map(l => { const r = DROWS.find(x => x.lesion === l && x.course === k); return r ? Math.round(dval(r) * 10) / 10 : 0; })}));
    const conf = Object.fromEntries((DOSE.courses || []).map(c => [c.course, c]));
    charts.set(id, new Chart(cv, {type: 'bar', data: {labels: les, datasets: ds},
      options: {animation: false, maintainAspectRatio: false,
        scales: {x: {stacked: true, ticks: {color: c => LCOL[les[c.index]] || css('--muted'), font: {weight: 'bold', size: 10}}, grid: {display: false}},
                 y: {stacked: true, title: {display: true, text: dunit() + ' (dose to the lesion)', color: css('--muted')}, ticks: {color: css('--muted')}, grid: {color: css('--line')}}},
        plugins: {legend: {labels: {color: css('--ink'), boxWidth: 12}},
          tooltip: {callbacks: {title: it => it[0].label + ' ' + (LNAME[it[0].label] || ''),
            label: it => { const k = Object.keys(CLAB)[it.datasetIndex], r = DROWS.find(x => x.lesion === it.label && x.course === k), c = conf[k] || {};
              return r ? `${CLAB[k]} (${c.start}–${c.end}): ${r.gy} Gy · ${r.eqd2_tumor} EQD2${r.targeted ? (isWhole(k) ? '' : ' · targeted') : ' · spill-over'} · ${c.confidence} confidence` : ''; },
            footer: it => { const r = DROWS.filter(x => x.lesion === it[0].label); return r.length ? 'Total so far: ' + Math.round(drun(r[r.length - 1])) + ' ' + dunit() : ''; }}}}}}));
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.textContent = 'Each bar = one lesion; colours = the radiation courses it received. ' + (DOSE.course_note || '') + ' EQD2 uses alpha/beta 10 for tumour. Spill-over = dose from a nearby target.';
    body.append(note);
  }

  /* ================= 3D timelapse (the phone start screen in a panel; phone_view.js is loaded after this file) ================= */
  function draw3D(id, body, tries = 0) {
    if (window.Brain3D) return window.Brain3D.mount(body, hOf(id, PANELS[id].h0));
    if (!body.firstChild) body.textContent = 'Loading the 3D timelapse…';
    if (tries < 100 && body.isConnected) setTimeout(() => draw3D(id, body, tries + 1), 50);
  }

  /* ================= plug into the viewer's hooks (same object the MRD panels use) ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => typeof id === 'string' && id.startsWith('img:');
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? (id === IDV && V.scan ? fd(V.scan.date) + (V.scan.sim ? ' · simulated ' + fd(V.scan.sim.date) : '') : PANELS[id].unit) : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); BODIES.set(id, body); (id === IDV ? drawViewer : id === ID3 ? draw3D : id === IDL ? drawLesions : id === IDD ? drawDose : id === IDP ? window.LesionPerfusion.draw : id === IDW ? window.LesionSwelling.draw : drawDates)(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); if (id === IDV || id === IDD || id === ID3) return;   // the slice viewer and the 3D timelapse don't follow the time window
    const b = BODIES.get(id); if (b && b.isConnected) (id === IDL ? drawLesions : id === IDP ? window.LesionPerfusion.draw : id === IDW ? window.LesionSwelling.draw : drawDates)(id, b); };

  /* one Projection switch for the imaging panels (projection_dates.js): when it changes, redraw the panels that draw a projection */
  if (window.Projection) Projection.onChange(() => [IDL, IDW].forEach(id => MRD.refresh(id)));

  /* Library: Imaging → Brain MRI → Scan dates / Slice viewer */
  MRD.section = (el, q) => {
    o.section(el, q);
    if (q && !'imaging brain mri scans slice viewer lesions over time radiation dose perfusion blood flow volume swelling shrinkage displacement bent grid projection future 3d timelapse head phone'.includes(q)) return;
    const S = section(el, 'img', 'Imaging', '1 group', true, 'sec', q);
    const ids = [ID, IDL, IDV].concat(B3D ? [ID3] : [], DOSE ? [IDD] : [], PERF ? [IDP] : [], SWELL ? [IDW] : []), k = ids.filter(i => sel.includes(i)).length;
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
    row(IDV, 'Slice viewer', SCANS.length + ' measured', 'Scroll through a scan in 3 planes + 3D with our lesion outlines (L01…); layers: radiation dose, perfusion, swelling (colour or bent grid); brightness matched across dates; simulate a future scan');
    if (B3D) row(ID3, '3D timelapse', SCANS.length + ' scans', 'The phone start screen in a panel: a turning glass head with the lesions playing through every scan (shapes blended between scans), vessels, eyes and vision pathway, radiation; drag to turn');
    if (DOSE) row(IDD, 'Radiation dose by lesion', DOSE_TAG, DOSE_REAL ? 'Radiation dose each lesion received, split by course (stacked bars); estimated, except a course marked dose file' : 'Estimated radiation dose each lesion received, split by course (stacked bars)');
    if (SWELL) row(IDW, 'Swelling by lesion', IMG_DATA.swelling.totals.length + ' scans', 'How much more (swollen) or less (shrunk) room the brain around each lesion takes than on the normal control MRI, over time (flexible-fit estimate); the map itself is a layer in the Slice viewer');
    if (PERF) row(IDP, 'Perfusion by lesion', new Set(IMG_DATA.perfusion.rows.map(r => r.date)).size + ' scans', 'Blood volume (rCBV) and blood flow (ASL) inside each lesion, compared with normal or nearby brain; the maps themselves are a layer in the Slice viewer');
  };

  syncMoments(); (window.momentSyncers = window.momentSyncers || []).push(syncMoments);   // again after the shared edits load
  const saved = store.get('selected', []);
  if (saved.some(mine)) { sel = saved.filter(id => BYID[id] || MRD.isId(id)); }
  updateBar(); list(); render();
})();
