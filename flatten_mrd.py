"""Build the private MRD (Signatera ctDNA) tables the viewer's "MRD tests" section reads.

    python3 flatten_mrd.py

Inputs (paths kept out of this public script, in the private local/mrd_sources.json):
    {"natera_reports": ["<extracted report text>", ...],   # text of Natera Signatera PDFs (records/pdftext.swift)
     "allele_dir": "<folder with Natera's per-draw allele .xlsx files>"}
Also reads local/labs_all.tsv to note which draws the hospitals' records already have.

Writes (all in local/, never committed):
    mrd_tests.tsv    one row per Signatera draw: date, MTM/mL, result, where it is recorded
    mrd_alleles.tsv  one row per draw x tracked variant: allele ratio and Natera's per-variant call
Then run  python3 liftover_mrd.py --ensembl --genes  when new variants appear (GRCh38 positions,
genes); it writes local/mrd_variants.tsv. make_lab_view.py inlines all three when they exist.

Natera's report lists the whole history (date + MTM/mL) on page 1; the newest report wins.
Draws a hospital recorded as "Test Not Performed" are kept as NOT PERFORMED rows.
"""
import csv, datetime, glob, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
CFG = os.path.join(LOCAL, "mrd_sources.json")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_xlsx(path):
    """Minimal .xlsx reader (standard library only): {sheet name: [rows of cell strings]}."""
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS)]
    sheets = sorted((n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
    col = lambda ref: sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(re.match(r"[A-Z]+", ref).group()))) - 1
    out = {}
    for name, sh in zip(names, sheets):
        rows = []
        for r in ET.fromstring(z.read(sh)).iter("{%s}row" % NS["m"]):
            row = {}
            for c in r.findall("m:c", NS):
                v, t = c.find("m:v", NS), c.get("t")
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif v is None:
                    continue
                else:
                    val = ss[int(v.text)] if t == "s" else v.text
                row[col(c.get("r"))] = val
            if row:
                rows.append([row.get(i, "") for i in range(max(row) + 1)])
        out[name] = rows
    return out


def report_history(path):
    """(report date, {draw date: MTM/mL}) from one Natera report's text."""
    txt = open(path).read()
    m = re.search(r"Report Date:\s*(\d\d)/(\d\d)/(\d{4})", txt)
    rdate = f"{m[3]}-{m[1]}-{m[2]}" if m else ""
    hist = {}
    if "Historical Results" in txt:
        block = txt.split("Historical Results", 1)[1].split("Interpretations", 1)[0]
        for line in block.splitlines():
            m = re.match(r"([A-Z][a-z]{2} \d\d, \d{4})\s+([\d.]+)\s*$", line.strip())
            if m:
                hist[datetime.datetime.strptime(m[1], "%b %d, %Y").date().isoformat()] = m[2]
    return rdate, hist


def main():
    if not os.path.exists(CFG):
        sys.exit(f"no {CFG}: nothing to do (see the docstring for its format)")
    cfg = json.load(open(CFG))
    # newest report last, so its history wins
    reports = sorted((report_history(os.path.expanduser(p)) + (p,) for p in cfg.get("natera_reports", [])), key=lambda r: r[0])
    draws, src = {}, {}
    for rdate, hist, p in reports:
        for d, v in hist.items():
            draws[d], src[d] = v, "natera_report_" + rdate

    hosp = {}   # draws the hospitals' lab records have (date -> (site, value text))
    labs = os.path.join(LOCAL, "labs_all.tsv")
    if os.path.exists(labs):
        for r in csv.DictReader(open(labs), delimiter="\t"):
            if r["measurement"] == "SIGNATERA MTM READOUT":
                hosp.setdefault(r["date"], (r["source"], r["value"] or r["value_text"]))

    rows = []
    for d in sorted(draws):
        v = draws[d]
        rows.append(dict(test="Signatera", vendor="Natera", kind="ctDNA (blood, tumor-informed)", draw_date=d, value=v, unit="MTM/mL",
                         result="DETECTED" if float(v) > 0 else "NOT DETECTED", source=src[d], also_in=hosp.get(d, ("",))[0], note=""))
    for d, (site, vt) in sorted(hosp.items()):   # in a hospital record but not in Natera's history (e.g. not performed)
        if d not in draws:
            rows.append(dict(test="Signatera", vendor="Natera", kind="ctDNA (blood, tumor-informed)", draw_date=d, value="", unit="MTM/mL",
                             result="NOT PERFORMED" if "not performed" in vt.lower() else ("DETECTED" if vt not in ("", "0", "0.0") else "NOT DETECTED"),
                             source=site, also_in="", note=vt))
    rows.sort(key=lambda r: r["draw_date"])
    write(os.path.join(LOCAL, "mrd_tests.tsv"), rows)

    al = []
    adir = os.path.expanduser(cfg.get("allele_dir", ""))
    for p in sorted(glob.glob(os.path.join(adir, "*.xlsx"))):
        f = os.path.basename(p)
        m = re.match(r"(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)", f)
        if not m:
            print("skipped (name not date-sampleID-...):", f); continue
        d = f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}"
        for name, sheet in read_xlsx(p).items():
            # full sheets only: alleleRatio, position, chr, type, ref, mut, targetId, targetCall (a second short sheet repeats the ratios)
            if not sheet or sheet[0][0] != "Column1.alleleRatio" or len(sheet[1]) < 8:
                continue
            for r in sheet[1:]:
                al.append(dict(test="Signatera", draw_date=d, natera_sample_id=m[4], target_id=r[6], chrom=r[2], position=r[1], ref=r[4], alt=r[5],
                               change_type=r[3], allele_ratio=r[0], call=r[7], source_file=f + " | " + name))
            break
    al.sort(key=lambda r: (r["draw_date"], int(r["target_id"].split("_")[1])))
    if al:
        write(os.path.join(LOCAL, "mrd_alleles.tsv"), al)
    nd = len({r["draw_date"] for r in al})
    print(f"mrd_tests.tsv: {len(rows)} draws ({sum(r['result'] == 'DETECTED' for r in rows)} detected) from {len(reports)} report(s); "
          f"mrd_alleles.tsv: {len(al)} rows, {nd} draws")
    var = os.path.join(LOCAL, "mrd_variants.tsv")
    known = {r["target_id"] for r in csv.DictReader(open(var), delimiter="\t")} if os.path.exists(var) else set()
    if {r["target_id"] for r in al} - known:
        print("new variants: run  python3 liftover_mrd.py --ensembl --genes")


def write(path, rows):
    w = csv.DictWriter(open(path, "w"), fieldnames=list(rows[0]), delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(rows)


if __name__ == "__main__":
    main()
