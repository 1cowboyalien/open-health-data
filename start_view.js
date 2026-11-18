/* Start view: what a new visitor (a browser that has never opened the viewer) sees first.
   serve_viewer.py puts window.START_VIEW (from local/start_view.json) in the page and, before the viewer's
   own script runs, copies it into this browser's saved settings (localStorage "labs.*") when there are none yet.
   This file adds the "Start view" button next to Clear:
   - everyone: put this browser back to the start view (clears its saved view settings and reloads);
   - this Mac / home network only (START_VIEW_CAN_SAVE): make the current view the start view for new visitors.
   Saved: window, selected tests, open panels and their heights, toggles, time zone. Never: medication edits
   (those are shared separately), the Ask name, anything typed. */
(() => {
  const SKIP = new Set(['txedits', 'txdirty', 'open']);
  const mine = () => Object.keys(localStorage).filter(k => k.startsWith('labs.') && !SKIP.has(k.slice(5)));
  const snapshot = () => {
    const keys = {};
    for (const k of mine()) { try { keys[k.slice(5)] = JSON.parse(localStorage.getItem(k)); } catch (e) { /* skip unreadable */ } }
    return keys;
  };
  const when = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

  const clr = document.getElementById('clr');
  if (!clr) return;
  const btn = document.createElement('button');
  btn.id = 'startView'; btn.textContent = 'Start view';
  btn.title = 'The view new visitors land on: put this browser back to it' + (window.START_VIEW_CAN_SAVE ? ', or make your current view the start view' : '');
  clr.after(btn);

  const box = document.createElement('div');
  box.id = 'startViewBox';
  box.style.cssText = 'position:fixed;z-index:9999;max-width:360px;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.4;'
    + 'background:var(--panel,#1d2330);color:var(--fg,#e8ecf3);border:1px solid var(--line,#3a4356);box-shadow:0 8px 28px rgba(0,0,0,.45);display:none';
  document.body.appendChild(box);
  const close = () => { box.style.display = 'none'; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', e => { if (box.style.display !== 'none' && !box.contains(e.target) && e.target !== btn) close(); });

  const row = (id, label, fn) => { const b = document.createElement('button'); b.id = id; b.textContent = label; b.style.cssText = 'display:block;width:100%;margin-top:8px;text-align:left'; b.onclick = fn; return b; };
  const msg = t => { const p = document.createElement('div'); p.textContent = t; p.style.marginTop = '4px'; return p; };

  function open() {
    const S = window.START_VIEW;
    box.replaceChildren(msg(S && S.saved
      ? 'New visitors land on the start view saved ' + when(S.saved) + '.'
      : 'No start view is saved yet: new visitors get the built-in layout.'));
    box.append(row('startViewReset', '⟲ Put this browser back to the start view', () => {
      // The marker tells the loader in serve_viewer.py to clear this browser's view settings (also any the page
      // writes while closing) and copy the start view in, as for a new visitor.
      localStorage.setItem('startview.reset', '1');
      location.reload();
    }));
    if (window.START_VIEW_CAN_SAVE) {
      const n = Object.keys(snapshot()).length;
      box.append(row('startViewSave', '★ Make my current view the start view', async () => {
        box.replaceChildren(msg('Saving…'));
        try {
          const r = await fetch('/api/start-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: snapshot() }) });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || r.status);
          window.START_VIEW = j;
          box.replaceChildren(msg('Saved. New visitors (and anyone who uses “Put this browser back”) now land on this view: ' + n + ' settings.'));
        } catch (e) { box.replaceChildren(msg('NOT saved: ' + e.message)); }
      }));
      box.append(msg('Saves this browser’s window, selected tests, open panels, heights, toggles and time zone. Visitors who have been here before keep their own view until they use the button above.'));
    }
    const r = btn.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - 376)) + 'px';
    box.style.top = (r.bottom + 6) + 'px';
    box.style.display = 'block';
  }
  btn.addEventListener('click', e => { e.stopPropagation(); box.style.display === 'none' ? open() : close(); });
})();
