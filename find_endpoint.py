#!/usr/bin/env python3
"""Search Epic's public list of FHIR R4 endpoints (open.epic.com) by name.

Usage:
    python3 find_endpoint.py "stanford" "kaiser" ...

Prints each matching organization and the `--base` address to use with epic_pull.py.
Only hospitals running Epic are on this list; others need a different app registration.
"""
import json
import sys
import urllib.request

URL = "https://open.epic.com/Endpoints/R4"

if len(sys.argv) < 2:
    sys.exit(__doc__)

req = urllib.request.Request(URL, headers={"Accept": "application/fhir+json", "User-Agent": "open-health-data"})
bundle = json.load(urllib.request.urlopen(req, timeout=60))
entries = [e["resource"] for e in bundle.get("entry", []) if e["resource"].get("resourceType") == "Endpoint"]
print(f"{len(entries)} Epic organizations in the list\n")

for term in sys.argv[1:]:
    t = term.lower()
    hits = [e for e in entries if t in e.get("name", "").lower()
            or any(t in c.get("name", "").lower() for c in e.get("contained", []))]
    print(f'== "{term}": {len(hits)} match(es)')
    for e in hits:
        print(f'   {e.get("name")}\n      --base {e.get("address")}')
    if not hits:
        print("   (not on Epic's list: may use a different EHR, or try another spelling)")
    print()
