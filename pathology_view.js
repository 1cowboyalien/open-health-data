/* Pathology slide photos in the Library of the lab viewer (labs.html). Used by make_lab_view.py when
   local/pathology/pathology.json exists. Everything about the patient (cases, stains, results, photos) comes from
   PATH_DATA, never from this code; the photos are served by serve_viewer.py at /pathology/<case>/{full,thumb}/<file>.jpg.
   It plugs into the same hooks as the MRD, imaging and procedure panels (MRD.isId/title/unit/h0/panel/refresh/section),
   so the panel gets the viewer's ⤒ ↑ ↓ ⤓ − + × controls.
   Panel path:slides has two views:
     Overview = one cover photo per slide, with the stain and the report's result for it
     Slide    = one photo large (◀ ▶ or the arrow keys), every photo of that slide in a strip below, what the stain shows,
                "Use as cover" (a view setting kept in this browser) and a link to the full-size photo.
   Data: PATH_DATA = {stains:[{key,label,kind,what}], cases:[{key,title,date,site,review,diagnosis,source,results:{stain:text},
                      slides:[{stain,slide,photos:[file],cover}]}]}, made outside this repo (it holds health data). */
(() => {
  const P = PATH_DATA;
  const ID = 'path:slides';
  const nPhotos = P.cases.reduce((a, c) => a + c.slides.reduce((b, s) => b + s.photos.length, 0), 0);
  const nSlides = P.cases.reduce((a, c) => a + c.slides.length, 0);
  const PANEL = {title: 'Pathology · slide photos', unit: nSlides + ' slides · ' + nPhotos + ' photos', h0: 520};
  const ST = Object.fromEntries(P.stains.map(s => [s.key, s]));
  const KCOL = {routine: '#a03a8c', IHC: '#9a6a1c', control: '#6b7280'};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const url = (c, kind, f) => '/pathology/' + encodeURIComponent(c.key) + '/' + kind + '/' + encodeURIComponent(f);
  const slideKey = (c, s) => c.key + '/' + s.stain + '_' + s.slide;
  const slideName = (c, s) => { const st = ST[s.stain] || {label: s.stain}, same = c.slides.filter(x => x.stain === s.stain).length > 1;
    return st.label + (same || s.slide !== '1' ? ' · slide ' + s.slide : ''); };
  const fd = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  // view state (kept in this browser): which case/slide/photo is open, and the user's own cover picks
  const V = Object.assign({mode: 'overview', caseKey: P.cases[0] && P.cases[0].key, slide: null, photo: 0}, store.get('path.view', {}));
  const covers = store.get('path.covers', {});
  const save = () => { store.set('path.view', V); store.set('path.covers', covers); };
  const curCase = () => P.cases.find(c => c.key === V.caseKey) || P.cases[0];
  const curSlide = c => c.slides.find(s => slideKey(c, s) === V.slide) || c.slides[0];
  const coverOf = (c, s) => covers[slideKey(c, s)] || s.cover;
  let BODY = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(ID, BODY); };

  if (!document.getElementById('pathCss')) { const st = document.createElement('style'); st.id = 'pathCss';
    st.textContent =
      '.pth-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}' +
      '.pth-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}' +
      '.pth-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}.pth-b:disabled{opacity:.35;cursor:default}' +
      '.pth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;overflow:auto}' +
      '.pth-tile{border:1px solid var(--line);border-radius:6px;overflow:hidden;cursor:pointer;background:var(--card)}' +
      '.pth-tile:hover{outline:2px solid var(--ink)}.pth-tile img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#ddd}' +
      '.pth-tile .cap{padding:4px 6px;font-size:12px;line-height:1.3}.pth-res{font-weight:600}' +
      '.pth-main{display:flex;gap:10px;min-height:0}.pth-img{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;background:#111;border-radius:6px;position:relative;outline:none}' +
      '.pth-img img{max-width:100%;max-height:100%;object-fit:contain;display:block}' +
      '.pth-img .nav{position:absolute;top:50%;transform:translateY(-50%);font-size:20px;width:34px;height:48px;border:0;border-radius:6px;background:rgba(0,0,0,.35);color:#fff;cursor:pointer}' +
      '.pth-img .nav:hover{background:rgba(0,0,0,.6)}.pth-img .nav:disabled{opacity:.2;cursor:default}' +
      '.pth-side{flex:0 0 230px;font-size:12px;line-height:1.4;overflow:auto}.pth-side h4{margin:0 0 4px;font-size:14px}' +
      '.pth-strip{display:flex;gap:4px;overflow-x:auto;padding:6px 0 2px}.pth-strip img{height:54px;border-radius:3px;cursor:pointer;opacity:.75;border:2px solid transparent;flex:none}' +
      '.pth-strip img:hover{opacity:1}.pth-strip img.on{opacity:1;border-color:var(--ink)}.pth-strip img.cv{box-shadow:0 -3px 0 #e0a020 inset}';
    document.head.append(st); }
  const mkBtn = (label, on, tip, fn) => { const b = document.createElement('button'); b.className = 'pth-b' + (on ? ' on' : ''); b.textContent = label; b.title = tip; b.onclick = fn; return b; };
  const kindTag = st => `<span style="font-size:10px;padding:0 5px;border-radius:8px;color:#fff;background:${KCOL[st.kind] || '#888'}">${esc(st.kind)}</span>`;

  function openSlide(c, s, photo) {
    V.caseKey = c.key; V.slide = slideKey(c, s); V.mode = 'slide';
    V.photo = photo != null ? photo : Math.max(0, s.photos.indexOf(coverOf(c, s)));
    save(); focusImg = true; redraw(); }
  let focusImg = false;   // after opening a slide or stepping, give the photo the keyboard so ← → step through photos

  function draw(id, body) {
    BODY = body; body.innerHTML = '';
    const c = curCase(); if (!c) { body.textContent = 'No pathology cases.'; return; }
    const H = hOf(id, PANEL.h0);
    // header: case + view switch + every slide as a chip
    const bar = document.createElement('div'); bar.className = 'pth-bar';
    if (P.cases.length > 1) P.cases.forEach(k => bar.append(mkBtn(fd(k.date) + ' ' + k.title, k.key === c.key, k.site, () => { V.caseKey = k.key; V.slide = null; save(); redraw(); })));
    bar.append(mkBtn('Overview', V.mode === 'overview', 'One cover photo per slide, with the result', () => { V.mode = 'overview'; save(); redraw(); }));
    c.slides.forEach(s => { const st = ST[s.stain] || {label: s.stain};
      const b = mkBtn(slideName(c, s), V.mode === 'slide' && slideKey(c, s) === V.slide, (c.results[s.stain] || '') + ' · ' + s.photos.length + ' photos', () => openSlide(c, s));
      bar.append(b); });
    body.append(bar);
    const info = document.createElement('div'); info.className = 'sub'; info.style.cssText = 'font-size:12px;margin-bottom:6px';
    info.innerHTML = `<b style="color:var(--ink)">${esc(c.title)}</b> · ${esc(fd(c.date))} · ${esc(c.site)} — ${esc(c.diagnosis)}<br>${esc(c.review)}`;
    info.title = 'Source: ' + c.source;
    body.append(info);
    const room = Math.max(200, H - 80);
    if (V.mode !== 'slide') return drawOverview(body, c, room);
    drawSlide(body, c, curSlide(c), room);
  }

  function drawOverview(body, c, room) {
    const g = document.createElement('div'); g.className = 'pth-grid'; g.style.maxHeight = room + 'px';
    c.slides.forEach(s => { const st = ST[s.stain] || {label: s.stain, kind: ''};
      const t = document.createElement('div'); t.className = 'pth-tile'; t.title = st.what || '';
      t.innerHTML = `<img loading="lazy" alt="${esc(slideName(c, s))}" src="${url(c, 'thumb', coverOf(c, s))}">
        <div class="cap"><b>${esc(slideName(c, s))}</b> ${kindTag(st)}<br><span class="pth-res">${esc(c.results[s.stain] || '—')}</span>
        <span class="sub"> · ${s.photos.length} photos</span></div>`;
      t.onclick = () => openSlide(c, s); g.append(t); });
    body.append(g);
  }

  function drawSlide(body, c, s, room) {
    const st = ST[s.stain] || {label: s.stain, kind: '', what: ''};
    const n = s.photos.length; V.photo = Math.min(Math.max(0, V.photo | 0), n - 1);
    const f = s.photos[V.photo];
    const main = document.createElement('div'); main.className = 'pth-main'; main.style.height = Math.max(140, room - 72) + 'px';
    const box = document.createElement('div'); box.className = 'pth-img'; box.tabIndex = 0; box.title = 'Arrow keys: previous / next photo';
    const img = document.createElement('img'); img.src = url(c, 'full', f); img.alt = slideName(c, s) + ' photo ' + (V.photo + 1);
    const go = d => { const k = V.photo + d; if (k < 0 || k >= n) return; V.photo = k; save(); focusImg = true; redraw(); };
    const prev = document.createElement('button'); prev.className = 'nav'; prev.style.left = '6px'; prev.textContent = '‹'; prev.title = 'Previous photo'; prev.disabled = V.photo === 0; prev.onclick = () => go(-1);
    const next = document.createElement('button'); next.className = 'nav'; next.style.right = '6px'; next.textContent = '›'; next.title = 'Next photo'; next.disabled = V.photo === n - 1; next.onclick = () => go(1);
    box.onkeydown = e => { const d = {ArrowLeft: -1, ArrowRight: 1}[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); go(d); };
    box.append(img, prev, next);
    const side = document.createElement('div'); side.className = 'pth-side';
    const isCover = coverOf(c, s) === f;
    side.innerHTML = `<h4>${esc(slideName(c, s))} ${kindTag(st)}</h4>
      <div>Report: <span class="pth-res">${esc(c.results[s.stain] || '—')}</span></div>
      <p style="margin:6px 0">${esc(st.what)}</p>
      <div class="sub">Photo ${V.photo + 1} of ${n} · ${esc(f)}</div>`;
    const acts = document.createElement('div'); acts.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-top:6px';
    acts.append(mkBtn(isCover ? '★ Cover' : '☆ Use as cover', isCover, 'The cover is the photo shown for this slide in the Overview (kept in this browser)', () => {
      covers[slideKey(c, s)] = f; save(); redraw(); }));
    const a = document.createElement('a'); a.href = url(c, 'full', f); a.target = '_blank'; a.rel = 'noopener'; a.className = 'pth-b'; a.textContent = 'Full size ↗'; a.style.textDecoration = 'none';
    acts.append(a);
    side.append(acts);
    main.append(box, side);
    body.append(main);
    const strip = document.createElement('div'); strip.className = 'pth-strip';
    const cv = coverOf(c, s);
    s.photos.forEach((p, i) => { const t = document.createElement('img'); t.loading = 'lazy'; t.src = url(c, 'thumb', p); t.alt = 'Photo ' + (i + 1);
      t.title = 'Photo ' + (i + 1) + (p === cv ? ' (cover)' : ''); t.className = (i === V.photo ? 'on' : '') + (p === cv ? ' cv' : '');
      t.onclick = () => { V.photo = i; save(); focusImg = true; redraw(); }; strip.append(t); });
    body.append(strip);
    if (focusImg) { focusImg = false; box.focus({preventScroll: true}); }
    const on = strip.querySelector('img.on'); if (on) requestAnimationFrame(() => { strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2; });
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

  /* Library: Pathology → Slide photos (the panel) + one row per slide (opens that slide in the panel) */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = ('pathology slides slide photos biopsy stain ihc ' + P.stains.map(s => s.label).join(' ') + ' ' + P.cases.map(c => c.title + ' ' + c.diagnosis).join(' ')).toLowerCase();
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
    SEC.append(row('Slide photos', nPhotos + ' photos', 'Overview of every slide, or one slide with all its photos', sel.includes(ID), v => setLabSel([ID], v)));
    P.cases.forEach(c => {
      const G = section(SEC, 'path:' + c.key, c.title + ' · ' + c.date.slice(0, 7), c.slides.length + ' slides', false, 'grp', q);
      c.slides.forEach(s => G.append(row(slideName(c, s), (c.results[s.stain] || '').slice(0, 14), (c.results[s.stain] || '') + '\nClick: open this slide in the Pathology panel',
        sel.includes(ID) && V.mode === 'slide' && V.slide === slideKey(c, s), v => { if (v) { openSlide(c, s); setLabSel([ID], true); } else { V.mode = 'overview'; save(); redraw(); list(); } },
        () => { openSlide(c, s); if (!sel.includes(ID)) setLabSel([ID], true); else list(); })));
    });
  };

  const saved = store.get('selected', []);
  if (saved.includes(ID) && !sel.includes(ID)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
