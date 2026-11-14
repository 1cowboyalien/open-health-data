/* ---------- treatment band (inlined into local/labs.html by make_lab_view.py) ----------
 Rows come from med_timeline.py (D.tx). Your own changes live in an "edits" object:
   seg:   {segId: {a,b,perDay,every,on,off,prn,dose,note,hidden}}  changes to a bar from the records
   dose:  {"rowKey|YYYY-MM-DD": "taken"|"skipped"}                  doses you confirmed or skipped
   added: [{id,drug,cls,setting,dose,route,freq,a,b,status,perDay,every,on,off,prn,note,given:[dates]}]
 Edits are kept in this browser (localStorage) and can be exported to local/med_edits.json,
 which make_lab_view.py builds back in (D.edits) and flatten_meds.py adds to meds_all.tsv.
 Nothing in here changes the hospital records. */
const TX=D.tx||[];
const CLS_ORDER=['HER2/targeted','chemo','steroid','supportive/antiemetic','anticonvulsant','pain','contrast/imaging','other'];
let txCls=store.get('txcls',['HER2/targeted','chemo']);let txHidden=store.get('txhidden',false);
const KIND={given:{style:'circle',fill:true,r:4.5,label:'Given: confirmed by a hospital dispense record'},
 order:{style:'rectRot',fill:true,r:5,label:'One-time order marked completed (no dispense record)'},
 fill:{style:'rect',fill:true,r:4,label:'Pharmacy fill'},
 assumed:{style:'circle',fill:false,r:2.6,label:'Assumed dose from the prescription schedule (not confirmed)'},
 user:{style:'triangle',fill:true,r:5.5,label:'Taken: confirmed or entered by you'},
 skipped:{style:'crossRot',fill:false,r:5,label:'Skipped: marked by you'}};
const ROWPX=30,BARY=0.17,DAYMS=864e5;
const EMPTY_EDITS=()=>({version:1,ts:0,seg:{},dose:{},added:[]});
const isoD=t=>new Date(t).toISOString().slice(0,10);
const dms=s=>Date.parse(s+'T12:00:00Z');

/* ---- edits: newest of (this browser, local/med_edits.json) wins ---- */
let E=(()=>{const f=D.edits&&D.edits.version?D.edits:null,l=store.get('txedits',null);
 const pick=l&&(!f||(l.ts||0)>=(f.ts||0))?l:f;return Object.assign(EMPTY_EDITS(),pick||{})})();
let txDirty=store.get('txdirty',false);
function saveEdits(){E.ts=Date.now();store.set('txedits',E);txDirty=true;store.set('txdirty',true);txStatus()}

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
    const sch=Object.assign({perDay:1,every:1,on:0,off:0,prn:false},g.sch||{});SCH_KEYS.forEach(k=>{if(ov[k]!=null)sch[k]=ov[k]});e.sch=sch}
   segs.push(e)});
  return Object.assign({},r,{segs,ev:r.ev.slice()})});
 const byKey={};rows.forEach(r=>byKey[r.key]=r);
 const rowFor=(drug,cls,setting)=>{const k=drug.toLowerCase()+'|'+setting;
  if(!byKey[k]){byKey[k]={key:k,drug:drug.toLowerCase(),cls,setting,segs:[],ev:[],ndisp:0,first:'9999'};rows.push(byKey[k])}return byKey[k]};
 (E.added||[]).forEach(m=>{if(!m.drug||!m.a)return;const r=rowFor(m.drug,m.cls||'other',m.setting||'home');
  const sch={perDay:+m.perDay||1,every:+m.every||1,on:+m.on||0,off:+m.off||0,prn:!!m.prn};
  r.segs.push({a:m.a,b:m.b||m.a,src:'you',user:true,uid:m.id,sid:'user:'+m.id,dose:m.dose||'',route:m.route||'',freq:m.freq||'',note:m.note||'',status:m.status||'',sch});
  (m.given||[]).forEach(d=>r.ev.push({d,k:'user',src:'you',dose:m.dose||'',route:m.route||'',text:'entered by you',uid:m.id}))});
 Object.entries(E.dose||{}).forEach(([k,v])=>{if(v!=='taken')return;const i=k.lastIndexOf('|'),r=byKey[k.slice(0,i)];
  if(r)r.ev.push({d:k.slice(i+1),k:'user',src:'you',text:'confirmed by you',doseKey:k})});
 rows.forEach(r=>{r.ev.sort((p,q)=>p.d.localeCompare(q.d));
  r.first=[...r.segs.map(g=>g.a),...r.ev.map(e=>e.d)].sort()[0]||'9999'});
 return rows.filter(r=>r.segs.length||r.ev.length)}
/* next state when you click a dose marker: assumed -> taken -> skipped -> back to assumed */
function nextDoseState(cur){return cur==null?'taken':cur==='taken'?'skipped':null}

/* ---- drawing ---- */
function txRows(){const vis=t=>t>=W.a-DAYMS&&t<=W.b+DAYMS;
 return effRows(TX,E).filter(r=>txCls.includes(r.cls)&&(r.segs.some(g=>dms(g.b)+DAYMS>=W.a&&dms(g.a)<=W.b)||r.ev.some(e=>vis(dms(e.d)))))
  .sort((p,q)=>CLS_ORDER.indexOf(p.cls)-CLS_ORDER.indexOf(q.cls)||p.first.localeCompare(q.first)||p.setting.localeCompare(q.setting))}
const rowLabel=r=>r.drug+(r.setting==='home'?' · taken at home':' · given at hospital/clinic');
function txChips(){const el=$('txCls');el.innerHTML='';const n={};effRows(TX,E).forEach(r=>n[r.cls]=(n[r.cls]||0)+1);
 CLS_ORDER.filter(c=>n[c]).forEach(c=>{const b=document.createElement('button');b.textContent=c+' ('+n[c]+')';b.className=txCls.includes(c)?'on':'';
  b.setAttribute('aria-pressed',txCls.includes(c));b.onclick=()=>{txCls=txCls.includes(c)?txCls.filter(x=>x!==c):[...txCls,c];store.set('txcls',txCls);txChips();render()};el.appendChild(b)})}
function txLegend(){const el=$('txLegend');el.innerHTML='';
 const svg={circle:f=>`<circle cx="7" cy="7" r="4.5" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="1.5"/>`,
  rectRot:()=>'<rect x="3.5" y="3.5" width="7" height="7" transform="rotate(45 7 7)" fill="currentColor"/>',rect:()=>'<rect x="3" y="3" width="8" height="8" fill="currentColor"/>',
  triangle:()=>'<path d="M7 1.5 L12.5 12 L1.5 12 Z" fill="currentColor"/>',crossRot:()=>'<path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" stroke-width="1.8"/>'};
 Object.entries(KIND).forEach(([k,v])=>{const e=document.createElement('span');e.className='shape';
  e.innerHTML='<svg width="14" height="14" aria-hidden="true">'+svg[v.style](v.fill)+'</svg><span></span>';e.lastChild.textContent=v.label;el.appendChild(e)});
 const b=document.createElement('span');b.className='shape';b.innerHTML='<svg width="22" height="10" aria-hidden="true"><rect x="1" y="2" width="20" height="6" rx="2" fill="currentColor" opacity=".35"/></svg><span>Ordered period (dashed: no end date in the record, or as needed; solid outline: changed or entered by you)</span>';el.appendChild(b)}
let txShown=[];
function renderBand(){$('txHide').textContent=txHidden?'Show':'Hide';$('txBody').classList.toggle('hide',txHidden);if(txHidden||(!TX.length&&!E.added.length))return;
 const rows=txRows(),TK=ticks();txShown=rows;$('txEmpty').textContent=rows.length?'':'No treatments of the chosen kinds in this window.';
 $('txBox').classList.toggle('hide',!rows.length);if(!rows.length)return;
 $('txBox').style.height=(rows.length*ROWPX+26)+'px';
 const pts={given:[],order:[],fill:[],assumed:[],user:[],skipped:[]};
 rows.forEach((r,i)=>{const taken=new Set();
  r.ev.forEach(e=>{const t=dms(e.d);if(e.k==='user')taken.add(e.d);if(t>=W.a&&t<=W.b)pts[e.k].push({x:pos(t),y:i+BARY,r,e})});
  if(r.setting==='home')r.segs.forEach(g=>assumedDays(g,W.a,W.b).forEach(t=>{const d=isoD(t),st=E.dose[r.key+'|'+d];if(taken.has(d))return;
   pts[st==='skipped'?'skipped':'assumed'].push({x:pos(t),y:i+BARY,r,e:{d,k:st==='skipped'?'skipped':'assumed',src:g.src,dose:g.dose,freq:g.freq,text:g.text,perDay:g.sch.perDay,doseKey:r.key+'|'+d}})}))});
 const bars={id:'bars',beforeDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();ctx.beginPath();ctx.rect(A.left,A.top-2,A.right-A.left,A.bottom-A.top+4);ctx.clip();
  rows.forEach((r,i)=>{const top=y.getPixelForValue(i-0.5),cy=y.getPixelForValue(i+BARY);
   if(i){ctx.strokeStyle=css('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(A.left,top);ctx.lineTo(A.right,top);ctx.stroke()}
   r.segs.forEach(g=>{const a=Math.max(dms(g.a),W.a),b=Math.min(dms(g.b)+DAYMS*0.9,W.b);if(b<W.a||a>W.b)return;
    const x1=x.getPixelForValue(pos(a)),x2=Math.max(x1+3,x.getPixelForValue(pos(b)));
    ctx.globalAlpha=.35;ctx.fillStyle=css('--ink2');ctx.fillRect(x1,cy-4,x2-x1,8);ctx.globalAlpha=1;
    if(g.user||g.edited){ctx.strokeStyle=css('--ink');ctx.lineWidth=1.2;ctx.strokeRect(x1+.5,cy-4.5,x2-x1-1,9)}
    else if(/no end/.test(g.note||'')||(g.sch&&g.sch.prn)){ctx.setLineDash([3,2]);ctx.strokeStyle=css('--ink2');ctx.strokeRect(x1+.5,cy-4.5,x2-x1-1,9);ctx.setLineDash([])}});
   ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';ctx.fillText(rowLabel(r),A.left+4,top+11)});ctx.restore()}};
 const guide={id:'guide',afterDatasetsDraw(c){if(hoverX==null)return;const{ctx,chartArea:a,scales:{x}}=c;const px=x.getPixelForValue(hoverX);if(px<a.left||px>a.right)return;
  ctx.save();ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';ctx.fillText(iso(unpos(hoverX)),Math.min(px+4,a.right-70),a.bottom-3);ctx.restore()}};
 const col=e=>e.src==='you'?css('--ink'):srcColor(e.src);
 const ds=Object.keys(pts).map(k=>({label:k,data:pts[k],pointStyle:KIND[k].style,pointRadius:KIND[k].r,pointHoverRadius:KIND[k].r+2,
  pointBackgroundColor:pts[k].map(p=>KIND[k].fill?col(p.e):css('--card')),pointBorderColor:pts[k].map(p=>k==='skipped'?css('--ink2'):KIND[k].fill?css('--card'):col(p.e)),
  pointBorderWidth:k==='skipped'?1.8:KIND[k].fill?1:1.3,showLine:false}));
 charts.set('tx',new Chart($('tx'),{type:'scatter',plugins:[bars,guide],data:{datasets:ds},
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
   onHover:(ev,els,c)=>{const xv=c.scales.x.getValueForPixel(ev.x);setHover(xv>=0&&xv<=100?xv:null);txInfo(rows,Math.round(c.scales.y.getValueForPixel(ev.y)),xv);
    c.canvas.style.cursor='pointer'},
   onClick:(ev,els,c)=>txClick(rows,els,c,ev),
   plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>{const p=c[0].raw;return rowLabel(p.r)+' · '+p.e.d},
    label:c=>{const e=c.raw.e;const L=[KIND[e.k].label,[e.dose,e.route,e.k==='assumed'&&e.perDay>1?e.perDay+' doses/day':e.freq,e.qty].filter(Boolean).join(' · ')+(e.src?'  · '+e.src:'')];
     if(e.k==='assumed'||e.k==='skipped'||e.doseKey)L.push(pxPerDay(c.chart)<4?'Click to edit; zoom in to click single doses':'Click to change: taken / skipped / assumed');return L}}}},
   layout:{padding:{right:8}},
   scales:{x:{type:'linear',min:0,max:100,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
     ticks:{color:css('--muted'),autoSkip:false,maxRotation:0,callback:(v,i)=>TK[i]?TK[i].label:''},
     grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}}},
    y:{type:'linear',reverse:true,min:-0.5,max:rows.length-0.5,afterFit:s=>{s.width=YW},ticks:{display:false},grid:{display:false},border:{display:false}}}}}));
 $('txBox').onmouseleave=()=>{setHover(null);$('txInfo').textContent=''}}
function segAt(r,t){return r&&r.segs.find(g=>t>=dms(g.a)-DAYMS/2&&t<=dms(g.b)+DAYMS)}
function txInfo(rows,i,xv){const r=rows[i];if(!r||xv==null){$('txInfo').textContent='';return}
 const g=segAt(r,unpos(xv));
 $('txInfo').textContent=(g?rowLabel(r)+': '+(g.user?'entered by you ':'ordered ')+g.a+' to '+g.b+(g.src&&g.src!=='you'?' · '+g.src:'')+(g.dose?' · '+g.dose:'')+(g.freq?' · '+g.freq:g.sch&&g.sch.perDay>1?' · '+g.sch.perDay+'×/day':'')
  +(g.sch&&g.sch.on?' · '+g.sch.on+' days on / '+g.sch.off+' off':'')+(g.sch&&g.sch.prn?' · as needed (no assumed doses drawn)':'')+(g.note?' · '+g.note:'')+(g.edited?' · changed by you':''):rowLabel(r))+'  — click to edit'+(r.setting==='home'?' or mark doses (zoom to 3 months to click single doses)':'')}

/* ---- clicking ---- */
/* doses can be clicked one by one only when they are at least 4px apart; otherwise open the editor */
const pxPerDay=c=>(c.chartArea.right-c.chartArea.left)*(pos(W.a+DAYMS)-pos(W.a))/100;
function txClick(rows,els,c,ev){
 const hit=els.map(el=>c.data.datasets[el.datasetIndex].data[el.index]).find(p=>p&&(p.e.doseKey||p.e.k==='assumed'));
 if(hit&&pxPerDay(c)<4){openSeg(hit.r,segAt(hit.r,dms(hit.e.d)),hit.e.d);return}
 if(hit){const k=hit.e.doseKey;const nx=nextDoseState(E.dose[k]);if(nx)E.dose[k]=nx;else delete E.dose[k];saveEdits();setTimeout(render,0);return}  // redraw after Chart.js finishes this click
 const xv=c.scales.x.getValueForPixel(ev.x),r=rows[Math.round(c.scales.y.getValueForPixel(ev.y))];if(!r||xv<0||xv>100)return;
 const t=unpos(xv),g=segAt(r,t);if(g&&g.user){openAdd((E.added||[]).find(m=>m.id===g.uid));return}
 openSeg(r,g,isoD(t))}

/* ---- small form helpers ---- */
function field(label,input){const w=document.createElement('label');w.className='fld';const s=document.createElement('span');s.textContent=label;w.append(s,input);return w}
function inp(type,val,attrs){const i=document.createElement(type==='select'||type==='textarea'?type:'input');if(type!=='select'&&type!=='textarea')i.type=type;
 Object.assign(i,attrs||{});if(type==='checkbox')i.checked=!!val;else if(val!=null&&type!=='select')i.value=val;return i}
function selBox(opts,val){const s=inp('select');opts.forEach(o=>{const op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op)});s.value=val;return s}
function btn(text,fn,cls){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;if(cls)b.className=cls;return b}
function panel(title,sub){const p=$('txEdit');p.innerHTML='';p.classList.remove('hide');const h=document.createElement('div');h.className='txh';
 const b=document.createElement('b');b.textContent=title;h.appendChild(b);h.appendChild(Object.assign(document.createElement('span'),{className:'ctl'}));
 h.lastChild.appendChild(btn('Close',()=>{p.classList.add('hide')}));p.appendChild(h);
 if(sub){const s=document.createElement('div');s.className='sub';s.textContent=sub;p.appendChild(s)}
 const g=document.createElement('div');g.className='fgrid';p.appendChild(g);return g}
const num=(v,d)=>{const n=parseFloat(v);return isFinite(n)?n:d};
function schedFields(g,sch){const f={perDay:inp('number',sch.perDay,{min:0,max:12,step:1}),every:inp('number',sch.every,{min:1,max:365,step:1}),
  on:inp('number',sch.on,{min:0,max:365}),off:inp('number',sch.off,{min:0,max:365}),prn:inp('checkbox',sch.prn)};
 g.append(field('Doses per day',f.perDay),field('Every N days',f.every),field('Days on (cycle)',f.on),field('Days off (cycle)',f.off),field('As needed (no assumed doses)',f.prn));return f}
const readSched=f=>({perDay:num(f.perDay.value,1),every:Math.max(1,num(f.every.value,1)),on:num(f.on.value,0),off:num(f.off.value,0),prn:f.prn.checked});

/* edit one bar from the records (or a row without a bar: add doses) */
function openSeg(r,g,clickDate){
 const g0=g&&TX.find(x=>x.key===r.key),orig=g0&&g0.segs.find(x=>segId(g0,x)===g.sid);
 const box=panel('Edit: '+rowLabel(r),g?'From the record: '+(orig?orig.a+' to '+orig.b+(orig.src?' · '+orig.src:'')+(orig.text?' · '+orig.text:''):'')+'. Your changes are kept separately; the record itself is not changed.':'No ordered period here. You can add a dose you took on a date.');
 if(g){const a=inp('date',g.a),b=inp('date',g.b),dose=inp('text',g.dose||''),note=inp('text',g.note||'',{size:40}),hide=inp('checkbox',false);
  box.append(field('Start',a),field('End',b),field('Dose',dose));
  const f=r.setting==='home'?schedFields(box,Object.assign({perDay:1,every:1,on:0,off:0,prn:false},g.sch||{})):null;
  box.append(field('Note',note),field('Hide this bar',hide));
  const act=document.createElement('div');act.className='bar';act.style.marginTop='10px';
  act.append(btn('Save',()=>{if(b.value<a.value){alert('End is before start.');return}
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
function openAdd(m){const isNew=!m;m=m||{id:'m'+Date.now().toString(36),drug:'',cls:'other',setting:'home',dose:'',route:'',freq:'',a:isoD(Math.min(Date.now(),W.b)),b:'',status:'active',
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
 act.append(btn('Save',()=>{const drug=F.drug.value.trim();if(!drug){alert('Enter a drug name.');return}if(!F.a.value){alert('Enter a start date.');return}
   if(F.b.value&&F.b.value<F.a.value){alert('End is before start.');return}
   const given=F.given.value.split(/[\s,;]+/).filter(Boolean),bad=given.filter(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||isNaN(dms(x)));
   if(bad.length){alert('Not a date (use YYYY-MM-DD): '+bad.join(', '));return}
   const rec=Object.assign({},m,{drug,cls:F.cls.value,setting:F.setting.value,dose:F.dose.value,route:F.route.value,freq:F.freq.value,a:F.a.value,b:F.b.value,
    status:F.status.value,note:F.note.value,given:[...new Set(given)].sort()},readSched(S));
   E.added=(E.added||[]).filter(x=>x.id!==rec.id).concat([rec]);if(!txCls.includes(rec.cls)){txCls.push(rec.cls);store.set('txcls',txCls)}
   saveEdits();$('txEdit').classList.add('hide');txChips();render()},'on'));
 if(!isNew)act.appendChild(btn('Delete',()=>{if(!confirm('Delete '+m.drug+' (entered by you)?'))return;E.added=E.added.filter(x=>x.id!==m.id);saveEdits();$('txEdit').classList.add('hide');txChips();render()}));
 $('txEdit').appendChild(act);F.drug.focus()}

/* ---- export / import ---- */
function nEdits(){return Object.keys(E.seg).length+Object.keys(E.dose).length+(E.added||[]).length}
function txStatus(){const n=nEdits();$('txStatus').textContent=n?n+' change'+(n>1?'s':'')+(txDirty?' · not exported yet':' · exported'):''}
function exportEdits(){const blob=new Blob([JSON.stringify(E,null,1)],{type:'application/json'});const a=document.createElement('a');
 a.href=URL.createObjectURL(blob);a.download='med_edits.json';document.body.appendChild(a);a.click();a.remove();
 txDirty=false;store.set('txdirty',false);txStatus();
 alert('Saved med_edits.json to your Downloads folder.\nMove it into the project\'s local/ folder, then rebuild:\n  python3 flatten_meds.py && python3 make_lab_view.py')}
function importEdits(file){const rd=new FileReader();rd.onload=()=>{try{const j=JSON.parse(rd.result);if(!j||j.version!==1)throw new Error('not a med_edits.json file');
  if(nEdits()&&!confirm('Replace the '+nEdits()+' changes in this browser with the file?'))return;
  E=Object.assign(EMPTY_EDITS(),j);store.set('txedits',E);txDirty=false;store.set('txdirty',false);txStatus();txChips();render()}catch(e){alert('Could not read the file: '+e.message)}};rd.readAsText(file)}
function txInit(){if(!TX.length&&!E.added.length&&!D.tx)$('txCard').classList.add('hide');
 $('txHide').onclick=()=>{txHidden=!txHidden;store.set('txhidden',txHidden);render()};
 $('txAdd').onclick=()=>{if(txHidden){txHidden=false;store.set('txhidden',false);render()}openAdd(null)};
 $('txExport').onclick=exportEdits;$('txImport').onclick=()=>$('txFile').click();$('txFile').onchange=e=>{if(e.target.files[0])importEdits(e.target.files[0]);e.target.value=''};
 txChips();txLegend();txStatus()}
