/* Treatment decisions section in the Library of the lab viewer (labs.html). Used by make_lab_view.py when local/decisions/decisions.json exists.
   Everything about the patient (steps, options, doctors, quotes, sources, wording) comes from DEC_DATA, never from this code.
   Panel dec:tree = a top-down decision tree: one row per step on the path taken; options that were raised but not taken sit
   beside the step and end there; open options are dashed. Click a box for its summary, quote, who and sources.
   Switches: show who (a line on every box), show supportive-care boxes (kind 'supp'), open all.
   Data: DEC_DATA = {title, unit, intro, kinds:{taken,chose,closed,open,supp: legend text}, gap_text, footnote, keywords,
     steps:[{date,t,s,who,sum,q?,gap?,k?:'open',src:[{label,path,line}],
             br:[{k:'chose'|'closed'|'open'|'supp',date,t,s,who,sum,q?,gap?,src:[...]}]}]}, made outside this repo (it holds health data). */
(() => {
  const D = DEC_DATA, ID = 'dec:tree';
  const PANEL = {title: D.title, unit: D.unit, h0: 640};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const V = Object.assign({who: false, supp: false, open: []}, store.get('dec.view', {}));
  const save = () => store.set('dec.view', V);
  let BODY = null, RO = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(ID, BODY); };

  if (!document.getElementById('decCss')) { const st = document.createElement('style'); st.id = 'decCss';
    st.textContent =
      '.dec-bar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;margin-bottom:6px}.dec-bar label{display:flex;gap:5px;align-items:center;cursor:pointer}' +
      '.dec-b{font-size:11px;padding:1px 9px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}' +
      '.dec-intro{font-size:12.5px;color:var(--ink2);margin:0 0 6px;line-height:1.45}' +
      '.dec-leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:var(--ink2);margin:0 0 12px}.dec-leg span{display:flex;align-items:center;gap:5px}.dec-leg i{width:12px;height:12px;border-radius:3px;border:1px solid}' +
      '.dec-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 36px;position:relative;padding-bottom:20px}' +
      '.dec-row:not(:last-child)::before{content:"";position:absolute;left:25%;top:26px;bottom:0;border-left:2px solid #1D9E75;opacity:.55}' +
      '.dec-main{position:relative;z-index:1}.dec-brs{display:flex;flex-direction:column;gap:8px}' +
      '.dec-brs .dec-c{position:relative}.dec-brs .dec-c::before{content:"";position:absolute;left:-36px;top:24px;width:34px;border-top:2px dashed var(--line)}' +
      '.dec-brs .dec-c.end::after{content:"";position:absolute;right:-9px;top:14px;height:20px;border-left:3px solid var(--line)}' +
      '.dec-c{border:1px solid;border-radius:9px;padding:8px 12px;cursor:pointer;background:var(--card);color:var(--ink);font-size:12.5px;line-height:1.4}' +
      '.dec-c:focus-visible{outline:2px solid #1D9E75;outline-offset:2px}' +
      '.dec-c .dd{font-size:11px;color:var(--muted)}.dec-c .dt{font-weight:600;font-size:13.5px}.dec-c .ds{font-size:12px;color:var(--ink2)}.dec-c .dw{font-size:11px;color:var(--muted);margin-top:2px}' +
      '.dec-taken{border-color:#1D9E75;background:linear-gradient(rgba(29,158,117,.16),rgba(29,158,117,.16)),var(--card)}.dec-chose{border-color:#D85A30;background:linear-gradient(rgba(216,90,48,.16),rgba(216,90,48,.16)),var(--card)}' +
      '.dec-closed{border-color:#888780;background:linear-gradient(rgba(136,135,128,.16),rgba(136,135,128,.16)),var(--card)}.dec-open{border:1.5px dashed var(--ink2)}.dec-supp{border-color:#7F77DD;background:linear-gradient(rgba(127,119,221,.18),rgba(127,119,221,.18)),var(--card)}' +
      '.dec-x{display:none;margin-top:7px;padding-top:7px;border-top:1px solid var(--line);font-size:12.5px;cursor:auto}.dec-c.on .dec-x{display:block}' +
      '.dec-x blockquote{margin:6px 0;padding:4px 9px;border-left:3px solid var(--line);font-style:italic;color:var(--ink2)}' +
      '.dec-x .src{font-size:11px;color:var(--muted);margin-top:5px}.dec-x code{font-size:10.5px}.dec-x .gap{font-size:12px;margin-top:5px;padding:4px 7px;border-radius:5px;background:rgba(136,135,128,.15)}' +
      '.dec-foot{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45;border-top:1px solid var(--line);padding-top:8px}' +
      '.dec-narrow .dec-row{grid-template-columns:1fr;gap:8px}.dec-narrow .dec-row:not(:last-child)::before{left:16px}' +
      '.dec-narrow .dec-brs{padding-left:30px}.dec-narrow .dec-brs .dec-c::before{left:-14px;width:12px}';
    document.head.append(st); }

  const key = (i, j) => i + (j == null ? '' : '.' + j);
  function card(o, kind, k, isBranch) {
    const on = V.open.includes(k);
    const src = (o.src || []).map(s => '<div>' + esc(s.label) + ': <code>' + esc(s.path) + '</code>' + (s.line ? ' · line ' + s.line : '') + '</div>').join('');
    return '<div class="dec-c dec-' + kind + (isBranch && kind !== 'open' && kind !== 'supp' ? ' end' : '') + (on ? ' on' : '') + '" tabindex="0" role="button" aria-expanded="' + on + '" data-k="' + k + '">' +
      '<div class="dd">' + esc(o.date) + '</div><div class="dt">' + esc(o.t) + '</div><div class="ds">' + esc(o.s) + '</div>' +
      (V.who && o.who ? '<div class="dw">' + esc(o.who) + '</div>' : '') +
      '<div class="dec-x"><div>' + esc(o.sum) + '</div>' + (o.q ? '<blockquote>"' + esc(o.q) + '"</blockquote>' : '') +
      (o.gap ? '<div class="gap">' + esc(D.gap_text || '') + '</div>' : '') +
      '<div class="src">' + (o.who ? 'Who: ' + esc(o.who) + '<br>' : '') + src + '</div></div></div>';
  }

  function draw(id, body) {
    BODY = body;
    const K = D.kinds || {};
    let h = '<div class="dec-intro">' + esc(D.intro || '') + '</div>' +
      '<div class="dec-bar"><label><input type="checkbox" data-o="who"' + (V.who ? ' checked' : '') + '> Show who recommended it</label>' +
      (D.steps.some(s => s.br.some(b => b.k === 'supp')) ? '<label><input type="checkbox" data-o="supp"' + (V.supp ? ' checked' : '') + '> ' + esc(K.supp || 'Supportive care') + '</label>' : '') +
      '<button class="dec-b" data-all>' + (V.open.length ? 'Close all' : 'Open all') + '</button></div>' +
      '<div class="dec-leg">' + ['taken', 'chose', 'closed', 'open'].concat(V.supp ? ['supp'] : []).filter(k => K[k]).map(k => '<span><i class="dec-' + k + '"></i>' + esc(K[k]) + '</span>').join('') + '</div>';
    D.steps.forEach((r, i) => {
      const brs = r.br.map((b, j) => ({b, j})).filter(x => V.supp || x.b.k !== 'supp');
      h += '<div class="dec-row"><div class="dec-main">' + card(r, r.k === 'open' ? 'open' : 'taken', key(i), false) + '</div>' +
        '<div class="dec-brs">' + brs.map(x => card(x.b, x.b.k, key(i, x.j), true)).join('') + '</div></div>';
    });
    h += '<div class="dec-foot">' + esc(D.footnote || '') + '</div>';
    body.innerHTML = '<div class="dec-wrap">' + h + '</div>';
    const wrap = body.firstChild;
    const fit = () => wrap.classList.toggle('dec-narrow', wrap.clientWidth < 600);
    fit(); if (RO) RO.disconnect(); if (window.ResizeObserver) { RO = new ResizeObserver(fit); RO.observe(wrap); }
    body.querySelectorAll('[data-o]').forEach(cb => cb.onchange = () => { V[cb.dataset.o] = cb.checked; save(); redraw(); });
    body.querySelector('[data-all]').onclick = () => {
      V.open = V.open.length ? [] : Array.from(body.querySelectorAll('.dec-c')).map(c => c.dataset.k); save(); redraw(); };
    body.querySelectorAll('.dec-c').forEach(c => {
      const tog = e => { if (e.target.closest('.dec-x')) return; const k = c.dataset.k;
        V.open = V.open.includes(k) ? V.open.filter(x => x !== k) : V.open.concat(k); save();
        c.classList.toggle('on'); c.setAttribute('aria-expanded', c.classList.contains('on'));
        const b = body.querySelector('[data-all]'); if (b) b.textContent = V.open.length ? 'Close all' : 'Open all'; };
      c.onclick = tog; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(e); } };
    });
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

  /* Library: Treatment decisions -> the panel */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = ((D.keywords || '') + ' ' + D.title + ' ' + D.steps.map(s => s.t + ' ' + s.br.map(b => b.t).join(' ')).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return;
    const nb = D.steps.reduce((n, s) => n + s.br.filter(b => b.k !== 'supp').length, 0);
    const SEC = section(el, 'dec', D.title, D.steps.length + ' steps', false, 'sec', q), s0 = SEC.firstChild;
    s0.insertBefore(groupOnlyBtn(D.title + ' panel', 'grp:dec', [ID], soloLab && soloLab.key === 'grp:dec', false, () => onlyLab('grp:dec', [ID], D.title)), s0.lastChild);
    const d = document.createElement('div'); d.className = 't';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(ID); cb.setAttribute('aria-label', 'Show ' + D.title);
    cb.onclick = e => { e.stopPropagation(); setLabSel([ID], cb.checked); };
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = 'Decision tree'; nm.title = D.intro || '';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = nb + ' options';
    d.append(cb, nm, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([ID], cb.checked); };
    SEC.append(d);
  };

  const saved = store.get('selected', []);
  if (saved.includes(ID) && !sel.includes(ID)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
