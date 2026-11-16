/* ---- Concern graph in the Moments panel ----
   Draws every shown moment that has a concern rating (E.moments[].concern, 1-10, set in the Moment editor) as a dot
   on the same time axis as every other chart: green (1) → amber (5) → red (10); a period moment (with an end date)
   also gets a bar to its end; a faint line joins the dots. The two-handled "Concern" range picks which rated
   moments are drawn (kept per browser as labs.msrange; ?msLo=&msHi= in the address sets it, used by the private
   milestones list page). Hover a dot: title, date, note and why it got that rating. Click: the window moves to the
   moment (goMoment: the same as stepping with ◀ ▶) and it is ringed. Double-click: opens it in the Moment editor.
   "List ↗" opens the private milestones list (record excerpts and original PDF pages) at that moment.
   Everything here is a function declaration or var: render() runs before this file's code (inlined at the end).
   Moment fields used here: concern (number), why (text), good (true = good news), rated_by ('family' | 'draft'). */
var MS_PAGE='http://127.0.0.1:8771/open-health-data-presets/local/milestones.html';
function msCol(c){const s=[[1,[27,175,122]],[5,[226,160,40]],[7.5,[235,104,52]],[10,[200,40,40]]];
 for(let i=1;i<s.length;i++)if(c<=s[i][0]){const[a,ca]=s[i-1],[b,cb]=s[i],f=(c-a)/(b-a);return'rgb('+ca.map((v,j)=>Math.round(v+(cb[j]-v)*f)).join(',')+')'}return'rgb(200,40,40)'}
function msRated(){return(E.moments||[]).filter(m=>m.date&&typeof m.concern==='number'&&isFinite(m.concern))}
function msTe(m){return m.end?ms(m.end):null}
function msRange(){const r=store.get('msrange',{lo:1,hi:10});return{lo:+r.lo||1,hi:+r.hi||10}}
function msIn(m){const r=msRange();return m.concern>=r.lo&&m.concern<=r.hi}
function msInit(){const row=$('msRow');if(!row)return;row.classList.remove('hide');
 {const q=new URLSearchParams(location.search),lo=+q.get('msLo'),hi=+q.get('msHi');if(lo>=1&&hi<=10&&lo<=hi)store.set('msrange',{lo,hi})}
 const LO=$('msLo'),HI=$('msHi'),r=msRange();LO.value=r.lo;HI.value=r.hi;
 const upd=e=>{if(+LO.value>+HI.value){if(e&&e.target===LO)LO.value=HI.value;else HI.value=LO.value}
  store.set('msrange',{lo:+LO.value,hi:+HI.value});renderConcern()};
 LO.oninput=upd;HI.oninput=upd;
 $('msList').onclick=()=>{const r=msRange();window.open(MS_PAGE+'?lo='+r.lo+'&hi='+r.hi+(momCur?'#'+momCur:''),'_blank')}}
function msControls(){const{lo,hi}=msRange(),p=v=>(v-1)/9*100,F=$('msFill');F.style.left=p(lo)+'%';F.style.width=(p(hi)-p(lo))+'%';
 $('msLo').style.zIndex=lo>=9.5?3:2;$('msRv').textContent=lo===1&&hi===10?'all':lo===hi?String(lo):lo+' – '+hi;
 const R=msRated(),n=R.filter(m=>momentOn(m)&&msIn(m)).length,inW=R.filter(m=>momentOn(m)&&msIn(m)&&(msTe(m)||momentT(m))>=W.a&&momentT(m)<=W.b).length;
 $('msCount').textContent=n+' of '+R.length+' rated moments · '+inW+' in this window'}
function renderConcern(){const cv=$('msc');if(!cv)return;msControls();const TK=ticks();
 if(charts.has('msc')){charts.get('msc').destroy();charts.delete('msc')}
 const shown=msRated().filter(m=>momentOn(m)&&msIn(m)).sort((a,b)=>momentT(a)-momentT(b));
 const pts=shown.map(m=>({x:pos(momentT(m)),y:m.concern,m}));
 const deco={id:'msdeco',beforeDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();
   [1,5,10].forEach(v=>{const py=y.getPixelForValue(v);ctx.strokeStyle=css('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(A.left,py);ctx.lineTo(A.right,py);ctx.stroke();
    ctx.fillStyle=css('--muted');ctx.font='10px system-ui';ctx.textAlign='right';ctx.fillText(String(v),A.left-6,py+3)});
   shown.forEach(m=>{const te=msTe(m);if(!te)return;const a=Math.max(momentT(m),W.a),b=Math.min(te,W.b);if(b<W.a||a>W.b)return;
    const x1=x.getPixelForValue(pos(a)),x2=x.getPixelForValue(pos(b)),py=y.getPixelForValue(m.concern);
    ctx.globalAlpha=.45;ctx.strokeStyle=msCol(m.concern);ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,py);ctx.lineTo(Math.max(x1+2,x2),py);ctx.stroke();ctx.globalAlpha=1});
   if(!shown.length){ctx.fillStyle=css('--muted');ctx.font='10px system-ui';ctx.textAlign='left';
    ctx.fillText(msRated().length?'no rated moments in this concern range':'give a moment a concern rating (1–10) in its editor to see it here',A.left+4,A.top+12)}
   ctx.restore()},
  afterDatasetsDraw(c){const{ctx,chartArea:A,scales:{x,y}}=c;ctx.save();
   shown.forEach(m=>{if(m.id!==momCur)return;const px=x.getPixelForValue(pos(momentT(m))),py=y.getPixelForValue(m.concern);if(px<A.left||px>A.right)return;
    ctx.beginPath();ctx.arc(px,py,9,0,7);ctx.lineWidth=2;ctx.strokeStyle=msCol(m.concern);ctx.stroke()});
   if(hoverX!=null){const px=x.getPixelForValue(hoverX);if(px>=A.left&&px<=A.right){ctx.setLineDash([3,3]);ctx.strokeStyle=css('--ink2');ctx.beginPath();ctx.moveTo(px,A.top);ctx.lineTo(px,A.bottom);ctx.stroke()}}
   ctx.restore()}};
 const ch=new Chart(cv,{type:'scatter',plugins:[deco,momentPlugin],data:{datasets:[{data:pts,showLine:true,borderColor:css('--muted')+'55',borderWidth:1,
   pointRadius:pts.map(p=>3+p.y/2.5),pointHoverRadius:pts.map(p=>5+p.y/2.5),pointBackgroundColor:pts.map(p=>msCol(p.y)),pointBorderColor:css('--card'),pointBorderWidth:1.5}]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,layout:{autoPadding:false,padding:{top:6,right:8,bottom:4}},
   onHover:(e,els,c)=>{const xv=c.scales.x.getValueForPixel(e.x);setHover(xv>=0&&xv<=100?xv:null);c.canvas.style.cursor=els.length?'pointer':''},
   onClick:(e,els,c)=>{if(els[0]){$('mtip').classList.add('hide');goMoment(c.data.datasets[0].data[els[0].index].m)}},
   plugins:{legend:{display:false},tooltip:{enabled:false,external:({chart,tooltip})=>{const el=$('mtip');if(!tooltip.opacity||!tooltip.dataPoints||!tooltip.dataPoints.length){el.classList.add('hide');return}
     const m=tooltip.dataPoints[0].raw.m;el.innerHTML='';const h=document.createElement('b');h.textContent=m.concern+' · '+m.title;h.style.color=msCol(m.concern);el.appendChild(h);
     [m.date+(m.end?' → '+m.end:'')+(m.good?' · ✓ good news':''),m.note?(m.note.length>220?m.note.slice(0,219)+'…':m.note):'',m.why?'Why '+m.concern+': '+m.why:'',
      (m.rated_by==='family'?'family rating':'draft rating')+((m.links||[]).length?' · '+m.links.length+' linked reading'+(m.links.length>1?'s':''):'')+((m.sources||[]).length?' · '+m.sources.length+' record source'+(m.sources.length>1?'s':''):''),
      'click: go there · double-click: open the moment']
      .filter(Boolean).forEach(t=>{const d=document.createElement('div');d.textContent=t;el.appendChild(d)});
     const r=chart.canvas.getBoundingClientRect();el.style.left=Math.min(r.left+tooltip.caretX+12,innerWidth-330)+'px';el.style.top=(r.top+tooltip.caretY+14)+'px';el.classList.remove('hide')}}},
   scales:{x:{type:'linear',min:0,max:100,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},ticks:{display:false},grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}},border:{display:false}},
    y:{min:0,max:10.8,afterFit:s=>{s.width=YW},ticks:{display:false},grid:{display:false},border:{display:false}}}}});
 charts.set('msc',ch);
 cv.ondblclick=e=>{const el=ch.getElementsAtEventForMode(e,'nearest',{intersect:true},false)[0];if(el){$('mtip').classList.add('hide');openMoment(ch.data.datasets[0].data[el.index].m)}};
 cv.parentNode.onmouseleave=()=>{setHover(null);$('mtip').classList.add('hide')}}
msInit();renderConcern();
