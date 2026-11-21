/* Costs section in the Library of the lab viewer (labs.html). Used by make_lab_view.py when local/costs/costs.json exists.
   Everything about the patient (care lines, prices, hospitals, flags, wording) comes from COST_DATA, never from this code.
   COST_DATA is made outside this repo by ../costs/viewer_export.py from the cost estimate in ../costs/ (posted hospital prices).
   Panels:
     cost:total  = "Costs · running total": a big running-total number (counts up on open; follows the hover line) over a
                   stacked "mountain" of the running total since diagnosis on the shared time axis. Colour by kind of care,
                   hospital or how sure the price is (posted rate / hospital's usual discount / borrowed). Other views: by month
                   (stacked columns). The biggest jumps are labelled; the Medicare date on file is a dashed line; click a step
                   or column for that day's / month's lines with codes, price basis, flags and sources.
     cost:detail = "Costs · breakdown": totals by kind and hospital (bar = Blue estimate, solid part = posted rates), the price
                   flags (file errors, big gaps between hospitals), caveats, and every line with a search box.
   Amount switch: Blue Cross estimate (allowed amount) or sticker (gross charge).
   It plugs into the same hooks as the MRD, imaging, procedure and DNA panels (MRD.isId/title/unit/h0/panel/refresh/section).
   Data: COST_DATA = {built, cols:[...], lines:[[date,cat,fac,event,code,code_basis,qty,sticker,allowed,basis,flags,source,item,act_billed,act_allowed]],
     cats:[{key,label,color}], facs:{key:label}, total:{sticker,allowed}, unpriced:{cat:n}, medicare:{date,label,short,text},
     basis:{key:text}, code_basis:{key:text}, caveats:[text], source} */
(() => {
  const D = COST_DATA, IDT = 'cost:total', IDD = 'cost:detail';
  const C = Object.fromEntries(D.cols.map((c, i) => [c, i]));
  const L = D.lines.map(r => ({date: r[C.date], t: ms(r[C.date]), cat: r[C.cat], fac: r[C.fac], event: r[C.event], code: r[C.code],
    cb: r[C.code_basis], qty: r[C.qty], st: r[C.sticker], al: r[C.allowed], basis: r[C.basis], flags: r[C.flags], src: r[C.source], item: r[C.item]}));
  const DONE = L.filter(x => x.cat !== 'planned'), PLAN = L.filter(x => x.cat === 'planned');
  const CAT = Object.fromEntries(D.cats.map(c => [c.key, c]));
  const FACN = D.facs;
  const FPAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300', '#e34948', '#7c8a99'];
  const FACS = [...new Set(DONE.map(x => x.fac))].sort((a, b) => sumBy(DONE.filter(x => x.fac === b), 'al') - sumBy(DONE.filter(x => x.fac === a), 'al'));
  const FCOL = Object.fromEntries(FACS.map((f, i) => [f, FPAL[i % FPAL.length]]));
  const SURE = [{key: 'posted', label: 'Posted Blue rate', color: '#2a78d6'}, {key: 'ratio', label: "Hospital's usual discount", color: '#85b7eb'},
                {key: 'borrowed', label: 'Borrowed from other hospitals', color: '#b4b2a9'},
                {key: 'list price', label: 'Published list price (outside the hospitals)', color: '#c98500'},
                {key: 'Medicare doctor fee', label: 'Medicare doctor fee schedule', color: '#6250d6'}];
  const sureOf = x => x.basis === 'posted-percent' ? 'posted' : x.basis;
  const PANELS = {[IDT]: {title: 'Costs · running total', unit: 'estimate from posted hospital prices', h0: 300},
                  [IDD]: {title: 'Costs · breakdown', unit: 'by kind, hospital, flags and every line', h0: 420}};
  const V = Object.assign({amt: 'al', view: 'run', by: 'cat', off: [], pick: null, q: '', showAll: false}, store.get('cost.view', {}));
  const save = () => store.set('cost.view', V);
  const BODIES = new Map();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const usd = v => '$' + Math.round(v).toLocaleString('en-US');
  const k$ = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? '$' + Math.round(v / 1e3) + 'k' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'k' : '$' + Math.round(v);
  const fd = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const fm = t => { const d = new Date(t); return MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  function sumBy(xs, k) { k = k || V.amt; return xs.reduce((s, x) => s + (k === 'al' ? x.al : x.st), 0); }
  const val = x => V.amt === 'al' ? x.al : x.st;
  const groups = () => V.by === 'cat' ? D.cats.filter(c => DONE.some(x => x.cat === c.key && val(x) > 0)).map(c => ({key: c.key, label: c.label, color: c.color}))
    : V.by === 'fac' ? FACS.filter(f => DONE.some(x => x.fac === f && val(x) > 0)).map(f => ({key: f, label: FACN[f] || f, color: FCOL[f]}))
    : SURE.filter(s => DONE.some(x => sureOf(x) === s.key && val(x) > 0));
  const gkey = x => V.by === 'cat' ? x.cat : V.by === 'fac' ? x.fac : sureOf(x);
  const on = g => !V.off.includes(V.by + ':' + g);
  const amtName = () => V.amt === 'al' ? 'Blue Cross estimate' : 'sticker price';

  if (!document.getElementById('costCss')) { const st = document.createElement('style'); st.id = 'costCss';
    st.textContent =
      '.cst-top{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-end;margin-bottom:6px}' +
      '.cst-hero{min-width:0}.cst-num{font-family:Georgia,"Times New Roman",serif;font-size:40px;line-height:1;font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.5px;color:var(--ink)}' +
      '.cst-cap{font-size:11.5px;color:var(--ink2);margin-top:3px}.cst-sub{font-size:11px;color:var(--muted)}' +
      '.cst-stats{display:flex;flex-wrap:wrap;gap:6px}.cst-stat{background:var(--bg);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--ink2)}.cst-stat b{display:block;font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '.cst-bar{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:11.5px;margin:4px 0 6px}' +
      '.cst-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}.cst-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.cst-leg{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:11px;color:var(--ink2);margin-top:4px}.cst-leg span{cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.cst-leg span.off{opacity:.35;text-decoration:line-through}.cst-leg i{width:10px;height:10px;border-radius:2px;display:inline-block}' +
      '.cst-card{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:8px;background:var(--card);font-size:12px}.cst-card h4{margin:0 0 4px;font-size:13px}' +
      '.cst-wrap{overflow:auto;max-width:100%}.cst-t{width:100%;border-collapse:collapse;font-size:12px}.cst-t th{text-align:left;font-weight:600;color:var(--ink2);font-size:11px;padding:3px 6px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}' +
      '.cst-t td{padding:3px 6px;border-bottom:1px solid var(--line);vertical-align:top}.cst-t td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.cst-meter{position:relative;height:9px;min-width:90px;background:var(--bg);border-radius:2px;overflow:hidden}.cst-meter i{position:absolute;top:0;bottom:0;left:0}' +
      '.cst-tag{display:inline-block;font-size:10px;padding:0 5px;border-radius:3px;border:1px solid var(--line);color:var(--ink2);white-space:nowrap}.cst-tag.posted{border-color:#2a78d6;color:#2a78d6}.cst-tag.ratio{border-color:#85b7eb}.cst-tag.borrowed{border-style:dashed}.cst-tag.unpriced{opacity:.6}' +
      '.cst-flag{color:#c2410c}.cst-note{font-size:11px;color:var(--muted);line-height:1.45;margin-top:6px}.cst-h{font-size:12.5px;font-weight:600;margin:10px 0 4px}';
    document.head.append(st); }
  const btn = (label, isOn, tip, fn) => { const b = document.createElement('button'); b.className = 'cst-b' + (isOn ? ' on' : ''); b.textContent = label; b.title = tip; b.onclick = fn; return b; };
  const lab = t => { const s = document.createElement('span'); s.className = 'cst-sub'; s.textContent = t; return s; };
  const redrawAll = () => BODIES.forEach((b, id) => { if (b.isConnected) (id === IDT ? drawTotal : drawDetail)(id, b); });

  /* ---------- running totals ---------- */
  const days = () => { const m = new Map(); DONE.forEach(x => { if (!on(gkey(x))) return; const v = val(x); if (!v) return;
    if (!m.has(x.t)) m.set(x.t, []); m.get(x.t).push(x); }); return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  const cumAt = (t, xs) => xs.filter(x => x.t <= t).reduce((s, x) => s + val(x), 0);

  function drawTotal(id, body) {
    const old = charts.get(id); if (old) { old.destroy(); charts.delete(id); }
    body.innerHTML = '';
    const G = groups().filter(g => on(g.key)), D_ = days(), all = DONE.filter(x => on(gkey(x)));
    const total = sumBy(all), inWin = all.filter(x => x.t >= W.a && x.t <= W.b), before = cumAt(W.a - 1, all);
    const posted = sumBy(all.filter(x => sureOf(x) === 'posted'));
    // header: hero number + small stats + switches
    const top = document.createElement('div'); top.className = 'cst-top';
    const hero = document.createElement('div'); hero.className = 'cst-hero';
    const num = document.createElement('div'); num.className = 'cst-num'; num.setAttribute('aria-live', 'polite');
    const cap = document.createElement('div'); cap.className = 'cst-cap';
    hero.append(num, cap);
    const setHero = (v, text) => { num.textContent = usd(v); cap.textContent = text; };
    const restText = () => 'Running total, ' + amtName() + ', all care ' + fm(DONE[0].t) + ' – ' + fm(DONE[DONE.length - 1].t) + (V.off.length ? ' (some hidden)' : '');
    const stats = document.createElement('div'); stats.className = 'cst-stats';
    const stat = (b, t, tip) => { const s = document.createElement('div'); s.className = 'cst-stat'; s.title = tip || ''; s.innerHTML = '<b>' + esc(b) + '</b>' + esc(t); return s; };
    stats.append(stat(k$(sumBy(DONE, 'st')), 'sticker prices', "What the hospitals' price lists charge before any discount"),
      stat(k$(sumBy(DONE, 'al')), 'Blue Cross estimate', 'What the plan and family together would owe at the posted Blue Cross rates'),
      stat(Math.round(100 * posted / Math.max(total, 1)) + '%', 'from posted rates', "Share of this total that uses the hospital's own posted Blue Cross rate; the rest is estimated"),
      stat(k$(sumBy(inWin)), 'in this time window', fm(W.a) + ' – ' + fm(W.b)),
      stat('?', "family's share", 'Not in any file: needs the plan\'s statements (deductible, coinsurance, out-of-pocket maximum)'));
    top.append(hero, stats); body.append(top);
    const bar = document.createElement('div'); bar.className = 'cst-bar';
    bar.append(lab('Amount:'), btn('Blue Cross estimate', V.amt === 'al', 'Allowed amount at the posted Blue Cross rates', () => { V.amt = 'al'; save(); redrawAll(); }),
      btn('Sticker', V.amt === 'st', "Hospitals' gross charges before discounts", () => { V.amt = 'st'; save(); redrawAll(); }),
      lab(' Show:'), btn('Running total', V.view === 'run', 'Running total since diagnosis', () => { V.view = 'run'; save(); redrawAll(); }),
      btn('By month', V.view === 'mon', 'What each month added', () => { V.view = 'mon'; save(); redrawAll(); }),
      lab(' Colour:'), btn('kind of care', V.by === 'cat', '', () => { V.by = 'cat'; save(); redrawAll(); }),
      btn('hospital', V.by === 'fac', '', () => { V.by = 'fac'; save(); redrawAll(); }),
      btn('how sure', V.by === 'sure', 'Posted rate (fact) vs estimated', () => { V.by = 'sure'; save(); redrawAll(); }));
    body.append(bar);
    // chart
    const box = document.createElement('div'); box.style.cssText = 'position:relative;height:' + hOf(id, PANELS[id].h0) + 'px';
    const cv = document.createElement('canvas'); cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Running total of care costs over time, ' + amtName() + ', ' + usd(total) + ' in all');
    const tip = document.createElement('div'); tip.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:5;max-width:300px;background:rgba(0,0,0,.86);color:#fff;font-size:11px;line-height:1.35;padding:5px 7px;border-radius:5px';
    box.append(cv, tip); body.append(box);
    let datasets, ymax, months = [];
    const X = t => pos(Math.min(Math.max(t, W.a), W.b));
    if (V.view === 'run') {
      // one stacked step area per group: running total from diagnosis; the window starts with what came before it
      const ts = [W.a, ...D_.map(d => d[0]).filter(t => t > W.a && t <= W.b), W.b];
      const per = Object.fromEntries(G.map(g => [g.key, all.filter(x => gkey(x) === g.key)]));
      datasets = G.map((g, i) => ({label: g.label, data: ts.map(t => ({x: X(t), y: cumAt(t, per[g.key])})), stepped: 'after', borderWidth: 1,
        borderColor: g.color, backgroundColor: g.color + 'cc', fill: i ? '-1' : 'origin', pointRadius: 0, pointHitRadius: 0}));
      ymax = cumAt(W.b, all) * 1.12 || 1;
    } else {
      const m = new Map();
      all.forEach(x => { if (x.t < W.a || x.t > W.b) return; const d = new Date(x.t), k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        if (!m.has(k)) m.set(k, {t: k, xs: []}); m.get(k).xs.push(x); });
      months = [...m.values()].sort((a, b) => a.t - b.t);
      datasets = [{data: []}]; ymax = Math.max(1, ...months.map(o => sumBy(o.xs))) * 1.15;
    }
    // biggest jumps in the window get a label (running total view)
    const jumps = V.view === 'run' ? D_.filter(d => d[0] >= W.a && d[0] <= W.b).map(d => ({t: d[0], xs: d[1], v: sumBy(d[1])})).sort((a, b) => b.v - a.v).slice(0, 5) : [];
    const short = xs => { const c = {}; xs.forEach(x => { const k = x.cat === 'infusion drug' ? x.event.split(' ')[0].replace(/^fam-trastuzumab$/i, 'Enhertu') : x.cat === 'radiation' ? x.event.split(',')[0] : (CAT[x.cat] || {}).label || x.cat; c[k] = (c[k] || 0) + val(x); });
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0].replace(/^fam-trastuzumab deruxtecan/i, 'Enhertu').replace(/^(\w)/, s => s.toUpperCase()); };
    let hits = [];
    const layer = {id: 'costLayer', afterDatasetsDraw(c) {
      const {ctx, chartArea: a, scales: {x, y}} = c; hits = []; ctx.save();
      if (V.view === 'mon') {
        const w = Math.max(3, (x.getPixelForValue(pos(W.a + 28 * DAY)) - x.getPixelForValue(pos(W.a))) * .72);
        months.forEach(o => { const cx = x.getPixelForValue(pos(o.t + 15 * DAY)); let y0 = y.getPixelForValue(0);
          G.forEach(g => { const v = sumBy(o.xs.filter(z => gkey(z) === g.key)); if (!v) return; const y1 = y.getPixelForValue(y.getValueForPixel(y0) + v);
            ctx.fillStyle = g.color; ctx.fillRect(cx - w / 2, y1, w, y0 - y1 - (y0 - y1 > 3 ? 1 : 0)); y0 = y1; });
          if (V.pick === 'm' + o.t) { ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.strokeRect(cx - w / 2 - 2, y0 - 2, w + 4, y.getPixelForValue(0) - y0 + 2); }
          hits.push({x0: cx - w / 2 - 2, x1: cx + w / 2 + 2, y0: y0 - 4, y1: a.bottom, id: 'm' + o.t, lines: [fm(o.t) + ': ' + usd(sumBy(o.xs)), ...topLines(o.xs), 'Click for the lines']}); });
      } else {
        ctx.font = '10px system-ui'; ctx.textBaseline = 'bottom';
        jumps.forEach((j, i) => { const px = x.getPixelForValue(X(j.t)), py = y.getPixelForValue(cumAt(j.t, all));
          const txt = short(j.xs) + ' +' + k$(j.v), tw = ctx.measureText(txt).width, ly = Math.max(a.top + 12, py - 14 - (i % 2) * 13);
          const lx = Math.min(Math.max(px - tw / 2, a.left + 2), a.right - tw - 2);
          ctx.strokeStyle = css('--ink2'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py - 1); ctx.lineTo(px, ly + 1); ctx.stroke();
          ctx.fillStyle = 'color-mix(in srgb,' + css('--card') + ' 85%,transparent)'; ctx.fillRect(lx - 2, ly - 12, tw + 4, 13);
          ctx.fillStyle = css('--ink'); ctx.fillText(txt, lx, ly); });
        D_.forEach(d => { if (d[0] < W.a || d[0] > W.b) return; const px = x.getPixelForValue(X(d[0]));
          hits.push({x0: px - 4, x1: px + 4, y0: a.top, y1: a.bottom, id: 'd' + d[0], lines: [fd(new Date(d[0]).toISOString().slice(0, 10)) + ': +' + usd(sumBy(d[1])), ...topLines(d[1]), 'Click for the lines']}); });
        if (V.pick && V.pick[0] === 'd') { const t = +V.pick.slice(1); if (t >= W.a && t <= W.b) { const px = x.getPixelForValue(X(t));
          ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); } }
      }
      // Medicare date on file and planned items
      const mt = ms(D.medicare.date);
      if (mt >= W.a && mt <= W.b) { const px = x.getPixelForValue(pos(mt)); ctx.strokeStyle = '#6250d6'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#6250d6'; ctx.font = '10px system-ui'; ctx.textBaseline = 'top'; const t = D.medicare.short || D.medicare.label, tw = ctx.measureText(t).width;
        ctx.fillText(t, px - tw - 4 > a.left ? px - tw - 4 : px + 4, a.top + 2);
        hits.push({x0: px - 4, x1: px + 4, y0: a.top, y1: a.top + 40, pri: 1, lines: [D.medicare.label, D.medicare.text]}); }
      PLAN.forEach(p => { if (p.t < W.a || p.t > W.b) return; const px = x.getPixelForValue(pos(p.t)), py = y.getPixelForValue(V.view === 'run' ? cumAt(W.b, all) : 0);
        ctx.strokeStyle = css('--ink2'); ctx.setLineDash([2, 3]); ctx.strokeRect(px - 5, py - 16, 10, 14); ctx.setLineDash([]);
        hits.push({x0: px - 6, x1: px + 6, y0: py - 18, y1: py, pri: 1, lines: ['Planned ' + fd(p.date) + ': ' + p.event, 'Surgeon fee alone ' + usd(val(p)) + ' (' + amtName() + '); not in the total']}); });
      // hover line + date
      if (hoverX != null) { const px = x.getPixelForValue(hoverX); if (px >= a.left && px <= a.right) { ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]); } }
      ctx.restore(); }};
    const c = new Chart(cv, {type: 'line', plugins: [layer, momentPlugin],
      data: {datasets: V.view === 'run' ? datasets : []},
      options: {animation: false, maintainAspectRatio: false, parsing: false, layout: TLAY(16),
        interaction: {mode: 'nearest', intersect: false},
        onHover: (ev, els, ch) => { const xv = ch.scales.x.getValueForPixel(ev.x); setHover(xv >= 0 && xv <= 100 ? xv : null);
          if (xv >= 0 && xv <= 100) { const t = unpos(xv); cap.dataset.hover = '1'; setHero(cumAt(t, all), 'Running total up to ' + fd(new Date(t).toISOString().slice(0, 10)) + ' · ' + amtName()); } },
        plugins: {legend: {display: false}, tooltip: {enabled: false}},
        scales: {x: Object.assign(xAxisCost(), {}), y: {stacked: V.view === 'run', min: 0, max: ymax, afterFit: s => { s.width = YW; },
          ticks: {color: css('--muted'), maxTicksLimit: 6, callback: v => k$(v)}, grid: {color: css('--line')}}}}});
    charts.set(id, c);
    const hitAt = (px, py) => hits.filter(h => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1).sort((a, b) => (b.pri || 0) - (a.pri || 0))[0];
    const showTip = (h, px, py) => { if (!h) { tip.style.display = 'none'; return; } tip.innerHTML = h.lines.map((l, i) => i ? esc(l) : '<b>' + esc(l) + '</b>').join('<br>');
      tip.style.display = 'block'; tip.style.left = Math.min(px + 12, box.clientWidth - 300) + 'px'; tip.style.top = Math.min(py + 12, box.clientHeight - 20) + 'px'; };
    cv.addEventListener('mousemove', ev => { const h = hitAt(ev.offsetX, ev.offsetY); showTip(h, ev.offsetX, ev.offsetY); cv.style.cursor = h && h.id ? 'pointer' : 'default'; });
    cv.addEventListener('click', ev => { const h = hitAt(ev.offsetX, ev.offsetY); V.pick = h && h.id ? (V.pick === h.id ? null : h.id) : null; save(); setTimeout(redrawAll, 0); });
    box.onmouseleave = () => { setHover(null); showTip(null); delete cap.dataset.hover; setHero(total, restText()); };
    // legend (click to hide a group)
    const lg = document.createElement('div'); lg.className = 'cst-leg';
    groups().forEach(g => { const s = document.createElement('span'); s.className = on(g.key) ? '' : 'off'; s.title = 'Click to ' + (on(g.key) ? 'hide' : 'show');
      s.innerHTML = '<i style="background:' + g.color + '"></i>' + esc(g.label) + ' ' + k$(sumBy(DONE.filter(x => gkey(x) === g.key)));
      s.onclick = () => { const k = V.by + ':' + g.key; V.off = V.off.includes(k) ? V.off.filter(z => z !== k) : V.off.concat(k); save(); redrawAll(); }; lg.append(s); });
    body.append(lg);
    if (V.pick) body.append(pickCard());
    const note = document.createElement('div'); note.className = 'cst-note';
    note.textContent = D.caveats[0] + ' ' + D.caveats[1] + ' Dashed purple line: ' + D.medicare.label + '.';
    body.append(note);
    // count up the big number when the panel opens
    const t0 = performance.now(), dur = 900, from = Math.max(0, total * .55);
    const tick = now => { if (!num.isConnected) return; const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      if (!cap.dataset.hover) setHero(from + (total - from) * e, restText()); if (k < 1) requestAnimationFrame(tick); };
    setHero(from, restText()); requestAnimationFrame(tick);
    setTimeout(() => { if (num.isConnected && !cap.dataset.hover) setHero(total, restText()); }, dur + 80);   // background tabs pause animation frames
  }
  function xAxisCost() { const TK = ticks();
    return {type: 'linear', min: 0, max: 100, afterFit: tEdge, afterBuildTicks: a => { a.ticks = TK.map(k => ({value: k.value})); },
      ticks: {color: css('--muted'), autoSkip: false, maxRotation: 0, callback: (v, i) => TK[i] ? TK[i].label : ''},
      grid: {color: c => { const k = TK[c.index]; return k && (k.year || k.brk) ? css('--line') : 'transparent'; }}}; }
  const topLines = xs => { const c = {}; xs.forEach(x => { const k = (CAT[x.cat] || {}).label || x.cat; c[k] = (c[k] || 0) + val(x); });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + usd(v)); };
  function pickCard() {
    const isM = V.pick[0] === 'm', t = +V.pick.slice(1), d = new Date(t);
    const xs = DONE.filter(x => on(gkey(x)) && (isM ? (new Date(x.t).getUTCFullYear() === d.getUTCFullYear() && new Date(x.t).getUTCMonth() === d.getUTCMonth()) : x.t === t))
      .sort((a, b) => val(b) - val(a));
    const box = document.createElement('div'); box.className = 'cst-card';
    box.innerHTML = '<h4>' + esc(isM ? fm(t) : fd(new Date(t).toISOString().slice(0, 10))) + ': ' + usd(sumBy(xs)) + ' <span class="cst-sub">' + amtName() + ' · ' + xs.length + ' lines · click again to close</span></h4>' + linesTable(xs, isM);
    return box;
  }
  const tag = b => '<span class="cst-tag ' + esc(b === 'posted-percent' ? 'posted' : b === 'list price' ? 'list' : b === 'Medicare doctor fee' ? 'mdf' : b) + '" title="' + esc(D.basis[b] || '') + '">' + esc(b) + '</span>';
  function linesTable(xs, withDate, limit) {
    const rows = xs.slice(0, limit || 400);
    return '<div class="cst-wrap" style="max-height:340px"><table class="cst-t"><tr>' + (withDate ? '<th>Date</th>' : '') + '<th>What (fact from the records)</th><th>Hospital</th><th>Code</th><th class="n">Sticker</th><th class="n">Blue est.</th><th>Price from</th></tr>' +
      rows.map(x => '<tr>' + (withDate ? '<td class="n">' + esc(x.date) + '</td>' : '') + '<td>' + esc(x.event) + (x.flags ? '<div class="cst-flag" style="font-size:10.5px">⚑ ' + esc(x.flags) + '</div>' : '') +
        '<div class="cst-sub" title="' + esc(x.src) + '">' + esc(x.item || '') + '</div></td><td>' + esc(FACN[x.fac] || x.fac) + '</td>' +
        '<td title="' + esc(D.code_basis[x.cb] || '') + '">' + esc(x.code || '—') + (x.qty && x.qty !== 1 ? ' ×' + x.qty : '') + '<div class="cst-sub">' + esc(x.cb) + '</div></td>' +
        '<td class="n">' + (x.st ? usd(x.st) : '—') + '</td><td class="n">' + (x.al ? usd(x.al) : x.basis === 'in per diem' ? 'in day rate' : '—') + '</td><td>' + tag(x.basis) + '</td></tr>').join('') +
      '</table></div>' + (xs.length > rows.length ? '<div class="cst-sub">' + (xs.length - rows.length) + ' more lines: narrow the search</div>' : '');
  }

  /* ---------- breakdown ---------- */
  function drawDetail(id, body) {
    body.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'cst-bar';
    bar.append(lab('Amount:'), btn('Blue Cross estimate', V.amt === 'al', '', () => { V.amt = 'al'; save(); redrawAll(); }),
      btn('Sticker', V.amt === 'st', '', () => { V.amt = 'st'; save(); redrawAll(); }));
    body.append(bar);
    const table = (title, keyOf, labelOf) => {
      const m = new Map(); DONE.forEach(x => { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      const rows = [...m.entries()].map(([k, xs]) => ({k, xs, v: sumBy(xs), p: sumBy(xs.filter(x => sureOf(x) === 'posted'))})).sort((a, b) => b.v - a.v);
      const mx = Math.max(1, ...rows.map(r => r.v));
      return '<div class="cst-h">' + esc(title) + '</div><div class="cst-wrap"><table class="cst-t"><tr><th>' + esc(title === 'By hospital' ? 'Hospital' : 'Kind of care') + '</th><th class="n">Lines</th><th class="n">' + (V.amt === 'al' ? 'Blue est.' : 'Sticker') + '</th><th style="min-width:110px">Posted rate (solid) vs estimated</th></tr>' +
        rows.map(r => '<tr><td>' + esc(labelOf(r.k)) + '</td><td class="n">' + r.xs.length + '</td><td class="n">' + (r.v ? usd(r.v) : 'not priced') + '</td><td><div class="cst-meter" title="' + (r.v ? Math.round(100 * r.p / r.v) + '% from posted Blue rates' : '') + '">' +
          '<i style="width:' + (100 * r.v / mx) + '%;background:#85b7eb"></i><i style="width:' + (100 * r.p / mx) + '%;background:#2a78d6"></i></div></td></tr>').join('') + '</table></div>'; };
    const sec = document.createElement('div');
    sec.innerHTML = table('By kind of care', x => x.cat, k => (CAT[k] || {}).label || k) + table('By hospital', x => x.fac, k => FACN[k] || k);
    body.append(sec);
    // flags grouped
    const fl = new Map();
    DONE.forEach(x => (x.flags || '').split('; ').filter(f => f && !/not in this hospital|folded into|flat daily rate/.test(f)).forEach(f => {
      const k = x.fac + '|' + x.code + '|' + f; if (!fl.has(k)) fl.set(k, {x, f, n: 0, v: 0}); const o = fl.get(k); o.n++; o.v += val(x); }));
    const F = [...fl.values()].sort((a, b) => b.v - a.v);
    const fd_ = document.createElement('div');
    fd_.innerHTML = '<div class="cst-h">⚑ Flags: problems and big differences in the posted prices (' + F.length + ')</div><div class="cst-wrap" style="max-height:260px"><table class="cst-t"><tr><th>Hospital</th><th>Item</th><th>Flag</th><th class="n">Lines</th><th class="n">' + (V.amt === 'al' ? 'Blue est.' : 'Sticker') + '</th></tr>' +
      F.map(o => '<tr><td>' + esc(FACN[o.x.fac] || o.x.fac) + '</td><td>' + esc(o.x.code) + ' <span class="cst-sub">' + esc(o.x.item) + '</span></td><td class="cst-flag">' + esc(o.f) + '</td><td class="n">' + o.n + '</td><td class="n">' + usd(o.v) + '</td></tr>').join('') + '</table></div>' +
      '<div class="cst-card"><b>' + esc(D.medicare.label) + '.</b> ' + esc(D.medicare.text) + '</div>' +
      '<div class="cst-note">' + D.caveats.map(esc).join('<br>') + '<br>How sure each price is: ' + Object.entries(D.basis).map(([k, t]) => tag(k) + ' ' + esc(t)).join(' · ') +
      '<br>Source: ' + esc(D.source) + ' (built ' + esc(D.built) + ')</div>';
    body.append(fd_);
    // every line with a search box
    const h = document.createElement('div'); h.className = 'cst-h'; h.textContent = 'Every line';
    const inp = document.createElement('input'); inp.type = 'search'; inp.placeholder = 'Search: a test, drug, date (2025-09), hospital or "borrowed"…'; inp.value = V.q;
    inp.style.cssText = 'width:100%;max-width:360px;font-size:12px;padding:3px 6px;margin-bottom:4px';
    const out = document.createElement('div');
    const show = () => { const q = inp.value.trim().toLowerCase(); V.q = inp.value; save();
      const xs = DONE.filter(x => !q || [x.date, x.event, x.code, FACN[x.fac], x.basis, x.cb, x.flags, x.item, (CAT[x.cat] || {}).label].join(' ').toLowerCase().includes(q));
      out.innerHTML = '<div class="cst-sub">' + xs.length + ' lines · ' + usd(sumBy(xs)) + ' ' + amtName() + '</div>' + linesTable(xs, true, 250); };
    inp.oninput = show; body.append(h, inp, out); show();
  }

  /* ================= plug into the viewer's hooks ================= */
  const o = {isId: MRD.isId, title: MRD.title, unit: MRD.unit, h0: MRD.h0, panel: MRD.panel, refresh: MRD.refresh, section: MRD.section};
  const mine = id => id === IDT || id === IDD;
  MRD.isId = id => mine(id) || o.isId(id);
  MRD.title = id => mine(id) ? PANELS[id].title : o.title(id);
  MRD.unit = id => mine(id) ? PANELS[id].unit : o.unit(id);
  MRD.h0 = id => mine(id) ? PANELS[id].h0 : o.h0(id);
  MRD.panel = (id, body) => { if (!mine(id)) return o.panel(id, body); BODIES.set(id, body); (id === IDT ? drawTotal : drawDetail)(id, body); };
  MRD.refresh = id => { if (!mine(id)) return o.refresh(id); const b = BODIES.get(id); if (b && b.isConnected) (id === IDT ? drawTotal : drawDetail)(id, b); };

  /* Library: Costs -> the two panels */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = ('costs cost money price prices bill bills billing insurance blue cross medicare dollars total spending ' + D.cats.map(c => c.label).join(' ') + ' ' + Object.values(FACN).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return;
    const SEC = section(el, 'cost', 'Costs', k$(sumBy(DONE, 'al')) + ' est.', false, 'sec', q), s0 = SEC.firstChild;
    panelBtns(SEC, 'Costs panel', 'grp:cost', [IDT, IDD], 'Costs');
    const row = (id, label, count, tip) => { const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.includes(id); cb.setAttribute('aria-label', 'Show ' + label);
      cb.onclick = e => { e.stopPropagation(); setLabSel([id], cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      d.append(cb, nm, n); d.onclick = () => { cb.checked = !cb.checked; setLabSel([id], cb.checked); }; return d; };
    SEC.append(row(IDT, 'Running total', k$(sumBy(DONE, 'al')), 'The running total of care costs since diagnosis on the time axis'),
      row(IDD, 'Breakdown, flags and every line', DONE.length + ' lines', 'Totals by kind and hospital, price flags, caveats and every line'));
  };

  const saved = store.get('selected', []);
  if (saved.some(mine) && !sel.some(mine)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
