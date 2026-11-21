// Phone fit: on narrow screens (760 px and under) the records page is scaled down so the data gets the room, not the controls.
// Only phones change; on a computer nothing here applies. Built into the page by make_lab_view.py, after navfold.js.
// - narrower page and panel margins, so every chart is wider;
// - in panel title bars, "💬 Ask questions" becomes "💬", and the move (⤒ ↑ ↓ ⤓) and height (− +) buttons hide behind one "⋯";
// - smaller buttons, selects and tables;
// - long notes and colour keys under a chart fold to two lines; tap them (or "more") to open, tap again to fold;
// - long tables show their first rows (about 260 px) with "show all N rows";
// - rows of lesion chips scroll sideways in one line instead of wrapping into many.
// Panels redraw themselves often, so a MutationObserver re-applies the title-bar and fold changes after each redraw.
(function () {
  const narrow = window.matchMedia('(max-width:760px)');
  const css = document.createElement('style');
  css.textContent = `@media (max-width:760px){
main{padding:6px!important}
.navpin{margin-left:-6px!important;margin-right:-6px!important;margin-top:-6px!important}
#txStatus{display:none!important}
.cmp,#txCard,#kfCard,#single,#mrd,section.det{padding-left:6px!important;padding-right:6px!important}
.cmp button,.cmp select,#txCard button,#txCard select,#single button,#single select,#mrd button,#mrd select{font-size:11px!important;padding:1px 7px!important;line-height:17px!important;min-height:0!important}
.cmp input[type=text],.cmp input[type=date],#txCard input[type=text]{font-size:12px!important}
.cmp table,#single table,#mrd table{font-size:10.5px!important}.cmp td,.cmp th,#single td,#single th,#mrd td,#mrd th{padding:2px 4px!important}
.cmph .u,.txh>.sub,.cmph>.sub{font-size:10.5px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}
.askPanelBtn.phIcon{font-size:13px!important;padding:0 6px!important}
.phMoreBtn{font-size:12px!important;padding:0 8px!important}
:is(.ctl,.pbar,.kfbar)>button:is([aria-label=Shorter],[aria-label=Taller]),:is(.ctl,.pbar,.kfbar)>.pmove,:is(.ctl,.pbar,.kfbar)>button.pmv{display:none!important}
.phOpen :is(.ctl,.pbar,.kfbar)>button:is([aria-label=Shorter],[aria-label=Taller]),.phOpen :is(.ctl,.pbar,.kfbar)>.pmove,.phOpen :is(.ctl,.pbar,.kfbar)>button.pmv{display:inline-flex!important}
.pall{flex-wrap:wrap}.pall button{white-space:nowrap!important;padding:1px 7px!important;font-size:11.5px!important}
.wnav{flex-wrap:wrap!important;row-gap:4px}.wnav #wp{flex:1 1 90px;min-width:90px;width:auto!important}
#kfCard .kfright,#kfCard .kfbar{flex-wrap:wrap!important;max-width:100%}
.lc-row{flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.lc-row::-webkit-scrollbar{display:none}.lc-row>*{flex:none}
.phFold{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;position:relative;cursor:pointer}
.phFold.legend,.phFold.txlegend{display:block!important;max-height:2.9em}
.phFoldTag{display:inline-block;font-size:10.5px;color:var(--accent);margin:1px 0 4px;cursor:pointer;user-select:none}
}`;
  document.head.appendChild(css);

  const MOVE = /^[⤒⤓↑↓]$/;
  function header(h) {   // one panel title bar
    if (!narrow.matches || !h) return;
    const ask = h.querySelector(':scope > .askPanelBtn, .hlift > .askPanelBtn');
    if (ask && !ask.classList.contains('phIcon')) { ask.title = ask.title || ask.textContent.trim(); ask.textContent = '💬'; ask.classList.add('phIcon'); }
    const bars = [...h.querySelectorAll('.ctl, .pbar, .kfbar')];
    const bar = bars.find(x => x.querySelector('.pmove, [aria-label=Shorter]') || [...x.children].some(b => MOVE.test(b.textContent.trim()))) || bars[0];
    if (!bar || h.querySelector('.phMoreBtn')) return;
    let n = 0;
    [...bar.children].forEach(b => { if (b.tagName === 'BUTTON' && MOVE.test(b.textContent.trim())) { b.classList.add('pmv'); n++; } });
    if (!n && !bar.querySelector('[aria-label=Shorter],[aria-label=Taller],.pmove')) return;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'phMoreBtn'; more.textContent = '⋯';
    more.title = 'Move this panel up or down, or make it shorter or taller';
    more.onclick = e => { e.stopPropagation(); h.classList.toggle('phOpen'); more.textContent = h.classList.contains('phOpen') ? '✕⋯' : '⋯'; };
    bar.insertBefore(more, bar.firstChild);
  }
  const FOLD_MIN = 64;   // px: notes and keys taller than about three lines fold
  function fold(el) {
    if (!narrow.matches || el.dataset.phf || !el.offsetParent) return;
    if (el.querySelector('input,select,textarea,canvas,table') || el.closest('.cmph,.txh,.phFoldOK')) return;
    if (el.offsetHeight < FOLD_MIN) return;
    el.dataset.phf = '1'; el.classList.add('phFold');
    const tag = document.createElement('span'); tag.className = 'phFoldTag';
    const isKey = el.classList.contains('legend') || /legend|key/i.test(el.className) || el.querySelector('i,svg,.sw');
    const set = open => { el.classList.toggle('phFold', !open); tag.textContent = open ? '▴ less' : (isKey ? '▾ show the key' : '▾ more'); };
    set(false);
    const flip = e => { if (e.target.closest('a,button')) return; set(el.classList.contains('phFold')); };
    el.addEventListener('click', flip); tag.addEventListener('click', flip);
    el.after(tag);
  }
  const TABLE_MAX = 260;   // px: a longer table shows its first rows; "show all" opens it
  function tableFold(t) {
    if (!narrow.matches || t.dataset.phf || !t.offsetParent || t.offsetHeight <= TABLE_MAX + 60) return;
    const box = t.parentElement; if (!box || box.dataset.phf || box.closest('.cmph,.txh')) return;
    t.dataset.phf = box.dataset.phf = '1';
    const rows = t.tBodies[0] ? t.tBodies[0].rows.length : t.rows.length;
    const tag = document.createElement('span'); tag.className = 'phFoldTag';
    const set = open => { box.style.maxHeight = open ? '' : TABLE_MAX + 'px'; box.style.overflow = open ? '' : 'hidden';
      box.style.webkitMaskImage = box.style.maskImage = open ? '' : 'linear-gradient(#000 75%, transparent)'; tag.textContent = open ? '▴ fewer rows' : '▾ show all ' + rows + ' rows'; };
    set(false); tag.onclick = () => set(box.style.maxHeight !== ''); box.after(tag);
  }
  function apply(root) {
    if (!narrow.matches) return;
    (root || document).querySelectorAll('.cmph, .txh, #kfCard > .mhead, #single > .dethead, #mrd > .dethead').forEach(header);
    (root || document).querySelectorAll('.cmp .sub, #txCard .sub, #txLegend, .cmp .legend, #single .sub, #mrd .sub').forEach(fold);
    (root || document).querySelectorAll('.cmp table, #single table, #mrd table').forEach(tableFold);
  }
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; apply(); }); };
  new MutationObserver(later).observe(document.body, {childList: true, subtree: true});
  narrow.addEventListener('change', later);
  window.addEventListener('load', later); later();
})();
