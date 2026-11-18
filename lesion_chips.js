/* One look and one behaviour for the lesion buttons of every imaging panel: Lesions over time (all five views),
   Perfusion by lesion, Swelling by lesion. Loaded before those panels by make_lab_view.py. No patient data here.

   LesionChips.row({ids, color(id), name(id), hidden: [ids], onChange(hiddenIds), badge(id) -> {text, dir, weak, tip} | null,
                    label, noneTip, extra: [elements], badgeNote}) -> a row element: label, one pill per lesion, All, None, extras
     click = hide / show · double-click = show only this one · All / None
     hidden may hold ids this panel does not list (a selection shared with another view): they are passed through untouched
   The badge is the panel's "latest reading" for that lesion in the current view, always in the same form:
     dir 'up'   -> red   ↑ text   (growing / more than the reference)
     dir 'down' -> green ↓ text   (shrinking / less than the reference)
     dir 'flat' -> grey    text   (no clear change: inside what the measurement can tell)
     weak       -> ⚠ after the text (read loosely; the tip says why)
     stale      -> the badge is faded: the reading is older than the panel's latest scan (the tip says from when)
   LesionChips.btn(text, on, fn, tip) = the pill toggle the toolbars use; LesionChips.mark(dir, text, weak) = the same badge as
   HTML for tables and notes; LesionChips.COL = the three colours. */
(() => {
  const COL = {up: '#e34948', down: '#1baf7a', flat: 'var(--muted)'}, ARROW = {up: '↑', down: '↓'};
  if (!document.getElementById('lchipCss')) { const st = document.createElement('style'); st.id = 'lchipCss';
    st.textContent = '.lc-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:12px;margin:0 0 6px}' +
      '.lc-row .lc-lab{color:var(--muted);font-size:11px;margin-right:1px}.lc-row .lc-note{color:var(--muted);font-size:10.5px;margin-left:6px}' +
      '.lc-chip{font:600 11px system-ui;line-height:16px;padding:0 7px;border-radius:9px;border:2px solid;background:transparent;cursor:pointer;white-space:nowrap}' +
      '.lc-chip.off{opacity:.35;border-style:dashed}.lc-chip small{font-weight:600;margin-left:5px;font-size:10px}' +
      '.lc-up{color:' + COL.up + '}.lc-down{color:' + COL.down + '}.lc-flat{color:' + COL.flat + '}' +
      '.lc-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.lc-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}';
    document.head.append(st); }
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const badgeText = b => (ARROW[b.dir] ? ARROW[b.dir] + ' ' : '') + b.text + (b.weak ? ' ⚠' : '');
  const cls = d => 'lc-' + (COL[d] ? d : 'flat');
  const mark = (dir, text, weak) => `<span class="${cls(dir)}">${esc(badgeText({dir, text, weak}))}</span>`;
  const btn = (txt, on, fn, tip) => { const b = el('button', 'lc-b' + (on ? ' on' : ''), txt); b.type = 'button'; if (tip) b.title = tip; b.onclick = fn; return b; };

  function row(o) {
    const r = el('div', 'lc-row'); r.setAttribute('role', 'group'); r.setAttribute('aria-label', 'Lesions shown');
    r.append(el('span', 'lc-lab', o.label || 'Lesions'));
    const hidden = new Set(o.hidden || []), others = [...hidden].filter(x => !o.ids.includes(x));
    o.ids.forEach(id => { const off = hidden.has(id), c = el('button', 'lc-chip' + (off ? ' off' : ''), id); c.type = 'button';
      c.style.borderColor = c.style.color = o.color(id); c.setAttribute('aria-pressed', String(!off));
      const b = o.badge ? o.badge(id) : null;
      if (b && b.text) { const sm = el('small', cls(b.dir), badgeText(b)); if (b.stale) sm.style.opacity = '.5'; c.append(sm); }
      c.title = [o.name ? o.name(id) : '', b && b.tip ? b.tip : '', off ? '(hidden: click to show)' : '(click to hide · double-click: show only this one)'].filter(Boolean).join('\n');
      c.onclick = () => o.onChange(off ? [...hidden].filter(x => x !== id) : [...hidden, id]);
      c.ondblclick = () => o.onChange(o.ids.filter(x => x !== id).concat(others));
      r.append(c); });
    r.append(btn('All', false, () => o.onChange(others), 'Show every lesion'),
             btn('None', false, () => o.onChange(o.ids.concat(others)), o.noneTip || 'Hide every lesion'));
    (o.extra || []).forEach(e => r.append(e));
    if (o.badgeNote) r.append(el('span', 'lc-note', o.badgeNote));
    return r;
  }
  window.LesionChips = {row, btn, mark, COL};
})();
