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
     Spots list = every named spot (teaching label) with stain/kind filters, and the automatic nucleus counts: all photos, per stain,
                and per photo (click a row to open that photo). "• Spots" in the Viewer / full window draws a ring on every nucleus
                the color program found (positions fetched per slide from /pathology/<case>/spots/<stain>_<slide>.json)
     Compare  = the ＋ photos side by side in 1-4 columns (◀ ▶ reorder, × remove); "Covers" fills it with every slide's cover
     Learn    = a written lesson per slide ("Start here" + one per slide): what the stain is, how to read it, how it is scored, what
                the report says, textbook examples with links, the slide's own numbers, pitfalls, questions to ask. The text comes
                from the private data (c.lessons); this file only draws it. The Viewer shows each lesson's short "what to look for".
   "◧ Tissue map" in the Viewer / full window tints each photo by an estimated "likely tumor / healthy tissue / can't tell" map made
   by a color program (fetched per slide from /pathology/<case>/masks/<stain>_<slide>.json), with name tags on the biggest patches,
   a "here:" readout under the pointer, a see-through slider, and a six-class "Tissue types" version.
   ⛶ (or double-click a photo) opens the full-window view: ‹ › / arrow keys, click the photo to see it at full resolution, Esc closes.
   On the timeline: one line per case on every chart (the biopsy date, results in its note; Library tick, on by default), and
   photos saved with 🔖 Keyframe as lines on the case date (group "Saved slide photos"). Both are generated moments, never written
   to the edits file; clicking one opens the case or the photo here. A case's `procedure` id links it with the Procedures panel
   (its card gets a "Slide photos" button through window.PATH; the Overview gets "Show in Procedures" through window.PROC_SHOW).
   View settings, compare picks, cover picks, timeline ticks and keyframes are kept in this browser
   (store 'path.view', 'path.covers', 'path.moments', 'path.keys').
   Data: PATH_DATA = {stains:[{key,label,kind,what}], cases:[{key,title,date,site,review,diagnosis,source,results:{stain:text},
                      procedure?, lessons?, slides:[{stain,slide,photos:[file],cover, note?, marks?, ann?, auto?, tmap?}]}]},
         made outside this repo (it holds health data). */
(() => {
  const P = PATH_DATA;
  const ID = 'path:slides';
  const nPhotos = P.cases.reduce((a, c) => a + c.slides.reduce((b, s) => b + s.photos.length, 0), 0);
  const nSlides = P.cases.reduce((a, c) => a + c.slides.length, 0);
  const PANEL = {title: 'Pathology · slide photos', unit: nSlides + ' slides · ' + nPhotos + ' photos', h0: 560};
  const ST = Object.fromEntries(P.stains.map(s => [s.key, s]));
  const KCOL = {routine: '#a03a8c', IHC: '#9a6a1c', control: '#6b7280'};
  const MODES = ['overview', 'learn', 'gallery', 'viewer', 'spots', 'compare'];
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
  // by-eye review marks per photo: [[kind, text]]; kinds best / art / fat / dup / note
  const MSYM = {best: '★', art: '⚠', fat: '○', dup: '≈', note: 'ℹ'}, MPRE = {art: 'Artifact: '};
  const marksOf = it => (it.s.marks && it.s.marks[it.f]) || [];
  const annOf = it => (it.s.ann && it.s.ann[it.f]) || null;   // teaching labels (Labels mode)
  const markSym = it => marksOf(it).map(m => MSYM[m[0]] || '').join('') + (annOf(it) ? '🏷' : '');
  const markText = it => marksOf(it).map(m => (MSYM[m[0]] || '') + ' ' + (MPRE[m[0]] || '') + m[1]).join('\n');
  let BODY = null, focusImg = false;
  let labSel = -1, labFor = null;   // selected teaching label and the photo it belongs to
  const LCOL = {tumor: '#ff4d4f', normal: '#22c55e', immune: '#38bdf8', blood: '#fb923c', structure: '#facc15', artifact: '#d4d4d8', measure: '#ffffff', kpos: '#ff2d95', kneg: '#00e5ff'};
  const LNAME = {tumor: 'Tumor', normal: 'Normal tissue', immune: 'Immune cells', blood: 'Blood', structure: 'Supporting tissue', artifact: 'Artifact (not real)', measure: 'Ruler', kpos: 'Ki-67 positive (brown nucleus)', kneg: 'Ki-67 negative (blue nucleus)'};
  /* Automatic spots: nuclei found by a color program (spots.swift, run outside this repo). Per photo the page has only the counts
     (s.auto = {mode, photos: {file: {c: {class: n}, b: brown % of tissue}}}); positions are fetched per slide from
     /pathology/<case>/spots/<stain>_<slide>.json = {mode, photos: {file: {w, h, spots: [x, y, class, n, ...]}}} when Spots is on. */
  const SCLS = {
    nuc: {p: ['#ff2d95', 'Brown nucleus (stained)'], n: ['#00e5ff', 'Blue round nucleus (not stained)'],
          t: ['#22c55e', 'Thin or small nucleus (stroma; not counted)'], x: ['#a1a1aa', 'Brown streak (crush or cautery?; not counted)']},
    ring: {r: ['#ff2d95', 'Nucleus with brown membrane all the way round (complete)'], i: ['#fb923c', 'Nucleus with brown part of the way round (partial)'],
           n: ['#00e5ff', 'Round nucleus, no brown membrane'], t: ['#22c55e', 'Thin or small nucleus (stroma; not counted)']},
    mem: {b: ['#ff2d95', 'Brown-stained cells (number estimated from the brown area)'], n: ['#00e5ff', 'Blue round nucleus (cell with no brown)'],
          t: ['#22c55e', 'Thin or small nucleus (stroma; not counted)']},
    he:  {l: ['#ff4d4f', 'Large nucleus (or several touching)'], m: ['#facc15', 'Medium nucleus'],
          s: ['#38bdf8', 'Small round nucleus (lymphocyte-sized)'], t: ['#22c55e', 'Thin, stretched nucleus (fibroblast, vessel)']}};
  const POS = {nuc: ['p'], mem: ['b'], ring: ['r', 'i']};
  const sName = (stain, mode, k) => stain === 'negc' && k === 'p' ? 'Brown spot (a control should have none: background or artifact)' : ((SCLS[mode] || {})[k] || ['', k])[1];
  const autoOf = it => (it.s.auto && it.s.auto.photos[it.f]) || null;
  const posN = (mode, c) => (POS[mode] || []).reduce((x, k) => x + (c[k] || 0), 0);
  const posPct = (mode, c) => { if (!POS[mode]) return null; const a = posN(mode, c), b = c.n || 0; return a + b ? Math.round(100 * a / (a + b)) : null; };
  const nucOf = c => Object.entries(c).reduce((a, [k, v]) => a + (k === 'x' ? 0 : v), 0);
  const isClean = (s, f) => !((s.marks && s.marks[f]) || []).some(m => m[0] === 'art' || m[0] === 'fat' || m[0] === 'dup');
  const spotCache = {};
  const spotsFor = (c, s) => spotCache[slideKey(c, s)] || (spotCache[slideKey(c, s)] =
    fetch('/pathology/' + encodeURIComponent(c.key) + '/spots/' + encodeURIComponent(s.stain + '_' + s.slide) + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
  function spotLayer(holder, img, it) {   // small rings on every nucleus the program found
    const NS = 'http://www.w3.org/2000/svg', ov = document.createElement('div'); ov.className = 'pth-ov pth-sp';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('preserveAspectRatio', 'none'); ov.append(svg); holder.append(ov);
    const place = () => Object.assign(ov.style, {left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px'});
    new ResizeObserver(place).observe(img);
    spotsFor(it.c, it.s).then(d => { const p = d && d.photos[it.f]; if (!p) return;
      svg.setAttribute('viewBox', '0 0 ' + p.w + ' ' + p.h);
      const cols = SCLS[d.mode] || {}, hide = new Set(V.spotHide || []); let h = '';
      for (let i = 0; i < p.spots.length; i += 4) { const k = p.spots[i + 2]; if (hide.has(k) || !cols[k]) continue;
        const r = (9 + 5 * Math.sqrt(Math.max(0, p.spots[i + 3] - 1))) * p.w / 1600;
        h += `<circle cx="${p.spots[i]}" cy="${p.spots[i + 1]}" r="${r.toFixed(1)}" stroke="${cols[k][0]}"/>`; }
      svg.innerHTML = '<g fill="none">' + h + '</g>'; place(); });
    if (img.complete) place(); else img.addEventListener('load', place, {once: true});
  }
  function autoBox(it, after) {   // counts for one photo, with class switches
    const a = autoOf(it); if (!a) return null; const mode = it.s.auto.mode, cols = SCLS[mode] || {}, hide = new Set(V.spotHide || []);
    const d = document.createElement('div'); d.style.cssText = 'margin:6px 0 8px';
    const pct = posPct(mode, a.c), tot = nucOf(a.c);
    d.innerHTML = `<b>Automatic spots</b> <span class="sub">${tot} nuclei found${V.spots ? '' : ' · switch • Spots on to see them'}</span>` +
      (pct != null ? `<div style="margin:3px 0"><b>${pct}%</b> ${mode === 'mem' ? 'of cells are brown (stained cells estimated from area)' : mode === 'ring' ? 'of round nuclei have brown membrane around them' + (posN(mode, a.c) ? ' (' + Math.round(100 * (a.c.r || 0) / posN(mode, a.c)) + '% of those all the way round)' : '') : 'of round nuclei are brown'}` +
        ` <span class="sub">(${posN(mode, a.c)} of ${posN(mode, a.c) + (a.c.n || 0)}, thin stromal nuclei left out${mode === 'mem' ? '; nuclei inside brown nests are too faint for the program, so it counts one stained cell per ~2,000 pixels of brown' : ''})</span></div>` : '') +
      (mode !== 'nuc' && mode !== 'he' ? `<div class="sub">Brown covers ${a.b}% of the tissue in this photo.</div>` : '');
    Object.keys(cols).forEach(k => { const r = document.createElement('div'); r.className = 'pth-li' + (hide.has(k) ? '' : ' on'); r.style.opacity = hide.has(k) ? .45 : 1;
      r.innerHTML = `<span style="color:${cols[k][0]};font-size:15px;line-height:14px">○</span><div style="flex:1">${esc(sName(it.s.stain, mode, k))}</div><b>${a.c[k] || 0}</b>`;
      r.title = 'Click to hide or show these rings';
      r.onclick = () => { const h = new Set(V.spotHide || []); h.has(k) ? h.delete(k) : h.add(k); V.spotHide = [...h]; save(); after(); }; d.append(r); });
    const n = document.createElement('div'); n.className = 'sub'; n.style.cssText = 'font-size:11px;margin-top:4px';
    n.textContent = (isClean(it.s, it.f) ? '' : 'This photo is marked as artifact, fat or a near-copy, so it is left out of the clean totals in the Spots list. ') +
      'Found by a color program, not a pathologist: it does not decide tumor vs normal, touching nuclei are estimated by area, and pale nuclei can be missed.';
    d.append(n); return d; }
  const spotBtn = (it, after) => mkBtn('• Spots' + (V.spots ? ': on' : ''), !!V.spots, autoOf(it) ? 'Show or hide a ring on every nucleus the color program found (color = class)' : 'No automatic spots for this photo',
    () => { V.spots = !V.spots; save(); after(); });
  /* Tissue map: an estimated "likely tumor vs the rest" layer per photo, made by a color program outside this repo (tissue.swift:
     white balance, stain separation, how crowded and how stained the tissue is on a 5-px grid, then rules per stain and hand corrections).
     The page has only the shares (s.tmap = {rule, photos: {file: [tissue % of the frame, % of the tissue in class 1..6]}}); the map is
     fetched per slide from /pathology/<case>/masks/<stain>_<slide>.json = {rule, gw, gh, photos: {file: {rle}}} when the layer is on
     (rle = runs of <class letter a-g><count>, row by row).
     Classes: 1 likely tumor · 2 support tissue · 3 immune cells · 4 normal structure · 5 can't judge · 6 cell-rich, can't tell.
     "Cancer vs healthy" shows three groups: tumor (1) · healthy (2, 3, 4) · can't tell (5, 6). */
  const TRGB = {1: [255, 45, 110], 2: [34, 197, 94], 3: [56, 189, 248], 4: [20, 184, 166], 5: [156, 163, 175], 6: [245, 158, 11]};
  const TGRP = {1: 't', 2: 'h', 3: 'h', 4: 'h', 5: 'u', 6: 'u'}, GRGB = {t: [255, 45, 110], h: [34, 197, 94], u: [245, 158, 11]};
  const GNAME = {t: 'Likely tumor', h: 'Healthy tissue (not tumor)', u: "Can't tell"}, GTAG = {t: 'likely tumor', h: 'healthy', u: "can't tell"};
  const TTAG = {1: 'likely tumor', 2: 'support tissue', 3: 'immune cells', 4: 'normal structure', 5: "can't judge", 6: "cells, can't tell"};
  const rgb = a => 'rgb(' + a.join(',') + ')';
  const tRule = s => (s.tmap && s.tmap.rule) || '';
  const tMarker = rule => rule === 'mem' || rule === 'nuc:pos', tSkin = rule => rule.indexOf('he:skin') === 0;
  const TNAME = (rule, k) => ({
    1: rule === 'mem' ? 'Likely tumor: cells carrying the brown stain' : rule === 'nuc:pos' ? 'Likely tumor: areas with brown nuclei'
      : tSkin(rule) ? "Likely tumor: clusters of large cells in the skin's collagen" : 'Likely tumor: crowded cells (no stain here to confirm it)',
    2: 'Support tissue: collagen, muscle, vessels, fat walls',
    3: 'Immune cells: small, very dark, round nuclei',
    4: 'Normal structure: skin surface, gland or muscle',
    5: "Can't judge: ink, smear, fold or heat damage",
    6: tMarker(rule) ? 'Cells without the brown stain: support or immune cells, or tumor cells that did not stain'
      : "Cell-rich, can't tell: a small vessel, a gland duct or a few tumor cells"})[k];
  const TSURE = rule => rule === 'mem' ? 'Fairly sure where it is red: the brown stain itself marks the tumor cells. Solid brown blobs with no cell outlines are set aside as "can\'t judge".'
    : rule === 'nuc:pos' ? 'Fairly sure where it is red: brown nuclei mark tumor cells. Tumor cells whose nuclei did not stain fall under "can\'t tell".'
    : tSkin(rule) ? 'Moderately sure: it goes by crowding, how dark the nuclei are and patch size, and was then corrected by eye (skin surface, glands). Small patches are left as "can\'t tell".'
    : 'Least sure: it goes by crowding only. Immune cells and heat-damaged tissue are crowded too, and nothing on this slide marks the tumor.';
  const THOW = rule => (rule.indexOf('he') === 0 ? 'The program measures how purple (cell-rich) each small patch of tissue is. Pink, cell-poor tissue is support tissue; purple, crowded tissue is cell-rich.'
      + (tSkin(rule) ? ' On skin, clusters of very dark small round nuclei are called immune cells and a solid sheet at the surface is the skin itself.' : '')
    : rule === 'mem' ? 'The program measures how much of each small patch is brown (the stain) and how many blue nuclei it has. Brown-rich = likely tumor; blue cell-rich with no brown = can\'t tell; the rest = support tissue.'
    : rule === 'nuc:pos' ? 'The program measures how much of each small patch is brown nuclei and how many blue nuclei it has. Brown nuclei = likely tumor; blue cell-rich with no brown = can\'t tell; the rest = support tissue.'
    : 'Nothing is brown on this slide, so the program can only measure how crowded the blue nuclei are. Crowded = likely tumor; sparse = support tissue.')
    + ' Made by a color program: not a pathologist and not a trained AI model. Use it to find your way around the photo, not as a diagnosis.';
  const tmOf = it => (it.s.tmap && it.s.tmap.photos[it.f]) || null;
  const tmGroups = a => ({t: a[1], h: a[2] + a[3] + a[4], u: a[5] + a[6]});
  const tmAgg = (s, clean) => { const o = [0, 0, 0, 0, 0, 0, 0]; let n = 0;   // slide totals, weighted by how much tissue each photo holds
    Object.entries((s.tmap || {photos: {}}).photos).forEach(([f, a]) => { if (clean && !isClean(s, f)) return; n++; o[0] += a[0]; for (let k = 1; k < 7; k++) o[k] += a[k] * a[0]; });
    return {n, a: [n ? o[0] / n : 0].concat(o.slice(1).map(x => o[0] ? x / o[0] : 0))}; };
  const pc = x => x >= 9.95 || x === 0 ? Math.round(x) + '%' : x < 1 ? '<1%' : x.toFixed(1).replace(/\.0$/, '') + '%';
  const maskCache = {};
  const masksFor = (c, s) => maskCache[slideKey(c, s)] || (maskCache[slideKey(c, s)] =
    fetch('/pathology/' + encodeURIComponent(c.key) + '/masks/' + encodeURIComponent(s.stain + '_' + s.slide) + '.json').then(r => r.ok ? r.json() : null).catch(() => null));
  function tmapLayer(holder, img, it) {   // the tinted map, name tags on the biggest patches, and a "here:" readout under the pointer
    const cv = document.createElement('canvas'); cv.className = 'pth-ov pth-tm'; cv.style.opacity = V.tmapOp || .5;
    const tg = document.createElement('div'); tg.className = 'pth-ov pth-tg';
    const here = document.createElement('div'); here.className = 'pth-here';
    holder.append(cv, tg, here);
    const place = () => [cv, tg].forEach(e => Object.assign(e.style, {left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px'}));
    new ResizeObserver(place).observe(img);
    masksFor(it.c, it.s).then(d => { const m = d && d.photos[it.f]; if (!m) { here.textContent = 'No tissue map for this photo'; here.style.display = 'block'; return; }
      const w = d.gw, h = d.gh, g = new Uint8Array(w * h), rule = d.rule || tRule(it.s), two = V.tmapMode !== 'detail', hide = new Set((V.tmapHide || []).map(String));
      const re = /([a-g])(\d+)/g; let x, i = 0; while ((x = re.exec(m.rle))) { const n = +x[2]; g.fill(x[1].charCodeAt(0) - 97, i, i + n); i += n; }
      const keyOf = k => k ? (two ? TGRP[k] : k) : 0, colOf = k => two ? GRGB[TGRP[k]] : TRGB[k];
      cv.width = w; cv.height = h; const ctx = cv.getContext('2d'), im = ctx.createImageData(w, h);
      for (i = 0; i < g.length; i++) { const k = g[i]; if (!k || hide.has(String(keyOf(k)))) continue; const col = colOf(k), q = keyOf(k), X = i % w;
        const edge = (X > 0 && keyOf(g[i - 1]) !== q) || (X < w - 1 && keyOf(g[i + 1]) !== q) || (i >= w && keyOf(g[i - w]) !== q) || (i < g.length - w && keyOf(g[i + w]) !== q);
        im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = edge ? 255 : 150; }
      ctx.putImageData(im, 0, 0);
      // name tags: for each kind, the deepest point of its biggest patch (so the tag sits well inside the color)
      const keys = two ? ['t', 'h', 'u'] : [1, 2, 3, 4, 5, 6], seen = new Uint8Array(w * h), dist = new Int16Array(w * h), st = new Int32Array(w * h);
      keys.forEach(q => { if (hide.has(String(q))) return; let best = null;
        for (let s0 = 0; s0 < g.length; s0++) { if (seen[s0] || keyOf(g[s0]) !== q) continue; let n = 0, top = 0; st[top++] = s0; seen[s0] = 1; const cells = [];
          while (top) { const c = st[--top]; cells.push(c); n++; const X = c % w;
            if (X > 0 && !seen[c - 1] && keyOf(g[c - 1]) === q) { seen[c - 1] = 1; st[top++] = c - 1; }
            if (X < w - 1 && !seen[c + 1] && keyOf(g[c + 1]) === q) { seen[c + 1] = 1; st[top++] = c + 1; }
            if (c >= w && !seen[c - w] && keyOf(g[c - w]) === q) { seen[c - w] = 1; st[top++] = c - w; }
            if (c < g.length - w && !seen[c + w] && keyOf(g[c + w]) === q) { seen[c + w] = 1; st[top++] = c + w; } }
          if (!best || n > best.n) best = {n, cells}; }
        if (!best || best.n < w * h * 0.012) return;
        for (let c = 0; c < g.length; c++) { const X = c % w; dist[c] = keyOf(g[c]) !== q ? 0 : Math.min(X > 0 ? dist[c - 1] + 1 : 1, c >= w ? dist[c - w] + 1 : 1); }
        for (let c = g.length - 1; c >= 0; c--) { const X = c % w; if (dist[c]) dist[c] = Math.min(dist[c], X < w - 1 ? dist[c + 1] + 1 : 1, c < g.length - w ? dist[c + w] + 1 : 1); }
        let at = best.cells[0]; best.cells.forEach(c => { if (dist[c] > dist[at]) at = c; });
        const b = document.createElement('div'); b.className = 'pth-bdg m'; b.textContent = two ? GTAG[q] : TTAG[q];
        b.style.cssText = `left:${(at % w + .5) / w * 100}%;top:${(Math.floor(at / w) + .5) / h * 100}%;background:${rgb(two ? GRGB[q] : TRGB[q])};color:#000`;
        tg.append(b); });
      place();
      img.addEventListener('mousemove', e => { const r = img.getBoundingClientRect(), X = Math.floor((e.clientX - r.left) / r.width * w), Y = Math.floor((e.clientY - r.top) / r.height * h);
        const k = X >= 0 && Y >= 0 && X < w && Y < h ? g[Y * w + X] : 0;
        here.style.display = 'block'; here.innerHTML = k ? `<span class="pth-chip" style="background:${rgb(colOf(k))}"></span> Here: ${esc(TNAME(rule, k))}` : 'Here: empty (glass, fat or a gap)'; });
      img.addEventListener('mouseleave', () => { here.style.display = 'none'; }); });
    if (img.complete) place(); else img.addEventListener('load', place, {once: true});
  }
  function tmapBox(it, after) {   // this photo's shares, the legend (click a row to hide it), the two color schemes and the see-through slider
    const a = tmOf(it); if (!a) return null; const rule = tRule(it.s), two = V.tmapMode !== 'detail', hide = new Set((V.tmapHide || []).map(String)), g = tmGroups(a);
    const rows = two ? ['t', 'h', 'u'].map(k => [k, GNAME[k], g[k], GRGB[k]]) : [1, 2, 3, 4, 5, 6].map(k => [k, TNAME(rule, k), a[k], TRGB[k]]);
    const d = document.createElement('div'); d.style.cssText = 'margin:6px 0 8px';
    d.innerHTML = `<b>Tissue map</b> <span class="sub">${V.tmap ? 'an estimate, not a diagnosis' : 'switch ◧ Tissue map on to see it'}</span>` +
      `<div class="pth-stk" title="Share of the tissue in this photo">${rows.filter(r => r[2] > 0).map(r => `<span style="width:${r[2]}%;background:${rgb(r[3])}" title="${esc(r[1])}: ${pc(r[2])}"></span>`).join('')}</div>`;
    const md = document.createElement('div'); md.className = 'pth-bar'; md.style.margin = '4px 0';
    md.append(mkBtn('Cancer vs healthy', two, "Three colors: likely tumor, healthy tissue, can't tell", () => { V.tmapMode = 'two'; V.tmapHide = []; save(); after(); }),
      mkBtn('Tissue types', !two, 'Six colors: tumor, support tissue, immune cells, normal structure, can\'t judge, cell-rich can\'t tell', () => { V.tmapMode = 'detail'; V.tmapHide = []; save(); after(); }));
    d.append(md);
    d.append(range('See-through', 15, 95, 5, Math.round((V.tmapOp || .5) * 100), 'How strongly the colors cover the photo', v => { V.tmapOp = v / 100; save();
      document.querySelectorAll('.pth-tm').forEach(e => { e.style.opacity = V.tmapOp; }); }));
    rows.forEach(([k, name, p, col]) => { if (!p && !two) return; const r = document.createElement('div'); r.className = 'pth-li'; r.style.opacity = hide.has(String(k)) ? .45 : 1;
      r.innerHTML = `<span class="pth-chip" style="background:${rgb(col)}"></span><div style="flex:1">${esc(name)}</div><b>${pc(p)}</b>`;
      r.title = 'Click to hide or show this color';
      r.onclick = () => { const hs = new Set((V.tmapHide || []).map(String)); hs.has(String(k)) ? hs.delete(String(k)) : hs.add(String(k)); V.tmapHide = [...hs]; save(); after(); }; d.append(r); });
    const n = document.createElement('div'); n.className = 'sub'; n.style.cssText = 'font-size:11px;margin-top:4px';
    n.innerHTML = `Shares are of the tissue in this photo (tissue fills ${pc(a[0])} of the frame; glass, fat and gaps are left clear).<br><b>How sure:</b> ${esc(TSURE(rule))}<br><b>How it is made:</b> ${esc(THOW(rule))}`;
    d.append(n); return d; }
  const tmapBtn = (it, after) => mkBtn('◧ Tissue map' + (V.tmap ? ': on' : ''), !!V.tmap, tmOf(it) ? 'Tint the photo by an estimated map: likely tumor, healthy tissue, can\'t tell (made by a color program)' : 'No tissue map for this photo',
    () => { V.tmap = !V.tmap; save(); after(); });
  function photoSay(it) {   // one or two sentences about this photo, from the numbers
    const a = tmOf(it); if (!a) return ''; const g = tmGroups(a);
    if (a[0] < 12) return 'Almost no tissue in this photo (' + pc(a[0]) + ' of the frame): mostly empty glass or fat.';
    const all = Object.values(it.s.tmap.photos).filter(x => x[0] >= 12).map(x => x[1]), below = all.filter(x => x < a[1]).length, rule = tRule(it.s);
    const kind = g.t >= 60 ? 'Mostly tumor-rich tissue' : g.t >= 25 ? 'A mix of tumor-rich areas and other tissue' : g.t >= 5 ? 'Mostly other tissue and a few tumor-rich patches'
      : g.u >= 40 ? 'Mostly tissue the map can\'t call either way' : 'Almost no tumor-rich area found by the map';
    const extra = [];
    if (a[4] >= 8) extra.push('a normal structure (skin surface, gland or muscle)');
    if (a[3] >= 2) extra.push('a cluster of immune cells');
    if (a[6] >= 15) extra.push(tMarker(rule) ? 'a large area of crowded cells without the brown stain' : 'cell-rich patches it can\'t name');
    if (a[5] >= 5) extra.push('an area that can\'t be judged (ink, smear or fold)');
    const listed = extra.length < 2 ? extra.join('') : extra.slice(0, -1).join('; ') + '; and ' + extra[extra.length - 1];
    return `${kind}${extra.length ? ', with ' + listed : ''}. Tissue fills about ${pc(a[0])} of the frame; of that, the map calls ${pc(g.t)} likely tumor, ${pc(g.h)} healthy` +
      (g.u >= 1 ? ` and ${pc(g.u)} can't tell` : '') + '.' + (g.t >= 1 ? ` More tumor-rich than ${below} of the ${all.length} photos of this slide that show tissue.` : ''); }
  /* Draw an annotation's labels over an <img> inside holder (holder must be position:relative).
     Shapes are in the 1600-px-wide photo's pixels; badges are HTML so they stay a readable size. */
  function overlay(holder, img, ann, onPick, onHover) {
    const NS = 'http://www.w3.org/2000/svg', W = 1600;
    const ov = document.createElement('div'); ov.className = 'pth-ov';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('preserveAspectRatio', 'none'); ov.append(svg); holder.append(ov);
    const els = []; let hover = null;
    const mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };
    function build() {
      const H = img.naturalWidth ? W * img.naturalHeight / img.naturalWidth : 900; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      ann.labels.forEach((L, i) => { const col = LCOL[L.kind] || '#fff', g = mk('g', {}); let bx, by;
        const sw = {stroke: col, 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke', class: 'k'};
        const halo = at => Object.assign({}, at, {stroke: 'rgba(0,0,0,.55)', 'stroke-width': 5, fill: 'none', class: 'h'});   // dark rim: visible on any stain
        if (L.line) { const [x1, y1, x2, y2] = L.line, len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len * 9, ny = (x2 - x1) / len * 9;
          const Q = [[x1, y1, x2, y2], [x1 - nx, y1 - ny, x1 + nx, y1 + ny], [x2 - nx, y2 - ny, x2 + nx, y2 + ny]].map(q => ({x1: q[0], y1: q[1], x2: q[2], y2: q[3]}));
          Q.forEach(q => g.append(mk('line', halo(Object.assign({}, q, sw))))); Q.forEach(q => g.append(mk('line', Object.assign({}, q, sw))));
          bx = (x1 + x2) / 2; by = Math.max(y1, y2) + 48;   // below the line, so it doesn't hide what it measures
        } else if (L.box) { const [x, y, w, h] = L.box, geo = {x, y, width: w, height: h};   // a counting box
          g.append(mk('rect', halo(Object.assign({}, geo, sw)))); g.append(mk('rect', Object.assign({}, geo, {fill: 'none', 'stroke-dasharray': '10 6'}, sw)));
          bx = x + w / 2; by = y + h + 34;
        } else if (L.x != null) { const rx = L.rx || L.r, ry = L.ry || L.r;
          const geo = {cx: L.x, cy: L.y, rx, ry}; g.append(mk('ellipse', halo(Object.assign({}, geo, sw))));
          const e = mk('ellipse', Object.assign({}, geo, {fill: col, 'fill-opacity': 0.06}, sw));
          if (L.sure === 'maybe') e.setAttribute('stroke-dasharray', '7 5');
          g.append(e); bx = L.x - rx * 0.71; by = L.y - ry * 0.71; }
        (L.dots || []).forEach(([x, y]) => { const geo = {cx: x, cy: y, r: L.dotR || 13};   // one small ring per counted nucleus
          g.append(mk('circle', halo(Object.assign({}, geo, sw)))); g.append(mk('circle', Object.assign({}, geo, {fill: 'none'}, sw))); });
        if (bx == null && L.dots && L.dots.length) { bx = L.dots[0][0] - 22; by = L.dots[0][1] - 22; }
        const t = mk('title', {}); t.textContent = (L.kind === 'measure' ? '' : (i + 1) + '. ') + L.name; g.append(t);
        svg.append(g);
        const b = document.createElement('div'); b.className = 'pth-bdg' + (L.kind === 'measure' ? ' m' : '');
        b.style.left = Math.max(1, Math.min(99, bx / W * 100)) + '%'; b.style.top = Math.max(2, Math.min(98, by / H * 100)) + '%';
        if (L.kind !== 'measure') b.style.background = col;
        b.textContent = L.kind === 'measure' ? L.name : String(i + 1); b.title = L.name;
        ov.append(b);
        [g, b].forEach(x => { x.onclick = e => { e.stopPropagation(); onPick(i); }; x.ondblclick = e => e.stopPropagation();
          x.onmouseenter = () => { hover = i; paint(); if (onHover) onHover(i); }; x.onmouseleave = () => { hover = null; paint(); if (onHover) onHover(null); }; });
        els.push({g, b}); });
      paint(); place(); }
    function paint() { const cur = hover != null ? hover : labSel;
      els.forEach((x, j) => { const dim = cur >= 0 && j !== cur; x.g.style.opacity = dim ? .3 : 1; x.b.style.opacity = dim ? .45 : 1;
        x.g.querySelectorAll('.k').forEach(e => e.setAttribute('stroke-width', j === cur ? 5 : 2.5));
        x.g.querySelectorAll('.h').forEach(e => e.setAttribute('stroke-width', j === cur ? 8 : 5)); }); }
    function place() { Object.assign(ov.style, {left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px'}); }
    new ResizeObserver(place).observe(img);
    if (img.complete && img.naturalWidth) build(); else img.addEventListener('load', build, {once: true});
    return {paint, hl: i => { hover = i; paint(); }};
  }
  // one label as a list row (side panel / full window)
  function labelRow(L, i, sel, onPick, onHover) {
    const r = document.createElement('div'); r.className = 'pth-li' + (sel ? ' on' : '');
    const n = L.kind === 'measure' ? (L.box ? '▭' : '↔') : String(i + 1);
    r.innerHTML = `<span class="pth-bdg s" style="background:${LCOL[L.kind] || '#fff'}">${esc(n)}</span><div><b>${esc(L.name)}</b>${L.sure === 'maybe' ? ' <span class="sub">(a guess)</span>' : ''}` +
      `<div class="tx">${esc(L.text)}</div></div>`;
    r.onclick = () => onPick(i); r.onmouseenter = () => onHover(i); r.onmouseleave = () => onHover(null); return r; }
  /* Learn: a written lesson per slide. c.lessons = {about, start: L, slides: {'<stain>_<slide>': L}}, L = {title, lead, look: [..], blocks: [..]}.
     Blocks: {h} heading · {p} paragraph · {ul: [..]} / {ol: [..]} · {table: {head: [..], rows: [[..]]}} · {note} · {q: [..]} questions for
     the care team · {see: [[file, caption, layer?]]} the case's own photos (layer 'map' | 'spots' | 'labels' opens the Viewer with it on) ·
     {ex: [{t, d, u, by, img?, imgs?, see?}]} textbook examples: u = the source page; img = a saved picture under /pathology/ (imgs =
     several small ones, [[path, caption]]); see = the case's matching photo. With a saved picture the card shows both, and a click
     opens them side by side, large ·
     {terms: [[word, meaning]]} · {nums: true} the slide's own numbers · {src: [..]} sources. Text may use **bold** and [label](https://…). */
  const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>');
  const byFile = (c, f) => { for (const s of c.slides) { const i = s.photos.indexOf(f); if (i >= 0) return {c, s, f, i}; } return null; };
  const lessonKey = s => s.stain + '_' + s.slide;
  const lessonOf = (c, s) => (c.lessons && c.lessons.slides && c.lessons.slides[lessonKey(s)]) || null;
  const openWith = (it, layer) => { if (layer === 'map') V.tmap = true; if (layer === 'spots') V.spots = true; if (layer === 'labels') V.labels = true;
    focusImg = true; go('viewer', {filter: slideKey(it.c, it.s), cur: pkey(it)}); };
  const aggSpots = (s, clean) => { const t = {}; let n = 0; const pcts = [];   // automatic spot counts over a slide's photos
    Object.entries(s.auto.photos).forEach(([f, a]) => { if (clean && !isClean(s, f)) return; n++; for (const k in a.c) t[k] = (t[k] || 0) + a.c[k];
      const p = posPct(s.auto.mode, a.c), m = posN(s.auto.mode, a.c) + (a.c.n || 0); if (p != null && m >= 20) pcts.push(p); });
    pcts.sort((x, y) => x - y); return {t, n, pcts}; };
  function slideNums(c, s) {   // the slide's own numbers: photos, automatic spots, tissue map, and its clearest photos
    const d = document.createElement('div'), clean = s.photos.filter(f => isClean(s, f)).length;
    let h = `<ul><li><b>${s.photos.length} photos</b> of this slide; ${clean} are clean (not marked artifact, fat only or a near-copy).</li>`;
    if (s.auto) { const mode = s.auto.mode, b = aggSpots(s, true), p = posPct(mode, b.t), q = b.pcts;
      h += '<li>' + (POS[mode] && p != null ? `Spot program, clean photos: <b>${nucOf(b.t).toLocaleString()}</b> nuclei found; <b>${p}%</b> of the round ones ` +
          (mode === 'ring' ? 'have brown membrane around them' : mode === 'mem' ? 'sit in brown-stained areas' : 'are brown') +
          (q.length > 2 ? (q[Math.floor(q.length * .1)] === q[Math.ceil(q.length * .9) - 1] ? ` (about the same on nearly every photo)`
            : ` (most photos fall between ${q[Math.floor(q.length * .1)]}% and ${q[Math.ceil(q.length * .9) - 1]}%)`) : '') + '.'
        : `Spot program, clean photos: <b>${nucOf(b.t).toLocaleString()}</b> nuclei found, sorted by size only (there is no brown to count on this slide).`) + '</li>'; }
    if (s.tmap) { const g = tmGroups(tmAgg(s, true).a);
      h += `<li>Tissue map, clean photos: <b>${pc(g.t)}</b> of the tissue is likely tumor, <b>${pc(g.h)}</b> healthy tissue, <b>${pc(g.u)}</b> can't be told. <span class="sub">${esc(TSURE(tRule(s)))}</span></li>`; }
    d.innerHTML = h + '<li class="sub">These numbers come from color programs run on photos that were aimed at interesting spots. They are a guide for the eye, not the lab\'s result.</li></ul>';
    const best = s.photos.filter(f => ((s.marks && s.marks[f]) || []).some(m => m[0] === 'best')).slice(0, 5);
    if (best.length) { const r = document.createElement('div'); r.className = 'pth-see';
      best.forEach(f => { const it = byFile(c, f), a = tmOf(it), t = document.createElement('figure');
        t.innerHTML = `<img loading="lazy" alt="" src="${url(c, 'thumb', f)}"><figcaption><b>#${it.i + 1}</b> ★ clear example${a ? ' · ' + pc(a[1]) + ' likely tumor' : ''}</figcaption>`;
        t.title = 'Open this photo in the Viewer with the tissue map on'; t.onclick = () => openWith(it, 'map'); r.append(t); });
      d.append(r); }
    return d; }
  function refBox(c, x, it, src) {   // a saved textbook picture, large; with the case's matching photo beside it when the card names one
    const ov = document.createElement('div'); ov.className = 'pth-lb'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Textbook example');
    const key = e => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); close(); };
    function close() { document.removeEventListener('keydown', key, true); ov.remove(); }
    const top = document.createElement('div'); top.className = 'top';
    const t = document.createElement('span'); t.className = 't';
    t.innerHTML = `<b>${fmt(x.t)}</b> <span style="opacity:.7">· textbook example${it ? ' next to the matching photo from this case' : ''} · Esc closes</span>`;
    top.append(t);
    if (it) top.append(mkBtn('Open this case\'s photo in the Viewer', false, 'Open the matching photo in the Viewer, where the layers can be switched on', () => { close(); openWith(it); }));
    if (x.u) { const a = document.createElement('a'); a.href = x.u; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'pth-b'; a.textContent = 'Source page ↗'; top.append(a); }
    top.append(mkBtn('✕ Close', false, 'Close (Esc)', close));
    const stage = document.createElement('div'); stage.className = 'pth-ref';
    const fig = (u, cap) => { const f = document.createElement('figure'); f.innerHTML = `<img alt="" src="${u}"><figcaption>${cap}</figcaption>`; return f; };
    stage.append(fig('/pathology/' + encodeURI(src), '<b>Textbook</b> · ' + fmt(x.by || '')));
    if (it) stage.append(fig(url(c, 'full', it.f), '<b>This case</b> · ' + esc(slideName(c, it.s) + ' · photo ' + (it.i + 1) + (result(it) ? ' · report: ' + result(it) : ''))));
    stage.onclick = e => { if (e.target === stage) close(); };
    const cap = document.createElement('div'); cap.className = 'lcap'; cap.innerHTML = fmt(x.d || '');
    ov.append(top, stage, cap);
    document.addEventListener('keydown', key, true); document.body.append(ov);
  }
  function lessonBlocks(el, c, s, blocks) {
    const add = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; el.append(e); return e; };
    const li = a => a.map(x => '<li>' + fmt(x) + '</li>').join('');
    (blocks || []).forEach(b => {
      if (b.h) add('h4', '', fmt(b.h));
      else if (b.p) add('p', '', fmt(b.p));
      else if (b.ul || b.ol) add(b.ul ? 'ul' : 'ol', '', li(b.ul || b.ol));
      else if (b.table) add('table', 'pth-tb', '<tr>' + b.table.head.map(x => '<th>' + fmt(x) + '</th>').join('') + '</tr>' +
        b.table.rows.map(r => '<tr>' + r.map(x => '<td>' + fmt(x) + '</td>').join('') + '</tr>').join(''));
      else if (b.note) add('div', 'pth-note', fmt(b.note));
      else if (b.q) add('div', 'pth-q', '<b>Questions to bring to the care team</b><ul>' + li(b.q) + '</ul>');
      else if (b.terms) add('dl', 'pth-terms', b.terms.map(t => '<dt>' + fmt(t[0]) + '</dt><dd>' + fmt(t[1]) + '</dd>').join(''));
      else if (b.src) add('div', 'pth-src', '<b>Sources</b><ul>' + li(b.src) + '</ul>');
      else if (b.see) { const d = add('div', 'pth-see', '');
        b.see.forEach(([f, cap, layer]) => { const it = byFile(c, f); if (!it) return; const t = document.createElement('figure');
          t.innerHTML = `<img loading="lazy" alt="" src="${url(c, 'thumb', f)}"><figcaption><b>${esc(slideName(c, it.s))} #${it.i + 1}</b> ${fmt(cap || '')}</figcaption>`;
          t.title = 'Open this photo in the Viewer' + (layer ? ' with ' + ({map: 'the tissue map', spots: 'the spots', labels: 'the labels'})[layer] + ' on' : '');
          t.onclick = () => openWith(it, layer); d.append(t); }); }
      else if (b.ex) { const d = add('div', 'pth-exs', '');
        b.ex.forEach(x => { const e = document.createElement('div'); e.className = 'pth-ex';
          const it = x.see && byFile(c, x.see), pics = x.img ? [[x.img, 'Textbook']] : (x.imgs || []);
          const fig = (src, cap, tip, fn) => { const f = document.createElement('figure'); f.innerHTML = `<img loading="lazy" alt="" src="${src}"><figcaption>${esc(cap)}</figcaption>`; f.title = tip; f.onclick = fn; return f; };
          if (pics.length) { const pr = document.createElement('div'); pr.className = 'pth-pair' + (x.imgs ? ' sm' : '');   // saved pictures: the textbook one(s), then this case's matching photo
            pics.forEach(([src, cap]) => pr.append(fig('/pathology/' + encodeURI(src), cap, 'Click: see it large' + (it ? ', next to the matching photo from this case' : ''), () => refBox(c, x, it, src))));
            if (it && x.img) pr.append(fig(url(c, 'thumb', it.f), 'This case · ' + slideName(c, it.s) + ' #' + (it.i + 1), 'Click: see the two side by side, large', () => refBox(c, x, it, x.img)));
            e.append(pr); }
          const tx = document.createElement('div');
          tx.innerHTML = `<b>${fmt(x.t)}</b><div class="tx">${fmt(x.d || '')}</div>` +
            `<div class="sub">${x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${pics.length ? 'Source page' : 'Open the example'} ↗</a>` : ''}${x.u && x.by ? ' · ' : ''}${fmt(x.by || '')}</div>`;
          e.append(tx);
          if (it) { const bt = mkBtn((pics.length ? 'Open in the Viewer: ' : 'Compare: ') + slideName(c, it.s) + ' #' + (it.i + 1), false, 'Open the matching photo from this case in the Viewer', () => openWith(it)); bt.style.marginTop = '5px'; e.append(bt); }
          d.append(e); }); }
      else if (b.nums && s) el.append(slideNums(c, s));
    });
  }
  function drawLearn(body, c) {
    const LS = c.lessons;
    if (!LS) { const e = document.createElement('div'); e.className = 'sub'; e.style.cssText = 'padding:24px;text-align:center;font-size:13px'; e.textContent = 'No lessons have been written for this case yet.'; body.append(e); return; }
    const SL = c.slides.filter(s => lessonOf(c, s)), keys = ['start'].concat(SL.map(lessonKey));
    if (!keys.includes(V.learn)) V.learn = 'start';
    const bar = document.createElement('div'); bar.className = 'pth-bar';
    bar.append(mkBtn('Start here', V.learn === 'start', 'How to look at any slide photo: the colors, the sizes, and what the layers do', () => go('learn', {learn: 'start'})));
    SL.forEach(s => bar.append(mkBtn(slideName(c, s), V.learn === lessonKey(s), (c.results[s.stain] || '') + ' · the lesson for this slide', () => go('learn', {learn: lessonKey(s)}))));
    body.append(bar);
    const s = SL.find(x => lessonKey(x) === V.learn) || null, L = s ? lessonOf(c, s) : LS.start;
    const wrap = document.createElement('div'); wrap.style.cssText = 'overflow:auto;max-height:' + Math.max(hOf(ID, PANEL.h0), 560) + 'px;padding-right:6px'; body.append(wrap);
    const el = document.createElement('div'); el.className = 'pth-ln'; wrap.append(el);
    const hd = document.createElement('div');
    hd.innerHTML = `<h3>${fmt(L.title)}</h3>` + (s ? `<div class="sub" style="margin-bottom:6px">${esc(slideName(c, s))} ${kindTag(ST[s.stain] || {kind: ''})} · Report: <b style="color:var(--ink)">${esc(c.results[s.stain] || '—')}</b> · ${s.photos.length} photos</div>` : '') +
      (L.lead ? `<p class="lead">${fmt(L.lead)}</p>` : '');
    el.append(hd);
    if (s) { const cover = {c, s, f: coverOf(c, s), i: s.photos.indexOf(coverOf(c, s))}, acts = document.createElement('div'); acts.className = 'pth-bar';
      acts.append(mkBtn('Open this slide in the Viewer', false, 'The cover photo of this slide, large', () => openWith(cover)));
      if (s.tmap) acts.append(mkBtn('◧ with the tissue map', false, 'Open it with the tumor / healthy map on', () => openWith(cover, 'map')));
      if (s.auto) acts.append(mkBtn('• with the spots', false, 'Open it with a ring on every nucleus the program found', () => openWith(cover, 'spots')));
      el.append(acts);
      if (L.look && L.look.length) { const lk = document.createElement('div'); lk.innerHTML = '<h4>What to look for</h4><ul>' + L.look.map(x => '<li>' + fmt(x) + '</li>').join('') + '</ul>'; el.append(lk); } }
    lessonBlocks(el, c, s, L.blocks);
    const nav = document.createElement('div'); nav.className = 'pth-bar'; nav.style.marginTop = '14px'; const j = keys.indexOf(V.learn);
    const nm = k => k === 'start' ? 'Start here' : slideName(c, SL.find(x => lessonKey(x) === k));
    if (j > 0) nav.append(mkBtn('◀ ' + nm(keys[j - 1]), false, 'Previous lesson', () => go('learn', {learn: keys[j - 1]}), 'big'));
    if (j < keys.length - 1) nav.append(mkBtn('Next: ' + nm(keys[j + 1]) + ' ▶', false, 'Next lesson', () => go('learn', {learn: keys[j + 1]}), 'big'));
    el.append(nav);
    if (LS.about) { const fine = document.createElement('div'); fine.className = 'pth-src'; fine.style.marginTop = '10px'; fine.innerHTML = fmt(LS.about); el.append(fine); }
  }
  // guided tour: the labeled photos in labels.json order
  const tourGo = (c, d, start) => { const T = c.tour || []; if (!T.length) return; const j = start ? -1 : T.indexOf(V.cur);
    const n = j < 0 ? 0 : Math.max(0, Math.min(T.length - 1, j + d)); V.labels = true; focusImg = true; go('viewer', {filter: 'all', cur: T[n]}); };
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
      '.pth-lb .pth-nav{position:fixed}' +
      '.pth-ov{position:absolute;pointer-events:none}.pth-ov svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.pth-ov svg g{pointer-events:visiblePainted;cursor:pointer}' +
      '.pth-bdg{position:absolute;transform:translate(-50%,-50%);min-width:20px;height:20px;border-radius:10px;color:#000;font:700 12px/20px system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box;pointer-events:auto;cursor:pointer;box-shadow:0 0 0 2px rgba(0,0,0,.55)}' +
      '.pth-bdg.m{background:rgba(0,0,0,.72);color:#fff;font-weight:600;font-size:11px;white-space:nowrap}.pth-bdg.s{position:static;transform:none;display:inline-block;flex:none;box-shadow:none;cursor:inherit}' +
      '.pth-li{display:flex;gap:6px;align-items:flex-start;padding:4px 5px;border-radius:5px;cursor:pointer;margin:1px 0}.pth-li:hover{background:rgba(127,127,127,.15)}.pth-li.on{background:rgba(127,127,127,.25)}' +
      '.pth-li .tx{font-size:11.5px;opacity:.85}.pth-lesson{margin:8px 0;padding:6px 8px;border-left:3px solid #38bdf8;background:rgba(56,189,248,.08);font-size:12px}' +
      '.pth-lb .stage{position:relative}.pth-lb .lcap{padding:6px 14px 10px;font-size:13px;min-height:38px;max-width:1100px}' +
      '.pth-sp svg g{pointer-events:none!important}.pth-sp circle{stroke-width:1.8px;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 1px rgba(0,0,0,.9))}' +
      '.pth-tb{border-collapse:collapse;font-size:12px;width:100%}.pth-tb th,.pth-tb td{padding:3px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}' +
      '.pth-tb th{font-weight:600;font-size:11px;color:var(--muted)}.pth-tb tr.k{cursor:pointer}.pth-tb tr.k:hover{background:rgba(127,127,127,.15)}.pth-tb td.r{text-align:right;white-space:nowrap}' +
      '.pth-h3{font-size:14px;margin:12px 0 4px}.pth-dt summary{cursor:pointer;padding:3px 0;font-size:12px}' +
      '.pth-tm{image-rendering:auto}.pth-tg .pth-bdg{pointer-events:none;cursor:default;font-size:11px;padding:0 7px}' +
      '.pth-here{position:absolute;left:8px;bottom:8px;max-width:80%;padding:3px 9px;border-radius:11px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;line-height:1.35;pointer-events:none;z-index:3;display:none}' +
      '.pth-stk{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:5px 0;background:rgba(127,127,127,.2)}.pth-stk span{display:block;height:100%}' +
      '.pth-chip{display:inline-block;width:11px;height:11px;border-radius:3px;flex:none;margin-top:3px;vertical-align:-1px}' +
      '.pth-ln{max-width:900px;font-size:13.5px;line-height:1.55}.pth-ln h3{font-size:20px;margin:4px 0 6px}.pth-ln h4{font-size:15px;margin:18px 0 4px}' +
      '.pth-ln p{margin:6px 0}.pth-ln .lead{font-size:15px}.pth-ln ul,.pth-ln ol{margin:6px 0;padding-left:22px}.pth-ln li{margin:3px 0}.pth-ln a{color:inherit}' +
      '.pth-ln .pth-tb{margin:8px 0;font-size:12.5px}.pth-note{margin:10px 0;padding:6px 10px;border-left:3px solid #f59e0b;background:rgba(245,158,11,.1)}' +
      '.pth-q{margin:10px 0;padding:6px 10px;border-left:3px solid #38bdf8;background:rgba(56,189,248,.08)}.pth-src{font-size:11.5px;color:var(--muted);margin-top:10px}' +
      '.pth-terms{margin:8px 0;display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:3px 12px}.pth-terms dt{font-weight:600}.pth-terms dd{margin:0}' +
      '.pth-see{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.pth-see figure{margin:0;width:186px;cursor:pointer;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--card)}' +
      '.pth-see figure:hover{outline:2px solid var(--ink)}.pth-see img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#ddd}.pth-see figcaption{font-size:11.5px;line-height:1.35;padding:4px 6px}' +
      '.pth-exs{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));margin:8px 0}.pth-ex{border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--card);font-size:12.5px;line-height:1.45}' +
      '.pth-ex .tx{margin:3px 0 5px}.pth-look{margin:6px 0;padding-left:18px}.pth-look li{margin:2px 0}' +
      '.pth-pair{display:flex;gap:6px;margin-bottom:7px}.pth-pair figure{margin:0;flex:1 1 0;min-width:0;cursor:zoom-in;border-radius:4px;overflow:hidden;border:1px solid var(--line);background:#111}' +
      '.pth-pair figure:hover{outline:2px solid var(--ink)}.pth-pair img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}' +
      '.pth-pair figcaption{font-size:10.5px;padding:2px 5px;background:var(--card);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pth-pair.sm img{aspect-ratio:auto}' +
      '.pth-ref{flex:1;min-height:0;display:flex;gap:12px;align-items:stretch;justify-content:center;padding:0 14px}' +
      '.pth-ref figure{margin:0;flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column}' +
      '.pth-ref img{flex:1 1 auto;min-height:0;width:100%;object-fit:contain;object-position:center top}' +
      '.pth-ref figcaption{order:-1;font-size:12.5px;padding:0 0 6px;opacity:.92;text-align:center}.pth-ref figcaption a{color:inherit}';
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
     ['learn', '📖 Learn', 'A written lesson for every slide: what the stain is, how to read it, how it is scored, textbook examples, pitfalls'],
     ['gallery', 'Gallery · ' + c.slides.reduce((a, s) => a + s.photos.length, 0), 'Every photo as thumbnails'],
     ['viewer', 'Viewer', 'One photo large, with a size slider'],
     ['spots', 'Spots list', 'Every labeled spot and the automatic nucleus counts: across all photos and per stain'],
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
    ({overview: drawOverview, learn: drawLearn, gallery: drawGallery, viewer: drawViewer, spots: drawSpots, compare: drawCompare})[V.mode](body, c, id);
  }

  function drawOverview(body, c) {
    const info = document.createElement('div'); info.className = 'sub'; info.style.cssText = 'font-size:12px;margin-bottom:6px';
    info.innerHTML = `<b style="color:var(--ink)">${esc(c.title)}</b> · ${esc(fd(c.date))} · ${esc(c.site)} — ${esc(c.diagnosis)}<br>${esc(c.review)}${c.reviewNote ? '<br><span style="font-size:11px">' + esc(c.reviewNote) + '</span>' : ''}`;
    info.title = 'Source: ' + c.source; body.append(info);
    const tl = document.createElement('div'); tl.className = 'pth-bar';
    tl.append(mkBtn(onLine.has(c.key) ? '✓ Line on the timeline' : '＋ Line on the timeline', onLine.has(c.key),
      'A line on every chart on ' + fd(c.date) + ' (click it to come back here)', () => setOnLine([c.key], !onLine.has(c.key))));
    if (c.procedure && window.PROC_SHOW) tl.append(mkBtn('Show in Procedures', false, 'Select this biopsy on the Procedures timeline', () => window.PROC_SHOW(c.procedure)));
    const nk = keyframes.filter(k => k.startsWith(c.key + '/')).length;
    if (nk) { const n = document.createElement('span'); n.className = 'sub'; n.style.fontSize = '11px'; n.textContent = '🔖 ' + nk + ' photo' + (nk > 1 ? 's' : '') + ' saved as keyframes'; tl.append(n); }
    if ((c.tour || []).length) tl.append(mkBtn('🏷 Guided tour: ' + c.tour.length + ' labeled photos', false,
      'Step through photos with labels on them (what each cell and structure is), from normal skin to tumor to each stain', () => tourGo(c, 0, true), 'big'));
    if (c.lessons) tl.append(mkBtn('📖 Learn: what each slide shows', false, 'A written lesson for every slide, starting with how to look at any slide photo', () => go('learn', {learn: 'start'}), 'big'));
    body.append(tl);
    const g = document.createElement('div'); g.className = 'pth-grid'; g.style.gridTemplateColumns = 'repeat(auto-fill,minmax(190px,1fr))';
    c.slides.forEach(s => { const st = ST[s.stain] || {label: s.stain, kind: ''}, it = {c, s, f: coverOf(c, s), i: s.photos.indexOf(coverOf(c, s))};
      const t = document.createElement('div'); t.className = 'pth-tile'; t.title = (s.note ? s.note + '\n\n' : '') + (st.what || '') + '\nClick: open this slide in the Viewer';
      t.innerHTML = `<img loading="lazy" alt="${esc(slideName(c, s))}" src="${url(c, 'thumb', it.f)}">
        <div class="cap" style="font-size:12px"><b>${esc(slideName(c, s))}</b> ${kindTag(st)}<br><span class="pth-res">${esc(c.results[s.stain] || '—')}</span>
        <span class="sub"> · ${s.photos.length} photos</span></div>`;
      t.append(pinBtn(it));
      if (lessonOf(c, s)) { const lb = document.createElement('button'); lb.className = 'pth-pin'; lb.style.cssText = 'left:4px;right:auto'; lb.textContent = '📖';
        lb.title = 'Learn: the lesson for this slide'; lb.onclick = e => { e.stopPropagation(); go('learn', {learn: lessonKey(s)}); }; t.append(lb); }
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
    L.forEach(it => { const t = document.createElement('div'); t.className = 'pth-tile'; t.title = caption(it) + '\n' + result(it) + (marksOf(it).length ? '\n' + markText(it) : '');
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = caption(it); im.dataset.f = it.f; im.dataset.k = kind; im.src = url(c, kind, it.f);
      const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = (V.filter === 'all' ? slideName(c, it.s) + ' · ' : '') + '#' + (it.i + 1) + (markSym(it) ? ' ' + markSym(it) : '');
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
    ctl.append(sep());
    const ann = annOf(it), lab = V.labels && ann;
    if (labFor !== pkey(it)) { labSel = -1; labFor = pkey(it); }
    ctl.append(mkBtn('🏷 Labels' + (V.labels ? ': on' : ''), !!V.labels, ann ? 'Show or hide the teaching labels on this photo: what each structure is (like a pathologist pointing things out)'
      : 'Show or hide teaching labels (this photo has none: use Tour to go to the labeled ones)', () => { V.labels = !V.labels; save(); redraw(); }));
    ctl.append(spotBtn(it, redraw));
    ctl.append(tmapBtn(it, redraw));
    const T = c.tour || [];
    if (T.length) { const j = T.indexOf(pkey(it));
      ctl.append(mkBtn('◀', false, 'Previous photo in the guided tour', () => tourGo(c, -1)));
      ctl.append(mkBtn(j >= 0 ? 'Tour ' + (j + 1) + ' / ' + T.length : 'Guided tour (' + T.length + ')', j >= 0, 'A guided tour of ' + T.length + ' labeled photos: normal skin first, then tumor, then each stain', () => tourGo(c, j < 0 ? 0 : 0)));
      ctl.lastChild.onclick = () => { if (j < 0) tourGo(c, 0); else { V.labels = !V.labels; save(); redraw(); } };
      if (j >= 0) ctl.lastChild.title = 'Stop ' + (j + 1) + ' of the guided tour (click to switch labels on or off)';
      ctl.append(mkBtn('▶', false, 'Next photo in the guided tour', () => tourGo(c, j < 0 ? 0 : 1))); }
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
    let ovl = null, rows = [];
    const pick = i => { labSel = labSel === i ? -1 : i; if (ovl) ovl.paint(); rows.forEach((r, j) => r.classList.toggle('on', j === labSel));
      if (labSel >= 0 && rows[labSel]) rows[labSel].scrollIntoView({block: 'nearest'}); };
    const hov = i => { rows.forEach((r, j) => r.style.outline = j === i ? '1px solid var(--line)' : ''); };
    if (V.tmap && tmOf(it)) { tmapLayer(box, img, it); side.style.flexBasis = '300px'; }
    if (V.spots && autoOf(it)) spotLayer(box, img, it);
    if (lab) {
      ovl = overlay(box, img, ann, pick, hov);
      side.style.flexBasis = '320px';
      const hd = document.createElement('div');
      hd.innerHTML = `<h4>${esc(ann.title)}</h4><p style="margin:4px 0 6px">${esc(ann.intro || '')}</p>`;
      side.append(hd);
      ann.labels.forEach((L, i) => { const r = labelRow(L, i, i === labSel, pick, h => { if (ovl) ovl.hl(h); }); rows.push(r); side.append(r); });
      if (ann.lesson) { const ls = document.createElement('div'); ls.className = 'pth-lesson'; ls.innerHTML = '<b>Going deeper</b><br>' + esc(ann.lesson); side.append(ls); }
      const kinds = [...new Set(ann.labels.map(L => L.kind))], lg = document.createElement('div'); lg.className = 'sub'; lg.style.cssText = 'font-size:11px;margin:6px 0';
      lg.innerHTML = kinds.map(k => `<span style="color:${LCOL[k]};font-size:14px">●</span> ${esc(LNAME[k] || k)}`).join(' &nbsp;') +
        '<br>Dashed outline = an educated guess. Labels are a layperson\'s reading of the photo, not a pathologist\'s.';
      side.append(lg, document.createElement('hr'));
    } else if (V.labels && T.length) {
      const n = document.createElement('div'); n.className = 'sub'; n.style.cssText = 'font-size:11px;margin-bottom:6px';
      n.textContent = 'No labels on this photo. The Tour buttons go to the ' + T.length + ' labeled photos.'; side.append(n);
    }
    const tb = V.tmap ? tmapBox(it, redraw) : null; if (tb) side.append(tb, document.createElement('hr'));
    const ab = autoBox(it, redraw); if (ab) side.append(ab, document.createElement('hr'));
    const sideInfo = document.createElement('div'); side.append(sideInfo);
    const isCover = coverOf(c, it.s) === it.f, LS = lessonOf(c, it.s), say = photoSay(it);
    sideInfo.innerHTML = `<h4>${esc(slideName(c, it.s))} ${kindTag(st)}</h4>
      <div>Report: <span class="pth-res">${esc(result(it) || '—')}</span></div>
      ${marksOf(it).length ? '<div style="margin:6px 0;font-weight:600">' + esc(markText(it)).replace(/\n/g, '<br>') + '</div>' : ''}
      ${say ? '<p style="margin:6px 0"><b>In this photo:</b> ' + esc(say) + '</p>' : ''}
      ${it.s.note ? '<p style="margin:6px 0"><b>What you can see:</b> ' + esc(it.s.note) + '</p>' : ''}
      ${LS && LS.look && LS.look.length ? '<div style="margin:6px 0"><b>What to look for on this slide</b><ul class="pth-look">' + LS.look.map(x => '<li>' + fmt(x) + '</li>').join('') + '</ul></div>' : ''}
      <p style="margin:6px 0" class="sub">${esc(st.what)}</p>
      <div class="sub">Photo ${it.i + 1} of ${it.s.photos.length} on this slide${V.filter === 'all' ? ' · ' + (k + 1) + ' of ' + L.length + ' in all' : ''}<br>${esc(it.f)}</div>`;
    const acts = document.createElement('div'); acts.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-top:6px';
    if (LS) acts.append(mkBtn('📖 Full lesson', false, 'The written lesson for this slide: how the stain works, how it is scored, textbook examples, pitfalls', () => go('learn', {learn: lessonKey(it.s)})));
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

  /* Spots list: named spots (teaching labels) and automatic counts, across all photos and per stain */
  const openAt = (key, lab) => { const it = findKey(key); if (!it) return;
    if (lab != null) { V.labels = true; labFor = key; labSel = lab; } else V.spots = true;
    focusImg = true; go('viewer', {filter: slideKey(it.c, it.s), cur: key}); };
  function drawSpots(body, c) {
    const intro = document.createElement('div'); intro.className = 'sub'; intro.style.cssText = 'font-size:12px;margin-bottom:6px';
    intro.innerHTML = 'Two kinds of spots. <b>Named spots</b> are the hand-placed teaching labels (what a structure is). <b>Automatic spots</b> are every nucleus a color program found, ' +
      'sorted by color into stained / not stained / thin stromal (IHC) or by size (H&amp;E). Click any row to open that photo with its spots showing.';
    body.append(intro);
    const wrap = document.createElement('div'); wrap.style.cssText = 'overflow:auto;max-height:' + Math.max(hOf(ID, PANEL.h0), 420) + 'px;padding-right:4px'; body.append(wrap);
    const h3 = t => { const h = document.createElement('div'); h.className = 'pth-h3'; h.innerHTML = t; wrap.append(h); return h; };
    const SL = c.slides.filter(s => s.auto);

    // ---- automatic counts: every photo, then per stain ----
    const all = SL.map(s => [s, aggSpots(s, false), aggSpots(s, true)]);
    const gN = all.reduce((x, [, a]) => x + nucOf(a.t), 0), gP = all.reduce((x, [, a]) => x + a.n, 0), gC = all.reduce((x, [, , b]) => x + b.n, 0);
    const sumK = (keys, which) => all.reduce((x, r) => x + keys.reduce((y, k) => y + (r[which].t[k] || 0), 0), 0);
    h3('Automatic spots: all photos');
    const g = document.createElement('div'); g.style.cssText = 'font-size:12.5px;margin-bottom:4px';
    g.innerHTML = `<b>${gN.toLocaleString()}</b> nuclei (and estimated stained cells) found in <b>${gP}</b> photos (${gC} clean: not marked artifact, fat or near-copy). ` +
      `Across all stains: <span style="color:#ff2d95">○</span> stained ${sumK(['p', 'b', 'r', 'i'], 1).toLocaleString()} · <span style="color:#00e5ff">○</span> round, not stained ${all.filter(r => r[0].auto.mode !== 'he').reduce((x, r) => x + (r[1].t.n || 0), 0).toLocaleString()} · ` +
      `<span style="color:#22c55e">○</span> thin stromal ${sumK(['t'], 1).toLocaleString()} · H&amp;E nuclei by size ${sumK(['l', 'm', 's'], 1).toLocaleString()}. ` +
      '<span class="sub">"Stained" means different things per stain (see below), so the stain-by-stain rows are the ones to read.</span>';
    wrap.append(g);
    h3('Automatic spots: per stain');
    const tb = document.createElement('table'); tb.className = 'pth-tb';
    tb.innerHTML = '<tr><th>Slide</th><th>Report</th><th>Photos (clean)</th><th>Nuclei found</th><th>By class (all photos)</th><th>Program\'s share (clean photos)</th><th>Range per photo</th></tr>';
    all.forEach(([s, a, b]) => { const mode = s.auto.mode, cols = SCLS[mode] || {}, bp = posPct(mode, b.t);
      const share = POS[mode] ? (bp != null ? bp + '% ' + (mode === 'ring' ? 'with brown membrane' + (posN(mode, b.t) ? ' (' + Math.round(100 * (b.t.r || 0) / posN(mode, b.t)) + '% complete)' : '') : 'brown') : '—') : '— (no stain to count)';
      const rg = b.pcts.length ? (b.pcts.length > 2 ? b.pcts[Math.floor(b.pcts.length * .1)] + '–' + b.pcts[Math.ceil(b.pcts.length * .9) - 1] + '%' : b.pcts[0] + '–' + b.pcts[b.pcts.length - 1] + '%') : '—';
      const tr = document.createElement('tr'); tr.className = 'k'; tr.title = 'Click: open this slide in the Viewer with Spots on';
      tr.innerHTML = `<td><b>${esc(slideName(c, s))}</b></td><td>${esc(c.results[s.stain] || '—')}</td><td class="r">${a.n} (${b.n})</td><td class="r">${nucOf(a.t).toLocaleString()}</td>` +
        `<td>${Object.keys(cols).map(x => `<span style="color:${cols[x][0]}" title="${esc(sName(s.stain, mode, x))}">○</span>${(a.t[x] || 0).toLocaleString()}`).join(' ')}</td>` +
        `<td><b>${share}</b></td><td class="r">${rg}</td>`;
      tr.onclick = () => openAt(slideKey(c, s) + '|' + coverOf(c, s)); tb.append(tr); });
    wrap.append(tb);
    const note = document.createElement('div'); note.className = 'sub'; note.style.cssText = 'font-size:11px;margin:4px 0';
    note.innerHTML = 'How to read it: for ER, PR, Ki-67 and GATA3 the share is brown round nuclei ÷ all round nuclei; for HER2 it walks out from each round nucleus in 24 directions and counts the cell as stained if most directions meet brown membrane (complete) or some do (partial), the same idea as the complete-membrane rule pathologists use; for E-cadherin the nuclei inside brown nests are too faint for the program, so stained cells are estimated from the brown area (one per ~2,000 pixels, a cell about 11 µm across) and compared with blue round nuclei. ' +
      'Thin stromal nuclei are left out, but the program cannot tell tumor from normal round cells, and the photos were aimed at interesting areas, so these are rough and not the lab\'s score. ' +
      '"Range per photo" = middle 80% of photos with at least 20 round nuclei. On the negative control any brown is background or artifact (folds, streaks). Rings on H&amp;E are only sorted by size.';
    wrap.append(note);

    // ---- tissue map: per stain ----
    const TM = c.slides.filter(s => s.tmap);
    if (TM.length) { h3('Tissue map: per stain');
      const t2 = document.createElement('table'); t2.className = 'pth-tb';
      t2.innerHTML = '<tr><th>Slide</th><th>Photos (clean)</th><th>Likely tumor</th><th>Healthy tissue</th><th>Can\'t tell</th><th>Split of the tissue (clean photos)</th><th>How sure</th></tr>';
      TM.forEach(s => { const a0 = tmAgg(s, false), b = tmAgg(s, true), g = tmGroups(b.a);
        const tr = document.createElement('tr'); tr.className = 'k'; tr.title = 'Click: open this slide in the Viewer with the tissue map on';
        tr.innerHTML = `<td><b>${esc(slideName(c, s))}</b></td><td class="r">${a0.n} (${b.n})</td><td class="r"><b>${pc(g.t)}</b></td><td class="r">${pc(g.h)}</td><td class="r">${pc(g.u)}</td>` +
          `<td style="min-width:130px"><div class="pth-stk">${['t', 'h', 'u'].map(k => `<span style="width:${g[k]}%;background:${rgb(GRGB[k])}" title="${esc(GNAME[k])}: ${pc(g[k])}"></span>`).join('')}</div></td>` +
          `<td class="sub">${esc(TSURE(tRule(s)).split(':')[0])}</td>`;
        tr.onclick = () => openWith({c, s, f: coverOf(c, s), i: s.photos.indexOf(coverOf(c, s))}, 'map'); t2.append(tr); });
      wrap.append(t2);
      const n2 = document.createElement('div'); n2.className = 'sub'; n2.style.cssText = 'font-size:11px;margin:4px 0';
      // which slides are which comes from the data (each slide's rule), so no result is written in this file
      const lab = f => [...new Set(TM.filter(s => f(tRule(s))).map(s => (ST[s.stain] || {label: s.stain}).label))].join(', '), mk = lab(tMarker), cr = lab(r => !tMarker(r));
      n2.innerHTML = 'How to read it: the tissue map ("◧ Tissue map" in the Viewer) tints every photo as likely tumor, healthy tissue or can\'t tell. Shares are of the tissue on the clean photos (glass, fat and gaps are left out). ' +
        (mk ? 'On slides where brown marks the tumor (' + esc(mk) + ') red means "has the stain", and crowded cells without it are "can\'t tell". ' : '') +
        (cr ? 'On slides with nothing brown to go by (' + esc(cr) + ') it can only go by how crowded the cells are. ' : '') +
        'The photos were aimed at interesting areas, so these are not shares of the whole slide, and the map is a color program\'s estimate with corrections by eye, not a pathologist\'s outline.';
      wrap.append(n2); }

    // ---- named spots (teaching labels) ----
    const named = []; c.slides.forEach(s => Object.entries(s.ann || {}).forEach(([f, an]) => an.labels.forEach((L, i) => named.push({s, f, an, L, i}))));
    const fS = V.nsStain || 'all', fK = V.nsKind || 'all';
    h3(`Named spots: ${named.length} on ${new Set(named.map(x => x.f)).size} photos`);
    const fb = document.createElement('div'); fb.className = 'pth-bar';
    fb.append(mkBtn('All stains · ' + named.length, fS === 'all', 'Named spots on every slide', () => { V.nsStain = 'all'; save(); redraw(); }));
    [...new Set(named.map(x => x.s.stain))].forEach(k => fb.append(mkBtn((ST[k] || {label: k}).label + ' · ' + named.filter(x => x.s.stain === k).length, fS === k, 'Only ' + (ST[k] || {label: k}).label, () => { V.nsStain = k; save(); redraw(); })));
    fb.append(sep());
    fb.append(mkBtn('All kinds', fK === 'all', 'Every kind', () => { V.nsKind = 'all'; save(); redraw(); }));
    [...new Set(named.map(x => x.L.kind))].forEach(k => { const b = mkBtn(LNAME[k] || k, fK === k, 'Only ' + (LNAME[k] || k), () => { V.nsKind = k; save(); redraw(); });
      b.style.borderColor = LCOL[k]; fb.append(b); });
    wrap.append(fb);
    const nt = document.createElement('table'); nt.className = 'pth-tb';
    nt.innerHTML = '<tr><th></th><th>Spot</th><th>Kind</th><th>Slide · photo</th><th>What it is</th></tr>';
    named.filter(x => (fS === 'all' || x.s.stain === fS) && (fK === 'all' || x.L.kind === fK)).forEach(x => {
      const tr = document.createElement('tr'); tr.className = 'k'; tr.title = 'Click: open this photo with this spot highlighted';
      tr.innerHTML = `<td><span class="pth-bdg s" style="background:${LCOL[x.L.kind] || '#fff'}">${x.L.kind === 'measure' ? (x.L.box ? '▭' : '↔') : x.i + 1}</span></td>` +
        `<td><b>${esc(x.L.name)}</b>${x.L.sure === 'maybe' ? ' <span class="sub">(a guess)</span>' : ''}${x.L.dots ? ' <span class="sub">· ' + x.L.dots.length + ' rings</span>' : ''}</td>` +
        `<td>${esc(LNAME[x.L.kind] || x.L.kind)}</td><td style="white-space:nowrap">${esc(slideName(c, x.s))} #${x.s.photos.indexOf(x.f) + 1}<br><span class="sub">${esc(x.an.title)}</span></td><td class="sub">${esc(x.L.text)}</td>`;
      tr.onclick = () => openAt(slideKey(c, x.s) + '|' + x.f, x.i); nt.append(tr); });
    wrap.append(nt);

    // ---- every photo, per slide ----
    h3('Automatic spots: every photo');
    SL.forEach(s => { const mode = s.auto.mode, cols = SCLS[mode] || {};
      const dt = document.createElement('details'); dt.className = 'pth-dt'; dt.open = V.spOpen === slideKey(c, s);
      dt.ontoggle = () => { if (dt.open) { V.spOpen = slideKey(c, s); save(); } };
      dt.innerHTML = `<summary><b>${esc(slideName(c, s))}</b> · ${s.photos.length} photos</summary>`;
      const t = document.createElement('table'); t.className = 'pth-tb';
      t.innerHTML = '<tr><th>Photo</th><th>Marks</th><th>Nuclei</th><th>By class</th><th>Share</th><th>Tissue map: likely tumor</th></tr>';
      s.photos.forEach((f, i) => { const a = s.auto.photos[f]; if (!a) return; const it = {c, s, f, i}, p = posPct(mode, a.c), tm = tmOf(it);
        const tr = document.createElement('tr'); tr.className = 'k'; if (!isClean(s, f)) tr.style.opacity = .55;
        tr.innerHTML = `<td>#${i + 1}</td><td>${esc(markSym(it))}</td><td class="r">${nucOf(a.c)}</td>` +
          `<td>${Object.keys(cols).map(x => `<span style="color:${cols[x][0]}">○</span>${a.c[x] || 0}`).join(' ')}</td><td class="r">${p != null ? p + '%' : '—'}</td>` +
          `<td class="r">${tm ? (tm[0] < 12 ? '<span class="sub">little tissue</span>' : pc(tm[1])) : '—'}</td>`;
        tr.title = (marksOf(it).length ? markText(it) + '\n' : '') + 'Click: open this photo with Spots on';
        tr.onclick = () => openAt(slideKey(c, s) + '|' + f); t.append(tr); });
      dt.append(t); wrap.append(dt); });
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
      const t = document.createElement('span'); t.className = 't'; t.innerHTML = `<b>${esc(slideName(it.c, it.s))}</b> · <span class="pth-res">${esc(result(it) || '—')}</span> <span class="sub">#${it.i + 1} ${markSym(it)}</span>`;
      t.title = caption(it) + '\n' + result(it) + (marksOf(it).length ? '\n' + markText(it) : '');
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
    const nav = (d, side, label) => { const b = document.createElement('button'); b.className = 'pth-nav'; b.style[side] = '10px'; b.textContent = label;
      b.disabled = k + d < 0 || k + d >= L.length; b.onclick = e => { e.stopPropagation(); stepLb(d); }; return b; };
    function show() {
      const it = L[k]; ov.innerHTML = '';
      const top = document.createElement('div'); top.className = 'top';
      const t = document.createElement('span'); t.className = 't';
      t.innerHTML = `<b>${esc(slideName(it.c, it.s))}</b> · ${esc(result(it) || '—')} · <span style="opacity:.7">photo ${it.i + 1} of ${it.s.photos.length}${L.length > 1 ? ' · ' + (k + 1) + '/' + L.length + ' here' : ''} · click the photo to see it at full resolution · ← → · Esc</span>`;
      top.append(t, mkBtn(pinned(it) ? '✓ In Compare' : '＋ Compare', pinned(it), 'Add this photo to Compare', () => { togglePin(it); show(); }), keyBtn(it, show));
      const a = document.createElement('a'); a.href = url(it.c, 'full', it.f); a.target = '_blank'; a.rel = 'noopener'; a.className = 'pth-b'; a.textContent = 'Full size ↗';
      const ann = annOf(it);
      if (ann) top.append(mkBtn('🏷 Labels' + (V.labels ? ': on' : ''), !!V.labels, 'Show or hide the teaching labels', () => { V.labels = !V.labels; save(); show(); }));
      if (autoOf(it)) top.append(spotBtn(it, show));
      if (tmOf(it)) top.append(tmapBtn(it, show));
      top.append(a, mkBtn('✕ Close', false, 'Close (Esc)', close));
      const stage = document.createElement('div'); stage.className = 'stage' + (zoom ? ' z' : '');
      const img = document.createElement('img'); img.src = url(it.c, 'full', it.f); img.alt = caption(it);
      img.onclick = e => { e.stopPropagation(); zoom = !zoom; stage.classList.toggle('z', zoom); };
      stage.onclick = e => { if (e.target === stage) close(); };
      stage.append(img);
      if (V.tmap && tmOf(it)) tmapLayer(stage, img, it);
      if (V.spots && autoOf(it)) spotLayer(stage, img, it);
      if (ann && V.labels) {
        const cap = document.createElement('div'); cap.className = 'lcap';
        const say = i => { const L = ann.labels[i]; cap.innerHTML = L ? `<span class="pth-bdg s" style="background:${LCOL[L.kind] || '#fff'};color:#000">${L.kind === 'measure' ? '↔' : i + 1}</span> <b>${esc(L.name)}</b> ${esc(L.text)}`
          : `<b>${esc(ann.title)}</b> · ${esc(ann.intro || '')} <span style="opacity:.6">(hover or click a number)</span>`; };
        let lbSel = -1; const o2 = overlay(stage, img, ann, i => { lbSel = lbSel === i ? -1 : i; labSel = lbSel; o2.paint(); say(lbSel); }, i => say(i == null ? lbSel : i));
        say(-1); ov.append(top, stage, cap);
        ov.append(nav(-1, 'left', '‹'), nav(1, 'right', '›')); return;
      }
      const lines = [];
      if (V.tmap && tmOf(it)) { const a = tmOf(it), g = tmGroups(a), two = V.tmapMode !== 'detail';
        lines.push('<b>Tissue map:</b> ' + (two ? ['t', 'h', 'u'].map(k => `<span class="pth-chip" style="background:${rgb(GRGB[k])}"></span> ${esc(GNAME[k])} <b>${pc(g[k])}</b>`)
          : [1, 2, 3, 4, 5, 6].filter(k => a[k] > 0).map(k => `<span class="pth-chip" style="background:${rgb(TRGB[k])}"></span> ${esc(TTAG[k])} <b>${pc(a[k])}</b>`)).join(' &nbsp; ') +
          ' <span style="opacity:.6">of the tissue in this photo · an estimate by a color program, not a diagnosis · move the pointer over the photo</span>'); }
      if (V.spots && autoOf(it)) { const a = autoOf(it), mode = it.s.auto.mode, cols = SCLS[mode] || {}, pct = posPct(mode, a.c);
        lines.push('<b>Automatic spots:</b> ' + Object.keys(cols).map(k => `<span style="color:${cols[k][0]}">○</span> ${esc(sName(it.s.stain, mode, k))} <b>${a.c[k] || 0}</b>`).join(' &nbsp; ') +
          (pct != null ? ` &nbsp;·&nbsp; <b>${pct}%</b> ${mode === 'ring' ? 'with brown membrane' : 'brown'}` : '') + ' <span style="opacity:.6">(a color program, not a pathologist)</span>'); }
      if (lines.length) { const cap = document.createElement('div'); cap.className = 'lcap'; cap.innerHTML = lines.join('<br>');
        ov.append(top, stage, cap, nav(-1, 'left', '‹'), nav(1, 'right', '›')); return; }
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
    const hay = ('pathology slides slide photos gallery compare biopsy stain ihc learn lesson tissue map tumor healthy mask spots ' + P.stains.map(s => s.label).join(' ') + ' ' + P.cases.map(c => c.title + ' ' + c.diagnosis).join(' ')).toLowerCase();
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
