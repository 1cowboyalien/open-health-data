/* Photo story (title from the data, e.g. "<name>'s story"): a person's own photos and videos in the Library of the lab viewer (labs.html), put in order by when they were taken.
   Used by make_lab_view.py when local/photos/photos_view.json exists (made by the private local/photos/build_web.py).
   Everything about the photos (dates, chapters, people, notes) comes from PHOTO_DATA, never from this code. The pictures are
   served by serve_viewer.py at /photos/thumb/<id>.jpg and /photos/web/<id>.<ext> (website copies: no location or camera data).
   It plugs into the same hooks as the MRD, imaging, procedure and pathology panels (MRD.isId/title/unit/h0/panel/refresh/section).
   Panels:
     photo:strip   = "Photos over time": small pictures on the shared time axis (same x as every chart; the scrub line follows),
                     chapters as a band on top; photos too close together share one tile with a count. Click a tile: open it.
     photo:gallery = "Gallery": the "Before & after" intro, then chapter → month, a grid of photos and videos. Click one: open it.
   Full-window view: the photo or video large, ‹ › / arrow keys, Esc closes; its date and how sure it is, the chapter, who is in it,
   "What was happening" (nearby procedures and hospital stays, if the Procedures panel's data is in the page) and the stories told about it.
   Graphic photos (level "graphic": wounds, skin changes, nudity): ONE button, "Show graphic photos", off by default, shows or covers
   all of them at once; until it is on, a graphic photo is a covered box and its picture is never requested. Kept per browser
   (store 'photo.graphic').
   Stories: fetched from /photos/stories.json = {stories: {<id>: [{title?, caption?, told?, family_only?, turns: [{who, text, audio?}]} | {text}]}};
   Stories told on the story page (story_view.html) name their storyteller (teller: Erica, or family and friends) and carry a caption in her words and the conversation; at home each of her answers
   can be played (audio = <session>/takes/NNN.wav, served by /story/audio/, home network only); links and more photos added in the
   story editor are listed under it. labs.html#date=YYYY-MM-DD opens the charts around that date (links saved with a story).
   the server leaves out family-only stories for visitors outside the home network. The words are shown as they were said.
   Data: PHOTO_DATA = {title, teller, chapters: [{from, title, about}], items: [{id, kind: photo|video, ext, t, tz?, sure, src?, chapter, level,
                       people?, caption?, note?, w?, h?, seconds?, session?, display?: 'intro', panels?, ask?}]}. */
(() => {
  const P = PHOTO_DATA;
  const NAME = P.title || 'Photos', TELLER = P.teller || 'the person', TELLS = TELLER + (TELLER.endsWith('s') ? "'" : "'s");   // the panel name and whose stories they are come from the data
  const IDS = 'photo:strip', IDG = 'photo:gallery';
  const EVERY = P.items.slice().sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  EVERY.forEach(i => { i.level0 = i.level; });
  /* Edits from /photos/edits.json (hidden photos, changed labels), saved by the Edit mode (this Mac and the home network only) */
  let HID = new Set(), canEdit = false, edit = false, showHidden = false;
  let ALL, INTRO, TL, nPh, nVid, PANELS = null;
  function applyEdits(e) {
    if (e) { HID = new Set(e.hidden || []); canEdit = !!e.canEdit; EVERY.forEach(i => { i.level = (e.level || {})[i.id] || i.level0; }); }
    ALL = EVERY.filter(i => !HID.has(i.id));
    INTRO = ALL.filter(i => i.display === 'intro');
    TL = ALL.filter(i => i.display !== 'intro');                       // everything on the timeline
    nPh = ALL.filter(i => i.kind === 'photo').length; nVid = ALL.filter(i => i.kind === 'video').length;
    if (PANELS) { PANELS[IDS].unit = TL.length + ' photos and videos'; PANELS[IDG].unit = nPh + ' photos · ' + nVid + ' videos'; }
  }
  applyEdits();
  PANELS = {[IDS]: {title: NAME + ' · photos over time', unit: TL.length + ' photos and videos', h0: 150},
                  [IDG]: {title: NAME + ' · gallery', unit: nPh + ' photos · ' + nVid + ' videos', h0: 620}};
  const CH = P.chapters, CHI = Object.fromEntries(CH.map((c, i) => [c.title, i]));
  const CHCOL = ['#8a8984', '#6b7280', '#c2410c', '#2a78d6', '#b45309', '#7c3aed', '#d4572a', '#1baf7a', '#a83fd0', '#2aa876', '#d42a8a'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const tOf = it => ms(String(it.t).slice(0, 10));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const S = Object.assign({chapter: '', win: false, size: 130, stories: false}, store.get('photo.view', {}));
  const saveS = () => store.set('photo.view', S);
  let graphic = !!store.get('photo.graphic', false);
  const isG = it => it.level === 'graphic';
  const covered = it => isG(it) && !graphic && !edit;   // the Edit mode shows everything, so labels can be judged
  const thumb = it => '/photos/thumb/' + encodeURIComponent(it.id) + '.jpg';
  const web = it => '/photos/web/' + encodeURIComponent(it.id) + '.' + (it.kind === 'video' ? it.ext : 'jpg');
  const BODIES = new Map();

  /* when: "Jun 14, 2023 · 7:04 PM", with how sure we are */
  function when(it, long) {
    const s = String(it.t), d = new Date(Date.UTC(+s.slice(0, 4), +(s.slice(5, 7) || 1) - 1, +(s.slice(8, 10) || 1)));
    const day = s.length >= 10 ? d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}) : s;
    let tm = '';
    if (s.length >= 16 && ['exact', 'matched'].includes(it.sure)) { const h = +s.slice(11, 13), m = s.slice(14, 16);
      tm = ' · ' + ((h + 11) % 12 + 1) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM'); }
    const sure = {exact: '', matched: long ? 'matched to photos taken at the same moment' : '', day: long ? 'day known, time not' : '',
      question: 'date not certain', panels: 'three photos from different times'}[it.sure] || '';
    return {text: day + tm, sure};
  }
  const dur = s => s ? (s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : Math.round(s) + 's') : '';

  /* ================= graphic button (one for all) ================= */
  function setGraphic(on) { graphic = on; store.set('photo.graphic', on); redrawAll(); }
  function graphicBtn() {
    const nG = ALL.filter(isG).length, b = document.createElement('button');
    b.type = 'button'; b.className = 'photoGBtn' + (graphic ? ' on' : '');
    b.textContent = graphic ? '◉ Graphic photos shown · hide them' : '○ Show graphic photos (' + nG + ')';
    b.title = graphic ? 'Cover every graphic photo again' : 'Some photos show the physical side of treatment: surgery wounds, skin changes, nudity. Press to show all of them; press again to cover them.';
    b.setAttribute('aria-pressed', graphic);
    b.onclick = () => setGraphic(!graphic); return b;
  }

  /* ================= photos over time (strip on the shared axis) ================= */
  const IMGS = new Map();
  function img(src, cb) { let o = IMGS.get(src); if (!o) { o = new Image(); o.decoding = 'async'; o.src = src; IMGS.set(src, o); }
    if (!o.complete && cb) o.addEventListener('load', cb, {once: true}); return o; }
  let stripTiles = [];
  function drawStrip(id, body) {
    body.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'photoBar';
    bar.append(graphicBtn());
    const hint = document.createElement('span'); hint.className = 'sub'; hint.textContent = 'Click a picture to open it · tiles with a number hold photos taken close together';
    bar.append(hint); body.append(bar);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer';
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Photos on the time axis');
    const tip = document.createElement('div'); tip.className = 'photoTip';
    box.append(cv, tip); body.append(box);
    const paint = () => {
      if (!cv.isConnected) return;
      const r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, Wd = r.width, Hd = r.height;
      cv.width = Wd * dpr; cv.height = Hd * dpr;
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, Wd, Hd);
      const L = YW, R = Wd - 8, X = t => L + pos(t) / 100 * (R - L), BAND = 18, top = BAND + 6, S_ = Math.max(28, Math.min(72, Hd - top - 18));
      c.font = '11px system-ui'; c.textBaseline = 'middle';
      // chapter band
      CH.forEach((ch, i) => { if (!ch.from) return; const a = ms(ch.from), nx = CH[i + 1] ? ms(CH[i + 1].from) : Infinity, b = Math.min(nx, W.b);
        if (b < W.a || a > W.b) return; const x0 = Math.max(L, X(Math.max(a, W.a))), x1 = Math.min(R, X(b));
        c.globalAlpha = .18; c.fillStyle = CHCOL[i % CHCOL.length]; c.fillRect(x0, 0, x1 - x0, BAND); c.globalAlpha = 1;
        c.fillStyle = CHCOL[i % CHCOL.length]; c.fillRect(x0, 0, 2, BAND);
        c.save(); c.beginPath(); c.rect(x0 + 4, 0, x1 - x0 - 6, BAND); c.clip(); c.fillStyle = css('--ink2'); c.fillText(ch.title, x0 + 6, BAND / 2); c.restore(); });
      c.fillStyle = css('--muted'); c.textAlign = 'right'; c.fillText('chapters', L - 6, BAND / 2); c.fillText('photos', L - 6, top + S_ / 2); c.textAlign = 'left';
      // tiles: one per day, merged when they would overlap
      const days = new Map(); TL.forEach(it => { const t = tOf(it); if (t < W.a || t > W.b) return; const k = String(it.t).slice(0, 10); (days.get(k) || days.set(k, []).get(k)).push(it); });
      const tiles = []; [...days.entries()].sort().forEach(([k, its]) => { const x = X(ms(k)); const last = tiles[tiles.length - 1];
        if (last && x - S_ / 2 < last.x + S_ / 2 + 3) { last.its.push(...its); last.to = k; } else tiles.push({x: Math.max(L + S_ / 2, Math.min(R - S_ / 2, x)), its: its.slice(), from: k, to: k}); });
      stripTiles = tiles.map(tl => Object.assign(tl, {x0: tl.x - S_ / 2, y0: top, s: S_}));
      tiles.forEach(tl => { const cover = tl.its.find(i => !covered(i)) || tl.its[0], x0 = tl.x0, y0 = top;
        c.save(); c.beginPath(); c.roundRect ? c.roundRect(x0, y0, S_, S_, 5) : c.rect(x0, y0, S_, S_); c.clip();
        if (covered(cover)) { c.fillStyle = css('--line'); c.fillRect(x0, y0, S_, S_); c.fillStyle = css('--muted'); c.textAlign = 'center'; c.fillText('graphic', tl.x, y0 + S_ / 2); c.textAlign = 'left'; }
        else { const im = img(thumb(cover), paint); if (im.complete && im.naturalWidth) { const k = Math.max(S_ / im.naturalWidth, S_ / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
            c.drawImage(im, tl.x - w / 2, y0 + S_ / 2 - h / 2, w, h); } else { c.fillStyle = css('--line'); c.fillRect(x0, y0, S_, S_); } }
        c.restore();
        c.strokeStyle = css('--card'); c.lineWidth = 2; c.strokeRect(x0, y0, S_, S_);
        if (tl.its.length > 1) { const tx = String(tl.its.length); c.font = 'bold 11px system-ui'; const w = c.measureText(tx).width + 8;
          c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(x0 + S_ - w - 2, y0 + 2, w, 15); c.fillStyle = '#fff'; c.fillText(tx, x0 + S_ - w + 2, y0 + 10); c.font = '11px system-ui'; }
        if (tl.its.some(i => i.kind === 'video')) { c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(x0 + 2, y0 + S_ - 17, 16, 15); c.fillStyle = '#fff'; c.fillText('▶', x0 + 5, y0 + S_ - 9); }
        c.strokeStyle = css('--muted'); c.lineWidth = 1; c.beginPath(); c.moveTo(X(ms(tl.from)), y0 + S_ + 2); c.lineTo(X(ms(tl.from)), y0 + S_ + 8); c.stroke(); });
      const before = TL.filter(i => tOf(i) < W.a).length, after = TL.filter(i => tOf(i) > W.b).length;
      c.fillStyle = css('--muted'); if (before) c.fillText('◀ ' + before + ' earlier', L + 2, Hd - 6);
      if (after) { c.textAlign = 'right'; c.fillText(after + ' later ▶', R - 2, Hd - 6); c.textAlign = 'left'; }
      if (!tiles.length) { c.fillStyle = css('--muted'); c.fillText('No photos in this time window', L + 8, top + S_ / 2); }
      if (hoverX != null) { const px = L + hoverX / 100 * (R - L); if (px >= L && px <= R) { c.save(); c.strokeStyle = css('--muted'); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(px, 0); c.lineTo(px, Hd); c.stroke(); c.restore(); } }
    };
    const hit = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      return {x, y, r, tl: stripTiles.find(t => x >= t.x0 && x <= t.x0 + t.s && y >= t.y0 && y <= t.y0 + t.s)}; };
    cv.onmousemove = e => { const {x, r, tl} = hit(e), L = YW, R = r.width - 8; setHover(x >= L && x <= R ? (x - L) / (R - L) * 100 : null);
      if (!tl) { tip.style.display = 'none'; return; }
      const a = when(tl.its[0]), b = when(tl.its[tl.its.length - 1]);
      tip.innerHTML = esc(a.text.split(' · ')[0] + (tl.from !== tl.to ? ' – ' + b.text.split(' · ')[0] : '')) + '<br>' + tl.its.length + ' photo' + (tl.its.length > 1 ? 's' : '') +
        (tl.its.some(covered) ? ' (' + tl.its.filter(covered).length + ' graphic, covered)' : '') + '<br><span style="opacity:.7">' + esc(tl.its[0].chapter || '') + '</span>';
      tip.style.display = 'block'; tip.style.left = Math.min(x + 12, r.width - 230) + 'px'; tip.style.top = '4px'; };
    cv.onmouseleave = () => { tip.style.display = 'none'; setHover(null); };
    cv.onclick = e => { const {tl} = hit(e); if (tl) openBox(tl.its, 0); };
    BODIES.set(id, {body, paint}); requestAnimationFrame(paint);
  }
  // the shared scrub line: redraw the strip when it moves
  { const _sh = setHover; setHover = function (xv) { const ch = xv !== hoverX; _sh(xv); if (ch) { const b = BODIES.get(IDS); if (b && b.paint) b.paint(); } }; }
  window.addEventListener('resize', () => { const b = BODIES.get(IDS); if (b && b.paint) b.paint(); });

  /* ================= gallery ================= */
  let STORIES = {}, storiesHome = false, storiesLoaded = false;
  fetch('/photos/edits.json').then(r => r.ok ? r.json() : null).then(j => { if (j) { applyEdits(j); if (sel.some(mine)) render(); list(); } }).catch(() => {});
  /* the gallery keeps its place: its scroll position survives every redraw (reset only when the filters change),
     and the page itself does not move when a save redraws the panels */
  let galScroll = 0, lastDone = null, galWhere = null;
  window.addEventListener('scroll', () => { if (galWhere) galWhere(); }, {passive: true});
  function saveEdit(body, what) {
    return fetch('/photos/edits', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || r.status)))
      .then(j => { const y = window.scrollY; applyEdits(j); lastDone = what || null; render(); list(); window.scrollTo(0, y); })   // render(): the panel headers show the new counts
      .catch(err => alert('Not saved: ' + err));
  }
  function editBar(it) {
    const b = document.createElement('div'); b.className = 'photoEdit';
    const h = document.createElement('button'); h.type = 'button';
    const hid = HID.has(it.id); h.textContent = hid ? '↩ Restore' : '✕ Hide'; h.className = hid ? 'phRestore' : 'phHide';
    h.title = hid ? 'Put this photo back on the website' : 'Take this photo off the website (the original is not touched; it can be restored)';
    const nm = when(it).text.split(' · ')[0] + ' ' + (it.kind === 'video' ? 'video' : 'photo');
    h.onclick = e => { e.stopPropagation(); saveEdit({id: it.id, hidden: !hid}, {text: (hid ? '↩ Restored: ' : '✕ Hidden: ') + nm, undo: {id: it.id, hidden: hid}}); };
    const sl = document.createElement('select'); sl.title = 'Label'; sl.setAttribute('aria-label', 'Label');
    ['everyday', 'medical', 'graphic'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; o.selected = (it.level || 'everyday') === v; sl.append(o); });
    sl.onclick = e => e.stopPropagation();
    sl.onchange = () => { const was = it.level || 'everyday';
      saveEdit({id: it.id, level: sl.value === (it.level0 || 'everyday') ? null : sl.value},
        {text: 'Label: ' + nm + ' → ' + sl.value, undo: {id: it.id, level: was === (it.level0 || 'everyday') ? null : was}}); };
    b.append(h, sl); return b;
  }
  fetch('/photos/stories.json').then(r => r.ok ? r.json() : null).then(j => { if (j) { STORIES = j.stories || {}; storiesHome = !!j.home; } storiesLoaded = true;
    const g = BODIES.get(IDG); if (g && g.body.isConnected) drawGallery(IDG, g.body); }).catch(() => { storiesLoaded = true; });
  const nStories = it => (STORIES[it.id] || []).length;

  function card(it, list, k, big) {
    const d = document.createElement('button'); d.type = 'button'; d.className = 'photoCard' + (big ? ' big' : '');
    d.style.width = d.style.height = (big ? S.size * 1.6 : S.size) + 'px';
    if (covered(it)) { d.classList.add('cov'); d.innerHTML = '<span>graphic</span>'; d.title = when(it).text + ' · graphic photo, covered (Show graphic photos to see it)'; }
    else { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = it.caption || (it.kind === 'video' ? 'Video' : 'Photo') + ', ' + when(it).text; im.src = thumb(it); d.append(im);
      d.title = when(it).text + (it.caption ? '\n' + it.caption : '') + (it.note ? '\n' + it.note : ''); }
    const badges = [];
    if (it.kind === 'video') badges.push('▶ ' + dur(it.seconds));
    if (['question'].includes(it.sure)) badges.push('date?');
    if (nStories(it)) badges.push('💬 ' + nStories(it));
    if (badges.length) { const b = document.createElement('span'); b.className = 'photoBadge'; b.textContent = badges.join(' · '); d.append(b); }
    d.onclick = () => openBox(list, k);
    if (!edit) return d;
    const w = document.createElement('div'); w.className = 'photoEditWrap' + (HID.has(it.id) ? ' isHidden' : '') + (isG(it) ? ' isGraphic' : '');
    w.append(d, editBar(it)); return w;
  }

  function drawGallery(id, body) {
    body.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'photoBar';
    const sel_ = document.createElement('select'); sel_.setAttribute('aria-label', 'Chapter');
    sel_.innerHTML = '<option value="">All chapters</option>' + CH.filter(c => ALL.some(i => i.chapter === c.title)).map(c => '<option' + (S.chapter === c.title ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('');
    sel_.onchange = () => { S.chapter = sel_.value; saveS(); galScroll = 0; drawGallery(id, body); };
    const tog = (label, key, tip) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'photoTog' + (S[key] ? ' on' : ''); b.textContent = label; b.title = tip;
      b.setAttribute('aria-pressed', !!S[key]); b.onclick = () => { S[key] = !S[key]; saveS(); galScroll = 0; drawGallery(id, body); }; return b; };
    const size = document.createElement('input'); size.type = 'range'; size.min = 80; size.max = 260; size.value = S.size; size.title = 'Picture size'; size.setAttribute('aria-label', 'Picture size');
    size.oninput = () => { S.size = +size.value; saveS(); body.querySelectorAll('.photoCard').forEach(c => { const b = c.classList.contains('big') ? 1.6 : 1; c.style.width = c.style.height = S.size * b + 'px'; }); };
    if (canEdit) { const eb = document.createElement('button'); eb.type = 'button'; eb.className = 'photoTog' + (edit ? ' on' : '');
      eb.textContent = edit ? '✓ Done editing' : '✎ Edit photos'; eb.title = 'Hide photos from the website, or change their label (this Mac and the home network only)';
      eb.onclick = () => { edit = !edit; if (!edit) showHidden = false; lastDone = null; redrawAll(); }; bar.append(eb);
      if (edit) { const hb = document.createElement('button'); hb.type = 'button'; hb.className = 'photoTog' + (showHidden ? ' on' : '');
        hb.textContent = 'Hidden (' + HID.size + ')'; hb.title = 'Show only the photos taken off the website, to restore one';
        hb.onclick = () => { showHidden = !showHidden; galScroll = 0; lastDone = null; drawGallery(id, body); }; bar.append(hb); } }
    bar.append(graphicBtn(), sel_, tog('Only the time window', 'win', 'Show only photos inside the time window of the charts'),
      tog('💬 With stories', 'stories', 'Show only photos with a story (from ' + TELLER + ' or anyone else)'), size);
    body.append(bar);
    const note = document.createElement('div'); note.className = 'sub photoNote';
    note.textContent = graphic ? 'Graphic photos are shown. Some show surgery wounds, skin changes and nudity.' :
      'Some photos show the physical side of treatment (surgery wounds, skin changes, nudity). They are covered until you press "Show graphic photos".';
    body.append(note);
    const box = document.createElement('div'); box.className = 'photoScroll'; box.style.height = hOf(id, PANELS[id].h0) + 'px'; body.append(box);
    const POOL = showHidden ? EVERY.filter(i => HID.has(i.id)) : TL;
    let its = POOL.filter(i => (!S.chapter || i.chapter === S.chapter) && (!S.win || (tOf(i) >= W.a && tOf(i) <= W.b)) && (!S.stories || nStories(i)));
    if (edit) { const n = document.createElement('div'); n.className = 'photoEditNote';
      n.textContent = showHidden ? 'Photos taken off the website. "Restore" puts one back.' :
        'Editing: every photo is shown, graphic ones too. "Hide" takes a photo off the website for everyone; the original is never touched. Changes are saved at once.';
      body.insertBefore(n, box); }
    if (!S.chapter && !S.win && !S.stories && !showHidden && INTRO.length) {
      const sec = document.createElement('section'); sec.className = 'photoSec';
      sec.innerHTML = '<h3>Before &amp; after</h3>';
      INTRO.forEach((it, k) => { const row = document.createElement('div'); row.className = 'photoIntro'; row.append(card(it, INTRO, k, true));
        const tx = document.createElement('div'); tx.className = 'sub';
        tx.innerHTML = (it.panels || []).map(p => '<div><b>' + esc(p.pos[0].toUpperCase() + p.pos.slice(1)) + ':</b> ' + esc(p.taken ? String(p.taken).replace('/', ' to ') : 'date unknown') +
          (p.people && p.people.length ? ' · ' + esc(p.people.join(', ')) : '') + (p.note ? '<br><span style="opacity:.8">' + esc(p.note) + '</span>' : '') + '</div>').join('');
        row.append(tx); sec.append(row); });
      box.append(sec);
    }
    if (!its.length) { const e = document.createElement('div'); e.className = 'sub'; e.style.padding = '12px';
      e.textContent = S.stories ? 'No stories yet. When ' + TELLER + ' tells the story of a photo, it will show here.' : 'No photos match.'; box.append(e); }
    const byCh = new Map(); its.forEach(i => { (byCh.get(i.chapter) || byCh.set(i.chapter, []).get(i.chapter)).push(i); });
    [...byCh.entries()].sort((a, b) => (CHI[a[0]] ?? 99) - (CHI[b[0]] ?? 99)).forEach(([ch, list]) => {
      const c = CH[CHI[ch]] || {}, sec = document.createElement('section'); sec.className = 'photoSec';
      sec.style.borderLeftColor = CHCOL[(CHI[ch] ?? 0) % CHCOL.length];
      sec.innerHTML = '<h3>' + esc(ch || 'Undated') + ' <span class="sub">' + list.length + '</span></h3>' + (c.about ? '<div class="sub">' + esc(c.about) + '</div>' : '');
      const byM = new Map(); list.forEach(i => { const m = String(i.t).slice(0, 7); (byM.get(m) || byM.set(m, []).get(m)).push(i); });
      byM.forEach((ml, m) => { const h = document.createElement('h4'); h.textContent = (MONTHS[+m.slice(5, 7) - 1] || '') + ' ' + m.slice(0, 4) + ' · ' + ml.length; sec.append(h);
        const grid = document.createElement('div'); grid.className = 'photoGrid'; ml.forEach(it => grid.append(card(it, its, its.indexOf(it)))); sec.append(grid); });
      box.append(sec);
    });
    // "you are here": a bar pinned to the bottom of the gallery with the chapter and month at the top of the view, and the last change (Undo)
    const here = document.createElement('div'); here.className = 'photoHere'; const hereT = document.createElement('span'); here.append(hereT);
    if (edit && lastDone) { const d = document.createElement('span'); d.className = 'done'; d.textContent = lastDone.text;
      const u = document.createElement('button'); u.type = 'button'; u.textContent = 'Undo';
      u.onclick = () => saveEdit(lastDone.undo, {text: 'Undone: ' + lastDone.text.replace(/^\S+ /, '')}); here.append(d, u); }
    box.append(here);
    const heads = [...box.querySelectorAll('h3,h4')];
    // the place = the heading above a line 40% down the part of the gallery you can see (the page's pinned panels can cover its top)
    const where = () => { const r = box.getBoundingClientRect(), v0 = Math.max(r.top, 0), v1 = Math.min(r.bottom, window.innerHeight), top = v0 + (v1 - v0) * 0.4; let ch = '', mo = '';
      heads.forEach(h => { if (h.getBoundingClientRect().top <= top) { if (h.tagName === 'H3') { ch = h.firstChild.textContent.trim(); mo = ''; } else mo = h.textContent.split(' · ')[0]; } });
      if (!ch && heads[0]) ch = heads[0].firstChild.textContent.trim();
      hereT.textContent = '📍 ' + [ch, mo].filter(Boolean).join(' · '); };
    box.scrollTop = galScroll; box.onscroll = () => { galScroll = box.scrollTop; where(); }; requestAnimationFrame(where);
    galWhere = () => { if (box.isConnected) where(); };
    BODIES.set(id, {body});
  }

  /* ================= full-window view ================= */
  const PROC = typeof PROC_DATA !== 'undefined' ? PROC_DATA : null;
  function happening(it) {
    if (!PROC) return [];
    const t = tOf(it), out = [];
    (PROC.events || []).forEach(e => { if (!e.date) return; const d = Math.round((ms(e.date) - t) / DAY); if (Math.abs(d) <= 10) out.push({d, text: e.short || e.label || '', date: e.date}); });
    (PROC.stays || []).forEach(s => { const a = ms(String(s.from).slice(0, 10)), b = ms(String(s.to || s.from).slice(0, 10)); if (t >= a - DAY && t <= b + DAY)
      out.push({d: 0, text: (s.kind === 'er' ? 'ER visit' : 'In hospital') + (s.where || s.site ? ' (' + (s.where || s.site) + ')' : '') + ' ' + String(s.from).slice(0, 10) + ' to ' + String(s.to || '').slice(0, 10), date: s.from, stay: true}); });
    return out.sort((a, b) => Math.abs(a.d) - Math.abs(b.d)).slice(0, 6);
  }
  function storyHtml(it) {
    const L = STORIES[it.id] || [];
    if (!L.length) return '<div class="sub">No stories yet. When ' + esc(TELLER) + ' tells the story of this photo, the words will appear here, as they were said.</div>';
    return L.map(s => '<div class="photoStory">' + (s.title ? '<b>' + esc(s.title) + '</b>' : '') +
      ' <span class="sub">' + esc(s.teller || TELLER) + (s.told ? ' told it ' + esc(s.told) : '') + '</span>' +
      (s.family_only ? ' <span class="sub">· family only</span>' : '') +
      (s.caption ? '<div class="cap">' + esc(s.caption) + '</div>' : '') +
      (s.caption && s.turns ? '<details><summary class="sub">The conversation (' + s.turns.length + ')</summary>' : '') +
      (s.turns || [{who: s.teller || TELLER, text: s.text}]).map(x => '<div class="turn ' + (x.who !== 'Claude' ? 'teller' : 'other') + '"><span class="who">' + esc(x.who || '') +
        (x.audio && storiesHome ? ' <audio controls preload="none" src="/story/audio/' + esc(x.audio) + '"></audio>' : '') + '</span>' + esc(x.text || '') + '</div>').join('') +
      (s.caption && s.turns ? '</details>' : '') +
      ((s.photos || []).filter(id => ALL.some(x => x.id === id)).length ? '<div class="sub" style="margin-top:6px">More photos in this story</div><div class="moreph">' +
        s.photos.filter(id => ALL.some(x => x.id === id)).map(id => '<a href="/photos/web/' + encodeURIComponent(id) + '.jpg" target="_blank" rel="noopener"><img src="/photos/thumb/' + encodeURIComponent(id) + '.jpg" alt="" loading="lazy"></a>').join('') + '</div>' : '') +
      ((s.links || []).length ? '<div class="sub" style="margin-top:6px">Links</div>' + s.links.map(l => '<div><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + '</a></div>').join('') : '') +
      '</div>').join('');
  }
  function openBox(list, k) {
    const ov = document.createElement('div'); ov.className = 'photoOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Photo');
    const show = () => {
      const it = list[k], w = when(it, true), hp = happening(it);
      ov.innerHTML = '';
      const stage = document.createElement('div'); stage.className = 'photoStage';
      if (covered(it)) { stage.innerHTML = '<div class="photoCovered"><div>Graphic photo</div><div class="sub">It shows the physical side of treatment. It is covered until "Show graphic photos" is on.</div></div>';
        const b = graphicBtn(); b.onclick = () => { setGraphic(true); show(); }; stage.firstChild.append(b); }
      else if (it.kind === 'video') { const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.src = web(it); v.poster = thumb(it); stage.append(v); }
      else { const im = document.createElement('img'); im.src = web(it); im.alt = it.caption || 'Photo, ' + w.text; stage.append(im); }
      const side = document.createElement('div'); side.className = 'photoSide';
      side.innerHTML = '<div class="photoWhen">' + esc(w.text) + '</div>' + (w.sure ? '<div class="sub">' + esc(w.sure) + '</div>' : '') +
        (it.caption ? '<p>' + esc(it.caption) + '</p>' : '') +
        '<div class="sub" style="margin-top:6px">' + esc(it.chapter || '') + '</div>' +
        (it.people && it.people.length ? '<div><b>Who:</b> ' + esc(it.people.join(', ')) + '</div>' : '') +
        (it.session ? '<div class="sub">' + esc(it.session) + '</div>' : '') +
        (it.note ? '<div class="sub" style="margin-top:6px">' + esc(it.note) + '</div>' : '') +
        (it.src && it.sure !== 'exact' ? '<div class="sub">Date from: ' + esc(it.src) + '</div>' : '') +
        (it.panels ? it.panels.map(p => '<div class="sub"><b>' + esc(p.pos) + ':</b> ' + esc(p.taken || 'date unknown') + (p.note ? ' · ' + esc(p.note) : '') + '</div>').join('') : '') +
        (hp.length ? '<h4>What was happening</h4>' + hp.map(h => '<div class="sub">' + (h.stay ? '' : esc(h.date) + ' (' + (h.d === 0 ? 'same day' : Math.abs(h.d) + ' day' + (Math.abs(h.d) > 1 ? 's ' : ' ') + (h.d > 0 ? 'later' : 'earlier')) + '): ') + esc(h.text) + '</div>').join('') : '') +
        '<h4>Stories</h4>' + storyHtml(it);
      if (it.display !== 'intro') { const go = document.createElement('button'); go.type = 'button'; go.className = 'photoTog'; go.textContent = 'Show this date on the charts';
        go.title = 'Move every chart to a window centred on this date, with the cursor locked on it (the Brain MRI viewer shows the scan from then)'; go.onclick = () => { goToDate(tOf(it), {len: 90 * DAY}); close(); }; side.append(go); }
      const nav = document.createElement('div'); nav.className = 'photoNav';
      nav.innerHTML = '<button type="button" aria-label="Previous">‹</button><span>' + (k + 1) + ' of ' + list.length + '</span><button type="button" aria-label="Next">›</button><button type="button" aria-label="Close" class="x">✕</button>';
      const [pv, , nx, x] = nav.children; pv.onclick = () => step(-1); nx.onclick = () => step(1); x.onclick = close;
      pv.disabled = k === 0; nx.disabled = k === list.length - 1;
      ov.append(stage, side, nav);
    };
    const step = d => { const j = k + d; if (j < 0 || j >= list.length) return; k = j; show(); };
    const key = e => { const d = {ArrowLeft: -1, ArrowRight: 1}[e.key]; if (e.key === 'Escape') close(); else if (d) step(d); else return; e.preventDefault(); e.stopPropagation(); };
    function close() { document.removeEventListener('keydown', key, true); ov.remove(); }
    ov.onclick = e => { if (e.target === ov) close(); };
    document.addEventListener('keydown', key, true); document.body.append(ov); show();
  }

  function redrawAll() { BODIES.forEach((v, id) => { if (v.body.isConnected) (id === IDS ? drawStrip : drawGallery)(id, v.body); }); }

  /* styles (theme colours from the viewer's CSS variables) */
  const st = document.createElement('style');
  st.textContent = `.photoBar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;margin-bottom:6px}
.photoBar select{font:inherit;font-size:12px;padding:2px 6px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);max-width:260px}
.photoGBtn,.photoTog{font:inherit;font-size:12px;padding:3px 10px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.photoGBtn{border-color:#b45309;color:#b45309}.photoGBtn.on{background:#b45309;color:#fff}.photoTog.on{background:var(--ink);color:var(--bg)}
.photoNote{margin:0 0 6px}.photoTip{position:absolute;pointer-events:none;display:none;z-index:5;max-width:230px;background:rgba(0,0,0,.85);color:#fff;font-size:11px;line-height:1.35;padding:5px 7px;border-radius:6px}
.photoScroll{overflow:auto;padding-right:4px}.photoSec{border-left:3px solid var(--line);padding:2px 0 8px 10px;margin:0 0 14px}
.photoSec h3{margin:4px 0 2px;font-size:15px;position:sticky;top:0;z-index:2;background:var(--card);padding:2px 0}
.photoSec h4{margin:10px 0 4px;font-size:12px;color:var(--ink2);font-weight:600;position:sticky;top:24px;z-index:1;background:var(--card);padding:1px 0}
.photoHere{position:sticky;bottom:0;z-index:3;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:6px 10px;border-radius:8px;
 background:var(--ink);color:var(--bg);font-size:13px;box-shadow:0 -2px 8px rgba(0,0,0,.25)}.photoHere .done{font-weight:600;margin-left:auto}
.photoHere button{font:inherit;font-size:12px;padding:1px 10px;border-radius:8px;border:1px solid var(--bg);background:transparent;color:var(--bg);cursor:pointer}
.photoDone{display:flex;gap:8px;align-items:center;margin-top:4px;font-weight:600}.photoDone button{font:inherit;font-size:12px;padding:1px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.photoGrid{display:flex;flex-wrap:wrap;gap:6px}.photoIntro{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}.photoIntro .sub div{margin-bottom:6px}
.photoCard{position:relative;padding:0;border:0;border-radius:6px;overflow:hidden;background:var(--line);cursor:pointer;flex:none}
.photoCard img{width:100%;height:100%;object-fit:cover;display:block}.photoCard.cov{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;
 background:repeating-linear-gradient(45deg,var(--line),var(--line) 8px,var(--card) 8px,var(--card) 16px)}
.photoCard:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.photoEditWrap{display:flex;flex-direction:column;gap:3px}.photoEditWrap.isGraphic .photoCard{outline:2px solid #b45309}
.photoEditWrap.isHidden .photoCard{opacity:.45}.photoEdit{display:flex;gap:3px}.photoEdit button,.photoEdit select{font:inherit;font-size:11px;padding:1px 4px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.photoEdit button.phHide{color:#c2410c}.photoEdit button.phRestore{color:#1baf7a}.photoEdit select{flex:1;min-width:0}
.photoEditNote{font-size:12px;margin:0 0 6px;padding:5px 8px;border-radius:6px;background:rgba(180,83,9,.12);color:var(--ink)}
.photoBadge{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;padding:1px 5px;border-radius:8px}
.photoOv{position:fixed;inset:0;z-index:1000;background:rgba(10,10,10,.92);display:grid;grid-template-columns:1fr 340px;grid-template-rows:1fr auto;gap:0}
.photoStage{display:flex;align-items:center;justify-content:center;min-height:0;padding:16px}.photoStage img,.photoStage video{max-width:100%;max-height:calc(100vh - 80px);object-fit:contain;border-radius:4px}
.photoCovered{color:#eee;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center}.photoCovered>div:first-child{font-size:20px}.photoCovered .sub{color:#bbb;max-width:360px}
.photoSide{grid-row:1/3;grid-column:2;background:var(--card);color:var(--ink);padding:16px;overflow:auto;font-size:14px}.photoSide h4{margin:14px 0 4px;font-size:13px}
.photoSide .photoTog{margin-top:12px}.photoWhen{font-size:17px;font-weight:600}
.photoNav{grid-column:1;display:flex;justify-content:center;align-items:center;gap:14px;color:#ddd;padding:8px}
.photoNav button{font-size:22px;background:transparent;border:1px solid #555;color:#eee;border-radius:8px;padding:0 12px;cursor:pointer}.photoNav button:disabled{opacity:.3}
.photoStory{border-top:1px solid var(--line);padding:8px 0}.photoStory .cap{font-family:Georgia,serif;font-size:16px;line-height:1.5;margin:6px 0}
.photoStory .moreph{display:flex;gap:6px;flex-wrap:wrap}.photoStory .moreph img{height:64px;border-radius:6px;display:block}
.photoStory audio{height:26px;vertical-align:middle;max-width:220px}.photoStory .turn{margin:6px 0;padding:6px 9px;border-radius:10px;background:var(--bg)}
.photoStory .turn.teller{background:rgba(42,120,214,.10)}.photoStory .who{display:block;font-size:11px;color:var(--muted);font-weight:600}
@media (max-width:760px){.photoOv{grid-template-columns:1fr;grid-template-rows:auto auto 1fr}.photoSide{grid-row:3;grid-column:1}.photoStage img,.photoStage video{max-height:55vh}}`;
  document.head.append(st);

  /* ================= plug into the viewer's hooks ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => id === IDS || id === IDG;
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? PANELS[id].unit : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); (id === IDS ? drawStrip : drawGallery)(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); const b = BODIES.get(id); if (!b || !b.body.isConnected) return;
    if (id === IDS) b.paint(); else if (S.win) drawGallery(id, b.body); };

  /* Library: <title> → Photos over time, Gallery, and one row per chapter (opens the gallery at that chapter) */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = (NAME + ' ' + TELLER + " story photos pictures videos gallery life family graphic stories " + CH.map(c => c.title).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return;
    const SEC = section(el, 'photo', NAME, ALL.length + ' photos', true, 'sec', q), s0 = SEC.firstChild;
    s0.insertBefore(groupOnlyBtn('photo panel', 'grp:photo', [IDS, IDG], soloLab && soloLab.key === 'grp:photo', false, () => onlyLab('grp:photo', [IDS, IDG], NAME)), s0.lastChild);
    const row = (label, count, tip, checked, onTick, onName) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked; cb.setAttribute('aria-label', 'Show ' + label);
      cb.onclick = e => { e.stopPropagation(); onTick(cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      d.append(cb, nm, n); d.onclick = onName || (() => { cb.checked = !cb.checked; onTick(cb.checked); }); return d; };
    SEC.append(row('Photos over time', TL.length, 'Small pictures on the time axis, lined up with every chart', sel.includes(IDS), v => setLabSel([IDS], v)));
    SEC.append(row('Gallery', ALL.length, 'Every photo and video by chapter and month; click one to open it, with its date and the stories told about it', sel.includes(IDG), v => setLabSel([IDG], v)));
    const G = section(SEC, 'photo:ch', 'Chapters', CH.filter(c => ALL.some(i => i.chapter === c.title)).length, false, 'grp', q);
    CH.filter(c => ALL.some(i => i.chapter === c.title)).forEach(c => { const n = ALL.filter(i => i.chapter === c.title).length;
      const open = () => { S.chapter = c.title; S.win = false; saveS(); if (!sel.includes(IDG)) setLabSel([IDG], true); else redrawAll(); };
      G.append(row(c.title, n, (c.about || c.title) + '\nClick: open the gallery at this chapter', sel.includes(IDG) && S.chapter === c.title, v => { if (v) open(); else { S.chapter = ''; saveS(); redrawAll(); } }, open)); });
  };

  const saved = store.get('selected', []);
  if (saved.some(mine)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
  // labs.html#date=YYYY-MM-DD (links saved with a story): open the charts around that date
  const hd = /date=(\d{4}-\d{2}-\d{2})/.exec(location.hash);
  if (hd) setTimeout(() => { try { goToDate(ms(hd[1]) + DAY / 2, {len: 60 * DAY}); } catch (e) {} }, 0);   // centred, cursor locked on that day
})();
