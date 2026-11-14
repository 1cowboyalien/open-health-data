#!/usr/bin/env python3
"""Build a local, private lab-results viewer (HTML) from a flattened lab TSV.

Usage:
    python3 flatten_labs.py          # builds local/labs_all.tsv from every hospital
    python3 make_lab_view.py [local/labs_all.tsv] [local/labs.html]

If local/meds_all.tsv exists (python3 flatten_meds.py), a treatment band is drawn above the
lab charts on the same time axis (rows: med_timeline.py; drawing and editing: med_timeline.js).
Changes made in the viewer can be exported to local/med_edits.json; it is built back in here.

The same test from different hospitals is combined by LOINC code (by name when there's
no LOINC) and unit; each point keeps its source hospital.
The output embeds the data and stays on this computer (local/ is git-ignored).
Charting uses Chart.js from cdnjs; no data is sent anywhere.
"""
import csv
import json
import os
import sys
from collections import Counter, defaultdict

import med_timeline

src = sys.argv[1] if len(sys.argv) > 1 else "local/labs_all.tsv"
out = sys.argv[2] if len(sys.argv) > 2 else "local/labs.html"

rows = list(csv.DictReader(open(src), delimiter="\t"))
series = defaultdict(lambda: {"panels": Counter(), "names": Counter(), "units": Counter(), "loincs": set(), "pts": []})
sources = sorted({s for r in rows for s in r["source"].split("+")})
for r in rows:
    if r["value"] == "":
        continue
    key = ("concept:" + r["concept"] if r.get("concept") else r["loinc_code"] or "name:" + r["measurement"].lower(), r["unit"].lower())
    s = series[key]
    s["panels"][r["panel_name"] or "Other"] += 1
    s["names"][r["measurement"].replace(" (LabDAQ)", "").strip()] += 1
    s["units"][r["unit"]] += 1
    if r["loinc_code"]:
        s["loincs"].add(r["loinc_code"])
    s["pts"].append({
        "date": r["date"], "v": float(r["value"]), "q": r["value_qualifier"], "flag": r["flag"],
        "src": r["source"], "name": r["measurement"],
        "lo": float(r["reference_low"]) if r["reference_low"] else None,
        "hi": float(r["reference_high"]) if r["reference_high"] else None,
    })

tests = []
for (code, unit), s in series.items():
    pts = sorted(s["pts"], key=lambda p: p["date"])
    tests.append({
        "name": code[8:] if code.startswith("concept:") else s["names"].most_common(1)[0][0],
        "unit": s["units"].most_common(1)[0][0],
        "loinc": ", ".join(sorted(s["loincs"])),
        "panel": s["panels"].most_common(1)[0][0], "n": len(pts),
        "flagged": sum(1 for p in pts if p["flag"]),
        "sources": sorted({x for p in pts for x in p["src"].split("+")}), "pts": pts,
        "id": f"{code}|{unit}",
    })
tests.sort(key=lambda t: (-t["n"], t["name"]))
# One fixed time axis for every chart: from the month of the earliest result of any kind
# to the end of the month of the latest, so charts line up when switching tests.
# Time before COMPRESS_BEFORE is squeezed into the first COMPRESS_WIDTH of the axis, so the
# busy recent period gets most of the room. Set COMPRESS_BEFORE = None for a plain axis.
COMPRESS_BEFORE = "2023-05-01"
COMPRESS_WIDTH = 0.15
all_dates = sorted(r["date"] for r in rows if r["date"])
span = [all_dates[0][:7] + "-01", all_dates[-1]]
brk = COMPRESS_BEFORE if COMPRESS_BEFORE and span[0] < COMPRESS_BEFORE < span[1] else None
here = os.path.dirname(os.path.abspath(src))
tx = med_timeline.build(os.path.join(here, "meds_all.tsv"), os.path.join(here, "med_dispenses.tsv"))
# hospitals seen only in medications go after the lab ones, so lab colors don't shift
sources += sorted(({e["src"] for r in tx for e in r["ev"]} | {g["src"] for r in tx for g in r["segs"] if g["src"]}) - set(sources))
edits_file = os.path.join(here, "med_edits.json")
edits = json.load(open(edits_file)) if os.path.exists(edits_file) else None
data = json.dumps({"tests": tests, "sources": sources, "span": span, "tx": tx, "edits": edits,
                   "brk": brk, "brkw": COMPRESS_WIDTH}, separators=(",", ":"))

html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lab results</title>
<style>
:root{--bg:#fbfbfa;--card:#fff;--ink:#141413;--ink2:#5e5d59;--muted:#8a8984;--line:#e6e5e0;--accent:#2a78d6;--band:rgba(27,175,122,.12);--hi:#d03b3b;--lo:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#232322;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8a8984;--line:#383835;--accent:#3987e5;--band:rgba(27,175,122,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:100vh}
aside{border-right:1px solid var(--line);padding:16px;overflow:auto;max-height:100vh;position:sticky;top:0}
main{padding:20px 24px;min-width:0}
h1{font-size:20px;font-weight:600;margin:0 0 4px}h2{font-size:17px;font-weight:600;margin:0}
.sub{color:var(--ink2);font-size:13px}
input[type=search]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit;margin:12px 0 6px}
.t{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:14px}
.t:hover{background:var(--line)}.t.on{background:var(--accent);color:#fff}.t .n{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap}.t.on .n{color:#fff}
.t input{margin:0;flex:none;width:15px;height:15px;cursor:pointer}.t .nm{min-width:0;overflow:hidden;text-overflow:ellipsis}
.grp{font-size:12px;color:var(--muted);margin:14px 8px 4px;text-transform:uppercase;letter-spacing:.04em}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:14px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.stat{background:var(--bg);border-radius:8px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:20px;font-weight:600}.stat span{font-size:12px;color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--ink2);font-weight:500}
.H{color:var(--hi);font-weight:600}.L{color:var(--lo);font-weight:600}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--muted)}button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.win{font-size:13px}.wrow{display:flex;align-items:center;gap:10px;margin:4px 0}.wl{width:36px;color:var(--ink2)}
.wrow input{flex:1;margin:0}.wrow b{min-width:92px;font-weight:600}.wbtn{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.wbtn button{font-size:12px;padding:4px 10px}
.cmp{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px 6px;margin-top:8px}
.cmph{display:flex;align-items:center;gap:8px;font-size:13px}.cmph b{font-weight:600}.cmph .u{color:var(--ink2)}
.cmph .ctl{margin-left:auto;display:flex;align-items:center;gap:4px}.cmph .ctl button{padding:1px 8px;font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:13px;color:var(--ink2)}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.hide{display:none!important}
.txh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}.txh b{font-size:15px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:5px}.chips button{font-size:12px;padding:2px 9px;border-radius:12px}
.txh .ctl{margin-left:auto;display:flex;gap:4px}.txh .ctl button{padding:1px 8px;font-size:12px}
#txInfo{min-height:20px;margin-top:4px}.shape{display:inline-flex;align-items:center;gap:5px}
#txEdit{border-top:1px solid var(--line);margin-top:10px;padding-top:10px}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 12px;margin-top:8px}
.fld{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--ink2)}
.fld input,.fld select,.fld textarea{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}
.fld input[type=checkbox]{width:16px;height:16px;align-self:flex-start}
@media (max-width:760px){.wrap{grid-template-columns:1fr}aside{position:static;max-height:40vh;border-right:0;border-bottom:1px solid var(--line)}main{padding:14px}}
</style></head><body>
<div class="wrap">
<aside><h1>Lab results</h1><div class="sub" id="meta"></div>
<input type="search" id="q" placeholder="Filter tests" aria-label="Filter tests">
<div class="sub">Click a name to view it. Tick boxes to compare several.</div>
<div id="list"></div></aside>
<main>
<div class="bar"><button id="mSingle">One test</button><button id="mCompare">Compare selected (0)</button><button id="clr">Clear selection</button>
<span class="sub" style="margin-left:auto" id="hint"></span></div>
<div class="card win">
<div class="wrow"><span class="wl">From</span><input type="range" id="wa" aria-label="Window start"><b id="wal"></b></div>
<div class="wrow"><span class="wl">To</span><input type="range" id="wb" aria-label="Window end"><b id="wbl"></b></div>
<div class="wbtn"><button data-p="all">All</button><button data-p="brk">Since May 2023</button><button data-p="24">Last 2 yrs</button><button data-p="12">Last 12 mo</button><button data-p="6">Last 6 mo</button><button data-p="3">Last 3 mo</button></div>
<div class="legend" id="srcLegend"></div>
</div>
<div class="card" id="txCard">
<div class="txh"><b>Treatments</b><span class="chips" id="txCls"></span>
<span class="ctl"><span class="sub" id="txStatus"></span><button id="txAdd">+ Add medication</button><button id="txExport" title="Save your changes to a file (med_edits.json)">Export</button><button id="txImport" title="Load changes from med_edits.json">Import</button><button id="txHide" title="Show or hide the treatment band">Hide</button></span>
<input type="file" id="txFile" accept="application/json,.json" class="hide"></div>
<div id="txBody"><div style="position:relative;margin-top:6px" id="txBox"><canvas id="tx" role="img" aria-label="Treatment timeline: bars are ordered periods, markers are doses"></canvas></div>
<div class="sub" id="txEmpty"></div><div class="sub" id="txInfo"></div>
<div id="txEdit" class="hide"></div>
<div class="legend" id="txLegend"></div></div></div>
<section id="single">
<div style="margin-top:16px"><h2 id="title"></h2><div class="sub" id="desc"></div></div>
<div class="stats" id="stats"></div>
<div class="card"><div style="position:relative" id="sbox"><canvas id="c" role="img" aria-label="Trend of the selected lab test with its normal range shaded"></canvas></div>
<div class="bar" style="margin-top:8px"><span class="sub">Height</span><button data-h="-">−</button><button data-h="+">+</button></div></div>
<div class="card"><table id="tbl"></table></div>
</section>
<section id="compare" class="hide"><div id="cmpList"></div>
<div class="sub" id="cmpEmpty" style="margin-top:14px">Tick the boxes next to tests in the list to stack them here on the same time scale.</div></section>
<div class="sub" style="margin-top:12px">Point color = hospital. Shaded band = normal range (latest result). Larger points with a red ring = flagged high, blue ring = flagged low. In wide windows, time before May 2023 is compressed left of the darker vertical line. Window, selection and heights are remembered in this browser.
Treatments: bars show the periods drugs were <i>ordered</i> for (from the hospitals' records); marker shape tells how sure a dose is (see the legend). Assumed doses are drawn from the prescription's schedule and are not in any record. Click a bar to correct it, click an assumed dose to mark it taken or skipped, or add a medication; your changes stay in this browser until you export them. This is a view of records, not medical advice: check doses with the care team.</div>
</main></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
const D=__DATA__;const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $=id=>document.getElementById(id);
const fmt=v=>(Math.round(v*1000)/1000).toString();
const store={get(k,d){try{const v=JSON.parse(localStorage.getItem('labs.'+k));return v==null?d:v}catch(e){return d}},
 set(k,v){try{localStorage.setItem('labs.'+k,JSON.stringify(v))}catch(e){}}};
const PAL=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6','#e34948'];
const SC={};D.sources.forEach((s,i)=>SC[s]=PAL[i%PAL.length]);
const srcColor=s=>SC[s.split('+')[0]]||'#888';
const BYID={};D.tests.forEach(t=>BYID[t.id]=t);
const ms=d=>Date.parse(d+'T12:00:00Z');const DAY=864e5;
const X0=ms(D.span[0]);const _e=new Date(ms(D.span[1]));const X1=Date.UTC(_e.getUTCFullYear(),_e.getUTCMonth()+1,1);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BRK=D.brk?ms(D.brk):null,FR=D.brk?D.brkw:0,NDAYS=Math.round((X1-X0)/DAY);
const YW=64;
let W=store.get('window',{a:X0,b:X1});if(!(W.a>=X0&&W.b<=X1&&W.b-W.a>=14*DAY))W={a:X0,b:X1};
let mode=store.get('mode','single');
let cur=store.get('current',D.tests[0].id);if(!BYID[cur])cur=D.tests[0].id;
let sel=store.get('selected',[]).filter(id=>BYID[id]);
let heights=store.get('heights',{});
let hoverX=null;const charts=new Map();

function compressing(){return BRK!=null&&W.a<BRK&&W.b>BRK&&(W.b-W.a)>3*365*DAY}
function pos(t){const a=W.a,b=W.b;if(!compressing())return 100*(t-a)/(b-a);
 const f=FR*(BRK-a)/(BRK-X0);return t<BRK?100*f*(t-a)/(BRK-a):100*f+100*(1-f)*(t-BRK)/(b-BRK)}
function unpos(x){const a=W.a,b=W.b;if(!compressing())return a+(b-a)*x/100;
 const f=FR*(BRK-a)/(BRK-X0);return x<100*f?a+(BRK-a)*x/(100*f):BRK+(b-BRK)*(x-100*f)/(100*(1-f))}
function ticks(){const T=[],a=W.a,b=W.b,months=(b-a)/(30.44*DAY),c=compressing();
 const step=months>30?3:months>14?2:1;
 for(let d=new Date(Date.UTC(new Date(a).getUTCFullYear(),new Date(a).getUTCMonth(),1));d.getTime()<=b;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))){
  const t=d.getTime(),m=d.getUTCMonth();if(t<a)continue;const early=c&&t<BRK;
  if(early?m===0:m%step===0)T.push({value:pos(t),label:m===0?String(d.getUTCFullYear()):MON[m]+(step===1&&months<6?' '+String(d.getUTCFullYear()).slice(2):''),year:m===0});
  if(months<4){const mid=Date.UTC(d.getUTCFullYear(),m,15);if(mid>=a&&mid<=b)T.push({value:pos(mid),label:'15'})}}
 if(c)T.push({value:pos(BRK),label:'',brk:true});return T}
const iso=t=>new Date(t).toISOString().slice(0,10);
const inWin=x=>{const t=ms(x.date);return t>=W.a&&t<=W.b};

/* one chart for one test; used by both modes */
function makeChart(canvas,t,opt){
 const p=t.pts,last=p[p.length-1],lo=last.lo,hi=last.hi,pv=p.filter(inWin),TK=ticks();
 const vv=pv.length?pv.map(x=>x.v):p.map(x=>x.v);
 const ymin=Math.min(...vv,lo??Infinity),ymax=Math.max(...vv,hi??-Infinity),pad=(ymax-ymin)*.1||1;
 const band={id:'band',beforeDatasetsDraw(c){if(lo==null&&hi==null)return;const{ctx,chartArea:a,scales:{y}}=c;const top=hi!=null?y.getPixelForValue(hi):a.top,bot=lo!=null?y.getPixelForValue(lo):a.bottom;ctx.save();ctx.fillStyle=css('--band');ctx.fillRect(a.left,Math.max(a.top,top),a.right-a.left,Math.min(a.bottom,bot)-Math.max(a.top,top));ctx.restore()}};
 const guide={id:'guide',afterDatasetsDraw(c){if(hoverX==null)return;const{ctx,chartArea:a,scales:{x}}=c;const px=x.getPixelForValue(hoverX);if(px<a.left||px>a.right)return;
  ctx.save();ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();
  if(opt.dateLabel){ctx.setLineDash([]);ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';ctx.fillText(iso(unpos(hoverX)),Math.min(px+4,a.right-70),a.top+11)}ctx.restore()}};
 return new Chart(canvas,{type:'line',plugins:[band,guide],
  data:{datasets:[{label:t.name,data:pv.map(x=>({x:pos(ms(x.date)),y:x.v})),borderColor:css('--muted'),
   pointBackgroundColor:pv.map(x=>srcColor(x.src)),pointBorderColor:pv.map(x=>/H/.test(x.flag)?'#d03b3b':/L/.test(x.flag)?'#2a78d6':css('--card')),
   pointBorderWidth:pv.map(x=>x.flag?2.5:1.5),pointRadius:pv.map(x=>x.flag?(opt.compact?5:6):(opt.compact?3:4)),pointHoverRadius:7,borderWidth:1.5,tension:0}]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
   onHover:(e,els,c)=>{const xv=c.scales.x.getValueForPixel(e.x);setHover(xv>=0&&xv<=100?xv:null)},
   plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>pv[c[0].dataIndex].date,label:c=>{const x=pv[c.dataIndex];return (x.q||'')+fmt(x.v)+' '+t.unit+(x.flag?'  ['+x.flag+']':'')+'  · '+x.src+(x.name!==t.name?' ('+x.name+')':'')}}}},
   layout:{padding:{right:8}},
   scales:{x:{type:'linear',min:0,max:100,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
     ticks:{display:opt.showX!==false,color:css('--muted'),autoSkip:false,maxRotation:0,callback:(v,i)=>TK[i]?TK[i].label:''},
     grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}}},
    y:{min:ymin-pad,max:ymax+pad,afterFit:s=>{s.width=YW},ticks:{color:css('--muted'),maxTicksLimit:opt.compact?4:8},grid:{color:css('--line')}}}}});
}
function setHover(xv){if(xv===hoverX)return;hoverX=xv;charts.forEach(c=>c.draw())}

__TXJS__

function list(){const q=$('q').value.toLowerCase();const el=$('list');el.innerHTML='';
 const groups={};D.tests.forEach(t=>{if(q&&!t.name.toLowerCase().includes(q))return;(groups[t.panel]=groups[t.panel]||[]).push(t)});
 Object.keys(groups).sort().forEach(g=>{const h=document.createElement('div');h.className='grp';h.textContent=g;el.appendChild(h);
  groups[g].forEach(t=>{const d=document.createElement('div');d.className='t'+(mode==='single'&&t.id===cur?' on':'');
   const cb=document.createElement('input');cb.type='checkbox';cb.checked=sel.includes(t.id);cb.setAttribute('aria-label','Compare '+t.name);
   cb.onclick=e=>{e.stopPropagation();toggle(t.id,cb.checked)};
   const nm=document.createElement('span');nm.className='nm';nm.textContent=t.name;
   const n=document.createElement('span');n.className='n';n.textContent=t.n+(t.flagged?' · '+t.flagged+'⚑':'');
   d.append(cb,nm,n);d.onclick=()=>{cur=t.id;store.set('current',cur);setMode('single')};el.appendChild(d)})})}
function toggle(id,on){sel=sel.filter(x=>x!==id);if(on)sel.push(id);store.set('selected',sel);updateBar();if(mode==='compare')render()}
function setMode(m){mode=m;store.set('mode',m);updateBar();list();render()}
function updateBar(){$('mCompare').textContent='Compare selected ('+sel.length+')';$('mSingle').className=mode==='single'?'on':'';$('mCompare').className=mode==='compare'?'on':'';
 $('single').classList.toggle('hide',mode!=='single');$('compare').classList.toggle('hide',mode!=='compare');
 $('hint').textContent=mode==='compare'?'Hover any chart to line up a date across all of them.':''}
function hOf(id,def){return heights[id]||def}
function setH(id,h){heights[id]=Math.max(70,Math.min(600,h));store.set('heights',heights)}

function render(){charts.forEach(c=>c.destroy());charts.clear();hoverX=null;
 renderBand();if(mode==='single')renderSingle();else renderCompare()}
function renderSingle(){const t=BYID[cur],p=t.pts,last=p[p.length-1],lo=last.lo,hi=last.hi,vals=p.map(x=>x.v),pv=p.filter(inWin);
 $('title').textContent=t.name+(t.unit?' ('+t.unit+')':'');
 $('desc').textContent=pv.length+' of '+p.length+' results in window · '+t.panel+' · all results '+p[0].date+' to '+last.date+' · '+t.sources.join(', ')+(t.loinc?' · LOINC '+t.loinc:'');
 const st=[['Latest',(last.q||'')+fmt(last.v),last.date],['Normal range',(lo!=null?fmt(lo):'')+' – '+(hi!=null?fmt(hi):''),t.unit],['Min / max',fmt(Math.min(...vals))+' / '+fmt(Math.max(...vals)),p.length+' results'],['Flagged',t.flagged,'of '+p.length]];
 $('stats').innerHTML='';st.forEach(s=>{const e=document.createElement('div');e.className='stat';e.innerHTML='<span></span><b></b><span></span>';[0,1,2].forEach(i=>e.children[i].textContent=s[i]);$('stats').appendChild(e)});
 $('sbox').style.height=hOf(t.id+'#single',340)+'px';
 charts.set('single',makeChart($('c'),t,{compact:false,dateLabel:false}));
 const tb=$('tbl');tb.innerHTML='<tr><th>Date</th><th>Value</th><th>Range</th><th>Flag</th><th>Hospital</th></tr>';
 [...pv].reverse().forEach(x=>{const r=tb.insertRow();[x.date,(x.q||'')+fmt(x.v),(x.lo!=null?fmt(x.lo):'')+' – '+(x.hi!=null?fmt(x.hi):''),x.flag,x.src].forEach((v,i)=>{const c=r.insertCell();c.textContent=v;if(i===3&&v)c.className=/H/.test(v)?'H':'L'})})}
function renderCompare(){const box=$('cmpList');box.innerHTML='';$('cmpEmpty').classList.toggle('hide',sel.length>0);
 sel.forEach((id,i)=>{const t=BYID[id];const w=document.createElement('div');w.className='cmp';
  const h=document.createElement('div');h.className='cmph';
  const b=document.createElement('b');b.textContent=t.name;const u=document.createElement('span');u.className='u';u.textContent=t.unit||'';
  const ctl=document.createElement('span');ctl.className='ctl';
  const mk=(label,title,fn)=>{const x=document.createElement('button');x.textContent=label;x.title=title;x.setAttribute('aria-label',title);x.onclick=fn;ctl.appendChild(x)};
  mk('↑','Move up',()=>{if(i>0){[sel[i-1],sel[i]]=[sel[i],sel[i-1]];store.set('selected',sel);render()}});
  mk('↓','Move down',()=>{if(i<sel.length-1){[sel[i+1],sel[i]]=[sel[i],sel[i+1]];store.set('selected',sel);render()}});
  mk('−','Shorter',()=>{setH(id,hOf(id,160)-40);render()});
  mk('+','Taller',()=>{setH(id,hOf(id,160)+40);render()});
  mk('×','Remove from comparison',()=>{toggle(id,false);list()});
  h.append(b,u,ctl);
  const cb=document.createElement('div');cb.style.cssText='position:relative;height:'+hOf(id,160)+'px';
  const cv=document.createElement('canvas');cv.setAttribute('role','img');cv.setAttribute('aria-label','Trend of '+t.name);cb.appendChild(cv);
  w.append(h,cb);box.appendChild(w);
  charts.set(id,makeChart(cv,t,{compact:true,dateLabel:i===0,showX:true}))});
 box.onmouseleave=()=>setHover(null)}

const wa=$('wa'),wb=$('wb');[wa,wb].forEach(e=>{e.min=0;e.max=NDAYS;e.step=1});
function syncWin(){wa.value=Math.round((W.a-X0)/DAY);wb.value=Math.round((W.b-X0)/DAY);$('wal').textContent=iso(W.a);$('wbl').textContent=iso(Math.min(W.b,ms(D.span[1])))}
function setWin(a,b){a=Math.max(X0,Math.min(a,X1-14*DAY));b=Math.min(X1,Math.max(b,a+14*DAY));W={a,b};store.set('window',W);syncWin();render()}
wa.oninput=()=>{const a=X0+wa.value*DAY;setWin(a,Math.max(W.b,a+14*DAY))};
wb.oninput=()=>{const b=X0+wb.value*DAY;setWin(Math.min(W.a,b-14*DAY),b)};
document.querySelectorAll('.wbtn button').forEach(btn=>btn.onclick=()=>{const p=btn.dataset.p;
 if(p==='all')setWin(X0,X1);else if(p==='brk')setWin(BRK??X0,X1);else{const e=new Date(X1);setWin(Date.UTC(e.getUTCFullYear(),e.getUTCMonth()-(+p),1),X1)}});
document.querySelectorAll('[data-h]').forEach(btn=>btn.onclick=()=>{const k=cur+'#single';setH(k,hOf(k,340)+(btn.dataset.h==='+'?60:-60));render()});
$('mSingle').onclick=()=>setMode('single');$('mCompare').onclick=()=>setMode('compare');
$('clr').onclick=()=>{sel=[];store.set('selected',sel);updateBar();list();if(mode==='compare')render()};
$('q').oninput=list;
txInit();
$('meta').textContent=D.tests.length+' numeric tests · '+D.tests.reduce((a,t)=>a+t.n,0)+' results';
const sl=$('srcLegend');D.sources.forEach(s=>{const e=document.createElement('span');e.style.cssText='display:flex;align-items:center;gap:5px';
 const sw=document.createElement('span');sw.className='sw';sw.style.background=SC[s];const tx=document.createElement('span');tx.textContent=s;e.append(sw,tx);sl.appendChild(e)});
syncWin();updateBar();list();render();
</script></body></html>"""
txjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "med_timeline.js")).read()
open(out, "w").write(html.replace("__TXJS__", txjs).replace("__DATA__", data))
print(f"wrote {out}: {len(tests)} numeric tests from {len(sources)} sources: {sources}"
      f"; treatment band: {len(tx)} drug rows" + (f"; your edits from {edits_file}" if edits else ""))
