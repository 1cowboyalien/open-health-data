"""Turn the flattened medication tables into treatment-timeline rows for the lab viewer.

Used by make_lab_view.py. Input: local/meds_all.tsv and local/med_dispenses.tsv (from
flatten_meds.py). Output: a list of rows, one per drug and setting:

  setting "facility": given by staff (infusions, injections, hospital stays).
      Markers: "given"  = a completed hospital dispense ("Unit Dose") - confirmed by a record.
               "order"  = a one-time order marked completed, with no dispense record.
  setting "home": prescriptions the patient takes herself.
      Markers: "fill"   = a pharmacy fill.
               assumed doses are drawn by the viewer from each segment's schedule
               (they are NOT in the record).

Bars ("segments") show the period a drug was ordered for. Rules (all editable in the viewer):
  - home orders end at their own end date, or where the next order for the same drug starts,
    whichever is first; an order with no end date is shown for 30 days (flagged).
  - "Historical Med" and patient-reported entries are medication-list copies, not
    prescriptions: they get no bar.
  - facility doses closer than 45 days apart are joined into one bar.
"""
import csv
import os
import re
from datetime import date, timedelta

GAP_DAYS = 45          # facility doses closer than this form one bar
OPEN_END_DAYS = 30     # shown length of a home order with no end date
FACILITY_ROUTES = re.compile(r"intraven|iv\b|subcut|intramusc|inject|infus|push|ivpb", re.I)
HOME_CATS = re.compile(r"community|discharge|outpatient", re.I)


def _d(s):
    return date.fromisoformat(s[:10]) if s else None


def schedule(freq, text, as_needed):
    """{'perDay': n, 'every': days, 'on': d, 'off': d, 'prn': bool, 'src': text} from the order."""
    t = f"{freq} {text}".lower()
    sch = {"perDay": 1, "every": 1, "on": 0, "off": 0, "prn": bool(as_needed), "src": freq or ""}
    if re.search(r"\b(three|3)\b.{0,12}(times|x)|three \(3\)|every 8 hours|\btid\b", t):
        sch["perDay"] = 3
    elif re.search(r"\b(two|2)\b.{0,12}(times|x)|twice|every 12|\bbid\b|morning.{0,60}evening", t):
        sch["perDay"] = 2
    elif re.search(r"\b(four|4)\b.{0,12}(times|x)|every 6 hours|\bqid\b", t):
        sch["perDay"] = 4
    m = re.search(r"every (\d+) days?\b", t)
    if m:
        sch["every"] = int(m.group(1))
    elif re.search(r"weekly|every week|once a week", t):
        sch["every"] = 7
    m = re.search(r"(\d+) days?.{0,40}?(\d+) days? off", t)
    if m:
        sch["on"], sch["off"] = int(m.group(1)), int(m.group(2))
    return sch


def is_facility(r):
    if re.search(r"inpatient", r["category"], re.I):
        return True
    if r["frequency"].strip().lower() == "once" or FACILITY_ROUTES.search(r["route"]):
        return True
    return not HOME_CATS.search(r["category"]) and bool(r["route"])


def build(meds_tsv="local/meds_all.tsv", disp_tsv="local/med_dispenses.tsv", today=None):
    if not os.path.exists(meds_tsv):
        return []
    orders = list(csv.DictReader(open(meds_tsv), delimiter="\t"))
    disp = list(csv.DictReader(open(disp_tsv), delimiter="\t")) if os.path.exists(disp_tsv) else []
    today = today or date.today()
    order_by_id = {o["request_id"]: o for o in orders}
    rows = {}

    def row(drug, cls, setting):
        k = f"{drug}|{setting}"
        if k not in rows:
            rows[k] = {"key": k, "drug": drug, "cls": cls, "setting": setting, "segs": [], "ev": [], "ndisp": 0}
        return rows[k]

    # ---- orders
    home = {}
    for o in orders:
        if o["name_placeholder"] or not o["date"] or o["source"] == "you":  # yours are drawn by the viewer
            continue
        fac = is_facility(o)
        dose = " ".join(x for x in (o["dose_value"] + ("-" + o["dose_value_high"] if o["dose_value_high"] else ""),
                                    o["dose_unit"]) if x)
        info = {"src": o["source"], "dose": dose, "route": o["route"], "freq": o["frequency"],
                "status": o["status"], "text": o["dosage_text"][:160], "id": o["request_id"]}
        if fac:
            r = row(o["drug"], o["drug_class"], "facility")
            once = o["frequency"].strip().lower() == "once" or (o["start"][:10] == o["end"][:10])
            if once and o["status"] == "completed" and not o["dispense_count"]:
                r["ev"].append({"d": o["date"], "k": "order", **info})
            if not once and o["start"] and o["end"]:   # inpatient course: bar for its period
                r["segs"].append({"a": o["start"][:10], "b": o["end"][:10], "src": o["source"], "note": "inpatient order"})
        else:
            if o["reported"] or "historical med" in o["dosage_text"].lower():
                continue
            home.setdefault((o["drug"], o["drug_class"]), []).append((o, info))

    # ---- home segments: cut each order at the next order's start
    for (drug, cls), lst in home.items():
        r = row(drug, cls, "home")
        lst.sort(key=lambda x: x[0]["start"][:10] or x[0]["date"])
        for i, (o, info) in enumerate(lst):
            a = _d(o["start"]) or _d(o["date"])
            b, note = _d(o["end"]), ""
            if not b:
                b, note = a + timedelta(days=OPEN_END_DAYS), f"no end date in the record ({OPEN_END_DAYS} days shown)"
            nxt = next((_d(x[0]["start"]) or _d(x[0]["date"]) for x in lst[i + 1:]
                        if (_d(x[0]["start"]) or _d(x[0]["date"])) > a), None)
            if nxt and nxt < b:
                b, note = nxt - timedelta(days=1), "ends where the next order starts"
            b = min(b, today)
            if b < a:
                b = a
            r["segs"].append({"a": a.isoformat(), "b": b.isoformat(), "src": o["source"], "note": note,
                              "sch": schedule(o["frequency"], o["dosage_text"], o["as_needed"]), **info})

    # ---- dispenses
    for x in disp:
        if x["status"] != "completed" or not x["date"]:
            continue
        o = order_by_id.get(x["request_id"].split(",")[0])
        unit_dose = "unit dose" in x["fill_type"].lower()
        r = row(x["drug"], x["drug_class"], "facility" if unit_dose or (o and is_facility(o)) else "home")
        r["ndisp"] += 1
        dose = " ".join(v for v in (x["dose_value"], x["dose_unit"]) if v)
        r["ev"].append({"d": x["date"], "k": "given" if r["setting"] == "facility" else "fill",
                        "src": x["source"], "dose": dose, "route": x["route"], "freq": x["frequency"],
                        "status": x["status"], "text": x["dosage_text"][:160],
                        "qty": f"{x['quantity']} {x['quantity_unit']}".strip(), "id": x["dispense_id"]})

    # ---- facility bars: join doses closer than GAP_DAYS
    for r in rows.values():
        if r["setting"] != "facility":
            continue
        ds = sorted({e["d"] for e in r["ev"]})
        start = prev = None
        for d in ds + [None]:
            if d and prev and (_d(d) - _d(prev)).days <= GAP_DAYS:
                prev = d
                continue
            if start:
                r["segs"].append({"a": start, "b": prev, "src": "", "note": "doses joined (gaps under %d days)" % GAP_DAYS})
            start = prev = d
        r["ev"].sort(key=lambda e: e["d"])

    out = [r for r in rows.values() if r["segs"] or r["ev"]]
    for r in out:
        r["first"] = min([s["a"] for s in r["segs"]] + [e["d"] for e in r["ev"]])
    return out
