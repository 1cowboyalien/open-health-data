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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Library</title>
<style>
:root{--bg:#fbfbfa;--card:#fff;--ink:#141413;--ink2:#5e5d59;--muted:#8a8984;--line:#e6e5e0;--accent:#2a78d6;--band:rgba(27,175,122,.12);--hi:#d03b3b;--lo:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#232322;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8a8984;--line:#383835;--accent:#3987e5;--band:rgba(27,175,122,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:340px minmax(0,1fr);min-height:100vh}
aside{border-right:1px solid var(--line);padding:16px;overflow:auto;max-height:100vh;position:sticky;top:0}
main{padding:20px 24px;min-width:0}
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
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:14px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.stat{background:var(--bg);border-radius:8px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:20px;font-weight:600}.stat span{font-size:12px;color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--ink2);font-weight:500}
.H{color:var(--hi);font-weight:600}.L{color:var(--lo);font-weight:600}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--muted)}button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.win{font-size:13px}.wrow{display:flex;align-items:center;gap:10px;margin:4px 0}.wl{width:36px;color:var(--ink2)}
.wrow input{flex:1;margin:0}.wnav button{font-size:12px;padding:3px 9px;flex:none}.wrow.wnav b{min-width:70px;font-weight:500;color:var(--ink2);font-size:12px}.wrow b{min-width:92px;font-weight:600}.wbtn{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.wbtn button{font-size:12px;padding:4px 10px}
.cmp{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 16px 6px;margin-top:8px}
.cmph{display:flex;align-items:center;gap:8px;font-size:13px}.cmph b{font-weight:600}.cmph .u{color:var(--ink2)}
.cmph .ctl{margin-left:auto;display:flex;align-items:center;gap:4px}.cmph .ctl button{padding:1px 8px;font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:13px;color:var(--ink2)}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.hide{display:none!important}
.dethead{display:flex;align-items:flex-start;gap:8px}.dethead>div{flex:1}.dethead .pmove{margin-top:4px}
.pmove{display:inline-flex;gap:2px}section.pmin>:not(.dethead){display:none!important}.dethead #detMin,.dethead [data-mmin]{margin:4px 0 0 4px;font-size:12px;padding:0 7px}#kfCard>.mhead{flex-wrap:nowrap;align-items:flex-start}#kfCard .mleft{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;flex:1;min-width:0}#kfCard .kfright{display:flex;align-items:center;flex:none}#kfCard .kfright .mtbtn{margin-left:0;gap:3px}@media (max-width:760px){#kfCard>.mhead{flex-wrap:wrap}#kfCard .kfright{flex-wrap:wrap;margin-left:auto}}
.nrow .datebtn{font-weight:600;padding:1px 7px;font-size:12px;min-width:78px}.nrow #wml{font-weight:400;color:var(--ink2);min-width:0}.nrow #saveRange{margin-left:2px}
.pdlg{left:50%;top:28%;transform:translateX(-50%);z-index:70;font-size:13px;min-width:300px;max-width:440px}.pdlg .pdmsg{white-space:pre-line}.pdlg input{font-size:13px;padding:4px 6px}
.calpop{position:fixed;z-index:45;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:12px;display:flex;flex-direction:column;gap:6px;min-width:230px}
.calpop .tzsel{font:inherit;font-size:12px;padding:3px 4px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);max-width:260px}
.calpop input{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}.calpop .bar{justify-content:flex-end}
body.viewonly #saveRange,body.viewonly .redit{display:none!important}
.nrow.lay{gap:6px;font-size:12px;flex-wrap:wrap}.nrow.lay button{font-size:12px;padding:1px 8px}.nrow.lay .laychip{border-radius:12px}.nrow.lay .laychip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.t .goto{flex:none;font-size:12px;padding:0 5px;line-height:17px}.nrow.lay button:disabled{opacity:.35}
.t.ract .nm{font-weight:600}.t.layrow{padding:3px 8px 3px 26px;font-size:13px}.t.layon{background:var(--accent);color:#fff}
body.viewonly #mAdd,body.viewonly #txAdd,body.viewonly #txImport,body.viewonly .ptpop button:not(.pclose),body.viewonly #mLinks button,body.viewonly .madd{display:none!important}.pmove button{padding:0 7px;font-size:12px}
.navpin .mcard{margin-top:6px;padding:4px 16px 2px}.mhead{display:flex;align-items:center;gap:8px;font-size:12px}.mhead b{font-size:13px}.mhead .mtbtn{margin-left:auto;display:flex;gap:4px}.mhead .mtbtn button{font-size:11px;padding:1px 7px}
.mtrack{position:relative;height:64px}
.kfbar,.pbar{display:inline-flex;align-items:center;gap:2px;padding-left:8px;margin-left:4px;border-left:1px solid var(--line)}.kfbar button,.pbar button{font-size:11px;padding:1px 7px}.kfbar .pmove,.pbar .pmove{margin-right:4px}
.mcard.unpinned{padding:8px 16px 6px}.mcard.kffold .mtrack,.mcard.kffold .mstrack{display:none}.mcard.kffold #kfFold{background:var(--accent);border-color:var(--accent);color:#fff}
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
.navpin{position:sticky;top:0;z-index:20;background:var(--bg);margin:-20px -24px 0;padding:6px 24px 5px;border-bottom:1px solid var(--line);box-shadow:0 6px 12px -10px rgba(0,0,0,.35)}
.nrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}.nrow+.nrow{margin-top:4px}
.nrow button{font-size:12px;padding:2px 8px}.nrow .wbtn,.nrow .wnav{display:inline-flex;align-items:center;gap:3px;margin-left:6px}
.nrow .wnav input{width:150px;margin:0 2px}.nrow .zl{color:var(--ink2);margin-left:6px}.nrow #wlen{color:var(--ink2);font-weight:500;margin-left:4px;min-width:62px}
.nrow.win .wl{color:var(--ink2)}.nrow.win input{flex:1;min-width:80px;margin:0}.nrow.win b{font-weight:600;min-width:78px}
.nrow.win .wfl{width:auto;margin-left:6px}.nrow #wfut{font-size:12px;padding:1px 3px;max-width:190px}.nrow #wfut.on{border-color:var(--accent);color:var(--accent)}
.nrow .legend{margin:0 0 0 8px;gap:8px;font-size:11px}.nrow #soloBar{margin-left:6px}
@media (max-width:760px){.navpin{margin:-14px -14px 0;padding:10px 14px}}
.txh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}.txh b{font-size:15px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:5px}.chips button{font-size:12px;padding:2px 9px;border-radius:12px}
.txh .ctl{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;align-items:center}.txh>.pbar{flex:none}.txh .ctl{flex:1 1 auto;min-width:0}@media (min-width:761px){.txh{flex-wrap:nowrap;align-items:flex-start}.txh>b{white-space:nowrap}}.txh .ctl button{padding:1px 8px;font-size:12px}
#txInfo{min-height:20px;margin-top:4px}.shape{display:inline-flex;align-items:center;gap:5px}
#txBody{position:relative}
.whybox{margin-top:8px;padding:6px 10px;border-left:3px solid var(--accent);background:var(--bg);font-size:12px;color:var(--ink2)}.whybox b{display:block;font-size:12px;color:var(--ink);margin-bottom:2px}
#txBox .txmv{position:absolute;z-index:5;width:17px;height:17px;padding:0;line-height:15px;font-size:11px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}#txBox .txmv:hover:not(:disabled){border-color:var(--line);background:var(--card);color:var(--ink)}#txBox .txmv:disabled{opacity:.25;cursor:default}
#txBox .txx{position:absolute;z-index:5;width:17px;height:17px;padding:0;line-height:15px;font-size:13px;border-radius:50%;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}#txBox .txx:hover{border-color:var(--line);background:var(--card);color:var(--hi)}
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
<div class="nrow win"><span class="wl">From</span><input type="range" id="wa" aria-label="Window start"><button id="wal" class="datebtn" title="Pick the start on a calendar"></button>
<span class="wl">To</span><input type="range" id="wb" aria-label="Window end"><button id="wbl" class="datebtn" title="Pick the end on a calendar"></button>
<span class="wl wfl" title="How far the timeline runs past the last data. Use it to see projections and planned dates (keyframes can be dated in the future); every panel gets the same longer axis, so they stay lined up. The part after today is tinted.">Future</span><select id="wfut" aria-label="How far the timeline runs past the last data"></select>
<button id="wml" class="datebtn" title="Pick the middle on a calendar: the window keeps its length"></button><button id="saveRange" title="Save this time range with a name (listed under Presets → Timeline)">☆ Save timeline</button>
<span class="legend" id="srcLegend"></span></div>
<div class="nrow lay hide" id="layBar"></div>
<div class="nrow lay hide" id="findBar"></div>
<div class="card mcard" id="kfCard"><div class="mhead"><span class="mleft"><b>Keyframes</b><span class="sub">your own notes on the timeline</span><span class="mklegend" id="mKinds"></span><span class="mnav" id="mNav"></span></span><span class="kfright"><span class="mtbtn"><button id="mAdd" title="Add a keyframe: your own note on the timeline">+ Keyframe</button><button id="mRowK" title="Switch the keyframes (the ones without a concern rating) on or off. Off: greyed out, no lines on the charts, and ◀ ▶ skip them">Keyframes</button><button id="mRowC" title="Switch the rated keyframes (the Concern marks) on or off. Off: greyed out here and on the Concern graph, no lines on the charts, and ◀ ▶ skip them">Concern</button><button id="mLines" title="Show or hide the keyframe lines across all charts">Lines: on</button></span><span class="kfbar" role="group" aria-label="Keyframes panel place and size"><span class="pmove"><button id="kfTop" title="Pin to the top bar (stays in view while you scroll)" aria-label="Pin Keyframes to the top bar">⤒</button><button id="kfUp" title="Move this panel up (from the first place: pin it to the top bar)" aria-label="Move Keyframes up">↑</button><button id="kfDown" title="Move this panel down, among the charts" aria-label="Move Keyframes down">↓</button><button id="kfBottom" title="Move this panel to the bottom" aria-label="Move Keyframes to the bottom">⤓</button></span><button id="kfLess" title="Make the Keyframes and Concern tracks shorter" aria-label="Shorter">−</button><button id="kfMore" title="Make the Keyframes and Concern tracks taller" aria-label="Taller">+</button><button id="kfFold" title="Minimize the Keyframes panel to its title bar and the time scroll bar (click again to open it)">▾ Minimize</button></span></span></div>
<div class="mtrack"><canvas id="mtrackc" role="img" aria-label="Keyframes: your own notes on the timeline"></canvas></div>
<div id="msRow" class="hide"><div class="mhead"><b>Concern</b><span class="sub">keyframes you rated 1–10</span>
<span class="msrng"><span class="trk"></span><span class="fill" id="msFill"></span><input id="msLo" type="range" min="1" max="10" step="0.5" value="1" aria-label="Lowest concern shown" title="Lowest concern shown"><input id="msHi" type="range" min="1" max="10" step="0.5" value="10" aria-label="Highest concern shown" title="Highest concern shown"></span>
<b id="msRv"></b><span class="sub" id="msCount"></span><span class="mtbtn"><button id="msList" title="Open the milestones list (record excerpts and original PDF pages; private page on this Mac) at the last keyframe you went to">List ↗</button></span></div>
<div class="mstrack"><canvas id="msc" role="img" aria-label="Concern rating of each milestone over time"></canvas></div></div><div class="kfscroll hide" id="kfScroll" title="Drag to move the time window along the whole record (it keeps its length). Click the bar to jump there."><div class="kfsdots" id="kfsDots"></div><div class="kfsthumb" id="kfsThumb"><span class="kfsl" id="kfsL"></span></div></div></div>
</div>
<div id="ptpop" class="ptpop hide"></div><div id="calPop" class="calpop hide"></div><div id="mtip" class="ptpop mtip hide"></div><div id="mEdit" class="mpanel hide"></div>
<div class="card" id="txCard">
<div class="txh"><b>Treatments</b><span class="sub">ticked in the Medications list</span>
<span class="ctl"><span class="sub" id="txStatus"></span><button id="txAdd">+ Add medication</button><button id="txExport" title="Save your changes to a file (med_edits.json)">Export</button><button id="txImport" title="Load changes from med_edits.json">Import</button><span id="hlCtl" class="hlctl"><button id="hlOn" title="Show or hide the half-life estimate curves under each drug">Half-life: on</button><button id="hlSmall" title="Make the half-life curves shorter">−</button><button id="hlBig" title="Make the half-life curves taller">+</button></span></span><span class="pbar" role="group" aria-label="Treatments panel place and size"><span class="pmove"><button id="txTop" title="Move this panel to the top" aria-label="Move Treatments to the top">⤒</button><button id="txUp" title="Move this panel up" aria-label="Move Treatments up">↑</button><button id="txDown" title="Move this panel down" aria-label="Move Treatments down">↓</button><button id="txBottom" title="Move this panel to the bottom" aria-label="Move Treatments to the bottom">⤓</button></span><button id="txHide" title="Minimize the Treatments panel to its title bar (click again to open it)">▾ Minimize</button></span>
<input type="file" id="txFile" accept="application/json,.json" class="hide"></div>
<div id="txBody"><div style="position:relative;margin-top:6px" id="txBox"><canvas id="tx" role="img" aria-label="Treatment timeline: bars are ordered periods, markers are doses"></canvas></div>
<div class="sub" id="txEmpty"></div><div class="sub" id="txInfo"></div>
<div id="txDoses"></div>
<div id="txEdit" class="hide"></div>
<div class="legend txlegend" id="txLegend"></div></div></div>
<section id="single">
<div class="dethead" style="margin-top:16px"><div><h2 id="title"></h2><div class="sub" id="desc"></div></div><span class="pmove"><button id="detTop" title="Move this panel to the top" aria-label="Move the detail panel to the top">⤒</button><button id="detUp" title="Move this panel up" aria-label="Move the detail panel up">↑</button><button id="detDown" title="Move this panel down" aria-label="Move the detail panel down">↓</button><button id="detBottom" title="Move this panel to the bottom" aria-label="Move the detail panel to the bottom">⤓</button></span><button id="detMin" title="Minimize this panel to its title bar (click again to open it)">▾ Minimize</button></div>
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
const YW=64;
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
function setMin(id,on){if(on)mins[id]=1;else delete mins[id];store.set('mins',mins);render()}
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
 const step=months>30?3:months>14?2:1;
 for(let d=new Date(Date.UTC(new Date(a).getUTCFullYear(),new Date(a).getUTCMonth(),1));d.getTime()<=b;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))){
  const t=d.getTime(),m=d.getUTCMonth();if(t<a)continue;const early=c&&t<BRK;
  /* in the compressed part only every k-th year gets a label (k so that at most ~3 fit), others just a faint line */
  if(early&&m===0){const y0=new Date(a).getUTCFullYear(),ny=new Date(BRK).getUTCFullYear()-y0,k=Math.max(1,Math.ceil(ny/3));
   T.push({value:pos(t),label:(d.getUTCFullYear()-y0)%k===0?String(d.getUTCFullYear()):'',year:true});continue}
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
  ls.insertBefore(miniBtn('None','Deselect every '+(q?'matching ':'')+'lab test',()=>setLabSel(all,false)),ls.lastChild)}
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
 $('single').classList.toggle('pmin',isMin('__det'));$('mrd').classList.toggle('pmin',isMin('__det'));$('detMin').textContent=minLabel('__det');
 $('detTop').disabled=$('detUp').disabled=txPos>0;$('detBottom').disabled=$('detDown').disabled=txPos===0;
 if(mode==='compare'){const n=o.length;[...$('cmpList').querySelectorAll(':scope > .cmp')].forEach(c=>{const k=o.indexOf(c.dataset.id);
  c.querySelector('[data-mv="top"]').disabled=c.querySelector('[data-mv="-1"]').disabled=k<=0;
  c.querySelector('[data-mv="bottom"]').disabled=c.querySelector('[data-mv="1"]').disabled=k>=n-1})}}
function moveTx(d){moveStage('__tx',d)}
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
let kfsM=[64,10];
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
function kfFold(){if(heights.__kffold)delete heights.__kffold;else heights.__kffold=1;store.set('heights',heights);kfSize();if(!heights.__kffold)kfDraw()}
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
 sel.forEach((id,i)=>{const isM=MRD.isId(id),t=isM?null:BYID[id],H0=isM?MRD.h0(id):160;const w=document.createElement('div');w.className='cmp'+(id===hlLab?' hl':'');w.dataset.id=id;
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
  if(isMin(id)){w.classList.add('pmin');w.append(h);box.appendChild(w);return}
  if(isM){const body=document.createElement('div');w.append(h,body);box.appendChild(w);MRD.panel(id,body);return}   // MRD panel: mrd_view.js draws it
  const cb=document.createElement('div');cb.style.cssText='position:relative;height:'+hOf(id,160)+'px';
  const cv=document.createElement('canvas');cv.setAttribute('role','img');cv.setAttribute('aria-label','Trend of '+t.name);cb.appendChild(cv);
  w.append(h,cb);box.appendChild(w);
  charts.set(id,makeChart(cv,t,{compact:true,dateLabel:false,showX:true}))});
 box.onmouseleave=()=>setHover(null)}

const wa=$('wa'),wb=$('wb');[wa,wb].forEach(e=>{e.min=0;e.max=NDAYS;e.step=1});
const wp=$('wp');wp.min=0;wp.step=1;
function syncWin(){wa.value=Math.round((W.a-X0)/DAY);wb.value=Math.round((W.b-X0)/DAY);const short=(W.b-W.a)<=3*DAY,dl=t=>(short?zStamp(t):zStamp(t).slice(0,10))+(NAVTZ||short?' '+zAbbr(t):'');$('wal').textContent=dl(W.a);$('wbl').textContent=dl(W.b);$('wml').textContent='Middle: '+dl((W.a+W.b)/2);
 const len=Math.round((W.b-W.a)/DAY);wp.max=Math.max(0,NDAYS-len);wp.value=Math.round((W.a-X0)/DAY);wp.disabled=+wp.max===0;
 const hrs=(W.b-W.a)/36e5;$('wlen').textContent=len>=730?(Math.round(len/36.5)/10)+' yrs':len>=60?Math.round(len/30.44)+' months':hrs<48?Math.round(hrs)+' hours':len+' days';
 $('wIn').disabled=W.b-W.a<=MINW+1;$('wOut').disabled=W.a<=X0&&W.b>=X1;if(typeof kfScrollSync==='function')kfScrollSync()}
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
 const lbl={a:'Start (From)',m:'Middle: keeps the window length',b:'End (To)'}[which];
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
 const hint=()=>{note.textContent=which==='m'&&full()?'The window already shows the whole record, so its middle cannot move. Zoom in (+) or pick From / To first.':''};
 const apply=()=>{const t=zParse(i.value);if(!isFinite(t))return;const len=W.b-W.a;
  if(which==='a')setWin(t,Math.max(W.b,t+MINW));else if(which==='b')setWin(Math.min(W.a,t-MINW),t);else{const a=Math.max(X0,Math.min(t-len/2,X1-len));setWin(a,a+len)}
  if(which==='m'&&Math.abs(cur()-t)>DAY)note.textContent=full()?'The window already shows the whole record, so its middle cannot move. Zoom in (+) or pick From / To first.':'The window reaches the edge of the record, so the middle stopped at '+zStamp(cur()).slice(0,10)+'.';
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
wb.oninput=()=>{const b=X0+wb.value*DAY;setWin(Math.min(W.a,b-MINW),b)};
/* move / zoom keep the window's length or centre; moving redraws at most once per frame */
let panFrame=0;
function shiftWin(a,len){a=Math.max(X0,Math.min(a,X1-len));W={a,b:a+len};store.set('window',W);syncWin();cancelAnimationFrame(panFrame);panFrame=requestAnimationFrame(renderWin)}
wp.oninput=()=>shiftWin(X0+wp.value*DAY,W.b-W.a);
$('wPrev').onclick=()=>shiftWin(W.a-(W.b-W.a)/4,W.b-W.a);$('wNext').onclick=()=>shiftWin(W.a+(W.b-W.a)/4,W.b-W.a);
/* zoom around the date in the middle of the charts. In wide windows the years before the break are squeezed, so
   that date is not the window's time midpoint (zooming around the midpoint jumped to a nearly empty stretch) */
function zoomWin(f){const c=compressing()?unpos(50):(W.a+W.b)/2,len=Math.min(X1-X0,Math.max(MINW,(W.b-W.a)*f));let a=c-len/2;
 if(BRK!=null){const keep=W;let lo=X0,hi=Math.max(X0,X1-len);   // find the start that puts c in the middle of the (maybe squeezed) new window
  for(let i=0;i<50;i++){const m=(lo+hi)/2;W={a:m,b:m+len};if(unpos(50)<c)lo=m;else hi=m}a=(lo+hi)/2;W=keep}
 shiftWin(a,len)}
$('wIn').onclick=()=>zoomWin(.5);$('wOut').onclick=()=>zoomWin(2);
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
$('detMin').onclick=()=>setMin('__det',!isMin('__det'));$('txTop').onclick=()=>moveTx('top');$('txBottom').onclick=()=>moveTx('bottom');$('detTop').onclick=()=>moveStage('__det','top');$('detBottom').onclick=()=>moveStage('__det','bottom');
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
__DNAJS__
__ASKJS__
</script><script>
__NAVFOLDJS__
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
    imgjs = ("const IMG_DATA=" + open(img_json).read().strip().replace("</", "<\\/") + ";\n"
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
# Ask (chat about the records, drawn by ask_view.js): only if local/ask.json exists, e.g.
# {"chatServer": "http://127.0.0.1:8820"}. The chat server is separate and not part of this repo;
# the page shows the Ask features only when that server answers.
ask_json = os.path.join(os.path.dirname(out), "ask.json")
askjs = ""
if os.path.exists(ask_json):
    askjs = ("const ASK_CONFIG=" + json.dumps(json.load(open(ask_json))).replace("</", "<\\/") + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ask_view.js")).read())
# Concern graph in the Moments panel (milestones_view.js): draws moments that have a concern rating (1-10).
msjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "milestones_view.js")).read()
open(out, "w").write(html.replace("__TXJS__", txjs).replace("__MSJS__", msjs).replace("__MRDJS__", mrdjs).replace("__DATA__", data).replace("__IMGJS__", imgjs).replace("__PROCJS__", procjs).replace("__PATHJS__", pathjs).replace("__DNAJS__", dnajs).replace("__ASKJS__", askjs).replace("__NAVFOLDJS__", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "navfold.js")).read()))
print(f"wrote {out}: {len(tests)} numeric tests from {len(sources)} sources: {sources}"
      f"; Treatment panel: {len(tx)} drug rows" + (f"; your edits from {edits_file}" if edits else "")
      + (f"; MRD: {len(mrd['rows'])} Signatera draws, {len({a['draw_date'] for a in mrd['alleles']})} allele files" if mrd else "")
      + ("; imaging: local/imaging/imaging.json" if imgjs else "")
      + ("; procedures: local/procedures/procedures.json" if procjs else "")
      + ("; pathology: local/pathology/pathology.json" if pathjs else "")
      + ("; dna: local/dna/dna.json" if dnajs else "")
      + ("; ask: local/ask.json" if askjs else ""))
