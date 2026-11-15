#!/usr/bin/env python3
"""
epic_pull.py - pull raw FHIR data for one patient from Epic and save it as-is.

Uses only the Python standard library (Python 3.8+). No installs needed.

Usage:
    # Sandbox (uses the local http://localhost:8765/callback redirect):
    python3 epic_pull.py --client-id YOUR_NON_PRODUCTION_CLIENT_ID

    # Production (https redirect page; you paste the result back in):
    python3 epic_pull.py --client-id YOUR_PRODUCTION_CLIENT_ID \
        --base https://<health-system>/api/FHIR/R4 \
        --redirect-uri https://<you>.github.io/open-health-data/callback.html

What it does:
  1. Opens your browser to Epic's MyChart login (sandbox by default).
  2. You log in as a test patient (e.g. fhircamila / epicepic1) and approve.
  3. It downloads Patient, labs, vitals, reports, conditions, meds (orders,
     dispenses and the Medication record each one points to), the text of
     imaging reports (the Binary each report points to; --report-text), etc.
  4. Saves every response, unmodified, under ./epic_raw/<timestamp>/

Nothing is changed or cleaned. The point is to look at the raw fields.
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

SANDBOX_BASE = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
REDIRECT_PORT = 8765
LOCAL_REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/callback"

# (label, query template). {pid} is replaced with the patient's FHIR ID.
# Epic requires a category on Observation and Condition searches.
QUERIES = [
    ("observation_labs",       "Observation?patient={pid}&category=laboratory"),
    ("observation_vitals",     "Observation?patient={pid}&category=vital-signs"),
    ("diagnostic_reports",     "DiagnosticReport?patient={pid}"),
    ("conditions_problems",    "Condition?patient={pid}&category=problem-list-item"),
    ("medication_requests",    "MedicationRequest?patient={pid}"),
    ("medication_dispenses",   "MedicationDispense?patient={pid}"),
    ("allergies",              "AllergyIntolerance?patient={pid}"),
    ("immunizations",          "Immunization?patient={pid}"),
    ("procedures",             "Procedure?patient={pid}"),
    ("encounters",             "Encounter?patient={pid}"),
]


def http_json(url, token=None, data=None):
    headers = {"Accept": "application/fhir+json, application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def discover(base):
    """Find the authorize/token URLs from the server's SMART configuration."""
    try:
        cfg = http_json(base.rstrip("/") + "/.well-known/smart-configuration")
        return cfg["authorization_endpoint"], cfg["token_endpoint"]
    except Exception as e:
        print(f"  (SMART discovery failed: {e}; using Epic sandbox defaults)")
        root = base.split("/api/FHIR")[0]
        return root + "/oauth2/authorize", root + "/oauth2/token"


def wait_for_code(expected_state):
    """Run a one-shot local web server to catch the OAuth redirect."""
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            msg = "Login received - you can close this tab and return to the terminal."
            if "error" in result:
                msg = f"Error: {result.get('error')} - {result.get('error_description', '')}"
            self.wfile.write(f"<html><body><p>{msg}</p></body></html>".encode())

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("localhost", REDIRECT_PORT), Handler)
    t = threading.Thread(target=server.handle_request)
    t.start()
    t.join(timeout=600)
    server.server_close()
    if "error" in result:
        sys.exit(f"Authorization failed: {result}")
    if result.get("state") != expected_state:
        sys.exit("State mismatch - aborting for safety.")
    if "code" not in result:
        sys.exit("No authorization code received (timed out after 10 minutes?).")
    return result["code"]


def _parse_callback(raw):
    raw = (raw or "").strip()
    if "?" in raw:  # a full URL instead of just the query string
        raw = raw.split("?", 1)[1]
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}


def _clipboard():
    """Current macOS clipboard text, or '' if unavailable."""
    try:
        import subprocess
        return subprocess.run(["pbpaste"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""


def paste_code(expected_state, timeout=900):
    """For an https redirect page: wait for the text the page shows.

    It is picked up automatically when the user clicks the page's Copy button
    (macOS clipboard), or can be pasted here and Enter pressed.
    The clipboard is only read, never logged or saved.
    """
    import select
    print("    After approving, the page shows a block of text with a Copy button.")
    print("    Click Copy - it is picked up automatically (or paste it here and press Enter).")
    before = _clipboard()
    deadline = time.time() + timeout
    while time.time() < deadline:
        clip = _clipboard()
        if clip != before:
            result = _parse_callback(clip)
            if result.get("state") == expected_state:
                break
            before = clip  # something else was copied; keep waiting
        if sys.stdin.isatty():
            ready, _, _ = select.select([sys.stdin], [], [], 1.0)
            if ready:
                result = _parse_callback(sys.stdin.readline())
                if result.get("state") == expected_state or "error" in result:
                    break
                print("    That text isn't from this login - try Copy again.")
        else:
            time.sleep(1.0)
    else:
        sys.exit("Timed out waiting for the login (15 minutes). Run the script again.")
    if "error" in result:
        sys.exit(f"Authorization failed: {result}")
    if "code" not in result:
        sys.exit("No code found in the copied text.")
    print("    Got it.")
    return result["code"]


def medication_refs(bundles):
    """Unique 'Medication/<id>' references from MedicationRequest/-Dispense bundles."""
    refs = []
    for b in bundles:
        for en in b.get("entry", []):
            ref = en.get("resource", {}).get("medicationReference", {}).get("reference", "")
            if ref.startswith("Medication/") and ref not in refs:
                refs.append(ref)
    return refs


def fetch_medications(base, access, outdir, bundles):
    """Orders and dispenses only point to Medication/<id> (the drug's codes, e.g. RxNorm).
    Epic can't search Medication by patient, so read each one. Responses are stored
    unchanged, collected in medications_p1.json (a 'collection' Bundle); failures are
    listed in medications_errors.json."""
    refs = medication_refs(bundles)
    found, errors = [], []
    for i, ref in enumerate(refs, 1):
        try:
            found.append({"fullUrl": f"{base}/{ref}", "resource": http_json(f"{base}/{ref}", access)})
        except urllib.error.HTTPError as e:
            errors.append({"reference": ref, "status": e.code, "body": e.read().decode()[:300]})
        except urllib.error.URLError as e:
            errors.append({"reference": ref, "status": "network", "body": str(e.reason)[:300]})
        if i % 50 == 0:
            print(f"      ... {i}/{len(refs)}")
    save(outdir, "medications_p1.json", {"resourceType": "Bundle", "type": "collection",
                                         "total": len(found), "entry": found})
    if errors:
        save(outdir, "medications_errors.json", errors)
    return len(found) if not errors else f"{len(found)} ({len(errors)} failed)"


FORM_EXT = {"text/html": "html", "text/plain": "txt", "text/rtf": "rtf", "application/rtf": "rtf",
            "application/pdf": "pdf", "text/xml": "xml", "application/xml": "xml"}


def http_raw(url, token, accept):
    """GET a Binary as the server sends it (no JSON parsing). Returns (bytes, content type)."""
    req = urllib.request.Request(url, headers={"Accept": accept, "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", "")


def is_imaging(report):
    """Radiology/imaging DiagnosticReports (category text or code), e.g. MRI, CT, X-ray reports."""
    words = [c.get("text", "") for c in report.get("category", [])]
    words += [cd.get("code", "") + " " + cd.get("display", "")
              for c in report.get("category", []) for cd in c.get("coding", [])]
    return any(w in t.lower() for t in words for w in ("imag", "radiolog", "rad"))


def report_forms(bundles, which):
    """(report, form) pairs whose text lives in a separate Binary (presentedForm.url)."""
    out = []
    for b in bundles:
        for en in b.get("entry", []):
            r = en.get("resource", {})
            if r.get("resourceType") != "DiagnosticReport":
                continue
            if which == "imaging" and not is_imaging(r):
                continue
            for f in r.get("presentedForm", []):
                if f.get("url") and not f.get("data"):
                    out.append((r, f))
    return out


def fetch_report_binaries(base, access, outdir, bundles, which="imaging"):
    """A DiagnosticReport only points to its text (presentedForm.url -> Binary/<id>).
    Download each one unchanged into <outdir>/binaries/, asking for the form's own content
    type, and list them in binaries_index.json (report id, date, name, file, status)."""
    if which == "none":
        return "skipped"
    pairs = report_forms(bundles, which)
    os.makedirs(os.path.join(outdir, "binaries"), exist_ok=True)
    index, failed = [], 0
    for i, (r, f) in enumerate(pairs, 1):
        url = f["url"] if f["url"].startswith("http") else f"{base.rstrip('/')}/{f['url'].lstrip('/')}"
        bid = url.rstrip("/").split("/")[-1]
        ctype = f.get("contentType", "")
        name = "".join(c if c.isalnum() or c in "-_." else "_" for c in bid)[:120]
        item = {"report_id": r.get("id"), "date": r.get("effectiveDateTime") or r.get("issued"),
                "report": r.get("code", {}).get("text"), "content_type": ctype, "url": url}
        try:
            body, got = http_raw(url, access, ctype or "*/*")
            fname = f"binaries/{name}.{FORM_EXT.get(got.split(';')[0].strip(), FORM_EXT.get(ctype, 'bin'))}"
            with open(os.path.join(outdir, fname), "wb") as fh:
                fh.write(body)
            item.update(file=fname, served_as=got, bytes=len(body))
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode(errors="replace")[:300]
            except Exception:
                detail = ""
            item.update(error=f"HTTP {e.code}", body=detail); failed += 1
        except urllib.error.URLError as e:
            item.update(error="network", body=str(e.reason)[:300]); failed += 1
        index.append(item)
        if i % 50 == 0:
            print(f"      ... {i}/{len(pairs)}")
    save(outdir, "binaries_index.json", index)
    return len(pairs) - failed if not failed else f"{len(pairs) - failed} ({failed} failed)"


def save(outdir, name, obj):
    path = os.path.join(outdir, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id", required=True,
                    help="Non-production client ID from fhir.epic.com")
    ap.add_argument("--base", default=SANDBOX_BASE,
                    help="FHIR R4 base URL (defaults to Epic's sandbox)")
    ap.add_argument("--out", default="epic_raw", help="Output folder")
    ap.add_argument("--scope", default=" ".join(
        ["launch/patient", "openid", "fhirUser"] +
        [f"patient/{r}.read" for r in ("Patient", "Observation", "DiagnosticReport",
         "Condition", "MedicationRequest", "MedicationDispense", "Medication",
         "AllergyIntolerance", "Immunization",
         "Procedure", "Encounter", "DocumentReference", "Binary")]),
        help="OAuth scopes to request")
    ap.add_argument("--redirect-uri", default=LOCAL_REDIRECT_URI,
                    help="Must exactly match a URI registered on the app")
    ap.add_argument("--report-text", choices=("imaging", "all", "none"), default="imaging",
                    help="Download the text documents (Binary) that DiagnosticReports point to: "
                         "imaging reports only (default), all reports, or none")
    ap.add_argument("--site", default=None,
                    help="Short name for the health system, e.g. mdanderson "
                         "(default: taken from the --base host)")
    args = ap.parse_args()
    redirect_uri = args.redirect_uri
    local_mode = redirect_uri == LOCAL_REDIRECT_URI
    is_sandbox = args.base.rstrip("/") == SANDBOX_BASE.rstrip("/")
    host = urllib.parse.urlparse(args.base).hostname or "unknown"
    site = args.site or ("sandbox" if is_sandbox else
                         next((p for p in host.split(".") if p not in ("fhir", "www", "epicproxy")), host))
    site = "".join(c for c in site.lower() if c.isalnum() or c in "-_") or "unknown"

    started = time.gmtime()
    outdir = os.path.join(args.out, time.strftime("%Y%m%d-%H%M%S") + "-" + site)
    os.makedirs(outdir, exist_ok=True)
    # Record where this pull came from, so pulls from many health systems never get mixed up.
    save(outdir, "_source.json", {
        "site": site, "fhir_base": args.base, "client_id": args.client_id,
        "pulled_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", started),
        "redirect_mode": "local" if local_mode else "paste",
    })

    print("1/4 Discovering Epic login endpoints...")
    auth_url, token_url = discover(args.base)

    # PKCE: proves the code exchange comes from the same program that started login.
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(16)

    params = {
        "response_type": "code",
        "client_id": args.client_id,
        "redirect_uri": redirect_uri,
        "scope": args.scope,
        "state": state,
        "aud": args.base,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    login = auth_url + "?" + urllib.parse.urlencode(params)

    print("2/4 Opening your browser to log in.")
    if is_sandbox:
        print("    Sandbox test login: fhircamila / epicepic1  (or fhirderrick / epicepic1)")
    else:
        print(f"    Log in with the patient's own MyChart account for: {site}")
    print(f"    If the browser doesn't open, paste this URL:\n    {login}\n")
    webbrowser.open(login)
    code = wait_for_code(state) if local_mode else paste_code(state)

    print("3/4 Exchanging the login code for an access token...")
    try:
        tok = http_json(token_url, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": args.client_id,
            "code_verifier": verifier,
        })
    except urllib.error.HTTPError as e:
        sys.exit(f"Token request failed ({e.code}): {e.read().decode()[:500]}")
    access, pid = tok["access_token"], tok.get("patient")
    print(f"    Granted scope: {tok.get('scope')}")
    # Keep the token response's non-secret fields for reference; never save tokens.
    save(outdir, "_token_info.json",
         {k: v for k, v in tok.items() if "token" not in k})
    if not pid:
        sys.exit("Token response had no patient ID - check the app's audience is 'Patients'.")

    print(f"4/4 Downloading data for patient {pid} ...")
    summary = {}
    try:
        save(outdir, "patient.json", http_json(f"{args.base}/Patient/{pid}", access))
        summary["patient"] = 1
    except urllib.error.HTTPError as e:
        summary["patient"] = f"HTTP {e.code}"

    med_bundles, report_bundles = [], []
    for label, tmpl in QUERIES:
        url = f"{args.base}/{tmpl.format(pid=pid)}"
        page, total = 1, 0
        while url:
            try:
                bundle = http_json(url, access)
            except urllib.error.HTTPError as e:
                err = e.read().decode()[:300]
                save(outdir, f"{label}_ERROR.json", {"status": e.code, "body": err, "url": url})
                total = f"HTTP {e.code} (API probably not enabled on your app)"
                break
            save(outdir, f"{label}_p{page}.json", bundle)
            if label.startswith("medication_"):
                med_bundles.append(bundle)
            if label == "diagnostic_reports":
                report_bundles.append(bundle)
            total += sum(1 for en in bundle.get("entry", [])
                         if en.get("resource", {}).get("resourceType") != "OperationOutcome")
            url = next((l["url"] for l in bundle.get("link", [])
                        if l.get("relation") == "next"), None)
            page += 1
        summary[label] = total
        print(f"    {label:22s} {total}")

    print("    medications (one read per referenced drug)...")
    summary["medications"] = fetch_medications(args.base, access, outdir, med_bundles)
    print(f"    {'medications':22s} {summary['medications']}")

    print(f"    report text ({args.report_text}; one read per attached document)...")
    summary["report_binaries"] = fetch_report_binaries(args.base, access, outdir,
                                                       report_bundles, args.report_text)
    print(f"    {'report_binaries':22s} {summary['report_binaries']}")

    save(outdir, "_summary.json", summary)
    print(f"\nDone. Raw files are in: {os.path.abspath(outdir)}")


if __name__ == "__main__":
    main()
