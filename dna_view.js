/* DNA section in the Library of the lab viewer (labs.html). Used by make_lab_view.py when local/dna/dna.json exists.
   Everything about the patient (sample, genes, copy ratios, mutations, drugs, flags, wording) comes from DNA_DATA, never from this code.
   Panel dna:genes = gene copy number in one sequenced sample next to the drugs that target each gene:
     Genes and drugs    = one row per gene: copies vs the genome average (log scale), a mutation tag, drug chips
                          (filled = found in the medication records); click a row for its card
     All gained regions = every gained stretch with the genes in it
     Mitochondria view  = (when DNA_DATA.mito exists) variant table for the mitochondrial genome and a drawing of the
                          reads around one position (one row per read, letters only where a read differs)
     Findings views     = one per entry of DNA_DATA.views: an intro, any number of plain tables (a cell may be a
                          {chip,strong} tag) and notes; for further topics that need no drawing of their own
     Microbes view      = (when DNA_DATA.microbes exists) organisms named among reads that did not match the reference,
                          and a table of where every unmatched read went
   Flags (DNA_DATA.flags) show as boxes at the top of the panel and as rows in the Library.
   It plugs into the same hooks as the MRD, imaging, procedure and pathology panels (MRD.isId/title/unit/h0/panel/refresh/section).
   Data: DNA_DATA = {sample:{label,date,source,analysis}, groups:[{key,title}], n_genes_measured, status_labels:{status:text}, footnote,
     genes:[{gene,group,chrom,start,end,ratio,state,bins,tumor_reads,normal_reads,region,note,mutation:{name,reads,effect}|null,
             drugs:[{drug,cls,status,note,checked,labels:[{name,link,date}],given:{first,last,orders}|null}]}], regions:[{chrom,start,end,kb,ratio,state,genes}],
     flags:[{date,by,title,text,source}],
     mito:{title,intro,sample_names:[a,b],variants:[{pos,change,a_alt,a_depth,a_pct,b_alt,b_depth,call,note,flag}],notes:[text],source,
           pileup:{pos,start,ref,caption,samples:[{label,summary,rows:[{s,e,d:{pos:letter}}]}]}|null}|null,
     views:[{key,title,count,intro,tables:[{title,columns:[text],rows:[[text|{chip,strong}]]}],notes:[text],source}],
     microbes:{title,intro,sample_names:[a,b],organisms:[{name,tumor,normal,kind,note}],notes:[text],categories:[{label,tumor,normal,what}],source}|null}, made outside this repo (it holds health data).
   Drug status keys: approved-here (approved for this patient's kind of cancer), approved-other, investigational. */
(() => {
  const D = DNA_DATA, ID = 'dna:genes';
  const PANEL = {title: 'DNA · gene copies and matching drugs', unit: D.sample.label + ' · ' + D.genes.length + ' genes shown', h0: 620};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const V = Object.assign({view: 'genes', sort: 'group', cur: null, onlyDrugs: false}, store.get('dna.view', {}));
  const save = () => store.set('dna.view', V);
  /* which genes the table shows: V.genes is 'all' or a list of gene names (ticked in the Library) */
  const ALLG = D.genes.map(g => g.gene);
  if (V.genes == null) V.genes = 'all';
  if (Array.isArray(V.genes)) V.genes = V.genes.filter(x => ALLG.includes(x));
  const inG = name => V.genes === 'all' || V.genes.includes(name);
  const picksG = () => V.genes === 'all' ? ALLG.slice() : V.genes.slice();
  const setPicksG = names => { const ks = ALLG.filter(x => names.includes(x)); V.genes = ks.length === ALLG.length ? 'all' : ks; };
  let BODY = null;
  const redraw = () => { if (BODY && BODY.isConnected) draw(ID, BODY); };
  const STATE = {amplified: 'amplified', gained: 'gained', average: 'about average', lower: 'fewer copies'};
  const STAT = D.status_labels || {};
  const fx = x => (x >= 10 ? x.toFixed(0) : x.toFixed(x >= 2 ? 1 : 2)) + '×';
  const fd = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
  const LO = -2, HI = 4;                                   // log2 scale: 0.25x .. 16x
  const pos = x => (Math.min(HI, Math.max(LO, Math.log2(x))) - LO) / (HI - LO) * 100;

  if (!document.getElementById('dnaCss')) { const st = document.createElement('style'); st.id = 'dnaCss';
    st.textContent =
      '.dna-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:8px}' +
      '.dna-b{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap}' +
      '.dna-b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}' +
      '.dna-wrap{overflow:auto;border-top:1px solid var(--line)}' +
      '.dna-t{width:100%;border-collapse:collapse;font-size:12.5px}.dna-t th{position:sticky;top:0;background:var(--card);text-align:left;font-weight:600;color:var(--ink2);font-size:11px;padding:4px 8px;border-bottom:1px solid var(--line);z-index:1}' +
      '.dna-t td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:middle}.dna-t tr.g td{background:var(--bg);font-weight:600;font-size:11.5px;color:var(--ink2);padding-top:10px}' +
      '.dna-t tr.r{cursor:pointer}.dna-t tr.r:hover td{background:var(--bg)}.dna-t tr.r.cur td{background:var(--band)}' +
      '.dna-gene{font-weight:600}.dna-sub{color:var(--muted);font-size:11px}' +
      '.dna-ax{position:relative;height:18px;min-width:220px}.dna-ax i{position:absolute;top:0;bottom:0;width:1px;background:var(--line)}.dna-ax i.one{background:var(--muted)}' +
      '.dna-fill{position:absolute;top:4px;height:10px;border-radius:2px}.dna-fill.up{background:#c2410c}.dna-fill.dn{background:#2a78d6}.dna-fill.av{background:var(--muted)}' +
      '.dna-val{position:absolute;top:0;font-size:11px;line-height:18px;color:var(--ink);font-variant-numeric:tabular-nums;padding:0 4px;white-space:nowrap}' +
      '.dna-tick{position:relative;height:14px;min-width:220px;font-size:10px;color:var(--muted)}.dna-tick span{position:absolute;transform:translateX(-50%)}' +
      '.dna-chip{display:inline-block;font-size:11px;padding:0 7px;border-radius:9px;margin:1px 3px 1px 0;border:1px solid var(--ink2);color:var(--ink);white-space:nowrap}' +
      '.dna-chip.given{background:var(--ink);color:var(--bg);border-color:var(--ink)}.dna-chip.other{border-style:solid;border-color:var(--muted);color:var(--ink2)}.dna-chip.inv{border-style:dashed;border-color:var(--muted);color:var(--ink2)}' +
      '.dna-mut{display:inline-block;font-size:11px;padding:0 6px;border-radius:3px;background:var(--hi);color:#fff;margin-left:6px}' +
      '.dna-none{color:var(--muted);font-size:11.5px}' +
      '.dna-card{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0;background:var(--card);font-size:12.5px}.dna-card h4{margin:0 0 4px;font-size:14px}.dna-card ul{margin:4px 0 0 18px;padding:0}.dna-card li{margin:2px 0}' +
      '.dna-pile{font:12px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;margin:2px 0 0;letter-spacing:.28em;white-space:pre}.dna-pile .r{font-weight:700;color:var(--ink)}.dna-pile .m{color:var(--muted)}.dna-pile .o{font-weight:700;color:var(--ink)}.dna-pile .x{font-weight:700;color:#c2410c}.dna-pile .hl{background:rgba(194,65,12,.16)}' +
      '.dna-leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:var(--ink2);margin:6px 0}.dna-foot{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4}';
    document.head.append(st); }

  const chip = d => { const c = d.given ? 'given' : d.status === 'approved-here' ? '' : d.status === 'approved-other' ? 'other' : 'inv';
    const tip = d.cls + ' · ' + STAT[d.status] + (d.given ? '\nIn the medication records: ' + fd(d.given.first) + ' to ' + fd(d.given.last) : '\nNot in the medication records') + (d.note ? '\n' + d.note : '');
    return '<span class="dna-chip ' + c + '" title="' + esc(tip) + '">' + (d.given ? '✓ ' : '') + esc(d.drug) + '</span>'; };
  const bar = g => { const p1 = pos(1), p = pos(g.ratio), cls = g.state === 'average' ? 'av' : g.ratio > 1 ? 'up' : 'dn';
    const l = Math.min(p, p1), w = Math.max(Math.abs(p - p1), .6);
    const lab = g.ratio >= 1 ? 'left:' + (p + .5) + '%' : 'right:' + (100 - p + .5) + '%';
    return '<div class="dna-ax">' + [.25, .5, 1, 2, 4, 8, 16].map(t => '<i class="' + (t === 1 ? 'one' : '') + '" style="left:' + pos(t) + '%"></i>').join('') +
      '<div class="dna-fill ' + cls + '" style="left:' + l + '%;width:' + w + '%"></div><span class="dna-val" style="' + lab + '">' + fx(g.ratio) + '</span></div>'; };
  const ticks = '<div class="dna-tick">' + [.25, .5, 1, 2, 4, 8, 16].map(t => '<span style="left:' + pos(t) + '%">' + t + '×</span>').join('') + '</div>';

  function card(g) {
    return '<div class="dna-card"><h4>' + esc(g.gene) + ' <span class="dna-sub">chr' + esc(g.chrom) + ':' + (g.start / 1e6).toFixed(2) + ' Mb (hg19)' + (g.region ? ' · ' + esc(g.region) : '') + '</span></h4>' +
      '<div><b>' + fx(g.ratio) + ' the genome average</b> (' + STATE[g.state] + '): ' + g.tumor_reads.toLocaleString() + ' tumor reads vs ' + g.normal_reads.toLocaleString() + ' normal reads over ' + g.bins + ' captured 1 kb bins.</div>' +
      (g.note ? '<div>' + esc(g.note) + '</div>' : '') +
      (g.mutation ? '<div style="margin-top:4px"><b>Mutation:</b> ' + esc(g.mutation.name) + ' · ' + esc(g.mutation.reads) + '<br>' + esc(g.mutation.effect) + '</div>' : '') +
      (g.drugs.length ? '<div style="margin-top:6px"><b>Drugs that target it</b><ul>' + g.drugs.map(d => '<li><b>' + esc(d.drug) + '</b> · ' + esc(d.cls) + ' · ' + STAT[d.status] +
        (d.given ? ' · <b>given</b> ' + fd(d.given.first) + ' to ' + fd(d.given.last) + ' (medication records)' : ' · not in the medication records') + (d.note ? '<br><span class="dna-sub">' + esc(d.note) + '</span>' : '') + ((d.labels || []).length ? '<br><span class="dna-sub">' + (d.checked ? 'Label checked ' + esc(d.checked) + ': ' : '') + d.labels.map(l => l.link ? '<a href="' + esc(l.link) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(l.name) + ' label ↗</a>' : esc(l.name) + ' (no US label)').join(' · ') + '</span>' : '') + '</li>').join('') + '</ul></div>'
        : '<div class="dna-none" style="margin-top:6px">No drug targets this gene.</div>') +
      '<div class="dna-sub" style="margin-top:6px">Source: ' + esc(D.sample.source) + ' · ' + esc(D.sample.analysis) + '</div></div>'; }

  function draw(id, body) {
    BODY = body;
    let h = '<div class="dna-bar">' +
      [['genes', 'Genes and drugs'], ['regions', 'All gained regions']].concat(D.mito ? [['mito', D.mito.title]] : []).concat(D.microbes ? [['microbes', D.microbes.title]] : []).concat((D.views || []).map(v => ['x:' + v.key, v.title])).map(([k, t]) => '<button class="dna-b' + (V.view === k ? ' on' : '') + '" data-view="' + k + '">' + t + '</button>').join('') +
      (V.view === 'genes' ? '<span style="color:var(--muted)">|</span>' +
        [['group', 'Grouped'], ['ratio', 'By copy number'], ['chrom', 'By chromosome']].map(([k, t]) => '<button class="dna-b' + (V.sort === k ? ' on' : '') + '" data-sort="' + k + '">' + t + '</button>').join('') +
        '<label style="font-size:11px;margin-left:6px"><input type="checkbox" data-od ' + (V.onlyDrugs ? 'checked' : '') + '> only genes with a drug</label>' : '') +
      '<span style="margin-left:auto;color:var(--ink2)">' + esc(D.sample.label) + ' · ' + D.n_genes_measured.toLocaleString() + ' genes measured</span></div>';
    (D.flags || []).forEach(f => { h += '<div class="dna-card" style="border-left:4px solid var(--hi)"><b>⚑ Flagged: ' + esc(f.title) + '</b> <span class="dna-sub">' + esc(f.date) + ' · flagged by ' + esc(f.by) + '</span><div>' + esc(f.text) + '</div><div class="dna-sub">' + esc(f.source) + '</div></div>'; });
    if (V.view === 'genes') {
      h += '<div class="dna-leg"><span><span class="dna-chip given">✓ drug</span>given (medication records)</span><span><span class="dna-chip">drug</span>' + esc(STAT['approved-here'] || 'approved for this cancer') + ', not in records</span>' +
        '<span><span class="dna-chip other">drug</span>' + esc(STAT['approved-other'] || 'approved elsewhere') + '</span><span><span class="dna-chip inv">drug</span>' + esc(STAT.investigational || 'trials only') + '</span><span><span class="dna-mut">mutation</span>tumor-only mutation found</span></div>';
      const cur = D.genes.find(g => g.gene === V.cur); if (cur) h += card(cur);
      let gs = D.genes.filter(g => (!V.onlyDrugs || g.drugs.length) && inG(g.gene));
      if (V.genes !== 'all') h += '<div class="dna-sub" style="margin:4px 0">' + (V.genes.length ? 'Showing ' + V.genes.length + ' of ' + ALLG.length + ' genes (ticked in the Library). ' : 'No gene is ticked. Tick genes in the Library, or ') + '<button class="dna-b" data-allg>Show all genes</button></div>';
      const row = g => '<tr class="r' + (g.gene === V.cur ? ' cur' : '') + '" data-gene="' + esc(g.gene) + '"><td><span class="dna-gene">' + esc(g.gene) + '</span>' + (g.mutation ? '<span class="dna-mut" title="' + esc(g.mutation.name + '\n' + g.mutation.reads) + '">mutation</span>' : '') +
        '<div class="dna-sub">' + esc(g.region || 'chr' + g.chrom) + '</div></td><td>' + bar(g) + '</td><td>' +
        (g.drugs.length ? g.drugs.map(chip).join('') : '<span class="dna-none">no drug targets it</span>') + '</td></tr>';
      let rows = '';
      if (V.sort === 'group') D.groups.forEach(G => { const x = gs.filter(g => g.group === G.key); if (x.length) rows += '<tr class="g"><td colspan="3">' + esc(G.title) + '</td></tr>' + x.map(row).join(''); });
      else { const CH = c => c === 'X' ? 23 : +c; gs = gs.slice().sort(V.sort === 'ratio' ? (a, b) => b.ratio - a.ratio : (a, b) => CH(a.chrom) - CH(b.chrom) || a.start - b.start); rows = gs.map(row).join(''); }
      h += '<div class="dna-wrap"><table class="dna-t"><thead><tr><th style="width:150px">Gene</th><th style="width:38%">Copies vs genome average (1× = normal)' + ticks + '</th><th>Drugs that target it</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } else if (V.view.startsWith('x:') && (D.views || []).some(v => 'x:' + v.key === V.view)) {
      const X = D.views.find(v => 'x:' + v.key === V.view);
      const cellx = c => c && typeof c === 'object' ? (c.strong ? '<span class="dna-mut">' + esc(c.chip) + '</span>' : '<span class="dna-chip other">' + esc(c.chip) + '</span>') : esc(c);
      h += '<div class="dna-card"><div>' + esc(X.intro) + '</div></div>';
      (X.tables || []).forEach(T => { h += '<div style="font-weight:600;font-size:12.5px;margin:10px 0 4px">' + esc(T.title) + '</div><div class="dna-wrap"><table class="dna-t"><thead><tr>' + T.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        T.rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i === 0 ? ' style="font-weight:600;white-space:nowrap"' : i === r.length - 1 ? ' class="dna-sub" style="color:var(--ink2);font-size:12px"' : ' style="white-space:nowrap"') + '>' + cellx(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; });
      if ((X.notes || []).length) h += '<div class="dna-card"><b>What it may mean</b><ul>' + X.notes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>';
      h += '<div class="dna-sub" style="margin-top:6px">Source: ' + esc(X.source || '') + '</div>';
    } else if (V.view === 'mito' && D.mito) {
      const M = D.mito, sn = M.sample_names || ['Sample', 'Comparison'];
      h += '<div class="dna-card"><div>' + esc(M.intro) + '</div></div>' +
        '<div class="dna-wrap"><table class="dna-t"><thead><tr><th>Position</th><th>Change</th><th style="width:26%">' + esc(sn[0]) + ': share of reads with the change</th><th>' + esc(sn[1]) + '</th><th>Call</th><th>Note</th></tr></thead><tbody>' +
        M.variants.map(v => '<tr' + (v.flag ? ' class="cur"' : '') + '><td><span class="dna-gene">' + v.pos + '</span></td><td>' + esc(v.change) + '</td><td><div class="dna-ax" style="min-width:120px"><div class="dna-fill ' + (v.flag ? 'up' : 'av') +
          '" style="left:0;width:' + Math.max(v.a_pct * .62, 1) + '%"></div><span class="dna-val" style="left:' + (v.a_pct * .62 + 1) + '%">' + v.a_pct.toFixed(v.a_pct < 10 ? 1 : 0) + '% (' + v.a_alt.toLocaleString() + ' of ' + v.a_depth.toLocaleString() + ')</span></div></td><td style="white-space:nowrap">' +
          v.b_alt + ' of ' + v.b_depth + '</td><td>' + (v.flag ? '<span class="dna-mut">⚑ ' + esc(v.call) + '</span>' : '<span class="dna-chip other">' + esc(v.call) + '</span>') + '</td><td class="dna-sub" style="color:var(--ink2)">' + esc(v.note) + '</td></tr>').join('') +
        '</tbody></table></div>';
      if (M.pileup) { const P = M.pileup, L = P.ref.length;
        h += '<div class="dna-card"><b>What the change looks like: position ' + P.pos + '</b><div class="dna-sub" style="margin:2px 0 6px">' + esc(P.caption || '') + '</div><div style="overflow:auto">';
        const cell = (ch, cls) => '<span class="' + cls + '">' + ch + '</span>';
        P.samples.forEach(S => {
          let t = '<div style="margin-top:8px"><b>' + esc(S.label) + '</b> <span class="dna-sub">' + esc(S.summary) + '</span></div><pre class="dna-pile">';
          t += P.ref.split('').map((c, i) => cell(c, 'r' + (P.start + i === P.pos ? ' hl' : ''))).join('') + '\n';
          S.rows.forEach(r => { let line = '';
            for (let i = 0; i < L; i++) { const x = P.start + i, hl = x === P.pos ? ' hl' : '';
              if (x < r.s || x > r.e) line += cell(' ', hl.trim());
              else { const b = r.d[x]; line += b == null ? cell('·', 'm' + hl) : b !== P.ref[i] ? cell(esc(b), (x === P.pos ? 'x' : 'o') + hl) : cell(esc(b), 'm' + hl); } }
            t += line + '\n'; });
          h += t + '</pre>'; });
        h += '</div></div>'; }
      h += '<div class="dna-card"><b>What it may mean</b><ul>' + M.notes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div><div class="dna-sub" style="margin-top:6px">Source: ' + esc(M.source) + '</div>';
    } else if (V.view === 'microbes' && D.microbes) {
      const M = D.microbes, sn = M.sample_names || ['Sample', 'Comparison'], n = x => x.toLocaleString();
      const mx = Math.max(1, ...M.organisms.map(o => Math.max(o.tumor, o.normal)));
      h += '<div class="dna-card"><div>' + esc(M.intro) + '</div></div>' +
        '<div class="dna-wrap"><table class="dna-t"><thead><tr><th>Organism named</th><th>Kind</th><th style="width:34%">' + esc(sn[0]) + '</th><th>' + esc(sn[1]) + '</th><th>Note</th></tr></thead><tbody>' +
        M.organisms.map(o => '<tr><td><span class="dna-gene">' + esc(o.name) + '</span></td><td><span class="dna-chip other">' + esc(o.kind) + '</span></td><td><div class="dna-ax" style="min-width:120px"><div class="dna-fill ' + (o.tumor ? 'up' : 'av') +
          '" style="left:0;width:' + Math.max(o.tumor / mx * 80, o.tumor ? 1.5 : 0) + '%"></div><span class="dna-val" style="left:' + (o.tumor / mx * 80 + 1) + '%">' + o.tumor + '</span></div></td><td>' + o.normal + '</td><td class="dna-sub" style="color:var(--ink2)">' + esc(o.note) + '</td></tr>').join('') +
        '</tbody></table></div><div class="dna-card"><b>What it may mean</b><ul>' + M.notes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' +
        '<div class="dna-wrap"><table class="dna-t"><thead><tr><th>Where every unmatched read went</th><th style="text-align:right">' + esc(sn[0]) + '</th><th style="text-align:right">' + esc(sn[1]) + '</th><th>What it is</th></tr></thead><tbody>' +
        M.categories.map(c => '<tr><td>' + esc(c.label) + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' + n(c.tumor) + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' + n(c.normal) + '</td><td class="dna-sub" style="color:var(--ink2)">' + esc(c.what) + '</td></tr>').join('') +
        '</tbody></table></div><div class="dna-sub" style="margin-top:6px">Source: ' + esc(M.source) + '</div>';
    } else {
      h += '<div class="dna-wrap"><table class="dna-t"><thead><tr><th>Region (hg19)</th><th>Size</th><th style="width:30%">Copies vs genome average' + ticks + '</th><th>Genes</th></tr></thead><tbody>' +
        D.regions.map(r => '<tr><td>chr' + esc(r.chrom) + ':' + (r.start / 1e6).toFixed(2) + '–' + (r.end / 1e6).toFixed(2) + ' Mb</td><td>' + (r.kb >= 1000 ? (r.kb / 1000).toFixed(1) + ' Mb' : r.kb + ' kb') + '</td><td>' +
          bar({ratio: r.ratio, state: 'gained'}) + '</td><td class="dna-sub" style="font-size:11.5px;color:var(--ink2)">' + esc(r.genes) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    h += '<div class="dna-foot">' + esc(D.footnote || '') + '</div>';
    body.innerHTML = h;
    body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { V.view = b.dataset.view; save(); redraw(); });
    body.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { V.sort = b.dataset.sort; save(); redraw(); });
    const od = body.querySelector('[data-od]'); if (od) od.onchange = () => { V.onlyDrugs = od.checked; save(); redraw(); };
    const ag = body.querySelector('[data-allg]'); if (ag) ag.onclick = () => { V.genes = 'all'; save(); redraw(); list(); };
    body.querySelectorAll('tr.r').forEach(tr => tr.onclick = () => { V.cur = V.cur === tr.dataset.gene ? null : tr.dataset.gene; save(); redraw(); if (typeof list === 'function') list(); });
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

  /* Library: DNA -> the panel + one group per copy-number group; clicking a gene opens its card */
  MRD.section = (el, q) => {
    o.section(el, q);
    const hay = ('dna gene genes copy number amplification exome tumor drugs therapy mitochondria flagged microbes bacteria virus ' + (D.views || []).map(v => v.title).join(' ') + ' ' + (D.microbes ? D.microbes.organisms.map(o => o.name).join(' ') + ' ' : '') + (D.flags || []).map(f => f.title).join(' ') + ' ' + D.genes.map(g => g.gene + ' ' + g.drugs.map(d => d.drug).join(' ')).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) return;
    const SEC = section(el, 'dna', 'DNA', D.sample.label, true, 'sec', q), s0 = SEC.firstChild;
    panelBtns(SEC, 'DNA panel', 'grp:dna', [ID], 'DNA');
    const row = (label, count, tip, checked, onTick, onName) => {
      const d = document.createElement('div'); d.className = 't';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked; cb.setAttribute('aria-label', 'Show ' + label);
      cb.onclick = e => { e.stopPropagation(); onTick(cb.checked); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = tip;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
      d.append(cb, nm, n); d.onclick = onName || (() => { cb.checked = !cb.checked; onTick(cb.checked); }); return d; };
    (D.flags || []).forEach(f => { const d = document.createElement('div'); d.className = 't'; d.title = f.text; d.innerHTML = '<span class="nm">⚑ ' + esc(f.title) + '</span>'; d.onclick = () => { if (!sel.includes(ID)) setLabSel([ID], true); }; SEC.append(d); });
    if (D.mito) { const d = document.createElement('div'); d.className = 't'; d.title = D.mito.intro; d.innerHTML = '<span class="nm">' + esc(D.mito.title) + '</span><span class="n">' + D.mito.variants.length + ' sites</span>';
      d.onclick = () => { V.view = 'mito'; save(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } }; SEC.append(d); }
    if (D.microbes) { const d = document.createElement('div'); d.className = 't'; d.title = D.microbes.intro; d.innerHTML = '<span class="nm">' + esc(D.microbes.title) + '</span><span class="n">' + D.microbes.organisms.length + ' named</span>';
      d.onclick = () => { V.view = 'microbes'; save(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } }; SEC.append(d); }
    (D.views || []).forEach(X => { const d = document.createElement('div'); d.className = 't'; d.title = X.intro; d.innerHTML = '<span class="nm">' + esc(X.title) + '</span><span class="n">' + esc(X.count || '') + '</span>';
      d.onclick = () => { V.view = 'x:' + X.key; save(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } }; SEC.append(d); });
    SEC.append(row('Gene copies and drugs', D.genes.length + ' genes', 'Gene copy number in the tumor next to the drugs that target each gene', sel.includes(ID), v => setLabSel([ID], v)));
    /* gene ticks choose which genes the table shows (several at once); the name opens that gene's card */
    const shownG = () => sel.includes(ID) && V.view === 'genes';
    const showGenes = names => { setPicksG(names); V.view = 'genes'; save(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } };
    D.groups.forEach(G => { const gs = D.genes.filter(g => g.group === G.key), names = gs.map(g => g.gene);
      const k = shownG() ? names.filter(inG).length : 0;
      const S = section(SEC, 'dna:' + G.key, G.title.replace(/ \(.*/, ''), (k ? k + '/' : '') + gs.length + ' genes', false, 'grp', q);
      gs.forEach(g => { const open = () => { V.view = 'genes'; V.cur = g.gene; if (!inG(g.gene)) setPicksG(picksG().concat(g.gene)); save(); };
        S.append(row(g.gene + (g.mutation ? ' ●' : ''), fx(g.ratio), g.gene + ': ' + fx(g.ratio) + ' the genome average' + (g.mutation ? '\nMutation: ' + g.mutation.name : '') + '\nTick: show this gene in the table (tick several to see them together)\nClick the name: open its card in the DNA panel',
          shownG() && inG(g.gene),
          v => { const base = shownG() ? picksG() : []; showGenes(v ? base.concat(g.gene) : base.filter(x => x !== g.gene)); },
          () => { open(); if (!sel.includes(ID)) setLabSel([ID], true); else { redraw(); list(); } })); });
      const ss = S.firstChild, add = b => ss.insertBefore(b, ss.lastChild), gkey = 'grp:dna:' + G.key;
      add(miniBtn('All', 'Tick every gene in this group', () => showGenes((shownG() ? picksG() : []).concat(names))));
      add(miniBtn('None', 'Untick every gene in this group', () => showGenes(shownG() ? picksG().filter(x => !names.includes(x)) : [])));
      add(groupOnlyBtn('DNA panel', gkey, [ID], soloLab && soloLab.key === gkey, false, () => {
        if (!(soloLab && soloLab.key === gkey)) { const mine = shownG() ? names.filter(inG) : []; setPicksG(mine.length ? mine : names); V.view = 'genes'; save(); }
        onlyLab(gkey, [ID], 'DNA · ' + G.title.replace(/ \(.*/, '')); }));
      ss.lastChild.previousSibling.title = soloLab && soloLab.key === gkey ? 'Turn off "only" and bring back the earlier selection' : 'Show only the DNA panel, with just the genes of this group (or the ones ticked in it)';
    });
  };

  const saved = store.get('selected', []);
  if (saved.includes(ID) && !sel.includes(ID)) sel = saved.filter(id => BYID[id] || MRD.isId(id));
  updateBar(); list(); render();
})();
