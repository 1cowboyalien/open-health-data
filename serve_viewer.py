#!/usr/bin/env python3
"""Serve the private viewer and keep its edits in one shared file, so every browser sees them.

Usage:
    python3 serve_viewer.py            # only this Mac:   http://127.0.0.1:8766/
    python3 serve_viewer.py --lan      # also other devices on the same Wi-Fi (no login!)
    python3 serve_viewer.py --port 8800

- Serves only local/labs.html (no folder listing, no other files), plus the imaging viewer's files:
  GET /imaging/<path> from local/imaging/ only, only .nii.gz (scans, outlines, dose maps) and .obj (3D lesion models).
- Pathology slide photos: GET /pathology/<path> from local/pathology/ only, only .jpg.
- GET  /api/edits  -> {"rev": n, "edits": {...}}  from local/med_edits.json (the same file the
  build scripts read, so moments, medication changes and saved ranges survive reloads/rebuilds).
- POST /api/edits  {"rev": n, "edits": {...}} saves them. If someone saved in between (rev differs)
  the answer is 409 with the newest version, so nobody silently overwrites another person's change.
- Every save first copies the previous file to local/edits_history/ (the newest 300 are kept).
- /ask/<path>: passed on to the separate chat server named in local/ask.json ({"chatServer": "http://127.0.0.1:8820"}),
  so the viewer's Ask features (ask_view.js) work at whatever address the viewer is reached by. Only the chat
  server's own paths are passed on, with X-Ask-Remote = the visitor's address; answers are streamed back.
  Without local/ask.json, /ask/ is 404.
There is no login: anyone who can reach the address can view, and switch the page to Edit.
Use --lan only on a private home network, and stop the server (Ctrl+C) when you're done.
Python standard library only.
"""
import urllib.parse
import http.client
import argparse
import json
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
PAGE = os.path.join(LOCAL, "labs.html")
EDITS = os.path.join(LOCAL, "med_edits.json")
HIST = os.path.join(LOCAL, "edits_history")
IMG_TYPES = (".nii.gz", ".obj")
KEEP = 300
MAXBODY = 5_000_000
lock = threading.Lock()
ASK_CONF = os.path.join(LOCAL, "ask.json")
ASK_PATHS = ("/", "/review", "/file", "/api/quick-asks", "/api/chat", "/api/conversations",
             "/api/conversation", "/api/review")


def read_edits():
    if not os.path.exists(EDITS):
        return 0, None
    e = json.load(open(EDITS))
    return int(e.pop("rev", 0) or 0), e


def write_edits(rev, edits):
    if os.path.exists(EDITS):
        os.makedirs(HIST, exist_ok=True)
        shutil.copy2(EDITS, os.path.join(HIST, time.strftime("med_edits-%Y%m%dT%H%M%SZ", time.gmtime())
                                         + f"-r{rev - 1}.json"))
        old = sorted(os.listdir(HIST))
        for f in old[:-KEEP]:
            os.remove(os.path.join(HIST, f))
    tmp = EDITS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(dict(edits, rev=rev), f, indent=1)
    os.replace(tmp, EDITS)


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json", cache=False):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)

    def ask_proxy(self):
        """Pass /ask/... on to the chat server and stream its answer back."""
        try:
            target = urllib.parse.urlparse(json.load(open(ASK_CONF))["chatServer"])
        except (OSError, ValueError, KeyError):
            return self.send(404, {"error": "Ask is not set up"})
        sub = self.path[len("/ask"):] or "/"
        if sub.split("?")[0] not in ASK_PATHS:
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAXBODY:
            return self.send(413, {"error": "too large"})
        body = self.rfile.read(n) if n else None
        headers = {"X-Ask-Remote": self.client_address[0]}
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers["Content-Type"]
        try:
            conn = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=900)
            conn.request(self.command, sub, body=body, headers=headers)
            r = conn.getresponse()
        except OSError:
            return self.send(502, {"error": "the chat server isn't running"})
        self.send_response(r.status)
        for k in ("Content-Type", "Content-Length"):
            if r.getheader(k):
                self.send_header(k, r.getheader(k))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                chunk = r.read1(65536) if hasattr(r, "read1") else r.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/ask" or path.startswith("/ask/"):
            return self.ask_proxy()
        if path in ("/", "/labs.html"):
            if not os.path.exists(PAGE):
                return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
            return self.send(200, open(PAGE, "rb").read(), "text/html; charset=utf-8")
        if path.startswith("/imaging/"):   # imaging viewer files: inside local/imaging/, scan/model types only
            rel = urllib.parse.unquote(path[len("/imaging/"):])
            base = os.path.realpath(os.path.join(LOCAL, "imaging"))
            f = os.path.realpath(os.path.join(base, rel))
            if (f.startswith(base + os.sep) and f.endswith(IMG_TYPES) and os.path.isfile(f)):
                return self.send(200, open(f, "rb").read(), "application/octet-stream")
            return self.send(404, {"error": "not found"})
        if path.startswith("/pathology/"):   # pathology slide photos: inside local/pathology/, .jpg only
            rel = urllib.parse.unquote(path[len("/pathology/"):])
            base = os.path.realpath(os.path.join(LOCAL, "pathology"))
            f = os.path.realpath(os.path.join(base, rel))
            if f.startswith(base + os.sep) and f.lower().endswith(".jpg") and os.path.isfile(f):
                return self.send(200, open(f, "rb").read(), "image/jpeg", cache=True)
            return self.send(404, {"error": "not found"})
        if path == "/api/edits":
            with lock:
                rev, edits = read_edits()
            return self.send(200, {"rev": rev, "edits": edits})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0].startswith("/ask/"):
            return self.ask_proxy()
        if self.path.split("?")[0] != "/api/edits":
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAXBODY:
            return self.send(413, {"error": "empty or too large"})
        try:
            body = json.loads(self.rfile.read(n))
            base, edits = int(body["rev"]), body["edits"]
            if not isinstance(edits, dict) or edits.get("version") != 1:
                raise ValueError("not a med_edits object")
        except Exception as e:  # noqa: BLE001 - any bad input is a 400
            return self.send(400, {"error": str(e)})
        with lock:
            rev, cur = read_edits()
            if base != rev:
                return self.send(409, {"rev": rev, "edits": cur})
            write_edits(rev + 1, edits)
        self.send(200, {"rev": rev + 1})

    def log_message(self, fmt, *args):  # one short line per save, nothing for page loads
        if self.command == "POST" and self.path.split("?")[0] == "/api/edits":
            print(time.strftime("%H:%M:%S"), self.client_address[0], "saved edits", args[1] if len(args) > 1 else "")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--lan", action="store_true", help="listen on all network interfaces (home Wi-Fi only)")
    ap.add_argument("--port", type=int, default=8766)
    a = ap.parse_args()
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    print(f"Viewer: http://127.0.0.1:{a.port}/" + ("  (also on this Mac's network address; no login)" if a.lan else ""))
    print("Edits are kept in", EDITS, "| Ctrl+C to stop")
    ThreadingHTTPServer((host, a.port), Handler).serve_forever()
