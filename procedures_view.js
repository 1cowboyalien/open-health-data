/* Procedures in the Library of the lab viewer (labs.html): a timeline of procedures, hospital stays, visits and radiation,
   and the same procedures as a table. Used by make_lab_view.py when local/procedures/procedures.json exists.
   Everything about the patient (procedures, hospitals, dates, results, sources) comes from PROC_DATA, never from this code.
   It plugs into the same hooks the MRD and imaging panels use (MRD.isId/title/unit/h0/panel/refresh/section),
   so the panels get the viewer's ⤒ ↑ ↓ ⤓ − + × controls, the shared time axis, hover line and moment lines.
   Panels:  proc:timeline = one lane per kind (lanes, colours and shapes come from the data) on the shared time axis;
                            × ↑ ↓ left of each lane name hide or move it (a view setting, like the Treatment panel's rows),
                            the lane's total next to its name, and a summary row of every point still in the selection
            proc:list     = the procedures as a table
   Visual grammar (legend in the panel):
     one marker            = one-and-done procedure
     thick bar             = a device in the body (port, line): placement → removal; arrow = still in; fade = end unknown
     marker + short block  = surgery with a hospital stay; dotted tail = follow-on treatment
     hollow marker + link  = the same operation counts in a second lane too
     dashed hollow, right  = planned, date not set
     bars in the stay lane = hospital stays and ER visits; small squares = outpatient visits (colour = visit type)
     radiation lanes       = one mark per fraction (paler = day estimated), pale block = the course
   Library ticks put a procedure, stay or radiation course on EVERY chart as a moment line (group "Procedures");
   these moments are generated and never saved to the edits file.
   Data: PROC_DATA = {lanes, sites, events, devices, followon, planned, radiation, rt_courses, stays, visits, visit_types, stay_kinds},
   made outside this repo (it holds health data). */
(() => {
  const P = PROC_DATA;
  const IDT = 'proc:timeline', IDL = 'proc:list';
  const PANELS = {[IDT]: {title: 'Procedures · over time', unit: P.events.length + ' procedures', h0: 300},
                  [IDL]: {title: 'Procedures · list', unit: 'with results and sources', h0: 320}};
  const LANES = P.lanes, LK = LANES.map(l => l.key);
  const LCOL = Object.fromEntries(LANES.map(l => [l.key, l.color || '#888']));
  const LMOM = Object.fromEntries(LANES.map(l => [l.key, l.moment || 'grey']));   // viewer moment colour names (red/orange/purple/green/grey)
  const SPAL = ['#2a7fd4', '#d4572a', '#2aa876', '#a83fd0', '#d4a72a', '#d42a8a', '#4a5568'];
  const SCOL = Object.fromEntries(P.sites.map((s, i) => [s.key, SPAL[i % SPAL.length]]));
  const SNAME = Object.fromEntries(P.sites.map(s => [s.key, s.short]));
  const BYEV = Object.fromEntries(P.events.map(e => [e.id, e]));
  const S = Object.assign({color: 'type', rt: true, labels: true}, store.get('proc.opts', {}));
  let picked = null;                       // id shown in the detail card
  let ticked = new Set(store.get('proc.moments', P.events.filter(e => e.key).map(e => e.id)));
  const BODIES = new Map();
  // the plot keeps the shared edges (YW and the 8px right margin from the viewer), so the scrub line lines up with the other panels:
  // × ↑ ↓ sit in the YW column; each lane's name and total are a small label at the top-left of its lane, inside the plot
  /* total per lane, all on record: procedures in that lane (an operation that also counts in a second lane counts there too),
     devices for Ports & lines, stays + ER for Hospital stay, visits for Outpatient visit */
  function laneTotal(k) {
    const inView = t => t >= W.a && t <= W.b;
    if (k.startsWith('rt-')) { const cs = RTC.filter(c => c.lane === k), n = cs.reduce((a, c) => a + c.n, 0);
      return {n, sub: 'fx', tip: n + ' fractions in ' + cs.length + ' course' + (cs.length === 1 ? '' : 's') + ' · ' + cs.reduce((a, c) => a + c.fx.filter(f => inView(ms(f.d))).length, 0) + ' in view\n' + cs.map(c => c.from + ' ' + c.label + ': ' + c.n + ' fx, ' + c.dose).join('\n')}; }
    if (k === 'stay') { const st = STAYS.filter(s => s.kind !== 'er'), er = STAYS.filter(s => s.kind === 'er');
      return {n: st.length, sub: er.length ? '+' + er.length + ' ER' : '', tip: st.length + ' hospital stays (' + st.reduce((n, s) => n + days(s.from, s.to), 0) + ' days in all) + ' + er.length + ' ER visits · ' + STAYS.filter(s => inView(tms(s.from))).length + ' in view'}; }
    if (k === 'visit') { const shown = VISITS.filter(v => !vtOff.has(v.sub));
      return {n: VISITS.length, sub: '', tip: VISITS.length + ' outpatient visits' + (shown.length < VISITS.length ? ' (' + shown.length + ' of the ticked types)' : '') + ' · ' + shown.filter(v => inView(tms(v.start))).length + ' in view\n' +
        VT.map(v => v.label + ': ' + VISITS.filter(x => x.sub === v.key).length).join('\n')}; }
    const evs = P.events.filter(e => e.lane === k || e.also === k), pl = P.planned.filter(p => p.lane === k);
    if (k === 'line') { const dv = P.devices.filter(d => BYEV[d.from].lane === k);
      return {n: dv.length, sub: '', tip: dv.map(d => d.label + (d.to ? ' (removed)' : d.end_unknown ? '' : ' (still in)')).join('\n')}; }
    return {n: evs.length, sub: pl.length ? '+' + pl.length + ' planned' : '', tip: evs.length + ' ' + laneLabel(k).toLowerCase() + ' on record' + (pl.length ? ', ' + pl.length + ' planned' : '') +
      ' · ' + evs.filter(e => e.date && inView(ms(e.date))).length + ' in view\n' + evs.map(e => (e.date || e.date_text) + ' ' + e.short).join('\n')}; }
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const colOf = e => S.color === 'site' ? (SCOL[e.site] || '#888') : LCOL[e.lane];
  const shapeOf = lane => (LANES.find(l => l.key === lane) || {}).shape || 'circle';
  const saveOpts = () => store.set('proc.opts', S);
  const laneLabel = k => (LANES.find(l => l.key === k) || {}).label || k;
  // hospital stays / ER visits and outpatient visits (from the FHIR Encounter pulls, procedures/encounters.tsv)
  const STAYS = P.stays || [], VISITS = P.visits || [], VT = P.visit_types || [], SK = P.stay_kinds || {};
  const BYSTAY = Object.fromEntries(STAYS.map(s => [s.id, s]));
  // radiation courses, one mark per fraction (the data marks fraction days that are estimated)
  const RTC = P.rt_courses || [], BYRT = Object.fromEntries(RTC.map(c => [c.id, c]));
  const rtOf = id => id && id.startsWith('rt-') ? {c: BYRT[id.split(':')[0]], k: id.includes(':') ? +id.split(':')[1] : null} : null;
  const VTCOL = Object.fromEntries(VT.map(v => [v.key, v.color])), VTLAB = Object.fromEntries(VT.map(v => [v.key, v.label]));
  let vtOff = new Set(store.get('proc.vtOff', []));
  const tms = s => Date.parse(s.replace(' ', 'T') + 'Z');   // local date+time, on the same UTC-midnight scale as ms()
  const days = (a, b) => Math.max(1, Math.round((tms(b) - tms(a)) / 864e5));
  const stayCol = s => S.color === 'site' ? (SCOL[s.site] || '#888') : LCOL.stay;
  const visitCol = v => S.color === 'site' ? (SCOL[v.site] || '#888') : (VTCOL[v.sub] || '#888');
  /* lane order and hidden lanes: ↑ ↓ × left of each lane name, like the medications in the Treatment panel (a view setting) */
  let order = store.get('proc.laneOrder', LK).filter(k => LK.includes(k)); LK.forEach((k, i) => { if (order.includes(k)) return; const prev = order.indexOf(LK[i - 1]); order.splice(prev + 1, 0, k); });   // a new lane goes in its default place
  let hidden = new Set(store.get('proc.laneHidden', []).filter(k => LK.includes(k)));
  let VIS = order.filter(k => !hidden.has(k));
  const on = lane => VIS.includes(lane);
  const saveLanes = () => { VIS = order.filter(k => !hidden.has(k)); store.set('proc.laneOrder', order); store.set('proc.laneHidden', [...hidden]); };
  function redrawAll() { [IDT, IDL].forEach(i => { const b = BODIES.get(i); if (b && b.isConnected) (i === IDT ? drawTimeline : drawList)(i, b); }); list(); }
  function moveLane(k, d) {   // swap with the next visible lane up or down
    const v = VIS.indexOf(k), other = VIS[v + d]; if (other == null) return;
    const i = order.indexOf(k), j = order.indexOf(other); order[i] = other; order[j] = k; saveLanes(); redrawAll(); }
  function hideLane(k, h) { h ? hidden.add(k) : hidden.delete(k); saveLanes(); redrawAll(); }
  if (!document.getElementById('procCss')) { const st = document.createElement('style'); st.id = 'procCss';
    st.textContent = '.prmv{width:14px;height:16px;padding:0;line-height:15px;font-size:11px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;flex:none}' +
      '.prmv:hover:not(:disabled){border-color:var(--line);background:var(--card);color:var(--ink)}.prmv:disabled{opacity:.25;cursor:default}';
    document.head.append(st); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const btn2 = (label, on, tip, fn) => { const b = document.createElement('button'); b.textContent = label; b.title = tip; b.className = on ? 'on' : '';
    b.style.cssText = 'font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid var(--line);background:' + (on ? 'var(--ink)' : 'transparent') + ';color:' + (on ? 'var(--bg)' : 'var(--ink)') + ';cursor:pointer';
    b.onclick = fn; return b; };

  /* ================= Procedures over time ================= */
  function xAxis() {
    const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}};
  }
  const inW = t => t >= W.a && t <= W.b;
  const clampT = t => Math.min(Math.max(t, W.a), W.b);

  // everything that is not a plain marker: radiation bands, device bars, stays, follow-on tails, ghost markers, planned, labels
  const draw = {id: 'procDraw',
    beforeDatasetsDraw(c) {
      const {ctx, chartArea: a, scales: {x, y}} = c, X = t => x.getPixelForValue(pos(clampT(t))), Y = lane => y.getPixelForValue(VIS.indexOf(lane));
      hits = [];
      ctx.save();
      if (S.rt) P.radiation.forEach(r => { const t0 = ms(r.from), t1 = ms(r.to); if (t1 < W.a || t0 > W.b) return;
        const x0 = X(t0), x1 = Math.max(X(t1), x0 + 3);
        ctx.fillStyle = 'rgba(224,160,32,.13)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        ctx.fillStyle = '#b07a10'; ctx.font = '9px system-ui'; ctx.fillText('☢ ' + r.short, x0 + 2, a.bottom - 3);
        hits.push({x0, x1, y0: a.top, y1: a.bottom, pri: 0, lines: [fd(r.from) + ' → ' + fd(r.to), r.course, r.where]}); });
      // today line + planned zone
      const now = Date.now();
      if (inW(now)) { const px = X(now); ctx.strokeStyle = css('--muted'); ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = css('--muted'); ctx.font = '9px system-ui'; ctx.fillText('today', px - 30, a.bottom - 14); }
      // devices: bar from placement to removal / now
      P.devices.forEach(d => { const e0 = BYEV[d.from], e1 = d.to ? BYEV[d.to] : null;
        const t0 = ms(e0.date), t1 = e1 ? ms(e1.date) : d.end_unknown ? ms(d.end_unknown) : Math.min(now, W.b);
        if (t1 < W.a || t0 > W.b || !on(e0.lane)) return;
        const x0 = X(t0), x1 = X(t1), yc = Y(e0.lane) + (d.thin ? 7 : 0), h = d.thin ? 5 : 9, col = colOf(e0);
        if (d.end_unknown) { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; }
        else ctx.fillStyle = col;
        ctx.globalAlpha = .55; ctx.beginPath(); ctx.roundRect(x0, yc - h / 2, Math.max(x1 - x0, 2), h, h / 2); ctx.fill(); ctx.globalAlpha = 1;
        hits.push({x0, x1, y0: yc - 6, y1: yc + 6, pri: 2, id: d.from, lines: [d.label, 'placed ' + fd(e0.date) + ' · ' + (SNAME[e0.site] || ''),
          e1 ? 'removed ' + fd(e1.date) + ' · ' + (SNAME[e1.site] || '') + ' (' + d.end + ')' : d.end, Math.round((t1 - t0) / 864e5) + (d.end_unknown ? '+' : '') + ' days in the body', 'Click for details']});
        if (!d.to && !d.end_unknown && t1 >= W.b - 1) {   // still in: arrow at the right edge
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1 + 1, yc - 7); ctx.lineTo(x1 + 9, yc); ctx.lineTo(x1 + 1, yc + 7); ctx.fill(); }
        if (S.labels && x1 - x0 > 60) { ctx.fillStyle = css('--ink'); ctx.font = '10px system-ui'; ctx.fillText(d.label, x0 + 8, yc - h / 2 - 3); }
      });
      // hospital stays and ER visits (FHIR encounters): bar from admission to discharge
      if (on('stay')) STAYS.forEach(s => { const t0 = tms(s.from), t1 = tms(s.to); if (t1 < W.a || t0 > W.b) return;
        const er = s.kind === 'er', x0 = X(t0), x1 = Math.max(X(t1), x0 + (er ? 5 : 7)), yc = Y('stay'), h = er ? 8 : 14, col = stayCol(s);
        ctx.fillStyle = col; ctx.globalAlpha = s.kind === 'inpatient' ? .75 : er ? .2 : .4; ctx.fillRect(x0, yc - h / 2, x1 - x0, h); ctx.globalAlpha = 1;
        if (er || s.kind !== 'inpatient') { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, yc - h / 2 + .5, x1 - x0 - 1, h - 1); }
        if (picked === s.id) { ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.strokeRect(x0 - 3, yc - h / 2 - 3, x1 - x0 + 6, h + 6); ctx.lineWidth = 1; }
        if (S.labels && x1 - x0 > 50) { ctx.fillStyle = css('--ink'); ctx.font = '10px system-ui'; ctx.fillText((SNAME[s.site] || s.site) + ' · ' + days(s.from, s.to) + ' d', x0 + 2, yc - h / 2 - 3); }
        hits.push({x0: x0 - 2, x1: x1 + 2, y0: yc - 9, y1: yc + 9, pri: 2, id: s.id, lines: [(SK[s.kind] || s.kind) + ' · ' + (SNAME[s.site] || s.site),
          s.from + ' → ' + s.to + (er ? '' : ' (' + days(s.from, s.to) + ' day' + (days(s.from, s.to) > 1 ? 's' : '') + ')'), s.location, s.disposition ? 'Went: ' + s.disposition : '', 'Click for details']}); });
      // radiation: pale block for the course, one mark per fraction (paler = day estimated), dashed outline = unverified course
      RTC.forEach(c => { if (!on(c.lane)) return; const t0 = ms(c.from), t1 = ms(c.to) + 864e5; if (t1 < W.a || t0 > W.b) return;
        const yc = Y(c.lane), col = LCOL[c.lane], x0 = X(t0), x1 = Math.max(X(t1), x0 + 4), day = Math.max(0, X(t0 + 864e5) - X(t0));
        ctx.fillStyle = col; ctx.globalAlpha = .12; ctx.fillRect(x0, yc - 9, x1 - x0, 18); ctx.globalAlpha = 1;
        if (c.unverified) { ctx.strokeStyle = col; ctx.setLineDash([2, 2]); ctx.strokeRect(x0 + .5, yc - 9.5, x1 - x0 - 1, 19); ctx.setLineDash([]); }
        hits.push({x0, x1, y0: yc - 10, y1: yc + 10, pri: 1, id: c.id, lines: [c.label + ' · ' + c.n + ' fractions', fd(c.from) + ' → ' + fd(c.to), c.dose, c.where, 'Click for details']});
        const w = Math.max(1.5, Math.min(day * .7, 8));
        c.fx.forEach((f, k) => { const fx0 = X(ms(f.d)); ctx.fillStyle = col; ctx.globalAlpha = f.est ? .5 : 1; ctx.fillRect(fx0, yc - 7, w, 14);
          hits.push({x0: fx0 - 1, x1: fx0 + w + 1, y0: yc - 8, y1: yc + 8, pri: 3, id: c.id + ':' + k,
            lines: [c.label + ' · fraction ' + (k + 1) + ' of ' + c.n, fd(f.d) + (f.est ? ' (day estimated)' : ' (from the record)'), c.dose, 'Click for details']}); });
        ctx.globalAlpha = 1;
        const sel = rtOf(picked); if (sel && sel.c === c) { ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2;
          if (sel.k == null) ctx.strokeRect(x0 - 2, yc - 11, x1 - x0 + 4, 22); else { const fx0 = X(ms(c.fx[sel.k].d)); ctx.strokeRect(fx0 - 2, yc - 10, w + 4, 20); } ctx.lineWidth = 1; }
        if (S.labels && x1 - x0 > 60) { ctx.fillStyle = css('--ink'); ctx.font = '10px system-ui'; ctx.fillText(c.label + ' · ' + c.n + ' fx', x0 + 2, yc - 11); }
        else if (S.labels) { ctx.fillStyle = css('--ink'); ctx.font = '9px system-ui'; ctx.fillText(c.n + '', x1 + 3, yc + 3); } });
      // hospital stays and follow-on tails
      P.events.forEach(e => { if (!e.date || !on(e.lane)) return;
        if (e.stay) { const t0 = ms(e.stay[0]), t1 = ms(e.stay[1]) + 864e5; if (t1 >= W.a && t0 <= W.b) {
          const x0 = X(t0), x1 = Math.max(X(t1), x0 + 6), yc = Y(e.lane); ctx.fillStyle = colOf(e); ctx.globalAlpha = .35; ctx.fillRect(x0, yc - 9, x1 - x0, 18); ctx.globalAlpha = 1;
          hits.push({x0, x1, y0: yc - 9, y1: yc + 9, pri: 1, id: e.id, lines: [e.short, 'Hospital stay ' + fd(e.stay[0]) + ' → ' + fd(e.stay[1]), 'Click for details']}); } }
        if (e.followon) { const f = P.followon[e.followon], t0 = ms(e.date), t1 = ms(f.from), t2 = ms(f.to);
          if (t2 >= W.a && t0 <= W.b) { const yc = Y(e.lane), col = colOf(e);
            ctx.strokeStyle = col; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(t0), yc); ctx.lineTo(X(t1), yc); ctx.stroke(); ctx.setLineDash([]);
            ctx.globalAlpha = .3; ctx.fillStyle = col; ctx.fillRect(X(t1), yc - 3, Math.max(X(t2) - X(t1), 3), 6); ctx.globalAlpha = 1;
            hits.push({x0: X(t0) + 8, x1: Math.max(X(t2), X(t1) + 3), y0: yc - 5, y1: yc + 5, pri: 1, id: e.id, lines: ['After: ' + e.short, f.label + ' ' + fd(f.from) + ' → ' + fd(f.to), 'Click for details']});
            if (S.labels && X(t2) - X(t1) > 40) { ctx.fillStyle = col; ctx.font = '9px system-ui'; ctx.fillText('then ' + f.label.toLowerCase(), X(t1), yc - 6); } } }
        if (e.also && on(e.also) && inW(ms(e.date))) {   // ghost marker in the second lane, linked by a dotted line
          const px = X(ms(e.date)), y0 = Y(e.lane), y1 = Y(e.also);
          ctx.strokeStyle = colOf(e); ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke(); ctx.setLineDash([]);
          ctx.lineWidth = 1.5; drawShape(ctx, shapeOf(e.also), px, y1, 5); ctx.stroke(); ctx.lineWidth = 1; }
      });
      ctx.restore();
    },
    afterDatasetsDraw(c) {
      const {ctx, chartArea: a, scales: {x, y}} = c, Y = lane => y.getPixelForValue(VIS.indexOf(lane));
      ctx.save();
      // planned (no date): dashed hollow marker at the right edge
      P.planned.forEach((p, i) => { if (!on(p.lane)) return; const px = a.right - 12 - (P.planned.length - 1 - i) * 18, yc = Y(p.lane);   // just inside the right edge
        ctx.fillStyle = css('--card'); ctx.globalAlpha = .85; ctx.fillRect(px - 9, yc - 19, 18, 29); ctx.globalAlpha = 1;
        ctx.strokeStyle = LCOL[p.lane]; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.5; drawShape(ctx, shapeOf(p.lane), px, yc, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = LCOL[p.lane]; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', px, yc + 3);
        ctx.font = '9px system-ui'; ctx.fillText('planned', px, yc - 12); ctx.textAlign = 'start';
        hits.push({x0: px - 10, x1: px + 10, y0: yc - 18, y1: yc + 10, pri: 3, id: p.id, lines: [p.short, 'date not set', 'Click for details']}); });
      // labels on key procedures
      if (S.labels) { const used = [];   // skip a label that would overlap one already drawn (zoom in to see it)
        ctx.font = 'bold 10px system-ui';
        P.events.filter(e => e.date && e.key && on(e.lane) && inW(ms(e.date))).forEach(e => {
          const px = x.getPixelForValue(pos(ms(e.date))), yc = Y(e.lane), w = ctx.measureText(e.short).width;
          const spot = [yc - 11, yc + 20].find(ty => !used.some(u => Math.abs(u.y - ty) < 11 && px + 9 < u.x1 && px + 9 + w > u.x0));
          if (spot == null) return; used.push({x0: px + 9, x1: px + 9 + w, y: spot});
          ctx.fillStyle = css('--ink'); ctx.fillText(e.short, px + 9, spot); }); }
      // selection ring
      const s = picked && BYEV[picked];
      if (s && s.date && on(s.lane) && inW(ms(s.date))) { const px = x.getPixelForValue(pos(ms(s.date))), yc = Y(s.lane);
        ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, yc, 11, 0, 7); ctx.stroke(); }
      ctx.restore();
    }};
  let hits = [];   // hover/click areas for everything drawn by hand (bars, stays, tails, bands, planned); top priority wins
  const hitAt = (px, py) => hits.filter(h => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1).sort((a, b) => b.pri - a.pri)[0] || null;
  function showTip(tip, h, px, py, box) {
    if (!h) { tip.style.display = 'none'; return; }
    tip.innerHTML = h.lines.filter(Boolean).map((l, i) => i ? esc(l) : '<b>' + esc(l) + '</b>').join('<br>'); tip.style.display = 'block';
    const w = box.clientWidth; tip.style.left = Math.min(px + 12, w - 290) + 'px'; tip.style.top = (py + 12) + 'px';
  }
  const guide = {id: 'procGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};

  function toolbar(body, redraw) {
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px';
    const lab = t => { const s = document.createElement('span'); s.className = 'sub'; s.textContent = t; return s; };
    bar.append(lab('Colour:'),
      btn2('type', S.color === 'type', 'Colour by kind of procedure', () => { S.color = 'type'; saveOpts(); redraw(); }),
      btn2('hospital', S.color === 'site', 'Colour by the hospital that did it', () => { S.color = 'site'; saveOpts(); redraw(); }),
      lab(' Show:'),
      btn2('☢ radiation', S.rt, 'Radiation courses as shaded bands (treatments, for context)', () => { S.rt = !S.rt; saveOpts(); redraw(); }),
      btn2('labels', S.labels, 'Names on key procedures and devices', () => { S.labels = !S.labels; saveOpts(); redraw(); }),
      btn2('◆ summary row', S.layer !== false, 'A row at the top with every point still in the selection, as keyframes', () => { S.layer = S.layer === false; saveOpts(); redraw(); }));
    if (hidden.size) { bar.append(lab(' Hidden:')); order.filter(k => hidden.has(k)).forEach(k => bar.append(btn2('＋ ' + laneLabel(k), false, 'Show the ' + laneLabel(k) + ' lane again', () => hideLane(k, false)))); }
    const early = P.events.filter(e => !e.date || ms(e.date) < W.a);
    if (early.length) { const b = btn2('◀ ' + early.length + ' earlier', false, early.map(e => e.date_text + ': ' + e.short).join('\n') + '\nClick to see them', () => { picked = early[0].id; redraw(); });
      b.style.marginLeft = 'auto'; bar.append(b); }
    body.append(bar);
  }

  function legend() {
    const d = document.createElement('div'); d.className = 'sub'; d.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;align-items:center';
    const item = (svg, t) => { const s = document.createElement('span'); s.style.cssText = 'display:inline-flex;gap:4px;align-items:center'; s.innerHTML = svg; s.append(t); d.append(s); };
    item('<svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="#888"/></svg>', 'one-and-done');
    item('<svg width="34" height="12"><rect x="1" y="2" width="26" height="8" rx="4" fill="#6250d6" opacity=".55"/><path d="M27 0l7 6-7 6z" fill="#6250d6"/></svg>', 'in the body (arrow = still in)');
    item('<svg width="26" height="12"><defs><linearGradient id="pfade"><stop offset="0" stop-color="#6250d6"/><stop offset="1" stop-color="#6250d6" stop-opacity="0"/></linearGradient></defs><rect x="1" y="3" width="24" height="6" rx="3" fill="url(#pfade)"/></svg>', 'end date unknown');
    item('<svg width="36" height="14"><rect x="2" y="1" width="6" height="12" fill="#e34948" opacity=".35"/><path d="M5 2l4 5-4 5-4-5z" fill="#e34948"/><path d="M9 7h14" stroke="#e34948" stroke-dasharray="2 3"/><rect x="23" y="4" width="12" height="6" fill="#e34948" opacity=".3"/></svg>', 'surgery + stay → follow-on');
    item('<svg width="12" height="12"><path d="M6 1l5 5-5 5-5-5z" fill="none" stroke="#888" stroke-width="1.5"/></svg>', 'also counts in this lane');
    item('<svg width="14" height="14"><path d="M7 1l6 6-6 6-6-6z" fill="none" stroke="#e34948" stroke-dasharray="2 2" stroke-width="1.5"/></svg>', 'planned, no date');
    if (RTC.some(c => on(c.lane))) item(`<svg width="30" height="14"><rect x="0" y="0" width="30" height="14" fill="#e0861a" opacity=".12"/>${[2, 8, 14, 20, 26].map((x, i) => `<rect x="${x}" y="2" width="2.5" height="10" fill="#e0861a" opacity="${i % 4 ? .5 : 1}"/>`).join('')}</svg>`, 'radiation: one mark per fraction (paler = day estimated)');
    if (on('stay')) item(`<svg width="40" height="12"><rect x="1" y="1" width="16" height="10" fill="${LCOL.stay}" opacity=".75"/><rect x="21" y="1" width="8" height="10" fill="${LCOL.stay}" opacity=".4" stroke="${LCOL.stay}"/><rect x="33" y="3" width="5" height="7" fill="${LCOL.stay}" opacity=".2" stroke="${LCOL.stay}"/></svg>`, 'inpatient · observation/overnight · ER');
    if (on('visit') && S.color === 'type') VT.filter(v => !vtOff.has(v.key)).forEach(v => item(`<svg width="8" height="8"><rect width="8" height="8" fill="${v.color}"/></svg>`, v.label));
    if (S.color === 'site') P.sites.forEach(s => item(`<svg width="10" height="10"><rect width="10" height="10" rx="2" fill="${SCOL[s.key]}"/></svg>`, s.short));
    return d;
  }

  function card(redraw) {
    const d = document.createElement('div'); d.style.cssText = 'margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.45';
    const rt = rtOf(picked);
    if (rt && rt.c) { const c = rt.c, k = rt.k;
      const ids = k == null ? RTC.map(x => x.id) : c.fx.map((_, i) => c.id + ':' + i), i = ids.indexOf(picked), what = k == null ? 'course' : 'fraction';
      const nav = document.createElement('div'); nav.style.cssText = 'float:right;display:flex;gap:4px';
      if (i > 0) nav.append(btn2('◀', false, 'Previous ' + what, () => { picked = ids[i - 1]; redraw(); }));
      if (i < ids.length - 1) nav.append(btn2('▶', false, 'Next ' + what, () => { picked = ids[i + 1]; redraw(); }));
      if (k != null) nav.append(btn2('whole course', false, 'Show the whole course', () => { picked = c.id; redraw(); }));
      nav.append(btn2('×', false, 'Close', () => { picked = null; redraw(); })); d.append(nav);
      const h = document.createElement('div'), col = LCOL[c.lane];
      h.innerHTML = `<b style="color:${col}">${esc(laneLabel(c.lane))}: ${esc(c.label)}${k != null ? ' · fraction ' + (k + 1) + ' of ' + c.n : ''}</b>
        <div class="sub">${k != null ? fd(c.fx[k].d) + (c.fx[k].est ? ' (day estimated)' : ' (from the record)') + ' · course ' : ''}${fd(c.from)} → ${fd(c.to)} · ${c.n} fractions${c.unverified ? ' · <i>unverified</i>' : ''}</div>
        <div style="margin-top:4px"><b>Dose:</b> ${esc(c.dose)}</div><div><b>Where:</b> ${esc(c.where)}</div><div><b>Course:</b> ${esc(c.course)}</div>
        <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${c.fx.map((f, i) => `<span title="${f.est ? 'day estimated' : 'from the record'}" style="font-size:10px;padding:0 4px;border-radius:3px;border:1px solid ${col};${i === k ? 'background:' + col + ';color:#fff;' : ''}${f.est ? 'opacity:.6;font-style:italic' : ''}">${i + 1}: ${f.d.slice(5).replace('-', '/')}</span>`).join('')}</div>
        <div class="sub" style="margin-top:4px">${c.exact ? 'The weekdays between the first and last day match the number of fractions exactly.' : 'The records give only the first day, last day and number of fractions (' + esc(c.fit) + '): italic days are spread evenly, not known.'} Source: ${esc(c.source)}</div>`;
      d.append(h); return d; }
    const st = picked && BYSTAY[picked], vi = picked && picked.startsWith('visit:') ? VISITS[+picked.slice(6)] : null;
    if (st || vi) {
      const ids = st ? STAYS.map(s => s.id) : VISITS.map((_, i) => 'visit:' + i), i = ids.indexOf(picked), what = st ? 'stay' : 'visit';
      const nav = document.createElement('div'); nav.style.cssText = 'float:right;display:flex;gap:4px';
      if (i > 0) nav.append(btn2('◀', false, 'Previous ' + what, () => { picked = ids[i - 1]; redraw(); }));
      if (i < ids.length - 1) nav.append(btn2('▶', false, 'Next ' + what, () => { picked = ids[i + 1]; redraw(); }));
      nav.append(btn2('×', false, 'Close', () => { picked = null; redraw(); })); d.append(nav);
      const h = document.createElement('div');
      h.innerHTML = st
        ? `<b style="color:${stayCol(st)}">${esc(SK[st.kind] || st.kind)} · ${esc(SNAME[st.site] || st.site)}</b>
           <div class="sub">${esc(st.from)} → ${esc(st.to)}${st.kind === 'er' ? '' : ' · ' + days(st.from, st.to) + ' day(s)'} · times approximate (local, from FHIR)</div>
           <div style="margin-top:4px"><b>Where:</b> ${esc(st.location || '—')}</div><div><b>Type:</b> ${esc(st.type)}</div>
           ${st.disposition ? `<div><b>Went:</b> ${esc(st.disposition)}</div>` : ''}
           ${P.events.filter(e => e.date && e.date >= st.from.slice(0, 10) && e.date <= st.to.slice(0, 10)).map(e => `<div><b>Procedure during this stay:</b> ${esc(e.short)}</div>`).join('')}
           <div class="sub" style="margin-top:4px">Source: <code style="font-size:10px">${esc(st.source)}</code></div>`
        : `<b style="color:${visitCol(vi)}">${esc(VTLAB[vi.sub] || vi.sub)} visit · ${esc(SNAME[vi.site] || vi.site)}</b>
           <div class="sub">${esc(vi.start)} (approximate local time)</div>
           <div style="margin-top:4px"><b>Type:</b> ${esc(vi.type)}</div><div><b>Where:</b> ${esc(vi.location || '—')}</div>${vi.provider ? `<div><b>With:</b> ${esc(vi.provider)}</div>` : ''}`;
      d.append(h); return d;
    }
    const e = picked && (BYEV[picked] || P.planned.find(p => p.id === picked));
    if (!e) { d.className = 'sub'; d.textContent = 'Click a procedure (or a Library row) to see where, who, the result and the sources.'; return d; }
    const isPlan = !BYEV[picked];
    const dev = P.devices.find(v => v.from === e.id || v.to === e.id);
    const fo = e.followon && P.followon[e.followon];
    const nav = document.createElement('div'); nav.style.cssText = 'float:right;display:flex;gap:4px';
    const list_ = P.events.map(x => x.id).concat(P.planned.map(p => p.id)), i = list_.indexOf(e.id);   // all, in date order: childhood first, planned last
    if (i > 0) nav.append(btn2('◀', false, 'Previous procedure', () => { picked = list_[i - 1]; redraw(); }));
    if (i >= 0 && i < list_.length - 1) nav.append(btn2('▶', false, 'Next procedure', () => { picked = list_[i + 1]; redraw(); }));
    nav.append(btn2('×', false, 'Close', () => { picked = null; redraw(); }));
    d.append(nav);
    const col = isPlan ? LCOL[e.lane] : colOf(e);
    const h = document.createElement('div');
    h.innerHTML = isPlan
      ? `<b style="color:${col}">${esc(e.short)}</b> <span class="sub">· date not set</span><div style="margin-top:4px">${esc(e.note)}</div>
         <div class="sub" style="margin-top:4px">When it happens and its records arrive, it becomes a normal marker.</div>`
      : `<b style="color:${col}">${esc(e.procedure)}</b>
         <div class="sub">${esc(e.date_text)} · ${esc(LANES.find(l => l.key === e.lane).label)}${e.also ? ' + ' + esc(LANES.find(l => l.key === e.also).label) : ''} · <i>${esc(e.sure)}</i></div>
         <div style="margin-top:4px"><b>Where / who:</b> ${esc(e.where)}</div>
         <div><b>Result:</b> ${esc(e.result)}</div>
         ${dev ? `<div><b>Device:</b> ${esc(dev.label)}: placed ${fd(BYEV[dev.from].date)} → ${dev.to ? 'removed ' + fd(BYEV[dev.to].date) : esc(dev.end)}${dev.to ? ' (' + esc(dev.end) + ')' : ''}</div>` : ''}
         ${e.stay ? `<div><b>Hospital stay:</b> ${fd(e.stay[0])} → ${fd(e.stay[1])}</div>` : ''}
         ${fo ? `<div><b>Then:</b> ${esc(fo.label)} ${fd(fo.from)} → ${fd(fo.to)}</div>` : ''}
         <details style="margin-top:4px"><summary class="sub" style="cursor:pointer">Sources (${e.sources.reduce((n, s) => n + s.n, 0)} mentions in ${e.sources.length} hospital${e.sources.length === 1 ? '' : 's'})</summary>
           ${e.sources.map(s => `<div class="sub">${esc(SNAME[s.site] || s.site)}: ${esc(s.kinds)} · e.g. <code style="font-size:10px">${esc(s.example)}</code></div>`).join('')}</details>`;
    d.append(h);
    // pathology slide photos of this procedure (pathology_view.js, when loaded, sets window.PATH)
    const slides = !isPlan && window.PATH ? window.PATH.forProcedure(e.id) : [];
    if (slides.length) { const r = document.createElement('div'); r.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap';
      slides.forEach(c => r.append(btn2('🔬 Slide photos · ' + c.n, false, 'Open the pathology slide photos of this procedure (' + c.title + ')', () => window.PATH.open(c.key))));
      d.append(r); }
    return d;
  }

  function drawTimeline(id, body) {
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = '';
    const redraw = () => { drawTimeline(id, body); const b = BODIES.get(IDL); if (b && b.isConnected) drawList(IDL, b); };
    toolbar(body, redraw);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Procedures over time, one lane per kind');
    const tip = document.createElement('div'); tip.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:5;max-width:280px;background:rgba(0,0,0,.85);color:#fff;font-size:11px;line-height:1.35;padding:5px 7px;border-radius:5px';
    box.append(cv, tip); body.append(box);
    const pts = P.events.filter(e => e.date && on(e.lane) && inW(ms(e.date))).map(e => ({x: pos(ms(e.date)), y: VIS.indexOf(e.lane), e}));
    const vpts = on('visit') ? VISITS.map((v, i) => ({v, i, t: tms(v.start)})).filter(o => !vtOff.has(o.v.sub) && inW(o.t)).map(o => ({x: pos(o.t), y: VIS.indexOf('visit'), v: o.v, vi: o.i})) : [];
    const c = new Chart(cv, {type: 'scatter', plugins: [draw, guide, momentPlugin],
      data: {datasets: [{data: pts,
        pointStyle: p => p.raw ? shapeOf(p.raw.e.lane) : 'circle',
        pointRadius: p => p.raw ? (p.raw.e.key ? 8 : 6) : 5, pointHoverRadius: 9,
        pointBackgroundColor: p => p.raw ? colOf(p.raw.e) : '#888',
        pointBorderColor: p => p.raw && ticked.has(p.raw.e.id) ? css('--ink') : '#fff', pointBorderWidth: p => p.raw && ticked.has(p.raw.e.id) ? 2 : 1},
        {data: vpts, pointStyle: 'rect', pointRadius: p => p.raw && picked === 'visit:' + p.raw.vi ? 6 : 3.5, pointHoverRadius: 6,
         pointBackgroundColor: p => p.raw ? visitCol(p.raw.v) : '#888', pointBorderColor: p => p.raw && picked === 'visit:' + p.raw.vi ? css('--ink') : 'transparent', pointBorderWidth: 2}]},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(14),
        onHover: (ev, els, ch) => { const xv = ch.scales.x.getValueForPixel(ev.x); setHover(xv >= 0 && xv <= 100 ? xv : null);
          if (els.length) { showTip(tip, null); ch.canvas.style.cursor = 'pointer'; } },
        onClick: (ev, els, ch) => {
          // redraw after Chart.js finishes handling the click (destroying the chart inside its own handler throws)
          if (els.length) { const o = ch.data.datasets[els[0].datasetIndex].data[els[0].index]; picked = o.e ? o.e.id : 'visit:' + o.vi; setTimeout(redraw, 0); } },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, callbacks: {
          title: it => { const o = it[0].raw; if (o.v) return o.v.start + ' · ' + (SNAME[o.v.site] || o.v.site); const e = o.e; return fd(e.date) + (e.site ? ' · ' + (SNAME[e.site] || e.site) : ''); },
          label: it => { const o = it.raw; if (o.v) return [(VTLAB[o.v.sub] || o.v.sub) + ' visit', o.v.type, o.v.location, o.v.provider].filter(Boolean);
            const e = o.e, r = e.result.length > 110 ? e.result.slice(0, 108) + '…' : e.result;
            return [e.short, r, e.sure, 'Click for details']; }}}},
        scales: {x: xAxis(),
          y: {min: -0.6, max: Math.max(VIS.length, 1) - 0.4, reverse: true, afterFit: s => { s.width = YW; },
            afterBuildTicks: a => { a.ticks = VIS.map((_, i) => ({value: i})); },
            ticks: {display: false}, grid: {color: css('--line')}}}}});
    // lane names with × ↑ ↓ (HTML on top of the chart, like the Treatment panel's medication rows)
    const band = VIS.length > 1 ? Math.abs(c.scales.y.getPixelForValue(1) - c.scales.y.getPixelForValue(0)) : 40;
    VIS.forEach((k, i) => { const yc = c.scales.y.getPixelForValue(i), L = laneLabel(k), t = laneTotal(k);
      const row = document.createElement('div'); row.style.cssText = `position:absolute;z-index:4;left:2px;top:${yc - 9}px;width:${c.chartArea.left - 6}px;height:18px;display:flex;align-items:center;justify-content:flex-end;gap:1px`;
      const mk = (t, title, fn, off) => { const b = btn(t, e => { e.stopPropagation(); fn(); }, 'prmv'); b.title = title; b.setAttribute('aria-label', title); b.disabled = !!off; return b; };
      row.append(mk('×', 'Hide the ' + L + ' lane (＋ above the chart brings it back)', () => hideLane(k, true)),
        mk('↑', 'Move ' + L + ' up', () => moveLane(k, -1), i === 0), mk('↓', 'Move ' + L + ' down', () => moveLane(k, 1), i === VIS.length - 1));
      // name and total (all on record, not only the time window): top-left of the lane, inside the plot; clicks pass through to the chart
      const tag = document.createElement('div'); tag.title = t.tip; tag.setAttribute('aria-label', L + ' total: ' + t.tip);
      tag.style.cssText = `position:absolute;z-index:3;pointer-events:none;left:${c.chartArea.left + 3}px;top:${yc - Math.min(band / 2, 24) + 1}px;max-width:240px;` +
        `font:bold 10.5px system-ui;line-height:13px;color:${LCOL[k]};background:color-mix(in srgb,var(--card) 80%,transparent);padding:0 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
      tag.textContent = L + ' ' + t.n;
      if (t.sub) { const sm = document.createElement('span'); sm.style.cssText = 'font-weight:400;font-size:9px;opacity:.8;margin-left:3px'; sm.textContent = t.sub; tag.append(sm); }
      box.append(row, tag); });
    // drawn shapes (bars, stays, bands, planned) are handled on the canvas itself: Chart.js ignores clicks outside the plot area
    const onPoint = ev => c.getElementsAtEventForMode(ev, 'nearest', {intersect: true}, false).length > 0;
    cv.addEventListener('mousemove', ev => { if (onPoint(ev)) return; const h = hitAt(ev.offsetX, ev.offsetY);
      showTip(tip, h, ev.offsetX, ev.offsetY, box); cv.style.cursor = h && h.id ? 'pointer' : 'default'; });
    cv.addEventListener('click', ev => { if (onPoint(ev)) return; const h = hitAt(ev.offsetX, ev.offsetY);
      picked = h && h.id ? h.id : null; setTimeout(redraw, 0); });
    charts.set(id, c); box.onmouseleave = () => { setHover(null); showTip(tip, null); };
    window.addEventListener('scroll', () => showTip(tip, null), {passive: true, once: true});
    body.append(legend(), card(redraw));
    setTimeout(drawLayer, 0);
  }

  /* ================= Procedure list (table) ================= */
  let laneOff = new Set(store.get('proc.laneOff', []));
  function drawList(id, body) {
    body.innerHTML = '';
    const redraw = () => { drawList(id, body); const b = BODIES.get(IDT); if (b && b.isConnected) drawTimeline(IDT, b); };
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px';
    order.map(k => LANES.find(l => l.key === k)).filter(l => P.events.some(e => e.lane === l.key || e.also === l.key)).forEach(l => { const b = btn2(l.label + ' ' + P.events.filter(e => e.lane === l.key || e.also === l.key).length, !laneOff.has(l.key), 'Show or hide ' + l.label, () => {
      laneOff.has(l.key) ? laneOff.delete(l.key) : laneOff.add(l.key); store.set('proc.laneOff', [...laneOff]); redraw(); });
      if (!laneOff.has(l.key)) { b.style.background = LCOL[l.key]; b.style.borderColor = LCOL[l.key]; b.style.color = '#fff'; } bar.append(b); });
    body.append(bar);
    const rows = P.events.filter(e => !laneOff.has(e.lane) || (e.also && !laneOff.has(e.also)));
    let h = '<div style="overflow:auto;max-height:' + hOf(id, PANELS[id].h0) + 'px"><table style="border-collapse:collapse;font-size:12px;width:100%">' +
      '<tr class="sub" style="text-align:left;position:sticky;top:0;background:var(--bg)"><th style="padding:3px 6px">Date</th><th>Procedure</th><th>Where</th><th>Result</th><th>Sure?</th></tr>';
    rows.forEach(e => { const dim = e.date && !inW(ms(e.date)) || !e.date;
      h += `<tr data-id="${e.id}" style="cursor:pointer;border-top:1px solid var(--line);${dim ? 'opacity:.5;' : ''}${picked === e.id ? 'outline:2px solid var(--ink);' : ''}">
        <td style="padding:3px 6px;white-space:nowrap;vertical-align:top"><span style="color:${colOf(e)}">${({rectRot: '◆', triangle: '▲', rect: '■', circle: '●', crossRot: '✕'})[shapeOf(e.lane)]}</span> ${esc(e.date ? fd(e.date) : e.date_text)}</td>
        <td style="vertical-align:top;${e.key ? 'font-weight:600' : ''}">${esc(e.short)}</td>
        <td style="vertical-align:top" class="sub">${esc(SNAME[e.site] || '—')}</td>
        <td style="vertical-align:top">${esc(e.result.length > 140 ? e.result.slice(0, 138) + '…' : e.result)}</td>
        <td style="vertical-align:top" class="sub">${esc(e.sure)}</td></tr>`; });
    P.planned.forEach(p => { h += `<tr data-id="${p.id}" style="cursor:pointer;border-top:1px dashed var(--line);font-style:italic"><td style="padding:3px 6px;color:${LCOL[p.lane]}">◇ date not set</td><td>${esc(p.short)}</td><td class="sub">—</td><td class="sub" colspan="2">${esc(p.note)}</td></tr>`; });
    h += '</table></div><div class="sub" style="margin-top:4px">Dimmed = outside the time window (or childhood, no exact date). Click a row to select it on the timeline.</div>';
    const w = document.createElement('div'); w.innerHTML = h; body.append(w);
    w.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { picked = tr.dataset.id; redraw(); });
  }

  /* ================= procedures as moment lines on every chart (ticked in the Library) ================= */
  const MGROUP = 'Procedures';
  function syncMoments() {
    if (typeof E === 'undefined') return;
    E.moments = (E.moments || []).filter(m => !m.procGen);
    P.events.filter(e => e.date && ticked.has(e.id)).forEach(e => {
      const dev = P.devices.find(v => v.from === e.id);
      const end = dev ? (dev.to ? BYEV[dev.to].date : '') : e.stay ? e.stay[1] : '';
      E.moments.push({id: 'proc-' + e.id, title: e.short, group: MGROUP, date: e.date, time: '', end, note: e.procedure + ' — ' + e.where,
        color: LMOM[e.lane], kind: 'procedure', line: true, on: true, links: [], procGen: e.id}); });
    RTC.filter(c => ticked.has(c.id)).forEach(c => E.moments.push({id: 'proc-' + c.id, title: 'Radiation: ' + c.label, group: MGROUP, date: c.from, time: '', end: c.to,
      note: c.n + ' fractions, ' + c.dose + ' · ' + c.where, color: LMOM[c.lane], kind: 'procedure', line: true, on: true, links: [], procGen: c.id}));
    STAYS.filter(s => ticked.has(s.id)).forEach(s => E.moments.push({id: 'proc-' + s.id, title: (SK[s.kind] || s.kind) + ' · ' + (SNAME[s.site] || s.site), group: MGROUP,
      date: s.from.slice(0, 10), time: '', end: s.to.slice(0, 10) > s.from.slice(0, 10) ? s.to.slice(0, 10) : '', note: s.location + (s.disposition ? ' · went: ' + s.disposition : ''),
      color: LMOM.stay, kind: 'event', line: true, on: true, links: [], procGen: s.id}));
  }
  if (typeof saveEdits === 'function') { const _save = saveEdits;
    saveEdits = function () { const mine = (E.moments || []).filter(m => m.procGen); E.moments = (E.moments || []).filter(m => !m.procGen);
      try { return _save.apply(this, arguments); } finally { E.moments.push(...mine); } }; }
  const _openMoment = openMoment;
  openMoment = function (m) { if (m && m.procGen) { show(m.procGen); return; } return _openMoment.apply(this, arguments); };
  /* Only on a lane: keep just this lane's keyframe lines; pressed again, the earlier ticks come back */
  let procOnly = store.get('proc.only', null);
  function onlyTicked(key, ids) {
    if (procOnly && procOnly.key === key) { ticked = new Set(procOnly.prev); procOnly = null; }
    else { procOnly = {key, prev: procOnly ? procOnly.prev : [...ticked]}; ticked = new Set(ids); }
    store.set('proc.only', procOnly); store.set('proc.moments', [...ticked]); syncMoments(); list(); render();
  }
  const laneOnly = (s, key, ids, what) => s.insertBefore(groupOnlyBtn(what, key, ids, !!(procOnly && procOnly.key === key), false, () => onlyTicked(key, ids)), s.lastChild);
  function setTicked(ids, on) { ids.forEach(i => on ? ticked.add(i) : ticked.delete(i)); store.set('proc.moments', [...ticked]); syncMoments(); list(); render(); }
  window.PROC_SHOW = id => show(id);   // used by pathology_view.js ("Show in Procedures")
  function show(id) {   // select a procedure and make sure the timeline panel is open
    picked = id;
    if (!sel.includes(IDT)) setLabSel([IDT], true);
    else { const b = BODIES.get(IDT); if (b && b.isConnected) drawTimeline(IDT, b); }
    setTimeout(() => { const b = BODIES.get(IDT); if (b && b.isConnected) b.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }, 50);
  }

  /* ================= Summary row: every point still in the selection, as keyframes =================
     A strip at the top of the Procedures timeline panel, on the same time axis: every point the lanes below are showing right now
     (visible lanes, ticked visit types, the time window) as keyframe marks. Diamonds = procedures, thin bars = ports/lines,
     stays and radiation courses (with a tick per fraction), small dots = visits. Click = select it on the Procedures timeline. */
  function layerItems() {
    const it = [], inWin = (a, b) => b >= W.a && a <= W.b;
    P.events.forEach(e => { if (e.date && on(e.lane) && inW(ms(e.date))) it.push({t: ms(e.date), col: LCOL[e.lane], kind: 'key', id: e.id, tip: [fd(e.date) + ' · ' + laneLabel(e.lane), e.short]}); });
    if (on('line')) P.devices.forEach(d => { const e0 = BYEV[d.from], e1 = d.to && BYEV[d.to], t0 = ms(e0.date), t1 = e1 ? ms(e1.date) : d.end_unknown ? ms(d.end_unknown) : Date.now();
      if (inWin(t0, t1)) it.push({t: t0, t1, col: LCOL.line, kind: 'bar', id: d.from, tip: [d.label, fd(e0.date) + ' → ' + (e1 ? fd(e1.date) : d.end)]}); });
    if (on('stay')) STAYS.forEach(st => { const t0 = tms(st.from), t1 = tms(st.to); if (inWin(t0, t1)) it.push({t: t0, t1, col: LCOL.stay, kind: 'bar', id: st.id, tip: [(SK[st.kind] || st.kind) + ' · ' + (SNAME[st.site] || st.site), st.from.slice(0, 10) + ' → ' + st.to.slice(0, 10)]}); });
    RTC.forEach(c => { if (!on(c.lane)) return; const t0 = ms(c.from), t1 = ms(c.to) + 864e5; if (!inWin(t0, t1)) return;
      it.push({t: t0, t1, col: LCOL[c.lane], kind: 'bar', id: c.id, tip: [laneLabel(c.lane) + ': ' + c.label, c.n + ' fractions · ' + fd(c.from) + ' → ' + fd(c.to)]});
      c.fx.forEach((f, k) => { const t = ms(f.d); if (inW(t)) it.push({t, col: LCOL[c.lane], kind: 'tick', id: c.id + ':' + k, tip: [c.label + ' · fraction ' + (k + 1) + ' of ' + c.n, fd(f.d) + (f.est ? ' (day estimated)' : '')]}); }); });
    if (on('visit')) VISITS.forEach((v, i) => { const t = tms(v.start); if (!vtOff.has(v.sub) && inW(t)) it.push({t, col: visitCol(v), kind: 'dot', id: 'visit:' + i, tip: [v.start.slice(0, 10) + ' · ' + (VTLAB[v.sub] || v.sub) + ' visit', SNAME[v.site] || v.site]}); });
    return it;
  }
  let layerHits = [];
  function drawLayer() {
    const mc = charts.get(IDT), mcv = mc && mc.canvas, track = mcv && mcv.parentElement;
    let box = document.getElementById('procLayer');
    const showIt = S.layer !== false && sel.includes(IDT) && track && track.isConnected;
    if (!showIt) { if (box) box.remove(); return; }
    const A = mc.chartArea, x = mc.scales.x;
    if (box && box.nextSibling !== track) { box.remove(); box = null; }   // the panel was redrawn: put a fresh row above the new chart
    if (!box) { box = document.createElement('div'); box.id = 'procLayer'; box.style.cssText = 'position:relative;margin-bottom:2px;border-bottom:1px dashed var(--line)';
      const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Summary row: every point shown in the Procedures timeline');
      const tip = document.createElement('div'); tip.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:6;max-width:260px;background:rgba(0,0,0,.85);color:#fff;font-size:11px;line-height:1.35;padding:4px 6px;border-radius:5px';
      box.append(cv, tip); track.before(box);
      // follow the chart's width: without this the row kept its old pixel width after the window or Library changed size,
      // pushing the page sideways (a horizontal scrollbar) or leaving the row short
      let rz = 0; new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (box.isConnected && mcv.isConnected) drawLayer(); }); }).observe(mcv);
      const near = ev => { const r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
        return layerHits.filter(h => px >= h.x0 - 3 && px <= h.x1 + 3 && py >= h.y0 && py <= h.y1).sort((a, b) => b.pri - a.pri || Math.abs(px - a.x0) - Math.abs(px - b.x0))[0]; };
      cv.addEventListener('mousemove', ev => { const h = near(ev); cv.style.cursor = h ? 'pointer' : 'default';
        if (!h) { tip.style.display = 'none'; return; } const r = cv.getBoundingClientRect();
        tip.innerHTML = h.tip.map((l, i) => i ? esc(l) : '<b>' + esc(l) + '</b>').join('<br>') + '<br><i>Click: show it in Procedures</i>'; tip.style.display = 'block';
        tip.style.left = Math.min(ev.clientX - r.left + 12, r.width - 270) + 'px'; tip.style.top = (ev.clientY - r.top + 10) + 'px'; });
      cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      cv.addEventListener('click', ev => { const h = near(ev); if (h) show(h.id); }); }
    box.style.display = '';
    const cv = box.querySelector('canvas'), wpx = mcv.clientWidth, H = 34, dpr = window.devicePixelRatio || 1;
    cv.style.width = wpx + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(wpx * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, wpx, H);
    const items = layerItems(), X = t => x.getPixelForValue(pos(Math.min(Math.max(t, W.a), W.b)));
    layerHits = [];
    // label in the narrow strip left of the axis (as wide as the Moments track's own margin)
    ctx.textAlign = 'right'; ctx.font = '600 9px system-ui'; ctx.fillStyle = css('--ink'); ctx.fillText('Selected', A.left - 4, 14);
    ctx.font = '10px system-ui'; ctx.fillStyle = css('--muted'); ctx.fillText(items.filter(i => i.kind !== 'bar').length + ' pts', A.left - 4, 27); ctx.textAlign = 'start';
    ctx.strokeStyle = css('--line'); ctx.beginPath(); ctx.moveTo(A.left, 17.5); ctx.lineTo(A.right, 17.5); ctx.stroke();
    // bars first (bottom), then visit dots (top row), fraction ticks, then procedure keyframes on the centre line
    items.filter(i => i.kind === 'bar').forEach(i => { const x0 = X(i.t), x1 = Math.max(X(i.t1), x0 + 3);
      ctx.fillStyle = i.col; ctx.globalAlpha = .45; ctx.fillRect(x0, 25, x1 - x0, 5); ctx.globalAlpha = 1; layerHits.push({x0, x1, y0: 22, y1: 33, pri: 1, id: i.id, tip: i.tip}); });
    items.filter(i => i.kind === 'dot').forEach(i => { const px = X(i.t); ctx.fillStyle = i.col; ctx.globalAlpha = .8; ctx.fillRect(px - 1.5, 3, 3, 4); ctx.globalAlpha = 1; layerHits.push({x0: px - 2, x1: px + 2, y0: 0, y1: 9, pri: 2, id: i.id, tip: i.tip}); });
    items.filter(i => i.kind === 'tick').forEach(i => { const px = X(i.t); ctx.fillStyle = i.col; ctx.fillRect(px - .75, 11, 1.5, 13); layerHits.push({x0: px - 1, x1: px + 1, y0: 9, y1: 25, pri: 2, id: i.id, tip: i.tip}); });
    items.filter(i => i.kind === 'key').forEach(i => { const px = X(i.t); ctx.fillStyle = i.col; ctx.strokeStyle = css('--card'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, 11); ctx.lineTo(px + 6, 17.5); ctx.lineTo(px, 24); ctx.lineTo(px - 6, 17.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (picked === i.id) { ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.stroke(); }
      layerHits.push({x0: px - 6, x1: px + 6, y0: 9, y1: 26, pri: 3, id: i.id, tip: i.tip}); });
    if (hoverX != null) { const px = x.getPixelForValue(hoverX); if (px >= A.left && px <= A.right) { ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); ctx.setLineDash([]); } }
  }

  /* ================= plug into the viewer's hooks ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => typeof id === 'string' && id.startsWith('proc:');
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? PANELS[id].unit : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); BODIES.set(id, body); (id === IDT ? drawTimeline : drawList)(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); const b = BODIES.get(id); if (b && b.isConnected) (id === IDT ? drawTimeline : drawList)(id, b); };

  /* Library: Procedures → Panels (over time, list) + one group per lane; tick = moment line on every chart */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = 'procedures surgery surgeries biopsy port line lumbar puncture ' + P.events.map(e => e.short + ' ' + e.procedure).join(' ').toLowerCase();
    if (q && !hay.includes(q)) return;
    const ids = [IDT, IDL], k = ids.filter(i => sel.includes(i)).length;
    const SEC = section(el, 'proc', 'Procedures', P.events.length + ' · ' + P.planned.length + ' planned', true, 'sec', q);
    const s0 = SEC.firstChild;
    s0.insertBefore(miniBtn('All', 'Show both procedure panels', () => setLabSel(ids, true)), s0.lastChild);
    s0.insertBefore(miniBtn('None', 'Hide both procedure panels', () => setLabSel(ids, false)), s0.lastChild);
    s0.insertBefore(groupOnlyBtn('procedure panel', 'grp:proc', ids, soloLab && soloLab.key === 'grp:proc', !!(soloLab && soloLab.key.startsWith('id:proc:')), () => onlyLab('grp:proc', ids, 'Procedures')), s0.lastChild);
    const G = section(SEC, 'proc:panels', 'Panels', k ? k + '/2' : '2', true, 'grp', q);
    panelBtns(G, 'procedure panel', 'grp:proc:panels', ids, 'Procedure panels');
    const prow = (id, label, count, tip) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(id); cb.setAttribute('aria-label', 'Show ' + PANELS[id].title);
      cb.onclick = e => { e.stopPropagation(); setLabSel([id], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      const only = onlyBtn('Show only ' + PANELS[id].title, () => onlyLab('id:' + id, [id], PANELS[id].title), soloLab && soloLab.key === 'id:' + id);
      d.append(cb, nm, only, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([id], cb.checked); };
      G.append(d);
    };
    prow(IDT, 'Procedures over time', LANES.length + ' lanes', 'Every procedure on the shared time axis; ports and lines as bars while they are in the body');
    prow(IDL, 'Procedure list', P.events.length + ' rows', 'The same procedures as a table with results and sources');
    // one group per lane; tick = moment line on every chart, name = select it on the timeline
    order.map(k => LANES.find(l => l.key === k)).forEach(l => {
      if (l.key.startsWith('rt-')) {   // each radiation course: tick = moment line (shaded for the course) on every chart
        const cs = RTC.filter(c => c.lane === l.key); if (!cs.length) return; const n = cs.filter(c => ticked.has(c.id)).length;
        const L = section(SEC, 'proc:lane:' + l.key, l.label + (hidden.has(l.key) ? ' (lane hidden)' : ''), (n ? n + '/' : '') + cs.length + ' · ' + cs.reduce((a, c) => a + c.n, 0) + ' fx', false, 'grp', q), s0 = L.firstChild;
        s0.insertBefore(miniBtn('All', 'Put every course on all charts', () => setTicked(cs.map(c => c.id), true)), s0.lastChild);
        s0.insertBefore(miniBtn('None', 'Remove these keyframe lines', () => setTicked(cs.map(c => c.id), false)), s0.lastChild);
        laneOnly(s0, l.key, cs.map(c => c.id), 'course');
        cs.forEach(c => { const d = document.createElement('div'); d.className = 't';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = ticked.has(c.id); cb.title = 'Keyframe line on every chart';
          cb.onclick = ev => { ev.stopPropagation(); setTicked([c.id], cb.checked); };
          const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.label + ' · ' + c.n + ' fx'; nm.title = c.dose + ' · ' + c.where + '\nClick: show it on the Procedures timeline';
          const nn = document.createElement('span'); nn.className = 'n'; nn.textContent = c.from.slice(0, 7);
          d.append(cb, nm, nn); d.onclick = () => show(c.id); L.append(d); });
        return; }
      if (l.key === 'stay' && STAYS.length) {   // each stay / ER visit: tick = moment line (shaded for the length of the stay) on every chart
        const n = STAYS.filter(s => ticked.has(s.id)).length;
        const L = section(SEC, 'proc:lane:stay', l.label + (hidden.has('stay') ? ' (lane hidden)' : ''), (n ? n + '/' : '') + STAYS.length, false, 'grp', q), s0 = L.firstChild;
        s0.insertBefore(miniBtn('All', 'Put every hospital stay on all charts', () => setTicked(STAYS.map(s => s.id), true)), s0.lastChild);
        s0.insertBefore(miniBtn('None', 'Remove these keyframe lines', () => setTicked(STAYS.map(s => s.id), false)), s0.lastChild);
        laneOnly(s0, 'stay', STAYS.map(s => s.id), 'stay');
        STAYS.forEach(s => { const d = document.createElement('div'); d.className = 't';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = ticked.has(s.id); cb.title = 'Keyframe line on every chart';
          cb.onclick = ev => { ev.stopPropagation(); setTicked([s.id], cb.checked); };
          const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (SK[s.kind] || s.kind) + ' · ' + (SNAME[s.site] || s.site) + (s.kind === 'er' ? '' : ' · ' + days(s.from, s.to) + ' d');
          nm.title = s.location + '\nClick: show it on the Procedures timeline';
          const nn = document.createElement('span'); nn.className = 'n'; nn.textContent = s.from.slice(0, 7);
          d.append(cb, nm, nn); d.onclick = () => show(s.id); L.append(d); });
        return; }
      if (l.key === 'visit' && VISITS.length) {   // one row per visit type: tick = show those visits on the timeline
        const L = section(SEC, 'proc:lane:visit', l.label + (hidden.has('visit') ? ' (lane hidden)' : ''), VISITS.filter(v => !vtOff.has(v.sub)).length + '/' + VISITS.length, false, 'grp', q), s0 = L.firstChild;
        const setVT = (keys, show) => { keys.forEach(k => show ? vtOff.delete(k) : vtOff.add(k)); store.set('proc.vtOff', [...vtOff]); redrawAll(); };
        s0.insertBefore(miniBtn('All', 'Show every kind of visit', () => setVT(VT.map(v => v.key), true)), s0.lastChild);
        s0.insertBefore(miniBtn('None', 'Hide every kind of visit', () => setVT(VT.map(v => v.key), false)), s0.lastChild);
        VT.forEach(v => { const cnt = VISITS.filter(x => x.sub === v.key).length; if (!cnt) return;
          const d = document.createElement('div'); d.className = 't';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !vtOff.has(v.key); cb.title = 'Show these visits on the timeline';
          cb.onclick = ev => { ev.stopPropagation(); setVT([v.key], cb.checked); };
          const nm = document.createElement('span'); nm.className = 'nm'; nm.innerHTML = `<svg width="8" height="8" style="margin-right:4px"><rect width="8" height="8" fill="${v.color}"/></svg>`; nm.append(v.label);
          const nn = document.createElement('span'); nn.className = 'n'; nn.textContent = cnt;
          d.append(cb, nm, nn); d.onclick = () => { cb.checked = !cb.checked; setVT([v.key], cb.checked); }; L.append(d); });
        return; }
      const evs = P.events.filter(e => e.lane === l.key && e.date), pls = P.planned.filter(p => p.lane === l.key), early = P.events.filter(e => e.lane === l.key && !e.date);
      if (!evs.length && !pls.length && !early.length) return;
      const on = evs.filter(e => ticked.has(e.id)).length;
      const L = section(SEC, 'proc:lane:' + l.key, l.label, (on ? on + '/' : '') + (evs.length + early.length), l.key === 'surgery', 'grp', q);
      const s = L.firstChild;
      s.insertBefore(miniBtn('All', 'Put every ' + l.label.toLowerCase() + ' on all charts as a keyframe line', () => setTicked(evs.map(e => e.id), true)), s.lastChild);
      s.insertBefore(miniBtn('None', 'Remove these keyframe lines', () => setTicked(evs.map(e => e.id), false)), s.lastChild);
      if (evs.length) laneOnly(s, l.key, evs.map(e => e.id), 'procedure');
      const item = (e, dated) => {
        const d = document.createElement('div'); d.className = 't';
        const sw = document.createElement('span'); sw.innerHTML = `<svg width="10" height="10" style="vertical-align:-1px"><rect width="10" height="10" rx="2" fill="${LCOL[l.key]}"/></svg>`;
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.short; nm.title = (e.procedure || e.note) + '\nClick: show it on the Procedures timeline';
        const n = document.createElement('span'); n.className = 'n'; n.textContent = e.date ? e.date.slice(0, 7) : e.date_text ? e.date_text.slice(0, 9) : 'planned';
        if (dated) { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = ticked.has(e.id);
          cb.title = 'Keyframe line on every chart'; cb.setAttribute('aria-label', 'Keyframe line for ' + e.short);
          cb.onclick = ev => { ev.stopPropagation(); setTicked([e.id], cb.checked); }; d.append(cb); }
        else { const sp = document.createElement('span'); sp.style.cssText = 'display:inline-block;width:13px'; d.append(sp); }
        d.append(nm, n); if (!e.date && !dated) nm.style.fontStyle = 'italic';
        d.onclick = () => show(e.id); L.append(d);
      };
      evs.forEach(e => item(e, true)); early.forEach(e => item(e, false)); pls.forEach(p => item(p, false));
    });
  };

  syncMoments(); (window.momentSyncers = window.momentSyncers || []).push(syncMoments);   // again after the shared edits load
  const saved = store.get('selected', []);
  if (saved.some(mine)) { sel = saved.filter(id => BYID[id] || MRD.isId(id)); }
  updateBar(); list(); render();
})();
