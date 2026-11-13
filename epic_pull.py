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
  3. It downloads Patient, labs, vitals, reports, conditions, meds, etc.
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


def paste_code(expected_state):
    """For an https redirect page: the user pastes what the page shows."""
    print("    After approving, the page shows a block of text with a Copy button.")
    raw = input("    Paste it here and press Enter: ").strip()
    if "?" in raw:  # they pasted a full URL instead
        raw = raw.split("?", 1)[1]
    result = {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}
    if "error" in result:
        sys.exit(f"Authorization failed: {result}")
    if result.get("state") != expected_state:
        sys.exit("State mismatch - the pasted text is from a different login. Run the script again.")
    if "code" not in result:
        sys.exit("No code found in the pasted text.")
    return result["code"]


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
         "Condition", "MedicationRequest", "AllergyIntolerance", "Immunization",
         "Procedure", "Encounter", "DocumentReference", "Binary")]),
        help="OAuth scopes to request")
    ap.add_argument("--redirect-uri", default=LOCAL_REDIRECT_URI,
                    help="Must exactly match a URI registered on the app")
    args = ap.parse_args()
    redirect_uri = args.redirect_uri
    local_mode = redirect_uri == LOCAL_REDIRECT_URI

    outdir = os.path.join(args.out, time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(outdir, exist_ok=True)

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
    print("    Sandbox test login: fhircamila / epicepic1  (or fhirderrick / epicepic1)")
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
            total += sum(1 for en in bundle.get("entry", [])
                         if en.get("resource", {}).get("resourceType") != "OperationOutcome")
            url = next((l["url"] for l in bundle.get("link", [])
                        if l.get("relation") == "next"), None)
            page += 1
        summary[label] = total
        print(f"    {label:22s} {total}")

    save(outdir, "_summary.json", summary)
    print(f"\nDone. Raw files are in: {os.path.abspath(outdir)}")


if __name__ == "__main__":
    main()
