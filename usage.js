/* Usage events for the viewer's /stats page (added by serve_viewer.py when it serves labs.html).
   Sends only code names of what was used: "click:<button id>", "click:window-<data-p>",
   "show:<panel id>" when a hidden panel appears, plus page open/close, seconds the page was
   visible, and the window size. Never text, test names, values, or anything typed. */
(() => {
  const q = [];
  let shownAt = document.visibilityState === 'visible' ? Date.now() : 0, spent = 0;
  const ok = s => /^[A-Za-z0-9_:.\-+]{0,48}$/.test(s);
  const add = (ev, d = '', ms) => { if (ok(d)) q.push(ms == null ? { ev, d } : { ev, d, ms }); };
  const flush = (beacon) => {
    if (!q.length) return;
    const body = JSON.stringify({ events: q.splice(0, 60), w: innerWidth, h: innerHeight });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/usage', new Blob([body], { type: 'application/json' }));
    else fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  add('open', `screen-${screen.width}x${screen.height}${'ontouchstart' in window ? '-touch' : ''}`);

  // Clicks on controls that have a code name. Text and labels are never read.
  const ATTR = [['data-p', 'window-'], ['data-r', 'mri-'], ['data-mm', 'move-'], ['data-h', 'height']];
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('button,summary,[role=button],a[id]');
    if (!el) return;
    let d = el.id;
    if (!d) for (const [a, pre] of ATTR) if (el.hasAttribute(a)) { d = pre + el.getAttribute(a); break; }
    if (!d) { const host = el.closest('[id]'); if (host) d = 'in-' + host.id; }
    if (d) add('click', d.slice(0, 48));
  }, true);

  // A panel with an id that stops being hidden counts as that panel being opened.
  const wasHidden = new WeakSet();
  const hidden = el => el.classList.contains('hide') || el.hidden || el.style.display === 'none';
  new MutationObserver(ms => {
    for (const m of ms) {
      const el = m.target;
      if (!el.id || m.type !== 'attributes') continue;
      if (hidden(el)) wasHidden.add(el);
      else if (wasHidden.has(el)) { wasHidden.delete(el); add('show', el.id.slice(0, 48)); }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  document.querySelectorAll('[id]').forEach(el => { if (hidden(el)) wasHidden.add(el); });
  document.addEventListener('toggle', e => { const el = e.target; if (el.id && el.open) add('toggle', el.id.slice(0, 48)); }, true);

  // Time on page = time the tab was visible.
  const pause = () => { if (shownAt) { spent += Date.now() - shownAt; shownAt = 0; } };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { pause(); add('hidden', '', spent); spent = 0; flush(true); }
    else shownAt = Date.now();
  });
  addEventListener('pagehide', () => { pause(); add('close', '', spent); spent = 0; flush(true); });
  setInterval(() => flush(false), 20000);
})();
