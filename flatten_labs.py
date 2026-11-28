#!/usr/bin/env python3
"""Flatten lab Observations from every health system's latest pull into one table.

Usage:
    python3 flatten_labs.py [epic_raw] [local/labs_all.tsv]

- Uses the newest pull folder for each site (`epic_raw/<timestamp>-<site>`).
- One row per lab result, with its source site.
- Duplicates (the same result present in two systems, e.g. shared via Care Everywhere)
  are merged: same test (LOINC, or name when there's no LOINC), same collection
  minute and same value. The kept row lists every site it came from in `source`.
Also adds results typed from paper records in local/labs_manual*.tsv (same columns).
Output stays private in local/ (git-ignored).
"""
import csv
import glob
import json
import os
import re
import sys
from collections import Counter

raw_root = sys.argv[1] if len(sys.argv) > 1 else "epic_raw"
out = sys.argv[2] if len(sys.argv) > 2 else "local/labs_all.tsv"

latest = {}
for d in sorted(glob.glob(os.path.join(raw_root, "*-*"))):
    src = os.path.join(d, "_source.json")
    if os.path.exists(src):
        latest[json.load(open(src))["site"]] = d  # sorted by time, so the last one wins

COLS = ["date", "collected_at", "source", "measurement", "test_name_original", "concept", "loinc_code",
        "panel_name", "value", "value_qualifier", "value_text", "unit", "unit_original",
        "value_original", "unit_note",
        "reference_low", "reference_high", "reference_text", "flag", "status",
        "issued_at", "result_id", "report_id"]

# ---- Unit clean-up -------------------------------------------------------------
# Same unit, different spelling -> one canonical spelling. (U/L and IU/L are treated
# as equal for enzymes, as labs do.)
SYNONYMS = {
    "k/ul": "10*3/uL", "10³/ul": "10*3/uL", "10^3/ul": "10*3/uL", "x10e3/ul": "10*3/uL",
    "10x3/ul": "10*3/uL", "10e3/ul": "10*3/uL", "thou/ul": "10*3/uL", "10*3/ul": "10*3/uL",
    "m/ul": "10*6/uL", "x10e6/ul": "10*6/uL", "10x6/ul": "10*6/uL", "10e6/ul": "10*6/uL",
    "mil/ul": "10*6/uL", "10*6/ul": "10*6/uL",
    "gm/dl": "g/dL", "g/dl": "g/dL", "iu/l": "U/L", "u/l": "U/L",
    "second(s)": "s", "seconds": "s", "sec": "s",
    "mciu/ml": "uIU/mL", "uiu/ml": "uIU/mL",
    "% hba1c": "%",
    "per 100 wbcs": "%",            # nRBC per 100 WBC is reported as % at other labs
    "/100 wbc": "%",
    "ml/min/1.73m2": "mL/min/1.73 m2", "ml/min/1.73 sq. m": "mL/min/1.73 m2", "ml/min/1.73 m2": "mL/min/1.73 m2",
}
# Real conversions: (loinc, from_unit) -> (factor, to_unit). Originals are kept.
CONVERT = {
    ("19123-9", "meq/l"): (1.215, "mg/dL"),  # magnesium: 1 mEq/L = 0.5 mmol/L = 1.215 mg/dL
}
COUNT_UNITS = {"10*3/uL", "10*6/uL", "10"}  # cell counts: a wrong 10^3/10^6 label shows in the values


def fix_mojibake(u):
    """'10Â³/uL' (UTF-8 read as Latin-1) -> '10³/uL'."""
    try:
        return u.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return u


NUM_TEXT = re.compile(r"^\s*([<>]=?)?\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z%][A-Za-z/%0-9.*^]*)?\s*$")
NOT_A_MEASUREMENT = re.compile(r"tube|number|\bid\b|accession|barcode", re.I)


def parse_text_numbers(rows):
    """Results sent as text but that are just a number (e.g. Signatera MTM '0.21')
    become numeric values. Blood pressure '120/78', IDs and words are left alone."""
    for r in rows:
        if r["value"] != "" or not r["value_text"] or NOT_A_MEASUREMENT.search(r["measurement"]):
            continue
        m = NUM_TEXT.match(r["value_text"])
        if not m:
            continue
        r["value"], r["value_original"] = float(m.group(2)), r["value_text"]
        r["value_qualifier"] = m.group(1) or ""
        if m.group(3) and not r["unit"]:
            r["unit"] = r["unit_original"] = m.group(3)
        r["unit_note"] = "number parsed from text result"
    # Signatera: the MTM readout has no unit in the feed (Natera reports MTM/mL), and its
    # POSITIVE/NEGATIVE call is a separate result at the same time -> use it as the flag.
    calls = {(r["source"], r["collected_at"]): r["value_text"].strip().upper()
             for r in rows if r["measurement"].upper() == "SIGNATERA TEST RESULT"}
    for r in rows:
        if r["measurement"].upper() == "SIGNATERA MTM READOUT" and r["value"] != "":
            if not r["unit"]:
                r["unit"] = "MTM/mL"
                r["unit_note"] = "number parsed from text result; unit MTM/mL added (Natera's reporting unit)"
            call = calls.get((r["source"], r["collected_at"]), "")
            if call == "POSITIVE":
                r["flag"] = "A"
            r["reference_text"] = r["reference_text"] or f"Signatera call: {call or 'unknown'}"


CONCEPTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference", "lab_concepts.tsv")


def apply_concepts(rows):
    """Harmonized test names (osteosarc-style `measurement`) from reference/lab_concepts.tsv.
    Equivalent LOINC codes from different labs get one name, so they chart as one test.
    `concept` holds the harmonized name (empty when no rule matched); the original name
    stays in `test_name_original`. A rule can also fill a missing unit."""
    if not os.path.exists(CONCEPTS_FILE):
        return
    rules = list(csv.DictReader(open(CONCEPTS_FILE), delimiter="\t"))
    by_loinc = {r["match"]: r for r in rules if r["match_type"] == "loinc"}
    by_name = [(re.compile(r["match"], re.I), r) for r in rules if r["match_type"] == "name"]
    for row in rows:
        rule = next((r for rx, r in by_name if rx.search(row["test_name_original"])), None) \
            or by_loinc.get(row["loinc_code"])
        if not rule:
            continue
        row["concept"] = row["measurement"] = rule["measurement"]
        if rule["unit_if_missing"] and not row["unit"].strip() and row["value"] != "":
            row["unit"] = rule["unit_if_missing"]
            row["unit_note"] = (row["unit_note"] + "; " if row["unit_note"] else "") + \
                f"unit {rule['unit_if_missing']} filled from lab_concepts.tsv"


def clean_units(rows):
    for r in rows:
        u = fix_mojibake(r["unit"]).strip()
        u = SYNONYMS.get(u.lower(), u)
        conv = CONVERT.get((r["loinc_code"], u.lower()))
        if conv and r["value"] != "":
            f, to = conv
            r["value"] = round(float(r["value"]) * f, 4)
            for k in ("reference_low", "reference_high"):
                if r[k] != "":
                    r[k] = round(float(r[k]) * f, 4)
            r["unit_note"] = f"converted from {u} (x{f})"
            u = to
        r["unit"] = u
    # Cell counts whose label disagrees with the values: relabel to the unit the other
    # results of the same LOINC use, only when the medians agree within 2x.
    import statistics
    groups = {}
    for r in rows:
        if r["loinc_code"] and r["value"] != "" and r["unit"] in COUNT_UNITS:
            groups.setdefault(r["loinc_code"], {}).setdefault(r["unit"], []).append(r)
    for loinc, by_unit in groups.items():
        if len(by_unit) < 2:
            continue
        main = max(by_unit, key=lambda k: len(by_unit[k]))
        m_main = statistics.median(float(r["value"]) for r in by_unit[main])
        for unit, rs in by_unit.items():
            if unit == main:
                continue
            m = statistics.median(float(r["value"]) for r in rs)
            if m_main and 0.5 <= (m or 1e-9) / m_main <= 2 or (m == 0 and m_main < 0.1):
                for r in rs:
                    r["unit_note"] = f"label '{r['unit_original'].strip()}' disagrees with values; relabeled {main}"
                    r["unit"] = main


def flatten(site, d):
    panel = {}
    for f in glob.glob(os.path.join(d, "diagnostic_reports_p*.json")):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] == "DiagnosticReport":
                for x in r.get("result", []):
                    panel[x.get("reference", "").split("/")[-1]] = (r["code"].get("text", ""), r["id"])
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "observation_labs_p*.json"))):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] != "Observation":
                continue
            code = r.get("code", {})
            loinc = next((c.get("code", "") for c in code.get("coding", [])
                          if c.get("system") == "http://loinc.org"), "")
            vq = r.get("valueQuantity", {})
            rr = (r.get("referenceRange") or [{}])[0]
            unit_orig = vq.get("unit") or ""
            p = panel.get(r["id"], ("", ""))
            eff = r.get("effectiveDateTime") or r.get("effectivePeriod", {}).get("start", "")
            rows.append({
                "date": eff[:10], "collected_at": eff, "source": site,
                "measurement": code.get("text", ""), "test_name_original": code.get("text", ""), "concept": "",
                "loinc_code": loinc,
                "panel_name": p[0] or (r.get("basedOn") or [{}])[0].get("display", ""),
                "value": vq.get("value", ""), "value_qualifier": vq.get("comparator", ""),
                "value_text": r.get("valueString", "") or r.get("valueCodeableConcept", {}).get("text", ""),
                "unit": unit_orig.strip(), "unit_original": unit_orig,
                "value_original": vq.get("value", ""), "unit_note": "",
                "reference_low": rr.get("low", {}).get("value", ""),
                "reference_high": rr.get("high", {}).get("value", ""),
                "reference_text": rr.get("text", ""),
                "flag": ",".join(c.get("code", "") for i in r.get("interpretation", [])
                                 for c in i.get("coding", [])),
                "status": r.get("status", ""), "issued_at": r.get("issued", ""),
                "result_id": r["id"], "report_id": p[1],
            })
    return rows


all_rows, per_site = [], Counter()
for site, d in sorted(latest.items()):
    rows = flatten(site, d)
    per_site[site] = len(rows)
    all_rows += rows

# Results typed from paper records (e.g. a handwritten office chart or a faxed lab report):
# local/labs_manual*.tsv, same columns as the output, each row with its own source.
for mf in sorted(glob.glob(os.path.join(os.path.dirname(out) or ".", "labs_manual*.tsv"))):
    for r in csv.DictReader(open(mf), delimiter="\t"):
        r["collected_at"] = r.get("collected_at") or r["date"]   # date only: keep each day apart when merging
        all_rows.append({c: r.get(c, "") for c in COLS})
        per_site[r["source"]] += 1

parse_text_numbers(all_rows)
apply_concepts(all_rows)
clean_units(all_rows)

# Merge duplicates across (and within) sites.
merged, seen = [], {}
for r in sorted(all_rows, key=lambda x: (x["collected_at"], x["source"])):
    key = (r["concept"] or r["loinc_code"] or r["measurement"].lower(), r["collected_at"][:16],
           str(r["value"]) or r["value_text"].strip().lower(), r["unit"].lower())
    if key in seen:
        k = seen[key]
        if r["source"] not in k["source"].split("+"):
            k["source"] += "+" + r["source"]
        continue
    seen[key] = r
    merged.append(r)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS, delimiter="\t")
    w.writeheader()
    w.writerows(merged)

print("pulls used:", {s: os.path.basename(d) for s, d in sorted(latest.items())})
print("rows per site:", dict(per_site), "| total", len(all_rows))
print(f"after merging duplicates: {len(merged)} ({len(all_rows) - len(merged)} duplicates)")
print("shared between sites:", Counter(r["source"] for r in merged if "+" in r["source"]))
print("wrote", out)
