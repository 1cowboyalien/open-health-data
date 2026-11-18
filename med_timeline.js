/* ---------- Treatment panel (inlined into local/labs.html by make_lab_view.py) ----------
 Rows come from med_timeline.py (D.tx). Your own changes live in an "edits" object:
   seg:   {segId: {a,b,perDay,every,on,off,prn,dose,note,hidden}}  changes to a bar from the records
   dose:  {"rowKey|YYYY-MM-DD": "taken"|"skipped"}                  doses you confirmed or skipped
   added: [{id,drug,cls,setting,dose,route,freq,a,b,status,perDay,every,on,off,prn,note,given:[dates]}]
 Edits are kept in this browser (localStorage) and can be exported to local/med_edits.json,
 which make_lab_view.py builds back in (D.edits) and flatten_meds.py adds to meds_all.tsv.
 Nothing in here changes the hospital records. */
const TX=D.tx||[];
const CLS_ORDER=['HER2/targeted','chemo','steroid','supportive/antiemetic','anticonvulsant','pain','blood/clotting','antibiotic/antifungal','heart/blood pressure','sleep/anxiety','neuro','GI/bowel','respiratory/allergy','fluids/electrolytes','vitamins/supplements','vaccine',"women's health",'anesthesia/procedure','contrast/imaging','other'];
let txHidden=store.get('txhidden',false);
const KIND={moment:{style:'star',fill:true,r:7,label:'Keyframe you added (your own note, not from the medical record)'},
 given:{style:'circle',fill:true,r:4.5,label:'Given: confirmed by a hospital dispense record'},
 order:{style:'rectRot',fill:true,r:5,label:'One-time order marked completed (no dispense record)'},
 fill:{style:'rect',fill:true,r:4,label:'Pharmacy fill'},
 assumed:{style:'circle',fill:false,r:2.6,label:'Assumed dose from the prescription schedule (not confirmed)'},
 user:{style:'triangle',fill:true,r:5.5,label:'Taken: confirmed or entered by you'},
 skipped:{style:'crossRot',fill:false,r:5,label:'Skipped: marked by you'}};
const ROWPX=30,BARY=0.17,DAYMS=864e5;
const EMPTY_EDITS=()=>({version:1,ts:0,seg:{},dose:{},added:[],moments:[],ranges:[],panels:[],macros:[]});
const isoD=t=>new Date(t).toISOString().slice(0,10);
/* when a dose was given: date and local time from the record ("at", UTC), else just the date */
/* why it was given, only as the record says it (flatten_meds.py): the diagnosis on the order, the order's
   "as needed for ..." words, and the reason of the visit it was ordered in. Nothing is guessed. */
const cut=(t,n)=>t.length>n?t.slice(0,n-1)+'…':t;
function whyLines(w,n){if(!w)return[];n=n||90;const L=[];if(w.order)L.push('Reason on the order: '+cut(w.order.replace(/ \| /g,'; '),n));
 if(w.prn&&!(w.order||'').toLowerCase().includes(w.prn.toLowerCase()))L.push('As needed for: '+cut(w.prn,n));if(w.visit)L.push('Visit: '+cut(w.visit,n));if(w.by)L.push('Ordered by: '+cut(w.by,n));return L}
/* when a dose was given, in ms: the recorded time if there is one, else the start of its date */
const evT=e=>e.at?Date.parse(e.at):dms(e.d);
const evWhen=e=>e&&e.at?localStamp(Date.parse(e.at)):e?e.d:'';
const evHover=e=>e&&e.at?hStamp(Date.parse(e.at)):e?e.d:'';
const dms=s=>Date.parse(s+'T12:00:00Z');

/* ---- edits: newest of (this browser, local/med_edits.json) wins ---- */
let E=(()=>{const f=D.edits&&D.edits.version?D.edits:null,l=store.get('txedits',null);
 const pick=l&&(!f||(l.ts||0)>=(f.ts||0))?l:f;return Object.assign(EMPTY_EDITS(),pick||{})})();
let txDirty=store.get('txdirty',false);
/* medications ticked in the sidebar (drug names); first visit: the HER2/targeted and chemo drugs */
let txSel=[];
function initTxSel(){txSel=store.get('txsel',null);
 if(!Array.isArray(txSel)){const c=store.get('txcls',['HER2/targeted','chemo']);txSel=[...new Set(effRows(TX,E).filter(r=>c.includes(r.cls)).map(r=>r.drug))];store.set('txsel',txSel)}}
/* ---- shared edits: when the page comes from serve_viewer.py, edits live in one file on the server
   (local/med_edits.json) and every browser loads them; otherwise they stay in this browser.
   View / Edit: in View only nothing is saved and the edit controls are hidden. ---- */
let SHARED=false,REV=0,saveQ=Promise.resolve(),shareMsg='';
let role=store.get('role','view');
const canEdit=()=>role==='edit';
function setRole(r){role=r;store.set('role',r);applyRole();if(!canEdit()){$('txEdit').classList.add('hide');if(editingMoment)$('mEdit').classList.add('hide');editingMoment=null}list();render()}
function applyRole(){document.body.classList.toggle('viewonly',!canEdit());const b=$('roleBtn');if(!b)return;
 b.textContent=canEdit()?'✎ Editing':'👁 View only';b.classList.toggle('on',canEdit());
 b.title=canEdit()?'You can change keyframes, presets and medications. Click to switch to View only.':'Changes are switched off. Click to edit (no login: anyone with the page can).'}
function saveEdits(){E.ts=Date.now();
 if(SHARED){if(canEdit())pushEdits();txStatus();return}
 if(!canEdit()){txStatus();return}
 store.set('txedits',E);txDirty=true;store.set('txdirty',true);txStatus()}
function pushEdits(){shareMsg='saving…';txStatus();
 saveQ=saveQ.then(async()=>{try{
   const r=await fetch('/api/edits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rev:REV,edits:E})});const j=await r.json();
   if(r.status===409){REV=j.rev;E=Object.assign(EMPTY_EDITS(),j.edits||{});delete E.rev;shareMsg='';txStatus();list();render();
    uiNote('Someone else saved a change just before you, so the newest version is now loaded.\nPlease make your last change again.');return}
   if(!r.ok)throw new Error(j.error||r.status);REV=j.rev;shareMsg='saved for everyone'}
  catch(e){shareMsg='NOT saved: the viewer server is not reachable';store.set('txedits',E)}
  txStatus()})}
async function loadShared(quiet){if(!/^https?:/.test(location.protocol))return false;
 try{const r=await fetch('/api/edits',{cache:'no-store'});if(!r.ok)return false;const j=await r.json();
  SHARED=true;
  if(!j.edits&&j.rev===0&&nEdits()){REV=0;pushEdits();shareMsg='your changes from this browser are now shared';txStatus();return true}   // first run: share what this browser had
  const changed=j.rev!==REV;REV=j.rev;if(changed||!quiet){E=Object.assign(EMPTY_EDITS(),j.edits||{});delete E.rev;
   (window.momentSyncers||[]).forEach(f=>{try{f()}catch(err){console.error(err)}});   // panels re-add their generated moment lines (procedures, MRI views, pathology)
  shareMsg='shared · everyone sees saved changes';txStatus();list();render()}
  return true}catch(e){return false}}
/* coming back to the tab: pick up other people's changes (not while an editor is open) */
window.addEventListener('focus',()=>{if(SHARED&&!editingMoment&&$('txEdit').classList.contains('hide'))loadShared(true)});

/* ---- pure helpers (tested with osascript) ---- */
function assumedDays(s,a,b){const out=[],sch=s.sch;if(!sch||sch.prn)return out;
 const s0=dms(s.a),s1=dms(s.b),step=DAYMS*Math.max(1,sch.every||1),cyc=(sch.on||0)+(sch.off||0);
 for(let t=s0;t<=s1;t+=step){if(t<a||t>b)continue;if(cyc&&sch.on&&Math.round((t-s0)/DAYMS)%cyc>=sch.on)continue;out.push(t)}return out}
const segId=(r,g)=>g.sid||g.id||(r.key+'|'+g.a+'|'+(g.src||''));
const SCH_KEYS=['perDay','every','on','off','prn'];
/* records + your edits -> rows to draw */
function effRows(tx,E){const rows=tx.map(r=>{const segs=[];
  r.segs.forEach(g=>{const sid=segId(r,g),ov=E.seg[sid];let e=Object.assign({},g,{sid});
   if(ov){if(ov.hidden)return;e=Object.assign(e,{a:ov.a||g.a,b:ov.b||g.b,dose:ov.dose!=null?ov.dose:g.dose,note:ov.note!=null?ov.note:g.note,edited:true});
    if(ov.dose!=null&&ov.dose!==g.dose){const pd=parseDose(ov.dose);e.dv=pd?pd.v:null;e.du=pd?pd.u:''}
    const sch=Object.assign({perDay:1,every:1,on:0,off:0,prn:false},g.sch||{});SCH_KEYS.forEach(k=>{if(ov[k]!=null)sch[k]=ov[k]});e.sch=sch}
   segs.push(e)});
  return Object.assign({},r,{segs,ev:r.ev.slice()})});
 const byKey={};rows.forEach(r=>byKey[r.key]=r);
 const rowFor=(drug,cls,setting)=>{const k=drug.toLowerCase()+'|'+setting;
  if(!byKey[k]){byKey[k]={key:k,drug:drug.toLowerCase(),cls,setting,segs:[],ev:[],ndisp:0,first:'9999',du:''};rows.push(byKey[k])}return byKey[k]};
 (E.added||[]).forEach(m=>{if(!m.drug||!m.a)return;const r=rowFor(m.drug,m.cls||'other',m.setting||'home');
  const sch={perDay:+m.perDay||1,every:+m.every||1,on:+m.on||0,off:+m.off||0,prn:!!m.prn};
  const pd=parseDose(m.dose),dv=pd?pd.v:null,du=pd?pd.u:'';if(pd&&!r.du)r.du=du;
  r.segs.push({dv,du,a:m.a,b:m.b||m.a,src:'you',user:true,uid:m.id,sid:'user:'+m.id,dose:m.dose||'',route:m.route||'',freq:m.freq||'',note:m.note||'',status:m.status||'',sch});
  (m.given||[]).forEach(d=>r.ev.push({dv,du,d,k:'user',src:'you',dose:m.dose||'',route:m.route||'',text:'entered by you',uid:m.id}))});
 Object.entries(E.dose||{}).forEach(([k,v])=>{if(v!=='taken')return;const i=k.lastIndexOf('|'),r=byKey[k.slice(0,i)];
  if(r)r.ev.push({d:k.slice(i+1),k:'user',src:'you',text:'confirmed by you',doseKey:k})});
 rows.forEach(r=>{r.ev.sort((p,q)=>p.d.localeCompare(q.d));
  r.first=[...r.segs.map(g=>g.a),...r.ev.map(e=>e.d)].sort()[0]||'9999'});
 return rows.filter(r=>r.segs.length||r.ev.length)}
/* "4 mg" -> {v:4,u:'mg'}; ranges and text without a number -> null */
function parseDose(t){const m=/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u00b5%][\w/%\u00b5]*)/.exec(t||'');return m&&!/^\s*\d+(\.\d+)?\s*-/.test(t)?{v:+m[1],u:m[2]}:null}
/* dose points of one drug (rows = its hospital and/or home rows), in its most common unit:
   doses from records (given / order / fill / user) and each prescribed period's start and end */
function dosePoints(rows){const cnt={};rows.forEach(r=>[...r.ev,...r.segs].forEach(x=>{if(x.dv!=null&&x.du)cnt[x.du]=(cnt[x.du]||0)+1}));
 const u=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];if(!u)return{u:'',pts:[]};const pts=[];
 rows.forEach(r=>{r.ev.forEach(e=>{if(e.dv!=null&&e.du===u)pts.push({t:evT(e),v:e.dv,k:e.k,src:e.src,r,e})});
  r.segs.forEach(g=>{if(g.dv!=null&&g.du===u){pts.push({t:dms(g.a),v:g.dv,k:'rx',src:g.src,r,g});pts.push({t:dms(g.b),v:g.dv,k:'rxend',src:g.src,r,g})}})});
 pts.sort((a,b)=>a.t-b.t||(a.k==='rxend')-(b.k==='rxend'));return{u,pts}}
/* dose in effect at time t: the last dose point at or before t (or the first one) */
function doseAt(pts,t){let v=pts.length?pts[0].v:null;for(const p of pts){if(p.t>t)break;if(p.k!=='rxend')v=p.v}return v}
/* places where the dose changes: [{t,v,prev}] (pure; tested with osascript) */
function doseChanges(pts){const out=[];let last=null;pts.forEach(p=>{if(p.k==='rxend')return;if(p.v!==last)out.push({t:p.t,v:p.v,prev:last});last=p.v});return out}
/* next state when you click a dose marker: assumed -> taken -> skipped -> back to assumed */
function nextDoseState(cur){return cur==null?'taken':cur==='taken'?'skipped':null}

/* ---- drawing ---- */
/* the order of drugs in the Treatment panel: drugs you moved (txOrder) first, in that order; others by class and first date */
let txOrder=store.get('txorder',[]);
const ordRank=d=>{const i=txOrder.indexOf(d);return i<0?1e6:i};
function moveDrug(drug,d){const ds=[...new Set(txShown.filter(r=>!r.moments).map(r=>r.drug))],i=ds.indexOf(drug),j=i+d;if(i<0||j<0||j>=ds.length)return;
 [ds[i],ds[j]]=[ds[j],ds[i]];txOrder=[...ds,...txOrder.filter(x=>!ds.includes(x))];store.set('txorder',txOrder);render()}
function txRows(){const vis=t=>t>=W.a-DAYMS&&t<=W.b+DAYMS;
 return effRows(TX,E).filter(r=>txSel.includes(r.drug)&&(r.segs.some(g=>dms(g.b)+DAYMS>=W.a&&dms(g.a)<=W.b)||r.ev.some(e=>vis(dms(e.d)))))
  .sort((p,q)=>ordRank(p.drug)-ordRank(q.drug)||CLS_ORDER.indexOf(p.cls)-CLS_ORDER.indexOf(q.cls)||p.first.localeCompare(q.first)||p.drug.localeCompare(q.drug)||p.setting.localeCompare(q.setting))}
/* "generic (Brand)" - brands only as the records name them (med_timeline.py) */
const drugLabel=(drug,brands)=>drug+(brands&&brands.length?' ('+brands.join(', ')+')':'');
const rowLabel=r=>r.moments?'Keyframes — your own notes (click the row to add one)':drugLabel(r.drug,r.brands)+(r.setting==='home'?' · taken at home':' · given at hospital/clinic');
/* drugs grouped by class for the sidebar: [{cls, drugs:[{drug, settings, n}]}] (pure; tested with osascript) */
function medGroupsOf(rows){const by={};rows.forEach(r=>{const d=by[r.drug]=by[r.drug]||{drug:r.drug,cls:r.cls,settings:[],brands:[],n:0,first:r.first};
  (r.brands||[]).forEach(b=>{if(!d.brands.includes(b))d.brands.push(b)});
  if(!d.settings.includes(r.setting))d.settings.push(r.setting);if(r.du)d.hasDose=true;d.n+=r.ev.length+(r.setting==='home'?r.segs.length:0);if(r.first<d.first)d.first=r.first});
 const out=[];CLS_ORDER.forEach(c=>{const drugs=Object.values(by).filter(d=>d.cls===c).sort((p,q)=>p.drug.localeCompare(q.drug));if(drugs.length)out.push({cls:c,drugs})});
 Object.values(by).filter(d=>!CLS_ORDER.includes(d.cls)).forEach(d=>{let g=out.find(x=>x.cls===d.cls);if(!g)out.push(g={cls:d.cls,drugs:[]});g.drugs.push(d)});return out}
const medGroups=()=>medGroupsOf(effRows(TX,E));
function setMedSel(drugs,on){txSel=txSel.filter(d=>!drugs.includes(d));if(on)txSel.push(...drugs);store.set('txsel',txSel);list();render()}
function medSection(el,q){const groups=medGroups().map(g=>({cls:g.cls,drugs:g.drugs.filter(d=>!q||drugLabel(d.drug,d.brands).toLowerCase().includes(q)||g.cls.toLowerCase().includes(q))})).filter(g=>g.drugs.length);
 if(!groups.length)return;const n=groups.reduce((a,g)=>a+g.drugs.length,0);
 const M=section(el,'meds','Medications',n+' drugs',true,'sec',q);
 const allNames=groups.flatMap(g=>g.drugs.map(d=>d.drug)),ms=M.firstChild;
 ms.insertBefore(miniBtn('None','Untick every medication',()=>setMedSel(allNames,false)),ms.lastChild);
 ms.insertBefore(miniBtn('All','Tick every medication',()=>setMedSel(allNames,true)),ms.lastChild.previousSibling);
 groups.forEach(g=>{const names=g.drugs.map(d=>d.drug),k=names.filter(d=>txSel.includes(d)).length;
  const G=section(M,'med:'+g.cls,g.cls,k?k+'/'+names.length:names.length,k>0,'grp',q);
  const all=document.createElement('input');all.type='checkbox';all.checked=k===names.length;all.indeterminate=k>0&&k<names.length;
  all.setAttribute('aria-label','Show all '+g.cls+' medications');all.title='Tick or untick the whole group';
  all.onclick=e=>{e.stopPropagation();setMedSel(names,all.checked)};const gs=G.firstChild;gs.insertBefore(all,gs.firstChild);
  gs.insertBefore(miniBtn('All','Tick all '+g.cls+' medications',()=>setMedSel(names,true)),gs.lastChild);
  gs.insertBefore(miniBtn('None','Untick all '+g.cls+' medications',()=>setMedSel(names,false)),gs.lastChild);
  gs.insertBefore(groupOnlyBtn('medication','grp:'+g.cls,names,soloMed&&soloMed.key==='grp:'+g.cls,soloMed&&soloMed.key.startsWith('id:')&&names.includes(soloMed.ids[0]),
   ()=>onlyMed('grp:'+g.cls,names,g.cls)),gs.lastChild);
  g.drugs.forEach(d=>{const row=document.createElement('label');row.className='t';
   const cb=document.createElement('input');cb.type='checkbox';cb.checked=txSel.includes(d.drug);cb.onchange=()=>setMedSel([d.drug],cb.checked);
   const nm=document.createElement('span');nm.className='nm';nm.textContent=drugLabel(d.drug,d.brands);nm.title=nm.textContent;
   const tg=document.createElement('span');tg.className='tag';tg.textContent=d.settings.map(x=>x==='home'?'home':'hosp').sort().join(' · ');
   tg.title=d.settings.map(x=>x==='home'?'taken at home':'given at hospital/clinic').join(', ');
   const c=document.createElement('span');c.className='n';c.textContent=d.n||'';c.title='records: doses, fills and prescriptions';
   const go=document.createElement('button');go.type='button';go.className='mini goto';go.textContent='⌖';
   go.title='Find '+drugLabel(d.drug,d.brands)+' on the timeline: step through its doses and orders';go.setAttribute('aria-label',go.title);
   go.onclick=e=>{e.preventDefault();e.stopPropagation();startFind(d.drug,drugLabel(d.drug,d.brands))};
   row.append(cb,nm,go,tg);
   if(d.hasDose){const dz=document.createElement('span');dz.className='dosetog';const dc=document.createElement('input');dc.type='checkbox';dc.checked=txDose.includes(d.drug);
    dc.setAttribute('aria-label','Show a dose chart for '+d.drug);dc.onclick=e=>{e.stopPropagation();setDoseChart(d.drug,dc.checked)};
    const dl=document.createElement('span');dl.textContent='dose';dz.title='Show the dose over time as a chart';dz.onclick=e=>{e.preventDefault();e.stopPropagation();if(e.target!==dc){dc.checked=!dc.checked;setDoseChart(d.drug,dc.checked)}};
    dz.append(dc,dl);row.appendChild(dz)}
   if(HLD[d.drug]){const hz=document.createElement('span');hz.className='tag';const est=HLD[d.drug].basis==='estimate';hz.textContent=est?'t½*':'t½';hz.title=(est?'Unofficial half-life estimate, not from a drug label (':'Half-life from the drug label (')+hlText(HLD[d.drug])+(HLD[d.drug].refers?'; '+HLD[d.drug].refers:'')+'): an estimate curve is drawn under this drug in the Treatment panel while Half-life is on';row.appendChild(hz)}
   row.appendChild(onlyBtn('Show only '+d.drug+' (deselect the other medications)',()=>onlyMed('id:'+d.drug,[d.drug],drugLabel(d.drug,d.brands)),soloMed&&soloMed.key==='id:'+d.drug));
   row.appendChild(c);row.onmouseenter=()=>setHlDrug(d.drug);row.onmouseleave=()=>setHlDrug(null);G.appendChild(row)})})}
/* compact legend: one line of small symbols with a word or two each; the full meaning is in each item's tooltip */
const SHORT={moment:'keyframe',given:'given',order:'completed order',fill:'fill',assumed:'assumed',user:'yours',skipped:'skipped'};
function txLegend(){const el=$('txLegend');el.innerHTML='';
 const svg={circle:f=>`<circle cx="6" cy="6" r="3.8" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.4"/>`,
  rectRot:()=>'<rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="currentColor"/>',rect:()=>'<rect x="2.5" y="2.5" width="7" height="7" fill="currentColor"/>',
  triangle:()=>'<path d="M6 1.5 L10.5 10.5 L1.5 10.5 Z" fill="currentColor"/>',star:()=>'<path d="M6 0.8 L7.5 4.6 L11.5 4.7 L8.3 7.1 L9.4 11 L6 8.7 L2.6 11 L3.7 7.1 L0.5 4.7 L4.5 4.6 Z" fill="#e34948"/>',crossRot:()=>'<path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" stroke-width="1.6"/>'};
 const item=(inner,w,text,title)=>{const e=document.createElement('span');e.className='shape';e.title=title;
  e.innerHTML='<svg width="'+w+'" height="12" aria-hidden="true">'+inner+'</svg><span></span>';e.lastChild.textContent=text;e.setAttribute('aria-label',title);el.appendChild(e)};
 Object.entries(KIND).forEach(([k,v])=>item(svg[v.style](v.fill),12,SHORT[k]||k,v.label));
 item('<rect x="1" y="3" width="16" height="6" rx="2" fill="currentColor" opacity=".35"/>',18,'ordered','Ordered period (dashed: no end date in the record, or as needed; solid outline: changed or entered by you; thicker = higher dose)');
 if(Object.keys(HLD).length){
  item('<path d="M1 11 L5 2 Q9 8 15 9 L15 11 Z" fill="rgba(57,135,229,.35)" stroke="#3987e5"/>',16,'t½ curve','Half-life curve under a drug: estimated amount in the body, half-life from the drug label (t½)');
  item('<path d="M1 11 L5 2 Q9 8 15 9" fill="none" stroke="#3987e5" stroke-dasharray="3 2"/>',16,'assumed taken','Dashed curve: home drug, assumes it was taken as prescribed');
  item('<path d="M1 11 L5 2 Q9 8 15 9 L15 11 Z" fill="rgba(138,137,132,.3)" stroke="#8a8984" stroke-dasharray="1.5 2"/>',16,'estimate (t½*)','Grey dotted curve: unofficial half-life estimate, not from a drug label (t½*)')}
 const h=document.createElement('span');h.className='sub';h.textContent='· hover a symbol for its meaning';el.appendChild(h)}
let txShown=[];let hlDrug=null;
/* "only" for medications: same idea as onlyLab() in the page script */
let soloMed=store.get('solomed',null);if(soloMed&&!soloMed.key)soloMed=null;
function onlyMed(key,drugs,label){if(soloMed&&soloMed.key===key){endSoloMed();return}
 soloMed={key,ids:drugs,label,prev:soloMed?soloMed.prev:txSel.slice()};store.set('solomed',soloMed);txSel=drugs.slice();store.set('txsel',txSel);list();render();if(drugs.length===1)setHlDrug(drugs[0])}
function endSoloMed(){if(!soloMed)return;txSel=soloBack(soloMed.prev,txSel,soloMed.ids);soloMed=null;store.set('solomed',null);store.set('txsel',txSel);list();render()}
/* ---- Find bar: step through one medication's doses and orders (⌖ in the Library) ----
   Each step ticks the drug if needed, moves the window to the event (keeping its length, or 3 months when it is
   longer than 6), highlights the drug's rows, puts the Hover line on the event and scrolls its row into view. */
let FIND=null;
function findEvents(drug){const out=[];
 effRows(TX,E).filter(r=>r.drug===drug).forEach(r=>{
  r.ev.forEach(e=>out.push({t:evT(e),when:evWhen(e),what:(SHORT[e.k]||e.k)+(r.setting==='home'?' (home)':''),dose:e.dose||'',src:e.src||''}));
  r.segs.forEach(g=>{if(!/joined/.test(g.note||''))out.push({t:dms(g.a),when:g.a,what:(g.user?'entered by you':'ordered')+' '+g.a+' to '+g.b,dose:g.dose||'',src:g.src||''})})});
 return out.sort((a,b)=>a.t-b.t)}
function startFind(drug,label){const evs=findEvents(drug);if(!evs.length)return;FIND={drug,label,evs,i:0};
 const j=evs.findIndex(e=>e.t>=W.a&&e.t<=W.b);findGo(j>=0?j:0)}
function findGo(i){const F=FIND;if(!F)return;F.i=i=Math.max(0,Math.min(F.evs.length-1,i));const ev=F.evs[i];let redo=false;
 if(!txSel.includes(F.drug)){txSel.push(F.drug);store.set('txsel',txSel);redo=true}
 if(txHidden){txHidden=false;store.set('txhidden',false);redo=true}
 let len=W.b-W.a;if(len>180*DAYMS)len=90*DAYMS;const a=Math.max(X0,Math.min(ev.t-len/2,X1-len));
 if(redo){W={a,b:a+len};store.set('window',W);syncWin();list();render()}else setWin(a,a+len);
 hlDrug=null;setHlDrug(F.drug);findBar();setTimeout(()=>{setHover(pos(ev.t));findScroll()},40)}
function findScroll(){const c=charts.get('tx'),r=FIND&&txShown.find(r=>r.drug===FIND.drug);if(!c||!r)return;
 const y=c.canvas.getBoundingClientRect().top+c.scales.y.getPixelForValue(r._u0),top=document.querySelector('.navpin').getBoundingClientRect().bottom+10;
 if(y<top||y>innerHeight-80)scrollBy({top:y-top-40,behavior:'smooth'})}
function findBar(){const bar=$('findBar');bar.innerHTML='';bar.classList.toggle('hide',!FIND);if(!FIND)return;const F=FIND,ev=F.evs[F.i],n=F.evs.length;
 const t=document.createElement('span');t.className='wl';t.textContent='⌖';const nb=document.createElement('b');nb.textContent=F.label;
 const k=document.createElement('span');k.className='sub';k.textContent=(F.i+1)+' of '+n;
 const d=document.createElement('span');d.textContent=ev.when+' · '+ev.what+(ev.dose?' · '+ev.dose:'')+(ev.src&&ev.src!=='you'?' · '+ev.src:'');
 const b=(txt,tip,i,off)=>{const x=btn(txt,()=>findGo(i),'');x.title=tip;x.disabled=off;return x};
 bar.append(t,nb,k,b('⏮','First',0,F.i===0),b('◀','Previous',F.i-1,F.i===0),b('▶','Next',F.i+1,F.i===n-1),b('⏭','Last',n-1,F.i===n-1),d);
 const x=btn('×',()=>{FIND=null;hlDrug=null;setHlDrug(null);findBar()},'');x.title='Close the Find bar';x.style.marginLeft='auto';bar.appendChild(x)}
/* hovering a drug in the list tints its band rows and outlines its dose chart */
function setHlDrug(drug){drug=drug||(FIND&&FIND.drug)||null;if(drug===hlDrug)return;hlDrug=drug;const c=charts.get('tx');if(c)c.draw();
 document.querySelectorAll('#txDoses .dosebox').forEach(b=>b.classList.toggle('hl',b.dataset.drug===drug))}
/* ---- Moments: your own notes on the timeline ----
   E.moments: [{id,title,group,date,time,end,note,color,line,on,links:[{test,name,t,text,src}]}]
   Kept with your other edits (this browser, Export/Import, private local/med_edits.json); never in public files.
   Shown in the pinned keyframe track, listed in the sidebar (groups, ticks, jump), with optional
   lines across every chart; readings can be linked to a moment (ringed with a star on their chart). */
const MCOL={red:'#e34948',orange:'#eb6834',purple:'#6250d6',green:'#1baf7a',grey:'#8a8984'};
/* moment kinds: each has its own shape (colour stays your choice); moments without a kind are events */
const MKIND={event:{label:'Event',shape:'star'},symptom:{label:'Symptom',shape:'triangle'},procedure:{label:'Procedure / treatment',shape:'rectRot'},
 test:{label:'Test / scan',shape:'rect'},note:{label:'Note',shape:'circle'}};
const mShape=m=>(MKIND[m.kind]||MKIND.event).shape;
/* draw a moment shape on a canvas, centred at x,y, radius r */
function drawShape(ctx,shape,x,y,r){ctx.beginPath();
 if(shape==='star'){for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r*.45:r;ctx.lineTo(x+q*Math.cos(a),y+q*Math.sin(a))}}
 else if(shape==='triangle'){ctx.moveTo(x,y-r);ctx.lineTo(x+r*.95,y+r*.75);ctx.lineTo(x-r*.95,y+r*.75)}
 else if(shape==='rectRot'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y)}
 else if(shape==='rect'){ctx.rect(x-r*.8,y-r*.8,r*1.6,r*1.6)}
 else ctx.arc(x,y,r*.85,0,7);
 ctx.closePath()}
/* the same shape as a small inline SVG (Library rows, legend) */
function shapeSvg(shape,col,px){const c=document.createElement('canvas');c.width=c.height=px*2;const x=c.getContext('2d');x.scale(2,2);drawShape(x,shape,px/2,px/2,px/2-1);x.fillStyle=col;x.fill();
 const i=document.createElement('img');i.src=c.toDataURL();i.width=i.height=px;i.alt='';i.className='mshape';return i}
const momentT=m=>!m||!m.date?null:m.time?new Date(m.date+'T'+m.time).getTime():dms(m.date);   // with a time: your local time
const momentOn=m=>m.on!==false;
let mLines=store.get('mlines',true),editingMoment=null;
/* the Keyframes track has two rows: plain keyframes, and rated ones (the Concern marks); each can be switched off (per browser) */
function mRows(){const r=store.get('mrows',{kf:true,cc:true});return{kf:r.kf!==false,cc:r.cc!==false}}
function rowOn(m){const r=mRows();return isRated(m)?r.cc:r.kf}
/* a dashed line (and a light shade for periods) at each shown moment, drawn on every chart */
const momentPlugin={id:'moments',afterDatasetsDraw(c){const ms_=(E.moments||[]).filter(m=>momentOn(m)&&m.date&&m.line!==false&&rowOn(m));if(!mLines||!ms_.length)return;
 const{ctx,chartArea:a,scales:{x}}=c;ctx.save();
 ms_.forEach(m=>{const t=momentT(m),te=m.end?dms(m.end):null,colr=MCOL[m.color]||MCOL.red;if((te||t)<W.a||t>W.b)return;
  const px=x.getPixelForValue(pos(Math.max(t,W.a)));
  if(te&&te>t){const p2=x.getPixelForValue(pos(Math.min(te,W.b)));ctx.globalAlpha=.08;ctx.fillStyle=colr;ctx.fillRect(px,a.top,p2-px,a.bottom-a.top)}
  if(t>=W.a){ctx.globalAlpha=.75;ctx.strokeStyle=colr;ctx.setLineDash([2,3]);ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.setLineDash([]);
   ctx.globalAlpha=.9;ctx.fillStyle=colr;drawShape(ctx,mShape(m),px,a.top+5,4.5);ctx.fill()}});
 ctx.restore()}};
/* star rings on readings linked to a shown moment (t = the chart's test, pv = its points in the window, tm = point time) */
function momentRings(test,pv,tm){return{id:'mrings',afterDatasetsDraw(c){const ed=editingMoment;
 const ms_=(E.moments||[]).filter(m=>!ed||m.id!==ed.id).concat(ed?[ed]:[]).filter(m=>(m===ed||momentOn(m))&&(m.links||[]).some(l=>l.test===test.id));if(!ms_.length)return;
 const{ctx}=c,meta=c.getDatasetMeta(0);ctx.save();
 ms_.forEach(m=>m.links.filter(l=>l.test===test.id).forEach(l=>{const i=(c.$pv||pv).findIndex(x=>tm(x)===l.t);if(i<0||!meta.data[i])return;const{x,y}=meta.data[i];
  ctx.strokeStyle=MCOL[m.color]||MCOL.red;ctx.lineWidth=2;ctx.setLineDash(m===ed?[3,2]:[]);ctx.beginPath();ctx.arc(x,y,8,0,7);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=ctx.strokeStyle;drawShape(ctx,mShape(m),x,y-15,5);ctx.fill()}));
 ctx.restore()}}}
/* ---- step through moments (⏮ ◀ ▶ ⏭ in the Moments panel header), like the Find bar for a medication ----
   Steps through the shown moments with a date (all of them if none is shown), in time order. Each step moves the
   window to the moment (keeping its length, or 2 weeks when it is longer than 2 months) and puts the Hover line on it.
   Without a current moment, ◀ / ▶ go to the nearest one before / after the middle of the window. */
let momCur=null;
/* a moment with a concern rating lives on the Concern graph (milestones_view.js), not on this track or its ◀ ▶ stepping */
function isRated(m){return typeof m.concern==='number'&&isFinite(m.concern)}
/* ◀ ▶ stop only at the rows that are switched on (Keyframes / Concern buttons); rated ones also only inside the Concern range */
function momList(){const all=(E.moments||[]).filter(m=>m.date&&rowOn(m)&&(!isRated(m)||typeof msIn!=='function'||msIn(m))),on=all.filter(momentOn);return(on.length?on:all).sort((a,b)=>momentT(a)-momentT(b))}
function goMoment(m){if(!m)return;momCur=m.id;const t=momentT(m);let len=W.b-W.a;if(len>60*DAYMS)len=14*DAYMS;
 const a=Math.max(X0,Math.min(t-len/2,X1-len));setWin(a,a+len);setTimeout(()=>setHover(pos(t)),40)}
function momNav(){const el=$('mNav');if(!el)return;el.innerHTML='';const L=momList(),n=L.length;if(!n)return;const mid=(W.a+W.b)/2;
 let i=L.findIndex(m=>m.id===momCur);if(i>=0&&(momentT(L[i])<W.a||momentT(L[i])>W.b))i=-1;
 let prev=i>=0?i-1:-1,next=i>=0?i+1:n;if(i<0){for(let k=0;k<n;k++){if(momentT(L[k])<mid)prev=k;else{next=k;break}}}
 const b=(t,tip,j)=>{const x=btn(t,()=>goMoment(L[j]),'');x.title=tip;x.disabled=j<0||j>=n||j===i;return x};
 const lab=document.createElement('span');lab.className='mnavl';
 if(i>=0){const m=L[i];lab.textContent=(i+1)+' of '+n+' · '+(m.title.length>28?m.title.slice(0,27)+'…':m.title)+' · '+m.date;lab.title='Open this keyframe';lab.onclick=()=>openMoment(m)}
 else lab.textContent=n+' keyframe'+(n>1?'s':'');
 el.append(b('⏮','First keyframe',0),b('◀','Previous keyframe',prev),lab,b('▶','Next keyframe',next),b('⏭','Last keyframe',n-1))}
function momentControls(){$('mLines').textContent='Lines: '+(mLines?'on':'off');$('mLines').className=mLines?'on':'';
 {const r=mRows();if($('mRowK')){$('mRowK').className=r.kf?'on':'';$('mRowC').className=r.cc?'on':''}}momNav();
 const k=$('mKinds');if(k&&!k.childNodes.length)Object.values(MKIND).forEach(v=>{const e=document.createElement('span');e.append(shapeSvg(v.shape,css('--muted'),10),v.label.split(' /')[0].toLowerCase());k.appendChild(e)})}
function setMomentsOn(ids,on){(E.moments||[]).forEach(m=>{if(ids.includes(m.id))m.on=on});saveEdits();list();render()}
/* jump: centre the window on the moment, keeping its length (3 days if the window is over ~2 months) */
function jumpMoment(m){if(!m.date){openMoment(m);return}let len=W.b-W.a;if(len>60*DAYMS)len=3*DAYMS;if(!momentOn(m)){m.on=true;saveEdits()}
 shiftWin(momentT(m)-len/2,len);list();openMoment(m)}

/* the pinned keyframe track (one row in the navigation bar, aligned with the charts) */
/* ---- time ruler under the Moments panel (pinned with the Navigator) ----
   Divisions follow the zoom: years → months → weeks (1st/8th/15th/22nd) → days → 6 h / 1 h → 15 / 5 / 1 min (the shortest window is 12 hours).
   Minor marks: the smallest unit at least 5 px apart; labelled marks: the smallest at least 34 px apart.
   While the mouse is over any chart, the Hover line's date (and time, when zoomed in to hours) is shown here. Local time. */
const HOURMS=3600e3,MINMS=60e3,WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],z2=n=>String(n).padStart(2,'0');
const dayName=d=>MON[d.getMonth()]+' '+d.getDate();
const RUNITS=[
 {ms:365.25*DAYMS,fl:d=>new Date(d.getFullYear(),0,1),nx:d=>new Date(d.getFullYear()+1,0,1),lb:d=>String(d.getFullYear())},
 {ms:30.44*DAYMS,fl:d=>new Date(d.getFullYear(),d.getMonth(),1),nx:d=>new Date(d.getFullYear(),d.getMonth()+1,1),lb:d=>d.getMonth()?MON[d.getMonth()]:String(d.getFullYear())},
 {ms:7.6*DAYMS,fl:d=>new Date(d.getFullYear(),d.getMonth(),[22,15,8,1].find(k=>k<=d.getDate())),   // 1st, 8th, 15th, 22nd
  nx:d=>d.getDate()>=22?new Date(d.getFullYear(),d.getMonth()+1,1):new Date(d.getFullYear(),d.getMonth(),d.getDate()+7),
  lb:d=>d.getDate()===1?(d.getMonth()?MON[d.getMonth()]:String(d.getFullYear())):String(d.getDate())},
 {ms:DAYMS,fl:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()),nx:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+1),
  lb:d=>d.getDate()===1?(d.getMonth()?MON[d.getMonth()]:String(d.getFullYear())):String(d.getDate())},
 ...[6,1].map(h=>({ms:h*HOURMS,fl:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),Math.floor(d.getHours()/h)*h),
  nx:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours()+h),lb:d=>d.getHours()?z2(d.getHours())+':00':dayName(d)})),
 ...[15,5,1].map(k=>({ms:k*MINMS,fl:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),Math.floor(d.getMinutes()/k)*k),
  nx:d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes()+k),lb:d=>d.getHours()||d.getMinutes()?z2(d.getHours())+':'+z2(d.getMinutes()):dayName(d)}))];
const RULERH=26;
function rulerUnits(wpx){const px=u=>u.ms/(W.b-W.a)*wpx,small=[...RUNITS].reverse();
 return{minor:small.find(u=>px(u)>=5)||RUNITS[0],major:small.find(u=>px(u)>=34)||RUNITS[0]}}
function rulerTimes(u){const out=[];let d=u.fl(new Date(W.a)),n=0;while(d.getTime()<=W.b&&n++<3000){if(d.getTime()>=W.a)out.push(d);d=u.nx(d)}return out}
function cursorText(t,u){const w=NAVTZ?new Date(tzWall(t,NAVTZ)):null,d=new Date(t),g=(a,b)=>w?w['getUTC'+a]():d['get'+(b||a)]();
 return WD[g('Day')]+' '+g('Date')+' '+MON[g('Month')]+' '+g('FullYear')+(u.ms<DAYMS?' · '+z2(g('Hours'))+':'+z2(g('Minutes'))+' '+zAbbr(t):'')}
const rulerPlugin={id:'ruler',afterDraw(c){const{ctx,chartArea:A,scales:{x}}=c,U=rulerUnits(A.right-A.left),y0=A.bottom+2,X=t=>x.getPixelForValue(pos(t));
 ctx.save();ctx.strokeStyle=css('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(A.left,y0+.5);ctx.lineTo(A.right,y0+.5);ctx.stroke();
 ctx.strokeStyle=css('--muted');ctx.beginPath();let last=-1e9;
 rulerTimes(U.minor).forEach(d=>{const px=X(d.getTime());if(px-last<4)return;last=px;ctx.moveTo(Math.round(px)+.5,y0);ctx.lineTo(Math.round(px)+.5,y0+4)});ctx.stroke();
 ctx.strokeStyle=css('--ink2');ctx.fillStyle=css('--ink2');ctx.font='10px system-ui';ctx.textAlign='center';ctx.beginPath();let lend=-1e9;
 rulerTimes(U.major).forEach(d=>{const px=X(d.getTime());ctx.moveTo(Math.round(px)+.5,y0);ctx.lineTo(Math.round(px)+.5,y0+8);
  const t=U.major.lb(d),w=ctx.measureText(t).width;if(px-w/2>lend+6&&px+w/2<=A.right+6){ctx.fillText(t,px,y0+18);lend=px+w/2}});ctx.stroke();
 if(hoverX!=null){const px=x.getPixelForValue(hoverX);ctx.setLineDash([3,3]);ctx.strokeStyle=css('--ink2');ctx.beginPath();ctx.moveTo(px,A.top);ctx.lineTo(px,y0+6);ctx.stroke();ctx.setLineDash([]);
  ctx.font='600 11px system-ui';const t=cursorText(unpos(hoverX),U.minor),w=ctx.measureText(t).width+12,bx=Math.max(A.left-YW+2,Math.min(px-w/2,A.right-w));
  ctx.fillStyle=css('--ink');ctx.beginPath();ctx.roundRect(bx,y0+5,w,17,8);ctx.fill();ctx.fillStyle=css('--bg');ctx.fillText(t,bx+w/2,y0+17)}
 ctx.restore()}};
function renderMomentTrack(){const cv=$('mtrackc');if(!cv)return;momentControls();const TK=ticks();
 if(charts.has('mtrack')){charts.get('mtrack').destroy();charts.delete('mtrack')}   // also redrawn alone (Concern range)
 /* row 1: plain keyframes; row 2 (under it): rated keyframes, the same marks as the Concern graph (its colours, and its 1–10 range) */
 const R=mRows(),two=(E.moments||[]).some(isRated),inW=m=>m.date&&(m.end?dms(m.end):momentT(m))>=W.a&&momentT(m)<=W.b;
 const shown=(E.moments||[]).filter(m=>momentOn(m)&&inW(m)&&(!isRated(m)||typeof msIn!=='function'||msIn(m)));   // a row that is off stays, greyed out
 cv.parentNode.style.height=Math.round((two?100:64)*(heights.__kf||100)/100)+'px';   // × the panel's size (− / + on its bar)
 const rowV=m=>two?(isRated(m)?-.5:.5):0,colOf=m=>!rowOn(m)?css('--muted'):isRated(m)?msCol(m.concern):MCOL[m.color]||MCOL.red,shp=m=>isRated(m)?'circle':mShape(m),
  rad=m=>isRated(m)?3+m.concern/2.5:mShape(m)==='star'?10:8;
 const band=(y,m)=>{const v=rowV(m);return two?[y.getPixelForValue(v+.5),y.getPixelForValue(v-.5)]:[y.getPixelForValue(1),y.getPixelForValue(-1)]};
 const titles={id:'mtitles',beforeDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();
   const last={};ctx.font='10px system-ui';
   if(two){ctx.fillStyle=css('--muted');ctx.textAlign='right';ctx.fillText('keyframes',A.left-6,y.getPixelForValue(.5)+3);ctx.fillText('concern',A.left-6,y.getPixelForValue(-.5)+3);ctx.textAlign='left';
    ctx.strokeStyle=css('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(A.left,Math.round(y.getPixelForValue(0))+.5);ctx.lineTo(A.right,Math.round(y.getPixelForValue(0))+.5);ctx.stroke()}
   shown.forEach(m=>{const t=momentT(m),te=m.end?dms(m.end):null,colr=colOf(m),px=x.getPixelForValue(pos(Math.max(t,W.a))),[T,B]=band(y,m),cy=y.getPixelForValue(rowV(m)),rk=isRated(m)?'c':'k';
    if(last[rk]==null)last[rk]=A.left;if(!rowOn(m))return;   // greyed row: just the faint marks (drawn below)
    if(te&&te>t){const p2=x.getPixelForValue(pos(Math.min(te,W.b)));ctx.globalAlpha=.16;ctx.fillStyle=colr;ctx.fillRect(px,T,Math.max(2,p2-px),B-T);
     ctx.globalAlpha=.7;ctx.fillRect(px,B-4,Math.max(2,p2-px),4);ctx.globalAlpha=1}
    if(t>=W.a){ctx.strokeStyle=colr;ctx.globalAlpha=.6;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px,T);ctx.lineTo(px,B);ctx.stroke();ctx.globalAlpha=1}
    /* title label: a tinted pill to the right of the shape, with the number of linked readings (rated: the rating first) */
    ctx.font='600 11px system-ui';const n=(m.links||[]).length,txt0=(isRated(m)?m.concern+' · ':'')+(m.title.length>36?m.title.slice(0,35)+'…':m.title),txt=txt0+(n?'  ·  '+n+' reading'+(n>1?'s':''):''),w=ctx.measureText(txt).width+12;
    const lx=px+12;if(lx>last[rk]&&lx+w<A.right){ctx.globalAlpha=.2;ctx.fillStyle=colr;ctx.beginPath();ctx.roundRect(lx,cy-9,w,18,9);ctx.fill();ctx.globalAlpha=1;
     ctx.fillStyle=colr;ctx.fillText(txt,lx+6,cy+4);last[rk]=lx+w+6}});
   ctx.restore()},
  afterDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();
   shown.forEach(m=>{const px=x.getPixelForValue(pos(Math.max(momentT(m),W.a))),sh=shp(m),cy=y.getPixelForValue(rowV(m));
    if(m.id===momCur&&rowOn(m)){ctx.beginPath();ctx.arc(px,cy,13,0,7);ctx.lineWidth=2;ctx.strokeStyle=colOf(m);ctx.stroke()}
    ctx.globalAlpha=rowOn(m)?1:.35;drawShape(ctx,sh,px,cy,rad(m));ctx.fillStyle=colOf(m);ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=css('--card');ctx.stroke();ctx.globalAlpha=1});ctx.font='10px system-ui';
   if(!shown.length){ctx.fillStyle=css('--muted');ctx.fillText((E.moments||[]).length?'no shown keyframes in this window':'click here or “+ Keyframe” to add one; or click a reading on a chart and choose ★ Make keyframe',A.left+4,A.top+12)}
   ctx.restore()}};
 charts.set('mtrack',new Chart(cv,{type:'scatter',plugins:[titles,rulerPlugin],data:{datasets:[{data:shown.map(m=>({x:pos(Math.max(momentT(m),W.a)),y:rowV(m),m})),
   pointStyle:shown.map(shp),pointRadius:shown.map(rad),pointHoverRadius:shown.map(m=>rad(m)+2),
   pointBackgroundColor:'transparent',pointBorderColor:'transparent',clip:false}]},   // the shapes are drawn filled by the titles plugin (Chart.js draws stars as outlines only)
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,layout:{autoPadding:false,padding:{top:3,right:8,bottom:RULERH}},
   onHover:(e,els,c)=>{const xv=c.scales.x.getValueForPixel(e.x);setHover(xv>=0&&xv<=100?xv:null)},
   onClick:(e,els,c)=>{if(e.y>c.chartArea.bottom)return;const xv=c.scales.x.getValueForPixel(e.x);setTimeout(()=>{if(els[0])openMoment(c.data.datasets[0].data[els[0].index].m);else if(xv>=0&&xv<=100)openMoment(null,{date:localStamp(unpos(xv)).slice(0,10)})},0)},
   plugins:{legend:{display:false},tooltip:{enabled:false,external:({chart,tooltip})=>{const el=$('mtip');if(!tooltip.opacity||!tooltip.dataPoints||!tooltip.dataPoints.length){el.classList.add('hide');return}
     const m=tooltip.dataPoints[0].raw.m;el.innerHTML='';const b=document.createElement('b');b.textContent=(isRated(m)?m.concern+' · ':'')+m.title;if(isRated(m))b.style.color=msCol(m.concern);el.appendChild(b);
     [m.date+(m.time?' '+m.time:'')+(m.end?' → '+m.end:'')+(m.group?' · '+m.group:''),m.note?m.note.slice(0,140):'',isRated(m)&&m.why?'Why '+m.concern+': '+m.why:'',(m.links||[]).length?(m.links.length+' linked reading'+(m.links.length>1?'s':'')):'','click to edit']
      .filter(Boolean).forEach(t=>{const d=document.createElement('div');d.textContent=t;el.appendChild(d)});
     const r=chart.canvas.getBoundingClientRect();el.style.left=Math.min(r.left+tooltip.caretX+12,innerWidth-270)+'px';el.style.top=(r.top+tooltip.caretY+16)+'px';el.classList.remove('hide')}}},
   scales:{x:{type:'linear',min:0,max:100,afterFit:tEdge,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},ticks:{display:false},grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}},border:{display:false}},
    y:{min:-1,max:1,afterFit:s=>{s.width=YW},ticks:{display:false},grid:{display:false},border:{display:false}}}}}));
 cv.parentNode.onmouseleave=()=>setHover(null)}

/* sidebar: Moments section (groups you name; tick to show; click a name to jump there) */
/* Presets (2026-11-16): one Library section with sub-sections Timeline (saved time windows) and Keyframes (the
   user's own dated notes, formerly "Moments"). Panel presets sit between them and Macros (one click sets all three) come last. Data keys are unchanged
   (E.ranges, E.moments) so saved edits keep working. */
function momentSection(el,q){migratePresets();const P=section(el,'presets','Presets',((E.ranges||[]).length+(E.panels||[]).length+(E.moments||[]).length+(E.macros||[]).length)||'none yet',true,'sec',q);
 rangeGroup(P,q);keyframeGroup(P,q);macroGroup(P,q)}
function keyframeGroup(P,q){const all=(E.moments||[]).filter(m=>!q||(m.title+' '+(m.group||'')+' '+(m.note||'')).toLowerCase().includes(q)||'keyframes moments presets'.includes(q));
 const k0=all.filter(momentOn).length;const S=section(P,'moments','Keyframes',(E.moments||[]).length?k0+'/'+all.length:'none yet',true,'grp',q),ss=S.firstChild,ids=all.map(m=>m.id);
 {const ma=miniBtn('+ Add','Add a keyframe',()=>openMoment(null));ma.classList.add('madd');ss.insertBefore(ma,ss.lastChild)}
 if(all.length){ss.insertBefore(miniBtn('All','Show every keyframe',()=>setMomentsOn(ids,true)),ss.lastChild);ss.insertBefore(miniBtn('None','Hide every keyframe',()=>setMomentsOn(ids,false)),ss.lastChild)}
 const groups={};all.forEach(m=>(groups[m.group||'Ungrouped']=groups[m.group||'Ungrouped']||[]).push(m));
 Object.keys(groups).sort((a,b)=>a==='Ungrouped'?1:b==='Ungrouped'?-1:a.localeCompare(b)).forEach(g=>{const ms_=groups[g].sort((a,b)=>(momentT(a)??9e15)-(momentT(b)??9e15)),gid=ms_.map(m=>m.id),k=ms_.filter(momentOn).length;
  const G=section(S,'mom:'+g,g,k+'/'+ms_.length,true,'grp',q),gs=G.firstChild;
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=k===ms_.length;cb.indeterminate=k>0&&k<ms_.length;cb.title='Show or hide the whole group';
  cb.onclick=e=>{e.stopPropagation();setMomentsOn(gid,cb.checked)};gs.insertBefore(cb,gs.firstChild);
  gs.insertBefore(miniBtn('All','Show all keyframes in '+g,()=>setMomentsOn(gid,true)),gs.lastChild);gs.insertBefore(miniBtn('None','Hide all keyframes in '+g,()=>setMomentsOn(gid,false)),gs.lastChild);
  gs.insertBefore(miniBtn('Only','Show only this group',()=>{(E.moments||[]).forEach(m=>m.on=gid.includes(m.id));saveEdits();list();render()}),gs.lastChild);
  ms_.forEach(m=>{const row=document.createElement('div');row.className='t';
   const c=document.createElement('input');c.type='checkbox';c.checked=momentOn(m);c.setAttribute('aria-label','Show '+m.title);c.onclick=e=>{e.stopPropagation();setMomentsOn([m.id],c.checked)};
   const dot=shapeSvg(mShape(m),MCOL[m.color]||MCOL.red,11);dot.title=(MKIND[m.kind]||MKIND.event).label;
   const nm=document.createElement('span');nm.className='nm';nm.textContent=m.title;nm.title='Click to jump to this keyframe'+(m.note?' — '+m.note:'');
   const ln=document.createElement('span');ln.className='tag';ln.textContent=(m.links||[]).length?'🔗'+m.links.length:'';
   const d=document.createElement('span');d.className='n';d.textContent=m.date?m.date.slice(2)+(m.time?' '+m.time:''):'no date';
   row.append(c,dot,nm,ln,d);row.onclick=()=>jumpMoment(m);G.appendChild(row)})})}
/* ---- Presets: Timeline (E.ranges: {id,name,a,b}) and Panel presets (E.panels: {id,name,v}) ----
   A Timeline preset is a saved time window (In = a, Out = b, Middle = their mean). A Panel preset is a snapshot of
   what the Library shows (lab/MRD/imaging charts, medications, dose charts, Treatment panel, chart heights and
   order); it has no time window and no keyframe visibility, so it works with any Timeline preset. Both are shared
   like the other edits. The bar under the Navigator (#layBar) shows the active one of each, with ↺ Reset (go back
   to the saved preset) and Update (overwrite it with what is on screen now).
   Before 2026-11-16 a "layout" belonged to a saved range (E.ranges[].layouts[] = {id,name,v}, v incl. which
   moments were shown). migratePresets() turns each into a Panel preset with the same id and name, plus a Macro
   (E.macros: {id,name,tl,panel,mon}) that remembers the range and the keyframes, for step 3. */
function migratePresets(){let n=0;(E.ranges||[]).forEach(r=>{(r.layouts||[]).forEach(l=>{const v=Object.assign({},l.v);const mon=v.mon;delete v.mon;
   if(!(E.panels||[]).some(x=>x.id===l.id))E.panels=(E.panels||[]).concat([{id:l.id,name:l.name,v}]);
   if(!(E.macros||[]).some(x=>x.panel===l.id&&x.tl===r.id))E.macros=(E.macros||[]).concat([{id:'m'+l.id,name:l.name,tl:r.id,panel:l.id,mon:mon||null}]);n++});
  if(r.layouts)delete r.layouts});
 if(n&&canEdit())setTimeout(saveEdits,0);return n}
/* in-page questions: browser pop-ups (confirm/prompt) are cancelled at once in some embedded browsers (seen in the
   Claude app's browser pane 2026-11-16), which made every Presets × and + Save do nothing. uiAsk(msg) → true/false;
   uiAsk(msg, default, okLabel) → the typed text or null. Enter = OK, Esc = Cancel. */
function uiAsk(msg,def,okLabel,noCancel){return new Promise(res=>{const old=$('pdlg');if(old)old.remove();
 const P=document.createElement('div');P.id='pdlg';P.className='calpop pdlg';const m=document.createElement('div');m.className='pdmsg';m.textContent=msg;P.appendChild(m);
 let inp=null;if(def!==undefined){inp=document.createElement('input');inp.type='text';inp.value=def;P.appendChild(inp)}
 const bar=document.createElement('div');bar.className='bar';
 const done=v=>{P.remove();document.removeEventListener('keydown',kd,true);res(v)};
 const ok=btn(okLabel||(inp?'Save':'Delete'),()=>done(inp?inp.value:true),'on'),no=btn('Cancel',()=>done(inp?null:false),'');bar.append(ok);if(!noCancel)bar.append(no);P.appendChild(bar);
 const kd=e=>{if(e.key==='Escape'){e.stopPropagation();done(inp?null:false)}else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();ok.click()}};
 document.addEventListener('keydown',kd,true);document.body.appendChild(P);(inp||ok).focus();if(inp)inp.select()})}
const uiNote=msg=>uiAsk(msg,undefined,'OK',true);
let activeR=store.get('activepreset',null)||(o=>o?{t:o.rid,p:o.lid}:{t:null,p:null})(store.get('activerange',null));
function setActive(t,p,m){activeR={t:t===undefined?activeR.t:t,p:p===undefined?activeR.p:p,m:m===undefined?activeR.m:m};store.set('activepreset',activeR)}
const actM=()=>activeR.m&&(E.macros||[]).find(x=>x.id===activeR.m),actT=()=>activeR.t&&(E.ranges||[]).find(x=>x.id===activeR.t),actP=()=>activeR.p&&(E.panels||[]).find(x=>x.id===activeR.p);
const winLen=len=>len>=60?Math.round(len/30.44)+' mo':len>=2?Math.round(len)+' d':Math.round(len*24)+' h';
function useTimeline(r){setActive(r.id);setWin(r.a,r.b);list()}
async function saveRange(){if(!canEdit())return;const dl=t=>localStamp(t).slice(0,10);
 const name=await uiAsk('Name for this Timeline preset:',dl(W.a)+' to '+dl(W.b));if(name==null||!name.trim())return;
 const r={id:'r'+Date.now().toString(36),name:name.trim(),a:Math.round(W.a),b:Math.round(W.b)};
 E.ranges=(E.ranges||[]).concat([r]);setActive(r.id);saveEdits();list()}
function delBtn(title,fn){const x=document.createElement('button');x.type='button';x.className='mini redit';x.textContent='×';x.title=title;x.onclick=e=>{e.stopPropagation();fn()};return x}
function rangeGroup(S,q){migratePresets();queueLay();const rs=(E.ranges||[]).filter(r=>!q||r.name.toLowerCase().includes(q)||'timeline presets saved ranges'.includes(q)).sort((x,y)=>x.a-y.a);
 const G=section(S,'presets:timeline','Timeline',rs.length||'none yet',true,'grp',q),gs=G.firstChild;
 {const b=miniBtn('+ Save','Save the time window shown now (In, Out and Middle) as a Timeline preset',saveRange);b.classList.add('redit');gs.insertBefore(b,gs.lastChild)}
 rs.forEach(r=>{const row=document.createElement('div');row.className='t';const len=(r.b-r.a)/DAYMS;
  const nm=document.createElement('span');nm.className='nm';nm.textContent='⟷ '+r.name;const st=t=>localStamp(t).slice(0,len<2?16:10);nm.title='Click to show this time window\nIn: '+st(r.a)+'\nOut: '+st(r.b)+'\nMiddle: '+st((r.a+r.b)/2);
  const d=document.createElement('span');d.className='n';d.textContent=localStamp(r.a).slice(2,10)+(len<2?' '+localStamp(r.a).slice(11):'')+' · '+winLen(len);
  const x=delBtn('Delete this Timeline preset',async()=>{if(!await uiAsk('Delete the Timeline preset "'+r.name+'"?'+((E.macros||[]).some(m=>m.tl===r.id)?'\n'+(E.macros||[]).filter(m=>m.tl===r.id).length+' macro(s) use it and will keep only their panels and keyframes.':'')))return;
   E.ranges=E.ranges.filter(y=>y.id!==r.id);if(activeR.t===r.id)setActive(null);saveEdits();list()});
  if(activeR.t===r.id)row.classList.add('ract');
  row.append(nm,d,x);row.onclick=()=>useTimeline(r);G.appendChild(row)});
 panelGroup(S,q)}
function panelGroup(S,q){const ps=(E.panels||[]).filter(l=>!q||l.name.toLowerCase().includes(q)||'panel presets layouts'.includes(q)).sort((x,y)=>x.name.localeCompare(y.name));
 const G=section(S,'presets:panels','Panel presets',ps.length||'none yet',true,'grp',q),gs=G.firstChild;
 {const b=miniBtn('+ Save','Save what the Library shows now (charts, medications, sizes and order) as a Panel preset',savePanel);b.classList.add('redit');gs.insertBefore(b,gs.lastChild)}
 ps.forEach(l=>{const row=document.createElement('div');row.className='t'+(activeR.p===l.id?' ract':'');
  const nm=document.createElement('span');nm.className='nm';nm.textContent='▦ '+l.name;nm.title='Click to show these panels ('+layDesc(l.v)+')';
  const d=document.createElement('span');d.className='n';d.textContent=(l.v.mode==='compare'?(l.v.sel||[]).length:1)+' ch · '+(l.v.txHidden?0:(l.v.txSel||[]).length)+' med';
  const x=delBtn('Delete this Panel preset',async()=>{const used=(E.macros||[]).filter(m=>m.panel===l.id).length;
   if(!await uiAsk('Delete the Panel preset "'+l.name+'"?'+(used?'\n'+used+' macro(s) use it and will keep only their timeline and keyframes.':'')))return;
   E.panels=E.panels.filter(y=>y.id!==l.id);if(activeR.p===l.id)setActive(undefined,null);saveEdits();list()});
  row.append(nm,d,x);row.onclick=()=>usePanel(l);G.appendChild(row)})}
const modSettings=()=>typeof MRD!=='undefined'&&MRD.getSettings?JSON.parse(JSON.stringify(MRD.getSettings())):null;   // MRD + Brain MRI display settings
function viewNow(){const v={mode,cur,sel:sel.slice(),txPos,txSel:txSel.slice(),txDose:txDose.slice(),txHidden,hlOn,hlH,heights:Object.assign({},heights),txOrder:txOrder.slice()};if(kfPos!=null)v.kfPos=kfPos;
 const ms=modSettings();if(ms)v.mods=ms;return v}
const canon=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,k)=>(o[k]=x[k],o),{}):x);
function panelChanged(l){const v=viewNow(),ref=l.v;if(!ref.txOrder)delete v.txOrder;if(!ref.mods)delete v.mods;/* presets saved before these existed */return canon(v)!==canon(Object.assign({},ref,{mon:undefined}))}
function layDesc(v){return (v.mode==='compare'?(v.sel||[]).length+' chart(s)':'one test')+', '+(v.txHidden?'Treatment panel hidden':(v.txSel||[]).length+' medication(s)')+((v.txDose||[]).length?', '+v.txDose.length+' dose chart(s)':'')}
const panelId=id=>BYID[id]||(typeof MRD!=='undefined'&&MRD.isId?MRD.isId(id):D.mrd&&/^mrd:(ot|var)$/.test(id));
function applyView(v){mode=v.mode==='compare'?'compare':'single';if(BYID[v.cur])cur=v.cur;sel=(v.sel||[]).filter(panelId);txPos=v.txPos||0;kfPos=v.kfPos??null;
 txSel=(v.txSel||[]).slice();txDose=(v.txDose||[]).slice();txHidden=!!v.txHidden;hlOn=v.hlOn!==false;hlH=v.hlH||28;heights=Object.assign({},v.heights||{});soloLab=null;soloMed=null;
 if(v.txOrder)txOrder=v.txOrder.slice();
 if(v.mods&&typeof MRD!=='undefined'&&MRD.setSettings)MRD.setSettings(v.mods);
 [['txorder',txOrder],['mode',mode],['current',cur],['selected',sel],['txpos',txPos],['kfpos',kfPos],['txsel',txSel],['txdose',txDose],['txhidden',txHidden],['hlon',hlOn],['hlh',hlH],['heights',heights],['sololab',null],['solomed',null]].forEach(([k,x])=>store.set(k,x))}
function usePanel(l){setActive(undefined,l.id);applyView(l.v);updateBar();list();render()}
async function savePanel(){if(!canEdit())return;const name=await uiAsk('Name for this Panel preset:','Panels '+((E.panels||[]).length+1));if(name==null||!name.trim())return;
 const l={id:'l'+Date.now().toString(36),name:name.trim(),v:viewNow()};E.panels=(E.panels||[]).concat([l]);setActive(undefined,l.id);saveEdits();list();layBar()}
/* ---- Macros (E.macros: {id,name,tl,panel,mon}): one click sets a Timeline preset (tl = its id), a Panel preset
   (panel = its id) and which keyframes are shown (mon = {keyframe id: shown}). Timeline and panels are linked by id,
   so editing those presets changes every macro that uses them; any layer may be empty (null) and is then left alone.
   Keyframes added after the macro was saved are not in mon and keep their current visibility. */
const kfNow=()=>Object.fromEntries((E.moments||[]).map(m=>[m.id,momentOn(m)]));
function kfDiffers(mon){return !!mon&&(E.moments||[]).some(m=>m.id in mon&&momentOn(m)!==!!mon[m.id])}
function applyKf(mon){if(!mon)return;let ch=false;(E.moments||[]).forEach(m=>{if(m.id in mon&&momentOn(m)!==!!mon[m.id]){m.on=!!mon[m.id];ch=true}});
 if(ch&&canEdit())saveEdits()}   // keyframe visibility is shared: saved only while Editing (View only changes this screen)
function useMacro(M){const r=M.tl&&(E.ranges||[]).find(x=>x.id===M.tl),l=M.panel&&(E.panels||[]).find(x=>x.id===M.panel);
 setActive(r?r.id:activeR.t,l?l.id:activeR.p,M.id);if(l)applyView(l.v);applyKf(M.mon);if(r){W={a:r.a,b:r.b};store.set('window',W);syncWin()}
 updateBar();list();render()}
function macroChanged(M){return (M.tl||null)!==(activeR.t||null)||(M.panel||null)!==(activeR.p||null)||kfDiffers(M.mon)||(!!actP()&&panelChanged(actP()))||(!!actT()&&(Math.round(W.a)!==actT().a||Math.round(W.b)!==actT().b))}
async function saveMacro(){if(!canEdit())return;const r=actT(),l=actP();
 const name=await uiAsk('Name for this Macro.\nIt will set: '+(r?'Timeline "'+r.name+'"':'no timeline')+', '+(l?'Panels "'+l.name+'"':'no panels')+', and the keyframes shown now.\n(Pick a Timeline and a Panel preset first to include them.)',[r&&r.name,l&&l.name].filter(Boolean).join(' + ')||'Macro '+((E.macros||[]).length+1));
 if(name==null||!name.trim())return;const M={id:'m'+Date.now().toString(36),name:name.trim(),tl:r?r.id:null,panel:l?l.id:null,mon:kfNow()};
 E.macros=(E.macros||[]).concat([M]);setActive(undefined,undefined,M.id);saveEdits();list();layBar()}
function updateMacro(M){if(!canEdit())return;M.tl=activeR.t||null;M.panel=activeR.p||null;M.mon=kfNow();saveEdits();list();layBar()}
function macroGroup(S,q){const nm_=M=>[M.name,((E.ranges||[]).find(x=>x.id===M.tl)||{}).name,((E.panels||[]).find(x=>x.id===M.panel)||{}).name].join(' ').toLowerCase();
 const ms=(E.macros||[]).filter(M=>!q||nm_(M).includes(q)||'macros presets'.includes(q));   // kept in your own order (↑ ↓ while Editing); keys 1-9 apply the first nine
 const G=section(S,'presets:macros','Macros',ms.length||'none yet',true,'grp',q),gs=G.firstChild;
 {const b=miniBtn('+ Save','Save the active Timeline preset, the active Panel preset and the keyframes shown now as a Macro',saveMacro);b.classList.add('redit');gs.insertBefore(b,gs.lastChild)}
 ms.forEach(M=>{const r=M.tl&&(E.ranges||[]).find(x=>x.id===M.tl),l=M.panel&&(E.panels||[]).find(x=>x.id===M.panel);
  const row=document.createElement('div');row.className='t'+(activeR.m===M.id?' ract':'');
  const nm=document.createElement('span');nm.className='nm';nm.textContent='◆ '+M.name;nm.title='Click to set the timeline, panels and keyframes of this macro';
  const nk=M.mon?Object.keys(M.mon).filter(id=>M.mon[id]&&(E.moments||[]).some(m=>m.id===id)).length:null;
  const i=E.macros.indexOf(M),d=document.createElement('span');d.className='n';d.textContent=(i<9?'key '+(i+1)+' · ':'')+[r&&'⟷',l&&'▦',M.mon&&'★'].filter(Boolean).join(' ');
  const mv=(k,lbl,tip)=>{const b=document.createElement('button');b.type='button';b.className='mini redit';b.textContent=lbl;b.title=tip;b.disabled=i+k<0||i+k>=E.macros.length;
   b.onclick=e=>{e.stopPropagation();const A=E.macros;[A[i],A[i+k]]=[A[i+k],A[i]];saveEdits();list()};return b};
  const x=delBtn('Delete this Macro (its presets stay)',async()=>{if(!await uiAsk('Delete the Macro "'+M.name+'"?\nIts Timeline and Panel presets stay.'))return;
   E.macros=E.macros.filter(y=>y.id!==M.id);if(activeR.m===M.id)setActive(undefined,undefined,null);saveEdits();list()});
  row.append(nm,d,mv(-1,'↑','Move up (also changes its number key)'),mv(1,'↓','Move down (also changes its number key)'),x);row.onclick=()=>useMacro(M);G.appendChild(row);
  /* its layers: click one to apply only that layer */
  const layer=(icon,txt,tip,fn,missing)=>{const lr=document.createElement('div');lr.className='t layrow';const s_=document.createElement('span');s_.className='nm';
   s_.textContent=icon+' '+txt;s_.title=tip;if(missing)s_.style.opacity=.5;lr.appendChild(s_);if(fn)lr.onclick=e=>{e.stopPropagation();fn()};G.appendChild(lr)};
  layer('⟷',r?r.name:M.tl?'(deleted timeline)':'no timeline',r?'Timeline layer: click to apply only this time window':'This macro leaves the time window alone',r?()=>useTimeline(r):null,!r);
  layer('▦',l?l.name:M.panel?'(deleted panels)':'no panels',l?'Panel layer: click to apply only these panels':'This macro leaves the panels alone',l?()=>usePanel(l):null,!l);
  layer('★',M.mon?nk+' keyframe'+(nk===1?'':'s')+' shown':'keyframes left alone',M.mon?'Keyframe layer: click to show only these keyframes':'This macro leaves the keyframes alone',M.mon?()=>{applyKf(M.mon);list();render()}:null,!M.mon)})}
/* keys 1-9 apply the first nine macros (not while typing, and not with Ctrl/Alt/Cmd) */
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.altKey||e.metaKey||!/^[1-9]$/.test(e.key))return;
 const t=e.target;if(t&&t.closest&&(t.closest('input,textarea,select,[contenteditable],canvas')||t.isContentEditable))return;
 const M=(E.macros||[])[+e.key-1];if(M){e.preventDefault();useMacro(M)}});
let layT=0;const queueLay=()=>{clearTimeout(layT);layT=setTimeout(layBar,60)};
function layBar(){const bar=$('layBar'),r=actT(),L=actP(),M=actM();bar.innerHTML='';bar.classList.toggle('hide',!r&&!L&&!M);if(!r&&!L&&!M)return;
 const lab=(icon,txt,tip)=>{const t=document.createElement('span');t.className='wl';t.textContent=icon+' '+txt;t.title=tip;return t};
 if(M){const changed=macroChanged(M);const nb=document.createElement('b');nb.textContent=M.name;nb.title=changed?'Changed since this macro was applied or saved':'Active Macro';
  bar.append(lab('◆','Macro:','Active Macro (Presets → Macros)'),nb);
  if(changed){const b=btn('↺',()=>useMacro(M),'');b.title='Apply "'+M.name+'" again (undo the changes since)';bar.appendChild(b);
   const u=btn('Update',()=>updateMacro(M),'redit');u.title='Make "'+M.name+'" use the active Timeline and Panel presets and the keyframes shown now';bar.appendChild(u)}
  const x=btn('×',()=>{setActive(undefined,undefined,null);layBar();list()},'');x.title='Leave this Macro (the view stays as it is)';bar.appendChild(x);
  const sep=document.createElement('span');sep.className='wl';sep.textContent='|';bar.appendChild(sep)}
 if(r){const moved=Math.round(W.a)!==r.a||Math.round(W.b)!==r.b;const nb=document.createElement('b');nb.textContent=r.name;
  bar.append(lab('⟷','Timeline:','Active Timeline preset (Presets → Timeline)'),nb);
  if(moved){const b=btn('↺',()=>setWin(r.a,r.b),'');b.title='Go back to the saved time window of "'+r.name+'"';bar.appendChild(b);
   const u=btn('Update',()=>{if(!canEdit())return;r.a=Math.round(W.a);r.b=Math.round(W.b);saveEdits();list();layBar()},'redit');u.title='Save the time window shown now as "'+r.name+'"';bar.appendChild(u)}
  const x=btn('×',()=>{setActive(null);layBar();list()},'');x.title='Leave this Timeline preset (the window stays as it is)';bar.appendChild(x)}
 if(L){const changed=panelChanged(L);const nb=document.createElement('b');nb.textContent=L.name;nb.title=layDesc(L.v)+(changed?' — changed since it was saved':'');
  const sep=document.createElement('span');sep.className='wl';sep.textContent=r?'·':'';bar.append(sep,lab('▦','Panels:','Active Panel preset (Presets → Panel presets)'),nb);
  if(changed){const b=btn('↺',()=>usePanel(L),'');b.title='Go back to the saved panels of "'+L.name+'"';bar.appendChild(b);
   const u=btn('Update',()=>{if(!canEdit())return;L.v=viewNow();saveEdits();list();layBar()},'redit');u.title='Save the panels shown now as "'+L.name+'"';bar.appendChild(u)}
  const x=btn('×',()=>{setActive(undefined,null);layBar();list()},'');x.title='Leave this Panel preset (the panels stay as they are)';bar.appendChild(x)}
 const sp=document.createElement('span');sp.style.marginLeft='auto';bar.appendChild(sp);
 {const b=btn('＋ Panel preset',savePanel,'redit');b.title='Save the panels shown now as a new Panel preset';bar.appendChild(b)}
 {const b=btn('＋ Macro',saveMacro,'redit');b.title='Save the active Timeline and Panel presets and the keyframes shown now as a Macro';bar.appendChild(b)}}

/* hovering a lab/vital reading: a small box with the reading and "★ Make keyframe" (or "★ Link to …" while a moment
   is open). Clicking a reading pins the box so the mouse can move onto the button; ×, Esc or clicking elsewhere closes it. */
let popTimer=0,popPinned=false;
function hidePop(){popPinned=false;$('ptpop').classList.add('hide')}
function pointPop(e,els,c,test,pv,tm,pin){const pop=$('ptpop');clearTimeout(popTimer);
 if(pickMode&&editingMoment){if(pin&&els.length&&pv[els[0].index]){const x=pv[els[0].index];   // picking: a click links / unlinks the reading
   toggleLink({test:test.id,name:labLabel(test),t:tm(x),text:valText(x)+(test.unit?' '+test.unit:''),src:x.src})}return}
 if(popPinned&&!pin)return;                       // a pinned box ignores hovering
 if(!els.length||!pv[els[0].index]){if(pin){hidePop();return}popTimer=setTimeout(()=>{if(!pop.matches(':hover'))pop.classList.add('hide')},350);return}
 const x=pv[els[0].index],t=tm(x),link={test:test.id,name:labLabel(test),t,text:valText(x)+(test.unit?' '+test.unit:''),src:x.src};
 pop.innerHTML='';const h=document.createElement('div');h.textContent=(x.ts!=null?hStamp(t):x.date)+' · '+link.name;const v=document.createElement('div');v.innerHTML='<b></b>';v.firstChild.textContent=link.text+' · '+x.src;
 const b=document.createElement('button');b.type='button';b.textContent=editingMoment?'★ Link to “'+(editingMoment.title||'this moment').slice(0,24)+'”':'★ Make keyframe';
 b.onclick=()=>{hidePop();if(editingMoment){editingMoment.links=editingMoment.links||[];if(!editingMoment.links.some(l=>l.test===link.test&&l.t===link.t))editingMoment.links.push(link);drawLinks();charts.forEach(c=>c.draw())}
  else openMoment(null,{date:localStamp(t).slice(0,10),time:x.ts!=null?localStamp(t).slice(11):'',links:[link]})};
 pop.append(h,v,b);
 if(pin){popPinned=true;pop.classList.add('pinned');const x_=document.createElement('button');x_.type='button';x_.className='pclose';x_.textContent='×';x_.title='Close (Esc)';x_.onclick=hidePop;
  const n=document.createElement('div');n.className='pnote';n.textContent='pinned · × or Esc to close';pop.append(x_,n)}else pop.classList.remove('pinned');
 pop.classList.remove('hide');const ev=e.native||e;pop.style.left=Math.min(ev.clientX+14,innerWidth-270)+'px';pop.style.top=Math.max(4,ev.clientY-70)+'px'}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&popPinned)hidePop()});
/* the box is fixed to the screen: when the page scrolls, a pinned box moves with its reading and a hover box goes away */
let popScrollY=scrollY;
document.addEventListener('scroll',()=>{const pop=$('ptpop'),dy=scrollY-popScrollY;popScrollY=scrollY;if(pop.classList.contains('hide'))return;
 if(!popPinned){pop.classList.add('hide');return}const top=parseFloat(pop.style.top)-dy;if(top<0||top>innerHeight)hidePop();else pop.style.top=top+'px'},{passive:true});
document.addEventListener('mousedown',e=>{if(popPinned&&!e.target.closest('#ptpop')&&!e.target.closest('main canvas'))hidePop()});

/* the moment editor: a small floating panel, so it is reachable from anywhere on the page */
/* Pick readings: while on, clicking a reading on any chart adds it to (or removes it from) the moment being edited */
let pickMode=false;
function setPick(on){pickMode=!!on&&!!editingMoment;document.body.classList.toggle('picking',pickMode);const b=$('mPick');
 if(b){b.textContent=pickMode?'◉ Picking: click readings · Done':'◎ Pick readings';b.classList.toggle('on',pickMode)}}
function toggleLink(link){const ls=editingMoment.links=editingMoment.links||[],i=ls.findIndex(l=>l.test===link.test&&l.t===link.t);
 if(i>=0)ls.splice(i,1);else ls.push(link);drawLinks();charts.forEach(c=>c.draw())}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pickMode)setPick(false)});
function drawLinks(){const L=$('mLinks');if(!L||!editingMoment)return;L.innerHTML='';const ls=editingMoment.links||[];
 const n=$('mLinkN');if(n)n.textContent='Linked readings ('+ls.length+'):';
 if(!ls.length){L.innerHTML='<span class="sub">none yet — press “◎ Pick readings” and click readings on any chart, or hover a reading and click “★ Link”</span>';return}
 ls.forEach((l,i)=>{const c=document.createElement('span');c.className='chip';const s=document.createElement('span');s.textContent=l.name+': '+l.text+' · '+localStamp(l.t).slice(2);
  const go=btn('↗',()=>{let len=W.b-W.a;if(len>60*DAYMS)len=3*DAYMS;shiftWin(l.t-len/2,len)});go.title='Jump to this reading';
  const x=btn('×',()=>{ls.splice(i,1);drawLinks();charts.forEach(c=>c.draw())});x.title='Unlink';c.append(s,go,x);L.appendChild(c)})}
function openMoment(m,pre){const isNew=!m;if(isNew&&!canEdit())return;m=m||Object.assign({id:'mo'+Date.now().toString(36),title:'',group:'',date:'',time:'',end:'',note:'',color:'red',line:true,on:true,links:[]},pre||{});
 if(isNew&&!pre)m.date=localStamp(Math.min(Date.now(),(W.a+W.b)/2)).slice(0,10);
 const draft=Object.assign({},m,{links:[...(m.links||[])]});editingMoment=draft;
 const P=$('mEdit');P.innerHTML='';P.classList.remove('hide');
 const h=document.createElement('div');h.className='txh';const b=document.createElement('b');b.textContent=isNew?'New keyframe':'Keyframe';const sp=document.createElement('span');sp.className='sub';
 sp.textContent='your own note, not from the record · private';h.append(b,sp);P.appendChild(h);
 const groups=[...new Set((E.moments||[]).map(x=>x.group).filter(Boolean))];
 const F={title:inp('text',m.title,{placeholder:'e.g. noticed symptoms'}),group:inp('text',m.group||'',{placeholder:'e.g. Delivery – Oct 2021'}),date:inp('date',m.date||''),time:inp('time',m.time||''),
  end:inp('date',m.end||''),color:selBox(Object.keys(MCOL).map(c=>[c,c]),m.color||'red'),kind:selBox(Object.entries(MKIND).map(([k,v])=>[k,v.label]),m.kind||'event'),line:inp('checkbox',m.line!==false),note:inp('textarea',m.note||'',{rows:2,placeholder:'what happened, who noticed, what was done'}),
  concern:inp('number',typeof m.concern==='number'?m.concern:'',{min:1,max:10,step:0.5,placeholder:'1–10'}),good:inp('checkbox',!!m.good),
  why:inp('textarea',m.why||'',{rows:2,placeholder:'why this rating (shown on the Concern graph)'})};
 F.title.oninput=()=>{draft.title=F.title.value};   // so “★ Link to …” shows the title being typed
 const dl=document.createElement('datalist');dl.id='mgroups';groups.forEach(g=>{const o=document.createElement('option');o.value=g;dl.appendChild(o)});F.group.setAttribute('list','mgroups');
 const g=document.createElement('div');g.className='fgrid';g.append(field('Title',F.title),field('Group',F.group),field('Date (optional)',F.date),field('Time (optional)',F.time),
  field('End date (for a period)',F.end),field('Kind (shape)',F.kind),field('Color',F.color),field('Line across all charts',F.line),
  field('Concern 1–10 (optional)',F.concern),field('Good news',F.good));P.append(g,dl,field('Note',F.note),field('Why this rating',F.why));
 /* record sources (from the milestones import): the text line and the original PDF pages, on the private milestones server */
 if((m.sources||[]).length){const S=document.createElement('div');S.className='sub';S.style.marginTop='6px';S.textContent='Record sources: ';
  const base='http://127.0.0.1:8771/',pv=base+'pdfview.html';
  m.sources.forEach((x,i)=>{const a=document.createElement('a');a.href=base+x.path.split('/').map(encodeURIComponent).join('/');a.target='_blank';a.textContent=x.label;a.title=x.path+(x.line?':'+x.line:'');
   S.append(i?' · ':'',a);(x.pdfs||[]).forEach(p=>{const b=document.createElement('a');b.href=pv+'?key='+encodeURIComponent(p.key)+'&page='+p.page+'&site='+encodeURIComponent(p.site||'');b.target='_blank';b.textContent=' 📄 p. '+p.page;b.title='Original PDF from '+(p.site||p.key)+', page '+p.page;S.append(b)})});
  P.appendChild(S)}
 const lh=document.createElement('div');lh.className='sub mlinkh';lh.style.marginTop='6px';const lt=document.createElement('span');lt.id='mLinkN';lh.appendChild(lt);
 const pk=btn('',()=>setPick(!pickMode),'mpick');pk.id='mPick';pk.title='While on, every reading you click on any chart is added to this keyframe (click it again to remove it)';lh.appendChild(pk);
 const L=document.createElement('div');L.id='mLinks';P.append(lh,L);setPick(false);drawLinks();
 const act=document.createElement('div');act.className='bar';act.style.marginTop='8px';
 const close=()=>{setPick(false);editingMoment=null;P.classList.add('hide');charts.forEach(c=>c.draw())};
 act.append(btn('Save',()=>{const title=F.title.value.trim();if(!title){uiNote('Enter a title.');return}
   if(F.end.value&&F.date.value&&F.end.value<F.date.value){uiNote('End date is before the date.');return}
   const cv=F.concern.value.trim(),cn=cv===''?null:Math.min(10,Math.max(1,Math.round(+cv*2)/2));
   if(cv!==''&&!isFinite(+cv)){uiNote('Concern must be a number from 1 to 10.');return}
   const rec=Object.assign({},m,{title,group:F.group.value.trim(),date:F.date.value,time:F.date.value?F.time.value:'',end:F.date.value?F.end.value:'',note:F.note.value,color:F.color.value,kind:F.kind.value,line:F.line.checked,links:draft.links,on:m.on!==false,why:F.why.value.trim(),good:F.good.checked});
   if(cn==null){delete rec.concern;delete rec.rated_by}else{if(cn!==m.concern)rec.rated_by='family';rec.concern=cn}   // a rating you set or change counts as the family's
   if(!rec.why)delete rec.why;if(!rec.good)delete rec.good;
   E.moments=(E.moments||[]).filter(x=>x.id!==rec.id).concat([rec]);saveEdits();close();list();setTimeout(render,0)},'on'));
 if(!isNew)act.appendChild(btn('Delete',async()=>{if(!await uiAsk('Delete the keyframe "'+m.title+'"?'))return;E.moments=E.moments.filter(x=>x.id!==m.id);saveEdits();close();list();setTimeout(render,0)}));
 act.appendChild(btn('Close',close));P.appendChild(act);
 if(!canEdit()){P.querySelectorAll('input,select,textarea').forEach(i=>i.disabled=true);[...act.children].forEach(x=>{if(x.textContent!=='Close')x.remove()});sp.textContent='view only · switch to Edit in the top bar to change it';editingMoment=null}
 else F.title.focus()}
function renderBand(){renderMomentTrack();if(typeof renderConcern==='function')renderConcern();   // concern graph: milestones_view.js
 hlControls();renderBandChart();renderDoses()}
function renderBandChart(){$('txHide').textContent=txHidden?'Show':'Hide';$('txBody').classList.toggle('hide',txHidden);if(txHidden||(!TX.length&&!E.added.length))return;
 const rows=txRows(),TK=ticks();txShown=rows;$('txEmpty').textContent=rows.length?'':txSel.length?'None of the ticked medications fall in this window.':'Tick medications in the list on the left to show them here.';
 $('txBox').querySelectorAll('.txx,.txmv').forEach(b=>b.remove());
 $('txBox').classList.toggle('hide',!rows.length);if(!rows.length)return;
 /* row layout in "row units": the bar line is 1 unit; a drug with a half-life gets hlH px more below its bar */
 let acc=0;rows.forEach(r=>{const hd=hlOn&&HLD[r.drug]?hlDoses([r]):null;r._hl=hd&&hd.doses.length?hd:null;
  r._u0=acc;r._yb=acc+0.5+BARY;r._span=1+(r._hl?hlH/ROWPX:0);acc+=r._span});
 $('txBox').style.height=(acc*ROWPX+26)+'px';
 rows.forEach(r=>r._dp=dosePoints([r]));
 const pts={moment:[],given:[],order:[],fill:[],assumed:[],user:[],skipped:[]};
 rows.forEach((r,i)=>{if(r.moments)return;const taken=new Set();
  r.ev.forEach(e=>{const t=evT(e);if(e.k==='user')taken.add(e.d);if(t>=W.a&&t<=W.b)pts[e.k].push({x:pos(t),y:r._yb,r,e})});
  if(r.setting==='home')r.segs.forEach(g=>assumedDays(g,W.a,W.b).forEach(t=>{const d=isoD(t),st=E.dose[r.key+'|'+d];if(taken.has(d))return;
   pts[st==='skipped'?'skipped':'assumed'].push({x:pos(t),y:r._yb,r,e:{d,k:st==='skipped'?'skipped':'assumed',src:g.src,dose:g.dose,freq:g.freq,text:g.text,perDay:g.sch.perDay,doseKey:r.key+'|'+d}})}))});
 const bars={id:'bars',beforeDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();ctx.beginPath();ctx.rect(A.left,A.top-2,A.right-A.left,A.bottom-A.top+4);ctx.clip();
  rows.forEach((r,i)=>{const top=y.getPixelForValue(r._u0),cy=y.getPixelForValue(r._yb);
   if(r.moments){ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';ctx.fillText('Moments',A.left+4,top+11);
    let lastEnd=A.left+60;ctx.font='10px system-ui';
    (E.moments||[]).forEach(m=>{const t=momentT(m),te=m.end?dms(m.end):null,colr=MCOL[m.color]||MCOL.red;if((te||t)<W.a||t>W.b)return;
     const px=x.getPixelForValue(pos(Math.max(t,W.a)));
     if(te&&te>t){const p2=x.getPixelForValue(pos(Math.min(te,W.b)));ctx.globalAlpha=.45;ctx.fillStyle=colr;ctx.fillRect(px,cy-2,Math.max(2,p2-px),4);ctx.globalAlpha=1}
     const txt=m.title.length>40?m.title.slice(0,39)+'…':m.title,w=ctx.measureText(txt).width;
     if(px+9>lastEnd&&px+9+w<A.right){ctx.fillStyle=colr;ctx.fillText(txt,px+9,top+11);lastEnd=px+9+w+8}});
    return}
   if(r.drug===hlDrug){const hh=y.getPixelForValue(r._u0+r._span)-top;ctx.save();ctx.globalAlpha=.25;ctx.fillStyle=css('--accent');ctx.fillRect(A.left,top,A.right-A.left,hh);
    ctx.globalAlpha=1;ctx.fillRect(A.left,top,3,hh);ctx.restore()}
   if(i){ctx.strokeStyle=css('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(A.left,top);ctx.lineTo(A.right,top);ctx.stroke()}
   /* bar thickness follows the dose (thin = lowest, thick = highest dose of this drug) */
   const dp=r._dp,mx=dp.pts.length?Math.max(...dp.pts.map(p=>p.v)):0,H=v=>mx&&v!=null?4+8*(v/mx):8,oh=dp.pts.length?13:9;
   r.segs.forEach(g=>{const a=Math.max(dms(g.a),W.a),b=Math.min(dms(g.b)+DAYMS*0.9,W.b);if(b<W.a||a>W.b)return;
    const x1=x.getPixelForValue(pos(a)),x2=Math.max(x1+3,x.getPixelForValue(pos(b)));
    const cuts=[a,...dp.pts.filter(p=>p.t>a&&p.t<b&&p.k!=='rxend').map(p=>p.t),b];
    ctx.globalAlpha=.35;ctx.fillStyle=css('--ink2');
    for(let k=0;k<cuts.length-1;k++){const p1=x.getPixelForValue(pos(cuts[k])),p2=k===cuts.length-2?x2:x.getPixelForValue(pos(cuts[k+1])),h=H(doseAt(dp.pts,cuts[k]));
     ctx.fillRect(p1,cy-h/2,Math.max(1,p2-p1),h)}
    ctx.globalAlpha=1;
    if(g.user||g.edited){ctx.strokeStyle=css('--ink');ctx.lineWidth=1.2;ctx.strokeRect(x1+.5,cy-oh/2,x2-x1-1,oh)}
    else if(/no end/.test(g.note||'')||(g.sch&&g.sch.prn)){ctx.setLineDash([3,2]);ctx.strokeStyle=css('--ink2');ctx.strokeRect(x1+.5,cy-oh/2,x2-x1-1,oh);ctx.setLineDash([])}});
   ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';const lab=rowLabel(r);ctx.fillText(lab,A.left+4,top+11);
   /* half-life curve under the bar: estimated amount in the body, low/high half-life shaded */
   if(r._hl){const hl=HLD[r.drug],c0=y.getPixelForValue(r._u0+1)+2,c1=y.getPixelForValue(r._u0+r._span)-3,hpx=c1-c0,step=2,xs=[],H=[],L=[];
    const smp=[];for(let px=A.left;px<=A.right;px+=step)smp.push([px,unpos(x.getValueForPixel(px))]);
    r._hl.doses.forEach(d=>{if(d.t<W.a||d.t>W.b)return;const px=x.getPixelForValue(pos(d.t));smp.push([px-.01,d.t-1],[px,d.t])});
    smp.sort((p,q)=>p[0]-q[0]).forEach(([px,t])=>{xs.push(px);H.push(hlAmount(r._hl.doses,t,hl.hi,true));L.push(hlAmount(r._hl.doses,t,hl.lo,false))});
    const mx=Math.max(...H,1e-9),Y=v=>c1-hpx*v/mx;ctx.save();
        /* label half-life: blue; unofficial best estimate: grey with a dotted line */
    const est=hl.basis==='estimate',fillA=est?'rgba(138,137,132,.28)':'rgba(57,135,229,.30)',fillB=est?'rgba(138,137,132,.14)':'rgba(57,135,229,.15)';
    ctx.beginPath();ctx.moveTo(xs[0],c1);xs.forEach((px,k)=>ctx.lineTo(px,Y(L[k])));ctx.lineTo(xs[xs.length-1],c1);ctx.closePath();ctx.fillStyle=fillA;ctx.fill();
    ctx.beginPath();xs.forEach((px,k)=>ctx.lineTo(px,Y(H[k])));for(let k=xs.length-1;k>=0;k--)ctx.lineTo(xs[k],Y(L[k]));ctx.closePath();ctx.fillStyle=fillB;ctx.fill();
    ctx.beginPath();xs.forEach((px,k)=>k?ctx.lineTo(px,Y(H[k])):ctx.moveTo(px,Y(H[k])));ctx.strokeStyle=est?css('--muted'):css('--accent');ctx.lineWidth=1.2;
    ctx.setLineDash(est?[1.5,2.5]:r._hl.assumed?[4,3]:[]);ctx.stroke();ctx.setLineDash([]);
    if(hpx>=22){ctx.font='9.5px system-ui';ctx.fillStyle=css('--muted');ctx.fillText((hl.basis==='estimate'?'unofficial estimate, not from a drug label · ':'')+hlText(hl)+' · estimated amount in body (max '+amt(mx)+' '+r._hl.u+')'+(r._hl.ranged?' · some doses only as a range in the record (shaded low to high)':'')+(r._hl.assumed?' · assumes taken as prescribed'+(r._hl.fromText?' (dose read from the prescription text)':''):''),A.left+4,c0+9)}
    ctx.restore()}
   /* dose labels where the dose changes ("5 mg", then "→ 10 mg"), on the name line, never over the name */
   const nameEnd=A.left+4+ctx.measureText(lab).width+8;let lastEnd=-1e9,skipped=[];ctx.font='10px system-ui';ctx.fillStyle=css('--ink');
   /* a change with no room for its label is folded into the next label: "→ 6 → 4 mg" */
   doseChanges(dp.pts).forEach(ch=>{if(ch.t<W.a||ch.t>W.b)return;const px=x.getPixelForValue(pos(ch.t));
    const txt=(ch.prev==null&&!skipped.length?'':'→ ')+[...skipped,ch.v].map(fmt).join(' → ')+' '+dp.u;
    if(px>nameEnd&&px>lastEnd+6&&px+ctx.measureText(txt).width<A.right){ctx.fillText(txt,px,top+11);lastEnd=px+ctx.measureText(txt).width;skipped=[]}else skipped.push(ch.v)})});ctx.restore()}};
 const guide={id:'guide',afterDatasetsDraw(c){if(hoverX==null)return;const{ctx,chartArea:a,scales:{x}}=c;const px=x.getPixelForValue(hoverX);if(px<a.left||px>a.right)return;
  ctx.save();ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.setLineDash([]);ctx.restore()}};
 const col=e=>e.src==='you'?css('--ink'):srcColor(e.src);
 const ds=Object.keys(pts).map(k=>({label:k,data:pts[k],pointStyle:KIND[k].style,pointRadius:KIND[k].r,pointHoverRadius:KIND[k].r+2,
  pointBackgroundColor:pts[k].map(p=>k==='moment'?MCOL[p.e.m.color]||MCOL.red:KIND[k].fill?col(p.e):css('--card')),pointBorderColor:pts[k].map(p=>k==='skipped'?css('--ink2'):KIND[k].fill?css('--card'):col(p.e)),
  pointBorderWidth:k==='skipped'?1.8:KIND[k].fill?1:1.3,showLine:false}));
 charts.set('tx',new Chart($('tx'),{type:'scatter',plugins:[bars,guide,momentPlugin],data:{datasets:ds},
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
   onHover:(ev,els,c)=>{if(ev.type==='mouseout'){setHover(null);$('mtip').classList.add('hide');return}   // Chart.js reports leaving the chart after our mouseleave: don't show anything again
    const xv=c.scales.x.getValueForPixel(ev.x);setHover(xv>=0&&xv<=100?xv:null);const u=c.scales.y.getValueForPixel(ev.y);txInfo(rows,rowAt(rows,u),xv,u);barPop(ev,els,rows[rowAt(rows,u)],xv,u);
    c.canvas.style.cursor='grab'},
   onClick:(ev,els,c)=>txClick(rows,els,c,ev),
   plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>{const p=c[0].raw;return p.e.k==='moment'?'Keyframe · '+p.e.d+(p.e.m.end?' → '+p.e.m.end:''):rowLabel(p.r)+' · '+evHover(p.e)},
    label:c=>{const e=c.raw.e;if(e.k==='moment')return [e.m.title,...(e.m.note?(e.m.note.match(/.{1,70}(\s|$)/g)||[e.m.note]).slice(0,4).map(x=>x.trim()):[]),'Click to edit'];const L=[KIND[e.k].label,[e.dose,e.route,e.k==='assumed'&&e.perDay>1?e.perDay+' doses/day':e.freq,e.qty].filter(Boolean).join(' · ')+(e.src?'  · '+e.src:'')];
     if(e.rlo!=null)L.push('amount given not in the record (only the range '+e.dose+')');
     L.push(...whyLines(e.why));
     if(e.k==='assumed'||e.k==='skipped'||e.doseKey)L.push(pxPerDay(c.chart)<4?'Click to edit; zoom in to click single doses':'Click to change: taken / skipped / assumed');return L}}}},
   layout:TLAY(),
   scales:{x:{type:'linear',min:0,max:100,afterFit:tEdge,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
     ticks:{color:css('--muted'),autoSkip:false,maxRotation:0,callback:(v,i)=>TK[i]?TK[i].label:''},
     grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}}},
    y:{type:'linear',reverse:true,min:0,max:acc,afterFit:s=>{s.width=YW},ticks:{display:false},grid:{display:false},border:{display:false}}}}}));
 /* a small × left of each medication's name: untick it here instead of in the Library (a view setting, not an edit) */
 {const c=charts.get('tx'),y=c.scales.y,A=c.chartArea,done=new Set();
  rows.forEach(r=>{if(r.moments||done.has(r.drug))return;done.add(r.drug);
   const b=btn('×',e=>{e.stopPropagation();setMedSel([r.drug],false)},'txx');b.title='Remove '+drugLabel(r.drug,r.brands)+' from the Treatment panel (tick it in the Library to bring it back)';
   b.setAttribute('aria-label','Remove '+r.drug+' from the Treatment panel');b.style.top=(y.getPixelForValue(r._u0)+1)+'px';b.style.left=(A.left-20)+'px';$('txBox').appendChild(b);
   const k=[...done].length-1,last=k===new Set(rows.filter(x=>!x.moments).map(x=>x.drug)).size-1;
   [['↑',-1,k===0],['↓',1,last]].forEach(([t,d,off],m)=>{const mv=btn(t,e=>{e.stopPropagation();moveDrug(r.drug,d)},'txmv');mv.disabled=off;
    mv.title='Move '+r.drug+(d<0?' up':' down')+' in the Treatment panel';mv.setAttribute('aria-label',mv.title);
    mv.style.top=b.style.top;mv.style.left=(A.left-58+m*19)+'px';$('txBox').appendChild(mv)})})}
 $('txBox').onmouseleave=()=>{setHover(null);$('txInfo').textContent='';$('mtip').classList.add('hide')}}
/* ---- half-life estimates: estimated amount still in the body after each dose ----
   amount(t) = Σ dose × ½^(days since dose ÷ t½), for the low and high half-life in
   reference/med_halflife.tsv (shaded between). Drawn inside the band under each drug's bar for
   every drug with a half-life on file, while "Half-life" is on. Doses = given / completed orders /
   entered by you (not fills or assumed doses). An estimate of the shape, not a measured level. */
const HLD=D.halflife||{};
let hlOn=store.get('hlon',true),hlH=Math.max(16,Math.min(200,store.get('hlh',28)));
/* "t½ 4 h" for short half-lives, "t½ 5.4–5.7 d" for long ones */
function hlText(hl){const h=hl.hi<=4,f=x=>h?fmt(Math.round(x*24*10)/10):fmt(Math.round(x*10)/10);return 't½ '+f(hl.lo)+(f(hl.hi)!==f(hl.lo)?'–'+f(hl.hi):'')+(h?' h':' d')}
/* amounts: whole numbers from 10 up, two decimals below (0.25 mg stays 0.25) */
const amt=v=>fmt(v>=10?Math.round(v):Math.round(v*100)/100);
/* hiDose: use the high end of range doses ("2-4 mg" → 4); otherwise the low end (2) */
function hlAmount(doses,t,h,hiDose){let s=0;for(const d of doses){const dt=(t-d.t)/DAYMS;if(dt>=0)s+=(hiDose&&d.vh!=null?d.vh:d.v)*Math.pow(.5,dt/h)}return s}
/* "3.1" or "1.2–3.1": low dose with the short half-life to high dose with the long one */
function rangeAmt(doses,t,hl){const a=amt(hlAmount(doses,t,hl.lo,false)),b=amt(hlAmount(doses,t,hl.hi,true));return a===b?b:a+'–'+b}
/* doses for the half-life curve: recorded doses (given / completed orders / entered by you), plus for
   home prescriptions the doses the schedule implies (doses/day, every N days, days on/off), minus days
   you marked skipped; "taken" marks use the dose of the prescription on that date. assumed = true
   when any dose comes from a schedule rather than a record. */
function hlDoses(rows){const dp=dosePoints(rows);let assumed=false,fromText=false,ranged=false;
 /* doses recorded only as a range ("2-4 mg", e.g. "as needed" orders): counted from low to high */
 const rng=rows.flatMap(r=>r.ev.filter(e=>e.dv==null&&e.rlo!=null&&(e.k==='given'||e.k==='order')));
 const u=dp.u||Object.entries(rng.reduce((c,e)=>(c[e.ru]=(c[e.ru]||0)+1,c),{})).sort((a,b)=>b[1]-a[1]).map(x=>x[0])[0]||'';
 const doses=dp.pts.filter(p=>p.k==='given'||p.k==='order'||p.k==='user').map(p=>({t:p.t,v:p.v}));
 rng.forEach(e=>{if(e.ru===u){doses.push({t:evT(e),v:e.rlo,vh:e.rhi});ranged=true}});
 rows.forEach(r=>{if(r.setting!=='home')return;const taken=new Set(r.ev.filter(e=>e.k==='user').map(e=>e.d));
  r.segs.forEach(g=>{if(g.dv==null||g.du!==u||!g.sch||g.sch.prn)return;const per=Math.max(1,g.sch.perDay||1);
   assumedDays(g,-Infinity,Infinity).forEach(t=>{const d=isoD(t);if(E.dose[r.key+'|'+d]==='skipped'||taken.has(d))return;
    assumed=true;if(g.dose_from_text)fromText=true;for(let k=0;k<per;k++)doses.push({t:t+(k-(per-1)/2)*DAYMS/per,v:g.dv})})});
  r.ev.forEach(e=>{if(e.k==='user'&&e.dv==null){const g=segAt(r,dms(e.d));if(g&&g.dv!=null&&g.du===u)doses.push({t:dms(e.d),v:g.dv})}})});
 doses.sort((a,b)=>a.t-b.t);return{u,doses,assumed,fromText,ranged}}
function hlControls(){$('hlOn').textContent='Half-life: '+(hlOn?'on':'off');$('hlOn').className=hlOn?'on':'';$('hlSmall').disabled=$('hlBig').disabled=!hlOn;
 $('hlCtl').classList.toggle('hide',!Object.keys(HLD).length)}
/* ---- dose charts: one per drug ticked "dose" in the sidebar, same axis/window/hover as the labs ---- */
let txDose=store.get('txdose',[]);
function setDoseChart(drug,on){txDose=txDose.filter(d=>d!==drug);if(on)txDose.push(drug);store.set('txdose',txDose);list();render()}
const DOSE_STYLE={given:['circle',4.5,true],order:['rectRot',5,true],fill:['rect',4,true],user:['triangle',5.5,true],rx:['circle',3,false],rxend:['circle',0,false]};
function renderDoses(){const box=$('txDoses');box.innerHTML='';if(txHidden)return;const all=effRows(TX,E);
 txDose.forEach((drug,di)=>{const rows=all.filter(r=>r.drug===drug);const dp=dosePoints(rows);if(!dp.pts.length)return;
  const w=document.createElement('div');w.className='dosebox'+(drug===hlDrug?' hl':'');w.dataset.drug=drug;const h=document.createElement('div');h.className='cmph';
  const b=document.createElement('b');b.textContent=drugLabel(drug,rows[0].brands)+' — dose';const u=document.createElement('span');u.className='u';
  const nIn=dp.pts.filter(p=>p.t>=W.a&&p.t<=W.b&&p.k!=='rxend').length;u.textContent=dp.u+(nIn?'':' · no doses in this window');
  const ctl=document.createElement('span');ctl.className='ctl';const id='dose:'+drug;
  const mk=(l,t,fn)=>{const x=document.createElement('button');x.textContent=l;x.title=t;x.setAttribute('aria-label',t);x.onclick=fn;ctl.appendChild(x)};
  const mvDose=d=>{const j=d==='top'?0:d==='bottom'?txDose.length-1:di+d;if(j<0||j>=txDose.length||j===di)return;txDose.splice(di,1);txDose.splice(j,0,drug);store.set('txdose',txDose);render()};
  const first=di===0,last=di===txDose.length-1;
  mk('⤒','Move this dose chart to the top',()=>mvDose('top'));if(first)ctl.lastChild.disabled=true;
  mk('↑','Move this dose chart up',()=>mvDose(-1));if(first)ctl.lastChild.disabled=true;
  mk('↓','Move this dose chart down',()=>mvDose(1));if(last)ctl.lastChild.disabled=true;
  mk('⤓','Move this dose chart to the bottom',()=>mvDose('bottom'));if(last)ctl.lastChild.disabled=true;
  mk('−','Shorter',()=>{setH(id,hOf(id,140)-40);render()});mk('+','Taller',()=>{setH(id,hOf(id,140)+40);render()});mk('×','Close dose chart',()=>setDoseChart(drug,false));
  h.append(b,u,ctl);const cb=document.createElement('div');cb.style.cssText='position:relative;height:'+hOf(id,140)+'px';
  const cv=document.createElement('canvas');cv.setAttribute('role','img');cv.setAttribute('aria-label','Dose of '+drug+' over time');cb.appendChild(cv);w.append(h,cb);box.appendChild(w);
  /* points in the window, plus the dose carried in from before it; the line breaks across gaps of more than GAP days */
  const GAP=45*DAYMS,inW=dp.pts.filter(p=>p.t>=W.a&&p.t<=W.b),before=dp.pts.filter(p=>p.t<W.a).pop(),data=[];
  if(before&&inW.length&&inW[0].t-before.t<GAP&&before.k!=='rxend')data.push({x:pos(W.a),y:before.v,p:Object.assign({},before,{carried:true})});
  inW.forEach((p,i)=>{const prev=i?inW[i-1]:null;if(prev&&(p.t-prev.t>GAP||(prev.k==='rxend'&&p.t-prev.t>2*DAYMS)))data.push({x:pos((p.t+prev.t)/2),y:null});
   data.push({x:pos(p.t),y:p.v,p})});
  const ys=dp.pts.map(p=>p.v),ymax=Math.max(...ys)*1.15||1,TK=ticks();
  const guide={id:'guide',afterDatasetsDraw(c){if(hoverX==null)return;const{ctx,chartArea:a,scales:{x}}=c;const px=x.getPixelForValue(hoverX);if(px<a.left||px>a.right)return;
   ctx.save();ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.restore()}};
  const st=d=>d.p?DOSE_STYLE[d.p.carried?'rxend':d.p.k]||DOSE_STYLE.given:DOSE_STYLE.rxend;
  const col=d=>d.p&&d.p.src&&d.p.src!=='you'?srcColor(d.p.src):css('--ink');
  charts.set(id,new Chart(cv,{type:'line',plugins:[guide,momentPlugin],data:{datasets:[{data,stepped:'after',spanGaps:false,borderColor:css('--muted'),borderWidth:1.5,
    pointStyle:data.map(d=>st(d)[0]),pointRadius:data.map(d=>st(d)[1]),pointHoverRadius:data.map(d=>st(d)[1]?st(d)[1]+2:0),
    pointBackgroundColor:data.map(d=>st(d)[2]?col(d):css('--card')),pointBorderColor:data.map(d=>st(d)[2]?css('--card'):col(d)),pointBorderWidth:1.3}]},
   options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
    onHover:(e,els,c)=>{const xv=c.scales.x.getValueForPixel(e.x);setHover(xv>=0&&xv<=100?xv:null)},
    plugins:{legend:{display:false},tooltip:{filter:c=>!!(c.raw.p&&st(c.raw)[1]),callbacks:{title:c=>{const p=c[0].raw.p;return p.e?evHover(p.e):isoD(p.t)},
     label:c=>{const p=c.raw.p;const what=p.k==='rx'?'prescribed from this date':KIND[p.k]?KIND[p.k].label:'';return [fmt(p.v)+' '+dp.u+(p.src?'  · '+p.src:''),what,...whyLines((p.e||p.g||{}).why)]}}}},
    layout:TLAY(),
    scales:{x:{type:'linear',min:0,max:100,afterFit:tEdge,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
      ticks:{color:css('--muted'),autoSkip:false,maxRotation:0,callback:(v,i)=>TK[i]?TK[i].label:''},
      grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}}},
     y:{min:0,max:ymax,afterFit:s=>{s.width=YW},ticks:{color:css('--muted'),maxTicksLimit:4},grid:{color:css('--line')}}}}}))});
 box.onmouseleave=()=>setHover(null)}
function rowAt(rows,u){return rows.findIndex(r=>u>=r._u0&&u<r._u0+r._span)}
function segAt(r,t){return r&&r.segs.find(g=>t>=dms(g.a)-DAYMS/2&&t<=dms(g.b)+DAYMS)}
/* Medication popup for a bar (dose markers have Chart.js's own popup): period, dose, why it was given, who ordered it */
function barPop(ev,els,r,xv,u){const el=$('mtip'),hide=()=>el.classList.add('hide');
 if($('txEdit').matches(':hover'))return hide();
 if(els.length||!r||r.moments||xv==null||xv<0||xv>100||u>=r._u0+1)return hide();const g=segAt(r,unpos(xv));if(!g)return hide();
 el.innerHTML='';const b=document.createElement('b');b.textContent=rowLabel(r);el.appendChild(b);
 [(g.user?'entered by you ':g.note&&/joined/.test(g.note)?'given ':'ordered ')+g.a+' to '+g.b+(g.src&&g.src!=='you'?' · '+g.src:''),
  [g.dose,g.freq||(g.sch&&g.sch.perDay>1?g.sch.perDay+'×/day':'')].filter(Boolean).join(' · '),g.edited?'changed by you':'',
  ...whyLines(g.why,140),canEdit()?'click to edit':''].filter(Boolean).forEach(t=>{const d=document.createElement('div');d.textContent=t;el.appendChild(d)});
 const n=ev.native||ev;el.style.left=Math.min(n.clientX+14,innerWidth-350)+'px';el.style.top=(n.clientY+16)+'px';el.classList.remove('hide')}
function txInfo(rows,i,xv,u){const r=rows[i];if(!r||xv==null){$('txInfo').textContent='';return}
 if(r._hl&&u!=null&&u>=r._u0+1){const t=unpos(xv),hl=HLD[r.drug];
  $('txInfo').textContent=drugLabel(r.drug,r.brands)+' on '+iso(t)+': about '+rangeAmt(r._hl.doses,t,hl)+' '+r._hl.u+' estimated in the body ('+hlText(hl)+(r._hl.ranged?'; some doses are only a range in the record, so counted low to high':'')+') — '+(hl.basis==='estimate'?'based on an UNOFFICIAL half-life estimate, not from a drug label':'based on the half-life in the drug label')+(r._hl.assumed?', assuming it was taken as prescribed':'')+', not a measured level';return}
 const g=segAt(r,unpos(xv));
 $('txInfo').textContent=(g?rowLabel(r)+': '+(g.user?'entered by you ':'ordered ')+g.a+' to '+g.b+(g.src&&g.src!=='you'?' · '+g.src:'')+(g.dose?' · '+g.dose:'')+(g.freq?' · '+g.freq:g.sch&&g.sch.perDay>1?' · '+g.sch.perDay+'×/day':'')
  +(g.sch&&g.sch.on?' · '+g.sch.on+' days on / '+g.sch.off+' off':'')+(g.sch&&g.sch.prn?' · as needed (no assumed doses drawn)':'')+(g.note?' · '+g.note:'')+(g.edited?' · changed by you':'')+(g.why?whyLines(g.why,160).map(x=>' · '+x).join(''):''):rowLabel(r))+'  — click to edit'+(r.setting==='home'?' or mark doses (zoom to 3 months to click single doses)':'')}

/* ---- clicking ---- */
/* doses can be clicked one by one only when they are at least 4px apart; otherwise open the editor */
const pxPerDay=c=>(c.chartArea.right-c.chartArea.left)*(pos(W.a+DAYMS)-pos(W.a))/100;
/* where the editor pops up: just under the clicked medication's bar (px from the top of #txBody) */
let editAt=null;
function anchorEdit(c,r,ev){const B=$('txBody').getBoundingClientRect(),C=c.canvas.getBoundingClientRect();
 editAt={y:C.top-B.top+(r?c.scales.y.getPixelForValue(r._u0+1):ev.y)+4,x:C.left-B.left+ev.x}}
function txClick(rows,els,c,ev){$('mtip').classList.add('hide');
 {const u=c.scales.y.getValueForPixel(ev.y);anchorEdit(c,rows[rowAt(rows,u)],ev)}
 const mh=els.map(el=>c.data.datasets[el.datasetIndex].data[el.index]).find(p=>p&&p.e.k==='moment');if(mh){openMoment(mh.e.m);return}
 const hit=els.map(el=>c.data.datasets[el.datasetIndex].data[el.index]).find(p=>p&&(p.e.doseKey||p.e.k==='assumed'));
 if(hit&&pxPerDay(c)<4){openSeg(hit.r,segAt(hit.r,dms(hit.e.d)),hit.e.d);return}
 if(!canEdit())return;
 if(hit){const k=hit.e.doseKey;const nx=nextDoseState(E.dose[k]);if(nx)E.dose[k]=nx;else delete E.dose[k];saveEdits();setTimeout(render,0);return}  // redraw after Chart.js finishes this click
 const xv=c.scales.x.getValueForPixel(ev.x),r=rows[rowAt(rows,c.scales.y.getValueForPixel(ev.y))];if(!r||xv<0||xv>100)return;
 if(r.moments){openMoment(null,isoD(unpos(xv)));return}
 const t=unpos(xv),g=segAt(r,t);if(g&&g.user){openAdd((E.added||[]).find(m=>m.id===g.uid));return}
 openSeg(r,g,isoD(t))}

/* float the editor under the clicked row (or under the panel's header for "+ Add medication"),
   keep it inside the panel's width, and scroll only as far as needed to show all of it */
function placeEdit(){const p=$('txEdit'),W0=$('txBody').clientWidth,w=Math.min(720,W0);
 const a=editAt||{y:0,x:0};p.style.top=a.y+'px';p.style.left=Math.max(0,Math.min(a.x-80,W0-w))+'px';p.style.width=w+'px';
 requestAnimationFrame(()=>{if(!p.classList.contains('hide'))p.scrollIntoView({block:'nearest',behavior:'smooth'})})}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('txEdit').classList.contains('hide')&&!e.target.closest('#txEdit input,#txEdit textarea,#txEdit select'))$('txEdit').classList.add('hide')});
/* ---- small form helpers ---- */
function field(label,input){const w=document.createElement('label');w.className='fld';const s=document.createElement('span');s.textContent=label;w.append(s,input);return w}
function inp(type,val,attrs){const i=document.createElement(type==='select'||type==='textarea'?type:'input');if(type!=='select'&&type!=='textarea')i.type=type;
 Object.assign(i,attrs||{});if(type==='checkbox')i.checked=!!val;else if(val!=null&&type!=='select')i.value=val;return i}
function selBox(opts,val){const s=inp('select');opts.forEach(o=>{const op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op)});s.value=val;return s}
function btn(text,fn,cls){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;if(cls)b.className=cls;return b}
function panel(title,sub){const p=$('txEdit');p.innerHTML='';p.classList.remove('hide');$('mtip').classList.add('hide');placeEdit();const h=document.createElement('div');h.className='txh';
 const b=document.createElement('b');b.textContent=title;h.appendChild(b);h.appendChild(Object.assign(document.createElement('span'),{className:'ctl'}));
 h.lastChild.appendChild(btn('Close',()=>{p.classList.add('hide')}));p.appendChild(h);
 if(sub){const s=document.createElement('div');s.className='sub';s.textContent=sub;p.appendChild(s)}
 const g=document.createElement('div');g.className='fgrid';p.appendChild(g);return g}
const num=(v,d)=>{const n=parseFloat(v);return isFinite(n)?n:d};
function schedFields(g,sch){const f={perDay:inp('number',sch.perDay,{min:0,max:12,step:1}),every:inp('number',sch.every,{min:1,max:365,step:1}),
  on:inp('number',sch.on,{min:0,max:365}),off:inp('number',sch.off,{min:0,max:365}),prn:inp('checkbox',sch.prn)};
 g.append(field('Doses per day',f.perDay),field('Every N days',f.every),field('Days on (cycle)',f.on),field('Days off (cycle)',f.off),field('As needed (no assumed doses)',f.prn));return f}
const readSched=f=>({perDay:num(f.perDay.value,1),every:Math.max(1,num(f.every.value,1)),on:num(f.on.value,0),off:num(f.off.value,0),prn:f.prn.checked});

/* in the Drug editor: why it was given and who ordered it, read-only, as the record states it */
function mergeWhy(ws){const o={};ws.forEach(w=>Object.entries(w||{}).forEach(([k,v])=>v.split(' | ').forEach(x=>{o[k]=o[k]||[];if(x&&!o[k].includes(x))o[k].push(x)})));
 return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.join(k==='by'?', ':' | ')]))}
function whyBlock(box,w){const L=whyLines(w,400);if(!L.length)return;const d=document.createElement('div');d.className='whybox';
 const h=document.createElement('b');h.textContent='Why it was given, from the record';d.appendChild(h);
 L.forEach(t=>{const x=document.createElement('div');x.textContent=t;d.appendChild(x)});box.parentNode.insertBefore(d,box)}
/* edit one bar from the records (or a row without a bar: add doses) */
function openSeg(r,g,clickDate){if(!canEdit())return;
 const g0=g&&TX.find(x=>x.key===r.key),orig=g0&&g0.segs.find(x=>segId(g0,x)===g.sid);
 const box=panel('Edit: '+rowLabel(r),g?'From the record: '+(orig?orig.a+' to '+orig.b+(orig.src?' · '+orig.src:'')+(orig.text?' · '+orig.text:''):'')+'. Your changes are kept separately; the record itself is not changed.':'No ordered period here. You can add a dose you took on a date.');
 whyBlock(box,g&&g.why&&Object.keys(g.why).length?g.why:mergeWhy(r.ev.filter(e=>e.d===clickDate).map(e=>e.why)));
 if(g){const a=inp('date',g.a),b=inp('date',g.b),dose=inp('text',g.dose||''),note=inp('text',g.note||'',{size:40}),hide=inp('checkbox',false);
  box.append(field('Start',a),field('End',b),field('Dose',dose));
  const f=r.setting==='home'?schedFields(box,Object.assign({perDay:1,every:1,on:0,off:0,prn:false},g.sch||{})):null;
  box.append(field('Note',note),field('Hide this bar',hide));
  const act=document.createElement('div');act.className='bar';act.style.marginTop='10px';
  act.append(btn('Save',()=>{if(b.value<a.value){uiNote('End is before start.');return}
    const ov={a:a.value,b:b.value,dose:dose.value,note:note.value,hidden:hide.checked};if(f)Object.assign(ov,readSched(f));
    E.seg[g.sid]=ov;saveEdits();$('txEdit').classList.add('hide');render()},'on'),
   btn('Reset to record',()=>{delete E.seg[g.sid];saveEdits();$('txEdit').classList.add('hide');render()}));
  $('txEdit').appendChild(act)}
 doseList(r,clickDate)}
/* the doses you marked in a row, plus "add a dose taken on <date>" */
function doseList(r,clickDate){const p=$('txEdit'),w=document.createElement('div');w.style.marginTop='12px';
 const h=document.createElement('div');h.className='sub';h.textContent='Doses you marked for '+r.drug+(r.setting==='home'?' (home)':' (hospital/clinic)')+':';w.appendChild(h);
 const ks=Object.keys(E.dose).filter(k=>k.slice(0,k.lastIndexOf('|'))===r.key).sort();
 const ul=document.createElement('div');ul.className='chips';ks.forEach(k=>{const d=k.slice(k.lastIndexOf('|')+1);
  ul.appendChild(btn(d+' · '+E.dose[k]+' ×',()=>{delete E.dose[k];saveEdits();render();openRowAgain(r,clickDate)}))});
 if(!ks.length)ul.appendChild(Object.assign(document.createElement('span'),{className:'sub',textContent:'none yet'}));w.appendChild(ul);
 const d=inp('date',clickDate),st=selBox([['taken','taken'],['skipped','skipped']],'taken');
 const row=document.createElement('div');row.className='bar';row.style.marginTop='6px';
 row.append(field('Date',d),field('Mark as',st),btn('Add',()=>{if(!d.value)return;E.dose[r.key+'|'+d.value]=st.value;saveEdits();render();openRowAgain(r,d.value)}));
 w.appendChild(row);p.appendChild(w)}
function openRowAgain(r,date){const rr=effRows(TX,E).find(x=>x.key===r.key)||r;openSeg(rr,segAt(rr,dms(date)),date)}

/* add a medication (or edit one you added) - same fields as the downloaded records */
function openAdd(m){if(!canEdit())return;const isNew=!m;m=m||{id:'m'+Date.now().toString(36),drug:'',cls:'other',setting:'home',dose:'',route:'',freq:'',a:isoD(Math.min(Date.now(),W.b)),b:'',status:'active',
  perDay:1,every:1,on:0,off:0,prn:false,note:'',given:[]};
 const box=panel(isNew?'Add a medication':'Edit: '+m.drug+' (entered by you)','Entered by you; shown with ▲ markers and a solid outline. Saved in this browser until you export.');
 const F={drug:inp('text',m.drug,{required:true,placeholder:'e.g. dexamethasone'}),cls:selBox(CLS_ORDER.map(c=>[c,c]),m.cls),
  setting:selBox([['home','taken at home'],['facility','given at hospital/clinic']],m.setting),dose:inp('text',m.dose,{placeholder:'e.g. 4 mg'}),
  route:inp('text',m.route,{placeholder:'e.g. oral'}),freq:inp('text',m.freq,{placeholder:'e.g. twice daily'}),a:inp('date',m.a),b:inp('date',m.b),
  status:selBox([['active','active'],['completed','completed'],['stopped','stopped']],m.status),note:inp('text',m.note,{size:40}),
  given:inp('textarea',(m.given||[]).join('\n'),{rows:3,placeholder:'one date per line, YYYY-MM-DD'})};
 box.append(field('Drug name',F.drug),field('Kind',F.cls),field('Setting',F.setting),field('Dose',F.dose),field('Route',F.route),field('Frequency (as written)',F.freq),
  field('Start',F.a),field('End (blank = one day)',F.b),field('Status',F.status));
 const S=schedFields(box,m);box.append(field('Note',F.note),field('Dates taken or given',F.given));
 const act=document.createElement('div');act.className='bar';act.style.marginTop='10px';
 act.append(btn('Save',()=>{const drug=F.drug.value.trim();if(!drug){uiNote('Enter a drug name.');return}if(!F.a.value){uiNote('Enter a start date.');return}
   if(F.b.value&&F.b.value<F.a.value){uiNote('End is before start.');return}
   const given=F.given.value.split(/[\s,;]+/).filter(Boolean),bad=given.filter(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||isNaN(dms(x)));
   if(bad.length){uiNote('Not a date (use YYYY-MM-DD): '+bad.join(', '));return}
   const rec=Object.assign({},m,{drug,cls:F.cls.value,setting:F.setting.value,dose:F.dose.value,route:F.route.value,freq:F.freq.value,a:F.a.value,b:F.b.value,
    status:F.status.value,note:F.note.value,given:[...new Set(given)].sort()},readSched(S));
   E.added=(E.added||[]).filter(x=>x.id!==rec.id).concat([rec]);const dk=rec.drug.toLowerCase();if(!txSel.includes(dk)){txSel.push(dk);store.set('txsel',txSel)}
   saveEdits();$('txEdit').classList.add('hide');list();render()},'on'));
 if(!isNew)act.appendChild(btn('Delete',async()=>{if(!await uiAsk('Delete '+m.drug+' (entered by you)?'))return;E.added=E.added.filter(x=>x.id!==m.id);saveEdits();$('txEdit').classList.add('hide');list();render()}));
 $('txEdit').appendChild(act);F.drug.focus()}

/* ---- export / import ---- */
function nEdits(){return Object.keys(E.seg).length+Object.keys(E.dose).length+(E.added||[]).length+(E.moments||[]).length+(E.ranges||[]).length+(E.panels||[]).length+(E.macros||[]).length}
function txStatus(){const n=nEdits();$('txStatus').textContent=SHARED?(n?n+' change'+(n>1?'s':'')+' · ':'')+shareMsg:n?n+' change'+(n>1?'s':'')+(txDirty?' · not exported yet':' · exported'):''}
function exportEdits(){const blob=new Blob([JSON.stringify(E,null,1)],{type:'application/json'});const a=document.createElement('a');
 a.href=URL.createObjectURL(blob);a.download='med_edits.json';document.body.appendChild(a);a.click();a.remove();
 txDirty=false;store.set('txdirty',false);txStatus();
 uiNote('Saved med_edits.json to your Downloads folder.\nMove it into the project\'s local/ folder, then rebuild:\n  python3 flatten_meds.py && python3 make_lab_view.py')}
function importEdits(file){const rd=new FileReader();rd.onload=async()=>{try{const j=JSON.parse(rd.result);if(!j||j.version!==1)throw new Error('not a med_edits.json file');
  if(nEdits()&&!await uiAsk('Replace the '+nEdits()+' changes'+(SHARED?' (for everyone)':' in this browser')+' with the file?',undefined,'Replace'))return;
  E=Object.assign(EMPTY_EDITS(),j);delete E.rev;if(SHARED){saveEdits();list();render();return}store.set('txedits',E);txDirty=false;store.set('txdirty',false);txStatus();list();render()}catch(e){uiNote('Could not read the file: '+e.message)}};rd.readAsText(file)}
function txInit(){initTxSel();
 {const s0=store.set;store.set=(k,v)=>{s0.call(store,k,v);queueLay()}}
 $('mAdd').onclick=()=>openMoment(null);
 $('mLines').onclick=()=>{mLines=!mLines;store.set('mlines',mLines);render()};
 {const flip=k=>{const r=mRows();r[k]=!r[k];store.set('mrows',r);render()};$('mRowK').onclick=()=>flip('kf');$('mRowC').onclick=()=>flip('cc')}
 $('hlOn').onclick=()=>{hlOn=!hlOn;store.set('hlon',hlOn);render()};
 const hlSize=dlt=>{hlH=Math.max(16,Math.min(200,hlH+dlt));store.set('hlh',hlH);render()};
 $('hlSmall').onclick=()=>hlSize(-8);$('hlBig').onclick=()=>hlSize(8);if(!TX.length&&!E.added.length&&!D.tx)$('txCard').classList.add('hide');
 $('txHide').onclick=()=>{txHidden=!txHidden;store.set('txhidden',txHidden);render()};
 $('txAdd').onclick=()=>{editAt=null;if(txHidden){txHidden=false;store.set('txhidden',false);render()}openAdd(null)};
 $('txExport').onclick=exportEdits;$('txImport').onclick=()=>$('txFile').click();$('txFile').onchange=e=>{if(e.target.files[0])importEdits(e.target.files[0]);e.target.value=''};
 $('roleBtn').onclick=()=>setRole(canEdit()?'view':'edit');applyRole();
 $('txEdit').addEventListener('mouseenter',()=>$('mtip').classList.add('hide'));
 txLegend();txStatus();loadShared()}
