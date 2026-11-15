#!/usr/bin/env python3
"""After every pull: list what the reference tables don't cover yet.

Usage (after the rebuild):
    python3 flatten_labs.py && python3 flatten_vitals.py && python3 flatten_meds.py && python3 make_lab_view.py
    python3 check_new_data.py

Reports, for the newly combined data in local/:
  1. Every drug in the records (any recorded dose, even without an amount or only a range such
     as "2-4 mg", and any prescription, "as needed" included) that has no row in reference/med_halflife.tsv or the private
     local/med_halflife.local.tsv. Look each up on its US label (DailyMed, section 12.3) and
     add it with the quote and link; use basis "estimate" when no label gives one, or basis
     "none" with a reason when a half-life doesn't apply (IV fluids, local use, vaccines...).
  2. Drugs that fall into class "other" in reference/med_classes.tsv (or the private
     local/med_classes.local.tsv for sensitive drugs).
  3. Numeric lab tests found at only one hospital and not joined by reference/lab_concepts.tsv:
     check whether another hospital has the same test under another code or name.
  4. Numeric lab tests with no abbreviation / full name in reference/lab_names.tsv.
Sections 3 and 4 show only tests that are new since the last review: after going through
them, run `python3 check_new_data.py --mark-reviewed` to remember the current tests in the
private local/reviewed_labs.json. Nothing else is changed. Exit code 0 always.
"""
import json
import sys
import csv
import os
import re
from collections import defaultdict

import med_timeline

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
REF = os.path.join(HERE, "reference")


def read_tsv(path):
    if not os.path.exists(path):
        return []
    return list(csv.DictReader((l for l in open(path) if not l.startswith("#")), delimiter="\t"))


def section(title, items):
    print(f"\n== {title}: {len(items)}")
    for i in items:
        print("   " + i)


# 1. half-lives
covered = {r["drug"] for f in ("med_halflife.tsv",) for r in read_tsv(os.path.join(REF, f))}
covered |= {r["drug"] for r in read_tsv(os.path.join(LOCAL, "med_halflife.local.tsv"))}
rows = med_timeline.build(os.path.join(LOCAL, "meds_all.tsv"), os.path.join(LOCAL, "med_dispenses.tsv"))
need = defaultdict(lambda: {"cls": "", "rec": 0, "rx": 0})
for r in rows:
    # every drug counts: doses without an amount or only a range ("2-4 mg") and "as needed" prescriptions too
    # (range doses are drawn low-to-high, and doses you mark as taken use the half-life)
    rec = sum(1 for e in r["ev"] if e["k"] in ("given", "order"))
    rx = sum(1 for g in r["segs"] if r["setting"] == "home" and g.get("src"))
    if (rec or rx) and r["drug"] not in covered and r["drug"] != "(placeholder)":
        n = need[r["drug"]]
        n["cls"], n["rec"], n["rx"] = r["cls"], n["rec"] + rec, n["rx"] + rx
section("Drugs needing a half-life (or a 'none' row)",
        [f"{d}  [{v['cls']}; {v['rec']} recorded doses, {v['rx']} prescriptions]" for d, v in sorted(need.items())])

# 2. unclassified drugs
meds = read_tsv(os.path.join(LOCAL, "meds_all.tsv"))
rules = read_tsv(os.path.join(LOCAL, "med_classes.local.tsv")) + read_tsv(os.path.join(REF, "med_classes.tsv"))
ruled = lambda name: any(re.search(r["match"], name, re.I) for r in rules if r.get("match_type") == "name")
other = defaultdict(set)
for m in meds:   # "other" with no rule at all (drugs put in "other" on purpose by a rule are fine)
    if m["drug_class"] == "other" and m["drug"] != "(placeholder)" and not ruled(m["drug_name_original"]):
        other[m["drug"]].add(m["drug_name_original"])
section("Drugs with no class rule (they fall into 'other')", [f"{d}  ({'; '.join(sorted(n))[:90]})" for d, n in sorted(other.items())])

# 3 + 4. labs
labs = read_tsv(os.path.join(LOCAL, "labs_all.tsv"))
key = lambda r: (r["concept"] or r["loinc_code"] or "name:" + r["measurement"].lower(), r["unit"].lower())
tests = defaultdict(lambda: {"sites": set(), "name": "", "loinc": set(), "concept": ""})
for r in labs:
    if r["value"] == "":
        continue
    t = tests[key(r)]
    t["sites"] |= set(r["source"].split("+"))
    t["name"], t["concept"] = r["measurement"], r["concept"]
    t["loinc"].add(r["loinc_code"])
nsites = len({s for t in tests.values() for s in t["sites"]})
REVIEWED = os.path.join(LOCAL, "reviewed_labs.json")
seen = set(json.load(open(REVIEWED))) if os.path.exists(REVIEWED) else set()
kid = lambda k: k[0] + "|" + k[1]
single = [f"{t['name']}  [{next(iter(t['sites']))}; LOINC {', '.join(sorted(x for x in t['loinc'] if x)) or 'none'}; unit {k[1] or '-'}]"
          for k, t in sorted(tests.items(), key=lambda x: x[1]["name"].lower())
          if len(t["sites"]) == 1 and not t["concept"] and nsites > 1 and kid(k) not in seen]
section("New lab tests seen at only one hospital (check for the same test elsewhere)", single)

names = read_tsv(os.path.join(REF, "lab_names.tsv"))
by_name = {r["match"].lower() for r in names if r["match_type"] == "name"}
toks = [r["match"] for r in names if r["match_type"] == "token"]
unnamed = sorted({t["name"] for k, t in tests.items()
                  if kid(k) not in seen and t["name"].lower() not in by_name
                  and not any(re.search(r"(?<![\w/])" + re.escape(tk) + r"(?![\w/])", t["name"]) for tk in toks)})
section("New lab tests without an abbreviation / full name (fine if already plain words)", unnamed)
if "--mark-reviewed" in sys.argv:
    json.dump(sorted(seen | {kid(k) for k in tests}), open(REVIEWED, "w"))
    print(f"\nMarked {len(tests)} lab tests as reviewed in {REVIEWED}")
print()
