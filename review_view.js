/* Review page: the viewer with only the Pathology panel, and a side column where a reviewer (for example a pathologist)
   changes what the panel teaches. Served by serve_viewer.py at /review, which puts window.REVIEW = {reviewer, api, base}
   in the page and loads this file after the viewer's own script.

   - Tools on a photo (Viewer and full window): "Outline" an area or "Point" at a spot, then say what it is. An outline
     also corrects the tissue map inside it.
   - Chat with Claude: a message, with outlines, spots, files, pictures and links attached. Claude answers and may ask
     for changes; the server checks and applies them.
   - Every change is one line in the review's history (review.py). Undo, Redo, "Undo this", "Put back" and
     "Before / after" never delete anything.
   The page data comes from GET <api>/state (the family viewer's data + the changes that are on) and replaces the
   panel's built-in data through window.PATH.setData. No patient data in this file. */
(() => {
  const R = window.REVIEW, PATH = window.PATH;
  if (!R || !PATH || !PATH.setData) return;
  const $ = (s, root) => (root || document).querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const btn = (label, title, fn, cls) => { const b = el('button', 'rv-b' + (cls ? ' ' + cls : ''), label); b.type = 'button'; if (title) b.title = title; b.onclick = fn; return b; };
  const CLS = {1: ['Tumor', 't'], 4: ['Normal structure', 'h'], 3: ['Immune cells', 'h'], 2: ['Support tissue', 'h'], 5: ["Artifact, can't judge", 'u']};
  const GCOL = {t: 'rgb(255,45,110)', h: 'rgb(34,197,94)', u: 'rgb(245,158,11)'};
  const colOf = cls => GCOL[(CLS[cls] || [0, 'u'])[1]];
  const when = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}); };
  const keep = {get: (k, d) => { try { const v = JSON.parse(localStorage.getItem('review.' + k)); return v == null ? d : v; } catch (e) { return d; } },
                set: (k, v) => { try { localStorage.setItem('review.' + k, JSON.stringify(v)); } catch (e) { /* full or blocked: the page still works */ } }};
  const me = R.reviewer, as = 'as=' + encodeURIComponent(me.id);

  // ---- state ----
  let S = null;                 // the server's answer: {version, data, history, canUndo, canRedo, files, chat}
  let shown = null;             // the page data on screen: S.data, or the review without one change while "Before / after" is on
  let tab = keep.get('tab', 'chat'), tool = 'look', draft = null, drawing = false, attach = [], busy = false, sel = null, peek = null;
  let cur = null, lbRedraw = null;   // the photo on screen ({c, s, f, i}); how to draw the full-window view again while it is open
  const lbOpen = () => !!document.querySelector('.pth-lb .stage');
  const again = () => { if (lbOpen() && lbRedraw) lbRedraw(); else PATH.redraw(); };   // draw the photo on screen again
  let msgs = keep.get('chat.' + me.id, []), sessionId = keep.get('session.' + me.id, null), working = null;

  // ---- look ----
  const css = el('style'); css.textContent = `
:root{--rv-w:min(440px,36vw)}
body.revFocus{padding-right:var(--rv-w)}
body.revFocus aside,body.revFocus .navpin,body.revFocus #kfCard,body.revFocus #txCard,body.revFocus #single,body.revFocus #mrd,body.revFocus #askTop,body.revFocus #askSide,body.revFocus .askPanelBtn{display:none!important}
body.revFocus .wrap{grid-template-columns:minmax(0,1fr)!important}
body.revFocus :is(.card,.cmp):not(.revTarget):not(:has(.revTarget)){display:none!important}
body.revFocus .pth-lb{right:var(--rv-w)}
body.revFocus .revTarget>.cmph .ctl{display:none!important}
#rvSide [hidden]{display:none!important}
#rvSide{position:fixed;top:0;right:0;width:var(--rv-w);height:100vh;display:flex;flex-direction:column;z-index:10050;background:var(--card);color:var(--ink);border-left:1px solid var(--line);font-size:13.5px;line-height:1.45}
@media (max-width:900px){:root{--rv-w:100vw}body.revFocus{padding-right:0;padding-bottom:48vh}#rvSide{top:auto;bottom:0;height:46vh;border-left:none;border-top:2px solid var(--line)}body.revFocus .pth-lb{right:0;bottom:46vh}}
@media (max-width:760px){body.revFocus .pth-main{flex-direction:column}body.revFocus .pth-img{min-height:0}}
#rvSide button,#rvSide input,#rvSide textarea{font:inherit;color:inherit}
.rv-b{background:transparent;border:1px solid var(--line);border-radius:7px;padding:3px 9px;cursor:pointer;color:inherit}
.rv-b:hover{border-color:var(--accent)}.rv-b.on{background:var(--accent);border-color:var(--accent);color:#fff}.rv-b:disabled{opacity:.4;cursor:default}
.rv-head{padding:8px 10px 6px;border-bottom:1px solid var(--line)}
.rv-head .t{font-weight:700;font-size:15px}.rv-head .s{color:var(--muted);font-size:12px}
.rv-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.rv-live{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;margin-right:auto}
.rv-live i{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block}
.rv-live.pulse{color:var(--ink)}.rv-live.pulse i{animation:rvp 1.1s ease-out 2}
.rv-live.err i{background:#ef4444}.rv-live.err{color:#ef4444}
@keyframes rvp{0%{box-shadow:0 0 0 0 rgba(34,197,94,.7)}100%{box-shadow:0 0 0 11px rgba(34,197,94,0)}}
.rv-tabs{display:flex;gap:3px;padding:6px 8px 0}.rv-tabs .rv-b{flex:1;border-radius:7px 7px 0 0;border-bottom:none;padding:5px 3px}
.rv-n{display:inline-block;min-width:17px;padding:0 4px;border-radius:9px;background:rgba(127,127,127,.25);font-size:11.5px;text-align:center}
.rv-new{margin:8px;padding:8px 10px;border:2px solid var(--accent);border-radius:9px}
.rv-new input{width:100%;margin:6px 0;padding:5px 8px;background:transparent;border:1px solid var(--line);border-radius:6px}
.rv-pane{flex:1;min-height:0;display:flex;flex-direction:column;border-top:1px solid var(--line)}
.rv-scroll{flex:1;min-height:0;overflow:auto;padding:9px}
.rv-msg{margin:0 0 9px;padding:7px 10px;border-radius:10px;max-width:95%;background:rgba(127,127,127,.12);overflow-wrap:anywhere}
.rv-msg.you{background:rgba(42,120,214,.18);margin-left:auto}
.rv-msg .by{font-size:11.5px;color:var(--muted);margin-bottom:2px}
.rv-msg p{margin:5px 0}.rv-msg ul,.rv-msg ol{margin:5px 0;padding-left:20px}.rv-msg li{margin:2px 0}.rv-msg code{font-size:12px}
.rv-msg a{color:inherit}.rv-tb{border-collapse:collapse;font-size:12px;margin:5px 0}.rv-tb td,.rv-tb th{border:1px solid var(--line);padding:2px 6px;text-align:left}
.rv-made{margin-top:6px;padding:5px 8px;border-left:3px solid #22c55e;background:rgba(34,197,94,.1);border-radius:0 6px 6px 0}
.rv-fail{margin-top:6px;padding:5px 8px;border-left:3px solid #ef4444;background:rgba(239,68,68,.1);border-radius:0 6px 6px 0}
.rv-steps{color:var(--muted);font-size:12px;margin-top:3px}
.rv-chip{display:inline-flex;align-items:center;gap:5px;margin:2px 4px 2px 0;padding:1px 8px;border-radius:10px;background:rgba(127,127,127,.2);font-size:12.5px;max-width:100%}
.rv-chip img{width:26px;height:26px;object-fit:cover;border-radius:4px}.rv-chip button{padding:0 4px;border:none;background:none;cursor:pointer}
.rv-comp{border-top:1px solid var(--line);padding:8px}
.rv-comp textarea{width:100%;min-height:52px;resize:vertical;background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 9px;box-sizing:border-box}
.rv-comp.drop textarea{border-color:var(--accent)}
.rv-link{display:flex;gap:6px;margin:6px 0}.rv-link input{flex:1;background:transparent;border:1px solid var(--line);border-radius:6px;padding:3px 8px;min-width:0}
.rv-ent{padding:7px 9px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px}
.rv-ent.off{opacity:.55}.rv-ent.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.rv-ent .hd{font-size:11.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.rv-tag{padding:0 6px;border-radius:8px;background:rgba(127,127,127,.22);color:var(--ink)}
.rv-ent .w{color:var(--muted);font-size:12px;margin-top:2px}.rv-ent .acts{margin-top:5px;display:flex;flex-wrap:wrap;gap:5px}.rv-ent .acts .rv-b{padding:1px 8px;font-size:12.5px}
.rv-warn{color:#f59e0b;font-size:12px;margin-top:3px}
.rv-empty{color:var(--muted);padding:16px 8px;text-align:center}
.rv-peek{margin:8px;padding:6px 10px;border-radius:8px;background:rgba(245,158,11,.16);border:1px solid #f59e0b;font-size:12.5px}
.rv-ov{position:absolute;pointer-events:none;z-index:3}.rv-ov.draw{pointer-events:auto;cursor:crosshair;touch-action:none}
.rv-ov svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.rv-ov path,.rv-ov circle{fill:none;stroke-width:3;vector-effect:non-scaling-stroke;stroke-linejoin:round}.rv-ov .h{stroke:rgba(0,0,0,.8);stroke-width:7}
.rv-bd{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;border:2px solid rgba(0,0,0,.75);border-radius:11px;color:#000;font-weight:700;font-size:12px;padding:0 7px;line-height:18px;cursor:pointer}
.rv-bd.sel{box-shadow:0 0 0 3px #fff}
.rv-marks{margin:0 0 8px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:12.5px}
.rv-marks .r{display:flex;gap:6px;align-items:flex-start;margin:4px 0}.rv-marks .r span.b{flex:none;border-radius:9px;padding:0 6px;color:#000;font-weight:700;font-size:11.5px;line-height:17px}`;
  document.head.append(css);

  // ---- talking to the server ----
  const get = p => fetch(R.api + '/' + p + (p.indexOf('?') < 0 ? '?' : '&') + as).then(r => r.json());
  const post = (p, body) => fetch(R.api + '/' + p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({as: me.id}, body))})
    .then(async r => ({ok: r.ok, j: await r.json().catch(() => ({}))}));
  function live(t, cls) { const l = $('#rvLive'); if (!l) return; l.className = 'rv-live ' + (cls || 'pulse'); $('#rvLiveT').textContent = t; clearTimeout(live.t);
    live.t = setTimeout(() => { l.className = 'rv-live'; $('#rvLiveT').textContent = 'Live: every change shows here at once'; }, cls === 'err' ? 7000 : 2600); }
  function take(state, quiet) {   // a new state from the server: show it everywhere
    if (!state || !state.data) return; S = state; shown = S.data; if (peek) { peek = null; PATH.setBase(R.base); }
    PATH.setData(S.data); if (lbOpen() && lbRedraw) lbRedraw(); draw(); if (!quiet) live('Updated just now'); }
  const load = quiet => get('state').then(s => take(s, quiet));
  async function act(path, body, say) { const r = await post(path, body); if (r.j && r.j.data) take(r.j, !r.ok); if (!r.ok) live(r.j.error || 'That could not be saved.', 'err'); else if (say) live(say); return r; }
  const change = (op, words) => act('change', {op, words});
  const flip = (id, on) => act('flip', {id, on}, on ? 'Put back just now' : 'Undone just now');

  // ---- finding things in the page data ----
  function findFile(f) { for (const c of (shown ? shown.cases : [])) for (const s of c.slides) { const i = s.photos.indexOf(f); if (i >= 0) return {c, s, f, i}; } return null; }
  const stain = s => { const x = S.data.stains.find(t => t.key === s.stain); return x ? x.label : s.stain; };
  const slideName = (c, s) => stain(s) + (c.slides.filter(x => x.stain === s.stain).length > 1 ? ' · slide ' + s.slide : '');
  const place = f => { const it = findFile(f); return it ? slideName(it.c, it.s) + ', photo ' + (it.i + 1) : f; };
  const marksOn = f => { const it = findFile(f); return (it && it.s.rev && it.s.rev[f]) || []; };

  // ---- on the photo: review marks, and the Outline / Point tools ----
  const path = (pts, col, dash, open) => { const d = 'M' + pts.map(q => Math.round(q[0]) + ' ' + Math.round(q[1])).join('L') + (open ? '' : 'Z');
    return `<path d="${d}" class="h"/><path d="${d}" style="stroke:${col}${dash ? ';stroke-dasharray:10 7' : ''}"/>`; };
  const ring = (q, col) => `<circle cx="${q[0]}" cy="${q[1]}" r="20" class="h"/><circle cx="${q[0]}" cy="${q[1]}" r="20" style="stroke:${col}"/>`;
  const centre = pts => { let x = 0, y = 0; pts.forEach(q => { x += q[0]; y += q[1]; }); return [x / pts.length, y / pts.length]; };
  function photoLayer(holder, img, it, redraw) {
    cur = it; if (/\bstage\b/.test(holder.className)) lbRedraw = redraw;
    const ov = el('div', 'rv-ov' + (tool !== 'look' ? ' draw' : '')), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('preserveAspectRatio', 'none'); ov.append(svg); holder.append(ov);
    const fit = () => Object.assign(ov.style, {left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px'});
    const size = () => [img.naturalWidth || 1600, img.naturalHeight || 900];
    function paint() { const [w, h] = size(); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); let s = ''; ov.querySelectorAll('.rv-bd').forEach(b => b.remove());
      marksOn(it.f).forEach(m => { const col = m.kind === 'area' ? colOf(m.cls) : '#c7ceff'; s += m.pts.length > 1 ? path(m.pts, col) : ring(m.pts[0], col);
        const c = centre(m.pts), b = el('button', 'rv-bd' + (sel === m.id ? ' sel' : ''), '#' + m.id); b.type = 'button'; b.style.cssText = `left:${c[0] / w * 100}%;top:${c[1] / h * 100}%;background:${col}`;
        b.title = (m.kind === 'area' ? CLS[m.cls][0] + (m.note ? ': ' + m.note : '') : m.text) + ' · ' + (m.by || ''); b.onclick = e => { e.stopPropagation(); sel = m.id; showTab('history'); }; ov.append(b); });
      attach.forEach(a => { if (a.file === it.f) s += a.type === 'area' ? path(a.pts, '#fff', true) : a.type === 'pin' ? ring(a.at, '#fff') : ''; });
      if (draft && draft.file === it.f) s += draft.pts.length > 1 ? path(draft.pts, '#fff', true, drawing) : ring(draft.pts[0], '#fff');
      svg.innerHTML = s; }
    photoLayer.paint = paint;
    new ResizeObserver(fit).observe(img); if (!img.complete) img.addEventListener('load', () => { fit(); paint(); }, {once: true});
    paint(); setTimeout(() => { fit(); paint(); }, 0);   // the photo box is put on the page after this call; a hidden page gets no resize callback
    const at = e => { const r = img.getBoundingClientRect(), [w, h] = size(); if (!r.width || !r.height) return null; return [Math.max(0, Math.min(w, (e.clientX - r.left) / r.width * w)), Math.max(0, Math.min(h, (e.clientY - r.top) / r.height * h))]; };
    ov.addEventListener('pointerdown', e => { if (tool === 'look' || e.target.closest('.rv-bd')) return; e.preventDefault(); e.stopPropagation(); fit(); const q = at(e); if (!q) return;
      if (tool === 'pin') { draft = {file: it.f, pts: [q]}; paint(); drawNew(); return; }
      drawing = true; draft = {file: it.f, pts: [q]}; try { ov.setPointerCapture(e.pointerId); } catch (x) { /* synthetic events have no pointer to capture */ } paint(); drawNew(); });
    ov.addEventListener('pointermove', e => { if (!drawing) return; const q = at(e), l = draft.pts[draft.pts.length - 1]; if (q && Math.hypot(q[0] - l[0], q[1] - l[1]) > 6) { draft.pts.push(q); paint(); } });
    const end = () => { if (!drawing) return; drawing = false; const xs = draft.pts.map(q => q[0]), ys = draft.pts.map(q => q[1]);
      if (draft.pts.length < 6 || Math.max(...xs) - Math.min(...xs) < 20 || Math.max(...ys) - Math.min(...ys) < 20) draft = null; paint(); drawNew(); };
    ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
    ['click', 'dblclick'].forEach(t => ov.addEventListener(t, e => { if (tool !== 'look') e.stopPropagation(); }));
  }
  function setTool(t) { tool = t; if (t === 'look') drawing = false; again(); }
  function toolButtons(bar, it, redraw) {
    const mk = (t, label, title) => { const b = el('button', 'pth-b' + (tool === t ? ' on' : ''), label); b.type = 'button'; b.title = title;
      b.onclick = e => { e.stopPropagation(); draft = null; tool = tool === t ? 'look' : t; drawNew(); redraw(); }; return b; };
    bar.append(mk('area', '✏️ Outline', 'Review: draw around an area on the photo, then say what it is. This also corrects the tissue map inside it.'),
               mk('pin', '📍 Point', 'Review: click one spot on the photo, then write a note about it.'));
  }
  function sideMarks(side, it) { const ms = marksOn(it.f); if (!ms.length) return; const d = el('div', 'rv-marks', '<b>Review marks on this photo</b>');
    ms.forEach(m => { const r = el('div', 'r'), col = m.kind === 'area' ? colOf(m.cls) : '#c7ceff';
      r.innerHTML = `<span class="b" style="background:${col}">#${m.id}</span><div style="flex:1">${esc(m.kind === 'area' ? CLS[m.cls][0] + (m.note ? ': ' + m.note : '') : m.text)}<div style="color:var(--muted);font-size:11.5px">${esc(m.by || '')} · ${when(m.at)}</div></div>`;
      r.append(btn('Undo', 'Undo this change (it stays in the history)', () => flip(m.id, false))); d.append(r); });
    side.append(d); }
  window.PATH_EXT = {tools: toolButtons, photo: photoLayer, side: sideMarks,
    drawn: w => { const p = PATH.el(); if (p) p.classList.add('revTarget'); if (!lbOpen()) { lbRedraw = null; if (w.mode !== 'viewer') cur = null; } }};

  // ---- the side column ----
  const side = el('div'); side.id = 'rvSide';
  side.innerHTML = `<div class="rv-head"><div class="rv-row"><div style="margin-right:auto"><span class="t">Slide review</span> <span class="s">for ${esc(me.name)}${me.role ? ', ' + esc(me.role) : ''}</span></div>
      <button class="rv-b" id="rvUndo" title="Undo the latest change">↩ Undo</button><button class="rv-b" id="rvRedo" title="Put back the change that was undone last">↪ Redo</button></div>
    <div class="rv-row" style="margin-top:4px"><div class="rv-live" id="rvLive"><i></i><span id="rvLiveT">Live: every change shows here at once</span></div>
      <span class="s">A teaching review, not a pathology report</span></div></div>
    <div class="rv-tabs"><button class="rv-b" data-t="chat">Chat with Claude</button><button class="rv-b" data-t="history">History <span class="rv-n" id="rvHN">0</span></button><button class="rv-b" data-t="files">Files <span class="rv-n" id="rvFN">0</span></button></div>
    <div id="rvPeek"></div><div id="rvNew"></div>
    <div class="rv-pane" id="rvP-chat"><div class="rv-scroll" id="rvMsgs"></div>
      <div class="rv-comp" id="rvComp"><div id="rvAtts"></div><textarea id="rvTa" placeholder="Say what is wrong or missing. Enter sends; Shift+Enter makes a new line."></textarea>
        <div class="rv-link" id="rvLinkRow" hidden><input id="rvLinkIn" placeholder="https://… (a paper, a guideline, a teaching page)"><button class="rv-b" id="rvLinkAdd">Add</button></div>
        <div class="rv-row" style="margin-top:6px"><button class="rv-b" id="rvFileBtn" title="Add a file or a picture. You can also paste or drop one here.">📎 File or picture</button>
          <button class="rv-b" id="rvLinkBtn" title="Add a link">🔗 Link</button><input type="file" id="rvFile" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.tsv">
          <button class="rv-b on" id="rvSend" style="margin-left:auto">Send</button></div></div></div>
    <div class="rv-pane" id="rvP-history" hidden><div class="rv-scroll" id="rvHist"></div></div>
    <div class="rv-pane" id="rvP-files" hidden><div class="rv-scroll" id="rvFiles"></div></div>`;
  document.body.append(side); document.body.classList.add('revFocus');
  function showTab(t) { tab = t; keep.set('tab', t); draw(); }

  // the card that asks what a freshly drawn outline or spot is
  function drawNew() { const d = $('#rvNew'); d.innerHTML = ''; if (!draft || drawing) return; const isArea = draft.pts.length > 1, c = el('div', 'rv-new');
    c.innerHTML = `<b>${isArea ? 'What is this area?' : 'What is at this spot?'}</b> <span style="color:var(--muted);font-size:12px">${esc(place(draft.file))}. ${isArea ? 'Pick one and save' : 'Write a note and save it'}, or ask Claude about it.</span>`;
    const r = el('div', 'rv-row'); r.style.marginTop = '6px';
    if (isArea) Object.keys(CLS).map(Number).sort((a, b) => [1, 4, 3, 2, 5].indexOf(a) - [1, 4, 3, 2, 5].indexOf(b)).forEach(k => { const b = btn(`<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${colOf(k)};margin-right:4px"></span>${CLS[k][0]}`, '', () => { draft.cls = k; drawNew(); }, draft.cls === k ? 'on' : ''); r.append(b); });
    c.append(r); const inp = el('input'); inp.placeholder = isArea ? 'A few words, for example: a normal gland' : 'What should be noted here?'; inp.value = draft.note || '';
    const sv = btn(isArea ? 'Save this mark' : 'Save this note', '', async () => { const dr = draft; draft = null; drawNew(); tool = 'look'; again();
      await change(isArea ? {op: 'area', file: dr.file, pts: dr.pts, cls: dr.cls, note: (dr.note || '').trim()} : {op: 'pin', file: dr.file, at: dr.pts[0], text: dr.note.trim()}); }, 'on');
    const ok = () => { sv.disabled = !(isArea ? draft.cls : (draft.note || '').trim()); }; inp.oninput = () => { draft.note = inp.value; ok(); }; ok();
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !sv.disabled) sv.click(); });
    const a = el('div', 'rv-row');
    a.append(sv, btn('💬 Ask Claude about it', 'Attach it to a chat message', () => { attach.push(isArea ? {type: 'area', file: draft.file, pts: draft.pts} : {type: 'pin', file: draft.file, at: draft.pts[0]}); draft = null; tool = 'look'; showTab('chat'); again(); $('#rvTa').focus(); }),
      btn('Cancel', '', () => { draft = null; drawNew(); if (photoLayer.paint) photoLayer.paint(); }));
    c.append(inp, a); d.append(c); }

  // a small, safe Markdown reader for Claude's replies
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  function md(src) { const out = []; let list = null, para = [], table = null;
    const fp = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const fl = () => { if (list) { out.push('<' + list.t + '>' + list.items.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + list.t + '>'); list = null; } };
    const ft = () => { if (table) { out.push('<table class="rv-tb">' + table.map((r, i) => '<tr>' + r.map(c => (i ? '<td>' : '<th>') + inline(c) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</table>'); table = null; } };
    String(src || '').split('\n').forEach(line => { const l = line.replace(/\s+$/, ''); let m;
      if (/^\s*\|.*\|$/.test(l)) { fp(); fl(); if (!/^\s*\|[\s:|-]+\|$/.test(l)) (table = table || []).push(l.trim().slice(1, -1).split('|').map(x => x.trim())); return; }
      ft();
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { fp(); if (!list || list.t !== 'ul') { fl(); list = {t: 'ul', items: []}; } list.items.push(m[1]); }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { fp(); if (!list || list.t !== 'ol') { fl(); list = {t: 'ol', items: []}; } list.items.push(m[1]); }
      else if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { fp(); fl(); out.push('<p><b>' + inline(m[1]) + '</b></p>'); }
      else if (!l.trim()) { fp(); fl(); }
      else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += ' ' + l.trim();
      else { fl(); para.push(l); } });
    fp(); fl(); ft(); return out.join(''); }

  // ---- chat ----
  const fsize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fileUrl = fid => R.base + 'review-files/' + fid + '.jpg';
  function chips(list, removable) { const d = el('div');
    list.forEach((a, i) => { const c = el('span', 'rv-chip', (a.type === 'file' && a.web ? `<img alt="" src="${fileUrl(a.fid)}">` : '') + esc(a.type === 'area' ? '✏️ outlined area · ' + place(a.file) : a.type === 'pin' ? '📍 spot · ' + place(a.file)
        : a.type === 'file' ? '📎 ' + a.name + (a.bytes ? ' · ' + fsize(a.bytes) : '') : '🔗 ' + a.url));
      if (removable) { const x = el('button', '', '✕'); x.type = 'button'; x.title = 'Remove'; x.onclick = () => { attach.splice(i, 1); draw(); if (photoLayer.paint) photoLayer.paint(); }; c.append(x); } d.append(c); }); return d; }
  function saveChat() { keep.set('chat.' + me.id, msgs.slice(-80)); keep.set('session.' + me.id, sessionId); }
  const goTo = w => { if (!w) return; if (w.lesson) PATH.lesson(w.lesson); else if (w.file) PATH.photo(w.file); else if (w.slide) { const c = S.data.cases.find(x => x.key === w.case), s = c && c.slides.find(x => x.stain + '_' + x.slide === w.slide); if (s) PATH.photo(s.cover || s.photos[0]); } };
  async function send() { const ta = $('#rvTa'), words = ta.value.trim(); if (busy || (!words && !attach.length)) return;
    if (!S.chat) { live('The chat is not switched on for this page yet.', 'err'); return; }
    const a = attach; attach = []; ta.value = ''; busy = true; msgs.push({who: 'you', text: words, atts: a, at: Date.now()}); working = {steps: [], t0: Date.now()}; draw(); if (photoLayer.paint) photoLayer.paint();
    const w = PATH.where(), view = {mode: w.mode, learn: w.learn, file: cur ? cur.f : null, tmap: w.tmap, labels: w.labels, spots: w.spots};
    const tick = setInterval(() => { const e = $('#rvWork'); if (e && working) e.textContent = Math.round((Date.now() - working.t0) / 1000) + ' s'; }, 1000);
    let res = null;
    try { const r = await fetch(R.api + '/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({as: me.id, text: words, attach: a, view, sessionId})});
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); res = {error: j.error || 'The chat could not answer.'}; }
      else { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) { const {value, done} = await rd.read(); if (done) break; buf += dec.decode(value, {stream: true}); let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
            if (ev.type === 'step') { working.steps.push(ev.text); drawChat(); } else if (ev.type === 'reply') res = ev; } } }
    } catch (e) { res = {error: 'The connection to the chat was lost.'}; }
    clearInterval(tick); working = null; busy = false; res = res || {error: 'The chat stopped before it answered.'};
    if (res.sessionId) sessionId = res.sessionId;
    msgs.push({who: 'claude', text: res.text || '', made: res.made || [], failed: res.failed || [], error: res.error || null, at: Date.now()}); saveChat();
    if (res.state) take(res.state, !(res.made && res.made.length)); else draw(); }
  function drawChat() { const d = $('#rvMsgs'); if (!d) return; d.innerHTML = '';
    const hello = el('div', 'rv-msg claude', `<div class="by">Claude</div><p>Hello. I am Claude. I work from the notes of the Claude that built these slide pages with the family, so I know how every label, count and map here was made, and where they are weakest. Tell me what is wrong or missing and I will change it while you watch.</p>
      <ol><li>In the <b>Viewer</b>, use <b>✏️ Outline</b> or <b>📍 Point</b> on a photo so I know where, then pick what it is, or ask me about it.</li><li>Add a <b>file, picture or link</b> with the buttons under the message box.</li><li>Every change shows at once and goes into <b>History</b>, where anything can be undone and put back.</li></ol>`);
    d.append(hello);
    msgs.forEach(m => { const b = el('div', 'rv-msg ' + (m.who === 'you' ? 'you' : 'claude'), `<div class="by">${m.who === 'you' ? esc(me.name) : 'Claude'} · ${when(m.at)}</div>` + (m.who === 'you' ? '<p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>' : md(m.text)));
      if (m.atts && m.atts.length) b.append(chips(m.atts));
      if (m.error) b.append(el('div', 'rv-fail', esc(m.error)));
      (m.made || []).forEach(c => { const live = S && S.history.find(h => h.id === c.id), r = el('div', 'rv-made', `<b>#${c.id}</b> ${esc(c.sum)}` + (live && !live.on ? ' <span class="rv-tag">undone</span>' : ''));
        const acts = el('div', 'rv-row'); acts.style.marginTop = '4px'; if (live) acts.append(btn(live.on ? 'Undo this' : 'Put back', '', () => flip(c.id, !live.on))); acts.append(btn('Show it', '', () => { sel = c.id; goTo(c.where); }));
        r.append(acts); b.append(r); });
      (m.failed || []).forEach(f => b.append(el('div', 'rv-fail', '<b>Not changed:</b> ' + esc(f.why || ''))));
      d.append(b); });
    if (working) d.append(el('div', 'rv-msg claude', `<div class="by">Claude</div>Working… <span id="rvWork">0 s</span><div class="rv-steps">${working.steps.slice(-4).map(esc).join('<br>')}</div>`));
    d.scrollTop = d.scrollHeight;
    const at = $('#rvAtts'); at.innerHTML = ''; if (attach.length) at.append(chips(attach, true)); $('#rvSend').disabled = busy; }
  async function addFiles(list) { showTab('chat');
    for (const f of [...list].slice(0, 6)) { live('Adding ' + (f.name || 'a picture') + '…');
      try { const r = await fetch(R.api + '/upload?' + as + '&name=' + encodeURIComponent(f.name || 'pasted-picture.png'), {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: f}), j = await r.json().catch(() => ({}));
        if (!r.ok) { live(j.error || 'That file could not be added.', 'err'); continue; } attach.push(Object.assign({type: 'file'}, j)); live('Added ' + j.name); }
      catch (e) { live('That file could not be added.', 'err'); } }
    await load(true); }

  // ---- history and files ----
  function drawHistory() { const d = $('#rvHist'); d.innerHTML = ''; const H = S ? S.history : [];
    if (!H.length) d.append(el('div', 'rv-empty', 'No changes yet. Each one is listed here with who made it, when, and what it changed.<br>Undo, Redo and “Put back” never delete anything.'));
    H.slice().reverse().forEach(h => { const e = el('div', 'rv-ent' + (h.on ? '' : ' off') + (h.id === sel ? ' sel' : ''));
      e.innerHTML = `<div class="hd"><b style="color:var(--ink)">#${h.id}</b><span>${when(h.at)}</span><span>${h.via === 'chat' ? 'Claude, asked by ' : ''}${esc(h.name || '')}</span><span class="rv-tag">${esc(h.tag)}</span>${h.on ? '' : '<span class="rv-tag">undone' + (h.flipped && h.flipped.name ? ' by ' + esc(h.flipped.name) : '') + '</span>'}</div><div>${esc(h.sum || '')}</div>` +
        (h.words ? `<div class="w">“${esc(h.words.length > 220 ? h.words.slice(0, 217) + '…' : h.words)}”</div>` : '') + (h.info && h.info.before ? `<div class="w">Likely tumor on this photo: ${h.info.before[0]}% → ${h.info.after[0]}%</div>` : '') +
        (h.problem ? `<div class="rv-warn">Not showing right now: ${esc(h.problem)}</div>` : '');
      const r = el('div', 'acts'); r.append(btn(h.on ? '↩ Undo this' : '↪ Put back', h.on ? 'Switch this change off. It stays in the list.' : 'Switch this change on again', () => flip(h.id, !h.on)));
      if (h.on) r.append(btn(peek === h.id ? 'Showing before · back to now' : 'Before / after', 'Show the page as it is without this change', () => setPeek(peek === h.id ? null : h.id), peek === h.id ? 'on' : ''));
      r.append(btn('Show it', 'Go to the photo or the lesson this changed', () => { sel = h.id; goTo(h.where); draw(); })); e.append(r); d.append(e); });
    if (H.length) d.append(el('div', 'rv-empty', 'The family viewer does not show these changes. Showing them there is a later step, and it is the site owner’s to take.'));
    const s = d.querySelector('.rv-ent.sel'); if (s) s.scrollIntoView({block: 'nearest'}); }
  async function setPeek(id) {   // the page without one change: a second copy of the data, fetched from the server and thrown away afterwards
    if (id == null) { peek = null; shown = S.data; PATH.setBase(R.base); PATH.setData(S.data); if (lbOpen() && lbRedraw) lbRedraw(); draw(); return; }
    const p = await get('state?without=' + id); if (!p || !p.data) return; peek = id; shown = p.data; PATH.setBase(R.base.replace(/\/$/, '') + '~' + id + '/'); PATH.setData(p.data);
    if (lbOpen() && lbRedraw) lbRedraw(); const h = S.history.find(x => x.id === id); if (h) goTo(h.where); draw(); }
  function drawFiles() { const d = $('#rvFiles'); d.innerHTML = ''; const F = S ? S.files : [];
    if (!F.length) d.append(el('div', 'rv-empty', 'Files and pictures added in the chat are kept here.<br>Add one with 📎 under the message box, or paste or drop a picture there.'));
    F.slice().reverse().forEach(u => { const e = el('div', 'rv-ent'); const used = (S.history || []).filter(h => h.on && h.kind === 'example' && (h.sum || '').length && S.data && JSON.stringify(S.data).indexOf('review-files/' + u.fid + '.jpg') >= 0).length;
      e.innerHTML = `<div class="hd"><span>${when(u.at)}</span><span>${esc(u.who || '')}</span><span class="rv-tag">${esc({image: 'Picture', pdf: 'PDF', text: 'Text'}[u.kind] || 'File')}</span></div>` +
        (u.web ? `<img alt="" src="${fileUrl(u.fid)}" style="max-width:100%;max-height:150px;border-radius:5px;display:block;margin:4px 0">` : '') + `<div>${esc(u.name)} <span style="color:var(--muted)">${u.bytes ? fsize(u.bytes) : ''}${u.pages ? ' · ' + u.pages + ' pages' : ''}</span></div>` + (used ? '<div class="w">Used in a lesson as an example picture</div>' : '');
      const r = el('div', 'acts'); r.append(btn('Use in my next message', 'Attach it to the message box', () => { if (!attach.some(a => a.fid === u.fid)) attach.push(Object.assign({type: 'file'}, u)); showTab('chat'); $('#rvTa').focus(); })); e.append(r); d.append(e); }); }

  function draw() { if (!S) return;
    $('#rvHN').textContent = S.history.length; $('#rvFN').textContent = S.files.length; $('#rvUndo').disabled = !S.canUndo; $('#rvRedo').disabled = !S.canRedo;
    side.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tab)); ['chat', 'history', 'files'].forEach(t => { $('#rvP-' + t).hidden = t !== tab; });
    const pk = $('#rvPeek'); pk.innerHTML = ''; if (peek) { const b = el('div', 'rv-peek', `Showing the page <b>without</b> change #${peek}. `); b.append(btn('Back to now', '', () => setPeek(null))); pk.append(b); }
    drawNew(); drawChat(); drawHistory(); drawFiles(); }

  // ---- wiring ----
  side.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => showTab(b.dataset.t); });
  $('#rvUndo').onclick = () => act('undo', {}, 'Undone just now').then(r => { if (r.ok && r.j.made) { sel = r.j.made; const h = S.history.find(x => x.id === sel); if (h) goTo(h.where); draw(); } });
  $('#rvRedo').onclick = () => act('redo', {}, 'Put back just now').then(r => { if (r.ok && r.j.made) { sel = r.j.made; const h = S.history.find(x => x.id === sel); if (h) goTo(h.where); draw(); } });
  $('#rvSend').onclick = send;
  $('#rvTa').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#rvFileBtn').onclick = () => $('#rvFile').click(); $('#rvFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#rvLinkBtn').onclick = () => { const r = $('#rvLinkRow'); r.hidden = !r.hidden; if (!r.hidden) $('#rvLinkIn').focus(); };
  const addLink = () => { const i = $('#rvLinkIn'), v = i.value.trim(); if (!/^https?:\/\/\S+$/.test(v)) { i.style.borderColor = '#ef4444'; return; } i.style.borderColor = ''; attach.push({type: 'link', url: v}); i.value = ''; $('#rvLinkRow').hidden = true; draw(); $('#rvTa').focus(); };
  $('#rvLinkAdd').onclick = addLink; $('#rvLinkIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
  const comp = $('#rvComp');
  comp.addEventListener('paste', e => { if (e.clipboardData && e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
  comp.addEventListener('dragover', e => { e.preventDefault(); comp.classList.add('drop'); }); comp.addEventListener('dragleave', () => comp.classList.remove('drop'));
  comp.addEventListener('drop', e => { e.preventDefault(); comp.classList.remove('drop'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (draft || tool !== 'look') && !document.querySelector('.pth-lb')) { draft = null; drawNew(); setTool('look'); } });

  // ---- start, and keep in step with changes made elsewhere (another browser, the chat) ----
  PATH.setBase(R.base);
  load(true).then(() => { if (!PATH.el()) PATH.open(S.data.cases[0].key); const p = PATH.el(); if (p) p.classList.add('revTarget'); window.dispatchEvent(new Event('resize')); })
    .catch(() => live('The review could not be loaded.', 'err'));
  setInterval(() => { if (busy || peek || drawing || !S) return; get('version').then(v => { if (v && v.version !== S.version) load(); }).catch(() => {}); }, 5000);
  window.REVIEW_PAGE = {state: () => ({version: S && S.version, history: S && S.history.map(h => ({id: h.id, on: h.on, tag: h.tag, sum: h.sum, problem: h.problem})), tab, tool, peek, attach: attach.length, msgs: msgs.length, cur: cur && cur.f, busy}),
    setTool, send, load};
})();
