#!/usr/bin/env python3
"""Build a local, private lab-results viewer (HTML) from a flattened lab TSV.

Usage:
    python3 flatten_labs.py          # builds local/labs_all.tsv from every hospital
    python3 make_lab_view.py [local/labs_all.tsv] [local/labs.html]

If local/meds_all.tsv exists (python3 flatten_meds.py), a Treatment panel is drawn above the
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

# Vitals (python3 flatten_vitals.py -> local/vitals_all.tsv): same chart shape as a lab test, shown
# in their own "Vitals" section of the sidebar (kind "vital"); no reference ranges.
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
data = json.dumps({"tests": tests, "sources": sources, "span": span, "tx": tx, "edits": edits, "halflife": halflife,
                   "brk": brk, "brkw": COMPRESS_WIDTH, "mrd": mrd}, separators=(",", ":"))

html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lab results</title>
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
.pmove{display:inline-flex;gap:2px}
.nrow .datebtn{font-weight:600;padding:1px 7px;font-size:12px;min-width:78px}.nrow #wml{font-weight:400;color:var(--ink2);min-width:0}.nrow #saveRange{margin-left:2px}
.pdlg{left:50%;top:28%;transform:translateX(-50%);z-index:70;font-size:13px;min-width:300px;max-width:440px}.pdlg .pdmsg{white-space:pre-line}.pdlg input{font-size:13px;padding:4px 6px}
.calpop{position:fixed;z-index:45;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:12px;display:flex;flex-direction:column;gap:6px;min-width:230px}
.calpop input{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}.calpop .bar{justify-content:flex-end}
body.viewonly #saveRange,body.viewonly .redit{display:none!important}
.nrow.lay{gap:6px;font-size:12px;flex-wrap:wrap}.nrow.lay button{font-size:12px;padding:1px 8px}.nrow.lay .laychip{border-radius:12px}.nrow.lay .laychip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.t .goto{flex:none;font-size:12px;padding:0 5px;line-height:17px}.nrow.lay button:disabled{opacity:.35}
.t.ract .nm{font-weight:600}.t.layrow{padding:3px 8px 3px 26px;font-size:13px}.t.layon{background:var(--accent);color:#fff}
body.viewonly #mAdd,body.viewonly #txAdd,body.viewonly #txImport,body.viewonly .ptpop button:not(.pclose),body.viewonly #mLinks button,body.viewonly .madd{display:none!important}.pmove button{padding:0 7px;font-size:12px}
.navpin .mcard{margin-top:6px;padding:4px 16px 2px}.mhead{display:flex;align-items:center;gap:8px;font-size:12px}.mhead b{font-size:13px}.mhead .mtbtn{margin-left:auto;display:flex;gap:4px}.mhead .mtbtn button{font-size:11px;padding:1px 7px}
.mtrack{position:relative;height:64px}.mshape{flex:none;vertical-align:middle}.mhead{flex-wrap:wrap;row-gap:3px}.mhead>.sub{white-space:nowrap}
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
.nrow .legend{margin:0 0 0 8px;gap:8px;font-size:11px}.nrow #soloBar{margin-left:6px}
@media (max-width:760px){.navpin{margin:-14px -14px 0;padding:10px 14px}}
.txh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}.txh b{font-size:15px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:5px}.chips button{font-size:12px;padding:2px 9px;border-radius:12px}
.txh .ctl{margin-left:auto;display:flex;gap:4px}.txh .ctl button{padding:1px 8px;font-size:12px}
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
</style></head><body>
<div class="wrap">
<aside><h1>Labs &amp; medications</h1><div class="sub" id="meta"></div>
<input type="search" id="q" placeholder="Filter labs and medications" aria-label="Filter labs and medications">
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
<button id="wml" class="datebtn" title="Pick the middle on a calendar: the window keeps its length"></button><button id="saveRange" title="Save this time range with a name (listed under Presets → Timeline)">☆ Save timeline</button>
<span class="legend" id="srcLegend"></span></div>
<div class="nrow lay hide" id="layBar"></div>
<div class="nrow lay hide" id="findBar"></div>
<div class="card mcard"><div class="mhead"><b>Keyframes</b><span class="sub">your own notes on the timeline</span><span class="mklegend" id="mKinds"></span><span class="mnav" id="mNav"></span><span class="mtbtn"><button id="mAdd" title="Add a keyframe: your own note on the timeline">+ Keyframe</button><button id="mLines" title="Show or hide the keyframe lines across all charts">Lines: on</button></span></div>
<div class="mtrack"><canvas id="mtrackc" role="img" aria-label="Keyframes: your own notes on the timeline"></canvas></div></div>
</div>
<div id="ptpop" class="ptpop hide"></div><div id="calPop" class="calpop hide"></div><div id="mtip" class="ptpop mtip hide"></div><div id="mEdit" class="mpanel hide"></div>
<div class="card" id="txCard">
<div class="txh"><b>Treatments</b><span class="sub">ticked in the Medications list</span><span class="pmove"><button id="txTop" title="Move this panel to the top" aria-label="Move Treatments to the top">⤒</button><button id="txUp" title="Move this panel up" aria-label="Move Treatments up">↑</button><button id="txDown" title="Move this panel down" aria-label="Move Treatments down">↓</button><button id="txBottom" title="Move this panel to the bottom" aria-label="Move Treatments to the bottom">⤓</button></span>
<span class="ctl"><span class="sub" id="txStatus"></span><button id="txAdd">+ Add medication</button><button id="txExport" title="Save your changes to a file (med_edits.json)">Export</button><button id="txImport" title="Load changes from med_edits.json">Import</button><span id="hlCtl" class="hlctl"><button id="hlOn" title="Show or hide the half-life estimate curves under each drug">Half-life: on</button><button id="hlSmall" title="Make the half-life curves shorter">−</button><button id="hlBig" title="Make the half-life curves taller">+</button></span><button id="txHide" title="Show or hide the Treatment panel's timeline">Hide</button></span>
<input type="file" id="txFile" accept="application/json,.json" class="hide"></div>
<div id="txBody"><div style="position:relative;margin-top:6px" id="txBox"><canvas id="tx" role="img" aria-label="Treatment timeline: bars are ordered periods, markers are doses"></canvas></div>
<div class="sub" id="txEmpty"></div><div class="sub" id="txInfo"></div>
<div id="txDoses"></div>
<div id="txEdit" class="hide"></div>
<div class="legend txlegend" id="txLegend"></div></div></div>
<section id="single">
<div class="dethead" style="margin-top:16px"><div><h2 id="title"></h2><div class="sub" id="desc"></div></div><span class="pmove"><button id="detTop" title="Move this panel to the top" aria-label="Move the detail panel to the top">⤒</button><button id="detUp" title="Move this panel up" aria-label="Move the detail panel up">↑</button><button id="detDown" title="Move this panel down" aria-label="Move the detail panel down">↓</button><button id="detBottom" title="Move this panel to the bottom" aria-label="Move the detail panel to the bottom">⤓</button></span></div>
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
const X0=ms(D.span[0]);const _e=new Date(ms(D.span[1]));const X1=Date.UTC(_e.getUTCFullYear(),_e.getUTCMonth()+1,1);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BRK=D.brk?ms(D.brk):null,FR=D.brk?D.brkw:0,NDAYS=Math.round((X1-X0)/DAY);
const YW=64;
const MINW=DAY/2;   // shortest window: 12 hours (hospital stays with readings every few hours)
let W=store.get('window',{a:X0,b:X1});if(!(W.a>=X0&&W.b<=X1&&W.b-W.a>=MINW))W={a:X0,b:X1};
let mode=store.get('mode','single');
/* Library (left bar): hide/show, remembered; Chart.js resizes the charts on its own */
let libHidden=store.get('libhidden',false);
function applyLib(){document.body.classList.toggle('nolib',libHidden);const b=$('libBtn');b.textContent=libHidden?'☰ Show Library':'◧ Hide Library';b.setAttribute('aria-pressed',String(libHidden))}
$('libBtn').onclick=()=>{libHidden=!libHidden;store.set('libhidden',libHidden);applyLib()};applyLib();
let cur=store.get('current',D.tests[0].id);if(!BYID[cur])cur=D.tests[0].id;
let sel=store.get('selected',[]).filter(id=>BYID[id]||(D.mrd&&/^mrd:(ot|var)$/.test(id)));   // lab ids, or the MRD panels (mrd_view.js)
let heights=store.get('heights',{});
let hoverX=null;const charts=new Map();

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
const whenText=t=>(W.b-W.a)<=3*DAY?localStamp(t):iso(t);
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
   plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>{const x=pv[c[0].dataIndex];return x.ts!=null?localStamp(x.ts):x.date},label:c=>{const x=pv[c.dataIndex];return valText(x)+' '+t.unit+(x.flag?'  ['+x.flag+']':'')+'  · '+x.src+(x.name!==t.name?' ('+x.name+')':'')}}}},
   layout:{padding:{right:8}},
   scales:{x:{type:'linear',min:0,max:100,afterBuildTicks:a=>{a.ticks=TK.map(k=>({value:k.value}))},
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

/* sidebar: collapsible sections (open state remembered; all open while filtering) */
let openState=store.get('open',{});let sectionIds=[];
function setAllOpen(on){sectionIds.forEach(id=>openState[id]=on);store.set('open',openState);list()}
/* small button inside a <summary>: preventDefault keeps the click from opening/closing the section */
function miniBtn(label,title,fn){const b=document.createElement('button');b.type='button';b.className='mini';b.textContent=label;b.title=title;
 b.setAttribute('aria-label',title);b.onclick=e=>{e.preventDefault();e.stopPropagation();fn()};return b}
function section(parent,id,title,count,defOpen,cls,q){sectionIds.push(id);const d=document.createElement('details');d.className=cls;d.open=q?true:(openState[id]??defOpen);
 const s=document.createElement('summary');const t=document.createElement('span');t.className='st';t.textContent=title;t.title=title;const n=document.createElement('span');n.className='n';n.textContent=count;
 s.append(t,n);d.appendChild(s);
 s.onclick=()=>setTimeout(()=>{if($('q').value)return;openState[id]=d.open;store.set('open',openState)},0);  // only your own clicks are remembered
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
function stageOrder(){const o=mode==='compare'?sel.slice():['__det'];o.splice(Math.min(txPos,o.length),0,'__tx');return o}
/* d: -1 / 1 = one step, 'top' / 'bottom' = to the first / last place */
function moveStage(key,d){const o=stageOrder(),i=o.indexOf(key),j=d==='top'?0:d==='bottom'?o.length-1:i+d;if(i<0||j<0||j>=o.length||j===i)return;
 o.splice(i,1);o.splice(j,0,key);txPos=o.indexOf('__tx');store.set('txpos',txPos);
 if(mode==='compare'){sel=o.filter(k=>k!=='__tx');store.set('selected',sel)}
 render()}
function placeTx(){const tc=$('txCard');if(mode==='compare'){const cards=[...$('cmpList').querySelectorAll(':scope > .cmp')],i=Math.min(txPos,cards.length);
  if(i<cards.length)$('cmpList').insertBefore(tc,cards[i]);else $('cmpList').appendChild(tc)}
 else{const sg=MRD.active()?$('mrd'):$('single');if(txPos>0)sg.after(tc);else sg.before(tc)}
 const o=stageOrder(),i=o.indexOf('__tx');$('txTop').disabled=$('txUp').disabled=i<=0;$('txBottom').disabled=$('txDown').disabled=i>=o.length-1;
 $('detTop').disabled=$('detUp').disabled=txPos>0;$('detBottom').disabled=$('detDown').disabled=txPos===0;
 if(mode==='compare'){const n=o.length;[...$('cmpList').querySelectorAll(':scope > .cmp')].forEach(c=>{const k=o.indexOf(c.dataset.id);
  c.querySelector('[data-mv="top"]').disabled=c.querySelector('[data-mv="-1"]').disabled=k<=0;
  c.querySelector('[data-mv="bottom"]').disabled=c.querySelector('[data-mv="1"]').disabled=k>=n-1})}}
function moveTx(d){moveStage('__tx',d)}
/* redraws keep the page where it is: hold main's height while the charts are rebuilt, then restore the scroll */
function keepScroll(f){const se=document.scrollingElement,y=se.scrollTop,m=document.querySelector('main');m.style.minHeight=m.offsetHeight+'px';
 try{f()}finally{m.style.minHeight='';se.scrollTop=y}}
function render(){keepScroll(()=>{charts.forEach(c=>c.destroy());charts.clear();hoverX=null;
 $('single').before($('txCard'));   // park it before the charts are rebuilt, then put it back in its place
 renderBand();if(MRD.active())MRD.render();else if(mode==='single')renderSingle();else renderCompare();placeTx()})}
/* only the time window changed (move, zoom, drag, presets): rebuild the Treatment panel, update the lab charts in place */
function renderWin(){if(!$('ptpop').classList.contains('hide'))hidePop();   // the reading it pointed at has moved
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
  mk('×','Remove from comparison',()=>{toggle(id,false);list()});
  h.append(b,u,ctl);
  if(isM){const body=document.createElement('div');w.append(h,body);box.appendChild(w);MRD.panel(id,body);return}   // MRD panel: mrd_view.js draws it
  const cb=document.createElement('div');cb.style.cssText='position:relative;height:'+hOf(id,160)+'px';
  const cv=document.createElement('canvas');cv.setAttribute('role','img');cv.setAttribute('aria-label','Trend of '+t.name);cb.appendChild(cv);
  w.append(h,cb);box.appendChild(w);
  charts.set(id,makeChart(cv,t,{compact:true,dateLabel:false,showX:true}))});
 box.onmouseleave=()=>setHover(null)}

const wa=$('wa'),wb=$('wb');[wa,wb].forEach(e=>{e.min=0;e.max=NDAYS;e.step=1});
const wp=$('wp');wp.min=0;wp.step=1;
function syncWin(){wa.value=Math.round((W.a-X0)/DAY);wb.value=Math.round((W.b-X0)/DAY);const dl=t=>(W.b-W.a)<=3*DAY?localStamp(t):localStamp(t).slice(0,10);$('wal').textContent=dl(W.a);$('wbl').textContent=dl(W.b);$('wml').textContent='Middle: '+dl((W.a+W.b)/2);
 const len=Math.round((W.b-W.a)/DAY);wp.max=Math.max(0,NDAYS-len);wp.value=Math.round((W.a-X0)/DAY);wp.disabled=+wp.max===0;
 const hrs=(W.b-W.a)/36e5;$('wlen').textContent=len>=730?(Math.round(len/36.5)/10)+' yrs':len>=60?Math.round(len/30.44)+' months':hrs<48?Math.round(hrs)+' hours':len+' days';
 $('wIn').disabled=W.b-W.a<=MINW+1;$('wOut').disabled=W.a<=X0&&W.b>=X1}
function setWin(a,b){a=Math.max(X0,Math.min(a,X1-MINW));b=Math.min(X1,Math.max(b,a+MINW));W={a,b};store.set('window',W);syncWin();renderWin()}
/* calendar pop-out for From / Middle / To: a date-and-time field that opens the browser's calendar.
   Picking a date applies it at once; Middle moves the window and keeps its length. */
const toInput=t=>localStamp(t).replace(' ','T');
function openCal(which,anchor){const P=$('calPop');P.innerHTML='';P.classList.remove('hide');
 const lbl={a:'Start (From)',m:'Middle: keeps the window length',b:'End (To)'}[which];
 const h=document.createElement('b');h.textContent=lbl;const i=document.createElement('input');i.type='datetime-local';i.min=toInput(X0);i.max=toInput(X1);
 const cur=()=>which==='a'?W.a:which==='b'?W.b:(W.a+W.b)/2;i.value=toInput(cur());
 const apply=()=>{const t=new Date(i.value).getTime();if(!isFinite(t))return;const len=W.b-W.a;
  if(which==='a')setWin(t,Math.max(W.b,t+MINW));else if(which==='b')setWin(Math.min(W.a,t-MINW),t);else{const a=Math.max(X0,Math.min(t-len/2,X1-len));setWin(a,a+len)}};
 i.onchange=apply;i.onkeydown=e=>{if(e.key==='Enter'){apply();closeCal()}};
 const bar=document.createElement('div');bar.className='bar';const done=document.createElement('button');done.type='button';done.textContent='Done';done.className='on';done.onclick=closeCal;bar.append(done);
 P.append(h,i,bar);const r=anchor.getBoundingClientRect();P.style.left=Math.max(6,Math.min(r.left,innerWidth-250))+'px';P.style.top=(r.bottom+6)+'px';
 i.focus();try{i.showPicker()}catch(e){}}
function closeCal(){$('calPop').classList.add('hide')}
document.addEventListener('mousedown',e=>{if(!$('calPop').classList.contains('hide')&&!e.target.closest('#calPop')&&!e.target.closest('.datebtn'))closeCal()});
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
function zoomWin(f){const c=(W.a+W.b)/2,len=Math.min(X1-X0,Math.max(MINW,(W.b-W.a)*f));shiftWin(c-len/2,len)}
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
 if(p==='all')setWin(X0,X1);else if(p==='brk')setWin(BRK??X0,X1);else{const e=new Date(X1);setWin(Date.UTC(e.getUTCFullYear(),e.getUTCMonth()-(+p),1),X1)}});
document.querySelectorAll('[data-h]').forEach(btn=>btn.onclick=()=>{const k=cur+'#single';setH(k,hOf(k,340)+(btn.dataset.h==='+'?60:-60));render()});
$('mSingle').onclick=()=>setMode('single');$('mCompare').onclick=()=>setMode('compare');
$('clr').onclick=()=>{sel=[];store.set('selected',sel);updateBar();list();if(mode==='compare')render()};
$('q').oninput=list;
$('txUp').onclick=()=>moveTx(-1);$('txDown').onclick=()=>moveTx(1);$('detUp').onclick=()=>moveStage('__det',-1);$('detDown').onclick=()=>moveStage('__det',1);
$('txTop').onclick=()=>moveTx('top');$('txBottom').onclick=()=>moveTx('bottom');$('detTop').onclick=()=>moveStage('__det','top');$('detBottom').onclick=()=>moveStage('__det','bottom');
$('collapseAll').onclick=()=>setAllOpen(false);$('expandAll').onclick=()=>setAllOpen(true);
txInit();
const LT=D.tests.filter(t=>t.kind!=='vital'),VT=D.tests.filter(t=>t.kind==='vital');
$('meta').textContent=LT.length+' numeric tests · '+LT.reduce((a,t)=>a+t.n,0)+' results'+(VT.length?' · '+VT.reduce((a,t)=>a+t.n,0)+' vitals':'')+(TX.length?' · '+medGroups().reduce((a,g)=>a+g.drugs.length,0)+' medications':'');
const sl=$('srcLegend');D.sources.forEach(s=>{const e=document.createElement('span');e.style.cssText='display:flex;align-items:center;gap:5px';
 const sw=document.createElement('span');sw.className='sw';sw.style.background=SC[s];const tx=document.createElement('span');tx.textContent=s;e.append(sw,tx);sl.appendChild(e)});
syncWin();updateBar();list();render();
__IMGJS__
</script></body></html>"""
txjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "med_timeline.js")).read()
mrdjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mrd_view.js")).read()
# Imaging (Library → Imaging → Brain MRI): only if local/imaging/imaging.json exists. It is made outside this repo
# (scan dates, slice viewer files, lesion outlines, estimated dose); the viewer server serves its files from local/imaging/.
img_json = os.path.join(os.path.dirname(out), "imaging", "imaging.json")
imgjs = ""
if os.path.exists(img_json):
    imgjs = ("const IMG_DATA=" + open(img_json).read().strip().replace("</", "<\\/") + ";\n"
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "imaging_view.js")).read())
open(out, "w").write(html.replace("__TXJS__", txjs).replace("__MRDJS__", mrdjs).replace("__DATA__", data).replace("__IMGJS__", imgjs))
print(f"wrote {out}: {len(tests)} numeric tests from {len(sources)} sources: {sources}"
      f"; Treatment panel: {len(tx)} drug rows" + (f"; your edits from {edits_file}" if edits else "")
      + (f"; MRD: {len(mrd['rows'])} Signatera draws, {len({a['draw_date'] for a in mrd['alleles']})} allele files" if mrd else "")
      + ("; imaging: local/imaging/imaging.json" if imgjs else ""))
