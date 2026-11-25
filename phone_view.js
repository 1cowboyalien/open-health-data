// Phone start screen: a turning glass head with the brain lesions playing through every viewer scan, the lesion volume chart (each lesion + Total)
// , cards into the main parts of the viewer and "Explore the records →".
// A smooth timelapse: a playhead moves through time and each lesion's shape morphs between measured scans (a blend, labelled
// "between scans"); layer buttons: Lesions, Skin, Brain, Radiation (treated lesions / whole brain light amber), Gravity grid
// (an illustration: a 3D lattice pulled toward each lesion by its size); dragging only turns the head (the turning starts again, easing in, 4 s after letting go).
// Shown on phones (760 px and under) when the page opens without a #link; ?phone=1 shows it on any screen, ?phone=0 never.
// The 3D model is local/phone/model.json (make_phone_model.py; face cut away), served by serve_viewer.py at /phone/model.json.
// three.js comes from cdnjs, like Chart.js; no data is sent anywhere. Radiation dates come from IMG_DATA.dose (brain courses only).
(function () {
  const q = new URLSearchParams(location.search).get('phone');
  const narrow = window.matchMedia('(max-width:760px)').matches;
  const DAY = 864e5, ms = d => Date.parse(d + 'T12:00:00Z');
  const fmt = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  const fmtS = d => new Date(ms(d)).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
  const cm3 = v => (v / 1000).toFixed(v < 1000 ? 2 : 1) + ' cm³';
  const ID = typeof IMG_DATA !== 'undefined' ? IMG_DATA : null;
  const COURSES = ID && ID.dose && ID.dose.courses ? ID.dose.courses.filter(c => ID.dose.course_info && ID.dose.course_info[c.course] && c.start)
    .map(c => ({a: c.start, b: c.end || c.start, l: ID.dose.course_info[c.course].kind === 'whole' ? 'Whole-brain radiation' : 'SRS radiation'})) : [];

  const css = document.createElement('style');
  css.textContent = `
#phHome{position:fixed;inset:0;z-index:1000;background:#0b0d12;color:#eef2f8;display:flex;flex-direction:column;font:14px/1.4 -apple-system,system-ui,sans-serif;touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none}
#phHome .ph3d{position:relative;flex:1;min-height:0}#phHome canvas.g{position:absolute;inset:0;width:100%;height:100%;display:block}
#phHome .top{flex:none;padding:calc(env(safe-area-inset-top) + 8px) 16px 2px;pointer-events:none}
#phHome .kick{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#aab3c2;display:flex;justify-content:space-between;align-items:baseline}
#phHome .date{font-size:21px;font-weight:700;letter-spacing:-.01em;line-height:1.2}#phHome .meta{color:#aab3c2;font-size:12.5px}
#phHome .tags{min-height:18px;margin-top:2px}
#phHome .tx{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;background:rgba(224,160,32,.18);color:#f0c060;visibility:hidden;margin-right:6px}
#phHome .hint{font-size:10px;letter-spacing:0;text-transform:none;color:#7d8696;transition:opacity .3s}
#phHome .layers{flex:none;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;touch-action:pan-x;padding:4px 10px 0}#phHome .layers::-webkit-scrollbar{display:none}
#phHome .layers button{flex:none;font-size:10.5px;padding:2px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#aab3c2}
#phHome .layers button.on{border-color:#4d8dff;background:rgba(77,141,255,.22);color:#fff}
#phHome .gnote{flex:none;padding:3px 12px 0;font-size:10px;color:#c9a978;display:none}#phHome.grid .gnote{display:block}
#phHome .vlab{font-size:10.5px;color:#e8c27a}
#phHome .msg{position:absolute;left:0;right:0;top:45%;text-align:center;color:#aab3c2;font-size:13px;padding:0 24px}
#phHome .sheet{flex:none;padding:6px 14px calc(env(safe-area-inset-bottom) + 12px);background:#0b0d12}
#phHome .lbl .scl{font-size:10.5px;padding:0 7px;border-radius:9px;border:1px solid #3a4352;background:none;color:#aab3c2;margin-left:2px}
#phHome .lbl{font-size:11px;color:#aab3c2;display:flex;justify-content:space-between;margin:0 4px 4px}
#phHome .bars{position:relative;height:110px}#phHome .bars canvas{width:100%;height:100%;display:block}
#phHome .cards{display:flex;gap:6px;overflow-x:auto;padding:6px 2px 2px;scrollbar-width:none;touch-action:pan-x}#phHome .cards::-webkit-scrollbar{display:none}
#phHome .card{flex:none;display:flex;align-items:baseline;gap:5px;background:#141923;border:1px solid #232a36;border-radius:12px;padding:4px 10px;color:inherit;font:inherit;white-space:nowrap}
#phHome .card b{font-size:11px;font-weight:500;color:#aab3c2}#phHome .card span{display:none}#phHome .card i{font-style:normal;font-size:12px;font-weight:650}
#phHome .enter{display:block;width:100%;margin-top:8px;padding:10px;border-radius:14px;border:0;background:#4d8dff;color:#fff;font-size:15px;font-weight:600}
#phHome .note{font-size:10px;color:#6f7888;margin:6px 4px 0;line-height:1.3}
#phOpen{position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:900;border-radius:20px;padding:7px 12px;font-size:13px;background:#0b0d12;color:#fff;border:1px solid #4d8dff;box-shadow:0 2px 10px rgba(0,0,0,.35)}`;
  document.head.appendChild(css);

  let el = null, stop = null;
  function open() {
    if (el) return;
    el = document.createElement('div'); el.id = 'phHome';
    el.innerHTML = `<div class="top"><div class="kick"><span>Brain MRI timelapse</span><span class="hint">☝︎ drag to turn · pinch to zoom</span></div>
 <div class="date">Loading…</div><div class="meta"></div><div class="tags"><span class="tx"></span><span class="vlab"></span></div></div>
 <div class="ph3d"><canvas class="g"></canvas></div>
 <div class="layers"></div><div class="gnote">Gravity grid: an illustration. Space is pulled toward each lesion by its size, like mass bending space. It is not measured brain shift.</div>
 <div class="sheet"><div class="lbl"><span>Lesion volume (mm³): each lesion · <b style="color:#fff">Total</b> · <button class="scl"></button></span><span class="vnow"></span></div>
 <div class="bars"><canvas></canvas></div><div class="cards"></div>
 <button class="enter">Explore the records →</button>
</div>`;
    document.body.appendChild(el); document.documentElement.style.overflow = 'hidden';
    const ob = document.getElementById('phOpen'); if (ob) ob.style.display = 'none';
    el.querySelector('.enter').onclick = () => close();
    cards();
    const fail = m => { if (el) { el.querySelector('.date').textContent = ''; const d = document.createElement('div'); d.className = 'msg'; d.textContent = m; el.querySelector('.ph3d').appendChild(d); } };
    const three = window.THREE ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    Promise.all([three, fetch('/phone/model.json').then(r => { if (!r.ok) throw 0; return r.json(); })])
      .then(([, M]) => { if (el) stop = run(el, M); })
      .catch(() => fail('The 3D picture could not load here. Explore the records below.'));
  }
  function close() {
    if (stop) stop(); stop = null;
    if (el) el.remove(); el = null; document.documentElement.style.overflow = '';
    let ob = document.getElementById('phOpen');
    if (!ob) { ob = document.createElement('button'); ob.id = 'phOpen'; ob.textContent = '🧠 3D'; ob.title = 'Back to the 3D brain MRI timelapse'; ob.onclick = open; document.body.appendChild(ob); }
    ob.style.display = '';
  }
  // ---- cards into the viewer ----
  function go(fn) { close(); setTimeout(fn, 60); }
  function panel(id) {
    if (typeof setLabSel === 'function' && typeof sel !== 'undefined' && !sel.includes(id)) setLabSel([id], true);
    const to = () => { const w = document.querySelector(`.cmp[data-id="${id}"]`) || document.getElementById(id); if (w) w.scrollIntoView({block: 'start', behavior: 'smooth'}); };
    setTimeout(to, 80); setTimeout(to, 1200);   // again once the panel has drawn (it grows while it loads)
  }
  function cards() {
    const C = [], box = el.querySelector('.cards');
    const VS = ID && ID.viewer_scans || [];
    if (VS.length) { const s = VS[VS.length - 1], n = (s.lesions || []).length;
      C.push({b: 'Latest MRI', i: fmt(s.date).replace(/, \d{4}$/, ''), s: (n ? n + ' lesion' + (n > 1 ? 's' : '') + ' · ' : '') + 'open the slice viewer', f: () => { if (window.openMriViewer) window.openMriViewer(s.date); panel('img:brain:viewer'); }}); }
    const mr = typeof D !== 'undefined' && D.mrd && D.mrd.rows ? D.mrd.rows.filter(r => r.draw_date) : [];
    if (mr.length) { const r = mr[mr.length - 1];
      C.push({b: 'Signatera', i: /not/i.test(r.result || '') ? 'Not detected' : (r.value + ' MTM/mL'), s: 'tumour DNA in blood · ' + fmt(r.draw_date), f: () => panel('mrd:ot')}); }
    if (typeof D !== 'undefined' && D.tx && D.tx.length) C.push({b: 'Treatments', i: String(new Set(D.tx.map(t => t.drug || t.name || t.id)).size), s: 'medicines on the timeline', f: () => { const t = document.getElementById('txCard'); if (t) t.scrollIntoView({block: 'start', behavior: 'smooth'}); }});
    if (typeof D !== 'undefined' && D.tests) C.push({b: 'Labs', i: String(D.tests.filter(t => t.kind !== 'vital').length), s: 'blood tests, every hospital', f: () => window.scrollTo({top: 0, behavior: 'smooth'})});
    C.forEach(c => { const b = document.createElement('button'); b.className = 'card'; b.innerHTML = '<b></b><i></i><span></span>';
      b.children[0].textContent = c.b; b.children[1].textContent = c.i; b.children[2].textContent = c.s; b.onclick = () => go(c.f); box.appendChild(b); });
  }

  // ---- the 3D timelapse ----
  function run(root, M) {
    const T = window.THREE;
    M.scans.forEach(s => { s.tot = s.lesions.reduce((a, l) => a + l.enh, 0); s.t = ms(s.date); });
    const T0 = M.scans[0].t - 40 * DAY, T1 = M.scans[M.scans.length - 1].t + 40 * DAY;
    const cv = root.querySelector('canvas.g'), wrap = root.querySelector('.ph3d');
    const R = new T.WebGLRenderer({canvas: cv, antialias: true}); R.setPixelRatio(Math.min(2, devicePixelRatio)); R.setClearColor(0x0b0d12, 1);
    const S = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, 1, 2000); cam.up.set(0, 0, 1);
    S.add(new T.AmbientLight(0xffffff, .55)); const dl = new T.DirectionalLight(0xffffff, .9); S.add(dl);
    const dl2 = new T.DirectionalLight(0x88aaff, .4); dl2.position.set(-1, -1, -.5); S.add(dl2);
    const geo = o => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(o.v, 3)); g.setIndex(o.f); g.computeVertexNormals(); return g; };
    // rim-lit glass: bright where the surface turns away from the eye, clear where it faces it; fades where the scan stops
    // and where the face was cut away (M.face = [y, z] of the cut), so the cut doesn't show as a bright shelf
    const glass = (col, pow, str, base) => new T.ShaderMaterial({transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: {c: {value: new T.Color(col)}, p: {value: pow}, s: {value: str}, b: {value: base}, zt: {value: M.zcut[1]}, zb: {value: M.zcut[0]}, fy: {value: M.face ? M.face[0] : 999}, fz: {value: M.face ? M.face[1] : -999}},
      vertexShader: 'varying vec3 vN;varying vec3 vV;varying float vz;varying float vy;void main(){vy=position.y;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);vz=position.z;gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform vec3 c;uniform float p;uniform float s;uniform float b;uniform float zt;uniform float zb;uniform float fy;uniform float fz;varying vec3 vN;varying vec3 vV;varying float vz;varying float vy;void main(){float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),p);float k=smoothstep(zt+2.,zt-14.,vz)*smoothstep(zb,zb+45.,vz)*(1.-smoothstep(fy-16.,fy,vy)*smoothstep(fz+16.,fz,vz));gl_FragColor=vec4(c*(f*s+b)*k,1.);}'});
    const head = new T.Mesh(geo(M.head), glass(0x5f8fff, 2.6, .95, .012)), brain = new T.Mesh(geo(M.brain), glass(0xff9fb0, 1.6, .38, .035));
    S.add(brain, head);
    const box = new T.Box3().setFromObject(brain), C = new T.Vector3(); box.getCenter(C);   // aim at the brain
    // ---- anatomy from the averaged scan (make_phone_model.py): blood vessels, eyes, optic nerves ----
    function tubes(list, segLen) {   // many centre lines -> one mesh of tubes (one draw call)
      const P = [], N = [], I = []; let base = 0;
      list.forEach(o => { const q = []; for (let k = 0; k < o.p.length; k += 3) q.push(new T.Vector3(o.p[k], o.p[k + 1], o.p[k + 2]));
        if (q.length < 2) return;
        const len = q.reduce((s, v, k) => k ? s + v.distanceTo(q[k - 1]) : 0, 0);
        const g = new T.TubeGeometry(new T.CatmullRomCurve3(q), Math.max(2, Math.round(len / segLen)), o.r, 6, false);
        P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); g.index.array.forEach(i => I.push(i + base));
        base += g.attributes.position.count; g.dispose(); });
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setIndex(I); return g; }
    const vessels = new T.Mesh(tubes(M.vessels || [], 2.5), new T.MeshPhongMaterial({color: 0xc8283c, emissive: 0x5a0812, transparent: true, opacity: .62, depthWrite: false, shininess: 40}));
    const eyesG = new T.Group();
    (M.eyes || []).forEach(e => eyesG.add(new T.Mesh(geo(e), new T.MeshPhongMaterial({color: 0xdfe8ff, emissive: 0x223344, transparent: true, opacity: .55, depthWrite: false, shininess: 90}))));
    eyesG.add(new T.Mesh(tubes(M.nerves || [], 1.5), new T.MeshPhongMaterial({color: 0xf2d27a, emissive: 0x4a3a10, transparent: true, opacity: .9, shininess: 30})));
    let RADS = [];
    if (M.visual) {   // visual pathway on: optic tracts (drawn: chiasm -> LGN) and optic radiations (traced on her DTI: LGN -> back of the brain)
      eyesG.add(new T.Mesh(tubes(M.visual.tracts.map(t => ({p: t.p, r: 1.3})), 1.5), new T.MeshPhongMaterial({color: 0xf2d27a, emissive: 0x4a3a10, transparent: true, opacity: .55, depthWrite: false})));
      // one set of radiations per DTI date (or the single older set); the nearest in time to the playhead shows, fading into the next one between DTI dates
      const sets = M.visual.by_date || {'': {radiations: M.visual.radiations || []}};
      RADS = Object.entries(sets).filter(([, v]) => v.radiations.length).map(([d, v]) => { const m = new T.Mesh(tubes(v.radiations.map(t => ({p: t.p, r: .45})), 3),
        new T.MeshPhongMaterial({color: 0xffc46b, emissive: 0x6a4210, transparent: true, opacity: .5, depthWrite: false, shininess: 20}));
        m.visible = false; eyesG.add(m); return {t: d ? ms(d) : 0, d, m}; }).sort((a, b) => a.t - b.t);
    }
    S.add(vessels, eyesG);
    // ---- lesions: one mesh per lesion, the same points on every scan (make_phone_model.py fits a shared sphere layout to
    // each outline: centre + a radius per direction), so between scans the shape itself morphs, point by point ----
    const DIR = M.dirs, ND = DIR.length / 3, AMBER = new T.Color(0xffa62b);
    const byScan = M.scans.map(s => { const o = {}; s.lesions.forEach(l => o[l.id] = l); return o; });
    const LES = {};
    M.scans.forEach(s => s.lesions.forEach(l => { if (LES[l.id]) return;
      const g = new T.BufferGeometry(), pos = new Float32Array(ND * 3); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(M.tri);
      const c = l.rgb ? new T.Color(l.rgb[0] / 255, l.rgb[1] / 255, l.rgb[2] / 255) : new T.Color(0xff5a5f);
      const m = new T.Mesh(g, new T.MeshPhongMaterial({color: c, emissive: c.clone(), emissiveIntensity: .4, transparent: true, opacity: 1, shininess: 60}));
      m.frustumCulled = false; m.visible = false; S.add(m); LES[l.id] = {m, pos, col: c}; }));
    // ---- layers the person can switch on and off (kept in localStorage phone.layers) ----
    const LAY = Object.assign({les: true, skin: true, brain: true, ves: true, eyes: true, rad: true, grid: false}, JSON.parse(localStorage.getItem('phone.layers') || '{}'));
    // radiation: which lesions each course aimed at (IMG_DATA.dose.rows), and how strongly to light them at tNow
    const TGT = {}; (ID && ID.dose && ID.dose.rows || []).forEach(r => { if (r.targeted) (TGT[r.course] = TGT[r.course] || new Set()).add(r.lesion); });
    const RC = ID && ID.dose && ID.dose.courses ? ID.dose.courses.filter(c => ID.dose.course_info && ID.dose.course_info[c.course] && c.start)
      .map(c => ({key: c.course, whole: ID.dose.course_info[c.course].kind === 'whole', a: ms(c.start), b: ms(c.end || c.start)})) : [];
    const radW = c => tNow < c.a - 2 * DAY ? 0 : tNow < c.a ? 1 - (c.a - tNow) / (2 * DAY) : tNow <= c.b ? 1 : Math.max(0, 1 - (tNow - c.b) / (40 * DAY));
    // gravity grid (an illustration, not a measurement): a 3D lattice through the brain, each point pulled toward every
    // lesion by its current size (like mass bending space), warmer where it is pulled more
    let grid = null;
    function makeGrid() {
      const bb = new T.Box3().setFromObject(brain), mn = bb.min, mx = bb.max, ctr = new T.Vector3(), half = new T.Vector3();
      bb.getCenter(ctr); bb.getSize(half).multiplyScalar(.5);
      const SP = 16, ST = 4, base = [], alpha = [];
      const fade = p => { const q = ((p[0] - ctr.x) / half.x) ** 2 + ((p[1] - ctr.y) / half.y) ** 2 + ((p[2] - ctr.z) / half.z) ** 2; return 1 - sm(.45, 1, q); };
      const ax = [[0, 1, 2], [1, 0, 2], [2, 0, 1]], lo = [mn.x, mn.y, mn.z], hi = [mx.x, mx.y, mx.z];
      ax.forEach(([a, b, c]) => { for (let u = lo[b] + SP / 2; u < hi[b]; u += SP) for (let w = lo[c] + SP / 2; w < hi[c]; w += SP) {
        for (let x = lo[a]; x + ST <= hi[a]; x += ST) { const p = [0, 0, 0], q = [0, 0, 0]; p[a] = x; q[a] = x + ST; p[b] = q[b] = u; p[c] = q[c] = w;
          const fa = fade(p), fb = fade(q); if (fa < .02 && fb < .02) continue; base.push(...p, ...q); alpha.push(fa, fb); } } });
      const g = new T.BufferGeometry(), pos = new Float32Array(base), col = new Float32Array(base.length);
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
      const ln = new T.LineSegments(g, new T.LineBasicMaterial({vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending}));
      ln.frustumCulled = false; S.add(ln); grid = {ln, base: new Float32Array(base), pos, col, alpha}; }
    let CUR = [];   // lesions shown now: centre and blended volume (for the grid)
    // each grid point is pulled toward every lesion by the lesion's size (L.R = radius of a ball of its volume), fading with distance
    function warp() { if (!grid) return; const {base, pos, col, alpha} = grid, n = base.length / 3;
      for (let k = 0; k < n; k++) { const x = base[3 * k], y = base[3 * k + 1], z = base[3 * k + 2]; let dx = 0, dy = 0, dz = 0;
        for (const L of CUR) { const vx = L.c[0] - x, vy = L.c[1] - y, vz = L.c[2] - z, d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2) || 1;
          const amt = Math.min(.8 * d, L.R * 2.6 * Math.exp(-d / (24 + 2 * L.R))); dx += vx / d * amt; dy += vy / d * amt; dz += vz / d * amt; }
        pos[3 * k] = x + dx; pos[3 * k + 1] = y + dy; pos[3 * k + 2] = z + dz;
        const a = alpha[k] * .42, h = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 9);
        col[3 * k] = a * (.25 + .85 * h); col[3 * k + 1] = a * (.45 + .1 * h); col[3 * k + 2] = a * (.95 - .6 * h); }
      grid.ln.geometry.attributes.position.needsUpdate = true; grid.ln.geometry.attributes.color.needsUpdate = true; }
    let az = 0.6, el = 0.18, dist = 400, dist0 = 400, auto = true, spin = 1, idleT = 0, lastNow = performance.now(), raf = 0;
    // ---- a smooth timelapse: a playhead moves through time; between two measured scans each lesion grows or shrinks
    // from one scan's volume to the next (cube root, so the size changes evenly) while one outline fades into the other.
    // The in-between sizes are an even blend, not measurements. Scans with no outlines are passed through, not used as zero.
    const N = M.scans.length, HOLD = .45, END = 1.8;   // seconds resting on each scan, and on the last one before it starts again
    // before the first scan with lesions: the viewer's growth model (IMG_DATA.growth.backcast) carries each lesion backwards from its
    // first measured size at the middle doubling time measured later, back to the clean scan. An estimate, drawn and labelled as one.
    const BC = ID && ID.growth && ID.growth.backcast || null, BT1 = BC ? ms(BC.first) : 0, BT0 = BC ? ms(BC.clean) : 0;
    const BV0 = {}; (BC && BC.lesions || []).forEach(r => BV0[r.id] = r.v0);
    const grow = t => BC ? Math.pow(2, -(BT1 - t) / DAY / BC.dt.mid) : 0;   // volume fraction of the first-scan size at time t
    const inBack = t => BC && t >= BT0 && t < BT1;
    const segD = j => (BC && M.scans[j].t === BT0 && M.scans[j + 1].t === BT1) ? 6 :   // the growth before the first scan gets time to be seen
      Math.max(.7, Math.min(3.2, .45 + (M.scans[j + 1].t - M.scans[j].t) / DAY / 110));   // travel time to the next scan
    const S0 = [0]; for (let j = 0; j < N - 1; j++) S0.push(S0[j] + HOLD + segD(j));
    const TOTAL = S0[N - 1] + END, meas = M.scans.map((s, j) => s.lesions.length ? j : -1).filter(j => j >= 0);
    let play = 0, tNow = M.scans[0].t, atScan = 0;
    function seek(j) { play = S0[j]; }
    function place() {   // play seconds -> time on the record, and the scan we are resting on (or -1 between scans)
      let j = 0; while (j < N - 1 && play >= S0[j + 1]) j++;
      const local = play - S0[j];
      if (j === N - 1 || local <= HOLD) { tNow = M.scans[j].t; atScan = j; return; }
      const f = (local - HOLD) / segD(j), e = f * f * (3 - 2 * f);   // ease in and out of each scan
      tNow = M.scans[j].t + e * (M.scans[j + 1].t - M.scans[j].t); atScan = -1; }
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    let est = 0;
    function lesions() {   // each lesion's shape at tNow: a point-by-point blend of the measured scans either side
      let a = -1, b = -1; meas.forEach(j => { if (M.scans[j].t <= tNow) a = j; else if (b < 0) b = j; });
      const f = a >= 0 && b >= 0 ? (tNow - M.scans[a].t) / (M.scans[b].t - M.scans[a].t) : 0;
      const pre = a < 0 && b >= 0 ? sm(.9, 1, (tNow - M.scans[0].t) / (M.scans[b].t - M.scans[0].t)) : 1;   // before the first outlines they fade in as that scan arrives (no made-up growth)
      const foc = RC.filter(c => !c.whole).map(c => ({w: LAY.rad ? radW(c) : 0, s: TGT[c.key] || new Set()}));
      CUR = []; est = 0;
      for (const id in LES) { const E = LES[id], A = a >= 0 ? byScan[a][id] : null, B = b >= 0 ? byScan[b][id] : null;
        let ca, cb, ra, rb, u, v;
        if (a < 0) { if (!B) { E.m.visible = false; continue; } ca = cb = B.c; ra = rb = B.r; u = 1; v = B.enh;
          if (inBack(tNow) && BV0[id]) { const gf = grow(tNow); v = BV0[id] * gf; ra = rb = B.r.map(r => r * Math.cbrt(gf)); } }
        else if (b < 0) { if (!A) { E.m.visible = false; continue; } ca = cb = A.c; ra = rb = A.r; u = 0; v = A.enh; }
        else { if (!A && !B) { E.m.visible = false; continue; }
          ca = A ? A.c : B.c; cb = B ? B.c : A.c; ra = A ? A.r : null; rb = B ? B.r : null; u = f; v = (A ? A.enh : 0) * (1 - f) + (B ? B.enh : 0) * f; }
        const cx = ca[0] + (cb[0] - ca[0]) * u, cy = ca[1] + (cb[1] - ca[1]) * u, cz = ca[2] + (cb[2] - ca[2]) * u; let big = 0;
        for (let k = 0; k < ND; k++) { const r = (ra ? ra[k] : 0) * (1 - u) + (rb ? rb[k] : 0) * u; if (r > big) big = r;
          E.pos[3 * k] = cx + DIR[3 * k] * r; E.pos[3 * k + 1] = cy + DIR[3 * k + 1] * r; E.pos[3 * k + 2] = cz + DIR[3 * k + 2] * r; }
        const o = a < 0 ? (BC && BV0[id] ? 1 : pre) : 1;
        E.m.visible = LAY.les && big > .05 && o > .01; E.m.material.opacity = o; E.m.material.depthWrite = o > .97;   // a see-through lesion must not hide what is behind it
        if (E.m.visible) { E.m.geometry.attributes.position.needsUpdate = true; E.m.geometry.computeVertexNormals(); E.m.geometry.computeBoundingSphere(); }
        const w = Math.max(0, ...foc.map(c => c.s.has(id) ? c.w : 0));   // lit amber while SRS aims at it, fading after
        E.m.material.emissive.copy(E.col).lerp(AMBER, w); E.m.material.emissiveIntensity = .4 + w * (.25 + .15 * Math.sin(performance.now() / 180)); E.m.material.color.copy(E.col).lerp(AMBER, w * .8);
        if (o > .01) { est += v * o; CUR.push({c: [cx, cy, cz], v: v * o, R: Math.cbrt(3 * v * o / (4 * Math.PI))}); } }
      const wb = LAY.rad ? Math.max(0, ...RC.filter(c => c.whole).map(radW)) : 0;   // whole-brain course: the brain glows amber
      brain.material.uniforms.c.value.set(0xff9fb0).lerp(AMBER, wb); brain.material.uniforms.s.value = .38 + .5 * wb; brain.material.uniforms.b.value = .035 + .05 * wb;
      brain.visible = LAY.brain; head.visible = LAY.skin; vessels.visible = LAY.ves; eyesG.visible = LAY.eyes;
      if (RADS.length) {   // the DTI sets either side of the playhead: hold the nearer one, and fade from one to the next around the
        // halfway point (over the middle 80 % of the time between the two DTI dates; the playhead moves fastest there), so a whole bundle never swaps in one frame
        let k = 0; while (k < RADS.length - 1 && RADS[k + 1].t <= tNow) k++;
        const A = RADS[k], B = RADS[k + 1] && tNow > A.t ? RADS[k + 1] : null, g = B ? B.t - A.t : 0;
        const f = B ? sm(A.t + .1 * g, A.t + .9 * g, tNow) : 0;
        RADS.forEach(r => { const w = r === A ? 1 - f : r === B ? f : 0; r.m.visible = w > .01; r.m.material.opacity = .5 * w; });
        const vl = $('.vlab'); const txt = !LAY.eyes || !A.d ? '' : f > .02 && f < .98 ? 'Optic radiations: DTI of ' + fmt(A.d) + ' → ' + fmt(B.d)
          : 'Optic radiations: DTI of ' + fmt((f >= .98 ? B : A).d); if (vl.textContent !== txt) vl.textContent = txt; }
      if (LAY.grid && !grid) makeGrid(); if (grid) { grid.ln.visible = LAY.grid; if (LAY.grid) warp(); } }
    function size() { const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
      const d = 212 / (2 * Math.tan(16 * Math.PI / 180) * Math.min(1, cam.aspect)); dist = dist * d / dist0; dist0 = d; }
    // ---- the viewer's lesion volume chart (Lesions over time → Volume): one line per lesion through our measured enhancing
    // volumes (IMG_DATA.lesion_series.measured, first series of each visit), a Total line (sum per scan), log or linear;
    // a lesion with no outline on a measured scan (none) drops to the floor there. A playhead moves across with the timelapse. ----
    const bc = root.querySelector('.bars canvas');
    const LSR = ID && ID.lesion_series, LCOL = {}, LINES = {};
    (LSR && LSR.lesions || []).forEach(l => LCOL[l.id] = l.rgb ? `rgb(${l.rgb})` : '#ff5a5f');
    // measured volumes plus the "not seen" / "too small to outline" notes on measured scans (lesion_series.states, as in the viewer):
    // there the line drops to the bottom (×), so a lesion never runs straight across a scan where it had shrunk away
    (LSR && LSR.measured || []).concat(LSR && LSR.states || []).filter(m => !m.alt).forEach(m => (LINES[m.lesion] = LINES[m.lesion] || []).push({t: ms(m.date), v: m.none ? 0 : m.enh_mm3 || 0, st: !!m.below}));
    Object.values(LINES).forEach(a => a.sort((x, y) => x.t - y.t || y.v - x.v));
    const TOT = M.scans.filter(s => s.lesions.length).map(s => ({t: s.t, v: s.tot}));
    let LOG = localStorage.getItem('phone.scale') !== 'linear';
    function bars() { const w = bc.clientWidth, h = bc.clientHeight, dpr = devicePixelRatio || 1;
      if (bc.width !== Math.round(w * dpr) || bc.height !== Math.round(h * dpr)) { bc.width = w * dpr; bc.height = h * dpr; }
      const g = bc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const L0 = 26, X = t => L0 + (t - T0) / (T1 - T0) * (w - L0 - 6), bot = h - 14, top = 4;
      const vmax = Math.max(...TOT.map(p => p.v), 1), lo = 10, hiL = Math.log10(vmax * 1.3);
      const Yv = v => LOG ? bot - (Math.log10(Math.max(lo, v)) - 1) / (hiL - 1) * (bot - top) : bot - v / (vmax * 1.08) * (bot - top);
      g.fillStyle = 'rgba(224,160,32,.2)'; COURSES.forEach(c => { const a = X(ms(c.a)), b = X(ms(c.b)); g.fillRect(a, top, Math.max(3, b - a), bot - top); });
      g.font = '9px system-ui'; g.fillStyle = '#6f7888'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.textAlign = 'right';
      (LOG ? [10, 100, 1000, 10000].filter(v => v < vmax * 1.3) : [0, 5000, 10000, 15000, 20000].filter(v => v < vmax * 1.08))
        .forEach(v => { const y = Yv(v); g.beginPath(); g.moveTo(L0, y); g.lineTo(w - 6, y); g.stroke(); g.fillText(v >= 1000 ? v / 1000 + 'k' : String(v), L0 - 3, y + 3); });
      const line = (pts, col, lw, dash) => { g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath();
        pts.forEach((p, k) => k ? g.lineTo(X(p.t), Yv(p.v)) : g.moveTo(X(p.t), Yv(p.v))); g.stroke(); g.setLineDash([]); };
      const at = (pts, t) => { if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null;   // value on a line at time t
        for (let k = 1; k < pts.length; k++) if (t <= pts[k].t) { if (pts[k - 1].v === 0 && t < pts[k].t) return null;   // size unknown while it was not yet outlined
          const f = (t - pts[k - 1].t) / (pts[k].t - pts[k - 1].t || 1); return pts[k - 1].v + f * (pts[k].v - pts[k - 1].v); }
        return pts[pts.length - 1].v; };
      g.globalAlpha = .85; for (const id in LINES) { const P = LINES[id], col = LCOL[id] || '#ff5a5f';
        for (let k = 1; k < P.length; k++) { const gone = P[k - 1].v === 0 || P[k].v === 0;   // to or from "nothing outlined there": when it shrank away or came back is unknown, so faint and dotted (as in the viewer)
          if (gone && BV0[id] && P[k].t === BT1) continue;   // drawn below as the growth-model estimate instead
          g.globalAlpha = gone ? .35 : .85; line([P[k - 1], P[k]], col, 1.3, gone ? [2, 3] : null); }
        g.globalAlpha = .85; P.forEach((p, k) => { if (p.v > 0) { g.fillStyle = col; g.fillRect(X(p.t) - 1.2, Yv(p.v) - 1.2, 2.4, 2.4); }
          else if (p.st && !(P[k - 1] && P[k - 1].v === 0 && P[k + 1] && P[k + 1].v === 0)) {   // × at the bottom: not seen / too small (first and last of a run)
            const x = X(p.t), y = Yv(0); g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - 2.5, y - 2.5); g.lineTo(x + 2.5, y + 2.5); g.moveTo(x + 2.5, y - 2.5); g.lineTo(x - 2.5, y + 2.5); g.stroke(); } }); }
      const bcurve = v0 => { const pts = []; for (let i = 0; i <= 40; i++) { const t = BT0 + (BT1 - BT0) * i / 40, v = v0 * grow(t); if (v >= lo * .8) pts.push({t, v}); } return pts; };
      if (BC) { for (const id in BV0) { g.globalAlpha = .7; line(bcurve(BV0[id]), LCOL[id] || '#ff5a5f', 1.1, [2, 3]); }
        g.globalAlpha = 1; line(bcurve(BC.total_v0 || Object.values(BV0).reduce((a, b) => a + b, 0)), '#fff', 1.8, [3, 3]); }
      g.globalAlpha = 1; line(TOT, '#fff', 2.2);
      M.scans.forEach(s => { if (!s.lesions.length) { g.strokeStyle = '#8a93a3'; g.lineWidth = 1; g.beginPath(); g.arc(X(s.t), bot - 3, 2.5, 0, 7); g.stroke(); } });   // scans with no outlines
      const px = X(tNow); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(px - .6, top, 1.2, bot - top);
      for (const id in LINES) { const v = inBack(tNow) && BV0[id] ? BV0[id] * grow(tNow) : at(LINES[id], tNow); if (v != null && v >= (inBack(tNow) ? lo : 0) && v > 0) { g.fillStyle = LCOL[id]; g.beginPath(); g.arc(px, Yv(v), 2.6, 0, 7); g.fill(); } }
      const tv = inBack(tNow) ? (est >= lo ? est : null) : at(TOT, tNow); if (tv != null) { g.fillStyle = '#fff'; g.beginPath(); g.arc(px, Yv(tv), 3.6, 0, 7); g.fill(); }
      g.fillStyle = '#7d8696'; g.font = '10px system-ui'; g.textAlign = 'center';
      for (let y = new Date(T0).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < T1; y++) { const x = X(Date.UTC(y, 0, 1)); g.fillText(String(y), x, h - 2); g.fillRect(x, bot + 1, 1, 3); }
      bc._X = X; }
    const scl = root.querySelector('.scl');
    scl.textContent = LOG ? 'log' : 'linear';
    scl.onclick = () => { LOG = !LOG; localStorage.setItem('phone.scale', LOG ? 'log' : 'linear'); scl.textContent = LOG ? 'log' : 'linear'; };
    bc.addEventListener('pointerdown', e => { e.stopPropagation(); const r = bc.getBoundingClientRect(), x = e.clientX - r.left; let best = 0, bd = 1e9;
      M.scans.forEach((s, j) => { const d = Math.abs(bc._X(s.t) - x); if (d < bd) { bd = d; best = j; } }); seek(best); });
    const $ = s => root.querySelector(s);
    const iso = t => new Date(t).toISOString().slice(0, 10);
    let lastTxt = '';
    function text() { const d = iso(tNow), s = atScan >= 0 ? M.scans[atScan] : null, n = s ? s.lesions.length : 0;
      const meta = s ? (n ? n + ' lesion' + (n > 1 ? 's' : '') + ' · ' + cm3(s.tot) : s.viewing ? 'scan with pictures only, no outlines' : 'no lesions outlined on this scan') + (s.field ? ' · ' + s.field : '') + ' · scan'
                     : inBack(tNow) ? (est >= 14 ? '≈ ' + cm3(est) + ' · estimated growth (later doubling times)' : 'nothing visible yet · estimated growth')
                     : (est > 0 ? '≈ ' + cm3(est) + ' · between scans (blended)' : 'between scans');
      const c = COURSES.find(c => tNow >= ms(c.a) - 3 * DAY && tNow <= ms(c.b) + 60 * DAY);
      const tx = c ? (tNow <= ms(c.b) + DAY ? c.l + ' ' + fmtS(c.a) : 'After ' + (c.l.startsWith('SRS') ? c.l : c.l.toLowerCase())) : '';
      const key = d + meta + tx; if (key === lastTxt) return; lastTxt = key;
      $('.date').textContent = fmt(d); $('.meta').textContent = meta;
      const te = $('.tx'); te.textContent = tx ? '☢ ' + tx : ''; te.style.visibility = tx ? 'visible' : 'hidden';
      $('.vnow').textContent = s ? 'scan ' + (atScan + 1) + ' of ' + N : 'playing'; }
    // ---- touch: the timelapse always plays; a finger only takes over the turning, which starts again 4 s after letting go ----
    const hint = $('.hint'), lay = $('.layers');
    [['les', 'Lesions'], ['ves', 'Vessels'], ['eyes', 'Eyes & vision pathway'], ['skin', 'Skin'], ['brain', 'Brain'], ['rad', '☢ Radiation'], ['grid', '◫ Gravity grid']].forEach(([k, t]) => {
      const b = document.createElement('button'); b.textContent = t; b.classList.toggle('on', !!LAY[k]);
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.onclick = () => { LAY[k] = !LAY[k]; b.classList.toggle('on', LAY[k]); root.classList.toggle('grid', LAY.grid); localStorage.setItem('phone.layers', JSON.stringify(LAY)); };
      lay.appendChild(b); });
    root.classList.toggle('grid', LAY.grid);
    function take() { auto = false; idleT = 0; hint.style.opacity = 0; }
    const P = new Map(); let pinch = 0, moved = 0;
    wrap.addEventListener('pointerdown', e => { wrap.setPointerCapture(e.pointerId); P.set(e.pointerId, {x: e.clientX, y: e.clientY}); moved = 0;
      if (P.size === 2) { const [a, b] = [...P.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    wrap.addEventListener('pointermove', e => { const p = P.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
      if (P.size === 1) { if (moved > 6) { take(); az -= dx * .01; el = Math.max(-1.2, Math.min(1.2, el + dy * .008)); } }
      else if (P.size === 2) { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...P.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { dist = Math.max(dist0 * .45, Math.min(dist0 * 3, dist * pinch / d)); take(); } pinch = d; return; }
      p.x = e.clientX; p.y = e.clientY; });
    const up = e => { P.delete(e.pointerId); pinch = 0; };
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(dist0 * .45, Math.min(dist0 * 3, dist * (1 + e.deltaY * .001))); take(); }, {passive: false});
    const ro = new ResizeObserver(size); ro.observe(wrap); size();
    function frame(now) { const dt = Math.min(.05, (now - lastNow) / 1000); lastNow = now;
      play += dt; if (play >= TOTAL) play = 0;
      place(); lesions(); text(); bars();
      if (auto) { spin = Math.min(1, spin + dt / 1.5); az += dt * .35 * spin; el += (0.18 - el) * dt * spin; }
      else if (!P.size) { idleT += dt; if (idleT > 4) { auto = true; spin = 0; hint.style.opacity = 1; } }
      const ce = Math.cos(el); const ty = C.z - 26;   // aim a little below the brain's middle, so the head sits high in its space
      cam.position.set(C.x + dist * Math.cos(az) * ce, C.y + dist * Math.sin(az) * ce, ty + dist * Math.sin(el)); cam.lookAt(C.x, C.y, ty);
      dl.position.copy(cam.position); R.render(S, cam); raf = requestAnimationFrame(frame); }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); S.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); R.dispose(); };
  }

  if (q === '1' || (q !== '0' && narrow && !location.hash)) open();
  else if (narrow && q !== '0') close();   // phones that skipped it (a #link) still get the 🧠 3D button
})();
