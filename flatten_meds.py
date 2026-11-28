#!/usr/bin/env python3
"""Flatten MedicationRequests from every health system's latest pull into one table.

Usage:
    python3 flatten_meds.py [epic_raw] [local/meds_all.tsv] [local/med_dispenses.tsv]

- Uses the newest pull folder for each site (`epic_raw/<timestamp>-<site>`, via _source.json).
- One row per order (MedicationRequest). These are orders, not administrations or fills.
- Drug name is kept as written and normalized; each drug gets a simple class from
  reference/med_classes.tsv (first matching rule wins; unmatched -> class "other").
- RxNorm codes come from the Medication records each order points to
  (medications_p*.json, fetched by epic_pull.py); Epic lists several per drug, joined by ';'.
- Dispenses (MedicationDispense: pharmacy fills and hospital pharmacy dispenses) go to a
  second table, one row per dispense; each order gets a count of its dispenses.
- Medications you entered in the lab viewer and exported to local/med_edits.json are added
  as rows with source "you" (request_id "user:<id>"). Bar corrections and dose marks from that
  file are not copied here; they stay in med_edits.json and are applied by the viewer.
- Medications typed from paper records (local/meds_manual*.json, same shape plus "source")
  are added with that source and request_id "manual:<id>".
- Orders whose medication is a placeholder ("Generic External Medication" etc.) are
  flagged in `name_placeholder`; their real drug is not in the data we have.
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
out = sys.argv[2] if len(sys.argv) > 2 else "local/meds_all.tsv"
out_disp = sys.argv[3] if len(sys.argv) > 3 else "local/med_dispenses.tsv"
HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES_FILE = os.path.join(HERE, "reference", "med_classes.tsv")

latest = {}
for d in sorted(glob.glob(os.path.join(raw_root, "*-*"))):
    src = os.path.join(d, "_source.json")
    if os.path.exists(src):
        latest[json.load(open(src))["site"]] = d  # sorted by time, so the last one wins

COLS = ["date", "authored_on", "source", "drug", "drug_class", "drug_name_original", "name_placeholder",
        "rxnorm_code", "dose_value", "dose_value_high", "dose_unit", "dose_admin_value", "dose_admin_unit",
        "dosage_text", "route", "frequency", "as_needed", "start", "end", "start_end_from",
        "status", "intent", "category", "course_of_therapy", "reported", "encounter",
        "reason", "prn_for", "visit_reason", "prescriber",
        "dispense_count", "first_dispensed", "last_dispensed",
        "medication_ref", "request_id", "prior_request_id"]
DISP_COLS = ["date", "handed_over", "source", "drug", "drug_class", "drug_name_original", "rxnorm_code",
             "quantity", "quantity_unit", "days_supply", "fill_type", "dose_value", "dose_unit",
             "dose_admin_value", "dose_admin_unit",
             "dosage_text", "route", "frequency", "status", "request_id", "dispense_id"]

PLACEHOLDER = re.compile(r"^(generic external medication|miscellaneous medication|non-formulary request)$", re.I)
RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm"


LOCAL_CLASSES_FILE = os.path.join(HERE, "local", "med_classes.local.tsv")   # private rules, read first


def load_rules():
    rules = []
    if os.path.exists(LOCAL_CLASSES_FILE):   # private rules for sensitive drugs, kept out of the public file
        rules += list(csv.DictReader((l for l in open(LOCAL_CLASSES_FILE) if not l.startswith("#")), delimiter="\t"))
    rules += list(csv.DictReader(open(CLASSES_FILE), delimiter="\t"))
    return [(re.compile(r["match"], re.I), r) for r in rules if r["match_type"] == "name"]


def basic_name(name):
    """'levETIRAcetam 500 mg tablet' -> 'levetiracetam'; '(Perjeta) IVPB' etc. dropped."""
    n = name.lower()
    n = re.sub(r"\(.*?\)", " ", n)                 # brand / PF in brackets
    n = re.sub(r"\s\d[\d,.]*\s*%?.*$", "", n)       # strength and form onwards
    n = re.sub(r"\b(chemo infusion.*|injection.*|ivpb|tablet|capsule|tabs?|pf|iv|odt|bolus|"
               r"in dextrose|by auc)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip(" ,-")


def quantity(dr):
    if "doseQuantity" in dr:
        q = dr["doseQuantity"]
        return q.get("value", ""), "", q.get("unit", "")
    if "doseRange" in dr:
        lo, hi = dr["doseRange"].get("low", {}), dr["doseRange"].get("high", {})
        return lo.get("value", ""), hi.get("value", ""), lo.get("unit") or hi.get("unit", "")
    return "", "", ""


def frequency(t):
    code = (t.get("code") or {}).get("text", "")
    rp = t.get("repeat", {})
    if code:
        return code
    if rp.get("frequency"):
        return f"{rp['frequency']}x per {rp.get('period', 1)} {rp.get('periodUnit', '')}".strip()
    return ""


def load_medications(d):
    """Medication id -> resource, from the per-drug reads saved by epic_pull.py."""
    meds = {}
    for f in glob.glob(os.path.join(d, "medications_p*.json")):
        for e in json.load(open(f)).get("entry", []):
            r = e.get("resource", {})
            if r.get("resourceType") == "Medication":
                meds[r["id"]] = r
    return meds


def rxnorm_codes(*codeables):
    codes = []
    for cc in codeables:
        for c in (cc or {}).get("coding", []):
            if c.get("system") == RXNORM and c.get("code") and c["code"] not in codes:
                codes.append(c["code"])
    return ";".join(codes)


def med_of(res, meds):
    """(name as written, RxNorm codes) for an order or dispense."""
    ref = res.get("medicationReference", {})
    cc = res.get("medicationCodeableConcept", {})
    med = meds.get(ref.get("reference", "").split("/")[-1], {})
    return ref.get("display") or cc.get("text", ""), rxnorm_codes(cc, med.get("code"))


def classify(name, rules):
    rule = next((ru for rx_, ru in rules if rx_.search(name)), None)
    return (rule["drug"] if rule and rule["drug"] else basic_name(name)), (rule["class"] if rule else "other")


def flatten_dispenses(site, d, rules, meds):
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "medication_dispenses_p*.json"))):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] != "MedicationDispense":
                continue
            name, rx = med_of(r, meds)
            drug, cls = classify(name, rules)
            di = (r.get("dosageInstruction") or [{}])[0]
            dose = {x.get("type", {}).get("text", ""): quantity(x) for x in di.get("doseAndRate", [])}
            ordered = dose.get("ordered") or dose.get("calculated") or ("", "", "")
            # amount given: admin-amount, else the calculated amount (e.g. 5.4 mg/kg -> 290 mg)
            admin = dose.get("admin-amount") or dose.get("calculated") or ("", "", "")
            q = r.get("quantity", {})
            when = r.get("whenHandedOver") or r.get("whenPrepared", "")
            rows.append({
                "date": when[:10], "handed_over": when, "source": site,
                "drug": drug, "drug_class": cls, "drug_name_original": name, "rxnorm_code": rx,
                "quantity": q.get("value", ""), "quantity_unit": q.get("unit", ""),
                "days_supply": r.get("daysSupply", {}).get("value", ""),
                "fill_type": ",".join(c.get("display", "") for c in r.get("type", {}).get("coding", [])),
                "dose_value": ordered[0] if not ordered[1] else f"{ordered[0]}-{ordered[1]}",
                "dose_unit": ordered[2],
                "dose_admin_value": admin[0] if not admin[1] else f"{admin[0]}-{admin[1]}",
                "dose_admin_unit": admin[2],
                "dosage_text": " | ".join(x.get("text", "") for x in r.get("dosageInstruction", [])
                                          ).replace("\r", "").replace("\n", " / ").replace("\t", " "),
                "route": (di.get("route") or {}).get("text", ""),
                "frequency": frequency(di.get("timing", {})),
                "status": r.get("status", ""),
                "request_id": ",".join(a.get("reference", "").split("/")[-1]
                                       for a in r.get("authorizingPrescription", [])),
                "dispense_id": r["id"],
            })
    return rows


def load_visits(d):
    """{encounter id: "visit type: reason; diagnosis"} from the pull's Encounter records (reasonCode, diagnosis)."""
    out = {}
    for f in sorted(glob.glob(os.path.join(d, "encounters_p*.json"))):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] != "Encounter":
                continue
            why = [c.get("text") or (c.get("coding") or [{}])[0].get("display", "") for c in r.get("reasonCode", [])]
            why += [(x.get("condition") or {}).get("display", "") for x in r.get("diagnosis", [])]
            kind = ((r.get("type") or [{}])[0].get("text") or (r.get("class") or {}).get("display", "")).strip()
            why = list(dict.fromkeys(w.strip() for w in why if w and w.strip() and w.strip().lower() != kind.lower()))
            if why:
                out[r["id"]] = (kind + ": " if kind else "") + "; ".join(why)
    return out


PRN = re.compile(r"\b(?:PRN|as needed)\b\.?,?\s*(?:for\b,?\s*)?(.*)", re.I | re.S)
PRN_STOP = re.compile(r",?\s*\b(?:Starting|Until|Last dose|Normal|may not exceed|Use |up to)\b|\s/\s|\.(?:\s|$)|\|", re.I)


def prn_for(text):
    """"nausea" from "... every 8 hours as needed for nausea." / "Moderate Pain, Severe Pain" from
    "EVERY 2 HOURS PRN, Moderate Pain, Severe Pain, Starting on ...". Empty when no reason is written."""
    m = PRN.search(text or "")
    if not m:
        return ""
    why = PRN_STOP.split(m.group(1), 1)[0]
    why = re.split(r"\s+Max Daily", why, 1, flags=re.I)[0].strip(" ,;:.")
    why = re.sub(r"^(?:other,\s*)+", "", why, flags=re.I).strip(" ,;:.")
    why = re.sub(r",\s*other\b", "", why, flags=re.I)
    if why.startswith("(") and why.endswith(")"):
        why = why[1:-1].strip()
    return "" if why.lower() in ("", "other", "for", "historical med") else why[:120]


def flatten(site, d, rules, meds):
    visits = load_visits(d)
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "medication_requests_p*.json"))):
        for e in json.load(open(f)).get("entry", []):
            r = e["resource"]
            if r["resourceType"] != "MedicationRequest":
                continue
            ref = r.get("medicationReference", {})
            name, rx = med_of(r, meds)
            drug, cls = classify(name, rules)
            di = (r.get("dosageInstruction") or [{}])[0]
            dose = {x.get("type", {}).get("text", ""): quantity(x) for x in di.get("doseAndRate", [])}
            ordered = dose.get("ordered") or dose.get("calculated") or ("", "", "")
            admin = dose.get("admin-amount", ("", "", ""))
            t = di.get("timing", {})
            bp = t.get("repeat", {}).get("boundsPeriod", {})
            vp = r.get("dispenseRequest", {}).get("validityPeriod", {})
            ev = t.get("event") or []
            start, end, frm = bp.get("start", ""), bp.get("end", ""), "timing"
            if not start and not end and vp:
                start, end, frm = vp.get("start", ""), vp.get("end", ""), "validityPeriod"
            if not start and ev:
                start, frm = ev[0], frm if end else "timing.event"
            if not start and not end:
                frm = ""
            cat = ",".join(c.get("text", "") for c in r.get("category", []))
            rows.append({
                "date": (start or r.get("authoredOn", ""))[:10],
                "authored_on": r.get("authoredOn", ""), "source": site,
                "drug": drug, "drug_class": cls,
                "drug_name_original": name,
                "name_placeholder": "yes" if PLACEHOLDER.match(name.strip()) else "",
                "rxnorm_code": rx,
                "dose_value": ordered[0], "dose_value_high": ordered[1], "dose_unit": ordered[2],
                "dose_admin_value": admin[0] if admin[1] == "" else f"{admin[0]}-{admin[1]}",
                "dose_admin_unit": admin[2],
                "dosage_text": " | ".join(x.get("text", "") for x in r.get("dosageInstruction", [])
                                          ).replace("\r", "").replace("\n", " / ").replace("\t", " "),
                "route": (di.get("route") or {}).get("text", ""),
                "frequency": frequency(t), "as_needed": "yes" if di.get("asNeededBoolean") else "",
                "start": start, "end": end, "start_end_from": frm,
                "status": r.get("status", ""), "intent": r.get("intent", ""), "category": cat,
                "course_of_therapy": (r.get("courseOfTherapyType") or {}).get("text", ""),
                "reported": "yes" if r.get("reportedBoolean") or r.get("reportedReference") else "",
                "encounter": (r.get("encounter") or {}).get("display", ""),
                # why it was given, only as the record says it: the diagnosis linked to the order, the
                # "as needed for ..." words of the order, and the reason/diagnosis of the visit it was ordered in
                "reason": " | ".join(dict.fromkeys(
                    (c.get("text") or (c.get("coding") or [{}])[0].get("display", "")).strip()
                    for c in r.get("reasonCode", []) if c.get("text") or c.get("coding"))),
                "prn_for": prn_for(" | ".join(x.get("text", "") for x in r.get("dosageInstruction", []))),
                "prescriber": (r.get("requester") or {}).get("display", ""),   # the ordering clinician, as named in the record
                "visit_reason": visits.get((r.get("encounter") or {}).get("reference", "").split("/")[-1], ""),
                "medication_ref": ref.get("reference", ""),
                "request_id": r["id"],
                "prior_request_id": (r.get("priorPrescription") or {}).get("reference", "").split("/")[-1],
            })
    return rows


rules = load_rules()
all_rows, disp_rows, per_site, disp_site = [], [], Counter(), Counter()
for site, d in sorted(latest.items()):
    meds = load_medications(d)
    rows = flatten(site, d, rules, meds)
    disp = flatten_dispenses(site, d, rules, meds)
    per_site[site], disp_site[site] = len(rows), len(disp)
    all_rows += rows
    disp_rows += disp
def entered_row(m, source="you", how="entered by you", prefix="user:"):
    """One row for a medication entered by hand (viewer edits, or typed from paper records)."""
    num = re.match(r"\s*([\d.]+)\s*(.*)$", m.get("dose", "") or "")
    sched = "" if m.get("prn") else f"{m.get('perDay', 1)}/day every {m.get('every', 1)} day(s)" + \
        (f", {m['on']} on / {m['off']} off" if m.get("on") else "")
    return ({c: "" for c in COLS} | {
        "date": m["a"], "source": source, "drug": m["drug"].lower(), "drug_class": m.get("cls", "other"),
        "drug_name_original": m["drug"],
        "dose_value": num.group(1) if num else "", "dose_unit": num.group(2) if num else "",
        "dosage_text": "; ".join(dict.fromkeys(x for x in (
            m.get("dose", ""), m.get("freq", ""), sched, "as needed" if m.get("prn") else "", m.get("note", ""),
            "dates given: " + ",".join(m["given"]) if m.get("given") else "") if x)),
        "route": m.get("route", ""), "frequency": m.get("freq", ""), "as_needed": "yes" if m.get("prn") else "",
        "start": m["a"], "end": m.get("b", ""), "start_end_from": m.get("start_end_from", how),
        "status": m.get("status", ""), "intent": how,
        "category": "home" if m.get("setting") == "home" else "hospital/clinic",
        "request_id": prefix + m["id"]})


local_dir = os.path.dirname(out) or "."
edits_file = os.path.join(local_dir, "med_edits.json")
if os.path.exists(edits_file):
    user_rows = [entered_row(m) for m in json.load(open(edits_file)).get("added", [])]
    all_rows += user_rows
    per_site["you"] = len(user_rows)
# Medications typed from paper records (e.g. a handwritten office chart): local/meds_manual*.json,
# a list in the same shape as med_edits.json "added", each with its own "source".
for mf in sorted(glob.glob(os.path.join(local_dir, "meds_manual*.json"))):
    for m in json.load(open(mf)):
        src = m.get("source", "paper")
        all_rows.append(entered_row(m, src, "typed from paper records", "manual:"))
        per_site[src] += 1
by_req = {}
for x in disp_rows:
    if x["status"] == "completed" and x["date"]:
        for rid in x["request_id"].split(","):
            by_req.setdefault(rid, []).append(x["date"])
for r in all_rows:
    ds = sorted(by_req.get(r["request_id"], []))
    r["dispense_count"] = len(ds) or ""
    r["first_dispensed"], r["last_dispensed"] = (ds[0], ds[-1]) if ds else ("", "")
disp_rows.sort(key=lambda x: (x["handed_over"], x["source"], x["drug"]))
all_rows.sort(key=lambda x: (x["date"], x["source"], x["drug"]))

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS, delimiter="\t")
    w.writeheader()
    w.writerows(all_rows)

with open(out_disp, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=DISP_COLS, delimiter="\t")
    w.writeheader()
    w.writerows(disp_rows)

ph = [r for r in all_rows if r["name_placeholder"]]
print("pulls used:", {s: os.path.basename(d) for s, d in sorted(latest.items())})
print("orders per site:", dict(per_site), "| total", len(all_rows))
print("distinct drugs:", len({r["drug"] for r in all_rows}), "| by class:",
      dict(Counter(r["drug_class"] for r in all_rows).most_common()))
print("with RxNorm code:", sum(1 for r in all_rows if r["rxnorm_code"]),
      "| orders with a completed dispense:", sum(1 for r in all_rows if r["dispense_count"]))
print("dispenses per site:", dict(disp_site), "| total", len(disp_rows))
print(f"placeholder names: {len(ph)} ({len({r['medication_ref'] for r in ph})} distinct Medication refs,"
      f" {sum(1 for r in ph if r['rxnorm_code'])} with RxNorm)")
print("wrote", out, "and", out_disp)
