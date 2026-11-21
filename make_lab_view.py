#!/usr/bin/env python3
"""Build a local, private lab-results viewer (HTML) from a flattened lab TSV.

Usage:
    python3 flatten_labs.py          # builds local/labs_all.tsv from every hospital
    python3 make_lab_view.py [local/labs_all.tsv] [local/labs.html]

If local/meds_all.tsv exists (python3 flatten_meds.py), a Treatment panel is drawn above the
lab charts on the same time axis (rows: med_timeline.py; drawing and editing: med_timeline.js).
Changes made in the viewer can be exported to local/med_edits.json; it is built back in here.
If local/procedures/procedures.json exists, a Procedures section is added (procedures_view.js).
If local/dna/dna.json exists, a DNA section is added (dna_view.js).
If local/photos/photos_view.json exists, a photo story section is added (photos_view.js).
If local/ask.json exists, Ask features are added (ask_view.js; needs a separate local chat server).

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

# Vitals (python3 flatten_vitals.py -> local/vitals_all.tsv): same chart shape as a lab test, shown
# in their own "Vitals" section of the Library (kind "vital"); no reference ranges.
vit_file = os.path.join(os.path.dirname(os.path.abspath(src)), "vitals_all.tsv")
vit_rows = list(csv.DictReader(open(vit_file), delimiter="\t")) if os.path.exists(vit_file) else []
VITAL_ORDER = ["Blood pressure", "Pulse", "SpO2", "Respirations", "Temperature", "Weight", "Height", "BMI", "BSA"]
vgroups = defaultdict(list)
import datetime as _dt
def _ts(at):   # reading time in ms, so several readings on one day spread out by time of day
    try:
        return int(_dt.datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None
bp = {}
for r in vit_rows:
    pt = {"date": r["date"], "ts": _ts(r["collected_at"]), "at": r["collected_at"][:16].replace("T", " "), "v": float(r["value"]),
          "q": "", "flag": "", "src": r["source"], "name": r["measurement"], "lo": None, "hi": None}
    if r["measurement"] in ("BP systolic", "BP diastolic"):   # one blood-pressure point: v = systolic, v2 = diastolic
        b = bp.setdefault((r["result_id"], r["collected_at"]), dict(pt, name="Blood pressure"))
        if r["measurement"] == "BP systolic":
            b["v"] = pt["v"]
        else:
            b["v2"] = pt["v"]
        continue
    vgroups[(r["measurement"], r["unit"])].append(pt)
for b in bp.values():
    if "v2" in b:
        vgroups[("Blood pressure", "mmHg")].append(b)
for (name, unit), pts in sorted(vgroups.items(), key=lambda x: (VITAL_ORDER.index(x[0][0]) if x[0][0] in VITAL_ORDER else 99, x[0][0])):
    pts.sort(key=lambda p: (p["date"], p.get("ts") or 0))
    tests.append({"name": name, "unit": unit, "loinc": "", "panel": "Vitals", "kind": "vital", "n": len(pts), "flagged": 0,
                  "sources": sorted({x for p in pts for x in p["src"].split("+")}), "pts": pts, "id": f"vital:{name}|{unit}"})
sources = sorted(set(sources) | {x for r in vit_rows for x in r["source"].split("+")})

# Abbreviation + full name for each test, from the public reference/lab_names.tsv:
# "name" rows match a test name exactly (any case); "token" rows spell out words such as
# LVOT or VTI inside other names. Both are searchable in the viewer.
import re
NAMES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference", "lab_names.tsv")
if os.path.exists(NAMES_FILE):
    nrules = list(csv.DictReader(open(NAMES_FILE), delimiter="\t"))
    by_name = {r["match"].lower(): r for r in nrules if r["match_type"] == "name"}
    toks = [(re.compile(r"(?<![\w/])" + re.escape(r["match"]) + r"(?![\w/])"), r["full_name"])
            for r in sorted((r for r in nrules if r["match_type"] == "token"), key=lambda r: -len(r["match"]))]
    for t in tests:
        r = by_name.get(t["name"].lower())
        if r:
            t["abbr"], t["full"] = r["abbr"], r["full_name"]
            continue
        full = t["name"]
        for rx, f in toks:
            full = rx.sub(f, full)
        if full != t["name"]:
            t["full"] = full
# One fixed time axis for every chart: from the month of the earliest result of any kind
# to the end of the month of the latest, so charts line up when switching tests.
# Time before COMPRESS_BEFORE is squeezed into the first COMPRESS_WIDTH of the axis, so the
# busy recent period gets most of the room. Set COMPRESS_BEFORE = None for a plain axis.
COMPRESS_BEFORE = "2023-05-01"
COMPRESS_WIDTH = 0.15
all_dates = sorted([r["date"] for r in rows if r["date"]] + [r["date"] for r in vit_rows if r["date"]])
span = [all_dates[0][:7] + "-01", all_dates[-1]]
brk = COMPRESS_BEFORE if COMPRESS_BEFORE and span[0] < COMPRESS_BEFORE < span[1] else None
here = os.path.dirname(os.path.abspath(src))
tx = med_timeline.build(os.path.join(here, "meds_all.tsv"), os.path.join(here, "med_dispenses.tsv"))
# hospitals seen only in medications go after the lab ones
sources += sorted(({e["src"] for r in tx for e in r["ev"]} | {g["src"] for r in tx for g in r["segs"] if g["src"]}) - set(sources))
# Keep each hospital's color stable when a new one is added: the order is remembered in the
# private local/site_order.json (not in this public script) and new hospitals go at the end.
order_file = os.path.join(here, "site_order.json")
known = json.load(open(order_file)) if os.path.exists(order_file) else []
sources = [x for x in known if x in sources] + [x for x in sources if x not in known]
json.dump(known + [x for x in sources if x not in known], open(order_file, "w"))
# Half-lives for the estimate strips: public reference/med_halflife.tsv (drug as normalized in med_classes.tsv)
HL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference", "med_halflife.tsv")
HL_LOCAL = os.path.join(here, "med_halflife.local.tsv")   # private rows (e.g. sensitive drugs), win over public ones
halflife = {}
for f in (HL_FILE, HL_LOCAL):
    if os.path.exists(f):
        for r in csv.DictReader((l for l in open(f) if not l.startswith("#")), delimiter="\t"):
            if r.get("basis") == "none" or not r.get("half_life_low_days"):   # deliberately no curve (fluids, local use...)
                halflife.pop(r["drug"], None)
                continue
            halflife[r["drug"]] = {"lo": float(r["half_life_low_days"]), "hi": float(r["half_life_high_days"]), "source": r["source"],
                                   "refers": r.get("refers_to", ""), "basis": r.get("basis", "label")}
edits_file = os.path.join(here, "med_edits.json")
edits = json.load(open(edits_file)) if os.path.exists(edits_file) else None
# MRD tests (Signatera ctDNA): private tables from flatten_mrd.py / liftover_mrd.py, shown when present
def load_mrd():
    f = lambda n: os.path.join(here, n)
    if not os.path.exists(f("mrd_tests.tsv")):
        return None
    rd = lambda n: list(csv.DictReader(open(f(n)), delimiter="\t")) if os.path.exists(f(n)) else []
    AA = {"Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G", "His": "H", "Ile": "I", "Leu": "L", "Lys": "K",
          "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S", "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V", "Ter": "*"}
    EFF = {"missense_variant": "missense", "synonymous_variant": "synonymous (no protein change)", "intron_variant": "intron", "splice_donor_variant": "splice site",
           "splice_acceptor_variant": "splice site", "stop_gained": "stop gained", "5_prime_UTR_variant": "5′ UTR", "3_prime_UTR_variant": "3′ UTR",
           "upstream_gene_variant": "upstream of gene", "downstream_gene_variant": "downstream of gene", "intergenic_variant": "between genes"}
    alleles = [{k: r[k] for k in ("draw_date", "target_id", "chrom", "position", "ref", "alt", "change_type", "allele_ratio", "call")} for r in rd("mrd_alleles.tsv")]
    vars_ = {}
    for a in alleles:   # positions as Natera sent them, so the page works before liftover_mrd.py has run
        vars_.setdefault(a["target_id"], {"chrom": a["chrom"], "pos_grch37": a["position"], "ref": a["ref"], "alt": a["alt"], "change_type": a["change_type"]})
    for r in rd("mrd_variants.tsv"):
        m = re.search(r"p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)", r.get("hgvsp", ""))
        v = vars_.setdefault(r["target_id"], {})
        v.update({k: r.get(k, "") for k in ("chrom", "pos_grch37", "chrom_grch38", "pos_grch38", "ref", "alt", "change_type", "check", "gene", "consequence", "hgvsc", "hgvsp")})
        v["prot"] = (AA[m[1]] + m[2] + (AA[m[1]] if m[3] == "=" else AA[m[3]])) if m else ""
        v["near"] = r.get("consequence") in ("upstream_gene_variant", "downstream_gene_variant")
        v["effect"] = EFF.get(r.get("consequence", ""), r.get("consequence", "").replace("_", " "))
    return {"rows": rd("mrd_tests.tsv"), "alleles": alleles, "vars": vars_}
mrd = load_mrd()
# Each hospital's time zone (IANA name) for the navigator's time zone choice, from the private
# local/site_zones.json ({"<site>": "America/Chicago", ...}); hospital names stay out of this script.
zones_file = os.path.join(here, "site_zones.json")
site_zones = json.load(open(zones_file)) if os.path.exists(zones_file) else {}
data = json.dumps({"tests": tests, "sources": sources, "span": span, "tx": tx, "edits": edits, "halflife": halflife,
                   "brk": brk, "brkw": COMPRESS_WIDTH, "mrd": mrd, "siteZones": site_zones}, separators=(",", ":"))

html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>/* Sideways phone = the computer layout, scaled to fit: a phone in landscape (short side of its screen 500 px or less) lays the page
out 1024 px wide and the browser shrinks it to the screen, like a desktop site (pinch zoom still works). Upright it is the phone layout.
?fit=wide forces the scaled computer layout, ?fit=phone the phone layout. Switches when the phone turns. */
(function(){var v=document.querySelector('meta[name=viewport]'),q=new URLSearchParams(location.search).get('fit'),land=matchMedia('(orientation: landscape)');
function set(){var phone=Math.min(screen.width,screen.height)<=500,wide=q==='wide'||(q!=='phone'&&phone&&land.matches);
 var across=land.matches?Math.max(screen.width,screen.height):Math.min(screen.width,screen.height),k=Math.min(1,across/1024).toFixed(3);
 var c=wide?'width=1024,initial-scale='+k+',minimum-scale='+k:'width=device-width,initial-scale=1';if(v.content!==c)v.content=c;document.documentElement.classList.toggle('fitwide',wide);}
set();land.addEventListener('change',set);})();</script>
<title>Library</title>
<style>
:root{--bg:#fbfbfa;--card:#fff;--ink:#141413;--ink2:#5e5d59;--muted:#8a8984;--line:#e6e5e0;--accent:#2a78d6;--band:rgba(27,175,122,.12);--hi:#d03b3b;--lo:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#232322;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8a8984;--line:#383835;--accent:#3987e5;--band:rgba(27,175,122,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:340px minmax(0,1fr);min-height:100vh}
aside{border-right:1px solid var(--line);padding:16px;overflow:auto;max-height:100vh;position:sticky;top:0}
main{padding:16px 12px;min-width:0}
h1{font-size:20px;font-weight:600;margin:0 0 4px}h2{font-size:17px;font-weight:600;margin:0}
.sub{color:var(--ink2);font-size:13px}
input[type=search]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit;margin:12px 0 6px}
.t{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:14px}
.t:hover{background:var(--line)}.t.on{background:var(--accent);color:#fff}.t .n{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap}.t.on .n{color:#fff}
.t input{margin:0;flex:none;width:15px;height:15px;cursor:pointer}.t .nm{min-width:0;overflow:hidden;text-overflow:ellipsis}
details>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;border-radius:6px}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:'▸';color:var(--muted);font-size:11px;width:10px;flex:none}details[open]>summary::before{content:'▾'}
details>summary:hover{background:var(--line)}summary .n{margin-left:auto;color:var(--muted);font-size:12px;font-weight:400}
details.sec{margin-top:10px}details.sec>summary{font-weight:600;font-size:15px;padding:6px 8px}
details.grp>summary{font-size:12.5px;color:var(--ink2);margin:6px 0 2px;padding:3px 8px}
details.grp{margin-left:8px}details.grp>summary input{margin:0;width:14px;height:14px}
.t .tag{color:var(--muted);font-size:11px;white-space:nowrap}.t.on .tag{color:#fff}
summary .st{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}summary .n,summary .mini,summary input{flex:none}
summary .mini{font-size:11px;padding:0 5px;border-radius:5px;text-transform:none;letter-spacing:0;font-weight:400;line-height:18px}
.dosetog{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--muted);flex:none;cursor:pointer}.dosetog input{width:12px;height:12px}.t.on .dosetog{color:#fff}
.hlctl{display:inline-flex;gap:2px}.hlctl button{padding:1px 8px;font-size:12px}
.dosebox{border-top:1px solid var(--line);margin-top:8px;padding-top:6px}
.t .only{display:none;font-size:11px;padding:0 6px;line-height:17px;flex:none}.t:hover .only,.t:focus-within .only{display:inline-block}
summary .gonly.on{background:var(--accent);border-color:var(--accent);color:#fff}summary .gonly.inside{border-color:var(--accent);color:var(--accent)}
.t .only.on{display:inline-block;background:var(--accent);border-color:var(--accent);color:#fff}
.solo{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border-radius:14px;padding:2px 4px 2px 11px;font-size:13px;max-width:340px}
.solo span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.solo button{background:rgba(255,255,255,.2);border:0;color:#fff;padding:1px 8px;border-radius:10px;font-size:12px;flex:none}
.cmp.hl,.dosebox.hl{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
.sidectl{display:flex;gap:6px;margin:4px 0 2px}.sidectl button{font-size:12px;padding:2px 9px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 10px;margin-top:12px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.stat{background:var(--bg);border-radius:8px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:20px;font-weight:600}.stat span{font-size:12px;color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--ink2);font-weight:500}
.H{color:var(--hi);font-weight:600}.L{color:var(--lo);font-weight:600}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--muted)}button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.win{font-size:13px}.wrow{display:flex;align-items:center;gap:10px;margin:4px 0}.wl{width:36px;color:var(--ink2)}
.wrow input{flex:1;margin:0}.wnav button{font-size:12px;padding:3px 9px;flex:none}.wrow.wnav b{min-width:70px;font-weight:500;color:var(--ink2);font-size:12px}.wrow b{min-width:92px;font-weight:600}.wbtn{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.wbtn button{font-size:12px;padding:4px 10px}
.cmp{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px 6px;margin-top:8px}
.cmph{display:flex;align-items:center;gap:8px;font-size:13px}.cmph b{font-weight:600}.cmph .u{color:var(--ink2)}
.cmph .ctl{margin-left:auto;display:flex;align-items:center;gap:4px}@media (max-width:760px){.cmph{flex-wrap:wrap;row-gap:4px}.cmph .ctl{flex-wrap:wrap;justify-content:flex-end;max-width:100%}}.cmph{position:relative;z-index:1}.hlift{position:relative;z-index:2;align-items:center}.cmph.skinned{position:relative;min-height:24px}.cmph.skinned.film{min-height:50px;align-items:flex-start}.cmph canvas.skin{position:absolute;left:-10px;top:-5px;pointer-events:none;z-index:0}.cmp.pmin{overflow:hidden}.cmph.skinned>*:not(canvas){position:relative;z-index:1}.cmph.skinned b,.cmph.skinned .u{text-shadow:0 0 3px var(--card),0 0 3px var(--card),0 0 2px var(--card)}.cmp.pmin .cmph b,.dosebox.pmin .cmph b,#kfCard.kffold .mhead b,#txCard.txmin .txh>b,section.pmin .dethead h2{opacity:.55;font-weight:500;text-shadow:0 0 2px var(--card)}.cmp.pmin .cmph.skinned .ctl{opacity:.3;transition:opacity .15s}.cmp.pmin .cmph .u,.cmp.pmin .cmph .hlift{display:none}.cmp.pmin .cmph .ctl>button:is([aria-label=Shorter],[aria-label=Taller]){display:none}.dosebox.pmin .cmph .u,.dosebox.pmin .cmph .ctl>button:is([aria-label=Shorter],[aria-label=Taller]){display:none}#kfCard.kffold .mleft>.sub,#kfCard.kffold .mklegend,#kfCard.kffold #kfLess,#kfCard.kffold #kfMore{display:none}#txCard.txmin .txh>.sub,#txCard.txmin .txh>.ctl{display:none}section.pmin .dethead .sub,section.pmin .dethead h2 .sub{display:none}.cmp.pmin:hover .cmph.skinned .ctl{opacity:1}.cmp.pmin{padding-top:5px;padding-bottom:5px}.tfoldx{display:none!important}.pclosed{display:none!important}.cmp.pmin .askPanelBtn,.dosebox.pmin .askPanelBtn,#kfCard.kffold .askPanelBtn,#txCard.txmin .askPanelBtn,section.pmin .askPanelBtn{display:none!important}.skintip{position:fixed;z-index:70;max-width:340px;background:rgba(0,0,0,.88);color:#fff;font-size:11px;line-height:1.35;padding:5px 8px;border-radius:6px;pointer-events:none;display:none}.skintip b{display:block;font-size:12px;margin-bottom:2px}.skintip div{color:#ddd}.cmph,.txh,#kfCard.unpinned>.mhead,#single>.dethead,#mrd>.dethead{cursor:grab}body.pdragging,body.pdragging *{cursor:grabbing!important;user-select:none}.dragging{opacity:.45;outline:2px dashed var(--accent);outline-offset:2px}.dropline{position:fixed;z-index:60;height:3px;border-radius:2px;background:var(--accent);box-shadow:0 0 6px var(--accent);pointer-events:none;display:none}.pall{margin-left:auto;display:inline-flex;align-items:center;gap:4px}.nrow .pall button{font-size:12px;padding:1px 7px;line-height:18px;border-radius:7px}.closedbar{display:inline-flex;gap:3px}.closedbar button{font-size:11px;padding:1px 7px}.hlift button,.hlift select{font-size:11px!important;padding:1px 7px!important;line-height:17px!important;min-height:0!important;height:auto!important}.hlift{font-size:11px}.cmph .ctl button{padding:1px 8px;font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:13px;color:var(--ink2)}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.hide{display:none!important}
.dethead{display:flex;align-items:flex-start;gap:8px}.dethead>div{flex:1}.dethead .pmove{margin-top:4px}
.pmove{display:inline-flex;gap:2px}section.pmin>:not(.dethead){display:none!important}.dethead #detMin,.dethead [data-mmin]{margin:4px 0 0 4px;font-size:12px;padding:0 7px}#kfCard>.mhead{flex-wrap:nowrap;align-items:flex-start}#kfCard .mleft{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;flex:1;min-width:0}#kfCard .kfright{display:flex;align-items:center;flex:none}#kfCard .kfright .mtbtn{margin-left:0;gap:3px}@media (max-width:760px){#kfCard>.mhead{flex-wrap:wrap}#kfCard .kfright{flex-wrap:wrap;margin-left:auto}}
.nrow .datebtn{font-weight:600;padding:1px 7px;font-size:12px;min-width:78px}.nrow #wml{font-weight:400;color:var(--ink2);min-width:0}.nrow #saveRange{margin-left:2px}.lockbar{display:inline-flex;gap:2px;align-items:center}.lockbar button{font-size:12px;padding:1px 7px;line-height:18px}.lockbar button.on{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}.lockbar .lockx{padding:1px 5px}
.pdlg{left:50%;top:28%;transform:translateX(-50%);z-index:70;font-size:13px;min-width:300px;max-width:440px}.pdlg .pdmsg{white-space:pre-line}.pdlg input{font-size:13px;padding:4px 6px}
.calpop{position:fixed;z-index:45;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:12px;display:flex;flex-direction:column;gap:6px;min-width:230px}
.calpop .tzsel{font:inherit;font-size:12px;padding:3px 4px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);max-width:260px}
.calpop input{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}.calpop .bar{justify-content:flex-end}
body.viewonly #saveRange,body.viewonly .redit{display:none!important}
.nrow.lay{gap:6px;font-size:12px;flex-wrap:wrap}.nrow.lay button{font-size:12px;padding:1px 8px}.nrow.lay .laychip{border-radius:12px}.nrow.lay .laychip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.t .goto{flex:none;font-size:12px;padding:0 5px;line-height:17px}.nrow.lay button:disabled{opacity:.35}
.t.ract .nm{font-weight:600}.t.layrow{padding:3px 8px 3px 26px;font-size:13px}.t.layon{background:var(--accent);color:#fff}
body.viewonly #mAdd,body.viewonly #txAdd,body.viewonly #txImport,body.viewonly .ptpop button:not(.pclose),body.viewonly #mLinks button,body.viewonly .madd{display:none!important}.pmove button{padding:0 7px;font-size:12px}
.navpin .mcard{margin-top:6px;padding:4px 10px 2px}.mhead{display:flex;align-items:center;gap:8px;font-size:12px}.mhead b{font-size:13px}.mhead .mtbtn{margin-left:auto;display:flex;gap:4px}.mhead .mtbtn button{font-size:11px;padding:1px 7px}
.mtrack{position:relative;height:64px}
.kfbar,.pbar{display:inline-flex;align-items:center;gap:2px;padding-left:8px;margin-left:4px;border-left:1px solid var(--line)}.kfbar button,.pbar button{font-size:11px;padding:1px 7px}.kfbar .pmove,.pbar .pmove{margin-right:4px}
.mcard.unpinned{padding:8px 10px 6px}.mcard.kffold .mtrack,.mcard.kffold .mstrack{display:none}.mcard.kffold #kfFold{background:var(--accent);border-color:var(--accent);color:#fff}
.kfscroll{position:relative;height:14px;margin:2px 0 4px;border-radius:7px;background:var(--line);cursor:pointer;touch-action:none;user-select:none}.kfsdots{position:absolute;inset:0;pointer-events:none}.kfsdots i{position:absolute;top:5px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--muted);opacity:.8}.kfsthumb{position:absolute;top:0;bottom:0;min-width:18px;border-radius:7px;background:var(--accent);opacity:.55;cursor:grab}.kfscroll:hover .kfsthumb,.kfscroll.drag .kfsthumb{opacity:.8}.kfscroll.drag .kfsthumb{cursor:grabbing}.kfsl{position:absolute;left:50%;top:-1px;transform:translateX(-50%);font-size:10px;line-height:14px;color:#fff;white-space:nowrap;pointer-events:none}.mcard.kffold .kfscroll{margin-top:4px}#msRow .mhead{margin-top:4px}.mstrack{position:relative;height:74px}
.msrng{position:relative;display:inline-block;width:150px;height:18px;vertical-align:middle}
.msrng .trk,.msrng .fill{position:absolute;top:7px;height:4px;border-radius:2px}.msrng .trk{left:0;right:0;background:var(--line)}
.msrng .fill{background:linear-gradient(90deg,#1baf7a,#e2a028,#c82828)}
.msrng input{position:absolute;left:0;top:0;width:100%;height:18px;margin:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none}
.msrng input::-webkit-slider-runnable-track{background:none;height:18px}
.msrng input::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:14px;height:14px;margin-top:2px;border-radius:50%;background:var(--card);border:2px solid var(--ink);cursor:grab}
.msrng input::-moz-range-thumb{pointer-events:auto;width:11px;height:11px;border-radius:50%;background:var(--card);border:2px solid var(--ink);cursor:grab}
.msrng input::-moz-range-track{background:none}.mshape{flex:none;vertical-align:middle}.mhead{flex-wrap:wrap;row-gap:3px}.mhead>.sub{white-space:nowrap}
.mnav{display:inline-flex;align-items:center;gap:4px;margin-left:8px}.mnav button{font-size:11px;padding:1px 7px}.mnav button:disabled{opacity:.35}.mnavl{font-size:12px;color:var(--ink2);cursor:pointer;max-width:330px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mnavl:hover{color:var(--ink)}
.mklegend{display:inline-flex;gap:8px;align-items:center;color:var(--muted);font-size:11px}.mklegend span{display:inline-flex;gap:3px;align-items:center}
.mlinkh{display:flex;align-items:center;gap:8px}.mpick{font-size:11px;padding:1px 8px}.mpick.on{background:var(--accent);color:#fff;border-color:var(--accent)}body.picking main canvas{cursor:crosshair!important}.nrow.lay .wl{width:auto}.mtip{pointer-events:none;z-index:60;max-width:340px}
.ptpop{position:fixed;z-index:50;background:var(--ink);color:var(--bg);border-radius:8px;padding:6px 9px;font-size:12px;max-width:250px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.ptpop.pinned{outline:2px solid #e34948}.ptpop .pclose{position:absolute;top:2px;right:4px;margin:0;background:transparent;border:0;color:inherit;font-size:14px;padding:0 4px}.ptpop .pnote{font-size:10px;opacity:.7;margin-top:3px}
.ptpop button{margin-top:5px;background:#e34948;border-color:#e34948;color:#fff;font-size:11px;padding:2px 8px}
.mpanel{position:fixed;z-index:40;right:18px;bottom:18px;width:min(560px,calc(100vw - 40px));max-height:70vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.mpanel .fgrid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.mpanel .chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:12px;padding:1px 4px 1px 8px;font-size:12px;margin:2px 4px 2px 0}
.mpanel .chip button{padding:0 5px;font-size:11px}.mdot{width:9px;height:9px;border-radius:50%;flex:none}
.txlegend{gap:4px 12px;font-size:11px;margin-top:4px;color:var(--muted)}.txlegend .shape{gap:3px;cursor:help}.txlegend .sub{font-size:11px;color:var(--muted)}
main canvas{cursor:grab}body.dragging,body.dragging main canvas{cursor:grabbing!important;user-select:none}
/* the mode buttons and time window stay at the top while the charts scroll */
.navpin{position:sticky;top:0;z-index:20;background:var(--bg);margin:-16px -12px 0;padding:6px 12px 5px;border-bottom:1px solid var(--line);box-shadow:0 6px 12px -10px rgba(0,0,0,.35)}
.nrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}.nrow+.nrow{margin-top:4px}
.nrow button{font-size:12px;padding:2px 8px}.nrow .wbtn,.nrow .wnav{display:inline-flex;align-items:center;gap:3px;margin-left:6px}
.nrow .wnav input{width:150px;margin:0 2px}.nrow .zl{color:var(--ink2);margin-left:6px}.nrow #wlen{color:var(--ink2);font-weight:500;margin-left:4px;min-width:62px}
.nrow.win .wl{color:var(--ink2)}.nrow.win input{flex:1;min-width:80px;margin:0}.nrow.win b{font-weight:600;min-width:78px}
.nrow.win .wfl{width:auto;margin-left:6px}.nrow.win input.fine{outline:1px solid var(--accent);outline-offset:2px;border-radius:4px}.nrow.win .wstep1{padding:1px 6px;font-size:12px;line-height:16px;flex:none}.nrow #wfut{font-size:12px;padding:1px 3px;max-width:190px}.nrow #wfut.on{border-color:var(--accent);color:var(--accent)}
.nrow .legend{margin:0 0 0 8px;gap:8px;font-size:11px}.nrow #soloBar{margin-left:6px}
@media (max-width:760px){.navpin{margin:-14px -14px 0;padding:10px 14px}}
.txh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}.txh b{font-size:15px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:5px}.chips button{font-size:12px;padding:2px 9px;border-radius:12px}
.txh .ctl{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;align-items:center}.txh>.pbar{flex:none}.txh .ctl{flex:1 1 auto;min-width:0}@media (min-width:761px){.txh{flex-wrap:nowrap;align-items:flex-start}.txh>b{white-space:nowrap}}.txh .ctl button{padding:1px 8px;font-size:12px}
#txInfo{min-height:20px;margin-top:4px}.shape{display:inline-flex;align-items:center;gap:5px}
#txBody{position:relative}
.whybox{margin-top:8px;padding:6px 10px;border-left:3px solid var(--accent);background:var(--bg);font-size:12px;color:var(--ink2)}.whybox b{display:block;font-size:12px;color:var(--ink);margin-bottom:2px}
#txBox .txmv{position:absolute;z-index:5;width:14px;height:16px;padding:0;line-height:15px;font-size:11px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}#txBox .txmv:hover:not(:disabled){border-color:var(--line);background:var(--card);color:var(--ink)}#txBox .txmv:disabled{opacity:.25;cursor:default}
#txBox .txx{position:absolute;z-index:5;width:14px;height:16px;padding:0;line-height:15px;font-size:13px;border-radius:50%;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}#txBox .txx:hover{border-color:var(--line);background:var(--card);color:var(--hi)}
#txEdit{position:absolute;z-index:30;max-height:70vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
body.nolib .wrap{grid-template-columns:minmax(0,1fr)}body.nolib aside{display:none}#libBtn{font-size:13px}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 12px;margin-top:8px}
.fld{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--ink2)}
.fld input,.fld select,.fld textarea{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}
.fld input[type=checkbox]{width:16px;height:16px;align-self:flex-start}
@media (max-width:760px){.wrap{grid-template-columns:1fr}aside{position:static;max-height:40vh;border-right:0;border-bottom:1px solid var(--line)}main{padding:14px}}
/* one size for every panel header button (move, size, Minimize, ×, and the blue on/off toggles) */
#kfCard>.mhead button,#msRow .mhead button,.txh button,.cmph button,.dethead button{font-size:11px!important;padding:1px 7px!important;line-height:17px;border-radius:7px}
</style></head><body>
<div class="wrap">
<aside><h1>Library</h1><div class="sub" id="meta"></div>
<input type="search" id="q" placeholder="Filter the Library" aria-label="Filter the Library">
<div class="sub">Labs: click a name to view it, tick boxes to compare several. Medications: tick the ones to show in the Treatment panel.</div>
<div class="sidectl"><button id="collapseAll" title="Close every section and group">Collapse all</button><button id="expandAll" title="Open every section and group">Expand all</button></div>
<div id="list"></div></aside>
<main>
<div class="navpin">
<div class="nrow"><button id="libBtn" title="Hide or show the Library (left bar) to give the charts more room" aria-pressed="false"></button><button id="mSingle">One test</button><button id="mCompare">Compare selected (0)</button><button id="clr">Clear</button>
<span class="wbtn" role="group" aria-label="Window presets"><button data-p="all" title="Whole record">All</button><button data-p="brk" title="Since May 2023">May '23</button><button data-p="24" title="Last 2 years">2y</button><button data-p="12" title="Last 12 months">12m</button><button data-p="6" title="Last 6 months">6m</button><button data-p="3" title="Last 3 months">3m</button></span>
<span class="wnav"><button id="wPrev" title="Move the window back by a quarter of its length" aria-label="Move back">◀</button>
<input type="range" id="wp" aria-label="Move the window along the timeline (keeps its length)" title="Drag to move the window along the timeline"><button id="wNext" title="Move the window forward by a quarter of its length" aria-label="Move forward">▶</button>
<span class="zl">Zoom</span><button id="wOut" title="Zoom out: double the length, around the middle" aria-label="Zoom out">−</button><button id="wIn" title="Zoom in: half the length, around the middle" aria-label="Zoom in">+</button><b id="wlen"></b></span>
<button id="roleBtn" style="margin-left:auto"></button><span id="soloBar" class="bar"></span><span class="sub hide" id="hint"></span></div>
<div class="nrow win"><span class="wl">From</span><button class="wstep1" data-ws="a" data-d="-1" aria-label="Start earlier">−</button><input type="range" id="wa" aria-label="Window start"><button class="wstep1" data-ws="a" data-d="1" aria-label="Start later">+</button><button id="wal" class="datebtn" title="Pick the start on a calendar"></button>
<span class="wl">To</span><button class="wstep1" data-ws="b" data-d="-1" aria-label="End earlier">−</button><input type="range" id="wb" aria-label="Window end"><button class="wstep1" data-ws="b" data-d="1" aria-label="End later">+</button><button id="wbl" class="datebtn" title="Pick the end on a calendar"></button>
<span class="wl wfl" title="How far the timeline runs past the last data. Use it to see projections and planned dates (keyframes can be dated in the future); every panel gets the same longer axis, so they stay lined up. The part after today is tinted.">Future</span><select id="wfut" aria-label="How far the timeline runs past the last data"></select>
<button id="wml" class="datebtn" title="Go to a date: it moves to the middle of the charts and the cursor locks there (the window keeps its length)"></button><span id="lockBar" class="lockbar"></span><button id="saveRange" title="Save this time range with a name (listed under Presets → Timeline)">☆ Save timeline</button>
<span class="pall"><span id="closedBar" class="closedbar"></span><button id="maxAll" title="Open every panel">▴ Maximize all</button><button id="minAll" title="Minimize every panel to its title bar (with its data skin), to find a panel or compare patterns">▾ Minimize all</button><button id="closeAll" title="Close every panel: the Compare panels and dose charts are unticked, Keyframes, Treatments and the detail panel get a + button here to bring them back">× All</button></span><span class="legend" id="srcLegend"></span></div>
<div class="nrow lay hide" id="layBar"></div>
<div class="nrow lay hide" id="findBar"></div>
<div class="card mcard" id="kfCard"><div class="mhead"><span class="mleft"><b>Keyframes</b><span class="sub">your own notes on the timeline</span><span class="mklegend" id="mKinds"></span><span class="mnav" id="mNav"></span></span><span class="kfright"><span class="mtbtn"><button id="mAdd" title="Add a keyframe: your own note on the timeline">+ Keyframe</button><button id="mRowK" title="Switch the keyframes (the ones without a concern rating) on or off. Off: greyed out, no lines on the charts, and ◀ ▶ skip them">Keyframes</button><button id="mRowC" title="Switch the rated keyframes (the Concern marks) on or off. Off: greyed out here and on the Concern graph, no lines on the charts, and ◀ ▶ skip them">Concern</button><button id="mLines" title="Show or hide the keyframe lines across all charts">Lines: on</button></span><span class="kfbar" role="group" aria-label="Keyframes panel place and size"><span class="pmove"><button id="kfTop" title="Pin to the top bar (stays in view while you scroll)" aria-label="Pin Keyframes to the top bar">⤒</button><button id="kfUp" title="Move this panel up (from the first place: pin it to the top bar)" aria-label="Move Keyframes up">↑</button><button id="kfDown" title="Move this panel down, among the charts" aria-label="Move Keyframes down">↓</button><button id="kfBottom" title="Move this panel to the bottom" aria-label="Move Keyframes to the bottom">⤓</button></span><button id="kfLess" title="Make the Keyframes and Concern tracks shorter" aria-label="Shorter">−</button><button id="kfMore" title="Make the Keyframes and Concern tracks taller" aria-label="Taller">+</button><button id="kfFold" title="Minimize the Keyframes panel to its title bar and the time scroll bar (click again to open it)">▾ Minimize</button><button id="kfClose" title="Close the Keyframes panel (bring it back with + Keyframes at the top right)" aria-label="Close the Keyframes panel">×</button></span></span></div>
<div class="mtrack"><canvas id="mtrackc" role="img" aria-label="Keyframes: your own notes on the timeline"></canvas></div>
<div id="msRow" class="hide"><div class="mhead"><b>Concern</b><span class="sub">keyframes you rated 1–10</span>
<span class="msrng"><span class="trk"></span><span class="fill" id="msFill"></span><input id="msLo" type="range" min="1" max="10" step="0.5" value="1" aria-label="Lowest concern shown" title="Lowest concern shown"><input id="msHi" type="range" min="1" max="10" step="0.5" value="10" aria-label="Highest concern shown" title="Highest concern shown"></span>
<b id="msRv"></b><span class="sub" id="msCount"></span><span class="mtbtn"><button id="msList" title="Open the milestones list (record excerpts and original PDF pages; private page on this Mac) at the last keyframe you went to">List ↗</button></span></div>
<div class="mstrack"><canvas id="msc" role="img" aria-label="Concern rating of each milestone over time"></canvas></div></div><div class="kfscroll hide" id="kfScroll" title="Drag to move the time window along the whole record (it keeps its length). Click the bar to jump there."><div class="kfsdots" id="kfsDots"></div><div class="kfsthumb" id="kfsThumb"><span class="kfsl" id="kfsL"></span></div></div></div>
</div>
<div id="ptpop" class="ptpop hide"></div><div id="calPop" class="calpop hide"></div><div id="mtip" class="ptpop mtip hide"></div><div id="mEdit" class="mpanel hide"></div>
<div class="card" id="txCard">
<div class="txh"><b>Treatments</b><span class="sub">ticked in the Medications list</span>
<span class="ctl"><span class="sub" id="txStatus"></span><button id="txAdd">+ Add medication</button><button id="txExport" title="Save your changes to a file (med_edits.json)">Export</button><button id="txImport" title="Load changes from med_edits.json">Import</button><span id="hlCtl" class="hlctl"><button id="hlOn" title="Show or hide the half-life estimate curves under each drug">Half-life: on</button><button id="hlSmall" title="Make the half-life curves shorter">−</button><button id="hlBig" title="Make the half-life curves taller">+</button></span></span><span class="pbar" role="group" aria-label="Treatments panel place and size"><span class="pmove"><button id="txTop" title="Move this panel to the top" aria-label="Move Treatments to the top">⤒</button><button id="txUp" title="Move this panel up" aria-label="Move Treatments up">↑</button><button id="txDown" title="Move this panel down" aria-label="Move Treatments down">↓</button><button id="txBottom" title="Move this panel to the bottom" aria-label="Move Treatments to the bottom">⤓</button></span><button id="txHide" title="Minimize the Treatments panel to its title bar (click again to open it)">▾ Minimize</button><button id="txClose" title="Close the Treatments panel (bring it back with + Treatments at the top right)" aria-label="Close the Treatments panel">×</button></span>
<input type="file" id="txFile" accept="application/json,.json" class="hide"></div>
<div id="txBody"><div style="position:relative;margin-top:6px" id="txBox"><canvas id="tx" role="img" aria-label="Treatment timeline: bars are ordered periods, markers are doses"></canvas></div>
<div class="sub" id="txEmpty"></div><div class="sub" id="txInfo"></div>
<div id="txDoses"></div>
<div id="txEdit" class="hide"></div>
<div class="legend txlegend" id="txLegend"></div></div></div>
<section id="single">
<div class="dethead" style="margin-top:16px"><div><h2 id="title"></h2><div class="sub" id="desc"></div></div><span class="pmove"><button id="detTop" title="Move this panel to the top" aria-label="Move the detail panel to the top">⤒</button><button id="detUp" title="Move this panel up" aria-label="Move the detail panel up">↑</button><button id="detDown" title="Move this panel down" aria-label="Move the detail panel down">↓</button><button id="detBottom" title="Move this panel to the bottom" aria-label="Move the detail panel to the bottom">⤓</button></span><button id="detMin" title="Minimize this panel to its title bar (click again to open it)">▾ Minimize</button><button id="detClose" title="Close this panel (bring it back with + at the top right)" aria-label="Close this panel">×</button></div>
<div class="stats" id="stats"></div>
<div class="card"><div style="position:relative" id="sbox"><canvas id="c" role="img" aria-label="Trend of the selected lab test with its normal range shaded"></canvas></div>
<div class="bar" style="margin-top:8px"><span class="sub">Height</span><button data-h="-">−</button><button data-h="+">+</button></div></div>
<div class="card"><table id="tbl"></table></div>
</section>
<section id="mrd" class="hide"></section>
<section id="compare" class="hide"><div id="cmpList"></div>
<div class="sub" id="cmpEmpty" style="margin-top:14px">Tick the boxes next to tests in the list to stack them here on the same time scale.</div></section>
<div class="sub" style="margin-top:12px">Point color = hospital. Shaded band = normal range (latest result). Larger points with a red ring = flagged high, blue ring = flagged low. In wide windows, time before May 2023 is compressed left of the darker vertical line. Window, selection and heights are remembered in this browser.
Treatments: bars show the periods drugs were <i>ordered</i> for (thicker where the dose is higher, with the dose written where it changes; tick "dose" next to a drug for a dose chart) (from the hospitals' records); marker shape tells how sure a dose is (see the legend). Assumed doses are drawn from the prescription's schedule and are not in any record. Click a bar to correct it, click an assumed dose to mark it taken or skipped, or add a medication; your changes stay in this browser until you export them. This is a view of records, not medical advice: check doses with the care team.</div>
</main></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
const D=__DATA__;const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $=id=>document.getElementById(id);
const fmt=v=>(Math.round(v*1000)/1000).toString();
const store={get(k,d){try{const v=JSON.parse(localStorage.getItem('labs.'+k));return v==null?d:v}catch(e){return d}},
 set(k,v){try{localStorage.setItem('labs.'+k,JSON.stringify(v))}catch(e){}}};
const PAL=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#6250d6','#e34948','#008300'];
const SC={};D.sources.forEach((s,i)=>SC[s]=PAL[i%PAL.length]);
const srcColor=s=>SC[s.split('+')[0]]||'#888';
const BYID={};D.tests.forEach(t=>BYID[t.id]=t);
const ms=d=>Date.parse(d+'T12:00:00Z');const DAY=864e5;
const X0=ms(D.span[0]);const _e=new Date(ms(D.span[1]));const XD=Date.UTC(_e.getUTCFullYear(),_e.getUTCMonth()+1,1);   // XD = end of the data: the 1st of the month after the last entry
/* Future (navigation bar): the time axis can run past the data, so projections and planned dates fit and every panel keeps the
   same axis. FUT = whole months added after XD (0 = off), remembered in this browser; X1 = the end of the axis. */
const FUTMAX=36,futEnd=m=>{const e=new Date(XD);return Date.UTC(e.getUTCFullYear(),e.getUTCMonth()+m,1)};
let FUT=Math.max(0,Math.min(FUTMAX,Math.round(+store.get('future',0))||0)),X1=futEnd(FUT);
const NOW=Date.now();
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BRK=D.brk?ms(D.brk):null,FR=D.brk?D.brkw:0;let NDAYS=Math.round((X1-X0)/DAY);
const YW=46;
/* width of the plot of a chart on the shared time axis, before any chart is drawn: the main column less its padding (14 px),
   the panel's padding (11 px), the y axis and the 8 px on the right */
const plotPx=()=>{const m=document.querySelector('main');return Math.max(120,(m?m.clientWidth:innerWidth)-28-22-YW-8)};
/* Shared plot edges for every chart on the time axis (labs, treatments, keyframes, MRD, imaging, procedures...):
   y axis YW wide on the left, 8px on the right, no automatic padding for big points or edge tick labels.
   Then the same moment is at the same x in every panel, so the scrub line lines up. Draw extra labels inside the plot. */
const TLAY=(top=8,bottom=0)=>({autoPadding:false,padding:{left:0,top,right:8,bottom}});
const tEdge=s=>{s.paddingLeft=0;s.paddingRight=0};
/* The future part of the axis (Future setting on): a faint tint from today to the right edge of every chart on the shared time
   axis, recognised by its x scale using tEdge. One global plugin, so every panel (and any new one) gets it without doing anything.
   Dated marks: a module can put dated lines on that same axis with axisMarks(key, list or function returning the list), each
   {t, label, sub, short, col, ink}: every chart then draws a dashed line (col) at t with the label (ink) on top, so one date sits at one place
   in every panel (used for the dates a projection is worked out for). The label is two rows (label over sub) in tall plots, one
   row in low ones, the short form when the marks are close together, and left out when even that does not fit.
   futureLay(c) works out what to draw for one chart; the lines go under the data and start below their label, the words go
   over the data with a thin outline in the card colour so a line or point crossing them does not hide them.
   A list given as a function can change without any chart being redrawn (e.g. it depends on which panels are on the page):
   axisMarksCheck() repaints, on the next frame, the charts whose marks are out of date. render() and renderWin() call it. */
const AMARKS=new Map();let amQ=false;
const amSig=()=>{let s='';AMARKS.forEach((v,k)=>{s+=k+':';(typeof v==='function'?v():v||[]).forEach(m=>{s+=m.t+','})});return s};
function axisMarks(key,list){if(list)AMARKS.set(key,list);else AMARKS.delete(key);charts.forEach(c=>c.draw())}   // called by modules, after the charts map exists
function axisMarksCheck(){if(amQ)return;amQ=true;requestAnimationFrame(()=>{amQ=false;const s=amSig();charts.forEach(c=>{if(c.$fut&&c.$fut.sig!==s)c.draw()})})}
function futureLay(c){const sx=c.scales.x;if(!sx||sx.options.afterFit!==tEdge)return null;
 const a=c.chartArea,H=a.bottom-a.top,g=c.ctx,L={a,tx:null,today:null,marks:[],sig:amSig()};
 if(FUT&&W.b>NOW){const px=Math.max(a.left,sx.getPixelForValue(pos(NOW)));if(px<a.right)L.tx=px}
 AMARKS.forEach(v=>{(typeof v==='function'?v():v||[]).forEach(m=>{if(m.t<W.a||m.t>W.b)return;const x=sx.getPixelForValue(pos(m.t));if(x>a.left+1&&x<a.right-1)L.marks.push({m,x})})});
 L.marks.sort((p,q)=>p.x-q.x);if(H<44)return L;
 g.save();const wOf=(t,f)=>{g.font=f;return g.measureText(t).width};
 /* the longest form that fits between neighbouring marks: label over sub (tall plots), label, short label, nothing */
 const M=L.marks,gap=M.reduce((s,k,i)=>i?Math.min(s,k.x-M[i-1].x):s,Infinity);
 const forms=[k=>({l:k.m.label,s:H>=120?k.m.sub:''}),k=>({l:k.m.label,s:''}),k=>({l:k.m.short||'',s:''})];
 for(const f of forms){const B=M.map(k=>{const o=f(k);return Object.assign(o,{w:Math.max(o.l?wOf(o.l,'bold 9px system-ui'):0,o.s?wOf(o.s,'9px system-ui'):0)})});
  if(B.every(o=>o.l&&o.w+6<=gap)){M.forEach((k,i)=>{const o=B[i];k.l=o.l;k.s=o.s;k.w=o.w;k.cx=Math.max(a.left+2+o.w/2,Math.min(a.right-2-o.w/2,k.x));k.y0=o.s?22:12});break}}
 /* today: to the right of its line with an arrow; to the left of it without one when a mark's label is in the way */
 if(L.tx!=null&&L.tx>a.left){const w=wOf('today →','9px system-ui'),w2=wOf('today','9px system-ui'),free=(x0,x1)=>!M.some(k=>k.l&&k.cx-k.w/2-3<x1&&k.cx+k.w/2+3>x0);
  if(a.right-L.tx>w+5&&free(L.tx+3,L.tx+3+w))L.today={t:'today →',x:L.tx+3};
  else if(L.tx-a.left>w2+6&&free(L.tx-3-w2,L.tx-3))L.today={t:'today',x:L.tx-3-w2}}
 g.restore();return L}
/* Phones and tablets (no hover): a chart answers a tap, not a moving finger. A finger moving over a chart is scrolling the page;
   following it redrew every chart on each move (the shared scrub line) and could leave a hover box behind where the scroll began. */
if(matchMedia('(hover:none)').matches)Chart.defaults.events=['mousemove','mouseout','click'];
Chart.register({id:'futureTint',beforeDatasetsDraw(c){const L=futureLay(c);c.$fut=L;if(!L||(L.tx==null&&!L.marks.length))return;const a=L.a,g=c.ctx;g.save();g.lineWidth=1;
 if(L.tx!=null){g.fillStyle=css('--ink');g.globalAlpha=.055;g.fillRect(L.tx,a.top,a.right-L.tx,a.bottom-a.top);
  if(L.tx>a.left){g.globalAlpha=.55;g.strokeStyle=css('--muted');g.setLineDash([2,3]);g.beginPath();g.moveTo(L.tx+.5,a.top);g.lineTo(L.tx+.5,a.bottom);g.stroke()}}
 L.marks.forEach(k=>{g.globalAlpha=.6;g.strokeStyle=k.m.col||css('--muted');g.setLineDash([4,3]);g.beginPath();g.moveTo(Math.round(k.x)+.5,a.top+(k.y0||0));g.lineTo(Math.round(k.x)+.5,a.bottom);g.stroke()});
 g.restore()},
 afterDatasetsDraw(c){const L=c.$fut;if(!L||(!L.today&&!L.marks.some(k=>k.l)))return;const a=L.a,g=c.ctx;g.save();g.textBaseline='top';g.textAlign='left';
  if(L.today){g.globalAlpha=.85;g.fillStyle=css('--muted');g.font='9px system-ui';g.fillText(L.today.t,L.today.x,a.top+1)}
  g.globalAlpha=1;g.textAlign='center';g.lineJoin='round';g.lineWidth=3;g.strokeStyle=css('--card');
  const put=(t,x,y)=>{g.strokeText(t,x,y);g.fillText(t,x,y)};
  L.marks.forEach(k=>{if(!k.l)return;g.fillStyle=k.m.ink||k.m.col||css('--muted');g.font='bold 9px system-ui';put(k.l,k.cx,a.top+1);
   if(k.s){g.font='9px system-ui';put(k.s,k.cx,a.top+11)}});
  g.restore()}});
const MINW=DAY/2;   // shortest window: 12 hours (hospital stays with readings every few hours)
let W=store.get('window',{a:X0,b:X1});if(W&&W.b>X1&&W.a>=X0&&X1-W.a>=MINW)W.b=X1;   // saved while the Future setting was longer
if(!(W.a>=X0&&W.b<=X1&&W.b-W.a>=MINW))W={a:X0,b:X1};
let mode=store.get('mode','single');
/* Library (left bar): hide/show, remembered; Chart.js resizes the charts on its own */
let libHidden=store.get('libhidden',false);
function applyLib(){document.body.classList.toggle('nolib',libHidden);const b=$('libBtn');b.textContent=libHidden?'☰ Show Library':'◧ Hide Library';b.setAttribute('aria-pressed',String(libHidden))}
$('libBtn').onclick=()=>{libHidden=!libHidden;store.set('libhidden',libHidden);applyLib()};applyLib();
let cur=store.get('current',D.tests[0].id);if(!BYID[cur])cur=D.tests[0].id;
let sel=store.get('selected',[]).filter(id=>BYID[id]||(D.mrd&&/^mrd:(ot|var)$/.test(id)));   // lab ids, or the MRD panels (mrd_view.js)
let heights=store.get('heights',{});
let hoverX=null;const charts=new Map();
/* Minimize: panels folded to their title bar (ids as in the Stage: lab ids, MRD/procedure/imaging ids, 'dose:<drug>', '__det') */
let mins=store.get('mins',{})||{};const isMin=id=>!!mins[id];
/* Minimize all / Open all (top bar): every panel on the page, i.e. the Compare panels or the One-test panel, the dose charts,
   Treatments and Keyframes. Shows "Open all" once nothing is open any more. */
const minAllIds=()=>[...(mode==='compare'?sel:['__det']),...txDose.map(d=>'dose:'+d)];
const anyOpen=()=>minAllIds().some(i=>!isMin(i))||(!heights.__kffold&&!closedP.kf)||(!txHidden&&!closedP.tx);
const PALL=document.querySelector('.pall'),MINALL=PALL.querySelector('#minAll'),MAXALL=PALL.querySelector('#maxAll'),CLOSEALL=PALL.querySelector('#closeAll'),CLOSEDBAR=PALL.querySelector('#closedBar');   // kept: the line they sit on may be redrawn
function minAllSync(){requestAnimationFrame(minAllAlign)}
/* Minimize all sits at the right end of the top bar, straight above the Minimize button of the top panel */
function minAllAlign(){const b=MINALL,box=PALL,pin=document.querySelector('.navpin');
 const m=[...document.querySelectorAll('#kfClose,#txClose,#detClose,[data-mclose],.cmph .ctl button')].find(x=>x.offsetParent&&x.textContent.trim()==='×'&&!x.closest('.pclosed'));
 /* on the top bar's last line (e.g. Macro / Timeline / Panels, else the From / To line), at the right end, straight above the
    panels' Minimize buttons, the same size as that line's own buttons */
 const rows=[...pin.querySelectorAll(':scope > .nrow')].filter(r=>r.offsetHeight&&!r.classList.contains('hide'));const row=rows[rows.length-1]||b.closest('.nrow');
 if(box.parentElement!==row||box!==row.lastElementChild){row.appendChild(box)}
 const ref=[...row.querySelectorAll('button,.datebtn')].filter(x=>!box.contains(x)&&x.offsetHeight).sort((p,q)=>q.offsetHeight-p.offsetHeight)[0];if(ref){const c=getComputedStyle(ref);
  box.querySelectorAll('button').forEach(x=>{x.style.fontSize=c.fontSize;x.style.padding=c.padding;x.style.lineHeight=c.lineHeight;x.style.borderRadius=c.borderRadius})}
 box.style.marginRight=m?Math.max(0,Math.round(row.getBoundingClientRect().right-m.getBoundingClientRect().right))+'px':''}
addEventListener('resize',()=>requestAnimationFrame(minAllAlign));
new ResizeObserver(()=>requestAnimationFrame(minAllAlign)).observe(document.querySelector('.navpin'));
new MutationObserver(()=>{if(!PALL.isConnected||PALL!==PALL.parentElement.lastElementChild)requestAnimationFrame(minAllAlign)}).observe(document.querySelector('.navpin'),{childList:true,subtree:true});
/* × on Keyframes, Treatments and the One-test panel closes it (Compare panels and dose charts already had ×); closed panels
   come back from the "+ name" buttons next to Minimize all. Kept in 'closed'. */
let closedP=store.get('closed',{})||{};
const CLOSE_NAMES={kf:'Keyframes',tx:'Treatments',det:'Detail panel'};
function closedSync(){$('kfCard').classList.toggle('pclosed',!!closedP.kf);$('txCard').classList.toggle('pclosed',!!closedP.tx);
 $('single').classList.toggle('pclosed',!!closedP.det);$('mrd').classList.toggle('pclosed',!!closedP.det);
 const bar=CLOSEDBAR;bar.innerHTML='';Object.keys(closedP).forEach(k=>{const b=document.createElement('button');b.textContent='+ '+CLOSE_NAMES[k];b.title='Bring the '+CLOSE_NAMES[k]+' panel back';
  b.onclick=()=>setClosed(k,false);bar.appendChild(b)})}
async function closeAll(){if(!await uiAsk('Close every panel? The Compare panels and dose charts are unticked (tick them in the Library to bring them back); Keyframes, Treatments and the detail panel get a + button at the top right.',undefined,'Close all'))return;
 if(sel.length)setLabSel(sel.slice(),false);txDose=[];store.set('txdose',txDose);closedP={kf:1,tx:1,det:1};store.set('closed',closedP);closedSync();render()}
function setClosed(k,on){if(on)closedP[k]=1;else delete closedP[k];store.set('closed',closedP);closedSync();render();if(k==='kf'&&!on)kfDraw()}
function setAllMin(close){if(close)captureFour();minAllIds().forEach(i=>{if(close)mins[i]=1;else delete mins[i]});store.set('mins',mins);
 if(close)heights.__kffold=1;else delete heights.__kffold;store.set('heights',heights);txHidden=close;store.set('txhidden',txHidden);kfSize();render();if(!close)kfDraw()}
function setMin(id,on){if(on&&id==='img:brain:viewer')captureFour();if(on)mins[id]=1;else delete mins[id];store.set('mins',mins);render()}
const minLabel=id=>isMin(id)?'▸ Open':'▾ Minimize';

function compressing(){return BRK!=null&&W.a<BRK&&W.b>BRK&&(W.b-W.a)>3*365*DAY}
function pos(t){const a=W.a,b=W.b;if(!compressing())return 100*(t-a)/(b-a);
 const f=FR*(BRK-a)/(BRK-X0);return t<BRK?100*f*(t-a)/(BRK-a):100*f+100*(1-f)*(t-BRK)/(b-BRK)}
function unpos(x){const a=W.a,b=W.b;if(!compressing())return a+(b-a)*x/100;
 const f=FR*(BRK-a)/(BRK-X0);return x<100*f?a+(BRK-a)*x/(100*f):BRK+(b-BRK)*(x-100*f)/(100*(1-f))}
/* short windows: daily labels (local midnight), and 3- or 6-hourly marks for 3 days or less */
function shortTicks(a,b,days){const T=[];
 if(days<=3){const stepH=days<=1.5?3:6,d=new Date(a);d.setMinutes(0,0,0);d.setHours(Math.ceil(d.getHours()/stepH)*stepH);
  for(let t=d.getTime();t<=b;t+=stepH*36e5){const x=new Date(t),h=x.getHours();T.push({value:pos(t),label:h===0?MON[x.getMonth()]+' '+x.getDate():String(h).padStart(2,'0')+':00',year:h===0})}}
 else{const step=days>24?3:days>12?2:1,d=new Date(a);d.setHours(0,0,0,0);if(d.getTime()<a)d.setDate(d.getDate()+1);
  for(;d.getTime()<=b;d.setDate(d.getDate()+1))if((d.getDate()-1)%step===0)T.push({value:pos(d.getTime()),label:MON[d.getMonth()]+' '+d.getDate(),year:d.getDate()===1})}
 return T}
/* local date + time for readings and the hover line in short windows */
const localStamp=t=>{const d=new Date(t),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes())};
/* ---- Navigator time zone (From / Middle / To and their calendar) ----
   '' = this browser's zone. Otherwise an IANA zone: typed dates and times are read as clock time in that zone
   (so a 2 pm visit in Houston is found by typing 14:00 with Central picked), and the labels show it.
   Offsets come from the browser's own time zone tables (Intl), so daylight saving is handled per date. */
const BROWSER_TZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){return ''}})();
const tzOk=z=>{try{new Intl.DateTimeFormat('en-US',{timeZone:z});return true}catch(e){return false}};
let NAVTZ=store.get('navTz','');if(NAVTZ&&!tzOk(NAVTZ))NAVTZ='';
const tzF={},tzFmt=z=>tzF[z]||(tzF[z]=new Intl.DateTimeFormat('en-US',{timeZone:z,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}));
function tzWall(t,z){const p={};tzFmt(z).formatToParts(new Date(t)).forEach(x=>p[x.type]=x.value);return Date.UTC(+p.year,p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)}
const tzOff=(t,z)=>tzWall(t,z)-Math.floor(t/1000)*1000;
function zStamp(t,z=NAVTZ){if(!z)return localStamp(t);const w=new Date(tzWall(t,z)),n=x=>String(x).padStart(2,'0');
 return w.getUTCFullYear()+'-'+n(w.getUTCMonth()+1)+'-'+n(w.getUTCDate())+' '+n(w.getUTCHours())+':'+n(w.getUTCMinutes())}
/* 'YYYY-MM-DDTHH:MM' as clock time in zone z -> UTC ms (two passes, so dates across a DST change get their own offset) */
function zParse(v,z=NAVTZ){if(!z)return new Date(v).getTime();const m=/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})/.exec(v);if(!m)return NaN;
 const g=Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5]);return g-tzOff(g-tzOff(g,z),z)}
/* hover / tooltip times follow the navigator's time zone and say which zone it is */
function hStamp(t){return zStamp(t)+' '+zAbbr(t)}
function zAbbr(t,z=NAVTZ){try{return new Intl.DateTimeFormat('en-US',{timeZone:z||undefined,timeZoneName:'short'}).formatToParts(new Date(t)).find(x=>x.type==='timeZoneName').value}catch(e){return ''}}
function zUtc(t,z=NAVTZ){const o=Math.round((z?tzOff(t,z):-new Date(t).getTimezoneOffset()*6e4)/6e4),h=Math.floor(Math.abs(o)/60),m=Math.abs(o)%60;return 'UTC'+(o<0?'−':'+')+h+(m?':'+String(m).padStart(2,'0'):'')}
const ZNAMES={'America/New_York':'Eastern','America/Chicago':'Central','America/Denver':'Mountain','America/Phoenix':'Arizona','America/Los_Angeles':'Pacific','America/Anchorage':'Alaska','Pacific/Honolulu':'Hawaii','UTC':'UTC'};
const zName=z=>z?(ZNAMES[z]?ZNAMES[z]+(z==='UTC'?'':' time'):z.replace(/_/g,' ')):'This browser'+(BROWSER_TZ?' ('+(ZNAMES[BROWSER_TZ]||BROWSER_TZ.replace(/_/g,' '))+')':'');
const whenText=t=>(W.b-W.a)<=3*DAY?hStamp(t):zStamp(t).slice(0,10);
function ticks(){const T=[],a=W.a,b=W.b,months=(b-a)/(30.44*DAY),c=compressing();if((b-a)/DAY<=45)return shortTicks(a,b,(b-a)/DAY);
 /* on a narrow screen (a phone) the labels also have to fit the plot: at most one per 42 px, so every 3, 6 or 12 months */
 const step0=months>30?3:months>14?2:1,step=innerWidth>760?step0:([1,2,3,6,12].find(s=>s>=step0&&months/s<=Math.max(3,Math.floor(plotPx()/42)))||12);
 for(let d=new Date(Date.UTC(new Date(a).getUTCFullYear(),new Date(a).getUTCMonth(),1));d.getTime()<=b;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))){
  const t=d.getTime(),m=d.getUTCMonth();if(t<a)continue;const early=c&&t<BRK;
  /* in the compressed part only every k-th year gets a label (k so that at most ~3 fit), others just a faint line */
  /* on a narrow screen (a phone) the compressed strip is only a few dozen px wide: as many year labels as it has room for (30 px each), possibly none */
  if(early&&m===0){const y0=new Date(a).getUTCFullYear(),ny=new Date(BRK).getUTCFullYear()-y0,fitE=innerWidth>760?3:Math.min(3,Math.floor(pos(BRK)/100*plotPx()/30)),k=fitE?Math.max(1,Math.ceil(ny/fitE)):0;
   T.push({value:pos(t),label:k&&(d.getUTCFullYear()-y0)%k===0?String(d.getUTCFullYear()):'',year:true});continue}
  if(early?m===0:m%step===0)T.push({value:pos(t),label:m===0?String(d.getUTCFullYear()):MON[m]+(step===1&&months<6?' '+String(d.getUTCFullYear()).slice(2):''),year:m===0});
  if(months<4){const mid=Date.UTC(d.getUTCFullYear(),m,15);if(mid>=a&&mid<=b)T.push({value:pos(mid),label:'15'})}}
 if(c)T.push({value:pos(BRK),label:'',brk:true});return T}
const iso=t=>new Date(t).toISOString().slice(0,10);
const inWin=x=>{const t=x.ts!=null?x.ts:ms(x.date);return t>=W.a&&t<=W.b};

/* one chart for one test; used by both modes */
/* "5.2", "<0.5", or "136/82" for blood pressure */
const valText=x=>(x.q||'')+fmt(x.v)+(x.v2!=null?'/'+fmt(x.v2):'');
function chartSpec(t,opt){
 const p=t.pts,last=p[p.length-1],lo=last.lo,hi=last.hi,pv=p.filter(inWin),TK=ticks();
 const bp=p.some(x=>x.v2!=null);   // blood pressure: v = systolic, v2 = diastolic, drawn as two lines with the gap shaded
 const vv=(pv.length?pv:p).flatMap(x=>x.v2!=null?[x.v,x.v2]:[x.v]);
 const X=x=>pos(x.ts!=null?x.ts:ms(x.date));
 const ymin=Math.min(...vv,lo??Infinity),ymax=Math.max(...vv,hi??-Infinity),pad=(ymax-ymin)*.1||1;
 const band={id:'band',beforeDatasetsDraw(c){if(lo==null&&hi==null)return;const{ctx,chartArea:a,scales:{y}}=c;const top=hi!=null?y.getPixelForValue(hi):a.top,bot=lo!=null?y.getPixelForValue(lo):a.bottom;ctx.save();ctx.fillStyle=css('--band');ctx.fillRect(a.left,Math.max(a.top,top),a.right-a.left,Math.min(a.bottom,bot)-Math.max(a.top,top));ctx.restore()}};
 const guide={id:'guide',afterDatasetsDraw(c){if(hoverX==null)return;const{ctx,chartArea:a,scales:{x}}=c;const px=x.getPixelForValue(hoverX);if(px<a.left||px>a.right)return;
  ctx.save();ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();
  if(opt.dateLabel){ctx.setLineDash([]);ctx.fillStyle=css('--ink2');ctx.font='11px system-ui';ctx.fillText(whenText(unpos(hoverX)),Math.min(px+4,a.right-100),a.top+11)}ctx.restore()}};
 return {pv,plugins:[band,guide,momentPlugin,momentRings(t,pv,x=>x.ts!=null?x.ts:ms(x.date))],
  data:{datasets:[{label:t.name,data:pv.map(x=>({x:X(x),y:x.v})),borderColor:bp?css('--ink2'):css('--muted'),fill:bp?'+1':false,backgroundColor:'rgba(57,135,229,.14)',
   pointBackgroundColor:pv.map(x=>srcColor(x.src)),pointBorderColor:pv.map(x=>/H/.test(x.flag)?'#d03b3b':/L/.test(x.flag)?'#2a78d6':css('--card')),
   pointBorderWidth:pv.map(x=>x.flag?2.5:1.5),pointRadius:pv.map(x=>x.flag?(opt.compact?5:6):(opt.compact?3:4)),pointHoverRadius:7,borderWidth:1.5,tension:0},
   ...(bp?[{label:'diastolic',data:pv.map(x=>({x:X(x),y:x.v2})),borderColor:css('--muted'),pointBackgroundColor:pv.map(x=>srcColor(x.src)),pointBorderColor:css('--card'),
     pointBorderWidth:1.5,pointRadius:opt.compact?3:4,pointHoverRadius:7,borderWidth:1.5,tension:0}]:[])]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
   onHover:(e,els,c)=>{const xv=c.scales.x.getValueForPixel(e.x);setHover(xv>=0&&xv<=100?xv:null);pointPop(e,els,c,t,pv,x=>x.ts!=null?x.ts:ms(x.date))},
   onClick:(e,els,c)=>pointPop(e,els,c,t,pv,x=>x.ts!=null?x.ts:ms(x.date),true),   // click a reading: pin its box
   plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>{const x=pv[c[0].dataIndex];return x.ts!=null?hStamp(x.ts):x.date},label:c=>{const x=pv[c.dataIndex];return valText(x)+' '+t.unit+(x.flag?'  ['+x.flag+']':'')+'  · '+x.src+(x.name!==t.name?' ('+x.name+')':'')}}}},
   layout:TLAY(),
   scales:{x:{type:'linear',min:0,max:100,afterFit:tEdge,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
     ticks:{display:opt.showX!==false,color:css('--muted'),autoSkip:false,maxRotation:0,callback:(v,i)=>TK[i]?TK[i].label:''},
     grid:{color:c=>{const k=TK[c.index];return k&&(k.year||k.brk)?(k.brk?css('--ink2'):css('--line')):'transparent'}}},
    y:{min:ymin-pad,max:ymax+pad,afterFit:s=>{s.width=YW},ticks:{color:css('--muted'),maxTicksLimit:opt.compact?4:8},grid:{color:css('--line')}}}}};
}
function makeChart(canvas,t,opt){const sp=chartSpec(t,opt),c=new Chart(canvas,{type:'line',plugins:sp.plugins,data:sp.data,options:sp.options});c.$t=t.id;c.$pv=sp.pv;return c}
/* same chart, new window: swap data and options in place (about 3× faster than re-creating it, and nothing jumps) */
function refreshChart(c,t,opt){const sp=chartSpec(t,opt);c.$pv=sp.pv;c.data=sp.data;c.options=sp.options;c.update('none')}
function setHover(xv){if(xv===hoverX)return;hoverX=xv;charts.forEach(c=>c.draw())}

__TXJS__

__MRDJS__

/* Library: collapsible sections. Every section starts closed when the page opens (a clean start;
   Presets bring back bigger views). What you open stays open until you reload; all open while filtering. */
let openState={};let sectionIds=[];store.set('open',null);   // (labs.open used to remember sections across visits)
function setAllOpen(on){sectionIds.forEach(id=>openState[id]=on);list()}
/* small button inside a <summary>: preventDefault keeps the click from opening/closing the section */
function miniBtn(label,title,fn){const b=document.createElement('button');b.type='button';b.className='mini';b.textContent=label;b.title=title;
 b.setAttribute('aria-label',title);b.onclick=e=>{e.preventDefault();e.stopPropagation();fn()};return b}
function section(parent,id,title,count,defOpen,cls,q){sectionIds.push(id);const d=document.createElement('details');d.className=cls;d.open=q?true:(openState[id]??false);   // defOpen is no longer used: everything starts closed
 const s=document.createElement('summary');const t=document.createElement('span');t.className='st';t.textContent=title;t.title=title;const n=document.createElement('span');n.className='n';n.textContent=count;
 s.append(t,n);d.appendChild(s);
 s.onclick=()=>setTimeout(()=>{if($('q').value)return;openState[id]=d.open},0);  // only your own clicks are kept (until reload)
 parent.appendChild(d);return d}
/* "ALT · Alanine aminotransferase": abbreviation and full name from reference/lab_names.tsv */
function labLabel(t){if(t.abbr&&t.full)return t.abbr.toLowerCase()===t.full.toLowerCase()?t.full:t.abbr+' · '+t.full;return t.full?t.name+' · '+t.full:t.name}
const labSearch=t=>[t.name,t.abbr||'',t.full||''].join(' ').toLowerCase();
/* hovering a list row highlights it on the right; "only" deselects everything else */
let hlLab=null;
function setHlLab(id){hlLab=id;document.querySelectorAll('#cmpList .cmp').forEach(c=>c.classList.toggle('hl',c.dataset.id===id))}
function onlyBtn(title,fn,on){const b=miniBtn('only',on?'Turn off "only" and bring back the earlier selection':title,fn);b.classList.add('only');if(on)b.classList.add('on');b.setAttribute('aria-pressed',!!on);return b}
/* "only": remember the selection, show one item; turning it off brings the earlier selection back
   (plus anything ticked meanwhile, minus the "only" item unless it was selected before) */
/* "only" state: {key, ids, label, prev, cur}; key is "id:<test>" for one test or "grp:<panel>" for a group */
let soloLab=store.get('sololab',null);if(soloLab&&!soloLab.key)soloLab=null;
function soloBack(prev,now,ids){return [...prev,...now.filter(x=>!prev.includes(x)&&!ids.includes(x))]}
function onlyLab(key,ids,label){if(soloLab&&soloLab.key===key){endSoloLab();return}
 soloLab={key,ids,label,prev:soloLab?soloLab.prev:sel.slice(),cur};store.set('sololab',soloLab);
 sel=ids.slice();if(ids.length===1)cur=ids[0];store.set('selected',sel);store.set('current',cur);updateBar();list();render();if(ids.length===1)setHlLab(ids[0])}
function endSoloLab(){if(!soloLab)return;sel=soloBack(soloLab.prev,sel,soloLab.ids);if(BYID[soloLab.cur])cur=soloLab.cur;soloLab=null;store.set('sololab',null);
 store.set('selected',sel);store.set('current',cur);updateBar();list();render()}
/* Only button for a group heading: lit when the group is "only"; outlined when one item inside it is */
function groupOnlyBtn(what,key,ids,on,inside,fn){const b=miniBtn('Only',on?'Turn off "only" and bring back the earlier selection':inside?'"Only" is on for one '+what+' in this group':'Show only this group (deselect the others)',fn);
 b.classList.add('gonly');if(on)b.classList.add('on');else if(inside)b.classList.add('inside');b.setAttribute('aria-pressed',!!on);return b}
/* All / None / Only on a Library heading whose rows are Stage panels (ids in sel). The Library uses these
   wherever a heading holds two or more things you can tick, so every section works the same way. */
function panelBtns(D,what,key,ids,label,opt){opt=opt||{};const s=D.firstChild,add=b=>s.insertBefore(b,s.lastChild),one=ids.length===1;
 if(!opt.noAllNone){add(miniBtn('All',(one?'Show the ':'Show every ')+what,()=>setLabSel(ids,true)));add(miniBtn('None',(one?'Hide the ':'Hide every ')+what,()=>setLabSel(ids,false)))}
 add(groupOnlyBtn(what,key,ids,soloLab&&soloLab.key===key,!!(soloLab&&soloLab.key!==key&&soloLab.ids.length===1&&ids.includes(soloLab.ids[0])),()=>onlyLab(key,ids,label)))}
/* the pills at the top: "Only: <name> ✕" for labs and for medications */
function soloBarRender(){const el=$('soloBar');el.innerHTML='';
 const pill=(what,name,off)=>{const p=document.createElement('span');p.className='solo';const t=document.createElement('span');t.textContent='Only '+what+': '+name;t.title=t.textContent;
  const b=document.createElement('button');b.textContent='✕ Show all again';b.title='Turn off "only" and bring back the earlier selection';b.onclick=off;p.append(t,b);el.appendChild(p)};
 if(soloLab)pill(soloLab.key.startsWith('grp:')?'lab group':'lab',soloLab.label,endSoloLab);
 if(typeof soloMed!=='undefined'&&soloMed)pill(soloMed.key.startsWith('grp:')?'medication group':'medication',soloMed.label,endSoloMed)}
function list(){const q=$('q').value.toLowerCase();const el=$('list');el.innerHTML='';sectionIds=[];
 const groups={};D.tests.forEach(t=>{if(t.kind==='vital'||(q&&!labSearch(t).includes(q)))return;(groups[t.panel]=groups[t.panel]||[]).push(t)});
 const nT=Object.values(groups).reduce((a,g)=>a+g.length,0);
 const L=nT?section(el,'labs','Lab results',nT+' tests',true,'sec',q):null;
 if(L){const all=Object.values(groups).flat().map(t=>t.id),ls=L.firstChild;
  ls.insertBefore(miniBtn('All','Select every '+(q?'matching ':'')+'lab test for comparison',async()=>{
   if(all.length>30&&!await uiAsk('Add all '+all.length+' tests to the comparison? That draws '+all.length+' charts.',undefined,'Add all'))return;setLabSel(all,true)}),ls.lastChild);
  ls.insertBefore(miniBtn('None','Deselect every '+(q?'matching ':'')+'lab test',()=>setLabSel(all,false)),ls.lastChild);
  /* Only here keeps the lab tests you have ticked and hides everything else (vitals, MRD, imaging, ...);
     with no lab ticked it would mean every test, so it asks first, like All */
  const on=soloLab&&soloLab.key==='grp:labs',mine=all.filter(id=>sel.includes(id));
  ls.insertBefore(groupOnlyBtn('lab test','grp:labs',all,on,false,async()=>{if(on||mine.length){onlyLab('grp:labs',on?all:mine,'Lab results');return}
   if(all.length>30&&!await uiAsk('No lab test is ticked. Show only lab tests, all '+all.length+' of them? That draws '+all.length+' charts.',undefined,'Show all'))return;onlyLab('grp:labs',all,'Lab results')}),ls.lastChild);
  ls.lastChild.previousSibling.title=on?'Turn off "only" and bring back the earlier selection':'Show only the ticked lab tests (hide vitals, MRD, imaging and the other panels)'}
 Object.keys(groups).sort().forEach(g=>{const ids=groups[g].map(t=>t.id),k=ids.filter(id=>sel.includes(id)).length;
  const G=section(L,'lab:'+g,g,k?k+'/'+ids.length:ids.length,true,'grp',q),gs=G.firstChild;
  const cb0=document.createElement('input');cb0.type='checkbox';cb0.checked=k===ids.length;cb0.indeterminate=k>0&&k<ids.length;
  cb0.setAttribute('aria-label','Select all '+g+' tests');cb0.title='Tick or untick the whole group';
  cb0.onclick=e=>{e.stopPropagation();setLabSel(ids,cb0.checked)};gs.insertBefore(cb0,gs.firstChild);
  gs.insertBefore(miniBtn('All','Select all '+g+' tests',()=>setLabSel(ids,true)),gs.lastChild);
  gs.insertBefore(miniBtn('None','Deselect all '+g+' tests',()=>setLabSel(ids,false)),gs.lastChild);
  gs.insertBefore(groupOnlyBtn('test','grp:'+g,ids,soloLab&&soloLab.key==='grp:'+g,soloLab&&soloLab.key.startsWith('id:')&&ids.includes(soloLab.ids[0]),
   ()=>onlyLab('grp:'+g,ids,g)),gs.lastChild);
  groups[g].forEach(t=>testRow(t,G))});
 /* Vitals: their own section, same row behaviour as the labs (view, compare, only, hover) */
 const V=D.tests.filter(t=>t.kind==='vital'&&(!q||labSearch(t).includes(q)||'vitals'.includes(q)));
 if(V.length){const vids=V.map(t=>t.id),k=vids.filter(id=>sel.includes(id)).length;
  const VS=section(el,'vitals','Vitals',k?k+'/'+vids.length:vids.length+' measures',true,'sec',q),vs=VS.firstChild;
  vs.insertBefore(miniBtn('All','Select every vital for comparison',()=>setLabSel(vids,true)),vs.lastChild);
  vs.insertBefore(miniBtn('None','Deselect every vital',()=>setLabSel(vids,false)),vs.lastChild);
  vs.insertBefore(groupOnlyBtn('vital','grp:Vitals',vids,soloLab&&soloLab.key==='grp:Vitals',soloLab&&soloLab.key.startsWith('id:')&&vids.includes(soloLab.ids[0]),
   ()=>onlyLab('grp:Vitals',vids,'Vitals')),vs.lastChild);
  V.forEach(t=>testRow(t,VS))}
 MRD.section(el,q);momentSection(el,q);medSection(el,q);soloBarRender()}
/* one lab or vital row in the sidebar */
function testRow(t,G){const d=document.createElement('div');d.className='t'+(mode==='single'&&!MRD.active()&&t.id===cur?' on':'');
 const cb=document.createElement('input');cb.type='checkbox';cb.checked=sel.includes(t.id);cb.setAttribute('aria-label','Compare '+t.name);
 cb.onclick=e=>{e.stopPropagation();toggle(t.id,cb.checked)};
 const nm=document.createElement('span');nm.className='nm';nm.textContent=labLabel(t);nm.title=labLabel(t)+(labLabel(t).includes(t.name)?'':' — as named by the lab: '+t.name);
 const n=document.createElement('span');n.className='n';n.textContent=t.n+(t.flagged?' · '+t.flagged+'⚑':'');
 const only=onlyBtn('Show only '+t.name+' (deselect the others)',()=>onlyLab('id:'+t.id,[t.id],labLabel(t)),soloLab&&soloLab.key==='id:'+t.id);
 d.append(cb,nm,only,n);d.onclick=()=>{MRD.close();cur=t.id;store.set('current',cur);setMode('single')};
 d.onmouseenter=()=>setHlLab(t.id);d.onmouseleave=()=>setHlLab(null);G.appendChild(d)}
function toggle(id,on){setLabSel([id],on)}
/* add or remove lab tests from the comparison (keeps the order they were ticked in) */
function setLabSel(ids,on){sel=sel.filter(x=>!ids.includes(x));if(on)sel.push(...ids);store.set('selected',sel);
 if(on&&ids.length&&mode!=='compare'){mode='compare';store.set('mode',mode)}   // ticking shows the charts right away (Compare view)
 updateBar();list();if(mode==='compare')render()}
function setMode(m){mode=m;store.set('mode',m);updateBar();list();render()}
function updateBar(){$('mCompare').textContent='Compare selected ('+sel.length+')';$('mSingle').className=mode==='single'?'on':'';$('mCompare').className=mode==='compare'?'on':'';
 $('single').classList.toggle('hide',mode!=='single'||MRD.active());$('mrd').classList.toggle('hide',!MRD.active());$('compare').classList.toggle('hide',mode!=='compare');
 $('hint').textContent=mode==='compare'?'Hover any chart to line up a date across all of them.':''}
function hOf(id,def){return heights[id]||def}
function setH(id,h){heights[id]=Math.max(70,Math.min(600,h));store.set('heights',heights)}

/* Stage order: every panel in the Stage has ↑↓. One list holds the order: in Compare it is the
   chart panels (sel) with the Treatment panel ('__tx') at txPos; in One test view it is the
   Treatment panel and the Detail panel ('__det'), with txPos 0 or 1. */
let txPos=store.get('txpos',0);
/* The Keyframes/Concern card ('__kf'): kfPos null = pinned in the top bar (default), a number = its place
   in the Stage among the other panels. Its track height and fold live in heights ('__kf', '__kffold'). */
let kfPos=store.get('kfpos',null);
function stageOrder(){const o=mode==='compare'?sel.slice():['__det'];o.splice(Math.min(txPos,o.length),0,'__tx');
 if(kfPos!=null)o.splice(Math.min(kfPos,o.length),0,'__kf');return o}
/* d: -1 / 1 = one step, 'top' / 'bottom' = to the first / last place */
function moveStage(key,d){const o=stageOrder(),i=o.indexOf(key),j=d==='top'?0:d==='bottom'?o.length-1:i+d;if(i<0||j<0||j>=o.length||j===i)return;
 o.splice(i,1);o.splice(j,0,key);if(kfPos!=null){kfPos=o.indexOf('__kf');store.set('kfpos',kfPos)}
 const o2=o.filter(k=>k!=='__kf');txPos=o2.indexOf('__tx');store.set('txpos',txPos);
 if(mode==='compare'){sel=o2.filter(k=>k!=='__tx');store.set('selected',sel)}
 render()}
function placeTx(){const tc=$('txCard');if(mode==='compare'){const cards=[...$('cmpList').querySelectorAll(':scope > .cmp')],i=Math.min(txPos,cards.length);
  if(i<cards.length)$('cmpList').insertBefore(tc,cards[i]);else $('cmpList').appendChild(tc)}
 else{const sg=MRD.active()?$('mrd'):$('single');if(txPos>0)sg.after(tc);else sg.before(tc)}
 const o=stageOrder(),i=o.indexOf('__tx');$('txTop').disabled=$('txUp').disabled=i<=0;$('txBottom').disabled=$('txDown').disabled=i>=o.length-1;
 minAllSync();closedSync();$('single').classList.toggle('pmin',isMin('__det'));$('mrd').classList.toggle('pmin',isMin('__det'));$('detMin').textContent=minLabel('__det');
 $('detTop').disabled=$('detUp').disabled=txPos>0;$('detBottom').disabled=$('detDown').disabled=txPos===0;
 if(mode==='compare'){const n=o.length;[...$('cmpList').querySelectorAll(':scope > .cmp:not(.cmperr)')].forEach(c=>{const k=o.indexOf(c.dataset.id);
  c.querySelector('[data-mv="top"]').disabled=c.querySelector('[data-mv="-1"]').disabled=k<=0;
  c.querySelector('[data-mv="bottom"]').disabled=c.querySelector('[data-mv="1"]').disabled=k>=n-1})}}
function moveTx(d){moveStage('__tx',d)}
/* Drag to reorder: grab a panel by its title bar (not a button or control) and drop it between two others; a blue line
   shows where it will go, and the page scrolls when you drag near the top or bottom. Same order as ⤒ ↑ ↓ ⤓. */
function setStageOrder(o){if(kfPos!=null){kfPos=o.indexOf('__kf');store.set('kfpos',kfPos)}
 const o2=o.filter(k=>k!=='__kf');txPos=o2.indexOf('__tx');store.set('txpos',txPos);
 if(mode==='compare'){sel=o2.filter(k=>k!=='__tx');store.set('selected',sel)}render()}
const stageKey=el=>el.dataset&&el.dataset.id?el.dataset.id:el.id==='txCard'?'__tx':el.id==='kfCard'?'__kf':(el.id==='single'||el.id==='mrd')?'__det':null;
function stageEls(){const o=stageOrder();return [...document.querySelectorAll('#cmpList > .cmp:not(.cmperr), #txCard, #kfCard.unpinned, #single:not(.hide), #mrd:not(.hide)')]
 .filter(e=>e.offsetParent&&!e.closest('.navpin')&&!e.classList.contains('pclosed')&&o.includes(stageKey(e)))}
(function(){let drag=null,line=null,raf=0;
 const HEAD='.cmph, .txh, #kfCard.unpinned > .mhead, #single > .dethead, #mrd > .dethead';
 const target=y=>{const els=stageEls().filter(e=>e!==drag.el);let i=els.findIndex(e=>{const r=e.getBoundingClientRect();return y<r.top+r.height/2});if(i<0)i=els.length;return {els,i}};
 const showLine=y=>{const {els,i}=target(y);const ref=els[i]||els[els.length-1];if(!ref){line.style.display='none';return}
  const r=ref.getBoundingClientRect(),top=els[i]?r.top-6:r.bottom+4;line.style.cssText+=';display:block;left:'+r.left+'px;width:'+r.width+'px;top:'+(top-1)+'px'};
 const scrollLoop=()=>{raf=0;if(!drag)return;const pinB=document.querySelector('.navpin').getBoundingClientRect().bottom,y=drag.y;
  const d=y<pinB+40?-Math.min(30,(pinB+40-y)/2):y>innerHeight-40?Math.min(30,(y-(innerHeight-40))/2):0;
  if(d){scrollBy(0,d);showLine(y);raf=requestAnimationFrame(scrollLoop)}};
 /* not by touch: a finger on a title bar is usually scrolling the page. The drag could start anyway (drop line, dimmed panel) until the
    browser took the gesture back, and a sideways swipe on a title bar could move the panel (from reading the code; not seen on a phone). On a touch screen the ⤒ ↑ ↓ ⤓ buttons move panels. */
 document.addEventListener('pointerdown',e=>{if(e.button!==0||e.pointerType==='touch')return;const h=e.target.closest(HEAD);if(!h||e.target.closest('button,input,select,textarea,a,label,.hlift,canvas:not(.skin)'))return;
  const el=h.parentElement.closest('.cmp, #txCard, #kfCard, #single, #mrd');if(!el||!stageKey(el)||el.closest('.navpin'))return;
  drag={el,key:stageKey(el),x0:e.clientX,y0:e.clientY,y:e.clientY,on:false,id:e.pointerId}},true);
 document.addEventListener('pointermove',e=>{if(!drag)return;drag.y=e.clientY;
  if(!drag.on){if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<6)return;drag.on=true;drag.el.classList.add('dragging');document.body.classList.add('pdragging');
   line=document.createElement('div');line.className='dropline';document.body.appendChild(line)}
  e.preventDefault();showLine(e.clientY);if(!raf)raf=requestAnimationFrame(scrollLoop)},true);
 const end=e=>{if(!drag)return;const d=drag;drag=null;if(line){line.remove();line=null}document.body.classList.remove('pdragging');d.el.classList.remove('dragging');
  if(!d.on||e.type==='pointercancel')return;const {els,i}=(drag=d,target(e.clientY));drag=null;
  const o=stageOrder().filter(k=>k!==d.key),keys=els.map(stageKey);const before=keys[i];const j=before?o.indexOf(before):o.length;
  o.splice(j<0?o.length:j,0,d.key);setStageOrder(o)};
 document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);
 document.addEventListener('click',e=>{if(document.body.classList.contains('pdragging'))e.stopPropagation()},true)})();
/* Keyframes card: ⤒ (or ↑ from the first place) pins it to the top bar; ↓ / ⤓ from the top bar put it in the Stage */
function moveKf(d){if(kfPos==null){if(d===1)kfPos=0;else if(d==='bottom')kfPos=999;else return;store.set('kfpos',kfPos);render();return}
 const o=stageOrder();if(d==='top'||(d===-1&&o.indexOf('__kf')<=0)){kfPos=null;store.set('kfpos',null);render();return}
 moveStage('__kf',d)}
/* heights.__kf = size in % (100 = normal); the Keyframes track sets its own base height when it draws */
function kfSize(){const c=$('kfCard'),h=heights.__kf||100,fold=!!heights.__kffold;c.classList.toggle('kffold',fold);$('kfFold').textContent=fold?'▸ Open':'▾ Minimize';
 c.querySelector('.mstrack').style.height=Math.round(74*h/100)+'px';
 $('kfLess').disabled=fold||h<=50;$('kfMore').disabled=fold||h>=250;$('kfLess').title='Make the Keyframes and Concern tracks shorter (now '+h+'%)'}
/* Keyframes scroll bar: the whole record (X0..X1, plain time) as a bar under the Keyframes track, lined up with its plot area.
   The thumb is the time window; drag it to move the window (same length), click the bar to centre the window there.
   Small dots mark every keyframe on the whole record. Always shown: on the whole record the thumb fills the bar. */
let kfsM=[YW,10];
function kfScrollSync(){const sb=$('kfScroll');if(!sb)return;sb.classList.remove('hide');
 const ch=charts.get('mtrack'),cv=$('mtrackc'),A=ch&&ch.chartArea;if(A&&cv.clientWidth){kfsM=[A.left,cv.clientWidth-A.right]}sb.style.marginLeft=kfsM[0]+'px';sb.style.marginRight=kfsM[1]+'px';
 const f=t=>Math.max(0,Math.min(1,(t-X0)/(X1-X0))),th=$('kfsThumb');th.style.left=(f(W.a)*100)+'%';th.style.width=((f(W.b)-f(W.a))*100)+'%';
 $('kfsL').textContent=th.offsetWidth>110?zStamp(W.a).slice(0,7)+' – '+zStamp(W.b).slice(0,7):'';
 const ms=(E.moments||[]).filter(m=>m.date&&momentOn(m)),key=X0+'|'+X1+'|'+ms.length;
 if(sb.dataset.k!==key){sb.dataset.k=key;$('kfsDots').innerHTML=ms.map(m=>'<i style="left:'+(f(momentT(m))*100).toFixed(2)+'%"></i>').join('')}}
(function(){const sb=$('kfScroll'),th=$('kfsThumb');let drag=null;
 const tAt=x=>{const r=sb.getBoundingClientRect();return X0+Math.max(0,Math.min(1,(x-r.left)/r.width))*(X1-X0)};
 sb.addEventListener('pointerdown',e=>{e.preventDefault();const len=W.b-W.a;
  if(e.target===th||th.contains(e.target))drag={x:e.clientX,a:W.a,len};
  else{shiftWin(tAt(e.clientX)-len/2,len);drag={x:e.clientX,a:W.a,len}}
  sb.setPointerCapture(e.pointerId);sb.classList.add('drag')});
 sb.addEventListener('pointermove',e=>{if(!drag)return;const r=sb.getBoundingClientRect();shiftWin(drag.a+(e.clientX-drag.x)/r.width*(X1-X0),drag.len)});
 const end=()=>{drag=null;sb.classList.remove('drag')};sb.addEventListener('pointerup',end);sb.addEventListener('pointercancel',end);
 new ResizeObserver(()=>kfScrollSync()).observe($('mtrackc'))})();
/* redraw only the two tracks (renderBand also rebuilds the Treatment chart, which needs a full render) */
function kfDraw(){keepScroll(()=>{renderMomentTrack();if(typeof renderConcern==='function')renderConcern()})}
function kfResize(d){heights.__kf=Math.max(50,Math.min(250,(heights.__kf||100)+d));if(heights.__kf===100)delete heights.__kf;store.set('heights',heights);kfSize();kfDraw()}
function kfFold(){if(heights.__kffold)delete heights.__kffold;else heights.__kffold=1;store.set('heights',heights);kfSize();minAllSync();if(!heights.__kffold)kfDraw()}
/* put the card in its place: back in the top bar, or before the Stage element at kfPos (cards are already in order) */
function placeKf(){const k=$('kfCard'),pin=kfPos==null;k.classList.toggle('unpinned',!pin);
 if(pin){$('findBar').after(k)}
 else{const els=mode==='compare'?[...$('cmpList').children].filter(c=>c.classList.contains('cmp')||c.id==='txCard')
   :[$('txCard'),MRD.active()?$('mrd'):$('single')].sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  const i=Math.min(kfPos,els.length);if(i<els.length)els[i].before(k);else els[els.length-1].after(k)}
 const o=stageOrder(),i=o.indexOf('__kf');$('kfTop').disabled=$('kfUp').disabled=pin;$('kfBottom').disabled=$('kfDown').disabled=!pin&&i>=o.length-1}
/* redraws keep the page where it is: hold main's height while the charts are rebuilt, then restore the scroll */
function keepScroll(f){const se=document.scrollingElement,y=se.scrollTop,m=document.querySelector('main');m.style.minHeight=m.offsetHeight+'px';
 try{f()}finally{m.style.minHeight='';se.scrollTop=y}}
function render(){axisMarksCheck();keepScroll(()=>{charts.forEach(c=>c.destroy());charts.clear();hoverX=null;
 $('single').before($('txCard'));$('findBar').after($('kfCard'));   // park them before the charts are rebuilt, then put them back in their places
 kfSize();renderBand();if(MRD.active())MRD.render();else if(mode==='single')renderSingle();else renderCompare();placeTx();placeKf()})}
/* only the time window changed (move, zoom, drag, presets): rebuild the Treatment panel, update the lab charts in place */
function renderWin(){axisMarksCheck();if(!$('ptpop').classList.contains('hide'))hidePop();   // the reading it pointed at has moved
 if(MRD.active()){keepScroll(()=>{[...charts.keys()].filter(k=>!k.startsWith('mrd:')).forEach(k=>{charts.get(k).destroy();charts.delete(k)});renderBand();MRD.render()});return}
 const labKeys=mode==='single'?['single']:sel;
 const ok=mode==='single'?(charts.get('single')||{}).$t===cur:sel.every(id=>MRD.isId(id)||(charts.get(id)||{}).$t===id);
 if(!ok)return render();
 keepScroll(()=>{[...charts.keys()].filter(k=>!labKeys.includes(k)).forEach(k=>{charts.get(k).destroy();charts.delete(k)});
  renderBand();if(mode==='single')renderSingle(true);else sel.forEach((id,i)=>MRD.isId(id)?MRD.refresh(id):refreshChart(charts.get(id),BYID[id],{compact:true,dateLabel:false,showX:true}))})}
function renderSingle(reuse){const t=BYID[cur],p=t.pts,last=p[p.length-1],lo=last.lo,hi=last.hi,vals=p.map(x=>x.v),pv=p.filter(inWin);
 $('title').textContent=labLabel(t)+(t.unit?' ('+t.unit+')':'');
 $('desc').textContent=pv.length+' of '+p.length+' results in window · '+t.panel+' · all results '+p[0].date+' to '+last.date+' · '+t.sources.join(', ')+(t.loinc?' · LOINC '+t.loinc:'')+(labLabel(t).includes(t.name)?'':' · named "'+t.name+'" by the lab');
 const d2=p.filter(x=>x.v2!=null).map(x=>x.v2);
 const st=[['Latest',valText(last),last.ts!=null?localStamp(last.ts):last.date],['Normal range',(lo!=null?fmt(lo):'')+' – '+(hi!=null?fmt(hi):''),t.unit],
  d2.length?['Systolic / diastolic range',fmt(Math.min(...vals))+'–'+fmt(Math.max(...vals))+' / '+fmt(Math.min(...d2))+'–'+fmt(Math.max(...d2)),p.length+' readings']:['Min / max',fmt(Math.min(...vals))+' / '+fmt(Math.max(...vals)),p.length+' results'],
  ['Flagged',t.flagged,'of '+p.length]];
 $('stats').innerHTML='';st.forEach(s=>{const e=document.createElement('div');e.className='stat';e.innerHTML='<span></span><b></b><span></span>';[0,1,2].forEach(i=>e.children[i].textContent=s[i]);$('stats').appendChild(e)});
 $('sbox').style.height=hOf(t.id+'#single',340)+'px';
 $('sbox').onmouseleave=()=>setHover(null);
 if(reuse)refreshChart(charts.get('single'),t,{compact:false,dateLabel:false});else charts.set('single',makeChart($('c'),t,{compact:false,dateLabel:false}));
 const tb=$('tbl');tb.innerHTML='<tr><th>Date</th><th>Value</th><th>Range</th><th>Flag</th><th>Hospital</th></tr>';
 [...pv].reverse().forEach(x=>{const r=tb.insertRow();[x.ts!=null?localStamp(x.ts):x.date,valText(x),(x.lo!=null?fmt(x.lo):'')+' – '+(x.hi!=null?fmt(x.hi):''),x.flag,x.src].forEach((v,i)=>{const c=r.insertCell();c.textContent=v;if(i===3&&v)c.className=/H/.test(v)?'H':'L'})})}
function renderCompare(){const box=$('cmpList');box.innerHTML='';$('cmpEmpty').classList.toggle('hide',sel.length>0);
 /* one panel failing (or an id that no longer exists, e.g. from an old saved view) must not stop the panels after it */
 sel.forEach((id,i)=>{try{cmpPanel(id,i,box)}catch(err){console.error('panel',id,err);const w=document.createElement('div');w.className='cmp cmperr';w.dataset.id=id;w.innerHTML='<div class="cmph"><b></b></div><div class="sub" style="color:#e0703a;padding:4px 0"></div>';w.querySelector('b').textContent=id;w.querySelector('.sub').textContent='This panel could not be drawn ('+(err&&err.message||err)+'). Remove it with × in the Library, or reload the page.';box.appendChild(w)}});
 box.onmouseleave=()=>setHover(null)}
/* A panel's first settings row (e.g. Procedures' Colour / Show, Signatera's Measure / Scale, the MRI view tabs) moves up into
   the empty middle of the panel's title row when it fits there, so the data gets that height. Checked again when the panel
   is resized or redraws its controls; if it doesn't fit, the row stays where it is. */
function toolRow(body){let e=body.firstElementChild;const top=body.getBoundingClientRect().top;
 for(let d=0;e&&d<4;d++){const r=e.getBoundingClientRect();if(r.top-top>4)return null;
  if(r.height>0&&r.height<=34&&e.querySelector('button,select,input')&&!e.querySelector('canvas,table,img,svg.big'))return e;
  e=e.firstElementChild}return null}
function liftTools(h,body,id){let raf=0;
 const fit=()=>{raf=0;if(!h.isConnected)return;tableFold(h,body,id);if(!body.offsetHeight)return;body.style.marginTop='';
  const old=body.querySelector('.hlift');if(old){old.classList.remove('hlift');old.style.width=old.style.marginLeft=old.style.marginRight=old.style.marginBottom=''}
  if(getComputedStyle(h).display==='none'||innerWidth<=760)return;
  const row=toolRow(body);if(!row)return;const ctl=h.querySelector('.ctl'),txt=h.querySelector('.u')||h.querySelector('b');if(!ctl||!txt)return;
  const room=ctl.getBoundingClientRect().left-txt.getBoundingClientRect().right-20;
  row.classList.add('hlift');row.style.width='max-content';row.style.marginBottom='8px';const need=row.getBoundingClientRect().width;   // measured at the compact header size
  if(need>room){row.classList.remove('hlift');row.style.width=row.style.marginBottom='';return}
  const hr=h.getBoundingClientRect(),lift=row.getBoundingClientRect().top-hr.top+(row.offsetHeight-h.offsetHeight)/2;
  row.style.marginLeft='auto';row.style.marginRight=(hr.right-ctl.getBoundingClientRect().left+10)+'px';
  body.style.marginTop=(-Math.max(0,Math.round(lift)))+'px'};
 const later=()=>{if(!raf)raf=requestAnimationFrame(fit)};
 new ResizeObserver(later).observe(h);new MutationObserver(later).observe(body,{childList:true,subtree:true});fit()}
/* Table fold: a panel with a chart and then a table (with its notes) under it gets a "Table" button among its panel buttons
   that hides the table and everything after it, so the chart has the room. Remembered per panel ('tblfold'). */
let tblFold=store.get('tblfold',{})||{};
function tableFold(h,body,id){const ctl=h.querySelector('.ctl');if(!ctl)return;let b=ctl.querySelector('.tfbtn');
 body.querySelectorAll('.tfoldx').forEach(e=>e.classList.remove('tfoldx'));
 const cv=[...body.querySelectorAll('canvas')].filter(x=>x.offsetHeight>40).pop();
 const tb=cv&&[...body.querySelectorAll('table')].find(t=>cv.compareDocumentPosition(t)&Node.DOCUMENT_POSITION_FOLLOWING);
 if(!tb){if(b)b.remove();return}
 let a=cv;while(a&&!a.contains(tb))a=a.parentElement;if(!a||a===body.parentElement)return;
 let t=tb;while(t.parentElement!==a)t=t.parentElement;
 const on=!!tblFold[id];
 if(!b){b=document.createElement('button');b.className='tfbtn';b.onclick=()=>{if(tblFold[id])delete tblFold[id];else tblFold[id]=1;store.set('tblfold',tblFold);tableFold(h,body,id)};
  const before=[...ctl.children].find(x=>/Minimize|Open/.test(x.textContent));ctl.insertBefore(b,before||null)}
 b.textContent=on?'▸ Table':'▾ Table';b.title=on?'Show the table and notes under the chart again':'Hide the table and notes under the chart, to give the chart more room';
 if(on)for(let e=t;e;e=e.nextElementSibling)e.classList.add('tfoldx')}
/* Skins: a minimized panel's title bar shows its data as a thin shape behind the title and buttons, on the same time axis
   as every chart (YW on the left, 8 px on the right), so minimized panels can be compared for patterns. No labels or axis.
   Styles per panel ('skins'): line, mount (filled, the part above normal in red) or off. Numbers are scaled to the points
   inside the time window. Event panels (procedures, scan dates) show ticks whatever the style. */
let skins=store.get('skins',{})||{};
const SKIN_STYLES=['line','mount','off'];
const SKIN_SW=['lines','fill','band','total','off'];   // Swelling by lesion has its own styles
const SKIN_DOSE=['stack','blocks','lesions','range','heat','off'];   // Radiation dose
const SKIN_PERF=['line','vol','dots','range','peak','heat','off'];   // Perfusion
const SKIN_PROC=['merged','tall','activity','off'];   // Procedures · over time
const SKIN_PLIST=['both','size','color','off'];   // Procedures · list: weight shown as size + colour, size or colour
const SKIN_MRD=['mount','lolli','step','fade','dots','allele','grid','count','off'];   // Signatera (both panels)
const SKIN_MRDV=['sarea2','sdots','szoom','sdraw','slog','scount','sarea','slin','mount','grid','off'];   // Signatera · Tumor variants: stacked by variant
const SKIN_BP=['dband','split','band','lines','days','heat','off'];   // blood pressure (systolic + diastolic)
const isBP=id=>!!(BYID[id]&&BYID[id].pts.some(p=>p.v2!=null));
const SKIN_SCANS=['height','rows','colour','site','rich','off'];   // Brain MRI · Scan dates
const SKIN_LES=['lin','log','off'];   // Brain MRI · Lesions over time: mountain on a linear or a log scale
const stylesFor=id=>id==='img:brain:lesions'?SKIN_LES:id==='img:brain:dates'?SKIN_SCANS:isBP(id)?SKIN_BP:id==='mrd:var'?SKIN_MRDV:id.startsWith('mrd:')?SKIN_MRD:id==='proc:list'?SKIN_PLIST:id==='proc:timeline'?SKIN_PROC:id==='img:brain:swell'?SKIN_SW:id==='img:brain:dose'?SKIN_DOSE:id==='img:brain:perf'?SKIN_PERF:SKIN_STYLES;
const skinOf=id=>{const v=skins[id],L=stylesFor(id);return L.includes(v)?v:(id==='img:brain:lesions'?'lin':id==='img:brain:dates'?'height':isBP(id)?'dband':id==='mrd:var'?'sarea2':id.startsWith('mrd:')?'mount':id==='proc:list'?'both':id==='proc:timeline'?'merged':id==='img:brain:swell'?'lines':id==='img:brain:dose'?'stack':id==='img:brain:perf'?'peak':BYID[id]?'line':'mount')};
const skinLabel=id=>({line:'∿ line',mount:'▲ mountain',off:'skin off',lines:'∿ lines',fill:'▲▼ filled',band:'∿ + range',total:'∿ total',stack:'▤ stacked',split:'▬ split heat',lin:'▲ linear',log:'▲ log',rows:'☰ 3T / 1.5T rows',height:'┃ 3T tall',colour:'┃ 3T colour',site:'┃ hospital',rich:'┃ 3T + details',
  dband:'▒ daily band',band:'▒ every reading',days:'┃ daily range',heat:'▬ category',sdots:'◎ circles',sarea2:'◎ circles by area',szoom:'◎ circles ×3 (area)',sdraw:'◎ circles per draw',slog:'▤ stacked (log)',scount:'▤ stacked (count)',sarea:'▲ stacked area',slin:'▤ stacked (true size)',dots:'● calls',allele:'▲ allele (log)',grid:'⋮ variants',count:'▮ count',mtm:'▲ MTM',both:'● size + colour',size:'● size',color:'● colour',
  lolli:'⫯ stems',step:'▭ steps',fade:'◢ fade-out',lanes:'☰ lanes',tall:'☰ lanes ×2',merged:'• one row',activity:'▮ activity',vol:'∿ volume only',dots:'• dots',peak:'▲ highest',blocks:'▮ courses',lesions:'⌐ per lesion',range:'▒ range',heat:'▬ heat'})[skinOf(id)];
function skinCycle(id){const L=stylesFor(id),i=L.indexOf(skinOf(id));skins[id]=L[(i+1)%L.length];store.set('skins',skins);render()}
const skMed=a=>{a=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);return a.length?a[a.length>>1]:null};
const skT=s=>{if(!s)return null;s=String(s);return Date.parse(s.length<=10?s+'T12:00:00Z':s.replace(' ','T')+'Z')};
function skinData(id){
 if(isBP(id))return{kind:'bp'};
 if(BYID[id]){const p=BYID[id].pts.filter(x=>x.v!=null&&isFinite(+x.v)&&(x.ts||x.date));
  return{kind:'num',pts:p.map(x=>({t:x.ts||skT(x.date),v:+x.v,f:x.flag||''})),lo:skMed(p.map(x=>x.lo)),hi:skMed(p.map(x=>x.hi))}}
 if(id.startsWith('mrd:')&&D.mrd&&D.mrd.rows&&!['mount','lolli','step','fade'].includes(skinOf(id)))return{kind:'mrd'};
 if(id.startsWith('mrd:')&&D.mrd&&D.mrd.rows){const r=D.mrd.rows.filter(x=>x.draw_date);
  /* the filled mountain, on the open panel's measure (Allele-based: summed allele ratio of the variants found, from Natera's allele files;
     else MTM/mL); 'lift': the smallest finding sits just above the floor (log scale between the smallest and largest), so a single
     variant on a 'not detected' draw (V16, 5/6/2026) still shows */
  const al=store.get('mrd.measure','mtm')!=='mtm',sum={};(D.mrd.alleles||[]).forEach(a=>{sum[a.draw_date]=(sum[a.draw_date]||0)+(a.call&&a.call!=='NEGATIVE'?+a.allele_ratio||0:0)});
  return{kind:'num',lift:true,edges:true,pts:r.map(x=>{const v=al&&x.draw_date in sum?sum[x.draw_date]:parseFloat(x.value)||0;return{t:skT(x.draw_date),v,f:v>0?'H':''}}),lo:null,hi:null}}
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:lesions'){const by={};(IMG_DATA.lesion_series.measured||[]).forEach(m=>{if(m.enh_mm3!=null)by[m.date]=(by[m.date]||0)+m.enh_mm3});
  // log or linear: the bar's own style button (▲ linear / ▲ log), independent of the open panel
  return{kind:'num',log:skinOf(id)==='log',edges:true,pts:Object.keys(by).sort().map(d=>({t:skT(d),v:by[d]}))}}
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:dose'&&IMG_DATA.dose&&IMG_DATA.dose.courses)return{kind:'dose'};
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:perf'&&IMG_DATA.perfusion&&IMG_DATA.perfusion.rows)return{kind:'perf'};
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:swell'&&IMG_DATA.swelling&&IMG_DATA.swelling.rows)return{kind:'swell'};
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:dates')return{kind:'scans'};
 if(typeof IMG_DATA!=='undefined'&&id==='img:brain:viewer'&&IMG_DATA.thumbs&&Object.keys(IMG_DATA.thumbs).length)return{kind:'film'};
 if(typeof IMG_DATA!=='undefined'&&id.startsWith('img:'))return{kind:'ticks',ts:(IMG_DATA.brain_mri||[]).map(r=>skT(r.date))};
 if(typeof PROC_DATA!=='undefined'&&id==='proc:timeline')return{kind:'proc'};
 if(typeof PROC_DATA!=='undefined'&&id==='proc:list')return{kind:'proc',list:true};
 if(typeof PROC_DATA!=='undefined'&&id.startsWith('proc:'))return{kind:'ticks',ts:(PROC_DATA.events||[]).map(e=>skT(e.date)).filter(Boolean),
  spans:(PROC_DATA.stays||[]).map(x=>[skT(x.from),skT(x.to)]).filter(x=>x[0]&&x[1])};
 if(typeof PATH_DATA!=='undefined'&&id.startsWith('path:'))return{kind:'ticks',ts:(PATH_DATA.cases||[]).map(c=>skT(c.date)).filter(Boolean)};
 return null}
function skinAttach(h,id){const st=skinOf(id);if(st==='off')return;const cv=document.createElement('canvas');cv.className='skin';h.prepend(cv);if(id==='img:brain:viewer'||(id==='proc:timeline'&&st==='tall'))h.classList.add('film');
 h.classList.add('skinned');cv.dataset.id=id;requestAnimationFrame(()=>skinDraw(cv))}
function skinDraw(cv){const id=cv.dataset.id,d=skinData(id),h=cv.parentElement;if(!h)return;
 /* the skin covers the whole bar, edge to edge (the panel's padding included); the time axis is the shared one (the open charts'
    plot runs from YW to 8 px from the right), continued past both ends, so data just outside the window fills the margins and
    every date still sits where it does on the open charts */
 const PADX=10,PADY=5,W0=h.clientWidth+2*PADX,H0=h.clientHeight+2*PADY,dpr=devicePixelRatio||1;cv.style.left=-PADX+'px';cv.style.top=-PADY+'px';
 cv.width=W0*dpr;cv.height=H0*dpr;cv.style.width=W0+'px';cv.style.height=H0+'px';const g=cv.getContext('2d');g.scale(dpr,dpr);if(!d)return;
 const Lo=PADX+YW,Ro=PADX+h.clientWidth-8,gpos=window.pos,pos=t=>100*(Lo+gpos(t)/100*(Ro-Lo))/W0;   // shared axis, as a share of the whole bar
 const L=0,R=W0,X=t=>L+pos(t)/100*(R-L),inW=t=>{const x=X(t);return x>=-4&&x<=W0+4};let st=skinOf(id);if(st==='lin'||st==='log')st='mount';   // lesions: both are the mountain, on a linear or log scale
 const red='#e34948',blue=css('--accent')||'#3987e5',green='rgba(27,175,122,.22)';
 if(d.kind==='scans'){   // Brain MRI scan dates: 1.5T vs 3T told apart (rows, height or colour), hospital colours, or extra details
  const R=IMG_DATA.brain_mri||[],T3='#e0861a',T15='#3987e5',UNK='rgba(160,160,150,.7)',hits=cv._hits=[];
  const SP=['#2a7fd4','#d4572a','#2aa876','#a83fd0','#d4a72a','#d42a8a','#4a5568'],sites=[...new Set(R.map(r=>r.site))],SC=Object.fromEntries(sites.map((x,i)=>[x,SP[i%SP.length]]));
  const PR=(IMG_DATA.perfusion||{}).rows||[],perf=new Set(PR.map(r=>r.date)),perfOurs=new Set(PR.filter(r=>r.rcbv_source&&!/MD Anderson/.test(r.rcbv_source)).map(r=>r.date)),plan=r=>/planning/i.test(r.finding||''),noimg=r=>!r.images||r.partial;
  g.save();g.beginPath();g.rect(0,0,W0,H0);g.clip();
  R.forEach(r=>{const t=skT(r.date),x=X(t),f=String(r.field),is3=f==='3',known=f==='3'||f==='1.5';let col=known?(is3?T3:T15):UNK,y0=2,h=H0-4;
   if(st==='rows'){h=(H0-6)/2;y0=is3?2:known?H0/2+1:2;if(!known)h=H0-4}
   else if(st==='height'){h=is3?H0-4:known?(H0-4)*.5:(H0-4)*.3;y0=H0-2-h}
   else if(st==='site')col=SC[r.site]||UNK;
   if(st==='site'||st==='rich'){h=is3?H0-4:(H0-4)*.55;y0=H0-2-h}
   const w=st==='rich'||st==='site'?3:2.4;
   if(noimg(r)){g.strokeStyle=col;g.lineWidth=1;g.strokeRect(x-w/2+.5,y0+.5,w-1,h-1)}else{g.fillStyle=col;g.fillRect(x-w/2,y0,w,h)}
   // perfusion measured on this scan: a pink circle at the top of its tick (hollow = measured with our own method, compare loosely)
   if(perf.has(r.date)){const cy_=Math.max(5.5,y0-1);g.beginPath();g.arc(x,cy_,4.5,0,7);if(perfOurs.has(r.date)){g.strokeStyle='#e05ad0';g.lineWidth=1.6;g.stroke()}else{g.fillStyle='#e05ad0';g.fill();g.strokeStyle='rgba(0,0,0,.5)';g.lineWidth=.8;g.stroke()}}
   if(st==='rich'){
    if(plan(r)){g.fillStyle='#ffd23f';g.beginPath();g.moveTo(x,H0-9);g.lineTo(x+3,H0-6);g.lineTo(x,H0-3);g.lineTo(x-3,H0-6);g.closePath();g.fill()}}
   hits.push({x0:x-4,x1:x+4,y0:0,y1:H0,cx:x,lines:[r.date+' · '+(r.hospital||r.site)+(known?' · '+f+'T':''),(r.scanner||'scanner not recorded')+(r.images?' · '+r.images+' images':' · no images')+(r.partial?' (partial copy)':''),
    (r.finding||'')+(perf.has(r.date)?' · perfusion measured':'')]})});
  g.restore();return}
 if(d.kind==='bp'){   // blood pressure: systolic (top) and diastolic (bottom) of each reading; inpatient stays give many readings a day, so most
  // styles use each day's median; scaled so the window's lowest diastolic to highest systolic fill the bar; faint lines at 120 and 80
  const pts=BYID[id].pts.filter(p=>p.v!=null&&p.v2!=null).map(p=>({t:p.ts||skT(p.date),date:p.date,s:+p.v,d:+p.v2})).sort((a,b)=>a.t-b.t);
  const byDay={};pts.forEach(p=>{(byDay[p.date]=byDay[p.date]||[]).push(p)});const med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1]};
  const days=Object.keys(byDay).sort().map(k=>{const a=byDay[k];return{t:skT(k),date:k,s:med(a.map(p=>p.s)),d:med(a.map(p=>p.d)),smax:Math.max(...a.map(p=>p.s)),dmin:Math.min(...a.map(p=>p.d)),n:a.length}});
  const vis=pts.filter(p=>inW(p.t));if(!vis.length)return;const lo=Math.min(...vis.map(p=>p.d),75),hi=Math.max(...vis.map(p=>p.s),125),Y=v=>H0-2-(v-lo)/(hi-lo)*(H0-4);
  const hits=cv._hits=[];g.save();g.beginPath();g.rect(0,0,W0,H0);g.clip();
  g.strokeStyle='rgba(160,160,150,.35)';g.lineWidth=1;[120,80].forEach(v=>{g.beginPath();g.moveTo(0,Math.round(Y(v))+.5);g.lineTo(W0,Math.round(Y(v))+.5);g.stroke()});
  const cat=s=>s>=140?'#e34948':s>=130?'#eb6834':s>=120?'#d9a21b':'#1baf7a';
  const area=(a,fill)=>{if(!a.length)return;g.beginPath();a.forEach((p,i)=>i?g.lineTo(X(p.t),Y(p.s)):g.moveTo(X(p.t),Y(p.s)));for(let i=a.length-1;i>=0;i--)g.lineTo(X(a[i].t),Y(a[i].d));g.closePath();g.fillStyle=fill;g.fill()};
  if(st==='band')area(pts,'rgba(57,135,229,.45)');
  else if(st==='dband'){area(days,'rgba(57,135,229,.42)');g.strokeStyle='rgba(227,73,72,.85)';g.lineWidth=1.2;g.beginPath();days.forEach((p,i)=>i?g.lineTo(X(p.t),Y(p.s)):g.moveTo(X(p.t),Y(p.s)));g.stroke();
   g.strokeStyle='rgba(57,135,229,.95)';g.beginPath();days.forEach((p,i)=>i?g.lineTo(X(p.t),Y(p.d)):g.moveTo(X(p.t),Y(p.d)));g.stroke()}
  else if(st==='lines'){[['s','#e34948'],['d','#3987e5']].forEach(([k,c])=>{g.strokeStyle=c;g.lineWidth=1.3;g.beginPath();days.forEach((p,i)=>i?g.lineTo(X(p.t),Y(p[k])):g.moveTo(X(p.t),Y(p[k])));g.stroke()})}
  else if(st==='days'){days.forEach(p=>{const x=X(p.t);g.fillStyle=cat(p.smax);g.globalAlpha=.85;g.fillRect(x-1,Y(p.smax),2,Math.max(1.5,Y(p.dmin)-Y(p.smax)));g.globalAlpha=1})}
  else if(st==='split'){   // top half = systolic, bottom half = diastolic, each day tinted dark blue (lowest in the window) to bright orange (highest)
   const vd=days.filter(p=>inW(p.t)),rng=k=>{const a=vd.map(p=>p[k]);return [Math.min(...a),Math.max(...a)]},[s0,s1]=rng('s'),[d0,d1]=rng('d');
   const ramp=f=>{f=Math.max(0,Math.min(1,f));const A=[16,38,92],B=[255,150,20];return 'rgb('+A.map((a,i)=>Math.round(a+(B[i]-a)*f)).join(',')+')'};
   days.forEach((p,i)=>{const x1=i?(X(days[i-1].t)+X(p.t))/2:X(p.t)-2,x2=i<days.length-1?(X(p.t)+X(days[i+1].t))/2:X(p.t)+2;if(x2-x1>30)return;const w=Math.max(1.5,x2-x1);
    g.fillStyle=ramp((p.s-s0)/((s1-s0)||1));g.fillRect(x1,0,w,H0/2-.5);g.fillStyle=ramp((p.d-d0)/((d1-d0)||1));g.fillRect(x1,H0/2+.5,w,H0/2-.5)});
   g.restore();days.forEach(p=>hits.push({x0:X(p.t)-3,x1:X(p.t)+3,y0:0,y1:H0,cx:X(p.t),lines:[p.date+(p.n>1?' · '+p.n+' readings':''),'median '+p.s+'/'+p.d+' mmHg (top half systolic, bottom diastolic)']}));return}
  else if(st==='heat'){days.forEach((p,i)=>{const x1=i?(X(days[i-1].t)+X(p.t))/2:X(p.t)-2,x2=i<days.length-1?(X(p.t)+X(days[i+1].t))/2:X(p.t)+2;if(x2-x1>30)return;g.fillStyle=cat(p.s);g.globalAlpha=.75;g.fillRect(x1,0,Math.max(1.5,x2-x1),H0);g.globalAlpha=1})}
  days.forEach(p=>hits.push({x0:X(p.t)-3,x1:X(p.t)+3,y0:0,y1:H0,cx:X(p.t),lines:[p.date+(p.n>1?' · '+p.n+' readings':''),'median '+p.s+'/'+p.d+' mmHg'+(p.n>1?' · highest systolic '+p.smax+', lowest diastolic '+p.dmin:'')]}));
  g.restore();return}
 if(d.kind==='mrd'){   // Signatera from the allele files: which tumour variants were found at each draw (a single one, e.g. V16 on
  // 5/6/2026, is a negative call for Natera but still shows here), on scales that let one small finding show
  const MR=D.mrd,rows=MR.rows.filter(r=>r.draw_date).map(r=>({t:skT(r.draw_date),date:r.draw_date,res:r.result||'',mtm:r.value})),byD={};
  (MR.alleles||[]).forEach(a=>{const o=byD[a.draw_date]=byD[a.draw_date]||{found:[],n:0};o.n++;if(a.call&&a.call!=='NEGATIVE'&&+a.allele_ratio>0)o.found.push({id:a.target_id,v:+a.allele_ratio})});
  const vn=id_=>+String(id_).split('_')[1],NT=Object.keys(MR.vars||{}).length||16,RED='#e34948',AMB='#d9a21b',hits=cv._hits=[];
  const callCol=n=>n>=2?RED:n===1?AMB:null;
  rows.forEach(r=>{const o=byD[r.date];r.file=!!o;r.found=o?o.found:[];r.sum=r.found.reduce((p,q)=>p+q.v,0)});
  const tipOf=r=>[r.date+' · Natera: '+(r.res||'?')+(r.mtm!=null?' ('+r.mtm+' MTM/mL)':''),r.file?(r.found.length?r.found.length+' variant'+(r.found.length>1?'s':'')+' found: '+r.found.map(f=>'V'+vn(f.id)+' '+(f.v*100).toFixed(3)+'%').join(', '):'no variant found'):'no allele file from Natera'];
  g.save();g.beginPath();g.rect(0,0,W0,H0);g.clip();
  if(st==='allele'){   // summed allele ratio of the variants found, log scale (0.001% to the highest), so 0.04% still stands up
   const lo=-5,hi=Math.max(-3,...rows.filter(r=>r.sum>0).map(r=>Math.log10(r.sum))),Y=v=>v>0?H0-2-(Math.log10(v)-lo)/(hi-lo)*(H0-4):H0-1;
   const pts=rows.filter(r=>r.file).sort((a,b)=>a.t-b.t);if(pts.length){g.beginPath();g.moveTo(X(pts[0].t),H0);pts.forEach(r=>g.lineTo(X(r.t),Y(r.sum)));g.lineTo(X(pts[pts.length-1].t),H0);g.closePath();g.fillStyle='rgba(227,73,72,.45)';g.fill()}
   pts.forEach(r=>{const c=callCol(r.found.length);g.fillStyle=c||'rgba(160,160,150,.7)';g.beginPath();g.arc(X(r.t),Y(r.sum),c?3:2,0,7);g.fill();hits.push({x0:X(r.t)-5,x1:X(r.t)+5,y0:0,y1:H0,cx:X(r.t),lines:tipOf(r)})});
   rows.filter(r=>!r.file).forEach(r=>{g.fillStyle='rgba(160,160,150,.45)';g.fillRect(X(r.t)-.5,H0-5,1,4);hits.push({x0:X(r.t)-4,x1:X(r.t)+4,y0:0,y1:H0,cx:X(r.t),lines:tipOf(r)})});g.restore();return}
  // stacked by variant (Tumor variants): per draw, the variants found piled up in their own colours, the largest at the bottom
  const VCf=window.SIG_VCOL||(t=>'#e34948');
  if(st==='sdots'||st==='sarea2'||st==='szoom'||st==='sdraw'){   // circles centred on each draw, one per variant found, in its colour, the biggest at the back: the largest
   // finding visible in the time window is the bar's full height; every other circle's width is in proportion to its allele ratio
   // (so the difference is exaggerated, not log-squeezed), at least 3 px so a small one still shows
   /* sdots: width in proportion to the allele ratio · sarea2: AREA in proportion (width ~ square root: the true-to-the-eye way, small ones bigger)
      · szoom: area in proportion, but 3x bigger, the largest runs past the bar's edge and is cut off · sdraw: each draw scaled on its own
      (its largest = full height; ratios hold within a draw, not between draws) */
   const vis=rows.filter(r=>inW(r.t)),vmax=Math.max(1e-9,...vis.flatMap(r=>r.found.map(f=>f.v))),cy=H0/2;
   const diaF=(v,mx)=>Math.max(3,st==='sdots'?H0*v/mx:st==='szoom'?3*H0*Math.sqrt(v/mx):H0*Math.sqrt(v/mx));
   rows.forEach(r=>{const x=X(r.t),fs=[...r.found].sort((a,b)=>b.v-a.v),mx=st==='sdraw'&&fs.length?fs[0].v:vmax,dia=v=>diaF(v,mx);
    if(!fs.length){g.strokeStyle=r.file?'rgba(200,200,190,.6)':'rgba(160,160,150,.35)';g.lineWidth=1;g.beginPath();g.arc(x,cy,1.6,0,7);g.stroke()}
    else fs.forEach(f=>{const rr=dia(f.v)/2;g.fillStyle=VCf(f.id);g.beginPath();g.arc(x,cy,rr,0,7);g.fill();g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=.9;g.stroke()});
    hits.push({x0:x-Math.max(6,fs.length?dia(fs[0].v)/2:0),x1:x+Math.max(6,fs.length?dia(fs[0].v)/2:0),y0:0,y1:H0,cx:x,lines:tipOf(r)})});g.restore();return}
  if(st==='slog'||st==='scount'||st==='slin'||st==='sarea'){
   const all=rows.flatMap(r=>r.found.map(f=>f.v)),vmin=all.length?Math.min(...all):1e-4,vmax=all.length?Math.max(...all):1e-3,lg=v=>3+(Math.log(v)-Math.log(vmin))/((Math.log(vmax)-Math.log(vmin))||1)*10;
   const seg=v=>st==='scount'?1:st==='slin'?v:lg(v),tot=r=>r.found.reduce((p,f)=>p+seg(f.v),0),mx=Math.max(1e-9,...rows.map(tot)),k=(H0-3)/mx,cw=6;
   if(st==='sarea'){   // layers in a fixed order (variant with the highest peak at the bottom), joined from draw to draw
    const peak={};rows.forEach(r=>r.found.forEach(f=>{peak[f.id]=Math.max(peak[f.id]||0,f.v)}));const order=Object.keys(peak).sort((a,b)=>peak[b]-peak[a]);
    const pts=rows.filter(r=>r.file).sort((a,b)=>a.t-b.t),base=pts.map(()=>H0);
    order.forEach(id_=>{const top=pts.map((r,i)=>{const f=r.found.find(q=>q.id===id_);return base[i]-(f?lg(f.v)*k:0)});
     g.beginPath();pts.forEach((r,i)=>i?g.lineTo(X(r.t),top[i]):g.moveTo(X(r.t),top[i]));for(let i=pts.length-1;i>=0;i--)g.lineTo(X(pts[i].t),base[i]);g.closePath();
     g.fillStyle=VCf(id_);g.globalAlpha=.85;g.fill();g.globalAlpha=1;top.forEach((y,i)=>{base[i]=y})});
    rows.forEach(r=>hits.push({x0:X(r.t)-5,x1:X(r.t)+5,y0:0,y1:H0,cx:X(r.t),lines:tipOf(r)}));g.restore();return}
   rows.forEach(r=>{const x=X(r.t);let y=H0;[...r.found].sort((a,b)=>b.v-a.v).forEach(f=>{const hh=Math.max(1.5,seg(f.v)*k);g.fillStyle=VCf(f.id);g.fillRect(x-cw/2,y-hh,cw,hh-.6);y-=hh});
    if(!r.found.length){g.fillStyle=r.file?'rgba(160,160,150,.5)':'rgba(160,160,150,.25)';g.fillRect(x-.5,H0-3,1,2)}hits.push({x0:x-5,x1:x+5,y0:0,y1:H0,cx:x,lines:tipOf(r)})});g.restore();return}
  if(st==='grid'){   // one thin row per tumour variant (V1 at the top): a dot where it was found, red when 2+ were found that draw, amber when only one
   const rh=(H0-2)/NT;rows.forEach(r=>{if(!r.file){g.fillStyle='rgba(160,160,150,.25)';g.fillRect(X(r.t)-.5,1,1,H0-2)}else{g.fillStyle='rgba(160,160,150,.18)';g.fillRect(X(r.t)-.5,1,1,H0-2)}
    r.found.forEach(f=>{g.fillStyle=callCol(r.found.length);g.beginPath();g.arc(X(r.t),1+(vn(f.id)-.5)*rh,Math.max(1.6,rh*.75),0,7);g.fill()});hits.push({x0:X(r.t)-5,x1:X(r.t)+5,y0:0,y1:H0,cx:X(r.t),lines:tipOf(r)})});g.restore();return}
  if(st==='count'){   // how many variants were found at each draw (bar height), red 2+, amber 1
   const mx=Math.max(2,...rows.map(r=>r.found.length));rows.forEach(r=>{const n=r.found.length,x=X(r.t);if(n){const hh=Math.max(5,n/mx*(H0-3));g.fillStyle=callCol(n);g.fillRect(x-2,H0-1-hh,4,hh)}else{g.fillStyle=r.file?'rgba(160,160,150,.6)':'rgba(160,160,150,.3)';g.fillRect(x-1,H0-3,2,2)}
    hits.push({x0:x-5,x1:x+5,y0:0,y1:H0,cx:x,lines:tipOf(r)})});g.restore();return}
  // dots (default for Over time): every draw a dot, like the open panel's legend: red = 2+ variants (Natera positive), amber = 1 variant
  // (Natera negative), hollow = none found, small grey = no allele file; size grows with the number found
  rows.forEach(r=>{const n=r.found.length,x=X(r.t),y=H0/2;if(n){g.fillStyle=callCol(n);g.beginPath();g.arc(x,y,Math.min(H0*.45,3+n*1.3),0,7);g.fill();if(n===1){g.strokeStyle='#fff';g.lineWidth=1;g.stroke()}}
   else if(r.file){g.strokeStyle='rgba(200,200,190,.7)';g.lineWidth=1;g.beginPath();g.arc(x,y,2.5,0,7);g.stroke()}else{g.fillStyle='rgba(160,160,150,.5)';g.beginPath();g.arc(x,y,1.5,0,7);g.fill()}
   hits.push({x0:x-6,x1:x+6,y0:0,y1:H0,cx:x,lines:tipOf(r)})});g.restore();return}
 if(d.kind==='proc'){   // Procedures · over time, shrunk: the open panel's lanes (its order, hidden lanes and Colour: type / hospital), no labels or grid
  const P=PROC_DATA,LK=P.lanes.map(l=>l.key),LC=Object.fromEntries(P.lanes.map(l=>[l.key,l.color||'#888'])),opt=Object.assign({color:'type'},store.get('proc.opts',{}));
  const SP=['#2a7fd4','#d4572a','#2aa876','#a83fd0','#d4a72a','#d42a8a','#4a5568'],SC=Object.fromEntries(P.sites.map((x,i)=>[x.key,SP[i%SP.length]])),VTC=Object.fromEntries((P.visit_types||[]).map(v=>[v.key,v.color]));
  const order=store.get('proc.laneOrder',LK).filter(k=>LK.includes(k)),hid=new Set(store.get('proc.laneHidden',[]));LK.forEach(k=>{if(!order.includes(k))order.push(k)});const VIS=order.filter(k=>!hid.has(k));
  const SNM=Object.fromEntries((P.sites||[]).map(x=>[x.key,x.short])),BY=Object.fromEntries(P.events.map(e=>[e.id,e])),col=(lane,site)=>opt.color==='site'&&site?(SC[site]||'#888'):LC[lane];
  // everything as marks: {lane, a, b (span end or null), c (colour), k: kind}
  /* a rough display weight, 1-4 (not a clinical severity): kind of procedure (surgery 3; biopsy, port/line, lumbar puncture 2;
     other 1), +1 when an inpatient/overnight stay covers its date; stays by length (ER 1.5, observation 2, 1 day 2, 2-4 days 3,
     5+ days 4); radiation fractions 1; visits 0.6 */
  const BASEW={surgery:3,biopsy:2,line:2,lp:2,other:1},stayW=x=>{if(x.kind==='er')return 1.5;if(x.kind==='observation')return 2;const d=(skT(x.to)-skT(x.from))/DAY;return d>=5?4:d>=2?3:2};
  const inStay=t=>(P.stays||[]).some(x=>x.kind!=='er'&&t>=skT(x.from)-DAY&&t<=skT(x.to)+DAY);
  const encL=d.list?st:null;const M=[];if(d.list)st='weighted';P.events.forEach(e=>{const t=skT(e.date);if(t)M.push({lane:e.lane,a:t,c:col(e.lane,e.site),k:'pt',w:Math.min(4,(BASEW[e.lane]||1)+(inStay(t)?1:0)),e})});
  // devices as in the open panel: placement to removal; no removal on record = fades out by end_unknown; still in = to today
  if(!d.list)(P.devices||[]).forEach(d=>{const e0=BY[d.from],e1=d.to?BY[d.to]:null,a=e0&&skT(e0.date);if(a)M.push({lane:e0.lane,a,b:e1?skT(e1.date):d.end_unknown?skT(d.end_unknown):Math.min(Date.now(),X1),c:col(e0.lane,e0.site),k:'bar',fade:!e1&&!!d.end_unknown,thin:!!d.thin,tip:[d.label,'placed '+e0.date+(e1?' · removed '+e1.date:' · '+(d.end||''))]})});
  if(!d.list)(P.stays||[]).forEach(x=>{const a=skT(x.from),b=skT(x.to)||a;if(a)M.push({lane:'stay',a,b:Math.max(b,a+DAY),c:col('stay',x.site),k:'bar',w:stayW(x),tip:[(P.stay_kinds||{})[x.kind]||x.kind,x.from.slice(0,10)+' – '+x.to.slice(0,10)+' · '+(SNM[x.site]||x.site)]})});
  if(!d.list)(P.visits||[]).forEach(v=>{const a=skT(v.start);if(a)M.push({lane:'visit',a,c:opt.color==='site'?(SC[v.site]||'#888'):(VTC[v.sub]||LC.visit),k:'tick',w:.6})});
  if(!d.list)(P.rt_courses||[]).forEach(c=>{(c.fx||[]).forEach(f=>{const a=skT(f.d);if(a)M.push({lane:c.lane,a,c:LC[c.lane],k:'tick',est:f.est,w:1})});const a=skT(c.from),b=skT(c.to);if(a&&b)M.push({lane:c.lane,a,b,c:LC[c.lane],k:'band'})});
  const PX=X;const vis=M.filter(m=>VIS.includes(m.lane)&&(m.b?PX(m.b)>=0&&PX(m.a)<=W0:inW(m.a)));
  g.save();g.beginPath();g.rect(L,0,R-L,H0);g.clip();
  if(st==='activity'){   // how busy each stretch was: a column per ~1% of the width, stacked by lane colour, height = number of marks
   const nb=Math.max(20,Math.round((R-L)/6)),bw=(R-L)/nb,cnt=Array.from({length:nb},()=>({}));vis.forEach(m=>{if(m.k==='band')return;const i=Math.min(nb-1,Math.max(0,Math.floor((PX(m.a)-L)/bw)));cnt[i][m.lane]=(cnt[i][m.lane]||0)+1});
   const mx=Math.max(1,...cnt.map(o=>Object.values(o).reduce((p,q)=>p+q,0)));cnt.forEach((o,i)=>{let y=H0-1;VIS.forEach(k=>{const n=o[k];if(!n)return;const hh=Math.max(1.5,n/mx*(H0-3));g.fillStyle=LC[k];g.fillRect(L+i*bw+.5,y-hh,bw-1,hh);y-=hh})});g.restore();return}
  const rows=st==='merged'||st==='weighted'?1:VIS.length||1,rh=(H0-2)/rows,rowY=lane=>st==='merged'||st==='weighted'?1:1+VIS.indexOf(lane)*rh;
  const enc=st==='weighted'?(window.__procEnc||encL||'both'):'none',bySize=enc==='size'||enc==='both',byCol=enc==='color'||enc==='both';
  const WC=['#8a8984','#d9a21b','#eb6834','#e34948'],wcol=w=>WC[Math.max(0,Math.min(3,Math.round(w)-1))];   // weight colours: grey, amber, orange, red
  if(enc!=='none')vis.sort((p,q)=>(p.w||1)-(q.w||1));   // heavier marks drawn last, on top
  const hits=cv._hits=[];const WTXT=['','minor','moderate','bigger','major'];
  vis.forEach(m=>{const y=rowY(m.lane),w=m.w||1,f=bySize?Math.max(.25,w/4):1,hh=(st==='merged'||st==='weighted'?H0-2:rh)*(m.k==='band'?1:f),yy=st==='merged'||st==='weighted'?(H0-hh)/2:y;
   const c0=byCol&&m.k!=='band'?wcol(w):m.c;g.fillStyle=c0;m={...m,c:c0};const y_=yy;
   if(m.k==='band'){g.globalAlpha=.18;g.fillRect(PX(m.a),y,Math.max(2,PX(m.b)-PX(m.a)),hh);g.globalAlpha=1}
   else if(m.k==='bar'){const x0=PX(m.a),x1=Math.max(PX(m.b),x0+2),bh=Math.max(1.5,hh*(m.thin?.35:.6)),by=y_+(hh-bh)/2;
    if(m.tip)hits.push({x0,x1,y0:by-3,y1:by+bh+3,lines:m.tip});
    if(m.fade){const gr=g.createLinearGradient(x0,0,x1,0);gr.addColorStop(0,m.c);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr}g.globalAlpha=(st==='merged'||st==='weighted')&&m.lane==='line'?.28:.75;/* one row: ports and lines faint so they don't hide the rest */g.fillRect(x0,by,x1-x0,bh);g.globalAlpha=1}
   else if(m.k==='tick'){g.globalAlpha=m.est?.45:.85;g.fillRect(PX(m.a)-.5,y_+hh*.15,1.2,Math.max(1.5,hh*.7));g.globalAlpha=1}
   else{const r_=Math.max(1.6,Math.min(bySize?H0*.42:4,hh*.42));if(m.e)hits.push({x0:PX(m.a)-r_-3,x1:PX(m.a)+r_+3,y0:0,y1:H0,cx:PX(m.a),
     lines:[m.e.procedure||m.e.short||'',(m.e.date||m.e.date_text||'')+(m.e.where&&m.e.where!=='—'?' · '+m.e.where:''),m.e.result||'',enc!=='none'?'weight '+Math.round(w)+' of 4 ('+WTXT[Math.round(w)]+'; rough, from the kind of procedure and any hospital stay)':''].filter(Boolean)});
    g.beginPath();g.arc(PX(m.a),y_+hh/2,r_,0,7);g.fill();if(byCol&&w>=3){g.strokeStyle='rgba(255,255,255,.7)';g.lineWidth=1;g.stroke()}}});
  g.restore();return}
 if(d.kind==='perf'){   // Perfusion: the open panel's lines (its lesion buttons, blood volume / flow / both, × normal or nearby brain):
  // blood volume solid, blood flow dashed, each lesion in its colour; the grey line = 1× (same as the reference brain); fills the bar's height
  const PF=IMG_DATA.perfusion,LS=IMG_DATA.lesion_series,VP=Object.assign({m:'both',hidden:[],ref:'normal'},store.get('img.perfChart',{}));
  const vv=(r,k)=>r[k+(VP.ref==='near'?'_vs_near':'_mean_ratio')],ks=VP.m==='both'?['rcbv','asl']:[VP.m],col=Object.fromEntries((LS.lesions||[]).map(l=>[l.id,'rgb('+l.rgb+')']));
  const lines=[];[...new Set(PF.rows.map(r=>r.lesion))].sort().filter(l=>!VP.hidden.includes(l)).forEach(l=>ks.forEach(k=>{
   const p=PF.rows.filter(r=>r.lesion===l&&vv(r,k)!=null).map(r=>({t:skT(r.date),v:+vv(r,k),weak:!!r[k+'_vessel']})).sort((a,b)=>a.t-b.t);if(p.length)lines.push({c:col[l]||'#888',k,p})}));
  const vis=lines.flatMap(l=>l.p.filter(p=>inW(p.t)));if(!vis.length)return;
  // ratios on a log scale (½× and 2× equally far from 1×), all readings in the window filling the bar's height
  const lg=v=>Math.log(Math.max(v,.05));let lo=Math.min(0,...vis.map(p=>lg(p.v))),hi=Math.max(0,...vis.map(p=>lg(p.v)));if(hi-lo<.2){hi+=.1;lo-=.1}
  const pad=2,Y=v=>H0-pad-(lg(v)-lo)/(hi-lo)*(H0-2*pad),PX=t=>L+pos(t)/100*(R-L);g.save();g.beginPath();g.rect(L,0,R-L,H0);g.clip();
  g.strokeStyle='rgba(160,160,150,.5)';g.lineWidth=1;g.beginPath();g.moveTo(L,Math.round(Y(1))+.5);g.lineTo(R,Math.round(Y(1))+.5);g.stroke();
  // styles: line = every lesion, both measures · vol = blood volume only · dots = points only · range = lowest–highest lesion per scan with the median
  // · peak = the highest lesion per scan, filled (red above 1×, blue below) · heat = the bar tinted per scan by its highest lesion
  const scans=[...new Set(vis.map(p=>p.t))].sort((a,b)=>a-b),perScan=t=>lines.filter(l=>st!=='vol'||l.k==='rcbv').map(l=>(l.p.find(p=>p.t===t)||{}).v).filter(v=>v!=null);
  if(st==='range'||st==='peak'||st==='heat'){const S=scans.map(t=>{const v=perScan(t).sort((a,b)=>a-b);return v.length?{t,lo:v[0],hi:v[v.length-1],med:v[v.length>>1]}:null}).filter(Boolean);
   const ringC=()=>[...new Set(PF.rows.filter(r=>r.rcbv_source&&!/MD Anderson/.test(r.rcbv_source)).map(r=>skT(r.date)))].forEach(t=>{if(!inW(t))return;g.strokeStyle=css('--ink');g.lineWidth=1.2;g.beginPath();g.arc(PX(t),5,3.2,0,7);g.stroke()});
   if(st==='heat'){S.forEach((p,i)=>{const x1=i?(PX(S[i-1].t)+PX(p.t))/2:PX(p.t)-6,x2=i<S.length-1?(PX(p.t)+PX(S[i+1].t))/2:PX(p.t)+6,v=Math.log2(p.hi);
     g.fillStyle=v>=0?`rgba(227,73,72,${Math.min(.9,.15+v*.35)})`:`rgba(57,135,229,${Math.min(.9,.15-v*.35)})`;g.fillRect(x1,0,x2-x1,H0)});ringC();g.restore();return}
   if(st==='peak'){const y1=Y(1);g.save();g.beginPath();g.moveTo(PX(S[0].t),y1);S.forEach(p=>g.lineTo(PX(p.t),Y(p.hi)));g.lineTo(PX(S[S.length-1].t),y1);g.closePath();g.clip();
     g.fillStyle='rgba(227,73,72,.75)';g.fillRect(L,0,R-L,y1);g.fillStyle='rgba(57,135,229,.6)';g.fillRect(L,y1,R-L,H0-y1);g.restore();ringC();g.restore();return}
   g.beginPath();S.forEach((p,i)=>i?g.lineTo(PX(p.t),Y(p.hi)):g.moveTo(PX(p.t),Y(p.hi)));for(let i=S.length-1;i>=0;i--)g.lineTo(PX(S[i].t),Y(S[i].lo));g.closePath();g.fillStyle='rgba(224,90,208,.28)';g.fill();
   g.strokeStyle='#e05ad0';g.lineWidth=1.5;g.beginPath();S.forEach((p,i)=>i?g.lineTo(PX(p.t),Y(p.med)):g.moveTo(PX(p.t),Y(p.med)));g.stroke();ringC();g.restore();return}
  if(st==='dots'){lines.forEach(l=>l.p.forEach(p=>{if(!inW(p.t))return;g.fillStyle=l.c;g.globalAlpha=l.k==='rcbv'?.95:.5;g.beginPath();g.arc(PX(p.t),Y(p.v),l.k==='rcbv'?2.6:2,0,7);g.fill()}));g.globalAlpha=1;g.restore();return}
  lines.forEach(l=>{if(st==='vol'&&l.k!=='rcbv')return;g.strokeStyle=l.c;g.lineWidth=l.k==='rcbv'?1.5:1.2;g.setLineDash(l.k==='asl'?[4,3]:[]);g.globalAlpha=.9;g.beginPath();l.p.forEach((p,i)=>i?g.lineTo(PX(p.t),Y(p.v)):g.moveTo(PX(p.t),Y(p.v)));g.stroke();g.setLineDash([]);
   l.p.forEach(p=>{if(!inW(p.t))return;g.fillStyle=l.c;if(p.weak){g.strokeStyle=l.c;g.strokeRect(PX(p.t)-1.5,Y(p.v)-1.5,3,3)}else g.fillRect(PX(p.t)-1.5,Y(p.v)-1.5,3,3)})});
  // scans measured with our own method (not a hospital map, e.g. UCLA 2/2025): a hollow ring at the top of the bar = compare loosely
  [...new Set(PF.rows.filter(r=>r.rcbv_source&&!/MD Anderson/.test(r.rcbv_source)).map(r=>skT(r.date)))].forEach(t=>{if(!inW(t))return;g.strokeStyle=css('--ink');g.lineWidth=1.2;g.beginPath();g.arc(PX(t),5,3.2,0,7);g.stroke()});
  g.globalAlpha=1;g.restore();return}
 if(d.kind==='dose'){   // Radiation dose: each course as a block in its panel colour (whole brain gold, SRS courses as in the panel), from its
  // start to its end; height = the course's mean dose to the lesions (Gy or EQD2, as set in the panel); a step line = the running total
  const DS=IMG_DATA.dose,CI=DS.course_info||{},eq=store.get('img.doseUnit','gy')==='eqd2',FC=['#7b68ee','#e05cc0','#3fb6c6','#e07b39','#8fbf3f'];
  let n=0;const CC=Object.fromEntries(Object.entries(CI).map(([k,c])=>[k,c.kind==='whole'?'#d9a21b':FC[n++%FC.length]]));
  // a course's layer = its dose to the lesions it aimed at (targeted), so a one-lesion course like SRS 2026 still shows at its real dose
  const per={},perAll={};(DS.rows||[]).forEach(r=>{const v=eq?r.eqd2_tumor:r.gy;if(v==null)return;(perAll[r.course]=perAll[r.course]||[]).push(+v);if(r.targeted)(per[r.course]=per[r.course]||[]).push(+v)});
  Object.keys(perAll).forEach(k=>{if(!per[k])per[k]=perAll[k]});
  const mean=k=>per[k]&&per[k].length?per[k].reduce((a,b)=>a+b,0)/per[k].length:null;
  const cs=DS.courses.map(c=>({k:c.course,a:skT(c.start),b:skT(c.end)||skT(c.start),v:mean(c.course)??(+c.total_gy||0),brain:!!CI[c.course]})).filter(c=>c.a).sort((x,y)=>x.a-y.a);
  let run=0;const steps=cs.filter(c=>c.brain).map(c=>({t:c.b,v:(run+=c.v)}));const top=Math.max(run,...cs.map(c=>c.v),1);
  const Y=v=>H0-2-v/top*(H0-4),PX=t=>L+pos(t)/100*(R-L);g.save();g.beginPath();g.rect(L,0,R-L,H0);g.clip();
  // per lesion: running dose after each course (Gy or EQD2), for the per-lesion, range and heat styles
  const LSc=Object.fromEntries(((IMG_DATA.lesion_series||{}).lesions||[]).map(l=>[l.id,'rgb('+l.rgb+')']));
  const byL={};(DS.rows||[]).forEach(r=>{const v=eq?r.eqd2_tumor:r.gy;if(v==null)return;(byL[r.lesion]=byL[r.lesion]||[]).push({a:skT(r.start),b:skT(r.end)||skT(r.start),v:+v})});
  const runL=Object.fromEntries(Object.entries(byL).map(([k,a])=>{a.sort((x,y)=>x.a-y.a);let s=0;return [k,a.map(x=>({a:x.a,b:x.b,from:s,to:(s+=x.v)}))]}));
  const lmax=Math.max(1,...Object.values(runL).map(a=>a.length?a[a.length-1].to:0));
  const YL=v=>H0-2-v/lmax*(H0-4),stepPath=a=>{g.beginPath();g.moveTo(L,YL(0));a.forEach(x=>{g.lineTo(PX(x.a),YL(x.from));g.lineTo(PX(x.b),YL(x.to))});g.lineTo(R+1,YL(a.length?a[a.length-1].to:0))};
  if(st==='blocks'){cs.forEach(c=>{if(c.b<W.a||c.a>W.b)return;const x1=PX(Math.max(c.a,W.a)),x2=PX(Math.min(c.b,W.b));g.fillStyle=c.brain?CC[c.k]:'rgba(160,160,150,.6)';g.fillRect(x1-1,1,Math.max(5,x2-x1+2),H0-2)});g.restore();return}
  if(st==='lesions'){Object.keys(runL).sort().forEach(k=>{g.strokeStyle=LSc[k]||'#888';g.lineWidth=1.3;g.globalAlpha=.9;stepPath(runL[k]);g.stroke()});g.globalAlpha=1;g.restore();return}
  if(st==='range'||st==='heat'){const ts=[...new Set(Object.values(runL).flatMap(a=>a.flatMap(x=>[x.a,x.b])))].sort((a,b)=>a-b);
   const at=(a,t)=>{let v=0;a.forEach(x=>{if(t>=x.b)v=x.to;else if(t>x.a)v=x.from+(x.to-x.from)*(t-x.a)/(x.b-x.a||1)});return v};
   const pts=[W.a,...ts.filter(t=>t>W.a&&t<W.b),W.b].map(t=>{const vs=Object.values(runL).map(a=>at(a,t));return {t,lo:Math.min(...vs),hi:Math.max(...vs),mean:vs.reduce((p,q)=>p+q,0)/vs.length}});
   if(st==='heat'){for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],x1=PX(a.t),x2=PX(b.t),v=b.mean/lmax;g.fillStyle=`hsl(${45-45*v} 85% ${30+25*v}%)`;g.globalAlpha=v>0?.85:0;g.fillRect(x1,0,Math.max(1,x2-x1)+.5,H0)}g.globalAlpha=1;g.restore();return}
   g.beginPath();pts.forEach((p,i)=>i?g.lineTo(PX(p.t),YL(p.hi)):g.moveTo(PX(p.t),YL(p.hi)));for(let i=pts.length-1;i>=0;i--)g.lineTo(PX(pts[i].t),YL(pts[i].lo));g.closePath();g.fillStyle='rgba(217,162,27,.35)';g.fill();
   g.strokeStyle='#d9a21b';g.lineWidth=1.5;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(PX(p.t),YL(p.mean)):g.moveTo(PX(p.t),YL(p.mean)));g.stroke();g.restore();return}
  // stacked like the open panel's bars: each brain course adds its layer from its start onwards (ramping up over the course);
  // height = the targeted dose of each course so far (the most-treated lesion's total); a course outside the brain (e.g. chest) is a grey block
  let base=0;cs.forEach(c=>{const x1=PX(c.a),x2=Math.max(PX(c.b),x1+2);if(!c.brain){if(c.b<W.a||c.a>W.b)return;g.fillStyle='rgba(160,160,150,.45)';g.fillRect(x1,H0*.5,Math.max(3,x2-x1),H0*.5-2);return}
   const y0=Y(base),y1=Y(base+c.v);g.fillStyle=CC[c.k];g.globalAlpha=.8;g.beginPath();g.moveTo(x1,y0);g.lineTo(x2,y1);g.lineTo(R+1,y1);g.lineTo(R+1,y0);g.closePath();g.fill();
   g.globalAlpha=1;g.strokeStyle=CC[c.k];g.lineWidth=1;g.beginPath();g.moveTo(x1,y0);g.lineTo(x2,y1);g.lineTo(R+1,y1);g.stroke();base+=c.v});
  g.restore();return}
 if(d.kind==='swell'){   // Swelling by lesion: one line per lesion shown in the open panel (its lesion buttons, Each / Total, % or mL)
  const SW=IMG_DATA.swelling,LS=IMG_DATA.lesion_series,VS=Object.assign({total:true,each:true,hidden:[],unit:'pct'},store.get('img.swellChart2',{}));
  const val=r=>VS.unit==='ml'?r.ml:r.pct,col=Object.fromEntries((LS.lesions||[]).map(l=>[l.id,'rgb('+l.rgb+')']));
  const lines=[];if(VS.each&&st!=='total'){const by={};SW.rows.forEach(r=>{if(VS.hidden.includes(r.lesion)||val(r)==null)return;(by[r.lesion]=by[r.lesion]||[]).push({t:skT(r.date),v:val(r)})});
   Object.keys(by).sort().forEach(k=>lines.push({c:col[k]||'#888',w:1.3,p:by[k].sort((a,b)=>a.t-b.t)}))}
  if(VS.total||st==='total')lines.push({c:css('--ink'),w:2.2,p:(SW.totals||[]).filter(r=>val(r)!=null).map(r=>({t:skT(r.date),v:val(r)})).sort((a,b)=>a.t-b.t),tot:true});
  const vis=lines.flatMap(l=>l.p.filter(p=>inW(p.t)));if(!vis.length)return;
  // all the readings in the window (and 0) fill the bar's full height
  let lo=Math.min(0,...vis.map(p=>p.v)),hi=Math.max(0,...vis.map(p=>p.v));if(hi-lo<1){hi+=.5;lo-=.5}
  const pad=2,Y=v=>H0-pad-(v-lo)/(hi-lo)*(H0-2*pad),Y0=Y(0),PX=t=>L+pos(t)/100*(R-L);
  g.save();g.beginPath();g.rect(L,0,R-L,H0);g.clip();
  if(st==='band'&&VS.unit!=='ml'){const b=(SW.band||[]).map(x=>({t:skT(x.date),lo:x.lo,hi:x.hi})).sort((a,b)=>a.t-b.t);if(b.length){g.beginPath();b.forEach((x,i)=>i?g.lineTo(PX(x.t),Y(x.hi)):g.moveTo(PX(x.t),Y(x.hi)));
   for(let i=b.length-1;i>=0;i--)g.lineTo(PX(b[i].t),Y(b[i].lo));g.closePath();g.fillStyle='rgba(160,160,150,.22)';g.fill()}}
  g.strokeStyle='rgba(160,160,150,.45)';g.lineWidth=1;g.beginPath();g.moveTo(L,Math.round(Y0)+.5);g.lineTo(R,Math.round(Y0)+.5);g.stroke();
  if(st==='fill'){const tl=lines.find(l=>l.tot)||lines[lines.length-1];if(tl&&tl.p.length){const pth=()=>{g.beginPath();g.moveTo(PX(tl.p[0].t),Y0);tl.p.forEach(p=>g.lineTo(PX(p.t),Y(p.v)));g.lineTo(PX(tl.p[tl.p.length-1].t),Y0);g.closePath()};
   g.save();pth();g.clip();g.fillStyle='rgba(227,73,72,.55)';g.fillRect(L,0,R-L,Y0);g.fillStyle='rgba(57,135,229,.55)';g.fillRect(L,Y0,R-L,H0-Y0);g.restore()}}
  lines.forEach(l=>{if(st==='fill'&&l.tot)return;g.strokeStyle=l.c;g.lineWidth=l.w;g.globalAlpha=l.tot?.95:.85;g.beginPath();l.p.forEach((p,i)=>i?g.lineTo(PX(p.t),Y(p.v)):g.moveTo(PX(p.t),Y(p.v)));g.stroke();
   l.p.forEach(p=>{if(inW(p.t)){g.fillStyle=l.c;g.fillRect(PX(p.t)-1.5,Y(p.v)-1.5,3,3)}})});
  g.globalAlpha=1;g.restore();return}
 if(d.kind==='film'){   // minimized MRI viewer: one axial picture per scan at its date, the last 4-view picture at the left under the title
  /* with the cursor locked: the scan on or before that day gets an outline, and before the first scan the 4-view picture is left out */
  const T=IMG_DATA.thumbs,sz=H0-6,TD=Object.keys(T).sort(),lk=LOCK?iso(LOCK.t):null,lkd=lk?TD.filter(dt=>dt<=lk).pop():null;let last=-1e9;TD.forEach(dt=>{const t=skT(dt);if(!inW(t))return;const x=X(t)-sz*.45;if(dt!==lkd&&x-last<sz*.9+2)return;last=x;
   const im=skImg(T[dt],()=>skinDraw(cv));if(im.complete&&im.naturalWidth){const c=skCrop(im),w=Math.round(sz*c.w/c.h);g.drawImage(im,c.x,c.y,c.w,c.h,X(t)-w/2,3,w,sz);
    if(dt===lkd){g.strokeStyle=css('--accent');g.lineWidth=2;g.strokeRect(X(t)-w/2-1,2,w+2,sz+2)}}});
  const f4=lk&&!lkd?null:localStorage.getItem('imgfour');if(f4){const im=skImg(f4,()=>skinDraw(cv));if(im.complete&&im.naturalWidth){const hh=Math.round(H0/2)-4,ww=Math.round(im.naturalWidth/im.naturalHeight*hh);
   g.fillStyle=css('--card');g.fillRect(PADX+6,H0/2,ww+4,hh+4);g.drawImage(im,PADX+8,H0/2+1,ww,hh)}}
  return}
 if(d.kind==='ticks'){g.fillStyle='rgba(155,147,238,.18)';(d.spans||[]).forEach(([a,b])=>{if(b<W.a||a>W.b)return;g.fillRect(X(a),0,Math.max(2,X(b)-X(a)),H0)});
  g.fillStyle='rgba(155,147,238,.65)';d.ts.forEach(t=>{if(t&&inW(t))g.fillRect(Math.round(X(t))-1,2,2,H0-4)});return}
 const pts=d.pts.filter(p=>p.t).sort((a,b)=>a.t-b.t);if(!pts.length)return;
 const iw=pts.filter(p=>inW(p.t)),use=iw.length?iw:pts,f=v=>d.log?Math.log10(Math.max(v,1)):v;
 let lo=Math.min(...use.map(p=>f(p.v))),hi=Math.max(...use.map(p=>f(p.v)));if(d.hi!=null&&!d.log)hi=Math.max(hi,d.hi);if(d.lo!=null&&!d.log)lo=Math.min(lo,d.lo);if(hi-lo<1e-9){hi+=1;lo-=1}
 let Y;if(d.lift){const pv=use.map(p=>p.v).filter(v=>v>0),mn=pv.length?Math.min(...pv):1,mx=pv.length?Math.max(...pv):1,LO=Math.log(mn),HI=Math.log(mx);
  Y=v=>v<=0?H0+1:H0-2-(4+(HI>LO?(Math.log(v)-LO)/(HI-LO):1)*(H0-10))}   // 0 = below the bar's edge (no colour at all); the smallest finding 4 px up; the largest at the top
 else{const pad=3;Y=v=>H0-pad-(f(v)-lo)/(hi-lo)*(H0-2*pad)}
 if(d.lo!=null&&d.hi!=null&&!d.log){g.fillStyle=green;g.fillRect(L,Y(d.hi),R-L,Y(d.lo)-Y(d.hi))}
 // the points in the window plus one on each side, so the shape runs to the edges
 let i0=pts.findIndex(p=>p.t>=W.a);if(i0<0)i0=pts.length-1;let i1=pts.length-1;for(let i=pts.length-1;i>=0;i--)if(pts[i].t<=W.b){i1=i;break}
 const seg=pts;   // every point: the bar's margins show the data just outside the window
 g.save();g.beginPath();g.rect(L,0,R-L,H0);g.clip();
 const path=()=>{g.beginPath();seg.forEach((p,i)=>{const x=L+pos(p.t)/100*(R-L),y=Y(p.v);i?g.lineTo(x,y):g.moveTo(x,y)})};
 if(d.lift&&(st==='lolli'||st==='step'||st==='fade')){   /* other Signatera looks, same scale (smallest finding just above the floor):
     lolli = a stem and a dot at each positive draw, nothing in between; step = each positive draw holds its level halfway to the draws
     either side; fade = each positive draw a peak that fades to nothing over ~3 weeks either side (no claim about the months between) */
  const PXs=t=>L+pos(t)/100*(R-L),C='rgba(227,73,72,.8)';
  seg.forEach((p,i)=>{if(!(p.v>0))return;const x=PXs(p.t),y=Y(p.v);
   if(st==='lolli'){g.strokeStyle=C;g.lineWidth=2;g.beginPath();g.moveTo(x,H0);g.lineTo(x,y);g.stroke();g.fillStyle='#e34948';g.beginPath();g.arc(x,y,2.8,0,7);g.fill()}
   else if(st==='step'){const xl=i?(PXs(seg[i-1].t)+x)/2:x-4,xr=i<seg.length-1?(x+PXs(seg[i+1].t))/2:x+4;g.fillStyle=C;g.fillRect(xl,y,xr-xl,H0-y);g.fillStyle='#e34948';g.fillRect(xl,y,xr-xl,1.5)}
   else{const w=Math.max(4,PXs(p.t+21*DAY)-x),gr=g.createLinearGradient(x-w,0,x+w,0);gr.addColorStop(0,'rgba(227,73,72,0)');gr.addColorStop(.5,C);gr.addColorStop(1,'rgba(227,73,72,0)');
    g.fillStyle=gr;g.beginPath();g.moveTo(x-w,H0+1);g.quadraticCurveTo(x-w*.35,y,x,y);g.quadraticCurveTo(x+w*.35,y,x+w,H0+1);g.closePath();g.fill()}});
  // where consecutive positive draws are joined (both found something): a thin line between their tops
  if(st!=='step'){g.strokeStyle='rgba(227,73,72,.55)';g.lineWidth=1;for(let i=0;i+1<seg.length;i++){const a=seg[i],b=seg[i+1];if(a.v>0&&b.v>0){g.beginPath();g.moveTo(PXs(a.t),Y(a.v));g.lineTo(PXs(b.t),Y(b.v));g.stroke()}}}}
 else if(st==='mount'&&d.edges){   /* filled only between two readings that both found something; a stretch between "nothing" and "something" is unknown
     (when it started or stopped is not measured): Signatera = a dotted line only, lesions = a faint grey wedge with a dashed edge
     ("onset unknown"). Every finding also gets a narrow peak of its own, so a single one between two negatives still shows. */
  const fill=d.lift?'rgba(227,73,72,.75)':'rgba(57,135,229,.42)',edge=d.lift?'rgba(227,73,72,.9)':'rgba(140,160,200,.9)',PXs=t=>L+pos(t)/100*(R-L);
  for(let i=0;i+1<seg.length;i++){const a=seg[i],b=seg[i+1],xa=PXs(a.t),xb=PXs(b.t),ya=Y(a.v),yb=Y(b.v);
   if(a.v>0&&b.v>0){g.beginPath();g.moveTo(xa,ya);g.lineTo(xb,yb);g.lineTo(xb,H0+1);g.lineTo(xa,H0+1);g.closePath();g.fillStyle=fill;g.fill()}
   else if((a.v>0||b.v>0)&&d.lift){   // Signatera: into / out of a negative draw = a short filled taper next to the positive draw (about two weeks,
    // at most half way to the other draw), then nothing: the bar doesn't claim a level for the weeks or months in between
    const pz=a.v>0?a:b,xp=a.v>0?xa:xb,yp=a.v>0?ya:yb,w=Math.min(Math.abs(xb-xa)/2,Math.max(3,PXs(pz.t+14*DAY)-xp)),xe=a.v>0?xp+w:xp-w;
    g.beginPath();g.moveTo(xp,yp);g.lineTo(xe,H0+1);g.lineTo(xp,H0+1);g.closePath();g.fillStyle=fill;g.fill()}
   else if(a.v>0||b.v>0){if(!d.lift){g.beginPath();g.moveTo(xa,ya);g.lineTo(xb,yb);g.lineTo(xb,H0+1);g.lineTo(xa,H0+1);g.closePath();g.fillStyle='rgba(160,160,150,.22)';g.fill()}
    g.setLineDash([2,3]);g.strokeStyle=edge;g.lineWidth=1.2;g.beginPath();g.moveTo(xa,ya);g.lineTo(xb,yb);g.stroke();g.setLineDash([])}}
  seg.forEach(p=>{if(!(p.v>0))return;const x=PXs(p.t),y=Y(p.v);g.beginPath();g.moveTo(x-4,H0+1);g.lineTo(x,y);g.lineTo(x+4,H0+1);g.closePath();g.fillStyle=fill;g.fill()})}
 else if(st==='mount'){path();const xl=L+pos(seg[seg.length-1].t)/100*(R-L),xf=L+pos(seg[0].t)/100*(R-L);g.lineTo(xl,H0);g.lineTo(xf,H0);g.closePath();
  g.fillStyle=d.lift?'rgba(227,73,72,.75)':'rgba(57,135,229,.38)';g.fill();
  const top=d.hi!=null&&!d.log?Y(d.hi):null;if(top!=null){g.save();g.beginPath();g.rect(L,0,R-L,top);g.clip();path();g.lineTo(xl,H0);g.lineTo(xf,H0);g.closePath();g.fillStyle='rgba(227,73,72,.85)';g.fill();g.restore()}}
 else{path();g.strokeStyle=blue;g.globalAlpha=.9;g.lineWidth=1.5;g.stroke();g.globalAlpha=1}
 seg.forEach(p=>{if(!/H|L/.test(p.f||''))return;g.fillStyle=/H/.test(p.f)?red:blue;g.fillRect(L+pos(p.t)/100*(R-L)-1.5,Y(p.v)-1.5,3,3)});
 g.restore()}
const SKIMG=new Map(),SKCROP=new Map();
/* the brain's box inside a filmstrip picture: rows and columns where over a tenth of the pixels are not black (a 1 px crosshair line or a corner letter doesn't count) */
function skCrop(im){if(SKCROP.has(im.src))return SKCROP.get(im.src);const w=im.naturalWidth,h=im.naturalHeight,c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(im,0,0);
 const d=g.getImageData(0,0,w,h).data,rows=new Array(h).fill(0),cols=new Array(w).fill(0);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(d[i]+d[i+1]+d[i+2]>90){rows[y]++;cols[x]++}}
 const fy=rows.map(n=>n>w*.1),fx=cols.map(n=>n>h*.1),y0=Math.max(0,fy.indexOf(true)-2),y1=Math.min(h,fy.lastIndexOf(true)+3),x0=Math.max(0,fx.indexOf(true)-2),x1=Math.min(w,fx.lastIndexOf(true)+3);
 const r=y1>y0+10&&x1>x0+10?{x:x0,y:y0,w:x1-x0,h:y1-y0}:{x:0,y:0,w,h};SKCROP.set(im.src,r);return r}
function skImg(src,onload){let im=SKIMG.get(src);if(!im){im=new Image();im.onload=onload;im.src=src;SKIMG.set(src,im)}return im}
/* the viewer's four views as they were when it was minimized (kept in this browser, outside the Start view) */
function captureFour(){const V=window.__imgViewer;try{if(V&&V.nv&&V.R('box').offsetHeight){V.nv.drawScene();localStorage.setItem('imgfour',V.R('cv').toDataURL('image/jpeg',.8))}}catch(e){}}
/* hover on a minimized bar: what the mark under the pointer is (bars that recorded marks while drawing, e.g. Procedures) */
(function(){let tip=null;const hide=()=>{if(tip)tip.style.display='none'};
 document.addEventListener('mousemove',e=>{const bar=e.target.closest&&e.target.closest('.cmp.pmin');const cv=bar&&bar.querySelector('canvas.skin');if(!cv||!cv._hits||!cv._hits.length||e.target.closest('button'))return hide();
  const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bd=1e9;
  cv._hits.forEach(h=>{if(x<h.x0||x>h.x1||y<h.y0||y>h.y1)return;const dd=h.cx!=null?Math.abs(x-h.cx):(h.x1-h.x0);if(dd<bd){bd=dd;best=h}});
  if(!best)return hide();if(!tip){tip=document.createElement('div');tip.className='skintip';document.body.appendChild(tip)}
  tip.innerHTML='';best.lines.forEach((l,i)=>{const d=document.createElement(i?'div':'b');d.textContent=l;tip.appendChild(d)});
  tip.style.display='block';tip.style.left=Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8)+'px';tip.style.top=(e.clientY+14)+'px'});
 document.addEventListener('scroll',hide,true)})();
function skinsRedraw(){document.querySelectorAll('canvas.skin').forEach(skinDraw)}
function cmpPanel(id,i,box){{const isM=MRD.isId(id),t=isM?null:BYID[id];if(!isM&&!t)return;const H0=isM?MRD.h0(id):160;const w=document.createElement('div');w.className='cmp'+(id===hlLab?' hl':'');w.dataset.id=id;
  const h=document.createElement('div');h.className='cmph';
  const b=document.createElement('b');b.textContent=isM?MRD.title(id):labLabel(t);b.title=isM?MRD.title(id):t.name;const u=document.createElement('span');u.className='u';u.textContent=isM?MRD.unit(id):t.unit||'';
  const ctl=document.createElement('span');ctl.className='ctl';
  const mk=(label,title,fn)=>{const x=document.createElement('button');x.textContent=label;x.title=title;x.setAttribute('aria-label',title);x.onclick=fn;ctl.appendChild(x);return x};
  mk('⤒','Move this panel to the top',()=>moveStage(id,'top')).dataset.mv='top';
  mk('↑','Move this panel up',()=>moveStage(id,-1)).dataset.mv='-1';
  mk('↓','Move this panel down',()=>moveStage(id,1)).dataset.mv='1';
  mk('⤓','Move this panel to the bottom',()=>moveStage(id,'bottom')).dataset.mv='bottom';
  mk('−','Shorter',()=>{setH(id,hOf(id,H0)-40);render()});
  mk('+','Taller',()=>{setH(id,hOf(id,H0)+40);render()});
  mk(minLabel(id),isMin(id)?'Open this panel again':'Minimize this panel to its title bar',()=>setMin(id,!isMin(id)));
  mk('×','Remove from comparison',()=>{toggle(id,false);list()});
  h.append(b,u,ctl);
  if(isMin(id)){w.classList.add('pmin');mk(skinLabel(id),'Skin style for this minimized bar: line, mountain or off',()=>{skinCycle(id)}).classList.add('skbtn');ctl.insertBefore(ctl.lastChild,ctl.children[ctl.children.length-3]);w.append(h);box.appendChild(w);skinAttach(h,id);return}
  if(isM){const body=document.createElement('div');w.append(h,body);box.appendChild(w);MRD.panel(id,body);liftTools(h,body,id);return}   // MRD panel: mrd_view.js draws it
  const cb=document.createElement('div');cb.style.cssText='position:relative;height:'+hOf(id,160)+'px';
  const cv=document.createElement('canvas');cv.setAttribute('role','img');cv.setAttribute('aria-label','Trend of '+t.name);cb.appendChild(cv);
  w.append(h,cb);box.appendChild(w);
  charts.set(id,makeChart(cv,t,{compact:true,dateLabel:false,showX:true}))}}

const wa=$('wa'),wb=$('wb');[wa,wb].forEach(e=>{e.min=0;e.max=NDAYS;e.step=1});
const wp=$('wp');wp.min=0;wp.step=1;
function syncWin(){wa.value=Math.round((W.a-X0)/DAY);wb.value=Math.round((W.b-X0)/DAY);const short=(W.b-W.a)<=3*DAY,dl=t=>(short?zStamp(t):zStamp(t).slice(0,10))+(NAVTZ||short?' '+zAbbr(t):'');$('wal').textContent=dl(W.a);$('wbl').textContent=dl(W.b);$('wml').textContent='Middle: '+dl((W.a+W.b)/2);
 const len=Math.round((W.b-W.a)/DAY);wp.max=Math.max(0,NDAYS-len);wp.value=Math.round((W.a-X0)/DAY);wp.disabled=+wp.max===0;
 const hrs=(W.b-W.a)/36e5;$('wlen').textContent=len>=730?(Math.round(len/36.5)/10)+' yrs':len>=60?Math.round(len/30.44)+' months':hrs<48?Math.round(hrs)+' hours':len+' days';
 $('wIn').disabled=W.b-W.a<=MINW+1;$('wOut').disabled=W.a<=X0&&W.b>=X1;if(typeof kfScrollSync==='function')kfScrollSync();if(typeof skinsRedraw==='function')requestAnimationFrame(skinsRedraw);if(typeof lockBar==='function')lockBar()}
function setWin(a,b){
 /* a window that ends past the axis (a saved Timeline preset that looks ahead, opened where Future is off or shorter): lengthen the axis to hold it */
 if(b>X1+DAY&&b<=futEnd(FUTMAX)+DAY){FUT=futFor(b-DAY);store.set('future',FUT);X1=futEnd(FUT);NDAYS=Math.round((X1-X0)/DAY);[wa,wb].forEach(e=>e.max=NDAYS);futSync()}
 a=Math.max(X0,Math.min(a,X1-MINW));b=Math.min(X1,Math.max(b,a+MINW));W={a,b};store.set('window',W);syncWin();renderWin()}
/* Future setting: lengthen or shorten the axis by whole months. A window that reached the old end follows the new end (so the
   future part shows at once); others keep their dates. Also used by panels that offer "show it on the timeline" (setFuture(n, true)). */
const wfut=$('wfut');
function futSync(){const lab=m=>{if(!m)return'off';const e=new Date(futEnd(m)-DAY);return'+'+m+' month'+(m>1?'s':'')+' · to '+MON[e.getUTCMonth()]+' '+e.getUTCFullYear()};
 const opts=[0,1,2,3,6,12,24];if(!opts.includes(FUT))opts.push(FUT);opts.sort((a,b)=>a-b);wfut.innerHTML='';
 opts.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=lab(m);wfut.appendChild(o)});
 const c=document.createElement('option');c.value='date';c.textContent='pick an end date…';wfut.appendChild(c);wfut.value=String(FUT);wfut.classList.toggle('on',FUT>0)}
function setFuture(m,show){m=Math.max(0,Math.min(FUTMAX,Math.round(m)||0));const atEnd=W.b>=X1-DAY;FUT=m;store.set('future',FUT);X1=futEnd(FUT);NDAYS=Math.round((X1-X0)/DAY);
 [wa,wb].forEach(e=>e.max=NDAYS);futSync();let a=W.a,b=W.b;if(atEnd||show||b>X1)b=X1;if(b-a<MINW)a=Math.max(X0,b-MINW);setWin(a,b)}
/* months needed for the axis to reach a date (used by the calendar below and by panels with projections) */
const futFor=t=>{const d=new Date(t),e=new Date(XD);return Math.max(0,Math.min(FUTMAX,(d.getUTCFullYear()-e.getUTCFullYear())*12+d.getUTCMonth()-e.getUTCMonth()+1))};
function openFutCal(){const P=$('calPop');P.innerHTML='';P.classList.remove('hide');
 const h=document.createElement('b');h.textContent='Timeline runs until';const i=document.createElement('input');i.type='date';i.min=iso(XD);i.max=iso(futEnd(FUTMAX)-DAY);i.value=iso(Math.max(XD,X1-DAY));
 const note=document.createElement('div');note.className='sub';note.style.cssText='margin-top:6px;max-width:230px';note.textContent='The axis ends with the month of this date (at most '+FUTMAX/12+' years past the data).';
 const apply=()=>{const t=Date.parse(i.value+'T12:00:00Z');if(isFinite(t))setFuture(futFor(t),true)};
 i.onkeydown=e=>{if(e.key==='Enter'){apply();closeCal()}};
 const bar=document.createElement('div');bar.className='bar';const done=document.createElement('button');done.type='button';done.textContent='Set';done.className='on';done.onclick=()=>{apply();closeCal()};bar.append(done);
 P.append(h,i,note,bar);const r=wfut.getBoundingClientRect();P.style.left=Math.max(6,Math.min(r.left,innerWidth-250))+'px';P.style.top=(r.bottom+6)+'px';i.focus();try{i.showPicker()}catch(e){}}
wfut.onchange=()=>{if(wfut.value==='date'){wfut.value=String(FUT);openFutCal()}else setFuture(+wfut.value)};futSync();
/* calendar pop-out for From / Middle / To: a date-and-time field that opens the browser's calendar.
   Picking a date applies it at once; Middle moves the window and keeps its length. */
const toInput=t=>zStamp(t).replace(' ','T');
function openCal(which,anchor){const P=$('calPop');P.innerHTML='';P.classList.remove('hide');
 const lbl={a:'Start (From)',m:'Go to a date',b:'End (To)'}[which];
 const h=document.createElement('b');h.textContent=lbl;const i=document.createElement('input');i.type='datetime-local';
 const cur=()=>which==='a'?W.a:which==='b'?W.b:(W.a+W.b)/2;
 /* time zone the typed time is read in (remembered); hospitals' zones from the private site_zones.json */
 const zs=document.createElement('select');zs.className='tzsel';zs.title='Time zone the date and time are read in. Records happen in different zones: pick the one where the event took place.';
 const zinfo=document.createElement('div');zinfo.className='sub';zinfo.style.cssText='margin-top:3px;max-width:230px';
 const fill=()=>{const sites={};Object.entries(D.siteZones||{}).forEach(([s,z])=>{if(tzOk(z))(sites[z]=sites[z]||[]).push(s)});
  const L=[''].concat(Object.keys(sites),Object.keys(ZNAMES).filter(z=>!sites[z]));if(NAVTZ&&!L.includes(NAVTZ))L.push(NAVTZ);
  zs.innerHTML='';L.forEach(z=>{const o=document.createElement('option');o.value=z;o.textContent=zName(z)+(sites[z]?' · '+sites[z].join(', '):'');zs.append(o)});
  const o=document.createElement('option');o.value='?';o.textContent='Other zone…';zs.append(o);zs.value=NAVTZ};
 const show=()=>{i.min=toInput(X0);i.max=toInput(X1);i.value=toInput(cur());const t=zParse(i.value);zinfo.textContent='Read as '+zAbbr(t)+' ('+zUtc(t)+' on this date)'};
 zs.onchange=()=>{let z=zs.value;if(z==='?'){z=(prompt('Time zone name (IANA), e.g. Europe/London or Asia/Tokyo:',NAVTZ||BROWSER_TZ)||'').trim();if(!z||!tzOk(z)){if(z)alert('Unknown time zone: '+z);zs.value=NAVTZ;return}}
  NAVTZ=z===BROWSER_TZ?'':z;store.set('navTz',NAVTZ);fill();show();syncWin()};
 fill();show();
 i.oninput=()=>{const t=zParse(i.value);if(isFinite(t))zinfo.textContent='Read as '+zAbbr(t)+' ('+zUtc(t)+' on this date)'};
 /* Middle can only move the window if it is shorter than the whole record; otherwise say so. */
 const note=document.createElement('div');note.className='sub';note.style.cssText='margin-top:6px;max-width:230px';
 const full=()=>W.b-W.a>=X1-X0-DAY;
 const hint=()=>{note.textContent=which==='m'?(full()?'Go to a date: the charts zoom to 6 months around it and the cursor locks on it.':'Go to a date: it moves to the middle and the cursor locks on it.'):''};
 const apply=()=>{const t=zParse(i.value);if(!isFinite(t))return;const len=W.b-W.a;
  if(which==='a')setWin(t,Math.max(W.b,t+MINW));else if(which==='b')setWin(Math.min(W.a,t-MINW),t);else goToDate(t);
  if(which==='m'&&Math.abs(cur()-t)>DAY)note.textContent='The window reaches the edge of the record, so '+zStamp(t).slice(0,10)+' is off centre (the cursor is locked on it).';
  else hint()};
 /* the calendar fires a change for every digit or arrow step: wait until the picking pauses */
 let tmr=0;i.onchange=()=>{i.oninput();clearTimeout(tmr);tmr=setTimeout(apply,350)};
 i.onkeydown=e=>{if(e.key==='Enter'){clearTimeout(tmr);apply();closeCal()}};
 const bar=document.createElement('div');bar.className='bar';const done=document.createElement('button');done.type='button';done.textContent='Done';done.className='on';done.onclick=()=>{clearTimeout(tmr);apply();closeCal()};bar.append(done);
 hint();P.append(h,zs,i,zinfo,note,bar);const r=anchor.getBoundingClientRect();P.style.left=Math.max(6,Math.min(r.left,innerWidth-250))+'px';P.style.top=(r.bottom+6)+'px';
 i.focus();try{i.showPicker()}catch(e){}}
function closeCal(){$('calPop').classList.add('hide')}
document.addEventListener('mousedown',e=>{if(!$('calPop').classList.contains('hide')&&!e.target.closest('#calPop')&&!e.target.closest('.datebtn')&&!e.target.closest('#wfut'))closeCal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCal()});
$('wal').onclick=e=>openCal('a',e.currentTarget);$('wbl').onclick=e=>openCal('b',e.currentTarget);$('wml').onclick=e=>openCal('m',e.currentTarget);
$('saveRange').onclick=saveRange;
wa.oninput=()=>{const a=X0+wa.value*DAY;setWin(a,Math.max(W.b,a+MINW))};
/* From / To: fine control. Dragging a slider's knob moves the date by one window length over the slider's width (instead of
   the whole record), so a short window near today can be set precisely; Shift = 4× finer still. A click on the bar away from
   the knob still jumps there. − / + step the date by a round amount that suits the window (a day, week, month, quarter or year). */
const wStep=()=>{const t=(W.b-W.a)/12;return [365.25,91.31,30.44,7,1].map(d=>d*DAY).find(d=>d<=t)||DAY};
const wStepName=()=>({365.25:'a year',91.31:'3 months',30.44:'a month',7:'a week',1:'a day'})[Math.round(wStep()/DAY*100)/100];
function setEnd(k,t){if(k==='a')setWin(Math.min(t,W.b-MINW),W.b);else setWin(W.a,Math.max(t,W.a+MINW))}
document.querySelectorAll('[data-ws]').forEach(b=>{b.onclick=()=>{const k=b.dataset.ws;setEnd(k,(k==='a'?W.a:W.b)+(+b.dataset.d)*wStep())};
 b.onmouseenter=()=>{b.title=(b.dataset.ws==='a'?'Start':'End')+(b.dataset.d<0?' earlier':' later')+' by '+wStepName()+' (step size follows the window length)'}});
[[wa,'a'],[wb,'b']].forEach(([el,k])=>{let drag=null;
 el.addEventListener('pointerdown',e=>{const r=el.getBoundingClientRect(),f=(+el.value-+el.min)/((+el.max-+el.min)||1),kx=r.left+8+f*(r.width-16);
  if(Math.abs(e.clientX-kx)>10)return;   // on the bar, not the knob: normal jump
  e.preventDefault();el.setPointerCapture(e.pointerId);drag={x:e.clientX,t:k==='a'?W.a:W.b,per:Math.max(DAY/24,(W.b-W.a)/Math.max(60,r.width))};el.classList.add('fine')});
 el.addEventListener('pointermove',e=>{if(!drag)return;const dx=(e.clientX-drag.x)*(e.shiftKey?.25:1);setEnd(k,drag.t+dx*drag.per)});
 const end=()=>{drag=null;el.classList.remove('fine')};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)});
wb.oninput=()=>{const b=X0+wb.value*DAY;setWin(Math.min(W.a,b-MINW),b)};
/* move / zoom keep the window's length or centre; moving redraws at most once per frame */
let panFrame=0;
function shiftWin(a,len){a=Math.max(X0,Math.min(a,X1-len));W={a,b:a+len};store.set('window',W);syncWin();cancelAnimationFrame(panFrame);panFrame=requestAnimationFrame(renderWin)}
wp.oninput=()=>shiftWin(X0+wp.value*DAY,W.b-W.a);
$('wPrev').onclick=()=>shiftWin(W.a-(W.b-W.a)/4,W.b-W.a);$('wNext').onclick=()=>shiftWin(W.a+(W.b-W.a)/4,W.b-W.a);
/* zoom around the date in the middle of the charts. In wide windows the years before the break are squeezed, so
   that date is not the window's time midpoint (zooming around the midpoint jumped to a nearly empty stretch) */
/* the window start that puts date c in the middle of the charts (in wide windows the years before the break are squeezed) */
function centreStart(c,len){let a=c-len/2;
 if(BRK!=null){const keep=W;let lo=X0,hi=Math.max(X0,X1-len);   // find the start that puts c in the middle of the (maybe squeezed) new window
  for(let i=0;i<50;i++){const m=(lo+hi)/2;W={a:m,b:m+len};if(unpos(50)<c)lo=m;else hi=m}a=(lo+hi)/2;W=keep}
 return a}
/* zoom around the locked cursor when it is on screen (so the moment stays put), else around the middle */
function zoomWin(f){const len=Math.min(X1-X0,Math.max(MINW,(W.b-W.a)*f));
 const c=LOCK&&LOCK.t>=W.a&&LOCK.t<=W.b?LOCK.t:compressing()?unpos(50):(W.a+W.b)/2;shiftWin(centreStart(c,len),len)}
$('wIn').onclick=()=>zoomWin(.5);$('wOut').onclick=()=>zoomWin(2);
/* ---- Go to a date, and the locked cursor ----
   Going to a date (Middle calendar, a story link, Keyframes ◀ ▶, ⌖ Find) puts that date in the middle of the charts and pins a
   solid cursor line there on every timeline panel and minimized bar. The pin stays on its date while you zoom (zoom keeps it in
   the middle), drag a chart or slide the window into the past or future, so the moment isn't lost. 📍 Lock pins it at the middle;
   Shift-click a chart, or press L while pointing, moves it there; clicking the date centres it again; × lets go.
   Panels that show one thing at a time follow it through the 'ohd:date' event (Brain MRI slice viewer: the latest scan on or
   before that date, none before the first scan). Kept in the 'lock' setting (part of the Start view). */
var LOCK=store.get('lock',null);if(LOCK&&!isFinite(LOCK.t))LOCK=null;
const lockDay=t=>zStamp(t).slice(0,10);
function lockBar(){const el=$('lockBar');if(!el)return;el.innerHTML='';
 if(!LOCK){const b=document.createElement('button');b.type='button';b.textContent='📍 Lock cursor';
  b.title='Pin a cursor line at the middle date on every panel. It stays on that date while you zoom, drag or slide the timeline. Shift-click a chart (or press L while pointing at one) to pin it there instead. The Brain MRI viewer shows the scan from that date.';
  b.onclick=()=>setLock(compressing()?unpos(50):(W.a+W.b)/2);el.append(b);return}
 const off=LOCK.t<W.a?'◂ ':LOCK.t>W.b?' ▸':'';const b=document.createElement('button');b.type='button';b.className='on';
 b.textContent='📍 '+(LOCK.t<W.a?off:'')+lockDay(LOCK.t)+(LOCK.t>W.b?off:'');
 b.title='Cursor locked to '+lockDay(LOCK.t)+(off?' (off screen: click to bring it back to the middle)':': click to put it back in the middle')+'. Shift-click a chart or press L while pointing to move it.';
 b.onclick=()=>goToDate(LOCK.t);
 const x=document.createElement('button');x.type='button';x.className='lockx';x.textContent='×';x.title='Unlock the cursor';x.setAttribute('aria-label',x.title);x.onclick=()=>setLock(null);
 el.append(b,x)}
function setLock(t,quiet){LOCK=t==null||!isFinite(t)?null:{t:Math.max(X0,Math.min(X1,t))};store.set('lock',LOCK);lockBar();
 charts.forEach(c=>c.draw());if(typeof skinsRedraw==='function')requestAnimationFrame(skinsRedraw);
 if(!quiet)document.dispatchEvent(new CustomEvent('ohd:date',{detail:{t:LOCK?LOCK.t:null}}))}
/* centre the charts on date t and lock the cursor there. The window keeps its length; a window showing (nearly) the whole record
   can't move, so it narrows to o.wide (6 months by default) around the date. */
function goToDate(t,o){o=o||{};if(!isFinite(t))return;let len=o.len||W.b-W.a;if(len>=(X1-X0)*.9)len=Math.min(X1-X0,o.wide||182*DAY);
 len=Math.max(MINW,len);setWin(centreStart(t,len),centreStart(t,len)+len);setLock(t)}
window.goToDate=goToDate;window.setLock=setLock;window.lockT=()=>LOCK?LOCK.t:null;
/* the locked line on every timeline chart (the same test as the future tint: the shared time axis) */
Chart.register({id:'lockCursor',afterDatasetsDraw(c){if(!LOCK)return;const sx=c.scales.x;if(!sx||sx.options.afterFit!==tEdge)return;
 const a=c.chartArea,px=Math.round(sx.getPixelForValue(pos(LOCK.t)))+.5;if(px<a.left-1||px>a.right+1)return;const g=c.ctx;g.save();
 g.strokeStyle=css('--accent');g.lineWidth=1.5;g.globalAlpha=.85;g.beginPath();g.moveTo(px,a.top);g.lineTo(px,a.bottom);g.stroke();
 g.globalAlpha=1;g.fillStyle=css('--accent');g.beginPath();g.moveTo(px-4.5,a.top);g.lineTo(px+4.5,a.top);g.lineTo(px,a.top+6);g.closePath();g.fill();g.restore()}});
/* and on the minimized bars' skins (same mapping as skinDraw) */
{const _sd=skinDraw;skinDraw=function(cv){_sd(cv);if(!LOCK)return;const h=cv.parentElement;if(!h)return;const PADX=10,Lo=PADX+YW,Ro=PADX+h.clientWidth-8;
 if(LOCK.t<W.a||LOCK.t>W.b)return;const x=Math.round(Lo+pos(LOCK.t)/100*(Ro-Lo))+.5,g=cv.getContext('2d'),H=cv.height/(devicePixelRatio||1);
 g.save();g.strokeStyle=css('--accent');g.lineWidth=1.5;g.globalAlpha=.85;g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();g.restore()}}
/* Shift-click on a timeline chart: lock the cursor there (the click does nothing else) */
document.addEventListener('click',e=>{if(!e.shiftKey)return;const cv=e.target.closest&&e.target.closest('main canvas');if(!cv)return;const ch=Chart.getChart(cv);
 const sx=ch&&ch.scales.x;if(!sx||sx.options.afterFit!==tEdge)return;const r=cv.getBoundingClientRect(),xv=sx.getValueForPixel(e.clientX-r.left);
 if(!(xv>=0&&xv<=100))return;e.preventDefault();e.stopPropagation();setLock(unpos(xv))},true);
/* L while pointing at a chart: lock there; L elsewhere: lock at the middle, or unlock if already locked */
document.addEventListener('keydown',e=>{if(e.key!=='l'&&e.key!=='L'||e.metaKey||e.ctrlKey||e.altKey)return;const tg=e.target;if(tg&&(tg.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)))return;
 if(hoverX!=null)setLock(unpos(hoverX));else if(LOCK)setLock(null);else setLock(compressing()?unpos(50):(W.a+W.b)/2)});
lockBar();
/* drag any chart left/right to slide the window (the navigator follows). It only counts as a drag
   after 4 px, so a plain click still marks doses / opens editors. Listeners live on the document
   because charts are re-created while dragging. */
let drag=null;
document.addEventListener('mousedown',e=>{if(e.button!==0)return;const cv=e.target.closest&&e.target.closest('main canvas');if(!cv)return;
 const ch=Chart.getChart(cv);if(!ch)return;const ar=ch.chartArea,r=cv.getBoundingClientRect();
 if(e.clientX<r.left+ar.left||e.clientX>r.left+ar.right)return;   // not on the y-axis labels
 drag={x:e.clientX,a:W.a,len:W.b-W.a,w:ar.right-ar.left,moved:false}});
document.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-drag.x;
 if(!drag.moved&&Math.abs(dx)<4)return;if(!drag.moved){drag.moved=true;document.body.classList.add('dragging')}
 shiftWin(drag.a-dx/drag.w*drag.len,drag.len);e.preventDefault()});
document.addEventListener('mouseup',()=>{if(!drag)return;if(drag.moved){document.body.classList.remove('dragging');
 const stop=ev=>{ev.stopPropagation();ev.preventDefault()};document.addEventListener('click',stop,{capture:true,once:true});setTimeout(()=>document.removeEventListener('click',stop,{capture:true}),0)}
 drag=null});
document.querySelectorAll('.wbtn button').forEach(btn=>btn.onclick=()=>{const p=btn.dataset.p;
 if(p==='all')setWin(X0,X1);else if(p==='brk')setWin(BRK??X0,X1);else{const e=new Date(XD);setWin(Date.UTC(e.getUTCFullYear(),e.getUTCMonth()-(+p),1),X1)}});   // last N months of data (plus the future part when Future is on)
document.querySelectorAll('[data-h]').forEach(btn=>btn.onclick=()=>{const k=cur+'#single';setH(k,hOf(k,340)+(btn.dataset.h==='+'?60:-60));render()});
$('mSingle').onclick=()=>setMode('single');$('mCompare').onclick=()=>setMode('compare');
$('clr').onclick=()=>{sel=[];store.set('selected',sel);updateBar();list();if(mode==='compare')render()};
$('q').oninput=list;
$('txUp').onclick=()=>moveTx(-1);$('txDown').onclick=()=>moveTx(1);$('detUp').onclick=()=>moveStage('__det',-1);$('detDown').onclick=()=>moveStage('__det',1);
$('detMin').onclick=()=>setMin('__det',!isMin('__det'));MINALL.onclick=()=>setAllMin(true);MAXALL.onclick=()=>setAllMin(false);CLOSEALL.onclick=closeAll;$('kfClose').onclick=()=>setClosed('kf',true);$('txClose').onclick=()=>setClosed('tx',true);$('detClose').onclick=()=>setClosed('det',true);$('txTop').onclick=()=>moveTx('top');$('txBottom').onclick=()=>moveTx('bottom');$('detTop').onclick=()=>moveStage('__det','top');$('detBottom').onclick=()=>moveStage('__det','bottom');
$('kfUp').onclick=()=>moveKf(-1);$('kfDown').onclick=()=>moveKf(1);$('kfTop').onclick=()=>moveKf('top');$('kfBottom').onclick=()=>moveKf('bottom');
$('kfLess').onclick=()=>kfResize(-25);$('kfMore').onclick=()=>kfResize(25);$('kfFold').onclick=kfFold;
$('collapseAll').onclick=()=>setAllOpen(false);$('expandAll').onclick=()=>setAllOpen(true);
txInit();
const LT=D.tests.filter(t=>t.kind!=='vital'),VT=D.tests.filter(t=>t.kind==='vital');
$('meta').textContent=LT.length+' numeric tests · '+LT.reduce((a,t)=>a+t.n,0)+' results'+(VT.length?' · '+VT.reduce((a,t)=>a+t.n,0)+' vitals':'')+(TX.length?' · '+medGroups().reduce((a,g)=>a+g.drugs.length,0)+' medications':'');
const sl=$('srcLegend');D.sources.forEach(s=>{const e=document.createElement('span');e.style.cssText='display:flex;align-items:center;gap:5px';
 const sw=document.createElement('span');sw.className='sw';sw.style.background=SC[s];const tx=document.createElement('span');tx.textContent=s;e.append(sw,tx);sl.appendChild(e)});
syncWin();updateBar();list();render();
__IMGJS__
__MSJS__
__PROCJS__
__PATHJS__
__PHOTOJS__
__DNAJS__
__COSTJS__
__DECJS__
__ASKJS__
</script><script>
__NAVFOLDJS__
</script><script>
__PHONEFITJS__
</script><script>
__PHONEJS__
</script></body></html>"""
txjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "med_timeline.js")).read()
mrdjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mrd_view.js")).read()
# Imaging (Library → Imaging → Brain MRI): only if local/imaging/imaging.json exists. It is made outside this repo
# (scan dates, slice viewer files, lesion outlines, estimated dose); the viewer server serves its files from local/imaging/.
img_json = os.path.join(os.path.dirname(out), "imaging", "imaging.json")
imgjs = ""
if os.path.exists(img_json):
    # lesion_chips.js (the lesion buttons every imaging panel shares) and projection_dates.js (the one Projection switch and the
    # projected scan dates marked in every panel) first, then lesion_trends_view.js (volume trends, doubling times) and
    # perfusion_view.js / swelling_view.js (Perfusion, Swelling by lesion): imaging_view.js draws them
    # small axial pictures per scan date (local/imaging/thumbs/<date>_ax.jpg, made from the viewer) for the minimized viewer's filmstrip
    thumbs = {}
    tdir = os.path.join(os.path.dirname(out), "imaging", "thumbs")
    if os.path.isdir(tdir):
        import base64
        for f in sorted(os.listdir(tdir)):
            if f.endswith("_ax.jpg"):
                thumbs[f[:10]] = "data:image/jpeg;base64," + base64.b64encode(open(os.path.join(tdir, f), "rb").read()).decode()
    imgjs = ("const IMG_DATA=" + open(img_json).read().strip().replace("</", "<\\/") + ";\n"
             + "IMG_DATA.thumbs=" + json.dumps(thumbs) + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesion_chips.js")).read() + "\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "projection_dates.js")).read() + "\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesion_trends_view.js")).read() + "\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "perfusion_view.js")).read() + "\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "swelling_view.js")).read() + "\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "imaging_view.js")).read())
# Procedures (Library → Procedures): only if local/procedures/procedures.json exists. It is made outside this repo
# (procedures, devices, hospital stays, visits, radiation fractions, with their sources); drawn by procedures_view.js.
proc_json = os.path.join(os.path.dirname(out), "procedures", "procedures.json")
procjs = ""
if os.path.exists(proc_json):
    procjs = ("const PROC_DATA=" + open(proc_json).read().strip().replace("</", "<\\/") + ";\n"
              + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "procedures_view.js")).read())
# Photo story (Library → photo story section): only if local/photos/photos_view.json exists. It is made outside this repo by the
# private local/photos/build_web.py (dates, chapters, people, notes; no location or camera data); the viewer server serves
# the website copies from local/photos/{thumb,web}/ and the stories from local/photos/stories/; drawn by photos_view.js.
photo_json = os.path.join(os.path.dirname(out), "photos", "photos_view.json")
photojs = ""
if os.path.exists(photo_json):
    photojs = ("const PHOTO_DATA=" + open(photo_json).read().strip().replace("</", "<\\/") + ";\n"
               + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "photos_view.js")).read())
# Pathology (Library → Pathology): only if local/pathology/pathology.json exists. It is made outside this repo
# (cases, stains, results, slide photo file names); the viewer server serves the photos from local/pathology/.
path_json = os.path.join(os.path.dirname(out), "pathology", "pathology.json")
pathjs = ""
if os.path.exists(path_json):
    pathjs = ("const PATH_DATA=" + open(path_json).read().strip().replace("</", "<\\/") + ";\n"
              + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pathology_view.js")).read())
# DNA (Library → DNA): only if local/dna/dna.json exists. It is made outside this repo
# (one sequenced sample: gene copy ratios, mutations, matching drugs, flagged findings); drawn by dna_view.js.
dna_json = os.path.join(os.path.dirname(out), "dna", "dna.json")
dnajs = ""
if os.path.exists(dna_json):
    dnajs = ("const DNA_DATA=" + open(dna_json).read().strip().replace("</", "<\\/") + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dna_view.js")).read())
# Costs (Library → Costs): only if local/costs/costs.json exists. It is made outside this repo by ../costs/viewer_export.py
# (every billable line since diagnosis priced from the hospitals' public price files, with how sure each price is); drawn by cost_view.js.
cost_json = os.path.join(os.path.dirname(out), "costs", "costs.json")
costjs = ""
if os.path.exists(cost_json):
    costjs = ("const COST_DATA=" + open(cost_json).read().strip().replace("</", "<\\/") + ";\n"
              + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cost_view.js")).read())
# Treatment decisions (Library → Treatment decisions): only if local/decisions/decisions.json exists. It is made outside this repo
# (each step of treatment taken, the options raised but not taken, who, quotes and sources); drawn by decisions_view.js.
dec_json = os.path.join(os.path.dirname(out), "decisions", "decisions.json")
decjs = ""
if os.path.exists(dec_json):
    decjs = ("const DEC_DATA=" + open(dec_json).read().strip().replace("</", "<\\/") + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "decisions_view.js")).read())
# Ask (chat about the records, drawn by ask_view.js): only if local/ask.json exists, e.g.
# {"chatServer": "http://127.0.0.1:8820"}. The chat server is separate and not part of this repo;
# the page shows the Ask features only when that server answers.
ask_json = os.path.join(os.path.dirname(out), "ask.json")
askjs = ""
if os.path.exists(ask_json):
    askjs = ("const ASK_CONFIG=" + json.dumps(json.load(open(ask_json))).replace("</", "<\\/") + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ask_view.js")).read())
# Phone start screen (phone_view.js): only if local/phone/model.json exists (made by make_phone_model.py; the server serves it
# at /phone/model.json). A turning glass head with the lesions playing through every scan, bars and cards into the viewer.
phonejs = ""
if os.path.exists(os.path.join(os.path.dirname(out), "phone", "model.json")):
    phonejs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "phone_view.js")).read()
# Concern graph in the Moments panel (milestones_view.js): draws moments that have a concern rating (1-10).
msjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "milestones_view.js")).read()
open(out, "w").write(html.replace("__TXJS__", txjs).replace("__MSJS__", msjs).replace("__MRDJS__", mrdjs).replace("__DATA__", data).replace("__IMGJS__", imgjs).replace("__PROCJS__", procjs).replace("__PATHJS__", pathjs).replace("__PHOTOJS__", photojs).replace("__DNAJS__", dnajs).replace("__COSTJS__", costjs).replace("__DECJS__", decjs).replace("__ASKJS__", askjs).replace("__PHONEJS__", phonejs).replace("__PHONEFITJS__", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "phone_fit.js")).read()).replace("__NAVFOLDJS__", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "navfold.js")).read()))
print(f"wrote {out}: {len(tests)} numeric tests from {len(sources)} sources: {sources}"
      f"; Treatment panel: {len(tx)} drug rows" + (f"; your edits from {edits_file}" if edits else "")
      + (f"; MRD: {len(mrd['rows'])} Signatera draws, {len({a['draw_date'] for a in mrd['alleles']})} allele files" if mrd else "")
      + ("; imaging: local/imaging/imaging.json" if imgjs else "")
      + ("; procedures: local/procedures/procedures.json" if procjs else "")
      + ("; pathology: local/pathology/pathology.json" if pathjs else "")
      + ("; photos: local/photos/photos_view.json" if photojs else "")
      + ("; dna: local/dna/dna.json" if dnajs else "")
      + ("; decisions: local/decisions/decisions.json" if decjs else "")
      + ("; ask: local/ask.json" if askjs else "")
      + ("; phone start screen: local/phone/model.json" if phonejs else ""))
