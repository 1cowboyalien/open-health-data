// Fold-away top bar. On phones the pinned bar (mode buttons, time window, and any panel pinned to it)
// can fill the whole screen. Folded, it is one thin line: the time window and a "Controls" button.
// Starts folded on narrow screens; on a computer it starts open and "▴" in the first row folds it.
// The choice is kept per screen kind in localStorage "navfold.phone" / "navfold.wide" (not a labs.* key,
// so it is not part of the saved Start view).
(function () {
  const pin = document.querySelector('.navpin');
  if (!pin) return;
  const css = document.createElement('style');
  css.textContent =
    '.nfold{display:none;align-items:center;gap:8px;font-size:12px;min-height:28px}' +
    '.navpin.folded>.nfold{display:flex}.navpin.folded>:not(.nfold){display:none!important}' +
    '.navpin.folded{padding-top:4px;padding-bottom:4px}' +
    '.nfold .nfw{color:var(--ink2);font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.nfold .nff{color:var(--accent);font-size:11px;margin-left:4px;font-weight:400}' +
    '.nfold button{font-size:13px;padding:3px 10px}' +
    '#navFoldBtn{font-size:12px;padding:2px 7px}' +
    '@media (max-width:760px){#navFoldBtn{font-size:13px;padding:3px 10px}}';
  document.head.appendChild(css);

  const strip = document.createElement('div');
  strip.className = 'nfold';
  strip.innerHTML = '<span class="nfw" id="nfWin"></span><button id="nfOpen" title="Show the buttons and the time window">Controls ▾</button>';
  pin.insertBefore(strip, pin.firstChild);

  const row = pin.querySelector('.nrow');
  const foldBtn = document.createElement('button');
  foldBtn.id = 'navFoldBtn';
  foldBtn.textContent = '▴ Fold';
  foldBtn.title = 'Fold this bar to one line, to give the charts more room';
  if (row) row.appendChild(foldBtn);

  const narrow = window.matchMedia('(max-width:760px)');
  const key = () => 'navfold.' + (narrow.matches ? 'phone' : 'wide');
  const want = () => { const v = localStorage.getItem(key()); return v === null ? narrow.matches : v === '1'; };

  const fmt = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
    if (!m) return (s || '').trim();
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  function summary() {
    const a = document.getElementById('wal'), b = document.getElementById('wbl');
    const solo = document.getElementById('soloBar');
    const filt = solo && solo.textContent.trim() ? '<span class="nff">· filtered</span>' : '';
    document.getElementById('nfWin').innerHTML = (a && b ? fmt(a.textContent) + ' – ' + fmt(b.textContent) : 'Time window') + filt;
  }
  function set(folded, remember) {
    pin.classList.toggle('folded', folded);
    if (remember) localStorage.setItem(key(), folded ? '1' : '0');
    summary();
    window.dispatchEvent(new Event('resize'));  // charts below re-measure the space they have
  }
  document.getElementById('nfOpen').onclick = () => set(false, true);
  foldBtn.onclick = () => set(true, true);
  narrow.addEventListener('change', () => set(want(), false));

  const mo = new MutationObserver(() => { if (pin.classList.contains('folded')) summary(); });
  ['wal', 'wbl', 'soloBar'].forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true, characterData: true, subtree: true }); });
  set(want(), false);

  // Keyframes / Concern pinned to the top bar: once you scroll down into the charts it folds to its title line
  // (like its own ▾ button, but without changing the saved setting) and opens again back at the top of the page.
  // Clicking the title line while it is folded this way opens it; it folds again once you scroll on by 150 px.
  const kf = document.getElementById('kfCard');
  if (!kf) return;
  const css2 = document.createElement('style');
  css2.textContent =
    '.navpin .mcard.kfauto .mtrack,.navpin .mcard.kfauto .mstrack,.navpin .mcard.kfauto #msRow{display:none}' +
    '.navpin .mcard.kfauto .mhead{cursor:pointer}' +
    '.navpin .mcard.kfauto .mhead b::after{content:" ▸ scrolled: click to open";font-weight:400;font-size:11px;color:var(--muted)}';
  document.head.appendChild(css2);
  let keepOpen = false, openedAt = 0, auto = false;
  const pinned = () => !!kf.closest('.navpin');
  function apply(on) {
    if (on === auto) return;
    auto = on;
    kf.classList.toggle('kfauto', on);
    if (!on && !kf.classList.contains('kffold')) {
      if (typeof kfDraw === 'function') kfDraw(); else window.dispatchEvent(new Event('resize'));
    }
  }
  function onScroll() {
    const y = window.scrollY;
    if (y < 10 || (keepOpen && openedAt !== null && Math.abs(y - openedAt) > 150)) keepOpen = false;
    if (!pinned()) return apply(false);
    if (y > 120 && !keepOpen) apply(true);
    else if (y < 10 || keepOpen) apply(false);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  kf.querySelector('.mhead').addEventListener('click', e => {
    if (!auto || e.target.closest('button,input,select,a')) return;
    keepOpen = true; openedAt = null; apply(false);
    // the redraw nudges the page for a moment: measure from where it settles
    setTimeout(() => { openedAt = window.scrollY; }, 500);
  });
  onScroll();
})();
