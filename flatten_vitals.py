#!/usr/bin/env python3
"""Flatten vital-sign Observations from every health system's latest pull into one table.

Usage:
    python3 flatten_vitals.py [epic_raw] [local/vitals_all.tsv]

- Uses the newest pull folder for each site (`epic_raw/<timestamp>-<site>`, via _source.json).
- One row per numeric reading. Blood pressure (one Observation with components) becomes two
  rows: "BP systolic" and "BP diastolic". Text-only flowsheet rows (BP location, position...)
  are skipped.
- Readings present at two sites (same measurement, minute and value) are merged; the kept
  row lists every site in `source`, as in flatten_labs.py.
Output stays private in local/ (git-ignored). make_lab_view.py shows it as the "Vitals" section.
"""
import csv
import glob
import json
import os
import re
import sys
from collections import Counter

raw_root = sys.argv[1] if len(sys.argv) > 1 else "epic_raw"
out = sys.argv[2] if len(sys.argv) > 2 else "local/vitals_all.tsv"

latest = {}
for d in sorted(glob.glob(os.path.join(raw_root, "*-*"))):
    src = os.path.join(d, "_source.json")
    if os.path.exists(src):
        latest[json.load(open(src))["site"]] = d

COLS = ["date", "collected_at", "source", "measurement", "name_original", "loinc_code", "value", "unit", "result_id"]

# One name per vital, by LOINC (first match wins), else by the flowsheet name.
BY_LOINC = [("8480-6", "BP systolic"), ("8462-4", "BP diastolic"), ("8867-4", "Pulse"), ("59408-5", "SpO2"),
            ("2708-6", "SpO2"), ("2710-2", "SpO2"), ("9279-1", "Respirations"), ("8310-5", "Temperature"),
            ("29463-7", "Weight"), ("3141-9", "Weight"), ("8302-2", "Height"), ("39156-5", "BMI"), ("3140-1", "BSA")]
UNITS = {"cel": "°C", "/min": "/min", "1/min": "/min", "kg": "kg", "cm": "cm", "kg/m2": "kg/m2", "sq meters": "m2", "%": "%",
         "mm[hg]": "mmHg", "mmhg": "mmHg"}


def loincs(cc):
    return [c.get("code", "") for c in (cc or {}).get("coding", []) if c.get("system") == "http://loinc.org"]


def name_for(cc, text):
    codes = loincs(cc)
    if "SpO2 Pulse Rate".lower() == (text or "").lower():
        return "Pulse (oximeter)"      # pulse from the oximeter, kept apart from the regular pulse
    for code, name in BY_LOINC:
        if code in codes:
            return name
    return None


def flatten(site, d):
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "observation_vitals_p*.json"))):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] != "Observation":
                continue
            when = r.get("effectiveDateTime") or r.get("effectivePeriod", {}).get("start", "")
            parts = [(c.get("code", {}), c.get("valueQuantity")) for c in r.get("component", [])] \
                or [(r.get("code", {}), r.get("valueQuantity"))]
            for cc, vq in parts:
                if not vq or vq.get("value") is None:
                    continue
                name = name_for(cc, r.get("code", {}).get("text", ""))
                if not name:
                    continue
                unit = UNITS.get((vq.get("unit") or vq.get("code") or "").strip().lower(), (vq.get("unit") or "").strip())
                rows.append({"date": when[:10], "collected_at": when, "source": site, "measurement": name,
                             "name_original": cc.get("text") or r.get("code", {}).get("text", ""),
                             "loinc_code": ",".join(c for c in loincs(cc) if c != "8716-3"),
                             "value": vq["value"], "unit": unit, "result_id": r["id"]})
    return rows


all_rows, per_site = [], Counter()
for site, d in sorted(latest.items()):
    rows = flatten(site, d)
    per_site[site] = len(rows)
    all_rows += rows

merged, seen = [], {}
for r in sorted(all_rows, key=lambda x: (x["collected_at"], x["source"])):
    k = (r["measurement"], r["collected_at"][:16], str(r["value"]), r["unit"])
    if k in seen:
        if r["source"] not in seen[k]["source"].split("+"):
            seen[k]["source"] += "+" + r["source"]
        continue
    seen[k] = r
    merged.append(r)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS, delimiter="\t")
    w.writeheader()
    w.writerows(merged)
print("readings per site:", dict(per_site), "| total", len(all_rows), "| after merging duplicates", len(merged))
print("by measurement:", dict(Counter(r["measurement"] for r in merged).most_common()))
print("wrote", out)
