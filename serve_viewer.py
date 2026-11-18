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
- Usage statistics (usage.py): every request is logged to local/usage.sqlite (private), each browser
  gets a random visitor cookie, and the page reports which panels were used (usage.js, injected
  when labs.html is served; code names only, never health values or Ask text).
  GET /stats is the report page with a health meter. It and /api/stats answer only this Mac and the
  home network (private addresses), unless local/usage.json has {"statsKey": "..."}: then
  /stats?key=<that key> also works from outside (and remembers it in a cookie).
There is no login: anyone who can reach the address can view, and switch the page to Edit.
Use --lan only on a private home network, and stop the server (Ctrl+C) when you're done.
Python standard library only.
"""
import urllib.parse
import http.client
import argparse
import json
import os
import re
import shutil
import threading
import hmac
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import usage

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
PAGE = os.path.join(LOCAL, "labs.html")
EDITS = os.path.join(LOCAL, "med_edits.json")
HIST = os.path.join(LOCAL, "edits_history")
IMG_TYPES = (".nii.gz", ".obj")
KEEP = 300
MAXBODY = 5_000_000
lock = threading.Lock()
USAGE = None   # usage.Usage, set in __main__
USAGE_JS = os.path.join(HERE, "usage.js")
STATS_HTML = os.path.join(HERE, "stats_view.html")
USAGE_CONF = os.path.join(LOCAL, "usage.json")
NOLOG = ("/stats", "/api/stats", "/api/ping", "/usage.js", "/api/usage")
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
    def send(self, code, body, ctype="application/json", cache=False, headers=()):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400" if cache else "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self._bytes = getattr(self, "_bytes", 0) + len(data)
        self.wfile.write(data)

    def send_response(self, code, message=None):
        self._status = code
        super().send_response(code, message)

    # ---- usage logging around every request ----
    def logged(self, fn):
        t0 = time.perf_counter()
        self._status, self._bytes = 0, 0
        self._vid = usage.visitor_id(self) if USAGE else ""
        try:
            fn()
        except (BrokenPipeError, ConnectionResetError):
            self._status = self._status or 499
        finally:
            if USAGE and self.path.split("?")[0] not in NOLOG:
                USAGE.hit(self, self._status, self._bytes, (time.perf_counter() - t0) * 1000, self._vid)

    def stats_allowed(self):
        """Stats only for this Mac and the home network, or with the key from local/usage.json."""
        if usage.is_local_request(self):
            return True, ()
        key = str(usage.load_conf(USAGE_CONF).get("statsKey") or "")
        if len(key) < 12:
            return False, ()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("key", [""])[0]
        c = re.search(r"(?:^|;\s*)ohd_sk=([^;]+)", self.headers.get("Cookie") or "")
        for given in (q, c.group(1) if c else ""):
            if given and hmac.compare_digest(given.encode(), key.encode()):
                return True, (("Set-Cookie", f"ohd_sk={key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"),)
        return False, ()

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
        self._bytes = 0
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
                self._bytes += len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    def do_GET(self):
        self.logged(self.get)

    def do_POST(self):
        self.logged(self.post)

    def get(self):
        path = self.path.split("?")[0]
        if path == "/ask" or path.startswith("/ask/"):
            return self.ask_proxy()
        if path in ("/", "/labs.html"):
            if not os.path.exists(PAGE):
                return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
            html, extra = open(PAGE, "rb").read(), []
            if USAGE:
                if not self._vid:
                    self._vid = usage.new_visitor_id()
                    extra.append(("Set-Cookie", f"ohd_vid={self._vid}; Path=/; Max-Age=63072000; SameSite=Lax"))
                i = html.rfind(b"</body>")
                tag = b'<script src="/usage.js" defer></script>'
                html = html[:i] + tag + html[i:] if i >= 0 else html + tag
            return self.send(200, html, "text/html; charset=utf-8", headers=extra)
        if path == "/usage.js":
            return self.send(200, open(USAGE_JS, "rb").read(), "text/javascript; charset=utf-8")
        if path in ("/stats", "/api/stats", "/api/ping"):
            ok, cookie = self.stats_allowed()
            if not ok or not USAGE:
                return self.send(404, {"error": "not found"})
            if path == "/api/ping":
                return self.send(200, {"t": time.time()})
            if path == "/api/stats":
                rng = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("r", ["day"])[0]
                return self.send(200, USAGE.stats(rng), headers=cookie)
            return self.send(200, open(STATS_HTML, "rb").read(), "text/html; charset=utf-8", headers=cookie)
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

    def post(self):
        if self.path.split("?")[0].startswith("/ask/"):
            return self.ask_proxy()
        if self.path.split("?")[0] == "/api/usage":
            n = int(self.headers.get("Content-Length") or 0)
            if not USAGE or n <= 0 or n > 16000:
                return self.send(400, {"error": "bad"})
            try:
                body = json.loads(self.rfile.read(n))
                assert isinstance(body, dict)
            except Exception:  # noqa: BLE001
                return self.send(400, {"error": "bad"})
            return self.send(200, {"ok": USAGE.events(self, self._vid, body)})
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
    USAGE = usage.Usage(os.path.join(LOCAL, "usage.sqlite"))
    print(f"Usage stats: http://127.0.0.1:{a.port}/stats (this Mac and the home network only)")
    ThreadingHTTPServer((host, a.port), Handler).serve_forever()
