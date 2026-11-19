/* Volume trends and doubling times for Imaging -> Brain MRI -> Lesions over time (the panel itself is in imaging_view.js).
   Loaded before imaging_view.js by make_lab_view.py; exposes window.LesionTrends.draw(id, body, view, viewBar, rerender, sel):
     sel = {get() -> [hidden lesion ids], set(ids)}: the panel's lesion selection, shared by all its views (the lesion buttons are
           LesionChips.row from lesion_chips.js, the same component every imaging panel uses)
     view 'volume'  = one line per lesion through our measured enhancing volumes (mm³), log or linear; Total on/off;
                      lesion chips with the latest rate; optional fitted steady-% trend in the time window with
                      doubling/halving labels and a table; hover = change and rate since the previous scan
     view 'periods' = doubling or halving time of each lesion in each treatment period
     'Before first scan' (volume view) = each first-scan lesion carried backwards at the doubling times measured later, to estimate when
                      it became visible; 'Projection' = each lesion on the latest scan carried forward 1-3 months at its latest rate,
                      with how that did on the past scans (both computed by imaging/volumetry/growth_model.py: IMG_DATA.growth).
                      The projection is drawn on the chart itself, on the shared time axis. Its switch and its dates (+1, +2, +3
                      months: amber date lines in every panel) are shared with the other imaging panels (projection_dates.js);
                      switching it on lengthens the axis when it stops short (navigation bar: Future)
   Everything about the patient comes from IMG_DATA.lesion_series and IMG_DATA.growth, never from this code.
   Data used: lesion_series.lesions [{id,name,rgb}], measured [{lesion,date,enh_mm3,axial_mm,field,seq,seq_name,lo,hi,conf,flags,alt?,none?,note?,range_why?}]
              (lo/hi = likely range, conf = ok|low, flags = cut/shared/faint/tiny, alt = a second series of the same visit; volumetry/quality.py;
              note = a line for that point's tooltip, range_why = what its range covers when that is more than the seed's place),
              treatments [{start,end,treatment,lesions,confidence}]; brain_mri [{date,partial}] for partial scans;
              unmeasured [{date,hospital,field,why,needs,report}] = brain MRIs with no measured point (drawn as a grey diamond on a dotted
              line at the scan's date, so no scan is silently absent); not_outlined {date: [ids]} = lesions the report describes on a
              measured scan that we could not outline (named in that date's Total hover box: the total is a lower bound);
              states [{lesion,date,none,below: not_seen|tiny,note,...}] = a lesion's state on a measured scan where it has no outline:
              its line drops to the bottom of the plot there (x mark), so it never runs straight across scans where the lesion had
              shrunk away; seen_not_outlined [{lesion,date,why}] = seen on that scan but not outlinable: a hollow square on its line;
              provisional [{lesion,date,enh_mm3,lo,hi,axial_mm,conf,flags,field,note,source}] = volumes taken on a copy that is not the
              hospital's files: a star on the lesion's line with dashed stretches, never part of a fit, a rate or a projection. */
(() => {
  const LS = IMG_DATA.lesion_series;
  if (!LS || !LS.measured || !LS.measured.length) return;
  const H0 = 380;
  const V0 = {total: true, scale: 'linear', fit: 'window', hidden: [], tx: true, back: false, psc: 'full'};   // opens with the total and the fitted trends (doubling times) showing
  const GR = IMG_DATA.growth || {};
  const PJ = GR.projection && GR.projection.lesions && GR.projection.lesions.length ? GR.projection : null;   // forward scenarios
  const BC = GR.backcast || null;                                                                              // start-of-growth estimate
  const V = Object.assign({}, V0, store.get('mrit.view', {}), store.get('img.trends', {}));   // mrit.view = saved while this was the MRI (test) section
  if (V.show) { V.total = V.show !== 'each'; if (V.show === 'total') V.hidden = LS.lesions.map(l => l.id); delete V.show; }   // older saved setting
  delete V.view; delete V.proj;   // Projection on/off is one switch for all imaging panels since 2026-11-18 (projection_dates.js), not kept here
  const PON = () => !!(PJ && window.Projection && Projection.on);
  const save = () => store.set('img.trends', V);
  let SEL = null;                                   // the panel's shared lesion selection (set on each draw); without it the choice is kept here
  const setHidden = h => { V.hidden = h; if (SEL) SEL.set(h); save(); };
  const LCOL = Object.fromEntries(LS.lesions.map(l => [l.id, 'rgb(' + l.rgb + ')']));
  const LNAME = Object.fromEntries(LS.lesions.map(l => [l.id, l.name]));
  const PARTIAL = new Set((IMG_DATA.brain_mri || []).filter(r => r.partial).map(r => r.date));
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const fv = v => v >= 1000 ? (v / 1000).toFixed(2) + ' cm³' : Math.round(v) + ' mm³';
  const fdays = d => Math.abs(d) >= 365 ? (Math.abs(d) / 365.25).toFixed(1) + ' yr' : Math.abs(d) >= 60 ? (Math.abs(d) / 30.44).toFixed(1) + ' mo' : Math.round(Math.abs(d)) + ' d';
  const shape = f => f === '3T' ? 'triangle' : 'circle';
  const shown = () => LS.lesions.filter(l => !V.hidden.includes(l.id) && LS.measured.some(m => m.lesion === l.id && !m.none));
  let redraw = () => {};   // set on each draw: the panel's own redraw (keeps the shared view buttons)

  if (!document.getElementById('ltrCss')) { const st = document.createElement('style'); st.id = 'ltrCss';
    st.textContent = '.ltr-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:6px}' +
      '.ltr-bar .lab{color:var(--muted);font-size:11px;margin-left:6px}' +
      '.ltr-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.ltr-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.ltr-chip{font-size:11px;padding:0 7px;border-radius:9px;border:2px solid;background:transparent;cursor:pointer;font-weight:600}.ltr-chip.off{opacity:.35;border-style:dashed}' +
      '.ltr-tbl{border-collapse:collapse;font-size:11.5px;margin-top:6px}.ltr-tbl td,.ltr-tbl th{padding:2px 8px;border-bottom:1px solid var(--line);text-align:right}.ltr-tbl th{color:var(--ink2);font-weight:600}.ltr-tbl td:first-child,.ltr-tbl th:first-child{text-align:left}' +
      '.ltr-nw td,.ltr-nw th{white-space:nowrap}.ltr-tbl.ltr-nar td,.ltr-tbl.ltr-nar th{padding:2px 4px}.ltr-tbl.ltr-nar td{vertical-align:middle}.ltr-up{color:#e34948}.ltr-dn{color:#1baf7a}.ltr-chip small{font-weight:500;margin-left:4px;font-size:10px}' +
      '.ltr-per td{vertical-align:top}.ltr-per td small{display:block;color:var(--muted);font-size:10px}.ltr-per .tg{color:#6250d6;font-weight:700}.ltr-per td.na{color:var(--muted)}';
    document.head.append(st); }

  /* points per lesion, sorted by date; "none" = our check found nothing there (0) */
  const MALL = LS.measured.concat(LS.states || []);   // states = "not seen" / "too small to outline" rows on measured scans (lesion_series.py)
  const ptsOf = id => MALL.filter(m => m.lesion === id).map(m => ({t: ms(m.date), date: m.date, v: m.none ? 0 : m.enh_mm3, m}))
    .sort((a, b) => a.t - b.t);
  /* Of a run of scans on which a lesion was not seen (or was too small to outline), keep the first and the last: the line drops at the first
     and rises again from the last. run = how many scans, from when to when (for the hover box). */
  const runEnds = pts => { const out = []; let i = 0;
    while (i < pts.length) { if (pts[i].v > 0) { out.push(pts[i++]); continue; }
      let j = i; while (j + 1 < pts.length && !(pts[j + 1].v > 0)) j++;
      const run = {n: j - i + 1, from: pts[i].date, to: pts[j].date};
      out.push(Object.assign({}, pts[i], {run})); if (j > i) out.push(Object.assign({}, pts[j], {run})); i = j + 1; }
    return out; };
  /* total per scan date over the lesions shown (a scan that measured fewer lesions than usual is marked partial) */
  function totals(S) {
    const by = new Map();
    LS.measured.filter(m => !m.none && S.some(l => l.id === m.lesion)).forEach(m => {
      const e = by.get(m.date) || {date: m.date, t: ms(m.date), v: 0, n: 0, field: m.field, seq: m.seq, seq_name: m.seq_name, lo: 0, hi: 0};
      e.v += m.enh_mm3; e.lo += m.lo != null ? m.lo : m.enh_mm3; e.hi += m.hi != null ? m.hi : m.enh_mm3; e.n++; by.set(m.date, e); });
    return [...by.values()].sort((a, b) => a.t - b.t).map(e => Object.assign(e, {partial: PARTIAL.has(e.date)}));
  }
  /* least-squares line through log(volume) vs time for the points inside the window: rate per day, doubling/halving time */
  function fitLog(pts, a = W.a, b = W.b) {
    const p = pts.filter(q => q.v > 0 && q.t >= a && q.t <= b); if (p.length < 2) return null;
    const n = p.length, mx = p.reduce((s, q) => s + q.t, 0) / n, my = p.reduce((s, q) => s + Math.log(q.v), 0) / n;
    let sxx = 0, sxy = 0; p.forEach(q => { sxx += (q.t - mx) ** 2; sxy += (q.t - mx) * (Math.log(q.v) - my); });
    if (!sxx) return null; const k = sxy / sxx * DAY;   // per day
    const f = t => Math.exp(my + sxy / sxx * (t - mx));
    const fs = new Set(p.map(q => q.field || (q.m && q.m.field)).filter(Boolean)), ss = new Set(p.map(q => q.seq || (q.m && q.m.seq)).filter(Boolean));
    const lowc = p.filter(q => (q.conf || (q.m && q.m.conf)) === 'low').length, why = [];
    if (fs.size > 1) why.push('1.5T and 3T scans mixed');
    if (ss.size > 1) why.push('different sequence types mixed (' + [...ss].join(', ') + ')');
    if (lowc) why.push(lowc + ' low-confidence point' + (lowc > 1 ? 's' : '') + ' (tiny, faint or seed-sensitive)');
    if (n === 2) why.push('only 2 scans');
    /* weak = the scans are not like for like or lean on low-confidence points; shown with a warning mark, not hidden */
    return {k, n, t0: p[0].t, t1: p[n - 1].t, f, dbl: k ? Math.LN2 / k : Infinity, last: p[n - 1], mixed: fs.size > 1, why, weak: fs.size > 1 || ss.size > 1 || lowc > 0};
  }
  /* rate wording: k = growth per day on the log scale */
  const MINGAP = 14;   // days: two scans closer than this give no step rate (scanner and outline noise outweigh real change)
  const rateTxt = (k, short) => !k || !isFinite(k) || Math.abs(Math.LN2 / k) > 3650 ? 'flat' : (k > 0 ? (short ? '↑' : '×2 in ') : (short ? '↓' : '½ in ')) + fdays(Math.LN2 / k).replace(' ', short ? '' : ' ');
  const perMonth = k => { const pm = (Math.exp(k * 30.44) - 1) * 100; return (pm > 0 ? '+' : '') + (Math.abs(pm) >= 100 ? pm.toFixed(0) : pm.toFixed(1)) + '%/mo'; };
  const upCls = k => k > 0 ? 'ltr-up' : 'ltr-dn';
  const WARN = '⚠';
  const whyTxt = f => f && f.why && f.why.length ? f.why.join('; ') : '';
  /* what each quality flag means, in words (quality.py) */
  const FLAGW = {cut: 'cut off by its search ball (a vein, sinus or neighbouring lesion continues beyond it): a lower bound',
    shared: 'touches a neighbouring lesion: where one ends and the other starts is a judgment', faint: 'faint (peak under 1.6× brain): the edge is uncertain',
    tiny: 'tiny (under 30 mm³, about 2–4 mm): at the limit of 1 mm images'};
  /* treatment periods: each starts at the last scan before the treatment (the baseline it is judged against) and runs
     until the next treatment starts; a scan just before a treatment therefore ends one period and starts the next */
  const TX = (LS.treatments || []).slice().sort((a, b) => a.start < b.start ? -1 : 1);
  const SCANT = [...new Set(LS.measured.map(m => m.date))].sort().map(ms);
  const PERIODS = TX.map((t, i) => { const s = ms(t.start), before = SCANT.filter(x => x < s).pop();
    return {t, a: before == null ? s : before, b: i + 1 < TX.length ? ms(TX[i + 1].start) - 1 : Infinity,
      label: 'After ' + (/whole-brain/i.test(t.treatment) ? 'WBRT' : 'SRS') + ' ' + t.start.slice(0, 4), wb: /whole-brain/i.test(t.treatment)}; });
  const periodFit = (pts, P) => fitLog(pts, P.a, P.b);
  /* latest rate of a lesion: fit over the last treatment period that has 2+ points (else null) */
  const latest = id => { const pts = ptsOf(id).map(p => Object.assign({field: p.m.field}, p)); for (let i = PERIODS.length - 1; i >= 0; i--) { const f = periodFit(pts, PERIODS[i]); if (f) return Object.assign(f, {P: PERIODS[i]}); } return null; };

  const txPlugin = {id: 'ltrTx', beforeDatasetsDraw(c) { if (!V.tx) return; const {ctx, chartArea: a, scales: {x}} = c;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    (LS.treatments || []).forEach(t => { let x0 = x.getPixelForValue(pos(ms(t.start))), x1 = x.getPixelForValue(pos(ms(t.end)));
      if (x1 - x0 < 6) { const m = (x0 + x1) / 2; x0 = m - 3; x1 = m + 3; }
      const wb = /whole-brain/i.test(t.treatment);
      ctx.fillStyle = wb ? 'rgba(237,161,0,0.22)' : 'rgba(98,80,214,0.16)'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.fillStyle = wb ? '#c98a00' : '#6250d6'; ctx.font = 'bold 10px system-ui'; ctx.fillText(wb ? 'WBRT' : 'SRS', x0 + 2, a.top + 10); });
    ctx.restore(); }};
  const guide = {id: 'ltrGuide', afterDatasetsDraw(c) { if (hoverX == null) return; const {ctx, chartArea: a, scales: {x}} = c, px = x.getPixelForValue(hoverX);
    if (px < a.left || px > a.right) return; ctx.save(); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore(); }};
  function xAxis() { const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? (k.brk ? css('--ink2') : css('--line')) : 'transparent'; }}}; }

  /* the badge on a lesion's button: its latest rate (last treatment period with 2+ scans). Grey when the projection model says the
     likely ranges of the volumes behind it overlap (no clear change), so a button never claims growth the scans cannot show. */
  const LASTD = LS.measured.reduce((m, r) => r.date > m ? r.date : m, '');   // the latest measured scan
  function chipBadge(id) {
    const lf = latest(id); if (!lf) return null;
    const pj = PJ && PJ.lesions.find(r => r.id === id), unclear = !!(pj && pj.rate && pj.rate.unclear);
    const flat = !lf.k || !isFinite(lf.k) || Math.abs(Math.LN2 / lf.k) > 3650, stale = lf.last.date < LASTD;
    return {text: unclear ? 'no clear change' : flat ? 'flat' : fdays(Math.LN2 / lf.k), dir: flat || unclear ? 'flat' : lf.k > 0 ? 'up' : 'down', weak: lf.weak && !unclear, stale,
      tip: (stale ? 'Not measured on the latest scan (' + fd(LASTD) + '): last seen ' + fd(lf.last.date) + '\n' : '') +
        'Latest: ' + rateTxt(lf.k) + ' (' + perMonth(lf.k) + ') ' + lf.P.label.toLowerCase() + ', ' + lf.n + ' scans' +
        (unclear ? '\nNo clear change: the likely ranges of the volumes behind this rate overlap' : '') + (lf.weak ? '\n' + WARN + ' read loosely: ' + whyTxt(lf) : '')};
  }
  /* hover-box text: long sentences from the data are wrapped by hand (the chart library does not wrap) */
  let TIPN = 76;   // characters across a hover box: 76, fewer on a narrow chart (set each time a hover box is built)
  const wrapLines = (t, n = TIPN) => { const out = []; let line = ''; String(t).split(/\s+/).forEach(w => { if (line && (line + ' ' + w).length > n) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; });
    if (line) out.push(line); return out; };
  /* a hover box is drawn inside the chart, so on a narrow chart (a phone) every line is wrapped to what fits across it:
     tipFit = characters that fit; fitTip wraps whatever is still longer (on a wide chart nothing changes) */
  const tipFit = ch => Math.max(24, Math.floor(((ch && ch.width) || 900) / 6.6) - 5);
  const fitTip = (lines, ch) => { const n = tipFit(ch); return [].concat(lines || []).reduce((o, l) => o.concat(String(l).length > n ? wrapLines(l, n) : [l]), []); };
  /* a brain MRI with no measured point: why, what the report found (with the sizes it gave), what is needed. All from the data. */
  function unmTip(u) {
    const sizes = (LS.reports || []).filter(r => r.date === u.date && r.kind === 'size' && r.mm > 0 && !r.ambiguous).map(r => r.lesion + ' ' + r.mm + ' mm');
    return [(u.hospital || 'Brain MRI') + (u.field ? ' · ' + u.field : '')].concat(
      wrapLines('Not measured: ' + u.why),
      u.report ? wrapLines('About this scan: ' + u.report + '.') : [],
      sizes.length ? wrapLines('Sizes its report gives: ' + sizes.join(', ') + ' (drawn in the Report sizes view).') : [],
      u.needs ? wrapLines('To measure it we need ' + u.needs + '.') : [],
      (LS.provisional || []).some(p => p.date === u.date) ? wrapLines('The stars on this date are provisional volumes, measured on a copy rebuilt from the pictures on the hospital\'s website.') : [],
      (() => { const po = (LS.provisional_other || []).filter(p => p.date === u.date); if (!po.length) return [];   // that copy's verdicts for the lesions without a volume
        const gone = po.filter(p => /gone/.test(p.verdict)).map(p => p.lesion), rest = po.filter(p => !/gone/.test(p.verdict)).map(p => p.lesion);
        return wrapLines('On that copy: ' + [gone.length ? gone.join(', ') + ' gone' : '', rest.length ? rest.join(', ') + ' could not be measured' : ''].filter(Boolean).join('; ') + '.'); })());
  }
  /* what a measured date's total leaves out: lesions seen but not outlined, and ones too small to outline (lesion_series.not_outlined). An entry is
     one lesion or the candidates of one ambiguous mention ("L12/L13/L14"); kept when any of them is among the lesions shown. */
  const shownIn = (list, S) => (list || []).filter(e => !S.length || e.split('/').some(i => S.some(l => l.id === i)));
  const notOut = (date, S) => { const n = (LS.not_outlined || {})[date]; if (!n) return [];
    const seen = shownIn(n.seen, S), pin = shownIn(n.tiny, S); if (!seen.length && !pin.length) return [];
    return wrapLines('Not in this total: ' + [seen.length ? seen.join(', ') + ' (seen, could not be outlined)' : '', pin.length ? pin.join(', ') + ' (too small to outline)' : ''].filter(Boolean).join('; ') +
      '. The total is a lower bound.'); };
  /* hover box of an x on the bottom line: every lesion shown that was not seen, or was too small to outline, on that scan; for a single mark
     also that lesion's own reason and how many scans in a row */
  function censTip(c, S) { if (!c.length) return [];
    const d = c[0].date, ids = new Set(S.map(l => l.id)), rows = MALL.filter(m => m.none && m.date === d && ids.has(m.lesion));
    const no = rows.filter(m => m.below !== 'tiny').map(m => m.lesion), pinIds = rows.filter(m => m.below === 'tiny').map(m => m.lesion);
    const grp = shownIn(((LS.not_outlined || {})[d] || {}).tiny, S), pin = grp.length ? grp : pinIds, out = [];
    if (no.length) out.push(...wrapLines('Not seen on this scan: ' + no.join(', ')));
    if (pin.length) out.push(...wrapLines('In the report, but too small for us to outline (a pinpoint or a thin streak): ' + pin.join(', ')));
    if (c.length === 1) { const r = c[0]; if (r.m.note) out.push(...wrapLines(r.lesion + ' · ' + r.m.note + '.'));
      if (r.run && r.run.n > 1) out.push('The same on ' + r.run.n + ' scans in a row, ' + fd(r.run.from) + ' – ' + fd(r.run.to) + '.'); }
    out.push('The line drops to the bottom of the plot: under about 3 mm, not a measured zero.');
    return out; }
  /* hover box of a star: a provisional volume (or the total of them), with where it comes from and what it is not used for */
  const PROVNOTE = 'Provisional: not used for the trends, rates or projections; to be replaced when the hospital\'s own files arrive.';
  function provTip(r, st) {
    if (r.total) return ['Total ' + fv(r.v) + ' · ' + r.n + ' lesion' + (r.n > 1 ? 's' : '') + ' · provisional · ' + r.field].concat(
      r.hi > r.lo ? ['likely range ' + fv(r.lo) + ' – ' + fv(r.hi) + ' (each lesion\'s range added up)'] : [],
      wrapLines('Measured on ' + ((LS.provisional || [])[0] || {}).source + '. A lower bound: lesions that could not be measured on it are left out.'), st, [PROVNOTE]);
    const q = r.prov;
    return [r.lesion + ' ' + fv(r.v) + ' · provisional · ' + q.field + (q.axial_mm ? ' · ' + q.axial_mm + ' mm wide' : ''), LNAME[r.lesion]].concat(
      q.hi > q.lo ? ['likely range ' + fv(q.lo) + ' – ' + fv(q.hi) + ' (if the seed sat a few mm elsewhere)'] : [],
      wrapLines('Measured on ' + q.source + '.'), q.note ? wrapLines(q.note[0].toUpperCase() + q.note.slice(1) + '.') : [], st, [PROVNOTE]); }
  /* hover box of a hollow square: the lesion was seen on that scan but could not be outlined */
  const seenTip = r => [r.lesion + ' seen on this scan, not outlined' + (r.seen.field ? ' · ' + r.seen.field : ''), LNAME[r.lesion]].concat(
    wrapLines(r.seen.why[0].toUpperCase() + r.seen.why.slice(1) + '.'), ['No volume. The square sits on the line between the neighbouring scans.']);
  function toolbar(body, view) {
    const bar = document.createElement('div'); bar.className = 'ltr-bar';
    const grp = (label, key, opts) => { const s = document.createElement('span'); s.className = 'lab'; s.textContent = label; bar.append(s);
      opts.forEach(([val, txt, tip]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ltr-b' + (V[key] === val ? ' on' : ''); b.textContent = txt; b.title = tip;
        b.onclick = () => { V[key] = val; save(); redraw(); }; bar.append(b); }); };
    if (view !== 'periods') grp('Scale', 'scale', [['log', 'Log', 'Log scale: equal steps = equal % change; small lesions stay readable'], ['linear', 'Linear', 'Plain mm³']]);
    if (view !== 'periods') grp('Trend', 'fit', [['off', 'Off', 'No fitted trend'], ['window', 'Fit in window', 'Fit a steady-% trend (straight on the log scale) to the points inside the time window; zoom or move the window to fit a stretch, e.g. after the last treatment']]);
    const tot = document.createElement('button'); tot.type = 'button'; tot.className = 'ltr-b' + (V.total ? ' on' : ''); tot.textContent = 'Total: ' + (V.total ? 'on' : 'off');
    tot.title = 'Show or hide the total line: the lesions ticked below, added up per scan (with every lesion hidden, it adds up all of them)';
    tot.onclick = () => { V.total = !V.total; save(); redraw(); }; bar.prepend(tot);
    const tx = document.createElement('button'); tx.type = 'button'; tx.className = 'ltr-b' + (V.tx ? ' on' : ''); tx.textContent = 'Treatments'; tx.title = 'Show radiation courses as bands';
    tx.onclick = () => { V.tx = !V.tx; save(); redraw(); }; bar.append(tx);
    const tog = (key, label, tip) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ltr-b' + (V[key] ? ' on' : ''); b.textContent = label; b.title = tip;
      b.onclick = () => { V[key] = !V[key]; save(); redraw(); }; bar.append(b); };
    if (view !== 'periods' && BC) tog('back', 'Before first scan', 'Estimate of the growth before the first scan with lesions: each lesion carried backwards at the doubling times measured later, down to the size a scan can show. Dotted = an estimate, not a measurement.');
    if (view !== 'periods' && PJ && window.Projection) bar.append(Projection.button('What each lesion on the latest scan would measure in 1, 2 and 3 months if its latest rate carried on, and how that kind of projection did on the past scans. A scenario, not a forecast.'));
    body.append(bar);
    const ids = LS.lesions.filter(l => LS.measured.some(m => m.lesion === l.id && !m.none)).map(l => l.id);
    body.append(LesionChips.row({ids, color: i => LCOL[i], name: i => LNAME[i], hidden: V.hidden, badge: chipBadge,
      onChange: h => { setHidden(h); redraw(); }, noneTip: 'Hide every lesion line (with Total on, only the total is left)',
      badgeNote: 'badge = latest rate: ↑ doubling time · ↓ halving time · grey = no clear change · faded = not on the latest scan'}));
  }

  /* tooltip lines: change since the previous scan, as a rate */
  function step(r) {
    const q = r.prev; if (!q || !(r.v > 0)) return [];
    const d = (r.t - q.t) / DAY, short = new Date(q.t).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
    /* like for like: if the two scans use different sequence types and one visit also has a series of the other's type, compare those */
    let rv = r.v, qv = q.v, like = '';
    if (r.seq && q.seq && r.seq !== q.seq && !r.total) {
      const qa = q.m && q.m.alt && q.m.alt.find(a => a.seq === r.seq), ra = r.m && r.m.alt && r.m.alt.find(a => a.seq === q.seq);
      if (qa) { qv = qa.enh_mm3; like = 'like for like: the ' + qa.seq_name + ' series of the ' + short + ' visit read ' + fv(qa.enh_mm3); }
      else if (ra) { rv = ra.enh_mm3; like = 'like for like: the ' + ra.seq_name + ' series of this visit reads ' + fv(ra.enh_mm3); }
    }
    const warn = [];
    if (q.field !== r.field) warn.push(WARN + ' ' + q.field + ' → ' + r.field + ': part of this change may be the scanner');
    if (r.seq && q.seq && r.seq !== q.seq && !like) warn.push(WARN + ' ' + (q.seq_name || q.seq) + ' → ' + (r.seq_name || r.seq) + ': a different sequence type (small lesions can read about 2× differently)');
    if (r.conf === 'low' || q.conf === 'low') warn.push(WARN + ' ' + (r.conf === 'low' && q.conf === 'low' ? 'both points are' : r.conf === 'low' ? 'this point is' : 'the earlier point is') + ' low confidence: read loosely');
    if (d < MINGAP) return ['Since ' + short + ': only ' + Math.round(d) + ' days apart, too close to read a rate' + (q.field !== r.field ? ' (and a different scanner)' : '')];
    const k = Math.log(rv / qv) / d, pct = (rv / qv - 1) * 100;
    /* a lesion that shrank to under 1% of its size is still there: one decimal, so the box never says -100% */
    return ['Since ' + short + ' (' + fdays(d) + '): ' + (pct > 0 ? '+' : '') + (pct < -99 ? pct.toFixed(1) : pct.toFixed(0)) + '% · ' + rateTxt(k) + ' (' + perMonth(k) + ')'].concat(like ? ['(' + like + ')'] : [], warn);
  }

  /* Doubling times view: one row per lesion, one column per treatment period */
  function drawPeriods(body, S) {
    const L = S.length ? S : LS.lesions.filter(l => LS.measured.some(m => m.lesion === l.id && !m.none));
    const dt = t => new Date(t).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
    const cell = (f, targeted) => {
      if (!f) return `<td class="na">${targeted ? '<span class="tg" title="Treated in this course">◎</span> ' : ''}—</td>`;
      const span = (f.t1 - f.t0) / DAY;
      return `<td class="${upCls(f.k)}"${f.weak ? ' style="opacity:.75"' : ''} title="${f.n} scans, ${dt(f.t0)} – ${dt(f.t1)}${f.weak ? '. ' + WARN + ' read loosely: ' + whyTxt(f) : ''}">` +
        `${targeted ? '<span class="tg" title="Treated in this course">◎</span> ' : ''}<b>${rateTxt(f.k)}</b>${f.weak ? ' ' + WARN : ''}<small>${perMonth(f.k)} · ${f.n} scans${span < 30 ? ' · short span' : ''}</small></td>`; };
    let h = '<div style="overflow:auto"><table class="ltr-tbl ltr-per"><tr><th>Lesion</th>' +
      PERIODS.map(P => `<th title="${P.t.treatment}, ${P.t.start}; from the last scan before it until the next treatment">${P.label}<small style="display:block;font-weight:400;color:var(--muted)">${P.t.start}</small></th>`).join('') + '<th>Latest</th></tr>';
    L.forEach(l => { const pts = ptsOf(l.id).map(p => Object.assign({field: p.m.field}, p)), lf = latest(l.id);
      h += `<tr><td><b style="color:${LCOL[l.id]}" title="${LNAME[l.id]}">${l.id}</b></td>` + PERIODS.map(P => cell(periodFit(pts, P), P.t.lesions.includes(l.id) && !P.wb)).join('') +
        (lf ? `<td class="${upCls(lf.k)}"${lf.weak ? ' style="opacity:.75" title="' + WARN + ' read loosely: ' + whyTxt(lf) + '"' : ''}><b>${rateTxt(lf.k)}</b>${lf.weak ? ' ' + WARN : ''}</td>` : '<td class="na">—</td>') + '</tr>'; });
    if (V.total) { const T = totals(L).filter(e => !e.partial);
      h += '<tr><td><b>Total</b></td>' + PERIODS.map(P => cell(fitLog(T, P.a, P.b), false)).join('') + '<td></td></tr>'; }
    body.insertAdjacentHTML('beforeend', h + '</table></div>');
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '6px';
    note.innerHTML = 'Each cell: a steady-% trend fitted to that lesion\'s scans from the last scan before the treatment until the next treatment starts (so it includes the response to that treatment). ' +
      '<span class="ltr-up">×2 in … = doubling time</span> (growing), <span class="ltr-dn">½ in … = halving time</span> (shrinking). ◎ = SRS aimed at this lesion in that course (whole-brain radiation covers all). ' +
      WARN + ' = a weak trend, shown lighter: the scans mix 1.5T and 3T or different sequence types, or it leans on low-confidence points (hover the cell for which). "short span" = under a month between first and last scan: read loosely. Fits need 2+ scans with the lesion seen.';
    body.append(note);
  }

  function draw(id, body, view, viewBar, rerender, sel) {
    redraw = rerender; SEL = sel || null; if (SEL) V.hidden = SEL.get();
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = ''; if (viewBar) body.append(viewBar); toolbar(body, view);
    const S = shown(), log = V.scale === 'log';
    if (view === 'periods') return drawPeriods(body, S);
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, H0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Tumor volume over time, one line per brain lesion');
    box.append(cv); body.append(box); box.onmouseleave = () => setHover(null);
    const ds = [], fits = [];
    const lineDs = (label, col, pts, extra) => Object.assign({label, data: pts, parsing: true, borderColor: col, backgroundColor: col, borderWidth: 2, tension: 0, showLine: true, spanGaps: true,
      pointStyle: p => !p.raw ? 'circle' : p.raw.prov ? 'star' : p.raw.cens ? 'crossRot' : shape(p.raw.field), pointRadius: p => !p.raw ? 4.5 : p.raw.prov ? 6 : p.raw.v === 0 ? 3.5 : 4.5, pointHoverRadius: 7,
      pointHitRadius: p => p.raw && p.raw.cens ? 9 : 1,   // the x marks sit on the plot's bottom edge, where only their upper half can be pointed at
      pointBackgroundColor: p => p.raw && (p.raw.v === 0 || p.raw.partial || p.raw.conf === 'low' || p.raw.prov) ? 'rgba(0,0,0,0)' : col, pointBorderColor: p => p.raw && (p.raw.v === 0 || p.raw.partial || p.raw.conf === 'low' || p.raw.prov) ? col : '#fff', pointBorderWidth: p => p.raw && p.raw.prov ? 1.8 : 1.4,
      /* a stretch that ends or starts at "not seen" is finely dotted and thin: when the lesion sank below what a scan shows is not known */
      segment: {borderDash: s => !(s.p0.raw && s.p1.raw) ? undefined : (s.p0.raw.cens || s.p1.raw.cens) ? [1, 4] : (s.p0.raw.gap || s.p0.raw.prov || s.p1.raw.prov) ? [5, 4] : s.p0.raw.field !== s.p1.raw.field ? [2, 3] : undefined,
                borderWidth: s => s.p0.raw && s.p1.raw && (s.p0.raw.cens || s.p1.raw.cens) ? 1.3 : undefined}}, extra);
    /* Not seen / too-small points sit on the bottom line of the plot (0 on the linear scale, the axis floor on the log scale), so each
       lesion's line drops where it shrank away instead of running straight to the next scan that measured it. */
    const FLOOR = log ? 5 : 0, PL = {};
    S.forEach(l => {
      /* with "Before first scan" on, the estimate curves take the place of the straight stretch from the clean scan to the first scan with lesions */
      const P = runEnds(ptsOf(l.id)).filter(p => p.v > 0 || !(V.back && BC) || p.date >= BC.first).map(p => ({x: pos(p.t), y: p.v > 0 ? p.v : FLOOR, v: p.v, t: p.t, date: p.date, field: p.m.field, lesion: l.id, m: p.m,
        lo: p.m.lo, hi: p.m.hi, conf: p.m.conf, seq: p.m.seq, seq_name: p.m.seq_name, cens: p.v > 0 ? null : (p.m.below || 'not_seen'), run: p.run}));
      /* provisional volumes (taken on a copy that is not the hospital's files): on the line as a star, dashed on both sides */
      (LS.provisional || []).filter(q => q.lesion === l.id).forEach(q => P.push({x: pos(ms(q.date)), y: q.enh_mm3, v: q.enh_mm3, t: ms(q.date), date: q.date, field: q.field,
        lesion: l.id, m: q, lo: q.lo, hi: q.hi, conf: q.conf, prov: q}));
      P.sort((a, b) => a.t - b.t);
      P.forEach((p, i) => { p.prev = P.slice(0, i).reverse().find(q => q.v > 0 && !q.prov); });   // rates are taken between hospital-file measurements only
      PL[l.id] = P;
      const SN = (LS.seen_not_outlined || []).filter(q => q.lesion === l.id).map(q => ms(q.date));   // scans that saw it without an outline
      P.forEach((p, i) => { const b = P[i + 1]; p.gap = !!(b && SN.some(t => t > p.t && t < b.t)); });
      ds.push(lineDs(l.id, LCOL[l.id], P));
      if (V.fit === 'window') { const f = fitLog(ptsOf(l.id).map(p => Object.assign({}, p))); if (f) fits.push(Object.assign(f, {label: l.id, col: LCOL[l.id]})); }
    });
    if (V.total) {
      const T = totals(S.length ? S : LS.lesions), col = css('--ink');
      const TP = T.map(e => ({x: pos(e.t), y: e.v, v: e.v, t: e.t, date: e.date, field: e.field, n: e.n, partial: e.partial, total: true, lo: e.lo, hi: e.hi, seq: e.seq, seq_name: e.seq_name}));
      const pvT = {};   // provisional volumes of the lesions shown, added up per date: a star on the total line
      (LS.provisional || []).filter(q => (S.length ? S : LS.lesions).some(l => l.id === q.lesion)).forEach(q => { const e = pvT[q.date] || (pvT[q.date] = {v: 0, lo: 0, hi: 0, n: 0, field: q.field});
        e.v += q.enh_mm3; e.lo += q.lo; e.hi += q.hi; e.n++; });
      Object.entries(pvT).forEach(([d, e]) => TP.push({x: pos(ms(d)), y: e.v, v: e.v, t: ms(d), date: d, field: e.field, n: e.n, total: true, lo: e.lo, hi: e.hi, prov: {total: true}}));
      TP.sort((a, b) => a.t - b.t);
      TP.forEach((p, i) => { p.prev = p.partial ? null : TP.slice(0, i).reverse().find(q => !q.partial && !q.prov); });
      ds.push(lineDs('Total', col, TP, {borderWidth: 3}));
      if (V.fit === 'window') { const f = fitLog(T.filter(e => !e.partial)); if (f) fits.push(Object.assign(f, {label: 'Total', col})); }
    }
    fits.forEach(f => { const N = 24, pts = []; for (let i = 0; i <= N; i++) { const t = f.t0 + (f.t1 - f.t0) * i / N; pts.push({x: pos(t), y: f.f(t), fit: f}); }
      ds.push({label: f.label + ' trend', data: pts, parsing: true, borderColor: f.col, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, showLine: true, fill: false}); });
    /* trend labels in a column just inside the right edge of the plot (the plot keeps the shared edges, so the scrub line
       lines up with the other panels), each on a dark backing and joined to its line's end by a thin leader */
    let projShown = false;   // the projection is drawn in the same right-hand part: the trend labels then stay in the table under the chart
    const endLab = {id: 'ltrEnd', afterDatasetsDraw(c) {
      if (V.fit === 'window' && !fits.length) {   // Trend is on but nothing could be fitted: say why instead of showing nothing
        const {ctx, chartArea: a} = c; ctx.save(); ctx.font = '11px system-ui'; ctx.fillStyle = css('--muted'); ctx.textBaseline = 'top';
        ctx.fillText('Trend: needs 2 or more scans inside the time window' + (S.length || V.total ? '' : ' (and a lesion or Total shown)') + '; move or widen the window', a.left + 6, a.top + 4); ctx.restore(); }
      if (!fits.length || projShown) return; const {ctx, chartArea: a, scales: {x, y}} = c;
      ctx.save(); ctx.font = 'bold 10.5px system-ui'; ctx.textBaseline = 'middle';
      const narrow = a.right - a.left < 420;   // a phone: the short form, L01 ↓3.0mo; with more than three trends none at all (they would
      if (narrow && fits.length > 3) return;   // hide the latest points, and the table under the chart lists the same rates)
      const L = fits.map(f => ({f, px: Math.min(a.right, x.getPixelForValue(pos(f.t1))), ey: y.getPixelForValue(f.f(f.t1)), txt: f.label + ' ' + rateTxt(f.k, narrow) + (f.weak ? (narrow ? '' : ' ') + WARN : '')}))
        .filter(o => o.px >= a.left).map(o => Object.assign(o, {py: Math.max(a.top + 7, Math.min(a.bottom - 7, o.ey)), w: ctx.measureText(o.txt).width})).sort((p, q) => p.py - q.py);
      const G = 14; for (let i = 1; i < L.length; i++) L[i].py = Math.max(L[i].py, L[i - 1].py + G);
      const over = L.length ? L[L.length - 1].py - (a.bottom - 7) : 0; if (over > 0) L.forEach(o => { o.py -= over; });   // push the stack up if it runs off the bottom
      for (let i = L.length - 2; i >= 0; i--) L[i].py = Math.min(L[i].py, L[i + 1].py - G);
      const rx = a.right - 4;
      L.forEach(o => { const lx = rx - o.w;
        if (o.px < lx - 8) { ctx.strokeStyle = o.f.col; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.px, Math.max(a.top, Math.min(a.bottom, o.ey))); ctx.lineTo(lx - 5, o.py); ctx.stroke(); }
        ctx.globalAlpha = .82; ctx.fillStyle = css('--card'); ctx.fillRect(lx - 4, o.py - 7, o.w + 7, 14); ctx.globalAlpha = 1;
        ctx.fillStyle = o.f.col; ctx.fillText(o.txt, lx, o.py); });
      ctx.restore(); }};
    /* Before first scan: each lesion of the first scan carried backwards at the middle doubling time measured in later growth
       (dotted, its colour); for the total also a shaded fan from the fast to the slow doubling time. Lines stop at the size a
       scan can show on the log scale (the axis floor is about that size). All numbers come from IMG_DATA.growth.backcast. */
    let backPlug = null;
    if (V.back && BC) {
      const t1 = ms(BC.first), t0 = ms(BC.clean), floor = log ? 5 : 0, ids = new Set(S.map(l => l.id));
      const at = (v0, dt, t) => v0 * Math.pow(2, -(t1 - t) / DAY / dt);
      const curve = (v0, dt, to) => { const N = 40, end = to != null ? to : (log ? Math.max(t0, t1 - dt * Math.log2(v0 / floor) * DAY) : t0), pts = [];
        for (let i = 0; i <= N; i++) { const t = t1 - (t1 - end) * i / N; pts.push({x: pos(t), y: at(v0, dt, t), fit: true}); } return pts; };
      BC.lesions.filter(r => ids.has(r.id)).forEach(r => ds.push({label: r.id + ' before', data: curve(r.v0, BC.dt.mid), parsing: true, borderColor: LCOL[r.id], borderWidth: 1.3, borderDash: [2, 3],
        pointRadius: 0, pointHoverRadius: 0, showLine: true, fill: false}));
      const vt = BC.lesions.filter(r => !S.length || ids.has(r.id)).reduce((a, r) => a + r.v0, 0);
      if (V.total && vt) ds.push({label: 'Total before', data: curve(vt, BC.dt.mid), parsing: true, borderColor: css('--ink'), borderWidth: 2, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0, showLine: true, fill: false});
      backPlug = {id: 'ltrBack', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c;
        ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
        const X = t => x.getPixelForValue(pos(t)), Y = v => Math.min(a.bottom + 50, y.getPixelForValue(Math.max(v, log ? 1e-3 : 0)));
        if (V.total && vt) {   // fan: between the slow (upper) and the fast (lower) doubling time
          const N = 40; ctx.beginPath();
          for (let i = 0; i <= N; i++) { const t = t1 - (t1 - t0) * i / N; ctx[i ? 'lineTo' : 'moveTo'](X(t), Y(at(vt, BC.dt.slow, t))); }
          for (let i = N; i >= 0; i--) { const t = t1 - (t1 - t0) * i / N; ctx.lineTo(X(t), Y(at(vt, BC.dt.fast, t))); }
          ctx.closePath(); ctx.fillStyle = css('--ink'); ctx.globalAlpha = .09; ctx.fill(); ctx.globalAlpha = 1; }
        // the size a scan can show, between the clean scan and the first scan with lesions; the clean scan itself
        const yf = y.getPixelForValue(Math.max(BC.floor_mm3, log ? 5 : 0)), xa = X(t0), xb = X(t1);
        ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(xa, yf); ctx.lineTo(xb, yf); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui'; ctx.textBaseline = 'bottom';
        ctx.fillText('▽ nothing seen ' + fd(BC.clean) + ' (each lesion under about ' + BC.floor_mm + ' mm)', Math.max(a.left + 4, xa + 4), yf - 3);
        ctx.restore(); }};
    }
    /* Projection on the shared time axis: each lesion's scenario from the latest scan, as far as the axis runs (navigation bar:
       Future). Dashed, hollow points at +1, +2 and +3 months with their range bars, on the amber date lines every panel draws
       (projection_dates.js); clipped to the plot. Between two months the line follows the same steady rate (straight on the log
       scale). The total is the sum of the lesions shown. */
    let projPlug = null; const measTop = Math.max(0, ...ds.flatMap(d => d.data.map(q => q.fit ? 0 : q.y)));
    if (PON()) {
      if (!PJ.scenarios.some(q => q.key === V.psc)) V.psc = PJ.scenarios[0].key;
      const tb = ms(PJ.base), rowsP = projRows(S), end = Math.max(X1, W.b);
      const curve = (label, col, now, cells, extra) => {
        const K = [{t: tb, v: now.v}].concat(PJ.months.map((m, i) => ({t: ms(m.date), v: cells[i] ? cells[i].v : now.v, c: cells[i], m}))), pts = [], N = 8;
        for (let i = 1; i < K.length && K[i - 1].t < end; i++) { const a = K[i - 1], b = K[i];
          for (let j = i === 1 ? 0 : 1; j <= N; j++) { const f = j / N, t = a.t + (b.t - a.t) * f, v = a.v > 0 && b.v > 0 ? a.v * Math.pow(b.v / a.v, f) : a.v + (b.v - a.v) * f;
            pts.push(j === N ? {x: pos(t), y: v, v, t, date: b.m.date, proj: b, lesion: label, lo: b.c ? b.c.lo : null, hi: b.c ? b.c.hi : null} : {x: pos(t), y: v, fit: true});
            if (t >= end) break; } }
        ds.push(Object.assign({label: label + ' projected', data: pts.filter(q => !log || q.y > 0), parsing: true, borderColor: col, backgroundColor: col, borderWidth: 2, borderDash: [6, 4], tension: 0, showLine: true, clip: 0,
          pointStyle: 'circle', pointRadius: q => q.raw && q.raw.proj ? 4 : 0, pointHoverRadius: q => q.raw && q.raw.proj ? 7 : 0, pointBackgroundColor: 'rgba(0,0,0,0)', pointBorderColor: col, pointBorderWidth: 1.6}, extra));
      };
      projShown = W.b > tb + 20 * DAY;
      rowsP.forEach(r => curve(r.id, LCOL[r.id], r.now, r[V.psc]));
      if (V.total && rowsP.length) { const T = projTotal(rowsP); curve('Total', css('--ink'), T.now, T.cells, {borderWidth: 3}); }
      projPlug = {id: 'ltrProjOn', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c, x0 = Math.max(a.left, x.getPixelForValue(pos(tb)));
        if (x0 >= a.right) return; ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
        const py = y.getPixelForValue(PJ.max_seen_mm3); ctx.strokeStyle = css('--muted'); ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(a.right, py); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui'; ctx.textBaseline = 'bottom';
        const t = 'largest single lesion measured so far (' + fv(PJ.max_seen_mm3) + ')'; if (a.right - x0 > ctx.measureText(t).width + 10) ctx.fillText(t, x0 + 5, py - 2);
        ctx.fillStyle = '#e0a020'; ctx.font = 'bold 10px system-ui'; ctx.textBaseline = 'top';
        const t2 = 'projection: ' + PJ.scenarios.find(q => q.key === V.psc).label; if (a.right - x0 > ctx.measureText(t2).width + 10) { ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = css('--card'); ctx.strokeText(t2, x0 + 5, a.top + 24); ctx.fillText(t2, x0 + 5, a.top + 24); }   // under the date labels (+1 mo over its date); outlined so the date lines do not cut through it
        ctx.restore(); }};
    }
    /* range bars: a thin vertical bar from the low to the high end of each point's likely range (seed position), drawn under the points */
    const rangeBars = {id: 'ltrRange', beforeDatasetsDraw(c) { const {ctx, chartArea: a, scales: {x, y}} = c;
      ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); ctx.lineWidth = 1.3;
      c.data.datasets.forEach((d, di) => { if (!c.isDatasetVisible(di)) return;
        d.data.forEach(p => { if (p.fit || p.lo == null || p.hi == null || !(p.hi > p.lo) || (log && !(p.lo > 0))) return;
          const px = x.getPixelForValue(p.x), y0 = y.getPixelForValue(Math.max(p.lo, log ? 5 : 0)), y1 = y.getPixelForValue(p.hi);
          if (Math.abs(y0 - y1) < 3) return;
          ctx.strokeStyle = d.borderColor; ctx.globalAlpha = .55;
          ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.moveTo(px - 3, y0); ctx.lineTo(px + 3, y0); ctx.moveTo(px - 3, y1); ctx.lineTo(px + 3, y1); ctx.stroke(); }); });
      ctx.restore(); }};
    /* Brain MRIs with no measured point (lesion_series.unmeasured): a grey diamond near the top of the plot on a dotted line at the
       scan's date, so a scan is never silently absent from the chart; hover it for why, what the report found and what is needed.
       Its own hidden y axis keeps it at the same height on the log and the linear scale. */
    /* Seen on a scan but not outlinable (lesion_series.seen_not_outlined): a hollow square in the lesion's colour on its line, at
       the height of the straight line between the neighbouring scans (there is no volume to plot). */
    S.forEach(l => { const P = PL[l.id] || [], marks = (LS.seen_not_outlined || []).filter(q => q.lesion === l.id); if (!marks.length || !P.length) return;
      const pts = marks.map(q => { const t = ms(q.date), x0 = pos(t), a = P.filter(p => p.t < t).pop(), b = P.find(p => p.t > t); let y;
        if (a && b) { const f = (x0 - a.x) / ((b.x - a.x) || 1); y = log ? Math.exp(Math.log(a.y) + f * (Math.log(b.y) - Math.log(a.y))) : a.y + f * (b.y - a.y); }
        else y = (a || b).y;
        return {x: x0, y, t, date: q.date, lesion: l.id, seen: q}; });
      ds.push({label: l.id + ' seen', data: pts, parsing: true, showLine: false, pointStyle: 'rect', pointRadius: 4, pointHoverRadius: 6.5,
        pointBackgroundColor: css('--card'), pointBorderColor: LCOL[l.id], pointBorderWidth: 1.6, borderColor: LCOL[l.id], backgroundColor: LCOL[l.id]}); });
    const UNM = (LS.unmeasured || []).map(u => ({x: pos(ms(u.date)), y: 0.955, date: u.date, unm: u})), mut = css('--muted');
    if (UNM.length) ds.push({label: 'Not measured', data: UNM, parsing: true, yAxisID: 'yU', showLine: false, pointStyle: 'rectRot', pointRadius: 5.5, pointHoverRadius: 8,
      pointBackgroundColor: css('--card'), pointBorderColor: mut, pointBorderWidth: 1.6, borderColor: mut, backgroundColor: mut});
    const unmPlug = {id: 'ltrUnm', beforeDatasetsDraw(c) { if (!UNM.length) return; const {ctx, chartArea: a, scales: {x}} = c;
      ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
      ctx.strokeStyle = mut; ctx.globalAlpha = .75; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      UNM.forEach(q => { const px = x.getPixelForValue(q.x); if (px < a.left || px > a.right) return; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); });
      ctx.restore(); }};
    const cfg = {type: 'line', plugins: [txPlugin].concat(backPlug ? [backPlug] : [], projPlug ? [projPlug] : [], [unmPlug, rangeBars, guide, endLab], typeof momentPlugin === 'object' ? [momentPlugin] : []), data: {datasets: ds},
      options: {animation: false, maintainAspectRatio: false, clip: false, layout: TLAY(),
        onHover: (e, els, ch) => { const xv = ch.scales.x.getValueForPixel(e.x); setHover(xv >= 0 && xv <= 100 ? xv : null); },
        plugins: {legend: {display: false}, tooltip: {displayColors: false, filter: it => !it.raw.fit, callbacks: {
          title: it => it[0] ? fd(it[0].raw.date) + (it[0].raw.unm ? ' · brain MRI, not measured' : it[0].raw.proj ? ' · projected (+' + it[0].raw.proj.m.m + ' mo), not measured' : '') : '',
          afterBody: its => (TIPN = Math.min(76, tipFit(its[0] && its[0].chart)), fitTip(censTip(its.map(it => it.raw).filter(r => r && r.cens), S), its[0] && its[0].chart)),
          label: it => (TIPN = Math.min(76, tipFit(it.chart)), fitTip((it => { const r = it.raw; if (r.unm) return unmTip(r.unm); if (r.seen) return seenTip(r); if (r.cens) return []; if (r.proj) return projTip(r); const st = step(r);
            if (r.prov) return provTip(r, st);
            if (r.total) return ['Total ' + fv(r.v) + ' · ' + r.n + ' lesion' + (r.n > 1 ? 's' : '') + (r.partial ? ' · partial scan' : '') + ' · ' + r.field + (r.seq_name ? ' ' + r.seq_name : '')]
              .concat(r.hi > r.lo ? ['likely range ' + fv(r.lo) + ' – ' + fv(r.hi) + ' (each lesion\'s range added up)'] : [], notOut(r.date, S), st);
            const m = r.m, q = [];
            if (m.lo != null && m.hi > m.lo) q.push(...wrapLines('likely range ' + fv(m.lo) + ' – ' + fv(m.hi) + ' (' + (m.range_why || 'if the seed sat a few mm elsewhere') + ')'));
            (m.flags || []).forEach(f => q.push((m.conf === 'low' || f === 'cut' ? WARN + ' ' : '') + FLAGW[f]));
            (m.alt || []).forEach(a => q.push('same visit, ' + a.seq_name + ' series: ' + fv(a.enh_mm3) + ' (a second measurement, not charted)'));
            return [r.lesion + ' ' + (r.v === 0 ? 'nothing found' : fv(r.v)) + ' · ' + r.field + (m.seq_name ? ' ' + m.seq_name : '') + (m.axial_mm ? ' · ' + m.axial_mm + ' mm wide' : ''), LNAME[r.lesion]]
              .concat(m.note ? wrapLines(m.note) : [], q, st); })(it), it.chart))}}},
        scales: {x: xAxis(), y: {type: log ? 'logarithmic' : 'linear', min: log ? 5 : 0, max: !log && projPlug ? Math.ceil(Math.max(measTop, PJ.max_seen_mm3) * 1.5 / 1000) * 1000 : undefined,
          /* log scale with the projection showing: about 26 px of room above the highest point, so the date labels at the top of the plot (+1 mo over its date) stay clear of it */
          afterDataLimits: s => { if (log && projPlug && projShown && s.max > s.min && s.min > 0) s.max *= Math.pow(s.max / s.min, 26 / Math.max(60, (s.height || 300) - 26)); },
          afterFit: s => { s.width = typeof YW === 'number' ? YW : s.width; },
          title: {display: true, text: 'mm³ (enhancing)', color: css('--muted')},
          ticks: {color: css('--muted'), callback: v => log ? ([5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].includes(v) ? (v >= 1000 ? v / 1000 + 'k' : v) : '') : (v >= 1000 ? +(v / 1000).toFixed(1) + 'k' : v)},
          grid: {color: css('--line')}},
          yU: {type: 'linear', display: false, min: 0, max: 1}}}};   // hidden axis of the not-measured marks; listed AFTER y, because a dataset with no yAxisID takes the first y axis
    charts.set(id, new Chart(cv, cfg));
    if (fits.length) {
      const nar = innerWidth <= 760, sd = t => { const d = new Date(t).toISOString().slice(0, 10); return nar ? +d.slice(5, 7) + '/' + +d.slice(8) + '/' + d.slice(2, 4) : fd(d); };
      let h = '<div style="overflow:auto"><table class="ltr-tbl ltr-nw' + (nar ? ' ltr-per ltr-nar' : '') + '"><tr><th>' + (nar ? 'Trend' : 'Trend in window') + '</th>' + (nar ? '' : '<th>points</th>') + '<th>from</th><th>to</th><th>' + (nar ? 'per month' : 'change / month') + '</th><th>' + (nar ? '×2 or ½ time' : 'doubling or halving time') + '</th></tr>';
      fits.forEach(f => { const pm = (Math.exp(f.k * 30.44) - 1) * 100, up = f.k > 0;
        h += `<tr><td><b style="color:${f.col}">${f.label}</b>${nar ? '<small>' + f.n + ' scans</small>' : ''}</td>${nar ? '' : '<td>' + f.n + '</td>'}<td>${sd(f.t0)}</td><td>${sd(f.t1)}</td>` +
             `<td class="${up ? 'ltr-up' : 'ltr-dn'}">${up ? '+' : ''}${pm.toFixed(0)}%</td><td class="${up ? 'ltr-up' : 'ltr-dn'}"${f.weak ? ' style="opacity:.75" title="' + WARN + ' read loosely: ' + whyTxt(f) + '"' : ''}>${isFinite(f.dbl) ? (nar ? (up ? '×2 in ' : '½ in ') : (up ? 'doubles every ' : 'halves every ')) + fdays(f.dbl) : 'flat'}${f.weak ? ' ' + WARN : ''}</td></tr>`; });
      body.insertAdjacentHTML('beforeend', h + '</table></div>');
    }
    if (V.back && BC) drawBack(body, S);
    if (PON()) drawProjection(body, S);
    const note = document.createElement('div'); note.className = 'sub'; note.style.marginTop = '4px';
    note.innerHTML = 'Our own measured enhancing volume per lesion (not the reports\' sizes). ● = 1.5T scanner, ▲ = 3T; ' +
      '<b>a dotted stretch joins a 1.5T and a 3T scan, so part of that change may be the scanner</b> (small lesions can differ up to ~2× between scanners). ' +
      '<b>Thin vertical bars = each point\'s likely range</b> (how much the volume changes if the seed is put a few mm elsewhere in the lesion). ' +
      '<b>Hollow = low confidence</b> (tiny, faint or seed-sensitive; also nothing found or a partial scan). ' + WARN + ' = a trend to read loosely (scans not like for like, or low-confidence points). ' +
      'Scans also differ in sequence type (MPRAGE/BRAVO, plain gradient echo, SPACE/CUBE spin echo): named in the hover box; volumes compare best within one type. Total = sum of the lesions shown on each scan' +
      (Object.keys(LS.not_outlined || {}).length ? ' (its hover box names lesions the report describes that we could not outline: the total is then a lower bound)' : '') + '. ' +
      (UNM.length ? '<b>◇ on a dotted line = a brain MRI we could not measure</b> (' + UNM.map(q => fd(q.date)).join(', ') + '): hover it for why. ' : '') +
      ((LS.provisional || []).length ? '<b>✳ = a provisional volume</b> (' + [...new Set(LS.provisional.map(p => p.date))].map(fd).join(', ') + '): measured on a copy rebuilt from the pictures on the hospital\'s website, not on the hospital\'s files. Its stretches are dashed, and it is not used for the trends, rates or projections; it will be replaced when the hospital\'s own files arrive. ' : '') +
      ((LS.states || []).length ? '<b>× on the bottom line = the lesion was not seen on that scan, or was too small to outline</b>; its line drops there (finely dotted) and comes back up if a later scan measures it again. Of several such scans in a row only the first and the last are marked. ' : '') +
      ((LS.seen_not_outlined || []).length ? '<b>□ on a line = seen on that scan but could not be outlined</b> (too faint, a thin line, or running into a vein): no volume, so the stretch through it is dashed and the square only sits on the straight line between its neighbours; hover it for why. ' : '') +
      (V.fit === 'window' ? 'Dashed = fitted steady-% trend through the points inside the time window (needs 2+ points); move or zoom the window to fit a different stretch. ' : '') +
      (V.back && BC ? 'Fine dotted lines before the first scan = the estimate described above, not measurements; the grey fan = the same for the total, from the fast to the slow doubling time. ' : '') +
      (projPlug ? '<b style="color:#e0a020">Dashed lines with hollow points after the latest scan = the projection (a scenario, not a forecast)</b>; its hollow points sit on the amber date lines (' + Projection.datesText() + '), which mark the same dates in every panel' + (log ? '' : '; on the linear scale lines that leave the top are larger than the scale (switch to Log)') +
        (projShown && fits.length ? '; while it shows, the fitted trends\' labels are in the table under the chart instead of the right-hand column' : '') + '. ' : '') +
      'Hover a point for the rate since the previous scan (none for scans under ' + MINGAP + ' days apart). Arrows on the chips = latest rate (last treatment period with 2+ scans). Bands: orange = whole-brain radiation, purple = SRS.';
    body.append(note);
  }

  /* ---- Before first scan: the estimate in words and per lesion (numbers from growth_model.py) ---- */
  const mY = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
  function drawBack(body, S) {
    const ids = new Set(S.map(l => l.id)), rows = BC.lesions.filter(r => !S.length || ids.has(r.id));
    const box = document.createElement('div'); box.style.cssText = 'margin-top:8px;padding:6px 10px;border:1px dashed var(--line);border-radius:6px;font-size:12px';
    let h = '<b>Before the first scan (estimate)</b> <span class="sub">· doubling every ' + BC.dt.mid + ' days, range ' + BC.dt.fast + '–' + BC.dt.slow + ' (from ' + BC.n_steps + ' later growth steps)</span>' +
      '<div style="margin:4px 0">' + esc_(BC.text) + '</div><details><summary class="sub" style="cursor:pointer">Each lesion</summary><table class="ltr-tbl"><tr><th>Lesion</th><th>first measured</th>' +
      '<th title="When this lesion would have reached the size a scan can show, at the middle doubling time (and between the slow and the fast one)">visible from about</th>' +
      '<th title="The same line carried back to one cell: very rough">one cell about</th><th title="Slower growth than this would have shown on the clean scan">doubling at most every</th></tr>';
    rows.forEach(r => { h += `<tr><td><b style="color:${LCOL[r.id]}" title="${esc_(LNAME[r.id] || '')}">${r.id}</b></td><td>${fv(r.v0)}</td><td>${mY(r.visible.mid)} <span class="sub">(${mY(r.visible.slow)} – ${mY(r.visible.fast)})</span></td>` +
      `<td class="sub">${mY(r.cell.mid)} (${mY(r.cell.slow)} – ${mY(r.cell.fast)})</td><td>${r.dt_max} d</td></tr>`; });
    h += '</table><div class="sub" style="margin-top:4px">Growth steps used (' + BC.steps.map(s => `${s.lesion} ${s.doubling_days} d${s.low_conf ? '*' : ''}`).join(' · ') + '; * = one of the two volumes is low confidence).</div></details>';
    box.innerHTML = h; body.append(box);
  }
  const esc_ = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  /* ---- Projection: each lesion on the latest scan carried forward 1-3 months (growth_model.py). The lines are on the main chart,
     on the shared time axis (switching Projection on lengthens the axis when it stops short: projection_dates.js). This box: the
     scenario buttons, how far to trust it, where it is drawn, and the table. ---- */
  const projRows = S => { const ids = new Set(S.map(l => l.id)); return PJ.lesions.filter(r => !S.length || ids.has(r.id)); };
  /* total of the lesions shown: now and per month (a lesion without a rate counts unchanged), ranges added up */
  function projTotal(rows) { const sum = f => rows.reduce((a, r) => a + f(r), 0);
    return {now: {v: sum(r => r.now.v), lo: sum(r => r.now.lo != null ? r.now.lo : r.now.v), hi: sum(r => r.now.hi != null ? r.now.hi : r.now.v)},
      cells: PJ.months.map((m, i) => { const g = k => sum(r => r[V.psc][i] ? r[V.psc][i][k] : r.now.v); return {v: g('v'), lo: g('lo'), hi: g('hi')}; })}; }
  function projTip(r) { const c = r.proj.c, sc = PJ.scenarios.find(q => q.key === V.psc);
    if (!c) return [r.lesion + ': no rate yet (first scan with this lesion), shown unchanged'];
    return [r.lesion + ' ' + fv(r.v) + (c.mm ? ' · about ' + c.mm + ' mm wide' : '') + ' · if ' + sc.label].concat(
      c.hi > c.lo ? ['range ' + fv(c.lo) + ' – ' + fv(c.hi) + ' (from the likely range of the scans behind the rate)'] : [],
      c.beyond ? [WARN + ' larger than any lesion measured so far: steady doubling cannot go on this long'] : [], c.below ? ['under what a scan can show'] : [],
      ['A scenario, not a forecast: ' + (PJ.backtest.short || '')]); }
  function drawProjection(body, S) {
    const rows = projRows(S);
    if (!PJ.scenarios.some(s => s.key === V.psc)) V.psc = PJ.scenarios[0].key;
    const wrap = document.createElement('div'); wrap.style.cssText = 'margin-top:8px;padding:6px 10px;border:2px solid #e0a020;border-radius:6px;font-size:12px';
    const head = document.createElement('div'); head.className = 'ltr-bar';
    head.innerHTML = '<b style="color:#e0a020">Projection (a scenario, not a forecast)</b> <span class="sub">from the ' + fd(PJ.base) + ' scan · if</span>';
    PJ.scenarios.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ltr-b' + (s.key === V.psc ? ' on' : ''); b.textContent = s.label;
      b.onclick = () => { V.psc = s.key; save(); redraw(); }; head.append(b); });
    wrap.append(head);
    const bt = document.createElement('div'); bt.style.cssText = 'margin:2px 0 6px'; bt.innerHTML = '<b>How far to trust it:</b> ' + esc_(PJ.backtest.text); wrap.append(bt);
    const short = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
    wrap.append(Projection.where());   // on the chart at the amber date lines, or a button that brings the timeline there
    // table: latest rate and the three months, selected scenario
    const cell = c => !c ? '<td class="na">—</td>' : `<td${c.beyond ? ' title="Larger than any lesion measured so far: steady doubling cannot go on this long"' : ''}><b>${fv(c.v)}</b>${c.beyond ? ' ' + WARN : ''}` +
      `<small style="display:block;color:var(--muted);font-size:10px">${c.below ? 'under what a scan shows' : 'about ' + c.mm + ' mm wide'}${c.hi > c.lo * 1.05 ? ' · ' + fv(c.lo) + '–' + fv(c.hi) : ''}</small></td>`;
    let h = '<div style="overflow:auto"><table class="ltr-tbl ltr-per"><tr><th>Lesion</th><th>latest rate</th><th>' + short(PJ.base) + '</th>' + PJ.months.map(m => '<th>+' + m.m + ' mo<small style="display:block;font-weight:400;color:var(--muted)">' + short(m.date) + '</small></th>').join('') + '</tr>';
    rows.forEach(r => { const q = r.rate;
      h += `<tr><td><b style="color:${LCOL[r.id]}" title="${esc_(LNAME[r.id] || '')}">${r.id}</b></td>` +
        (q ? `<td class="${q.unclear ? 'na' : upCls(q.k)}" title="${q.n} scans, ${fd(q.from)} – ${fd(q.to)}. Range from the likely range of the volumes: ${q.range_words[0]} to ${q.range_words[1]}.${q.weak ? ' ' + WARN + ' ' + q.why.join('; ') + '.' : ''}"><b>${q.unclear ? 'no clear change' : q.words}</b>${q.weak && !q.unclear ? ' ' + WARN : ''}` +
              `<small style="display:block;color:var(--muted);font-size:10px">${q.unclear ? q.words + ' at face value; the range includes no change' : q.range_words[0] === q.range_words[1] ? '' : q.range_words[0].replace(/^(doubles|halves) every /, '') + ' – ' + q.range_words[1]}</small></td>`
           : '<td class="na" title="First scan with this lesion: no rate yet">—</td>') +
        `<td><b>${fv(r.now.v)}</b><small style="display:block;color:var(--muted);font-size:10px">${r.now.mm} mm wide</small></td>` + r[V.psc].map(cell).join('') + '</tr>'; });
    if (V.total) { const T = projTotal(rows); h += `<tr><td><b>Total</b>${rows.length < PJ.lesions.length ? ' <small style="color:var(--muted)">of the lesions shown</small>' : ''}</td><td></td><td><b>${fv(T.now.v)}</b></td>` + T.cells.map(c => `<td><b>${fv(c.v)}</b><small style="display:block;color:var(--muted);font-size:10px">${fv(c.lo)}–${fv(c.hi)}</small></td>`).join('') + '</tr>'; }
    wrap.insertAdjacentHTML('beforeend', h + '</table></div><div class="sub" style="margin-top:4px">' + esc_(PJ.note) +
      ' Dashed lines and hollow points are projected; thin bars = the range the two scans behind the rate allow. "No clear change" = the likely ranges of the two volumes overlap. ' +
      'The same sizes can be drawn on the images: Slice viewer → Simulate.</div>');
    body.append(wrap);
  }

  window.LesionTrends = {draw};
})();
