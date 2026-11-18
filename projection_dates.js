/* One Projection switch and one set of projected scan dates for the imaging panels. Loaded by make_lab_view.py after
   lesion_chips.js and before the panels. Everything about the patient comes from IMG_DATA, never from this code.
   Why: each panel had its own Projection button and only the projection box named the dates (+1, +2, +3 months after the latest
   scan), so the charts did not say which dates their hollow points stood for and the panels could disagree about what was showing.
   - The switch (remembered in this browser as img.projOn): on in one panel = on in every panel that has a projection (Lesions
     over time, Swelling by lesion). Switching it on lengthens the shared time axis when it stops before the last projected date
     (navigation bar: Future), so the projection is always drawn on the timeline itself.
   - The dates: IMG_DATA.growth.projection and IMG_DATA.swelling.projection, each {base, months [{m, date}]} (the same dates when
     both start from the same scan). While the switch is on and a panel that has the switch is on the page, every chart on the
     shared time axis draws an amber dashed line at each date with "+1 mo" over the date on top (axisMarks in make_lab_view.py),
     so a projected date sits at the same place in every panel. Close those panels and the lines go too: no marks without a
     visible switch.
   window.Projection = {has, on, active(), base, months [{m, date, t}], first, last, datesText(), set(on), button(tip), where(),
                        reaches(), reach(), onChange(fn), sync()} */
(() => {
  const AMBER = '#e0a020', AMBER_ON_LIGHT = '#b0700a';   // the projection colour of every imaging panel; darker for words on a white page
  const srcs = [IMG_DATA.growth && IMG_DATA.growth.projection, IMG_DATA.swelling && IMG_DATA.swelling.projection].filter(p => p && p.months && p.months.length);
  const byDate = new Map();
  srcs.forEach(p => p.months.forEach(m => { if (!byDate.has(m.date)) byDate.set(m.date, {m: m.m, date: m.date, t: ms(m.date)}); }));
  const months = [...byDate.values()].sort((a, b) => a.t - b.t), has = months.length > 0;
  const base = has ? srcs.map(p => p.base).sort().pop() : null, first = has ? months[0].t : null, last = has ? months[months.length - 1].t : null;
  const short = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  const long = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const datesText = () => months.map(m => '+' + m.m + ' mo ' + short(m.date)).join(' · ');

  /* the switch: one value for every panel. Before 2026-11-18 Lesions over time and Swelling each kept their own (img.trends.proj,
     img.swellChart2.proj): on in either one carries over as on */
  let on = store.get('img.projOn', null);
  if (on == null) { on = !!((store.get('img.trends', {}) || {}).proj || (store.get('img.swellChart2', {}) || {}).proj); if (on) store.set('img.projOn', true); }
  on = !!on && has;
  const SW = document.getElementsByClassName('proj-switch');   // live list of the switch buttons on the page
  const active = () => on && SW.length > 0;
  const reaches = () => X1 >= last;                             // the time axis runs to the last projected date
  const reach = () => { if (typeof setFuture === 'function') setFuture(Math.max(FUT, futFor(last)), true); };
  const subs = new Set(), onChange = fn => subs.add(fn);

  /* the date lines: given to the page as a function, because they depend on what is on the page (active()). A panel with the
     switch can come or go after other charts were drawn: sync() has the page repaint the charts whose lines are out of date
     (axisMarksCheck, also run by the page after every redraw) */
  const MQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : {matches: true};
  const MARKS = months.map(m => ({t: m.t, label: '+' + m.m + ' mo', sub: short(m.date), short: '+' + m.m, col: AMBER, ink: AMBER}));
  if (has) axisMarks('projection', () => { if (!active()) return [];
    const ink = MQ.matches ? AMBER : AMBER_ON_LIGHT; if (MARKS[0].ink !== ink) MARKS.forEach(k => { k.ink = ink; }); return MARKS; });
  const sync = () => axisMarksCheck();

  function set(v) { v = !!v && has; if (v === on) return; on = v; store.set('img.projOn', on);
    if (on && !reaches() && typeof setFuture === 'function') setFuture(Math.max(FUT, futFor(last)));   // redraws every panel on the time axis
    else subs.forEach(fn => fn());
    sync(); }

  if (!document.getElementById('projCss')) { const st = document.createElement('style'); st.id = 'projCss';
    st.textContent = '.lc-b.proj-switch.on{background:' + AMBER + ';border-color:' + AMBER + ';color:#141413}'; document.head.append(st); }
  /* the switch as a button: the same pill, wording and behaviour in every panel; `tip` says what that panel's projection is */
  function button(tip) {
    const b = LesionChips.btn('Projection', on, () => set(!on), (tip ? tip + '\n' : '') + 'One switch for every panel: it also marks the projected scan dates (' + datesText() + ') on the whole timeline' +
      (on || reaches() ? '.' : ' and lengthens the timeline to reach them (navigation bar: Future).'));
    b.classList.add('proj-switch'); b.setAttribute('aria-pressed', String(on)); sync(); return b; }
  /* where the projection is drawn, for a panel's projection box: on the chart at the amber date lines, or how to get it there */
  function where() {
    const d = document.createElement('div'); d.className = 'lc-row'; d.style.margin = '0 0 4px';
    const s = document.createElement('span'); s.className = 'sub'; d.append(s);
    if (!reaches()) { s.textContent = 'The timeline stops before the last projected date (' + long(months[months.length - 1].date) + '), so only the start of the dashed lines fits.';
      d.append(LesionChips.btn('Show the dates on the timeline', false, reach, 'Lengthens the time axis of every panel so it reaches the last projected date (the same as Future in the navigation bar)')); }
    else if (W.b < last) { s.textContent = 'The time window ends before the last projected date (' + long(months[months.length - 1].date) + ').';
      d.append(LesionChips.btn('Show the dates', false, reach, 'Moves the end of the time window to the end of the timeline')); }
    else s.textContent = 'Drawn on the chart above: dashed lines with hollow points on the amber date lines (' + datesText() + '). The same lines mark those dates in every panel.';
    return d; }

  window.Projection = {has, get on() { return on; }, active, base, months, first, last, datesText, set, button, where, reaches, reach, onChange, sync};
})();
