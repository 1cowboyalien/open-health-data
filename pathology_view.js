/* Pathology slide photos in the Library of the lab viewer (labs.html). Used by make_lab_view.py when
   local/pathology/pathology.json exists. Everything about the patient (cases, stains, results, photos) comes from
   PATH_DATA, never from this code; the photos are served by serve_viewer.py at /pathology/<case>/{full,thumb}/<file>.jpg.
   It plugs into the same hooks as the MRD, imaging and procedure panels (MRD.isId/title/unit/h0/panel/refresh/section),
   so the panel gets the viewer's ⤒ ↑ ↓ ⤓ − + × controls (− + set the Gallery's height).
   Panel path:slides has four views (buttons at the top of the panel):
     Overview = one cover photo per slide, with the stain and the report's result for it
     Gallery  = every photo as a thumbnail grid; filter by slide; thumbnail size slider; ＋ on a photo adds it to Compare
     Viewer   = one photo large with a size slider (‹ › or the arrow keys), the filtered photos in a strip below,
                what the stain shows, ＋ Compare, "Use as cover", full-size link
     Compare  = the ＋ photos side by side in 1-4 columns (◀ ▶ reorder, × remove); "Covers" fills it with every slide's cover
   ⛶ (or double-click a photo) opens the full-window view: ‹ › / arrow keys, click the photo to see it at full resolution, Esc closes.
   On the timeline: one line per case on every chart (the biopsy date, results in its note; Library tick, on by default), and
   photos saved with 🔖 Keyframe as lines on the case date (group "Saved slide photos"). Both are generated moments, never written
   to the edits file; clicking one opens the case or the photo here. A case's `procedure` id links it with the Procedures panel
   (its card gets a "Slide photos" button through window.PATH; the Overview gets "Show in Procedures" through window.PROC_SHOW).
   View settings, compare picks, cover picks, timeline ticks and keyframes are kept in this browser
   (store 'path.view', 'path.covers', 'path.moments', 'path.keys').
   Data: PATH_DATA = {stains:[{key,label,kind,what}], cases:[{key,title,date,site,review,diagnosis,source,results:{stain:text},
                      procedure?, slides:[{stain,slide,photos:[file],cover}]}]}, made outside this repo (it holds health data). */
(() => {
  const P = PATH_DATA;
  const ID = 'path:slides';
  const nPhotos = P.cases.reduce((a, c) => a + c.slides.reduce((b, s) => b + s.photos.length, 0), 0);
  const nSlides = P.cases.reduce((a, c) => a + c.slides.length, 0);
  const PANEL = {title: 'Pathology · slide photos', unit: nSlides + ' slides · ' + nPhotos + ' photos', h0: 560};
  const ST = Object.fromEntries(P.stains.map(s => [s.key, s]));
  const KCOL = {routine: '#a03a8c', IHC: '#9a6a1c', control: '#6b7280'};
  const MODES = ['overview', 'gallery', 'viewer', 'compare'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const url = (c, kind, f) => '/pathology/' + encodeURIComponent(c.key) + '/' + kind + '/' + encodeURIComponent(f);
  const slideKey = (c, s) => c.key + '/' + s.stain + '_' + s.slide;
  const slideName = (c, s) => { const st = ST[s.stain] || {label: s.stain}, same = c.slides.filter(x => x.stain === s.stain).length > 1;
    return st.label + (same || s.slide !== '1' ? ' · slide ' + s.slide : ''); };
  const fd = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

  /* view state (kept in this browser) */
  const V = Object.assign({mode: 'overview', caseKey: P.cases[0] && P.cases[0].key, filter: 'all', cur: null,
    thumb: 180, size: 560, cols: 2, pins: []}, store.get('path.view', {}));
  if (V.mode === 'slide') V.mode = 'viewer';   // older saved view
  if (!MODES.includes(V.mode)) V.mode = 'overview';
  const covers = store.get('path.covers', {});
  const save = () => { store.set('path.view', V); store.set('path.covers', covers); };
  const curCase = () => P.cases.find(c => c.key === V.caseKey) || P.cases[0];
  const coverOf = (c, s) => covers[slideKey(c, s)] || s.cover;
  // a photo = {c, s, f, i}; its key = '<case>/<stain>_<slide>|<file>'
  const pkey = it => slideKey(it.c, it.s) + '|' + it.f;
  const findKey = k => { const [sk, f] = String(k).split('|');
    for (const c of P.cases) { const s = c.slides.find(x => slideKey(c, x) === sk); if (s && s.photos.includes(f)) return {c, s, f, i: s.photos.indexOf(f)}; }
    return null; };
  V.pins = V.pins.filter(findKey);
  const items = c => c.slides.filter(s => V.filter === 'all' || slideKey(c, s) === V.filter).flatMap(s => s.photos.map((f, i) => ({c, s, f, i})));
  const pinned = it => V.pins.includes(pkey(it));
  const togglePin = it => { const k = pkey(it), j = V.pins.indexOf(k); j >= 0 ? V.pins.splice(j, 1) : V.pins.push(k); save(); };
  const result = it => it.c.results[it.s.stain] || '';
  const caption = it => slideName(it.c, it.s) + ' · photo ' + (it.i + 1) + ' of ' + it.s.photos.length;
  let BODY = null, focusImg = false;
  const redraw = () => { if (BODY && BODY.isConnected) draw(ID, BODY); };
  const go = (mode, extra) => { Object.assign(V, extra || {}); V.mode = mode; save(); redraw(); if (typeof list === 'function') list(); };

  /* ================= on the timeline (generated moments) ================= */
  const MGROUP = 'Pathology', KGROUP = 'Saved slide photos';
  const onLine = new Set(store.get('path.moments', P.cases.map(c => c.key)));
  const keyframes = store.get('path.keys', []).filter(findKey);
  const isKey = it => keyframes.includes(pkey(it));
  const nOf = c => c.slides.reduce((a, s) => a + s.photos.length, 0);
  const summary = c => [...new Set(c.slides.map(s => s.stain))].filter(k => (ST[k] || {}).kind === 'IHC' && c.results[k])
    .map(k => ST[k].label + ' ' + c.results[k]).join(' · ');
  function syncMoments() {
    if (typeof E === 'undefined') return;
    E.moments = (E.moments || []).filter(m => !m.pathGen && !m.pathKey);
    P.cases.filter(c => onLine.has(c.key)).forEach(c => E.moments.push({id: 'path-' + c.key, title: 'Pathology: ' + c.title, group: MGROUP,
      date: c.date, time: '', end: '', note: c.diagnosis + ' — ' + summary(c) + '. Click to see the ' + nOf(c) + ' slide photos.',
      color: 'red', kind: 'test', line: true, on: true, links: [], pathGen: c.key}));
    keyframes.map(findKey).filter(Boolean).forEach(it => E.moments.push({id: 'pathkey-' + pkey(it).replace(/[^A-Za-z0-9]+/g, '-'),
      title: 'Slide photo: ' + slideName(it.c, it.s) + ' #' + (it.i + 1), group: KGROUP, date: it.c.date, time: '', end: '',
      note: (result(it) || slideName(it.c, it.s)) + '. Click to open this photo.', color: 'purple', kind: 'test', line: true, on: true, links: [], pathKey: pkey(it)}));
  }
  const refreshAll = () => { syncMoments(); list(); render(); };
  function setOnLine(keys, on) { keys.forEach(k => on ? onLine.add(k) : onLine.delete(k)); store.set('path.moments', [...onLine]); refreshAll(); }
  function toggleKey(it) { const k = pkey(it), j = keyframes.indexOf(k); j >= 0 ? keyframes.splice(j, 1) : keyframes.push(k); store.set('path.keys', keyframes); refreshAll(); }
  if (typeof saveEdits === 'function') { const _save = saveEdits;   // generated lines are never written to the edits file
    saveEdits = function () { const mine = (E.moments || []).filter(m => m.pathGen || m.pathKey); E.moments = (E.moments || []).filter(m => !m.pathGen && !m.pathKey);
      try { return _save.apply(this, arguments); } finally { E.moments.push(...mine); } }; }
  function openPanel(mode) {   // show the panel (tick it if needed) in this view and scroll to it
    V.mode = mode; save();
    if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); }
    setTimeout(() => { if (BODY && BODY.isConnected) BODY.parentElement.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 60);
  }
  const openPhoto = k => { const it = findKey(k); if (!it) return; Object.assign(V, {caseKey: it.c.key, filter: slideKey(it.c, it.s), cur: k}); focusImg = true; openPanel('viewer'); };
  const _openMoment = openMoment;
  openMoment = function (m) {   // clicking a pathology line opens the photos instead of the moment editor
    if (m && m.pathGen) { V.caseKey = m.pathGen; return openPanel('overview'); }
    if (m && m.pathKey) return openPhoto(m.pathKey);
    return _openMoment.apply(this, arguments);
  };
  window.PATH = {forProcedure: id => P.cases.filter(c => c.procedure && c.procedure === id).map(c => ({key: c.key, title: c.title, n: nOf(c)})),
                 open: key => { V.caseKey = key; openPanel('overview'); }};
  const keyBtn = (it, after) => mkBtn(isKey(it) ? '🔖 On the timeline' : '🔖 Keyframe', isKey(it),
    isKey(it) ? 'This photo is a line on the timeline charts (click to remove it)' : 'Save this photo as a line on the timeline charts, on the biopsy date',
    () => { toggleKey(it); if (after) after(); });

  if (!document.getElementById('pathCss')) { const st = document.createElement('style'); st.id = 'pathCss';
    st.textContent =
      '.pth-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}' +
      '.pth-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;white-space:nowrap}' +
      '.pth-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}.pth-b:disabled{opacity:.35;cursor:default}' +
      '.pth-b.big{font-size:12px;padding:2px 11px}.pth-sep{width:1px;height:16px;background:var(--line);margin:0 2px}' +
      '.pth-rng{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)}.pth-rng input{width:120px}' +
      '.pth-grid{display:grid;gap:8px;overflow:auto;align-content:start}' +
      '.pth-tile{border:1px solid var(--line);border-radius:6px;overflow:hidden;cursor:pointer;background:var(--card);position:relative}' +
      '.pth-tile:hover{outline:2px solid var(--ink)}.pth-tile img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#ddd}' +
      '.pth-tile .cap{padding:3px 6px;font-size:11px;line-height:1.3}.pth-res{font-weight:600}' +
      '.pth-pin{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:12px;border:0;background:rgba(0,0,0,.5);color:#fff;font-size:14px;line-height:24px;padding:0;cursor:pointer}' +
      '.pth-pin.on{background:#e0a020;color:#000}.pth-pin:hover{background:rgba(0,0,0,.8)}.pth-pin.on:hover{background:#f0b030}' +
      '.pth-main{display:flex;gap:10px;min-height:0}.pth-img{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;background:#111;border-radius:6px;position:relative;outline:none}' +
      '.pth-img:focus-visible{box-shadow:0 0 0 2px var(--ink)}.pth-img img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:zoom-in}' +
      '.pth-nav{position:absolute;top:50%;transform:translateY(-50%);font-size:22px;width:36px;height:52px;border:0;border-radius:6px;background:rgba(0,0,0,.35);color:#fff;cursor:pointer;z-index:2}' +
      '.pth-nav:hover{background:rgba(0,0,0,.65)}.pth-nav:disabled{opacity:.2;cursor:default}' +
      '.pth-side{flex:0 0 220px;font-size:12px;line-height:1.4;overflow:auto}.pth-side h4{margin:0 0 4px;font-size:14px}' +
      '.pth-strip{display:flex;gap:4px;overflow-x:auto;padding:6px 0 2px}.pth-strip img{height:54px;border-radius:3px;cursor:pointer;opacity:.7;border:2px solid transparent;flex:none}' +
      '.pth-strip img:hover{opacity:1}.pth-strip img.on{opacity:1;border-color:var(--ink)}.pth-strip img.pn{box-shadow:0 -3px 0 #e0a020 inset}' +
      '.pth-cmp{display:grid;gap:8px}.pth-cell{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--card)}' +
      '.pth-cell .hd{display:flex;align-items:center;gap:4px;padding:3px 6px;font-size:12px}.pth-cell .hd .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pth-cell img{width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;display:block;cursor:zoom-in}' +
      '.pth-x{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:13px;padding:0 3px}.pth-x:hover{color:var(--ink)}.pth-x:disabled{opacity:.25;cursor:default}' +
      '.pth-lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.94);display:flex;flex-direction:column;color:#eee}' +
      '.pth-lb .top{display:flex;gap:8px;align-items:center;padding:8px 12px;font-size:13px;flex-wrap:wrap}.pth-lb .top .t{flex:1;min-width:200px}' +
      '.pth-lb .pth-b{color:#eee;border-color:#777}.pth-lb .pth-b.on{background:#e0a020;color:#000;border-color:#e0a020}' +
      '.pth-lb .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
      '.pth-lb .stage img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in}' +
      '.pth-lb .stage.z{display:block;overflow:auto}.pth-lb .stage.z img{max-width:none;max-height:none;cursor:zoom-out}' +
      '.pth-lb .pth-nav{position:fixed}';
    document.head.append(st); }
  const mkBtn = (label, on, tip, fn, cls) => { const b = document.createElement('button'); b.className = 'pth-b' + (on ? ' on' : '') + (cls ? ' ' + cls : ''); b.textContent = label; b.title = tip; b.onclick = fn; return b; };
  const sep = () => { const d = document.createElement('span'); d.className = 'pth-sep'; return d; };
  const kindTag = st => `<span style="font-size:10px;padding:0 5px;border-radius:8px;color:#fff;background:${KCOL[st.kind] || '#888'}">${esc(st.kind)}</span>`;
  function range(label, min, max, step, val, tip, onInput) {
    const w = document.createElement('label'); w.className = 'pth-rng'; w.title = tip;
    const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
    r.oninput = () => onInput(+r.value); r.onkeydown = e => e.stopPropagation();
    w.append(label, r); return w; }
  const pinBtn = it => { const b = document.createElement('button'); const on = pinned(it);
    b.className = 'pth-pin' + (on ? ' on' : ''); b.textContent = on ? '✓' : '＋'; b.title = on ? 'In Compare: click to take it out' : 'Add to Compare';
    b.onclick = e => { e.stopPropagation(); togglePin(it); redraw(); }; return b; };

  /* ================= panel ================= */
  function draw(id, body) {
    BODY = body; body.innerHTML = '';
    const c = curCase(); if (!c) { body.textContent = 'No pathology cases.'; return; }
    // row 1: views (+ cases when there is more than one)
    const bar = document.createElement('div'); bar.className = 'pth-bar';
    if (P.cases.length > 1) { P.cases.forEach(k => bar.append(mkBtn(fd(k.date) + ' ' + k.title, k.key === c.key, k.site, () => go(V.mode, {caseKey: k.key, filter: 'all', cur: null})))); bar.append(sep()); }
    [['overview', 'Overview', 'One cover photo per slide, with the result'],
     ['gallery', 'Gallery · ' + c.slides.reduce((a, s) => a + s.photos.length, 0), 'Every photo as thumbnails'],
     ['viewer', 'Viewer', 'One photo large, with a size slider'],
     ['compare', 'Compare · ' + V.pins.length, 'The photos you added with ＋, side by side']]
      .forEach(([m, l, t]) => bar.append(mkBtn(l, V.mode === m, t, () => go(m), 'big')));
    body.append(bar);
    if (V.mode === 'gallery' || V.mode === 'viewer') {   // row 2: which slide(s)
      const f = document.createElement('div'); f.className = 'pth-bar';
      f.append(mkBtn('All slides', V.filter === 'all', 'Photos of every slide', () => go(V.mode, {filter: 'all'})));
      c.slides.forEach(s => f.append(mkBtn(slideName(c, s), V.filter === slideKey(c, s), (c.results[s.stain] || '') + ' · ' + s.photos.length + ' photos',
        () => go(V.mode, {filter: slideKey(c, s), cur: V.mode === 'viewer' ? slideKey(c, s) + '|' + coverOf(c, s) : V.cur}))));
      body.append(f);
    }
    ({overview: drawOverview, gallery: drawGallery, viewer: drawViewer, compare: drawCompare})[V.mode](body, c, id);
  }

  function drawOverview(body, c) {
    const info = document.createElement('div'); info.className = 'sub'; info.style.cssText = 'font-size:12px;margin-bottom:6px';
    info.innerHTML = `<b style="color:var(--ink)">${esc(c.title)}</b> · ${esc(fd(c.date))} · ${esc(c.site)} — ${esc(c.diagnosis)}<br>${esc(c.review)}`;
    info.title = 'Source: ' + c.source; body.append(info);
    const tl = document.createElement('div'); tl.className = 'pth-bar';
    tl.append(mkBtn(onLine.has(c.key) ? '✓ Line on the timeline' : '＋ Line on the timeline', onLine.has(c.key),
      'A line on every chart on ' + fd(c.date) + ' (click it to come back here)', () => setOnLine([c.key], !onLine.has(c.key))));
    if (c.procedure && window.PROC_SHOW) tl.append(mkBtn('Show in Procedures', false, 'Select this biopsy on the Procedures timeline', () => window.PROC_SHOW(c.procedure)));
    const nk = keyframes.filter(k => k.startsWith(c.key + '/')).length;
    if (nk) { const n = document.createElement('span'); n.className = 'sub'; n.style.fontSize = '11px'; n.textContent = '🔖 ' + nk + ' photo' + (nk > 1 ? 's' : '') + ' saved as keyframes'; tl.append(n); }
    body.append(tl);
    const g = document.createElement('div'); g.className = 'pth-grid'; g.style.gridTemplateColumns = 'repeat(auto-fill,minmax(190px,1fr))';
    c.slides.forEach(s => { const st = ST[s.stain] || {label: s.stain, kind: ''}, it = {c, s, f: coverOf(c, s), i: s.photos.indexOf(coverOf(c, s))};
      const t = document.createElement('div'); t.className = 'pth-tile'; t.title = (st.what || '') + '\nClick: open this slide in the Viewer';
      t.innerHTML = `<img loading="lazy" alt="${esc(slideName(c, s))}" src="${url(c, 'thumb', it.f)}">
        <div class="cap" style="font-size:12px"><b>${esc(slideName(c, s))}</b> ${kindTag(st)}<br><span class="pth-res">${esc(c.results[s.stain] || '—')}</span>
        <span class="sub"> · ${s.photos.length} photos</span></div>`;
      t.append(pinBtn(it));
      t.onclick = () => { focusImg = true; go('viewer', {filter: slideKey(c, s), cur: pkey(it)}); }; g.append(t); });
    body.append(g);
  }

  function drawGallery(body, c, id) {
    const L = items(c);
    const ctl = document.createElement('div'); ctl.className = 'pth-bar';
    ctl.append(range('Thumbnail size', 90, 480, 10, V.thumb, 'Make the thumbnails smaller or bigger', v => { V.thumb = v; save();
      const g = body.querySelector('.pth-grid'); if (g) g.style.gridTemplateColumns = 'repeat(auto-fill,minmax(' + v + 'px,1fr))';
      body.querySelectorAll('.pth-grid img').forEach(im => { const want = v > 240 ? 'full' : 'thumb'; if (im.dataset.k !== want) { im.dataset.k = want; im.src = url(c, want, im.dataset.f); } }); }));
    const n = document.createElement('span'); n.className = 'sub'; n.style.fontSize = '11px';
    n.textContent = L.length + ' photos · click one to open it in the Viewer · ＋ adds it to Compare'; ctl.append(n);
    body.append(ctl);
    const g = document.createElement('div'); g.className = 'pth-grid';
    g.style.gridTemplateColumns = 'repeat(auto-fill,minmax(' + V.thumb + 'px,1fr))'; g.style.maxHeight = hOf(id, PANEL.h0) + 'px';
    const kind = V.thumb > 240 ? 'full' : 'thumb';
    L.forEach(it => { const t = document.createElement('div'); t.className = 'pth-tile'; t.title = caption(it) + '\n' + result(it);
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = caption(it); im.dataset.f = it.f; im.dataset.k = kind; im.src = url(c, kind, it.f);
      const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = (V.filter === 'all' ? slideName(c, it.s) + ' · ' : '') + '#' + (it.i + 1);
      t.append(im, cap, pinBtn(it)); t.ondblclick = e => { e.preventDefault(); lightbox(L, L.indexOf(it)); };
      t.onclick = () => { focusImg = true; go('viewer', {cur: pkey(it)}); }; g.append(t); });
    body.append(g);
  }

  function drawViewer(body, c) {
    const L = items(c); if (!L.length) { body.append('No photos.'); return; }
    let k = L.findIndex(it => pkey(it) === V.cur); if (k < 0) k = 0;
    const it = L[k], st = ST[it.s.stain] || {label: it.s.stain, kind: '', what: ''};
    const step = d => { const j = k + d; if (j < 0 || j >= L.length) return; V.cur = pkey(L[j]); save(); focusImg = true; redraw(); };
    const ctl = document.createElement('div'); ctl.className = 'pth-bar';
    ctl.append(range('Size', 240, 1400, 20, V.size, 'Make the photo smaller or bigger', v => { V.size = v; save(); const m = body.querySelector('.pth-main'); if (m) m.style.height = v + 'px'; }));
    ctl.append(mkBtn('⛶ Full window', false, 'Show this photo as big as the window (Esc to close)', () => lightbox(L, k)));
    ctl.append(mkBtn(pinned(it) ? '✓ In Compare' : '＋ Compare', pinned(it), 'Add this photo to Compare, to see it next to others', () => { togglePin(it); redraw(); }));
    ctl.append(keyBtn(it));
    body.append(ctl);
    const main = document.createElement('div'); main.className = 'pth-main'; main.style.height = V.size + 'px';
    const box = document.createElement('div'); box.className = 'pth-img'; box.tabIndex = 0; box.title = '← → previous / next photo · double-click: full window';
    const img = document.createElement('img'); img.src = url(c, 'full', it.f); img.alt = caption(it);
    img.ondblclick = () => lightbox(L, k);
    const prev = document.createElement('button'); prev.className = 'pth-nav'; prev.style.left = '6px'; prev.textContent = '‹'; prev.title = 'Previous photo'; prev.disabled = k === 0; prev.onclick = () => step(-1);
    const next = document.createElement('button'); next.className = 'pth-nav'; next.style.right = '6px'; next.textContent = '›'; next.title = 'Next photo'; next.disabled = k === L.length - 1; next.onclick = () => step(1);
    box.onkeydown = e => { const d = {ArrowLeft: -1, ArrowRight: 1}[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); step(d); };
    box.append(img, prev, next);
    const side = document.createElement('div'); side.className = 'pth-side';
    const isCover = coverOf(c, it.s) === it.f;
    side.innerHTML = `<h4>${esc(slideName(c, it.s))} ${kindTag(st)}</h4>
      <div>Report: <span class="pth-res">${esc(result(it) || '—')}</span></div>
      <p style="margin:6px 0">${esc(st.what)}</p>
      <div class="sub">Photo ${it.i + 1} of ${it.s.photos.length} on this slide${V.filter === 'all' ? ' · ' + (k + 1) + ' of ' + L.length + ' in all' : ''}<br>${esc(it.f)}</div>`;
    const acts = document.createElement('div'); acts.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-top:6px';
    acts.append(mkBtn(isCover ? '★ Cover' : '☆ Use as cover', isCover, 'The cover is the photo shown for this slide in the Overview (kept in this browser)', () => {
      covers[slideKey(c, it.s)] = it.f; save(); redraw(); }));
    const a = document.createElement('a'); a.href = url(c, 'full', it.f); a.target = '_blank'; a.rel = 'noopener'; a.className = 'pth-b'; a.textContent = 'Full size ↗';
    acts.append(a); side.append(acts);
    main.append(box, side); body.append(main);
    const strip = document.createElement('div'); strip.className = 'pth-strip';
    L.forEach((p, j) => { const t = document.createElement('img'); t.loading = 'lazy'; t.src = url(c, 'thumb', p.f); t.alt = caption(p);
      t.title = caption(p) + (pinned(p) ? ' (in Compare)' : ''); t.className = (j === k ? 'on' : '') + (pinned(p) ? ' pn' : '');
      t.onclick = () => { V.cur = pkey(p); save(); focusImg = true; redraw(); }; strip.append(t); });
    body.append(strip);
    const on = strip.querySelector('img.on'); if (on) requestAnimationFrame(() => { strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2; });
    if (focusImg) { focusImg = false; box.focus({preventScroll: true}); }
  }

  function drawCompare(body, c) {
    const L = V.pins.map(findKey).filter(Boolean);
    const ctl = document.createElement('div'); ctl.className = 'pth-bar';
    ctl.append('Columns');
    [1, 2, 3, 4].forEach(n => ctl.append(mkBtn(String(n), V.cols === n, n + ' photo' + (n > 1 ? 's' : '') + ' per row (fewer = bigger)', () => { V.cols = n; save(); redraw(); })));
    ctl.append(sep());
    ctl.append(mkBtn('Covers of every slide', false, 'Put the cover photo of each slide here (replaces the current picks)', () => {
      V.pins = c.slides.map(s => slideKey(c, s) + '|' + coverOf(c, s)); save(); redraw(); }));
    if (L.length) ctl.append(mkBtn('⛶ Full window', false, 'Step through these photos as big as the window', () => lightbox(L, 0)));
    if (L.length) ctl.append(mkBtn('Clear', false, 'Take every photo out of Compare', () => { V.pins = []; save(); redraw(); }));
    body.append(ctl);
    if (!L.length) { const e = document.createElement('div'); e.className = 'sub'; e.style.cssText = 'padding:24px;text-align:center;font-size:13px';
      e.textContent = 'Nothing to compare yet. Press ＋ on photos in the Overview, Gallery or Viewer, or use "Covers of every slide".'; body.append(e); return; }
    const g = document.createElement('div'); g.className = 'pth-cmp'; g.style.gridTemplateColumns = 'repeat(' + V.cols + ',minmax(0,1fr))';
    const move = (j, d) => { const k = j + d; if (k < 0 || k >= V.pins.length) return; [V.pins[j], V.pins[k]] = [V.pins[k], V.pins[j]]; save(); redraw(); };
    L.forEach((it, j) => { const cell = document.createElement('div'); cell.className = 'pth-cell';
      const hd = document.createElement('div'); hd.className = 'hd';
      const t = document.createElement('span'); t.className = 't'; t.innerHTML = `<b>${esc(slideName(it.c, it.s))}</b> · <span class="pth-res">${esc(result(it) || '—')}</span> <span class="sub">#${it.i + 1}</span>`;
      t.title = caption(it) + '\n' + result(it);
      const bt = (label, tip, dis, fn) => { const b = document.createElement('button'); b.className = 'pth-x'; b.textContent = label; b.title = tip; b.disabled = dis; b.onclick = fn; return b; };
      hd.append(t, bt('◀', 'Move left', j === 0, () => move(j, -1)), bt('▶', 'Move right', j === L.length - 1, () => move(j, 1)),
        bt('✕', 'Take out of Compare', false, () => { V.pins.splice(j, 1); save(); redraw(); }));
      const im = document.createElement('img'); im.loading = 'lazy'; im.src = url(it.c, 'full', it.f); im.alt = caption(it); im.title = 'Click: full window';
      im.onclick = () => lightbox(L, j);
      cell.append(hd, im); g.append(cell); });
    body.append(g);
  }

  /* ================= full-window view ================= */
  function lightbox(L, k) {
    const ov = document.createElement('div'); ov.className = 'pth-lb'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Slide photo, full window');
    let zoom = false;
    function show() {
      const it = L[k]; ov.innerHTML = '';
      const top = document.createElement('div'); top.className = 'top';
      const t = document.createElement('span'); t.className = 't';
      t.innerHTML = `<b>${esc(slideName(it.c, it.s))}</b> · ${esc(result(it) || '—')} · <span style="opacity:.7">photo ${it.i + 1} of ${it.s.photos.length}${L.length > 1 ? ' · ' + (k + 1) + '/' + L.length + ' here' : ''} · click the photo to see it at full resolution · ← → · Esc</span>`;
      top.append(t, mkBtn(pinned(it) ? '✓ In Compare' : '＋ Compare', pinned(it), 'Add this photo to Compare', () => { togglePin(it); show(); }), keyBtn(it, show));
      const a = document.createElement('a'); a.href = url(it.c, 'full', it.f); a.target = '_blank'; a.rel = 'noopener'; a.className = 'pth-b'; a.textContent = 'Full size ↗';
      top.append(a, mkBtn('✕ Close', false, 'Close (Esc)', close));
      const stage = document.createElement('div'); stage.className = 'stage' + (zoom ? ' z' : '');
      const img = document.createElement('img'); img.src = url(it.c, 'full', it.f); img.alt = caption(it);
      img.onclick = e => { e.stopPropagation(); zoom = !zoom; stage.classList.toggle('z', zoom); };
      stage.onclick = e => { if (e.target === stage) close(); };
      stage.append(img);
      const nav = (d, side, label) => { const b = document.createElement('button'); b.className = 'pth-nav'; b.style[side] = '10px'; b.textContent = label;
        b.disabled = k + d < 0 || k + d >= L.length; b.onclick = e => { e.stopPropagation(); stepLb(d); }; return b; };
      ov.append(top, stage, nav(-1, 'left', '‹'), nav(1, 'right', '›'));
    }
    const stepLb = d => { const j = k + d; if (j < 0 || j >= L.length) return; k = j; show(); };
    const key = e => { const d = {ArrowLeft: -1, ArrowRight: 1}[e.key];
      if (e.key === 'Escape') close(); else if (d) stepLb(d); else return; e.preventDefault(); e.stopPropagation(); };
    function close() { document.removeEventListener('keydown', key, true); ov.remove(); redraw(); }
    document.addEventListener('keydown', key, true);
    document.body.append(ov); show();
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

  /* Library: Pathology → Slide photos (the panel) + one row per slide (opens that slide in the Viewer) */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = ('pathology slides slide photos gallery compare biopsy stain ihc ' + P.stains.map(s => s.label).join(' ') + ' ' + P.cases.map(c => c.title + ' ' + c.diagnosis).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return;
    const SEC = section(el, 'path', 'Pathology', nSlides + ' slides', true, 'sec', q), s0 = SEC.firstChild;
    s0.insertBefore(groupOnlyBtn('pathology panel', 'grp:path', [ID], soloLab && soloLab.key === 'grp:path', false, () => onlyLab('grp:path', [ID], 'Pathology')), s0.lastChild);
    const row = (label, count, tip, checked, onTick, onName) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked; cb.setAttribute('aria-label', 'Show ' + label);
      cb.onclick = e => { e.stopPropagation(); onTick(cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      d.append(cb, nm, n); d.onclick = onName || (() => { cb.checked = !cb.checked; onTick(cb.checked); }); return d; };
    SEC.append(row('Slide photos', nPhotos + ' photos', 'Overview, gallery, viewer and side-by-side compare of the slide photos', sel.includes(ID), v => setLabSel([ID], v)));
    P.cases.forEach(c => {
      const G = section(SEC, 'path:' + c.key, c.title + ' · ' + c.date.slice(0, 7), c.slides.length + ' slides', false, 'grp', q);
      G.append(row('Line on the timeline', c.date.slice(0, 7), 'A line on every chart on ' + fd(c.date) + '; click the line to open these photos',
        onLine.has(c.key), v => setOnLine([c.key], v)));
      keyframes.map(findKey).filter(it => it && it.c === c).forEach(it => G.append(row('🔖 ' + slideName(c, it.s) + ' #' + (it.i + 1), 'keyframe',
        'Saved as a line on the timeline\nUntick: remove it · Click: open this photo', true, v => { if (!v) toggleKey(it); }, () => openPhoto(pkey(it)))));
      c.slides.forEach(s => { const sk = slideKey(c, s), open = () => { V.caseKey = c.key; V.filter = sk; V.cur = sk + '|' + coverOf(c, s); V.mode = 'viewer'; save(); };
        G.append(row(slideName(c, s), (c.results[s.stain] || '').slice(0, 14), (c.results[s.stain] || '') + '\nClick: open this slide in the Pathology viewer',
          sel.includes(ID) && V.mode === 'viewer' && V.filter === sk,
          v => { if (v) { open(); sel.includes(ID) ? (redraw(), list()) : setLabSel([ID], true); } else go('overview'); },
          () => { open(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } })); });
    });
  };

  syncMoments(); (window.momentSyncers = window.momentSyncers || []).push(syncMoments);   // again after the shared edits load
  const saved = store.get('selected', []);
  if (saved.includes(ID) && !sel.includes(ID)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
